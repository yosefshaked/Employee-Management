import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveWorkingDays, calculateGlobalDailyRate, aggregateGlobalDays, aggregateGlobalDayForDate } from '../src/lib/payroll.js';
import { computePeriodTotals, clampDateString } from '../src/lib/payroll.js';
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

describe('global day aggregation', () => {
  const emp = { id: 'e1', employee_type: 'global', working_days: ['SUN','MON','TUE','WED','THU'] };
  it('global_same_day_counted_once', () => {
    const monthlyRate = 3000;
    const daily = calculateGlobalDailyRate(emp, '2024-02-05', monthlyRate);
    const rows = [
      { employee_id: 'e1', date: '2024-02-05', entry_type: 'hours', total_payment: daily },
      { employee_id: 'e1', date: '2024-02-05', entry_type: 'hours', total_payment: daily }
    ];
    const agg = aggregateGlobalDays(rows, { e1: emp });
    let sum = 0; agg.forEach(v => { sum += v.dailyAmount; });
    assert.equal(sum, daily);
  });
  it('global_two_days_counted_twice', () => {
    const monthlyRate = 3000;
    const daily = calculateGlobalDailyRate(emp, '2024-02-05', monthlyRate);
    const rows = [
      { employee_id: 'e1', date: '2024-02-05', entry_type: 'hours', total_payment: daily },
      { employee_id: 'e1', date: '2024-02-06', entry_type: 'hours', total_payment: daily }
    ];
    const agg = aggregateGlobalDays(rows, { e1: emp });
    let sum = 0; agg.forEach(v => { sum += v.dailyAmount; });
    assert.equal(sum, daily * 2);
  });
  it('session_hourly_unchanged', () => {
    const rows = [
      { employee_id: 'e2', entry_type: 'hours', total_payment: 100 },
      { employee_id: 'e2', entry_type: 'hours', total_payment: 100 },
      { employee_id: 'e3', entry_type: 'session', total_payment: 50 }
    ];
    const agg = aggregateGlobalDays(rows, { e2: { id: 'e2', employee_type: 'hourly' }, e3: { id: 'e3', employee_type: 'instructor' } });
    assert.equal(Array.from(agg.keys()).length, 0);
    const total = rows.reduce((s,r)=>s+r.total_payment,0);
    assert.equal(total, 250);
  });
});

describe('aggregateGlobalDayForDate', () => {
  const emp = { id: 'e1', employee_type: 'global', working_days: ['SUN','MON','TUE','WED','THU'] };
  it('counts only once per day', () => {
    const daily = calculateGlobalDailyRate(emp, '2024-02-05', 3000);
    const rows = [
      { id: 'r1', employee_id: 'e1', date: '2024-02-05', entry_type: 'hours', total_payment: daily },
      { id: 'r2', employee_id: 'e1', date: '2024-02-05', entry_type: 'hours', total_payment: daily }
    ];
    const agg = aggregateGlobalDayForDate(rows, { e1: emp });
    assert.equal(agg.total, daily);
    assert.equal(agg.byKey.get('e1|2024-02-05').firstRowId, 'r1');
  });
  it('counts different days separately', () => {
    const daily = calculateGlobalDailyRate(emp, '2024-02-05', 3000);
    const rows = [
      { id: 'r1', employee_id: 'e1', date: '2024-02-05', entry_type: 'hours', total_payment: daily },
      { id: 'r2', employee_id: 'e1', date: '2024-02-06', entry_type: 'hours', total_payment: daily }
    ];
    const agg = aggregateGlobalDayForDate(rows, { e1: emp });
    assert.equal(agg.total, daily * 2);
  });
});

describe('computePeriodTotals aggregator', () => {
  const employees = [
    { id: 'g1', employee_type: 'global', working_days: ['SUN','MON','TUE','WED','THU'] },
    { id: 'h1', employee_type: 'hourly' },
    { id: 'i1', employee_type: 'instructor' }
  ];
  const services = [
    { id: 's1', duration_minutes: 60 },
    { id: 's2', duration_minutes: 30 }
  ];
  const rows = [
    { employee_id: 'g1', date: '2024-02-05', entry_type: 'hours', total_payment: 100, rate_used: 3000 },
    { employee_id: 'g1', date: '2024-02-05', entry_type: 'hours', total_payment: 100, rate_used: 3000 },
    { employee_id: 'g1', date: '2024-02-06', entry_type: 'paid_leave', total_payment: 100, rate_used: 3000 },
    { employee_id: 'h1', date: '2024-02-05', entry_type: 'hours', total_payment: 200, hours: 8 },
    { employee_id: 'i1', date: '2024-02-05', entry_type: 'session', total_payment: 150, sessions_count: 3, students_count: 5, service_id: 's1' },
    { employee_id: 'i1', date: '2024-02-06', entry_type: 'session', total_payment: 100, sessions_count: 2, students_count: 2, service_id: 's2' },
    { employee_id: 'h1', date: '2024-02-07', entry_type: 'adjustment', total_payment: 50 }
  ];

  const res = computePeriodTotals({
    workSessions: rows,
    employees,
    services,
    startDate: '2024-02-01',
    endDate: '2024-02-28'
  });

  it('global_many_segments_one_day_counts_once', () => {
    const emp = res.totalsByEmployee.find(e => e.employee_id === 'g1');
    assert.equal(emp.pay, 200);
    assert.equal(res.diagnostics.uniquePaidDays, 2);
  });

  it('instructors_sessions_times_students_times_rate', () => {
    const emp = res.totalsByEmployee.find(e => e.employee_id === 'i1');
    assert.equal(emp.pay, 250);
    assert.equal(emp.sessions, 5);
    assert.equal(Math.round(res.totalHours * 10) / 10, 8);
  });

  it('hourly_hours_times_rate', () => {
    const emp = res.totalsByEmployee.find(e => e.employee_id === 'h1');
    assert.equal(emp.pay, 250);
    assert.equal(emp.hours, 8);
  });

  it('adjustments_affect_payment_only', () => {
    assert.equal(res.diagnostics.adjustmentsSum, 50);
    assert.equal(res.totalPay, 700);
  });

  it('reports_header_equals_sum_of_table', () => {
    const sum = res.totalsByEmployee.reduce((s, e) => s + e.pay, 0);
    assert.equal(sum, res.totalPay);
  });
  it('dashboard_uses_same_aggregator', () => {
    const dash = computePeriodTotals({
      workSessions: rows,
      employees,
      services,
      startDate: '2024-02-01',
      endDate: '2024-02-28'
    });
    assert.equal(dash.totalPay, res.totalPay);
  });
});

describe('clampDateString', () => {
  it('invalid_end_date_clamped_or_blocked', () => {
    assert.equal(clampDateString('2023-09-31'), '2023-09-30');
  });
});
