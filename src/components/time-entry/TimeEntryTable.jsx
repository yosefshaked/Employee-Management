import React, { useState, useMemo } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isToday, parseISO } from "date-fns";
import { he } from "date-fns/locale";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import TimeEntryForm from './TimeEntryForm'; // Assuming it's in the same folder

export default function TimeEntryTable({ employees, workSessions, services, getRateForDate, onTableSubmit }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [editingCell, setEditingCell] = useState(null); // Will hold { day, employee }
  const daysInMonth = useMemo(() => {
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);

    return eachDayOfInterval({ start, end });

  }, [currentMonth]);
  const goToPreviousMonth = () => setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  const goToNextMonth = () => setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));

  const monthlyTotals = useMemo(() => {
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);
    const totals = {};

    employees.forEach(emp => {
      totals[emp.id] = { hours: 0, sessions: 0, payment: 0, hasEntry: false };
    });

    workSessions.forEach(s => {
      const sessionDate = parseISO(s.date);
      if (sessionDate >= start && sessionDate <= end && totals[s.employee_id]) {
        const empTotals = totals[s.employee_id];
        empTotals.hasEntry = true;
        empTotals.payment += s.total_payment || 0;
        if (s.entry_type === 'hours') {
          empTotals.hours += s.hours || 0;
        } else {
          empTotals.sessions += s.sessions_count || 0;
        }
      }
    });

    // For global employees, if they have any entry this month, show their monthly rate
    employees.forEach(emp => {
      const empTotals = totals[emp.id];
      if (emp.employee_type === 'global' && empTotals.hasEntry) {
        const { rate } = getRateForDate(emp.id, start);
        empTotals.payment = rate;
      }
    });

    return totals;
  }, [workSessions, employees, currentMonth, getRateForDate]);

  return (
    <> {/* Using a Fragment (<>) instead of a div to avoid extra wrappers */}
        <Card>
        <CardContent className="p-4">
            {/* Header with Month Navigation */}
            <div className="flex justify-between items-center mb-4">
            <Button variant="outline" size="icon" onClick={goToPreviousMonth}><ChevronRight className="w-4 h-4" /></Button>
            <h2 className="text-xl font-bold">{format(currentMonth, 'MMMM yyyy', { locale: he })}</h2>
            <Button variant="outline" size="icon" onClick={goToNextMonth}><ChevronLeft className="w-4 h-4" /></Button>
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
                                let summaryText = '-';
                                let summaryPayment = 0;
                                let rateInfo = null; // Will hold the entire rate object
                                let showNoRateWarning = false;

                                if (emp.employee_type === 'hourly' || emp.employee_type === 'global') {
                                rateInfo = getRateForDate(emp.id, day);
                                } else {
                                showNoRateWarning = dailySessions.some(s => s.rate_used === 0);
                                }

                                if (dailySessions.length > 0) {
                                  if (emp.employee_type === 'instructor') {
                                    summaryPayment = dailySessions.reduce((sum, s) => sum + (s.total_payment || 0), 0);
                                    const sessionCount = dailySessions.reduce((sum, s) => sum + (s.sessions_count || 0), 0);
                                    summaryText = `${sessionCount} מפגשים`;
                                  } else { // Hourly or Global
                                    const hoursCount = dailySessions.reduce((sum, s) => sum + (s.hours || 0), 0);
                                    summaryText = `${hoursCount.toFixed(1)} שעות`;
                                    if (emp.employee_type === 'hourly' && rateInfo?.rate > 0) {
                                      summaryPayment = hoursCount * rateInfo.rate;
                                    }
                                  }
                                }

                                return (
                                    <TableCell
                                        key={emp.id}
                                        className="text-center cursor-pointer hover:bg-blue-50 transition-colors p-2"
                                        onClick={() => setEditingCell({ day, employee: emp, existingSessions: dailySessions })}
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
            {editingCell && (
            <TimeEntryForm
                employee={editingCell.employee}
                services={services}
                initialRows={editingCell.existingSessions}
                selectedDate={editingCell.day}
                getRateForDate={getRateForDate}
                
                onSubmit={(updatedRows) => {
                    onTableSubmit({
                    employee: editingCell.employee,
                    day: editingCell.day,
                    updatedRows,
                    existingSessions: editingCell.existingSessions,
                    });
                    setEditingCell(null);
                }}
            />
            )}
        </DialogContent>
        </Dialog>
    </>
    );
}