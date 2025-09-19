import { createClient } from '@supabase/supabase-js';
import { getRuntimeConfig } from './runtime/config.js';

const runtimeConfig = getRuntimeConfig();
const resolvedSupabaseUrl = runtimeConfig?.supabaseUrl || import.meta.env.VITE_SUPABASE_URL;
const resolvedSupabaseKey = runtimeConfig?.supabaseAnonKey || import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!resolvedSupabaseUrl || !resolvedSupabaseKey) {
  throw new Error('Supabase configuration missing. ודא ש-/config זמין או שקובץ ה-.env מוגדר.');
}

export const coreSupabase = createClient(resolvedSupabaseUrl, resolvedSupabaseKey);
export const SUPABASE_URL = resolvedSupabaseUrl;
export const SUPABASE_ANON_KEY = resolvedSupabaseKey;

let activeOrgConfig = null;
let activeOrgClient = null;
const listeners = new Set();

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

export function setOrgSupabaseConfig(nextConfig) {
  const hasValidConfig = Boolean(nextConfig?.supabaseUrl && nextConfig?.supabaseAnonKey);

  if (!hasValidConfig) {
    activeOrgConfig = nextConfig ? { ...nextConfig } : null;
    activeOrgClient = null;
    listeners.forEach((listener) => listener(activeOrgClient, activeOrgConfig));
    return null;
  }

  const normalizedConfig = {
    supabaseUrl: nextConfig.supabaseUrl.trim(),
    supabaseAnonKey: nextConfig.supabaseAnonKey.trim(),
  };

  const unchanged =
    activeOrgConfig &&
    activeOrgConfig.supabaseUrl === normalizedConfig.supabaseUrl &&
    activeOrgConfig.supabaseAnonKey === normalizedConfig.supabaseAnonKey;

  if (unchanged && activeOrgClient) {
    return activeOrgClient;
  }

  activeOrgClient = createClient(normalizedConfig.supabaseUrl, normalizedConfig.supabaseAnonKey);
  activeOrgConfig = normalizedConfig;
  listeners.forEach((listener) => listener(activeOrgClient, activeOrgConfig));
  return activeOrgClient;
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
