import { sumHourlyHours } from './lib/payroll.js';
import {
  DEFAULT_LEAVE_POLICY,
  findHolidayForDate,
  computeEmployeeLeaveSummary,
  normalizeLeavePolicy,
} from './lib/leave.js';

function entryMatchesFilters(row, emp, filters = {}) {
  const { dateFrom, dateTo, selectedEmployee, employeeType = 'all', serviceId = 'all' } = filters;
  if (dateFrom && new Date(row.date) < new Date(dateFrom)) return false;
  if (dateTo && new Date(row.date) > new Date(dateTo)) return false;
  if (selectedEmployee && row.employee_id !== selectedEmployee) return false;
  if (employeeType !== 'all' && emp.employee_type !== employeeType) return false;
  if (serviceId !== 'all' && row.service_id !== serviceId) return false;
  return true;
}

export function selectHourlyHours(entries = [], employees = [], filters = {}) {
  return sumHourlyHours(entries, employees, filters);
}

export function selectMeetingHours(entries = [], services = [], employees = [], filters = {}) {
  const byId = Object.fromEntries(employees.map(e => [e.id, e]));
  const serviceMap = Object.fromEntries(services.map(s => [s.id, s]));
  return entries.reduce((sum, row) => {
    const emp = byId[row.employee_id];
    if (!emp || emp.employee_type !== 'instructor') return sum;
    if (!entryMatchesFilters(row, emp, filters)) return sum;
    if (row.entry_type !== 'session') return sum;
    if (row.hours != null) return sum + (parseFloat(row.hours) || 0);
    const service = serviceMap[row.service_id];
    if (service && service.duration_minutes) {
      return sum + (service.duration_minutes / 60) * (row.sessions_count || 0);
    }
    switch (row.session_type) {
      case 'session_30':
        return sum + 0.5 * (row.sessions_count || 0);
      case 'session_45':
        return sum + 0.75 * (row.sessions_count || 0);
      case 'session_150':
        return sum + 2.5 * (row.sessions_count || 0);
      default:
        return sum;
    }
  }, 0);
}

export function selectGlobalHours(entries = [], employees = [], filters = {}) {
  const byId = Object.fromEntries(employees.map(e => [e.id, e]));
  return entries.reduce((sum, row) => {
    const emp = byId[row.employee_id];
    if (!emp || emp.employee_type !== 'global') return sum;
    if (!entryMatchesFilters(row, emp, filters)) return sum;
    if (row.entry_type !== 'hours') return sum;
    return sum + (parseFloat(row.hours) || 0);
  }, 0);
}

export function selectTotalHours(entries = [], services = [], employees = [], filters = {}) {
  return (
    selectHourlyHours(entries, employees, filters) +
    selectMeetingHours(entries, services, employees, filters) +
    selectGlobalHours(entries, employees, filters)
  );
}

export function selectHolidayForDate(policy = DEFAULT_LEAVE_POLICY, date = new Date()) {
  return findHolidayForDate(normalizeLeavePolicy(policy), date);
}

export function selectLeaveRemaining(
  employeeId,
  date = new Date(),
  {
    employees = [],
    leaveBalances = [],
    policy = DEFAULT_LEAVE_POLICY,
  } = {},
) {
  const employee = employees.find(emp => emp.id === employeeId);
  if (!employee) {
    return {
      remaining: 0,
      used: 0,
      quota: 0,
      carryIn: 0,
      allocations: 0,
      adjustments: 0,
      year: new Date(date).getFullYear(),
    };
  }
  return computeEmployeeLeaveSummary({
    employee,
    leaveBalances,
    policy,
    date,
  });
}

