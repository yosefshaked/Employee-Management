export const EMPLOYMENT_SCOPE_VALUE_STRINGS = [
  'משרה מלאה',
  'חצי משרה',
  '75% משרה',
  '25% משרה',
];

export const EMPLOYMENT_SCOPE_OPTIONS = EMPLOYMENT_SCOPE_VALUE_STRINGS.map((value) => ({
  value,
  label: value,
}));

export const EMPLOYMENT_SCOPE_DEFAULT_ENABLED_TYPES = ['global'];

const SUPPORTED_EMPLOYEE_TYPES = new Set(['global', 'hourly', 'instructor']);
const EMPLOYMENT_SCOPE_VALUES = new Set(EMPLOYMENT_SCOPE_VALUE_STRINGS);

export function normalizeEmploymentScopeEnabledTypes(source) {
  const rawList = Array.isArray(source) ? source : [];
  const normalized = rawList
    .map((item) => (typeof item === 'string' ? item.trim().toLowerCase() : ''))
    .filter((item) => SUPPORTED_EMPLOYEE_TYPES.has(item));
  const unique = new Set([...normalized, ...EMPLOYMENT_SCOPE_DEFAULT_ENABLED_TYPES]);
  return Array.from(unique);
}

export function normalizeEmploymentScopePolicy(value) {
  const enabledTypes = normalizeEmploymentScopeEnabledTypes(value?.enabled_types);
  return { enabledTypes };
}

export function sanitizeEmploymentScopeFilter(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  const unique = new Set();
  values.forEach((value) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (trimmed && EMPLOYMENT_SCOPE_VALUES.has(trimmed)) {
      unique.add(trimmed);
    }
  });
  return Array.from(unique);
}
