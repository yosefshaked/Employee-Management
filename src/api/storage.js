import { STORAGE_SETTINGS_KEY, DEFAULT_STORAGE_SETTINGS, normalizeStorageQuotaSettings } from '@/lib/storage.js';

const extractUsageValue = (payload, key) => {
  if (payload == null) return null;
  if (typeof payload === 'number' && Number.isFinite(payload)) return payload;
  if (typeof payload === 'object') {
    const value = payload[key] ?? payload[key.toLowerCase()];
    if (Number.isFinite(value)) return value;
  }
  return null;
};

const isMissingRpcError = (error) => {
  if (!error) return false;
  const code = String(error.code || '').toUpperCase();
  if (code === 'PGRST202' || code === 'PGRST116' || code === '404') return true;
  return Boolean(error.message && error.message.includes('schema cache'));
};

let missingStorageUsageRpc = false;
let missingDbUsageRpc = false;

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

  if (!missingStorageUsageRpc) {
    const storageResponse = await client.rpc('get_total_storage_usage');
    if (storageResponse.error) {
      if (isMissingRpcError(storageResponse.error)) {
        missingStorageUsageRpc = true;
        metrics.errors.storage = storageResponse.error;
      } else {
        throw storageResponse.error;
      }
    } else {
      metrics.storageBytes = extractUsageValue(storageResponse.data, 'total_storage_bytes');
    }
  } else {
    metrics.errors.storage = { code: 'PGRST202', message: 'get_total_storage_usage RPC is missing' };
  }

  if (includeDatabase) {
    if (!missingDbUsageRpc) {
      const dbResponse = await client.rpc('get_total_db_usage');
      if (dbResponse.error) {
        if (isMissingRpcError(dbResponse.error)) {
          missingDbUsageRpc = true;
          metrics.errors.database = dbResponse.error;
        } else {
          throw dbResponse.error;
        }
      } else {
        metrics.dbBytes = extractUsageValue(dbResponse.data, 'total_db_bytes');
      }
    } else {
      metrics.errors.database = { code: 'PGRST202', message: 'get_total_db_usage RPC is missing' };
    }
  }

  return metrics;
};
