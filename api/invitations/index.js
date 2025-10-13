/* eslint-env node */
import process from 'node:process';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import { json, resolveBearerAuthorization } from '../_shared/http.js';

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

function parseInvitationRoute(req) {
  const rawUrl = typeof req?.url === 'string' ? req.url : '/api/invitations';
  let url;
  try {
    url = new URL(rawUrl, 'http://localhost');
  } catch {
    url = new URL('/api/invitations', 'http://localhost');
  }

  const segments = url.pathname.split('/').filter(Boolean);
  const apiIndex = segments.indexOf('api');
  const relevantSegments = apiIndex >= 0 ? segments.slice(apiIndex + 1) : segments;

  if (!relevantSegments.length || relevantSegments[0] !== 'invitations') {
    return { base: [], tail: [] };
  }

  const tail = relevantSegments.slice(1);
  return { base: relevantSegments, tail };
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

function resolveAdminConfig(env) {
  return readSupabaseAdminConfig(env, {
    supabaseUrl: env.APP_CONTROL_DB_URL,
    serviceRoleKey: env.APP_CONTROL_DB_SERVICE_ROLE_KEY,
  });
}

async function ensureMembershipRole(supabase, orgId, userId) {
  const { data, error } = await supabase
    .from('org_memberships')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.role ?? null;
}

async function fetchOrganization(supabase, orgId) {
  const { data, error } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('id', orgId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  return { id: data.id ?? orgId, name: data.name ?? null };
}

async function fetchOrganizationsMap(supabase, orgIds) {
  if (!Array.isArray(orgIds) || !orgIds.length) {
    return new Map();
  }

  const { data, error } = await supabase
    .from('organizations')
    .select('id, name')
    .in('id', orgIds);

  if (error) {
    throw error;
  }

  const map = new Map();
  for (const row of data || []) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    const id = row.id;
    if (!id) {
      continue;
    }
    map.set(id, { id, name: row.name ?? null });
  }
  return map;
}

async function checkExistingMembership(supabase, orgId, email) {
  const { data: userResult, error: userError } = await supabase.auth.admin.getUserByEmail(email);
  if (userError) {
    throw userError;
  }

  const candidateUserId = userResult?.user?.id;
  if (!candidateUserId) {
    return false;
  }

  const { data, error } = await supabase
    .from('org_memberships')
    .select('id')
    .eq('org_id', orgId)
    .eq('user_id', candidateUserId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Boolean(data);
}

async function findActiveInvitation(supabase, orgId, email) {
  const { data, error } = await supabase
    .from('org_invitations')
    .select('*')
    .eq('org_id', orgId)
    .eq('email', email)
    .in('status', ACTIVE_INVITE_STATUSES);

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  const rows = Array.isArray(data) ? data : [data];
  return rows.find((row) => row && ACTIVE_INVITE_STATUSES.includes(row.status)) ?? null;
}

async function createInvitation(supabase, payload) {
  const { data, error } = await supabase
    .from('org_invitations')
    .insert(payload)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return data ?? null;
}

async function fetchInvitationById(supabase, invitationId) {
  const { data, error } = await supabase
    .from('org_invitations')
    .select('*')
    .eq('id', invitationId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ?? null;
}

async function fetchInvitationByToken(supabase, token) {
  const { data, error } = await supabase
    .from('org_invitations')
    .select('*')
    .eq('token', token)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ?? null;
}

async function updateInvitationStatus(supabase, invitationId, status) {
  const { data, error } = await supabase
    .from('org_invitations')
    .update({ status })
    .eq('id', invitationId)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return data ?? null;
}

async function sendInvitationEmail(supabase, email, redirectTo, metadata) {
  const response = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: metadata,
  });

  if (response.error) {
    throw response.error;
  }

  return response.data ?? null;
}

async function handlePost(context, req, supabase, user, env) {
  context.log('Invitations POST handler started', { userId: user?.id });

  let orgId = null;
  let email = null;

  try {
    context.log('Invitations POST user authenticated', { hasUser: Boolean(user), userId: user?.id });

    const body = parseRequestBody(req);
    context.log('Invitations POST body parsed', { hasBody: Boolean(body), bodyKeys: Object.keys(body || {}) });

    orgId = normalizeString(body.orgId || body.org_id);
    email = normalizeEmail(body.email);

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
      context.log?.error?.('Invitations POST failed to verify membership', {
        message: membershipError?.message,
        orgId,
        userId: user.id,
      });
      return respond(context, 500, { message: 'failed_to_verify_membership' });
    }

    if (!membershipRole || !isAdminRole(membershipRole)) {
      context.log('Invitations POST forbidden for role', { orgId, userId: user.id, membershipRole });
      return respond(context, 403, { message: 'forbidden' });
    }

    try {
      context.log('Invitations POST checking existing membership', { orgId, email });
      const alreadyMember = await checkExistingMembership(supabase, orgId, email);
      context.log('Invitations POST existing membership result', { orgId, email, alreadyMember });
      if (alreadyMember) {
        return respond(context, 409, { message: 'user_already_member' });
      }
    } catch (existingMembershipError) {
      context.log?.error?.('Invitations POST failed to check membership', {
        message: existingMembershipError?.message,
        orgId,
        email,
      });
      return respond(context, 500, { message: 'failed_to_check_membership' });
    }

    try {
      context.log('Invitations POST checking active invitation', { orgId, email });
      const activeInvite = await findActiveInvitation(supabase, orgId, email);
      context.log('Invitations POST active invitation result', { orgId, email, hasActiveInvite: Boolean(activeInvite) });
      if (activeInvite) {
        return respond(context, 409, { message: 'invitation_already_pending' });
      }
    } catch (activeInviteError) {
      context.log?.error?.('Invitations POST failed to check active invitation', {
        message: activeInviteError?.message,
        orgId,
        email,
      });
      return respond(context, 500, { message: 'failed_to_check_existing_invitation' });
    }

    let invitationRow;
    try {
      context.log('Invitations POST inserting invitation', { orgId, email });
      invitationRow = await createInvitation(supabase, {
        org_id: orgId,
        email,
        invited_by: user.id,
      });
      context.log('Invitations POST invitation inserted', { invitationId: invitationRow?.id });
    } catch (insertError) {
      if (insertError?.code === '23505') {
        context.log('Invitations POST insert hit unique violation', { orgId, email });
        return respond(context, 409, { message: 'invitation_already_pending' });
      }
      context.log?.error?.('Invitations POST failed to create invitation', {
        message: insertError?.message,
        orgId,
        email,
      });
      return respond(context, 500, { message: 'failed_to_create_invitation' });
    }

    const token = normalizeString(invitationRow?.token);
    if (!token) {
      context.log?.error?.('Invitations POST missing token after insert', { invitationId: invitationRow?.id });
      return respond(context, 500, { message: 'failed_to_create_invitation' });
    }

    let organization = null;
    try {
      context.log('Invitations POST fetching organization details', { orgId });
      organization = await fetchOrganization(supabase, orgId);
      context.log('Invitations POST organization details fetched', { orgId, hasOrganization: Boolean(organization) });
    } catch (organizationError) {
      context.log?.warn?.('Invitations POST failed to fetch organization', {
        message: organizationError?.message,
        orgId,
      });
    }

    const baseUrl = resolveAppBaseUrl(env);
    const invitationLink = buildInvitationLink(baseUrl, token);
    context.log('Invitations POST resolved invitation link', { token, invitationLink });

    try {
      const inviterName = extractInviterName(user);
      context.log('Invitations POST dispatching email', {
        invitationId: invitationRow.id,
        email,
        inviterName,
        organizationName: organization?.name ?? null,
        invitationLink,
      });
      await sendInvitationEmail(supabase, email, invitationLink, {
        inviter_name: inviterName,
        organization_name: organization?.name ?? null,
      });
      context.log('Invitations POST email dispatched', { invitationId: invitationRow.id });
    } catch (emailError) {
      context.log?.error?.('Invitations POST failed to send email', {
        message: emailError?.message,
        orgId,
        invitationId: invitationRow.id,
      });
      return respond(context, 502, { message: 'failed_to_send_email' });
    }

    const normalizedInvitation = normalizeInvitationRow(invitationRow);
    return respond(context, 201, {
      invitation: normalizedInvitation,
      organization: organization ?? { id: orgId, name: organization?.name ?? null },
    });
  } catch (error) {
    context.log?.error?.('Invitations POST unexpected failure', {
      message: error?.message,
      stack: error?.stack,
      orgId,
      email,
      userId: user?.id,
    });
    return respond(context, 500, { message: 'unexpected_error' });
  }
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
    context.log?.error?.('Invitations GET failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!membershipRole || !isAdminRole(membershipRole)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  let invitations = [];
  try {
    const { data, error } = await supabase
      .from('org_invitations')
      .select('*')
      .eq('org_id', orgId)
      .in('status', ACTIVE_INVITE_STATUSES)
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }

    const rows = Array.isArray(data) ? data : data ? [data] : [];
    invitations = rows.map((row) => normalizeInvitationRow(row)).filter(Boolean);
  } catch (listError) {
    context.log?.error?.('Invitations GET failed to list invitations', {
      message: listError?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_list_invitations' });
  }

  return respond(context, 200, { invitations });
}

async function handleTokenLookup(context, supabase, token) {
  const normalizedToken = normalizeString(token);
  if (!normalizedToken || !UUID_PATTERN.test(normalizedToken)) {
    return respond(context, 400, { message: 'invalid_token' });
  }

  let invitation;
  try {
    invitation = await fetchInvitationByToken(supabase, normalizedToken);
  } catch (lookupError) {
    context.log?.error?.('Invitations token lookup failed', {
      message: lookupError?.message,
    });
    return respond(context, 500, { message: 'failed_to_lookup_invitation' });
  }

  if (!invitation || !ACTIVE_INVITE_STATUSES.includes(invitation.status)) {
    return respond(context, 404, { message: 'invitation_not_found' });
  }

  const organizationId = invitation.org_id ?? invitation.organization_id ?? null;
  let organization = null;
  if (organizationId) {
    try {
      organization = await fetchOrganization(supabase, organizationId);
    } catch (organizationError) {
      context.log?.warn?.('Invitations token lookup organization fetch failed', {
        message: organizationError?.message,
        organizationId,
      });
    }
  }

  const normalized = normalizeInvitationRow(invitation);
  return respond(context, 200, {
    invitation: {
      id: normalized?.id ?? null,
      org_id: normalized?.org_id ?? organizationId,
      email: normalized?.email ?? normalizeEmail(invitation.email || invitation.invitee_email),
      status: normalized?.status ?? invitation.status ?? 'pending',
      created_at: normalized?.created_at ?? invitation.created_at ?? null,
      expires_at: normalized?.expires_at ?? invitation.expires_at ?? null,
    },
    organization: organization
      ? { id: organization.id ?? organizationId, name: organization.name ?? null }
      : { id: organizationId, name: organization?.name ?? null },
  });
}

async function handleAccept(context, supabase, user, invitationId) {
  const normalizedInvitationId = normalizeString(invitationId);
  if (!normalizedInvitationId || !UUID_PATTERN.test(normalizedInvitationId)) {
    return respond(context, 400, { message: 'invalid_invitation_id' });
  }

  const userEmail = normalizeEmail(user.email);
  if (!userEmail) {
    return respond(context, 400, { message: 'user_missing_email' });
  }

  let invitation;
  try {
    invitation = await fetchInvitationById(supabase, normalizedInvitationId);
  } catch (invitationError) {
    context.log?.error?.('Invitations accept failed to load invitation', {
      message: invitationError?.message,
      invitationId: normalizedInvitationId,
    });
    return respond(context, 500, { message: 'failed_to_load_invitation' });
  }

  if (!invitation) {
    return respond(context, 404, { message: 'invitation_not_found' });
  }

  const invitationEmail = normalizeEmail(invitation.email || invitation.invitee_email);
  if (!invitationEmail) {
    return respond(context, 409, { message: 'invitation_missing_email' });
  }

  if (invitationEmail !== userEmail) {
    return respond(context, 403, { message: 'invitee_mismatch' });
  }

  if (!ACTIVE_INVITE_STATUSES.includes(invitation.status)) {
    return respond(context, 409, { message: 'invitation_not_pending' });
  }

  const orgId = invitation.org_id ?? invitation.organization_id;
  if (!orgId || !isValidOrgId(String(orgId))) {
    return respond(context, 409, { message: 'invitation_missing_org' });
  }

  try {
    const { error: membershipError } = await supabase
      .from('org_memberships')
      .insert({
        org_id: orgId,
        user_id: user.id,
        email: userEmail,
        role: 'member',
      });

    if (membershipError) {
      throw membershipError;
    }
  } catch (membershipError) {
    if (membershipError?.code === '23505') {
      return respond(context, 409, { message: 'user_already_member' });
    }
    context.log?.error?.('Invitations accept failed to create membership', {
      message: membershipError?.message,
      invitationId: normalizedInvitationId,
    });
    return respond(context, 500, { message: 'failed_to_create_membership' });
  }

  let updatedInvitation = null;
  try {
    updatedInvitation = await updateInvitationStatus(supabase, normalizedInvitationId, 'accepted');
  } catch (updateError) {
    context.log?.error?.('Invitations accept failed to update invitation', {
      message: updateError?.message,
      invitationId: normalizedInvitationId,
    });
    return respond(context, 500, { message: 'failed_to_update_invitation' });
  }

  let organization;
  try {
    organization = await fetchOrganization(supabase, orgId);
  } catch (organizationError) {
    context.log?.warn?.('Invitations accept organization fetch failed', {
      message: organizationError?.message,
      orgId,
    });
  }

  const normalizedInvitation = normalizeInvitationRow(updatedInvitation || invitation);
  return respond(context, 200, {
    invitation: normalizedInvitation,
    organization: organization
      ? { id: organization.id ?? orgId, name: organization.name ?? null }
      : { id: orgId, name: organization?.name ?? null },
  });
}

async function handleIncoming(context, supabase, user) {
  const userEmail = normalizeEmail(user?.email);
  if (!userEmail) {
    return respond(context, 400, { message: 'user_missing_email' });
  }

  let invitations = [];
  try {
    const { data, error } = await supabase
      .from('org_invitations')
      .select('*')
      .eq('email', userEmail)
      .in('status', ACTIVE_INVITE_STATUSES)
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }

    invitations = (data || []).map((row) => normalizeInvitationRow(row)).filter(Boolean);
  } catch (listError) {
    context.log?.error?.('Invitations incoming failed to list invitations', {
      message: listError?.message,
      userId: user.id,
    });
    return respond(context, 500, { message: 'failed_to_list_invitations' });
  }

  const orgIds = Array.from(new Set(invitations.map((invite) => invite.org_id).filter(Boolean)));
  let orgMap = new Map();
  if (orgIds.length) {
    try {
      orgMap = await fetchOrganizationsMap(supabase, orgIds);
    } catch (organizationError) {
      context.log?.warn?.('Invitations incoming organization fetch failed', {
        message: organizationError?.message,
      });
    }
  }

  const enriched = invitations.map((invite) => ({
    ...invite,
    organization: orgMap.get(invite.org_id) ?? { id: invite.org_id, name: null },
  }));

  return respond(context, 200, { invitations: enriched });
}

async function handleRevoke(context, supabase, userId, invitationId) {
  const normalizedInvitationId = normalizeString(invitationId);
  if (!normalizedInvitationId || !UUID_PATTERN.test(normalizedInvitationId)) {
    return respond(context, 400, { message: 'invalid_invitation_id' });
  }

  let invitation;
  try {
    invitation = await fetchInvitationById(supabase, normalizedInvitationId);
  } catch (invitationError) {
    context.log?.error?.('Invitations revoke failed to load invitation', {
      message: invitationError?.message,
      invitationId: normalizedInvitationId,
    });
    return respond(context, 500, { message: 'failed_to_load_invitation' });
  }

  if (!invitation) {
    return respond(context, 404, { message: 'invitation_not_found' });
  }

  const orgId = invitation.org_id ?? invitation.organization_id;
  if (!orgId || !isValidOrgId(String(orgId))) {
    return respond(context, 409, { message: 'invitation_missing_org' });
  }

  let membershipRole;
  try {
    membershipRole = await ensureMembershipRole(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('Invitations revoke failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!membershipRole || !isAdminRole(membershipRole)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  try {
    await updateInvitationStatus(supabase, normalizedInvitationId, 'revoked');
  } catch (updateError) {
    context.log?.error?.('Invitations revoke failed to update invitation', {
      message: updateError?.message,
      invitationId: normalizedInvitationId,
    });
    return respond(context, 500, { message: 'failed_to_update_invitation' });
  }

  return respond(context, 204, null);
}

async function handleDecline(context, supabase, user, invitationId) {
  const normalizedInvitationId = normalizeString(invitationId);
  if (!normalizedInvitationId || !UUID_PATTERN.test(normalizedInvitationId)) {
    return respond(context, 400, { message: 'invalid_invitation_id' });
  }

  const userEmail = normalizeEmail(user?.email);
  if (!userEmail) {
    return respond(context, 400, { message: 'user_missing_email' });
  }

  let invitation;
  try {
    invitation = await fetchInvitationById(supabase, normalizedInvitationId);
  } catch (invitationError) {
    context.log?.error?.('Invitations decline failed to load invitation', {
      message: invitationError?.message,
      invitationId: normalizedInvitationId,
    });
    return respond(context, 500, { message: 'failed_to_load_invitation' });
  }

  if (!invitation) {
    return respond(context, 404, { message: 'invitation_not_found' });
  }

  const invitationEmail = normalizeEmail(invitation.email || invitation.invitee_email);
  if (!invitationEmail) {
    return respond(context, 409, { message: 'invitation_missing_email' });
  }

  if (invitationEmail !== userEmail) {
    return respond(context, 403, { message: 'invitee_mismatch' });
  }

  if (!ACTIVE_INVITE_STATUSES.includes(invitation.status)) {
    return respond(context, 409, { message: 'invitation_not_pending' });
  }

  try {
    await updateInvitationStatus(supabase, normalizedInvitationId, 'declined');
  } catch (updateError) {
    context.log?.error?.('Invitations decline failed to update invitation', {
      message: updateError?.message,
      invitationId: normalizedInvitationId,
    });
    return respond(context, 500, { message: 'failed_to_update_invitation' });
  }

  return respond(context, 204, null);
}

export default async function (context, req) {
  const env = readEnv(context);
  const { tail } = parseInvitationRoute(req);
  const method = String(req?.method || 'GET').toUpperCase();

  const adminConfig = resolveAdminConfig(env);
  if (!adminConfig?.supabaseUrl || !adminConfig?.serviceRoleKey) {
    context.log?.error?.('Invitations API missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  if (method === 'GET' && tail[0] === 'token') {
    if (!tail[1]) {
      return respond(context, 400, { message: 'invalid_token' });
    }

    return handleTokenLookup(context, supabase, tail[1]);
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    context.log?.warn?.('Invitations API missing bearer token');
    return respond(context, 401, { message: 'missing_bearer' });
  }

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (authError) {
    context.log?.error?.('Invitations API failed to validate token', {
      message: authError?.message,
    });
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    context.log?.warn?.('Invitations API token did not resolve to user');
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  const user = authResult.data.user;

  if (method === 'GET' && (!tail.length || tail[0] === '')) {
    return handleGet(context, req, supabase, user.id);
  }

  if (method === 'GET' && tail.length === 1 && tail[0] === 'incoming') {
    return handleIncoming(context, supabase, user);
  }

  if (method === 'POST' && (!tail.length || tail[0] === '')) {
    return handlePost(context, req, supabase, user, env);
  }

  if (method === 'POST' && tail.length === 2 && tail[1] === 'accept') {
    return handleAccept(context, supabase, user, tail[0]);
  }

  if (method === 'POST' && tail.length === 2 && tail[1] === 'decline') {
    return handleDecline(context, supabase, user, tail[0]);
  }

  if (method === 'DELETE' && tail.length === 1 && tail[0]) {
    return handleRevoke(context, supabase, user.id, tail[0]);
  }

  return respond(context, 405, { message: 'method_not_allowed' }, { Allow: 'GET, POST, DELETE' });
}
