function ensureIds(ids) {
  return Array.isArray(ids) ? ids : [ids];
}

export async function softDeleteWorkSessions(ids, client) {
  const supa = client || (await import('../supabaseClient.js')).supabase;
  const idsArray = ensureIds(ids);
  const { data, error } = await supa
    .from('WorkSessions')
    .update({ deleted: true, deleted_at: new Date().toISOString() })
    .in('id', idsArray)
    .select('*');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error('No rows deleted');
  }
  return data;
}

export async function softDeleteWorkSession(id, client) {
  const rows = await softDeleteWorkSessions([id], client);
  return rows[0] || null;
}

export async function restoreWorkSessions(ids, client) {
  const supa = client || (await import('../supabaseClient.js')).supabase;
  const idsArray = ensureIds(ids);
  const { data, error } = await supa
    .from('WorkSessions')
    .update({ deleted: false, deleted_at: null })
    .in('id', idsArray)
    .select('*');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error('No rows restored');
  }
  return data;
}

export async function restoreWorkSession(id, client) {
  const rows = await restoreWorkSessions([id], client);
  return rows[0] || null;
}

export async function permanentlyDeleteWorkSessions(ids, client) {
  const supa = client || (await import('../supabaseClient.js')).supabase;
  const idsArray = ensureIds(ids);
  const { data, error } = await supa
    .from('WorkSessions')
    .delete()
    .in('id', idsArray)
    .select('id');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error('No rows deleted');
  }
  return data;
}

export async function permanentlyDeleteWorkSession(id, client) {
  const rows = await permanentlyDeleteWorkSessions([id], client);
  return rows[0] || null;
}
