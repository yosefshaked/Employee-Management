import { differenceInCalendarDays, isAfter, isBefore } from 'date-fns';

export const DEFAULT_LEAVE_POLICY = {
  allow_half_day: false,
  allow_negative_balance: false,
  negative_floor_days: 0,
  carryover_enabled: false,
  carryover_max_days: 0,
  holiday_rules: [],
};

export const LEAVE_TYPE_OPTIONS = [
  { value: 'employee_paid', label: 'חופשה מהמכסה' },
  { value: 'system_paid', label: 'חג משולם (מערכת)' },
  { value: 'unpaid', label: 'לא משולם' },
  { value: 'mixed', label: 'מעורב' },
  { value: 'half_day', label: 'חצי יום' },
];

export const HOLIDAY_TYPE_LABELS = LEAVE_TYPE_OPTIONS.reduce((acc, option) => {
  acc[option.value] = option.label;
  return acc;
}, {});

export const LEAVE_ENTRY_TYPES = {
  system_paid: 'leave_system_paid',
  employee_paid: 'leave_employee_paid',
  unpaid: 'leave_unpaid',
  half_day: 'leave_half_day',
  mixed: 'leave_mixed',
};

const ENTRY_TYPE_TO_KIND = {
  paid_leave: 'system_paid',
  leave_system_paid: 'system_paid',
  leave_employee_paid: 'employee_paid',
  leave_unpaid: 'unpaid',
  leave_half_day: 'half_day',
  leave_mixed: 'mixed',
};

export function getLeaveKindFromEntryType(entryType) {
  return ENTRY_TYPE_TO_KIND[entryType] || null;
}

export function getEntryTypeForLeaveKind(kind) {
  return LEAVE_ENTRY_TYPES[kind] || null;
}

export function isLeaveEntryType(entryType) {
  return Boolean(getLeaveKindFromEntryType(entryType));
}

export function isPayableLeaveKind(kind) {
  return kind === 'system_paid' || kind === 'employee_paid' || kind === 'half_day';
}

export function getLeaveLedgerDelta(kind) {
  if (kind === 'employee_paid') return -1;
  if (kind === 'half_day') return -0.5;
  return 0;
}

