import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Save, Plus, Copy, Trash2, RotateCcw } from 'lucide-react';
import EntryRow from './EntryRow.jsx';
import { removeSegment, duplicateSegment, toggleDelete, sumHours } from './dayUtils.js';
import { toast } from 'sonner';
import { calculateGlobalDailyRate } from '@/lib/payroll.js';

const weekNames = ['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'];

function GlobalForm({ employee, onSubmit, getRateForDate, initialRows, selectedDate, onTotalsChange, hideSubmitButton, formId, dayType }) {
  const createSeg = () => ({ id: crypto.randomUUID(), hours: '', notes: '', _status: 'new' });
  const [segments, setSegments] = useState(() => {
    if (initialRows && initialRows.length > 0) {
      return initialRows.map(r => ({ id: r.id, hours: r.hours || '', notes: r.notes || '', _status: 'existing' }));
    }
    return [createSeg()];
  });
  const [errors, setErrors] = useState({});
  const refs = useRef({});
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [confirmCheck, setConfirmCheck] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkCheck, setBulkCheck] = useState(false);
  const [bulkText, setBulkText] = useState('');

  const { rate } = getRateForDate(employee.id, selectedDate, null);
  let dailyRate = 0;
  try { dailyRate = calculateGlobalDailyRate(employee, selectedDate, rate); } catch { dailyRate = 0; }

  const dateLabel = React.useMemo(() => {
    const d = new Date(selectedDate + 'T00:00:00');
    return `${d.toLocaleDateString('he-IL')} · יום ${weekNames[d.getDay()]}`;
  }, [selectedDate]);

  useEffect(() => {
    const totalH = sumHours(segments);
    onTotalsChange && onTotalsChange({ hours: totalH, daily: dailyRate });
  }, [segments, dailyRate, onTotalsChange]);

    const addSeg = () => {
      const seg = createSeg();
      setSegments(prev => [...prev, seg]);
      setTimeout(() => refs.current[seg.id]?.focus(), 0);
    };

  const duplicate = (id) => {
    setSegments(prev => {
      const updated = duplicateSegment(prev, id);
      const newSeg = updated.find(s => !prev.some(p => p.id === s.id));
      setTimeout(() => refs.current[newSeg.id]?.focus(), 0);
      return updated;
    });
  };

  const deleteSeg = (seg) => {
    if (seg._status === 'new') {
      const res = removeSegment(segments, seg.id);
      if (!res.removed) {
        toast('נדרש לפחות מקטע אחד ליום גלובלי');
      } else {
        setSegments(res.rows);
      }
    } else {
      const active = segments.filter(s => s._status !== 'deleted');
      if (active.length <= 1) {
        toast('נדרש לפחות מקטע אחד ליום גלובלי');
        return;
      }
      setConfirmTarget(seg);
    }
  };

  const undoDelete = (id) => {
    setSegments(prev => toggleDelete(prev, id).rows);
  };

  const confirmDeletion = () => {
    if (!confirmTarget) return;
    const res = toggleDelete(segments, confirmTarget.id);
    if (!res.changed) {
      toast('נדרש לפחות מקטע אחד ליום גלובלי');
    } else {
      setSegments(res.rows);
    }
    setConfirmTarget(null);
    setConfirmCheck(false);
    setConfirmText('');
  };

  const confirmBulk = () => {
    setBulkOpen(false);
    setBulkCheck(false);
    setBulkText('');
    onSubmit({ rows: segments });
  };

  const handleChange = (id, patch) => {
    setSegments(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  };

    const handleSubmit = (e) => {
      e.preventDefault();
      const err = {};
    segments.forEach(s => {
      if (s._status === 'deleted') return;
      const h = parseFloat(s.hours);
      if (s._status === 'new') {
        if (isNaN(h) || h <= 0) err[s.id] = 'שעות נדרשות וגדולות מ־0';
      } else if (isNaN(h) || h < 0) err[s.id] = 'שעות נדרשות וגדולות מ־0';
    });
    if (Object.keys(err).length > 0) {
      setErrors(err);
      return;
    }
    setErrors({});
    if (segments.some(s => s._status === 'deleted')) {
      setBulkOpen(true);
    } else {
      onSubmit({ rows: segments });
    }
  };

    const firstActive = segments.find(s => s._status !== 'deleted');

    useEffect(() => {
      if (dayType && firstActive) {
        setTimeout(() => refs.current[firstActive.id]?.focus(), 0);
      }
    }, [dayType, firstActive]);

    return (
      <>
        <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Button type="button" variant="outline" onClick={addSeg} className="self-start" disabled={!dayType}><Plus className="w-4 h-4 ml-2" />הוסף מקטע שעות</Button>
        <div className="flex flex-col gap-3">
          {segments.map(seg => (
            <div key={seg.id} className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 p-4 md:p-5 relative">
              <div className="absolute top-2 left-2 flex gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button type="button" variant="ghost" size="icon" onClick={() => duplicate(seg.id)} aria-label="שכפל מקטע שעות" className="h-7 w-7"><Copy className="h-4 w-4" /></Button>
                  </TooltipTrigger>
                  <TooltipContent>שכפל מקטע שעות</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => seg._status === 'deleted' ? undoDelete(seg.id) : deleteSeg(seg)}
                      aria-label={seg._status === 'deleted' ? 'בטל מחיקה' : 'מחק מקטע שעות'}
                      className="h-7 w-7"
                    >
                      {seg._status === 'deleted' ? <RotateCcw className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{seg._status === 'deleted' ? 'בטל מחיקה' : 'מחק מקטע שעות'}</TooltipContent>
                </Tooltip>
              </div>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-sm font-medium text-slate-700">שעות</Label>
                  <Input
                    ref={el => refs.current[seg.id] = el}
                    type="number"
                    step="0.25"
                    min="0"
                    value={seg.hours}
                    disabled={seg._status === 'deleted'}
                    onChange={e => handleChange(seg.id, { hours: e.target.value })}
                    className="bg-white h-10 text-base leading-6"
                  />
                  {errors[seg.id] && <p className="text-sm text-red-600">{errors[seg.id]}</p>}
                </div>
                <div className="space-y-1">
                  <Label className="text-sm font-medium text-slate-700">הערות</Label>
                  <Textarea
                    value={seg.notes}
                    disabled={seg._status === 'deleted'}
                    onChange={e => handleChange(seg.id, { notes: e.target.value })}
                    className="bg-white text-base leading-6"
                    rows={2}
                    maxLength={300}
                    placeholder="הערה חופשית (לא חובה)"
                  />
                </div>
              </div>
              <div className="mt-4 text-sm text-right text-slate-700">
                סה"כ לשורה: <span className="font-bold">₪{dailyRate.toFixed(2)}</span>
                {seg.id !== firstActive?.id && <span className="block text-xs text-slate-500">נספר לפי יום — רישום זה לא מכפיל שכר</span>}
                {seg._status === 'deleted' && <span className="block text-xs text-red-600">סומן למחיקה</span>}
              </div>
            </div>
          ))}
        </div>
        <Button type="button" variant="outline" onClick={addSeg} className="self-start"><Plus className="w-4 h-4 ml-2" />הוסף מקטע שעות</Button>
        {!hideSubmitButton && <Button type="submit" className="self-end bg-gradient-to-r from-green-500 to-blue-500 text-white"><Save className="w-4 h-4 ml-2" />שמור רישומים</Button>}
      </form>

      <Dialog open={!!confirmTarget} onOpenChange={(v) => { if (!v) { setConfirmTarget(null); setConfirmCheck(false); setConfirmText(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>מחיקה לצמיתות</DialogTitle>
            <DialogDescription>את/ה עומד/ת למחוק לצמיתות רישום מהמסד. הפעולה בלתי הפיכה.</DialogDescription>
          </DialogHeader>
          {confirmTarget && (
            <div className="text-sm space-y-1">
              <div>{employee.name}</div>
              <div>{dateLabel}</div>
              <div>שעות: {confirmTarget.hours || 0}</div>
              {confirmTarget.notes && <div>הערות: {confirmTarget.notes.slice(0,60)}</div>}
            </div>
          )}
          <div className="mt-4 p-3 bg-red-50 text-red-700 rounded-md text-sm">המחיקה תתבצע לצמיתות במסד הנתונים ואין אפשרות לשחזר.</div>
          <div className="mt-4 flex items-center gap-2">
            <input id="del-check" type="checkbox" className="h-4 w-4" checked={confirmCheck} onChange={e => setConfirmCheck(e.target.checked)} />
            <Label htmlFor="del-check">אני מבין/ה שהמחיקה בלתי הפיכה</Label>
          </div>
          <div className="mt-2">
            <Input value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder="להמשך הקלד/י: מחק" />
          </div>
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => setConfirmTarget(null)}>בטל</Button>
            <Button type="button" variant="destructive" disabled={!(confirmCheck && confirmText === 'מחק')} onClick={confirmDeletion}>מחק לצמיתות</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkOpen} onOpenChange={(v) => { if (!v) { setBulkOpen(false); setBulkCheck(false); setBulkText(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>אישור מחיקה לצמיתות</DialogTitle>
            <DialogDescription>את/ה עומד/ת למחוק לצמיתות את הרישומים הבאים (בלתי הפיך):</DialogDescription>
          </DialogHeader>
          <ul className="mt-2 text-sm text-right space-y-1">
            {segments.filter(s => s._status === 'deleted').map((s, i) => (
              <li key={s.id}>{`${dateLabel} — מקטע #${i + 1} (שעות: ${s.hours || 0})`}</li>
            ))}
          </ul>
          <div className="mt-4 p-3 bg-red-50 text-red-700 rounded-md text-sm">המחיקה תתבצע לצמיתות במסד הנתונים ואין אפשרות לשחזר.</div>
          <div className="mt-4 flex items-center gap-2">
            <input id="bulk-check" type="checkbox" className="h-4 w-4" checked={bulkCheck} onChange={e => setBulkCheck(e.target.checked)} />
            <Label htmlFor="bulk-check">אני מבין/ה שהמחיקה בלתי הפיכה</Label>
          </div>
          <div className="mt-2">
            <Input value={bulkText} onChange={e => setBulkText(e.target.value)} placeholder="להמשך הקלד/י: מחק" />
          </div>
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => setBulkOpen(false)}>בטל</Button>
            <Button type="button" variant="destructive" disabled={!(bulkCheck && bulkText === 'מחק')} onClick={confirmBulk}>מחק לצמיתות</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function TimeEntryForm({ employee, services, onSubmit, getRateForDate, initialRows = null, selectedDate, onTotalsChange, hideSubmitButton = false, formId, dayType }) {
  const isGlobal = employee.employee_type === 'global';

  const createRow = () => ({
    id: crypto.randomUUID(),
    date: selectedDate,
    service_id: '',
    hours: '',
    sessions_count: '1',
    students_count: '',
    notes: '',
    isNew: true,
  });
  const [rows, setRows] = useState(initialRows && initialRows.length > 0 ? initialRows : [createRow()]);

  if (isGlobal) {
    return (
      <GlobalForm
        employee={employee}
        onSubmit={onSubmit}
        getRateForDate={getRateForDate}
        initialRows={initialRows}
        selectedDate={selectedDate}
        onTotalsChange={onTotalsChange}
        hideSubmitButton={hideSubmitButton}
        formId={formId}
        dayType={dayType}
      />
    );
  }
  const addRow = () => setRows(prev => [...prev, createRow()]);
  const removeRow = (id) => setRows(prev => prev.filter(r => r.id !== id));
  const handleRowChange = (id, patch) => setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  const handleSubmit = (e) => { e.preventDefault(); onSubmit({ rows }); };

  return (
    <form onSubmit={handleSubmit} id={formId} className="space-y-4">
      {rows.map(r => (
        <EntryRow key={r.id} value={r} employee={employee} services={services} getRateForDate={getRateForDate} onChange={p => handleRowChange(r.id, p)} allowRemove={rows.length > 1} onRemove={() => removeRow(r.id)} />
      ))}
      <Button type="button" variant="outline" onClick={addRow}><Plus className="w-4 h-4 ml-2" />הוסף רישום</Button>
      {!hideSubmitButton && <Button type="submit" className="bg-gradient-to-r from-green-500 to-blue-500 text-white"><Save className="w-4 h-4 ml-2" />שמור רישומים</Button>}
    </form>
  );
}

