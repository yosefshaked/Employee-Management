import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseHebrewCsv } from '../src/lib/csv.js';

const services = [
  { id: '1', name: 'חוג אנגלית' },
  { id: '2', name: 'חוג מתמטיקה' }
];

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
