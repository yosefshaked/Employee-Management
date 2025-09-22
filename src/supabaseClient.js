import { createContext, createElement, useContext, useEffect, useMemo, useState } from 'react';
import { MissingRuntimeConfigError } from './runtime/config.js';
import {
  authClient as controlSupabase,
  getAuthClient,
  getAuthSupabaseAnonKey,
  getAuthSupabaseUrl,
} from './lib/authClient.js';
import { activateOrg as activateRuntimeOrg, clearOrg as clearRuntimeOrg } from './lib/org-runtime.js';
import {
  getSupabase as getRuntimeSupabase,
  getCachedSupabase as getCachedRuntimeSupabase,
  resetSupabase as resetRuntimeSupabase,
} from './lib/supabase-client.js';

const IS_DEV = Boolean(import.meta?.env?.DEV);

if (IS_DEV) {
  console.debug('[supabaseClient] module evaluated');
}

export { AUTH_SUPABASE_ANON_KEY as SUPABASE_ANON_KEY, AUTH_SUPABASE_URL as SUPABASE_URL } from './lib/authClient.js';

export const coreSupabase = controlSupabase;

export function getCoreSupabase() {
  return getAuthClient();
}

export function getSupabaseUrl() {
  return getAuthSupabaseUrl();
}

export function getSupabaseAnonKey() {
  return getAuthSupabaseAnonKey();
}

let activeOrgConfig = null;
let activeOrgClient = null;
const listeners = new Set();

export function maskSupabaseCredential(value) {
  if (!value) return '';
  const stringValue = String(value);
  if (stringValue.length <= 6) return '••••';
  return `${stringValue.slice(0, 3)}…${stringValue.slice(-3)}`;
}

function normalizeOrgConfig(raw) {
  if (!raw) return null;
  const supabaseUrl = raw.supabaseUrl || raw.supabase_url;
  const supabaseAnonKey = raw.supabaseAnonKey || raw.supabase_anon_key || raw.anon_key;
  const orgId = raw.orgId || raw.org_id || raw.id;
  const trimmedOrgId = typeof orgId === 'string' ? orgId.trim() : '';
  const trimmedUrl = typeof supabaseUrl === 'string' ? supabaseUrl.trim() : '';
  const trimmedKey = typeof supabaseAnonKey === 'string' ? supabaseAnonKey.trim() : '';

  if (!trimmedOrgId || !trimmedUrl || !trimmedKey) {
    return null;
  }

  return { orgId: trimmedOrgId, supabaseUrl: trimmedUrl, supabaseAnonKey: trimmedKey };
}

function logOrgClientUpdate(action, config, options = {}) {
  const info = {
    action,
    orgId: config?.orgId || null,
    supabaseUrl: maskSupabaseCredential(config?.supabaseUrl),
    anonKey: maskSupabaseCredential(config?.supabaseAnonKey),
  };

  if (options.cached !== undefined) {
    info.cached = options.cached;
  }

  console.info('[OrgSupabase]', info);
}

function notifyOrgListeners(client, config) {
  listeners.forEach((listener) => {
    try {
      listener(client, config);
    } catch (error) {
      console.error('Org Supabase listener failed', error);
    }
  });
}

function updateActiveOrgState(nextClient, nextConfig) {
  const previousConfig = activeOrgConfig;
  const previousClient = activeOrgClient;

  if (!nextClient || !nextConfig) {
    if (!previousClient && !previousConfig) {
      return null;
    }

    activeOrgClient = null;
    activeOrgConfig = null;
    notifyOrgListeners(activeOrgClient, activeOrgConfig);
    return 'cleared';
  }

  const normalizedConfig = { ...nextConfig };
  const sameConfig =
    previousConfig &&
    previousConfig.orgId === normalizedConfig.orgId &&
    previousConfig.supabaseUrl === normalizedConfig.supabaseUrl &&
    previousConfig.supabaseAnonKey === normalizedConfig.supabaseAnonKey;
  const sameClient = previousClient === nextClient;

  activeOrgClient = nextClient;
  activeOrgConfig = normalizedConfig;
  notifyOrgListeners(activeOrgClient, activeOrgConfig);

  if (sameConfig && sameClient) {
    return null;
  }

  if (sameConfig) {
    return 'refreshed';
  }

  return 'activated';
}

export function getActiveOrgConfig() {
  return activeOrgConfig;
}

