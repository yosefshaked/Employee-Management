import { describe, it } from 'node:test';
import assert from 'node:assert';
import { deleteWorkSession, deleteWorkSessions } from '../src/api/workSessions.js';

describe('workSessions API', () => {
  it('deletes single id with filter', async () => {
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
                  }
                };
              }
            };
          }
        };
      }
    };
    await deleteWorkSession('123', fakeClient);
    assert.deepStrictEqual(calls, ['WorkSessions', { col: 'id', ids: ['123'] }, 'id']);
  });

  it('deletes multiple ids', async () => {
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
                  }
                };
              }
            };
          }
        };
      }
    };
    await deleteWorkSessions(['a', 'b'], fakeClient);
    assert.deepStrictEqual(calls, ['WorkSessions', { col: 'id', ids: ['a', 'b'] }, 'id']);
  });

  it('propagates errors', async () => {
    const fakeClient = {
      from() {
        return {
          delete() {
            return {
              in() {
                return {
                  select() {
                    return Promise.resolve({ error: { message: 'fail' }, data: null });
                  }
                };
              }
            };
          }
        };
      }
    };
    await assert.rejects(() => deleteWorkSessions(['a'], fakeClient), /fail/);
  });

  it('throws when nothing deleted', async () => {
    const fakeClient = {
      from() {
        return {
          delete() {
            return {
              in() {
                return {
                  select() {
                    return Promise.resolve({ data: [], error: null });
                  }
                };
              }
            };
          }
        };
      }
    };
    await assert.rejects(() => deleteWorkSessions(['a'], fakeClient), /No rows deleted/);
  });
});
