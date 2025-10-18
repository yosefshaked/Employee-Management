import { Buffer } from 'node:buffer';

const DEFAULT_AUTH_HEADER_NAMES = [
  'x-supabase-authorization',
  'x-supabase-auth',
  'authorization',
];

function toBase64UrlString(segment) {
  if (!segment) {
    return '';
  }

  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const paddingNeeded = (4 - (normalized.length % 4)) % 4;
  return normalized + '='.repeat(paddingNeeded);
}

function decodeJwtPayload(token) {
  if (typeof token !== 'string') {
    return null;
  }

  const segments = token.split('.');
  if (segments.length < 2) {
    return null;
  }

  try {
    const payloadSegment = toBase64UrlString(segments[1]);
    const json = Buffer.from(payloadSegment, 'base64').toString('utf8');
    const payload = JSON.parse(json);
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function extractHostname(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }

  try {
    const url = new URL(value);
    return url.hostname ? url.hostname.toLowerCase() : null;
  } catch {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    if (/^[a-z0-9.-]+$/i.test(trimmed)) {
      return trimmed.toLowerCase();
    }
    return null;
  }
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

    if (
      typeof rawValue.toString === 'function'
      && rawValue.toString !== Object.prototype.toString
    ) {
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

function toStringValue(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const resolved = toStringValue(entry);
      if (resolved) {
        return resolved;
      }
    }
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object' && typeof value.toString === 'function') {
    const stringValue = value.toString();
    return typeof stringValue === 'string' ? stringValue : null;
  }
  return null;
}

function getHeaderFromRaw(rawHeaders, name) {
  if (!Array.isArray(rawHeaders) || rawHeaders.length === 0) {
    return null;
  }
  const target = name.toLowerCase();
  for (let index = 0; index < rawHeaders.length - 1; index += 2) {
    const headerName = String(rawHeaders[index] || '').toLowerCase();
    if (headerName === target) {
      return rawHeaders[index + 1];
    }
  }
  return null;
}

function readHeader(headers, name) {
  if (!headers) {
    return null;
  }
  if (typeof headers.get === 'function') {
    const direct = headers.get(name);
    if (direct) {
      return direct;
    }
    const lower = headers.get(name.toLowerCase());
    if (lower) {
      return lower;
    }
  }
  if (typeof headers.entries === 'function') {
    for (const [headerName, headerValue] of headers.entries()) {
      if (String(headerName || '').toLowerCase() === name.toLowerCase()) {
        return headerValue;
      }
    }
  }
  if (typeof headers === 'object') {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === name.toLowerCase()) {
        return headers[key];
      }
    }
  }
  return null;
}

function collectHeaderValues(request, name) {
  const values = [];
  const visited = new Set();

  function addValue(raw) {
    const normalized = normalizeHeaderValue(raw);
    if (typeof normalized !== 'string' || normalized.length === 0) {
      return;
    }
    if (visited.has(normalized)) {
      return;
    }
    visited.add(normalized);
    values.push(normalized);
  }

  const direct = resolveHeaderValue(request, name);
  if (direct) {
    addValue(direct);
  }

  const headers = request?.headers;
  if (headers && headers !== request) {
    const nested = resolveHeaderValue(headers, name);
    if (nested) {
      addValue(nested);
    }
  }

  const rawHeaders = request?.rawHeaders;
  if (Array.isArray(rawHeaders)) {
    for (let index = 0; index < rawHeaders.length - 1; index += 2) {
      const rawName = rawHeaders[index];
      if (typeof rawName !== 'string') {
        continue;
      }
      if (rawName.toLowerCase() !== String(name).toLowerCase()) {
        continue;
      }
      addValue(rawHeaders[index + 1]);
    }
  }

  return values;
}

function extractBearerTokens(rawValue) {
  const normalized = normalizeHeaderValue(rawValue);
  if (typeof normalized !== 'string') {
    return [];
  }

  const tokens = [];
  const segments = normalized
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean);

  for (const segment of segments) {
    if (segment.toLowerCase().startsWith('bearer ')) {
      const token = segment.slice('bearer '.length).trim();
      if (token) {
        tokens.push(token);
      }
      continue;
    }

    if (!segment.includes(' ')) {
      tokens.push(segment);
    }
  }

  return tokens;
}

