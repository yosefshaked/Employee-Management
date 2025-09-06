import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Clock, TrendingUp, DollarSign } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format, startOfMonth, endOfMonth, parseISO } from "date-fns";
import { he } from "date-fns/locale";

export default function QuickStats({ employees, workSessions, currentDate, isLoading }) {
  const getCurrentMonthSessions = () => {
    const start = startOfMonth(currentDate);
    const end = endOfMonth(currentDate);
    
    return workSessions.filter(session => {
      const sessionDate = parseISO(session.date);
      return sessionDate >= start && sessionDate <= end;
    });
  };

  const currentMonthSessions = getCurrentMonthSessions();
  const totalPayment = currentMonthSessions.reduce((sum, session) => sum + session.total_payment, 0);
  const totalHours = currentMonthSessions.reduce((sum, session) => {
    if (session.session_type === 'hourly') {
      return sum + session.hours;
    } else {
      return sum + (session.sessions_count * 0.5); // approximate hours for sessions
    }
  }, 0);

  const stats = [
    {
      title: "עובדים פעילים",
      value: employees.length,
      icon: Users,
      color: "from-blue-500 to-blue-600",
      trend: ""
    },
    {
      title: "שעות החודש",
      value: Math.round(totalHours * 10) / 10,
      icon: Clock,
      color: "from-green-500 to-green-600",
      trend: ""
    },
    {
      title: "מפגשים החודש",
      value: currentMonthSessions.length,
      icon: TrendingUp,
      color: "from-purple-500 to-purple-600",
      trend: ""
    },
    {
      title: "סה״כ תשלום",
      value: `₪${totalPayment.toLocaleString()}`,
      icon: DollarSign,
      color: "from-orange-500 to-orange-600",
      trend: format(currentDate, 'MMMM', { locale: he })
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
                {isLoading ? (
                  <Skeleton className="h-8 w-20" />
                ) : (
                  <CardTitle className="text-2xl md:text-3xl font-bold text-slate-900">
                    {stat.value}
                  </CardTitle>
                )}
                {stat.trend && (
                  <p className="text-sm text-slate-500">{stat.trend}</p>
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
