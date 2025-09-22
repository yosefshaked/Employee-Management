import { authClient } from '@/lib/supabase-manager.js';

export async function createOrganization(orgName) {
  const trimmedName = typeof orgName === 'string' ? orgName.trim() : '';
  if (!trimmedName) {
    throw new Error('יש להזין שם ארגון.');
  }

  const { data, error } = await authClient.rpc('create_organization', { p_name: trimmedName });
  if (error) {
    throw error;
  }

  if (typeof data === 'string') {
    return data;
  }

  if (data && typeof data.id === 'string') {
    return data.id;
  }

  throw new Error('שרת Supabase לא החזיר מזהה ארגון לאחר היצירה.');
}
