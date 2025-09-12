import { format, startOfMonth, endOfMonth, eachMonthOfInterval, differenceInCalendarDays } from 'date-fns';

const GENERIC_RATE_SERVICE_ID = '00000000-0000-0000-0000-000000000000';

export function getProratedBaseSalary(employee, dateFrom, dateTo, rateHistories) {
  const rangeStart = startOfMonth(dateFrom);
  const rangeEnd = endOfMonth(dateTo);
  const months = eachMonthOfInterval({ start: rangeStart, end: rangeEnd });
  let total = 0;
  for (const month of months) {
    const monthStart = startOfMonth(month);
    const monthEnd = endOfMonth(month);
    const dateStr = format(monthStart, 'yyyy-MM-dd');
    const relevantRates = rateHistories
      .filter(r => r.employee_id === employee.id && r.service_id === GENERIC_RATE_SERVICE_ID && r.effective_date <= dateStr)
      .sort((a, b) => new Date(b.effective_date) - new Date(a.effective_date));
    if (relevantRates.length === 0) continue;
    const baseSalary = relevantRates[0].rate;
    if (employee.start_date) {
      const startDate = new Date(employee.start_date);
      if (startDate > monthEnd) continue;
      if (startDate > monthStart) {
        const daysInMonth = differenceInCalendarDays(monthEnd, monthStart) + 1;
        const daysWorked = differenceInCalendarDays(monthEnd, startDate) + 1;
        total += (baseSalary / daysInMonth) * daysWorked;
        continue;
      }
    }
    total += baseSalary;
  }
  return total;
}

