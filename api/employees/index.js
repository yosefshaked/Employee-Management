/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { readEnv, respond } from '../_shared/context.js';
import {
  normalizeString,
  resolveEncryptionSecret,
  deriveEncryptionKey,
  decryptDedicatedKey,
  fetchOrgConnection,
} from '../_shared/org-connections.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export default async function (context, req) {
  console.log('[API INIT] /api/employees handler invoked');

  try {
    const authorization = resolveBearerAuthorization(req);
    if (!authorization?.token) {
      context.log?.warn?.('employees missing bearer token');
      return respond(context, 401, { message: 'missing bearer' });
    }

    const env = readEnv(context);
    const adminConfig = readSupabaseAdminConfig(env);
    const { supabaseUrl, serviceRoleKey } = adminConfig;

    if (!supabaseUrl || !serviceRoleKey) {
      context.log?.error?.('employees missing Supabase admin credentials');
      return respond(context, 500, { message: 'server_misconfigured' });
    }

    const supabaseAdmin = createSupabaseAdminClient(adminConfig);

    let authResult;
    try {
      authResult = await supabaseAdmin.auth.getUser(authorization.token);
    } catch (error) {
      context.log?.error?.('employees failed to validate token', { message: error?.message });
      return respond(context, 401, { message: 'invalid or expired token' });
    }

    const user = authResult?.data?.user;
    if (!user) {
      return respond(context, 401, { message: 'Invalid user token' });
    }

    const method = String(req.method || 'GET').toUpperCase();
    const body = method === 'GET' ? {} : parseRequestBody(req);
    const query = req?.query ?? {};
    const orgCandidate = body.org_id || body.orgId || query.org_id || query.orgId;
    const orgId = normalizeString(orgCandidate);

    if (!orgId || !UUID_PATTERN.test(orgId)) {
      return respond(context, 400, { message: 'invalid org id' });
    }

    const connectionResult = await fetchOrgConnection(supabaseAdmin, orgId);
    if (connectionResult.error) {
      const message = connectionResult.error.message || 'failed_to_load_connection';
      const status = message === 'missing_connection_settings'
        ? 412
        : message === 'missing_dedicated_key'
          ? 428
          : 500;
      return respond(context, status, { message });
    }

    const encryptionSecret = resolveEncryptionSecret(env);
    const encryptionKey = deriveEncryptionKey(encryptionSecret);

    if (!encryptionKey) {
      context.log?.error?.('employees missing encryption secret');
      return respond(context, 500, { message: 'encryption_not_configured' });
    }

    const dedicatedKey = decryptDedicatedKey(connectionResult.encryptedKey, encryptionKey);
    if (!dedicatedKey) {
      return respond(context, 500, { message: 'Could not retrieve dedicated key for org.' });
    }

    const supabaseUrlHost = new URL(connectionResult.supabaseUrl).hostname;
    const customerSupabaseUrl = `https://${supabaseUrlHost}/functions/v1/secure-api-worker`;

    const response = await fetch(customerSupabaseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${dedicatedKey}`,
        apikey: connectionResult.anonKey,
      },
      body: JSON.stringify({
        action: 'GET_EMPLOYEES',
        payload: {},
      }),
    });

    let data;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      const errorMessage = (data && (data.error || data.message)) || 'Edge function call failed';
      throw new Error(errorMessage);
    }

    return respond(context, 200, data ?? {});
  } catch (error) {
    console.error('API Proxy Error:', error);
    return respond(context, 500, { message: error.message || 'internal_server_error' });
  }
}
