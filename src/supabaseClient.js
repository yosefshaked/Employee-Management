import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { MissingRuntimeConfigError } from './runtime/config.js';
import {
  authClient as controlSupabase,
  getAuthClient,
  getAuthSupabaseAnonKey,
  getAuthSupabaseUrl,
  getSupabase as getRuntimeSupabase,
  getCachedSupabase as getCachedRuntimeSupabase,
  resetSupabase as resetRuntimeSupabase,
} from './lib/supabase-manager.js';
import { activateOrg as activateRuntimeOrg, clearOrg as clearRuntimeOrg } from './lib/org-runtime.js';

const IS_DEV = Boolean(import.meta?.env?.DEV);

if (IS_DEV) {
  console.debug('[supabaseClient] module evaluated');
}

export {
  getAuthSupabaseAnonKey as getCoreSupabaseAnonKey,
  getAuthSupabaseUrl as getCoreSupabaseUrl,
} from './lib/supabase-manager.js';

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

function configsEqual(a, b) {
  if (!a || !b) {
    return false;
  }
  return (
    a.orgId === b.orgId &&
    a.supabaseUrl === b.supabaseUrl &&
    a.supabaseAnonKey === b.supabaseAnonKey
  );
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
  const lastAppliedConfigRef = useRef(activeOrgConfig);

  useEffect(() => {
    let cancelled = false;
    let cachedClient = false;
    let resolvedClient = null;
    const normalized = normalizeOrgConfig(config);
    const previousApplied = lastAppliedConfigRef.current;

    if (!normalized) {
      lastAppliedConfigRef.current = null;
      if (previousApplied) {
        clearRuntimeOrg();
        resetRuntimeSupabase(previousApplied.orgId);
      } else {
        clearRuntimeOrg();
        resetRuntimeSupabase();
      }
      const action = updateActiveOrgState(null, null);
      if (action) {
        logOrgClientUpdate(action, previousApplied || {});
      }
      setState((current) => {
        if (!current.client && !current.config) {
          return current;
        }
        return { client: null, config: null };
      });
      return () => {
        cancelled = true;
      };
    }

    const hasConfigChanged = !configsEqual(previousApplied, normalized);

    const initialize = async () => {
      try {
        if (hasConfigChanged && previousApplied) {
          resetRuntimeSupabase(previousApplied.orgId);
        }

        activateRuntimeOrg(normalized);
        resolvedClient = getCachedRuntimeSupabase(normalized.orgId);
        cachedClient = Boolean(resolvedClient);
        if (!resolvedClient) {
          resolvedClient = await getRuntimeSupabase();
          cachedClient = false;
        }

        if (cancelled) {
          if (!cachedClient && resolvedClient) {
            resetRuntimeSupabase(normalized.orgId);
          }
          return;
        }

        lastAppliedConfigRef.current = normalized;

        const action = updateActiveOrgState(resolvedClient, normalized);
        if (action) {
          logOrgClientUpdate(action, normalized, { cached: cachedClient });
        }

        setState((current) => {
          if (current.client === resolvedClient && configsEqual(current.config, normalized)) {
            return current;
          }
          return { client: resolvedClient, config: normalized };
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        console.error('Org Supabase initialization failed', error);
        clearRuntimeOrg();
        resetRuntimeSupabase(normalized.orgId);
        lastAppliedConfigRef.current = null;
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
  }, [config]);

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
