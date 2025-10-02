import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isToday, parseISO } from 'date-fns';
import { he } from 'date-fns/locale';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import TimeEntryForm from './TimeEntryForm';
import ImportModal from '@/components/import/ImportModal.jsx';
import EmployeePicker from '../employees/EmployeePicker.jsx';
import MultiDateEntryModal from './MultiDateEntryModal.jsx';
import {
  aggregateGlobalDays,
  aggregateGlobalDayForDate,
  createLeaveDayValueResolver,
  resolveLeaveSessionValue,
} from '@/lib/payroll.js';
import { Badge } from '@/components/ui/badge';
import {
  HOLIDAY_TYPE_LABELS,
  MIXED_SUBTYPE_LABELS,
  DEFAULT_MIXED_SUBTYPE,
  getLeaveKindFromEntryType,
  inferLeaveType,
  isLeaveEntryType,
  parseMixedLeaveDetails,
  normalizeMixedSubtype,
} from '@/lib/leave.js';
import { selectLeaveDayValue } from '@/selectors.js';

const GENERIC_RATE_SERVICE_ID = '00000000-0000-0000-0000-000000000000';

function TimeEntryTableInner({
  employees,
  workSessions,
  allWorkSessions = null,
  services,
  rateHistories = [],
  getRateForDate,
  onTableSubmit,
  onImported,
  onDeleted,
  leavePolicy,
  leavePayPolicy,
  activeTab = 'all',
}) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [editingCell, setEditingCell] = useState(null); // Will hold { day, employee }
  const [multiMode, setMultiMode] = useState(false);
  const [allSummaryOpen, setAllSummaryOpen] = useState(false);
  const [selectedDates, setSelectedDates] = useState([]);
  const [selectedEmployees, setSelectedEmployees] = useState(employees.map(e => e.id));
  const displaySessions = useMemo(
    () => (Array.isArray(workSessions)
      ? workSessions.filter(session => session && !session.deleted)
      : []),
    [workSessions],
  );
  const contextSessions = useMemo(
    () => {
      if (Array.isArray(allWorkSessions) && allWorkSessions.length) {
        return allWorkSessions.filter(session => session && !session.deleted);
      }
      return displaySessions;
    },
    [allWorkSessions, displaySessions],
  );
  const leaveValueResolver = useMemo(
    () => createLeaveDayValueResolver({
      employees,
      workSessions: contextSessions,
      services,
      leavePayPolicy,
      leaveDayValueSelector: selectLeaveDayValue,
    }),
    [contextSessions, employees, services, leavePayPolicy],
  );
  const resolveRateForDate = useCallback((employeeId, date, serviceId = null) => {
    if (!employeeId || !date) {
      return { rate: 0, reason: 'חסרים פרטי עובד או תאריך' };
    }

    const baseResult = typeof getRateForDate === 'function'
      ? getRateForDate(employeeId, date, serviceId)
      : null;

    const parsedRate = Number(baseResult?.rate);
    if (Number.isFinite(parsedRate) && parsedRate > 0) {
      return { ...baseResult, rate: parsedRate };
    }

    const employee = employees.find(item => item?.id === employeeId);
    if (!employee) {
      return baseResult || { rate: 0, reason: 'אין עובד כזה' };
    }

    const dateValue = date instanceof Date ? date : new Date(date);
    const normalizedDate = Number.isNaN(dateValue.getTime())
      ? null
      : format(dateValue, 'yyyy-MM-dd');
    if (!normalizedDate) {
      return baseResult || { rate: 0, reason: 'תאריך לא תקין' };
    }

    const effectiveServiceId = (employee.employee_type === 'hourly' || employee.employee_type === 'global')
      ? GENERIC_RATE_SERVICE_ID
      : (serviceId || null);

    const relevantRates = rateHistories
      .filter(rate => rate
        && rate.employee_id === employeeId
        && rate.service_id === effectiveServiceId
        && rate.effective_date <= normalizedDate)
      .sort((a, b) => new Date(b.effective_date) - new Date(a.effective_date));

    if (relevantRates.length > 0) {
      const latest = relevantRates[0];
      const fallbackRate = Number(latest?.rate) || 0;
      if (fallbackRate > 0) {
        return { rate: fallbackRate, effectiveDate: latest.effective_date };
      }
    }

    if (baseResult && typeof baseResult === 'object') {
      return baseResult;
    }

    return { rate: 0, reason: 'לא הוגדר תעריף' };
  }, [employees, getRateForDate, rateHistories]);
  const employeesById = useMemo(() => Object.fromEntries(employees.map(e => [e.id, e])), [employees]);
  const [importOpen, setImportOpen] = useState(false);
  const [multiModalOpen, setMultiModalOpen] = useState(false);
  const daysInMonth = useMemo(() => {
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);

    return eachDayOfInterval({ start, end });

  }, [currentMonth]);
  const goToPreviousMonth = () => setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  const goToNextMonth = () => setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));

  // Clear selections when month changes
  useEffect(() => {
    setSelectedDates([]);
    setSelectedEmployees(employees.map(e => e.id));
    setMultiMode(false);
  }, [currentMonth, employees]);



  const monthlyTotals = useMemo(() => {
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);
    const totals = {};
    employees.forEach(emp => {
      totals[emp.id] = {
        hours: 0,
        sessions: 0,
        workPayment: 0,
        leavePaidAmount: 0,
        leaveUnpaidAmount: 0,
        leavePaidCount: 0,
        leaveUnpaidCount: 0,
        adjustmentCredit: 0,
        adjustmentDebit: 0,
        adjustmentNet: 0,
        payment: 0,
        preStartLeaveDates: new Set(),
      };
    });
    const processedLeave = new Map();
    const globalAgg = aggregateGlobalDays(
      displaySessions.filter(s => {
        const d = parseISO(s.date);
        return d >= start && d <= end;
      }),
      employeesById,
    );
    displaySessions.forEach(s => {
      const sessionDate = parseISO(s.date);
      if (sessionDate < start || sessionDate > end) return;
      const emp = employeesById[s.employee_id];
      const empTotals = totals[s.employee_id];
      if (!empTotals || !emp) return;
      if (s.entry_type === 'adjustment') {
        const amount = Number(s.total_payment) || 0;
        if (amount > 0) {
          empTotals.adjustmentCredit += amount;
        } else if (amount < 0) {
          empTotals.adjustmentDebit += Math.abs(amount);
        }
        empTotals.adjustmentNet += amount;
        empTotals.payment += amount;
        return;
      }
      if (isLeaveEntryType(s.entry_type)) {
        const key = `${s.employee_id}|${s.date}`;
        const already = processedLeave.get(key) || 0;
        if (already >= 1) return;
        const sessionValue = resolveLeaveSessionValue(s, leaveValueResolver, { employee: emp });
        if (sessionValue.preStartDate) {
          empTotals.preStartLeaveDates.add(s.date);
          processedLeave.set(key, 1);
          return;
        }
        const multiplier = Number.isFinite(sessionValue.multiplier) && sessionValue.multiplier > 0
          ? sessionValue.multiplier
          : 1;
        const remaining = Math.max(0, 1 - already);
        if (remaining <= 0) return;
        const credit = Math.min(multiplier, remaining);
        const scale = multiplier ? credit / multiplier : 0;
        const amount = sessionValue.amount * scale;
        const countCredit = Number.isFinite(credit) && credit > 0 ? credit : 0;
        if (s.payable === false || amount <= 0) {
          empTotals.leaveUnpaidCount += countCredit;
          empTotals.leaveUnpaidAmount += Math.abs(amount);
        } else if (emp.employee_type !== 'global') {
          empTotals.leavePaidCount += countCredit;
          empTotals.leavePaidAmount += amount;
          empTotals.payment += amount;
        }
        processedLeave.set(key, already + credit);
        return;
      }
      if (s.entry_type === 'session') {
        empTotals.sessions += s.sessions_count || 0;
        const amount = Number(s.total_payment) || 0;
        empTotals.workPayment += amount;
        empTotals.payment += amount;
        return;
      }
      if (s.entry_type === 'hours') {
        empTotals.hours += s.hours || 0;
        const amount = Number(s.total_payment) || 0;
        if (emp.employee_type !== 'global') {
          empTotals.workPayment += amount;
          empTotals.payment += amount;
        }
        return;
      }
    });
    globalAgg.forEach((value, key) => {
      const [empId] = key.split('|');
      const empTotals = totals[empId];
      if (!empTotals) return;
      const amount = Number(value?.dailyAmount) || 0;
      if (!amount) return;
      empTotals.payment += amount;
      if (isLeaveEntryType(value?.dayType)) {
        const multiplier = Number.isFinite(value?.multiplier) && value.multiplier > 0
          ? value.multiplier
          : 1;
        if (value?.payable === false) {
          empTotals.leaveUnpaidAmount += Math.abs(amount);
          empTotals.leaveUnpaidCount += multiplier;
        } else {
          empTotals.leavePaidAmount += amount;
          empTotals.leavePaidCount += multiplier;
        }
      } else {
        empTotals.workPayment += amount;
      }
    });
    return totals;
  }, [displaySessions, employees, employeesById, currentMonth, leaveValueResolver]);

  const toggleDateSelection = (day) => {
    setSelectedDates(prev => {
      const exists = prev.find(d => d.getTime() === day.getTime());
      return exists ? prev.filter(d => d.getTime() !== day.getTime()) : [...prev, day];
    });
  };

  const startMultiEntry = () => {
    if (!selectedDates.length || !selectedEmployees.length) return;
    setMultiModalOpen(true);
  };

  useEffect(() => {
    if (activeTab !== 'all') {
      setAllSummaryOpen(false);
    }
  }, [activeTab]);

  const shouldShowHoursSummary = activeTab === 'work' || (activeTab === 'all' && allSummaryOpen);
  const summaryRowConfigs = [];
  if (activeTab === 'all') {
    summaryRowConfigs.push({
      key: 'workPayment',
      label: 'סה"כ תשלום שעות/שיעורים',
      getValue: totals => totals.workPayment || 0,
      format: 'currency',
    });
    summaryRowConfigs.push({
      key: 'leavePaid',
      label: 'סה"כ חופשות בתשלום',
      getValue: totals => totals.leavePaidAmount || 0,
      format: 'currency',
    });
    summaryRowConfigs.push({
      key: 'leaveUnpaid',
      label: 'סה"כ חופשות ללא תשלום',
      getValue: totals => totals.leaveUnpaidAmount || 0,
      format: 'muted',
    });
  }
  if (activeTab === 'leave') {
    summaryRowConfigs.push({
      key: 'leavePaidCount',
      label: 'סה"כ חופשות בתשלום (כמות)',
      getValue: totals => totals.leavePaidCount || 0,
      format: 'count',
    });
    summaryRowConfigs.push({
      key: 'leaveUnpaidCount',
      label: 'סה"כ חופשות ללא תשלום (כמות)',
      getValue: totals => totals.leaveUnpaidCount || 0,
      format: 'count-muted',
    });
  }
  if (activeTab === 'all' || activeTab === 'adjustments') {
    summaryRowConfigs.push({
      key: 'adjustmentsCredit',
      label: 'סה"כ התאמות - זיכויים',
      getValue: totals => totals.adjustmentCredit || 0,
      format: 'currency',
    });
    summaryRowConfigs.push({
      key: 'adjustmentsDebit',
      label: 'סה"כ התאמות - ניקויים',
      getValue: totals => totals.adjustmentDebit || 0,
      format: 'debit',
    });
    if (activeTab === 'all') {
      summaryRowConfigs.push({
        key: 'adjustmentsNet',
        label: 'סה"כ התאמות (נטו)',
        getValue: totals => totals.adjustmentNet || 0,
        format: 'net',
      });
    }
  }
  const finalRowConfig = (() => {
    if (activeTab === 'leave') {
      return {
        key: 'leaveTotal',
        label: 'סה"כ חופשות (כמות)',
        getValue: totals => (totals.leavePaidCount || 0) + (totals.leaveUnpaidCount || 0),
        format: 'count-total',
        showPreStart: true,
      };
    }
    if (activeTab === 'adjustments') {
      return {
        key: 'adjustmentsNet',
        label: 'סה"כ התאמות (נטו)',
        getValue: totals => totals.adjustmentNet || 0,
        format: 'net',
      };
    }
    if (activeTab === 'work') {
      return {
        key: 'workTotal',
        label: 'סה"כ צפי לתשלום',
        getValue: totals => totals.workPayment || 0,
        format: 'total',
      };
    }
    return {
      key: 'grandTotal',
      label: 'סה"כ צפי לתשלום',
      getValue: totals => totals.payment || 0,
      format: 'total',
      showPreStart: true,
    };
  })();

  const formatCurrencyValue = (amount, format = 'currency') => {
    const numeric = Number(amount) || 0;
    const absValue = Math.abs(numeric);
    const formatted = `₪${absValue.toLocaleString()}`;
    if (format === 'muted') {
      return { text: formatted, className: 'text-slate-600' };
    }
    if (format === 'count' || format === 'count-muted' || format === 'count-total') {
      const display = numeric.toLocaleString(undefined, {
        maximumFractionDigits: 2,
        minimumFractionDigits: Math.abs(numeric % 1) > 0 ? 1 : 0,
      });
      const baseClass = format === 'count-muted'
        ? 'text-slate-600'
        : format === 'count-total'
          ? (numeric === 0 ? 'text-slate-600' : 'text-slate-800 font-semibold')
          : 'text-slate-800';
      return { text: display, className: baseClass };
    }
    if (format === 'debit') {
      return {
        text: numeric ? `-₪${absValue.toLocaleString()}` : '₪0',
        className: numeric ? 'text-red-700' : 'text-slate-600',
      };
    }
    if (format === 'net') {
      if (numeric > 0) return { text: `+₪${absValue.toLocaleString()}`, className: 'text-green-700' };
      if (numeric < 0) return { text: `-₪${absValue.toLocaleString()}`, className: 'text-red-700' };
      return { text: '₪0', className: 'text-slate-600' };
    }
    if (format === 'total') {
      if (numeric < 0) return { text: `-₪${absValue.toLocaleString()}`, className: 'text-red-700' };
      if (numeric === 0) return { text: '₪0', className: 'text-slate-600' };
      return { text: `₪${absValue.toLocaleString()}`, className: 'text-green-700' };
    }
    return {
      text: `₪${absValue.toLocaleString()}`,
      className: numeric === 0 ? 'text-slate-600' : 'text-green-700',
    };
  };

  return (
    <> {/* Using a Fragment (<>) instead of a div to avoid extra wrappers */}
        <Card>
        <CardContent className="p-4">
            {/* Header with Month Navigation */}
            <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={goToPreviousMonth}><ChevronRight className="w-4 h-4" /></Button>
              <h2 className="text-xl font-bold">{format(currentMonth, 'MMMM yyyy', { locale: he })}</h2>
              <Button variant="outline" size="icon" onClick={goToNextMonth}><ChevronLeft className="w-4 h-4" /></Button>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setImportOpen(true)}>ייבוא CSV</Button>
              {!multiMode ? (
                <Button variant="outline" onClick={() => {
                  setMultiMode(true);
                  setSelectedDates([]);
                  setSelectedEmployees(employees.map(e => e.id));
                }}>בחר תאריכים להזנה מרובה</Button>
              ) : (
                <>
                  <EmployeePicker employees={employees} value={selectedEmployees} onChange={setSelectedEmployees} />
                  <Button variant="default" onClick={startMultiEntry} disabled={!selectedDates.length || !selectedEmployees.length}>הזן</Button>
                  <Button variant="outline" onClick={() => { setMultiMode(false); setSelectedDates([]); setSelectedEmployees(employees.map(e => e.id)); }}>בטל</Button>
                </>
              )}
            </div>
            </div>

            {/* Table */}
                <div className="overflow-auto border rounded-lg max-h-[65vh]"> 
                    <Table className="min-w-full">
                        <TableHeader className="sticky top-0 z-20">
                        <TableRow>
                            <TableHead className="sticky w-24 text-right right-0 bg-slate-100 z-20 shadow-sm">תאריך</TableHead>
                            {/* Headers display each employee with current rate info */}
                            {employees.map(emp => {
                            const headerRateInfo = (emp.employee_type === 'hourly' || emp.employee_type === 'global')
                              ? resolveRateForDate(emp.id, currentMonth)
                              : null;
                            return (
                              <TableHead key={emp.id} className="top-0 text-center z-20 min-w-[140px] p-2 bg-slate-50 shadow-sm">
                                <div className="flex flex-col items-center">
                                  <span>{emp.name}</span>
                                  {headerRateInfo && (
                                    headerRateInfo.rate > 0 ? (
                                      <>
                                        <span className="text-xs text-green-700">
                                          {emp.employee_type === 'hourly'
                                            ? `₪${headerRateInfo.rate.toFixed(2)}`
                                            : `₪${headerRateInfo.rate.toLocaleString()} לחודש`}
                                        </span>
                                        <span className="text-[10px] text-slate-500">
                                          {`מ-${format(parseISO(headerRateInfo.effectiveDate), 'dd/MM/yy')}`}
                                        </span>
                                      </>
                                    ) : headerRateInfo.reason === 'לא התחילו לעבוד עדיין' ? (
                                      <span className="text-xs text-red-700">טרם התחיל</span>
                                    ) : null
                                  )}
                                </div>
                              </TableHead>
                            );
                            })}
                        </TableRow>
                        </TableHeader>
                        <TableBody>

                        {/* Loop through each day of the month to create a row */}
                        {daysInMonth.map(day => (
                            <TableRow key={day.toISOString()}>
                            <TableCell className={`text-right font-semibold sticky right-0 z-10 p-2 ${isToday(day) ? 'bg-blue-100' : 'bg-slate-50'}`}>
                                <div className="flex items-center justify-end gap-2">
                                {multiMode && (
                                  <input type="checkbox" checked={selectedDates.some(d => d.getTime() === day.getTime())} onChange={() => toggleDateSelection(day)} />
                                )}
                                <span>{format(day, 'd')}</span>
                                <span className="text-xs text-slate-500">{format(day, 'EEE', { locale: he })}</span>
                                </div>
                            </TableCell>

                            {/* For each day, loop through employees to create a cell */}
                            {employees.map(emp => {
                                const dailySessions = displaySessions.filter(s =>
                                s.employee_id === emp.id &&
                                format(parseISO(s.date), 'yyyy-MM-dd') === format(day, 'yyyy-MM-dd')
                                );
                                const adjustments = dailySessions.filter(s =>
                                  s.entry_type === 'adjustment'
                                );
                                const paidLeave = dailySessions.find(s => isLeaveEntryType(s.entry_type));
                                const regularSessions = dailySessions.filter(s =>
                                  s.entry_type !== 'adjustment' && !isLeaveEntryType(s.entry_type)
                                );
                                const adjustmentTotal = adjustments.reduce((sum, s) => sum + (s.total_payment || 0), 0);

        let summaryText = '-';
        let summaryPayment = 0;
        let extraInfo = '';
        const rateInfo = resolveRateForDate(emp.id, day);
        const showNoRateWarning = regularSessions.some(s => s.rate_used === 0);
        let leaveKind = null;
        let leaveLabel = null;
        let leavePayment = null;
        const startDateStr = typeof emp.start_date === 'string' ? emp.start_date : null;
        const isPreStartLeave = Boolean(
          paidLeave &&
          startDateStr &&
          paidLeave.date &&
                                  paidLeave.date < startDateStr
                                );

                                if (paidLeave) {
                                  const inferredType = inferLeaveType(paidLeave);
                                  leaveKind = inferredType || getLeaveKindFromEntryType(paidLeave.entry_type) || null;
                                  leaveLabel = inferredType
                                    ? (HOLIDAY_TYPE_LABELS[inferredType] || inferredType)
                                    : (leaveKind ? (HOLIDAY_TYPE_LABELS[leaveKind] || leaveKind) : null);
                                  if (inferredType === 'mixed' || leaveKind === 'mixed') {
                                    const mixedDetails = parseMixedLeaveDetails(paidLeave);
                                    const resolvedSubtype = normalizeMixedSubtype(mixedDetails.subtype) || DEFAULT_MIXED_SUBTYPE;
                                    const subtypeLabel = MIXED_SUBTYPE_LABELS[resolvedSubtype] || null;
                                    const isPaid = mixedDetails.paid === null ? (paidLeave.payable !== false) : mixedDetails.paid;
                                    const parts = [
                                      'מעורב',
                                      subtypeLabel,
                                      isPaid ? 'בתשלום' : 'ללא תשלום',
                                      isPaid && mixedDetails.halfDay ? 'חצי יום' : null,
                                    ].filter(Boolean);
                                    summaryText = parts.join(' · ') || 'מעורב';
                                  leaveLabel = summaryText;
                                } else {
                                  summaryText = leaveLabel || 'חופשה';
                                }
                                const leaveValue = resolveLeaveSessionValue(paidLeave, leaveValueResolver, { employee: emp });
                                if (!leaveValue.preStartDate) {
                                  const calculatedAmount = paidLeave.payable === false
                                    ? 0
                                    : (Number.isFinite(leaveValue.amount) ? leaveValue.amount : 0);
                                  leavePayment = Math.max(0, calculatedAmount || 0);
                                }
                              } else if (regularSessions.length > 0) {
                                if (emp.employee_type === 'instructor') {
                                  summaryPayment = regularSessions.reduce((sum, s) => sum + (s.total_payment || 0), 0);
                                  const sessionCount = regularSessions.reduce((sum, s) => sum + (s.sessions_count || 0), 0);
                                    summaryText = `${sessionCount} מפגשים`;
                                  } else if (emp.employee_type === 'hourly') {
                                    const hoursCount = regularSessions.reduce((sum, s) => sum + (s.hours || 0), 0);
                                    summaryText = `${hoursCount.toFixed(1)} שעות`;
                                    summaryPayment = regularSessions.reduce((sum, s) => sum + (s.total_payment || 0), 0);
                                  } else {
                                    const hoursCount = regularSessions.reduce((sum, s) => sum + (s.hours || 0), 0);
                                    const agg = aggregateGlobalDayForDate(regularSessions, employeesById);
                                    summaryPayment = agg.total;
                                    summaryText = hoursCount > 0 ? `${hoursCount.toFixed(1)} שעות` : '-';
                                    extraInfo = summaryPayment > 0 ? `₪${summaryPayment.toLocaleString()}` : '';
                                  }
                                }

                                const isSelected = multiMode && selectedDates.some(d => d.getTime() === day.getTime()) && selectedEmployees.includes(emp.id);

                                return (
                                    <TableCell
                                        key={emp.id}
                                        className={`text-center transition-colors p-2 ${isSelected ? 'bg-blue-50' : ''} ${multiMode ? '' : 'cursor-pointer hover:bg-blue-50'}`}
                                        onClick={() => {
                                          if (!multiMode) {
                                            const payload = {
                                              day,
                                              employee: emp,
                                              existingSessions: regularSessions,
                                              adjustments,
                                            };
                                            if (paidLeave) {
                                              payload.dayType = 'paid_leave';
                                              payload.paidLeaveId = paidLeave.id;
                                              payload.paidLeaveNotes = paidLeave.notes || '';
                                              const inferredType = inferLeaveType(paidLeave);
                                              payload.leaveType = inferredType || leaveKind || null;
                                              if (leaveKind === 'mixed') {
                                                const mixedDetails = parseMixedLeaveDetails(paidLeave);
                                                const resolvedSubtype = normalizeMixedSubtype(mixedDetails.subtype) || DEFAULT_MIXED_SUBTYPE;
                                                const isPaid = mixedDetails.paid === null
                                                  ? (paidLeave.payable !== false)
                                                  : mixedDetails.paid;
                                                payload.mixedPaid = isPaid;
                                                payload.mixedSubtype = resolvedSubtype;
                                                payload.mixedHalfDay = isPaid && mixedDetails.halfDay === true;
                                              }
                                              if ((payload.leaveType || leaveKind) === 'half_day') {
                                                payload.halfDayPrimaryLeaveType = paidLeave?.payable === false
                                                  ? 'system_paid'
                                                  : 'employee_paid';
                                                if (regularSessions.length > 0) {
                                                  payload.halfDaySecondHalfMode = 'work';
                                                } else {
                                                  const otherLeaveSessions = dailySessions.filter(session => (
                                                    isLeaveEntryType(session.entry_type)
                                                    && session.id !== paidLeave.id
                                                  ));
                                                  if (otherLeaveSessions.length > 0) {
                                                    payload.halfDaySecondHalfMode = 'leave';
                                                    const inferredSecondary = inferLeaveType(otherLeaveSessions[0]);
                                                    payload.halfDaySecondLeaveType = inferredSecondary
                                                      || getLeaveKindFromEntryType(otherLeaveSessions[0].entry_type)
                                                      || 'employee_paid';
                                                  }
                                                }
                                              }
                                            } else if (activeTab === 'adjustments') {
                                              payload.dayType = 'adjustment';
                                            } else if (activeTab === 'leave') {
                                              payload.dayType = 'paid_leave';
                                            }
                                            if (!payload.dayType && !paidLeave && regularSessions.length === 0 && adjustments.length > 0) {
                                              payload.dayType = 'adjustment';
                                            }
                                            setEditingCell(payload);
                                          }
                                        }}
                                    >
                                        <div className="font-semibold text-sm">{summaryText}</div>
                                        {extraInfo && (
                                          <div className="text-xs text-slate-500">{extraInfo}</div>
                                        )}
                                        {paidLeave && (
                                          <div className="mt-1 flex justify-center">
                                            <Badge variant="secondary">{leaveLabel || 'חופשה'}</Badge>
                                          </div>
                                        )}

                {/* --- WARNINGS --- */}
                                        {rateInfo?.reason === 'לא התחילו לעבוד עדיין' && (
                                          <div className="text-xs text-red-700">טרם התחיל</div>
                                        )}

                                        {showNoRateWarning && summaryText !== '-' && (
                                          <div className="text-xs text-red-700">לא הוגדר תעריף</div>
                                        )}

                                        {leavePayment !== null && !isPreStartLeave && (
                                          <div className={`text-xs ${leavePayment > 0 ? 'text-green-700' : 'text-slate-600'}`}>
                                            ₪{leavePayment.toLocaleString()}
                                          </div>
                                        )}

                                        {summaryPayment > 0 && emp.employee_type !== 'global' && (
                                          <div className="text-xs text-green-700">₪{summaryPayment.toLocaleString()}</div>
                                        )}

                                        {adjustmentTotal !== 0 && (
                                          <div className={`text-xs ${adjustmentTotal > 0 ? 'text-green-700' : 'text-red-700'}`}> 
                                            {adjustmentTotal > 0 ? '+' : '-'}₪{Math.abs(adjustmentTotal).toLocaleString()}
                                          </div>
                                        )}

                                        {isPreStartLeave && (
                                          <div className="mt-1 text-[11px] text-amber-700">
                                            תאריך לפני תחילת עבודה—הושמט מהסכום
                                          </div>
                                        )}
                                    </TableCell>
                                    );
                            })}
                            </TableRow>
                        ))}

                        {/* Totals Rows */}
                        {shouldShowHoursSummary && (
                          <TableRow className="bg-slate-100 font-medium">
                            <TableCell className="text-right sticky right-0 bg-slate-100">סה"כ שיעורים/שעות</TableCell>
                            {employees.map(emp => {
                              const totals = monthlyTotals[emp.id] || {
                                hours: 0,
                                sessions: 0,
                              };
                              const value = emp.employee_type === 'instructor'
                                ? `${totals.sessions} מפגשים`
                                : `${(totals.hours || 0).toFixed(1)} שעות`;
                              return (
                                <TableCell key={emp.id} className="text-center">
                                  {value}
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        )}
                        {activeTab === 'all' && summaryRowConfigs.length > 0 && (
                          <TableRow className="bg-slate-100">
                            <TableCell
                              colSpan={employees.length + 1}
                              className="bg-slate-100 p-0"
                            >
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setAllSummaryOpen(prev => !prev)}
                                aria-expanded={allSummaryOpen}
                                className="flex w-full items-center justify-between gap-2 rounded-none px-4 py-3 text-right"
                              >
                                <span className="flex-1 text-right">
                                  {allSummaryOpen ? 'הסתר פירוט' : 'הצג פירוט'}
                                </span>
                                <ChevronDown
                                  className={`h-4 w-4 shrink-0 transition-transform ${allSummaryOpen ? 'rotate-180' : ''}`}
                                />
                              </Button>
                            </TableCell>
                          </TableRow>
                        )}
                        {(activeTab !== 'all' || allSummaryOpen) && summaryRowConfigs.map(row => (
                          <TableRow key={row.key} className="bg-slate-100 font-medium">
                            <TableCell className="text-right sticky right-0 bg-slate-100">{row.label}</TableCell>
                            {employees.map(emp => {
                              const totals = monthlyTotals[emp.id] || {
                                workPayment: 0,
                                leavePaidAmount: 0,
                                leaveUnpaidAmount: 0,
                                leavePaidCount: 0,
                                leaveUnpaidCount: 0,
                                adjustmentCredit: 0,
                                adjustmentDebit: 0,
                                adjustmentNet: 0,
                              };
                              const rawValue = typeof row.getValue === 'function' ? row.getValue(totals, emp) : 0;
                              const { text, className } = formatCurrencyValue(rawValue, row.format);
                              return (
                                <TableCell key={emp.id} className={`text-center ${className}`}>
                                  {text}
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        ))}
                        <TableRow className="bg-slate-100 font-semibold">
                          <TableCell className="text-right sticky right-0 bg-slate-100">{finalRowConfig.label}</TableCell>
                          {employees.map(emp => {
                            const totals = monthlyTotals[emp.id] || {
                              workPayment: 0,
                              leavePaidAmount: 0,
                              leaveUnpaidAmount: 0,
                              leavePaidCount: 0,
                              leaveUnpaidCount: 0,
                              adjustmentNet: 0,
                              payment: 0,
                              preStartLeaveDates: new Set(),
                            };
                            const value = typeof finalRowConfig.getValue === 'function'
                              ? finalRowConfig.getValue(totals, emp)
                              : 0;
                            const { text, className } = formatCurrencyValue(value, finalRowConfig.format);
                            const hasPreStart = finalRowConfig.showPreStart && (
                              totals.preStartLeaveDates instanceof Set
                                ? totals.preStartLeaveDates.size > 0
                                : Array.isArray(totals.preStartLeaveDates) && totals.preStartLeaveDates.length > 0
                            );
                            return (
                              <TableCell key={emp.id} className={`text-center ${className}`}>
                                <div>{text}</div>
                                {hasPreStart && (
                                  <div className="mt-1 text-[11px] text-amber-700">
                                    תאריך לפני תחילת עבודה—הושמט מהסכום
                                  </div>
                                )}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                        </TableBody>
                    </Table>
                </div>

        </CardContent>
        </Card>
        {/* The Dialog for editing/adding entries */}
        <Dialog open={!!editingCell} onOpenChange={(isOpen) => !isOpen && setEditingCell(null)}>
        <DialogContent wide className="max-w-none w-[98vw] max-w-[1100px] p-0 overflow-hidden">
          <DialogHeader>
            <DialogTitle className="sr-only">עריכת רישומי זמן</DialogTitle>
            <DialogDescription className="sr-only">טופס עריכת רישומים</DialogDescription>
          </DialogHeader>
          {editingCell && (
            <TimeEntryForm
              employee={editingCell.employee}
              allEmployees={employees}
              workSessions={contextSessions}
              services={services}
              initialRows={editingCell.existingSessions}
              initialAdjustments={editingCell.adjustments}
              initialDayType={editingCell.dayType || 'regular'}
              paidLeaveId={editingCell.paidLeaveId}
              paidLeaveNotes={editingCell.paidLeaveNotes}
              initialLeaveType={editingCell.leaveType}
              selectedDate={format(editingCell.day, 'yyyy-MM-dd')}
              getRateForDate={resolveRateForDate}
              allowDayTypeSelection
              allowHalfDay={leavePolicy?.allow_half_day}
              initialMixedPaid={editingCell.mixedPaid}
              initialMixedSubtype={editingCell.mixedSubtype}
              initialMixedHalfDay={editingCell.mixedHalfDay}
              initialHalfDaySecondHalfMode={editingCell.halfDaySecondHalfMode}
              initialHalfDaySecondLeaveType={editingCell.halfDaySecondLeaveType}
              initialHalfDayPrimaryLeaveType={editingCell.halfDayPrimaryLeaveType}
              leavePayPolicy={leavePayPolicy}
              onSubmit={async (result) => {
                if (!result) {
                  setEditingCell(null);
                  return { cancelled: true };
                }
                try {
                    const submissionResponse = await onTableSubmit({
                      employee: editingCell.employee,
                      day: editingCell.day,
                      dayType: result.dayType,
                      updatedRows: result.rows,
                      paidLeaveId: result.paidLeaveId,
                      paidLeaveNotes: result.paidLeaveNotes,
                      leaveType: result.leaveType,
                      mixedPaid: result.mixedPaid,
                      mixedSubtype: result.mixedSubtype,
                      mixedHalfDay: result.mixedHalfDay,
                      halfDaySecondHalfMode: result.halfDaySecondHalfMode,
                      halfDayWorkSegments: result.halfDayWorkSegments,
                      halfDaySecondLeaveType: result.halfDaySecondLeaveType,
                      includeHalfDaySecondHalf: result.includeHalfDaySecondHalf,
                      halfDayRemovedWorkIds: result.halfDayRemovedWorkIds,
                      adjustments: result.adjustments,
                      overrideDailyValue: result.overrideDailyValue,
                    });
                  if (!submissionResponse?.needsConfirmation) {
                    setEditingCell(null);
                  }
                  return submissionResponse;
                } catch {
                  // keep modal open on error
                  return null;
                }
              }}
              onDeleted={(ids, rows = []) => {
                setEditingCell(prev => {
                  if (!prev) return prev;
                  const toRemove = new Set((ids || []).map(val => String(val)));
                  return {
                    ...prev,
                    existingSessions: Array.isArray(prev.existingSessions)
                      ? prev.existingSessions.filter(s => !toRemove.has(String(s.id)))
                      : prev.existingSessions,
                    adjustments: Array.isArray(prev.adjustments)
                      ? prev.adjustments.filter(s => !toRemove.has(String(s.id)))
                      : prev.adjustments,
                  };
                });
                if (typeof onDeleted === 'function') {
                  onDeleted(ids, rows);
                }
              }}
            />
          )}
        </DialogContent>
        </Dialog>
        <ImportModal
          open={importOpen}
          onOpenChange={setImportOpen}
          employees={employees}
          services={services}
          getRateForDate={resolveRateForDate}
          workSessions={contextSessions}
          onImported={onImported}
        />
        <MultiDateEntryModal
          open={multiModalOpen}
          onClose={() => setMultiModalOpen(false)}
          employees={employees}
          services={services}
          selectedEmployees={selectedEmployees}
          selectedDates={selectedDates}
          getRateForDate={resolveRateForDate}
          workSessions={contextSessions}
          leavePayPolicy={leavePayPolicy}
          allowHalfDay={leavePolicy?.allow_half_day}
          defaultMode={activeTab === 'leave'
            ? 'leave'
            : (activeTab === 'adjustments' ? 'adjustment' : 'regular')}
          onSaved={() => {
            onImported();
            setSelectedDates([]);
            setSelectedEmployees(employees.map(e => e.id));
            setMultiMode(false);
            setMultiModalOpen(false);
          }}
        />
    </>
    );
}

export default function TimeEntryTable(props) {
  return <TimeEntryTableInner {...props} />;
}