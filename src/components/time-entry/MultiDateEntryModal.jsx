import React, { useMemo, useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import EntryRow, { computeRowPayment } from './EntryRow.jsx';
import { copyFromPrevious, formatDatesCount, isRowCompleteForProgress } from './multiDateUtils.js';
import { format } from 'date-fns';
import { useTimeEntry } from './useTimeEntry.js';
import { ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { calculateGlobalDailyRate, aggregateGlobalDays } from '@/lib/payroll.js';

function validateRow(row, employee, services, getRateForDate) {
  const errors = {};
  if (!row.date) errors.date = 'חסר תאריך';
  const isHourlyOrGlobal = employee.employee_type === 'hourly' || employee.employee_type === 'global';
  const { rate } = getRateForDate(employee.id, row.date, isHourlyOrGlobal ? null : row.service_id);
  if (!rate) errors.entry_type = 'אין תעריף';
  if (employee.employee_type === 'instructor') {
    if (!row.service_id) errors.service_id = 'חסר שירות';
    if (!row.sessions_count) errors.sessions_count = 'חסר מספר מפגשים';
    const service = services.find(s => s.id === row.service_id);
    if (service && service.payment_model === 'per_student' && !row.students_count) {
      errors.students_count = 'חסר מספר תלמידים';
    }
  } else if (employee.employee_type === 'hourly') {
    if (!row.hours) errors.hours = 'חסרות שעות';
  } else if (employee.employee_type === 'global') {
    if (row.entry_type !== 'hours' && row.entry_type !== 'paid_leave') {
      errors.entry_type = 'בחר סוג יום';
    } else {
      try {
        calculateGlobalDailyRate(employee, row.date, rate);
      } catch {
        errors.entry_type = 'אין ימי עבודה בחודש';
      }
    }
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

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
          entry_type: emp.employee_type === 'global' ? '' : (emp.employee_type === 'hourly' ? 'hours' : 'session'),
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

  const validation = useMemo(
    () => rows.map(r => validateRow(r, employeesById[r.employee_id], services, getRateForDate)),
    [rows, employeesById, services, getRateForDate]
  );
  const payments = useMemo(() => rows.map(r => computeRowPayment(r, employeesById[r.employee_id], services, getRateForDate)), [rows, employeesById, services, getRateForDate]);
  const globalAgg = useMemo(() => {
    const withPay = rows.map((r, i) => ({ ...r, total_payment: payments[i] }));
    return aggregateGlobalDays(withPay, employeesById);
  }, [rows, payments, employeesById]);
  const duplicateMap = useMemo(() => {
    const map = {};
    globalAgg.forEach(val => {
      val.indices.forEach((idx, i) => { map[idx] = i > 0; });
    });
    return map;
  }, [globalAgg]);
  const summaryTotal = useMemo(() => {
    let nonGlobal = 0;
    rows.forEach((r, i) => {
      const emp = employeesById[r.employee_id];
      if (emp.employee_type === 'global' && (r.entry_type === 'hours' || r.entry_type === 'paid_leave')) return;
      nonGlobal += payments[i];
    });
    let globalSum = 0;
    globalAgg.forEach(v => { globalSum += v.dailyAmount; });
    return nonGlobal + globalSum;
  }, [rows, payments, employeesById, globalAgg]);
  const filledCount = useMemo(
    () => rows.filter(r => isRowCompleteForProgress(r, employeesById[r.employee_id])).length,
    [rows, employeesById]
  );
  const [showErrors, setShowErrors] = useState(false);
  const [showBanner, setShowBanner] = useState(false);
  const [flash, setFlash] = useState(null);

  const updateRow = (index, patch) => setRows(prev => prev.map((r, i) => i === index ? { ...r, ...patch } : r));
  const handleCopy = (index, field) => {
    const { rows: updated, success } = copyFromPrevious(rows, index, field);
    setRows(updated);
    if (!success) {
      toast(field === 'dayType' ? 'אין ערך סוג יום להעתקה' : 'אין ערך להעתקה');
    } else {
      const flashField = field === 'dayType' ? 'entry_type' : field;
      setFlash({ index, field: flashField, ts: Date.now() });
    }
  };

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
    const invalidIndex = validation.findIndex(v => !v.valid);
    if (invalidIndex !== -1) {
      setShowErrors(true);
      setShowBanner(true);
      const el = document.getElementById(`row-${invalidIndex}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    try {
      await saveRows(rows);
      toast.success(`נשמרו ${rows.length}`);
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const saveValidOnly = async () => {
    const validRows = rows.filter((_, i) => validation[i].valid);
    try {
      await saveRows(validRows);
      toast.success(`נשמרו ${validRows.length} / נדחו ${rows.length - validRows.length}`);
      setShowBanner(false);
    } catch (e) {
      toast.error(e.message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <TooltipProvider>
        <DialogContent
          wide
          className="max-w-none w-[98vw] max-w-[1200px] p-0 overflow-hidden"
          style={{ maxHeight: 'none' }}
        >
          <div
            data-testid="md-container"
            className="flex flex-col w-full h-[min(92vh,calc(100dvh-2rem))]"
          >
            <div
              data-testid="md-header"
              className="sticky top-0 z-20 bg-background border-b px-4 py-3"
            >
              <DialogTitle>הזנה מרובה</DialogTitle>
            </div>

            <div
              className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3"
              data-testid="md-body"
            >
              <div className="flex text-sm text-slate-600">
                <span>טיפ: אפשר להעתיק ערכים מהרישום הקודם עם האייקון ליד כל שדה.</span>
              <span className="ml-auto">מולאו {filledCount} מתוך {rows.length} שורות</span>
            </div>
            <div className="text-right font-medium text-slate-700">סיכום כולל לרישומים: ₪{summaryTotal.toFixed(2)}</div>
            {showBanner && (
                <div className="bg-amber-50 border border-amber-200 p-4 flex justify-between items-center text-sm">
                  <span>חלק מהשורות מכילות שגיאות.</span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setShowBanner(false)}>חזור לתיקון</Button>
                    <Button size="sm" onClick={saveValidOnly}>שמור רק תקינים</Button>
                  </div>
                </div>
              )}
              {groupedRows.map(([empId, items], idx) => {
                const emp = employeesById[empId];
                const isCollapsed = collapsed[empId];
                return (
                  <div key={empId} className="space-y-3">
                    <div
                      className="flex items-center bg-slate-100 px-3 py-2 rounded-xl ring-1 ring-slate-200 cursor-pointer"
                      onClick={() => toggleEmp(empId)}
                    >
                      <span className="truncate max-w-[60%] text-[17px] font-semibold">{emp.name}</span>
                      <span className="ml-auto text-sm text-slate-600">{formatDatesCount(items.length)}</span>
                      <ChevronUp className={`h-4 w-4 mr-1 transition-transform ${isCollapsed ? 'rotate-180' : ''}`} />
                    </div>
                    {!isCollapsed && (
                      <div className="flex flex-col gap-3 mt-2">
                        {items.map(({ row, index }) => (
                          <EntryRow
                            key={`${row.employee_id}-${row.date}-${index}`}
                            value={row}
                            employee={emp}
                            services={services}
                            getRateForDate={getRateForDate}
                            onChange={(patch) => updateRow(index, patch)}
                            onCopyField={(field) => handleCopy(index, field)}
                            showSummary={true}
                            readOnlyDate
                            rowId={`row-${index}`}
                            flashField={flash && flash.index === index ? flash.field : null}
                            errors={showErrors ? validation[index].errors : {}}
                            isDuplicate={!!duplicateMap[index]}
                          />
                        ))}
                      </div>
                    )}
                    {idx !== groupedRows.length - 1 && <Separator className="my-4" />}
                  </div>
                );
              })}
            </div>

            <div
              data-testid="md-footer"
              className="shrink-0 bg-background border-t px-4 py-3 flex justify-end gap-2"
            >
              <Button variant="outline" onClick={onClose}>בטל</Button>
              <Button onClick={handleSave}>שמור רישומים</Button>
            </div>
          </div>
        </DialogContent>
      </TooltipProvider>
    </Dialog>
  );
}
