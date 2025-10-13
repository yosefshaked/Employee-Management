import { authenticatedFetch } from '@/lib/api-client.js';

function normalizeOrgId(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function normalizeEmail(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase();
}

export async function createInvitation({ session, orgId, email, signal } = {}) {
  if (!session) {
    throw new Error('נדרשת התחברות כדי לשלוח הזמנה.');
  }

  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) {
    throw new Error('יש לבחור ארגון יעד להזמנה.');
  }

  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error('יש להזין כתובת דוא"ל תקינה.');
  }

  return authenticatedFetch('invitations', {
    method: 'POST',
    session,
    signal,
    body: {
      orgId: normalizedOrgId,
      email: normalizedEmail,
    },
  });
}

export async function listPendingInvitations({ session, orgId, signal } = {}) {
  if (!session) {
    throw new Error('נדרשת התחברות כדי לטעון הזמנות.');
  }

  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) {
    throw new Error('יש לבחור ארגון כדי לטעון הזמנות.');
  }

  return authenticatedFetch(`invitations?orgId=${encodeURIComponent(normalizedOrgId)}`, {
    method: 'GET',
    session,
    signal,
  });
}
