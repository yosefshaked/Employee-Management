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
import { format } from "date-fns";
import { calculateGlobalDailyRate } from '@/lib/payroll.js';
import { hasDuplicateSession } from '@/lib/workSessionsUtils.js';
import {
  DEFAULT_LEAVE_POLICY,
  DEFAULT_LEAVE_PAY_POLICY,
  normalizeLeavePolicy,
  normalizeLeavePayPolicy,
  getEntryTypeForLeaveKind,
  getLeaveKindFromEntryType,
  isLeaveEntryType,
  getLeaveLedgerDelta,
  isPayableLeaveKind,
  getNegativeBalanceFloor,
  getLeaveLedgerEntryDelta,
  getLeaveLedgerEntryDate,
  getLeaveLedgerEntryType,
  resolveLeavePayMethodContext,
} from '@/lib/leave.js';
import { selectLeaveDayValue, selectLeaveRemaining } from '@/selectors.js';
import {
  buildLeaveMetadata,
  buildSourceMetadata,
  canUseWorkSessionMetadata,
} from '@/lib/workSessionsMetadata.js';

const GENERIC_RATE_SERVICE_ID = '00000000-0000-0000-0000-000000000000';
const TIME_ENTRY_LEAVE_PREFIX = 'time_entry_leave';

const getLedgerTimestamp = (entry = {}) => {
  const raw = entry.date || entry.entry_date || entry.effective_date || entry.change_date || entry.created_at;
  if (!raw) return 0;
  const parsed = new Date(raw);
  const value = parsed.getTime();
  return Number.isNaN(value) ? 0 : value;
};

const sortLeaveLedger = (entries = []) => {
  return [...entries].sort((a, b) => getLedgerTimestamp(a) - getLedgerTimestamp(b));
};

