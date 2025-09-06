import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Clock, User, Calendar, ArrowLeft } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format, parseISO } from "date-fns";
import { he } from "date-fns/locale";
import { Link } from "react-router-dom";
import { getColorForService } from '@/lib/colorUtils';

export default function RecentActivity({ title = "פעילות אחרונה", sessions, employees, services, isLoading, showViewAllButton = true }) {
  
  const getEmployee = (employeeId) => employees.find(emp => emp.id === employeeId);

  const getServiceName = (session) => {
    const employee = getEmployee(session.employee_id);
    if (employee?.employee_type === 'hourly') return "שעות עבודה";
    const service = services.find(s => s.id === session.service_id);
    return service ? service.name : 'סוג לא ידוע';
  };

  return (
    <Card className="bg-white/70 backdrop-blur-sm border-0 shadow-lg flex flex-col h-full">
      <CardHeader className="p-6 border-b">
        <CardTitle className="flex items-center gap-2 text-xl font-bold text-slate-900">
          <Clock className="w-5 h-5 text-green-500" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6 flex-1">
        {isLoading ? (
          <div className="space-y-4">{Array(5).fill(0).map((_, i) => (<div key={i} className="flex items-center gap-3"><Skeleton className="w-10 h-10 rounded-full" /><div className="flex-1"><Skeleton className="h-4 w-32 mb-2" /><Skeleton className="h-3 w-24" /></div></div>))}</div>
        ) : sessions && sessions.length > 0 ? (
          <div className="space-y-3">
            {sessions.map((session) => {
              const employee = getEmployee(session.employee_id);
              const isHourly = employee?.employee_type === 'hourly';
              
              return (
                <div key={session.id} className="flex items-center gap-3 p-3 rounded-lg bg-slate-50">
                  <div className="w-10 h-10 bg-gradient-to-r from-blue-400 to-green-400 rounded-full flex items-center justify-center flex-shrink-0"><User className="w-5 h-5 text-white" /></div>
                  
                  <div className="flex-1 min-w-0 grid grid-cols-2 gap-x-2">
                    <div className="col-span-1">
                      <p className="font-semibold text-slate-900 truncate">{employee?.name || 'לא ידוע'}</p>
                      <div className="flex items-center gap-1.5 text-xs text-slate-600">
                        <Calendar className="w-3 h-3 flex-shrink-0" />
                        <span>{format(parseISO(session.date), 'dd/MM/yy', { locale: he })}</span>
                      </div>
                    </div>
                    <div className="col-span-1 text-left">
                      <p className="text-sm font-semibold text-slate-700 truncate">₪{session.total_payment.toLocaleString()}</p>
                      <p className="text-xs font-medium text-slate-500 truncate">
                        {isHourly ? `${session.hours} שעות` : `${session.sessions_count} מפגשים`}
                      </p>
                    </div>
                  </div>

                  <div className="flex-shrink-0 w-28 text-center">
                    <Badge variant="outline" className="text-xs w-full block truncate"
                      title={getServiceName(session)}
                      style={{
                        backgroundColor: `${getColorForService(isHourly ? null : session.service_id)}20`,
                        color: getColorForService(isHourly ? null : session.service_id),
                        borderColor: getColorForService(isHourly ? null : session.service_id),
                      }}>
                      {getServiceName(session)}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8 text-slate-500"><Clock className="w-12 h-12 mx-auto mb-3 opacity-50" /><p>אין פעילות אחרונה</p></div>
        )}
      </CardContent>
      {showViewAllButton && (
        <div className="p-4 border-t mt-auto">
          <Button asChild variant="outline" className="w-full">
            <Link to="/Reports" state={{ openTab: 'employee' }}>
              הצג את כל הדוחות
              <ArrowLeft className="w-4 h-4 mr-2" />
            </Link>
          </Button>
        </div>
      )}
    </Card>
  );
}