/* eslint-env node */
import { json, resolveBearerAuthorization } from '../_shared/http.js';
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigValid,
  readSupabaseAdminConfig,
} from '../_shared/supabase-admin.js';

const ADMIN_CLIENT_OPTIONS = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  global: {
    headers: {
      Accept: 'application/json',
    },
  },
};

let cachedAdminClient = null;
let cachedAdminConfig = null;

function respond(context, status, body, extraHeaders = {}) {
  const response = json(status, body, { 'Cache-Control': 'no-store', ...extraHeaders });
  context.res = response;
  return response;
}

function normalizeUuid(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(trimmed)) {
    return null;
  }
  return trimmed.toLowerCase();
}

function getAdminClient(context) {
  const config = readSupabaseAdminConfig(context);
  if (!isSupabaseAdminConfigValid(config)) {
    return { client: null, error: new Error('missing_admin_credentials') };
  }

  const hasConfigChanged =
    !cachedAdminClient ||
    !cachedAdminConfig ||
    cachedAdminConfig.supabaseUrl !== config.supabaseUrl ||
    cachedAdminConfig.serviceRoleKey !== config.serviceRoleKey;

  if (hasConfigChanged) {
    cachedAdminClient = createSupabaseAdminClient(config, ADMIN_CLIENT_OPTIONS);
    cachedAdminConfig = config;
  }

  return { client: cachedAdminClient, error: null };
}

function isPrivilegedRole(role) {
  if (typeof role !== 'string') {
    return false;
  }
  const normalized = role.trim().toLowerCase();
  return normalized === 'admin' || normalized === 'owner';
}

async function getAuthenticatedUser(context, req, supabase) {
  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    respond(context, 401, { message: 'missing bearer token' });
    return null;
  }

  let result;
  try {
    result = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.warn?.('memberships failed to validate bearer token', { message: error?.message });
    respond(context, 401, { message: 'invalid or expired token' });
    return null;
  }

  if (result.error || !result.data?.user?.id) {
    respond(context, 401, { message: 'invalid or expired token' });
    return null;
  }

  const user = result.data.user;
  return { id: user.id };
}

async function fetchMembership(context, supabase, membershipId) {
  const membershipResult = await supabase
    .from('org_memberships')
    .select('id, org_id, user_id, role')
    .eq('id', membershipId)
    .maybeSingle();

  if (membershipResult.error) {
    context.log?.error?.('memberships failed to load membership', {
      membershipId,
      message: membershipResult.error.message,
    });
    respond(context, 500, { message: 'failed to load membership' });
    return null;
  }

  if (!membershipResult.data) {
    respond(context, 404, { message: 'membership not found' });
    return null;
  }

  return membershipResult.data;
}

async function requireOrgAdmin(context, supabase, orgId, userId) {
  const membershipResult = await supabase
    .from('org_memberships')
    .select('id, role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();

  if (membershipResult.error) {
    context.log?.error?.('memberships failed to verify caller permissions', {
      orgId,
      userId,
      message: membershipResult.error.message,
    });
    respond(context, 500, { message: 'failed to verify permissions' });
    return null;
  }

  if (!membershipResult.data) {
    respond(context, 403, { message: 'forbidden' });
    return null;
  }

  if (!isPrivilegedRole(membershipResult.data.role)) {
    respond(context, 403, { message: 'forbidden' });
    return null;
  }

  return membershipResult.data;
}

async function deleteMembership(context, supabase, membershipId) {
  const deleteResult = await supabase
    .from('org_memberships')
    .delete()
    .eq('id', membershipId)
    .select('id')
    .maybeSingle();

  if (deleteResult.error) {
    context.log?.error?.('memberships failed to delete membership', {
      membershipId,
      message: deleteResult.error.message,
    });
    respond(context, 500, { message: 'failed to delete membership' });
    return false;
  }

  if (!deleteResult.data) {
    respond(context, 404, { message: 'membership not found' });
    return false;
  }

  return true;
}

async function revokeAcceptedInvitations(context, supabase, orgId, userId) {
  const updateResult = await supabase
    .from('org_invitations')
    .update({ status: 'revoked' })
    .match({ org_id: orgId, user_id: userId, status: 'accepted' });

  if (updateResult.error) {
    context.log?.error?.('memberships failed to revoke accepted invitations', {
      orgId,
      userId,
      message: updateResult.error.message,
    });
    respond(context, 500, { message: 'failed to revoke invitations' });
    return false;
  }

  return true;
}

export default async function memberships(context, req) {
  let membershipId = null;
  let authUser = null;
  let membershipRecord = null;

  try {
    const { client: supabase, error } = getAdminClient(context);
    if (error || !supabase) {
      context.log?.error?.('memberships missing admin credentials', { message: error?.message });
      respond(context, 500, { message: 'missing admin credentials' });
      return;
    }

    membershipId =
      normalizeUuid(req?.params?.membershipId) || normalizeUuid(context?.bindingData?.membershipId);

    if (!membershipId) {
      respond(context, 400, { message: 'invalid membership id' });
      return;
    }

    authUser = await getAuthenticatedUser(context, req, supabase);
    if (!authUser) {
      return;
    }

    membershipRecord = await fetchMembership(context, supabase, membershipId);
    if (!membershipRecord) {
      return;
    }

    const { org_id: orgId, user_id: memberUserId } = membershipRecord;

    const callerMembership = await requireOrgAdmin(context, supabase, orgId, authUser.id);
    if (!callerMembership) {
      return;
    }

    const deleted = await deleteMembership(context, supabase, membershipId);
    if (!deleted) {
      return;
    }

    const revoked = await revokeAcceptedInvitations(context, supabase, orgId, memberUserId);
    if (!revoked) {
      return;
    }

    respond(context, 200, { success: true });
  } catch (error) {
    context.log?.error?.({
      message: 'memberships unexpected failure',
      request: {
        method: req?.method || null,
        url: req?.url || null,
        invocationId: context?.invocationId || null,
      },
      membershipId,
      orgId: membershipRecord?.org_id || null,
      callerUserId: authUser?.id || null,
      supabaseError: error?.message || null,
      stack: error?.stack || null,
    });
    if (!context.res) {
      respond(context, 500, { message: 'unexpected server error' });
    }
  }
}
