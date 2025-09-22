import { createClient } from '@supabase/supabase-js';
import {
  getCurrentConfig,
  MissingRuntimeConfigError,
  onConfigActivated,
  onConfigCleared,
} from '@/runtime/config.js';

const IS_DEV = Boolean(import.meta?.env?.DEV);

let authClientInstance = null;
let authClientConfigKey = null;
let controlConfigSnapshot = null;

export let AUTH_SUPABASE_URL = null;
export let AUTH_SUPABASE_ANON_KEY = null;

function buildAuthClient(config) {
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      storageKey: 'app-auth-token',
      persistSession: true,
      autoRefreshToken: true,
    },
    global: {
      headers: { Accept: 'application/json' },
    },
  });
}

function computeAuthConfigKey(config) {
  return `${config.supabaseUrl}::${config.supabaseAnonKey}`;
}

function applyAuthConfig(config) {
  const key = computeAuthConfigKey(config);
  if (authClientInstance && authClientConfigKey === key) {
    return authClientInstance;
  }

  authClientInstance = buildAuthClient(config);
  authClientConfigKey = key;
  AUTH_SUPABASE_URL = config.supabaseUrl;
  AUTH_SUPABASE_ANON_KEY = config.supabaseAnonKey;

  if (!config.orgId) {
    controlConfigSnapshot = {
      supabaseUrl: config.supabaseUrl,
      supabaseAnonKey: config.supabaseAnonKey,
      source: config.source || null,
    };
  }

  if (IS_DEV) {
    console.debug('[authClient] core client initialized', {
      source: config.source || 'unknown',
    });
  }

  return authClientInstance;
}

function ensureAuthClientInstance() {
  const activeConfig = getCurrentConfig();
  const controlConfig = activeConfig && !activeConfig.orgId ? activeConfig : controlConfigSnapshot;

  if (!controlConfig) {
    throw new MissingRuntimeConfigError(
      'Supabase configuration missing. ודא שפונקציית /api/config זמינה ומחזירה supabase_url ו-anon_key.',
    );
  }

  return applyAuthConfig(controlConfig);
}

const preloadedConfig = getCurrentConfig();
if (preloadedConfig && !preloadedConfig.orgId) {
  applyAuthConfig(preloadedConfig);
}

onConfigActivated((config) => {
  if (!config || config.orgId) {
    if (IS_DEV && config?.orgId) {
      console.debug('[authClient] skipped init for org-scoped config', {
        orgId: config.orgId,
      });
    }
    return;
  }

  try {
    applyAuthConfig(config);
  } catch (error) {
    if (IS_DEV) {
      console.warn('[authClient] failed to initialize on activation', error);
    }
  }
});

onConfigCleared(() => {
  if (!controlConfigSnapshot) {
    authClientInstance = null;
    authClientConfigKey = null;
    AUTH_SUPABASE_URL = null;
    AUTH_SUPABASE_ANON_KEY = null;
  }

  if (IS_DEV) {
    console.debug('[authClient] clear event processed', {
      preserved: Boolean(controlConfigSnapshot),
    });
  }
});

export const authClient = new Proxy(
  {},
  {
    get(_target, prop) {
      const client = ensureAuthClientInstance();
      const value = client[prop];
      return typeof value === 'function' ? value.bind(client) : value;
    },
  },
);

export function getAuthClient() {
  return ensureAuthClientInstance();
}

export function getAuthSupabaseUrl() {
  if (!AUTH_SUPABASE_URL) {
    throw new MissingRuntimeConfigError(
      'Supabase configuration missing. ודא שפונקציית /api/config זמינה ומחזירה supabase_url ו-anon_key.',
    );
  }
  return AUTH_SUPABASE_URL;
}

export function getAuthSupabaseAnonKey() {
  if (!AUTH_SUPABASE_ANON_KEY) {
    throw new MissingRuntimeConfigError(
      'Supabase configuration missing. ודא שפונקציית /api/config זמינה ומחזירה supabase_url ו-anon_key.',
    );
  }
  return AUTH_SUPABASE_ANON_KEY;
}
