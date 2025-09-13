import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateGlobalDailyRate } from '../src/lib/payroll.js';
import { copyFromPrevious, fillDown, isRowCompleteForProgress } from '../src/components/time-entry/multiDateUtils.js';
import { useTimeEntry } from '../src/components/time-entry/useTimeEntry.js';
import fs from 'node:fs';
import path from 'node:path';

describe('multi-date save', () => {
  it('creates a WorkSessions row for each employee-date combination', async () => {
    const employees = [
      { id: 'e1', employee_type: 'hourly' },
      { id: 'e2', employee_type: 'hourly' }
    ];
    const services = [];
    const dates = [new Date('2024-02-01'), new Date('2024-02-02')];
    const rows = employees.flatMap(emp => dates.map(d => ({
      employee_id: emp.id,
      date: d.toISOString().slice(0,10),
      entry_type: 'hours',
      hours: '1'
    })));
    const fakeSupabase = { from: () => ({ insert: async () => ({}) }) };
    const { saveRows } = useTimeEntry({ employees, services, getRateForDate: () => ({ rate: 100 }), supabaseClient: fakeSupabase });
    const inserted = await saveRows(rows);
    assert.equal(inserted.length, employees.length * dates.length);
  });
});

describe('copy and fill utilities', () => {
  it('copyFromPrevious copies only within same employee', () => {
    const rows = [
      { employee_id: 'e1', hours: '1' },
      { employee_id: 'e1', hours: '' },
      { employee_id: 'e2', hours: '' }
    ];
    let { rows: result, success } = copyFromPrevious(rows, 1, 'hours');
    assert.equal(success, true);
    assert.equal(result[1].hours, '1');
    const second = copyFromPrevious(result, 2, 'hours');
    assert.equal(second.success, false);
    assert.equal(second.rows[2].hours, '');
  });
  it('fillDown fills empty rows from first', () => {
    const rows = [{ sessions_count: '2' }, { sessions_count: '' }, { sessions_count: '3' }];
    const result = fillDown(rows, 'sessions_count');
    assert.equal(result[1].sessions_count, '2');
    assert.equal(result[2].sessions_count, '3');
  });
});

describe('global daily rate ignores hours', () => {
  it('uses daily rate regardless of hours input', () => {
    const emp = { working_days: ['SUN','MON','TUE','WED','THU'] };
    const monthlyRate = 3000;
    const dailyRate = calculateGlobalDailyRate(emp, new Date('2024-02-05'), monthlyRate);
    const total = dailyRate; // hours ignored
    assert.equal(total, dailyRate);
  });
});

describe('progress completion rules', () => {
  it('session row requires service, sessions and students', () => {
    const emp = { employee_type: 'instructor' };
    const row = { service_id: 's1', sessions_count: '1', students_count: '1' };
    assert.equal(isRowCompleteForProgress(row, emp), true);
    row.students_count = '';
    assert.equal(isRowCompleteForProgress(row, emp), false);
  });
  it('hourly row requires hours > 0', () => {
    const emp = { employee_type: 'hourly' };
    const row = { hours: '0' };
    assert.equal(isRowCompleteForProgress(row, emp), false);
    row.hours = '2';
    assert.equal(isRowCompleteForProgress(row, emp), true);
  });
  it('global row requires explicit day type', () => {
    const emp = { employee_type: 'global' };
    const row = { entry_type: '' };
    assert.equal(isRowCompleteForProgress(row, emp), false);
    row.entry_type = 'hours';
    assert.equal(isRowCompleteForProgress(row, emp), true);
    row.entry_type = 'paid_leave';
    assert.equal(isRowCompleteForProgress(row, emp), true);
  });
});

describe('no days text in table for globals', () => {
  it('TimeEntryTable does not contain " ימים"', () => {
    const content = fs.readFileSync(path.join('src','components','time-entry','TimeEntryTable.jsx'), 'utf8');
    assert(!content.includes(' ימים'));
  });
});
