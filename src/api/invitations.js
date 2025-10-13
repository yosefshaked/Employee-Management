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

function normalizeToken(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

async function fetchJson(path, { method = 'GET', signal } = {}) {
  const response = await fetch(`/api/${path}`, { method, signal });
  let payload = null;

  const contentType = response.headers?.get?.('content-type')
    || response.headers?.get?.('Content-Type')
    || '';
  const isJson = typeof contentType === 'string' && contentType.toLowerCase().includes('application/json');

  if (isJson) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const message = payload?.message || 'אירעה שגיאה בעת שליפת ההזמנה.';
    const error = new Error(message);
    error.status = response.status;
    if (payload) {
      error.data = payload;
    }
    throw error;
  }

  return payload;
}

export async function getInvitationByToken({ token, signal, session } = {}) {
  const normalizedToken = normalizeToken(token);
  if (!normalizedToken) {
    throw new Error('קישור ההזמנה חסר או פגום.');
  }

  const encoded = encodeURIComponent(normalizedToken);
  if (session) {
    return authenticatedFetch(`invitations/token/${encoded}`, {
      method: 'GET',
      session,
      signal,
    });
  }

  return fetchJson(`invitations/token/${encoded}`, { method: 'GET', signal });
}

export async function acceptInvitation({ session, invitationId, signal } = {}) {
  if (!session) {
    throw new Error('נדרשת התחברות כדי להצטרף לארגון.');
  }

  const normalizedId = normalizeToken(invitationId);
  if (!normalizedId) {
    throw new Error('זיהוי הזמנה חסר.');
  }

  return authenticatedFetch(`invitations/${encodeURIComponent(normalizedId)}/accept`, {
    method: 'POST',
    session,
    signal,
  });
}

export async function listIncomingInvitations({ session, signal } = {}) {
  if (!session) {
    throw new Error('נדרשת התחברות כדי לטעון הזמנות נכנסות.');
  }

  return authenticatedFetch('invitations/incoming', {
    method: 'GET',
    session,
    signal,
  });
}

export async function revokeInvitation({ session, invitationId, signal } = {}) {
  if (!session) {
    throw new Error('נדרשת התחברות כדי לבטל הזמנה.');
  }

  const normalizedId = normalizeToken(invitationId);
  if (!normalizedId) {
    throw new Error('זיהוי הזמנה חסר.');
  }

  return authenticatedFetch(`invitations/${encodeURIComponent(normalizedId)}`, {
    method: 'DELETE',
    session,
    signal,
  });
}

export async function declineInvitation({ session, invitationId, signal } = {}) {
  if (!session) {
    throw new Error('נדרשת התחברות כדי לדחות הזמנה.');
  }

  const normalizedId = normalizeToken(invitationId);
  if (!normalizedId) {
    throw new Error('זיהוי הזמנה חסר.');
  }

  return authenticatedFetch(`invitations/${encodeURIComponent(normalizedId)}/decline`, {
    method: 'POST',
    session,
    signal,
  });
}
