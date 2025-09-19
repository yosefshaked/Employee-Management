import { createContext, createElement, useContext, useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { getRuntimeConfig } from './runtime/config.js';

const runtimeConfig = getRuntimeConfig();

if (!runtimeConfig?.supabaseUrl || !runtimeConfig?.supabaseAnonKey) {
  throw new Error('Supabase configuration missing. ודא שקובץ runtime-config.json נטען לפני הפעלת המערכת.');
}

export const coreSupabase = createClient(runtimeConfig.supabaseUrl, runtimeConfig.supabaseAnonKey);
export const SUPABASE_URL = runtimeConfig.supabaseUrl;
export const SUPABASE_ANON_KEY = runtimeConfig.supabaseAnonKey;

let activeOrgConfig = null;
let activeOrgClient = null;
const listeners = new Set();

function normalizeOrgConfig(raw) {
  if (!raw) return null;
  const supabaseUrl = raw.supabaseUrl || raw.supabase_url;
  const supabaseAnonKey = raw.supabaseAnonKey || raw.supabase_anon_key || raw.anon_key;
  const trimmedUrl = typeof supabaseUrl === 'string' ? supabaseUrl.trim() : '';
  const trimmedKey = typeof supabaseAnonKey === 'string' ? supabaseAnonKey.trim() : '';
  if (!trimmedUrl || !trimmedKey) {
    return null;
  }
  return { supabaseUrl: trimmedUrl, supabaseAnonKey: trimmedKey };
}

function updateActiveOrgState(nextClient, nextConfig) {
  const normalizedConfig = nextConfig ? { ...nextConfig } : null;
  const sameConfig =
    (!activeOrgConfig && !normalizedConfig) ||
    (activeOrgConfig &&
      normalizedConfig &&
      activeOrgConfig.supabaseUrl === normalizedConfig.supabaseUrl &&
      activeOrgConfig.supabaseAnonKey === normalizedConfig.supabaseAnonKey);
  const sameClient = nextClient === activeOrgClient;

  if (sameClient && sameConfig) {
    return;
  }

  activeOrgClient = nextClient || null;
  activeOrgConfig = normalizedConfig;

  listeners.forEach(listener => {
    try {
      listener(activeOrgClient, activeOrgConfig);
    } catch (error) {
      console.error('Org Supabase listener failed', error);
    }
  });
}

export function getActiveOrgConfig() {
  return activeOrgConfig;
}

export function getOrgSupabase() {
  if (!activeOrgClient) {
    throw new Error('לא נבחרה עדיין סביבה ארגונית. בחר ארגון כדי להמשיך.');
  }
  return activeOrgClient;
}

export function subscribeOrgClientChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const OrgSupabaseContext = createContext(undefined);

export function OrgSupabaseProvider({ config, children }) {
  const [state, setState] = useState({ client: activeOrgClient, config: activeOrgConfig });

  useEffect(() => {
    const normalized = normalizeOrgConfig(config);

    if (!normalized) {
      setState(current => {
        if (!current.client && !current.config) {
          updateActiveOrgState(null, null);
          return current;
        }
        updateActiveOrgState(null, null);
        return { client: null, config: null };
      });
      return;
    }

    setState(current => {
      if (
        current.config &&
        current.config.supabaseUrl === normalized.supabaseUrl &&
        current.config.supabaseAnonKey === normalized.supabaseAnonKey
      ) {
        updateActiveOrgState(current.client, current.config);
        return current;
      }

      const nextClient = createClient(normalized.supabaseUrl, normalized.supabaseAnonKey);
      updateActiveOrgState(nextClient, normalized);
      return { client: nextClient, config: normalized };
    });
  }, [config, config?.supabaseUrl, config?.supabaseAnonKey]);

  const contextValue = useMemo(() => state, [state]);

  return createElement(OrgSupabaseContext.Provider, { value: contextValue, children });
}

export function useOrgSupabase() {
  const context = useContext(OrgSupabaseContext);
  if (context === undefined) {
    throw new Error('OrgSupabaseProvider is missing from the React tree.');
  }
  if (!context.client) {
    throw new Error('לא נבחר ארגון פעיל או שהחיבור שלו טרם הוגדר.');
  }
  return context.client;
}

export function useOrgSupabaseConfig() {
  const context = useContext(OrgSupabaseContext);
  if (context === undefined) {
    throw new Error('OrgSupabaseProvider is missing from the React tree.');
  }
  return context.config;
}

export const supabase = new Proxy(
  {},
  {
    get(_target, prop) {
      if (!activeOrgClient) {
        throw new Error('לא נבחר ארגון פעיל או שהחיבור שלו טרם הוגדר.');
      }
      const value = activeOrgClient[prop];
      return typeof value === 'function' ? value.bind(activeOrgClient) : value;
    },
  },
);
