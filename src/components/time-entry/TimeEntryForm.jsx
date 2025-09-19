import React, { useState, useMemo, useEffect, useCallback } from 'react';
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
import { Input } from '@/components/ui/input';
import { selectLeaveDayValue } from '@/selectors.js';
import {
  DEFAULT_LEAVE_PAY_POLICY,
  LEAVE_PAY_METHOD_DESCRIPTIONS,
  LEAVE_PAY_METHOD_LABELS,
  LEAVE_TYPE_OPTIONS,
  MIXED_SUBTYPE_OPTIONS,
  MIXED_SUBTYPE_LABELS,
  DEFAULT_MIXED_SUBTYPE,
  getLeaveBaseKind,
  isPayableLeaveKind,
  normalizeLeavePayPolicy,
  normalizeMixedSubtype,
} from '@/lib/leave.js';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Trash2 } from 'lucide-react';

const VALID_LEAVE_PAY_METHODS = new Set(Object.keys(LEAVE_PAY_METHOD_LABELS));

export default function TimeEntryForm({
  employee,
  allEmployees = [],
  workSessions = [],
  services = [],
  onSubmit,
  getRateForDate,
  initialRows = null,
  initialAdjustments = [],
  selectedDate,
  onDeleted,
  initialDayType = 'regular',
  paidLeaveId = null,
  paidLeaveNotes: initialPaidLeaveNotes = '',
  allowDayTypeSelection = false,
  initialLeaveType = null,
  allowHalfDay = false,
  initialMixedPaid = true,
  initialMixedSubtype = DEFAULT_MIXED_SUBTYPE,
  initialMixedHalfDay = false,
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
  const createAdjustment = useCallback(() => ({
    id: crypto.randomUUID(),
    workSessionId: null,
    type: 'credit',
    amount: '',
    notes: '',
    _status: 'new',
  }), []);
  const mapInitialAdjustments = useCallback((items = []) => {
    if (!Array.isArray(items) || items.length === 0) {
      return [createAdjustment()];
    }
    const mapped = items.map(item => {
      const rawAmount = Math.abs(Number(item?.total_payment ?? 0));
      return {
        id: String(item?.id ?? crypto.randomUUID()),
        workSessionId: item?.id || null,
        type: Number(item?.total_payment ?? 0) < 0 ? 'debit' : 'credit',
        amount: Number.isFinite(rawAmount) && rawAmount !== 0 ? String(rawAmount) : '',
        notes: item?.notes || '',
        _status: item?.id ? 'existing' : 'new',
      };
    });
    return mapped.length > 0 ? mapped : [createAdjustment()];
  }, [createAdjustment]);
  const [adjustments, setAdjustments] = useState(() => mapInitialAdjustments(initialAdjustments));
  const [adjustmentErrors, setAdjustmentErrors] = useState({});

  useEffect(() => {
    setAdjustments(mapInitialAdjustments(initialAdjustments));
    setAdjustmentErrors({});
  }, [initialAdjustments, mapInitialAdjustments]);
  const [dayType, setDayType] = useState(initialDayType);
  const [paidLeaveNotes, setPaidLeaveNotes] = useState(initialPaidLeaveNotes);
  const [leaveType, setLeaveType] = useState(initialLeaveType || '');
  const [mixedPaid, setMixedPaid] = useState(
    initialLeaveType === 'mixed' ? (initialMixedPaid !== false) : true
  );
  const [mixedSubtype, setMixedSubtype] = useState(() => {
    if (initialLeaveType === 'mixed') {
      return normalizeMixedSubtype(initialMixedSubtype) || DEFAULT_MIXED_SUBTYPE;
    }
    return DEFAULT_MIXED_SUBTYPE;
  });
  const [mixedHalfDay, setMixedHalfDay] = useState(() => (
    initialLeaveType === 'mixed' && initialMixedPaid !== false
      ? Boolean(initialMixedHalfDay)
      : false
  ));
  const [errors, setErrors] = useState({});
  const [pendingDelete, setPendingDelete] = useState(null);
  const [currentPaidLeaveId, setCurrentPaidLeaveId] = useState(paidLeaveId);

  useEffect(() => {
    setCurrentPaidLeaveId(paidLeaveId);
  }, [paidLeaveId]);

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
    if (!allowHalfDay && mixedHalfDay) {
      setMixedHalfDay(false);
    }
  }, [allowHalfDay, mixedHalfDay]);

  useEffect(() => {
    if (initialLeaveType === 'mixed') {
      setMixedPaid(initialMixedPaid !== false);
      setMixedSubtype(normalizeMixedSubtype(initialMixedSubtype) || DEFAULT_MIXED_SUBTYPE);
      setMixedHalfDay(initialMixedPaid !== false ? Boolean(initialMixedHalfDay) : false);
    }
  }, [initialLeaveType, initialMixedPaid, initialMixedSubtype, initialMixedHalfDay]);

  useEffect(() => {
    if (leaveType !== 'mixed') return;
    if (!normalizeMixedSubtype(mixedSubtype)) {
      setMixedSubtype(DEFAULT_MIXED_SUBTYPE);
    }
    if (!mixedPaid && mixedHalfDay) {
      setMixedHalfDay(false);
    }
  }, [leaveType, mixedSubtype, mixedPaid, mixedHalfDay]);

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
    return getLeaveBaseKind(leaveType);
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

  const isMixedHalfDay = leaveType === 'mixed' && mixedPaid && mixedHalfDay && allowHalfDay;
  const isHalfDaySelection = leaveType === 'half_day' || isMixedHalfDay;

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
    const summary = {
      employeeName: employee.name,
      date: format(new Date(selectedDate + 'T00:00:00'), 'dd/MM/yyyy'),
      entryTypeLabel: isHourly || isGlobal ? 'שעות' : 'מפגש',
      hours: isHourly || isGlobal ? target.hours : null,
      meetings: isHourly || isGlobal ? null : target.sessions_count
    };
    setPendingDelete({ id, summary, kind: 'segment' });
  };
  const addAdjustment = () => setAdjustments(prev => [...prev, createAdjustment()]);
  const updateAdjustment = (id, patch) => {
    setAdjustments(prev => prev.map(item => (item.id === id ? { ...item, ...patch } : item)));
    setAdjustmentErrors(prev => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };
  const removeAdjustment = (id) => {
    const target = adjustments.find(item => item.id === id);
    if (!target) return;
    if (target._status === 'existing' && target.workSessionId) {
      const amountValue = parseFloat(target.amount);
      const formattedDate = format(new Date(selectedDate + 'T00:00:00'), 'dd/MM/yyyy');
      const summary = {
        employeeName: employee.name,
        date: formattedDate,
        entryTypeLabel: 'התאמה',
      };
      const summaryText = Number.isFinite(amountValue) && amountValue > 0
        ? `התאמה ${target.type === 'debit' ? 'ניכוי' : 'זיכוי'} על סך ₪${Math.abs(amountValue).toLocaleString()}`
        : 'התאמה';
      setPendingDelete({
        id: target.workSessionId,
        summary,
        summaryText,
        kind: 'adjustment',
        localId: target.id,
      });
      return;
    }
    setAdjustments(prev => {
      const next = prev.filter(item => item.id !== id);
      return next.length > 0 ? next : [createAdjustment()];
    });
    setAdjustmentErrors(prev => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };
  const requestDeleteLeave = () => {
    if (!currentPaidLeaveId) return;
    const summary = {
      employeeName: employee.name,
      date: format(new Date(selectedDate + 'T00:00:00'), 'dd/MM/yyyy'),
      entryTypeLabel: 'חופשה',
    };
    setPendingDelete({ id: currentPaidLeaveId, summary, kind: 'leave' });
  };
  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    try {
      const deletedRow = await softDeleteWorkSession(target.id);
      let payload = deletedRow ? [deletedRow] : [];
      if (target.kind === 'segment') {
        setSegments(prev => prev.filter(s => s.id !== target.id));
      }
      if (target.kind === 'leave') {
        setCurrentPaidLeaveId(null);
        setDayType('regular');
        setLeaveType('');
        setMixedPaid(true);
        setMixedSubtype(DEFAULT_MIXED_SUBTYPE);
        setMixedHalfDay(false);
        setPaidLeaveNotes('');
        setSegments(prev => (prev.length > 0 ? prev : [createSeg()]));
      }
      if (target.kind === 'adjustment') {
        setAdjustments(prev => {
          const next = prev.filter(item => item.id !== target.localId);
          return next.length > 0 ? next : [createAdjustment()];
        });
        setAdjustmentErrors(prev => {
          if (!target.localId || !prev[target.localId]) return prev;
          const next = { ...prev };
          delete next[target.localId];
          return next;
        });
      }
      onDeleted?.([target.id], payload);
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
    if (value === 'adjustment' && adjustments.length === 0) {
      setAdjustments([createAdjustment()]);
    }
    if (value !== 'adjustment') {
      setAdjustmentErrors({});
    }
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
    if (dayType === 'adjustment') {
      const normalized = [];
      const errs = {};
      adjustments.forEach(row => {
        const amountValue = parseFloat(row.amount);
        if (!row.amount || Number.isNaN(amountValue) || amountValue <= 0) {
          errs[row.id] = 'סכום גדול מ-0 נדרש';
          return;
        }
        normalized.push({
          id: row.workSessionId || null,
          type: row.type === 'debit' ? 'debit' : 'credit',
          amount: Math.abs(amountValue),
          notes: row.notes || '',
        });
      });
      if (Object.keys(errs).length > 0) {
        setAdjustmentErrors(errs);
        toast.error('נא למלא סכום עבור כל התאמה.', { duration: 15000 });
        return;
      }
      if (!normalized.length) {
        toast.error('יש להזין לפחות התאמה אחת.', { duration: 15000 });
        return;
      }
      setAdjustmentErrors({});
      onSubmit({
        rows: [],
        dayType,
        adjustments: normalized,
      });
      return;
    }
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
      if (leaveType === 'mixed') {
        const normalizedSubtype = normalizeMixedSubtype(mixedSubtype);
        if (!normalizedSubtype) {
          toast.error('יש לבחור סוג חופשה מעורבת.', { duration: 15000 });
          return;
        }
      }
      onSubmit({
        rows: [],
        dayType,
        paidLeaveId: currentPaidLeaveId,
        paidLeaveNotes,
        leaveType,
        mixedPaid: leaveType === 'mixed' ? mixedPaid : null,
        mixedSubtype: leaveType === 'mixed'
          ? (normalizeMixedSubtype(mixedSubtype) || DEFAULT_MIXED_SUBTYPE)
          : null,
        mixedHalfDay: leaveType === 'mixed'
          ? (mixedPaid && allowHalfDay ? Boolean(mixedHalfDay) : false)
          : null,
      });
      return;
    }
    if (!validate()) return;
    onSubmit({ rows: segments, dayType, paidLeaveId: currentPaidLeaveId, leaveType: null });
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

  const adjustmentSummary = useMemo(() => {
    if (!Array.isArray(adjustments) || adjustments.length === 0) {
      return 'לא הוזנו התאמות ליום זה.';
    }
    const total = adjustments.reduce((sum, item) => {
      const amountValue = parseFloat(item.amount);
      if (!item.amount || Number.isNaN(amountValue) || amountValue <= 0) {
        return sum;
      }
      const normalized = item.type === 'debit' ? -Math.abs(amountValue) : Math.abs(amountValue);
      return sum + normalized;
    }, 0);
    if (total === 0) {
      return 'לא הוזנו התאמות ליום זה.';
    }
    const prefix = total > 0 ? '+' : '-';
    return `סה"כ התאמות ליום: ${prefix}₪${Math.abs(total).toLocaleString()}`;
  }, [adjustments]);

  const leaveSummary = useMemo(() => {
    if (!isLeaveDay) return null;
    if (!leaveType) {
      return 'בחרו סוג חופשה כדי לחשב שווי.';
    }
    const resolvedMixedSubtype = normalizeMixedSubtype(mixedSubtype) || DEFAULT_MIXED_SUBTYPE;
    const mixedSubtypeLabel = MIXED_SUBTYPE_LABELS[resolvedMixedSubtype] || null;
    if (leaveType === 'mixed' && !mixedPaid) {
      const details = ['מעורב', mixedSubtypeLabel, 'ללא תשלום'].filter(Boolean).join(' · ');
      return (
        <>
          <div className="text-base font-medium text-slate-900">היום המעורב סומן כחופשה ללא תשלום.</div>
          {details ? (
            <div className="text-xs text-slate-600 text-right">{details}</div>
          ) : null}
        </>
      );
    }
    if (!isPaidLeavePreview) {
      const details = leaveType === 'mixed'
        ? ['מעורב', mixedSubtypeLabel, 'ללא תשלום'].filter(Boolean).join(' · ')
        : null;
      return (
        <>
          <div className="text-base font-medium text-slate-900">היום סומן כחופשה ללא תשלום.</div>
          {details ? (
            <div className="text-xs text-slate-600 text-right">{details}</div>
          ) : null}
        </>
      );
    }
    const value = Number.isFinite(leaveDayValue) ? leaveDayValue : 0;
    const baseAmount = isHalfDaySelection ? value / 2 : value;
    const amount = showPreStartWarning ? 0 : baseAmount;
    const headline = leaveType === 'mixed'
      ? (isMixedHalfDay ? 'שווי חצי יום חופשה מעורבת' : 'שווי יום חופשה מעורבת')
      : (isHalfDaySelection ? 'שווי חצי יום חופשה' : 'שווי יום חופשה');
    const detailParts = leaveType === 'mixed'
      ? [
        'מעורב',
        mixedSubtypeLabel,
        mixedPaid ? 'בתשלום' : null,
        mixedPaid && mixedHalfDay ? 'חצי יום' : null,
      ].filter(Boolean)
      : null;
    return (
      <>
        <div className="text-base font-medium text-slate-900">{`${headline}: ₪${amount.toFixed(2)}`}</div>
        {detailParts?.length ? (
          <div className="text-xs text-slate-600 text-right">{detailParts.join(' · ')}</div>
        ) : null}
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
    mixedHalfDay,
    mixedSubtype,
    isPaidLeavePreview,
    leaveDayValue,
    isHalfDaySelection,
    isMixedHalfDay,
    leaveMethodLabel,
    leaveMethodDescription,
    showInsufficientHistoryHint,
    showPreStartWarning,
  ]);

  const summary = dayType === 'adjustment'
    ? adjustmentSummary
    : (isLeaveDay ? leaveSummary : baseSummary);

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

  const renderAdjustmentSegment = (row, idx) => (
    <div key={row.id} className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-slate-700">התאמה #{idx + 1}</div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-red-500 hover:bg-red-50"
              onClick={() => removeAdjustment(row.id)}
              aria-label="מחק התאמה"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>מחק התאמה</TooltipContent>
        </Tooltip>
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-1">
          <Label className="text-sm font-medium text-slate-700">סוג התאמה</Label>
          <div className="flex gap-2" role="radiogroup" aria-label="סוג התאמה">
            <Button
              type="button"
              variant={row.type === 'credit' ? 'default' : 'ghost'}
              className="flex-1 h-10"
              onClick={() => updateAdjustment(row.id, { type: 'credit' })}
            >
              זיכוי
            </Button>
            <Button
              type="button"
              variant={row.type === 'debit' ? 'default' : 'ghost'}
              className="flex-1 h-10"
              onClick={() => updateAdjustment(row.id, { type: 'debit' })}
            >
              ניכוי
            </Button>
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-sm font-medium text-slate-700">סכום (₪)</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={row.amount}
            onChange={event => updateAdjustment(row.id, { amount: event.target.value })}
            className="bg-white h-10 text-base"
          />
          {adjustmentErrors[row.id] ? (
            <p className="text-xs text-red-600 text-right">{adjustmentErrors[row.id]}</p>
          ) : null}
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label className="text-sm font-medium text-slate-700">הערות</Label>
          <Textarea
            value={row.notes}
            onChange={event => updateAdjustment(row.id, { notes: event.target.value })}
            rows={2}
            className="bg-white text-base leading-6"
            placeholder="הסבר קצר (לא חובה)"
          />
        </div>
      </div>
    </div>
  );

  const addLabel = isHourly || isGlobal ? 'הוסף מקטע שעות' : 'הוסף רישום';

  const renderPaidLeaveSegment = () => (
    <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 p-4 md:p-5 space-y-4">
      {currentPaidLeaveId ? (
        <div className="flex justify-end mb-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={requestDeleteLeave}
                aria-label="מחק רישום חופשה"
                className="h-7 w-7 text-red-500 hover:bg-red-50"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>מחק רישום חופשה</TooltipContent>
          </Tooltip>
        </div>
      ) : null}
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
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-sm font-semibold text-slate-800">הגדרות חופשה מעורבת</div>
          <div className="space-y-1">
            <Label className="text-sm font-medium text-slate-700">סוג חופשה</Label>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="סוג חופשה">
              {MIXED_SUBTYPE_OPTIONS.map(option => {
                const isActive = normalizeMixedSubtype(mixedSubtype) === option.value;
                return (
                  <Button
                    key={option.value}
                    type="button"
                    variant={isActive ? 'default' : 'ghost'}
                    className="h-10 w-full"
                    onClick={() => setMixedSubtype(option.value)}
                  >
                    {option.label}
                  </Button>
                );
              })}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-sm font-medium text-slate-700">תשלום</Label>
            <div className="flex gap-2" role="radiogroup" aria-label="תשלום">
              <Button
                type="button"
                variant={mixedPaid ? 'default' : 'ghost'}
                className="flex-1 h-10"
                onClick={() => setMixedPaid(true)}
              >
                בתשלום
              </Button>
              <Button
                type="button"
                variant={!mixedPaid ? 'default' : 'ghost'}
                className="flex-1 h-10"
                onClick={() => {
                  setMixedPaid(false);
                  setMixedHalfDay(false);
                }}
              >
                ללא תשלום
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
            <div>
              <div className="text-sm font-medium text-slate-700">חצי יום</div>
              <div className="text-xs text-slate-500">
                {allowHalfDay ? 'זמין רק לחופשה בתשלום' : 'חצי יום מושבת במדיניות החופשות'}
              </div>
            </div>
            <Switch
              checked={mixedHalfDay}
              onCheckedChange={checked => setMixedHalfDay(checked)}
              disabled={!mixedPaid || !allowHalfDay}
              aria-label="חצי יום"
            />
          </div>
          {!allowHalfDay ? (
            <div className="text-xs text-slate-500">
              להפעלת חצי יום, עדכנו את הגדרת המדיניות במסך ההגדרות.
            </div>
          ) : null}
        </div>
      )}
    </div>
  );

  const visibleSegments = dayType === 'paid_leave'
    ? [{ id: 'paid_leave_notes' }]
    : dayType === 'adjustment'
      ? adjustments
      : segments.filter(s => s._status !== 'deleted');

  const segmentRenderer = dayType === 'paid_leave'
    ? renderPaidLeaveSegment
    : dayType === 'adjustment'
      ? renderAdjustmentSegment
      : renderSegment;

  const addHandler = dayType === 'paid_leave'
    ? null
    : dayType === 'adjustment'
      ? addAdjustment
      : addSeg;

  const addButtonLabel = dayType === 'adjustment'
    ? 'הוסף התאמה'
    : addLabel;

  return (
    <form onSubmit={handleSave} className="flex flex-col w-[min(98vw,1100px)] max-w-[98vw] h-[min(92vh,calc(100dvh-2rem))]">
      <SingleDayEntryShell
        employee={employee}
        date={selectedDate}
        showDayType={allowDayTypeSelection ? true : isGlobal}
        dayType={dayType}
        onDayTypeChange={handleDayTypeChange}
        segments={visibleSegments}
        renderSegment={segmentRenderer}
        onAddSegment={addHandler}
        addLabel={addButtonLabel}
        summary={summary}
        onCancel={() => onSubmit(null)}
      />
      <ConfirmPermanentDeleteModal
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        summary={pendingDelete ? pendingDelete.summary : null}
        summaryText={pendingDelete?.summaryText || ''}
      />
    </form>
  );
}
