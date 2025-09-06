import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Edit, UserCheck, UserX, Phone, Mail, Calendar } from "lucide-react";
import { format, parseISO } from "date-fns";
import { he } from "date-fns/locale";

const EMPLOYEE_TYPES = {
  hourly: 'עובד שעתי',
  instructor: 'מדריך'
};

export default function EmployeeList({ employees, onEdit, onToggleActive, isLoading }) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array(6).fill(0).map((_, i) => (
          <Card key={i} className="bg-white/70 backdrop-blur-sm border-0 shadow-lg">
            <CardContent className="p-6">
              <div className="flex items-start justify-between mb-4">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-6 w-16" />
              </div>
              <Skeleton className="h-4 w-20 mb-2" />
              <Skeleton className="h-4 w-24 mb-4" />
              <div className="flex gap-2">
                <Skeleton className="h-9 w-20" />
                <Skeleton className="h-9 w-24" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (employees.length === 0) {
    return (
      <Card className="bg-white/70 backdrop-blur-sm border-0 shadow-lg">
        <CardContent className="p-12 text-center">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <UserCheck className="w-8 h-8 text-slate-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 mb-2">אין עובדים</h3>
          <p className="text-slate-600">התחל בהוספת עובד חדש למערכת</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {employees.map((employee) => (
        <Card
          key={employee.id}
          className={`bg-white/70 backdrop-blur-sm border-0 shadow-lg hover:shadow-xl transition-all duration-300 ${
            !employee.is_active ? 'opacity-60' : ''
          }`}
        >
          <CardContent className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900 mb-1">
                  {employee.name}
                </h3>
                {employee.employee_id && (
                  <p className="text-sm text-slate-500">מספר: {employee.employee_id}</p>
                )}
              </div>
              <Badge
                variant={employee.is_active ? "default" : "secondary"}
                className={
                  employee.is_active
                    ? "bg-green-100 text-green-700 border-green-200"
                    : "bg-slate-100 text-slate-600"
                }
              >
                {employee.is_active ? "פעיל" : "לא פעיל"}
              </Badge>
            </div>

            <div className="space-y-2 mb-4">
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <span className="font-medium">{EMPLOYEE_TYPES[employee.employee_type]}</span>
              </div>
              
              {employee.employee_type === 'hourly' && (
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <span>תעריף שעתי: ₪{employee.current_rate}</span>
                </div>
              )}

              {employee.phone && (
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Phone className="w-3 h-3" />
                  {employee.phone}
                </div>
              )}

              {employee.email && (
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Mail className="w-3 h-3" />
                  {employee.email}
                </div>
              )}

              {employee.start_date && (
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Calendar className="w-3 h-3" />
                  התחיל: {format(parseISO(employee.start_date), 'dd/MM/yyyy', { locale: he })}
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onEdit(employee)}
                className="flex-1"
              >
                <Edit className="w-4 h-4 ml-1" />
                ערוך
              </Button>
              <Button
                variant={employee.is_active ? "destructive" : "default"}
                size="sm"
                onClick={() => onToggleActive(employee)}
                className="flex-1"
              >
                {employee.is_active ? (
                  <>
                    <UserX className="w-4 h-4 ml-1" />
                    השבת
                  </>
                ) : (
                  <>
                    <UserCheck className="w-4 h-4 ml-1" />
                    הפעל
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}