import React, { useMemo, useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import EntryRow from './EntryRow.jsx';
import { copyFromPrevious, formatDatesCount } from './multiDateUtils.js';
import { format } from 'date-fns';
import { useTimeEntry } from './useTimeEntry.js';
import { ChevronDown, ChevronUp } from 'lucide-react';

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

  const groupedRows = useMemo(() => {
    const map = new Map();
    rows.forEach((row, index) => {
      if (!map.has(row.employee_id)) map.set(row.employee_id, []);
      map.get(row.employee_id).push({ row, index });
    });
    return Array.from(map.entries());
  }, [rows]);

  const [collapsed, setCollapsed] = useState({});
  const toggleEmp = (id) => setCollapsed(prev => ({ ...prev, [id]: !prev[id] }));

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
      <TooltipProvider>
        <DialogContent
          className="p-0 flex flex-col"
          style={{ width: 'min(95vw, 1100px)', height: 'min(90vh, calc(100dvh - 4rem))' }}
        >
          <DialogHeader className="sticky top-0 bg-background z-10 p-4 border-b">
            <DialogTitle>הזנה מרובה</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {groupedRows.map(([empId, items]) => {
              const emp = employeesById[empId];
              const isCollapsed = collapsed[empId];
              return (
                <div key={empId} className="space-y-2">
                  <div
                    className="flex items-center bg-slate-50 px-3 py-2 rounded-xl cursor-pointer"
                    onClick={() => toggleEmp(empId)}
                  >
                    <span className="truncate max-w-[60%] font-medium">{emp.name}</span>
                    <span className="ml-auto flex items-center gap-1 text-sm text-muted-foreground">
                      {formatDatesCount(items.length)}
                      {isCollapsed ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronUp className="h-4 w-4" />
                      )}
                    </span>
                  </div>
                  {!isCollapsed && (
                    <div className="space-y-4 mt-2">
                      {items.map(({ row, index }) => (
                        <EntryRow
                          key={`${row.employee_id}-${row.date}-${index}`}
                          value={row}
                          employee={emp}
                          services={services}
                          getRateForDate={getRateForDate}
                          onChange={(patch) => updateRow(index, patch)}
                          onCopyField={(field) => handleCopy(index, field)}
                          showSummary={false}
                          readOnlyDate
                        />
                      ))}
                    </div>
                  )}
                  <Separator className="my-4" />
                </div>
              );
            })}
          </div>

          <div className="bg-background p-4 border-t flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>בטל</Button>
            <Button onClick={handleSave}>שמור רישומים</Button>
          </div>
        </DialogContent>
      </TooltipProvider>
    </Dialog>
  );
}
