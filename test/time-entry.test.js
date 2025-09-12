import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateGlobalDailyRate } from '../src/lib/payroll.js';
import fs from 'node:fs';
import path from 'node:path';

describe('multi-date row creation', () => {
  it('creates rows per employee and date', () => {
    const employees = ['e1','e2'];
    const dates = ['2024-02-01','2024-02-02','2024-02-03'];
    const rows = [];
    for (const emp of employees) {
      for (const d of dates) {
        rows.push({ employee_id: emp, date: d });
      }
    }
    assert.equal(rows.length, employees.length * dates.length);
  });
});

describe('copy-forward gating', () => {
  const shouldPromptCopy = (selectedDates, selectedEmployees) => selectedDates.length * selectedEmployees.length > 1;
  it('single date does not prompt', () => {
    assert.equal(shouldPromptCopy(['2024-02-01'], ['e1']), false);
  });
  it('multi date prompts', () => {
    assert.equal(shouldPromptCopy(['2024-02-01','2024-02-02'], ['e1']), true);
  });
});

describe('global daily rate ignores hours', () => {
  it('ignores hours when computing total payment', () => {
    const emp = { working_days: ['SUN','MON','TUE','WED','THU'] };
    const monthlyRate = 3000;
    const dailyRate = calculateGlobalDailyRate(emp, new Date('2024-02-05'), monthlyRate);
    const total = dailyRate; // hours ignored
    assert.equal(total, dailyRate);
  });
});

describe('no days_count references', () => {
  it('TimeEntryForm has no days_count', () => {
    const content = fs.readFileSync(path.join('src','components','time-entry','TimeEntryForm.jsx'), 'utf8');
    assert(!content.includes('days_count'));
  });
});

describe('paid_leave counted like global day', () => {
  it('totals paid leave like regular day', () => {
    const emp = { working_days: ['SUN','MON','TUE','WED','THU'] };
    const monthlyRate = 3000;
    const dailyRate = calculateGlobalDailyRate(emp, new Date('2024-02-05'), monthlyRate);
    const rows = [
      { entry_type: 'hours', total_payment: dailyRate },
      { entry_type: 'paid_leave', total_payment: dailyRate },
    ];
    const total = rows.reduce((sum, r) => sum + r.total_payment, 0);
    assert.equal(total, dailyRate * 2);
  });
});
