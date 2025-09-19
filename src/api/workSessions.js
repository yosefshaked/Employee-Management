import {
  isLeaveEntryType,
  inferLeaveType,
  getLeaveLedgerDelta,
  TIME_ENTRY_LEAVE_PREFIX,
} from '../lib/leave.js';

function ensureIds(ids) {
  return Array.isArray(ids) ? ids : [ids];
}

function buildLedgerEntry(session) {
  if (!session || !isLeaveEntryType(session.entry_type)) return null;
  if (!session.employee_id || !session.date) return null;
  const leaveType = inferLeaveType(session);
  if (!leaveType) return null;
  const balance = getLeaveLedgerDelta(leaveType);
  if (!balance) return null;
  return {
    employee_id: session.employee_id,
    effective_date: session.date,
    leave_type: `${TIME_ENTRY_LEAVE_PREFIX}_${leaveType}`,
    balance,
    notes: session.notes || null,
  };
}

function collectLedgerEntries(sessions = []) {
  const map = new Map();
  sessions.forEach(session => {
    const entry = buildLedgerEntry(session);
    if (!entry) return;
    const key = `${entry.employee_id}|${entry.effective_date}|${entry.leave_type}|${entry.balance}`;
    if (!map.has(key)) {
      map.set(key, entry);
    }
  });
  return Array.from(map.values());
}

async function fetchExistingLedgerEntries(client, entries) {
  if (!entries.length) return [];
  const employeeIds = Array.from(new Set(entries.map(entry => entry.employee_id)));
  const dates = Array.from(new Set(entries.map(entry => entry.effective_date)));
  const { data, error } = await client
    .from('LeaveBalances')
    .select('id, employee_id, effective_date, leave_type, balance')
    .in('employee_id', employeeIds)
    .in('effective_date', dates)
    .like('leave_type', `${TIME_ENTRY_LEAVE_PREFIX}%`);
  if (error) throw new Error(error.message);
  return data || [];
}

async function removeLedgerEntriesForSessions(client, sessions) {
  const entries = collectLedgerEntries(sessions);
  if (!entries.length) return;
  const existing = await fetchExistingLedgerEntries(client, entries);
  if (!existing.length) return;
  const idsToDelete = [];
  const existingByKey = new Map(existing.map(item => {
    const key = `${item.employee_id}|${item.effective_date}|${item.leave_type}|${Number(item.balance)}`;
    return [key, item];
  }));
  entries.forEach(entry => {
    const key = `${entry.employee_id}|${entry.effective_date}|${entry.leave_type}|${Number(entry.balance)}`;
    const match = existingByKey.get(key);
    if (match && match.id) {
      idsToDelete.push(match.id);
    }
  });
  if (!idsToDelete.length) return;
  const uniqueIds = Array.from(new Set(idsToDelete));
  const { error } = await client.from('LeaveBalances').delete().in('id', uniqueIds);
  if (error) throw new Error(error.message);
}

async function ensureLedgerEntriesForSessions(client, sessions) {
  const entries = collectLedgerEntries(sessions);
  if (!entries.length) return;
  const existing = await fetchExistingLedgerEntries(client, entries);
  const existingKeys = new Set(existing.map(item => `${item.employee_id}|${item.effective_date}|${item.leave_type}|${Number(item.balance)}`));
  const toInsert = entries.filter(entry => {
    const key = `${entry.employee_id}|${entry.effective_date}|${entry.leave_type}|${Number(entry.balance)}`;
    return !existingKeys.has(key);
  });
  if (!toInsert.length) return;
  const { error } = await client.from('LeaveBalances').insert(toInsert);
  if (error) throw new Error(error.message);
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
  await removeLedgerEntriesForSessions(supa, data);
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
  await ensureLedgerEntriesForSessions(supa, data);
  return data;
}

export async function restoreWorkSession(id, client) {
  const rows = await restoreWorkSessions([id], client);
  return rows[0] || null;
}

export async function permanentlyDeleteWorkSessions(ids, client) {
  const supa = client || (await import('../supabaseClient.js')).supabase;
  const idsArray = ensureIds(ids);
  const { data: rowsToDelete, error: fetchError } = await supa
    .from('WorkSessions')
    .select('*')
    .in('id', idsArray);
  if (fetchError) throw new Error(fetchError.message);
  await removeLedgerEntriesForSessions(supa, rowsToDelete || []);
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
