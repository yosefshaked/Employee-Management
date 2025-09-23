import { authenticatedFetch } from '@/lib/api-client.js';

function normalizeOrgId(orgId) {
  if (typeof orgId !== 'string') {
    return '';
  }
  return orgId.trim();
}

function resolveSessionToken(session) {
  const token = session?.access_token || session?.accessToken || null;
  if (typeof token !== 'string') {
    return null;
  }
  const trimmed = token.trim();
  return trimmed.length ? trimmed : null;
}

async function employeesRequest(method, { session, orgId, body, signal, employeeId } = {}) {
  const token = resolveSessionToken(session);
  if (!token) {
    throw new Error('נדרשת התחברות כדי לגשת לנתוני העובדים.');
  }

  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) {
    throw new Error('יש לבחור ארגון פעיל לפני ביצוע הפעולה.');
  }

  const path = employeeId ? `employees/${employeeId}` : 'employees';
  const search = method === 'GET' ? `?org_id=${encodeURIComponent(normalizedOrgId)}` : '';
  const basePayload = body && typeof body === 'object' ? body : {};
  const payload = method === 'GET' ? undefined : { ...basePayload, org_id: normalizedOrgId };

  const options = { method, signal };
  if (payload) {
    options.body = JSON.stringify(payload);
  }

  try {
    return await authenticatedFetch(`${path}${search}`, token, options);
  } catch (error) {
    if (!error?.message) {
      error.message = 'הפעולה נכשלה. נסה שוב מאוחר יותר.';
    }
    throw error;
  }
}

export function fetchEmployeesList(options) {
  return employeesRequest('GET', options);
}

export function createEmployee(options) {
  return employeesRequest('POST', options);
}

export function updateEmployee(options) {
  return employeesRequest('PATCH', options);
}

export function deleteEmployee(options) {
  return employeesRequest('DELETE', options);
}
