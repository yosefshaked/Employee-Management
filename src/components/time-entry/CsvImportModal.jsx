import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { parseHebrewCsv } from '@/lib/csv.js';
import { calculateGlobalDailyRate } from '@/lib/payroll.js';
import { supabase } from '@/supabaseClient';

const GENERIC_RATE_SERVICE_ID = '00000000-0000-0000-0000-000000000000';

export default function CsvImportModal({ open, onOpenChange, employees, services, getRateForDate, onImported }) {
  const [employeeId, setEmployeeId] = useState('');
  const [csvText, setCsvText] = useState('');
  const [rows, setRows] = useState([]);

  const parseCsv = () => {
    const employee = employees.find(e => e.id === employeeId);
    if (!employee) {
      toast.error('יש לבחור עובד לפני הפענוח');
      return;
    }
    const parsed = parseHebrewCsv(csvText, services);
    const withValidation = parsed.map(r => validateRow(r, employee));
    setRows(withValidation);
  };

  const validateRow = (row, employee) => {
    const errors = [...row.errors];
    const serviceIdForRate = (employee.employee_type === 'hourly' || employee.employee_type === 'global') ? GENERIC_RATE_SERVICE_ID : row.service_id;
    if (row.entry_type === 'paid_leave' && employee.employee_type !== 'global') {
      errors.push('paid_leave only for global employees');
    }
    const { rate: rateUsed, reason } = getRateForDate(employee.id, row.date, serviceIdForRate);
    if (!rateUsed) {
      errors.push(reason || 'לא נמצא תעריף');
    }
    let totalPayment = 0;
    if (errors.length === 0) {
      if (row.entry_type === 'session') {
        if (!row.service_id) {
          errors.push('service_id required');
        } else {
          const service = services.find(s => s.id === row.service_id);
          if (service?.payment_model === 'per_student') {
            const students = row.students_count;
            if (!students) errors.push(`חובה להזין מספר תלמידים (גדול מ-0) עבור "${service.name}"`);
            else totalPayment = (row.sessions_count || 1) * students * rateUsed;
          } else {
            totalPayment = (row.sessions_count || 1) * rateUsed;
          }
        }
      } else if (row.entry_type === 'hours') {
        if (employee.employee_type === 'hourly') {
          if (!row.hours) errors.push('hours required');
          else totalPayment = row.hours * rateUsed;
        } else {
          try {
            const dailyRate = calculateGlobalDailyRate(employee, row.date, rateUsed);
            totalPayment = dailyRate;
          } catch (err) {
            errors.push(err.message);
          }
        }
      } else if (row.entry_type === 'paid_leave') {
        try {
          const dailyRate = calculateGlobalDailyRate(employee, row.date, rateUsed);
          totalPayment = dailyRate;
        } catch (err) {
          errors.push(err.message);
        }
      } else if (row.entry_type === 'adjustment') {
        totalPayment = row.hours || 0;
      }
    }
    return { ...row, rate_used: errors.length ? null : rateUsed, total_payment: errors.length ? null : totalPayment, errors };
  };

  const handleInsert = async () => {
    const employee = employees.find(e => e.id === employeeId);
    const valid = rows.filter(r => r.errors.length === 0);
    if (!employee || !valid.length) {
      toast.error('אין שורות תקינות לייבוא');
      return;
    }
    const payload = valid.map(r => ({
      employee_id: employee.id,
      date: r.date,
      entry_type: r.entry_type,
      service_id: r.entry_type === 'session' ? r.service_id : (employee.employee_type === 'hourly' ? GENERIC_RATE_SERVICE_ID : null),
      hours: r.entry_type === 'hours' ? (employee.employee_type === 'hourly' ? r.hours : (employee.employee_type === 'global' ? (r.hours || null) : null)) : null,
      sessions_count: r.entry_type === 'session' ? r.sessions_count : null,
      students_count: r.entry_type === 'session' ? r.students_count : null,
      notes: r.entry_type === 'paid_leave' ? 'paid_leave' : null,
      rate_used: r.rate_used,
      total_payment: r.total_payment,
    }));
    const { error } = await supabase.from('WorkSessions').insert(payload);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${payload.length} שורות יובאו בהצלחה`);
    onImported();
    setRows([]);
    setCsvText('');
    setEmployeeId('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>ייבוא CSV בעברית</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Select value={employeeId} onValueChange={setEmployeeId}>
            <SelectTrigger className="bg-white"><SelectValue placeholder="בחר עובד" /></SelectTrigger>
            <SelectContent>{employees.map(e => (<SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>))}</SelectContent>
          </Select>
          <Textarea value={csvText} onChange={e => setCsvText(e.target.value)} placeholder="הדבק כאן נתוני CSV" />
          <Button onClick={parseCsv} variant="outline">תצוגה מקדימה</Button>
          {rows.length > 0 && (
            <div className="max-h-60 overflow-auto border rounded">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-100"><th className="p-2">תאריך</th><th className="p-2">סוג</th><th className="p-2">סכום</th><th className="p-2">סטטוס</th></tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr key={idx} className="border-t">
                      <td className="p-2 text-right">{r.date}</td>
                      <td className="p-2 text-right">{r.entry_type}</td>
                      <td className="p-2 text-right">{r.total_payment ? `₪${r.total_payment.toFixed(2)}` : '-'}</td>
                      <td className="p-2 text-right">{r.errors.length ? r.errors.join('; ') : '✓'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>בטל</Button>
          <Button onClick={handleInsert} disabled={!rows.length}>ייבא</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
