import React, { useMemo, useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import EntryRow from './EntryRow.jsx';
import { copyFromPrevious, fillDown } from './multiDateUtils.js';
import { format } from 'date-fns';
import { useTimeEntry } from './useTimeEntry.js';

export default function MultiDateEntryModal({ open, onClose, employees, services, selectedEmployees, selectedDates, getRateForDate, onSaved }) {
  const employeesById = useMemo(() => Object.fromEntries(employees.map(e => [e.id, e])), [employees]);
  const initialRows = useMemo(() => {
    const items = [];
    for (const empId of selectedEmployees) {
      const emp = employeesById[empId];
      const datesSorted = [...selectedDates].sort((a, b) => a - b);
      for (const d of datesSorted) {
        items.push({
          employee_id: empId,
          date: format(d, 'yyyy-MM-dd'),
          entry_type: emp.employee_type === 'global' ? 'hours' : (emp.employee_type === 'hourly' ? 'hours' : 'session'),
          service_id: null,
          hours: '',
          sessions_count: '',
          students_count: '',
          notes: ''
        });
      }
    }
    return items;
  }, [selectedEmployees, selectedDates, employeesById]);

  const [rows, setRows] = useState(initialRows);
  useEffect(() => { setRows(initialRows); }, [initialRows]);
  const { saveRows } = useTimeEntry({ employees, services, getRateForDate });

  const updateRow = (index, patch) => setRows(prev => prev.map((r, i) => i === index ? { ...r, ...patch } : r));
  const handleCopy = (index, field) => setRows(prev => copyFromPrevious(prev, index, field));
  const handleFillDown = (field) => setRows(prev => fillDown(prev, field));

  const handleSave = async () => {
    try {
      await saveRows(rows);
      onSaved();
      onClose();
    } catch (e) {
      alert(e.message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>הזנה מרובה</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 mb-4">
          <Button variant="outline" size="sm" onClick={() => handleFillDown('hours')}>העתק מהראשון לכל השורות (שעות)</Button>
          <Button variant="outline" size="sm" onClick={() => handleFillDown('sessions_count')}>העתק מהראשון לכל השורות (מפגשים)</Button>
          <Button variant="outline" size="sm" onClick={() => handleFillDown('students_count')}>העתק מהראשון לכל השורות (תלמידים)</Button>
        </div>

        <div className="space-y-4">
          {rows.map((row, index) => (
            <EntryRow
              key={`${row.employee_id}-${row.date}-${index}`}
              value={row}
              employee={employeesById[row.employee_id]}
              services={services}
              getRateForDate={getRateForDate}
              onChange={(patch) => updateRow(index, patch)}
              onCopyField={(field) => handleCopy(index, field)}
              showSummary={false}
              readOnlyDate
            />
          ))}
        </div>

        <div className="flex justify-end mt-4 gap-2">
          <Button variant="outline" onClick={onClose}>בטל</Button>
          <Button onClick={handleSave}>שמור רישומים</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
