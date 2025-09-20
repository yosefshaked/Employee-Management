/* eslint-env node */

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

function extractBearerToken(rawValue) {
  if (typeof rawValue !== 'string') {
    return null;
  }
  const trimmed = rawValue.trim();
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

  if (typeof headers.get === 'function') {
    const directValue = headers.get(name);
    if (directValue) {
      return directValue;
    }

    const lowerValue = headers.get(name.toLowerCase());
    if (lowerValue) {
      return lowerValue;
    }
  }

  if (typeof headers === 'object') {
    if (headers[name]) {
      return headers[name];
    }

    const lowerName = typeof name === 'string' ? name.toLowerCase() : name;
    if (lowerName !== name && headers[lowerName]) {
      return headers[lowerName];
    }

    const upperName = typeof name === 'string' ? name.toUpperCase() : name;
    if (upperName !== name && headers[upperName]) {
      return headers[upperName];
    }
  }

  if (typeof headers?.toJSON === 'function') {
    const serialized = headers.toJSON();
    if (serialized && typeof serialized === 'object') {
      if (serialized[name]) {
        return serialized[name];
      }

      const lowerName = typeof name === 'string' ? name.toLowerCase() : name;
      if (lowerName !== name && serialized[lowerName]) {
        return serialized[lowerName];
      }

      const upperName = typeof name === 'string' ? name.toUpperCase() : name;
      if (upperName !== name && serialized[upperName]) {
        return serialized[upperName];
      }
    }
  }

  return undefined;
}

function readBearerToken(req) {
  const headers = req?.headers;
  const candidates = [
    'X-Supabase-Authorization',
    'x-supabase-auth',
    'Authorization',
  ];

  for (const headerName of candidates) {
    const value = resolveHeaderValue(headers, headerName);
    const token = extractBearerToken(value);
    if (token) {
      return token;
    }
  }

  return null;
}

function ensureTrailingSlashRemoved(url) {
  return url.replace(/\/+$/, '');
}

async function parseJson(response) {
  const contentType = response.headers?.get?.('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return null;
  }
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export default async function (context, req) {
  const env = context.env ?? globalThis.process?.env ?? {};
  const supabaseUrl = env.APP_SUPABASE_URL;
  const anonKey = env.APP_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    context.log.error('Supabase credentials are missing for org key lookup.');
    jsonResponse(context, 500, { error: 'server_misconfigured' });
    return;
  }

  const orgId = context.bindingData?.orgId || context.bindingData?.id;
  if (!orgId) {
    jsonResponse(context, 400, { error: 'missing_org', message: 'ארגון לא צוין בבקשה.' });
    return;
  }

  const token = readBearerToken(req);
  if (!token) {
    jsonResponse(context, 401, { error: 'missing_or_invalid_token' });
    return;
  }

  const rpcUrl = `${ensureTrailingSlashRemoved(supabaseUrl)}/rest/v1/rpc/get_org_public_keys`;

  let response;
  try {
    response = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Prefer: 'params=single-object',
      },
      body: JSON.stringify({ p_org_id: orgId }),
    });
  } catch (networkError) {
    context.log.error('Network failure when calling get_org_public_keys.', {
      orgId,
      message: networkError?.message,
    });
    jsonResponse(context, 502, { error: 'upstream_unreachable' });
    return;
  }

  const payload = await parseJson(response);

  if (response.status === 401) {
    jsonResponse(context, 401, { error: 'missing_or_invalid_token' });
    return;
  }

  if (response.status === 403) {
    context.log.warn('Access denied when requesting org keys.', {
      orgId,
    });
    jsonResponse(context, 403, { error: 'forbidden' });
    return;
  }

  if (!response.ok) {
    context.log.error('Unexpected response from get_org_public_keys.', {
      orgId,
      status: response.status,
      body: payload,
    });
    const status = response.status === 404 ? 404 : 500;
    jsonResponse(context, status, { error: status === 404 ? 'not_found' : 'server_error' });
    return;
  }

  if (!payload?.supabase_url || !payload?.anon_key) {
    context.log.warn('Org keys RPC returned no credentials.', {
      orgId,
      payload,
    });
    jsonResponse(context, 404, { error: 'not_found' });
    return;
  }

  context.log.info('Issued org public keys.', {
    orgId,
    supabaseUrl: maskForLog(payload.supabase_url),
    anonKey: maskForLog(payload.anon_key),
  });

  jsonResponse(
    context,
    200,
    {
      supabase_url: payload.supabase_url,
      anon_key: payload.anon_key,
    },
    { 'X-Config-Scope': 'org' },
  );
}
