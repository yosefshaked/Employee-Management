import { getSupabase } from './supabase-client.js';

export async function verifyConnection() {
  const supabase = await getSupabase();
  const { error } = await supabase.from('Employees').select('id').limit(1);
  if (error) {
    throw error;
  }
  return true;
}
