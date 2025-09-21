let currentOrg = null;
let readyResolve = () => {};
let readyPromise = createReadyPromise();

function createReadyPromise() {
  return new Promise((resolve) => {
    readyResolve = resolve;
  });
}

function normalizeConfig(config) {
  if (!config || typeof config !== 'object') {
    return null;
  }

  const orgId = typeof config.orgId === 'string' ? config.orgId.trim() : '';
  const supabaseUrl = typeof config.supabaseUrl === 'string' ? config.supabaseUrl.trim() : '';
  const supabaseAnonKey = typeof config.supabaseAnonKey === 'string' ? config.supabaseAnonKey.trim() : '';

  if (!orgId || !supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  return { orgId, supabaseUrl, supabaseAnonKey };
}

export function setOrg(config) {
  const normalized = normalizeConfig(config);

  if (!normalized) {
    throw new Error('MissingRuntimeConfigError');
  }

  currentOrg = normalized;
  readyResolve();
  return currentOrg;
}

export function clearOrg() {
  currentOrg = null;
  readyPromise = createReadyPromise();
}

export async function waitOrgReady() {
  return readyPromise;
}

export function getOrgOrThrow() {
  if (!currentOrg) {
    throw new Error('MissingRuntimeConfigError');
  }

  const normalized = normalizeConfig(currentOrg);

  if (!normalized) {
    throw new Error('MissingRuntimeConfigError');
  }

  return normalized;
}
