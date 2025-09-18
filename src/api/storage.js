import { STORAGE_SETTINGS_KEY, DEFAULT_STORAGE_SETTINGS, normalizeStorageQuotaSettings } from '@/lib/storage.js';

const extractUsageValue = (payload, key) => {
  if (payload == null) return 0;
  if (typeof payload === 'number' && Number.isFinite(payload)) return payload;
  if (typeof payload === 'object') {
    const value = payload[key] ?? payload[key.toLowerCase()];
    if (Number.isFinite(value)) return value;
  }
  return 0;
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
  const storageResponse = await client.rpc('get_total_storage_usage');
  if (storageResponse.error) {
    throw storageResponse.error;
  }

  const metrics = {
    storageBytes: extractUsageValue(storageResponse.data, 'total_storage_bytes'),
    dbBytes: null,
    fetchedAt: new Date().toISOString(),
  };

  if (includeDatabase) {
    const dbResponse = await client.rpc('get_total_db_usage');
    if (dbResponse.error) {
      throw dbResponse.error;
    }
    metrics.dbBytes = extractUsageValue(dbResponse.data, 'total_db_bytes');
  }

  return metrics;
};
