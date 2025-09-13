export async function deleteWorkSessions(ids, client) {
  const supa = client || (await import('../supabaseClient.js')).supabase;
  const idsArray = Array.isArray(ids) ? ids : [ids];
  const { data, error } = await supa
    .from('WorkSessions')
    .delete()
    .in('id', idsArray)
    .select('id');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error('No rows deleted');
  }
}

export async function deleteWorkSession(id, client) {
  return deleteWorkSessions([id], client);
}
