import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Loader2, ShieldCheck, Info } from 'lucide-react';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import { fetchEmployeesList, updateEmployee } from '@/api/employees.js';
import { createLeaveBalanceEntry } from '@/api/leave-balances.js';
import { fetchWorkSessions } from '@/api/work-sessions.js';
import { getServices } from '@/api/services.js';
import { selectLeaveRemaining, selectHolidayForDate, selectLeaveDayValue } from '@/selectors.js';
import {
  DEFAULT_LEAVE_POLICY,
  DEFAULT_LEAVE_PAY_POLICY,
  HOLIDAY_TYPE_LABELS,
  LEAVE_TYPE_OPTIONS,
  LEAVE_PAY_METHOD_OPTIONS,
  LEAVE_PAY_METHOD_DESCRIPTIONS,
  LEAVE_PAY_METHOD_LABELS,
  SYSTEM_PAID_ALERT_TEXT,
  getLeaveBaseKind,
  isPayableLeaveKind,
  resolveLeavePayMethodContext,
  formatLeaveTypeLabel,
} from '@/lib/leave.js';
import { useTimeEntry } from '@/components/time-entry/useTimeEntry.js';

const EMPLOYEE_PLACEHOLDER_VALUE = '__employee_placeholder__';
const OVERRIDE_METHOD_PLACEHOLDER_VALUE = '__no_override__';
const GENERIC_RATE_SERVICE_ID = '00000000-0000-0000-0000-000000000000';

const ENTRY_KINDS = [
  { value: 'usage', label: 'סימון חופשה' },
  { value: 'allocation', label: 'הקצאת ימי חופשה' },
];

function determineUsageAmount(type) {
  const baseKind = getLeaveBaseKind(type) || type;
  if (baseKind === 'half_day') return 0.5;
  if (baseKind === 'system_paid' || baseKind === 'unpaid') return 0;
  return 1;
}

