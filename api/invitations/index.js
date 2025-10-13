/* eslint-env node */
import process from 'node:process';
import { json, resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMIN_ROLES = new Set(['admin', 'owner']);
const ACTIVE_INVITE_STATUSES = ['pending', 'sent'];

function readEnv(context) {
  if (context?.env && typeof context.env === 'object') {
    return context.env;
  }
  return process.env ?? {};
}

function respond(context, status, body, extraHeaders) {
  const response = json(status, body, extraHeaders);
  context.res = response;
  return response;
}

function normalizeString(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function normalizeEmail(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return '';
  }
  return normalized.toLowerCase();
}

function isValidEmail(value) {
  if (!value) {
    return false;
  }
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return EMAIL_PATTERN.test(value);
}

function parseRequestBody(req) {
  if (req?.body && typeof req.body === 'object' && req.body !== null && !Array.isArray(req.body)) {
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
  return ADMIN_ROLES.has(String(role).trim().toLowerCase());
}

function resolveAppBaseUrl(env) {
  const candidates = [
    env.APP_PUBLIC_URL,
    env.APP_BASE_URL,
    env.APP_SITE_URL,
    env.APP_WEB_URL,
    env.APP_DESKTOP_URL,
    env.APP_URL,
    env.PUBLIC_APP_URL,
    env.PUBLIC_URL,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeString(candidate);
    if (!normalized) {
      continue;
    }
    const trimmed = normalized.replace(/\/+$/, '');
    if (trimmed) {
      return trimmed;
    }
  }

  return '';
}

function buildInvitationLink(baseUrl, token) {
  if (!baseUrl || !token) {
    return '';
  }
  const encodedToken = encodeURIComponent(token);
  return `${baseUrl}/#/accept-invite?token=${encodedToken}`;
}

function extractInviterName(user) {
  if (!user || typeof user !== 'object') {
    return null;
  }

  const metadata = user.user_metadata && typeof user.user_metadata === 'object'
    ? user.user_metadata
    : user.raw_user_meta_data && typeof user.raw_user_meta_data === 'object'
      ? user.raw_user_meta_data
      : null;

  if (metadata) {
    const fullName = normalizeString(metadata.full_name || metadata.fullName || metadata.name);
    if (fullName) {
      return fullName;
    }

    const firstName = normalizeString(metadata.first_name || metadata.firstName);
    const lastName = normalizeString(metadata.last_name || metadata.lastName);
    const joined = [firstName, lastName].filter(Boolean).join(' ');
    if (joined) {
      return joined;
    }
  }

  const email = normalizeEmail(user.email);
  if (email) {
    return email;
  }

  return null;
}

function normalizeInvitationRow(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }
  return {
    id: row.id ?? null,
    org_id: row.org_id ?? null,
    email: row.email ? row.email.toLowerCase() : null,
    status: row.status || 'pending',
    invited_by: row.invited_by ?? null,
    created_at: row.created_at ?? null,
    expires_at: row.expires_at ?? null,
  };
}

async function ensureMembershipRole(supabase, orgId, userId) {
  const { data, error } = await supabase
    .from('org_memberships')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || 'failed_to_fetch_membership');
  }

  if (!data) {
    return null;
  }

  return data.role || null;
}

async function fetchOrganization(supabase, orgId) {
  const { data, error } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('id', orgId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || 'failed_to_fetch_organization');
  }

  if (!data) {
    return null;
  }

  return data;
}

async function checkExistingMembership(supabase, orgId, email) {
  const { data, error } = await supabase
    .from('org_memberships')
    .select('user_id, users!inner(email)')
    .eq('org_id', orgId)
    .eq('users.email', email)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || 'failed_to_check_membership');
  }

  return Boolean(data);
}

async function findActiveInvitation(supabase, orgId, email) {
  const { data, error } = await supabase
    .from('org_invitations')
    .select('id, status')
    .eq('org_id', orgId)
    .eq('email', email)
    .in('status', ACTIVE_INVITE_STATUSES)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || 'failed_to_check_existing_invitation');
  }

  return data;
}

