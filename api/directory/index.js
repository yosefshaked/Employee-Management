/* eslint-env node */
import process from 'node:process';
import { json, resolveSupabaseAccessToken } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readEnv(context) {
  if (context?.env && typeof context.env === 'object') {
    return context.env;
  }
  return process.env ?? {};
}

function respond(context, status, body, extraHeaders = {}) {
  const response = json(status, body, { 'Cache-Control': 'no-store', ...extraHeaders });
  context.res = response;
  return response;
}

function normalizeString(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function normalizeUuid(value) {
  const candidate = normalizeString(value);
  if (!candidate) {
    return null;
  }
  return UUID_PATTERN.test(candidate) ? candidate : null;
}

function deriveNameFromMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    return '';
  }

  const candidates = [
    metadata.full_name,
    metadata.fullName,
    metadata.name,
    metadata.preferred_username,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }

  const given = typeof metadata.given_name === 'string' ? metadata.given_name.trim() : '';
  const family = typeof metadata.family_name === 'string' ? metadata.family_name.trim() : '';
  const combined = [given, family].filter(Boolean).join(' ');
  return combined.trim();
}

function buildProfilePayload(user) {
  if (!user || typeof user !== 'object') {
    return null;
  }

  const email = typeof user.email === 'string' ? user.email.trim() : null;
  const metadata = user.user_metadata ?? {};
  const fullName = deriveNameFromMetadata(metadata) || email || null;

  return {
    id: user.id || null,
    email,
    full_name: fullName,
    name: fullName,
    raw_user_meta_data: metadata,
  };
}

function sanitizeMember(row, profileMap) {
  if (!row || typeof row !== 'object') {
    return null;
  }

  const profile = profileMap.get(row.user_id) || null;
  const email = typeof row.email === 'string' && row.email.trim() ? row.email.trim() : profile?.email ?? null;
  const joinedAt = row.joined_at || row.created_at || null;

  return {
    id: row.id || null,
    org_id: row.org_id || null,
    user_id: row.user_id || null,
    role: row.role || 'member',
    status: row.status || 'active',
    invited_at: row.invited_at || null,
    joined_at: joinedAt,
    created_at: row.created_at || null,
    email,
    profile,
    profiles: profile,
    user_profile: profile,
  };
}

function sanitizeInvite(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }

  const email = typeof row.email === 'string' ? row.email.trim().toLowerCase() : null;

  return {
    id: row.id || null,
    org_id: row.org_id || null,
    email,
    status: row.status || 'pending',
    invited_by: row.invited_by || null,
    created_at: row.created_at || null,
    expires_at: row.expires_at || null,
  };
}

async function ensureMembership(supabase, orgId, userId) {
  const { data, error } = await supabase
    .from('org_memberships')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  return data.role || 'member';
}

async function fetchProfileMap(context, supabase, members) {
  const userIds = Array.from(
    new Set(
      (members || [])
        .map((row) => row?.user_id)
        .filter((value) => typeof value === 'string' && value.trim()),
    ),
  );

  const profileMap = new Map();

  await Promise.all(
    userIds.map(async (userId) => {
      try {
        const { data, error } = await supabase.auth.admin.getUserById(userId);
        if (error) {
          context.log?.warn?.('directory failed to load user profile', { userId, message: error.message });
          return;
        }
        if (data?.user) {
          const profile = buildProfilePayload(data.user);
          if (profile) {
            profileMap.set(userId, profile);
          }
        }
      } catch (profileError) {
        context.log?.error?.('directory threw while loading user profile', {
          userId,
          message: profileError?.message,
        });
      }
    }),
  );

  return profileMap;
}

export default async function (context, req) {
  context.log?.info?.('directory API invoked');

  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);
  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('directory missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const bearerToken = resolveSupabaseAccessToken(req, {
    supabaseUrl: adminConfig.supabaseUrl,
  });

  if (!bearerToken) {
    context.log?.warn?.('directory missing Supabase bearer token');
    return respond(context, 401, { message: 'missing bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  let authResult;
  try {
    authResult = await supabase.auth.getUser(bearerToken);
  } catch (error) {
    context.log?.error?.('directory failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    context.log?.warn?.('directory token did not resolve to user');
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const query = req?.query ?? {};
  const orgCandidate = query.orgId || query.org_id;
  const orgId = normalizeUuid(orgCandidate);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('directory failed to verify membership', {
      orgId,
      userId,
      message: membershipError?.message,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const [membersResult, invitesResult] = await Promise.all([
    supabase
      .from('org_memberships')
      .select('id, org_id, user_id, role, status, invited_at, joined_at, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true }),
    supabase
      .from('org_invitations')
      .select('id, org_id, email, status, invited_by, created_at, expires_at')
      .eq('org_id', orgId)
      .in('status', ['pending', 'sent'])
      .order('created_at', { ascending: true }),
  ]);

  if (membersResult.error) {
    context.log?.error?.('directory failed to load members', { message: membersResult.error.message, orgId });
    return respond(context, 500, { message: 'failed_to_load_members' });
  }

  if (invitesResult.error) {
    context.log?.error?.('directory failed to load invites', { message: invitesResult.error.message, orgId });
    return respond(context, 500, { message: 'failed_to_load_invites' });
  }

  const profileMap = await fetchProfileMap(context, supabase, membersResult.data || []);

  const members = (membersResult.data || [])
    .map((row) => sanitizeMember(row, profileMap))
    .filter(Boolean);

  const invites = (invitesResult.data || [])
    .map((row) => sanitizeInvite(row))
    .filter(Boolean);

  return respond(context, 200, { members, invites, role: role || 'member' });
}
