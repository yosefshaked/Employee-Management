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
import { updateEmployee } from '@/api/employees.js';
import { selectLeaveRemaining, selectHolidayForDate } from '@/selectors.js';
import {
  DEFAULT_LEAVE_POLICY,
  DEFAULT_LEAVE_PAY_POLICY,
  HOLIDAY_TYPE_LABELS,
  LEAVE_TYPE_OPTIONS,
  LEAVE_PAY_METHOD_OPTIONS,
  LEAVE_PAY_METHOD_DESCRIPTIONS,
  LEAVE_PAY_METHOD_LABELS,
  getLeaveBaseKind,
  getNegativeBalanceFloor,
  resolveLeavePayMethodContext,
} from '@/lib/leave.js';

const EMPLOYEE_PLACEHOLDER_VALUE = '__employee_placeholder__';
const OVERRIDE_METHOD_PLACEHOLDER_VALUE = '__no_override__';

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
  const [overrideEmployeeId, setOverrideEmployeeId] = useState(null);
  const [overrideMethod, setOverrideMethod] = useState(OVERRIDE_METHOD_PLACEHOLDER_VALUE);
  const [overrideRate, setOverrideRate] = useState('');
  const [isSavingOverride, setIsSavingOverride] = useState(false);
  const [isOverrideDialogOpen, setIsOverrideDialogOpen] = useState(false);
  const { dataClient, authClient, user, loading, session } = useSupabase();
  const { activeOrgId } = useOrg();

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
      if (!dataClient) {
        throw new Error('חיבור Supabase אינו זמין.');
      }
      const payload = {
        employee_id: employee.id,
        effective_date: date,
        balance: delta,
        leave_type: ledgerType,
        notes: formState.notes ? formState.notes.trim() : null,
      };
      const { error } = await dataClient.from('LeaveBalances').insert([payload]);
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

  const selectedEmployee = useMemo(() => {
    if (!overrideEmployeeId) return null;
    return employees.find(emp => emp.id === overrideEmployeeId) || null;
  }, [employees, overrideEmployeeId]);

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

  if (!dataClient) {
    return (
      <Card className="border-0 shadow-lg bg-white/80">
        <CardHeader className="border-b">
          <CardTitle className="text-xl font-semibold text-slate-900">נדרש חיבור Supabase פעיל לארגון.</CardTitle>
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
