/* eslint-env node */
import process from 'node:process';
import { json, resolveBearerAuthorization } from '../_shared/http.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMIN_ROLES = new Set(['admin', 'owner']);
const ACTIVE_INVITE_STATUSES = ['pending', 'sent'];

class InternalApiError extends Error {
  constructor(message, status, payload) {
    super(message || 'internal_api_error');
    this.status = status ?? 500;
    this.payload = payload ?? null;
  }
}

async function parseJsonResponse(response) {
  if (!response) {
    return null;
  }

  const contentType = response.headers?.get?.('content-type') ?? response.headers?.get?.('Content-Type') ?? '';
  const isJson = typeof contentType === 'string' && contentType.toLowerCase().includes('application/json');

  try {
    if (isJson) {
      return await response.json();
    }
    const text = await response.text();
    if (!text) {
      return null;
    }
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function resolveControlApiBaseUrl(env) {
  const candidates = [
    env.CONTROL_API_URL,
    env.CONTROL_DB_API_URL,
    env.APP_CONTROL_API_URL,
    env.INTERNAL_CONTROL_API_URL,
    env.CONTROL_SERVICE_URL,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeString(candidate);
    if (!normalized) {
      continue;
    }
    return normalized.replace(/\/+$/, '');
  }

  return '';
}

function buildInternalApiUrl(baseUrl, path, query) {
  const normalizedBase = `${baseUrl}/`.replace(/\/+/g, '/');
  const trimmedPath = normalizeString(path).replace(/^\/+/, '');
  const url = new URL(trimmedPath || '', normalizedBase);

  if (query && typeof query === 'object') {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) {
        continue;
      }

      if (Array.isArray(value)) {
        for (const entry of value) {
          if (entry === undefined || entry === null) {
            continue;
          }
          url.searchParams.append(key, String(entry));
        }
        continue;
      }

      url.searchParams.append(key, String(value));
    }
  }

  return url.toString();
}

function createInternalApiClient(context, env, authorizationHeader) {
  const baseUrl = resolveControlApiBaseUrl(env);
  if (!baseUrl) {
    return null;
  }

  async function request(method, path, { query, body, headers: extraHeaders } = {}) {
    const url = buildInternalApiUrl(baseUrl, path, query);
    const headers = {
      Accept: 'application/json',
      ...(extraHeaders ?? {}),
    };

    if (authorizationHeader) {
      headers.Authorization = authorizationHeader;
      if (!headers['X-Supabase-Authorization']) {
        headers['X-Supabase-Authorization'] = authorizationHeader;
      }
    }

    const hasBody = body !== undefined && body !== null;
    const serializedBody = hasBody ? JSON.stringify(body) : undefined;

    if (hasBody) {
      headers['Content-Type'] = 'application/json';
    }

    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: serializedBody,
      });
    } catch (networkError) {
      context.log?.error?.('control api request failed', {
        method,
        path,
        message: networkError?.message,
      });
      throw new InternalApiError('control_api_unreachable', 502, {
        message: networkError?.message,
      });
    }

    const payload = await parseJsonResponse(response);

    if (!response.ok) {
      const message = payload?.message || 'control_api_error';
      throw new InternalApiError(message, response.status, payload);
    }

    return { status: response.status, data: payload };
  }

  return {
    baseUrl,
    request,
    get(path, options) {
      return request('GET', path, options);
    },
    post(path, options) {
      return request('POST', path, options);
    },
  };
}

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
      : user.metadata && typeof user.metadata === 'object'
        ? user.metadata
        : user.profile && typeof user.profile === 'object'
          ? user.profile
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

async function ensureMembershipRole(controlApi, orgId, userId) {
  try {
    const { data } = await controlApi.get('/org_memberships', {
      query: { org_id: orgId, user_id: userId },
    });

    const record = Array.isArray(data) ? data.find((entry) => entry && typeof entry === 'object') : data;
    if (!record || typeof record !== 'object') {
      return null;
    }

    return record.role ?? null;
  } catch (error) {
    if (error instanceof InternalApiError && (error.status === 404 || error.status === 204)) {
      return null;
    }
    throw error;
  }
}

async function fetchOrganization(controlApi, orgId) {
  try {
    const { data } = await controlApi.get(`/organizations/${encodeURIComponent(orgId)}`);
    if (!data || typeof data !== 'object') {
      return null;
    }

    if (data.organization && typeof data.organization === 'object') {
      return data.organization;
    }

    return data;
  } catch (error) {
    if (error instanceof InternalApiError && (error.status === 404 || error.status === 204)) {
      return null;
    }
    throw error;
  }
}

async function checkExistingMembership(controlApi, orgId, email) {
  try {
    const { data } = await controlApi.get('/org_memberships', {
      query: { org_id: orgId, email },
    });

    if (Array.isArray(data)) {
      return data.length > 0;
    }

    return Boolean(data);
  } catch (error) {
    if (error instanceof InternalApiError && (error.status === 404 || error.status === 204)) {
      return false;
    }
    throw error;
  }
}

async function findActiveInvitation(controlApi, orgId, email) {
  try {
    const { data } = await controlApi.get('/org_invitations', {
      query: { org_id: orgId, email, status: ACTIVE_INVITE_STATUSES },
    });

    if (Array.isArray(data)) {
      return data.find((entry) => entry && ACTIVE_INVITE_STATUSES.includes(entry.status));
    }

    if (data && typeof data === 'object' && ACTIVE_INVITE_STATUSES.includes(data.status)) {
      return data;
    }

    return null;
  } catch (error) {
    if (error instanceof InternalApiError && (error.status === 404 || error.status === 204)) {
      return null;
    }
    throw error;
  }
}

