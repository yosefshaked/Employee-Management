/* eslint-env node */
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { json, resolveBearerAuthorization } from '../_shared/http.js';

function readEnv(context) {
  return context?.env ?? process.env ?? {};
}

function normalizeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value;
}

function respond(context, status, body, extraHeaders) {
  const response = json(status, body, extraHeaders);
  context.res = response;
  return response;
}

export default async function (context, req) {
  const env = readEnv(context);
  const supabaseUrl = env.APP_SUPABASE_URL;
  const serviceRoleKey = env.APP_SUPABASE_SERVICE_ROLE;

  if (!supabaseUrl || !serviceRoleKey) {
    context.log?.error?.('users-me missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  const hasBearer = Boolean(authorization?.token);

  if (!hasBearer) {
    context.log?.warn?.('users-me missing bearer token');
    return respond(context, 401, { message: 'missing bearer' });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('users-me getUser threw', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    context.log?.warn?.('users-me failed to resolve user from token', {
      hasBearer,
      status: 401,
    });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;

  let adminResult;
  try {
    adminResult = await supabase.auth.admin.getUserById(userId);
  } catch (error) {
    context.log?.error?.('users-me admin lookup failed', {
      userId,
      message: error?.message,
    });
    return respond(context, 500, { message: 'failed to load user' });
  }

  if (adminResult.error) {
    const status = adminResult.error?.status ?? 500;
    context.log?.warn?.('users-me admin lookup error', {
      userId,
      status,
    });
    if (status === 404) {
      return respond(context, 404, { message: 'user not found' });
    }
    return respond(context, status, { message: 'failed to load user' });
  }

  const user = adminResult.data?.user;
  if (!user?.id) {
    context.log?.warn?.('users-me admin lookup returned no user', { userId });
    return respond(context, 404, { message: 'user not found' });
  }

  const metadata = normalizeMetadata(user.raw_user_meta_data) ?? normalizeMetadata(user.user_metadata);

  context.log?.info?.('users-me resolved user', { userId });
  return respond(context, 200, {
    id: user.id,
    email: user.email ?? null,
    raw_user_meta_data: metadata,
  });
}
