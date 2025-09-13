export function parseDateStrict(input) {
  if (!input) return { ok: false, date: null, error: 'format' };
  const match = input.trim().match(/^([0-9]{2})\/([0-9]{2})\/([0-9]{4})$/);
  if (!match) return { ok: false, date: null, error: 'format' };
  const day = Number(match[1]);
  const month = Number(match[2]) - 1;
  const year = Number(match[3]);
  const d = new Date(Date.UTC(year, month, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month || d.getUTCDate() !== day) {
    return { ok: false, date: null, error: 'range' };
  }
  return { ok: true, date: d };
}

export function toISODateString(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isValidRange(start, end) {
  return !!(start && end && start <= end);
}
