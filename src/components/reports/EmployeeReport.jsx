import React, { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
// Same color palette as ChartsOverview.jsx
const COLORS = ['#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444', '#06B6D4'];

// Get color for a service/session type, cycling through COLORS for new types
function getColorForService(serviceId, serviceName) {
  // Prefer serviceId for stable color, fallback to name
  if (!serviceId && !serviceName) return COLORS[0];
  const key = serviceId || serviceName;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}
import { Skeleton } from "@/components/ui/skeleton";
import { format, parseISO } from "date-fns";
import { he } from "date-fns/locale";

export default function EmployeeReport({ sessions, employees, filters, isLoading, services = [] }) {
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/3" />
        {Array(10).fill(0).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  const getEmployeeName = (employeeId) => {
    const employee = employees.find(emp => emp.id === employeeId);
    return employee ? employee.name : 'לא ידוע';
  };


  const getServiceName = (serviceId) => {
    const service = services.find(s => s.id === serviceId);
    return service ? service.name : 'לא ידוע';
  };

  const getSessionTypeName = (session) => {
    const types = {
      hourly: 'שעות עבודה',
      session_30: 'מפגש 30 דקות',
      session_45: 'מפגש 45 דקות',
      session_150: 'מפגש 2.5 שעות'
    };
    if (session.session_type) return types[session.session_type] || session.session_type;
    // fallback to service name if session_type is missing
    // If employee is hourly, show 'שעות עבודה'
    const employeeType = getEmployeeType(session.employee_id);
    if (employeeType === 'hourly') return 'שעות עבודה';
    return getServiceName(session.service_id);
  };

  const getEmployeeType = (employeeId) => {
    const employee = employees.find(emp => emp.id === employeeId);
    return employee ? employee.employee_type : null;
  };

  // Grouping state
  const [groupBy, setGroupBy] = useState('none'); // 'none', 'date', 'service', 'employee', 'amount'

  // Group sessions
  let groupedSessions = {};
  if (groupBy === 'date') {
    groupedSessions = sessions.reduce((acc, session) => {
      const key = session.date;
      if (!acc[key]) acc[key] = [];
      acc[key].push(session);
      return acc;
    }, {});
  } else if (groupBy === 'service') {
    groupedSessions = sessions.reduce((acc, session) => {
      // Use getSessionTypeName so 'שעות עבודה' is recognized as a group
      const key = getSessionTypeName(session);
      if (!acc[key]) acc[key] = [];
      acc[key].push(session);
      return acc;
    }, {});
  } else if (groupBy === 'employee') {
    groupedSessions = sessions.reduce((acc, session) => {
      const key = getEmployeeName(session.employee_id);
      if (!acc[key]) acc[key] = [];
      acc[key].push(session);
      return acc;
    }, {});
  } else if (groupBy === 'amount') {
    groupedSessions = sessions.reduce((acc, session) => {
      const employeeType = getEmployeeType(session.employee_id);
      let key = '';
      if (employeeType === 'hourly') {
        key = `${session.hours || 0} שעות`;
      } else {
        key = `${session.sessions_count || 0} מפגשים`;
      }
      if (!acc[key]) acc[key] = [];
      acc[key].push(session);
      return acc;
    }, {});
  }

  const sortedSessions = [...sessions].sort((a, b) => new Date(b.date) - new Date(a.date));

  // Sort group keys for display
  let sortedGroupEntries = Object.entries(groupedSessions);
  if (groupBy === 'date') {
    sortedGroupEntries.sort((a, b) => new Date(b[0]) - new Date(a[0])); // newest date first
  } else if (groupBy === 'service' || groupBy === 'employee') {
    sortedGroupEntries.sort((a, b) => a[0].localeCompare(b[0], 'he'));
  } else if (groupBy === 'amount') {
    // Extract number for sorting, descending
    sortedGroupEntries.sort((a, b) => {
      const getNum = str => parseFloat(str.replace(/[^\d.]/g, ''));
      return getNum(b[0]) - getNum(a[0]);
    });
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">רישומי עבודה מפורטים</h3>
      <div className="flex gap-4 items-center mb-2">
        <span className="text-sm">קבץ לפי:</span>
        <select className="border rounded px-2 py-1" value={groupBy} onChange={e => setGroupBy(e.target.value)}>
          <option value="none">ללא קיבוץ</option>
          <option value="date">תאריך</option>
          <option value="service">סוג רישום</option>
          <option value="employee">שם עובד</option>
          <option value="amount">כמות שעות/מפגשים</option>
        </select>
      </div>
      {sessions.length === 0 ? (
        <div className="text-center py-8 text-slate-500">
          <p>אין נתונים להצגה עבור המסננים שנבחרו</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          {groupBy === 'none' && (
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="text-right">עובד</TableHead>
                  <TableHead className="text-right">תאריך</TableHead>
                  <TableHead className="text-right">סוג רישום</TableHead>
                  <TableHead className="text-right">שעות/מפגשים</TableHead>
                  <TableHead className="text-right">תלמידים</TableHead>
                  <TableHead className="text-right">תעריף</TableHead>
                  <TableHead className="text-right">סה״כ תשלום</TableHead>
                  <TableHead className="text-right">הערות</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedSessions.map((session, index) => {
                  const employeeType = getEmployeeType(session.employee_id);
                  return (
                    <TableRow key={index} className="hover:bg-slate-50">
                      <TableCell className="font-medium">
                        {getEmployeeName(session.employee_id)}
                      </TableCell>
                      <TableCell>
                        {format(parseISO(session.date), 'dd/MM/yyyy', { locale: he })}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          style={{
                            background: `${getColorForService(session.service_id, getSessionTypeName(session))}15`, // subtle background
                            color: getColorForService(session.service_id, getSessionTypeName(session)),
                            border: `1.5px solid ${getColorForService(session.service_id, getSessionTypeName(session))}`,
                            whiteSpace: 'pre-line',
                            wordBreak: 'break-word',
                            maxWidth: 160,
                            display: 'inline-block',
                            fontWeight: 500,
                          }}
                        >
                          {getSessionTypeName(session)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {employeeType === 'hourly'
                          ? `${session.hours || 0} שעות`
                          : `${session.sessions_count || 0} מפגשים`
                        }
                      </TableCell>
                      <TableCell>
                        {session.students_count || '-'}
                      </TableCell>
                      <TableCell>
                        ₪{session.rate_used.toFixed(2)}
                      </TableCell>
                      <TableCell className="font-semibold">
                        ₪{session.total_payment.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {session.notes || '-'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          {groupBy !== 'none' && (
            sortedGroupEntries.map(([group, groupSessions]) => (
              <div key={group} className="mb-6">
                <div className="font-bold text-blue-700 mb-2 text-md">{groupBy === 'date' ? format(parseISO(group), 'dd/MM/yyyy', { locale: he }) : group}</div>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="text-right">עובד</TableHead>
                      {groupBy === 'date' ? null : <TableHead className="text-right">תאריך</TableHead>}
                      <TableHead className="text-right">סוג מפגש</TableHead>
                      <TableHead className="text-right">שעות/מפגשים</TableHead>
                      <TableHead className="text-right">תלמידים</TableHead>
                      <TableHead className="text-right">תעריף</TableHead>
                      <TableHead className="text-right">סה״כ תשלום</TableHead>
                      <TableHead className="text-right">הערות</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groupSessions.map((session, index) => {
                      const employeeType = getEmployeeType(session.employee_id);
                      return (
                        <TableRow key={index} className="hover:bg-slate-50">
                          <TableCell className="font-medium">
                            {getEmployeeName(session.employee_id)}
                          </TableCell>
                          {groupBy === 'date' ? null : (
                            <TableCell>
                              {format(parseISO(session.date), 'dd/MM/yyyy', { locale: he })}
                            </TableCell>
                          )}
                          <TableCell>
                            <Badge
                              variant="outline"
                              style={{
                                background: `${getColorForService(session.service_id, getSessionTypeName(session))}15`,
                                color: getColorForService(session.service_id, getSessionTypeName(session)),
                                border: `1.5px solid ${getColorForService(session.service_id, getSessionTypeName(session))}`,
                                whiteSpace: 'pre-line',
                                wordBreak: 'break-word',
                                maxWidth: 160,
                                display: 'inline-block',
                                fontWeight: 500,
                              }}
                            >
                              {getSessionTypeName(session)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {employeeType === 'hourly'
                              ? `${session.hours || 0} שעות`
                              : `${session.sessions_count || 0} מפגשים`
                            }
                          </TableCell>
                          <TableCell>
                            {session.students_count || '-'}
                          </TableCell>
                          <TableCell>
                            ₪{session.rate_used.toFixed(2)}
                          </TableCell>
                          <TableCell className="font-semibold">
                            ₪{session.total_payment.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-sm text-slate-600">
                            {session.notes || '-'}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ))
          )}
        </div>
      )}
      {sessions.length > 0 && (
        <div className="flex justify-end mt-4 p-4 bg-slate-50 rounded-lg">
          <div className="text-left">
            <p className="text-sm text-slate-600">סה״כ רישומים: {sessions.length}</p>
            <p className="text-lg font-semibold text-slate-900">
              סה״כ תשלום: ₪{sessions.reduce((sum, s) => sum + s.total_payment, 0).toLocaleString()}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}