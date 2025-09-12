import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseHebrewCsv, validateImportRow } from '../src/lib/csvMapping.js';

const services = [
  { id: '1', name: 'חוג אנגלית', payment_model: 'per_student' },
  { id: '2', name: 'שיעור פרטי', payment_model: 'per_session' }
];

const hourlyEmp = { id: 'e1', employee_type: 'hourly', working_days: ['SUN','MON','TUE','WED','THU'] };
const globalEmp = { id: 'e2', employee_type: 'global', working_days: ['SUN','MON','TUE','WED','THU'] };

function stubRate(rate) {
  return () => ({ rate });
}

describe('parseHebrewCsv', () => {
  it('maps Hebrew headers and values', () => {
    const csv = 'תאריך,סוג רישום,שירות,שעות,מספר שיעורים,מספר תלמידים\n10/02/2024,שיעור,חוג אנגלית,,1,5';
    const rows = parseHebrewCsv(csv, services);
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.date, '2024-02-10');
    assert.equal(row.entry_type, 'session');
    assert.equal(row.service_id, '1');
    assert.equal(row.sessions_count, 1);
    assert.equal(row.students_count, 5);
    assert.equal(row.errors.length, 0);
  });

  it('flags unknown service', () => {
    const csv = 'תאריך,סוג רישום,שירות\n10/02/2024,שיעור,לא קיים';
    const rows = parseHebrewCsv(csv, services);
    assert.equal(rows[0].errors[0], 'Unknown service: לא קיים');
  });

  it('handles invalid dates', () => {
    const csv = 'תאריך,סוג רישום\n31/02/2024,שעות';
    const rows = parseHebrewCsv(csv, services);
    assert.equal(rows[0].errors[0], 'Invalid date');
  });
});

describe('validateImportRow', () => {
  it('computes global daily rate and paid_leave', () => {
    const row = { date: '2024-02-10', entry_type: 'hours', errors: [] };
    const validated = validateImportRow(row, globalEmp, services, stubRate(10000));
    assert.equal(validated.total_payment, 10000 / 21);
    const leaveRow = { date: '2024-02-11', entry_type: 'paid_leave', errors: [] };
    const validatedLeave = validateImportRow(leaveRow, globalEmp, services, stubRate(10000));
    assert.equal(validatedLeave.total_payment, 10000 / 21);
  });
});

describe('integration', () => {
  it('imports valid rows', () => {
    const csv = 'תאריך,סוג רישום,שירות,שעות,מספר שיעורים,מספר תלמידים\n01/03/2024,שעות,,8,,\n02/03/2024,שיעור,שיעור פרטי,,1,\n03/03/2024,חופשה בתשלום,,,,';
    const rows = parseHebrewCsv(csv, services);
    const validated = rows.map(r => validateImportRow(r, globalEmp, services, stubRate(10000)));
    assert.equal(validated.filter(r => r.errors.length).length, 0);
    assert.equal(validated.length, 3);
  });

  it('rejects invalid rows', () => {
    const csv = 'תאריך,סוג רישום,שירות\n32/01/2024,שעות,\n10/02/2024,שיעור,לא קיים';
    const rows = parseHebrewCsv(csv, services);
    const validated = rows.map(r => validateImportRow(r, hourlyEmp, services, stubRate(50)));
    assert.equal(validated.filter(r => r.errors.length).length, 2);
  });
});
