import React, { useState, useMemo } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isToday, parseISO } from 'date-fns';
import { he } from 'date-fns/locale';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import TimeEntryForm from './TimeEntryForm';
import ImportModal from '@/components/import/ImportModal.jsx';
import EmployeePicker from '../employees/EmployeePicker.jsx';
import MultiDateEntryModal from './MultiDateEntryModal.jsx';
import { aggregateGlobalDays } from '@/lib/payroll.js';
function TimeEntryTableInner({ employees, workSessions, services, getRateForDate, onTableSubmit, onImported }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [editingCell, setEditingCell] = useState(null); // Will hold { day, employee }
  const [tab, setTab] = useState('add');
  const [multiMode, setMultiMode] = useState(false);
  const [selectedDates, setSelectedDates] = useState([]);
  const [selectedEmployees, setSelectedEmployees] = useState(employees.map(e => e.id));
  const [importOpen, setImportOpen] = useState(false);
  const [multiModalOpen, setMultiModalOpen] = useState(false);
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
    setMultiMode(false);
  }, [currentMonth, employees]);

  React.useEffect(() => {
    if (editingCell) {
      setTab(editingCell.existingSessions.length ? 'edit' : 'add');
    }
  }, [editingCell]);

  const monthlyTotals = useMemo(() => {
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);
    const totals = {};
    const employeesById = Object.fromEntries(employees.map(e => [e.id, e]));
    employees.forEach(emp => {
      totals[emp.id] = { hours: 0, sessions: 0, payment: 0 };
    });
    const globalAgg = aggregateGlobalDays(
      workSessions.filter(s => {
        const d = parseISO(s.date);
        return d >= start && d <= end;
      }),
      employeesById
    );
    workSessions.forEach(s => {
      const sessionDate = parseISO(s.date);
      if (sessionDate < start || sessionDate > end) return;
      const emp = employeesById[s.employee_id];
      const empTotals = totals[s.employee_id];
      if (!empTotals || !emp) return;
      if (s.entry_type === 'adjustment') {
        empTotals.payment += s.total_payment || 0;
        return;
      }
      if (emp.employee_type === 'global' && (s.entry_type === 'hours' || s.entry_type === 'paid_leave')) {
        // payment handled via aggregation
      } else {
        empTotals.payment += s.total_payment || 0;
      }
      if (s.entry_type === 'session') {
        empTotals.sessions += s.sessions_count || 0;
      } else if (s.entry_type === 'hours') {
        empTotals.hours += s.hours || 0;
      }
    });
    globalAgg.forEach((v, key) => {
      const [empId] = key.split('|');
      const empTotals = totals[empId];
      if (empTotals) empTotals.payment += v.dailyAmount;
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
    setMultiModalOpen(true);
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
                }}>בחר תאריכים להזנה מרובה</Button>
              ) : (
                <>
                  <EmployeePicker employees={employees} value={selectedEmployees} onChange={setSelectedEmployees} />
                  <Button variant="default" onClick={startMultiEntry} disabled={!selectedDates.length || !selectedEmployees.length}>הזן</Button>
                  <Button variant="outline" onClick={() => { setMultiMode(false); setSelectedDates([]); setSelectedEmployees(employees.map(e => e.id)); }}>בטל</Button>
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
                                let extraInfo = '';
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
                                    const hoursCount = regularSessions.reduce((sum, s) => sum + (s.hours || 0), 0);
                                    summaryPayment = regularSessions.reduce((sum, s) => sum + (s.total_payment || 0), 0);
                                    summaryText = summaryPayment > 0 ? `₪${summaryPayment.toLocaleString()}` : '-';
                                    extraInfo = hoursCount > 0 ? `שעות ${hoursCount.toFixed(1)}` : '';
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
                                        {extraInfo && (
                                          <div className="text-xs text-slate-500">{extraInfo}</div>
                                        )}

                {/* --- WARNINGS --- */}
                                        {rateInfo?.reason === 'לא התחילו לעבוד עדיין' && (
                                          <div className="text-xs text-red-700">טרם התחיל</div>
                                        )}

                                        {showNoRateWarning && summaryText !== '-' && (
                                          <div className="text-xs text-red-700">לא הוגדר תעריף</div>
                                        )}

                                        {summaryPayment > 0 && emp.employee_type !== 'global' && (
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
        <DialogContent wide className="max-w-none w-[98vw] max-w-[1100px] p-0 overflow-hidden">
          {editingCell && (
            <Tabs
              value={tab}
              onValueChange={setTab}
              defaultValue={editingCell.existingSessions.length ? 'edit' : 'add'}
            >
              <div
                data-testid="day-modal-container"
                className="flex flex-col w-[min(98vw,1100px)] max-w-[98vw] h-[min(92vh,calc(100dvh-2rem))]"
              >
                <div
                  data-testid="day-modal-header"
                  className="sticky top-0 z-20 bg-background border-b px-4 py-3"
                >
                  <DialogHeader className="p-0">
                    <DialogTitle>
                      רישום עבור: {editingCell.employee.name} | {format(editingCell.day, 'dd/MM/yyyy', { locale: he })}
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                      הזן או ערוך את פרטי שעות העבודה או המפגשים עבור היום הנבחר.
                    </DialogDescription>
                  </DialogHeader>
                  <TabsList className="grid w-full grid-cols-2 mt-2">
                    <TabsTrigger value="add">הוספת רישום חדש</TabsTrigger>
                    <TabsTrigger value="edit" disabled={!editingCell.existingSessions.length}>עריכת רישומים קיימים</TabsTrigger>
                  </TabsList>
                </div>
                <div
                  data-testid="day-modal-body"
                  className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3"
                >
                  <TabsContent value="add">
                    <TimeEntryForm
                      employee={editingCell.employee}
                      services={services}
                      selectedDate={format(editingCell.day, 'yyyy-MM-dd')}
                      getRateForDate={getRateForDate}
                      hideSubmitButton
                      formId="add-entry-form"
                      onSubmit={(updatedRows) => {
                        onTableSubmit({ employee: editingCell.employee, day: editingCell.day, updatedRows });
                        setEditingCell(null);
                      }}
                    />
                  </TabsContent>
                  <TabsContent value="edit">
                    <TimeEntryForm
                      employee={editingCell.employee}
                      services={services}
                      initialRows={editingCell.existingSessions}
                      selectedDate={format(editingCell.day, 'yyyy-MM-dd')}
                      getRateForDate={getRateForDate}
                      allowAddRow={false}
                      hideSubmitButton
                      formId="edit-entry-form"
                      onSubmit={(updatedRows) => {
                        onTableSubmit({ employee: editingCell.employee, day: editingCell.day, updatedRows });
                        setEditingCell(null);
                      }}
                    />
                  </TabsContent>
                </div>
                <div
                  data-testid="day-modal-footer"
                  className="shrink-0 bg-background border-t px-4 py-3 flex justify-between gap-2"
                >
                  <Button variant="outline" type="button" onClick={() => setEditingCell(null)}>בטל</Button>
                  <Button type="submit" form={tab === 'edit' ? 'edit-entry-form' : 'add-entry-form'} className="bg-gradient-to-r from-green-500 to-blue-500 text-white">שמור רישומים</Button>
                </div>
              </div>
            </Tabs>
          )}
        </DialogContent>
        </Dialog>
        <ImportModal
          open={importOpen}
          onOpenChange={setImportOpen}
          employees={employees}
          services={services}
          getRateForDate={getRateForDate}
          onImported={onImported}
        />
        <MultiDateEntryModal
          open={multiModalOpen}
          onClose={() => setMultiModalOpen(false)}
          employees={employees}
          services={services}
          selectedEmployees={selectedEmployees}
          selectedDates={selectedDates}
          getRateForDate={getRateForDate}
          onSaved={() => {
            onImported();
            setSelectedDates([]);
            setSelectedEmployees(employees.map(e => e.id));
            setMultiMode(false);
            setMultiModalOpen(false);
          }}
        />
    </>
    );
}

export default function TimeEntryTable(props) {
  return <TimeEntryTableInner {...props} />;
}