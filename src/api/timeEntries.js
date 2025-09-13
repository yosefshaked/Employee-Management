export async function deleteTimeEntry(id) {
  const res = await fetch(`/api/time-entries/${id}?hard=true`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(text || 'Failed to delete');
  }
}

export async function bulkDeleteTimeEntries(ids) {
  const res = await fetch('/api/time-entries/bulk-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, hard: true })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to delete');
  }
  return res.json();
}
