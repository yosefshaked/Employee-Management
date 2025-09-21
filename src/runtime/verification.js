import { getSupabase } from '@/lib/supabase-client.js';

export async function verifyOrgConnection() {
  const supabase = await getSupabase();
  const { data, error, status } = await supabase
    .from('Settings')
    .select('settings_value')
    .eq('key', 'leave_policy')
    .limit(1);

  if (status === 406) {
    const friendlyError = new Error(
      'REST 406: Accept/header mismatch or PostgREST media-type. וודא Accept: application/json וניסוח select תקין',
    );
    friendlyError.status = status;
    throw friendlyError;
  }

  if (status === 401) {
    const friendlyError = new Error(
      '401: missing/invalid anon key. ודא anon ולא service, ושהוא מתאים לפרויקט',
    );
    friendlyError.status = status;
    throw friendlyError;
  }

  if (error) {
    throw error;
  }

  return { ok: true, data: Array.isArray(data) ? data : [] };
}

export const verifyConnection = verifyOrgConnection;
