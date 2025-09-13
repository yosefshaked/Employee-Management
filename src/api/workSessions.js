export async function deleteWorkSessions(ids, client) {
  const supa = client || (await import('../supabaseClient.js')).supabase;
  const idsArray = Array.isArray(ids) ? ids : [ids];
  const { error } = await supa.from('WorkSessions').delete().in('id', idsArray);
  if (error) throw new Error(error.message);
}

export async function deleteWorkSession(id, client) {
  return deleteWorkSessions([id], client);
}
