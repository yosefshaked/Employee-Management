export async function authenticatedFetch(path, accessToken, options = {}) {
  const token = typeof accessToken === 'string' ? accessToken.trim() : '';
  if (!token) {
    throw new Error('A valid session is required to call this API.');
  }

  const { headers: customHeaders = {}, body, ...rest } = options;
  const headers = {
    'Content-Type': 'application/json',
    ...customHeaders,
    Authorization: `Bearer ${token}`,
  };

  let requestBody = body;
  if (requestBody && typeof requestBody === 'object' && !(requestBody instanceof FormData)) {
    requestBody = JSON.stringify(requestBody);
  }

  const normalizedPath = String(path || '').replace(/^\/+/, '');
  const response = await fetch(`/api/${normalizedPath}`, {
    ...rest,
    headers,
    body: requestBody,
  });

  let payload = null;
  const contentType = response.headers?.get?.('content-type') || response.headers?.get?.('Content-Type') || '';
  const isJson = typeof contentType === 'string' && contentType.toLowerCase().includes('application/json');
  if (isJson) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const message = payload?.message || 'An API error occurred';
    const error = new Error(message);
    error.status = response.status;
    if (payload) {
      error.data = payload;
    }
    throw error;
  }

  return payload;
}
