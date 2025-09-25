import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useLocation, useNavigate } from 'react-router-dom';
import RecentActivity from "../components/dashboard/RecentActivity";
import TimeEntryTable from '../components/time-entry/TimeEntryTable';
import TrashTab from '../components/time-entry/TrashTab.jsx';
import { toast } from "sonner";
import { useOrg } from '@/org/OrgContext.jsx';
import { fetchLeavePolicySettings, fetchLeavePayPolicySettings } from '@/lib/settings-client.js';
import { fetchEmployeesList } from '@/api/employees.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from "date-fns";
import { calculateGlobalDailyRate } from '@/lib/payroll.js';
import { hasDuplicateSession } from '@/lib/workSessionsUtils.js';
import {
  fetchWorkSessions,
  createWorkSessions,
  updateWorkSession,
  deleteWorkSession,
} from '@/api/work-sessions.js';
import {
  createLeaveBalanceEntry,
  deleteLeaveBalanceEntries,
} from '@/api/leave-balances.js';
import { useSupabase } from '@/context/SupabaseContext.jsx';
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
  inferLeaveType,
  resolveLeavePayMethodContext,
  normalizeMixedSubtype,
  DEFAULT_MIXED_SUBTYPE,
  TIME_ENTRY_LEAVE_PREFIX,
} from '@/lib/leave.js';
import { selectLeaveDayValue, selectLeaveRemaining } from '@/selectors.js';
import {
  buildLeaveMetadata,
  buildSourceMetadata,
  canUseWorkSessionMetadata,
} from '@/lib/workSessionsMetadata.js';
import { useTimeEntry } from '@/components/time-entry/useTimeEntry.js';

const GENERIC_RATE_SERVICE_ID = '00000000-0000-0000-0000-000000000000';
const TIME_ENTRY_TABS = [
  { value: 'all', label: 'הכול' },
  { value: 'work', label: 'שעות/שיעורים' },
  { value: 'leave', label: 'חופשות' },
  { value: 'adjustments', label: 'התאמות' },
  { value: 'trash', label: 'סל אשפה' },
];

const DEFAULT_TAB = 'all';
const VALID_TAB_VALUES = new Set(TIME_ENTRY_TABS.map(tab => tab.value));

const getTabFromSearch = (search) => {
  try {
    const params = new URLSearchParams(search || '');
    const requested = params.get('tab');
    return (requested && VALID_TAB_VALUES.has(requested)) ? requested : DEFAULT_TAB;
  } catch (error) {
    console.warn('Failed to parse tab from search params', error);
    return DEFAULT_TAB;
  }
};

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

