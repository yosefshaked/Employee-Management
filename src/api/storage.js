import { STORAGE_SETTINGS_KEY, DEFAULT_STORAGE_SETTINGS, normalizeStorageQuotaSettings } from '@/lib/storage.js';

const toFiniteNumber = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const extractUsageValue = (payload, key) => {
  if (payload == null) return null;

  const directNumber = toFiniteNumber(payload);
  if (directNumber != null) return directNumber;

  if (Array.isArray(payload)) {
    for (const entry of payload) {
      const value = extractUsageValue(entry, key);
      if (value != null) return value;
    }
    return null;
  }

  if (typeof payload === 'object') {
    const candidates = [];
    if (key in payload) candidates.push(payload[key]);
    const lowerKey = typeof key === 'string' ? key.toLowerCase() : key;
    if (lowerKey in payload) candidates.push(payload[lowerKey]);

    for (const candidate of candidates) {
      const value = extractUsageValue(candidate, key);
      if (value != null) return value;
    }
  }

  return null;
};

export const fetchStorageQuotaSettings = async (client) => {
  const { data, error } = await client
    .from('Settings')
    .select('settings_value')
    .eq('key', STORAGE_SETTINGS_KEY)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return { ...DEFAULT_STORAGE_SETTINGS };
    }
    throw error;
  }

  return normalizeStorageQuotaSettings(data?.settings_value);
};

export const saveStorageQuotaSettings = async (client, draftSettings) => {
  const normalized = normalizeStorageQuotaSettings(draftSettings);
  const { error } = await client
    .from('Settings')
    .upsert({
      key: STORAGE_SETTINGS_KEY,
      settings_value: normalized,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'key',
      returning: 'minimal',
    });

  if (error) throw error;
  return normalized;
};

export const fetchStorageUsageMetrics = async (client, { includeDatabase = true } = {}) => {
  const metrics = {
    storageBytes: null,
    dbBytes: includeDatabase ? null : undefined,
    fetchedAt: new Date().toISOString(),
    errors: {},
  };

  try {
    const storageResponse = await client.functions.invoke('storage-usage');

    if (storageResponse.error) {
      metrics.errors.storage = {
        code: storageResponse.error?.status ?? storageResponse.error?.code,
        message: storageResponse.error.message || 'Failed to fetch storage usage.',
        details: storageResponse.error?.name || storageResponse.error?.details,
      };
    } else if (storageResponse.data?.error) {
      metrics.errors.storage = storageResponse.data;
    } else {
      metrics.storageBytes = extractUsageValue(storageResponse.data, 'total_bytes');
    }
  } catch (error) {
    metrics.errors.storage = {
      message: error instanceof Error ? error.message : 'Failed to fetch storage usage.',
    };
  }

  if (includeDatabase) {
    try {
      const dbResponse = await client.rpc('get_total_db_usage');
      if (dbResponse.error) {
        metrics.errors.database = dbResponse.error;
      } else {
        metrics.dbBytes = extractUsageValue(dbResponse.data, 'total_db_bytes');
      }
    } catch (error) {
      metrics.errors.database = {
        message: error instanceof Error ? error.message : 'Failed to fetch database usage.',
      };
    }
  }

  return metrics;
};
