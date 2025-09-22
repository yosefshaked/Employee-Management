import { getSupabase } from '@/lib/supabase-client.js';
import { fetchLeavePolicySettings } from '@/lib/settings-client.js';

export async function verifyOrgConnection() {
  const supabase = await getSupabase();
  const { value } = await fetchLeavePolicySettings(supabase);
  return { ok: true, settingsValue: value };
}

export const verifyConnection = verifyOrgConnection;
