import { getCurrentConfig } from '@/runtime/config.js';

function base64UrlDecode(segment) {
  if (typeof segment !== 'string') {
    throw new Error('Invalid JWT payload.');
  }

  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const value = normalized + padding;

  if (typeof globalThis?.atob === 'function') {
    return globalThis.atob(value);
  }

  if (typeof globalThis?.Buffer?.from === 'function') {
    return globalThis.Buffer.from(value, 'base64').toString('utf-8');
  }

  throw new Error('Unable to decode JWT payload in this environment.');
}

function extractDomain(urlLike) {
  if (typeof urlLike !== 'string' || !urlLike.trim()) {
    return '';
  }

  try {
    const parsed = new URL(urlLike);
    return parsed.host.toLowerCase();
  } catch {
    return '';
  }
}

function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length < 2) {
    throw new Error('Malformed access token received.');
  }

  try {
    const json = base64UrlDecode(parts[1]);
    return JSON.parse(json);
  } catch {
    throw new Error('Unable to parse access token payload.');
  }
}

export function resolveControlAccessToken(credential) {
  const rawToken = typeof credential === 'string'
    ? credential
    : credential?.access_token || credential?.accessToken || credential?.token || '';
  const token = typeof rawToken === 'string' ? rawToken.trim() : '';

  if (!token) {
    throw new Error('נדרש אסימון גישה פעיל כדי לקרוא ל-API.');
  }

  const payload = decodeJwtPayload(token);
  const config = getCurrentConfig();

  if (!config?.supabaseUrl) {
    throw new Error('החיבור למסד הבקרה אינו זמין. נסה לרענן את ההגדרות ונסה שוב.');
  }

  const expectedDomain = extractDomain(config.supabaseUrl);
  const issuerDomain = extractDomain(payload?.iss);
  const audienceDomain = extractDomain(payload?.aud);
  const candidateDomains = new Set();

  if (issuerDomain) {
    candidateDomains.add(issuerDomain);
  }
  if (audienceDomain) {
    candidateDomains.add(audienceDomain);
  }

  if (candidateDomains.size === 0) {
    throw new Error('אסימון ההתחברות חסר מידע זיהוי. התחבר מחדש ונסה שוב.');
  }

  if (expectedDomain && !candidateDomains.has(expectedDomain.toLowerCase())) {
    throw new Error('זוהה אסימון שאינו שייך לפרויקט הבקרה. התחבר מחדש לחשבון הניהול.');
  }

  return token;
}

export async function authenticatedFetch(path, { session, accessToken, ...options } = {}) {
  const tokenSource = session ?? accessToken;
  const token = resolveControlAccessToken(tokenSource);
  const bearer = `Bearer ${token}`;

  const { headers: customHeaders = {}, body, ...rest } = options;
  const headers = {
    'Content-Type': 'application/json',
    ...customHeaders,
  };

  headers.Authorization = bearer;
  headers['X-Supabase-Authorization'] = bearer;
  headers['x-supabase-authorization'] = bearer;
  headers['x-supabase-auth'] = bearer;

  let requestBody = body;
  if (requestBody && typeof requestBody === 'object' && !(requestBody instanceof FormData)) {
    requestBody = JSON.stringify(requestBody);
  }

  const normalizedPath = String(path || '').replace(/^\/+/, '');
  const response = await fetch(`/api/${normalizedPath}`, {
    ...rest,
    headers,
    body: requestBody,
  });

  let payload = null;
  const contentType = response.headers?.get?.('content-type') || response.headers?.get?.('Content-Type') || '';
  const isJson = typeof contentType === 'string' && contentType.toLowerCase().includes('application/json');
  if (isJson) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const message = payload?.message || 'An API error occurred';
    const error = new Error(message);
    error.status = response.status;
    if (payload) {
      error.data = payload;
    }
    throw error;
  }

  return payload;
}
