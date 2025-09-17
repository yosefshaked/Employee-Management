import React, { useEffect, useMemo, useState } from 'react';
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
import { toast } from 'sonner';
import { Loader2, ShieldCheck, Info } from 'lucide-react';
import { supabase } from '@/supabaseClient';
import { selectLeaveRemaining, selectHolidayForDate } from '@/selectors.js';
import {
  DEFAULT_LEAVE_POLICY,
  DEFAULT_LEAVE_PAY_POLICY,
  HOLIDAY_TYPE_LABELS,
  LEAVE_TYPE_OPTIONS,
  LEAVE_PAY_METHOD_OPTIONS,
  LEAVE_PAY_METHOD_DESCRIPTIONS,
  LEAVE_PAY_METHOD_LABELS,
  getNegativeBalanceFloor,
} from '@/lib/leave.js';

const EMPLOYEE_PLACEHOLDER_VALUE = '__employee_placeholder__';
const OVERRIDE_METHOD_PLACEHOLDER_VALUE = '__no_override__';

const ENTRY_KINDS = [
  { value: 'usage', label: 'סימון חופשה' },
  { value: 'allocation', label: 'הקצאת ימי חופשה' },
];

function determineUsageAmount(type) {
  if (type === 'half_day') return 0.5;
  if (type === 'system_paid' || type === 'unpaid') return 0;
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
  const [overrideEmployeeId, setOverrideEmployeeId] = useState(initialEmployeeId);
  const [overrideMethod, setOverrideMethod] = useState(OVERRIDE_METHOD_PLACEHOLDER_VALUE);
  const [overrideRate, setOverrideRate] = useState('');
  const [isSavingOverride, setIsSavingOverride] = useState(false);

  const usageOptions = useMemo(() => {
    return LEAVE_TYPE_OPTIONS.filter(option => leavePolicy.allow_half_day || option.value !== 'half_day');
  }, [leavePolicy.allow_half_day]);

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
    if (employees.length === 0) {
      if (overrideEmployeeId !== EMPLOYEE_PLACEHOLDER_VALUE) {
        setOverrideEmployeeId(EMPLOYEE_PLACEHOLDER_VALUE);
      }
      return;
    }
    const exists = employees.some(emp => emp.id === overrideEmployeeId);
    if (!exists) {
      const nextId = employees[0].id;
      if (overrideEmployeeId !== nextId) {
        setOverrideEmployeeId(nextId);
      }
    }
  }, [employees, overrideEmployeeId]);

  useEffect(() => {
    if (employees.length === 0 || overrideEmployeeId === EMPLOYEE_PLACEHOLDER_VALUE) {
      setOverrideMethod(OVERRIDE_METHOD_PLACEHOLDER_VALUE);
      setOverrideRate('');
      return;
    }
    const employee = employees.find(emp => emp.id === overrideEmployeeId);
    if (!employee) {
      setOverrideMethod(OVERRIDE_METHOD_PLACEHOLDER_VALUE);
      setOverrideRate('');
      return;
    }
    const nextMethod = employee.leave_pay_method && employee.leave_pay_method.length > 0
      ? employee.leave_pay_method
      : OVERRIDE_METHOD_PLACEHOLDER_VALUE;
    const nextRate = employee.leave_fixed_day_rate;
    setOverrideMethod(nextMethod);
    setOverrideRate(nextRate === null || nextRate === undefined ? '' : String(nextRate));
  }, [employees, overrideEmployeeId]);

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
      }))
      .sort((a, b) => (b.summary.remaining || 0) - (a.summary.remaining || 0));
  }, [employees, evaluationDate, leaveBalances, leavePolicy, showInactive]);

  const handleFormChange = (updates) => {
    setFormState(prev => ({ ...prev, ...updates }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!employees.length || formState.employeeId === EMPLOYEE_PLACEHOLDER_VALUE) {
      toast.error('בחר עובד להזנת חופשה');
      return;
    }
    const employee = employees.find(emp => emp.id === formState.employeeId);
    if (!employee) {
      toast.error('העובד שנבחר לא נמצא');
      return;
    }
    const date = formState.date || new Date().toISOString().slice(0, 10);
    const entryKind = formState.entryKind;
    let delta = 0;
    let ledgerType = 'manual';
    if (entryKind === 'allocation') {
      const allocation = Number(formState.allocationAmount);
      if (!allocation || allocation <= 0) {
        toast.error('הזן כמות ימים גדולה מאפס להקצאה');
        return;
      }
      delta = allocation;
      ledgerType = 'allocation';
    } else {
      const type = formState.holidayType || 'employee_paid';
      let amount = Number(formState.usageAmount);
      if (Number.isNaN(amount) || amount < 0) {
        toast.error('כמות ימי החופשה אינה תקינה');
        return;
      }
      if (!leavePolicy.allow_half_day && amount % 1 !== 0) {
        toast.error('חצי יום אינו מאושר במדיניות הנוכחית');
        return;
      }
      delta = -amount;
      ledgerType = `usage_${type}`;
    }
    const summary = selectLeaveRemaining(employee.id, date, {
      employees,
      leaveBalances,
      policy: leavePolicy,
    });
    const currentRemaining = summary.remaining;
    const projected = currentRemaining + delta;
    if (formState.entryKind === 'usage' && delta < 0) {
      if (!leavePolicy.allow_negative_balance) {
        if (currentRemaining <= 0 || projected < 0) {
          toast.error('חריגה ממכסה ימי החופשה המותרים');
          return;
        }
      } else {
        const floorLimit = getNegativeBalanceFloor(leavePolicy);
        if (projected < floorLimit) {
          toast.error('חריגה ממכסה ימי החופשה המותרים');
          return;
        }
      }
    }
    setIsSubmitting(true);
    try {
      const payload = {
        employee_id: employee.id,
        effective_date: date,
        balance: delta,
        leave_type: ledgerType,
        notes: formState.notes ? formState.notes.trim() : null,
      };
      const { error } = await supabase.from('LeaveBalances').insert([payload]);
      if (error) throw error;
      toast.success('הרישום נשמר בהצלחה');
      if (onRefresh) await onRefresh();
      setFormState(prev => ({
        ...prev,
        notes: '',
        entryKind: prev.entryKind,
        allocationAmount: 1,
        usageAmount: prev.entryKind === 'usage' ? prev.usageAmount : 1,
      }));
    } catch (error) {
      console.error('Error saving leave entry', error);
      toast.error('שמירת הרישום נכשלה');
    }
    setIsSubmitting(false);
  };

  const lockedUsageTypes = new Set(['half_day', 'system_paid', 'unpaid']);
  const isUsageLocked = lockedUsageTypes.has(formState.holidayType);

  const hasOverrideEmployeeSelection = overrideEmployeeId && overrideEmployeeId !== EMPLOYEE_PLACEHOLDER_VALUE;

  const selectedEmployee = useMemo(() => {
    if (!hasOverrideEmployeeSelection) return null;
    return employees.find(emp => emp.id === overrideEmployeeId) || null;
  }, [employees, hasOverrideEmployeeSelection, overrideEmployeeId]);

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
      const methodToSave = normalizedOverrideMethod || null;
      const payload = {
        leave_pay_method: methodToSave,
        leave_fixed_day_rate: methodToSave === 'fixed_rate' ? rateToSave : null,
      };
      const { error } = await supabase
        .from('Employees')
        .update(payload)
        .eq('id', overrideEmployeeId);
      if (error) throw error;
      toast.success('עקיפת השיטה נשמרה בהצלחה');
      if (onRefresh) {
        await onRefresh();
      }
    } catch (error) {
      console.error('Error saving leave pay override', error);
      toast.error('שמירת העקיפה נכשלה');
    }
    setIsSavingOverride(false);
  };

  return (
    <div className="space-y-6">
      <Card className="border-0 shadow-lg bg-white/80">
        <CardHeader className="border-b">
          <CardTitle className="text-xl font-semibold text-slate-900">עקיפת שיטת חישוב</CardTitle>
        </CardHeader>
        <CardContent>
          {employees.length === 0 ? (
            <p className="text-sm text-slate-500 text-right">אין עובדים זמינים לעדכון עקיפות.</p>
          ) : (
            <form className="grid grid-cols-1 md:grid-cols-2 gap-4" onSubmit={handleOverrideSubmit}>
              <div className="space-y-1 md:col-span-2">
                <p className="text-sm text-slate-600 text-right">
                  השיטה הארגונית ({defaultMethodLabel}) תחול כאשר אין עקיפה אישית.
                </p>
              </div>
              <div className="space-y-1">
                <Label className="text-sm font-semibold text-slate-700">עובד</Label>
                <Select
                  value={overrideEmployeeId}
                  onValueChange={setOverrideEmployeeId}
                  disabled={isLoading || isSavingOverride || employees.length === 0}
                >
                  <SelectTrigger className="bg-white">
                    <SelectValue placeholder="בחר עובד" />
                  </SelectTrigger>
                  <SelectContent>
                    {overrideEmployeeId === EMPLOYEE_PLACEHOLDER_VALUE && (
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
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-sm font-semibold text-slate-700">עקיפת שיטת חישוב</Label>
                  {normalizedOverrideMethod && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleOverrideMethodChange(OVERRIDE_METHOD_PLACEHOLDER_VALUE)}
                      disabled={isLoading || isSavingOverride}
                    >
                      אפס
                    </Button>
                  )}
                </div>
                <Select
                  value={overrideMethod}
                  onValueChange={handleOverrideMethodChange}
                  disabled={isLoading || isSavingOverride || !hasOverrideEmployeeSelection}
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
                    disabled={isLoading || isSavingOverride}
                  />
                </div>
              )}
              <div className="md:col-span-2 flex justify-end">
                <Button
                  type="submit"
                  className="gap-2"
                  disabled={isSavingOverride || isLoading || !hasOverrideEmployeeSelection || !hasOverrideChanges}
                >
                  {isSavingOverride ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                  {isSavingOverride ? 'שומר...' : 'שמור עקיפה'}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

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
                  <TableCell colSpan={6} className="text-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin inline-block text-slate-400" />
                  </TableCell>
                </TableRow>
              ) : summaryRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-slate-500 py-10">
                    לא נמצאו נתונים להצגה
                  </TableCell>
                </TableRow>
              ) : (
                summaryRows.map(({ employee, summary }) => {
                  const remaining = Number(summary.remaining || 0);
                  const statusVariant = remaining < 0 ? 'destructive' : 'secondary';
                  return (
                    <TableRow key={employee.id}>
                      <TableCell className="font-medium">{employee.name}</TableCell>
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
    </div>
  );
}
