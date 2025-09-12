import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveWorkingDays, calculateGlobalDailyRate } from '../src/lib/payroll.js';
import { eachMonthOfInterval } from 'date-fns';

const empSunThu = { working_days: ['SUN','MON','TUE','WED','THU'] };
const empSunFri = { working_days: ['SUN','MON','TUE','WED','THU','FRI'] };
const empAll = { working_days: ['SUN','MON','TUE','WED','THU','FRI','SAT'] };

describe('effectiveWorkingDays', () => {
  const months = eachMonthOfInterval({ start: new Date('2024-01-01'), end: new Date('2024-12-01') });
  it('handles SUN-THU pattern', () => {
    const feb = months.find(m => m.getMonth() === 1);
    assert.equal(effectiveWorkingDays(empSunThu, feb), 21);
  });
  it('handles SUN-FRI pattern', () => {
    const feb = months.find(m => m.getMonth() === 1);
    assert.equal(effectiveWorkingDays(empSunFri, feb), 25);
  });
  it('handles SUN-SAT pattern', () => {
    const feb = months.find(m => m.getMonth() === 1);
    assert.equal(effectiveWorkingDays(empAll, feb), 29);
  });
});

describe('calculateGlobalDailyRate', () => {
  it('computes correct daily rate', () => {
    const rate = calculateGlobalDailyRate(empSunThu, new Date('2024-02-10'), 1000);
    assert.equal(rate, 1000 / 21);
  });
  it('throws when no working days', () => {
    assert.throws(() => calculateGlobalDailyRate({ working_days: [] }, new Date('2024-02-10'), 1000));
  });
});

describe('paid_leave inclusion', () => {
  it('sums paid leave correctly', () => {
    const monthlyRate = 3000;
    const dailyRate = calculateGlobalDailyRate(empSunThu, new Date('2024-02-05'), monthlyRate);
    const sessions = [
      { entry_type: 'paid_leave', total_payment: dailyRate },
      { entry_type: 'hours', total_payment: dailyRate * 2 },
      { entry_type: 'adjustment', total_payment: 100 },
    ];
    const total = sessions.reduce((sum, s) => sum + s.total_payment, 0);
    assert.equal(total, dailyRate * 3 + 100);
  });
});

describe('rate snapshots and adjustments', () => {
  it('uses per-row rate snapshots for instructors', () => {
    const rows = [
      { entry_type: 'session', sessions_count: 1, students_count: 2, rate_used: 50, total_payment: 100 },
      { entry_type: 'session', sessions_count: 1, students_count: 2, rate_used: 60, total_payment: 120 },
    ];
    const total = rows.reduce((sum, r) => sum + r.total_payment, 0);
    assert.equal(total, 220);
  });

  it('counts adjustments once', () => {
    const rows = [
      { entry_type: 'hours', total_payment: 100 },
      { entry_type: 'adjustment', total_payment: -20 },
    ];
    const total = rows.reduce((sum, r) => sum + r.total_payment, 0);
    assert.equal(total, 80);
  });
});
