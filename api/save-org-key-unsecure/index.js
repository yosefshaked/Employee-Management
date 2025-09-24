/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { readEnv, respond } from '../_shared/context.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { normalizeString } from '../_shared/org-connections.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADD_PLAINTEXT_COLUMN_SQL = 'ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS dedicated_key_plaintext text;';

function parseRequestBody(req) {
  if (req?.body && typeof req.body === 'object') {
    return req.body;
  }

  const rawBody = typeof req?.body === 'string'
    ? req.body
    : typeof req?.rawBody === 'string'
      ? req.rawBody
      : null;

  if (!rawBody) {
    return {};
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    return {};
  }
}

function isValidOrgId(value) {
  return UUID_PATTERN.test(value);
}

function isAdminRole(role) {
  if (!role) {
    return false;
  }
  const normalized = String(role).trim().toLowerCase();
  return normalized === 'admin' || normalized === 'owner';
}

export default async function handler(context, req) {
  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);
  const { supabaseUrl, serviceRoleKey } = adminConfig;

  if (!supabaseUrl || !serviceRoleKey) {
    context.log?.error?.('save-org-key-unsecure missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    context.log?.warn?.('save-org-key-unsecure missing bearer token');
    return respond(context, 401, { message: 'missing bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('save-org-key-unsecure failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    context.log?.warn?.('save-org-key-unsecure token did not resolve to user');
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const body = parseRequestBody(req);
  const orgId = normalizeString(body.org_id || body.orgId);
  const dedicatedKey = normalizeString(
    body.service_role_key
      || body.serviceRoleKey
      || body.dedicated_key
      || body.dedicatedKey,
  );

  if (!orgId || !isValidOrgId(orgId)) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  if (!dedicatedKey) {
    return respond(context, 400, { message: 'missing service role key' });
  }

  const membershipResult = await supabase
    .from('org_memberships')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();

  if (membershipResult.error) {
    context.log?.error?.('save-org-key-unsecure failed to load membership', {
      orgId,
      userId,
      message: membershipResult.error.message,
    });
    return respond(context, 500, { message: 'failed to verify membership' });
  }

  if (!membershipResult.data || !isAdminRole(membershipResult.data.role)) {
    context.log?.warn?.('save-org-key-unsecure forbidden', {
      orgId,
      userId,
      hasMembership: Boolean(membershipResult.data),
    });
    return respond(context, 403, { message: 'forbidden' });
  }

  const savedAt = new Date().toISOString();
  const updates = {
    dedicated_key_plaintext: dedicatedKey,
    dedicated_key_saved_at: savedAt,
    updated_at: savedAt,
  };

  const { error: updateError } = await supabase
    .from('organizations')
    .update(updates)
    .eq('id', orgId);

  if (updateError) {
    if (updateError.code === '42703') {
      return respond(context, 400, {
        message: 'missing_plaintext_column',
        hint: 'The dedicated_key_plaintext column is missing. Run the provided SQL migration and try again.',
        sql: ADD_PLAINTEXT_COLUMN_SQL,
      });
    }

    context.log?.error?.('save-org-key-unsecure update failed', {
      orgId,
      userId,
      message: updateError.message,
      code: updateError.code,
    });
    return respond(context, 500, { message: 'failed to store dedicated key' });
  }

  context.log?.info?.('save-org-key-unsecure success', { orgId, userId });
  return respond(context, 200, { saved: true, saved_at: savedAt });
}
