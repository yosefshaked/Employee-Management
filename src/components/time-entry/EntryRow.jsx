/* eslint-disable react-refresh/only-export-components */
import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Calendar as CalendarIcon, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';
import { InfoTooltip } from '@/components/InfoTooltip.jsx';
import { calculateGlobalDailyRate } from '@/lib/payroll.js';

export function computeRowPayment(row, employee, services, getRateForDate) {
  const isHourlyOrGlobal = employee.employee_type === 'hourly' || employee.employee_type === 'global';
  const { rate } = getRateForDate(employee.id, row.date, isHourlyOrGlobal ? null : row.service_id);
  if (employee.employee_type === 'hourly') {
    return (parseFloat(row.hours) || 0) * rate;
  }
  if (employee.employee_type === 'global') {
    try {
      return calculateGlobalDailyRate(employee, row.date, rate);
    } catch {
      return 0;
    }
  }
  if (employee.employee_type === 'instructor') {
    const service = services.find(s => s.id === row.service_id);
    if (service) {
      if (service.payment_model === 'per_student') {
        return (parseInt(row.sessions_count, 10) || 1) * (parseInt(row.students_count, 10) || 0) * rate;
      }
      return (parseInt(row.sessions_count, 10) || 1) * rate;
    }
  }
  return 0;
}

export default function EntryRow({
  value,
  onChange,
  onCopyField,
  employee,
  services,
  getRateForDate,
  allowRemove = false,
  onRemove,
  showSummary = true,
  readOnlyDate = false
}) {
  const row = value;
  const handleChange = (field, val) => onChange({ [field]: val });
  const selectedService = services.find(s => s.id === row.service_id);
  const isHourlyOrGlobal = employee.employee_type === 'hourly' || employee.employee_type === 'global';
  const { rate } = getRateForDate(employee.id, row.date, isHourlyOrGlobal ? null : row.service_id);
  const rowPayment = computeRowPayment(row, employee, services, getRateForDate);

  return (
    <div className="rounded-xl bg-slate-50 p-4 space-y-3 relative">
      {readOnlyDate ? (
        <div className="text-sm font-medium text-right">{format(new Date(row.date), 'dd/MM/yyyy')}</div>
      ) : (
        <div className="space-y-1">
          <Label className="text-sm font-medium text-slate-700">תאריך</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-start text-right font-normal bg-white">
                <CalendarIcon className="ml-2 h-4 w-4" />
                {format(new Date(row.date), 'dd/MM/yyyy')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0">
              <Calendar mode="single" selected={new Date(row.date)} onSelect={(d) => d && handleChange('date', format(d, 'yyyy-MM-dd'))} initialFocus locale={he} />
            </PopoverContent>
          </Popover>
        </div>
      )}

      {employee.employee_type === 'hourly' && (
        <div className="space-y-1">
          <Label className="text-sm font-medium text-slate-700">שעות עבודה</Label>
          <div className="flex gap-2">
            <Input type="number" step="0.1" value={row.hours} onChange={(e) => handleChange('hours', e.target.value)} required className="w-full bg-white" />
            {onCopyField && <Button variant="ghost" size="sm" onClick={() => onCopyField('hours')}>העתק מהרישום הקודם</Button>}
          </div>
        </div>
      )}

      {employee.employee_type === 'global' && (
        <>
          <div className="space-y-1">
            <Label className="text-sm font-medium text-slate-700">סוג יום</Label>
            <Select value={row.entry_type} onValueChange={(v) => handleChange('entry_type', v)}>
              <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="hours">יום רגיל</SelectItem>
                <SelectItem value="paid_leave">חופשה בתשלום</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="flex items-center gap-1 text-sm font-medium text-slate-700">שעות<InfoTooltip text="בגלובלי השכר מחושב לפי יום; שדה השעות להצגה בלבד." /></Label>
            <div className="flex gap-2">
              <Input type="number" step="0.1" value={row.hours} onChange={(e) => handleChange('hours', e.target.value)} className="w-full bg-white" />
              {onCopyField && <Button variant="ghost" size="sm" onClick={() => onCopyField('hours')}>העתק מהרישום הקודם</Button>}
            </div>
          </div>
        </>
      )}

      {employee.employee_type === 'instructor' && (
        <div className="space-y-1">
          <Label className="text-sm font-medium text-slate-700">שירות</Label>
          <div className="flex gap-2">
            <Select value={row.service_id} onValueChange={(v) => handleChange('service_id', v)}>
              <SelectTrigger className="bg-white"><SelectValue placeholder="בחר שירות..." /></SelectTrigger>
              <SelectContent>{services.map(s => (<SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>))}</SelectContent>
            </Select>
            {onCopyField && <Button variant="ghost" size="sm" onClick={() => onCopyField('service_id')}>העתק מהרישום הקודם</Button>}
          </div>
        </div>
      )}

      {employee.employee_type === 'instructor' && selectedService && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-sm font-medium text-slate-700">כמות מפגשים</Label>
            <div className="flex gap-2">
              <Input type="number" value={row.sessions_count} onChange={(e) => handleChange('sessions_count', e.target.value)} className="w-full bg-white" />
              {onCopyField && <Button variant="ghost" size="sm" onClick={() => onCopyField('sessions_count')}>העתק מהרישום הקודם</Button>}
            </div>
          </div>
          {selectedService.payment_model === 'per_student' && (
            <div className="space-y-1">
              <Label className="text-sm font-medium text-slate-700">כמות תלמידים</Label>
              <div className="flex gap-2">
                <Input type="number" value={row.students_count} onChange={(e) => handleChange('students_count', e.target.value)} className="w-full bg-white" />
                {onCopyField && <Button variant="ghost" size="sm" onClick={() => onCopyField('students_count')}>העתק מהרישום הקודם</Button>}
              </div>
            </div>
          )}
        </div>
      )}

      {showSummary && (
        <div className="text-sm text-slate-600 bg-slate-100 p-2 rounded-md text-right">
          {employee.employee_type === 'global'
            ? `שכר חודשי: ₪${rate.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`
            : `תעריף: ₪${rate.toFixed(2)}`}
          {' | '}סה"כ לשורה: <span className="font-bold text-slate-800">₪{rowPayment.toFixed(2)}</span>
        </div>
      )}

      {allowRemove && (
        <Button variant="ghost" size="icon" onClick={onRemove} className="absolute top-1 left-1 h-7 w-7 text-red-500 hover:bg-red-50">
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

