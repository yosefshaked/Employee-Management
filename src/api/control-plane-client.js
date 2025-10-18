import { createClient } from '@supabase/supabase-js';
import { loadRuntimeConfig, MissingRuntimeConfigError } from '@/runtime/config.js';

const CONTROL_STORAGE_KEY = 'app-main-auth-session';

let cachedCredentials = null;
let credentialsPromise = null;
let controlClient = null;
let clientPromise = null;

function readEnvCandidate(env, key) {
  const value = env?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function resolveEnvCredentials() {
  const env = typeof import.meta !== 'undefined' ? import.meta.env ?? {} : {};
  const supabaseUrl =
    readEnvCandidate(env, 'APP_SUPABASE_URL') ||
    readEnvCandidate(env, 'VITE_APP_SUPABASE_URL') ||
    readEnvCandidate(env, 'PUBLIC_APP_SUPABASE_URL') ||
    readEnvCandidate(env, 'SUPABASE_URL');
  const supabaseAnonKey =
    readEnvCandidate(env, 'APP_SUPABASE_ANON_KEY') ||
    readEnvCandidate(env, 'VITE_APP_SUPABASE_ANON_KEY') ||
    readEnvCandidate(env, 'PUBLIC_APP_SUPABASE_ANON_KEY') ||
    readEnvCandidate(env, 'SUPABASE_ANON_KEY');

  if (supabaseUrl && supabaseAnonKey) {
    return { supabaseUrl, supabaseAnonKey };
  }
  return null;
}

function resolveWindowCredentials() {
  if (typeof window === 'undefined') {
    return null;
  }
  const preloaded = window.__RUNTIME_CONFIG__;
  const supabaseUrl = typeof preloaded?.supabaseUrl === 'string' ? preloaded.supabaseUrl.trim() : '';
  const supabaseAnonKey = typeof preloaded?.supabaseAnonKey === 'string'
    ? preloaded.supabaseAnonKey.trim()
    : '';

  if (supabaseUrl && supabaseAnonKey) {
    return { supabaseUrl, supabaseAnonKey };
  }
  return null;
}

async function fetchControlCredentials() {
  if (cachedCredentials) {
    return cachedCredentials;
  }
  if (credentialsPromise) {
    return credentialsPromise;
  }

  const envCredentials = resolveEnvCredentials();
  if (envCredentials) {
    cachedCredentials = envCredentials;
    return cachedCredentials;
  }

  const windowCredentials = resolveWindowCredentials();
  if (windowCredentials) {
    cachedCredentials = windowCredentials;
    return cachedCredentials;
  }

  credentialsPromise = (async () => {
    const config = await loadRuntimeConfig();
    if (!config?.supabaseUrl || !config?.supabaseAnonKey) {
      throw new MissingRuntimeConfigError('חסר חיבור לבקרת Supabase. ודא שהפונקציה /api/config זמינה.');
    }
    cachedCredentials = {
      supabaseUrl: config.supabaseUrl,
      supabaseAnonKey: config.supabaseAnonKey,
    };
    return cachedCredentials;
  })().finally(() => {
    credentialsPromise = null;
  });

  return credentialsPromise;
}

async function ensureControlClient() {
  if (controlClient) {
    return controlClient;
  }
  if (clientPromise) {
    return clientPromise;
  }

  clientPromise = (async () => {
    const credentials = await fetchControlCredentials();
    controlClient = createClient(credentials.supabaseUrl, credentials.supabaseAnonKey, {
      auth: {
        storageKey: CONTROL_STORAGE_KEY,
        persistSession: true,
        autoRefreshToken: true,
      },
    });
    return controlClient;
  })().finally(() => {
    clientPromise = null;
  });

  return clientPromise;
}

function buildUrl(path, params = {}) {
  const searchParams = new URLSearchParams();
  if (params && typeof params === 'object') {
    for (const [key, value] of Object.entries(params)) {
      if (value == null) continue;
      if (Array.isArray(value)) {
        value.forEach((entry) => {
          if (entry != null) {
            searchParams.append(key, String(entry));
          }
        });
      } else {
        searchParams.append(key, String(value));
      }
    }
  }

  const hasProtocol = typeof path === 'string' && /^https?:\/\//i.test(path);
  const base = typeof window !== 'undefined' && window.location
    ? window.location.origin
    : 'http://localhost';
  const url = hasProtocol ? new URL(path) : new URL(path, base);

  if (Array.from(searchParams.keys()).length > 0) {
    for (const [key, value] of searchParams.entries()) {
      url.searchParams.append(key, value);
    }
  }

  return url.toString();
}

async function resolveAccessToken(client) {
  const { data, error } = await client.auth.getSession();
  if (error) {
    const sessionError = new Error('טעינת ההרשאות נכשלה. התחבר מחדש ונסה שוב.');
    sessionError.cause = error;
    throw sessionError;
  }
  const token = data?.session?.access_token;
  if (!token) {
    throw new Error('נדרש חיבור פעיל כדי לבצע פעולה זו. התחבר מחדש ונסה שוב.');
  }
  return token;
}

function normalizeRequestOptions(options) {
  if (!options || typeof options !== 'object') {
    return { params: {}, headers: undefined, signal: undefined, body: undefined };
  }
  const knownKeys = new Set(['params', 'headers', 'signal', 'body']);
  const optionKeys = Object.keys(options);
  const containsKnownKey = optionKeys.some((key) => knownKeys.has(key));
  if (containsKnownKey) {
    return {
      params: options.params ?? {},
      headers: options.headers,
      signal: options.signal,
      body: options.body,
    };
  }
  return { params: options, headers: undefined, signal: undefined, body: undefined };
}

async function authedRequest(method, path, options = {}) {
  const client = await ensureControlClient();
  const { params, headers: customHeaders, signal, body } = normalizeRequestOptions(options);
  const token = await resolveAccessToken(client);
  const url = buildUrl(path, params);

  const headers = new Headers(customHeaders || {});
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }
  headers.set('Authorization', `Bearer ${token}`);

  const fetchOptions = { method, headers, signal };
  if (body !== undefined) {
    if (body instanceof FormData) {
      fetchOptions.body = body;
    } else if (body == null) {
      fetchOptions.body = null;
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
    } else {
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
      fetchOptions.body = JSON.stringify(body);
    }
  }

  const response = await fetch(url, fetchOptions);
  const contentType = response.headers?.get?.('content-type') || response.headers?.get?.('Content-Type') || '';
  const expectsJson = typeof contentType === 'string' && contentType.toLowerCase().includes('application/json');

  let payload = null;
  if (expectsJson) {
    try {
      payload = await response.json();
    } catch (error) {
      if (response.ok) {
        throw new Error('השרת החזיר נתונים בלתי צפויים.');
      }
    }
  } else if (response.status === 204 || response.status === 205) {
    payload = null;
  } else if (response.ok) {
    payload = await response.text();
  }

  if (!response.ok) {
    const message = payload?.message || `בקשת ה-API נכשלה (סטטוס ${response.status}).`;
    const error = new Error(message);
    error.status = response.status;
    if (payload) {
      error.data = payload;
    }
    throw error;
  }

  return payload;
}

export async function authedGet(path, options) {
  return authedRequest('GET', path, options);
}

export async function authedPost(path, body, options = {}) {
  return authedRequest('POST', path, { ...options, body });
}

export async function authedDelete(path, options) {
  return authedRequest('DELETE', path, options);
}

export async function authedPut(path, body, options = {}) {
  return authedRequest('PUT', path, { ...options, body });
}

export async function getControlPlaneClient() {
  return ensureControlClient();
}