export function getNegativeBalanceFloor(policy = {}) {
  const raw = Number(policy?.negative_floor_days ?? 0);
  if (Number.isNaN(raw)) return 0;
  return raw <= 0 ? raw : -Math.abs(raw);
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfYear(year) {
  return new Date(year, 0, 1);
}

function endOfYear(year) {
  return new Date(year, 11, 31);
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function resolveDelta(entry = {}) {
  if (typeof entry.days_delta === 'number') return entry.days_delta;
  if (typeof entry.delta_days === 'number') return entry.delta_days;
  if (typeof entry.delta === 'number') return entry.delta;
  if (typeof entry.amount === 'number') return entry.amount;
  if (typeof entry.days === 'number') return entry.days;
  return 0;
}

function resolveDate(entry = {}) {
  return entry.date || entry.entry_date || entry.effective_date || entry.change_date || entry.created_at;
}

export function normalizeHolidayRule(rule) {
  if (!rule) return null;
  const id = rule.id || crypto.randomUUID?.() || `rule-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const start = toDate(rule.start_date || rule.date || null);
  const end = toDate(rule.end_date || rule.date || null);
  const type = rule.type || 'employee_paid';
  return {
    id,
    name: rule.name || '',
    type,
    start_date: start ? start.toISOString().slice(0, 10) : null,
    end_date: end ? end.toISOString().slice(0, 10) : (start ? start.toISOString().slice(0, 10) : null),
    recurrence: rule.recurrence || null,
    half_day: rule.half_day || type === 'half_day',
    metadata: rule.metadata || null,
  };
}

export function normalizeLeavePolicy(value) {
  let policy = value;
  if (!policy) {
    policy = {};
  } else if (typeof policy === 'string') {
    try {
      policy = JSON.parse(policy);
    } catch (error) {
      console.warn('Failed to parse leave policy JSON', error);
      policy = {};
    }
  }
  return {
    allow_half_day: Boolean(policy.allow_half_day),
    allow_negative_balance: Boolean(policy.allow_negative_balance),
    negative_floor_days: Number(policy.negative_floor_days || 0),
    carryover_enabled: Boolean(policy.carryover_enabled),
    carryover_max_days: Number(policy.carryover_max_days || 0),
    holiday_rules: Array.isArray(policy.holiday_rules)
      ? policy.holiday_rules.map(normalizeHolidayRule)
      : [],
  };
}

function ruleMatchesDate(rule, date) {
  if (!rule || !date) return false;
  const target = toDate(date);
  if (!target) return false;
  if (rule.recurrence === 'yearly') {
    const ruleStart = toDate(`${target.getFullYear()}-${rule.start_date.slice(5)}`);
    const ruleEnd = toDate(`${target.getFullYear()}-${rule.end_date.slice(5)}`);
    if (!ruleStart || !ruleEnd) return false;
    return !isBefore(target, ruleStart) && !isAfter(target, ruleEnd);
  }
  const start = toDate(rule.start_date);
  const end = toDate(rule.end_date);
  if (!start || !end) return false;
  return !isBefore(target, start) && !isAfter(target, end);
}

export function findHolidayForDate(policy = DEFAULT_LEAVE_POLICY, date = new Date()) {
  const normalized = normalizeLeavePolicy(policy);
  const rules = normalized.holiday_rules || [];
  for (const rule of rules) {
    if (ruleMatchesDate(rule, date)) {
      return {
        ...rule,
        label: HOLIDAY_TYPE_LABELS[rule.type] || rule.name,
      };
    }
  }
  return null;
}

function computeBaseQuotaForYear(employee, year) {
  const annual = Number(employee?.annual_leave_days || 0);
  if (!annual) return 0;
  const startDate = toDate(employee?.start_date);
  const yearStart = startOfYear(year);
  const yearEnd = endOfYear(year);
  if (startDate && startDate > yearEnd) return 0;
  if (!startDate || startDate < yearStart || startDate.getFullYear() < year) return annual;
  if (startDate.getFullYear() > year) return 0;
  const totalDays = isLeapYear(year) ? 366 : 365;
  const effectiveStart = startDate > yearStart ? startDate : yearStart;
  const remainingDays = differenceInCalendarDays(yearEnd, effectiveStart) + 1;
  if (remainingDays <= 0) return 0;
  const prorated = (annual * remainingDays) / totalDays;
  return Math.max(0, prorated);
}

function sumUsage(entries = []) {
  return entries.reduce((acc, entry) => {
    const delta = resolveDelta(entry);
    return delta < 0 ? acc + Math.abs(delta) : acc;
  }, 0);
}

function sumPositive(entries = []) {
  return entries.reduce((acc, entry) => {
    const delta = resolveDelta(entry);
    return delta > 0 ? acc + delta : acc;
  }, 0);
}

function collectEntriesForYear(employeeId, year, leaveBalances = [], options = {}) {
  const { upToDate = null } = options;
  const yearStart = startOfYear(year);
  const yearEnd = endOfYear(year);
  return leaveBalances.filter(entry => {
    if (entry.employee_id !== employeeId) return false;
    const rawDate = resolveDate(entry);
    const entryDate = toDate(rawDate);
    if (!entryDate) return false;
    if (entryDate < yearStart || entryDate > yearEnd) return false;
    if (upToDate && entryDate > upToDate) return false;
    return true;
  });
}

export function computeEmployeeLeaveSummary({
  employee,
  leaveBalances = [],
  policy = DEFAULT_LEAVE_POLICY,
  date = new Date(),
}) {
  const targetDate = toDate(date) || new Date();
  const normalizedPolicy = normalizeLeavePolicy(policy);
  if (!employee) {
    return {
      remaining: 0,
      used: 0,
      quota: 0,
      carryIn: 0,
      allocations: 0,
      adjustments: 0,
      year: targetDate.getFullYear(),
    };
  }
  const employeeStart = toDate(employee.start_date);
  if (employeeStart && targetDate < employeeStart) {
    return {
      remaining: 0,
      used: 0,
      quota: 0,
      carryIn: 0,
      allocations: 0,
      adjustments: 0,
      year: targetDate.getFullYear(),
    };
  }
  const year = targetDate.getFullYear();
  const startYear = employeeStart ? employeeStart.getFullYear() : year;
  let carry = 0;
  let lastSummary = {
    remaining: 0,
    used: 0,
    quota: 0,
    carryIn: 0,
    allocations: 0,
    adjustments: 0,
    year,
  };
  for (let currentYear = startYear; currentYear <= year; currentYear += 1) {
    const entries = collectEntriesForYear(employee.id, currentYear, leaveBalances, {
      upToDate: currentYear === year ? targetDate : null,
    });
    const baseQuota = computeBaseQuotaForYear(employee, currentYear);
    const usage = sumUsage(entries);
    const positiveAdjustments = sumPositive(entries);
    const totalDelta = entries.reduce((acc, entry) => acc + resolveDelta(entry), 0);
    const quotaWithCarry = baseQuota + carry;
    const balance = quotaWithCarry + totalDelta;
    if (currentYear === year) {
      lastSummary = {
        remaining: Number(balance.toFixed(3)),
        used: Number(usage.toFixed(3)),
        quota: Number(quotaWithCarry.toFixed(3)),
        carryIn: Number(carry.toFixed(3)),
        allocations: Number((baseQuota + positiveAdjustments).toFixed(3)),
        adjustments: Number(totalDelta.toFixed(3)),
        year,
      };
    } else if (normalizedPolicy.carryover_enabled) {
      const nextCarry = Math.max(0, Math.min(balance, normalizedPolicy.carryover_max_days || 0));
      carry = nextCarry;
    } else {
      carry = 0;
    }
  }
  return lastSummary;
}

export function projectBalanceAfterChange({
  employee,
  leaveBalances = [],
  policy = DEFAULT_LEAVE_POLICY,
  date = new Date(),
  delta,
}) {
  const summary = computeEmployeeLeaveSummary({ employee, leaveBalances, policy, date });
  const updated = summary.remaining + delta;
  return {
    ...summary,
    projectedRemaining: Number(updated.toFixed(3)),
  };
}
