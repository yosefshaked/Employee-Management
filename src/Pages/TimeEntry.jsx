import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock } from "lucide-react";
import TimeEntryForm from "../components/time-entry/TimeEntryForm";
import RecentActivity from "../components/dashboard/RecentActivity";
import TimeEntryTable from '../components/time-entry/TimeEntryTable';
import { toast } from "sonner";
import { supabase } from "../supabaseClient";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format, getDaysInMonth } from "date-fns";

const GENERIC_RATE_SERVICE_ID = '00000000-0000-0000-0000-000000000000';

export default function TimeEntry() {
  const [employees, setEmployees] = useState([]);
  const [services, setServices] = useState([]);
  const [rateHistories, setRateHistories] = useState([]);
  const [workSessions, setWorkSessions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);
  const [viewMode, setViewMode] = useState('form');

  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    setIsLoading(true);
    try {
      const [employeesData, sessionsData, ratesData, servicesData] = await Promise.all([
        supabase.from('Employees').select('*').eq('is_active', true).order('name'),
        supabase.from('WorkSessions').select('*, service:service_id(name)').order('created_at', { ascending: false }),
        supabase.from('RateHistory').select('*'),
        supabase.from('Services').select('*')
      ]);

      if (employeesData.error) throw employeesData.error;
      if (sessionsData.error) throw sessionsData.error;
      if (ratesData.error) throw ratesData.error;
      if (servicesData.error) throw servicesData.error;
      
      setEmployees(employeesData.data || []);
      setWorkSessions(sessionsData.data || []);
      setRateHistories(ratesData.data || []);
      setServices(servicesData.data || []);
    } catch (error) { 
      console.error("Error loading data:", error);
      toast.error("שגיאה בטעינת הנתונים"); 
    }
    setIsLoading(false);
  };

  const getRateForDate = (employeeId, date, serviceId = null) => {
    const employee = employees.find(e => e.id === employeeId);
    if (!employee) return { rate: 0, reason: 'אין עובד כזה' };

    const targetServiceId = (employee.employee_type === 'hourly' || employee.employee_type === 'global')
      ? GENERIC_RATE_SERVICE_ID
      : serviceId;

    const dateStr = format(new Date(date), 'yyyy-MM-dd');

    // Check if the employee's start date is after the requested date
    if (employee.start_date && employee.start_date > dateStr) {
      return { rate: 0, reason: 'לא התחילו לעבוד עדיין' };
    }

    const relevantRates = rateHistories
      .filter(r =>
        r.employee_id === employeeId &&
        r.service_id === targetServiceId &&
        r.effective_date <= dateStr
      )
      .sort((a, b) => new Date(b.effective_date) - new Date(a.effective_date));
    
    if (relevantRates.length > 0) {
      return {
        rate: relevantRates[0].rate,
        effectiveDate: relevantRates[0].effective_date
      };
    }
    
    return { rate: 0, reason: 'לא הוגדר תעריף' };
  };

  const handleSessionSubmit = async (rows) => {
    try {
      const employee = employees.find(e => e.id === selectedEmployeeId);
      if (!employee) throw new Error("Employee not found");

      const sessionsToInsert = rows.map(row => {
        const isHourlyOrGlobal = employee.employee_type === 'hourly' || employee.employee_type === 'global';
        const serviceIdForRate = isHourlyOrGlobal ? GENERIC_RATE_SERVICE_ID : row.service_id;

        if (employee.employee_type === 'hourly') {
          const hoursValue = parseFloat(row.hours);
          if (isNaN(hoursValue) || hoursValue <= 0) {
            toast.error("יש להזין מספר שעות גדול מ-0.", { duration: 15000 });
            return null;
          }
        } else if (employee.employee_type === 'instructor') {
          if (!row.service_id) {
            toast.error("חובה לבחור שירות.", { duration: 15000 });
            return null;
          }
          const sessionsValue = parseInt(row.sessions_count, 10);
          if (isNaN(sessionsValue) || sessionsValue <= 0) {
            toast.error("יש להזין כמות מפגשים גדולה מ-0.", { duration: 15000 });
            return null;
          }
          const service = services.find(s => s.id === row.service_id);
          if (service && service.payment_model === 'per_student') {
            const studentsValue = parseInt(row.students_count, 10);
            if (isNaN(studentsValue) || studentsValue <= 0) {
              toast.error(`חובה להזין מספר תלמידים (גדול מ-0) עבור "${service.name}"`, { duration: 15000 });
              return null;
            }
          }
        }

        const { rate: rateUsed, reason } = getRateForDate(employee.id, row.date, serviceIdForRate);
        if (!rateUsed) {
          toast.error(reason || 'לא הוגדר תעריף עבור תאריך זה', { duration: 15000 });
          return null;
        }

        let totalPayment = 0;
        if (employee.employee_type === 'hourly') {
          totalPayment = (parseFloat(row.hours) || 0) * rateUsed;
        } else if (employee.employee_type === 'global') {
          totalPayment = rateUsed / getDaysInMonth(new Date(row.date));
        } else {
          const service = services.find(s => s.id === row.service_id);
          if (!service) return null;
          if (service.payment_model === 'per_student') {
            totalPayment = (parseInt(row.sessions_count) || 0) * (parseInt(row.students_count) || 0) * rateUsed;
          } else {
            totalPayment = (parseInt(row.sessions_count) || 0) * rateUsed;
          }
        }

        const entryType = isHourlyOrGlobal ? 'hours' : 'session';

        return {
          employee_id: employee.id,
          date: row.date,
          entry_type: entryType,
          service_id: isHourlyOrGlobal ? null : row.service_id,
          hours: isHourlyOrGlobal ? (parseFloat(row.hours) || null) : null,
          sessions_count: employee.employee_type === 'instructor' ? (parseInt(row.sessions_count) || null) : null,
          students_count: employee.employee_type === 'instructor' ? (parseInt(row.students_count) || null) : null,
          notes: row.notes,
          rate_used: rateUsed,
          total_payment: totalPayment,
        };
      }).filter(Boolean);

      if (sessionsToInsert.length === 0) {
        toast.error("לא נמצאו רישומים תקינים לשמירה.");
        return;
      }

      const { error } = await supabase.from('WorkSessions').insert(sessionsToInsert);
      if (error) throw error;

      toast.success(`${sessionsToInsert.length} רישומים נשמרו בהצלחה!`);
      loadInitialData();
      setSelectedEmployeeId(null);
    } catch (error) {
      console.error("Error submitting sessions:", error);
      toast.error(`שגיאה בשמירת הרישומים: ${error.message}`);
    }
  };

  const handleTableSubmit = async ({ employee, day, updatedRows }) => {
    setIsLoading(true);
    try {
      const sessionsToProcess = updatedRows.map(row => {
        const isHourlyOrGlobal = employee.employee_type === 'hourly' || employee.employee_type === 'global';
        const hoursValue = parseFloat(row.hours);
        const studentsValue = parseInt(row.students_count, 10);
        const sessionsValue = parseInt(row.sessions_count, 10);

        if (employee.employee_type === 'hourly') {
          if (isNaN(hoursValue) || hoursValue <= 0) {
            toast.error("יש להזין מספר שעות גדול מ-0.", { duration: 15000 });
            return 'validation_error';
          }
        } else if (employee.employee_type === 'instructor') {
          if (!row.service_id) return null;
          if (isNaN(sessionsValue) || sessionsValue <= 0) {
            toast.error("יש להזין כמות מפגשים גדולה מ-0.", { duration: 15000 });
            return 'validation_error';
          }
          const service = services.find(s => s.id === row.service_id);
          if (service && service.payment_model === 'per_student') {
            if (isNaN(studentsValue) || studentsValue <= 0) {
              toast.error(`חובה להזין מספר תלמידים (גדול מ-0) עבור "${service.name}"`, { duration: 15000 });
              return 'validation_error';
            }
          }
        }

        const { rate: rateUsed, reason } = getRateForDate(employee.id, day, isHourlyOrGlobal ? GENERIC_RATE_SERVICE_ID : row.service_id);
        if (!rateUsed) {
          toast.error(reason || 'לא הוגדר תעריף עבור תאריך זה', { duration: 15000 });
          return 'validation_error';
        }
        let totalPayment = 0;

        if (employee.employee_type === 'hourly') {
          totalPayment = (parseFloat(row.hours) || 0) * rateUsed;
        } else if (employee.employee_type === 'global') {
          totalPayment = rateUsed / getDaysInMonth(day);
        } else {
          const service = services.find(s => s.id === row.service_id);
          if (!service) return null;
          if (service.payment_model === 'per_student') {
            totalPayment = (parseInt(row.sessions_count, 10) || 1) * (parseInt(row.students_count, 10) || 0) * rateUsed;
          } else {
            totalPayment = (parseInt(row.sessions_count, 10) || 1) * rateUsed;
          }
        }

        const sessionData = {
          employee_id: employee.id,
          date: format(row.date, 'yyyy-MM-dd'),
          notes: row.notes || '',
          rate_used: rateUsed,
          total_payment: totalPayment,
        };

        if (!row.isNew && row.id) {
          sessionData.id = row.id;
        }

        if (isHourlyOrGlobal) {
          sessionData.entry_type = 'hours';
          sessionData.hours = parseFloat(row.hours) || 0;
          sessionData.service_id = GENERIC_RATE_SERVICE_ID;
          sessionData.sessions_count = null;
          sessionData.students_count = null;
        } else {
          sessionData.entry_type = 'session';
          sessionData.hours = null;
          sessionData.service_id = row.service_id;
          sessionData.sessions_count = parseInt(row.sessions_count, 10) || 1;
          sessionData.students_count = parseInt(row.students_count, 10) || null;
        }
         
        return sessionData;

      }).filter(Boolean);

      if (sessionsToProcess.includes('validation_error')) {
        setIsLoading(false);
        return; // Stop the entire submission process
      }

      if (sessionsToProcess.length === 0) {
          toast.info("לא נמצאו רישומים חדשים או שינויים לשמירה.");
          setIsLoading(false);
          return;
      }

      const sessionsToInsert = sessionsToProcess.filter(s => !s.id);
      const sessionsToUpdate = sessionsToProcess.filter(s => s.id);

      if (sessionsToInsert.length > 0) {
        const { error: insertError } = await supabase.from('WorkSessions').insert(sessionsToInsert);
        if (insertError) throw insertError;
      }

      if (sessionsToUpdate.length > 0) {
        const { error: updateError } = await supabase.from('WorkSessions').upsert(sessionsToUpdate, { onConflict: 'id' });
        if (updateError) throw updateError;
      }

      toast.success(`הרישומים עודכנו בהצלחה!`);
      loadInitialData();

    } catch (error) {
      console.error("Error submitting from table:", error);
      toast.error(`שגיאה בעדכון הרישומים: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };
  
  const selectedEmployee = employees.find(e => e.id === selectedEmployeeId);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">רישום זמנים</h1>
          <p className="text-slate-600">הזן שעות עבודה או מפגשים עבור העובדים</p>
        </div>

        <Tabs value={viewMode} onValueChange={setViewMode} className="w-full">
          <div className="flex justify-center mb-4">
            <TabsList className="grid w-full sm:w-[280px] grid-cols-2">
              <TabsTrigger value="form">הזנה בטופס</TabsTrigger>
              <TabsTrigger value="table">הזנה בטבלה</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="form">
            <div className="grid lg:grid-cols-5 gap-8">
              <div className="lg:col-span-3">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-blue-500" /> הזנת רישום חדש
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="space-y-2 mb-6">
                  <Label>עבור מי הרישום?</Label>
                  {isLoading ? <Skeleton className="h-10 w-full" /> : (
                    <Select value={selectedEmployeeId || ''} onValueChange={setSelectedEmployeeId}>
                      <SelectTrigger><SelectValue placeholder="בחר עובד..." /></SelectTrigger>
                      <SelectContent>{employees.map(emp => (<SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>))}</SelectContent>
                    </Select>
                  )}
                </div>
                {selectedEmployee && (
                  <TimeEntryForm
                    employee={selectedEmployee}
                    services={services}
                    onSubmit={handleSessionSubmit}
                    getRateForDate={getRateForDate}
                  />
                )}
              </CardContent>
            </Card>
          </div>
          <div className="lg:col-span-2">
            <RecentActivity 
              title="רישומים אחרונים"
              sessions={workSessions.slice(0, 5)}
              employees={employees}
              services={services}
              isLoading={isLoading}
              showViewAllButton={true}
            />
          </div>
        </div>
          </TabsContent>

          <TabsContent value="table">
            <TimeEntryTable
              employees={employees}
              workSessions={workSessions}
              services={services}
              getRateForDate={getRateForDate}
              onTableSubmit={handleTableSubmit}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}