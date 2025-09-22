import { createClient } from '@supabase/supabase-js';
import { getOrgOrThrow, waitOrgReady } from './org-runtime.js';

const clients = new Map();
const pendingClients = new Map();

function buildSupabaseClient({ orgId, supabaseUrl, supabaseAnonKey }) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      storageKey: `org-data-token-${orgId}`,
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { Accept: 'application/json' },
    },
  });
}

function resolveCurrentOrgId() {
  try {
    const { orgId } = getOrgOrThrow();
    return orgId || null;
  } catch {
    return null;
  }
}

export async function getSupabase() {
  await waitOrgReady();
  const config = getOrgOrThrow();
  const orgId = config.orgId;

  if (clients.has(orgId)) {
    return clients.get(orgId);
  }

  if (!pendingClients.has(orgId)) {
    const creation = Promise.resolve()
      .then(() => buildSupabaseClient(config))
      .then((client) => {
        clients.set(orgId, client);
        pendingClients.delete(orgId);
        return client;
      })
      .catch((error) => {
        pendingClients.delete(orgId);
        throw error;
      });

    pendingClients.set(orgId, creation);
  }

  return pendingClients.get(orgId);
}

export function getCachedSupabase(orgId) {
  const targetOrgId = orgId || resolveCurrentOrgId();
  if (!targetOrgId) {
    return null;
  }
  return clients.get(targetOrgId) || null;
}

export function resetSupabase(orgId) {
  const targetOrgId = orgId || resolveCurrentOrgId();

  if (targetOrgId) {
    clients.delete(targetOrgId);
    pendingClients.delete(targetOrgId);
    return;
  }

  clients.clear();
  pendingClients.clear();
}
