import React, { useState } from 'react';
import { format, parseISO, startOfMonth, endOfMonth, eachMonthOfInterval } from "date-fns";
import { calculatePayrollSummary } from "@/lib/reportUtils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp } from "lucide-react";

const EMPLOYEE_TYPES = {
  hourly: 'שעתי',
  instructor: 'מדריך',
  global: 'גלובלי'
};

// קומפוננטה קטנה לשורות הפירוט עם עיצוב משופר
const InstructorDetailsRow = ({ details }) => (
  <TableRow className="bg-slate-50 hover:bg-slate-100/70">
    <TableCell colSpan={1} className="py-2"></TableCell>
    <TableCell colSpan={5} className="p-2 px-4">
      <div className="font-semibold text-xs text-slate-500 grid grid-cols-4 gap-4 mb-1 px-2">
        <span>שם השירות</span>
        <span className="text-center">כמות מפגשים</span>
        <span className="text-center">תעריף למפגש</span>
        <span className="text-left">סה"כ</span>
      </div>
      <div className="space-y-1">
        {details.map((detail, index) => (
          <div key={index} className="bg-white p-2 rounded-md grid grid-cols-4 gap-4 text-sm items-center border">
            <span className="font-medium text-slate-700">{detail.serviceName}</span>
            <span className="font-semibold text-center">{detail.sessionsCount}</span>
            <span className="text-slate-600 text-center">₪{detail.avgRate.toFixed(2)}</span>
            <span className="font-semibold text-slate-800 text-left">₪{detail.totalPayment.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </TableCell>
  </TableRow>
);

export default function PayrollSummary({ sessions, employees, services, isLoading, getRateForDate, scopedEmployeeIds, dateFrom, dateTo, rateHistories = [] }) {
  const [expandedRows, setExpandedRows] = useState({});

  const EMPLOYEE_TYPE_CONFIG = {
    hourly: {
      label: 'שעתי',
      className: 'bg-blue-50 text-blue-700 border-blue-200',
      activity: (emp) => `${emp.totalHours.toFixed(1)} שעות`
    },
    global: {
      label: 'גלובלי',
      className: 'bg-yellow-50 text-yellow-700 border-yellow-200', // צבע חדש לגלובלי
      activity: (emp) => `${emp.totalHours.toFixed(1)} שעות`
    },
    instructor: {
      label: 'מדריך',
      className: 'bg-purple-50 text-purple-700 border-purple-200',
      activity: (emp) => `${emp.totalSessions} מפגשים`
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    );
  }

  const toggleRow = (employeeId) => {
    setExpandedRows(prev => ({...prev, [employeeId]: !prev[employeeId]}));
  };

      const reportMonths = new Set(
        eachMonthOfInterval({
          start: startOfMonth(parseISO(dateFrom)),
          end: endOfMonth(parseISO(dateTo))
        }).map(m => format(m, 'yyyy-MM'))
      );

      const summary = calculatePayrollSummary({
        employees,
        sessions,
        services,
        getRateForDate,
        scopedEmployeeIds,
        rateHistories
      });

      const detailsMap = {};
      sessions.forEach(session => {
        const emp = employees.find(e => e.id === session.employee_id);
        if (!emp || emp.employee_type !== 'instructor') return;
        if (!detailsMap[emp.id]) detailsMap[emp.id] = {};
        const service = services.find(s => s.id === session.service_id);
        const key = session.service_id;
        if (!detailsMap[emp.id][key]) {
          detailsMap[emp.id][key] = {
            serviceName: service ? service.name : 'שירות לא ידוע',
            sessionsCount: 0,
            totalPayment: 0
          };
        }
        detailsMap[emp.id][key].sessionsCount += session.sessions_count || 0;
        detailsMap[emp.id][key].totalPayment += session.total_payment || 0;
      });

      const employeesSummary = summary.map(emp => {
        const details = emp.employeeType === 'instructor'
          ? Object.values(detailsMap[emp.id] || {}).map(d => ({
              ...d,
              avgRate: d.totalPayment / (d.sessionsCount || 1)
            }))
          : [];
        const original = employees.find(e => e.id === emp.id);
        return { ...emp, details, isActive: original ? original.is_active : false };
      }).filter(emp => {
          const hasActivity = emp.totalPayment !== 0 || emp.totalHours > 0 || emp.totalSessions > 0;
          if (hasActivity) return true;
          const original = employees.find(e => e.id === emp.id);
          if (original && original.is_active && original.start_date) {
            const startMonth = format(parseISO(original.start_date), 'yyyy-MM');
            if ([...reportMonths].some(m => m >= startMonth)) return true;
          }
          return false;
      }).sort((a, b) => (b.totalPayment || 0) - (a.totalPayment || 0));

  return (
    <Card className="border-0 shadow-lg">
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50 hover:bg-slate-50">
            <TableHead className="w-12"></TableHead>
            <TableHead className="text-right">עובד</TableHead>
            <TableHead className="text-right">סוג</TableHead>
            <TableHead className="text-right">שכר בסיס</TableHead>
            <TableHead className="text-right">סה"כ פעילות</TableHead>
            <TableHead className="text-right">התאמות</TableHead>
            <TableHead className="text-right">סה״כ לתשלום</TableHead>
            <TableHead className="text-right">סטטוס</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {employeesSummary.map((employee) => (
            <React.Fragment key={employee.id}>
              <TableRow className="hover:bg-slate-50/50">
                <TableCell>
                  {(employee.employeeType === 'instructor' || employee.employeeType === 'global') && employee.details.length > 0 && (
                    <Button variant="ghost" size="icon" onClick={() => toggleRow(employee.id)} className="w-8 h-8 rounded-full">
                      {expandedRows[employee.id] ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                  )}
                </TableCell>
                <TableCell className="font-medium">{employee.name}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={EMPLOYEE_TYPE_CONFIG[employee.employeeType]?.className || ''}>
                    {EMPLOYEE_TYPE_CONFIG[employee.employeeType]?.label || 'לא ידוע'}
                  </Badge>
                </TableCell>
                <TableCell className="font-semibold text-slate-600">
                  {employee.baseSalary !== null ? `₪${employee.baseSalary.toLocaleString()}` : '-'}
                </TableCell>
                <TableCell className="font-semibold">
                  {EMPLOYEE_TYPE_CONFIG[employee.employeeType]?.activity(employee) || '-'}
                </TableCell>
                <TableCell className={`font-semibold ${employee.totalAdjustments >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                  {employee.totalAdjustments !== null && employee.totalAdjustments !== 0 ? `₪${employee.totalAdjustments.toLocaleString()}` : '-'}
                </TableCell>
                <TableCell className="font-semibold text-green-700">₪{employee.totalPayment.toLocaleString()}</TableCell>
                <TableCell>
                  <Badge className={employee.isActive ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'}>
                    {employee.isActive ? 'פעיל' : 'לא פעיל'}
                  </Badge>
                </TableCell>
              </TableRow>
              {expandedRows[employee.id] && <InstructorDetailsRow details={employee.details} />}
            </React.Fragment>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
