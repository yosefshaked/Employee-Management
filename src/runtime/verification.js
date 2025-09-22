import { fetchLeavePolicySettings } from '../lib/settings-client.js';

export async function verifyOrgConnection(client) {
  if (!client) {
    throw new Error('Supabase client is required for verification.');
  }
  const { value } = await fetchLeavePolicySettings(client);
  return { ok: true, settingsValue: value };
}

export const verifyConnection = verifyOrgConnection;
