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
