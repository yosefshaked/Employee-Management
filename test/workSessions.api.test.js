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
        calls.push({ table, stage: 'from' });
        return {
          select(cols) {
            calls.push({ table, action: 'select', cols });
            return {
              in(col, ids) {
                calls.push({ table, action: 'select.in', col, ids });
                return Promise.resolve({
                  data: ids.map(id => ({
                    id,
                    employee_id: 'emp',
                    date: '2024-01-01',
                    entry_type: 'hours',
                  })),
                  error: null,
                });
              },
            };
          },
          delete() {
            calls.push({ table, action: 'delete' });
            return {
              in(col, ids) {
                calls.push({ table, action: 'delete.in', col, ids });
                return {
                  select(cols) {
                    calls.push({ table, action: 'delete.select', cols });
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
      { table: 'WorkSessions', stage: 'from' },
      { table: 'WorkSessions', action: 'select', cols: '*' },
      { table: 'WorkSessions', action: 'select.in', col: 'id', ids: ['a'] },
      { table: 'WorkSessions', stage: 'from' },
      { table: 'WorkSessions', action: 'delete' },
      { table: 'WorkSessions', action: 'delete.in', col: 'id', ids: ['a'] },
      { table: 'WorkSessions', action: 'delete.select', cols: 'id' },
      { table: 'WorkSessions', stage: 'from' },
      { table: 'WorkSessions', action: 'select', cols: '*' },
      { table: 'WorkSessions', action: 'select.in', col: 'id', ids: ['a', 'b'] },
      { table: 'WorkSessions', stage: 'from' },
      { table: 'WorkSessions', action: 'delete' },
      { table: 'WorkSessions', action: 'delete.in', col: 'id', ids: ['a', 'b'] },
      { table: 'WorkSessions', action: 'delete.select', cols: 'id' },
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

  it('soft delete removes leave ledger entries', async () => {
    let deletedIds = null;
    const fakeClient = {
      from(table) {
        if (table === 'WorkSessions') {
          return {
            update() {
              return {
                in(col, ids) {
                  assert.strictEqual(col, 'id');
                  return {
                    select() {
                      return Promise.resolve({
                        data: ids.map(id => ({
                          id,
                          employee_id: 'emp1',
                          date: '2024-01-01',
                          entry_type: 'leave_employee_paid',
                          notes: 'note',
                        })),
                        error: null,
                      });
                    },
                  };
                },
              };
            },
          };
        }
        if (table === 'LeaveBalances') {
          return {
            select() {
              return {
                in(col, values) {
                  assert.strictEqual(col, 'employee_id');
                  assert.deepStrictEqual(values, ['emp1']);
                  return {
                    in(col2, values2) {
                      assert.strictEqual(col2, 'effective_date');
                      assert.deepStrictEqual(values2, ['2024-01-01']);
                      return {
                        like(col3, pattern) {
                          assert.strictEqual(col3, 'leave_type');
                          assert.strictEqual(pattern, 'time_entry_leave%');
                          return Promise.resolve({
                            data: [{
                              id: 'ledger1',
                              employee_id: 'emp1',
                              effective_date: '2024-01-01',
                              leave_type: 'time_entry_leave_employee_paid',
                              balance: -1,
                            }],
                            error: null,
                          });
                        },
                      };
                    },
                  };
                },
              };
            },
            delete() {
              return {
                in(col, ids) {
                  assert.strictEqual(col, 'id');
                  deletedIds = ids;
                  return Promise.resolve({ data: null, error: null });
                },
              };
            },
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    };
    await softDeleteWorkSessions(['abc'], fakeClient);
    assert.deepStrictEqual(deletedIds, ['ledger1']);
  });

  it('restoring leave sessions recreates ledger rows when missing', async () => {
    let insertedPayload = null;
    const fakeClient = {
      from(table) {
        if (table === 'WorkSessions') {
          return {
            update() {
              return {
                in(col, ids) {
                  assert.strictEqual(col, 'id');
                  return {
                    select() {
                      return Promise.resolve({
                        data: ids.map(id => ({
                          id,
                          employee_id: 'emp1',
                          date: '2024-01-01',
                          entry_type: 'leave_employee_paid',
                          notes: 'note',
                        })),
                        error: null,
                      });
                    },
                  };
                },
              };
            },
          };
        }
        if (table === 'LeaveBalances') {
          return {
            select() {
              return {
                in() {
                  return {
                    in() {
                      return {
                        like() {
                          return Promise.resolve({ data: [], error: null });
                        },
                      };
                    },
                  };
                },
              };
            },
            insert(payload) {
              insertedPayload = payload;
              return Promise.resolve({ data: null, error: null });
            },
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    };
    await restoreWorkSessions(['abc'], fakeClient);
    assert.ok(Array.isArray(insertedPayload));
    assert.deepStrictEqual(insertedPayload, [{
      employee_id: 'emp1',
      effective_date: '2024-01-01',
      leave_type: 'time_entry_leave_employee_paid',
      balance: -1,
      notes: 'note',
    }]);
  });
});
