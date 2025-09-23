import { SupabaseHttpError } from './error-utils.js';

function ensureClient(client) {
  if (!client || typeof client.from !== 'function') {
    throw new Error('Supabase client is required to read Settings.');
  }
  return client;
}

export async function fetchSettingsValue(client, key) {
  const supabase = ensureClient(client);
  const sanitizedKey = typeof key === 'string' ? key.trim() : '';
  if (!sanitizedKey) {
    throw new Error('A settings key is required.');
  }

  const { data, error, status } = await supabase
    .from('Settings')
    .select('settings_value')
    .eq('key', sanitizedKey)
    .maybeSingle();

  if (status === 406) {
    throw new SupabaseHttpError(
      'בקשת Settings החזירה 406 (Not Acceptable). ודא שהכותרת Accept היא application/json ושהבחירה select נכונה.',
      { status },
    );
  }

  if (status === 401) {
    throw new SupabaseHttpError(
      'בקשת Settings החזירה 401 (Unauthorized). ודא שמפתח Supabase תקף ושלטבלת Settings קיימות הרשאות קריאה.',
      { status },
    );
  }

  if (error) {
    throw error;
  }

  const exists = Boolean(data && typeof data === 'object');
  const value = exists ? data.settings_value ?? null : null;

  return { exists, value };
}

export async function fetchLeavePolicySettings(client) {
  return fetchSettingsValue(client, 'leave_policy');
}

export async function fetchLeavePayPolicySettings(client) {
  return fetchSettingsValue(client, 'leave_pay_policy');
}
