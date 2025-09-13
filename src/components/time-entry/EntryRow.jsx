/* eslint-disable react-refresh/only-export-components */
import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Calendar as CalendarIcon, Trash2, Copy } from 'lucide-react';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';
import { InfoTooltip } from '@/components/InfoTooltip.jsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { calculateGlobalDailyRate } from '@/lib/payroll.js';
import { useEffect, useState } from 'react';

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
  readOnlyDate = false,
  flashField = null,
  errors = {},
  rowId
}) {
  const row = value;
  const handleChange = (field, val) => onChange({ [field]: val });
  const selectedService = services.find(s => s.id === row.service_id);
  const rowPayment = computeRowPayment(row, employee, services, getRateForDate);
  const [flash, setFlash] = useState(null);

  useEffect(() => {
    if (flashField) {
      setFlash(flashField);
      const t = setTimeout(() => setFlash(null), 400);
      return () => clearTimeout(t);
    }
  }, [flashField]);

  const CopyBtn = (field) => (
    onCopyField ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onCopyField(field)}
            className="h-6 w-6"
            aria-label="העתק מהרישום הקודם"
          >
            <Copy className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>העתק מהרישום הקודם</TooltipContent>
      </Tooltip>
    ) : null
  );

  return (
    <div className="w-full rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 p-4 md:p-5 relative focus-within:ring-2 focus-within:ring-sky-300" id={rowId}>
      {readOnlyDate ? (
        <div className="absolute top-2 right-2 text-xs font-medium text-slate-600 bg-slate-50 ring-1 ring-slate-200 rounded-full px-2 py-0.5">
          {format(new Date(row.date), 'dd/MM')}
        </div>
      ) : (
        <div className="space-y-1">
          <Label className="flex items-center gap-1 text-sm font-medium text-slate-700">
            {CopyBtn('date')}
            <span>תאריך</span>
          </Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-start text-right font-normal bg-white h-10 text-base leading-6">
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

      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3 mt-3">
        {employee.employee_type === 'hourly' && (
          <div className={`space-y-1 min-w-[160px] ${flash === 'hours' ? 'ring-2 ring-sky-300 rounded-md p-1' : ''}`}>
            <Label className="flex items-center gap-1 text-sm font-medium text-slate-700">
              {CopyBtn('hours')}
              <span>שעות עבודה</span>
            </Label>
            <Input
              type="number"
              step="0.1"
              value={row.hours}
              onChange={(e) => handleChange('hours', e.target.value)}
              required
              className="w-full bg-white h-10 text-base leading-6"
            />
            {errors.hours && <p className="text-sm text-red-600 mt-1">{errors.hours}</p>}
          </div>
        )}

        {employee.employee_type === 'global' && (
          <>
            <div className={`space-y-1 min-w-[180px] ${flash === 'entry_type' ? 'ring-2 ring-sky-300 rounded-md p-1' : ''}`}>
              <Label className="text-sm font-medium text-slate-700">סוג יום</Label>
              <Select value={row.entry_type} onValueChange={(v) => handleChange('entry_type', v)}>
                <SelectTrigger className="bg-white h-10 text-base leading-6"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hours">יום רגיל</SelectItem>
                  <SelectItem value="paid_leave">חופשה בתשלום</SelectItem>
                </SelectContent>
              </Select>
              {errors.entry_type && <p className="text-sm text-red-600 mt-1">{errors.entry_type}</p>}
            </div>
            <div className={`space-y-1 min-w-[160px] ${flash === 'hours' ? 'ring-2 ring-sky-300 rounded-md p-1' : ''}`}>
              <Label className="flex items-center gap-1 text-sm font-medium text-slate-700">
                {CopyBtn('hours')}
                <span className="flex items-center gap-1">שעות<InfoTooltip text="בגלובלי השכר מחושב לפי יום; שדה השעות להצגה בלבד." /></span>
              </Label>
              <Input
                type="number"
                step="0.1"
                value={row.hours}
                onChange={(e) => handleChange('hours', e.target.value)}
                className="w-full bg-white h-10 text-base leading-6"
              />
              {errors.hours && <p className="text-sm text-red-600 mt-1">{errors.hours}</p>}
            </div>
          </>
        )}

        {employee.employee_type === 'instructor' && (
          <div className={`space-y-1 min-w-[320px] ${flash === 'service_id' ? 'ring-2 ring-sky-300 rounded-md p-1' : ''}`}>
            <Label className="flex items-center gap-1 text-sm font-medium text-slate-700">
              {CopyBtn('service_id')}
              <span>שירות</span>
            </Label>
            <Select value={row.service_id} onValueChange={(v) => handleChange('service_id', v)}>
              <SelectTrigger className="bg-white whitespace-normal break-words min-h-10 py-2 leading-5">
                <SelectValue placeholder="בחר שירות..." />
              </SelectTrigger>
              <SelectContent>
                {services.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.service_id && <p className="text-sm text-red-600 mt-1">{errors.service_id}</p>}
          </div>
        )}

        {employee.employee_type === 'instructor' && selectedService && (
          <>
            <div className={`space-y-1 min-w-[160px] ${flash === 'sessions_count' ? 'ring-2 ring-sky-300 rounded-md p-1' : ''}`}>
              <Label className="flex items-center gap-1 text-sm font-medium text-slate-700">
                {CopyBtn('sessions_count')}
                <span>כמות מפגשים</span>
              </Label>
              <Input
                type="number"
                value={row.sessions_count}
                onChange={(e) => handleChange('sessions_count', e.target.value)}
                className="w-full bg-white h-10 text-base leading-6"
              />
              {errors.sessions_count && <p className="text-sm text-red-600 mt-1">{errors.sessions_count}</p>}
            </div>
            {selectedService.payment_model === 'per_student' && (
              <div className={`space-y-1 min-w-[160px] ${flash === 'students_count' ? 'ring-2 ring-sky-300 rounded-md p-1' : ''}`}>
                <Label className="flex items-center gap-1 text-sm font-medium text-slate-700">
                  {CopyBtn('students_count')}
                  <span>כמות תלמידים</span>
                </Label>
                <Input
                  type="number"
                  value={row.students_count}
                  onChange={(e) => handleChange('students_count', e.target.value)}
                  className="w-full bg-white h-10 text-base leading-6"
                />
                {errors.students_count && <p className="text-sm text-red-600 mt-1">{errors.students_count}</p>}
              </div>
            )}
          </>
        )}

        {employee.employee_type !== 'instructor' && employee.employee_type !== 'hourly' && employee.employee_type !== 'global' && null}

      </div>

      {showSummary && (
        <div className="mt-4 text-sm text-right text-slate-700">
          סה"כ לשורה: <span className="font-bold">₪{rowPayment.toFixed(2)}</span>
        </div>
      )}

      {allowRemove && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onRemove}
          className="absolute top-1 left-1 h-7 w-7 text-red-500 hover:bg-red-50"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

