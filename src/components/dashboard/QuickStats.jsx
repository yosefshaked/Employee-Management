import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Clock, TrendingUp, DollarSign } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format, startOfMonth, endOfMonth, parseISO, isSameMonth, differenceInDays, getDaysInMonth } from "date-fns";
import { he } from "date-fns/locale";
import { InfoTooltip } from "../InfoTooltip";

const GENERIC_RATE_SERVICE_ID = '00000000-0000-0000-0000-000000000000';

export default function QuickStats({ employees, workSessions, services, currentDate, isLoading, rateHistories = [] }) {

  const getRateForDate = (employeeId, date, serviceId = null) => {
    const employee = employees.find(e => e.id === employeeId);
    if (!employee) return { rate: 0, reason: 'אין עובד כזה' };

    const targetServiceId = (employee.employee_type === 'hourly' || employee.employee_type === 'global')
      ? GENERIC_RATE_SERVICE_ID
      : serviceId;

    const dateStr = format(new Date(date), 'yyyy-MM-dd');

    if (employee.start_date && employee.start_date > dateStr) {
      return { rate: 0, reason: 'לא התחילו לעבוד עדיין' };
    }

    const relevantRates = rateHistories
      .filter(r =>
        r.employee_id === employeeId &&
        r.service_id === targetServiceId &&
        r.effective_date <= dateStr
      )
      .sort((a, b) => new Date(b.effective_date) - new Date(a.effective_date));

    if (relevantRates.length > 0) {
      return {
        rate: relevantRates[0].rate,
        effectiveDate: relevantRates[0].effective_date
      };
    }

    return { rate: 0, reason: 'לא הוגדר תעריף' };
  };

  const calculateMonthlyStats = () => {
    if (!workSessions || !employees || !services) {
      return { totalPayment: 0, totalHours: 0, uniqueWorkDays: 0, activeEmployees: 0 };
    }

    const currentMonthSessions = workSessions.filter(session => {
      if (!isSameMonth(parseISO(session.date), currentDate)) return false;
      const emp = employees.find(e => e.id === session.employee_id);
      if (emp && emp.start_date && session.date < emp.start_date) return false;
      return true;
    });

    let totalPayment = 0;
    let totalHours = 0;

    currentMonthSessions.forEach(session => {
      const employee = employees.find(e => e.id === session.employee_id);
      if (!employee) return;

      if (session.entry_type === 'adjustment') {
        totalPayment += session.total_payment || 0;
        return;
      }

      if (employee.employee_type === 'instructor') {
        const service = services.find(s => s.id === session.service_id);
        const rate = getRateForDate(employee.id, session.date, session.service_id).rate;
        let sessionPay = 0;
        if (service && service.payment_model === 'per_student') {
          sessionPay = (session.sessions_count || 0) * (session.students_count || 0) * rate;
        } else {
          sessionPay = (session.sessions_count || 0) * rate;
        }
        totalPayment += sessionPay;
        if (service && service.duration_minutes) {
          totalHours += (service.duration_minutes / 60) * (session.sessions_count || 0);
        }
      } else if (employee.employee_type === 'hourly') {
        const rate = getRateForDate(employee.id, session.date).rate;
        totalPayment += (session.hours || 0) * rate;
        totalHours += session.hours || 0;
      } else if (employee.employee_type === 'global') {
        totalHours += session.hours || 0;
      }
    });

    const globalWithWork = new Set(
      currentMonthSessions
        .filter(s => s.entry_type !== 'adjustment')
        .map(s => s.employee_id)
        .filter(id => {
          const emp = employees.find(e => e.id === id);
          return emp && emp.employee_type === 'global';
        })
    );

    globalWithWork.forEach(empId => {
      const emp = employees.find(e => e.id === empId);
      if (emp) {
        const monthDate = startOfMonth(currentDate);
        const { rate: monthlyRate } = getRateForDate(emp.id, monthDate);
        if (monthlyRate > 0) {
          const employeeStartDate = emp.start_date ? parseISO(emp.start_date) : null;
          const monthStart = monthDate;
          const monthEnd = endOfMonth(monthDate);
          const effectiveStartDateInMonth = employeeStartDate && employeeStartDate > monthStart ? employeeStartDate : monthStart;
          const daysInMonth = getDaysInMonth(monthDate);
          const daysWorked = differenceInDays(monthEnd, effectiveStartDateInMonth) + 1;
          if (daysWorked > 0) {
            const dailyRate = monthlyRate / daysInMonth;
            totalPayment += dailyRate * daysWorked;
          }
        }
      }
    });

    const workDaySet = new Set(
      currentMonthSessions.map(session => `${session.employee_id}-${session.date}`)
    );
    const uniqueWorkDays = workDaySet.size;

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
