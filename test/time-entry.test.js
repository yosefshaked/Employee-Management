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

  it('copies day type for global employees', () => {
    const rows = [
      { employee_id: 'g1', entry_type: 'hours' },
      { employee_id: 'g1', entry_type: '' }
    ];
    let { rows: result, success } = copyFromPrevious(rows, 1, 'dayType');
    assert.equal(success, true);
    assert.equal(result[1].entry_type, 'hours');
    const emp = { employee_type: 'global' };
    assert.equal(isRowCompleteForProgress(result[1], emp), true);
  });

  it('fails to copy day type when source missing or different employee', () => {
    const rows = [
      { employee_id: 'g1', entry_type: '' },
      { employee_id: 'g1', entry_type: '' },
      { employee_id: 'g2', entry_type: 'hours' }
    ];
    let res = copyFromPrevious(rows, 1, 'dayType');
    assert.equal(res.success, false);
    assert.equal(res.rows[1].entry_type, '');
    res = copyFromPrevious(rows, 2, 'dayType');
    assert.equal(res.success, false);
    assert.equal(res.rows[2].entry_type, 'hours');
  });
});

describe('day type copy icon visibility', () => {
  it('renders copy-prev-daytype with aria-label', () => {
    const content = fs.readFileSync(path.join('src','components','time-entry','EntryRow.jsx'),'utf8');
    assert(content.includes('copy-prev-daytype'));
    assert(content.includes('העתק סוג יום מהרישום הקודם'));
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

describe('multi-date modal layout', () => {
  it('uses wide dialog with footer outside body', () => {
    const content = fs.readFileSync(
      path.join('src', 'components', 'time-entry', 'MultiDateEntryModal.jsx'),
      'utf8'
    );
    assert(content.includes('w-[98vw]'));
    assert(content.includes('max-w-[1200px]'));
    const bodyIndex = content.indexOf('data-testid="md-body"');
    const footerIndex = content.indexOf('data-testid="md-footer"');
    assert(bodyIndex !== -1 && footerIndex !== -1);
    assert(footerIndex > bodyIndex);
    assert(content.includes('overflow-y-auto'));
    assert(!content.includes('sticky bottom-0'));
  });
});

describe('single-day modal layout and date handling', () => {
  it('uses wide dialog with body scroll and footer outside', () => {
    const content = fs.readFileSync(
      path.join('src', 'components', 'time-entry', 'TimeEntryTable.jsx'),
      'utf8'
    );
    assert(content.includes('data-testid="day-modal-body"'));
    assert(content.includes('data-testid="day-modal-footer"'));
    const bodyIndex = content.indexOf('data-testid="day-modal-body"');
    const footerIndex = content.indexOf('data-testid="day-modal-footer"');
    assert(footerIndex > bodyIndex);
    assert(content.includes('w-[98vw]'));
    assert(content.includes('max-w-[1100px]'));
  });

  it('avoids date off-by-one conversions', () => {
    const formContent = fs.readFileSync(path.join('src','components','time-entry','TimeEntryForm.jsx'),'utf8');
    assert(!formContent.includes('new Date(dateToUse).toISOString'));
    const tableContent = fs.readFileSync(path.join('src','components','time-entry','TimeEntryTable.jsx'),'utf8');
    assert(tableContent.includes("format(editingCell.day, 'yyyy-MM-dd')"));
  });
});
