import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, TrendingUp } from "lucide-react";
import { format, parseISO, startOfMonth, endOfMonth, eachMonthOfInterval } from "date-fns";
import { he } from "date-fns/locale";

// Helper function to get base salary, now inside the component
const getBaseSalary = (employeeId, rateHistories) => {
  if (!rateHistories) return 0;
  const GENERIC_RATE_SERVICE_ID = '00000000-0000-0000-0000-000000000000';
  const relevantRates = rateHistories
    .filter(r => r.employee_id === employeeId && r.service_id === GENERIC_RATE_SERVICE_ID)
    .sort((a, b) => new Date(b.effective_date) - new Date(a.effective_date));
  return relevantRates.length > 0 ? relevantRates[0].rate : 0;
};

export default function MonthlyReport({ sessions, employees, services, rateHistories, isLoading }) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array(6).fill(0).map((_, i) => <Skeleton key={i} className="h-40" />)}
      </div>
    );
  }

  const getEmployeeName = (employeeId) => employees.find(emp => emp.id === employeeId)?.name || 'לא ידוע';
  
  // Logic to determine date range from filtered sessions or default to last 6 months
  let startDate, endDate;
  if (sessions.length > 0) {
    const dates = sessions.map(s => parseISO(s.date));
    startDate = new Date(Math.min(...dates));
    endDate = new Date(Math.max(...dates));
  } else {
    endDate = new Date();
    startDate = new Date(endDate.getFullYear(), endDate.getMonth() - 5, 1);
  }
  const months = eachMonthOfInterval({ start: startDate, end: endDate });

  const monthlyData = months.map(month => {
    const monthStart = startOfMonth(month);
    const monthEnd = endOfMonth(month);
    const monthSessions = sessions.filter(session => {
      const sessionDate = parseISO(session.date);
      if (sessionDate < monthStart || sessionDate > monthEnd) return false;
      const employee = employees.find(e => e.id === session.employee_id);
      return !employee || !employee.start_date || session.date >= employee.start_date;
    });

    let totalPayment = 0;
    let totalHours = 0;
    let totalSessions = 0;
    let totalStudents = 0;

    monthSessions.forEach(session => {
      const employee = employees.find(e => e.id === session.employee_id);
      if (!employee) return;
      if (employee.start_date && session.date < employee.start_date) return;

      // Always add the payment
      totalPayment += session.total_payment || 0;

      // Handle activity based on employee type
      if (employee.employee_type === 'instructor') {
        totalSessions += session.sessions_count || 0;
        totalStudents += (session.students_count || 0) * (session.sessions_count || 0);
        
        // Calculate estimated hours for instructors
        const service = services.find(s => s.id === session.service_id);
        if (service && service.duration_minutes) {
          totalHours += (service.duration_minutes / 60) * (session.sessions_count || 0);
        }
      } else { // This covers 'hourly' and 'global'
        // Only count hours if it's an 'hours' entry type, not an 'adjustment'
        if (session.entry_type !== 'adjustment') {
          totalHours += session.hours || 0;
        }
      }
    });

    const activeGlobalEmployeeIdsInMonth = [...new Set(
      monthSessions
        .filter(s => s.entry_type !== 'adjustment')
        .filter(s => {
          const emp = employees.find(e => e.id === s.employee_id && e.employee_type === 'global');
          return emp && (!emp.start_date || s.date >= emp.start_date);
        })
        .map(s => s.employee_id)
    )];
    
    activeGlobalEmployeeIdsInMonth.forEach(employeeId => {
      totalPayment += getBaseSalary(employeeId, rateHistories);
    });

    const employeePayments = {};
    monthSessions.forEach(session => {
      employeePayments[session.employee_id] = (employeePayments[session.employee_id] || 0) + session.total_payment;
    });
    activeGlobalEmployeeIdsInMonth.forEach(employeeId => {
      employeePayments[employeeId] = (employeePayments[employeeId] || 0) + getBaseSalary(employeeId, rateHistories);
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