export function getOrgSupabase() {
  if (!activeOrgClient) {
    throw new MissingRuntimeConfigError('לא נבחר ארגון פעיל או שהחיבור שלו טרם הוגדר.');
  }
  return activeOrgClient;
}

const OrgSupabaseContext = createContext(undefined);

export function OrgSupabaseProvider({ config, children }) {
  const [state, setState] = useState({ client: activeOrgClient, config: activeOrgConfig });
  const authClient = useMemo(() => getAuthClient(), []);

  useEffect(() => {
    let cancelled = false;
    const normalized = normalizeOrgConfig(config);

    if (!normalized) {
      const previousConfig = activeOrgConfig;
      clearRuntimeOrg();
      resetRuntimeSupabase();
      const action = updateActiveOrgState(null, null);
      if (action) {
        logOrgClientUpdate(action, previousConfig || {});
      }
      setState((current) => {
        if (!current.client && !current.config) {
          return current;
        }
        return { client: null, config: null };
      });
      return;
    }

    const initialize = async () => {
      try {
        if (
          activeOrgConfig &&
          (activeOrgConfig.orgId !== normalized.orgId ||
            activeOrgConfig.supabaseUrl !== normalized.supabaseUrl ||
            activeOrgConfig.supabaseAnonKey !== normalized.supabaseAnonKey)
        ) {
          resetRuntimeSupabase(normalized.orgId);
        }

        activateRuntimeOrg(normalized);
        let client = getCachedRuntimeSupabase(normalized.orgId);
        let cached = Boolean(client);
        if (!client) {
          client = await getRuntimeSupabase();
          cached = false;
        }

        if (cancelled) {
          if (!cached) {
            resetRuntimeSupabase(normalized.orgId);
          }
          return;
        }

        const action = updateActiveOrgState(client, normalized);
        if (action) {
          logOrgClientUpdate(action, normalized, { cached });
        }

        setState({ client, config: normalized });
      } catch (error) {
        if (cancelled) {
          return;
        }
        console.error('Org Supabase initialization failed', error);
        clearRuntimeOrg();
        resetRuntimeSupabase(normalized.orgId);
        const action = updateActiveOrgState(null, null);
        if (action) {
          logOrgClientUpdate(action, normalized);
        }
        setState({ client: null, config: null });
      }
    };

    initialize();

    return () => {
      cancelled = true;
    };
  }, [config, config?.orgId, config?.supabaseUrl, config?.supabaseAnonKey]);

  const contextValue = useMemo(
    () => ({
      authClient,
      dataClient: state.client,
      client: state.client,
      config: state.config,
      currentOrg: state.config,
    }),
    [authClient, state],
  );

  return createElement(OrgSupabaseContext.Provider, { value: contextValue, children });
}

export function useOrgSupabase() {
  const context = useContext(OrgSupabaseContext);
  if (context === undefined) {
    throw new Error('OrgSupabaseProvider is missing from the React tree.');
  }
  const client = context.dataClient || context.client;
  if (!client) {
    throw new MissingRuntimeConfigError('לא נבחר ארגון פעיל או שהחיבור שלו טרם הוגדר.');
  }
  return client;
}

export function useOrgSupabaseConfig() {
  const context = useContext(OrgSupabaseContext);
  if (context === undefined) {
    throw new Error('OrgSupabaseProvider is missing from the React tree.');
  }
  return context.currentOrg || context.config;
}

export function useSupabase() {
  const context = useContext(OrgSupabaseContext);
  if (context === undefined) {
    throw new Error('OrgSupabaseProvider is missing from the React tree.');
  }
  return {
    authClient: context.authClient,
    dataClient: context.dataClient,
    currentOrg: context.currentOrg,
  };
}

export const supabase = new Proxy(
  {},
  {
    get(_target, prop) {
      if (!activeOrgClient) {
        throw new MissingRuntimeConfigError('לא נבחר ארגון פעיל או שהחיבור שלו טרם הוגדר.');
      }
      const value = activeOrgClient[prop];
      return typeof value === 'function' ? value.bind(activeOrgClient) : value;
    },
  },
);

export function subscribeOrgClientChange(listener) {
  listeners.add(listener);
  try {
    listener(activeOrgClient, activeOrgConfig);
  } catch (error) {
    console.error('Org Supabase listener failed during subscription', error);
  }
  return () => listeners.delete(listener);
}
