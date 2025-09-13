import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Clock, TrendingUp, DollarSign } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { he } from "date-fns/locale";
import { InfoTooltip } from "../InfoTooltip";
import { computePeriodTotals } from '@/lib/payroll.js';

export default function QuickStats({ employees, workSessions, services, currentDate, isLoading }) {

  const calculateMonthlyStats = () => {
    if (!workSessions || !employees || !services) {
      return { totalPayment: 0, totalHours: 0, uniqueWorkDays: 0, activeEmployees: 0 };
    }
    const start = startOfMonth(currentDate);
    const end = endOfMonth(currentDate);
    const res = computePeriodTotals({
      workSessions,
      employees,
      services,
      startDate: format(start, 'yyyy-MM-dd'),
      endDate: format(end, 'yyyy-MM-dd')
    });
    return {
      totalPayment: res.totalPay,
      totalHours: res.totalHours,
      uniqueWorkDays: res.diagnostics.uniquePaidDays,
      activeEmployees: employees.filter(e => e.is_active !== false).length
    };
  };

  const statsData = calculateMonthlyStats();
  const tooltipTextsHe = [
    'מספר עובדים שמסומנים כפעילים',
    'נספרות שעות עבור עובדים שעתיים בלבד',
    'עובד נספר פעם אחת לכל יום עבודה בחודש',
    'סכום תשלומים מהרישומים'
  ];
  const tooltipTexts = [
    'Counts only employees marked active',
    'Hours counted only for hourly employees',
    'Each employee counted once per work day in the month',
    'Total payments from work sessions'
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
