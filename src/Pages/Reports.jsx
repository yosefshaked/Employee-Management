import React, { useState, useEffect, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoTooltip } from "../components/InfoTooltip";
import { Button } from "@/components/ui/button";
import { BarChart3, Download, Calendar, TrendingUp } from "lucide-react";
import { format, endOfMonth, startOfMonth } from "date-fns";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "../supabaseClient";

import ReportsFilters from "../components/reports/ReportsFilters";
import { parseDateStrict, toISODateString, isValidRange } from '@/lib/date.js';
import DetailedEntriesReport from "../components/reports/DetailedEntriesReport";
import MonthlyReport from "../components/reports/MonthlyReport";
import PayrollSummary from "../components/reports/PayrollSummary";
import ChartsOverview from "../components/reports/ChartsOverview";
import { computePeriodTotals } from '@/lib/payroll.js';

const GENERIC_RATE_SERVICE_ID = '00000000-0000-0000-0000-000000000000';

export default function Reports() {
  const [employees, setEmployees] = useState([]);
  const [workSessions, setWorkSessions] = useState([]);
  const [services, setServices] = useState([]);
  const [filteredSessions, setFilteredSessions] = useState([]);
  const [totals, setTotals] = useState({ totalPay: 0, totalHours: 0, totalSessions: 0, totalsByEmployee: [] });
  const [isLoading, setIsLoading] = useState(true);
  const location = useLocation(); // מאפשר לנו לגשת למידע על הכתובת הנוכחית
  const [activeTab, setActiveTab] = useState(location.state?.openTab || "overview");
  const [rateHistories, setRateHistories] = useState([]);

  const getRateForDate = (employeeId, date, serviceId = null) => {
    const employee = employees.find(e => e.id === employeeId);
    if (!employee) return { rate: 0, reason: 'אין עובד כזה' };

    const targetServiceId = (employee.employee_type === 'hourly' || employee.employee_type === 'global')
      ? GENERIC_RATE_SERVICE_ID
      : serviceId;

    const dateStr = format(new Date(date), 'yyyy-MM-dd');

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

  const [filters, setFilters] = useState({
    selectedEmployee: '',
    dateFrom: format(startOfMonth(new Date()), 'dd/MM/yyyy'),
    dateTo: format(new Date(), 'dd/MM/yyyy'),
    employeeType: 'all',
    serviceId: 'all',
  });
  const [dateErrors, setDateErrors] = useState({ dateFrom: null, dateTo: null, range: null });

  const handleDateBlur = (key, value) => {
    const res = parseDateStrict(value);
    setDateErrors(prev => ({ ...prev, [key]: res.ok ? null : 'תאריך לא תקין. פורמט תקין: 30/09/2025' }));
  };

  const applyFilters = useCallback(() => {
    const fromRes = parseDateStrict(filters.dateFrom);
    const toRes = parseDateStrict(filters.dateTo);
    if (!fromRes.ok || !toRes.ok) {
      setFilteredSessions([]);
      setTotals({ totalPay: 0, totalHours: 0, totalSessions: 0, totalsByEmployee: [] });
      return;
    }
    if (!isValidRange(fromRes.date, toRes.date)) {
      setDateErrors(prev => ({ ...prev, range: "טווח תאריכים לא תקין (תאריך 'עד' לפני 'מ')" }));
      setFilteredSessions([]);
      setTotals({ totalPay: 0, totalHours: 0, totalSessions: 0, totalsByEmployee: [] });
      return;
    }
    setDateErrors(prev => ({ ...prev, range: null }));
    const res = computePeriodTotals({
      workSessions,
      employees,
      services,
      startDate: toISODateString(fromRes.date),
      endDate: toISODateString(toRes.date),
      serviceFilter: filters.serviceId,
      employeeFilter: filters.selectedEmployee,
      employeeTypeFilter: filters.employeeType
    });
    setFilteredSessions(res.filteredSessions);
    setTotals({
      totalPay: res.totalPay,
      totalHours: res.totalHours,
      totalSessions: res.totalSessions,
      totalsByEmployee: res.totalsByEmployee
    });
  }, [workSessions, employees, services, filters, setDateErrors]);

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [applyFilters]);

  const loadInitialData = async () => {
    setIsLoading(true);
    try {
      const [employeesData, sessionsData, servicesData, ratesData] = await Promise.all([
        supabase.from('Employees').select('*').order('name'),
        supabase.from('WorkSessions').select('*'),
        supabase.from('Services').select('*'),
        supabase.from('RateHistory').select('*')
      ]);

      if (employeesData.error) throw employeesData.error;
      if (sessionsData.error) throw sessionsData.error;
      if (servicesData.error) throw servicesData.error;
      if (ratesData.error) throw ratesData.error;

      setEmployees(employeesData.data || []);
      setWorkSessions(sessionsData.data || []);
      setServices(servicesData.data || []);
      setRateHistories(ratesData.data || []);
    } catch (error) {
      console.error("Error loading data:", error);
    }
    setIsLoading(false);
  };

  const getServiceName = (serviceId) => {
    const service = services.find(s => s.id === serviceId);
    return service ? service.name : 'עבודה שעתית';
  };

  const exportToExcel = () => {
      const exportData = [...filteredSessions]       // copy so the original array isn’t mutated
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .map(session => {
        const employee = employees.find(emp => emp.id === session.employee_id);
        return {
          'שם העובד': employee ? employee.name : 'לא ידוע',
          'תאריך': session.date,
          'שירות': getServiceName(session.service_id),
          'שעות': session.hours || '',
          'מפגשים': session.sessions_count || '',
          'תלמידים': session.students_count || '',
          'תעריף': session.rate_used,
          'סה"כ תשלום': session.total_payment,
          'הערות': session.notes || ''
        };
      });

      if (exportData.length === 0) return;

      const headers = Object.keys(exportData[0]);
      const csvContent = [
        headers.join(','),
        ...exportData.map(row => headers.map(header => `"${row[header] || ''}"`).join(','))
      ].join('\n');

      const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `דוח_שכר_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    };

  // Show a warning when the selected range is a partial month
  const fromDate = new Date(filters.dateFrom);
  const toDate = new Date(filters.dateTo);
  const isPartialRange = fromDate.getDate() !== 1 || toDate.getDate() !== endOfMonth(toDate).getDate();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 mb-2">דוחות ונתונים</h1>
            <p className="text-slate-600">צפה בדוחות מפורטים על עבודת העובדים והתשלומים</p>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={exportToExcel} disabled={filteredSessions.length === 0}>
              <Download className="w-4 h-4 ml-2" />
              יצוא לאקסל
            </Button>
          </div>
        </div>

        {isPartialRange && (
          <div className="mb-4 p-3 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-sm">
            שים לב: נבחר טווח חלקי של חודש. הסיכומים מתבססים רק על הרישומים שבטווח שנבחר.
          </div>
        )}
        <ReportsFilters
          filters={filters}
          setFilters={setFilters}
          employees={employees}
          services={services}
          errors={dateErrors}
          onDateBlur={handleDateBlur}
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card className="bg-white/70 backdrop-blur-sm border-0 shadow-lg">
            <CardContent className="p-6 flex items-center gap-4 relative">
              <div className="absolute left-4 top-4"><InfoTooltip text={"סה\"כ תשלום הוא הסכום הכולל ששולם לכל העובדים בתקופת הדוח.\nהסכום מחושב לפי תעריף העובד וסוג העבודה (שעות או מפגשים)."} /></div>
              <div className="p-3 bg-green-100 rounded-lg"><BarChart3 className="w-6 h-6 text-green-600" /></div>
              <div><p className="text-sm text-slate-600">סה״כ תשלום</p><p className="text-2xl font-bold text-slate-900">₪{totals.totalPay.toLocaleString()}</p></div>
            </CardContent>
          </Card>
          <Card className="bg-white/70 backdrop-blur-sm border-0 shadow-lg">
            <CardContent className="p-6 flex items-center gap-4 relative">
              <div className="absolute left-4 top-4"><InfoTooltip text={"סה\"כ שעות הוא סך כל השעות שעובדים עבדו בתקופת הדוח.\nלעובדים שעתיים - נספרות שעות בפועל.\nלמדריכים - השעות מחושבות לפי מספר מפגשים וזמן מפגש."} /></div>
              <div className="p-3 bg-blue-100 rounded-lg"><Calendar className="w-6 h-6 text-blue-600" /></div>
              <div><p className="text-sm text-slate-600">סה״כ שעות (מוערך)</p><p className="text-2xl font-bold text-slate-900">{totals.totalHours.toFixed(1)}</p></div>
            </CardContent>
          </Card>
          <Card className="bg-white/70 backdrop-blur-sm border-0 shadow-lg">
            <CardContent className="p-6 flex items-center gap-4 relative">
              <div className="absolute left-4 top-4"><InfoTooltip text={"סה\"כ מפגשים הוא מספר כל המפגשים שנערכו בתקופת הדוח.\nלעובדים שעתיים - לא נספרים מפגשים.\nלמדריכים - נספרים כל המפגשים שבוצעו בפועל."} /></div>
              <div className="p-3 bg-purple-100 rounded-lg"><TrendingUp className="w-6 h-6 text-purple-600" /></div>
              <div><p className="text-sm text-slate-600">סה״כ מפגשים</p><p className="text-2xl font-bold text-slate-900">{totals.totalSessions}</p></div>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-white/70 backdrop-blur-sm border-0 shadow-lg">
          <CardHeader className="p-6 border-b">
            <CardTitle className="text-xl font-bold text-slate-900">דוחות מפורטים</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-4 mb-6">
                <TabsTrigger value="overview">סקירה כללית</TabsTrigger>
                <TabsTrigger value="employee">פירוט הרישומים</TabsTrigger>
                <TabsTrigger value="monthly">דוח חודשי</TabsTrigger>
                <TabsTrigger value="payroll">דוח שכר</TabsTrigger>
              </TabsList>
              <TabsContent value="overview"><ChartsOverview sessions={filteredSessions} employees={employees} services={services} workSessions={workSessions} dateFrom={filters.dateFrom} dateTo={filters.dateTo} isLoading={isLoading} /></TabsContent>
              <TabsContent value="employee"><DetailedEntriesReport sessions={filteredSessions} employees={employees} services={services} rateHistories={rateHistories} isLoading={isLoading} /></TabsContent>
              <TabsContent value="monthly"><MonthlyReport sessions={filteredSessions} employees={employees} services={services} workSessions={workSessions} isLoading={isLoading} /></TabsContent>
              <TabsContent value="payroll"><PayrollSummary sessions={filteredSessions} employees={employees} services={services} getRateForDate={getRateForDate} isLoading={isLoading} employeeTotals={totals.totalsByEmployee} /></TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
