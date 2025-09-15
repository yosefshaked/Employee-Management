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
import { toast } from 'sonner';
import { Loader2, ShieldCheck } from 'lucide-react';
import { supabase } from '@/supabaseClient';
import { selectLeaveRemaining, selectHolidayForDate } from '@/selectors.js';
import { DEFAULT_LEAVE_POLICY, HOLIDAY_TYPE_LABELS } from '@/lib/leave.js';

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
  onRefresh,
  isLoading = false,
}) {
  const [evaluationDate, setEvaluationDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [showInactive, setShowInactive] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formState, setFormState] = useState({
    employeeId: '',
    entryKind: 'usage',
    date: new Date().toISOString().slice(0, 10),
    holidayType: '',
    usageAmount: 1,
    allocationAmount: 1,
    notes: '',
  });

  useEffect(() => {
    if (!formState.employeeId && employees.length > 0) {
      setFormState(prev => ({ ...prev, employeeId: employees[0].id }));
    }
  }, [employees, formState.employeeId]);

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
    if (!formState.employeeId) {
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
    let source = 'manual';
    if (entryKind === 'allocation') {
      const allocation = Number(formState.allocationAmount);
      if (!allocation || allocation <= 0) {
        toast.error('הזן כמות ימים גדולה מאפס להקצאה');
        return;
      }
      delta = allocation;
      source = 'allocation';
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
      source = `usage_${type}`;
    }
    const summary = selectLeaveRemaining(employee.id, date, {
      employees,
      leaveBalances,
      policy: leavePolicy,
    });
    const projected = summary.remaining + delta;
    if (formState.entryKind === 'usage') {
      if (!leavePolicy.allow_negative_balance && projected < 0) {
        toast.error('חריגה ממכסה ימי החופשה המותרים');
        return;
      }
      if (leavePolicy.allow_negative_balance && projected < -Number(leavePolicy.negative_floor_days || 0)) {
        toast.error('חריגה ממכסה ימי החופשה המותרים');
        return;
      }
    }
    setIsSubmitting(true);
    try {
      const payload = {
        employee_id: employee.id,
        date,
        days_delta: delta,
        source,
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
                  <Label className="text-sm font-semibold text-slate-700">סוג חג</Label>
                  <Select
                    value={formState.holidayType || 'employee_paid'}
                    onValueChange={(value) => handleFormChange({ holidayType: value, usageAmount: determineUsageAmount(value) })}
                  >
                    <SelectTrigger className="bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="employee_paid">חופשה מהמכסה</SelectItem>
                      <SelectItem value="system_paid">חג משולם (מערכת)</SelectItem>
                      <SelectItem value="unpaid">לא משולם</SelectItem>
                      <SelectItem value="mixed">מעורב</SelectItem>
                      {leavePolicy.allow_half_day && (
                        <SelectItem value="half_day">חצי יום</SelectItem>
                      )}
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
                <TableHead className="text-right">יתרת פתיחה</TableHead>
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
                          {remaining < 0 ? 'במינוס' : 'בתקין'}
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
