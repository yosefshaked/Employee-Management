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

const supabaseManagerPromise = import('../src/lib/supabase-manager.js');

describe('shared Supabase client module', () => {
  it('exposes the expected helpers', async () => {
    const { authClient, createDataClient } = await supabaseManagerPromise;
    assert.ok(authClient);
    assert.equal(typeof authClient.auth, 'object');
    assert.equal(typeof createDataClient, 'function');
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
