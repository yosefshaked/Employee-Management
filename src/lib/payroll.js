import { startOfMonth, endOfMonth, eachDayOfInterval } from 'date-fns';

const DAY_NAMES = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

export function effectiveWorkingDays(employee, date) {
  const workingDays = employee?.working_days || ['SUN','MON','TUE','WED','THU'];
  const monthDate = new Date(date);
  const interval = { start: startOfMonth(monthDate), end: endOfMonth(monthDate) };
  let count = 0;
  for (const day of eachDayOfInterval(interval)) {
    if (workingDays.includes(DAY_NAMES[day.getDay()])) count++;
  }
  return count;
}

export function calculateGlobalDailyRate(employee, date, monthlyRate) {
  const days = effectiveWorkingDays(employee, date);
  if (!days) throw new Error('Employee has no defined working days in this month');
  return monthlyRate / days;
}

export function aggregateGlobalDays(rows, employeesById) {
  const map = new Map();
  rows.forEach((row, index) => {
    const emp = employeesById[row.employee_id];
    if (!emp || emp.employee_type !== 'global') return;
    if (row.entry_type !== 'hours' && row.entry_type !== 'paid_leave') return;
    const key = `${row.employee_id}|${row.date}`;
    const existing = map.get(key);
    if (!existing) {
      const amount = row.total_payment != null
        ? row.total_payment
        : (row.rate_used != null ? calculateGlobalDailyRate(emp, row.date, row.rate_used) : 0);
      map.set(key, {
        dayType: row.entry_type,
        indices: [index],
        rateUsed: row.rate_used,
        dailyAmount: amount
      });
    } else {
      existing.indices.push(index);
      if (existing.dayType && row.entry_type && existing.dayType !== row.entry_type) {
        existing.conflict = true;
      }
    }
  });
  return map;
}

export function aggregateGlobalDayForDate(rows, employeesById) {
  const byKey = new Map();
  let total = 0;
  rows.forEach(row => {
    const emp = employeesById[row.employee_id];
    if (!emp || emp.employee_type !== 'global') return;
    if (row.entry_type !== 'hours' && row.entry_type !== 'paid_leave') return;
    const key = `${row.employee_id}|${row.date}`;
    const amount = row.total_payment != null
      ? row.total_payment
      : (row.rate_used != null ? calculateGlobalDailyRate(emp, row.date, row.rate_used) : 0);
    if (!byKey.has(key)) {
      byKey.set(key, { firstRowId: row.id, dailyAmount: amount });
      total += amount;
    }
  });
  return { byKey, total };
}