export function resolveHeaderValue(source, name) {
  if (!source || !name) {
    return undefined;
  }

  const targetName = typeof name === 'string' ? name : String(name || '');
  const targetLower = targetName.toLowerCase();
  const targetUpper = targetName.toUpperCase();
  const visited = new Set();

  function search(headers) {
    if (!headers || visited.has(headers)) {
      return undefined;
    }

    visited.add(headers);

    if (typeof headers.get === 'function') {
      const directValue = normalizeHeaderValue(headers.get(targetName));
      if (typeof directValue === 'string' && directValue.length > 0) {
        return directValue;
      }

      const lowerValue = normalizeHeaderValue(headers.get(targetLower));
      if (typeof lowerValue === 'string' && lowerValue.length > 0) {
        return lowerValue;
      }
    }

    if (typeof headers === 'object') {
      if (Object.prototype.hasOwnProperty.call(headers, targetName)) {
        const directValue = normalizeHeaderValue(headers[targetName]);
        if (typeof directValue === 'string' && directValue.length > 0) {
          return directValue;
        }
      }

      if (
        targetLower !== targetName
        && Object.prototype.hasOwnProperty.call(headers, targetLower)
      ) {
        const lowerValue = normalizeHeaderValue(headers[targetLower]);
        if (typeof lowerValue === 'string' && lowerValue.length > 0) {
          return lowerValue;
        }
      }

      if (
        targetUpper !== targetName
        && Object.prototype.hasOwnProperty.call(headers, targetUpper)
      ) {
        const upperValue = normalizeHeaderValue(headers[targetUpper]);
        if (typeof upperValue === 'string' && upperValue.length > 0) {
          return upperValue;
        }
      }
    }

    if (typeof headers?.toJSON === 'function') {
      const serialized = headers.toJSON();
      if (serialized && typeof serialized === 'object') {
        const serializedValue = search(serialized);
        if (serializedValue) {
          return serializedValue;
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

        if (rawName.toLowerCase() !== targetLower) {
          continue;
        }

        const rawValue = normalizeHeaderValue(rawHeaders[index + 1]);
        if (typeof rawValue === 'string' && rawValue.length > 0) {
          return rawValue;
        }
      }
    }

    const nested = headers?.headers;
    if (nested && nested !== headers) {
      const nestedValue = search(nested);
      if (nestedValue) {
        return nestedValue;
      }
    }

    return undefined;
  }

  const direct = search(source);
  if (direct) {
    return direct;
  }

  if (source?.headers && source.headers !== source) {
    const nestedValue = search(source.headers);
    if (nestedValue) {
      return nestedValue;
    }
  }

  const rawHeaders = source?.rawHeaders;
  if (Array.isArray(rawHeaders)) {
    for (let index = 0; index < rawHeaders.length - 1; index += 2) {
      const rawName = rawHeaders[index];
      if (typeof rawName !== 'string') {
        continue;
      }

      if (rawName.toLowerCase() !== targetLower) {
        continue;
      }

      const rawValue = normalizeHeaderValue(rawHeaders[index + 1]);
      if (typeof rawValue === 'string' && rawValue.length > 0) {
        return rawValue;
      }
    }
  }

  return undefined;
}

export function resolveAuthorizationHeader(request, names = DEFAULT_AUTH_HEADER_NAMES) {
  const headerNames = Array.isArray(names) && names.length ? names : DEFAULT_AUTH_HEADER_NAMES;
  const headers = request?.headers ?? null;

  for (const name of headerNames) {
    const value = resolveHeaderValue(request, name);
    if (value) {
      return toStringValue(value);
    }
  }

  for (const name of headerNames) {
    const value = readHeader(headers, name);
    if (value) {
      return toStringValue(value);
    }
  }

  const rawHeaders = request?.rawHeaders;
  if (Array.isArray(rawHeaders) && rawHeaders.length) {
    for (const name of headerNames) {
      const value = getHeaderFromRaw(rawHeaders, name);
      if (value) {
        return toStringValue(value);
      }
    }
  }

  return null;
}

export function resolveBearerAuthorization(request) {
  const raw = resolveAuthorizationHeader(request);
  if (!raw) {
    return null;
  }

  const segments = String(raw)
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean);

  for (const segment of segments) {
    if (segment.toLowerCase().startsWith('bearer ')) {
      const token = segment.slice('Bearer '.length).trim();
      if (token) {
        return { header: `Bearer ${token}`, token };
      }
    }
    if (!segment.includes(' ')) {
      return { header: `Bearer ${segment}`, token: segment };
    }
  }

  return null;
}

export function resolveSupabaseAccessToken(request, { supabaseUrl, headerNames = DEFAULT_AUTH_HEADER_NAMES } = {}) {
  const expectedHost = extractHostname(supabaseUrl);
  const names = Array.isArray(headerNames) && headerNames.length ? headerNames : DEFAULT_AUTH_HEADER_NAMES;

  const candidateTokens = [];
  const seenTokens = new Set();

  for (const name of names) {
    const headerValues = collectHeaderValues(request, name);
    for (const headerValue of headerValues) {
      const tokens = extractBearerTokens(headerValue);
      for (const token of tokens) {
        if (!token || seenTokens.has(token)) {
          continue;
        }
        seenTokens.add(token);
        candidateTokens.push({ token, headerName: name });
      }
    }
  }

  if (candidateTokens.length === 0) {
    return null;
  }

  if (expectedHost) {
    for (const candidate of candidateTokens) {
      const payload = decodeJwtPayload(candidate.token);
      if (!payload) {
        continue;
      }

      const issuerHost = extractHostname(payload.iss);
      const audienceHost = extractHostname(payload.aud);

      if (issuerHost === expectedHost || audienceHost === expectedHost) {
        return candidate.token;
      }
    }
  }

  return candidateTokens[0]?.token ?? null;
}

function ensureJsonSerializable(value) {
  if (value === undefined) {
    return null;
  }
  return value;
}

export function json(status, body, extraHeaders = {}) {
  const headers = {
    'content-type': 'application/json',
    'Content-Type': 'application/json',
    ...extraHeaders,
  };

  return {
    status,
    headers,
    body: JSON.stringify(ensureJsonSerializable(body)),
  };
}
