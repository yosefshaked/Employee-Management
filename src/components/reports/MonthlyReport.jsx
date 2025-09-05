import React, { useEffect, useState } from 'react';
import { supabase } from '@/supabaseClient';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, TrendingUp } from "lucide-react";
import { format, parseISO, startOfMonth, endOfMonth, eachMonthOfInterval } from "date-fns";
import { he } from "date-fns/locale";


export default function MonthlyReport() {
  const [sessions, setSessions] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [services, setServices] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      const [{ data: sessionsData }, { data: employeesData }, { data: servicesData }] = await Promise.all([
        supabase.from('WorkSessions').select('*'),
        supabase.from('Employees').select('*'),
        supabase.from('Services').select('*'),
      ]);
      setSessions(sessionsData || []);
      setEmployees(employeesData || []);
      setServices(servicesData || []);
      setIsLoading(false);
    }
    fetchData();
  }, []);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array(6).fill(0).map((_, i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
    );
  }

  const getEmployeeName = (employeeId) => {
    const employee = employees.find(emp => emp.id === employeeId);
    return employee ? employee.name : 'לא ידוע';
  };

  // Get last 6 months
  const now = new Date();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const months = eachMonthOfInterval({ start: sixMonthsAgo, end: now });

  const getServiceName = (serviceId) => {
    const service = services?.find(s => s.id === serviceId);
    return service ? service.name : 'לא ידוע';
  };

  const getSessionHours = (session) => {
    // Use service duration if available
    const service = services?.find(s => s.id === session.service_id);
    if (session.session_type === 'hourly') {
      return session.hours || 0;
    } else if (service && service.duration_minutes) {
      return (service.duration_minutes / 60) * (session.sessions_count || 0);
    } else {
      return (session.sessions_count || 0) * 0.5; // fallback
    }
  };

  const monthlyData = months.map(month => {
    const monthStart = startOfMonth(month);
    const monthEnd = endOfMonth(month);
    const monthSessions = sessions.filter(session => {
      const sessionDate = parseISO(session.date);
      return sessionDate >= monthStart && sessionDate <= monthEnd;
    });

  let totalPayment = 0;
  let totalHours = 0;
  let totalSessions = 0;
  let totalStudents = 0;

    monthSessions.forEach(session => {
      totalPayment += session.total_payment || 0;
      if (session.hours != null) {
        // Hourly employee: use hours field
        totalHours += session.hours;
        // Do NOT count hourly rate input as a session
      } else {
        // Instructor: use (service.duration_minutes / 60) * sessions_count (do NOT multiply by students_count)
        const service = services.find(s => s.id === session.service_id);
        if (service && service.duration_minutes) {
          totalHours += (service.duration_minutes / 60) * (session.sessions_count || 0);
        } else {
          // Fallback to type-based duration only if service duration is missing
          if (session.session_type === 'session_30') {
            totalHours += 0.5 * (session.sessions_count || 0);
          } else if (session.session_type === 'session_45') {
            totalHours += 0.75 * (session.sessions_count || 0);
          } else if (session.session_type === 'session_150') {
            totalHours += 2.5 * (session.sessions_count || 0);
          }
        }
        // Only count instructor sessions
        totalSessions += session.sessions_count || 0;
      }
  // Count students as students_count * sessions_count for all sessions
  totalStudents += (session.students_count || 0) * (session.sessions_count || 0);
    });

    // Top employee for the month
    const employeePayments = {};
    monthSessions.forEach(session => {
      employeePayments[session.employee_id] = (employeePayments[session.employee_id] || 0) + session.total_payment;
    });
    const topEmployeeId = Object.keys(employeePayments).reduce((a, b) => 
      employeePayments[a] > employeePayments[b] ? a : b, null
    );

    return {
      month: format(month, 'MMMM yyyy', { locale: he }),
      shortMonth: format(month, 'MMM', { locale: he }),
      totalPayment,
      totalHours: Math.round(totalHours * 10) / 10,
      sessionsCount: totalSessions,
      studentsCount: totalStudents,
      topEmployee: topEmployeeId ? getEmployeeName(topEmployeeId) : '-',
      topEmployeePayment: topEmployeeId ? employeePayments[topEmployeeId] : 0
    };
  });

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold">דוח חודשי - 6 חודשים אחרונים</h3>
      
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
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-600">סה״כ תשלום:</span>
                <span className="font-semibold text-slate-900">₪{monthData.totalPayment.toLocaleString()}</span>
              </div>
              
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-600">שעות:</span>
                <span className="font-medium text-slate-800">{monthData.totalHours}</span>
              </div>
              
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-600">מפגשים:</span>
                <span className="font-medium text-slate-800">{monthData.sessionsCount}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-600">תלמידים:</span>
                <span className="font-medium text-slate-800">{monthData.studentsCount}</span>
              </div>
              
              {monthData.topEmployee !== '-' && (
                <div className="pt-2 border-t">
                  <div className="flex items-center gap-2 mb-1">
                    <TrendingUp className="w-4 h-4 text-green-500" />
                    <span className="text-sm font-medium text-slate-700">עובד מוביל:</span>
                  </div>
                  <p className="text-sm text-slate-900 font-medium">{monthData.topEmployee}</p>
                  <p className="text-xs text-slate-600">₪{monthData.topEmployeePayment.toLocaleString()}</p>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}