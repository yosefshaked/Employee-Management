import React, { useState, useMemo } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isToday, parseISO } from "date-fns";
import { he } from "date-fns/locale";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import TimeEntryForm from './TimeEntryForm'; // Assuming it's in the same folder
import CsvImportModal from '@/components/import/ImportCsvModal.jsx';
import EmployeePicker from '../employees/EmployeePicker.jsx';
import { MultiDateProvider, useMultiDate } from './MultiDateContext.jsx';
function TimeEntryTableInner({ employees, workSessions, services, getRateForDate, onTableSubmit, onImported }) {
  const { isMultiDateMode, setIsMultiDateMode, lastRows, setLastRows } = useMultiDate();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [editingCell, setEditingCell] = useState(null); // Will hold { day, employee }
  const [multiMode, setMultiMode] = useState(false);
  const [selectedDates, setSelectedDates] = useState([]);
  const [selectedEmployees, setSelectedEmployees] = useState(employees.map(e => e.id));
  const [multiQueue, setMultiQueue] = useState([]);
  const [importOpen, setImportOpen] = useState(false);
  const daysInMonth = useMemo(() => {
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);

    return eachDayOfInterval({ start, end });

  }, [currentMonth]);
  const goToPreviousMonth = () => setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  const goToNextMonth = () => setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));

  // Clear selections when month changes
  React.useEffect(() => {
    setSelectedDates([]);
    setSelectedEmployees(employees.map(e => e.id));
    setMultiQueue([]);
    setMultiMode(false);
    setIsMultiDateMode(false);
  }, [currentMonth, employees, setIsMultiDateMode]);

  const monthlyTotals = useMemo(() => {
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);
    const totals = {};

    employees.forEach(emp => {
      totals[emp.id] = { hours: 0, sessions: 0, payment: 0 };
    });

    workSessions.forEach(s => {
      const sessionDate = parseISO(s.date);
      if (sessionDate < start || sessionDate > end) return;
      const empTotals = totals[s.employee_id];
      if (!empTotals) return;
      if (s.entry_type === 'adjustment') {
        empTotals.payment += s.total_payment || 0;
        return;
      }
      empTotals.payment += s.total_payment || 0;
      if (s.entry_type === 'session') {
        empTotals.sessions += s.sessions_count || 0;
      } else if (s.entry_type === 'hours') {
        empTotals.hours += s.hours || 0;
      }
    });

    return totals;
  }, [workSessions, employees, currentMonth]);

  const toggleDateSelection = (day) => {
    setSelectedDates(prev => {
      const exists = prev.find(d => d.getTime() === day.getTime());
      return exists ? prev.filter(d => d.getTime() !== day.getTime()) : [...prev, day];
    });
  };

  const startMultiEntry = () => {
    if (!selectedDates.length || !selectedEmployees.length) return;
    const dateQueue = [...selectedDates].sort((a, b) => a - b);
    const empQueue = employees.filter(e => selectedEmployees.includes(e.id));
    const queue = [];
    dateQueue.forEach(day => {
      empQueue.forEach(emp => queue.push({ day, employee: emp }));
    });
    setMultiQueue(queue);
    setIsMultiDateMode(queue.length > 1);
    const first = queue[0];
    setEditingCell({ day: first.day, employee: first.employee, existingSessions: [] });
  };

  const handleMultiSubmit = ({ employee, day, updatedRows }) => {
    onTableSubmit({ employee, day, updatedRows });
    const [, ...rest] = multiQueue;
    setLastRows(updatedRows);
    if (rest.length) {
      const next = rest[0];
      let nextRows = [];
      if (isMultiDateMode && window.confirm('להעתיק את מה שהזנת הרגע?')) {
        nextRows = updatedRows.map(r => ({ ...r, id: crypto.randomUUID(), isNew: true, date: format(next.day, 'yyyy-MM-dd') }));
      }
      setMultiQueue(rest);
      setEditingCell({ day: next.day, employee: next.employee, existingSessions: nextRows });
    } else {
      setEditingCell(null);
      setMultiQueue([]);
      setSelectedDates([]);
      setSelectedEmployees(employees.map(e => e.id));
      setMultiMode(false);
      setIsMultiDateMode(false);
      setLastRows([]);
    }
  };

  return (
    <> {/* Using a Fragment (<>) instead of a div to avoid extra wrappers */}
        <Card>
        <CardContent className="p-4">
            {/* Header with Month Navigation */}
            <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={goToPreviousMonth}><ChevronRight className="w-4 h-4" /></Button>
              <h2 className="text-xl font-bold">{format(currentMonth, 'MMMM yyyy', { locale: he })}</h2>
              <Button variant="outline" size="icon" onClick={goToNextMonth}><ChevronLeft className="w-4 h-4" /></Button>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setImportOpen(true)}>ייבוא CSV</Button>
              {!multiMode ? (
                <Button variant="outline" onClick={() => {
                  setMultiMode(true);
                  setSelectedDates([]);
                  setSelectedEmployees(employees.map(e => e.id));
                  setIsMultiDateMode(false);
                }}>בחר תאריכים להזנה מרובה</Button>
              ) : (
                <>
                  <EmployeePicker employees={employees} value={selectedEmployees} onChange={setSelectedEmployees} />
                  <Button variant="default" onClick={startMultiEntry} disabled={!selectedDates.length || !selectedEmployees.length}>הזן</Button>
                  <Button variant="outline" onClick={() => { setMultiMode(false); setSelectedDates([]); setSelectedEmployees(employees.map(e => e.id)); setIsMultiDateMode(false); }}>בטל</Button>
                </>
              )}
            </div>
            </div>

            {/* Table */}
                <div className="overflow-auto border rounded-lg max-h-[65vh]"> 
                    <Table className="min-w-full">
                        <TableHeader className="sticky top-0 z-20">
                        <TableRow>
                            <TableHead className="sticky w-24 text-right right-0 bg-slate-100 z-20 shadow-sm">תאריך</TableHead>
                            {/* Headers display each employee with current rate info */}
                            {employees.map(emp => {
                            const headerRateInfo = (emp.employee_type === 'hourly' || emp.employee_type === 'global')
                              ? getRateForDate(emp.id, currentMonth)
                              : null;
                            return (
                              <TableHead key={emp.id} className="top-0 text-center z-20 min-w-[140px] p-2 bg-slate-50 shadow-sm">
                                <div className="flex flex-col items-center">
                                  <span>{emp.name}</span>
                                  {headerRateInfo && (
                                    headerRateInfo.rate > 0 ? (
                                      <>
                                        <span className="text-xs text-green-700">
                                          {emp.employee_type === 'hourly'
                                            ? `₪${headerRateInfo.rate.toFixed(2)}`
                                            : `₪${headerRateInfo.rate.toLocaleString()} לחודש`}
                                        </span>
                                        <span className="text-[10px] text-slate-500">
                                          {`מ-${format(parseISO(headerRateInfo.effectiveDate), 'dd/MM/yy')}`}
                                        </span>
                                      </>
                                    ) : headerRateInfo.reason === 'לא התחילו לעבוד עדיין' ? (
                                      <span className="text-xs text-red-700">טרם התחיל</span>
                                    ) : null
                                  )}
                                </div>
                              </TableHead>
                            );
                            })}
                        </TableRow>
                        </TableHeader>
                        <TableBody>

                        {/* Loop through each day of the month to create a row */}
                        {daysInMonth.map(day => (
                            <TableRow key={day.toISOString()}>
                            <TableCell className={`text-right font-semibold sticky right-0 z-10 p-2 ${isToday(day) ? 'bg-blue-100' : 'bg-slate-50'}`}>
                                <div className="flex items-center justify-end gap-2">
                                {multiMode && (
                                  <input type="checkbox" checked={selectedDates.some(d => d.getTime() === day.getTime())} onChange={() => toggleDateSelection(day)} />
                                )}
                                <span>{format(day, 'd')}</span>
                                <span className="text-xs text-slate-500">{format(day, 'EEE', { locale: he })}</span>
                                </div>
                            </TableCell>

                            {/* For each day, loop through employees to create a cell */}
                            {employees.map(emp => {
                                const dailySessions = workSessions.filter(s =>
                                s.employee_id === emp.id &&
                                format(parseISO(s.date), 'yyyy-MM-dd') === format(day, 'yyyy-MM-dd')
                                );
                                const adjustments = dailySessions.filter(s =>
                                  s.entry_type === 'adjustment'
                                );
                                const regularSessions = dailySessions.filter(s =>
                                  s.entry_type !== 'adjustment'
                                );
                                const adjustmentTotal = adjustments.reduce((sum, s) => sum + (s.total_payment || 0), 0);

                                let summaryText = '-';
                                let summaryPayment = 0;
                                const rateInfo = getRateForDate(emp.id, day);
                                const showNoRateWarning = regularSessions.some(s => s.rate_used === 0);

                                if (regularSessions.length > 0) {
                                  if (emp.employee_type === 'instructor') {
                                    summaryPayment = regularSessions.reduce((sum, s) => sum + (s.total_payment || 0), 0);
                                    const sessionCount = regularSessions.reduce((sum, s) => sum + (s.sessions_count || 0), 0);
                                    summaryText = `${sessionCount} מפגשים`;
                                  } else if (emp.employee_type === 'hourly') {
                                    const hoursCount = regularSessions.reduce((sum, s) => sum + (s.hours || 0), 0);
                                    summaryText = `${hoursCount.toFixed(1)} שעות`;
                                    summaryPayment = regularSessions.reduce((sum, s) => sum + (s.total_payment || 0), 0);
                                  } else {
                                    const paidLeaveCount = regularSessions.filter(s => s.entry_type === 'paid_leave').length;
                                    const dayCount = regularSessions.filter(s => s.entry_type === 'hours').length;
                                    const parts = [];
                                    if (dayCount > 0) parts.push(`${dayCount} ימים`);
                                    if (paidLeaveCount > 0) parts.push(`${paidLeaveCount} חופש`);
                                    summaryText = parts.join(' + ') || '-';
                                    summaryPayment = regularSessions.reduce((sum, s) => sum + (s.total_payment || 0), 0);
                                  }
                                }

                                const isSelected = multiMode && selectedDates.some(d => d.getTime() === day.getTime()) && selectedEmployees.includes(emp.id);

                                return (
                                    <TableCell
                                        key={emp.id}
                                        className={`text-center transition-colors p-2 ${isSelected ? 'bg-blue-50' : ''} ${multiMode ? '' : 'cursor-pointer hover:bg-blue-50'}`}
                                        onClick={() => {
                                          if (!multiMode) {
                                            setEditingCell({ day, employee: emp, existingSessions: regularSessions });
                                          }
                                        }}
                                    >
                                        <div className="font-semibold text-sm">{summaryText}</div>

                {/* --- WARNINGS --- */}
                                        {rateInfo?.reason === 'לא התחילו לעבוד עדיין' && (
                                          <div className="text-xs text-red-700">טרם התחיל</div>
                                        )}

                                        {showNoRateWarning && summaryText !== '-' && (
                                          <div className="text-xs text-red-700">לא הוגדר תעריף</div>
                                        )}

                                        {summaryPayment > 0 && (
                                          <div className="text-xs text-green-700">₪{summaryPayment.toLocaleString()}</div>
                                        )}

                                        {adjustmentTotal !== 0 && (
                                          <div className={`text-xs ${adjustmentTotal > 0 ? 'text-green-700' : 'text-red-700'}`}> 
                                            {adjustmentTotal > 0 ? '+' : '-'}₪{Math.abs(adjustmentTotal).toLocaleString()}
                                          </div>
                                        )}
                                    </TableCell>
                                    );
                            })}
                            </TableRow>
                        ))}

                        {/* Totals Rows */}
                        <TableRow className="bg-slate-100 font-medium">
                          <TableCell className="text-right sticky right-0 bg-slate-100">סה"כ שיעורים/שעות</TableCell>
                          {employees.map(emp => {
                            const totals = monthlyTotals[emp.id] || { hours: 0, sessions: 0 };
                            const value = emp.employee_type === 'instructor'
                              ? `${totals.sessions} מפגשים`
                              : `${totals.hours.toFixed(1)} שעות`;
                            return (
                              <TableCell key={emp.id} className="text-center">
                                {value}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                        <TableRow className="bg-slate-100 font-medium">
                          <TableCell className="text-right sticky right-0 bg-slate-100">סה"כ צפי לתשלום</TableCell>
                          {employees.map(emp => {
                            const totals = monthlyTotals[emp.id] || { payment: 0 };
                            return (
                              <TableCell key={emp.id} className="text-center text-green-700">
                                ₪{totals.payment.toLocaleString()}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                        </TableBody>
                    </Table>
                </div>

        </CardContent>
        </Card>
        {/* The Dialog for editing/adding entries */}
        <Dialog open={!!editingCell} onOpenChange={(isOpen) => !isOpen && setEditingCell(null)}>
        <DialogContent className="max-w-3xl">
            <DialogHeader>
            <DialogTitle>
                רישום עבור: {editingCell?.employee.name} | {editingCell && format(editingCell.day, 'dd/MM/yyyy', { locale: he })}
            </DialogTitle>
            <DialogDescription className="sr-only">
              הזן או ערוך את פרטי שעות העבודה או המפגשים עבור היום הנבחר.
            </DialogDescription>
            </DialogHeader>
            {isMultiDateMode && (
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm text-slate-600">
                  {selectedDates.sort((a,b) => a - b).map(d => format(d, 'dd/MM')).join(', ')}
                </div>
                {lastRows.length > 0 && (
                  <Button variant="outline" size="sm" onClick={() => {
                    const copyRows = lastRows.map(r => ({ ...r, id: crypto.randomUUID(), isNew: true, date: format(editingCell.day, 'yyyy-MM-dd') }));
                    setEditingCell(prev => ({ ...prev, existingSessions: copyRows }));
                  }}>העתק מהתאריך הקודם</Button>
                )}
              </div>
            )}
            {editingCell && (
              <Tabs defaultValue={editingCell.existingSessions.length ? 'edit' : 'add'}>
                <TabsList className="grid w-full grid-cols-2 mb-4">
                  <TabsTrigger value="add">הוספת רישום חדש</TabsTrigger>
                  <TabsTrigger value="edit" disabled={!editingCell.existingSessions.length}>עריכת רישומים קיימים</TabsTrigger>
                </TabsList>
                <TabsContent value="add">
                  <TimeEntryForm
                    employee={editingCell.employee}
                    services={services}
                    selectedDate={editingCell.day}
                    getRateForDate={getRateForDate}
                    onSubmit={(updatedRows) => {
                      if (multiQueue.length) {
                        handleMultiSubmit({ employee: editingCell.employee, day: editingCell.day, updatedRows });
                      } else {
                        onTableSubmit({ employee: editingCell.employee, day: editingCell.day, updatedRows });
                        setEditingCell(null);
                      }
                    }}
                  />
                </TabsContent>
                <TabsContent value="edit">
                  <TimeEntryForm
                    employee={editingCell.employee}
                    services={services}
                    initialRows={editingCell.existingSessions}
                    selectedDate={editingCell.day}
                    getRateForDate={getRateForDate}
                    allowAddRow={false}
                    onSubmit={(updatedRows) => {
                      if (multiQueue.length) {
                        handleMultiSubmit({ employee: editingCell.employee, day: editingCell.day, updatedRows });
                      } else {
                        onTableSubmit({ employee: editingCell.employee, day: editingCell.day, updatedRows });
                        setEditingCell(null);
                      }
                    }}
                  />
                </TabsContent>
              </Tabs>
            )}
        </DialogContent>
        </Dialog>
        <CsvImportModal
          open={importOpen}
          onOpenChange={setImportOpen}
          employees={employees}
          services={services}
          getRateForDate={getRateForDate}
          onImported={onImported}
        />
    </>
    );
}

export default function TimeEntryTable(props) {
  return (
    <MultiDateProvider>
      <TimeEntryTableInner {...props} />
    </MultiDateProvider>
  );
}