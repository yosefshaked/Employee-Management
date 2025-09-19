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
    listeners.forEach(listener => listener(activeOrgClient, activeOrgConfig));
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
  listeners.forEach(listener => listener(activeOrgClient, activeOrgConfig));
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
