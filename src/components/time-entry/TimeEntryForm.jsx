import React, { useState, useMemo } from 'react';
import SingleDayEntryShell from './shared/SingleDayEntryShell.jsx';
import GlobalSegment from './segments/GlobalSegment.jsx';
import HourlySegment from './segments/HourlySegment.jsx';
import InstructorSegment from './segments/InstructorSegment.jsx';
import { calculateGlobalDailyRate } from '@/lib/payroll.js';
import { sumHours, removeSegment } from './dayUtils.js';
import ConfirmPermanentDeleteModal from './ConfirmPermanentDeleteModal.jsx';
import { deleteWorkSession } from '@/api/workSessions.js';
import { toast } from 'sonner';
import { format } from 'date-fns';
import he from '@/i18n/he.json';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

export default function TimeEntryForm({ employee, services = [], onSubmit, getRateForDate, initialRows = null, selectedDate, onDeleted, initialDayType = 'regular', paidLeaveId = null, paidLeaveNotes: initialPaidLeaveNotes = '' }) {
  const isGlobal = employee.employee_type === 'global';
  const isHourly = employee.employee_type === 'hourly';

  const createSeg = () => ({ id: crypto.randomUUID(), hours: '', service_id: '', sessions_count: '', students_count: '', notes: '', _status: 'new' });
  const [segments, setSegments] = useState(() => {
    if (initialDayType === 'paid_leave') return initialRows || [];
    return initialRows && initialRows.length > 0
      ? initialRows.map(r => ({ ...r, id: r.id || crypto.randomUUID(), _status: 'existing' }))
      : [createSeg()];
  });
  const [dayType, setDayType] = useState(initialDayType);
  const [paidLeaveNotes, setPaidLeaveNotes] = useState(initialPaidLeaveNotes);
  const [errors, setErrors] = useState({});
  const [pendingDelete, setPendingDelete] = useState(null);

  const dailyRate = useMemo(() => {
    if (!isGlobal) return 0;
    const { rate } = getRateForDate(employee.id, selectedDate, null);
    try { return calculateGlobalDailyRate(employee, selectedDate, rate); } catch { return 0; }
  }, [employee, selectedDate, getRateForDate, isGlobal]);

  const addSeg = () => setSegments(prev => [...prev, createSeg()]);
  const duplicateSeg = (id) => {
    setSegments(prev => {
      const idx = prev.findIndex(s => s.id === id);
      const copy = { ...prev[idx], id: crypto.randomUUID(), _status: 'new' };
      return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
    });
  };
  const deleteSeg = (id) => {
    const target = segments.find(s => s.id === id);
    if (!target) return;
    if (target._status === 'new') {
      const res = removeSegment(segments, id);
      if (res.removed) setSegments(res.rows);
      return;
    }
    const active = segments.filter(s => s._status !== 'deleted');
    if (active.length <= 1) return;
    const summary = {
      employeeName: employee.name,
      date: format(new Date(selectedDate + 'T00:00:00'), 'dd/MM/yyyy'),
      entryTypeLabel: isHourly || isGlobal ? 'שעות' : 'מפגש',
      hours: isHourly || isGlobal ? target.hours : null,
      meetings: isHourly || isGlobal ? null : target.sessions_count
    };
    setPendingDelete({ id, summary });
  };
  const confirmDelete = async () => {
    try {
      await deleteWorkSession(pendingDelete.id);
      setSegments(prev => prev.filter(s => s.id !== pendingDelete.id));
      onDeleted?.(pendingDelete.id);
      toast.success(he['toast.delete.success']);
      setPendingDelete(null);
    } catch (err) {
      toast.error(he['toast.delete.error']);
      throw err;
    }
  };
  const changeSeg = (id, patch) => setSegments(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));

  const validate = () => {
    const err = {};
    segments.filter(s => s._status !== 'deleted').forEach(s => {
      if (isGlobal || isHourly) {
        const h = parseFloat(s.hours);
        if (!h || h <= 0) err[s.id] = 'שעות נדרשות וגדולות מ־0';
      } else {
        if (!s.service_id) err[s.id] = 'חסר שירות';
        if (!(parseInt(s.sessions_count) >= 1)) err[s.id] = 'מספר שיעורים נדרש';
        if (!(parseInt(s.students_count) >= 1)) err[s.id] = 'מספר תלמידים נדרש';
      }
    });
    setErrors(err);
    return Object.keys(err).length === 0;
  };

  const handleSave = (e) => {
    e.preventDefault();
    if (dayType === 'paid_leave') {
      const conflicts = segments.filter(s => {
        if (s._status === 'deleted') return false;
        if (s._status === 'existing') return true;
        const hasData =
          (s.hours && parseFloat(s.hours) > 0) ||
          s.service_id ||
          s.sessions_count ||
          s.students_count;
        return hasData;
      });
      if (conflicts.length > 0) {
        const dateStr = format(new Date(selectedDate + 'T00:00:00'), 'dd/MM/yyyy');
        const details = conflicts.map(c => {
          const hrs = c.hours ? `, ${c.hours} שעות` : '';
          return `${employee.name} ${dateStr}${hrs} (ID ${c.id})`;
        }).join('\n');
        toast.error(`קיימים רישומי עבודה מתנגשים:\n${details}`);
        return;
      }
      onSubmit({ rows: [], dayType, paidLeaveId, paidLeaveNotes });
      return;
    }
    if (!validate()) return;
    onSubmit({ rows: segments, dayType, paidLeaveId });
  };

  const summary = useMemo(() => {
    const active = segments.filter(s => s._status !== 'deleted');
    if (isGlobal) return `שכר יומי: ₪${dailyRate.toFixed(2)}`;
    if (isHourly) {
      const { rate } = getRateForDate(employee.id, selectedDate, null);
      const h = sumHours(active);
      return `שכר יומי: ₪${(h * rate).toFixed(2)} | סה"כ שעות: ${h}`;
    }
    const total = active.reduce((acc, s) => {
      const { rate } = getRateForDate(employee.id, selectedDate, s.service_id || null);
      return acc + (parseFloat(s.sessions_count || 0) * parseFloat(s.students_count || 0) * rate);
    }, 0);
    return `שכר יומי: ₪${total.toFixed(2)}`;
  }, [segments, isGlobal, isHourly, dailyRate, employee, selectedDate, getRateForDate]);

  const renderSegment = (seg, idx) => {
    if (isGlobal) {
      return <GlobalSegment key={seg.id} segment={seg} onChange={changeSeg} onDuplicate={duplicateSeg} onDelete={deleteSeg} isFirst={idx === 0} dailyRate={dailyRate} error={errors[seg.id]} />;
    }
    if (isHourly) {
      const { rate } = getRateForDate(employee.id, selectedDate, null);
      return <HourlySegment key={seg.id} segment={seg} onChange={changeSeg} onDuplicate={duplicateSeg} onDelete={deleteSeg} rate={rate} error={errors[seg.id]} />;
    }
    const { rate } = getRateForDate(employee.id, selectedDate, seg.service_id || null);
    return <InstructorSegment key={seg.id} segment={seg} services={services} onChange={changeSeg} onDuplicate={duplicateSeg} onDelete={deleteSeg} rate={rate} errors={{ service: !seg.service_id && errors[seg.id], sessions_count: errors[seg.id] && seg.service_id ? errors[seg.id] : null, students_count: errors[seg.id] && seg.service_id ? errors[seg.id] : null }} />;
  };

  const addLabel = isHourly || isGlobal ? 'הוסף מקטע שעות' : 'הוסף רישום';

  const renderPaidLeaveSegment = () => (
    <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 p-4 md:p-5">
      <div className="space-y-1">
        <Label className="text-sm font-medium text-slate-700">הערות</Label>
        <Textarea
          value={paidLeaveNotes}
          onChange={e => setPaidLeaveNotes(e.target.value)}
          className="bg-white text-base leading-6"
          rows={2}
          maxLength={300}
          placeholder="הערה חופשית (לא חובה)"
        />
      </div>
    </div>
  );

  return (
    <form onSubmit={handleSave} className="flex flex-col w-[min(98vw,1100px)] max-w-[98vw] h-[min(92vh,calc(100dvh-2rem))]">
      <SingleDayEntryShell
        employee={employee}
        date={selectedDate}
        showDayType={isGlobal}
        dayType={dayType}
        onDayTypeChange={setDayType}
        segments={dayType === 'paid_leave' ? [{ id: 'paid_leave_notes' }] : segments.filter(s => s._status !== 'deleted')}
        renderSegment={dayType === 'paid_leave' ? renderPaidLeaveSegment : renderSegment}
        onAddSegment={dayType === 'paid_leave' ? null : addSeg}
        addLabel={addLabel}
        summary={summary}
        onCancel={() => onSubmit(null)}
      />
      <ConfirmPermanentDeleteModal
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        summary={pendingDelete ? pendingDelete.summary : null}
      />
    </form>
  );
}
