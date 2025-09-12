export function copyFromPrevious(rows, index, field) {
  if (index === 0) return rows;
  const updated = [...rows];
  updated[index][field] = updated[index - 1][field];
  return updated;
}

export function fillDown(rows, field) {
  const first = rows[0]?.[field];
  if (first === undefined) return rows;
  return rows.map(r => ({ ...r, [field]: r[field] || first }));
}
