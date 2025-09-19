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

function sanitizeConfig(raw, source = 'runtime') {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const supabaseUrl = raw.supabaseUrl || raw.supabase_url;
  const supabaseAnonKey = raw.supabaseAnonKey || raw.supabase_anon_key || raw.anon_key;
  if (!supabaseUrl || !supabaseAnonKey) {
    return undefined;
  }
  return {
    supabaseUrl: String(supabaseUrl).trim(),
    supabaseAnonKey: String(supabaseAnonKey).trim(),
    source,
  };
}

function loadFromWindow() {
  if (typeof window === 'undefined') {
    return undefined;
  }
  const current = window[GLOBAL_CONFIG_KEY];
  return sanitizeConfig(current, 'window');
}

async function loadFromRuntimeFile() {
  if (typeof window === 'undefined') {
    return undefined;
  }

  const candidates = ['/runtime-config.json', '/config/runtime-config.json'];

  for (const path of candidates) {
    try {
      const response = await fetch(path, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!response.ok) {
        continue;
      }
      const data = await response.json();
      const sanitized = sanitizeConfig(data, 'file');
      if (sanitized) {
        return sanitized;
      }
    } catch (error) {
      console.warn('Failed to load runtime config from', path, error);
    }
  }

  return undefined;
}

export async function loadRuntimeConfig() {
  const existing = getRuntimeConfig();
  if (existing) {
    return existing;
  }

  const fromWindow = loadFromWindow();
  if (fromWindow) {
    setRuntimeConfig(fromWindow);
    return fromWindow;
  }

  const fromFile = await loadFromRuntimeFile();
  if (fromFile) {
    setRuntimeConfig(fromFile);
    return fromFile;
  }

  throw new MissingRuntimeConfigError();
}
