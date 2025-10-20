/* eslint-env node */
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';

function jsonResponse(context, status, payload, extraHeaders = {}) {
  context.res = {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
    body: JSON.stringify(payload),
  };
}

function maskForLog(value) {
  if (!value) return '';
  const stringValue = String(value);
  if (stringValue.length <= 6) return '••••';
  return `${stringValue.slice(0, 2)}••••${stringValue.slice(-2)}`;
}

function normalizeHeaderValue(rawValue) {
  if (!rawValue) {
    return undefined;
  }

  if (typeof rawValue === 'string') {
    return rawValue;
  }

  if (Array.isArray(rawValue)) {
    for (const entry of rawValue) {
      const normalized = normalizeHeaderValue(entry);
      if (typeof normalized === 'string' && normalized.length > 0) {
        return normalized;
      }
    }
    return undefined;
  }

  if (typeof rawValue === 'object') {
    if (typeof rawValue.value === 'string') {
      return rawValue.value;
    }

    if (Array.isArray(rawValue.value)) {
      const normalized = normalizeHeaderValue(rawValue.value);
      if (normalized) {
        return normalized;
      }
    }

    if (typeof rawValue[0] === 'string') {
      return rawValue[0];
    }

    if (typeof rawValue.toString === 'function' && rawValue.toString !== Object.prototype.toString) {
      const candidate = rawValue.toString();
      if (typeof candidate === 'string' && candidate && candidate !== '[object Object]') {
        return candidate;
      }
    }

    if (typeof rawValue[Symbol.iterator] === 'function') {
      for (const entry of rawValue) {
        const normalized = normalizeHeaderValue(entry);
        if (typeof normalized === 'string' && normalized.length > 0) {
          return normalized;
        }
      }
    }
  }

  if (typeof rawValue === 'number' || typeof rawValue === 'boolean') {
    return String(rawValue);
  }

  return undefined;
}

function extractBearerToken(rawValue) {
  const normalized = normalizeHeaderValue(rawValue);
  if (typeof normalized !== 'string') {
    return null;
  }
  const trimmed = normalized.trim();
  if (!trimmed) {
    return null;
  }
  if (!trimmed.toLowerCase().startsWith('bearer ')) {
    return null;
  }
  const token = trimmed.slice('bearer '.length).trim();
  return token || null;
}