async function createInvitation(controlApi, payload) {
  const { data } = await controlApi.post('/org_invitations', { body: payload });
  if (Array.isArray(data)) {
    return data[0] ?? null;
  }
  return data ?? null;
}

async function sendInvitationEmail(controlApi, payload) {
  return controlApi.post('/emails/invitations', { body: payload });
}

async function handlePost(context, req, controlApi, user, env) {
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
    membershipRole = await ensureMembershipRole(controlApi, orgId, user.id);
    context.log('Invitations POST membership role resolved', { orgId, userId: user.id, membershipRole });
  } catch (membershipError) {
    context.log?.error?.('invitations failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId: user.id,
      status: membershipError instanceof InternalApiError ? membershipError.status : undefined,
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
    organization = await fetchOrganization(controlApi, orgId);
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
    const membershipExists = await checkExistingMembership(controlApi, orgId, email);
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
    const existingInvitation = await findActiveInvitation(controlApi, orgId, email);
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
    inserted = await createInvitation(controlApi, {
      org_id: orgId,
      email,
      invited_by: user.id,
    });
    context.log('Invitations POST insert succeeded', { orgId, invitedEmail: email, invitationId: inserted?.id });
  } catch (insertError) {
    context.log?.error?.('invitations failed to insert invitation', {
      message: insertError?.message,
      orgId,
      invitedEmail: email,
      status: insertError instanceof InternalApiError ? insertError.status : undefined,
    });
    if (insertError instanceof InternalApiError && insertError.status === 409) {
      return respond(context, 409, { message: 'invitation_already_pending' });
    }
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

  try {
    context.log('Invitations POST dispatching invite email', { orgId, invitedEmail: email, redirectTo: invitationLink, token: inserted.token });
    await sendInvitationEmail(controlApi, {
      invitation_id: inserted.id,
      org_id: orgId,
      email,
      token: inserted.token,
      redirect_to: invitationLink,
      inviter_name: inviterName,
      organization_name: organizationName,
    });
    context.log('Invitations POST invite email dispatched', {
      orgId,
      invitedEmail: email,
    });
  } catch (emailError) {
    context.log?.error?.('invitations failed to dispatch email', {
      message: emailError?.message,
      orgId,
      invitedEmail: email,
      status: emailError instanceof InternalApiError ? emailError.status : undefined,
    });
    return respond(context, 502, { message: 'failed_to_send_email' });
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

async function handleGet(context, req, controlApi, userId) {
  const query = req?.query ?? {};
  const orgCandidate = query.orgId || query.org_id;
  const orgId = normalizeString(orgCandidate);

  if (!orgId || !isValidOrgId(orgId)) {
    return respond(context, 400, { message: 'invalid_org_id' });
  }

  let membershipRole;
  try {
    membershipRole = await ensureMembershipRole(controlApi, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('invitations failed to verify membership on list', {
      message: membershipError?.message,
      orgId,
      userId,
      status: membershipError instanceof InternalApiError ? membershipError.status : undefined,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!membershipRole || !isAdminRole(membershipRole)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  let invitations = [];
  try {
    const { data } = await controlApi.get('/org_invitations', {
      query: { org_id: orgId, status: ACTIVE_INVITE_STATUSES },
    });

    const rows = Array.isArray(data) ? data : (data ? [data] : []);
    invitations = rows.map((row) => normalizeInvitationRow(row)).filter(Boolean);
  } catch (listError) {
    if (listError instanceof InternalApiError && (listError.status === 404 || listError.status === 204)) {
      invitations = [];
    } else {
      context.log?.error?.('invitations failed to list invitations', {
        message: listError?.message,
        orgId,
        userId,
        status: listError instanceof InternalApiError ? listError.status : undefined,
      });
      return respond(context, 500, { message: 'failed_to_list_invitations' });
    }
  }

  const normalized = invitations;
  return respond(context, 200, { invitations: normalized });
}

export default async function (context, req) {
  const env = readEnv(context);
  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    context.log?.warn?.('invitations missing bearer token');
    return respond(context, 401, { message: 'missing_bearer' });
  }

  const controlApi = createInternalApiClient(context, env, authorization.header);
  if (!controlApi) {
    context.log?.error?.('invitations missing control API base URL');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  let user;
  try {
    const { data } = await controlApi.get('/auth/user');
    if (data && typeof data === 'object') {
      user = data.user && typeof data.user === 'object' ? data.user : data;
    }
  } catch (userError) {
    context.log?.error?.('invitations failed to resolve user from control API', {
      message: userError?.message,
      status: userError instanceof InternalApiError ? userError.status : undefined,
    });
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  if (!user || !user.id) {
    context.log?.warn?.('invitations control API did not return user');
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  const method = String(req?.method || 'GET').toUpperCase();

  if (method === 'GET') {
    return handleGet(context, req, controlApi, user.id);
  }

  if (method === 'POST') {
    return handlePost(context, req, controlApi, user, env);
  }

  return respond(context, 405, { message: 'method_not_allowed' }, { Allow: 'GET, POST' });
}