export default function TimeEntry() {
  const [employees, setEmployees] = useState([]);
  const [services, setServices] = useState([]);
  const [rateHistories, setRateHistories] = useState([]);
  const [workSessions, setWorkSessions] = useState([]);
  const [leaveBalances, setLeaveBalances] = useState([]);
  const [leavePolicy, setLeavePolicy] = useState(DEFAULT_LEAVE_POLICY);
  const [leavePayPolicy, setLeavePayPolicy] = useState(DEFAULT_LEAVE_PAY_POLICY);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);
  const [viewMode, setViewMode] = useState('form');

  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    setIsLoading(true);
    try {
      const [
        employeesData,
        sessionsData,
        ratesData,
        servicesData,
        leavePolicySettings,
        leavePayPolicySettings,
        leaveLedgerData,
      ] = await Promise.all([
        supabase.from('Employees').select('*').eq('is_active', true).order('name'),
        supabase.from('WorkSessions').select('*, service:service_id(name)').order('created_at', { ascending: false }),
        supabase.from('RateHistory').select('*'),
        supabase.from('Services').select('*'),
        supabase.from('Settings').select('settings_value').eq('key', 'leave_policy').single(),
        supabase.from('Settings').select('settings_value').eq('key', 'leave_pay_policy').single(),
        supabase.from('LeaveBalances').select('*')
      ]);

      if (employeesData.error) throw employeesData.error;
      if (sessionsData.error) throw sessionsData.error;
      if (ratesData.error) throw ratesData.error;
      if (servicesData.error) throw servicesData.error;
      if (leaveLedgerData.error) throw leaveLedgerData.error;

      setEmployees(employeesData.data || []);
      setWorkSessions(sessionsData.data || []);
      setRateHistories(ratesData.data || []);
      const filteredServices = (servicesData.data || []).filter(service => service.id !== GENERIC_RATE_SERVICE_ID);
      setServices(filteredServices);
      setLeaveBalances(sortLeaveLedger(leaveLedgerData.data || []));

      if (leavePolicySettings.error) {
        if (leavePolicySettings.error.code !== 'PGRST116') throw leavePolicySettings.error;
        setLeavePolicy(DEFAULT_LEAVE_POLICY);
      } else {
        setLeavePolicy(normalizeLeavePolicy(leavePolicySettings.data?.settings_value));
      }

      if (leavePayPolicySettings.error) {
        if (leavePayPolicySettings.error.code !== 'PGRST116') throw leavePayPolicySettings.error;
        setLeavePayPolicy(DEFAULT_LEAVE_PAY_POLICY);
      } else {
        setLeavePayPolicy(normalizeLeavePayPolicy(leavePayPolicySettings.data?.settings_value));
      }
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

  const findConflicts = (employeeId, dateStr) => {
    return workSessions.filter(ws =>
      ws.employee_id === employeeId &&
      ws.date === dateStr &&
      !isLeaveEntryType(ws.entry_type) &&
      ws.entry_type !== 'adjustment'
    );
  };

  const findLeaveSessions = (employeeId, dateStr) => {
    return workSessions.filter(ws =>
      ws.employee_id === employeeId &&
      ws.date === dateStr &&
      isLeaveEntryType(ws.entry_type)
    );
  };

  const handleSessionSubmit = async (rows) => {
    try {
      const employee = employees.find(e => e.id === selectedEmployeeId);
      if (!employee) throw new Error("Employee not found");
      const canWriteMetadata = await canUseWorkSessionMetadata(supabase);

      let blockedByLeave = false;
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
        } else if (employee.employee_type === 'global') {
          if (!row.dayType) {
            toast.error('יש לבחור סוג יום.', { duration: 15000 });
            return null;
          }
          const hoursValue = parseFloat(row.hours);
          if (row.dayType === 'regular' && (isNaN(hoursValue) || hoursValue <= 0)) {
            toast.error("יש להזין מספר שעות גדול מ-0.", { duration: 15000 });
            return null;
          }
        }

        const { rate: rateUsed, reason } = getRateForDate(employee.id, row.date, serviceIdForRate);
        if (!rateUsed) {
          toast.error(reason || 'לא הוגדר תעריף עבור תאריך זה', { duration: 15000 });
          return null;
        }

        const isLeaveEntry = isLeaveEntryType(entryType);
        let totalPayment = 0;
        let leaveValue = null;
        if (isLeaveEntry) {
          leaveValue = selectLeaveDayValue(employee.id, row.date, {
            employees,
            workSessions,
            services,
            leavePayPolicy,
          });
          if (typeof leaveValue === 'number' && Number.isFinite(leaveValue) && leaveValue > 0) {
            totalPayment = leaveValue;
          } else if (employee.employee_type === 'global') {
            try {
              const dailyRate = calculateGlobalDailyRate(employee, row.date, rateUsed);
              totalPayment = dailyRate;
            } catch (err) {
              toast.error(err.message, { duration: 15000 });
              return null;
            }
          }
        } else if (employee.employee_type === 'hourly') {
          totalPayment = (parseFloat(row.hours) || 0) * rateUsed;
        } else if (employee.employee_type === 'global') {
          try {
            const dailyRate = calculateGlobalDailyRate(employee, row.date, rateUsed);
            totalPayment = dailyRate;
          } catch (err) {
            toast.error(err.message, { duration: 15000 });
            return null;
          }
        } else {
          const service = services.find(s => s.id === row.service_id);
          if (!service) return null;
          if (service.payment_model === 'per_student') {
            totalPayment = (parseInt(row.sessions_count) || 0) * (parseInt(row.students_count) || 0) * rateUsed;
          } else {
            totalPayment = (parseInt(row.sessions_count) || 0) * rateUsed;
          }
        }

        const entryType = employee.employee_type === 'global'
          ? (row.dayType === 'paid_leave' ? getEntryTypeForLeaveKind('system_paid') : 'hours')
          : (employee.employee_type === 'hourly' ? 'hours' : 'session');
        if (isLeaveEntryType(entryType) && employee.employee_type !== 'global') {
          toast.error('paid_leave only allowed for global employees', { duration: 15000 });
          return null;
        }
        if (isLeaveEntry) {
          if (employee.start_date && row.date < employee.start_date) {
            const formattedStart = format(new Date(employee.start_date + 'T00:00:00'), 'dd/MM/yyyy');
            const formattedTarget = format(new Date(row.date + 'T00:00:00'), 'dd/MM/yyyy');
            toast.error(`לא ניתן להזין חופשה לפני תחילת העבודה (${formattedStart}): ${formattedTarget}`, { duration: 15000 });
            return null;
          }
          const conflicts = findConflicts(employee.id, row.date);
          if (conflicts.length > 0) {
            const details = conflicts.map(c => {
              const hrs = c.hours ? `, ${c.hours} שעות` : '';
              const d = format(new Date(c.date + 'T00:00:00'), 'dd/MM/yyyy');
              return `${employee.name} ${d}${hrs} (ID ${c.id})`;
            }).join('\n');
            toast.error(`קיימים רישומי עבודה מתנגשים:\n${details}`, { duration: 10000 });
            return null;
          }
        }
        if (!isLeaveEntryType(entryType)) {
          const leaveSessions = findLeaveSessions(employee.id, row.date);
          if (leaveSessions.length > 0 && !blockedByLeave) {
            const formattedDate = format(new Date(row.date + 'T00:00:00'), 'dd/MM/yyyy');
            const suffix = employee.name ? ` (${employee.name})` : '';
            toast.error(`לא ניתן להוסיף שעות בתאריך שכבר הוזנה בו חופשה: ${formattedDate}${suffix}`, { duration: 15000 });
            blockedByLeave = true;
          }
          if (leaveSessions.length > 0) {
            return null;
          }
        }
        const session = {
          employee_id: employee.id,
          date: row.date,
          entry_type: entryType,
          service_id: (employee.employee_type === 'instructor') ? row.service_id : null,
          hours: employee.employee_type === 'hourly'
            ? (parseFloat(row.hours) || null)
            : (employee.employee_type === 'global' && entryType === 'hours'
              ? (parseFloat(row.hours) || null)
              : (isLeaveEntryType(entryType) ? 0 : null)),
          sessions_count: employee.employee_type === 'instructor' ? (parseInt(row.sessions_count) || null) : null,
          students_count: employee.employee_type === 'instructor' ? (parseInt(row.students_count) || null) : null,
          notes: row.notes || null,
          rate_used: rateUsed,
          total_payment: totalPayment,
        };
        if (isLeaveEntryType(entryType)) {
          session.payable = true;
        }
        if (hasDuplicateSession(workSessions, session)) {
          toast.error('רישום זה כבר קיים', { duration: 15000 });
          return null;
        }
        if (canWriteMetadata) {
          if (isLeaveEntryType(session.entry_type)) {
            const leaveKind = getLeaveKindFromEntryType(session.entry_type) || 'system_paid';
            const payContext = resolveLeavePayMethodContext(employee, leavePayPolicy);
            const baseSnapshot = typeof leaveValue === 'number' && Number.isFinite(leaveValue) && leaveValue > 0
              ? leaveValue
              : (totalPayment || null);
            const metadata = buildLeaveMetadata({
              source: 'form',
              leaveType: leaveKind,
              leaveKind,
              payable: true,
              fraction: leaveKind === 'half_day' ? 0.5 : 1,
              halfDay: leaveKind === 'half_day',
              method: payContext.method,
              lookbackMonths: payContext.lookback_months,
              legalAllow12mIfBetter: payContext.legal_allow_12m_if_better,
              dailyValueSnapshot: baseSnapshot,
              overrideApplied: payContext.override_applied,
            });
            if (metadata) {
              session.metadata = metadata;
            }
          } else {
            const metadata = buildSourceMetadata('form');
            if (metadata) {
              session.metadata = metadata;
            }
          }
        }
        return session;
      }).filter(Boolean);

      if (blockedByLeave) {
        return;
      }

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

  const handleTableSubmit = async ({ employee, day, dayType, updatedRows, paidLeaveId, paidLeaveNotes, leaveType, mixedPaid }) => {
    setIsLoading(true);
    try {
      const canWriteMetadata = await canUseWorkSessionMetadata(supabase);
      const toInsert = [];
      const toUpdate = [];
      const dateStr = format(day, 'yyyy-MM-dd');
      const existingLedgerEntries = leaveBalances.filter(entry => {
        if (entry.employee_id !== employee.id) return false;
        const entryDate = getLeaveLedgerEntryDate(entry);
        if (entryDate !== dateStr) return false;
        const ledgerType = getLeaveLedgerEntryType(entry) || '';
        return ledgerType.startsWith(TIME_ENTRY_LEAVE_PREFIX);
      });
      let ledgerDeleteIds = existingLedgerEntries.map(entry => entry.id).filter(Boolean);
      const existingLedgerDelta = existingLedgerEntries.reduce(
        (sum, entry) => sum + getLeaveLedgerEntryDelta(entry),
        0,
      );
      let ledgerInsertPayload = null;

      if (dayType !== 'paid_leave') {
        if (paidLeaveId && updatedRows.length > 0 && !updatedRows[0].id) {
          updatedRows[0].id = paidLeaveId;
        }
        const leaveSessions = findLeaveSessions(employee.id, dateStr);
        if (leaveSessions.length > 0) {
          const formattedDate = format(new Date(dateStr + 'T00:00:00'), 'dd/MM/yyyy');
          const suffix = employee.name ? ` (${employee.name})` : '';
          toast.error(`לא ניתן להוסיף שעות בתאריך שכבר הוזנה בו חופשה: ${formattedDate}${suffix}`, { duration: 15000 });
          return;
        }
        for (const row of updatedRows) {
          const hoursValue = parseFloat(row.hours);
          const isHourlyOrGlobal = employee.employee_type === 'hourly' || employee.employee_type === 'global';
          if (employee.employee_type === 'hourly') {
            if (isNaN(hoursValue) || hoursValue <= 0) {
              toast.error('יש להזין מספר שעות גדול מ-0.', { duration: 15000 });
              return;
            }
          }
          if (employee.employee_type === 'global') {
            if (!dayType) {
              toast.error('יש לבחור סוג יום', { duration: 15000 });
              return;
            }
            if (row._status === 'new' && (isNaN(hoursValue) || hoursValue <= 0)) {
              toast.error('יש להזין מספר שעות גדול מ-0.', { duration: 15000 });
              return;
            }
          }

          const { rate: rateUsed, reason } = getRateForDate(employee.id, day, isHourlyOrGlobal ? GENERIC_RATE_SERVICE_ID : row.service_id);
          if (!rateUsed) {
            toast.error(reason || 'לא הוגדר תעריף עבור תאריך זה', { duration: 15000 });
            return;
          }
          const legacyPaidLeave = row.entry_type === 'paid_leave' && employee.employee_type !== 'global';
          if (legacyPaidLeave) {
            row.notes = row.notes ? `${row.notes} (סומן בעבר כחופשה)` : 'סומן בעבר כחופשה';
          }
          let totalPayment = 0;
          if (employee.employee_type === 'hourly') {
            totalPayment = (hoursValue || 0) * rateUsed;
          } else if (employee.employee_type === 'global') {
            try {
              const dailyRate = calculateGlobalDailyRate(employee, day, rateUsed);
              totalPayment = dailyRate;
            } catch (err) {
              toast.error(err.message, { duration: 15000 });
              return;
            }
          } else {
            const service = services.find(s => s.id === row.service_id);
            if (!service) return;
            if (service.payment_model === 'per_student') {
              const sessions = parseInt(row.sessions_count, 10) || 1;
              const students = parseInt(row.students_count, 10) || 0;
              totalPayment = sessions * students * rateUsed;
            } else {
              const sessions = parseInt(row.sessions_count, 10) || 1;
              totalPayment = sessions * rateUsed;
            }
          }
          const sessionData = {
            employee_id: employee.id,
            date: dateStr,
            notes: row.notes || null,
            rate_used: rateUsed,
            total_payment: totalPayment,
          };
          if (row.id) sessionData.id = row.id;
          if (employee.employee_type === 'hourly') {
            sessionData.entry_type = 'hours';
            sessionData.hours = hoursValue || 0;
            sessionData.service_id = GENERIC_RATE_SERVICE_ID;
            sessionData.sessions_count = null;
            sessionData.students_count = null;
          } else if (employee.employee_type === 'global') {
            sessionData.entry_type = 'hours';
            sessionData.hours = hoursValue || null;
            sessionData.service_id = null;
            sessionData.sessions_count = null;
            sessionData.students_count = null;
          } else {
            sessionData.entry_type = 'session';
            sessionData.service_id = row.service_id;
            sessionData.sessions_count = parseInt(row.sessions_count, 10) || 1;
            sessionData.students_count = parseInt(row.students_count, 10) || null;
          }
          if (hasDuplicateSession(workSessions, sessionData)) {
            toast.error('רישום זה כבר קיים', { duration: 15000 });
            return;
          }
          if (canWriteMetadata) {
            const metadata = buildSourceMetadata('table');
            if (metadata) {
              sessionData.metadata = metadata;
            }
          }
          if (row.id) {
            toUpdate.push(sessionData);
          } else {
            toInsert.push(sessionData);
          }
        }
      } else {
        if (!leaveType) {
          toast.error('יש לבחור סוג חופשה.', { duration: 15000 });
          return;
        }
        if (employee.start_date && employee.start_date > dateStr) {
          const requested = format(new Date(dateStr + 'T00:00:00'), 'dd/MM/yyyy');
          const startFormatted = format(new Date(employee.start_date + 'T00:00:00'), 'dd/MM/yyyy');
          toast.error(`לא ניתן לשמור חופשה לתאריך ${requested} לפני תחילת העבודה (${startFormatted}).`, { duration: 15000 });
          return;
        }
        if (leaveType === 'half_day' && !leavePolicy.allow_half_day) {
          toast.error('חצי יום אינו מאושר במדיניות הנוכחית', { duration: 15000 });
          return;
        }
        const conflicts = findConflicts(employee.id, dateStr);
        if (conflicts.length > 0) {
          const details = conflicts.map(c => {
            const hrs = c.hours ? `, ${c.hours} שעות` : '';
            const d = format(new Date(c.date + 'T00:00:00'), 'dd/MM/yyyy');
            return `${employee.name} ${d}${hrs} (ID ${c.id})`;
          }).join('\n');
          toast.error(`קיימים רישומי עבודה מתנגשים:\n${details}`, { duration: 10000 });
          return;
        }

        const entryType = getEntryTypeForLeaveKind(leaveType) || getEntryTypeForLeaveKind('system_paid');
        if (!entryType) {
          toast.error('סוג חופשה לא נתמך', { duration: 15000 });
          return;
        }

        const ledgerDelta = getLeaveLedgerDelta(leaveType);
        const summary = selectLeaveRemaining(employee.id, dateStr, {
          employees,
          leaveBalances,
          policy: leavePolicy,
        });
        const baselineRemaining = summary.remaining - existingLedgerDelta;
        const projected = baselineRemaining + ledgerDelta;
        if (ledgerDelta < 0) {
          if (!leavePolicy.allow_negative_balance) {
            if (baselineRemaining <= 0 || projected < 0) {
              toast.error('חריגה ממכסה ימי החופשה המותרים', { duration: 15000 });
              return;
            }
          } else {
            const floorLimit = getNegativeBalanceFloor(leavePolicy);
            if (projected < floorLimit) {
              toast.error('חריגה ממכסה ימי החופשה המותרים', { duration: 15000 });
              return;
            }
          }
        }

        const isMixed = leaveType === 'mixed';
        const mixedIsPaid = isMixed ? (mixedPaid !== false) : false;
        const isPayable = isMixed ? mixedIsPaid : isPayableLeaveKind(leaveType);
        const leaveFraction = leaveType === 'half_day' ? 0.5 : 1;
        let rateUsed = 0;
        let totalPayment = 0;
        let resolvedLeaveValue = 0;
        if (isPayable) {
          const { rate, reason } = getRateForDate(employee.id, day, GENERIC_RATE_SERVICE_ID);
          rateUsed = rate || 0;
          if (!rateUsed && employee.employee_type === 'global') {
            toast.error(reason || 'לא הוגדר תעריף עבור תאריך זה', { duration: 15000 });
            return;
          }
          if (employee.employee_type === 'global') {
            const selectorValue = selectLeaveDayValue(employee.id, day, {
              employees,
              workSessions,
              services,
              leavePayPolicy,
            });
            if (typeof selectorValue === 'number' && Number.isFinite(selectorValue) && selectorValue > 0) {
              resolvedLeaveValue = selectorValue;
            } else {
              try {
                resolvedLeaveValue = calculateGlobalDailyRate(employee, day, rateUsed);
              } catch (err) {
                toast.error(err.message, { duration: 15000 });
                return;
              }
            }
            totalPayment = resolvedLeaveValue * leaveFraction;
          } else {
            const selectorValue = selectLeaveDayValue(employee.id, day, {
              employees,
              workSessions,
              services,
              leavePayPolicy,
            });
            if (typeof selectorValue === 'number' && Number.isFinite(selectorValue) && selectorValue > 0) {
              resolvedLeaveValue = selectorValue;
            }
          }
        }

        const leaveRow = {
          employee_id: employee.id,
          date: dateStr,
          notes: paidLeaveNotes || null,
          rate_used: isPayable ? (rateUsed || null) : null,
          total_payment: isPayable && employee.employee_type === 'global' ? totalPayment : 0,
          entry_type: entryType,
          hours: 0,
          service_id: null,
          sessions_count: null,
          students_count: null,
          payable: isPayable,
        };

        if (hasDuplicateSession(workSessions, leaveRow)) {
          toast.error('רישום זה כבר קיים', { duration: 15000 });
          return;
        }

        if (canWriteMetadata) {
          const payContext = resolveLeavePayMethodContext(employee, leavePayPolicy);
          const dailyValueSnapshot = isPayable
            ? ((typeof resolvedLeaveValue === 'number' && Number.isFinite(resolvedLeaveValue) && resolvedLeaveValue > 0)
              ? resolvedLeaveValue
              : null)
            : null;
          const metadata = buildLeaveMetadata({
            source: 'table',
            leaveType,
            leaveKind: leaveType,
            payable: isPayable,
            fraction: leaveFraction,
            halfDay: leaveType === 'half_day',
            mixedPaid: isMixed ? mixedIsPaid : null,
            method: payContext.method,
            lookbackMonths: payContext.lookback_months,
            legalAllow12mIfBetter: payContext.legal_allow_12m_if_better,
            dailyValueSnapshot,
            overrideApplied: payContext.override_applied,
          });
          if (metadata) {
            leaveRow.metadata = metadata;
          }
        }

        if (paidLeaveId) {
          leaveRow.id = paidLeaveId;
          toUpdate.push(leaveRow);
        } else {
          toInsert.push(leaveRow);
        }

        if (ledgerDelta !== 0) {
          ledgerInsertPayload = {
            employee_id: employee.id,
            effective_date: dateStr,
            balance: ledgerDelta,
            leave_type: `${TIME_ENTRY_LEAVE_PREFIX}_${leaveType}`,
            notes: paidLeaveNotes ? paidLeaveNotes : null,
          };
        }
      }

      if (toInsert.length > 0) {
        const { error: insErr } = await supabase.from('WorkSessions').insert(toInsert);
        if (insErr) throw insErr;
      }
      if (toUpdate.length > 0) {
        const { error: upErr } = await supabase.from('WorkSessions').upsert(toUpdate, { onConflict: 'id' });
        if (upErr) throw upErr;
      }

      if (ledgerDeleteIds.length > 0) {
        const { error: ledgerDeleteErr } = await supabase.from('LeaveBalances').delete().in('id', ledgerDeleteIds);
        if (ledgerDeleteErr) throw ledgerDeleteErr;
      }
      if (ledgerInsertPayload) {
        const { error: ledgerInsertErr } = await supabase.from('LeaveBalances').insert([ledgerInsertPayload]);
        if (ledgerInsertErr) throw ledgerInsertErr;
      }

      toast.success('הרישומים עודכנו בהצלחה!');
      await loadInitialData();
    } catch (error) {
      console.error('Error submitting from table:', error);
      toast.error(`שגיאה בעדכון הרישומים: ${error.message}`);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const handleSessionsDeleted = (ids) => {
    const idsSet = new Set(ids.map(String));
    setWorkSessions(prev => prev.filter(ws => !idsSet.has(String(ws.id))));
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
                    allEmployees={employees}
                    workSessions={workSessions}
                    services={services}
                    onSubmit={(res) => handleSessionSubmit(res.rows)}
                    getRateForDate={getRateForDate}
                    allowHalfDay={leavePolicy.allow_half_day}
                    leavePayPolicy={leavePayPolicy}
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
              onImported={loadInitialData}
              onDeleted={handleSessionsDeleted}
              leavePolicy={leavePolicy}
              leavePayPolicy={leavePayPolicy}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}