import { makeApiCall } from '@/lib/api-client.js';

const METHOD_TO_ACTION = {
  GET: 'FETCH_EMPLOYEE_BUNDLE',
  POST: 'CREATE_EMPLOYEE',
  PATCH: 'UPDATE_EMPLOYEE',
  PUT: 'UPDATE_EMPLOYEE',
  DELETE: 'DELETE_EMPLOYEE',
};

function normalizeOrgId(orgId) {
  if (typeof orgId !== 'string') {
    return '';
  }
  return orgId.trim();
}

function normalizeEmployeeId(employeeId) {
  if (typeof employeeId === 'string' && employeeId.trim()) {
    return employeeId.trim();
  }
  if (typeof employeeId === 'number' && Number.isFinite(employeeId)) {
    return String(employeeId);
  }
  return '';
}

async function employeesRequest(method, {
  authClient,
  session,
  accessToken,
  orgId,
  activeOrg,
  connection,
  body,
  signal,
  employeeId,
} = {}) {
  const normalizedMethod = typeof method === 'string' ? method.toUpperCase() : '';
  const action = METHOD_TO_ACTION[normalizedMethod];
  if (!action) {
    throw new Error('Unsupported employee request method.');
  }

  if (!authClient && !session && !accessToken) {
    throw new Error('נדרש לקוח Supabase או אסימון גישה לביצוע הפעולה.');
  }

  const normalizedOrgId = normalizeOrgId(orgId);
  const normalizedEmployeeId = normalizeEmployeeId(employeeId);

  if (!normalizedOrgId && !activeOrg?.id) {
    throw new Error('יש לבחור ארגון פעיל לפני ביצוע הפעולה.');
  }

  const payload = normalizedMethod === 'GET'
    ? {}
    : {
        ...(body && typeof body === 'object' ? body : {}),
        ...(normalizedEmployeeId ? { employee_id: normalizedEmployeeId } : {}),
      };

  try {
    return await makeApiCall({
      action,
      authClient,
      session,
      accessToken,
      activeOrg,
      connection,
      orgId: normalizedOrgId,
      payload,
      signal,
    });
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
