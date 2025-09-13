import React, { useState, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import { Save, Plus } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import EntryRow, { computeRowPayment } from './EntryRow.jsx';
import DayHeader from './DayHeader.jsx';
import { applyDayType, removeSegment } from './dayUtils.js';
import { toast } from 'sonner';
import { aggregateGlobalDayForDate } from '@/lib/payroll.js';

export default function TimeEntryForm({ employee, services, onSubmit, getRateForDate, initialRows = null, selectedDate, hideSubmitButton = false, formId }) {
  const isGlobal = employee.employee_type === 'global';
  const hasExisting = initialRows && initialRows.length > 0;

  const createNewRow = (dateToUse, dt) => ({
    id: crypto.randomUUID(),
    isNew: true,
    date: dateToUse || new Date().toISOString().split('T')[0],
    service_id: '',
    hours: '',
    sessions_count: '1',
    students_count: '',
    notes: '',
    dayType: isGlobal ? (dt || null) : undefined,
  });

  const [rows, setRows] = useState(() => {
    if (hasExisting) return initialRows.map(r => ({ ...r, dayType: r.entry_type === 'paid_leave' ? 'paid_leave' : 'regular' }));
    return [createNewRow(selectedDate)];
  });
  const [dayType, setDayType] = useState(() => (hasExisting && isGlobal ? (initialRows[0].entry_type === 'paid_leave' ? 'paid_leave' : 'regular') : null));

  const totalCalculatedPayment = useMemo(() => {
    if (employee.employee_type === 'global') {
      const payments = rows.map(r => ({
        ...r,
        entry_type: r.dayType === 'paid_leave' ? 'paid_leave' : 'hours',
        employee_id: employee.id,
        total_payment: computeRowPayment(r, employee, services, getRateForDate)
      }));
      const agg = aggregateGlobalDayForDate(payments, { [employee.id]: employee });
      return agg.total;
    }
    return rows.reduce((sum, row) => sum + computeRowPayment(row, employee, services, getRateForDate), 0);
  }, [rows, employee, services, getRateForDate]);

  const duplicateMap = useMemo(() => {
    if (employee.employee_type !== 'global') return {};
    const payments = rows.map(r => ({
      ...r,
      entry_type: r.dayType === 'paid_leave' ? 'paid_leave' : 'hours',
      employee_id: employee.id,
      total_payment: computeRowPayment(r, employee, services, getRateForDate)
    }));
    const agg = aggregateGlobalDayForDate(payments, { [employee.id]: employee });
    const res = {};
    rows.forEach(r => {
      const info = agg.byKey.get(`${employee.id}|${r.date}`);
      res[r.id] = info ? info.firstRowId !== r.id : false;
    });
    return res;
  }, [rows, employee, services, getRateForDate]);

  const addRow = () => {
    const referenceDate = rows.length > 0 ? rows[0].date : selectedDate;
    setRows(prev => [...prev, createNewRow(referenceDate, dayType)]);
  };

  const removeRow = (id) => {
    if (isGlobal) {
      const res = removeSegment(rows, id);
      if (!res.removed) {
        toast('נדרש לפחות מקטע אחד ליום גלובלי');
      } else {
        setRows(res.rows);
      }
    } else {
      setRows(prev => prev.filter(row => row.id !== id));
    }
  };

  const handleRowChange = (id, patch) => {
    setRows(prev => prev.map(row => row.id === id ? { ...row, ...patch } : row));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const rowsToSave = isGlobal && hasExisting ? applyDayType(rows, dayType) : rows;
    onSubmit(rowsToSave);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6" id={formId}>
      {isGlobal && hasExisting && (
        <DayHeader dayType={dayType} onChange={setDayType} />
      )}
      <div className="space-y-4">
        {rows.map((row) => (
          <EntryRow
            key={row.id}
            value={row}
            employee={employee}
            services={services}
            getRateForDate={getRateForDate}
            onChange={(patch) => handleRowChange(row.id, patch)}
            allowRemove={(!isGlobal || hasExisting) && rows.length > 1}
            onRemove={() => removeRow(row.id)}
            isDuplicate={!!duplicateMap[row.id]}
            hideDayType={isGlobal && (hasExisting || rows.length > 1)}
            readOnlyDate
          />
        ))}
      </div>

      {isGlobal && hasExisting && (
        <Button type="button" variant="outline" onClick={addRow}><Plus className="w-4 h-4 ml-2" />הוסף מקטע שעות</Button>
      )}

      {!isGlobal && (
        <div className="flex justify-start">
          <Button type="button" variant="outline" onClick={addRow}><Plus className="w-4 h-4 ml-2" />הוסף רישום</Button>
        </div>
      )}

      <Alert variant="info" className="bg-blue-50 border-blue-200">
        <AlertTitle className="text-blue-800 font-semibold">סיכום כולל לרישומים</AlertTitle>
        <AlertDescription className="text-blue-700">
          סה״כ לתשלום עבור כל הרישומים שהוזנו: <span className="font-bold">₪{totalCalculatedPayment.toFixed(2)}</span>
        </AlertDescription>
      </Alert>
      <div className="flex justify-end items-center pt-4">
        {!hideSubmitButton && (
          <Button type="submit" className="bg-gradient-to-r from-green-500 to-blue-500 text-white"><Save className="w-4 h-4 ml-2" />שמור רישומים</Button>
        )}
      </div>
    </form>
  );
}
