export function copyFromPrevious(rows, index, field) {
  if (index === 0) return rows;
  const prev = rows[index - 1];
  const curr = rows[index];
  if (prev.employee_id !== curr.employee_id) return rows;
  const updated = [...rows];
  updated[index] = { ...curr, [field]: prev[field] };
  return updated;
}

export function fillDown(rows, field) {
  const first = rows[0]?.[field];
  if (first === undefined) return rows;
  return rows.map(r => ({ ...r, [field]: r[field] || first }));
}
