import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { verifyOrgConnection } from '../src/runtime/verification.js';

const env = globalThis.process?.env ?? {};
if (!env.VITE_APP_SUPABASE_URL) {
  env.VITE_APP_SUPABASE_URL = 'https://example.supabase.co';
}
if (!env.VITE_APP_SUPABASE_ANON_KEY) {
  env.VITE_APP_SUPABASE_ANON_KEY = 'test-anon-key';
}
if (!env.NODE_ENV) {
  env.NODE_ENV = 'test';
}

const supabaseManagerPromise = import('../src/lib/supabase-manager.js');

describe('shared Supabase client module', () => {
  it('supports lazy initialization and reset', async () => {
    const {
      initializeAuthClient,
      getAuthClient,
      isAuthClientInitialized,
      resetAuthClient,
      createDataClient,
    } = await supabaseManagerPromise;

    if (isAuthClientInitialized()) {
      resetAuthClient();
    }

    assert.equal(isAuthClientInitialized(), false);
    assert.throws(() => getAuthClient(), /has not been initialized/);

    initializeAuthClient({
      supabaseUrl: env.VITE_APP_SUPABASE_URL,
      supabaseAnonKey: env.VITE_APP_SUPABASE_ANON_KEY,
    });

    const client = getAuthClient();
    assert.ok(client);
    assert.equal(isAuthClientInitialized(), true);

    const dataClient = createDataClient({
      id: 'tenant-1',
      supabaseUrl: 'https://tenant.supabase.co',
      supabaseAnonKey: 'tenant-anon-key',
    });
    assert.ok(dataClient);

    resetAuthClient();
    assert.equal(isAuthClientInitialized(), false);
  });

  it('accepts snake_case credentials during initialization', async () => {
    const {
      initializeAuthClient,
      getAuthClient,
      isAuthClientInitialized,
      resetAuthClient,
    } = await supabaseManagerPromise;

    if (isAuthClientInitialized()) {
      resetAuthClient();
    }

    initializeAuthClient({
      supabase_url: env.VITE_APP_SUPABASE_URL,
      supabase_anon_key: env.VITE_APP_SUPABASE_ANON_KEY,
    });

    assert.ok(getAuthClient());
    resetAuthClient();
  });
});

describe('verifyOrgConnection', () => {
  it('requires a Supabase client argument', async () => {
    await assert.rejects(() => verifyOrgConnection(), /Supabase client is required/);
  });

  it('returns ok when leave policy settings can be fetched', async () => {
    const calls = [];
    const stubClient = {
      from(table) {
        calls.push(table);
        return {
          select(columns) {
            calls.push(columns);
            return {
              eq(column, value) {
                calls.push([column, value]);
                return {
                  maybeSingle: async () => ({
                    data: { settings_value: { enabled: true } },
                    status: 200,
                  }),
                };
              },
            };
          },
        };
      },
    };

    const result = await verifyOrgConnection(stubClient);

    assert.deepEqual(calls, [
      'Settings',
      'settings_value',
      ['key', 'leave_policy'],
    ]);
    assert.deepEqual(result, { ok: true, settingsValue: { enabled: true } });
  });
});
