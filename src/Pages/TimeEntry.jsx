import React, { useState, useEffect, useMemo, useCallback } from "react";
import RecentActivity from "../components/dashboard/RecentActivity";
import TimeEntryTable from '../components/time-entry/TimeEntryTable';
import TrashTab from '../components/time-entry/TrashTab.jsx';
import { toast } from "sonner";
import { supabase } from "../supabaseClient";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from "date-fns";
import { calculateGlobalDailyRate } from '@/lib/payroll.js';
import { hasDuplicateSession } from '@/lib/workSessionsUtils.js';
import { restoreWorkSessions, permanentlyDeleteWorkSessions } from '@/api/workSessions.js';
import {
  DEFAULT_LEAVE_POLICY,
  DEFAULT_LEAVE_PAY_POLICY,
  normalizeLeavePolicy,
  normalizeLeavePayPolicy,
  getEntryTypeForLeaveKind,
  isLeaveEntryType,
  getLeaveLedgerDelta,
  isPayableLeaveKind,
  getNegativeBalanceFloor,
  getLeaveLedgerEntryDelta,
  getLeaveLedgerEntryDate,
  getLeaveLedgerEntryType,
  getLeaveBaseKind,
  getLeaveSubtypeFromValue,
  resolveLeavePayMethodContext,
  normalizeMixedSubtype,
  DEFAULT_MIXED_SUBTYPE,
} from '@/lib/leave.js';
import { selectLeaveDayValue, selectLeaveRemaining } from '@/selectors.js';
import {
  buildLeaveMetadata,
  buildSourceMetadata,
  canUseWorkSessionMetadata,
} from '@/lib/workSessionsMetadata.js';

