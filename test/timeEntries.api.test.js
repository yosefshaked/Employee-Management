import { describe, it } from 'node:test';
import assert from 'node:assert';
import { deleteTimeEntry, bulkDeleteTimeEntries } from '../src/api/timeEntries.js';

describe('timeEntries API', () => {
  it('sends hard delete for single id', async () => {
    const calls = [];
    globalThis.fetch = async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, status: 204, text: async () => '' };
    };
    await deleteTimeEntry('123');
    assert.strictEqual(calls[0].url, '/api/time-entries/123?hard=true');
    assert.strictEqual(calls[0].opts.method, 'DELETE');
  });

  it('sends hard delete for bulk ids', async () => {
    const calls = [];
    globalThis.fetch = async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, json: async () => ({ deleted: [] }) };
    };
    await bulkDeleteTimeEntries(['a', 'b']);
    assert.strictEqual(calls[0].url, '/api/time-entries/bulk-delete');
    assert.strictEqual(calls[0].opts.method, 'POST');
    assert.deepStrictEqual(JSON.parse(calls[0].opts.body), { ids: ['a', 'b'], hard: true });
  });
});
