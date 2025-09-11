import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoTooltip } from "../components/InfoTooltip";
import { Button } from "@/components/ui/button";
import { BarChart3, Download, Calendar, TrendingUp } from "lucide-react";
import { format, parseISO, startOfMonth, endOfMonth, eachMonthOfInterval } from "date-fns";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "../supabaseClient";

import ReportsFilters from "../components/reports/ReportsFilters";
import DetailedEntriesReport from "../components/reports/DetailedEntriesReport";
import MonthlyReport from "../components/reports/MonthlyReport";
import PayrollSummary from "../components/reports/PayrollSummary";
import ChartsOverview from "../components/reports/ChartsOverview";

const GENERIC_RATE_SERVICE_ID = '00000000-0000-0000-0000-000000000000';

export default function Reports() {
  const [employees, setEmployees] = useState([]);
  const [workSessions, setWorkSessions] = useState([]);
  const [services, setServices] = useState([]);
  const [filteredSessions, setFilteredSessions] = useState([]);
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

  const formatDateLocal = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const [filters, setFilters] = useState({
    selectedEmployee: '',
    dateFrom: formatDateLocal(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
    dateTo: formatDateLocal(new Date()),
    employeeType: 'all',
    serviceId: 'all',
  });

  const visibleEmployeeIds = useMemo(() => {
    if (filters.selectedEmployee) return new Set([filters.selectedEmployee]);
    const relevant = filters.employeeType === 'all'
      ? employees
      : employees.filter(e => e.employee_type === filters.employeeType);
    return new Set(relevant.map(e => e.id));
  }, [filters.selectedEmployee, filters.employeeType, employees]);

  const applyFilters = useCallback(() => {
    let filtered = workSessions.filter(ws => visibleEmployeeIds.has(ws.employee_id));
    if (filters.serviceId !== 'all') {
      filtered = filtered.filter(session => session.service_id === filters.serviceId);
    }
    filtered = filtered.filter(session => {
      const sessionDate = new Date(session.date);
      const fromDate = new Date(filters.dateFrom);
      const toDate = new Date(filters.dateTo);
      if (sessionDate < fromDate || sessionDate > toDate) return false;
      const emp = employees.find(e => e.id === session.employee_id);
      return !emp || !emp.start_date || session.date >= emp.start_date;
    });
    setFilteredSessions(filtered);
  }, [workSessions, filters, employees, visibleEmployeeIds]);

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

  const filteredWorkSessions = useMemo(
    () => workSessions.filter(ws => visibleEmployeeIds.has(ws.employee_id)),
    [workSessions, visibleEmployeeIds]
  );

  const scopedEmployeeIds = useMemo(() => {
    const ids = new Set(filteredWorkSessions.map(ws => ws.employee_id));
    if (filters.selectedEmployee) {
      ids.add(filters.selectedEmployee);
    }
    return ids;
  }, [filteredWorkSessions, filters.selectedEmployee]);

  const getTotals = () => {
    let payment = 0;
    let hours = 0;
    let sessionsCount = 0;

    filteredSessions.forEach(session => {
      const employee = employees.find(e => e.id === session.employee_id);
      if (!employee) return;

      if (session.entry_type === 'adjustment') {
        payment += session.total_payment || 0;
        return;
      }

      if (employee.employee_type === 'instructor') {
        const service = services.find(s => s.id === session.service_id);
        const rate = getRateForDate(employee.id, session.date, session.service_id).rate;
        let sessionPay = 0;
        if (service && service.payment_model === 'per_student') {
          sessionPay = (session.sessions_count || 0) * (session.students_count || 0) * rate;
        } else {
          sessionPay = (session.sessions_count || 0) * rate;
        }
        payment += sessionPay;
        sessionsCount += session.sessions_count || 0;
        if (service && service.duration_minutes) {
          hours += (service.duration_minutes / 60) * (session.sessions_count || 0);
        }
      } else if (employee.employee_type === 'hourly') {
        const rate = getRateForDate(employee.id, session.date).rate;
        payment += (session.hours || 0) * rate;
        hours += session.hours || 0;
      } else if (employee.employee_type === 'global') {
        hours += session.hours || 0;
      }
    });

    const fromDate = new Date(filters.dateFrom);
    const toDate = new Date(filters.dateTo);
    const monthsInRange = eachMonthOfInterval({ start: startOfMonth(fromDate), end: endOfMonth(toDate) });

    const globals = employees.filter(e => e.employee_type === 'global' && scopedEmployeeIds.has(e.id));
    globals.forEach(emp => {
      monthsInRange.forEach(m => {
        const hasSession = filteredWorkSessions.some(ws =>
          ws.employee_id === emp.id &&
          ws.entry_type !== 'adjustment' &&
          parseISO(ws.date) >= startOfMonth(m) &&
          parseISO(ws.date) <= endOfMonth(m)
        );
        if (hasSession && (!emp.start_date || parseISO(emp.start_date) <= endOfMonth(m))) {
          payment += getRateForDate(emp.id, m).rate;
        }
      });
    });

    const filteredIds = new Set(filteredSessions.map(s => s.id));
    const monthsSet = new Set(monthsInRange.map(m => format(m, 'yyyy-MM')));
    const extraAdjustmentsTotal = filteredWorkSessions
      .filter(s => scopedEmployeeIds.has(s.employee_id))
      .filter(s => s.entry_type === 'adjustment')
      .filter(s => monthsSet.has(format(parseISO(s.date), 'yyyy-MM')))
      .filter(s => !filteredIds.has(s.id))
      .filter(s => {
        const emp = employees.find(e => e.id === s.employee_id);
        return !emp || !emp.start_date || s.date >= emp.start_date;
      })
      .reduce((sum, s) => sum + (s.total_payment || 0), 0);
    payment += extraAdjustmentsTotal;

    return { payment, hours, sessionsCount };
  };

  const totals = getTotals();

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
            שים לב: נבחר טווח חלקי של חודש. הסיכומים כוללים גם התאמות ושכר גלובלי לכל החודש/ים שבטווח המסונן.
          </div>
        )}
        <ReportsFilters filters={filters} setFilters={setFilters} employees={employees} services={services} isLoading={isLoading} />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card className="bg-white/70 backdrop-blur-sm border-0 shadow-lg">
            <CardContent className="p-6 flex items-center gap-4 relative">
              <div className="absolute left-4 top-4"><InfoTooltip text={"סה\"כ תשלום הוא הסכום הכולל ששולם לכל העובדים בתקופת הדוח.\nהסכום מחושב לפי תעריף העובד וסוג העבודה (שעות או מפגשים)."} /></div>
              <div className="p-3 bg-green-100 rounded-lg"><BarChart3 className="w-6 h-6 text-green-600" /></div>
              <div><p className="text-sm text-slate-600">סה״כ תשלום</p><p className="text-2xl font-bold text-slate-900">₪{totals.payment.toLocaleString()}</p></div>
            </CardContent>
          </Card>
          <Card className="bg-white/70 backdrop-blur-sm border-0 shadow-lg">
            <CardContent className="p-6 flex items-center gap-4 relative">
              <div className="absolute left-4 top-4"><InfoTooltip text={"סה\"כ שעות הוא סך כל השעות שעובדים עבדו בתקופת הדוח.\nלעובדים שעתיים - נספרות שעות בפועל.\nלמדריכים - השעות מחושבות לפי מספר מפגשים וזמן מפגש."} /></div>
              <div className="p-3 bg-blue-100 rounded-lg"><Calendar className="w-6 h-6 text-blue-600" /></div>
              <div><p className="text-sm text-slate-600">סה״כ שעות (מוערך)</p><p className="text-2xl font-bold text-slate-900">{totals.hours.toFixed(1)}</p></div>
            </CardContent>
          </Card>
          <Card className="bg-white/70 backdrop-blur-sm border-0 shadow-lg">
            <CardContent className="p-6 flex items-center gap-4 relative">
              <div className="absolute left-4 top-4"><InfoTooltip text={"סה\"כ מפגשים הוא מספר כל המפגשים שנערכו בתקופת הדוח.\nלעובדים שעתיים - לא נספרים מפגשים.\nלמדריכים - נספרים כל המפגשים שבוצעו בפועל."} /></div>
              <div className="p-3 bg-purple-100 rounded-lg"><TrendingUp className="w-6 h-6 text-purple-600" /></div>
              <div><p className="text-sm text-slate-600">סה״כ מפגשים</p><p className="text-2xl font-bold text-slate-900">{totals.sessionsCount}</p></div>
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
              <TabsContent value="overview"><ChartsOverview sessions={filteredSessions} employees={employees} services={services} workSessions={filteredWorkSessions} getRateForDate={getRateForDate} dateFrom={filters.dateFrom} dateTo={filters.dateTo} scopedEmployeeIds={scopedEmployeeIds} isLoading={isLoading} /></TabsContent>
              <TabsContent value="employee"><DetailedEntriesReport sessions={filteredSessions} employees={employees} services={services} rateHistories={rateHistories} isLoading={isLoading} /></TabsContent>
              <TabsContent value="monthly"><MonthlyReport sessions={filteredSessions} employees={employees} services={services} workSessions={filteredWorkSessions} getRateForDate={getRateForDate} scopedEmployeeIds={scopedEmployeeIds} dateFrom={filters.dateFrom} dateTo={filters.dateTo} isLoading={isLoading} /></TabsContent>
              <TabsContent value="payroll"><PayrollSummary sessions={filteredSessions} employees={employees} services={services} workSessions={filteredWorkSessions} getRateForDate={getRateForDate} scopedEmployeeIds={scopedEmployeeIds} dateFrom={filters.dateFrom} dateTo={filters.dateTo} isLoading={isLoading} /></TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
