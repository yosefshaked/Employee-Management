import { createClient } from '@supabase/supabase-js';
import {
  getConfigOrThrow,
  waitConfigReady,
  onConfigActivated,
  onConfigCleared,
} from './config.js';

let cachedClient = null;
let pendingClient = null;

async function createSupabaseClient() {
  await waitConfigReady();
  const { supabaseUrl, supabaseAnonKey } = getConfigOrThrow();
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
    },
  });
}

function resetClient() {
  cachedClient = null;
  pendingClient = null;
}

export async function getSupabase() {
  if (cachedClient) {
    return cachedClient;
  }

  if (!pendingClient) {
    pendingClient = createSupabaseClient()
      .then((client) => {
        cachedClient = client;
        return client;
      })
      .finally(() => {
        pendingClient = null;
      });
  }

  return pendingClient;
}

export function getCachedSupabase() {
  return cachedClient;
}

export function resetSupabase() {
  resetClient();
}

onConfigCleared(resetClient);
onConfigActivated(resetClient);
