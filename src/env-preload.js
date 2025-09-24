const globalScope = typeof window !== 'undefined' ? window : undefined;

if (globalScope) {
  const env = import.meta.env || {};
  const {
    MODE,
    DEV,
    PROD,
    VITE_APP_SUPABASE_URL,
    VITE_APP_SUPABASE_ANON_KEY,
  } = env;

  const envMode = typeof MODE === 'string' && MODE ? MODE : DEV ? 'development' : PROD ? 'production' : undefined;

  globalScope.__APP_ENV__ = envMode;
  globalScope.__APP_SUPABASE_URL__ = VITE_APP_SUPABASE_URL;
  globalScope.__APP_SUPABASE_ANON_KEY__ = VITE_APP_SUPABASE_ANON_KEY;

  if (typeof globalScope.dispatchEvent === 'function') {
    globalScope.dispatchEvent(new CustomEvent('app:env-ready'));
  }
}
