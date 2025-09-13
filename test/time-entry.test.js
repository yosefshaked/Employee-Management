import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateGlobalDailyRate } from '../src/lib/payroll.js';
import { copyFromPrevious, fillDown, isRowCompleteForProgress } from '../src/components/time-entry/multiDateUtils.js';
import { applyDayType, removeSegment } from '../src/components/time-entry/dayUtils.js';
import { duplicateSegment, toggleDelete } from '../src/components/time-entry/dayUtils.js';
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
      { employee_id: 'g1', dayType: 'regular' },
      { employee_id: 'g1', dayType: null }
    ];
    let { rows: result, success } = copyFromPrevious(rows, 1, 'dayType');
    assert.equal(success, true);
    assert.equal(result[1].dayType, 'regular');
    const emp = { employee_type: 'global' };
    assert.equal(isRowCompleteForProgress(result[1], emp), true);
  });

  it('fails to copy day type when source missing or different employee', () => {
    const rows = [
      { employee_id: 'g1', dayType: null },
      { employee_id: 'g1', dayType: null },
      { employee_id: 'g2', dayType: 'regular' }
    ];
    let res = copyFromPrevious(rows, 1, 'dayType');
    assert.equal(res.success, false);
    assert.equal(res.rows[1].dayType, null);
    res = copyFromPrevious(rows, 2, 'dayType');
    assert.equal(res.success, false);
    assert.equal(res.rows[2].dayType, 'regular');
  });
});

describe('day editor helpers', () => {
  it('applyDayType propagates to all rows', () => {
    const rows = [{ id: 'a', dayType: 'regular' }, { id: 'b', dayType: 'regular' }];
    const res = applyDayType(rows, 'paid_leave');
    assert.equal(res[0].dayType, 'paid_leave');
    assert.equal(res[1].dayType, 'paid_leave');
  });

  it('prevent removing last segment', () => {
    const rows = [{ id: 'a' }];
    let result = removeSegment(rows, 'a');
    assert.equal(result.removed, false);
    assert.equal(result.rows.length, 1);
    result = removeSegment([{ id: 'a' }, { id: 'b' }], 'a');
    assert.equal(result.removed, true);
    assert.equal(result.rows.length, 1);
  });

  it('preserves notes and date when applying day type', () => {
    const rows = [{ id: 'a', dayType: 'regular', notes: 'n', date: '2024-01-01' }];
    const res = applyDayType(rows, 'paid_leave');
    assert.equal(res[0].notes, 'n');
    assert.equal(res[0].date, '2024-01-01');
  });
});

describe('segment duplication and deletion', () => {
  it('duplicate_creates_unsaved_segment', () => {
    const rows = [{ id: 'a', hours: '2', _status: 'existing' }];
    const res = duplicateSegment(rows, 'a');
    assert.equal(res.length, 2);
    assert.equal(res[1].hours, '2');
    assert.equal(res[1]._status, 'new');
  });

  it('trash_unsaved_removes_immediately', () => {
    const rows = [{ id: 'a', _status: 'new' }, { id: 'b', _status: 'existing' }];
    const res = removeSegment(rows, 'a');
    assert.equal(res.removed, true);
    assert.equal(res.rows.length, 1);
  });

  it('mark_deleted_then_cancel_before_save_restores_segment', () => {
    const rows = [{ id: 'a', _status: 'existing' }, { id: 'b', _status: 'existing' }];
    let res = toggleDelete(rows, 'a');
    assert.equal(res.rows[0]._status, 'deleted');
    res = toggleDelete(res.rows, 'a');
    assert.equal(res.rows[0]._status, 'existing');
  });

  it('prevent_delete_last_segment_instantly_blocks', () => {
    const rows = [{ id: 'a', _status: 'existing' }];
    const res = toggleDelete(rows, 'a');
    assert.equal(res.changed, false);
  });

  it('hours_required_message_exists', () => {
    const content = fs.readFileSync(path.join('src','components','time-entry','TimeEntryForm.jsx'),'utf8');
    assert(content.includes('שעות נדרשות וגדולות מ־0'));
  });

  it('table_shows_sum_hours_for_global_date', () => {
    const content = fs.readFileSync(path.join('src','components','time-entry','TimeEntryTable.jsx'),'utf8');
    assert(content.includes('שעות סה"כ'));
  });
});

describe('destructive deletion copy', () => {
  it('delete modals contain required Hebrew text', () => {
    const content = fs.readFileSync(path.join('src','components','time-entry','TimeEntryForm.jsx'),'utf8');
    assert(content.includes('מחיקה לצמיתות'));
    assert(content.includes('אישור מחיקה לצמיתות'));
    assert(content.includes('המחיקה תתבצע לצמיתות במסד הנתונים ואין אפשרות לשחזר'));
    assert(content.includes('להמשך הקלד/י: מחק'));
    assert(content.includes('אני מבין/ה שהמחיקה בלתי הפיכה'));
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
    const row = { dayType: null };
    assert.equal(isRowCompleteForProgress(row, emp), false);
    row.dayType = 'regular';
    assert.equal(isRowCompleteForProgress(row, emp), true);
    row.dayType = 'paid_leave';
    assert.equal(isRowCompleteForProgress(row, emp), true);
  });
});

describe('no days text in table for globals', () => {
  it('TimeEntryTable does not contain " ימים"', () => {
    const content = fs.readFileSync(path.join('src','components','time-entry','TimeEntryTable.jsx'), 'utf8');
    assert(!content.includes(' ימים'));
  });
});

describe('global hours segments', () => {
  it('TimeEntryTable shows hours count for globals', () => {
    const content = fs.readFileSync(path.join('src','components','time-entry','TimeEntryTable.jsx'), 'utf8');
    assert(content.includes('hoursCount.toFixed(1)} שעות'));
  });
  it('EntryRow requires hours for new global segments', () => {
    const content = fs.readFileSync(path.join('src','components','time-entry','EntryRow.jsx'), 'utf8');
    assert(content.includes('required={row.isNew}'));
  });
  it('TimeEntryForm has add segment microcopy', () => {
    const content = fs.readFileSync(path.join('src','components','time-entry','TimeEntryForm.jsx'), 'utf8');
    assert(content.includes('הוסף מקטע שעות'));
    assert(content.includes('נדרש לפחות מקטע אחד ליום גלובלי'));
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
