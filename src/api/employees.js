const DEFAULT_HEADERS = { 'Content-Type': 'application/json' };

function normalizeOrgId(orgId) {
  if (typeof orgId !== 'string') {
    return '';
  }
  return orgId.trim();
}

function resolveSessionToken(session) {
  const token = session?.access_token || session?.accessToken || null;
  return typeof token === 'string' ? token : null;
}

function buildHeaders(session) {
  const token = resolveSessionToken(session);
  if (!token) {
    throw new Error('נדרשת התחברות כדי לגשת לנתוני העובדים.');
  }
  return {
    ...DEFAULT_HEADERS,
    Authorization: `Bearer ${token}`,
  };
}

async function parseResponse(response) {
  const contentType = response.headers.get('content-type') || response.headers.get('Content-Type') || '';
  const isJson = typeof contentType === 'string' && contentType.toLowerCase().includes('application/json');
  if (!isJson) {
    return { ok: response.ok, data: null };
  }
  try {
    const data = await response.json();
    return { ok: response.ok, data };
  } catch {
    return { ok: response.ok, data: null };
  }
}

async function employeesRequest(method, { session, orgId, body, signal, employeeId } = {}) {
  const headers = buildHeaders(session);
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) {
    throw new Error('יש לבחור ארגון פעיל לפני ביצוע הפעולה.');
  }

  const params = new URLSearchParams({ org_id: normalizedOrgId });
  const path = employeeId ? `/api/employees/${employeeId}` : '/api/employees';
  const url = `${path}?${params.toString()}`;

  const response = await fetch(url, {
    method,
    headers,
    signal,
    body: body ? JSON.stringify({ ...body, org_id: normalizedOrgId }) : undefined,
  });

  const payload = await parseResponse(response);
  if (!payload.ok) {
    const message = payload.data?.message || 'הפעולה נכשלה. נסה שוב מאוחר יותר.';
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload.data || null;
    throw error;
  }
  return payload.data || null;
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
