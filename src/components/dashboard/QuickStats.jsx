import React from 'react';
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, Calendar, Users, DollarSign } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { he } from "date-fns/locale";
import { InfoTooltip } from "../InfoTooltip";
import {
  computePeriodTotals,
  sumHourlyHours,
  countGlobalEffectiveDays,
  sumInstructorSessions
} from '@/lib/payroll.js';

export default function QuickStats({ employees = [], workSessions = [], services = [], currentDate, filters = {}, isLoading }) {
  const start = startOfMonth(currentDate);
  const end = endOfMonth(currentDate);
  const baseFilters = {
    dateFrom: format(start, 'yyyy-MM-dd'),
    dateTo: format(end, 'yyyy-MM-dd'),
    employeeType: filters.employeeType || 'all',
    selectedEmployee: filters.selectedEmployee || null,
    serviceId: filters.serviceId || 'all'
  };

  const totals = computePeriodTotals({
    workSessions,
    employees,
    services,
    startDate: baseFilters.dateFrom,
    endDate: baseFilters.dateTo,
    serviceFilter: baseFilters.serviceId,
    employeeFilter: baseFilters.selectedEmployee || '',
    employeeTypeFilter: baseFilters.employeeType
  });

  const hourlyHours = sumHourlyHours(workSessions, employees, baseFilters);
  const globalDays = countGlobalEffectiveDays(workSessions, employees, baseFilters, { excludePaidLeave: true });
  const instructorSessions = sumInstructorSessions(workSessions, services, employees, baseFilters);

  const stats = [
    {
      title: "סך שעות (שעתיים)",
      value: hourlyHours.toFixed(1),
      icon: Clock,
      color: "from-green-500 to-green-600",
      tooltip: "סכום שעות שנרשמו לעובדים שעתיים בלבד בטווח התאריכים המסונן."
    },
    {
      title: "ימי עבודה (גלובליים)",
      value: globalDays,
      icon: Calendar,
      color: "from-purple-500 to-purple-600",
      tooltip: "ימי עבודה אפקטיביים לעובדים גלובליים לפי הגדרות הימים והסוגים (ללא חופשה בתשלום)."
    },
    {
      title: "סה״כ מפגשים (מדריכים)",
      value: instructorSessions,
      icon: Users,
      color: "from-blue-500 to-blue-600",
      tooltip: "סך מפגשים של מדריכים לפי הרישומים והמסננים הפעילים."
    },
    {
      title: `סה״כ תשלום ל${format(currentDate, 'MMMM', { locale: he })}`,
      value: `₪${totals.totalPay.toLocaleString()}`,
      icon: DollarSign,
      color: "from-orange-500 to-orange-600",
      tooltip: 'סכום תשלומים מהרישומים'
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {stats.map((stat, index) => (
        <Card key={index} className="relative overflow-hidden bg-white/70 backdrop-blur-sm border-0 shadow-lg hover:shadow-xl transition-all duration-300">
          <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-l ${stat.color} opacity-10 transform translate-x-8 -translate-y-8 rounded-full`} />
          <CardHeader className="p-6">
            <div className="flex justify-between items-start">
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-600">{stat.title}</p>
                <div className="absolute left-3 top-3 z-10">
                  <InfoTooltip text={stat.tooltip} />
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
