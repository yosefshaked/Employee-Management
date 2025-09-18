import React, { useState, useMemo, useEffect } from 'react';
import SingleDayEntryShell from './shared/SingleDayEntryShell.jsx';
import GlobalSegment from './segments/GlobalSegment.jsx';
import HourlySegment from './segments/HourlySegment.jsx';
import InstructorSegment from './segments/InstructorSegment.jsx';
import { calculateGlobalDailyRate } from '@/lib/payroll.js';
import { sumHours, removeSegment } from './dayUtils.js';
import ConfirmPermanentDeleteModal from './ConfirmPermanentDeleteModal.jsx';
import { softDeleteWorkSession } from '@/api/workSessions.js';
import { toast } from 'sonner';
import { format } from 'date-fns';
import he from '@/i18n/he.json';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { InfoTooltip } from '@/components/InfoTooltip.jsx';
import { selectLeaveDayValue } from '@/selectors.js';
import {
  DEFAULT_LEAVE_PAY_POLICY,
  LEAVE_PAY_METHOD_DESCRIPTIONS,
  LEAVE_PAY_METHOD_LABELS,
  LEAVE_TYPE_OPTIONS,
  isPayableLeaveKind,
  normalizeLeavePayPolicy,
} from '@/lib/leave.js';

const VALID_LEAVE_PAY_METHODS = new Set(Object.keys(LEAVE_PAY_METHOD_LABELS));

