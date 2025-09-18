import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  softDeleteWorkSession,
  softDeleteWorkSessions,
  restoreWorkSession,
  restoreWorkSessions,
  permanentlyDeleteWorkSession,
  permanentlyDeleteWorkSessions,
} from '../src/api/workSessions.js';

describe('workSessions API', () => {
  it('soft deletes single id and returns row', async () => {
    const calls = [];
    let payload = null;
    const fakeClient = {
      from(table) {
        calls.push(table);
        return {
          update(updatePayload) {
            payload = updatePayload;
            return {
              in(col, ids) {
                calls.push({ col, ids });
                return {
                  select(cols) {
                    calls.push(cols);
                    return Promise.resolve({
                      data: ids.map(id => ({ id, deleted: true, deleted_at: '2024-01-01T00:00:00Z' })),
                      error: null,
                    });
                  },
                };
              },
            };
          },
        };
      },
    };
    const row = await softDeleteWorkSession('123', fakeClient);
    assert.deepStrictEqual(calls, ['WorkSessions', { col: 'id', ids: ['123'] }, '*']);
    assert.strictEqual(row.id, '123');
    assert.strictEqual(payload.deleted, true);
    assert.strictEqual(typeof payload.deleted_at, 'string');
    assert.ok(!Number.isNaN(Date.parse(payload.deleted_at)));
  });

  it('soft deletes multiple ids', async () => {
    const calls = [];
    const fakeClient = {
      from(table) {
        calls.push(table);
        return {
          update(updatePayload) {
            calls.push(updatePayload);
            return {
              in(col, ids) {
                calls.push({ col, ids });
                return {
                  select(cols) {
                    calls.push(cols);
                    return Promise.resolve({
                      data: ids.map(id => ({ id })),
                      error: null,
                    });
                  },
                };
              },
            };
          },
        };
      },
    };
    await softDeleteWorkSessions(['a', 'b'], fakeClient);
    assert.strictEqual(calls[0], 'WorkSessions');
    assert.strictEqual(calls[1].deleted, true);
    assert.strictEqual(typeof calls[1].deleted_at, 'string');
    assert.ok(!Number.isNaN(Date.parse(calls[1].deleted_at)));
    assert.deepStrictEqual(calls[2], { col: 'id', ids: ['a', 'b'] });
    assert.strictEqual(calls[3], '*');
  });

  it('restores records', async () => {
    const calls = [];
    let payload = null;
    const fakeClient = {
      from(table) {
        calls.push(table);
        return {
          update(updatePayload) {
            payload = updatePayload;
            return {
              in(col, ids) {
                calls.push({ col, ids });
                return {
                  select(cols) {
                    calls.push(cols);
                    return Promise.resolve({
                      data: ids.map(id => ({ id, deleted: false, deleted_at: null })),
                      error: null,
                    });
                  },
                };
              },
            };
          },
        };
      },
    };
    const rows = await restoreWorkSessions(['z'], fakeClient);
    assert.deepStrictEqual(calls, ['WorkSessions', { col: 'id', ids: ['z'] }, '*']);
    assert.strictEqual(payload.deleted, false);
    assert.strictEqual(payload.deleted_at, null);
    assert.strictEqual(rows[0].id, 'z');
    const single = await restoreWorkSession('abc', fakeClient);
    assert.strictEqual(single.id, 'abc');
  });

  it('permanently deletes ids', async () => {
    const calls = [];
    const fakeClient = {
      from(table) {
        calls.push(table);
        return {
          delete() {
            return {
              in(col, ids) {
                calls.push({ col, ids });
                return {
                  select(cols) {
                    calls.push(cols);
                    return Promise.resolve({ data: ids.map(id => ({ id })), error: null });
                  },
                };
              },
            };
          },
        };
      },
    };
    await permanentlyDeleteWorkSession('a', fakeClient);
    await permanentlyDeleteWorkSessions(['a', 'b'], fakeClient);
    assert.deepStrictEqual(calls, [
      'WorkSessions',
      { col: 'id', ids: ['a'] },
      'id',
      'WorkSessions',
      { col: 'id', ids: ['a', 'b'] },
      'id',
    ]);
  });

  it('propagates soft delete errors', async () => {
    const fakeClient = {
      from() {
        return {
          update() {
            return {
              in() {
                return {
                  select() {
                    return Promise.resolve({ error: { message: 'fail' }, data: null });
                  },
                };
              },
            };
          },
        };
      },
    };
    await assert.rejects(() => softDeleteWorkSessions(['a'], fakeClient), /fail/);
  });

  it('throws when soft delete removes nothing', async () => {
    const fakeClient = {
      from() {
        return {
          update() {
            return {
              in() {
                return {
                  select() {
                    return Promise.resolve({ data: [], error: null });
                  },
                };
              },
            };
          },
        };
      },
    };
    await assert.rejects(() => softDeleteWorkSessions(['a'], fakeClient), /No rows deleted/);
  });
});
