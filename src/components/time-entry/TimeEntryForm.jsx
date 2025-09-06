import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Calendar as CalendarIcon, Save, Plus, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { he } from "date-fns/locale";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const createNewRow = () => ({
  id: Math.random(),
  date: new Date().toISOString().split('T')[0],
  service_id: '',
  hours: '',
  sessions_count: '1',
  students_count: '',
  notes: ''
});

export default function TimeEntryForm({ employee, services, onSubmit, getRateForDate }) {
  const [rows, setRows] = useState([createNewRow()]);
  const [totalCalculatedPayment, setTotalCalculatedPayment] = useState(0);

  // useEffect שיחשב את התשלום הכולל בכל שינוי
  useEffect(() => {
    const total = rows.reduce((sum, row) => {
      const rate = getRateForDate(employee.id, row.date, row.service_id);
      let rowPayment = 0;
      if (employee.employee_type === 'hourly') {
        rowPayment = (parseFloat(row.hours) || 0) * rate;
      } else {
        const service = services.find(s => s.id === row.service_id);
        if (service) {
          if (service.payment_model === 'per_student') {
            rowPayment = (parseInt(row.sessions_count, 10) || 0) * (parseInt(row.students_count, 10) || 0) * rate;
          } else {
            rowPayment = (parseInt(row.sessions_count, 10) || 0) * rate;
          }
        }
      }
      return sum + rowPayment;
    }, 0);
    setTotalCalculatedPayment(total);
  }, [rows, employee, services, getRateForDate]);

  const addRow = () => setRows(prev => [...prev, createNewRow()]);
  const removeRow = (id) => { if (rows.length > 1) setRows(prev => prev.filter(row => row.id !== id)); };
  const handleRowChange = (id, field, value) => { setRows(prev => prev.map(row => row.id === id ? { ...row, [field]: value } : row)); };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(rows);
    setRows([createNewRow()]);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-4">
        {rows.map((row) => {
          const selectedService = services.find(s => s.id === row.service_id);
          const rate = getRateForDate(employee.id, row.date, row.service_id);
          let rowPayment = 0;
          if (employee.employee_type === 'hourly') {
            rowPayment = (parseFloat(row.hours) || 0) * rate;
          } else if (selectedService) {
            if (selectedService.payment_model === 'per_student') {
              rowPayment = (parseInt(row.sessions_count, 10) || 0) * (parseInt(row.students_count, 10) || 0) * rate;
            } else {
              rowPayment = (parseInt(row.sessions_count, 10) || 0) * rate;
            }
          }

          return (
            <div key={row.id} className="p-4 border rounded-lg bg-slate-50 relative space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1"><Label>תאריך</Label><Popover><PopoverTrigger asChild><Button variant="outline" className="w-full justify-start text-right font-normal bg-white"><CalendarIcon className="ml-2 h-4 w-4" />{format(new Date(row.date), 'dd/MM/yyyy')}</Button></PopoverTrigger><PopoverContent className="w-auto p-0"><Calendar mode="single" selected={new Date(row.date)} onSelect={(date) => date && handleRowChange(row.id, 'date', format(date, 'yyyy-MM-dd'))} initialFocus locale={he} /></PopoverContent></Popover></div>
                {employee.employee_type === 'hourly' ? (
                  <div className="space-y-1"><Label>שעות עבודה</Label><Input type="number" step="0.1" value={row.hours} onChange={(e) => handleRowChange(row.id, 'hours', e.target.value)} required className="bg-white" /></div>
                ) : (
                  <div className="space-y-1"><Label>שירות</Label><Select value={row.service_id} onValueChange={(value) => handleRowChange(row.id, 'service_id', value)} required><SelectTrigger className="bg-white"><SelectValue placeholder="בחר שירות..." /></SelectTrigger><SelectContent>{services.map(s => (<SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>))}</SelectContent></Select></div>
                )}
              </div>
              {employee.employee_type === 'instructor' && selectedService && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1"><Label>כמות מפגשים</Label><Input type="number" value={row.sessions_count} onChange={(e) => handleRowChange(row.id, 'sessions_count', e.target.value)} required className="bg-white" /></div>
                  {selectedService.payment_model === 'per_student' && (
                    <div className="space-y-1"><Label>כמות תלמידים</Label><Input type="number" value={row.students_count} onChange={(e) => handleRowChange(row.id, 'students_count', e.target.value)} required className="bg-white" /></div>
                  )}
                </div>
              )}
              <div className="text-sm text-slate-600 bg-slate-100 p-2 rounded-md text-right">
                תעריף: ₪{rate.toFixed(2)} | סה"כ לשורה: <span className="font-bold text-slate-800">₪{rowPayment.toFixed(2)}</span>
              </div>
              {rows.length > 1 && (<Button variant="ghost" size="icon" onClick={() => removeRow(row.id)} className="absolute top-1 left-1 h-7 w-7 text-red-500 hover:bg-red-50"><Trash2 className="h-4 w-4" /></Button>)}
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
      
      <div className="flex justify-between items-center pt-4">
        <Button type="button" variant="outline" onClick={addRow}><Plus className="w-4 h-4 ml-2" />הוסף רישום</Button>
        <Button type="submit" className="bg-gradient-to-r from-green-500 to-blue-500 text-white"><Save className="w-4 h-4 ml-2" />שמור רישומים</Button>
      </div>
    </form>
  );
}