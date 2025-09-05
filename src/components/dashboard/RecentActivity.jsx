import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, User, Calendar } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format, parseISO } from "date-fns";
import { he } from "date-fns/locale";

const SESSION_TYPES = {
  hourly: 'עבודה שעתית',
  session_30: 'מפגש 30 דקות',
  session_45: 'מפגש 45 דקות',
  session_150: 'מפגש 2.5 שעות'
};

export default function RecentActivity({ workSessions, employees, isLoading }) {
  const getEmployeeName = (employeeId) => {
    const employee = employees.find(emp => emp.id === employeeId);
    return employee ? employee.name : 'לא ידוע';
  };

  const [showAll, setShowAll] = useState(false);
  const recentSessions = showAll ? workSessions : workSessions.slice(0, 10);

  return (
    <Card className="bg-white/70 backdrop-blur-sm border-0 shadow-lg">
      <CardHeader className="p-6 border-b">
        <CardTitle className="flex items-center gap-2 text-xl font-bold text-slate-900">
          <Clock className="w-5 h-5 text-green-500" />
          פעילות אחרונה
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        {isLoading ? (
          <div className="space-y-4">
            {Array(5).fill(0).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-slate-50">
                <Skeleton className="w-10 h-10 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="h-4 w-32 mb-2" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-6 w-16" />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {recentSessions.map((session, index) => (
              <div
                key={index}
                className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors duration-200"
              >
                <div className="w-10 h-10 bg-gradient-to-r from-blue-400 to-green-400 rounded-full flex items-center justify-center">
                  <User className="w-5 h-5 text-white" />
                </div>
                
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-900 truncate">
                    {getEmployeeName(session.employee_id)}
                  </p>
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Calendar className="w-3 h-3" />
                    {format(parseISO(session.date), 'dd/MM', { locale: he })}
                  </div>
                </div>

                <div className="text-left">
                  <Badge
                    variant="outline"
                    className={`mb-1 ${
                      session.session_type === 'hourly' 
                        ? 'bg-green-50 text-green-700 border-green-200' 
                        : 'bg-purple-50 text-purple-700 border-purple-200'
                    }`}
                  >
                    {SESSION_TYPES[session.session_type] || session.session_type || 'סוג לא ידוע'}
                  </Badge>
                  <p className="text-xs text-slate-500 mt-1">
                    {session.sessions_count ? `${session.sessions_count} מפגשים` : session.hours ? `${session.hours} שעות` : ''}
                  </p>
                  <p className="text-sm font-semibold text-slate-700">
                    ₪{session.total_payment.toLocaleString()}
                  </p>
                </div>
            {workSessions.length > 10 && !showAll && (
              <div className="text-center mt-2">
                <button
                  className="text-blue-600 underline text-sm hover:text-blue-800"
                  onClick={() => setShowAll(true)}
                >
                  הצג הכל ({workSessions.length})
                </button>
              </div>
            )}
            {showAll && workSessions.length > 10 && (
              <div className="text-center mt-2">
                <button
                  className="text-blue-600 underline text-sm hover:text-blue-800"
                  onClick={() => setShowAll(false)}
                >
                  הצג פחות
                </button>
              </div>
            )}
              </div>
            ))}

            {recentSessions.length === 0 && (
              <div className="text-center py-8 text-slate-500">
                <Clock className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>אין פעילות אחרונה</p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}