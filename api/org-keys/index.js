/* eslint-env node */
import process from 'node:process';
import { json, resolveBearerAuthorization } from '../_shared/http.js';

function readEnv(context) {
  return context?.env ?? process.env ?? {};
}

async function parseJsonResponse(response) {
  const contentType = response.headers?.get?.('content-type') ?? response.headers?.get?.('Content-Type') ?? '';
  if (typeof contentType === 'string' && contentType.toLowerCase().includes('application/json')) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  try {
    const text = await response.text();
    if (!text) {
      return {};
    }
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function respond(context, status, body, extraHeaders) {
  const response = json(status, body, extraHeaders);
  context.res = response;
  return response;
}

export default async function (context, req) {
  const env = readEnv(context);
  const orgId = context.bindingData?.orgId;

  if (!orgId) {
    context.log?.warn?.('org-keys missing orgId');
    return respond(context, 400, { message: 'missing org id' });
  }

  const authorization = resolveBearerAuthorization(req);
  const hasBearer = Boolean(authorization?.token);

  if (!hasBearer) {
    context.log?.warn?.('org-keys missing bearer', { orgId });
    return respond(context, 401, { message: 'missing bearer' });
  }

  const supabaseUrl = env.APP_SUPABASE_URL;
  const anonKey = env.APP_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    context.log?.error?.('org-keys missing Supabase environment values');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const rpcUrl = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/get_org_public_keys`;
  let rpcResponse;

  try {
    rpcResponse = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: anonKey,
        authorization: authorization.header,
      },
      body: JSON.stringify({ p_org_id: orgId }),
    });
  } catch (error) {
    context.log?.error?.('org-keys rpc request failed', {
      orgId,
      hasBearer,
      message: error?.message,
    });
    return respond(context, 502, { message: 'failed to reach control database' });
  }

  const payload = await parseJsonResponse(rpcResponse);

  if (!rpcResponse.ok) {
    context.log?.info?.('org-keys rpc error', {
      orgId,
      hasBearer,
      status: rpcResponse.status,
    });
    return respond(context, rpcResponse.status, payload && typeof payload === 'object' ? payload : {});
  }

  const record = Array.isArray(payload)
    ? payload.find((entry) => entry && typeof entry === 'object' && entry.supabase_url && entry.anon_key)
    : (payload && typeof payload === 'object' ? payload : null);

  if (!record || typeof record.supabase_url !== 'string' || typeof record.anon_key !== 'string') {
    context.log?.info?.('org-keys missing configuration', {
      orgId,
      hasBearer,
      status: 404,
    });
    return respond(context, 404, { message: 'org not found or no access' });
  }

  context.log?.info?.('org-keys success', {
    orgId,
    hasBearer,
    status: 200,
  });

  return respond(context, 200, {
    supabaseUrl: record.supabase_url,
    anonKey: record.anon_key,
  });
}
