export function getDayType(row) {
  if (Object.prototype.hasOwnProperty.call(row, 'dayType')) {
    return row.dayType || undefined;
  }
  if (row.entry_type === 'paid_leave') return 'paid_leave';
  if (row.entry_type === 'hours') return 'regular';
  return undefined;
}

export function setDayType(rows, index, dt) {
  const updated = [...rows];
  const curr = { ...updated[index] };
  if (Object.prototype.hasOwnProperty.call(curr, 'dayType')) {
    curr.dayType = dt;
  } else {
    curr.entry_type = dt === 'paid_leave' ? 'paid_leave' : 'hours';
  }
  updated[index] = curr;
  return updated;
}

export function copyFromPrevious(rows, index, field) {
  const curr = rows[index];
  let prevIndex = index - 1;
  while (prevIndex >= 0 && rows[prevIndex].employee_id !== curr.employee_id) {
    prevIndex -= 1;
  }
  if (prevIndex < 0) return { rows, success: false };
  const prev = rows[prevIndex];
  if (field === 'dayType') {
    const prevDt = getDayType(prev);
    if (!prevDt) return { rows, success: false };
    return { rows: setDayType(rows, index, prevDt), success: true };
  }
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
    const dt = getDayType(row);
    return dt === 'regular' || dt === 'paid_leave';
  }
  return false;
}
