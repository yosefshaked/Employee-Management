import { createClient } from '@supabase/supabase-js';
import { MissingRuntimeConfigError } from './error-utils.js';
import {
  getCurrentConfig,
  onConfigActivated,
  onConfigCleared,
} from '../runtime/config.js';
import { getOrgOrThrow, waitOrgReady } from './org-runtime.js';

const IS_DEV = Boolean(import.meta?.env?.DEV);
const AUTH_STORAGE_KEY = 'app-main-auth-session';

let authClientInstance = null;
let authClientConfigKey = null;
let lastAuthConfig = null;

const dataClients = new Map();
const pendingDataClients = new Map();

function buildAuthClient(config) {
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      storageKey: AUTH_STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: true,
    },
    global: {
      headers: { Accept: 'application/json' },
    },
  });
}

function computeConfigKey(config) {
  return `${config.supabaseUrl}::${config.supabaseAnonKey}`;
}

function ensureControlConfig() {
  const current = getCurrentConfig();

  if (current && !current.orgId) {
    lastAuthConfig = {
      supabaseUrl: current.supabaseUrl,
      supabaseAnonKey: current.supabaseAnonKey,
      source: current.source || null,
    };
    return lastAuthConfig;
  }

  if (lastAuthConfig) {
    return lastAuthConfig;
  }

  throw new MissingRuntimeConfigError(
    'Supabase configuration missing. ודא שפונקציית /api/config זמינה ומחזירה supabase_url ו-anon_key.',
  );
}

function ensureAuthClient() {
  const config = ensureControlConfig();
  const configKey = computeConfigKey(config);

  if (authClientInstance && authClientConfigKey === configKey) {
    return authClientInstance;
  }

  authClientInstance = buildAuthClient(config);
  authClientConfigKey = configKey;
  lastAuthConfig = config;

  if (IS_DEV) {
    console.debug('[supabase-manager] auth client initialized', {
      source: config.source || 'runtime',
    });
  }

  return authClientInstance;
}

export const authClient = new Proxy(
  {},
  {
    get(_target, prop) {
      const client = ensureAuthClient();
      const value = client[prop];
      return typeof value === 'function' ? value.bind(client) : value;
    },
  },
);

export function getAuthClient() {
  return ensureAuthClient();
}

export function getAuthSupabaseUrl() {
  const config = ensureControlConfig();
  return config.supabaseUrl;
}

export function getAuthSupabaseAnonKey() {
  const config = ensureControlConfig();
  return config.supabaseAnonKey;
}

function getOrgCacheKey(orgId) {
  return orgId || null;
}

function resolveCurrentOrgId() {
  try {
    const { orgId } = getOrgOrThrow();
    return orgId || null;
  } catch {
    return null;
  }
}

export function createDataClient(orgUrl, orgAnonKey, orgId) {
  if (!orgUrl || !orgAnonKey) {
    console.error('[supabase-manager] Cannot create data client without URL and anon key', {
      orgId: orgId || null,
    });
    return null;
  }

  const storageKey = orgId ? `org-data-token-${orgId}` : 'org-data-token';

  return createClient(orgUrl, orgAnonKey, {
    auth: {
      storageKey,
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { Accept: 'application/json' },
    },
  });
}

export async function getSupabase() {
  await waitOrgReady();
  const config = getOrgOrThrow();
  const cacheKey = getOrgCacheKey(config.orgId);

  if (dataClients.has(cacheKey)) {
    return dataClients.get(cacheKey);
  }

  if (!pendingDataClients.has(cacheKey)) {
    const pending = Promise.resolve()
      .then(() => {
        const client = createDataClient(config.supabaseUrl, config.supabaseAnonKey, config.orgId);
        if (!client) {
          throw new MissingRuntimeConfigError('supabase_url ו-anon_key נדרשים להפעלת חיבור הארגון.');
        }
        dataClients.set(cacheKey, client);
        pendingDataClients.delete(cacheKey);
        return client;
      })
      .catch((error) => {
        pendingDataClients.delete(cacheKey);
        throw error;
      });

    pendingDataClients.set(cacheKey, pending);
  }

  return pendingDataClients.get(cacheKey);
}

export function getCachedSupabase(orgId) {
  const cacheKey = getOrgCacheKey(orgId) ?? resolveCurrentOrgId();
  if (cacheKey === null) {
    return null;
  }
  return dataClients.get(cacheKey) || null;
}

export function resetSupabase(orgId) {
  const cacheKey = getOrgCacheKey(orgId) ?? resolveCurrentOrgId();

  if (cacheKey !== null) {
    dataClients.delete(cacheKey);
    pendingDataClients.delete(cacheKey);
    return;
  }

  dataClients.clear();
  pendingDataClients.clear();
}

const preloadedConfig = (() => {
  try {
    return getCurrentConfig();
  } catch {
    return null;
  }
})();

if (preloadedConfig && !preloadedConfig.orgId) {
  ensureAuthClient();
}

onConfigActivated((config) => {
  if (!config || config.orgId) {
    return;
  }

  try {
    ensureAuthClient();
  } catch (error) {
    if (IS_DEV) {
      console.warn('[supabase-manager] failed to initialize auth client on activation', error);
    }
  }
});

onConfigCleared(() => {
  authClientInstance = null;
  authClientConfigKey = null;
  lastAuthConfig = null;
});
