const GLOBAL_CONFIG_KEY = '__EMPLOYEE_MANAGEMENT_PUBLIC_CONFIG__';
const ACTIVE_ORG_STORAGE_KEY = 'active_org_id';
const CACHE = new Map();

let lastDiagnostics = {
  orgId: null,
  status: null,
  scope: 'app',
  ok: false,
  error: null,
  timestamp: null,
  accessToken: null,
  accessTokenPreview: null,
};

export class MissingRuntimeConfigError extends Error {
  constructor(message = 'טעינת ההגדרות נכשלה. ודא שפונקציית /api/config זמינה ומחזירה JSON תקין.') {
    super(message);
    this.name = 'MissingRuntimeConfigError';
  }
}

export function setRuntimeConfig(config) {
  CACHE.set('app', config);
  if (typeof window !== 'undefined') {
    window[GLOBAL_CONFIG_KEY] = config;
  }
}

export function getRuntimeConfig() {
  if (CACHE.has('app')) {
    return CACHE.get('app');
  }
  if (typeof window === 'undefined') {
    return undefined;
  }
  return window[GLOBAL_CONFIG_KEY];
}

function sanitizeConfig(raw, source = 'api') {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const supabaseUrl = raw.supabaseUrl || raw.supabase_url;
  const supabaseAnonKey = raw.supabaseAnonKey || raw.supabase_anon_key || raw.anon_key;
  const trimmedUrl = typeof supabaseUrl === 'string' ? supabaseUrl.trim() : '';
  const trimmedKey = typeof supabaseAnonKey === 'string' ? supabaseAnonKey.trim() : '';

  if (!trimmedUrl || !trimmedKey) {
    return undefined;
  }

  return {
    supabaseUrl: trimmedUrl,
    supabaseAnonKey: trimmedKey,
    source,
  };
}

function getStoredOrgId() {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage.getItem(ACTIVE_ORG_STORAGE_KEY);
  } catch {
    return null;
  }
}

function buildTokenPreview(token) {
  if (!token) {
    return null;
  }
  const trimmed = String(token).trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length <= 8) {
    return trimmed;
  }
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

function updateDiagnostics({ orgId, status, scope, ok, error, accessToken }) {
  lastDiagnostics = {
    orgId: orgId || null,
    status: typeof status === 'number' ? status : null,
    scope,
    ok,
    error: error || null,
    timestamp: Date.now(),
    accessToken: accessToken || null,
    accessTokenPreview: buildTokenPreview(accessToken),
  };
}

export function getRuntimeConfigDiagnostics() {
  return { ...lastDiagnostics };
}

function buildCacheKey(scope, orgId) {
  if (scope === 'org') {
    return `org:${orgId || 'none'}`;
  }
  return 'app';
}

function ensureJsonResponse(response, orgId, scope, accessToken, endpoint) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    updateDiagnostics({
      orgId,
      status: response.status,
      scope,
      ok: false,
      error: 'response-not-json',
      accessToken,
    });
    const endpointLabel = endpoint || '/api/config';
    throw new MissingRuntimeConfigError(
      `הפונקציה ${endpointLabel} לא מחזירה JSON תקין. ודא שהיא מחזירה תשובה מסוג application/json.`,
    );
  }
}

export async function loadRuntimeConfig(options = {}) {
  const { accessToken = null, orgId: explicitOrgId = undefined, force = false } = options;
  const scope = accessToken ? 'org' : 'app';
  const targetOrgId = scope === 'org' ? explicitOrgId ?? getStoredOrgId() : null;
  const cacheKey = buildCacheKey(scope, targetOrgId);

  if (!force && CACHE.has(cacheKey)) {
    return CACHE.get(cacheKey);
  }

  const headers = { Accept: 'application/json' };
  let endpoint = '/api/config';

  if (scope === 'org') {
    if (!targetOrgId) {
      updateDiagnostics({
        orgId: null,
        status: null,
        scope,
        ok: false,
        error: 'missing-org',
        accessToken,
      });
      throw new MissingRuntimeConfigError('לא נמצא ארגון פעיל לטעינת מפתחות Supabase.');
    }

    if (!accessToken) {
      updateDiagnostics({
        orgId: targetOrgId,
        status: null,
        scope,
        ok: false,
        error: 'missing-token',
        accessToken,
      });
      throw new MissingRuntimeConfigError('נדרשת כניסה מחדש כדי לאמת את בקשת מפתחות הארגון.');
    }

    headers.Authorization = `Bearer ${accessToken}`;
    endpoint = `/api/org/${encodeURIComponent(targetOrgId)}/keys`;
  }

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      headers,
      cache: 'no-store',
    });
  } catch {
    updateDiagnostics({
      orgId: targetOrgId,
      status: null,
      scope,
      ok: false,
      error: 'network-failure',
      accessToken,
    });
    throw new MissingRuntimeConfigError(
      `לא ניתן ליצור קשר עם הפונקציה ${endpoint}. ודא שהיא פרוסה ופועלת.`,
    );
  }

  ensureJsonResponse(response, targetOrgId, scope, accessToken, endpoint);

  let payload;
  try {
    payload = await response.json();
  } catch {
    updateDiagnostics({
      orgId: targetOrgId,
      status: response.status,
      scope,
      ok: false,
      error: 'invalid-json',
      accessToken,
    });
    throw new MissingRuntimeConfigError(
      `לא ניתן לפענח את תשובת ${endpoint}. ודא שהפונקציה מחזירה JSON תקין.`,
    );
  }

  if (!response.ok) {
    let serverMessage;

    if (scope === 'org') {
      if (response.status === 404) {
        serverMessage = 'לא נמצאו מפתחות Supabase עבור הארגון שנבחר.';
      } else if (response.status === 401 || response.status === 403) {
        serverMessage = 'אין הרשאה לצפות במפתחות הארגון. ודא שהחשבון משויך לארגון.';
      } else {
        serverMessage = `טעינת מפתחות הארגון נכשלה (סטטוס ${response.status}).`;
      }
    } else {
      serverMessage = typeof payload?.error === 'string'
        ? payload.error
        : `טעינת ההגדרות נכשלה (סטטוס ${response.status}).`;
    }

    updateDiagnostics({
      orgId: targetOrgId,
      status: response.status,
      scope,
      ok: false,
      error: serverMessage,
      accessToken,
    });
    throw new MissingRuntimeConfigError(serverMessage);
  }

  const sanitized = sanitizeConfig(payload, scope === 'org' ? 'org-api' : 'api');
  if (!sanitized) {
    updateDiagnostics({
      orgId: targetOrgId,
      status: response.status,
      scope,
      ok: false,
      error: 'missing-keys',
      accessToken,
    });
    throw new MissingRuntimeConfigError(
      `הפונקציה ${endpoint} לא סיפקה supabase_url ו-anon_key.`,
    );
  }

  const normalized = {
    ...sanitized,
    orgId: scope === 'org' ? targetOrgId || null : null,
  };

  updateDiagnostics({
    orgId: targetOrgId,
    status: response.status,
    scope,
    ok: true,
    error: null,
    accessToken,
  });

  CACHE.set(cacheKey, normalized);
  if (scope === 'app') {
    setRuntimeConfig(normalized);
  }

  return normalized;
}
