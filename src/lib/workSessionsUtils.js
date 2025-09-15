export function isSameWorkSession(a, b) {
  return (
    a.employee_id === b.employee_id &&
    a.date === b.date &&
    a.entry_type === b.entry_type &&
    (a.hours ?? null) === (b.hours ?? null)
  );
}

export function hasDuplicateSession(existing, candidate) {
  return existing.some(ws => isSameWorkSession(ws, candidate) && ws.id !== candidate.id);
}
