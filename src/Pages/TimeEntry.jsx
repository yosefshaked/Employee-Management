import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, ListChecks } from "lucide-react";
import TimeEntryForm from "../components/time-entry/TimeEntryForm";
import RecentEntries from "../components/time-entry/RecentEntries";
import { toast } from "sonner";
import { supabase } from "../supabaseClient";

export default function TimeEntry() {
  const [employees, setEmployees] = useState([]);
  const [rateHistories, setRateHistories] = useState([]);
  const [recentSessions, setRecentSessions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    setIsLoading(true);
    try {
      const [employeesData, sessionsData, ratesData] = await Promise.all([
        supabase.from('Employees').select('*').eq('is_active', true).order('name'),
        // === התיקון הסופי והנכון: מיון לפי id ===
        supabase.from('WorkSessions').select('*, Services(name)').order('date', { ascending: false }).limit(10),
        // ===========================================
        supabase.from('RateHistory').select('*')
      ]);

      if (employeesData.error) throw employeesData.error;
      if (sessionsData.error) throw sessionsData.error;
      if (ratesData.error) throw ratesData.error;

      setEmployees(employeesData.data);
      setRecentSessions(sessionsData.data);
      setRateHistories(ratesData.data);

    } catch (error) {
      console.error("Error loading data:", error);
      toast.error("שגיאה בטעינת הנתונים");
    }
    setIsLoading(false);
  };

  const getRateForDate = (employeeId, date, serviceId = null) => {
    const employee = employees.find(e => e.id === employeeId);
    if (!employee) return 0;
    
    if (employee.employee_type === 'hourly') {
        return employee.current_rate || 0;
    }

    const relevantRates = rateHistories
      .filter(r => 
        r.employee_id === employeeId && 
        r.service_id === serviceId &&
        new Date(r.effective_date) <= new Date(date)
      )
      .sort((a, b) => new Date(b.effective_date) - new Date(a.effective_date));
    
    if (relevantRates.length > 0) {
      return relevantRates[0].rate;
    }
    
    return 0;
  };

  const handleSessionSubmit = async (sessionData) => {
    try {
      let rateUsed = 0;
      let totalPayment = 0;
      const employee = employees.find(e => e.id === sessionData.employee_id);
      if (!employee) throw new Error("Employee not found");

      let finalSessionData = { ...sessionData };

      if (employee.employee_type === 'hourly') {
        rateUsed = getRateForDate(sessionData.employee_id, sessionData.date, null);
        totalPayment = (sessionData.hours || 0) * rateUsed;
        finalSessionData.service_id = null;
      } else {
        const { data: service } = await supabase.from('Services').select('*').eq('id', sessionData.service_id).single();
        if (!service) throw new Error("Service not found");

        rateUsed = getRateForDate(sessionData.employee_id, sessionData.date, sessionData.service_id);
        
        if (service.payment_model === 'per_student') {
          totalPayment = (sessionData.sessions_count || 0) * (sessionData.students_count || 0) * rateUsed;
        } else {
          totalPayment = (sessionData.sessions_count || 0) * rateUsed;
        }
        finalSessionData.hours = null;
      }

      finalSessionData.rate_used = rateUsed;
      finalSessionData.total_payment = totalPayment;

      // מוחקים את המפתח session_type אם הוא קיים בטעות
      delete finalSessionData.session_type;

      const { error } = await supabase.from('WorkSessions').insert([finalSessionData]);
      if (error) throw error;

      toast.success("רישום הזמן נשמר בהצלחה!");
      loadInitialData();
    } catch (error) {
      console.error("Error submitting session:", error);
      toast.error(`שגיאה בשמירת הרישום: ${error.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">רישום זמנים</h1>
          <p className="text-slate-600">הזן שעות עבודה או מפגשים עבור העובדים</p>
        </div>

        <div className="grid lg:grid-cols-5 gap-8">
          <div className="lg:col-span-3">
            <Card className="bg-white/70 backdrop-blur-sm border-0 shadow-lg">
              <CardHeader className="p-6 border-b">
                <CardTitle className="flex items-center gap-2 text-xl font-bold text-slate-900">
                  <Clock className="w-5 h-5 text-blue-500" />
                  הזנת רישום חדש
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <TimeEntryForm
                  employees={employees}
                  onSubmit={handleSessionSubmit}
                  isLoading={isLoading}
                  getRateForDate={getRateForDate}
                />
              </CardContent>
            </Card>
          </div>
          <div className="lg:col-span-2">
            <Card className="bg-white/70 backdrop-blur-sm border-0 shadow-lg">
              <CardHeader className="p-6 border-b">
                <CardTitle className="flex items-center gap-2 text-xl font-bold text-slate-900">
                  <ListChecks className="w-5 h-5 text-green-500" />
                  רישומים אחרונים
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <RecentEntries
                  sessions={recentSessions}
                  employees={employees}
                  isLoading={isLoading}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}