export function applyDayType(rows, dayType) {
  return rows.map(r => ({ ...r, dayType }));
}

export function removeSegment(rows, id) {
  if (rows.length <= 1) {
    return { rows, removed: false };
  }
  return { rows: rows.filter(r => r.id !== id), removed: true };
}

export function duplicateSegment(rows, id) {
  const idx = rows.findIndex(r => r.id === id);
  if (idx === -1) return rows;
  const copy = { ...rows[idx], id: crypto.randomUUID(), _status: 'new' };
  return [...rows.slice(0, idx + 1), copy, ...rows.slice(idx + 1)];
}

export function toggleDelete(rows, id) {
  const active = rows.filter(r => r._status !== 'deleted');
  const target = rows.find(r => r.id === id);
  if (!target) return { rows, changed: false };
  if (target._status === 'deleted') {
    return {
      rows: rows.map(r => r.id === id ? { ...r, _status: r.isNew ? 'new' : 'existing' } : r),
      changed: true
    };
  }
  if (active.length <= 1) {
    return { rows, changed: false };
  }
  return {
    rows: rows.map(r => r.id === id ? { ...r, _status: 'deleted' } : r),
    changed: true
  };
}

export function sumHours(rows) {
  return rows
    .filter(r => r._status !== 'deleted')
    .reduce((s, r) => s + (parseFloat(r.hours) || 0), 0);
}
