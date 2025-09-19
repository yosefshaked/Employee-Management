const GLOBAL_CONFIG_KEY = '__EMPLOYEE_MANAGEMENT_PUBLIC_CONFIG__';

export class MissingRuntimeConfigError extends Error {
  constructor(message = 'לא נמצאה תצורת Supabase לטעינת המערכת.') {
    super(message);
    this.name = 'MissingRuntimeConfigError';
  }
}

export function setRuntimeConfig(config) {
  if (typeof window !== 'undefined') {
    window[GLOBAL_CONFIG_KEY] = config;
  }
}

export function getRuntimeConfig() {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return window[GLOBAL_CONFIG_KEY];
}

function sanitizeConfig(raw) {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const supabaseUrl = raw.supabaseUrl && String(raw.supabaseUrl).trim();
  const supabaseAnonKey = raw.supabaseAnonKey && String(raw.supabaseAnonKey).trim();
  if (!supabaseUrl || !supabaseAnonKey) {
    return undefined;
  }
  return {
    supabaseUrl,
    supabaseAnonKey,
    source: raw.source || 'config',
  };
}

export async function loadRuntimeConfig() {
  const existing = getRuntimeConfig();
  if (existing) {
    return existing;
  }

  let config = loadFromEnv();

  if (!config) {
    config = await loadFromFunction();
  }

  if (!config) {
    throw new MissingRuntimeConfigError();
  }

  setRuntimeConfig(config);
  return config;
}

async function loadFromFunction() {
  try {
    const response = await fetch('/config', {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      return undefined;
    }

    const data = await response.json();
    return sanitizeConfig({
      ...data,
      source: 'config',
    });
  } catch {
    return undefined;
  }
}

function loadFromEnv() {
  const envUrl = import.meta.env.VITE_SUPABASE_URL;
  const envAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!envUrl || !envAnonKey) {
    return undefined;
  }

  return sanitizeConfig({
    supabaseUrl: envUrl,
    supabaseAnonKey: envAnonKey,
    source: 'env',
  });
}
