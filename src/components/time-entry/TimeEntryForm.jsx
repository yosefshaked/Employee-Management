import React, { useState, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import { Save, Plus } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import EntryRow, { computeRowPayment } from './EntryRow.jsx';

export default function TimeEntryForm({ employee, services, onSubmit, getRateForDate, initialRows = null, selectedDate, allowAddRow = true }) {
  const createNewRow = (dateToUse) => ({
    id: crypto.randomUUID(),
    isNew: true,
    date: dateToUse ? new Date(dateToUse).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    service_id: '',
    hours: '',
    sessions_count: '1',
    students_count: '',
    notes: '',
    entry_type: employee.employee_type === 'global' ? 'hours' : undefined,
  });

  const [rows, setRows] = useState(() => {
    if (initialRows && initialRows.length > 0) return initialRows;
    return [createNewRow(selectedDate)];
  });

  const totalCalculatedPayment = useMemo(() => {
    return rows.reduce((sum, row) => sum + computeRowPayment(row, employee, services, getRateForDate), 0);
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

  const handleRowChange = (id, patch) => {
    setRows(prev => prev.map(row => row.id === id ? { ...row, ...patch } : row));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(rows);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-4">
        {rows.map((row) => (
          <EntryRow
            key={row.id}
            value={row}
            employee={employee}
            services={services}
            getRateForDate={getRateForDate}
            onChange={(patch) => handleRowChange(row.id, patch)}
            allowRemove={allowAddRow && typeof row.id === 'string' && rows.length > 1}
            onRemove={() => removeRow(row.id)}
          />
        ))}
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
