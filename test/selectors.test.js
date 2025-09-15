import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { selectGlobalHours, selectTotalHours } from '../src/selectors.js';

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
  { employee_id: 'g1', entry_type: 'paid_leave', hours: 4, date: '2024-02-02' },
  { employee_id: 'g2', entry_type: 'hours', hours: 4, date: '2024-02-01' },
  { employee_id: 'g2', entry_type: 'hours', hours: 1, date: '2024-03-01' },
  { employee_id: 'h1', entry_type: 'hours', hours: 8, date: '2024-02-01' },
  { employee_id: 'i1', entry_type: 'session', sessions_count: 1, service_id: 's1', date: '2024-02-01' }
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
});
