import React, { useState } from 'react';
import { format, parseISO } from "date-fns";
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

export default function PayrollSummary({ sessions, employees, services, rateHistories, isLoading, workSessions = [] }) {
  const [expandedRows, setExpandedRows] = useState({});
  const getBaseSalary = (employeeId) => {
  if (!rateHistories) return 0;
  const GENERIC_RATE_SERVICE_ID = '00000000-0000-0000-0000-000000000000';
  const relevantRates = rateHistories
    .filter(r => r.employee_id === employeeId && r.service_id === GENERIC_RATE_SERVICE_ID)
    .sort((a, b) => new Date(b.effective_date) - new Date(a.effective_date));
  return relevantRates.length > 0 ? relevantRates[0].rate : 0;
};

  const getRateForDate = (employeeId, date, serviceId) => {
    if (!rateHistories) return 0;
    const dateStr = format(new Date(date), 'yyyy-MM-dd');
    const relevantRates = rateHistories
      .filter(r => r.employee_id === employeeId && r.service_id === serviceId && r.effective_date <= dateStr)
      .sort((a, b) => new Date(b.effective_date) - new Date(a.effective_date));
    return relevantRates.length > 0 ? relevantRates[0].rate : 0;
  };

  const calculateSessionPayment = (session, employee) => {
    const stored = parseFloat(session.total_payment);
    if (!Number.isNaN(stored)) return stored;

    if (session.entry_type === 'adjustment') {
      return parseFloat(session.adjustment_amount) || 0;
    }

    const serviceIdForRate = (employee.employee_type === 'hourly' || employee.employee_type === 'global')
      ? '00000000-0000-0000-0000-000000000000'
      : session.service_id;

    let rate = parseFloat(session.rate_used);
    if (Number.isNaN(rate) || rate === 0) {
      rate = getRateForDate(employee.id, session.date, serviceIdForRate);
    }

    if (employee.employee_type === 'hourly' || employee.employee_type === 'global') {
      return (parseFloat(session.hours) || 0) * rate;
    }

    if (employee.employee_type === 'instructor') {
      const service = services.find(s => s.id === session.service_id);
      const sessionsCount = parseInt(session.sessions_count, 10) || 0;
      if (service && service.payment_model === 'per_student') {
        const students = parseInt(session.students_count, 10) || 0;
        return sessionsCount * students * rate;
      }
      return sessionsCount * rate;
    }

    return 0;
  };

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

      const employeesSummary = employees.map(employee => {
        const employeeSessions = sessions.filter(s => s.employee_id === employee.id);

        // Calculate totals based on session data first
        const sessionTotals = employeeSessions.reduce((acc, session) => {
          const payment = calculateSessionPayment(session, employee);
          if (session.entry_type === 'adjustment') {
            acc.totalAdjustments += payment;
          } else {
            acc.sessionPayment += payment;
            if (employee.employee_type === 'instructor') {
              acc.totalSessions += session.sessions_count || 0;
            } else if (employee.employee_type === 'hourly' || employee.employee_type === 'global') {
              acc.totalHours += session.hours || 0;
            }
          }
          return acc;
        }, { sessionPayment: 0, totalHours: 0, totalSessions: 0, totalAdjustments: 0 });

        let finalPayment = 0;
        let baseSalary = null;

        // Build month set covered by the current filtered sessions range (exclude adjustments)
        const monthsSet = new Set(
          sessions
            .filter(s => s.entry_type !== 'adjustment')
            .map(s => format(parseISO(s.date), 'yyyy-MM'))
        );

        // Month-aware extra adjustments (outside exact range but within same months)
        const filteredIds = new Set(employeeSessions.map(s => s.id));
        const extraAdjustments = (workSessions || [])
          .filter(s => s.employee_id === employee.id && s.entry_type === 'adjustment')
          .filter(s => monthsSet.has(format(parseISO(s.date), 'yyyy-MM')))
          .filter(s => !filteredIds.has(s.id))
          .reduce((sum, s) => sum + calculateSessionPayment(s, employee), 0);

        const totalAdjustments = sessionTotals.totalAdjustments + extraAdjustments;

        if (employee.employee_type === 'global') {
          baseSalary = getBaseSalary(employee.id);
          // Count months in range where this employee has any non-adjustment entry (use all sessions)
          const employeeMonthsAll = new Set(
            (workSessions || [])
              .filter(s => s.employee_id === employee.id && s.entry_type !== 'adjustment')
              .map(s => format(parseISO(s.date), 'yyyy-MM'))
          );
          let monthsCount = 0;
          monthsSet.forEach(m => { if (employeeMonthsAll.has(m)) monthsCount++; });
          finalPayment = (baseSalary * monthsCount) + totalAdjustments;
        } else {
          // For hourly and instructors, final pay is session payments plus adjustments
          finalPayment = sessionTotals.sessionPayment + totalAdjustments;
        }
        
        // Instructor service details logic (remains the same)
        let serviceDetails = {};
        if (employee.employee_type === 'instructor') {
          employeeSessions.forEach(session => {
            if (session.service_id) {
              if (!serviceDetails[session.service_id]) {
                const service = services.find(s => s.id === session.service_id);
                serviceDetails[session.service_id] = {
                  serviceName: service ? service.name : 'שירות לא ידוע',
                  sessionsCount: 0,
                  totalPayment: 0
                };
              }
              serviceDetails[session.service_id].sessionsCount += session.sessions_count || 0;
              serviceDetails[session.service_id].totalPayment += calculateSessionPayment(session, employee);
            }
          });
          Object.values(serviceDetails).forEach(detail => {
            detail.avgRate = detail.totalPayment / (detail.sessionsCount || 1);
          });
        }

        return {
          id: employee.id, name: employee.name, employeeType: employee.employee_type,
          baseSalary,
          totalAdjustments,
          isActive: employee.is_active,
          totalPayment: finalPayment,
          totalHours: Math.round(sessionTotals.totalHours * 10) / 10,
          totalSessions: sessionTotals.totalSessions,
          details: Object.values(serviceDetails)
        };
      }).filter(emp => {
          // Show active employees, OR employees with any kind of payment/activity in the filtered period
          if (emp.isActive) return true;
          if (emp.totalPayment !== 0) return true;
          if (emp.totalHours > 0) return true;
          if (emp.totalSessions > 0) return true;
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