async function handlePost(context, req, supabase, user, env) {
  context.log('Invitations POST handler started', { userId: user?.id });

  const body = parseRequestBody(req);
  context.log('Invitations POST body parsed', { hasBody: Boolean(body), bodyKeys: Object.keys(body || {}) });

  const orgId = normalizeString(body.orgId || body.org_id);
  const email = normalizeEmail(body.email);

  if (!orgId || !isValidOrgId(orgId)) {
    context.log('Invitations POST invalid org id detected', { orgId });
    return respond(context, 400, { message: 'invalid_org_id' });
  }

  if (!email || !isValidEmail(email)) {
    context.log('Invitations POST invalid email detected', { orgId, email });
    return respond(context, 400, { message: 'invalid_email' });
  }

  context.log('Invitations POST request body validated', { orgId, email });

  let membershipRole;
  try {
    context.log('Invitations POST verifying membership role', { orgId, userId: user.id });
    membershipRole = await ensureMembershipRole(supabase, orgId, user.id);
    context.log('Invitations POST membership role resolved', { orgId, userId: user.id, membershipRole });
  } catch (membershipError) {
    context.log?.error?.('invitations failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId: user.id,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!membershipRole || !isAdminRole(membershipRole)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  context.log('Invitations POST authorization confirmed', { orgId, userId: user.id, membershipRole });

  let organization;
  try {
    context.log('Invitations POST loading organization', { orgId });
    organization = await fetchOrganization(supabase, orgId);
    context.log('Invitations POST organization loaded', { orgId, organizationFound: Boolean(organization) });
  } catch (organizationError) {
    context.log?.error?.('invitations failed to load organization', {
      message: organizationError?.message,
      orgId,
    });
    return respond(context, 500, { message: 'failed_to_load_organization' });
  }

  if (!organization) {
    return respond(context, 404, { message: 'organization_not_found' });
  }

  try {
    context.log('Invitations POST checking for existing membership', { orgId, invitedEmail: email });
    const membershipExists = await checkExistingMembership(supabase, orgId, email);
    context.log('Invitations POST existing membership check complete', { orgId, invitedEmail: email, membershipExists });
    if (membershipExists) {
      return respond(context, 409, { message: 'user_already_member' });
    }
  } catch (membershipLookupError) {
    context.log?.error?.('invitations failed to check existing membership', {
      message: membershipLookupError?.message,
      orgId,
      invitedEmail: email,
    });
    return respond(context, 500, { message: 'failed_to_check_membership' });
  }

  try {
    context.log('Invitations POST checking for existing invitation', { orgId, invitedEmail: email });
    const existingInvitation = await findActiveInvitation(supabase, orgId, email);
    context.log('Invitations POST existing invitation check complete', {
      orgId,
      invitedEmail: email,
      existingInvitationId: existingInvitation?.id ?? null,
      existingInvitationStatus: existingInvitation?.status ?? null,
    });
    if (existingInvitation) {
      return respond(context, 409, { message: 'invitation_already_pending' });
    }
  } catch (invitationLookupError) {
    context.log?.error?.('invitations failed to check existing invitation', {
      message: invitationLookupError?.message,
      orgId,
      invitedEmail: email,
    });
    return respond(context, 500, { message: 'failed_to_check_existing_invitation' });
  }

  let inserted;
  try {
    context.log('Invitations POST inserting new invitation', { orgId, invitedEmail: email, invitedBy: user.id });
    const insertResult = await supabase
      .from('org_invitations')
      .insert({
        org_id: orgId,
        email,
        invited_by: user.id,
      })
      .select('id, org_id, email, status, invited_by, created_at, expires_at, token')
      .single();

    if (insertResult.error) {
      if (insertResult.error.code === '23505') {
        return respond(context, 409, { message: 'invitation_already_pending' });
      }
      throw new Error(insertResult.error.message || 'failed_to_create_invitation');
    }

    inserted = insertResult.data;
    context.log('Invitations POST insert succeeded', { orgId, invitedEmail: email, invitationId: inserted?.id });
  } catch (insertError) {
    context.log?.error?.('invitations failed to insert invitation', {
      message: insertError?.message,
      orgId,
      invitedEmail: email,
    });
    return respond(context, 500, { message: 'failed_to_create_invitation' });
  }

  if (!inserted || !inserted.token) {
    context.log?.error?.('invitations insert did not return token', {
      orgId,
      invitedEmail: email,
    });
    return respond(context, 500, { message: 'failed_to_create_invitation' });
  }

  const baseUrl = resolveAppBaseUrl(env);
  context.log('Invitations POST resolved base URL', { orgId, baseUrl });
  if (!baseUrl) {
    context.log?.error?.('invitations missing application base URL');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const invitationLink = buildInvitationLink(baseUrl, inserted.token);
  const inviterName = extractInviterName(user);
  const organizationName = normalizeString(organization.name) || null;

  context.log('Invitations POST prepared email payload', {
    orgId,
    invitationId: inserted.id,
    token: inserted.token,
    redirectTo: invitationLink,
    inviterName,
    organizationName,
  });

  let emailResult;
  try {
    context.log('Invitations POST dispatching invite email', { orgId, invitedEmail: email });
    emailResult = await supabase.auth.admin.inviteUserByEmail(email, {
      redirectTo: invitationLink,
      data: {
        inviter_name: inviterName,
        organization_name: organizationName,
      },
    });
    context.log('Invitations POST invite email dispatched', {
      orgId,
      invitedEmail: email,
      hasError: Boolean(emailResult?.error),
    });
  } catch (emailError) {
    context.log?.error?.('invitations failed to dispatch email', {
      message: emailError?.message,
      orgId,
      invitedEmail: email,
    });
    return respond(context, 502, { message: 'failed_to_send_email' });
  }

  if (emailResult.error) {
    context.log?.error?.('invitations email dispatch returned error', {
      message: emailResult.error.message,
      status: emailResult.error.status,
      orgId,
      invitedEmail: email,
    });
    return respond(context, emailResult.error.status || 502, { message: 'failed_to_send_email' });
  }

  const normalizedInvitation = normalizeInvitationRow(inserted);
  context.log('Invitations POST completed successfully', {
    orgId,
    invitationId: normalizedInvitation?.id,
  });
  return respond(context, 201, {
    invitation: normalizedInvitation,
    organization: {
      id: organization.id,
      name: organizationName,
    },
  });
}

async function handleGet(context, req, supabase, userId) {
  const query = req?.query ?? {};
  const orgCandidate = query.orgId || query.org_id;
  const orgId = normalizeString(orgCandidate);

  if (!orgId || !isValidOrgId(orgId)) {
    return respond(context, 400, { message: 'invalid_org_id' });
  }

  let membershipRole;
  try {
    membershipRole = await ensureMembershipRole(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('invitations failed to verify membership on list', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!membershipRole || !isAdminRole(membershipRole)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const { data, error } = await supabase
    .from('org_invitations')
    .select('id, org_id, email, status, invited_by, created_at, expires_at')
    .eq('org_id', orgId)
    .in('status', ACTIVE_INVITE_STATUSES)
    .order('created_at', { ascending: true });

  if (error) {
    context.log?.error?.('invitations failed to list invitations', {
      message: error?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_list_invitations' });
  }

  const normalized = Array.isArray(data) ? data.map((row) => normalizeInvitationRow(row)).filter(Boolean) : [];
  return respond(context, 200, { invitations: normalized });
}

export default async function (context, req) {
  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);
  const { supabaseUrl, serviceRoleKey } = adminConfig;

  if (!supabaseUrl || !serviceRoleKey) {
    context.log?.error?.('invitations missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    context.log?.warn?.('invitations missing bearer token');
    return respond(context, 401, { message: 'missing_bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (authError) {
    context.log?.error?.('invitations failed to validate token', {
      message: authError?.message,
    });
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    context.log?.warn?.('invitations token did not resolve to user');
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  const user = authResult.data.user;
  const method = String(req?.method || 'GET').toUpperCase();

  if (method === 'GET') {
    return handleGet(context, req, supabase, user.id);
  }

  if (method === 'POST') {
    return handlePost(context, req, supabase, user, env);
  }

  return respond(context, 405, { message: 'method_not_allowed' }, { Allow: 'GET, POST' });
}
