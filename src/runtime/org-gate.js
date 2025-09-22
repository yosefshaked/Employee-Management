import {
  activateOrg,
  clearOrg,
  waitOrgReady,
  getOrgOrThrow,
  getCurrentOrg,
} from '@/lib/org-runtime.js';
import {
  getSupabase,
  getCachedSupabase,
  resetSupabase,
} from '@/lib/supabase-manager.js';

export function activateRuntimeOrg(config) {
  return activateOrg(config);
}

export function clearRuntimeOrg() {
  clearOrg();
}

export function waitRuntimeOrgReady() {
  return waitOrgReady();
}

export function getRuntimeOrgOrThrow() {
  return getOrgOrThrow();
}

export function getRuntimeOrg() {
  return getCurrentOrg();
}

export function getRuntimeSupabase() {
  return getSupabase();
}

export function getCachedRuntimeSupabase(orgId) {
  return getCachedSupabase(orgId);
}

export function resetRuntimeSupabase(orgId) {
  resetSupabase(orgId);
}
