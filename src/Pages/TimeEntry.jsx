import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, ListChecks } from "lucide-react";
import TimeEntryForm from "../components/time-entry/TimeEntryForm";
import RecentEntries from "../components/time-entry/RecentEntries";
import { toast } from "sonner";
import { supabase } from "../supabaseClient";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

export default function TimeEntry() {
  const [employees, setEmployees] = useState([]);
  const [services, setServices] = useState([]);
  const [rateHistories, setRateHistories] = useState([]);
  const [recentSessions, setRecentSessions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);

  useEffect(() => { loadInitialData(); }, []);

  const loadInitialData = async () => {
    setIsLoading(true);
    try {
      const [employeesData, sessionsData, ratesData, servicesData] = await Promise.all([
        supabase.from('Employees').select('*').eq('is_active', true).order('name'),
        supabase.from('WorkSessions').select('*, service:service_id(name)').order('id', { ascending: false }).limit(5),
        supabase.from('RateHistory').select('*'),
        supabase.from('Services').select('*')
      ]);

      if (employeesData.error) throw employeesData.error;
      if (sessionsData.error) throw sessionsData.error;
      if (ratesData.error) throw ratesData.error;
      if (servicesData.error) throw servicesData.error;
      
      setEmployees(employeesData.data || []);
      setRecentSessions(sessionsData.data || []);
      setRateHistories(ratesData.data || []);
      setServices(servicesData.data || []);
    } catch (error) { toast.error("שגיאה בטעינת הנתונים"); }
    setIsLoading(false);
  };

  const getRateForDate = (employeeId, date, serviceId = null) => {
    const employee = employees.find(e => e.id === employeeId);
    if (!employee) return 0;
    if (employee.employee_type === 'hourly') return employee.current_rate || 0;

    const relevantRates = rateHistories
      .filter(r => r.employee_id === employeeId && r.service_id === serviceId && new Date(r.effective_date) <= new Date(date))
      .sort((a, b) => new Date(b.effective_date) - new Date(a.effective_date));
    
    return relevantRates.length > 0 ? relevantRates[0].rate : 0;
  };

  const handleSessionSubmit = async (rows) => {
    try {
      const employee = employees.find(e => e.id === selectedEmployeeId);
      if (!employee) throw new Error("Employee not found");

      const sessionsToInsert = rows.map(row => {
        let rateUsed = getRateForDate(employee.id, row.date, row.service_id);
        let totalPayment = 0;
        
        if (employee.employee_type === 'hourly') {
          totalPayment = (parseFloat(row.hours) || 0) * rateUsed;
        } else {
          const service = services.find(s => s.id === row.service_id);
          if (!service) return null;
          if (service.payment_model === 'per_student') {
            totalPayment = (parseInt(row.sessions_count) || 0) * (parseInt(row.students_count) || 0) * rateUsed;
          } else {
            totalPayment = (parseInt(row.sessions_count) || 0) * rateUsed;
          }
        }
        
        return {
          employee_id: employee.id, date: row.date, service_id: row.service_id || null,
          hours: parseFloat(row.hours) || null,
          sessions_count: parseInt(row.sessions_count) || null,
          students_count: parseInt(row.students_count) || null,
          notes: row.notes, rate_used: rateUsed, total_payment: totalPayment,
        };
      }).filter(Boolean);

      if (sessionsToInsert.length === 0) { toast.error("לא נמצאו רישומים תקינים לשמירה."); return; }
      
      const { error } = await supabase.from('WorkSessions').insert(sessionsToInsert);
      if (error) throw error;

      toast.success(`${sessionsToInsert.length} רישומים נשמרו בהצלחה!`);
      loadInitialData();
    } catch (error) {
      console.error("Error submitting sessions:", error);
      toast.error(`שגיאה בשמירת הרישומים: ${error.message}`);
    }
  };
  
  const selectedEmployee = employees.find(e => e.id === selectedEmployeeId);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">רישום זמנים</h1>
          <p className="text-slate-600">הזן שעות עבודה או מפגשים עבור העובדים</p>
        </div>
        <div className="grid lg:grid-cols-5 gap-8">
          <div className="lg:col-span-3">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Clock /> הזנת רישום חדש</CardTitle></CardHeader>
              <CardContent className="p-6">
                <div className="space-y-2 mb-6">
                  <Label>עבור מי הרישום?</Label>
                  {isLoading ? <Skeleton className="h-10 w-full" /> : (
                    <Select onValueChange={setSelectedEmployeeId}>
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
                    onCancel={() => setSelectedEmployeeId(null)}
                    getRateForDate={getRateForDate}
                  />
                )}
              </CardContent>
            </Card>
          </div>
          <div className="lg:col-span-2">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><ListChecks /> רישומים אחרונים</CardTitle></CardHeader>
              <CardContent className="p-6">
                <RecentEntries sessions={recentSessions} employees={employees} isLoading={isLoading} />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}