import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, TrendingUp } from "lucide-react";
import { format, parseISO, startOfMonth, endOfMonth, eachMonthOfInterval } from "date-fns";
import { he } from "date-fns/locale";

export default function MonthlyReport({ sessions, employees, services, workSessions = [], getRateForDate, scopedEmployeeIds, dateFrom, dateTo, isLoading }) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array(6).fill(0).map((_, i) => <Skeleton key={i} className="h-40" />)}
      </div>
    );
  }

  const getEmployeeName = (employeeId) => employees.find(emp => emp.id === employeeId)?.name || 'לא ידוע';
  
  const months = eachMonthOfInterval({
    start: startOfMonth(parseISO(dateFrom)),
    end: endOfMonth(parseISO(dateTo))
  });

  const monthlyData = months.map(month => {
    const monthStart = startOfMonth(month);
    const monthEnd = endOfMonth(month);
    const monthSessions = sessions.filter(session => {
      const sessionDate = parseISO(session.date);
      if (sessionDate < monthStart || sessionDate > monthEnd) return false;
      const employee = employees.find(e => e.id === session.employee_id);
      return !employee || !employee.start_date || session.date >= employee.start_date;
    });
    const monthAllSessions = (workSessions.length ? workSessions : sessions).filter(session => {
      const sessionDate = parseISO(session.date);
      return sessionDate >= monthStart && sessionDate <= monthEnd;
    });

    let sessionPayment = 0;
    let totalHours = 0;
    let totalSessions = 0;
    let totalStudents = 0;
    let adjustments = 0;

    monthSessions.forEach(session => {
      const employee = employees.find(e => e.id === session.employee_id);
      if (!employee) return;
      if (employee.start_date && session.date < employee.start_date) return;

      if (session.entry_type === 'adjustment') {
        adjustments += session.total_payment || 0;
        return;
      }

      if (employee.employee_type === 'instructor') {
        totalSessions += session.sessions_count || 0;
        totalStudents += (session.students_count || 0) * (session.sessions_count || 0);
        const service = services.find(s => s.id === session.service_id);
        const rate = getRateForDate(employee.id, session.date, session.service_id).rate;
        let pay = 0;
        if (service && service.duration_minutes) {
          pay = (session.sessions_count || 0) * (service.payment_model === 'per_student'
            ? (session.students_count || 0) * rate
            : rate);
          totalHours += (service.duration_minutes / 60) * (session.sessions_count || 0);
        } else {
          pay = (session.sessions_count || 0) * rate;
        }
        sessionPayment += pay;
      } else if (employee.employee_type === 'hourly') {
        const rate = getRateForDate(employee.id, session.date).rate;
        sessionPayment += (session.hours || 0) * rate;
        totalHours += session.hours || 0;
      } else if (employee.employee_type === 'global') {
        totalHours += session.hours || 0;
      }
    });

    const monthSessionIds = new Set(monthSessions.map(s => s.id));
    const extraAdjustments = monthAllSessions
      .filter(s => s.entry_type === 'adjustment' && !monthSessionIds.has(s.id))
      .filter(s => {
        const emp = employees.find(e => e.id === s.employee_id);
        return !emp || !emp.start_date || s.date >= emp.start_date;
      })
      .reduce((sum, s) => sum + (s.total_payment || 0), 0);

    const globalEmployees = employees.filter(e => e.employee_type === 'global' && scopedEmployeeIds.has(e.id));
    globalEmployees.forEach(emp => {
      const hasSession = monthAllSessions.some(s => s.employee_id === emp.id && s.entry_type !== 'adjustment');
      if (hasSession && (!emp.start_date || parseISO(emp.start_date) <= endOfMonth(monthStart))) {
        sessionPayment += getRateForDate(emp.id, monthStart).rate;
      }
    });

    const totalPayment = sessionPayment + adjustments + extraAdjustments;

    const employeePayments = {};
    monthAllSessions.forEach(session => {
      const emp = employees.find(e => e.id === session.employee_id);
      if (!emp || (emp.start_date && session.date < emp.start_date)) return;
      let amt = 0;
      if (session.entry_type === 'adjustment') {
        amt = session.total_payment || 0;
      } else if (emp.employee_type === 'instructor') {
        const service = services.find(s => s.id === session.service_id);
        const rate = getRateForDate(emp.id, session.date, session.service_id).rate;
        if (service && service.payment_model === 'per_student') {
          amt = (session.sessions_count || 0) * (session.students_count || 0) * rate;
        } else {
          amt = (session.sessions_count || 0) * rate;
        }
      } else if (emp.employee_type === 'hourly') {
        const rate = getRateForDate(emp.id, session.date).rate;
        amt = (session.hours || 0) * rate;
      }
      employeePayments[session.employee_id] = (employeePayments[session.employee_id] || 0) + amt;
    });
    globalEmployees.forEach(emp => {
      const hasSession = monthAllSessions.some(s => s.employee_id === emp.id && s.entry_type !== 'adjustment');
      if (hasSession && (!emp.start_date || parseISO(emp.start_date) <= endOfMonth(monthStart))) {
        employeePayments[emp.id] = (employeePayments[emp.id] || 0) + getRateForDate(emp.id, monthStart).rate;
      }
    });
    const topEmployeeId = Object.keys(employeePayments).reduce((a, b) => 
      employeePayments[a] > employeePayments[b] ? a : b, null
    );

    return {
      month: format(month, 'MMMM yyyy', { locale: he }),
      totalPayment,
      totalHours: Math.round(totalHours * 10) / 10,
      sessionsCount: totalSessions,
      studentsCount: totalStudents,
      topEmployee: topEmployeeId ? getEmployeeName(topEmployeeId) : '-',
      topEmployeePayment: topEmployeeId ? employeePayments[topEmployeeId] : 0
    };
  }).reverse(); // Show most recent month first

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold">דוח חודשי מסונן</h3>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {monthlyData.map((monthData, index) => (
          <Card key={index} className="bg-gradient-to-br from-white to-slate-50 border-0 shadow-lg">
            <CardHeader className="p-4 border-b">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Calendar className="w-5 h-5 text-blue-500" />
                {monthData.month}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              <div className="flex justify-between items-center"><span className="text-sm text-slate-600">סה״כ תשלום:</span><span className="font-semibold text-slate-900">₪{monthData.totalPayment.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span></div>
              <div className="flex justify-between items-center"><span className="text-sm text-slate-600">שעות:</span><span className="font-medium text-slate-800">{monthData.totalHours}</span></div>
              <div className="flex justify-between items-center"><span className="text-sm text-slate-600">מפגשים:</span><span className="font-medium text-slate-800">{monthData.sessionsCount}</span></div>
              <div className="flex justify-between items-center"><span className="text-sm text-slate-600">תלמידים:</span><span className="font-medium text-slate-800">{monthData.studentsCount}</span></div>
              {monthData.topEmployee !== '-' && (
                <div className="pt-2 border-t">
                  <div className="flex items-center gap-2 mb-1"><TrendingUp className="w-4 h-4 text-green-500" /><span className="text-sm font-medium text-slate-700">עובד מוביל:</span></div>
                  <p className="text-sm text-slate-900 font-medium">{monthData.topEmployee}</p>
                  <p className="text-xs text-slate-600">₪{monthData.topEmployeePayment.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}