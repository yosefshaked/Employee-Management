import React, { useState, useEffect } from 'react';

// === הוספה: מייבאים את הלקוח של Supabase ===
import { supabase } from '../supabaseClient';

// ייבוא הקומפוננטות של הדשבורד
import QuickStats from '../components/dashboard/QuickStats';
import MonthlyCalendar from '../components/dashboard/MonthlyCalendar';
import RecentActivity from '../components/dashboard/RecentActivity';
import { toast } from "sonner";

export default function Dashboard() {
  const [employees, setEmployees] = useState([]);
  const [workSessions, setWorkSessions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());

  // טעינת הנתונים הראשוניים מהשרת
  const loadData = async () => {
    setIsLoading(true);
    try {
      // === החלפה: קוראים ל-Supabase במקום ל-Entities ===
      const [employeesData, sessionsData] = await Promise.all([
        supabase.from('Employees').select('*').eq('is_active', true),
        supabase.from('WorkSessions').select('*').order('date', { ascending: false }).limit(100) // טוענים 100 רישומים אחרונים
      ]);

      if (employeesData.error) throw employeesData.error;
      if (sessionsData.error) throw sessionsData.error;

      setEmployees(employeesData.data);
      setWorkSessions(sessionsData.data);

    } catch (error) {
      console.error("Error loading dashboard data:", error);
      toast.error("שגיאה בטעינת נתוני הדשבורד");
    }
    setIsLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []); // ריצה פעם אחת בלבד כשהקומפוננטה עולה

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">לוח בקרה</h1>
          <p className="text-slate-600">סקירה כללית של הפעילות במערכת</p>
        </div>

        {/* קומפוננטת סטטיסטיקות מהירות */}
        <QuickStats 
          employees={employees} 
          workSessions={workSessions}
          currentDate={currentDate}
          isLoading={isLoading} 
        />
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* קומפוננטת לוח שנה חודשי */}
          <div className="lg:col-span-2">
            <MonthlyCalendar 
              currentDate={currentDate}
              setCurrentDate={setCurrentDate}
              workSessions={workSessions}
              employees={employees}
              isLoading={isLoading}
            />
          </div>
          
          {/* קומפוננטת פעילות אחרונה */}
          <div className="lg:col-span-1">
            <RecentActivity 
              workSessions={workSessions}
              employees={employees}
              isLoading={isLoading}
            />
          </div>
        </div>
      </div>
    </div>
  );
}