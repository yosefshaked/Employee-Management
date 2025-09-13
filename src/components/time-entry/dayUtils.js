export function applyDayType(rows, dayType) {
  return rows.map(r => ({ ...r, entry_type: dayType }));
}

export function removeSegment(rows, id) {
  if (rows.length <= 1) {
    return { rows, removed: false };
  }
  return { rows: rows.filter(r => r.id !== id), removed: true };
}
