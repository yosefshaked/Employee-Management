import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Clock, TrendingUp, DollarSign } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format, startOfMonth, endOfMonth, parseISO, isSameMonth } from "date-fns";
import { he } from "date-fns/locale";
import { InfoTooltip } from "../InfoTooltip";

export default function QuickStats({ employees, workSessions, services, currentDate, isLoading, rateHistories = [] }) {

  // === שינוי 1: הלוגיקה כולה רוכזה בפונקציה אחת ברורה ===
  const calculateMonthlyStats = () => {
    if (!workSessions || !employees || !services) {
      return { totalPayment: 0, totalHours: 0, uniqueWorkDays: 0, activeEmployees: 0 };
    }
    
    // סינון הרישומים הרלוונטיים לחודש הנוכחי
    const currentMonthSessions = workSessions.filter(session => 
      isSameMonth(parseISO(session.date), currentDate)
    );

    // Helper: base salary for global employees from RateHistory
    const getBaseSalary = (employeeId) => {
      const GENERIC_RATE_SERVICE_ID = '00000000-0000-0000-0000-000000000000';
      if (rateHistories && rateHistories.length > 0) {
        const relevantRates = rateHistories
          .filter(r => r.employee_id === employeeId && r.service_id === GENERIC_RATE_SERVICE_ID)
          .sort((a, b) => new Date(b.effective_date) - new Date(a.effective_date));
        if (relevantRates.length > 0) return relevantRates[0].rate;
      }
      // Fallback to employee.current_rate if available
      const emp = employees.find(e => e.id === employeeId);
      if (emp && emp.employee_type === 'global' && typeof emp.current_rate === 'number') {
        return emp.current_rate;
      }
      return 0;
    };

    let totalPayment = currentMonthSessions.reduce((sum, session) => sum + (session.total_payment || 0), 0);
    
    // חישוב שעות משולב ומדויק
    const totalHours = currentMonthSessions.reduce((sum, session) => {
      const employee = employees.find(e => e.id === session.employee_id);
      if (employee?.employee_type === 'hourly' || employee?.employee_type === 'global') {
        return sum + (session.hours || 0);
      } else if (employee?.employee_type === 'instructor') {
        const service = services.find(s => s.id === session.service_id);
        if (service?.duration_minutes) {
          return sum + (service.duration_minutes / 60) * (session.sessions_count || 0);
        }
      }
      return sum;
    }, 0);

    // === שינוי 2: הלוגיקה החדשה לספירת ימי עבודה ייחודיים ===
    const workDaySet = new Set(
      currentMonthSessions.map(session => `${session.employee_id}-${session.date}`)
    );
    const uniqueWorkDays = workDaySet.size;

    // Rule: if a global employee has any entry in the month, include full base for the month
    const globalEmployeeIdsWithEntries = [...new Set(
      currentMonthSessions
        .map(s => employees.find(e => e.id === s.employee_id))
        .filter(e => e && e.employee_type === 'global')
        .map(e => e.id)
    )];
    globalEmployeeIdsWithEntries.forEach(employeeId => {
      totalPayment += getBaseSalary(employeeId);
    });

    return {
      totalPayment,
      totalHours,
      uniqueWorkDays,
      activeEmployees: employees.filter(e => e.is_active !== false).length
    };
  };

  const statsData = calculateMonthlyStats();
  const tooltipTextsHe = [
    'מספר עובדים שמסומנים כפעילים',
    'לעובדי שעה וגלובלי: סכום שעות.' + '\n' + ' למדריכים: לפי משך שירות × מספר מפגשים',
    'עובד נספר פעם אחת לכל יום עבודה בחודש',
    'סכום תשלומים מהרישומים + שכר גלובלי אם לעובד יש רישום כלשהו בחודש'
  ];
  const tooltipTexts = [
    'Counts only employees marked active',
    'Hourly/Global: sum hours.' + '\n' + 'For Instructors: duration × sessions',
    'Each employee counted once per work day in the month',
    'Total session payments + global base if employee has any entry this month'
  ];
  
  // === שינוי 3: עדכון מערך הנתונים לתצוגה ===
  const stats = [
    {
      title: "עובדים פעילים",
      value: statsData.activeEmployees,
      icon: Users,
      color: "from-blue-500 to-blue-600",
    },
    {
      title: "שעות עבודה בחודש",
      value: statsData.totalHours.toFixed(1),
      icon: Clock,
      color: "from-green-500 to-green-600",
    },
    {
      title: "ימי עבודה בחודש",
      value: statsData.uniqueWorkDays,
      icon: TrendingUp,
      color: "from-purple-500 to-purple-600",
    },
    {
      title: `סה״כ תשלום ל${format(currentDate, 'MMMM', { locale: he })}`,
      value: `₪${statsData.totalPayment.toLocaleString()}`,
      icon: DollarSign,
      color: "from-orange-500 to-orange-600",
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {stats.map((stat, index) => (
        <Card key={index} className="relative overflow-hidden bg-white/70 backdrop-blur-sm border-0 shadow-lg hover:shadow-xl transition-all duration-300">
          <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-l ${stat.color} opacity-10 transform translate-x-8 -translate-y-8 rounded-full`} />
          <CardHeader className="p-6">
            <div className="flex justify-between items-start">
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-600">{stat.title}</p>
                <div className="absolute left-3 top-3 z-10">
                  <InfoTooltip text={tooltipTextsHe[index] || tooltipTexts[index]} />
                </div>
                {isLoading ? (
                  <Skeleton className="h-8 w-20" />
                ) : (
                  <CardTitle className="text-2xl md:text-3xl font-bold text-slate-900">
                    {stat.value}
                  </CardTitle>
                )}
              </div>
              <div className={`p-3 rounded-xl bg-gradient-to-r ${stat.color} shadow-lg`}>
                <stat.icon className="w-5 h-5 text-white" />
              </div>
            </div>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}
