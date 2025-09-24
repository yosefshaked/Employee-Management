import { activateConfig, loadRuntimeConfig } from './runtime/config.js';
import { renderConfigError } from './runtime/ConfigErrorScreen.jsx';

async function resolveBootstrapConfig() {
  const mode = import.meta.env.MODE;

  if (mode === 'development') {
    console.log('[Bootstrap] Running in DEVELOPMENT mode. Using local .env variables.');
    const supabaseUrl = import.meta?.env?.VITE_APP_SUPABASE_URL;
    const supabaseAnonKey = import.meta?.env?.VITE_APP_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error(
        'Missing VITE_APP_SUPABASE_URL or VITE_APP_SUPABASE_ANON_KEY in .env.local file for development.',
      );
    }

    return {
      config: {
        supabaseUrl,
        supabaseAnonKey,
        source: 'env',
        orgId: null,
      },
      activated: false,
    };
  }

  console.log('[Bootstrap] Running in PRODUCTION mode. Fetching config from API.');
  const config = await loadRuntimeConfig();
  return { config, activated: true };
}

async function bootstrap() {
  try {
    const { config, activated } = await resolveBootstrapConfig();

    if (!activated) {
      await activateConfig(config, { source: config?.source || 'env', orgId: config?.orgId ?? null });
    }

    const { renderApp } = await import('./main.jsx');
    renderApp(config);
  } catch (error) {
    renderConfigError(error);
  }
}

bootstrap();
