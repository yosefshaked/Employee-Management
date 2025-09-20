import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntimeConfig } from './config.js';

describe('loadRuntimeConfig', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends the bearer token when requesting organization config', async () => {
    const calls = [];
    global.fetch = async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        headers: {
          get(name) {
            return name.toLowerCase() === 'content-type' ? 'application/json' : null;
          },
        },
        async json() {
          return {
            supabase_url: 'https://example-org.supabase.co',
            anon_key: 'anon-key-123',
          };
        },
      };
    };

    const result = await loadRuntimeConfig({ accessToken: 'token-123', orgId: 'org-456', force: true });

    assert.equal(calls.length, 1);
    const request = calls[0];
    assert.equal(request.options.method, 'GET');
    assert.equal(request.options.headers.Authorization, 'Bearer token-123');
    assert.equal(request.options.headers['x-org-id'], 'org-456');
    assert.equal(result.supabaseUrl, 'https://example-org.supabase.co');
    assert.equal(result.supabaseAnonKey, 'anon-key-123');
  });
});
