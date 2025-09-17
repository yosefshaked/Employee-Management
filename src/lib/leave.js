import { differenceInCalendarDays, isAfter, isBefore } from 'date-fns';

export const DEFAULT_LEAVE_POLICY = {
  allow_half_day: false,
  allow_negative_balance: false,
  negative_floor_days: 0,
  carryover_enabled: false,
  carryover_max_days: 0,
  holiday_rules: [],
};

export const DEFAULT_LEAVE_PAY_POLICY = {
  default_method: 'legal',
  lookback_months: 3,
  legal_allow_12m_if_better: false,
  fixed_rate_default: null,
  legal_info_url: '',
};

export const LEAVE_PAY_METHOD_OPTIONS = [
  {
    value: 'legal',
    title: 'חישוב חוקי (מומלץ)',
    description: 'שווי יום חופש לפי ממוצע שכר יומי בתקופת בדיקה',
  },
  {
    value: 'avg_hourly_x_avg_day_hours',
    title: 'ממוצע שכר שעתי × שעות ליום',
    description: 'מכפיל את ממוצע השכר השעתי במספר שעות העבודה היומיות הממוצעות בתקופה',
  },
  {
    value: 'fixed_rate',
    title: 'תעריף יומי קבוע',
    description: 'שווי יום חופשה לפי סכום קבוע במדיניות',
  },
];

export const LEAVE_PAY_METHOD_LABELS = LEAVE_PAY_METHOD_OPTIONS.reduce((acc, option) => {
  acc[option.value] = option.title;
  return acc;
}, {});

export const LEAVE_PAY_METHOD_DESCRIPTIONS = LEAVE_PAY_METHOD_OPTIONS.reduce((acc, option) => {
  acc[option.value] = option.description;
  return acc;
}, {});

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

function parseLeaveMetadata(value) {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch (error) {
      console.warn('Failed to parse leave metadata JSON', error);
    }
  }
  return null;
}

function coerceFiniteNumber(value) {
  const num = typeof value === 'string' ? Number(value) : value;
  return typeof num === 'number' && Number.isFinite(num) ? num : null;
}

export function getLeaveValueMultiplier(details = {}) {
  const metadata = parseLeaveMetadata(details.metadata);
  const candidates = [
    details.leave_fraction,
    details.leaveFraction,
    details.fraction,
    metadata?.leave_fraction,
    metadata?.leaveFraction,
    metadata?.fraction,
  ];
  for (const candidate of candidates) {
    const num = coerceFiniteNumber(candidate);
    if (num !== null && num > 0) {
      return num;
    }
  }
  const kind = details.leave_kind ||
    details.leaveKind ||
    details.leave_type ||
    details.leaveType ||
    getLeaveKindFromEntryType(details.entry_type || details.entryType);
  if (kind === 'half_day') return 0.5;
  return 1;
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

function parseMaybeNumber(value) {
  if (typeof value === 'number') {
    return Number.isNaN(value) ? null : value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function resolveDelta(entry = {}) {
  const candidates = [
    entry.balance,
    entry.days_delta,
    entry.delta_days,
    entry.delta,
    entry.amount,
    entry.days,
  ];
  for (const candidate of candidates) {
    const parsed = parseMaybeNumber(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }
  return 0;
}

function resolveDate(entry = {}) {
  return entry.date || entry.entry_date || entry.effective_date || entry.change_date || entry.created_at;
}

function normalizeDateString(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    if (value.length >= 10) {
      return value.slice(0, 10);
    }
    const parsed = toDate(value);
    return parsed ? parsed.toISOString().slice(0, 10) : null;
  }
  const parsed = toDate(value);
  return parsed ? parsed.toISOString().slice(0, 10) : null;
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

function sanitizeLeavePayMethod(value) {
  if (typeof value !== 'string') return DEFAULT_LEAVE_PAY_POLICY.default_method;
  const match = LEAVE_PAY_METHOD_OPTIONS.find(option => option.value === value);
  return match ? match.value : DEFAULT_LEAVE_PAY_POLICY.default_method;
}

export function normalizeLeavePayPolicy(value) {
  let policy = value;
  if (!policy) {
    policy = {};
  } else if (typeof policy === 'string') {
    try {
      policy = JSON.parse(policy);
    } catch (error) {
      console.warn('Failed to parse leave pay policy JSON', error);
      policy = {};
    }
  }

  const lookbackCandidate = parseMaybeNumber(policy.lookback_months);
  const fixedRateCandidate = parseMaybeNumber(policy.fixed_rate_default);
  const legalInfoUrl = typeof policy.legal_info_url === 'string' ? policy.legal_info_url.trim() : '';

  return {
    default_method: sanitizeLeavePayMethod(policy.default_method),
    lookback_months:
      typeof lookbackCandidate === 'number' && lookbackCandidate > 0
        ? Math.round(lookbackCandidate)
        : DEFAULT_LEAVE_PAY_POLICY.lookback_months,
    legal_allow_12m_if_better: Boolean(policy.legal_allow_12m_if_better),
    fixed_rate_default:
      typeof fixedRateCandidate === 'number' && fixedRateCandidate >= 0
        ? fixedRateCandidate
        : DEFAULT_LEAVE_PAY_POLICY.fixed_rate_default,
    legal_info_url: legalInfoUrl,
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

export function getLeaveLedgerEntryDelta(entry = {}) {
  return resolveDelta(entry);
}

export function getLeaveLedgerEntryDate(entry = {}) {
  return normalizeDateString(resolveDate(entry));
}

export function getLeaveLedgerEntryType(entry = {}) {
  const raw = entry.leave_type || entry.source || entry.type || entry.reason || null;
  return typeof raw === 'string' ? raw : null;
}