function resolveHeaderValue(headers, name) {
  if (!headers || !name) {
    return undefined;
  }

  const targetName = typeof name === 'string' ? name : String(name || '');

  if (typeof headers.get === 'function') {
    const directValue = normalizeHeaderValue(headers.get(name));
    if (typeof directValue === 'string' && directValue.length > 0) {
      return directValue;
    }

    const lowerValue = normalizeHeaderValue(headers.get(name.toLowerCase()));
    if (typeof lowerValue === 'string' && lowerValue.length > 0) {
      return lowerValue;
    }
  }

  if (typeof headers === 'object') {
    if (Object.prototype.hasOwnProperty.call(headers, name)) {
      const directValue = normalizeHeaderValue(headers[name]);
      if (typeof directValue === 'string' && directValue.length > 0) {
        return directValue;
      }
    }

    const lowerName = typeof name === 'string' ? name.toLowerCase() : name;
    if (lowerName !== name && Object.prototype.hasOwnProperty.call(headers, lowerName)) {
      const lowerValue = normalizeHeaderValue(headers[lowerName]);
      if (typeof lowerValue === 'string' && lowerValue.length > 0) {
        return lowerValue;
      }
    }

    const upperName = typeof name === 'string' ? name.toUpperCase() : name;
    if (upperName !== name && Object.prototype.hasOwnProperty.call(headers, upperName)) {
      const upperValue = normalizeHeaderValue(headers[upperName]);
      if (typeof upperValue === 'string' && upperValue.length > 0) {
        return upperValue;
      }
    }
  }

  if (typeof headers?.toJSON === 'function') {
    const serialized = headers.toJSON();
    if (serialized && typeof serialized === 'object') {
      if (Object.prototype.hasOwnProperty.call(serialized, name)) {
        const directValue = normalizeHeaderValue(serialized[name]);
        if (typeof directValue === 'string' && directValue.length > 0) {
          return directValue;
        }
      }

      const lowerName = typeof name === 'string' ? name.toLowerCase() : name;
      if (lowerName !== name && Object.prototype.hasOwnProperty.call(serialized, lowerName)) {
        const lowerValue = normalizeHeaderValue(serialized[lowerName]);
        if (typeof lowerValue === 'string' && lowerValue.length > 0) {
          return lowerValue;
        }
      }

      const upperName = typeof name === 'string' ? name.toUpperCase() : name;
      if (upperName !== name && Object.prototype.hasOwnProperty.call(serialized, upperName)) {
        const upperValue = normalizeHeaderValue(serialized[upperName]);
        if (typeof upperValue === 'string' && upperValue.length > 0) {
          return upperValue;
        }
      }
    }
  }

  const rawHeaders = headers?.rawHeaders;
  if (Array.isArray(rawHeaders)) {
    for (let index = 0; index < rawHeaders.length - 1; index += 2) {
      const rawName = rawHeaders[index];
      if (typeof rawName !== 'string') {
        continue;
      }

      if (rawName.toLowerCase() !== targetName.toLowerCase()) {
        continue;
      }

      const rawValue = normalizeHeaderValue(rawHeaders[index + 1]);
      if (typeof rawValue === 'string' && rawValue.length > 0) {
        return rawValue;
      }
    }
  }

  const nestedHeaders = headers?.headers;
  if (nestedHeaders && nestedHeaders !== headers) {
    const nestedValue = resolveHeaderValue(nestedHeaders, name);
    if (nestedValue) {
      return nestedValue;
    }
  }

  return undefined;
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

async function requireOrgMembership(context, supabase, orgId, userId) {
  const membershipResult = await supabase
    .from('org_memberships')
    .select('id, role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();

  if (membershipResult.error) {
    context.log?.error?.('directory failed to verify membership', {
      orgId,
      userId,
      message: membershipResult.error.message,
    });
    jsonResponse(context, 500, { message: 'failed to verify membership' });
    return null;
  }

  if (!membershipResult.data) {
    jsonResponse(context, 403, { message: 'forbidden' });
    return null;
  }

  return membershipResult.data;
}

function logSupabaseQueryFailure(context, req, userId, stage, error) {
  const payload = {
    message: `Directory: Supabase query failed while ${stage}.`,
    context: {
      invocationId: context.invocationId,
      method: req?.method,
      url: req?.url,
      query: req?.query,
    },
    user: userId ? { id: maskForLog(userId) } : undefined,
    error: {
      message: error?.message,
      code: error?.code,
      details: error?.details,
      hint: error?.hint,
    },
  };

  if (typeof context.log?.error === 'function') {
    context.log.error(payload);
  } else if (typeof context.log === 'function') {
    context.log(payload);
  } else {
    console.error(payload);
  }
}

async function fetchOrgMembers(context, req, supabase, orgId, userId) {
  try {
    const membershipsResult = await supabase
      .from('org_memberships')
      .select('id, org_id, user_id, role, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true });

    if (membershipsResult.error) {
      logSupabaseQueryFailure(context, req, userId, 'fetching membership rows', membershipsResult.error);
      jsonResponse(context, 500, { message: 'failed to load members' });
      return null;
    }

    const memberships = Array.isArray(membershipsResult.data) ? membershipsResult.data : [];
    const userIds = Array.from(
      new Set(
        memberships
          .map((membership) => membership.user_id)
          .filter((value) => typeof value === 'string' && value.trim().length > 0),
      ),
    );

    let profiles = [];
    if (userIds.length > 0) {
      const profilesResult = await supabase
        .from('profiles')
        .select('id, email, full_name')
        .in('id', userIds);

      if (profilesResult.error) {
        logSupabaseQueryFailure(context, req, userId, 'fetching member profiles', profilesResult.error);
        jsonResponse(context, 500, { message: 'failed to load members' });
        return null;
      }

      profiles = Array.isArray(profilesResult.data) ? profilesResult.data : [];
    }

    const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));

    return memberships.map((membership) => ({
      ...membership,
      profile: profileMap.get(membership.user_id) ?? null,
    }));
  } catch (error) {
    logSupabaseQueryFailure(context, req, userId, 'fetching members', error);
    jsonResponse(context, 500, { message: 'failed to load members' });
    return null;
  }
}

async function fetchPendingInvitations(context, req, supabase, orgId, userId) {
  try {
    const result = await supabase
      .from('org_invitations')
      .select(
        'id, org_id, email, status, invited_by, created_at, expires_at, organization:organizations(id, name)',
      )
      .eq('org_id', orgId)
      .in('status', ['pending', 'sent'])
      .order('created_at', { ascending: true });

    if (result.error) {
      logSupabaseQueryFailure(context, req, userId, 'fetching invitations', result.error);
      jsonResponse(context, 500, { message: 'failed to load invitations' });
      return null;
    }

    return Array.isArray(result.data) ? result.data : [];
  } catch (error) {
    logSupabaseQueryFailure(context, req, userId, 'fetching invitations', error);
    jsonResponse(context, 500, { message: 'failed to load invitations' });
    return null;
  }
}

export default async function directory(context, req) {
  context.log.warn('RAW INCOMING HEADERS:', req.headers);
  const env = context.env ?? globalThis.process?.env ?? {};
  const adminConfig = readSupabaseAdminConfig(env);
  const { supabaseUrl, serviceRoleKey } = adminConfig;

  if (!supabaseUrl || !serviceRoleKey) {
    context.log.error('Supabase metadata credentials are missing.');
    jsonResponse(context, 500, { error: 'server_misconfigured' });
    return;
  }

  if (req.method !== 'GET') {
    jsonResponse(
      context,
      405,
      { error: 'method_not_allowed' },
      { Allow: 'GET' },
    );
    return;
  }

  const headerCandidates = [
    'X-Supabase-Authorization',
    'x-supabase-auth',
    'Authorization',
  ];

  let token = null;
  for (const headerName of headerCandidates) {
    const value = resolveHeaderValue(req.headers, headerName);
    token = extractBearerToken(value);
    if (token) {
      break;
    }
  }

  if (!token) {
    jsonResponse(context, 401, { error: 'missing_or_invalid_token' });
    return;
  }

  const supabase = createSupabaseAdminClient(adminConfig, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  let userId;
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error) throw error;
    userId = data?.user?.id;
  } catch (authError) {
    context.log.warn('Failed to authenticate token for directory.', {
      message: authError?.message,
    });
    jsonResponse(context, 401, { error: 'missing_or_invalid_token' });
    return;
  }

  if (!userId) {
    jsonResponse(context, 401, { error: 'missing_or_invalid_token' });
    return;
  }

  const orgId = normalizeUuid(req.query?.orgId ?? req.query?.org_id);
  if (!orgId) {
    jsonResponse(context, 400, { message: 'missing orgId' });
    return;
  }

  const membership = await requireOrgMembership(context, supabase, orgId, userId);
  if (!membership) {
    return;
  }

  const members = await fetchOrgMembers(context, req, supabase, orgId, userId);
  if (!members) {
    return;
  }

  const invitations = await fetchPendingInvitations(context, req, supabase, orgId, userId);
  if (!invitations) {
    return;
  }

  jsonResponse(context, 200, {
    members,
    invitations,
  });
}
