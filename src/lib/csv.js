const typeMap = {
  'שיעור': 'session',
  'שעות': 'hours',
  'התאמה': 'adjustment',
  'חופשה בתשלום': 'paid_leave',
};

const headerMap = {
  'תאריך': 'date',
  'סוג רישום': 'entry_type',
  'שירות': 'service_name',
  'שעות': 'hours',
  'מספר שיעורים': 'sessions_count',
  'מספר תלמידים': 'students_count',
};

function parseDate(value) {
  if (!value) return { error: 'Invalid date' };
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return { error: 'Invalid date' };
  const [, day, month, year] = match;
  const iso = `${year}-${month}-${day}`;
  const d = new Date(iso);
  if (d.getFullYear() !== Number(year) || (d.getMonth() + 1) !== Number(month) || d.getDate() !== Number(day)) {
    return { error: 'Invalid date' };
  }
  return { value: iso };
}

export function parseHebrewCsv(text, services = []) {
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  const indices = {};
  headers.forEach((h, idx) => {
    const key = headerMap[h];
    if (key) indices[key] = idx;
  });
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = line.split(',').map(c => c.trim());
    const row = { errors: [] };
    const dateRes = parseDate(cols[indices.date]);
    if (dateRes.error) row.errors.push(dateRes.error); else row.date = dateRes.value;
    const typeLabel = cols[indices.entry_type];
    row.entry_type = typeMap[typeLabel];
    if (!row.entry_type) row.errors.push('Unknown entry_type');
    const serviceName = indices.service_name !== undefined ? cols[indices.service_name] : '';
    if (serviceName) {
      const service = services.find(s => s.name === serviceName);
      if (service) row.service_id = service.id; else row.errors.push(`Unknown service: ${serviceName}`);
    }
    row.hours = indices.hours !== undefined ? parseFloat(cols[indices.hours]) || null : null;
    row.sessions_count = indices.sessions_count !== undefined ? parseInt(cols[indices.sessions_count], 10) || null : null;
    row.students_count = indices.students_count !== undefined ? parseInt(cols[indices.students_count], 10) || null : null;
    rows.push(row);
  }
  return rows;
}
