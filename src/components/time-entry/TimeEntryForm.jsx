import React, { useState, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Calendar as CalendarIcon, Save, Plus, Trash2 } from "lucide-react";
import { format, getDaysInMonth } from "date-fns";
import { he } from "date-fns/locale";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

// This is our central calculation logic
const calculateRowPayment = (row, employee, services, getRateForDate) => {
  const isHourlyOrGlobal = employee.employee_type === 'hourly' || employee.employee_type === 'global';
  const { rate } = getRateForDate(employee.id, row.date, isHourlyOrGlobal ? null : row.service_id);

  if (employee.employee_type === 'hourly') {
    return (parseFloat(row.hours) || 0) * rate;
  }
  if (employee.employee_type === 'global') {
    const daysInMonth = getDaysInMonth(new Date(row.date));
    return rate / daysInMonth;
  }
  if (employee.employee_type === 'instructor') {
    const service = services.find(s => s.id === row.service_id);
    if (service) {
      if (service.payment_model === 'per_student') {
        return (parseInt(row.sessions_count, 10) || 1) * (parseInt(row.students_count, 10) || 0) * rate;
      } else {
        return (parseInt(row.sessions_count, 10) || 1) * rate;
      }
    }
  }
  return 0;
};

export default function TimeEntryForm({ employee, services, onSubmit, getRateForDate, initialRows = null, selectedDate, allowAddRow = true }) {
  
  const createNewRow = (dateToUse) => ({
    id: crypto.randomUUID(),
    isNew: true,
    date: dateToUse ? format(new Date(dateToUse), 'yyyy-MM-dd') : new Date().toISOString().split('T')[0],
    service_id: '',
    hours: '',
    sessions_count: '1',
    students_count: '',
    notes: ''
  });
  
  const [rows, setRows] = useState(() => {
    if (initialRows && initialRows.length > 0) return initialRows;
    return [createNewRow(selectedDate)];
  });

  const totalCalculatedPayment = useMemo(() => {
    return rows.reduce((sum, row) => {
      return sum + calculateRowPayment(row, employee, services, getRateForDate);
    }, 0);
  }, [rows, employee, services, getRateForDate]);

  const addRow = () => {
    const referenceDate = rows.length > 0 ? rows[0].date : selectedDate;
    setRows(prev => [...prev, createNewRow(referenceDate)]);
  };
  
  const removeRow = (id) => {
    setRows(prev => {
      const newRows = prev.filter(row => row.id !== id);
      return newRows.length > 0 ? newRows : [createNewRow(selectedDate)];
    });
  };

  const handleRowChange = (id, field, value) => { setRows(prev => prev.map(row => row.id === id ? { ...row, [field]: value } : row)); };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(rows);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-4">
        {rows.map((row) => {
          const selectedService = services.find(s => s.id === row.service_id);
          const isHourlyOrGlobal = employee.employee_type === 'hourly' || employee.employee_type === 'global';
          const { rate } = getRateForDate(employee.id, row.date, isHourlyOrGlobal ? null : row.service_id);
          const rowPayment = calculateRowPayment(row, employee, services, getRateForDate);

          return (
            <div key={row.id} className="p-4 border rounded-lg bg-slate-50 relative space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1"><Label>תאריך</Label><Popover><PopoverTrigger asChild><Button variant="outline" className="w-full justify-start text-right font-normal bg-white"><CalendarIcon className="ml-2 h-4 w-4" />{format(new Date(row.date), 'dd/MM/yyyy')}</Button></PopoverTrigger><PopoverContent className="w-auto p-0"><Calendar mode="single" selected={new Date(row.date)} onSelect={(date) => date && handleRowChange(row.id, 'date', format(date, 'yyyy-MM-dd'))} initialFocus locale={he} /></PopoverContent></Popover></div>
                {(isHourlyOrGlobal) ? (
                  <div className="space-y-1"><Label>שעות עבודה</Label><Input type="number" step="0.1" value={row.hours || ''} onChange={(e) => handleRowChange(row.id, 'hours', e.target.value)} required={employee.employee_type === 'hourly'} className="bg-white" /></div>
                ) : (
                  <div className="space-y-1"><Label>שירות</Label><Select value={row.service_id} onValueChange={(serviceId) => handleRowChange(row.id, 'service_id', serviceId)} required><SelectTrigger className="bg-white"><SelectValue placeholder="בחר שירות..." /></SelectTrigger><SelectContent>{services.map(s => (<SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>))}</SelectContent></Select></div>
                )}
              </div>
              {employee.employee_type === 'instructor' && selectedService && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1"><Label>כמות מפגשים</Label><Input type="number" value={row.sessions_count || ''} onChange={(e) => handleRowChange(row.id, 'sessions_count', e.target.value)} required className="bg-white" /></div>
                  {selectedService.payment_model === 'per_student' && (
                    <div className="space-y-1"><Label>כמות תלמידים</Label><Input type="number" value={row.students_count || ''} onChange={(e) => handleRowChange(row.id, 'students_count', e.target.value)} required className="bg-white" /></div>
                  )}
                </div>
              )}
              <div className="text-sm text-slate-600 bg-slate-100 p-2 rounded-md text-right">
                {employee.employee_type === 'global' 
                  ? `שכר חודשי: ₪${rate.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`
                  : `תעריף: ₪${rate.toFixed(2)}`
                }
                {' | '}
                סה"כ לשורה: <span className="font-bold text-slate-800">₪{rowPayment.toFixed(2)}</span>
              </div>
              {typeof row.id === 'string' && rows.length > 1 && (
                <Button variant="ghost" size="icon" onClick={() => removeRow(row.id)} className="absolute top-1 left-1 h-7 w-7 text-red-500 hover:bg-red-50">
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          );
        })}
      </div>
      
      <Alert variant="info" className="bg-blue-50 border-blue-200">
        <AlertTitle className="text-blue-800 font-semibold">סיכום כולל לרישומים</AlertTitle>
        <AlertDescription className="text-blue-700">
          סה״כ לתשלום עבור כל הרישומים שהוזנו: <span className="font-bold">₪{totalCalculatedPayment.toFixed(2)}</span>
        </AlertDescription>
      </Alert>
      
        <div className={`flex ${allowAddRow ? 'justify-between' : 'justify-end'} items-center pt-4`}>
          {allowAddRow && (
            <Button type="button" variant="outline" onClick={addRow}><Plus className="w-4 h-4 ml-2" />הוסף רישום</Button>
          )}
          <Button type="submit" className="bg-gradient-to-r from-green-500 to-blue-500 text-white"><Save className="w-4 h-4 ml-2" />שמור רישומים</Button>
        </div>
    </form>
  );
}