export default function LeaveOverview({
  employees = [],
  leaveBalances = [],
  leavePolicy = DEFAULT_LEAVE_POLICY,
  leavePayPolicy = DEFAULT_LEAVE_PAY_POLICY,
  onRefresh,
  isLoading = false,
}) {
  const [evaluationDate, setEvaluationDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [showInactive, setShowInactive] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const initialEmployeeId = employees[0]?.id ?? EMPLOYEE_PLACEHOLDER_VALUE;
  const [formState, setFormState] = useState(() => ({
    employeeId: initialEmployeeId,
    entryKind: 'usage',
    date: new Date().toISOString().slice(0, 10),
    holidayType: '',
    usageAmount: 1,
    allocationAmount: 1,
    notes: '',
  }));
  const [lastNonSystemHolidayType, setLastNonSystemHolidayType] = useState('employee_paid');
  const [overrideEmployeeId, setOverrideEmployeeId] = useState(null);
  const [overrideMethod, setOverrideMethod] = useState(OVERRIDE_METHOD_PLACEHOLDER_VALUE);
  const [overrideRate, setOverrideRate] = useState('');
  const [isSavingOverride, setIsSavingOverride] = useState(false);
  const [isOverrideDialogOpen, setIsOverrideDialogOpen] = useState(false);
  const [servicesList, setServicesList] = useState([]);
  const [workSessionsHistory, setWorkSessionsHistory] = useState([]);
  const [rateHistories, setRateHistories] = useState([]);
  const [includeSecondHalf, setIncludeSecondHalf] = useState(false);
  const [secondHalfMode, setSecondHalfMode] = useState('work');
  const [secondHalfLeaveType, setSecondHalfLeaveType] = useState('employee_paid');
  const [secondHalfHours, setSecondHalfHours] = useState('4');
  const [secondHalfServiceId, setSecondHalfServiceId] = useState('');
  const [secondHalfSessionsCount, setSecondHalfSessionsCount] = useState('1');
  const [secondHalfStudentsCount, setSecondHalfStudentsCount] = useState('');
  const [fallbackDialogState, setFallbackDialogState] = useState(null);
  const [fallbackAmount, setFallbackAmount] = useState('');
  const [fallbackError, setFallbackError] = useState('');
  const [isFallbackSubmitting, setIsFallbackSubmitting] = useState(false);
  const { authClient, user, loading, session, dataClient } = useSupabase();
  const { activeOrgId } = useOrg();

  const loadSupportingData = useCallback(async () => {
    if (!session || !activeOrgId) {
      setServicesList([]);
      setWorkSessionsHistory([]);
      setRateHistories([]);
      return;
    }

    try {
      const [servicesResponse, sessionsResponse, employeesBundle] = await Promise.all([
        getServices({ session, orgId: activeOrgId }),
        fetchWorkSessions({ session, orgId: activeOrgId }),
        fetchEmployeesList({ session, orgId: activeOrgId }),
      ]);

      const nextServices = Array.isArray(servicesResponse?.services)
        ? servicesResponse.services.filter(service => service && service.id !== GENERIC_RATE_SERVICE_ID)
        : [];
      const nextSessions = Array.isArray(sessionsResponse?.sessions)
        ? sessionsResponse.sessions.filter(item => item && !item.deleted)
        : [];
      const nextRateHistory = Array.isArray(employeesBundle?.rateHistory)
        ? employeesBundle.rateHistory
        : [];

      setServicesList(nextServices);
      setWorkSessionsHistory(nextSessions);
      setRateHistories(nextRateHistory);
    } catch (error) {
      console.error('Failed to load supporting leave data', error);
    }
  }, [session, activeOrgId]);

  useEffect(() => {
    loadSupportingData();
  }, [loadSupportingData]);

  const usageOptions = useMemo(() => {
    return LEAVE_TYPE_OPTIONS
      .filter(option => option.value !== 'mixed')
      .filter(option => leavePolicy.allow_half_day || option.value !== 'half_day')
      .map(option => ({
        ...option,
        label: formatLeaveTypeLabel(option.value, option.label),
      }));
  }, [leavePolicy.allow_half_day]);

  const secondaryLeaveTypeOptions = useMemo(() => (
    LEAVE_TYPE_OPTIONS
      .filter(option => option.value !== 'mixed' && option.value !== 'half_day')
      .map(option => ({
        value: option.value,
        label: formatLeaveTypeLabel(option.value, option.label),
      }))
  ), []);

  const selectedUsageEmployee = useMemo(() => {
    if (!formState.employeeId || formState.employeeId === EMPLOYEE_PLACEHOLDER_VALUE) {
      return null;
    }
    return employees.find(emp => emp.id === formState.employeeId) || null;
  }, [employees, formState.employeeId]);

  const isUsageEntry = formState.entryKind === 'usage';
  const isHalfDaySelection = isUsageEntry && formState.holidayType === 'half_day';
  const secondHalfEnabled = isUsageEntry && isHalfDaySelection && includeSecondHalf;
  const shouldIncludeSecondHalfLeave = secondHalfEnabled && secondHalfMode === 'leave';
  const shouldIncludeSecondHalfWork = secondHalfEnabled && secondHalfMode === 'work';

  const { saveLeaveDay } = useTimeEntry({
    employees,
    services: servicesList,
    getRateForDate,
    metadataClient: dataClient,
    workSessions: workSessionsHistory,
    leavePayPolicy,
    leavePolicy,
    leaveBalances,
    session,
    orgId: activeOrgId,
  });

  const defaultUsageType = useMemo(() => {
    const option = usageOptions.find(item => item.value !== 'system_paid');
    return option ? option.value : 'employee_paid';
  }, [usageOptions]);

  const getRateForDate = useCallback((employeeId, dateValue, serviceId = null) => {
    const employee = employees.find(emp => emp.id === employeeId);
    if (!employee) {
      return { rate: 0, reason: 'עובד לא נמצא' };
    }

    const targetServiceId = (employee.employee_type === 'hourly' || employee.employee_type === 'global')
      ? GENERIC_RATE_SERVICE_ID
      : (serviceId || GENERIC_RATE_SERVICE_ID);

    const baseDate = dateValue ? new Date(`${dateValue}T00:00:00`) : new Date();
    const dateStr = format(baseDate, 'yyyy-MM-dd');

    if (employee.start_date && employee.start_date > dateStr) {
      return { rate: 0, reason: 'לא התחילו לעבוד עדיין' };
    }

    const relevantRates = rateHistories
      .filter((rate) => {
        if (!rate || rate.employee_id !== employeeId || rate.effective_date > dateStr) {
          return false;
        }
        if (rate.service_id === targetServiceId) {
          return true;
        }
        if (targetServiceId === GENERIC_RATE_SERVICE_ID && (rate.service_id === null || rate.service_id === undefined)) {
          return true;
        }
        return false;
      })
      .sort((a, b) => new Date(b.effective_date) - new Date(a.effective_date));

    if (relevantRates.length > 0) {
      const numericRate = Number(relevantRates[0].rate);
      if (Number.isFinite(numericRate) && numericRate > 0) {
        return { rate: numericRate, effectiveDate: relevantRates[0].effective_date };
      }
    }

    const fallbackRate = Number(employee.current_rate);
    if (Number.isFinite(fallbackRate) && fallbackRate > 0) {
      return { rate: fallbackRate, reason: 'current_rate_fallback' };
    }

    return { rate: 0, reason: 'לא הוגדר תעריף' };
  }, [employees, rateHistories]);

  useEffect(() => {
    if (employees.length === 0) {
      if (formState.employeeId !== EMPLOYEE_PLACEHOLDER_VALUE) {
        setFormState(prev => ({ ...prev, employeeId: EMPLOYEE_PLACEHOLDER_VALUE }));
      }
      return;
    }
    const exists = employees.some(emp => emp.id === formState.employeeId);
    if (!exists) {
      const nextId = employees[0].id;
      if (formState.employeeId !== nextId) {
        setFormState(prev => ({ ...prev, employeeId: nextId }));
      }
    }
  }, [employees, formState.employeeId]);

  useEffect(() => {
    if (!isOverrideDialogOpen) return;
    const exists = employees.some(emp => emp.id === overrideEmployeeId);
    if (!exists) {
      setOverrideEmployeeId(null);
      setOverrideMethod(OVERRIDE_METHOD_PLACEHOLDER_VALUE);
      setOverrideRate('');
      setIsOverrideDialogOpen(false);
    }
  }, [employees, isOverrideDialogOpen, overrideEmployeeId]);

  useEffect(() => {
    if (formState.entryKind !== 'usage') return;
    const rule = selectHolidayForDate(leavePolicy, formState.date);
    if (!rule) {
      if (!formState.holidayType) {
        setFormState(prev => ({ ...prev, holidayType: 'employee_paid', usageAmount: 1 }));
      }
      return;
    }
    setFormState(prev => {
      const nextAmount = determineUsageAmount(rule.type);
      if (prev.holidayType === rule.type && prev.usageAmount === nextAmount) return prev;
      return { ...prev, holidayType: rule.type, usageAmount: nextAmount };
    });
  }, [formState.date, formState.entryKind, formState.holidayType, leavePolicy]);

  useEffect(() => {
    if (formState.holidayType && formState.holidayType !== 'system_paid') {
      setLastNonSystemHolidayType(formState.holidayType);
    }
  }, [formState.holidayType]);

  useEffect(() => {
    if (!isUsageEntry || !isHalfDaySelection) {
      if (includeSecondHalf) setIncludeSecondHalf(false);
      if (secondHalfMode !== 'work') setSecondHalfMode('work');
      return;
    }
  }, [includeSecondHalf, isHalfDaySelection, isUsageEntry, secondHalfMode]);

  useEffect(() => {
    if (!isUsageEntry || !isHalfDaySelection) return;
    const targetAmount = shouldIncludeSecondHalfLeave ? 1 : 0.5;
    setFormState(prev => {
      if (prev.entryKind !== 'usage' || prev.holidayType !== 'half_day') return prev;
      const current = Number(prev.usageAmount);
      if (Number.isFinite(current) && Math.abs(current - targetAmount) < 0.0001) {
        return prev;
      }
      return { ...prev, usageAmount: targetAmount };
    });
  }, [isUsageEntry, isHalfDaySelection, shouldIncludeSecondHalfLeave]);

  useEffect(() => {
    if (!secondHalfEnabled || secondHalfMode !== 'leave') return;
    if (secondHalfLeaveType) return;
    const fallbackOption = secondaryLeaveTypeOptions[0]?.value || 'employee_paid';
    setSecondHalfLeaveType(fallbackOption);
  }, [secondHalfEnabled, secondHalfLeaveType, secondHalfMode, secondaryLeaveTypeOptions]);

  useEffect(() => {
    if (!secondHalfEnabled || !shouldIncludeSecondHalfWork) {
      if (secondHalfServiceId) setSecondHalfServiceId('');
      return;
    }
    if (!selectedUsageEmployee || selectedUsageEmployee.employee_type !== 'instructor') {
      if (secondHalfServiceId) setSecondHalfServiceId('');
      return;
    }
    if (!secondHalfServiceId || !servicesList.some(service => service.id === secondHalfServiceId)) {
      const fallbackService = servicesList[0];
      setSecondHalfServiceId(fallbackService ? fallbackService.id : '');
    }
  }, [
    secondHalfEnabled,
    secondHalfServiceId,
    servicesList,
    shouldIncludeSecondHalfWork,
    selectedUsageEmployee,
  ]);

  useEffect(() => {
    if (secondHalfEnabled) return;
    if (secondHalfHours !== '4') setSecondHalfHours('4');
    if (secondHalfSessionsCount !== '1') setSecondHalfSessionsCount('1');
    if (secondHalfStudentsCount !== '') setSecondHalfStudentsCount('');
  }, [secondHalfEnabled, secondHalfHours, secondHalfSessionsCount, secondHalfStudentsCount]);

  const summaryRows = useMemo(() => {
    const evaluation = evaluationDate;
    return employees
      .filter(emp => showInactive || emp.is_active !== false)
      .map(emp => ({
        employee: emp,
        summary: selectLeaveRemaining(emp.id, evaluation, {
          employees,
          leaveBalances,
          policy: leavePolicy,
        }),
        payContext: resolveLeavePayMethodContext(emp, leavePayPolicy),
      }))
      .sort((a, b) => (b.summary.remaining || 0) - (a.summary.remaining || 0));
  }, [employees, evaluationDate, leaveBalances, leavePayPolicy, leavePolicy, showInactive]);

  const handleFormChange = (updates) => {
    setFormState(prev => ({ ...prev, ...updates }));
  };

  const isSystemPaidSelection = formState.holidayType === 'system_paid';

  const handleSystemPaidToggle = useCallback((checked) => {
    if (checked) {
      setFormState(prev => ({
        ...prev,
        holidayType: 'system_paid',
        usageAmount: determineUsageAmount('system_paid'),
      }));
      return;
    }
    const fallbackType = (lastNonSystemHolidayType
      && usageOptions.some(option => option.value === lastNonSystemHolidayType))
      ? lastNonSystemHolidayType
      : defaultUsageType;
    setFormState(prev => ({
      ...prev,
      holidayType: fallbackType,
      usageAmount: determineUsageAmount(fallbackType),
    }));
  }, [defaultUsageType, lastNonSystemHolidayType, usageOptions]);

  const usagePreview = useMemo(() => {
    if (!isUsageEntry) return null;
    const employee = selectedUsageEmployee;
    if (!employee) return null;
    const baseKind = getLeaveBaseKind(formState.holidayType) || formState.holidayType;
    const fractionValue = Number(formState.usageAmount);
    const normalizedFraction = Number.isFinite(fractionValue) && fractionValue > 0 ? fractionValue : 1;

    if (!isPayableLeaveKind(baseKind)) {
      return {
        payable: false,
        value: 0,
        fraction: normalizedFraction,
        insufficientData: false,
      };
    }

    const computed = selectLeaveDayValue(employee.id, formState.date, {
      employees,
      workSessions: workSessionsHistory,
      services: servicesList,
      leavePayPolicy,
      collectDiagnostics: true,
    });

    let value = 0;
    let insufficientData = false;

    if (computed && typeof computed === 'object') {
      value = Number(computed.value) || 0;
      insufficientData = Boolean(computed.insufficientData);
    } else if (computed !== null && computed !== undefined) {
      const numeric = Number(computed);
      if (Number.isFinite(numeric) && numeric > 0) {
        value = numeric;
      } else {
        insufficientData = true;
      }
    } else {
      insufficientData = true;
    }

    return {
      payable: true,
      value,
      fraction: normalizedFraction,
      insufficientData,
    };
  }, [
    employees,
    isUsageEntry,
    formState.date,
    formState.holidayType,
    formState.usageAmount,
    leavePayPolicy,
    selectedUsageEmployee,
    servicesList,
    workSessionsHistory,
  ]);

  const usagePreviewTotal = usagePreview && usagePreview.payable
    ? usagePreview.value * usagePreview.fraction
    : null;
  const usagePreviewDailyDisplay = usagePreview && usagePreview.payable
    ? Math.max(usagePreview.value || 0, 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : null;
  const usagePreviewTotalDisplay = usagePreviewTotal !== null
    ? Math.max(usagePreviewTotal, 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : null;

  const resetFallbackDialog = useCallback(() => {
    setFallbackDialogState(null);
    setFallbackAmount('');
    setFallbackError('');
  }, []);

  const resetFormState = useCallback(() => {
    setFormState(prev => ({
      ...prev,
      notes: '',
      entryKind: prev.entryKind,
      allocationAmount: 1,
      usageAmount: prev.entryKind === 'usage' ? prev.usageAmount : 1,
    }));
    setIncludeSecondHalf(false);
    setSecondHalfMode('work');
    setSecondHalfLeaveType('employee_paid');
    setSecondHalfHours('4');
    setSecondHalfServiceId('');
    setSecondHalfSessionsCount('1');
    setSecondHalfStudentsCount('');
  }, []);

  const handleSuccessfulSave = useCallback(async (result = null) => {
    toast.success('הרישום נשמר בהצלחה');
    if (result?.usedFallbackRate) {
      toast.info('הערה: שווי יום החופשה חושב לפי תעריף נוכחי עקב חוסר בנתוני עבר.');
    }
    if (result?.overrideApplied) {
      toast.info('שווי יום החופשה אושר ידנית על ידי המשתמש.');
    }
    if (onRefresh) {
      await onRefresh();
    }
    await loadSupportingData();
    resetFormState();
    resetFallbackDialog();
  }, [loadSupportingData, onRefresh, resetFallbackDialog, resetFormState]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!employees.length || formState.employeeId === EMPLOYEE_PLACEHOLDER_VALUE) {
      toast.error('בחר עובד להזנת חופשה');
      return;
    }
    const employee = selectedUsageEmployee;
    if (!employee) {
      toast.error('העובד שנבחר לא נמצא');
      return;
    }
    if (!session) {
      toast.error('יש להתחבר מחדש לפני שמירת הרישום.');
      return;
    }
    if (!activeOrgId) {
      toast.error('בחרו ארגון פעיל לפני שמירת הרישום.');
      return;
    }

    const date = formState.date || new Date().toISOString().slice(0, 10);
    const entryKind = formState.entryKind;
    const notesValue = formState.notes && formState.notes.trim().length > 0
      ? formState.notes.trim()
      : null;

    if (entryKind === 'allocation') {
      const allocation = Number(formState.allocationAmount);
      if (!allocation || allocation <= 0) {
        toast.error('הזן כמות ימים גדולה מאפס להקצאה');
        return;
      }

      const payload = {
        employee_id: employee.id,
        effective_date: date,
        balance: allocation,
        leave_type: 'allocation',
        notes: notesValue,
      };

      setIsSubmitting(true);
      try {
        await createLeaveBalanceEntry({
          session,
          orgId: activeOrgId,
          body: payload,
        });
        await handleSuccessfulSave();
      } catch (error) {
        console.error('Error saving leave allocation', error);
        toast.error(error?.message || 'שמירת הרישום נכשלה');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (isUsageEntry && isHalfDaySelection && secondHalfEnabled && shouldIncludeSecondHalfLeave && !secondHalfLeaveType) {
      toast.error('יש לבחור סוג חופשה לחצי היום השני.');
      return;
    }

    let halfDayWorkSegments = [];
    if (isUsageEntry && isHalfDaySelection && secondHalfEnabled && shouldIncludeSecondHalfWork) {
      try {
        if (employee.employee_type === 'hourly' || employee.employee_type === 'global') {
          const hoursValue = Number(secondHalfHours);
          if (!Number.isFinite(hoursValue) || hoursValue <= 0) {
            throw new Error('יש להזין מספר שעות גדול מ-0 לחצי השני.');
          }
          halfDayWorkSegments = [{
            hours: hoursValue,
            notes: notesValue,
          }];
        } else {
          if (!secondHalfServiceId) {
            throw new Error('בחר שירות עבור חצי היום השני.');
          }
          const service = servicesList.find(item => item.id === secondHalfServiceId);
          if (!service) {
            throw new Error('בחר שירות עבור חצי היום השני.');
          }
          const sessionsCountValue = Number(secondHalfSessionsCount);
          if (!Number.isFinite(sessionsCountValue) || sessionsCountValue <= 0) {
            throw new Error('מספר המפגשים לחצי השני חייב להיות גדול מ-0.');
          }
          const studentsCountRaw = secondHalfStudentsCount === '' ? null : Number(secondHalfStudentsCount);
          if (service.payment_model === 'per_student') {
            if (!Number.isFinite(studentsCountRaw) || studentsCountRaw <= 0) {
              throw new Error('מספר התלמידים לחצי השני חייב להיות גדול מ-0.');
            }
          }
          halfDayWorkSegments = [{
            service_id: secondHalfServiceId,
            sessions_count: sessionsCountValue,
            students_count: Number.isFinite(studentsCountRaw) && studentsCountRaw >= 0 ? studentsCountRaw : null,
            notes: notesValue,
          }];
        }
      } catch (validationError) {
        toast.error(validationError.message || 'פרטי חצי היום השני אינם תקינים.');
        return;
      }
    }

    const baseHolidayType = formState.holidayType || 'employee_paid';
    const requestPayload = {
      employee,
      day: new Date(`${date}T00:00:00`),
      date,
      leaveType: baseHolidayType,
      paidLeaveNotes: notesValue,
      source: 'employees_leave_overview',
      includeHalfDaySecondHalf: Boolean(secondHalfEnabled),
      halfDaySecondHalfMode: secondHalfEnabled ? secondHalfMode : null,
      halfDaySecondLeaveType: shouldIncludeSecondHalfLeave ? secondHalfLeaveType : null,
      halfDayWorkSegments,
      halfDayRemovedWorkIds: [],
    };

    setIsSubmitting(true);
    try {
      const result = await saveLeaveDay(requestPayload);
      if (result?.needsConfirmation) {
        setFallbackDialogState({
          request: requestPayload,
          fallbackValue: result.fallbackValue,
          fraction: result.fraction ?? 1,
          payable: result.payable !== false,
        });
        setFallbackAmount(result.fallbackValue ? String(result.fallbackValue) : '');
        setFallbackError('');
        return;
      }
      await handleSuccessfulSave(result);
    } catch (error) {
      console.error('Error saving leave entry', error);
      toast.error(error?.message || 'שמירת הרישום נכשלה');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFallbackDialogClose = (isOpen) => {
    if (isOpen) return;
    if (isFallbackSubmitting) return;
    resetFallbackDialog();
  };

  const handleFallbackConfirm = async () => {
    if (!fallbackDialogState) return;
    const numericValue = Number(fallbackAmount);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      setFallbackError('יש להזין שווי יום גדול מ-0.');
      return;
    }
    setFallbackError('');
    setIsFallbackSubmitting(true);
    setIsSubmitting(true);
    try {
      const requestPayload = {
        ...fallbackDialogState.request,
        overrideDailyValue: numericValue,
      };
      const result = await saveLeaveDay(requestPayload);
      if (result?.needsConfirmation) {
        setFallbackDialogState({
          request: requestPayload,
          fallbackValue: result.fallbackValue,
          fraction: result.fraction ?? 1,
          payable: result.payable !== false,
        });
        setFallbackAmount(result.fallbackValue ? String(result.fallbackValue) : '');
        return;
      }
      await handleSuccessfulSave(result);
    } catch (error) {
      console.error('Error saving leave entry after confirmation', error);
      toast.error(error?.message || 'שמירת הרישום נכשלה');
    } finally {
      setIsFallbackSubmitting(false);
      setIsSubmitting(false);
    }
  };
  const lockedUsageTypes = new Set(['half_day', 'system_paid', 'unpaid']);
  const isUsageLocked = lockedUsageTypes.has(formState.holidayType);

  const selectedEmployee = useMemo(() => {
    if (!overrideEmployeeId) return null;
    return employees.find(emp => emp.id === overrideEmployeeId) || null;
  }, [employees, overrideEmployeeId]);

  const parsedFallbackAmount = Number(fallbackAmount);
  const fallbackFraction = fallbackDialogState && fallbackDialogState.payable !== false
    ? (Number.isFinite(fallbackDialogState.fraction) && fallbackDialogState.fraction > 0
      ? fallbackDialogState.fraction
      : 1)
    : 1;
  const fallbackTotalPreview = fallbackDialogState
    && fallbackDialogState.payable !== false
    && Number.isFinite(parsedFallbackAmount)
    ? parsedFallbackAmount * fallbackFraction
    : null;
  const fallbackDisplayAmount = typeof fallbackAmount === 'string' && fallbackAmount.trim().length > 0
    ? fallbackAmount.trim()
    : (Number.isFinite(parsedFallbackAmount) && parsedFallbackAmount !== 0
      ? String(parsedFallbackAmount)
      : '0');
  const fallbackTotalDisplay = fallbackTotalPreview !== null
    ? String(fallbackTotalPreview)
    : null;

  const hasOverrideEmployeeSelection = Boolean(selectedEmployee);

  const parseRateValue = (value) => {
    if (value === '' || value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const initialMethod = selectedEmployee?.leave_pay_method || '';
  const initialRateNumber = parseRateValue(selectedEmployee?.leave_fixed_day_rate);
  const currentRateNumber = parseRateValue(overrideRate);
  const normalizedOverrideMethod = overrideMethod === OVERRIDE_METHOD_PLACEHOLDER_VALUE ? '' : overrideMethod;
  const hasOverrideChanges = Boolean(hasOverrideEmployeeSelection)
    && (normalizedOverrideMethod !== (initialMethod || '')
      || (normalizedOverrideMethod === 'fixed_rate' && currentRateNumber !== initialRateNumber));
  const isFixedSelected = normalizedOverrideMethod === 'fixed_rate';
  const defaultMethodLabel = LEAVE_PAY_METHOD_LABELS[leavePayPolicy?.default_method] || 'חישוב חוקי (מומלץ)';
  const selectedMethodDescription = normalizedOverrideMethod
    ? LEAVE_PAY_METHOD_DESCRIPTIONS[normalizedOverrideMethod] || ''
    : '';

  const handleOverrideDialogClose = () => {
    setIsOverrideDialogOpen(false);
    setOverrideEmployeeId(null);
    setOverrideMethod(OVERRIDE_METHOD_PLACEHOLDER_VALUE);
    setOverrideRate('');
    setIsSavingOverride(false);
  };

  const handleOpenOverrideDialog = (employee) => {
    if (!employee) return;
    const nextMethod = employee.leave_pay_method && employee.leave_pay_method.length > 0
      ? employee.leave_pay_method
      : OVERRIDE_METHOD_PLACEHOLDER_VALUE;
    const nextRate = employee.leave_fixed_day_rate;
    setOverrideEmployeeId(employee.id);
    setOverrideMethod(nextMethod);
    setOverrideRate(nextMethod === 'fixed_rate' && nextRate !== null && nextRate !== undefined ? String(nextRate) : '');
    setIsOverrideDialogOpen(true);
  };

  const handleOverrideMethodChange = (value) => {
    setOverrideMethod(value);
    if (value !== 'fixed_rate') {
      setOverrideRate('');
    }
  };

  const handleOverrideSubmit = async (event) => {
    event.preventDefault();
    if (!hasOverrideEmployeeSelection) {
      toast.error('בחר עובד לעדכון השיטה');
      return;
    }
    if (!hasOverrideChanges) {
      toast.info('אין שינויים לשמירה');
      return;
    }
    let rateToSave = null;
    if (normalizedOverrideMethod === 'fixed_rate') {
      const parsed = parseRateValue(overrideRate);
      if (parsed === null || parsed <= 0) {
        toast.error('הזן תעריף יומי גדול מאפס');
        return;
      }
      rateToSave = parsed;
    }
    setIsSavingOverride(true);
    try {
      if (!session) {
        throw new Error('יש להתחבר מחדש לפני שמירת העקיפה.');
      }
      if (!activeOrgId) {
        throw new Error('בחרו ארגון פעיל לפני שמירת העקיפה.');
      }
      const methodToSave = normalizedOverrideMethod || null;
      const payload = {
        leave_pay_method: methodToSave,
        leave_fixed_day_rate: methodToSave === 'fixed_rate' ? rateToSave : null,
      };
      await updateEmployee({
        session,
        orgId: activeOrgId,
        employeeId: overrideEmployeeId,
        body: { updates: payload },
      });
      toast.success('עקיפת השיטה נשמרה בהצלחה');
      if (onRefresh) {
        await onRefresh();
      }
      handleOverrideDialogClose();
    } catch (error) {
      console.error('Error saving leave pay override', error);
      toast.error('שמירת העקיפה נכשלה');
    }
    setIsSavingOverride(false);
  };

  if (loading || !authClient) {
    return (
      <Card className="border-0 shadow-lg bg-white/80">
        <CardHeader className="border-b">
          <CardTitle className="text-xl font-semibold text-slate-900">טוען חיבור Supabase...</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  if (!user) {
    return (
      <Card className="border-0 shadow-lg bg-white/80">
        <CardHeader className="border-b">
          <CardTitle className="text-xl font-semibold text-slate-900">יש להתחבר כדי לנהל חופשות.</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  if (!activeOrgId) {
    return (
      <Card className="border-0 shadow-lg bg-white/80">
        <CardHeader className="border-b">
          <CardTitle className="text-xl font-semibold text-slate-900">בחרו ארגון פעיל כדי לנהל חופשות.</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-0 shadow-lg bg-white/80">
        <CardHeader className="border-b">
          <CardTitle className="text-xl font-semibold text-slate-900">פעולה מהירה</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid grid-cols-1 md:grid-cols-5 gap-4" onSubmit={handleSubmit}>
            <div className="space-y-1">
              <Label className="text-sm font-semibold text-slate-700">עובד</Label>
              <Select value={formState.employeeId} onValueChange={(value) => handleFormChange({ employeeId: value })}>
                <SelectTrigger className="bg-white">
                  <SelectValue placeholder="בחר עובד" />
                </SelectTrigger>
                <SelectContent>
                  {formState.employeeId === EMPLOYEE_PLACEHOLDER_VALUE && (
                    <SelectItem value={EMPLOYEE_PLACEHOLDER_VALUE} disabled>
                      בחר עובד
                    </SelectItem>
                  )}
                  {employees.map(emp => (
                    <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-sm font-semibold text-slate-700">סוג פעולה</Label>
              <Select value={formState.entryKind} onValueChange={(value) => handleFormChange({ entryKind: value })}>
                <SelectTrigger className="bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENTRY_KINDS.map(option => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-sm font-semibold text-slate-700">תאריך</Label>
              <Input
                type="date"
                value={formState.date}
                onChange={(event) => handleFormChange({ date: event.target.value })}
              />
            </div>
            {formState.entryKind === 'allocation' ? (
              <div className="space-y-1">
                <Label className="text-sm font-semibold text-slate-700">ימי חופשה</Label>
                <Input
                  type="number"
                  min={0.5}
                  step="0.5"
                  value={formState.allocationAmount}
                  onChange={(event) => handleFormChange({ allocationAmount: event.target.value })}
                />
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  <Label className="text-sm font-semibold text-slate-700">סוג חופשה</Label>
                  <Select
                    value={formState.holidayType || 'employee_paid'}
                    onValueChange={(value) => handleFormChange({ holidayType: value, usageAmount: determineUsageAmount(value) })}
                  >
                    <SelectTrigger className="bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {usageOptions.map(option => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label
                      htmlFor="employees-system-paid-toggle"
                      className="text-sm font-semibold text-slate-700"
                    >
                      על חשבון המערכת
                    </Label>
                    <Switch
                      id="employees-system-paid-toggle"
                      checked={isSystemPaidSelection}
                      onCheckedChange={handleSystemPaidToggle}
                      aria-label="על חשבון המערכת"
                    />
                </div>
                {isSystemPaidSelection ? (
                  <div
                    role="alert"
                    className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                  >
                    {SYSTEM_PAID_ALERT_TEXT}
                  </div>
                ) : null}
              </div>
              {isUsageEntry && isHalfDaySelection ? (
                <div className="space-y-3 md:col-span-3">
                  <div className="flex items-center justify-between gap-3">
                    <Label className="text-sm font-semibold text-slate-700" htmlFor="employees-second-half-toggle">
                      הוסף רישום לחצי היום השני
                    </Label>
                    <Switch
                      id="employees-second-half-toggle"
                      checked={secondHalfEnabled}
                      onCheckedChange={(checked) => {
                        setIncludeSecondHalf(checked);
                        if (!checked) {
                          setSecondHalfMode('work');
                        }
                      }}
                      aria-label="הוסף רישום לחצי היום השני"
                    />
                  </div>
                  {secondHalfEnabled ? (
                    <div className="space-y-3 rounded-xl bg-slate-50 px-3 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className="text-sm font-medium text-slate-700">סוג הרישום הנוסף:</span>
                        <div className="flex items-center gap-2">
                          <span className={`text-sm ${secondHalfMode === 'work' ? 'font-semibold text-slate-900' : 'text-slate-500'}`}>
                            עבודה
                          </span>
                          <Switch
                            checked={secondHalfMode === 'leave'}
                            onCheckedChange={(checked) => setSecondHalfMode(checked ? 'leave' : 'work')}
                            aria-label="סוג הרישום הנוסף"
                          />
                          <span className={`text-sm ${secondHalfMode === 'leave' ? 'font-semibold text-slate-900' : 'text-slate-500'}`}>
                            חופשה
                          </span>
                        </div>
                      </div>
                      {shouldIncludeSecondHalfLeave ? (
                        <div className="space-y-1">
                          <Label className="text-sm font-semibold text-slate-700">סוג חופשה נוסף</Label>
                          <Select value={secondHalfLeaveType} onValueChange={value => setSecondHalfLeaveType(value)}>
                            <SelectTrigger className="bg-white">
                              <SelectValue placeholder="בחר סוג לחצי השני" />
                            </SelectTrigger>
                            <SelectContent>
                              {secondaryLeaveTypeOptions.map(option => (
                                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ) : null}
                      {shouldIncludeSecondHalfWork ? (
                        <div className="space-y-3">
                          {selectedUsageEmployee?.employee_type === 'instructor' ? (
                            <>
                              <div className="space-y-1">
                                <Label className="text-sm font-semibold text-slate-700">שירות</Label>
                                <Select
                                  value={secondHalfServiceId}
                                  onValueChange={setSecondHalfServiceId}
                                  disabled={servicesList.length === 0}
                                >
                                  <SelectTrigger className="bg-white">
                                    <SelectValue placeholder="בחר שירות" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {servicesList.map(service => (
                                      <SelectItem key={service.id} value={service.id}>{service.name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div className="space-y-1">
                                  <Label className="text-sm font-semibold text-slate-700">מספר מפגשים</Label>
                                  <Input
                                    type="number"
                                    min={0.25}
                                    step="0.25"
                                    value={secondHalfSessionsCount}
                                    onChange={(event) => setSecondHalfSessionsCount(event.target.value)}
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-sm font-semibold text-slate-700">מספר תלמידים</Label>
                                  <Input
                                    type="number"
                                    min={0}
                                    step="1"
                                    value={secondHalfStudentsCount}
                                    onChange={(event) => setSecondHalfStudentsCount(event.target.value)}
                                  />
                                </div>
                              </div>
                              {servicesList.length === 0 ? (
                                <p className="text-xs text-amber-700 text-right">
                                  אין שירותים זמינים למדריכים. הוסיפו שירות כדי לשמור עבודה לחצי השני.
                                </p>
                              ) : null}
                            </>
                          ) : (
                            <div className="space-y-1">
                              <Label className="text-sm font-semibold text-slate-700">שעות עבודה לחצי השני</Label>
                              <Input
                                type="number"
                                min={0}
                                step="0.25"
                                value={secondHalfHours}
                                onChange={(event) => setSecondHalfHours(event.target.value)}
                              />
                            </div>
                          )}
                        </div>
                      ) : null}
                      {shouldIncludeSecondHalfWork ? (
                        <p className="text-xs text-slate-600 text-right">
                          הזינו את פרטי העבודה כדי לשמור את חצי היום השני כרישום עבודה.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="space-y-1">
                <Label className="text-sm font-semibold text-slate-700">כמות לניכוי</Label>
                <Input
                  type="number"
                  min={0}
                    step="0.5"
                    value={formState.usageAmount}
                    onChange={(event) => handleFormChange({ usageAmount: event.target.value })}
                    disabled={isUsageLocked}
                  />
                </div>
              </>
            )}
            <div className="space-y-1 md:col-span-2">
              <Label className="text-sm font-semibold text-slate-700">הערות</Label>
              <Textarea
                value={formState.notes}
                onChange={(event) => handleFormChange({ notes: event.target.value })}
                placeholder="פרטי חופשה או הקצאה"
                className="min-h-[48px]"
              />
            </div>
            {usagePreview?.payable ? (
              <div className="md:col-span-3 text-right space-y-1">
                {usagePreviewDailyDisplay ? (
                  <p className="text-sm text-slate-600">
                    {`שווי משוער ליום מלא: ₪${usagePreviewDailyDisplay}`}
                  </p>
                ) : null}
                {usagePreviewTotalDisplay ? (
                  <p className="text-xs text-slate-500">
                    {`תשלום משוער לרישום (${usagePreview.fraction === 0.5 ? 'חצי יום' : `מכפיל ${usagePreview.fraction}`}): ₪${usagePreviewTotalDisplay}`}
                  </p>
                ) : null}
                {usagePreview.insufficientData ? (
                  <p className="text-xs text-amber-700">
                    הערה: שווי יום החופשה חושב לפי תעריף נוכחי עקב חוסר בנתוני עבר.
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="flex items-end md:col-span-3 justify-end">
              <Button type="submit" className="gap-2" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                {isSubmitting ? 'שומר...' : 'שמור רישום'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-lg bg-white/80">
        <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b">
          <div>
            <CardTitle className="text-xl font-semibold text-slate-900">מצב יתרות</CardTitle>
            <p className="text-sm text-slate-500 mt-1">מעקב אחר ניצול ומכסה לכל העובדים לפי מדיניות הארגון</p>
          </div>
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-slate-500">תאריך חישוב</Label>
              <Input
                type="date"
                value={evaluationDate}
                onChange={(event) => setEvaluationDate(event.target.value)}
              />
            </div>
            <div className="flex items-center gap-2 border rounded-lg px-3 py-2 bg-slate-50">
              <Switch checked={showInactive} onCheckedChange={setShowInactive} />
              <span className="text-sm text-slate-600">הצג גם עובדים לא פעילים</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">עובד</TableHead>
                <TableHead className="text-right">שיטת חישוב</TableHead>
                <TableHead className="text-right">מכסה שנתית</TableHead>
                <TableHead className="text-right">
                  <div className="flex flex-row-reverse items-center justify-end gap-1">
                    <span>יתרת צבירה משנה קודמת</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-400 transition-colors hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                          aria-label="יתרת חופשה שהועברה משנה קודמת לפי מדיניות הארגון."
                        >
                          <Info className="h-4 w-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" align="end">
                        יתרת חופשה שהועברה משנה קודמת לפי מדיניות הארגון.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </TableHead>
                <TableHead className="text-right">נוצל</TableHead>
                <TableHead className="text-right">יתרה נוכחית</TableHead>
                <TableHead className="text-right">סטטוס</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin inline-block text-slate-400" />
                  </TableCell>
                </TableRow>
              ) : summaryRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-slate-500 py-10">
                    לא נמצאו נתונים להצגה
                  </TableCell>
                </TableRow>
              ) : (
                summaryRows.map(({ employee, summary, payContext }) => {
                  const remaining = Number(summary.remaining || 0);
                  const statusVariant = remaining < 0 ? 'destructive' : 'secondary';
                  const methodValue = payContext?.method || DEFAULT_LEAVE_PAY_POLICY.default_method;
                  const methodLabel = LEAVE_PAY_METHOD_LABELS[methodValue] || LEAVE_PAY_METHOD_LABELS.legal;
                  const hasOverride = Boolean(payContext?.override_applied);
                  return (
                    <TableRow key={employee.id}>
                      <TableCell className="font-medium">{employee.name}</TableCell>
                      <TableCell>
                        <div className="flex flex-col items-end gap-2">
                          <div className="flex flex-row-reverse items-center gap-2">
                            <span className="text-sm font-medium text-slate-700">{methodLabel}</span>
                            <div className="flex flex-row-reverse items-center gap-1">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => handleOpenOverrideDialog(employee)}
                                disabled={isLoading}
                              >
                                עקיפת שיטת חישוב
                              </Button>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                                    aria-label="מידע על עקיפת שיטת החישוב"
                                  >
                                    <Info className="h-4 w-4" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="top" align="end" className="max-w-xs text-right leading-relaxed">
                                  שינוי השיטה משפיע על חישוב חופשות חדשות או עריכות שתשמרו מהיום והלאה. רישומים קיימים שומרים את הסכום שנקבע בזמן הקליטה, ולכן אם צריך לעדכן אותם יש לערוך אותם ידנית.
                                </TooltipContent>
                              </Tooltip>
                            </div>
                          </div>
                          {hasOverride ? (
                            <Badge variant="outline" className="text-xs text-amber-700 border-amber-200 bg-amber-50">
                              עקיפת שיטת חישוב
                            </Badge>
                          ) : (
                            <span className="text-xs text-slate-400">ברירת מחדל ארגונית</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{Number(employee.annual_leave_days || 0).toFixed(1)}</TableCell>
                      <TableCell>{summary.carryIn.toFixed(1)}</TableCell>
                      <TableCell>{summary.used.toFixed(1)}</TableCell>
                      <TableCell className={remaining < 0 ? 'text-red-600 font-semibold' : 'font-semibold text-green-700'}>
                        {remaining.toFixed(1)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant}>
                          {remaining < 0 ? 'במינוס' : 'תקין'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Dialog open={Boolean(fallbackDialogState)} onOpenChange={handleFallbackDialogClose}>
        <DialogContent className="sm:max-w-md text-right">
          <DialogHeader>
            <DialogTitle>אישור שווי יום החופשה</DialogTitle>
            <DialogDescription className="text-sm text-slate-500">
              {`שווי יום החופשה חושב לפי תעריף נוכחי עקב חוסר בנתוני עבר: ₪${fallbackDisplayAmount}. עדכנו או אשרו את הסכום לפני שמירה סופית.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              {`שווי מוצע ליום מלא: ₪${fallbackDisplayAmount}`}
            </p>
            {fallbackTotalDisplay !== null ? (
              <p className="text-xs text-slate-500">
                {`תשלום מתוכנן (${fallbackFraction === 0.5 ? 'חצי יום' : `מכפיל ${fallbackFraction}`}): ₪${fallbackTotalDisplay}`}
              </p>
            ) : null}
            <div className="space-y-1">
              <Label htmlFor="fallback-confirm-amount" className="text-sm font-semibold text-slate-700">
                שווי יום חופשה לאישור (₪)
              </Label>
              <Input
                id="fallback-confirm-amount"
                type="number"
                min="0"
                step="0.01"
                value={fallbackAmount}
                onChange={(event) => {
                  setFallbackAmount(event.target.value);
                  if (fallbackError) setFallbackError('');
                }}
                autoFocus
                disabled={isFallbackSubmitting}
              />
              {fallbackError ? (
                <p className="text-xs text-red-600">{fallbackError}</p>
              ) : null}
            </div>
          </div>
          <DialogFooter className="flex flex-row-reverse gap-2">
            <Button type="button" onClick={handleFallbackConfirm} disabled={isFallbackSubmitting}>
              {isFallbackSubmitting ? 'שומר...' : 'אשר סכום'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleFallbackDialogClose(false)}
              disabled={isFallbackSubmitting}
            >
              בטל
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={isOverrideDialogOpen} onOpenChange={(open) => (!open ? handleOverrideDialogClose() : null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader className="text-right">
            <DialogTitle>עקיפת שיטת חישוב</DialogTitle>
            <DialogDescription className="text-sm text-slate-500 space-y-1">
              <p>בחר שיטה חלופית לתשלום חופשה עבור העובד הנוכחי.</p>
              <p>השיטה הארגונית ({defaultMethodLabel}) תחול כאשר אין עקיפה אישית.</p>
            </DialogDescription>
          </DialogHeader>
          <Alert className="bg-sky-50 border-sky-200 text-sky-900 text-right">
            <AlertTitle className="flex flex-row-reverse items-center gap-2 text-base">
              <Info className="h-4 w-4" />חשוב לדעת
            </AlertTitle>
            <AlertDescription className="text-sm leading-relaxed">
              שינוי שיטת החישוב משפיע על כל חופשה שתקליטו או תעדכנו מרגע השמירה ואילך. רישומים שנשמרו בעבר אינם משתנים אוטומטית, ולכן אם ביצעתם שינוי באמצע השנה חשוב לבדוק האם יש צורך לעדכן ידנית ימים שנרשמו כבר.
            </AlertDescription>
          </Alert>
          <form className="space-y-4" onSubmit={handleOverrideSubmit}>
            <div className="space-y-1 text-right">
              <Label className="text-sm font-semibold text-slate-700">עובד</Label>
              <p className="text-base font-medium text-slate-900">{selectedEmployee?.name || '—'}</p>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-sm font-semibold text-slate-700">עקיפת שיטת חישוב</Label>
                {normalizedOverrideMethod && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleOverrideMethodChange(OVERRIDE_METHOD_PLACEHOLDER_VALUE)}
                    disabled={isSavingOverride}
                  >
                    אפס
                  </Button>
                )}
              </div>
              <Select
                value={overrideMethod}
                onValueChange={handleOverrideMethodChange}
                disabled={!hasOverrideEmployeeSelection || isSavingOverride}
              >
                <SelectTrigger className="bg-white">
                  <SelectValue placeholder="ללא עקיפה (ברירת מחדל)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={OVERRIDE_METHOD_PLACEHOLDER_VALUE}>ללא עקיפה (ברירת מחדל)</SelectItem>
                  {LEAVE_PAY_METHOD_OPTIONS.map(option => (
                    <SelectItem key={option.value} value={option.value}>{option.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedMethodDescription && (
                <p className="text-xs text-slate-500 text-right mt-1">{selectedMethodDescription}</p>
              )}
            </div>
            {isFixedSelected && (
              <div className="space-y-1">
                <Label className="text-sm font-semibold text-slate-700">תעריף יומי לעובד (₪)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={overrideRate}
                  onChange={(event) => setOverrideRate(event.target.value)}
                  disabled={isSavingOverride}
                />
              </div>
            )}
            <DialogFooter className="flex flex-row-reverse gap-2">
              <Button
                type="submit"
                className="gap-2"
                disabled={isSavingOverride || !hasOverrideEmployeeSelection || !hasOverrideChanges}
              >
                {isSavingOverride ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                {isSavingOverride ? 'שומר...' : 'שמור עקיפה'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={handleOverrideDialogClose}
                disabled={isSavingOverride}
              >
                ביטול
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
