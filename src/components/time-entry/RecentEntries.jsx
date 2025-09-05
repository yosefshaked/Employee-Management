import React from 'react';
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { User, Calendar, Clock } from "lucide-react"; // הוספנו Clock
import { format, parseISO } from "date-fns";
import { he } from "date-fns/locale";

// כבר לא צריכים את זה
// const SESSION_TYPES = { ... };

export default function RecentEntries({ sessions, employees, isLoading }) {
  const getEmployeeName = (employeeId) => {
    const employee = employees.find(emp => emp.id === employeeId);
    return employee ? employee.name : 'לא ידוע';
  };

  if (isLoading) {
    // ... קוד הסקלטון נשאר זהה
  }
  
  if (sessions.length === 0) {
    // ... קוד ההודעה הריקה נשאר זהה
  }

  return (
    <div className="space-y-3">
      {sessions.map(session => (
        <div key={session.id} className="p-3 rounded-lg border bg-slate-50/70">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-slate-500" />
              <p className="font-semibold text-slate-800">{getEmployeeName(session.employee_id)}</p>
            </div>
            <p className="text-sm font-bold text-slate-900">₪{session.total_payment.toFixed(2)}</p>
          </div>
          <div className="flex items-center justify-between text-sm text-slate-600">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              <span>{format(parseISO(session.date), 'dd/MM/yyyy', { locale: he })}</span>
            </div>
            {/* === התיקון כאן: מציגים את שם השירות מהמידע החדש === */}
            <Badge variant="secondary" className="bg-white">
              {session.Services ? session.Services.name : 'עבודה שעתית'}
            </Badge>
            {/* ======================================================= */}
          </div>
        </div>
      ))}
    </div>
  );
}