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

function normalizeOrgId(candidate, fallback) {
  if (typeof candidate === 'string' && candidate.trim()) {
    return candidate.trim();
  }
  if (typeof fallback === 'string' && fallback.trim()) {
    return fallback.trim();
  }
  return '';
}

function deriveFunctionsBaseUrl(supabaseUrl) {
  if (typeof supabaseUrl !== 'string' || !supabaseUrl.trim()) {
    return '';
  }

  try {
    const parsed = new URL(supabaseUrl);
    const [projectId, ...rest] = parsed.host.split('.');
    if (!projectId || rest.length === 0) {
      return '';
    }
    const baseDomain = rest.join('.');
    return `https://${projectId}.functions.${baseDomain}`;
  } catch {
    return '';
  }
}

function resolveOrgConnection(activeOrg, connection) {
  const candidates = [
    connection?.supabaseUrl,
    activeOrg?.supabase_url,
    activeOrg?.supabaseUrl,
    activeOrg?.connection?.supabaseUrl,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return '';
}

function resolveOrgAnonKey(activeOrg, connection) {
  const candidates = [
    connection?.supabaseAnonKey,
    activeOrg?.supabase_anon_key,
    activeOrg?.supabaseAnonKey,
    activeOrg?.connection?.supabaseAnonKey,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return '';
}

async function resolveAccessToken({ authClient, session, accessToken }) {
  if (accessToken) {
    return resolveControlAccessToken(accessToken);
  }

  if (session) {
    return resolveControlAccessToken(session);
  }

  if (authClient?.auth?.getSession) {
    const { data, error } = await authClient.auth.getSession();
    if (error) {
      throw new Error('שליפת אסימון הגישה נכשלה. התחבר מחדש ונסה שוב.');
    }
    if (data?.session) {
      return resolveControlAccessToken(data.session);
    }
  }

  throw new Error('נדרש לקוח Supabase כדי לאחזר אסימון גישה תקף.');
}

function buildRequestPayload({ payload, activeOrg, connection }) {
  if (!payload || typeof payload !== 'object' || payload instanceof FormData) {
    return payload ?? null;
  }

  const enriched = { ...payload };
  if (
    !('supabaseUrl' in enriched)
    && !('orgSupabaseUrl' in enriched)
    && !('customerSupabaseUrl' in enriched)
  ) {
    const url = resolveOrgConnection(activeOrg, connection);
    if (url) {
      enriched.supabaseUrl = url;
    }
  }

  if (!('supabaseAnonKey' in enriched) && !('anonKey' in enriched)) {
    const anonKey = resolveOrgAnonKey(activeOrg, connection);
    if (anonKey) {
      enriched.supabaseAnonKey = anonKey;
    }
  }

  return enriched;
}

export async function makeApiCall({
  action,
  payload,
  orgId,
  authClient,
  session,
  accessToken,
  activeOrg,
  connection,
  signal,
  headers: extraHeaders,
} = {}) {
  const normalizedAction = typeof action === 'string' ? action.trim().toUpperCase() : '';
  if (!normalizedAction) {
    throw new Error('יש לציין פעולה לביצוע.');
  }

  const config = getCurrentConfig();
  if (!config?.supabaseUrl) {
    throw new Error('החיבור למסד הבקרה אינו זמין. נסה לרענן את ההגדרות ונסה שוב.');
  }

  const functionsBaseUrl = deriveFunctionsBaseUrl(config.supabaseUrl);
  if (!functionsBaseUrl) {
    throw new Error('לא ניתן לבנות את כתובת פונקציית Supabase. בדוק את הגדרות הפרויקט.');
  }

  const token = await resolveAccessToken({ authClient, session, accessToken });
  const resolvedOrgId = normalizeOrgId(orgId, activeOrg?.id);
  if (!resolvedOrgId) {
    throw new Error('יש לבחור ארגון פעיל לפני ביצוע הפעולה.');
  }

  const requestBody = {
    action: normalizedAction,
    orgId: resolvedOrgId,
    payload: buildRequestPayload({ payload, activeOrg, connection }),
  };

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    ...(extraHeaders || {}),
  };

  headers['X-Supabase-Authorization'] = headers.Authorization;
  headers['x-supabase-authorization'] = headers.Authorization;
  headers['x-supabase-auth'] = headers.Authorization;

  const endpoint = `${functionsBaseUrl.replace(/\/$/, '')}/api-proxy`;
  const response = await fetch(endpoint, {
    method: 'POST',
    signal,
    headers,
    body: JSON.stringify(requestBody),
  });

  let responseBody = null;
  const contentType = response.headers?.get?.('content-type') || response.headers?.get?.('Content-Type') || '';
  if (typeof contentType === 'string' && contentType.toLowerCase().includes('application/json')) {
    try {
      responseBody = await response.json();
    } catch {
      responseBody = null;
    }
  }

  if (!response.ok) {
    const message = responseBody?.error || responseBody?.message || 'הקריאה לשכבת הפרוקסי נכשלה.';
    const error = new Error(message);
    error.status = response.status;
    if (responseBody) {
      error.data = responseBody;
    }
    throw error;
  }

  return responseBody;
}
