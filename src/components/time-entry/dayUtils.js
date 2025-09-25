export function applyDayType(rows, dayType) {
  return rows.map(r => ({ ...r, dayType }));
}

const segmentKey = (row) => row?.id ?? row?._localId ?? null;

export function removeSegment(rows, key) {
  if (rows.length <= 1) {
    return { rows, removed: false };
  }
  return { rows: rows.filter(r => segmentKey(r) !== key), removed: true };
}

export function duplicateSegment(rows, key) {
  const idx = rows.findIndex(r => segmentKey(r) === key);
  if (idx === -1) return rows;
  const { id: _omitId, _localId: _omitLocal, _status: _omitStatus, ...rest } = rows[idx];
  const copy = {
    ...rest,
    _localId: crypto.randomUUID(),
    _status: 'new',
  };
  return [...rows.slice(0, idx + 1), copy, ...rows.slice(idx + 1)];
}

export function toggleDelete(rows, key) {
  const active = rows.filter(r => r._status !== 'deleted');
  const target = rows.find(r => segmentKey(r) === key);
  if (!target) return { rows, changed: false };
  if (target._status === 'deleted') {
    return {
      rows: rows.map(r => (segmentKey(r) === key
        ? { ...r, _status: r.id ? 'existing' : 'new' }
        : r
      )),
      changed: true
    };
  }
  if (active.length <= 1) {
    return { rows, changed: false };
  }
  return {
    rows: rows.map(r => (segmentKey(r) === key ? { ...r, _status: 'deleted' } : r)),
    changed: true
  };
}

export function sumHours(rows) {
  return rows
    .filter(r => r._status !== 'deleted')
    .reduce((s, r) => s + (parseFloat(r.hours) || 0), 0);
}
