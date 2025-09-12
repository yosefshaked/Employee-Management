import { parseISO, startOfMonth, endOfMonth, getDaysInMonth, differenceInDays } from 'date-fns';

const GENERIC_RATE_SERVICE_ID = '00000000-0000-0000-0000-000000000000';

export function calculatePayrollSummary({
  employees = [],
  sessions = [],
  services = [],
  getRateForDate,
  scopedEmployeeIds = new Set(),
  rateHistories = []
}) {
  const allEmployees = employees.filter(e => scopedEmployeeIds.has(e.id));

  return allEmployees.map(employee => {
    const employeeSessions = sessions.filter(
      s => s.employee_id === employee.id && (!employee.start_date || s.date >= employee.start_date)
    );

    const sessionTotals = employeeSessions.reduce((acc, session) => {
      const sessionDate = parseISO(session.date);
      if (session.entry_type === 'adjustment') {
        acc.totalAdjustments += session.total_payment || 0;
      } else if (employee.employee_type === 'instructor') {
        const service = services.find(s => s.id === session.service_id);
        const rate = getRateForDate(employee.id, sessionDate, session.service_id).rate;
        let payment = 0;
        if (service && service.payment_model === 'per_student') {
          payment = (session.sessions_count || 0) * (session.students_count || 0) * rate;
        } else {
          payment = (session.sessions_count || 0) * rate;
        }
        acc.sessionPayment += payment;
        acc.totalSessions += session.sessions_count || 0;
      } else if (employee.employee_type === 'hourly') {
        const rate = getRateForDate(employee.id, sessionDate).rate;
        acc.sessionPayment += (session.hours || 0) * rate;
        acc.totalHours += session.hours || 0;
      } else if (employee.employee_type === 'global') {
        acc.totalHours += session.hours || 0;
      }
      return acc;
    }, { sessionPayment: 0, totalAdjustments: 0, totalHours: 0, totalSessions: 0 });

    let finalPayment = 0;
    let baseSalary = 0;
    const totalAdjustments = sessionTotals.totalAdjustments;

    if (employee.employee_type === 'global') {
      const workedMonths = [...new Set(
        employeeSessions.map(s => startOfMonth(parseISO(s.date)))
      )];

      workedMonths.forEach(monthDate => {
        const { rate: monthlyRate } = getRateForDate(employee.id, monthDate, GENERIC_RATE_SERVICE_ID, rateHistories);
        if (monthlyRate > 0) {
          const employeeStartDate = employee.start_date ? parseISO(employee.start_date) : null;
          const monthStart = startOfMonth(monthDate);
          const monthEnd = endOfMonth(monthDate);
          const effectiveStartDateInMonth = employeeStartDate && employeeStartDate > monthStart ? employeeStartDate : monthStart;
          const daysInMonth = getDaysInMonth(monthDate);
          const daysWorked = differenceInDays(monthEnd, effectiveStartDateInMonth) + 1;
          if (daysWorked > 0) {
            const dailyRate = monthlyRate / daysInMonth;
            baseSalary += dailyRate * daysWorked;
          }
        }
      });

      finalPayment = baseSalary + totalAdjustments;
    } else {
      finalPayment = sessionTotals.sessionPayment + totalAdjustments;
    }

    return {
      id: employee.id,
      name: employee.name,
      employeeType: employee.employee_type,
      baseSalary: employee.employee_type === 'global' ? baseSalary : null,
      totalAdjustments,
      totalPayment: finalPayment,
      totalHours: Math.round(sessionTotals.totalHours * 10) / 10,
      totalSessions: sessionTotals.totalSessions
    };
  });
}

export { GENERIC_RATE_SERVICE_ID };
