import { startOfMonth, endOfMonth, eachDayOfInterval } from 'date-fns';
import { isLeaveEntryType } from './leave.js';

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
    if (row.entry_type !== 'hours' && !isLeaveEntryType(row.entry_type)) return;
    if (isLeaveEntryType(row.entry_type) && row.payable === false) return;
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
        dailyAmount: amount,
        payable: row.payable !== false,
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
    if (row.entry_type !== 'hours' && !isLeaveEntryType(row.entry_type)) return;
    if (isLeaveEntryType(row.entry_type) && row.payable === false) return;
    const key = `${row.employee_id}|${row.date}`;
    const amount = row.total_payment != null
      ? row.total_payment
      : (row.rate_used != null ? calculateGlobalDailyRate(emp, row.date, row.rate_used) : 0);
    if (!byKey.has(key)) {
      byKey.set(key, { firstRowId: row.id, dailyAmount: amount, payable: row.payable !== false, dayType: row.entry_type });
      total += amount;
    }
  });
  return { byKey, total };
}

export function clampDateString(dateStr) {
  const d = new Date(dateStr);
  if (!isNaN(d) && dateStr === d.toISOString().slice(0, 10)) return dateStr;
  const [y, m] = dateStr.split('-').map(Number);
  const last = new Date(y, m, 0);
  return `${y}-${String(m).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
}

export function createLeaveDayValueResolver({
  employees = [],
  workSessions = [],
  services = [],
  leavePayPolicy = null,
  settings = null,
  leaveDayValueSelector = null,
} = {}) {
  const selector = typeof leaveDayValueSelector === 'function' ? leaveDayValueSelector : null;
  const cache = new Map();
  return (employeeId, date) => {
    if (!employeeId || !date) return 0;
    if (!selector) return 0;
    const key = `${employeeId}|${date}`;
    if (cache.has(key)) return cache.get(key);
    const value = selector(employeeId, date, {
      employees,
      workSessions,
      services,
      leavePayPolicy,
      settings,
    });
    const safe = typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
    cache.set(key, safe);
    return safe;
  };
}

export function computePeriodTotals({
  workSessions = [],
  employees = [],
  services = [],
  startDate,
  endDate,
  serviceFilter = 'all',
  employeeFilter = '',
  employeeTypeFilter = 'all',
  leavePayPolicy = null,
  settings = null,
  leaveDayValueSelector = null,
}) {
  const employeesById = Object.fromEntries(employees.map(e => [e.id, e]));
  const start = new Date(startDate);
  const end = new Date(endDate);
  const filtered = workSessions.filter(row => {
    const d = new Date(row.date);
    if (d < start || d > end) return false;
    const emp = employeesById[row.employee_id];
    if (!emp) return false;
    if (employeeFilter && row.employee_id !== employeeFilter) return false;
    if (employeeTypeFilter !== 'all' && emp.employee_type !== employeeTypeFilter) return false;
    if (serviceFilter !== 'all' && row.service_id !== serviceFilter) return false;
    if (emp.start_date && row.date < emp.start_date) return false;
    return true;
  });

  const result = {
    totalPay: 0,
    totalHours: 0,
    totalSessions: 0,
    totalsByEmployee: [],
    diagnostics: { uniquePaidDays: 0, paidLeaveDays: 0, adjustmentsSum: 0 },
    filteredSessions: filtered
  };

  const perEmp = {};
  const processedLeave = new Set();
  const resolveLeaveValue = createLeaveDayValueResolver({
    employees,
    workSessions,
    services,
    leavePayPolicy,
    settings,
    leaveDayValueSelector,
  });

  const globalAgg = aggregateGlobalDays(filtered, employeesById);
  globalAgg.forEach((val, key) => {
    const [empId] = key.split('|');
    result.totalPay += val.dailyAmount;
    result.diagnostics.uniquePaidDays++;
    if (isLeaveEntryType(val.dayType) && val.payable) result.diagnostics.paidLeaveDays++;
    if (!perEmp[empId]) perEmp[empId] = { employee_id: empId, pay: 0, hours: 0, sessions: 0, daysPaid: 0, adjustments: 0 };
    perEmp[empId].pay += val.dailyAmount;
    perEmp[empId].daysPaid++;
  });

  filtered.forEach(row => {
    const emp = employeesById[row.employee_id];
    if (!emp) return;
    if (!perEmp[row.employee_id]) {
      perEmp[row.employee_id] = { employee_id: row.employee_id, pay: 0, hours: 0, sessions: 0, daysPaid: 0, adjustments: 0 };
    }
    const bucket = perEmp[row.employee_id];
    if (emp.employee_type === 'global') {
      if (row.entry_type === 'hours') {
        const hours = row.hours || 0;
        result.totalHours += hours;
        bucket.hours += hours;
      }
      return;
    }
    if (isLeaveEntryType(row.entry_type)) {
      if (row.payable === false) return;
      const key = `${row.employee_id}|${row.date}`;
      if (processedLeave.has(key)) return;
      processedLeave.add(key);
      let pay = resolveLeaveValue(row.employee_id, row.date);
      if (!pay && row.total_payment != null && typeof leaveDayValueSelector !== 'function') {
        const fallback = Number(row.total_payment);
        pay = Number.isFinite(fallback) ? fallback : 0;
      }
      if (pay) {
        result.totalPay += pay;
        bucket.pay += pay;
      }
      bucket.daysPaid += 1;
      result.diagnostics.paidLeaveDays += 1;
      return;
    }
    if (row.entry_type === 'adjustment') {
      const pay = row.total_payment || 0;
      result.totalPay += pay;
      result.diagnostics.adjustmentsSum += pay;
      bucket.pay += pay;
      bucket.adjustments += pay;
      return;
    }
    if (row.entry_type === 'session') {
      const pay = row.total_payment || 0;
      result.totalPay += pay;
      result.totalSessions += row.sessions_count || 0;
      bucket.pay += pay;
      bucket.sessions += row.sessions_count || 0;
    } else if (row.entry_type === 'hours') {
      const pay = row.total_payment || 0;
      const hours = row.hours || 0;
      result.totalPay += pay;
      result.totalHours += hours;
      bucket.pay += pay;
      bucket.hours += hours;
    }
  });

  result.totalsByEmployee = Object.values(perEmp);
  return result;
}

function entryMatchesFilters(row, emp, filters = {}) {
  const { dateFrom, dateTo, selectedEmployee, employeeType = 'all', serviceId = 'all' } = filters;
  if (dateFrom && new Date(row.date) < new Date(dateFrom)) return false;
  if (dateTo && new Date(row.date) > new Date(dateTo)) return false;
  if (selectedEmployee && row.employee_id !== selectedEmployee) return false;
  if (employeeType !== 'all' && emp.employee_type !== employeeType) return false;
  if (serviceId !== 'all' && row.service_id !== serviceId) return false;
  return true;
}

export function sumHourlyHours(entries = [], employees = [], filters = {}) {
  const byId = Object.fromEntries(employees.map(e => [e.id, e]));
  return entries.reduce((sum, row) => {
    const emp = byId[row.employee_id];
    if (!emp || emp.employee_type !== 'hourly') return sum;
    if (!entryMatchesFilters(row, emp, filters)) return sum;
    if (row.entry_type !== 'hours') return sum;
    return sum + (parseFloat(row.hours) || 0);
  }, 0);
}

export function countGlobalEffectiveDays(entries = [], employees = [], filters = {}, opts = {}) {
  const { excludePaidLeave = true } = opts;
  const byId = Object.fromEntries(employees.map(e => [e.id, e]));
  const days = new Set();
  entries.forEach(row => {
    const emp = byId[row.employee_id];
    if (!emp || emp.employee_type !== 'global') return;
    if (!entryMatchesFilters(row, emp, filters)) return;
    if (row.entry_type !== 'hours' && !isLeaveEntryType(row.entry_type)) return;
    if (excludePaidLeave && isLeaveEntryType(row.entry_type)) return;
    days.add(`${row.employee_id}|${row.date}`);
  });
  return days.size;
}

export function sumInstructorSessions(entries = [], services = [], employees = [], filters = {}) {
  const serviceSet = new Set(services.map(s => s.id));
  
  const byId = Object.fromEntries(employees.map(e => [e.id, e]));
  return entries.reduce((sum, row) => {
    const emp = byId[row.employee_id];
    if (!emp || emp.employee_type !== 'instructor') return sum;
    if (!serviceSet.has(row.service_id)) return sum;
    if (!entryMatchesFilters(row, emp, filters)) return sum;
    if (row.entry_type !== 'session') return sum;
    return sum + (row.sessions_count || 0);
  }, 0);
}
