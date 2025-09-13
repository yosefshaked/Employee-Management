export function copyFromPrevious(rows, index, field) {
  if (index === 0) return { rows, success: false };
  const prev = rows[index - 1];
  const curr = rows[index];
  if (prev.employee_id !== curr.employee_id) return { rows, success: false };
  if (prev[field] === undefined || prev[field] === '' || prev[field] === null) {
    return { rows, success: false };
  }
  const updated = [...rows];
  updated[index] = { ...curr, [field]: prev[field] };
  return { rows: updated, success: true };
}

export function fillDown(rows, field) {
  const first = rows[0]?.[field];
  if (first === undefined) return rows;
  return rows.map(r => ({ ...r, [field]: r[field] || first }));
}

export function formatDatesCount(n) {
  if (n === 1) return 'תאריך להזנה';
  if (n > 1) return `${n} תאריכים להזנה`;
  return 'אין תאריכים';
}

export function isRowCompleteForProgress(row, employee) {
  if (employee.employee_type === 'instructor') {
    return Boolean(row.service_id) && parseInt(row.sessions_count, 10) >= 1 && parseInt(row.students_count, 10) >= 1;
  }
  if (employee.employee_type === 'hourly') {
    return parseFloat(row.hours) > 0;
  }
  if (employee.employee_type === 'global') {
    return row.entry_type === 'hours' || row.entry_type === 'paid_leave';
  }
  return false;
}
