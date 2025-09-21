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
