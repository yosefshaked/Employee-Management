export function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...headers,
    },
    body: JSON.stringify(body ?? {}),
  }
}
