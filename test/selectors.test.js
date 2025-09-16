import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectGlobalHours,
  selectTotalHours,
  selectHolidayForDate,
  selectLeaveRemaining,
} from '../src/selectors.js';

const employees = [
  { id: 'g1', employee_type: 'global' },
  { id: 'g2', employee_type: 'global' },
  { id: 'h1', employee_type: 'hourly' },
  { id: 'i1', employee_type: 'instructor' }
];

const services = [
  { id: 's1', duration_minutes: 60 }
];

const entries = [
  { employee_id: 'g1', entry_type: 'hours', hours: 2, date: '2024-02-01' },
  { employee_id: 'g1', entry_type: 'hours', hours: 3, date: '2024-02-01' },
  { employee_id: 'g1', entry_type: 'leave_system_paid', hours: 4, date: '2024-02-02' },
  { employee_id: 'g2', entry_type: 'hours', hours: 4, date: '2024-02-01' },
  { employee_id: 'g2', entry_type: 'hours', hours: 1, date: '2024-03-01' },
  { employee_id: 'h1', entry_type: 'hours', hours: 8, date: '2024-02-01' },
  { employee_id: 'i1', entry_type: 'session', sessions_count: 1, service_id: 's1', date: '2024-02-01' }
];

const leavePolicy = {
  allow_half_day: true,
  carryover_enabled: true,
  carryover_max_days: 3,
  holiday_rules: [
    { id: 'r1', name: 'ערב חג', type: 'half_day', start_date: '2025-04-21', end_date: '2025-04-21' },
  ],
};

const leaveBalances = [
  { employee_id: 'g1', date: '2024-02-10', days_delta: -1 },
  { employee_id: 'g1', date: '2024-06-01', days_delta: 2 },
  { employee_id: 'g1', date: '2025-01-05', days_delta: -0.5 },
];

describe('selectors', () => {
  it('selectGlobalHours respects filters', () => {
    const total = selectGlobalHours(entries, employees, { dateFrom: '2024-02-01', dateTo: '2024-02-28' });
    assert.equal(total, 9);
    const single = selectGlobalHours(entries, employees, { dateFrom: '2024-02-01', dateTo: '2024-02-28', selectedEmployee: 'g1' });
    assert.equal(single, 5);
  });

  it('selectTotalHours sums all sources', () => {
    const total = selectTotalHours(entries, services, employees, { dateFrom: '2024-02-01', dateTo: '2024-02-28' });
    assert.equal(total, 18);
  });

  it('selectHolidayForDate resolves rule by date', () => {
    const rule = selectHolidayForDate(leavePolicy, '2025-04-21');
    assert.ok(rule);
    assert.equal(rule.type, 'half_day');
  });

  it('selectLeaveRemaining computes summary', () => {
    const summary = selectLeaveRemaining('g1', '2025-02-01', {
      employees: [
        { id: 'g1', employee_type: 'global', annual_leave_days: 12, start_date: '2024-01-15' },
      ],
      leaveBalances,
      policy: leavePolicy,
    });
    assert.ok(summary.quota > 0);
    assert.ok(summary.remaining <= summary.quota);
  });
});