const buildLedgerEntryFromSession = (session) => {
  if (!session || !isLeaveEntryType(session.entry_type)) {
    return null;
  }
  if (!session.employee_id || !session.date) {
    return null;
  }
  const inferredType = inferLeaveType(session);
  const baseKind = getLeaveBaseKind(inferredType);
  if (!baseKind) {
    return null;
  }
  const delta = getLeaveLedgerDelta(baseKind);
  if (!delta) {
    return null;
  }
  return {
    employee_id: session.employee_id,
    effective_date: session.date,
    balance: delta,
    leave_type: `${TIME_ENTRY_LEAVE_PREFIX}_${baseKind}`,
    notes: session.notes || null,
  };
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
  const location = useLocation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(() => getTabFromSearch(location.search));
  const { tenantClientReady, activeOrgHasConnection, activeOrgId } = useOrg();
  const { dataClient, authClient, user, loading, session } = useSupabase();

  const ensureSessionAndOrg = useCallback(() => {
    if (!session) {
      throw new Error('נדרש להתחבר כדי לבצע את הפעולה.');
    }
    if (!activeOrgId) {
      throw new Error('יש לבחור ארגון פעיל לפני ביצוע הפעולה.');
    }
  }, [session, activeOrgId]);
  const loadInitialData = useCallback(async ({ silent = false } = {}) => {
    if (!tenantClientReady || !activeOrgHasConnection || !dataClient || !session || !activeOrgId) {
      if (!silent) {
        setIsLoading(false);
      }
      return;
    }

    if (!silent) setIsLoading(true);
    try {
      const bundle = await fetchEmployeesList({ session, orgId: activeOrgId });
      const employeeRecords = Array.isArray(bundle?.employees) ? bundle.employees : [];
      setEmployees(employeeRecords.filter((emp) => emp?.is_active !== false));

      const [sessionsResponse, leavePolicySettings, leavePayPolicySettings] = await Promise.all([
        fetchWorkSessions({ session, orgId: activeOrgId }),
        fetchLeavePolicySettings({ session, orgId: activeOrgId }),
        fetchLeavePayPolicySettings({ session, orgId: activeOrgId }),
      ]);

      const allSessions = Array.isArray(sessionsResponse?.sessions) ? sessionsResponse.sessions : [];
      const activeSessions = allSessions
        .filter((session) => !session?.deleted)
        .sort((a, b) => {
          const dateA = new Date(a.date || 0).getTime();
          const dateB = new Date(b.date || 0).getTime();
          if (dateA !== dateB) {
            return dateB - dateA;
          }
          const createdA = new Date(a.created_at || 0).getTime();
          const createdB = new Date(b.created_at || 0).getTime();
          return createdB - createdA;
        });
      const trashedSessions = allSessions
        .filter((session) => session?.deleted)
        .sort((a, b) => {
          const deletedA = new Date(a.deleted_at || 0).getTime();
          const deletedB = new Date(b.deleted_at || 0).getTime();
          return deletedB - deletedA;
        });

      setWorkSessions(activeSessions);
      setTrashSessions(trashedSessions);

      const rateHistoryRecords = Array.isArray(bundle?.rateHistory) ? bundle.rateHistory : [];
      setRateHistories(rateHistoryRecords);

      const serviceRecords = Array.isArray(bundle?.services) ? bundle.services : [];
      const filteredServices = serviceRecords.filter(service => service.id !== GENERIC_RATE_SERVICE_ID);
      setServices(filteredServices);

      const leaveLedgerRecords = Array.isArray(bundle?.leaveBalances) ? bundle.leaveBalances : [];
      setLeaveBalances(sortLeaveLedger(leaveLedgerRecords));

      setLeavePolicy(
        bundle?.leavePolicy
          ? normalizeLeavePolicy(bundle.leavePolicy)
          : (leavePolicySettings.value
            ? normalizeLeavePolicy(leavePolicySettings.value)
            : DEFAULT_LEAVE_POLICY),
      );

      setLeavePayPolicy(
        bundle?.leavePayPolicy
          ? normalizeLeavePayPolicy(bundle.leavePayPolicy)
          : (leavePayPolicySettings.value
            ? normalizeLeavePayPolicy(leavePayPolicySettings.value)
            : DEFAULT_LEAVE_PAY_POLICY),
      );
    } catch (error) {
      console.error('Error loading time entry data:', error);
      toast.error('שגיאה בטעינת נתוני רישום הזמנים');
    } finally {
      setIsLoading(false);
    }
  }, [tenantClientReady, activeOrgHasConnection, dataClient, session, activeOrgId]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    const normalized = getTabFromSearch(location.search);
    setActiveTab(prev => (prev === normalized ? prev : normalized));
  }, [location.search]);

  const handleTabChange = useCallback((value) => {
    const normalized = VALID_TAB_VALUES.has(value) ? value : DEFAULT_TAB;
    setActiveTab(normalized);
    const params = new URLSearchParams(location.search || '');
    if (normalized === DEFAULT_TAB) {
      params.delete('tab');
    } else {
      params.set('tab', normalized);
    }
    navigate({ pathname: location.pathname, search: params.toString() ? `?${params.toString()}` : '' }, { replace: true });
  }, [location.pathname, location.search, navigate]);

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

  const { saveAdjustments } = useTimeEntry({
    employees,
    services,
    getRateForDate,
    metadataClient: dataClient,
    workSessions,
    leavePayPolicy,
    session,
    orgId: activeOrgId,
  });


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
    adjustments = [],
  }) => {
    setIsLoading(true);
    try {
      const dateStr = format(day, 'yyyy-MM-dd');

      if (dayType === 'adjustment') {
        try {
          await saveAdjustments({
            employee,
            date: dateStr,
            adjustments: Array.isArray(adjustments) ? adjustments : [],
            source: 'table',
          });
        } catch (error) {
          const message = error?.message || 'שמירת ההתאמות נכשלה.';
          toast.error(message, { duration: 15000 });
          throw error;
        }

        toast.success('התאמות נשמרו בהצלחה.');
        await loadInitialData({ silent: true });
        return;
      }

      if (!dataClient) {
        throw new Error('חיבור Supabase אינו זמין.');
      }

      const canWriteMetadata = await canUseWorkSessionMetadata(dataClient);

      const toInsert = [];
      const toUpdate = [];
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

      ensureSessionAndOrg();

      if (toInsert.length > 0) {
        await createWorkSessions({
          session,
          orgId: activeOrgId,
          sessions: toInsert,
        });
      }
      if (toUpdate.length > 0) {
        await Promise.all(
          toUpdate.map((payload) => {
            const { id: sessionId, ...updates } = payload || {};
            if (!sessionId) {
              return Promise.resolve();
            }
            return updateWorkSession({
              session,
              orgId: activeOrgId,
              sessionId,
              body: { updates },
            });
          }),
        );
      }

      if (ledgerDeleteIds.length > 0) {
        await deleteLeaveBalanceEntries({
          session,
          orgId: activeOrgId,
          ids: ledgerDeleteIds,
        });
      }
      if (ledgerInsertPayload) {
        await createLeaveBalanceEntry({
          session,
          orgId: activeOrgId,
          body: ledgerInsertPayload,
        });
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
      ensureSessionAndOrg();
      const sessionsToRestore = trashSessions.filter(item => normalized.includes(String(item.id)));
      await Promise.all(
        normalized.map(sessionId => updateWorkSession({
          session,
          orgId: activeOrgId,
          sessionId,
          body: { updates: { deleted: false, deleted_at: null } },
        })),
      );
      const ledgerEntries = sessionsToRestore
        .map(buildLedgerEntryFromSession)
        .filter(Boolean);
      if (ledgerEntries.length) {
        await createLeaveBalanceEntry({
          session,
          orgId: activeOrgId,
          entries: ledgerEntries,
        });
      }
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
      ensureSessionAndOrg();
      await Promise.all(
        normalized.map(sessionId => deleteWorkSession({
          session,
          orgId: activeOrgId,
          sessionId,
        })),
      );
      toast.success(normalized.length === 1 ? 'הרישום נמחק לצמיתות.' : 'הרישומים נמחקו לצמיתות.');
      setTrashSessions(prev => prev.filter(item => !normalized.includes(String(item.id))));
      await loadInitialData({ silent: true });
    } catch (error) {
      console.error('Error permanently deleting sessions:', error);
      toast.error('מחיקה לצמיתות נכשלה, נסו שוב.');
      throw error;
    }
  };

  if (loading || !authClient) {
    return (
      <div className="p-6 text-center text-slate-500">
        טוען חיבור Supabase...
      </div>
    );
  }

  if (!user) {
    return (
      <div className="p-6 text-center text-slate-500">
        יש להתחבר כדי לעבוד עם רישומי הזמנים.
      </div>
    );
  }

  if (!dataClient) {
    return (
      <div className="p-6 text-center text-slate-500">
        בחרו ארגון עם חיבור פעיל כדי להציג את רישומי הזמנים.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-slate-900">רישום זמנים</h1>
          <p className="text-slate-600">ניהול רישומי שעות, חופשות והתאמות במקום אחד</p>
        </div>

        {/* Storage Usage widget temporarily disabled; flip features.storageUsage=true to re-enable (requires RPCs). */}

        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
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
                activeTab={tab.value}
                employees={employees}
                workSessions={tabbedSessions[tab.value] || []}
                allWorkSessions={workSessions}
                services={services}
                rateHistories={rateHistories}
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