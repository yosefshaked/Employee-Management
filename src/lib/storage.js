const GIGABYTE = 1024 ** 3;

export const STORAGE_SETTINGS_KEY = 'storage_quota';

const DEFAULT_STORAGE_PRESETS = [
  { plan: 'Free', quota_gb: 2, db_quota_gb: 0.5 },
  { plan: 'Pro', quota_gb: 100, db_quota_gb: 8 },
];

export const DEFAULT_STORAGE_SETTINGS = {
  plan: 'Free',
  quota_gb: DEFAULT_STORAGE_PRESETS[0].quota_gb,
  db_quota_gb: DEFAULT_STORAGE_PRESETS[0].db_quota_gb,
  show_db_and_storage: false,
  note: '',
  presets: DEFAULT_STORAGE_PRESETS,
};

const REQUIRED_PRESET_NAMES = new Set(DEFAULT_STORAGE_PRESETS.map(preset => preset.plan));

const toFiniteNumber = (value, fallback = 0) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const isPlainObject = (value) => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const normalizePreset = (preset) => {
  if (!isPlainObject(preset)) return null;
  const plan = typeof preset.plan === 'string' && preset.plan.trim() ? preset.plan.trim() : null;
  if (!plan) return null;
  return {
    plan,
    quota_gb: toFiniteNumber(preset.quota_gb, DEFAULT_STORAGE_PRESETS[0].quota_gb),
    db_quota_gb: toFiniteNumber(
      preset.db_quota_gb ?? preset.database_quota_gb,
      toFiniteNumber(preset.quota_gb, DEFAULT_STORAGE_PRESETS[0].db_quota_gb),
    ),
  };
};

const ensurePresetPresence = (presets = []) => {
  const mapped = new Map();
  presets.forEach((preset) => {
    const normalized = normalizePreset(preset);
    if (normalized) mapped.set(normalized.plan, normalized);
  });
  DEFAULT_STORAGE_PRESETS.forEach((preset) => {
    if (!mapped.has(preset.plan)) {
      mapped.set(preset.plan, { ...preset });
    }
  });
  return Array.from(mapped.values());
};

export const normalizeStorageQuotaSettings = (rawSettings) => {
  if (!isPlainObject(rawSettings)) {
    return { ...DEFAULT_STORAGE_SETTINGS };
  }

  const presets = ensurePresetPresence(rawSettings.presets);
  const plan = typeof rawSettings.plan === 'string' && rawSettings.plan.trim()
    ? rawSettings.plan.trim()
    : DEFAULT_STORAGE_SETTINGS.plan;

  const customStorageQuota = toFiniteNumber(
    rawSettings.quota_gb ?? rawSettings.custom_quota_gb,
    DEFAULT_STORAGE_SETTINGS.quota_gb,
  );

  const customDbQuota = toFiniteNumber(
    rawSettings.db_quota_gb ?? rawSettings.custom_db_quota_gb,
    customStorageQuota,
  );

  const showDb = Boolean(rawSettings.show_db_and_storage);
  const note = typeof rawSettings.note === 'string' ? rawSettings.note : '';

  return {
    plan,
    quota_gb: customStorageQuota,
    db_quota_gb: customDbQuota,
    show_db_and_storage: showDb,
    note,
    presets,
  };
};

export const findPresetForPlan = (settings, planName) => {
  const source = settings?.presets;
  if (!Array.isArray(source)) return null;
  return source.find(preset => preset.plan === planName) || null;
};

export const resolvePlanQuotas = (settings = DEFAULT_STORAGE_SETTINGS) => {
  const planName = settings?.plan || DEFAULT_STORAGE_SETTINGS.plan;
  const preset = findPresetForPlan(settings, planName);
  const planIsCustom = planName === 'Custom' || !REQUIRED_PRESET_NAMES.has(planName);

  const storageQuotaGb = planIsCustom
    ? toFiniteNumber(settings?.quota_gb, DEFAULT_STORAGE_SETTINGS.quota_gb)
    : toFiniteNumber(preset?.quota_gb, DEFAULT_STORAGE_SETTINGS.quota_gb);

  const dbQuotaGb = planIsCustom
    ? toFiniteNumber(settings?.db_quota_gb, storageQuotaGb)
    : toFiniteNumber(preset?.db_quota_gb ?? preset?.quota_gb, storageQuotaGb);

  return {
    plan: planName,
    storageQuotaGb,
    dbQuotaGb,
    isCustom: planIsCustom,
  };
};

export const bytesToGigabytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes < 0) return 0;
  return bytes / GIGABYTE;
};

export const formatGigabytes = (value, { precision = 2 } = {}) => {
  const gb = Number.isFinite(value) ? value : bytesToGigabytes(value);
  if (!Number.isFinite(gb)) return '0 GB';
  const decimals = gb >= 10 ? Math.min(precision, 1) : precision;
  return `${gb.toFixed(decimals)} GB`;
};

export const calculateUsagePercent = (usedBytes, quotaGb) => {
  if (!Number.isFinite(usedBytes) || !Number.isFinite(quotaGb) || quotaGb <= 0) {
    return null;
  }
  const percent = (bytesToGigabytes(usedBytes) / quotaGb) * 100;
  if (!Number.isFinite(percent)) return null;
  return Math.min(100, Math.max(0, Math.round(percent)));
};

export const STORAGE_USAGE_SQL_SNIPPET = `create or replace function public.get_total_storage_usage()
returns bigint
language sql
security definer
set search_path = public, extensions
as $$
  select coalesce(sum((metadata->>'size')::bigint), 0)
  from storage.objects;
$$;

comment on function public.get_total_storage_usage() is
  'Returns total bytes used across all Supabase Storage buckets.';

create or replace function public.get_total_db_usage()
returns bigint
language sql
security definer
set search_path = public, extensions
as $$
  select pg_database_size(current_database());
$$;

comment on function public.get_total_db_usage() is
  'Returns total bytes used by the current Postgres database.';`;