export default function TimeEntryForm({
  employee,
  allEmployees = [],
  workSessions = [],
  services = [],
  onSubmit,
  getRateForDate,
  initialRows = null,
  selectedDate,
  onDeleted,
  initialDayType = 'regular',
  paidLeaveId = null,
  paidLeaveNotes: initialPaidLeaveNotes = '',
  allowDayTypeSelection = false,
  initialLeaveType = null,
  allowHalfDay = false,
  initialMixedPaid = true,
  leavePayPolicy = DEFAULT_LEAVE_PAY_POLICY,
}) {
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
  const [leaveType, setLeaveType] = useState(initialLeaveType || '');
  const [mixedPaid, setMixedPaid] = useState(
    initialLeaveType === 'mixed' ? (initialMixedPaid !== false) : true
  );
  const [errors, setErrors] = useState({});
  const [pendingDelete, setPendingDelete] = useState(null);

  const leaveTypeOptions = useMemo(() => {
    return LEAVE_TYPE_OPTIONS
      .filter(option => allowHalfDay || option.value !== 'half_day')
      .map(option => [option.value, option.label]);
  }, [allowHalfDay]);

  useEffect(() => {
    if (!allowHalfDay && leaveType === 'half_day') {
      const [firstOption] = leaveTypeOptions;
      setLeaveType(firstOption ? firstOption[0] : '');
    }
  }, [allowHalfDay, leaveType, leaveTypeOptions]);

  useEffect(() => {
    if (initialLeaveType === 'mixed') {
      setMixedPaid(initialMixedPaid !== false);
    }
  }, [initialLeaveType, initialMixedPaid]);

  const dailyRate = useMemo(() => {
    if (!isGlobal) return 0;
    const { rate } = getRateForDate(employee.id, selectedDate, null);
    try { return calculateGlobalDailyRate(employee, selectedDate, rate); } catch { return 0; }
  }, [employee, selectedDate, getRateForDate, isGlobal]);

  const isLeaveDay = dayType === 'paid_leave';

  const normalizedLeavePay = useMemo(
    () => normalizeLeavePayPolicy(leavePayPolicy),
    [leavePayPolicy],
  );

  const employeesForSelector = useMemo(() => {
    if (Array.isArray(allEmployees) && allEmployees.length > 0) return allEmployees;
    return employee ? [employee] : [];
  }, [allEmployees, employee]);

  const leaveKindForPay = useMemo(() => {
    if (!isLeaveDay) return null;
    if (!leaveType) return null;
    if (leaveType === 'mixed') {
      return mixedPaid ? 'employee_paid' : null;
    }
    return leaveType;
  }, [isLeaveDay, leaveType, mixedPaid]);

  const isPaidLeavePreview = useMemo(() => {
    if (!isLeaveDay) return false;
    if (!leaveKindForPay) return false;
    return isPayableLeaveKind(leaveKindForPay);
  }, [isLeaveDay, leaveKindForPay]);

  const leavePayMethod = useMemo(() => {
    const override = employee?.leave_pay_method;
    if (override && VALID_LEAVE_PAY_METHODS.has(override)) {
      return override;
    }
    const fallback = normalizedLeavePay.default_method || DEFAULT_LEAVE_PAY_POLICY.default_method;
    if (VALID_LEAVE_PAY_METHODS.has(fallback)) {
      return fallback;
    }
    return DEFAULT_LEAVE_PAY_POLICY.default_method;
  }, [employee?.leave_pay_method, normalizedLeavePay]);

  const leaveMethodLabel = LEAVE_PAY_METHOD_LABELS[leavePayMethod] || LEAVE_PAY_METHOD_LABELS[DEFAULT_LEAVE_PAY_POLICY.default_method];
  const leaveMethodDescription =
    LEAVE_PAY_METHOD_DESCRIPTIONS[leavePayMethod] ||
    LEAVE_PAY_METHOD_DESCRIPTIONS[DEFAULT_LEAVE_PAY_POLICY.default_method] ||
    '';

  const leaveDayValueInfo = useMemo(() => {
    if (!isPaidLeavePreview || !employee?.id) {
      return { value: 0, insufficientData: false, preStartDate: false };
    }
    const result = selectLeaveDayValue(employee.id, selectedDate, {
      employees: employeesForSelector,
      workSessions,
      services,
      leavePayPolicy: normalizedLeavePay,
      collectDiagnostics: true,
    });
    if (result && typeof result === 'object' && !Number.isNaN(result.value)) {
      return {
        value: result.value,
        insufficientData: Boolean(result.insufficientData),
        preStartDate: Boolean(result.preStartDate),
      };
    }
    const numericValue = Number.isFinite(result) ? result : 0;
    return { value: numericValue, insufficientData: numericValue <= 0, preStartDate: false };
  }, [isPaidLeavePreview, employee?.id, selectedDate, employeesForSelector, workSessions, services, normalizedLeavePay]);

  const leaveDayValue = leaveDayValueInfo.value;
  const showInsufficientHistoryHint = leaveDayValueInfo.insufficientData;
  const showPreStartWarning = leaveDayValueInfo.preStartDate;

  const isHalfDaySelection = leaveKindForPay === 'half_day';

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
      const deletedRow = await softDeleteWorkSession(pendingDelete.id);
      setSegments(prev => prev.filter(s => s.id !== pendingDelete.id));
      const payload = deletedRow ? [deletedRow] : [];
      onDeleted?.([pendingDelete.id], payload);
      toast.success(he['toast.delete.success']);
      setPendingDelete(null);
    } catch (err) {
      toast.error(he['toast.delete.error']);
      setPendingDelete(null);
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

  const handleDayTypeChange = (value) => {
    setDayType(value);
    if (value !== 'paid_leave') {
      setLeaveType('');
      setMixedPaid(true);
    } else if (!leaveType) {
      const [firstOption] = leaveTypeOptions;
      if (firstOption) setLeaveType(firstOption[0]);
    }
  };

  const handleSave = (e) => {
    e.preventDefault();
    if (dayType === 'paid_leave') {
      if (!leaveType) {
        toast.error('יש לבחור סוג חופשה.', { duration: 15000 });
        return;
      }
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
        toast.error(`קיימים רישומי עבודה מתנגשים:\n${details}`, { duration: 10000 });
        return;
      }
      onSubmit({
        rows: [],
        dayType,
        paidLeaveId,
        paidLeaveNotes,
        leaveType,
        mixedPaid: leaveType === 'mixed' ? mixedPaid : null
      });
      return;
    }
    if (!validate()) return;
    onSubmit({ rows: segments, dayType, paidLeaveId, leaveType: null });
  };

  const baseSummary = useMemo(() => {
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

  const leaveSummary = useMemo(() => {
    if (!isLeaveDay) return null;
    if (!leaveType) {
      return 'בחרו סוג חופשה כדי לחשב שווי.';
    }
    if (leaveType === 'mixed' && !mixedPaid) {
      return 'היום המעורב סומן כלא משולם.';
    }
    if (!isPaidLeavePreview) {
      return 'היום סומן כחופשה ללא תשלום.';
    }
    const value = Number.isFinite(leaveDayValue) ? leaveDayValue : 0;
    const baseAmount = isHalfDaySelection ? value / 2 : value;
    const amount = showPreStartWarning ? 0 : baseAmount;
    const headline = isHalfDaySelection ? 'שווי חצי יום חופשה' : 'שווי יום חופשה';
    return (
      <>
        <div className="text-base font-medium text-slate-900">{`${headline}: ₪${amount.toFixed(2)}`}</div>
        <div className="flex items-center justify-end gap-2 text-xs text-slate-600">
          <span>{`שיטה: ${leaveMethodLabel}`}</span>
          {leaveMethodDescription ? <InfoTooltip text={leaveMethodDescription} /> : null}
        </div>
        {showInsufficientHistoryHint ? (
          <div className="mt-1 text-xs text-amber-700 text-right">
            אין מספיק נתוני עבר—הערכה עשויה להיות חלקית
          </div>
        ) : null}
        {showPreStartWarning ? (
          <div className="mt-1 text-xs text-amber-700 text-right">
            תאריך לפני תחילת עבודה—הושמט מהסכום
          </div>
        ) : null}
      </>
    );
  }, [
    isLeaveDay,
    leaveType,
    mixedPaid,
    isPaidLeavePreview,
    leaveDayValue,
    isHalfDaySelection,
    leaveMethodLabel,
    leaveMethodDescription,
    showInsufficientHistoryHint,
    showPreStartWarning,
  ]);

  const summary = isLeaveDay ? leaveSummary : baseSummary;

  const renderSegment = (seg, idx) => {
    if (isGlobal) {
      return (
        <GlobalSegment
          key={seg.id}
          segment={seg}
          onChange={changeSeg}
          onDuplicate={duplicateSeg}
          onDelete={deleteSeg}
          isFirst={idx === 0}
          dailyRate={dailyRate}
          error={errors[seg.id]}
          disabled={isLeaveDay}
        />
      );
    }
    if (isHourly) {
      const { rate } = getRateForDate(employee.id, selectedDate, null);
      return (
        <HourlySegment
          key={seg.id}
          segment={seg}
          onChange={changeSeg}
          onDuplicate={duplicateSeg}
          onDelete={deleteSeg}
          rate={rate}
          error={errors[seg.id]}
          disabled={isLeaveDay}
        />
      );
    }
    const { rate } = getRateForDate(employee.id, selectedDate, seg.service_id || null);
    return (
      <InstructorSegment
        key={seg.id}
        segment={seg}
        services={services}
        onChange={changeSeg}
        onDuplicate={duplicateSeg}
        onDelete={deleteSeg}
        rate={rate}
        errors={{ service: !seg.service_id && errors[seg.id], sessions_count: errors[seg.id] && seg.service_id ? errors[seg.id] : null, students_count: errors[seg.id] && seg.service_id ? errors[seg.id] : null }}
        disabled={isLeaveDay}
      />
    );
  };

  const addLabel = isHourly || isGlobal ? 'הוסף מקטע שעות' : 'הוסף רישום';

  const renderPaidLeaveSegment = () => (
    <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 p-4 md:p-5 space-y-4">
      <div className="space-y-1">
        <Label className="text-sm font-medium text-slate-700">סוג חופשה</Label>
        <Select value={leaveType || ''} onValueChange={setLeaveType}>
          <SelectTrigger className="bg-white h-10 text-base leading-6">
            <SelectValue placeholder="בחר סוג חופשה" />
          </SelectTrigger>
          <SelectContent>
            {leaveTypeOptions.map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
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
      {leaveType === 'mixed' && (
        <div className="space-y-1">
          <Label className="text-sm font-medium text-slate-700">האם היום המעורב בתשלום?</Label>
          <div className="flex gap-2" role="radiogroup" aria-label="האם היום המעורב בתשלום?">
            <Button
              type="button"
              variant={mixedPaid ? 'default' : 'ghost'}
              className="flex-1 h-10"
              onClick={() => setMixedPaid(true)}
            >
              כן
            </Button>
            <Button
              type="button"
              variant={!mixedPaid ? 'default' : 'ghost'}
              className="flex-1 h-10"
              onClick={() => setMixedPaid(false)}
            >
              לא
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <form onSubmit={handleSave} className="flex flex-col w-[min(98vw,1100px)] max-w-[98vw] h-[min(92vh,calc(100dvh-2rem))]">
      <SingleDayEntryShell
        employee={employee}
        date={selectedDate}
        showDayType={allowDayTypeSelection ? true : isGlobal}
        dayType={dayType}
        onDayTypeChange={handleDayTypeChange}
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
