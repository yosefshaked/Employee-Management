import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import EntryRow, { computeRowPayment } from './EntryRow.jsx';
import { copyFromPrevious, formatDatesCount, isRowCompleteForProgress } from './multiDateUtils.js';
import { format } from 'date-fns';
import { useTimeEntry } from './useTimeEntry.js';
import { ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import he from '@/i18n/he.json';
import { calculateGlobalDailyRate, aggregateGlobalDays, createLeaveDayValueResolver } from '@/lib/payroll.js';
import {
  isLeaveEntryType,
  LEAVE_TYPE_OPTIONS,
  MIXED_SUBTYPE_OPTIONS,
  DEFAULT_MIXED_SUBTYPE,
  normalizeMixedSubtype,
} from '@/lib/leave.js';
import { Switch } from '@/components/ui/switch';
import { selectLeaveDayValue } from '@/selectors.js';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';

function validateRow(row, employee, services, getRateForDate) {
  const errors = {};
  if (!row.date) errors.date = 'חסר תאריך';
  const isHourlyOrGlobal = employee.employee_type === 'hourly' || employee.employee_type === 'global';
  const { rate } = getRateForDate(employee.id, row.date, isHourlyOrGlobal ? null : row.service_id);
  if (!rate) errors.entry_type = 'אין תעריף';
  if (employee.employee_type === 'instructor') {
    if (!row.service_id) errors.service_id = 'חסר שירות';
    if (!row.sessions_count) errors.sessions_count = 'חסר מספר מפגשים';
    const service = services.find(s => s.id === row.service_id);
    if (service && service.payment_model === 'per_student' && !row.students_count) {
      errors.students_count = 'חסר מספר תלמידים';
    }
  } else if (employee.employee_type === 'hourly') {
    if (!row.hours) errors.hours = 'חסרות שעות';
  } else if (employee.employee_type === 'global') {
    try {
      calculateGlobalDailyRate(employee, row.date, rate);
    } catch {
      errors.hours = 'אין ימי עבודה בחודש';
    }
  } else if (isLeaveEntryType(row.entry_type)) {
    errors.entry_type = 'סוג יום לא נתמך';
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

export default function MultiDateEntryModal({
  open,
  onClose,
  employees,
  services,
  selectedEmployees,
  selectedDates,
  getRateForDate,
  onSaved,
  workSessions = [],
  leavePayPolicy = null,
  allowHalfDay = false,
  defaultMode = 'regular',
}) {
  const employeesById = useMemo(() => Object.fromEntries(employees.map(e => [e.id, e])), [employees]);
  const initialRows = useMemo(() => {
    const items = [];
    for (const empId of selectedEmployees) {
      const emp = employeesById[empId];
      const datesSorted = [...selectedDates].sort((a, b) => a - b);
      for (const d of datesSorted) {
        items.push({
          employee_id: empId,
          date: format(d, 'yyyy-MM-dd'),
          entry_type: emp.employee_type === 'hourly'
            ? 'hours'
            : (emp.employee_type === 'instructor'
              ? 'session'
              : (emp.employee_type === 'global' ? 'hours' : undefined)),
          service_id: null,
          hours: '',
          sessions_count: '',
          students_count: '',
          notes: ''
        });
      }
    }
    return items;
  }, [selectedEmployees, selectedDates, employeesById]);

  const [rows, setRows] = useState(initialRows);
  useEffect(() => { setRows(initialRows); }, [initialRows]);
  const { session, dataClient } = useSupabase();
  const { activeOrgId } = useOrg();

  const { saveRows, saveMixedLeave, saveAdjustments } = useTimeEntry({
    employees,
    services,
    getRateForDate,
    metadataClient: dataClient,
    workSessions,
    leavePayPolicy,
    session,
    orgId: activeOrgId,
  });

  const leaveValueResolver = useMemo(() => {
    return createLeaveDayValueResolver({
      employees,
      workSessions,
      services,
      leavePayPolicy,
      leaveDayValueSelector: selectLeaveDayValue,
    });
  }, [employees, workSessions, services, leavePayPolicy]);

  const normalizedDefaultMode = useMemo(() => {
    return defaultMode === 'leave' || defaultMode === 'adjustment' ? defaultMode : 'regular';
  }, [defaultMode]);
  const [mode, setMode] = useState(normalizedDefaultMode);
  useEffect(() => {
    if (open) {
      setMode(normalizedDefaultMode);
    }
  }, [open, normalizedDefaultMode]);
  const handleModeChange = useCallback((nextMode) => {
    setMode(nextMode);
    if (nextMode !== 'adjustment') {
      setAdjustmentErrors({});
    }
  }, []);
  const defaultMixedSubtype = DEFAULT_MIXED_SUBTYPE;
  const ensureMixedSelection = useCallback((value = {}) => {
    const paid = value && value.paid !== false;
    const subtype = normalizeMixedSubtype(value?.subtype) || defaultMixedSubtype;
    const halfDay = allowHalfDay && paid ? Boolean(value?.halfDay) : false;
    return { paid, subtype, halfDay };
  }, [allowHalfDay, defaultMixedSubtype]);
  const leaveTypeOptions = useMemo(
    () => LEAVE_TYPE_OPTIONS.filter(option => option.value === 'mixed'),
    []
  );
  const [selectedLeaveType, setSelectedLeaveType] = useState(
    () => leaveTypeOptions[0]?.value || 'mixed'
  );
  useEffect(() => {
    setSelectedLeaveType(leaveTypeOptions[0]?.value || 'mixed');
  }, [leaveTypeOptions]);

  const sortedDates = useMemo(
    () => [...selectedDates].sort((a, b) => a - b),
    [selectedDates]
  );
  const [globalMixedSubtype, setGlobalMixedSubtype] = useState(DEFAULT_MIXED_SUBTYPE);
  const defaultMixedSelections = useMemo(() => {
    const base = {};
    selectedEmployees.forEach(empId => {
      const inner = {};
      sortedDates.forEach(d => {
        inner[format(d, 'yyyy-MM-dd')] = ensureMixedSelection();
      });
      base[empId] = inner;
    });
    return base;
  }, [selectedEmployees, sortedDates, ensureMixedSelection]);
  const [mixedSelections, setMixedSelections] = useState(defaultMixedSelections);
  useEffect(() => {
    setMixedSelections(defaultMixedSelections);
    setGlobalMixedSubtype(DEFAULT_MIXED_SUBTYPE);
  }, [defaultMixedSelections]);

  const defaultAdjustmentValues = useMemo(() => {
    const base = {};
    selectedEmployees.forEach(empId => {
      const inner = {};
      sortedDates.forEach(d => {
        const dateStr = format(d, 'yyyy-MM-dd');
        inner[dateStr] = { type: 'credit', amount: '', notes: '' };
      });
      base[empId] = inner;
    });
    return base;
  }, [selectedEmployees, sortedDates]);

  const [adjustmentValues, setAdjustmentValues] = useState(defaultAdjustmentValues);
  const [adjustmentErrors, setAdjustmentErrors] = useState({});

  useEffect(() => {
    if (open && normalizedDefaultMode !== 'adjustment') {
      setAdjustmentErrors({});
    }
  }, [open, normalizedDefaultMode, setAdjustmentErrors]);

  useEffect(() => {
    setAdjustmentValues(defaultAdjustmentValues);
    setAdjustmentErrors({});
  }, [defaultAdjustmentValues]);

  useEffect(() => {
    setAdjustmentErrors({});
  }, [selectedEmployees, sortedDates]);

  const updateAdjustmentValue = useCallback((empId, dateStr, patch) => {
    setAdjustmentValues(prev => {
      const next = { ...prev };
      const inner = { ...(next[empId] || {}) };
      const current = inner[dateStr] || { type: 'credit', amount: '', notes: '' };
      inner[dateStr] = { ...current, ...patch };
      next[empId] = inner;
      return next;
    });
    setAdjustmentErrors(prev => {
      const next = { ...prev };
      if (!next[empId]) return next;
      const inner = { ...next[empId] };
      if (!inner[dateStr]) return next;
      delete inner[dateStr];
      if (Object.keys(inner).length === 0) {
        delete next[empId];
      } else {
        next[empId] = inner;
      }
      return next;
    });
  }, []);

  const adjustmentStats = useMemo(() => {
    let filled = 0;
    let total = 0;
    let sum = 0;
    selectedEmployees.forEach(empId => {
      const inner = adjustmentValues[empId] || {};
      sortedDates.forEach(d => {
        total += 1;
        const dateStr = format(d, 'yyyy-MM-dd');
        const entry = inner[dateStr];
        if (!entry) return;
        const amountValue = parseFloat(entry.amount);
        if (!entry.amount || Number.isNaN(amountValue) || amountValue <= 0) return;
        filled += 1;
        const normalized = entry.type === 'debit' ? -Math.abs(amountValue) : Math.abs(amountValue);
        sum += normalized;
      });
    });
    return { filled, total, sum };
  }, [adjustmentValues, selectedEmployees, sortedDates]);

  const validation = useMemo(
    () => rows.map(r => validateRow(r, employeesById[r.employee_id], services, getRateForDate)),
    [rows, employeesById, services, getRateForDate]
  );
  const payments = useMemo(
    () => rows.map(r => computeRowPayment(r, employeesById[r.employee_id], services, getRateForDate, { leaveValueResolver })),
    [rows, employeesById, services, getRateForDate, leaveValueResolver]
  );
  const globalAgg = useMemo(() => {
    const withPay = rows.map((r, i) => ({
      ...r,
      entry_type: employeesById[r.employee_id].employee_type === 'global'
        ? 'hours'
        : r.entry_type,
      total_payment: payments[i]
    }));
    return aggregateGlobalDays(withPay, employeesById);
  }, [rows, payments, employeesById]);
  const duplicateMap = useMemo(() => {
    const map = {};
    globalAgg.forEach(val => {
      val.indices.forEach((idx, i) => { map[idx] = i > 0; });
    });
    return map;
  }, [globalAgg]);
  const summaryTotal = useMemo(() => {
    let nonGlobal = 0;
    rows.forEach((r, i) => {
      const emp = employeesById[r.employee_id];
      if (emp.employee_type === 'global') return;
      nonGlobal += payments[i];
    });
    let globalSum = 0;
    globalAgg.forEach(v => { globalSum += v.dailyAmount; });
    return nonGlobal + globalSum;
  }, [rows, payments, employeesById, globalAgg]);
  const filledCount = useMemo(
    () => rows.filter(r => isRowCompleteForProgress(r, employeesById[r.employee_id])).length,
    [rows, employeesById]
  );
  const [showErrors, setShowErrors] = useState(false);
  const [showBanner, setShowBanner] = useState(false);
  const [flash, setFlash] = useState(null);

  const formatConflictMessage = useCallback((items = []) => {
    if (!Array.isArray(items) || items.length === 0) return null;
    const lines = items.map(item => {
      const employee = employeesById[item.employeeId] || {};
      const name = item.employeeName || employee.name || '';
      const dateValue = item.date ? new Date(`${item.date}T00:00:00`) : null;
      const formatted = dateValue && !Number.isNaN(dateValue.getTime())
        ? format(dateValue, 'dd/MM/yyyy')
        : (item.date || '');
      return `${name} – ${formatted}`.trim();
    });
    if (!lines.some(Boolean)) return null;
    return `לא ניתן לשמור חופשה עבור התאריכים הבאים:\n${lines.join('\n')}`;
  }, [employeesById]);

  const formatRegularConflictMessage = useCallback((items = []) => {
    if (!Array.isArray(items) || items.length === 0) return null;
    const lines = items.map(item => {
      const employee = employeesById[item.employeeId] || {};
      const name = item.employeeName || employee.name || '';
      const dateValue = item.date ? new Date(`${item.date}T00:00:00`) : null;
      const formatted = dateValue && !Number.isNaN(dateValue.getTime())
        ? format(dateValue, 'dd/MM/yyyy')
        : (item.date || '');
      const suffix = name ? ` (${name})` : '';
      const line = `${formatted}${suffix}`.trim();
      return line;
    }).filter(Boolean);
    if (!lines.length) return null;
    return `לא ניתן להוסיף שעות בתאריך שכבר הוזנה בו חופשה:\n${lines.join('\n')}`;
  }, [employeesById]);

  const formatInvalidStartMessage = useCallback((items = []) => {
    if (!Array.isArray(items) || items.length === 0) return null;
    const lines = items.map(item => {
      const employee = employeesById[item.employeeId] || {};
      const name = item.employeeName || employee.name || '';
      const dateValue = item.date ? new Date(`${item.date}T00:00:00`) : null;
      const formattedDate = dateValue && !Number.isNaN(dateValue.getTime())
        ? format(dateValue, 'dd/MM/yyyy')
        : (item.date || '');
      const startSource = item.startDate || employee.start_date || '';
      const startValue = startSource ? new Date(`${startSource}T00:00:00`) : null;
      const formattedStart = startValue && !Number.isNaN(startValue.getTime())
        ? format(startValue, 'dd/MM/yyyy')
        : (startSource || '');
      if (formattedStart) {
        return `${name} – ${formattedDate} (תאריך התחלה ${formattedStart})`.trim();
      }
      return `${name} – ${formattedDate}`.trim();
    });
    if (!lines.some(Boolean)) return null;
    return `לא ניתן לשמור חופשה לפני תאריך תחילת העבודה:\n${lines.join('\n')}`;
  }, [employeesById]);

  useEffect(() => {
    if (mode !== 'regular') {
      setShowBanner(false);
      setShowErrors(false);
    }
  }, [mode]);

  const updateMixedSelection = useCallback((empId, dateStr, updater) => {
    setMixedSelections(prev => {
      const next = { ...prev };
      const current = { ...(next[empId] || {}) };
      const existing = ensureMixedSelection(current[dateStr]);
      const updated = typeof updater === 'function'
        ? ensureMixedSelection(updater(existing))
        : ensureMixedSelection({ ...existing, ...updater });
      current[dateStr] = updated;
      next[empId] = current;
      return next;
    });
  }, [ensureMixedSelection]);

  const toggleMixedSelection = (empId, dateStr, paid) => {
    updateMixedSelection(empId, dateStr, current => ({
      ...current,
      paid,
      halfDay: paid ? current.halfDay : false,
    }));
  };

  const markAllMixed = (paid) => {
    setMixedSelections(prev => {
      const next = {};
      selectedEmployees.forEach(empId => {
        const inner = { ...(prev[empId] || {}) };
        sortedDates.forEach(d => {
          const dateStr = format(d, 'yyyy-MM-dd');
          const current = ensureMixedSelection(inner[dateStr]);
          inner[dateStr] = ensureMixedSelection({
            ...current,
            paid,
            halfDay: paid ? current.halfDay : false,
          });
        });
        next[empId] = inner;
      });
      return next;
    });
  };

  const applySubtypeToAll = (subtype) => {
    const normalized = normalizeMixedSubtype(subtype) || DEFAULT_MIXED_SUBTYPE;
    setMixedSelections(prev => {
      const next = {};
      selectedEmployees.forEach(empId => {
        const inner = { ...(prev[empId] || {}) };
        sortedDates.forEach(d => {
          const dateStr = format(d, 'yyyy-MM-dd');
          const current = ensureMixedSelection(inner[dateStr]);
          inner[dateStr] = { ...current, subtype: normalized };
        });
        next[empId] = inner;
      });
      return next;
    });
  };

  const applyHalfDayToPaid = () => {
    if (!allowHalfDay) return;
    setMixedSelections(prev => {
      const next = {};
      selectedEmployees.forEach(empId => {
        const inner = { ...(prev[empId] || {}) };
        sortedDates.forEach(d => {
          const dateStr = format(d, 'yyyy-MM-dd');
          const current = ensureMixedSelection(inner[dateStr]);
          inner[dateStr] = current.paid ? { ...current, halfDay: true } : current;
        });
        next[empId] = inner;
      });
      return next;
    });
  };

  const updateRow = (index, patch) => setRows(prev => prev.map((r, i) => i === index ? { ...r, ...patch } : r));
  const handleCopy = (index, field) => {
    const { rows: updated, success } = copyFromPrevious(rows, index, field);
    setRows(updated);
    if (!success) {
      toast('אין ערך להעתקה');
    } else {
      setFlash({ index, field, ts: Date.now() });
    }
  };

  const removeRow = (index) => {
    setRows(prev => prev.filter((_, i) => i !== index));
    toast.success(he['toast.delete.success']);
  };

  const groupedRows = useMemo(() => {
    const map = new Map();
    rows.forEach((row, index) => {
      if (!map.has(row.employee_id)) map.set(row.employee_id, []);
      map.get(row.employee_id).push({ row, index });
    });
    return Array.from(map.entries());
  }, [rows]);

  const [collapsed, setCollapsed] = useState({});
  const toggleEmp = (id) => setCollapsed(prev => ({ ...prev, [id]: !prev[id] }));

  const handleRegularSave = async () => {
    const invalidIndex = validation.findIndex(v => !v.valid);
    if (invalidIndex !== -1) {
      setShowErrors(true);
      setShowBanner(true);
      const el = document.getElementById(`row-${invalidIndex}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    try {
      const result = await saveRows(rows);
      if (result?.conflicts?.length) {
        const message = formatRegularConflictMessage(result.conflicts);
        if (message) {
          toast.error(message, { duration: 15000 });
        }
      }
      const insertedCount = Array.isArray(result?.inserted) ? result.inserted.length : rows.length;
      toast.success(`נשמרו ${insertedCount}`);
      onSaved();
      onClose();
    } catch (e) {
      if (e?.code === 'TIME_ENTRY_REGULAR_CONFLICT') {
        const message = formatRegularConflictMessage(e.conflicts);
        if (message) {
          toast.error(message, { duration: 15000 });
        }
        return;
      }
      toast.error(e.message);
    }
  };

  const saveValidOnly = async () => {
    const validRows = rows.filter((_, i) => validation[i].valid);
    try {
      const result = await saveRows(validRows);
      if (result?.conflicts?.length) {
        const message = formatRegularConflictMessage(result.conflicts);
        if (message) {
          toast.error(message, { duration: 15000 });
        }
      }
      const insertedCount = Array.isArray(result?.inserted) ? result.inserted.length : validRows.length;
      toast.success(`נשמרו ${insertedCount} / נדחו ${validRows.length - insertedCount}`);
      setShowBanner(false);
    } catch (e) {
      if (e?.code === 'TIME_ENTRY_REGULAR_CONFLICT') {
        const message = formatRegularConflictMessage(e.conflicts);
        if (message) {
          toast.error(message, { duration: 15000 });
        }
        return;
      }
      toast.error(e.message);
    }
  };

  const handleSaveMixed = async () => {
    if (selectedLeaveType !== 'mixed') {
      toast.error('סוג חופשה לא נתמך');
      return;
    }
    if (!selectedEmployees.length || !sortedDates.length) {
      toast.error('בחרו עובדים ותאריכים לחופשה');
      return;
    }
    const selections = [];
    selectedEmployees.forEach(empId => {
      const map = mixedSelections[empId] || {};
      sortedDates.forEach(d => {
        const dateStr = format(d, 'yyyy-MM-dd');
        const entry = ensureMixedSelection(map[dateStr]);
        selections.push({
          employee_id: empId,
          date: dateStr,
          paid: entry.paid,
          subtype: entry.subtype,
          half_day: entry.paid ? entry.halfDay : false,
        });
      });
    });
    if (!selections.length) {
      toast.error('לא נבחרו תאריכים לחופשה');
      return;
    }
    try {
      const result = await saveMixedLeave(selections, { leaveType: selectedLeaveType });
      if (result?.conflicts?.length) {
        const message = formatConflictMessage(result.conflicts);
        if (message) {
          toast.error(message, { duration: 15000 });
        }
      }
      if (result?.invalidStartDates?.length) {
        const invalidMessage = formatInvalidStartMessage(result.invalidStartDates);
        if (invalidMessage) {
          toast.error(invalidMessage, { duration: 15000 });
        }
      }
      const insertedCount = Array.isArray(result?.inserted) ? result.inserted.length : 0;
      if (insertedCount > 0) {
        toast.success(`נשמרו ${insertedCount} ימי חופשה`);
        onSaved();
        onClose();
      }
    } catch (e) {
      if (e?.code === 'TIME_ENTRY_LEAVE_CONFLICT') {
        let handled = false;
        if (Array.isArray(e.conflicts) && e.conflicts.length) {
          const message = formatConflictMessage(e.conflicts);
          if (message) {
            toast.error(message, { duration: 15000 });
            handled = true;
          }
        }
        if (Array.isArray(e.invalidStartDates) && e.invalidStartDates.length) {
          const invalidMessage = formatInvalidStartMessage(e.invalidStartDates);
          if (invalidMessage) {
            toast.error(invalidMessage, { duration: 15000 });
            handled = true;
          }
        }
        if (handled) return;
      }
      toast.error(e.message);
    }
  };

  const regularSaveDisabled = mode === 'regular' && rows.length === 0;
  const leaveSaveDisabled = mode === 'leave' && (!selectedEmployees.length || !sortedDates.length);
  const handleAdjustmentSave = async () => {
    const entries = [];
    const errors = {};
    let hasError = false;
    selectedEmployees.forEach(empId => {
      const inner = adjustmentValues[empId] || {};
      sortedDates.forEach(d => {
        const dateStr = format(d, 'yyyy-MM-dd');
        const entry = inner[dateStr];
        if (!entry) return;
        const amountValue = parseFloat(entry.amount);
        const rowErrors = {};
        if (!entry.amount || Number.isNaN(amountValue) || amountValue <= 0) {
          rowErrors.amount = 'סכום גדול מ-0 נדרש';
        }
        const notesValue = typeof entry.notes === 'string' ? entry.notes.trim() : '';
        if (!notesValue) {
          rowErrors.notes = 'יש להוסיף הערה להתאמה';
        }
        if (rowErrors.amount || rowErrors.notes) {
          hasError = true;
          if (!errors[empId]) errors[empId] = {};
          errors[empId][dateStr] = rowErrors;
          return;
        }
        entries.push({
          employee_id: empId,
          date: dateStr,
          type: entry.type === 'debit' ? 'debit' : 'credit',
          amount: amountValue,
          notes: notesValue,
        });
      });
    });
    if (hasError) {
      setAdjustmentErrors(errors);
      toast.error('נא למלא סכום והערה עבור כל התאמה.', { duration: 15000 });
      return;
    }
    if (!entries.length) {
      toast.error('נא להזין סכום לפחות להתאמה אחת.', { duration: 15000 });
      return;
    }
    try {
      const result = await saveAdjustments(entries);
      const insertedCount = Array.isArray(result?.inserted) ? result.inserted.length : entries.length;
      toast.success(`נשמרו ${insertedCount} התאמות`);
      setAdjustmentErrors({});
      onSaved();
      onClose();
    } catch (error) {
      toast.error(error.message);
    }
  };
  const adjustmentSaveDisabled = mode === 'adjustment' && adjustmentStats.filled === 0;
  const primaryDisabled = mode === 'leave'
    ? leaveSaveDisabled
    : (mode === 'adjustment' ? adjustmentSaveDisabled : regularSaveDisabled);
  const handlePrimarySave = mode === 'leave'
    ? handleSaveMixed
    : (mode === 'adjustment' ? handleAdjustmentSave : handleRegularSave);

  return (
      <Dialog open={open} onOpenChange={onClose}>
      <TooltipProvider>
        <DialogContent
          wide
          className="max-w-none w-[98vw] max-w-[1200px] p-0 overflow-hidden"
          style={{ maxHeight: 'none' }}
        >
          <DialogHeader>
            <DialogTitle className="sr-only">הזנה מרובה</DialogTitle>
            <DialogDescription className="sr-only">טופס הזנת רישומים למספר תאריכים</DialogDescription>
          </DialogHeader>
          <div
            data-testid="md-container"
            className="flex flex-col w-full h-[min(92vh,calc(100dvh-2rem))]"
          >
            <div
              data-testid="md-header"
              className="sticky top-0 z-20 bg-background border-b px-4 py-3"
            >
              <div className="flex items-center">
                <div className="text-xl font-semibold ml-auto">הזנה מרובה</div>
                <div className="text-sm text-slate-700 flex gap-2 mr-4">
                  <span>נבחרו {selectedEmployees.length} עובדים</span>
                  <span>{selectedDates.length} תאריכים להזנה</span>
                </div>
              </div>
            </div>

            <div
              className="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-24 space-y-3 relative"
              data-testid="md-body"
            >
              <div className="flex items-center bg-slate-100 rounded-lg ring-1 ring-slate-200 p-1 gap-1">
                <Button
                  type="button"
                  variant={mode === 'regular' ? 'default' : 'ghost'}
                  className="flex-1 h-9"
                  onClick={() => handleModeChange('regular')}
                >
                  רישום שעות
                </Button>
                <Button
                  type="button"
                  variant={mode === 'leave' ? 'default' : 'ghost'}
                  className="flex-1 h-9"
                  onClick={() => handleModeChange('leave')}
                >
                  חופשה
                </Button>
                <Button
                  type="button"
                  variant={mode === 'adjustment' ? 'default' : 'ghost'}
                  className="flex-1 h-9"
                  onClick={() => handleModeChange('adjustment')}
                >
                  התאמות
                </Button>
              </div>

              {mode === 'regular' ? (
                <>
                  <div className="flex text-sm text-slate-600">
                    <span>טיפ: אפשר להעתיק ערכים מהרישום הקודם עם האייקון ליד כל שדה.</span>
                    <span className="ml-auto">מולאו {filledCount} מתוך {rows.length} שורות</span>
                  </div>
                  <div className="text-right font-medium text-slate-700">סיכום כולל לרישומים: ₪{summaryTotal.toFixed(2)}</div>
                  {showBanner && (
                    <div className="bg-amber-50 border border-amber-200 p-4 flex justify-between items-center text-sm">
                      <span>חלק מהשורות מכילות שגיאות.</span>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setShowBanner(false)}>חזור לתיקון</Button>
                        <Button size="sm" onClick={saveValidOnly}>שמור רק תקינים</Button>
                      </div>
                    </div>
                  )}
                  {groupedRows.map(([empId, items], idx) => {
                    const emp = employeesById[empId];
                    const isCollapsed = collapsed[empId];
                    return (
                      <div key={empId} className="space-y-3">
                        <div
                          className="flex items-center bg-slate-100 px-3 py-2 rounded-xl ring-1 ring-slate-200 cursor-pointer"
                          onClick={() => toggleEmp(empId)}
                        >
                          <span className="truncate max-w-[60%] text-[17px] font-semibold">{emp.name}</span>
                          <span className="ml-auto text-sm text-slate-600">{formatDatesCount(items.length)}</span>
                          <ChevronUp className={`h-4 w-4 mr-1 transition-transform ${isCollapsed ? 'rotate-180' : ''}`} />
                        </div>
                        {!isCollapsed && (
                          <div className="space-y-3 mt-2 relative">
                            <div className="flex flex-col gap-3 mt-2">
                              {items.map(({ row, index }) => (
                                <EntryRow
                                  key={`${row.employee_id}-${row.date}-${index}`}
                                  value={row}
                                  employee={emp}
                                  services={services}
                                  getRateForDate={getRateForDate}
                                  leaveValueResolver={leaveValueResolver}
                                  onChange={(patch) => updateRow(index, patch)}
                                  onCopyField={(field) => handleCopy(index, field)}
                                  showSummary={true}
                                  readOnlyDate
                                  rowId={`row-${index}`}
                                  flashField={flash && flash.index === index ? flash.field : null}
                                  errors={showErrors ? validation[index].errors : {}}
                                  isDuplicate={!!duplicateMap[index]}
                                  hideDayType={emp.employee_type === 'global'}
                                  allowRemove
                                  onRemove={() => removeRow(index)}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                        {idx !== groupedRows.length - 1 && <Separator className="my-4" />}
                      </div>
                    );
                  })}
                </>
              ) : mode === 'leave' ? (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:items-end">
                    <div className="space-y-1">
                      <Label className="text-sm font-medium text-slate-700">סוג חופשה</Label>
                      <Select value={selectedLeaveType} onValueChange={setSelectedLeaveType}>
                        <SelectTrigger className="bg-white h-10 text-base leading-6">
                          <SelectValue placeholder="בחר סוג חופשה" />
                        </SelectTrigger>
                        <SelectContent>
                          {leaveTypeOptions.map(option => (
                            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-wrap gap-2 justify-end">
                      <Button type="button" onClick={() => markAllMixed(true)}>סמן הכל כבתשלום</Button>
                      <Button type="button" variant="outline" onClick={() => markAllMixed(false)}>סמן הכל כלא בתשלום</Button>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:items-end">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium text-slate-700">סוג חופשה (ברירת מחדל)</Label>
                      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="סוג חופשה מעורבת">
                        {MIXED_SUBTYPE_OPTIONS.map(option => {
                          const active = globalMixedSubtype === option.value;
                          return (
                            <Button
                              key={option.value}
                              type="button"
                              variant={active ? 'default' : 'ghost'}
                              className="h-10"
                              onClick={() => {
                                setGlobalMixedSubtype(option.value);
                                applySubtypeToAll(option.value);
                              }}
                            >
                              {option.label}
                            </Button>
                          );
                        })}
                      </div>
                      <p className="text-xs text-slate-500">ניתן לשנות לכל יום בנפרד ברשימה למטה.</p>
                    </div>
                    <div className="flex flex-wrap gap-2 justify-end">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={applyHalfDayToPaid}
                        disabled={!allowHalfDay}
                      >
                        סמן חצי יום לכל הימים בתשלום
                      </Button>
                      {!allowHalfDay ? (
                        <p className="text-xs text-slate-500">
                          חצי יום מושבת במדיניות החופשות.
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="space-y-4">
                    {selectedEmployees.length === 0 && (
                      <div className="text-sm text-slate-600">בחרו לפחות עובד אחד להזנת חופשה.</div>
                    )}
                    {selectedEmployees.map(empId => {
                      const emp = employeesById[empId];
                      const map = mixedSelections[empId] || {};
                      return (
                        <div key={empId} className="space-y-3 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 p-4">
                          <div className="flex items-center justify-between">
                            <span className="text-[17px] font-semibold truncate max-w-[60%]">{emp?.name || 'עובד'}</span>
                            <span className="text-sm text-slate-600">{formatDatesCount(sortedDates.length)}</span>
                          </div>
                          <div className="space-y-2">
                            <div className="text-sm font-medium text-slate-700">תאריכים שנבחרו</div>
                            <div className="space-y-2">
                              {sortedDates.length === 0 && (
                                <div className="text-sm text-slate-600">בחרו תאריכים להזנת חופשה.</div>
                              )}
                              {sortedDates.map(d => {
                                const dateStr = format(d, 'yyyy-MM-dd');
                                const entry = ensureMixedSelection(map[dateStr]);
                                const paid = entry.paid;
                                const subtypeValue = entry.subtype;
                                const halfDay = entry.halfDay;
                                return (
                                  <div
                                    key={`${empId}-${dateStr}`}
                                    className="space-y-2 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200"
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                      <span className="text-sm font-medium text-slate-700">{format(d, 'dd/MM/yyyy')}</span>
                                      <div className="flex gap-2" role="radiogroup" aria-label={`האם ${format(d, 'dd/MM/yyyy')} בתשלום?`}>
                                        <Button
                                          type="button"
                                          variant={paid ? 'default' : 'ghost'}
                                          className="h-9"
                                          onClick={() => toggleMixedSelection(empId, dateStr, true)}
                                        >
                                          בתשלום
                                        </Button>
                                        <Button
                                          type="button"
                                          variant={!paid ? 'default' : 'ghost'}
                                          className="h-9"
                                          onClick={() => toggleMixedSelection(empId, dateStr, false)}
                                        >
                                          ללא תשלום
                                        </Button>
                                      </div>
                                    </div>
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                      <div className="flex items-center gap-2">
                                        <span className="text-xs font-medium text-slate-600">סוג חופשה</span>
                                        <Select
                                          value={subtypeValue}
                                          onValueChange={value => updateMixedSelection(empId, dateStr, { subtype: value })}
                                        >
                                          <SelectTrigger className="h-9 w-[120px] bg-white text-sm">
                                            <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {MIXED_SUBTYPE_OPTIONS.map(option => (
                                              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <span className={`text-xs font-medium ${paid ? 'text-slate-600' : 'text-slate-400'}`}>חצי יום</span>
                                        <Switch
                                          checked={allowHalfDay && paid ? halfDay : false}
                                          disabled={!paid || !allowHalfDay}
                                          onCheckedChange={checked => updateMixedSelection(empId, dateStr, { halfDay: checked })}
                                          aria-label="חצי יום"
                                        />
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="text-sm text-slate-600">
                    מלאו סכום לכל התאמות שתרצו לשמור. שורות ללא סכום יידלגו אוטומטית.
                  </div>
                  {selectedEmployees.length === 0 ? (
                    <div className="text-sm text-slate-600">בחרו לפחות עובד אחד להזנת התאמות.</div>
                  ) : null}
                  {selectedEmployees.map(empId => {
                    const emp = employeesById[empId];
                    const map = adjustmentValues[empId] || {};
                    return (
                      <div key={empId} className="space-y-3 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 p-4">
                        <div className="flex items-center justify-between">
                          <span className="text-[17px] font-semibold truncate max-w-[60%]">{emp?.name || 'עובד'}</span>
                          <span className="text-sm text-slate-600">{formatDatesCount(sortedDates.length)}</span>
                        </div>
                        <div className="space-y-2">
                          {sortedDates.length === 0 ? (
                            <div className="text-sm text-slate-600">בחרו תאריכים להזנת התאמות.</div>
                          ) : null}
                          {sortedDates.map(d => {
                            const dateStr = format(d, 'yyyy-MM-dd');
                            const entry = map[dateStr] || { type: 'credit', amount: '', notes: '' };
                            const rowErrors = (adjustmentErrors[empId] && adjustmentErrors[empId][dateStr]) || {};
                            const isDebit = entry.type === 'debit';
                            return (
                              <div
                                key={`${empId}-${dateStr}`}
                                className="space-y-3 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                  <span className="text-sm font-medium text-slate-700">{format(d, 'dd/MM/yyyy')}</span>
                                  <div className="flex gap-2" role="radiogroup" aria-label={`סוג התאמה עבור ${format(d, 'dd/MM/yyyy')}`}>
                                    <Button
                                      type="button"
                                      variant={!isDebit ? 'default' : 'ghost'}
                                      className="h-9"
                                      onClick={() => updateAdjustmentValue(empId, dateStr, { type: 'credit' })}
                                    >
                                      זיכוי
                                    </Button>
                                    <Button
                                      type="button"
                                      variant={isDebit ? 'default' : 'ghost'}
                                      className="h-9"
                                      onClick={() => updateAdjustmentValue(empId, dateStr, { type: 'debit' })}
                                    >
                                      ניכוי
                                    </Button>
                                  </div>
                                </div>
                                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                                  <div className="space-y-1">
                                    <Label className="text-sm font-medium text-slate-700">סכום (₪)</Label>
                                    <Input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={entry.amount}
                                      onChange={event => updateAdjustmentValue(empId, dateStr, { amount: event.target.value })}
                                      className="bg-white h-10 text-base"
                                    />
                                    {rowErrors.amount ? (
                                      <p className="text-xs text-red-600 text-right">{rowErrors.amount}</p>
                                    ) : null}
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-sm font-medium text-slate-700">הערות</Label>
                                    <Textarea
                                      value={entry.notes}
                                      onChange={event => updateAdjustmentValue(empId, dateStr, { notes: event.target.value })}
                                      rows={2}
                                      className="bg-white text-base leading-6"
                                      placeholder="הוסיפו הסבר קצר (חובה)"
                                    />
                                    {rowErrors.notes ? (
                                      <p className="text-xs text-red-600 text-right">{rowErrors.notes}</p>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div
              data-testid="md-footer"
              className="shrink-0 bg-background border-t px-4 py-3"
            >
              <div className="flex flex-wrap items-center justify-end gap-3 sm:flex-row-reverse">
                {mode === 'adjustment' ? (
                  <div className="text-sm font-medium text-slate-700 text-right">
                    {adjustmentStats.total > 0
                      ? `סה"כ התאמות: ${adjustmentStats.sum > 0 ? '+' : adjustmentStats.sum < 0 ? '-' : ''}₪${Math.abs(adjustmentStats.sum).toLocaleString()} (${adjustmentStats.filled}/${adjustmentStats.total})`
                      : 'סה"כ התאמות: ₪0'}
                  </div>
                ) : null}
                <div className="flex gap-2">
                  <Button variant="outline" onClick={onClose}>בטל</Button>
                  <Button
                    onClick={handlePrimarySave}
                    disabled={primaryDisabled}
                  >
                    שמור רישומים
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </TooltipProvider>
    </Dialog>
  );
}
