// src/lib/supabase-manager.js
import { createClient } from '@supabase/supabase-js';

// --- Main Authentication Client (Singleton) ---
// This is created only ONCE when the application loads.

const supabaseUrl = import.meta.env.VITE_APP_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_APP_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Critical Error: Main Supabase credentials are not defined in environment variables.");
}

export const authClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storageKey: 'app-main-auth-session', // Unique, static key for isolation
    persistSession: true,
    autoRefreshToken: true,
  }
});

// --- Data Client Factory ---
// This function will create isolated data clients on demand.

export function createDataClient(orgConfig) {
  const { supabase_url: orgUrl, supabase_anon_key: orgAnonKey, id: orgId } = orgConfig;

  if (!orgUrl || !orgAnonKey) {
    console.error("[DataClient] Cannot create data client without URL and Key for org:", orgId);
    return null;
  }

  console.log(`[DataClient] Creating new data client for org: ${orgId}`);

  return createClient(orgUrl, orgAnonKey, {
    // Absolute isolation settings
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    }
  });
}
