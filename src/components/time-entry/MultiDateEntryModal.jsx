import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import EntryRow, { computeRowPayment } from './EntryRow.jsx';
import { copyFromPrevious, formatDatesCount, isRowCompleteForProgress } from './multiDateUtils.js';
import { format } from 'date-fns';
import { useTimeEntry } from './useTimeEntry.js';
import { ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import he from '@/i18n/he.json';
import { calculateGlobalDailyRate, aggregateGlobalDays } from '@/lib/payroll.js';
import { isLeaveEntryType, LEAVE_TYPE_OPTIONS } from '@/lib/leave.js';

function validateRow(row, employee, services, getRateForDate, dayTypeMap) {
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
    const dt = dayTypeMap[employee.id];
    if (dt !== 'regular' && dt !== 'paid_leave') {
      errors.dayType = 'יש לבחור סוג יום';
    } else {
      try {
        calculateGlobalDailyRate(employee, row.date, rate);
      } catch {
        errors.dayType = 'אין ימי עבודה בחודש';
      }
    }
  } else if (isLeaveEntryType(row.entry_type)) {
    errors.entry_type = 'סוג יום לא נתמך';
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

export default function MultiDateEntryModal({ open, onClose, employees, services, selectedEmployees, selectedDates, getRateForDate, onSaved, workSessions = [] }) {
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
          entry_type: emp.employee_type === 'hourly' ? 'hours' : (emp.employee_type === 'instructor' ? 'session' : undefined),
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
  const { saveRows, saveMixedLeave } = useTimeEntry({ employees, services, getRateForDate, workSessions });

  const globalEmployeeIds = useMemo(
    () => selectedEmployees.filter(id => employeesById[id]?.employee_type === 'global'),
    [selectedEmployees, employeesById]
  );
  const shouldForceLeaveMode = globalEmployeeIds.length > 0 && globalEmployeeIds.length === selectedEmployees.length;

  const [mode, setMode] = useState(shouldForceLeaveMode ? 'leave' : 'regular');
  useEffect(() => {
    if (shouldForceLeaveMode && mode !== 'leave') {
      setMode('leave');
    }
  }, [shouldForceLeaveMode, mode]);

  const showModeToggle = !shouldForceLeaveMode;
  const handleModeChange = useCallback((nextMode) => {
    if (shouldForceLeaveMode && nextMode !== 'leave') return;
    setMode(nextMode);
  }, [shouldForceLeaveMode]);
  const leaveTypeOptions = useMemo(
    () => LEAVE_TYPE_OPTIONS.filter(option => option.value === 'mixed'),
    []
  );
  const [selectedLeaveType, setSelectedLeaveType] = useState(
    () => leaveTypeOptions[0]?.value || 'mixed'
  );
  useEffect(() => {
    setSelectedLeaveType(leaveTypeOptions[0]?.value || 'mixed');
  }, [leaveTypeOptions]);

  const sortedDates = useMemo(
    () => [...selectedDates].sort((a, b) => a - b),
    [selectedDates]
  );
  const defaultMixedSelections = useMemo(() => {
    const base = {};
    selectedEmployees.forEach(empId => {
      const inner = {};
      sortedDates.forEach(d => {
        inner[format(d, 'yyyy-MM-dd')] = true;
      });
      base[empId] = inner;
    });
    return base;
  }, [selectedEmployees, sortedDates]);
  const [mixedSelections, setMixedSelections] = useState(defaultMixedSelections);
  useEffect(() => { setMixedSelections(defaultMixedSelections); }, [defaultMixedSelections]);

  const [employeeDayType, setEmployeeDayType] = useState({});
  const [dayTypeErrors, setDayTypeErrors] = useState({});
  const getEmployeeDayType = useCallback((id) => employeeDayType[id] || null, [employeeDayType]);
  const setEmployeeDayTypeWrapper = (id, value) => {
    setEmployeeDayType(prev => ({ ...prev, [id]: value }));
    setDayTypeErrors(prev => ({ ...prev, [id]: false }));
    const firstIdx = rows.findIndex(r => r.employee_id === id);
    if (firstIdx !== -1) {
      setTimeout(() => {
        const el = document.querySelector(`#row-${firstIdx} input[name="hours"]`);
        el?.focus();
      }, 0);
    }
  };

  const validation = useMemo(
    () => rows.map(r => validateRow(r, employeesById[r.employee_id], services, getRateForDate, employeeDayType)),
    [rows, employeesById, services, getRateForDate, employeeDayType]
  );
  const payments = useMemo(
    () => rows.map(r => computeRowPayment(r, employeesById[r.employee_id], services, getRateForDate)),
    [rows, employeesById, services, getRateForDate]
  );
  const globalAgg = useMemo(() => {
    const withPay = rows.map((r, i) => ({
      ...r,
      entry_type: employeesById[r.employee_id].employee_type === 'global'
        ? (getEmployeeDayType(r.employee_id) === 'paid_leave' ? 'paid_leave' : 'hours')
        : r.entry_type,
      total_payment: payments[i]
    }));
    return aggregateGlobalDays(withPay, employeesById);
  }, [rows, payments, employeesById, getEmployeeDayType]);
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
      if (emp.employee_type === 'global') return;
      nonGlobal += payments[i];
    });
    let globalSum = 0;
    globalAgg.forEach(v => { globalSum += v.dailyAmount; });
    return nonGlobal + globalSum;
  }, [rows, payments, employeesById, globalAgg]);
  const filledCount = useMemo(
    () => rows.filter(r => isRowCompleteForProgress(r, employeesById[r.employee_id], employeeDayType)).length,
    [rows, employeesById, employeeDayType]
  );
  const [showErrors, setShowErrors] = useState(false);
  const [showBanner, setShowBanner] = useState(false);
  const [flash, setFlash] = useState(null);

  const formatConflictMessage = useCallback((items = []) => {
    if (!Array.isArray(items) || items.length === 0) return null;
    const lines = items.map(item => {
      const employee = employeesById[item.employeeId] || {};
      const name = item.employeeName || employee.name || '';
      const dateValue = item.date ? new Date(`${item.date}T00:00:00`) : null;
      const formatted = dateValue && !Number.isNaN(dateValue.getTime())
        ? format(dateValue, 'dd/MM/yyyy')
        : (item.date || '');
      return `${name} – ${formatted}`.trim();
    });
    if (!lines.some(Boolean)) return null;
    return `לא ניתן לשמור חופשה עבור התאריכים הבאים:\n${lines.join('\n')}`;
  }, [employeesById]);

  useEffect(() => {
    if (mode === 'leave') {
      setShowBanner(false);
      setShowErrors(false);
    }
  }, [mode]);

  const toggleMixedSelection = (empId, dateStr, paid) => {
    setMixedSelections(prev => {
      const next = { ...prev };
      const current = { ...(next[empId] || {}) };
      current[dateStr] = paid;
      next[empId] = current;
      return next;
    });
  };

  const markAllMixed = (paid) => {
    setMixedSelections(() => {
      const next = {};
      selectedEmployees.forEach(empId => {
        const inner = {};
        sortedDates.forEach(d => {
          inner[format(d, 'yyyy-MM-dd')] = paid;
        });
        next[empId] = inner;
      });
      return next;
    });
  };

  const updateRow = (index, patch) => setRows(prev => prev.map((r, i) => i === index ? { ...r, ...patch } : r));
  const handleCopy = (index, field) => {
    const { rows: updated, success } = copyFromPrevious(rows, index, field);
    setRows(updated);
    if (!success) {
      toast('אין ערך להעתקה');
    } else {
      setFlash({ index, field, ts: Date.now() });
    }
  };

  const removeRow = (index) => {
    setRows(prev => prev.filter((_, i) => i !== index));
    toast.success(he['toast.delete.success']);
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

  const handleRegularSave = async () => {
    const missingId = globalEmployeeIds.find(id => !getEmployeeDayType(id));
    if (missingId) {
      setDayTypeErrors(prev => ({ ...prev, [missingId]: true }));
      const el = document.getElementById(`daytype-${missingId}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.querySelector('button')?.focus();
      return;
    }
    const invalidIndex = validation.findIndex(v => !v.valid);
    if (invalidIndex !== -1) {
      setShowErrors(true);
      setShowBanner(true);
      const el = document.getElementById(`row-${invalidIndex}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    try {
      await saveRows(rows, employeeDayType);
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
      await saveRows(validRows, employeeDayType);
      toast.success(`נשמרו ${validRows.length} / נדחו ${rows.length - validRows.length}`);
      setShowBanner(false);
    } catch (e) {
      toast.error(e.message);
    }
  };

  const handleSaveMixed = async () => {
    if (selectedLeaveType !== 'mixed') {
      toast.error('סוג חופשה לא נתמך');
      return;
    }
    if (!selectedEmployees.length || !sortedDates.length) {
      toast.error('בחרו עובדים ותאריכים לחופשה');
      return;
    }
    const selections = [];
    selectedEmployees.forEach(empId => {
      const map = mixedSelections[empId] || {};
      sortedDates.forEach(d => {
        const dateStr = format(d, 'yyyy-MM-dd');
        const paid = map[dateStr] !== false;
        selections.push({ employee_id: empId, date: dateStr, paid });
      });
    });
    if (!selections.length) {
      toast.error('לא נבחרו תאריכים לחופשה');
      return;
    }
    try {
      const result = await saveMixedLeave(selections, { leaveType: selectedLeaveType });
      if (result?.conflicts?.length) {
        const message = formatConflictMessage(result.conflicts);
        if (message) {
          toast.error(message, { duration: 15000 });
        }
      }
      const insertedCount = Array.isArray(result?.inserted) ? result.inserted.length : 0;
      if (insertedCount > 0) {
        toast.success(`נשמרו ${insertedCount} ימי חופשה`);
        onSaved();
        onClose();
      }
    } catch (e) {
      if (e?.code === 'TIME_ENTRY_LEAVE_CONFLICT' && Array.isArray(e.conflicts)) {
        const message = formatConflictMessage(e.conflicts);
        if (message) {
          toast.error(message, { duration: 15000 });
          return;
        }
      }
      toast.error(e.message);
    }
  };

  const regularSaveDisabled = mode === 'regular' && globalEmployeeIds.some(id => !getEmployeeDayType(id));
  const leaveSaveDisabled = mode === 'leave' && (!selectedEmployees.length || !sortedDates.length);

  return (
      <Dialog open={open} onOpenChange={onClose}>
      <TooltipProvider>
        <DialogContent
          wide
          className="max-w-none w-[98vw] max-w-[1200px] p-0 overflow-hidden"
          style={{ maxHeight: 'none' }}
        >
          <DialogHeader>
            <DialogTitle className="sr-only">הזנה מרובה</DialogTitle>
            <DialogDescription className="sr-only">טופס הזנת רישומים למספר תאריכים</DialogDescription>
          </DialogHeader>
          <div
            data-testid="md-container"
            className="flex flex-col w-full h-[min(92vh,calc(100dvh-2rem))]"
          >
            <div
              data-testid="md-header"
              className="sticky top-0 z-20 bg-background border-b px-4 py-3"
            >
              <div className="flex items-center">
                <div className="text-xl font-semibold ml-auto">הזנה מרובה</div>
                <div className="text-sm text-slate-700 flex gap-2 mr-4">
                  <span>נבחרו {selectedEmployees.length} עובדים</span>
                  <span>{selectedDates.length} תאריכים להזנה</span>
                </div>
              </div>
            </div>

            <div
              className="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-24 space-y-3 relative"
              data-testid="md-body"
            >
              {showModeToggle && (
                <div className="flex items-center justify-between bg-slate-100 rounded-lg ring-1 ring-slate-200 p-1">
                  <Button
                    type="button"
                    variant={mode === 'regular' ? 'default' : 'ghost'}
                    className="flex-1 h-9"
                    onClick={() => handleModeChange('regular')}
                  >
                    רישום שעות
                  </Button>
                  <Button
                    type="button"
                    variant={mode === 'leave' ? 'default' : 'ghost'}
                    className="flex-1 h-9"
                    onClick={() => handleModeChange('leave')}
                  >
                    חופשה
                  </Button>
                </div>
              )}

              {mode === 'regular' ? (
                <>
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
                const dt = getEmployeeDayType(empId);
                const disabled = emp.employee_type === 'global' && !dt;
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
                      <div className="space-y-3 mt-2 relative">
                        {emp.employee_type === 'global' && (
                          <div id={`daytype-${empId}`}>
                            <Label className="text-sm font-medium text-slate-700">סוג יום לעובד זה*</Label>
                            <div className="mt-1 flex rounded-lg overflow-hidden ring-1 ring-slate-200" role="radiogroup">
                              <Button
                                type="button"
                                variant={dt === 'regular' ? 'default' : 'ghost'}
                                className="flex-1 h-10 rounded-none"
                                onClick={() => setEmployeeDayTypeWrapper(empId, 'regular')}
                                aria-label="יום רגיל"
                              >
                                יום רגיל
                              </Button>
                              <Button
                                type="button"
                                variant={dt === 'paid_leave' ? 'default' : 'ghost'}
                                className="flex-1 h-10 rounded-none"
                                onClick={() => setEmployeeDayTypeWrapper(empId, 'paid_leave')}
                                aria-label="חופשה בתשלום"
                              >
                                חופשה בתשלום
                              </Button>
                            </div>
                            {dayTypeErrors[empId] && <p className="text-sm text-red-600">יש לבחור סוג יום</p>}
                            <p className="text-sm text-slate-600 mt-1">שכר גלובלי נספר לפי יום; הוספת מקטע שעות לא מכפילה שכר.</p>
                          </div>
                        )}
                        <div className="relative">
                          {disabled && (
                            <div className="absolute inset-0 bg-white/70 z-10 pointer-events-none"></div>
                          )}
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
                                hideDayType={emp.employee_type === 'global'}
                                allowRemove
                                onRemove={() => removeRow(index)}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                    {idx !== groupedRows.length - 1 && <Separator className="my-4" />}
                  </div>
                );
              })}
                </>
              ) : (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
                    <div className="space-y-1">
                      <Label className="text-sm font-medium text-slate-700">סוג חופשה</Label>
                      <Select value={selectedLeaveType} onValueChange={setSelectedLeaveType}>
                        <SelectTrigger className="bg-white h-10 text-base leading-6">
                          <SelectValue placeholder="בחר סוג חופשה" />
                        </SelectTrigger>
                        <SelectContent>
                          {leaveTypeOptions.map(option => (
                            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" className="flex-1" onClick={() => markAllMixed(true)}>סמן הכל כבתשלום</Button>
                      <Button type="button" variant="outline" className="flex-1" onClick={() => markAllMixed(false)}>סמן הכל כלא בתשלום</Button>
                    </div>
                  </div>
                  <div className="space-y-4">
                    {selectedEmployees.length === 0 && (
                      <div className="text-sm text-slate-600">בחרו לפחות עובד אחד להזנת חופשה.</div>
                    )}
                    {selectedEmployees.map(empId => {
                      const emp = employeesById[empId];
                      const map = mixedSelections[empId] || {};
                      return (
                        <div key={empId} className="space-y-3 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 p-4">
                          <div className="flex items-center justify-between">
                            <span className="text-[17px] font-semibold truncate max-w-[60%]">{emp?.name || 'עובד'}</span>
                            <span className="text-sm text-slate-600">{formatDatesCount(sortedDates.length)}</span>
                          </div>
                          <div className="space-y-2">
                            <div className="text-sm font-medium text-slate-700">תאריכים שנבחרו</div>
                            <div className="space-y-2">
                              {sortedDates.length === 0 && (
                                <div className="text-sm text-slate-600">בחרו תאריכים להזנת חופשה.</div>
                              )}
                              {sortedDates.map(d => {
                                const dateStr = format(d, 'yyyy-MM-dd');
                                const paid = map[dateStr] !== false;
                                return (
                                  <div
                                    key={`${empId}-${dateStr}`}
                                    className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200"
                                  >
                                    <span className="text-sm font-medium text-slate-700">{format(d, 'dd/MM/yyyy')}</span>
                                    <div className="flex gap-2" role="radiogroup" aria-label={`האם ${format(d, 'dd/MM/yyyy')} בתשלום?`}>
                                      <Button
                                        type="button"
                                        variant={paid ? 'default' : 'ghost'}
                                        className="h-9"
                                        onClick={() => toggleMixedSelection(empId, dateStr, true)}
                                      >
                                        בתשלום
                                      </Button>
                                      <Button
                                        type="button"
                                        variant={!paid ? 'default' : 'ghost'}
                                        className="h-9"
                                        onClick={() => toggleMixedSelection(empId, dateStr, false)}
                                      >
                                        לא בתשלום
                                      </Button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div
              data-testid="md-footer"
              className="shrink-0 bg-background border-t px-4 py-3 flex justify-end gap-2"
            >
              <Button variant="outline" onClick={onClose}>בטל</Button>
              <Button
                onClick={mode === 'leave' ? handleSaveMixed : handleRegularSave}
                disabled={regularSaveDisabled || leaveSaveDisabled}
              >
                שמור רישומים
              </Button>
            </div>
          </div>
        </DialogContent>
      </TooltipProvider>
    </Dialog>
  );
}
