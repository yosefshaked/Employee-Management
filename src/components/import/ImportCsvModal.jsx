import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { parseHebrewCsv, validateImportRow } from '@/lib/csvMapping.js';
import { supabase } from '@/supabaseClient';

const GENERIC_RATE_SERVICE_ID = '00000000-0000-0000-0000-000000000000';

export default function CsvImportModal({ open, onOpenChange, employees, services, getRateForDate, onImported }) {
  const [employeeId, setEmployeeId] = useState('');
  const [csvText, setCsvText] = useState('');
  const [rows, setRows] = useState([]);

  const parseCsv = (text) => {
    const employee = employees.find(e => e.id === employeeId);
    if (!employee) {
      toast.error('יש לבחור עובד לפני הפענוח');
      return;
    }
    const parsed = parseHebrewCsv(text, services);
    const withValidation = parsed.map(r => validateImportRow(r, employee, services, getRateForDate));
    setRows(withValidation);
  };

  const handleParseClick = () => parseCsv(csvText);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    const text = new TextDecoder('utf-8').decode(buf);
    setCsvText(text);
    parseCsv(text);
  };

  const downloadTemplate = () => {
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();
    const dateStr = `${dd}/${mm}/${yyyy}`;
    const rows = [
      ['תאריך','סוג רישום','שירות','שעות','מספר שיעורים','מספר תלמידים'],
      [dateStr,'שעות','', '8','',''],
      [dateStr,'שיעור','שם שירות לדוגמה','', '1','1'],
      [dateStr,'חופשה בתשלום','','','',''],
    ];
    const bom = '\ufeff';
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'template-ייבוא-רישומים.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadErrors = () => {
    const invalid = rows.filter(r => r.errors.length);
    if (!invalid.length) return;
    const headers = ['תאריך','סוג','שגיאות'];
    const data = invalid.map(r => [r.date || '', r.entry_type || '', r.errors.join('; ')]);
    const bom = '\ufeff';
    const csv = [headers, ...data].map(r => r.join(',')).join('\n');
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'errors.csv';
    a.click();
    URL.revokeObjectURL(url);
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
          <div className="flex items-center gap-2">
            <input type="file" accept=".csv,text/csv" onChange={handleFile} />
            <Button onClick={downloadTemplate} variant="outline">הורד CSV להזנה</Button>
          </div>
          <Textarea value={csvText} onChange={e => setCsvText(e.target.value)} placeholder="הדבק כאן נתוני CSV" />
          <Button onClick={handleParseClick} variant="outline">תצוגה מקדימה</Button>
          {rows.length > 0 && (
            <div className="max-h-60 overflow-auto border rounded">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-100"><th className="p-2">תאריך</th><th className="p-2">סוג</th><th className="p-2">סכום</th><th className="p-2">סטטוס</th></tr>
                </thead>
                <tbody>
                  {rows.slice(0,50).map((r, idx) => (
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
          {rows.some(r => r.errors.length) && (
            <Button onClick={downloadErrors} variant="outline">הורד שגיאות</Button>
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