const GENERIC_RATE_SERVICE_ID = '00000000-0000-0000-0000-000000000000';
const TIME_ENTRY_LEAVE_PREFIX = 'time_entry_leave';
const TIME_ENTRY_TABS = [
  { value: 'all', label: 'הכול' },
  { value: 'work', label: 'שעות/שיעורים' },
  { value: 'leave', label: 'חופשות' },
  { value: 'adjustments', label: 'התאמות' },
  { value: 'trash', label: 'סל אשפה' },
];

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
  const [trashSessions, setTrashSessions] = useState([]);
  const [leaveBalances, setLeaveBalances] = useState([]);
  const [leavePolicy, setLeavePolicy] = useState(DEFAULT_LEAVE_POLICY);
  const [leavePayPolicy, setLeavePayPolicy] = useState(DEFAULT_LEAVE_PAY_POLICY);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');
  const loadInitialData = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setIsLoading(true);
    try {
      const [
        employeesData,
        sessionsData,
        ratesData,
        servicesData,
        leavePolicySettings,
        leavePayPolicySettings,
        leaveLedgerData,
        trashData,
      ] = await Promise.all([
        supabase.from('Employees').select('*').eq('is_active', true).order('name'),
        supabase.from('WorkSessions')
          .select('*, service:service_id(name)')
          .eq('deleted', false)
          .order('date', { ascending: false })
          .order('created_at', { ascending: false }),
        supabase.from('RateHistory').select('*'),
        supabase.from('Services').select('*'),
        supabase.from('Settings').select('settings_value').eq('key', 'leave_policy').single(),
        supabase.from('Settings').select('settings_value').eq('key', 'leave_pay_policy').single(),
        supabase.from('LeaveBalances').select('*'),
        supabase.from('WorkSessions')
          .select('*, service:service_id(name)')
          .eq('deleted', true)
          .order('deleted_at', { ascending: false })
      ]);

      if (employeesData.error) throw employeesData.error;
      if (sessionsData.error) throw sessionsData.error;
      if (ratesData.error) throw ratesData.error;
      if (servicesData.error) throw servicesData.error;
      if (leaveLedgerData.error) throw leaveLedgerData.error;
      if (trashData.error) throw trashData.error;

      setEmployees(employeesData.data || []);
      const activeSessions = (sessionsData.data || []).filter(session => !session?.deleted);
      setWorkSessions(activeSessions);
      setTrashSessions(trashData.data || []);
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
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

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


  const handleTableSubmit = async ({
    employee,
    day,
    dayType,
    updatedRows,
    paidLeaveId,
    paidLeaveNotes,
    leaveType,
    mixedPaid,
    mixedSubtype,
    mixedHalfDay,
  }) => {
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

        const baseLeaveKind = getLeaveBaseKind(leaveType) || leaveType;
        const isMixed = baseLeaveKind === 'mixed';
        const resolvedMixedSubtype = isMixed
          ? (normalizeMixedSubtype(mixedSubtype) || DEFAULT_MIXED_SUBTYPE)
          : null;
        const leaveSubtype = isMixed ? null : getLeaveSubtypeFromValue(leaveType);
        const entryType = getEntryTypeForLeaveKind(baseLeaveKind) || getEntryTypeForLeaveKind('system_paid');
        if (!entryType) {
          toast.error('סוג חופשה לא נתמך', { duration: 15000 });
          return;
        }

        const ledgerDelta = getLeaveLedgerDelta(baseLeaveKind);
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

        const mixedIsPaid = isMixed ? (mixedPaid !== false) : false;
        const mixedHalfDayRequested = isMixed && mixedIsPaid && mixedHalfDay === true;
        const mixedHalfDayEnabled = mixedHalfDayRequested && leavePolicy.allow_half_day;
        const isPayable = isMixed ? mixedIsPaid : isPayableLeaveKind(baseLeaveKind);
        const leaveFraction = baseLeaveKind === 'half_day'
          ? 0.5
          : (isMixed ? (mixedHalfDayEnabled ? 0.5 : 1) : 1);
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
            leaveType: baseLeaveKind,
            leaveKind: baseLeaveKind,
            subtype: isMixed ? resolvedMixedSubtype : leaveSubtype,
            payable: isPayable,
            fraction: isPayable ? leaveFraction : null,
            halfDay: baseLeaveKind === 'half_day' || mixedHalfDayEnabled,
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

  const handleSessionsDeleted = async (ids = [], rows = []) => {
    const idsSet = new Set((ids || []).map(String));
    if (idsSet.size > 0) {
      setWorkSessions(prev => prev.filter(ws => !idsSet.has(String(ws.id))));
      if (Array.isArray(rows) && rows.length > 0) {
        setTrashSessions(prev => {
          const filtered = prev.filter(item => !idsSet.has(String(item.id)));
          return [...rows, ...filtered];
        });
      }
    }
    try {
      await loadInitialData({ silent: true });
    } catch (error) {
      console.error('Error refreshing after delete:', error);
    }
  };

  const tabbedSessions = useMemo(() => {
    const base = Array.isArray(workSessions)
      ? workSessions.filter(session => session && !session.deleted)
      : [];
    const work = base.filter(row => row && (row.entry_type === 'hours' || row.entry_type === 'session'));
    const leave = base.filter(row => row && isLeaveEntryType(row.entry_type));
    const adjustments = base.filter(row => row && row.entry_type === 'adjustment');
    return {
      all: base,
      work,
      leave,
      adjustments,
    };
  }, [workSessions]);

  const nonTrashTabs = useMemo(
    () => TIME_ENTRY_TABS.filter(tab => tab.value !== 'trash'),
    [],
  );

  const handleTrashRestore = async (ids) => {
    const idsArray = Array.isArray(ids) ? ids : [ids];
    const normalized = Array.from(new Set(idsArray.map(String)));
    if (!normalized.length) return;
    try {
      await restoreWorkSessions(normalized, supabase);
      toast.success(normalized.length === 1 ? 'הרישום שוחזר.' : 'הרישומים שוחזרו.');
      setTrashSessions(prev => prev.filter(item => !normalized.includes(String(item.id))));
      await loadInitialData({ silent: true });
    } catch (error) {
      console.error('Error restoring sessions:', error);
      toast.error('שחזור נכשל, נסו שוב.');
      throw error;
    }
  };

  const handlePermanentDelete = async (ids) => {
    const idsArray = Array.isArray(ids) ? ids : [ids];
    const normalized = Array.from(new Set(idsArray.map(String)));
    if (!normalized.length) return;
    try {
      await permanentlyDeleteWorkSessions(normalized, supabase);
      toast.success(normalized.length === 1 ? 'הרישום נמחק לצמיתות.' : 'הרישומים נמחקו לצמיתות.');
      setTrashSessions(prev => prev.filter(item => !normalized.includes(String(item.id))));
      await loadInitialData({ silent: true });
    } catch (error) {
      console.error('Error permanently deleting sessions:', error);
      toast.error('מחיקה לצמיתות נכשלה, נסו שוב.');
      throw error;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-slate-900">רישום זמנים</h1>
          <p className="text-slate-600">ניהול רישומי שעות, חופשות והתאמות במקום אחד</p>
        </div>

        {/* Storage Usage widget temporarily disabled; flip features.storageUsage=true to re-enable (requires RPCs). */}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="flex flex-wrap justify-center gap-2 rounded-lg bg-white/70 p-1 shadow-sm">
            {TIME_ENTRY_TABS.map(tab => (
              <TabsTrigger key={tab.value} value={tab.value} className="px-4 py-2">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {nonTrashTabs.map(tab => (
            <TabsContent key={tab.value} value={tab.value} className="mt-6 space-y-6">
              <TimeEntryTable
                employees={employees}
                workSessions={tabbedSessions[tab.value] || []}
                allWorkSessions={workSessions}
                services={services}
                getRateForDate={getRateForDate}
                onTableSubmit={handleTableSubmit}
                onImported={() => loadInitialData()}
                onDeleted={handleSessionsDeleted}
                leavePolicy={leavePolicy}
                leavePayPolicy={leavePayPolicy}
              />
              <RecentActivity
                title="רישומים אחרונים"
                sessions={(tabbedSessions[tab.value] || []).slice(0, 5)}
                employees={employees}
                services={services}
                isLoading={isLoading}
                showViewAllButton={true}
              />
            </TabsContent>
          ))}

          <TabsContent value="trash" className="mt-6">
            <TrashTab
              sessions={trashSessions}
              employees={employees}
              services={services}
              onRestore={handleTrashRestore}
              onPermanentDelete={handlePermanentDelete}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}