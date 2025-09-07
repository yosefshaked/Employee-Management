import React, { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { format, parseISO } from "date-fns";
import { he } from "date-fns/locale";
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getColorForService } from '@/lib/colorUtils';

export default function DetailedEntriesReport({ sessions, employees, services, isLoading }) {
  const [groupBy, setGroupBy] = useState('none');

  if (isLoading) {
    return <Skeleton className="h-60 w-full" />;
  }

  const getEmployee = (employeeId) => employees.find(emp => emp.id === employeeId);
  
  const getServiceName = (session) => {
    const employee = getEmployee(session.employee_id);
    if (employee?.employee_type === 'hourly' || employee?.employee_type === 'global') return 'שעות עבודה';
    const service = services.find(s => s.id === session.service_id);
    return service ? service.name : 'שירות לא ידוע';
  };
  
  const sortedSessions = [...sessions].sort((a, b) => new Date(b.date) - new Date(a.date));

  // --- לוגיקת הקיבוץ ---
  const groupedSessions = sortedSessions.reduce((acc, session) => {
    let key;
    if (groupBy === 'date') key = session.date;
    else if (groupBy === 'service') key = getServiceName(session);
    else if (groupBy === 'employee') key = getEmployee(session.employee_id)?.name || 'לא ידוע';
    
    if (key && groupBy !== 'none') {
      if (!acc[key]) acc[key] = [];
      acc[key].push(session);
    }
    return acc;
  }, {});
  const sortedGroupEntries = Object.entries(groupedSessions);

  const renderSessionRow = (session) => (
    <TableRow key={session.id} className="hover:bg-slate-50">
      <TableCell className="font-medium">{getEmployee(session.employee_id)?.name || 'לא ידוע'}</TableCell>
      <TableCell>{format(parseISO(session.date), 'dd/MM/yyyy', { locale: he })}</TableCell>
      <TableCell>
        <Badge
          variant="outline"
          className="font-medium"
          style={{
            backgroundColor: `${getColorForService(getEmployee(session.employee_id)?.employee_type === 'hourly' ? null : session.service_id)}20`,
            color: getColorForService(getEmployee(session.employee_id)?.employee_type === 'hourly' ? null : session.service_id),
            borderColor: getColorForService(getEmployee(session.employee_id)?.employee_type === 'hourly' ? null : session.service_id),
          }}
        >
          {getServiceName(session)}
        </Badge>
      </TableCell>
        <TableCell>
          {(getEmployee(session.employee_id)?.employee_type === 'hourly' || getEmployee(session.employee_id)?.employee_type === 'global') ? `${session.hours || 0} שעות` : `${session.sessions_count || 0} מפגשים`}
        </TableCell>
      <TableCell>{session.students_count || '-'}</TableCell>
      <TableCell>₪{session.rate_used?.toFixed(2) || '0.00'}</TableCell>
      <TableCell className="font-semibold">₪{session.total_payment?.toFixed(2) || '0.00'}</TableCell>
      <TableCell className="text-sm text-slate-600">{session.notes || '-'}</TableCell>
    </TableRow>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">רישומי עבודה מפורטים</h3>
        <div className="flex gap-2 items-center">
          <Label className="text-sm font-medium text-slate-600">קבץ לפי:</Label>
          <Select onValueChange={setGroupBy} defaultValue="none">
            <SelectTrigger className="w-[180px] bg-white border-slate-300"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">ללא קיבוץ</SelectItem>
              <SelectItem value="date">תאריך</SelectItem>
              <SelectItem value="service">סוג רישום</SelectItem>
              <SelectItem value="employee">שם עובד</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      
      {sessions.length === 0 ? (
        <div className="text-center py-8 text-slate-500"><p>אין נתונים להצגה עבור המסננים שנבחרו</p></div>
      ) : (
        <div className="overflow-x-auto border rounded-lg bg-white">
          {groupBy === 'none' ? (
            <Table>
              <TableHeader><TableRow className="bg-slate-50 hover:bg-slate-50"><TableHead>עובד</TableHead><TableHead>תאריך</TableHead><TableHead>סוג רישום</TableHead><TableHead>כמות</TableHead><TableHead>תלמידים</TableHead><TableHead>תעריף</TableHead><TableHead>סה״כ</TableHead><TableHead>הערות</TableHead></TableRow></TableHeader>
              <TableBody>{sortedSessions.map(session => renderSessionRow(session))}</TableBody>
            </Table>
          ) : (
            sortedGroupEntries.map(([group, groupSessions]) => (
              <div key={group} className="mb-2">
                <h4 className="font-bold text-base p-2 bg-slate-100 border-b border-t">{group} ({groupSessions.length} רישומים)</h4>
                <Table>
                  <TableBody>{groupSessions.map(session => renderSessionRow(session))}</TableBody>
                </Table>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}