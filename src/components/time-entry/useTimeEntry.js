import { format } from 'date-fns';
import { createWorkSessions, updateWorkSession } from '@/api/work-sessions.js';
import { createLeaveBalanceEntry, deleteLeaveBalanceEntries } from '@/api/leave-balances.js';
import { hasDuplicateSession } from '@/lib/workSessionsUtils.js';
import { calculateGlobalDailyRate } from '../../lib/payroll.js';
import {
  getEntryTypeForLeaveKind,
  getLeaveKindFromEntryType,
  getLeaveBaseKind,
  getLeaveSubtypeFromValue,
  inferLeaveType,
  getLeaveValueMultiplier,
  isLeaveEntryType,
  isPayableLeaveKind,
  getLeaveLedgerDelta,
  getNegativeBalanceFloor,
  getLeaveLedgerEntryDelta,
  getLeaveLedgerEntryDate,
  getLeaveLedgerEntryType,
  resolveLeavePayMethodContext,
  normalizeMixedSubtype,
  DEFAULT_MIXED_SUBTYPE,
  TIME_ENTRY_LEAVE_PREFIX,
} from '../../lib/leave.js';
import {
  buildLeaveMetadata,
  buildSourceMetadata,
  canUseWorkSessionMetadata,
} from '../../lib/workSessionsMetadata.js';
import { selectLeaveDayValue, selectLeaveRemaining } from '../../selectors.js';

const GENERIC_RATE_SERVICE_ID = '00000000-0000-0000-0000-000000000000';

export function useTimeEntry({
  employees,
  services,
  getRateForDate,
  metadataClient = null,
  session = null,
  orgId = null,
  workSessions = [],
  leavePayPolicy = null,
  leavePolicy = null,
  leaveBalances = [],
}) {
  const baseRegularSessions = new Set();
  const baseLeaveSessions = new Set();
  if (Array.isArray(workSessions)) {
    workSessions.forEach(session => {
      if (!session) return;
      if (!session.employee_id || !session.date) return;
      if (session.entry_type === 'adjustment') return;
      if (isLeaveEntryType(session.entry_type)) {
        baseLeaveSessions.add(`${session.employee_id}-${session.date}`);
        return;
      }
      baseRegularSessions.add(`${session.employee_id}-${session.date}`);
    });
  }

  const resolveLeaveValue = (employeeId, date, multiplier = 1) => {
    const base = selectLeaveDayValue(employeeId, date, {
      employees,
      workSessions,
      services,
      leavePayPolicy,
    });
    const safeBase = typeof base === 'number' && Number.isFinite(base) && base > 0 ? base : 0;
    const scale = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
    return safeBase * scale;
  };

  const effectiveMetadataClient = metadataClient || null;

  const resolveCanWriteMetadata = async () => {
    if (!effectiveMetadataClient) {
      return false;
    }
    try {
      return await canUseWorkSessionMetadata(effectiveMetadataClient);
    } catch (error) {
      console.warn('Failed to verify WorkSessions metadata support', error);
      return false;
    }
  };

  const ensureApiPrerequisites = () => {
    if (!session) {
      const error = new Error('נדרשת התחברות כדי לשמור רישומי שעות.');
      error.code = 'AUTH_REQUIRED';
      throw error;
    }
    if (!orgId) {
      const error = new Error('יש לבחור ארגון פעיל לפני ביצוע הפעולה.');
      error.code = 'ORG_REQUIRED';
      throw error;
    }
  };

  const saveRows = async (rows, dayTypeMap = {}) => {
    ensureApiPrerequisites();
    const canWriteMetadata = await resolveCanWriteMetadata();
    const inserts = [];
    const leaveConflicts = [];
    const leaveOccupied = new Set(baseLeaveSessions);
    for (const row of rows) {
      const employee = employees.find(e => e.id === row.employee_id);
      if (!employee) continue;
      const isHourlyOrGlobal = employee.employee_type === 'hourly' || employee.employee_type === 'global';
      const { rate: rateUsed, reason } = getRateForDate(employee.id, row.date, isHourlyOrGlobal ? null : row.service_id);
      if (!rateUsed) throw new Error(reason || 'missing rate');
      let totalPayment = 0;
      const empDayType = dayTypeMap ? dayTypeMap[row.employee_id] : undefined;
      const originalType = row.entry_type;
      let entryType;
      if (employee.employee_type === 'global') {
        if (empDayType === 'paid_leave') {
          entryType = getEntryTypeForLeaveKind('system_paid');
        } else {
          entryType = 'hours';
        }
      } else {
        entryType = employee.employee_type === 'instructor' ? 'session' : 'hours';
        if (originalType && isLeaveEntryType(originalType)) {
          row.notes = row.notes ? `${row.notes} (סומן בעבר כחופשה)` : 'סומן בעבר כחופשה';
        }
      }

      const key = `${employee.id}-${row.date}`;
      if (!isLeaveEntryType(entryType) && leaveOccupied.has(key)) {
        leaveConflicts.push({
          employeeId: employee.id,
          employeeName: employee.name || '',
          date: row.date,
        });
        continue;
      }

      if (entryType === 'session') {
        const service = services.find(s => s.id === row.service_id);
        if (!service) throw new Error('service required');
        if (service.payment_model === 'per_student') {
          totalPayment = (parseInt(row.sessions_count, 10) || 0) * (parseInt(row.students_count, 10) || 0) * rateUsed;
        } else {
          totalPayment = (parseInt(row.sessions_count, 10) || 0) * rateUsed;
        }
      } else if (entryType && entryType.startsWith('leave_')) {
        const leaveKind = getLeaveKindFromEntryType(entryType);
        const multiplier = getLeaveValueMultiplier({ entry_type: entryType, leave_kind: leaveKind });
        let value = resolveLeaveValue(employee.id, row.date, multiplier || 1);
        if (employee.employee_type === 'global') {
          if (!(typeof value === 'number' && Number.isFinite(value) && value > 0)) {
            try {
              const fallback = calculateGlobalDailyRate(employee, row.date, rateUsed);
              value = (typeof fallback === 'number' && Number.isFinite(fallback) ? fallback : 0)
                * (Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1);
            } catch {
              value = 0;
            }
          }
          totalPayment = value;
        }
      } else if (entryType === 'leave') {
        totalPayment = 0;
      } else if (employee.employee_type === 'hourly') {
        totalPayment = (parseFloat(row.hours) || 0) * rateUsed;
      } else if (employee.employee_type === 'global') {
        const dailyRate = calculateGlobalDailyRate(employee, row.date, rateUsed);
        totalPayment = dailyRate;
      }
      const payload = {
        employee_id: employee.id,
        date: row.date,
        entry_type: entryType,
        service_id: row.service_id || null,
        hours: entryType === 'hours' ? (parseFloat(row.hours) || null) : null,
        sessions_count: entryType === 'session' ? (parseInt(row.sessions_count, 10) || null) : null,
        students_count: entryType === 'session' ? (parseInt(row.students_count, 10) || null) : null,
        notes: row.notes ? row.notes : null,
        rate_used: rateUsed,
        total_payment: totalPayment,
      };
      if (entryType && entryType.startsWith('leave_')) {
        payload.payable = true;
        payload.hours = 0;
        leaveOccupied.add(key);
        if (canWriteMetadata) {
          const leaveKind = getLeaveKindFromEntryType(entryType) || 'system_paid';
          const payContext = resolveLeavePayMethodContext(employee, leavePayPolicy);
          const fraction = leaveKind === 'half_day' ? 0.5 : 1;
          const snapshot = typeof totalPayment === 'number' && Number.isFinite(totalPayment) && totalPayment > 0
            ? (fraction && fraction !== 0 ? totalPayment / fraction : totalPayment)
            : null;
          const metadata = buildLeaveMetadata({
            source: 'multi_date',
            leaveType: leaveKind,
            leaveKind,
            payable: true,
            fraction,
            halfDay: leaveKind === 'half_day',
            method: payContext.method,
            lookbackMonths: payContext.lookback_months,
            legalAllow12mIfBetter: payContext.legal_allow_12m_if_better,
            dailyValueSnapshot: snapshot,
            overrideApplied: payContext.override_applied,
          });
          if (metadata) {
            payload.metadata = metadata;
          }
        }
      } else if (entryType === 'leave') {
        payload.payable = false;
        payload.hours = 0;
        payload.total_payment = 0;
        payload.rate_used = null;
        leaveOccupied.add(key);
        if (canWriteMetadata) {
          const inferred = inferLeaveType(row) || 'unpaid';
          const subtype = getLeaveSubtypeFromValue(inferred) || getLeaveSubtypeFromValue(row.leave_type || row.leaveType);
          const metadata = buildLeaveMetadata({
            source: 'multi_date',
            leaveType: getLeaveBaseKind(inferred) || 'unpaid',
            leaveKind: getLeaveBaseKind(inferred) || 'unpaid',
            subtype,
            payable: false,
            fraction: 1,
            halfDay: false,
          });
          if (metadata) {
            payload.metadata = metadata;
          }
        }
      } else if (canWriteMetadata) {
        const metadata = buildSourceMetadata('multi_date');
        if (metadata) {
          payload.metadata = metadata;
        }
      }
      inserts.push(payload);
    }
    if (!inserts.length) {
      if (leaveConflicts.length > 0) {
        const error = new Error('regular_conflicts');
        error.code = 'TIME_ENTRY_REGULAR_CONFLICT';
        error.conflicts = leaveConflicts;
        throw error;
      }
      throw new Error('no valid rows');
    }
    await createWorkSessions({ session, orgId, sessions: inserts });
    return { inserted: inserts, conflicts: leaveConflicts };
  };

  const saveWorkDay = async (input = {}) => {
    ensureApiPrerequisites();

    const {
      employee = null,
      segments = [],
      day = null,
      date = null,
      dayType = null,
      paidLeaveId = null,
      source = 'table',
    } = input || {};

    if (!employee || !employee.id) {
      throw new Error('נדרש לבחור עובד לשמירת היום.');
    }

    const normalizedDate = typeof date === 'string' && date
      ? date
      : (day instanceof Date && !Number.isNaN(day.getTime())
        ? format(day, 'yyyy-MM-dd')
        : null);

    if (!normalizedDate) {
      throw new Error('נדרש תאריך תקין לשמירת היום.');
    }

    const dayReference = day instanceof Date && !Number.isNaN(day.getTime())
      ? day
      : new Date(`${normalizedDate}T00:00:00`);

    if (Number.isNaN(dayReference.getTime())) {
      throw new Error('נדרש תאריך תקין לשמירת היום.');
    }

    const segmentList = Array.isArray(segments) ? segments.map(item => ({ ...item })) : [];

    if (!segmentList.length) {
      throw new Error('אין רישומי עבודה לשמירה.');
    }

    if (paidLeaveId && segmentList.length > 0 && !segmentList[0].id) {
      segmentList[0].id = paidLeaveId;
    }

    const conflictingLeaveSessions = Array.isArray(workSessions)
      ? workSessions.filter(ws =>
        ws &&
        ws.employee_id === employee.id &&
        ws.date === normalizedDate &&
        isLeaveEntryType(ws.entry_type) &&
        !segmentList.some(segment => segment.id && segment.id === ws.id),
      )
      : [];

    if (conflictingLeaveSessions.length > 0) {
      const error = new Error('לא ניתן להוסיף שעות בתאריך שכבר הוזנה בו חופשה.');
      error.code = 'TIME_ENTRY_LEAVE_CONFLICT';
      error.conflicts = conflictingLeaveSessions;
      throw error;
    }

    const canWriteMetadata = await resolveCanWriteMetadata();

    const toInsert = [];
    const toUpdate = [];

    for (const segment of segmentList) {
      const hoursValue = segment.hours !== undefined && segment.hours !== null
        ? parseFloat(segment.hours)
        : NaN;
      const isHourly = employee.employee_type === 'hourly';
      const isGlobal = employee.employee_type === 'global';
      const isHourlyOrGlobal = isHourly || isGlobal;

      if (isHourly) {
        if (!Number.isFinite(hoursValue) || hoursValue <= 0) {
          throw new Error('יש להזין מספר שעות גדול מ-0.');
        }
      }

      if (isGlobal) {
        if (!dayType) {
          throw new Error('יש לבחור סוג יום.');
        }
        if ((segment._status === 'new' || !segment.id) && (!Number.isFinite(hoursValue) || hoursValue <= 0)) {
          throw new Error('יש להזין מספר שעות גדול מ-0.');
        }
      }

      const serviceId = isHourlyOrGlobal ? GENERIC_RATE_SERVICE_ID : segment.service_id;
      const { rate: rateUsed, reason } = getRateForDate(
        employee.id,
        dayReference,
        serviceId,
      );
      if (!rateUsed) {
        const error = new Error(reason || 'לא הוגדר תעריף עבור תאריך זה.');
        error.code = 'TIME_ENTRY_RATE_MISSING';
        throw error;
      }

      const legacyPaidLeave = segment.entry_type === 'paid_leave' && !isGlobal;
      const notes = legacyPaidLeave
        ? (segment.notes ? `${segment.notes} (סומן בעבר כחופשה)` : 'סומן בעבר כחופשה')
        : (segment.notes || null);

      let totalPayment = 0;

      if (isHourly) {
        totalPayment = (Number.isFinite(hoursValue) ? hoursValue : 0) * rateUsed;
      } else if (isGlobal) {
        try {
          totalPayment = calculateGlobalDailyRate(employee, dayReference, rateUsed);
        } catch (error) {
          error.code = error.code || 'TIME_ENTRY_GLOBAL_RATE_FAILED';
          throw error;
        }
      } else {
        const service = services.find(svc => svc.id === segment.service_id);
        if (!service) {
          const error = new Error('נדרש לבחור שירות עבור מדריך.');
          error.code = 'TIME_ENTRY_SERVICE_REQUIRED';
          throw error;
        }
        const sessionsCount = parseInt(segment.sessions_count, 10) || 1;
        const studentsCount = parseInt(segment.students_count, 10) || 0;
        if (service.payment_model === 'per_student') {
          totalPayment = sessionsCount * studentsCount * rateUsed;
        } else {
          totalPayment = sessionsCount * rateUsed;
        }
      }

      const payloadBase = {
        employee_id: employee.id,
        date: normalizedDate,
        notes,
        rate_used: rateUsed,
        total_payment: totalPayment,
      };

      if (isHourly) {
        payloadBase.entry_type = 'hours';
        payloadBase.hours = Number.isFinite(hoursValue) ? hoursValue : 0;
        payloadBase.service_id = GENERIC_RATE_SERVICE_ID;
        payloadBase.sessions_count = null;
        payloadBase.students_count = null;
      } else if (isGlobal) {
        payloadBase.entry_type = 'hours';
        payloadBase.hours = Number.isFinite(hoursValue) ? hoursValue : null;
        payloadBase.service_id = null;
        payloadBase.sessions_count = null;
        payloadBase.students_count = null;
      } else {
        payloadBase.entry_type = 'session';
        payloadBase.service_id = segment.service_id;
        payloadBase.sessions_count = parseInt(segment.sessions_count, 10) || 1;
        payloadBase.students_count = parseInt(segment.students_count, 10) || null;
      }

      if (hasDuplicateSession(Array.isArray(workSessions) ? workSessions : [], {
        ...payloadBase,
        id: segment.id || null,
      })) {
        const error = new Error('רישום זה כבר קיים.');
        error.code = 'TIME_ENTRY_DUPLICATE';
        throw error;
      }

      if (canWriteMetadata) {
        const metadata = buildSourceMetadata(source);
        if (metadata) {
          payloadBase.metadata = metadata;
        }
      }

      if (segment.id) {
        toUpdate.push({ id: segment.id, updates: payloadBase });
      } else {
        toInsert.push(payloadBase);
      }
    }

    if (!toInsert.length && !toUpdate.length) {
      throw new Error('אין שינויים לשמירה.');
    }

    if (toInsert.length) {
      await createWorkSessions({
        session,
        orgId,
        sessions: toInsert,
      });
    }

    if (toUpdate.length) {
      await Promise.all(
        toUpdate.map(({ id, updates }) => updateWorkSession({
          session,
          orgId,
          sessionId: id,
          body: { updates },
        })),
      );
    }

    return {
      insertedCount: toInsert.length,
      updatedCount: toUpdate.length,
      inserted: toInsert,
      updated: toUpdate,
    };
  };

  const saveLeaveDay = async (input = {}) => {
    ensureApiPrerequisites();

    const {
      employee = null,
      day = null,
      date = null,
      leaveType = null,
      paidLeaveId = null,
      paidLeaveNotes = null,
      mixedPaid = null,
      mixedSubtype = null,
      mixedHalfDay = null,
      source = 'table',
    } = input || {};

    if (!employee || !employee.id) {
      throw new Error('נדרש לבחור עובד לשמירת חופשה.');
    }

    const normalizedDate = typeof date === 'string' && date
      ? date
      : (day instanceof Date && !Number.isNaN(day.getTime())
        ? format(day, 'yyyy-MM-dd')
        : null);

    if (!normalizedDate) {
      throw new Error('נדרש תאריך תקין לשמירת חופשה.');
    }

    const dayReference = day instanceof Date && !Number.isNaN(day.getTime())
      ? day
      : new Date(`${normalizedDate}T00:00:00`);

    if (Number.isNaN(dayReference.getTime())) {
      throw new Error('נדרש תאריך תקין לשמירת חופשה.');
    }

    if (!leaveType) {
      const error = new Error('יש לבחור סוג חופשה.');
      error.code = 'TIME_ENTRY_LEAVE_TYPE_REQUIRED';
      throw error;
    }

    if (employee.start_date && employee.start_date > normalizedDate) {
      const error = new Error('לא ניתן לשמור חופשה לפני תחילת העבודה.');
      error.code = 'TIME_ENTRY_LEAVE_BEFORE_START';
      error.details = {
        requestedDate: normalizedDate,
        startDate: employee.start_date,
      };
      throw error;
    }

    const effectivePolicy = leavePolicy && typeof leavePolicy === 'object'
      ? leavePolicy
      : {};

    if (leaveType === 'half_day' && !effectivePolicy.allow_half_day) {
      const error = new Error('חצי יום אינו מאושר במדיניות הנוכחית.');
      error.code = 'TIME_ENTRY_HALF_DAY_DISABLED';
      throw error;
    }

    const workConflicts = Array.isArray(workSessions)
      ? workSessions.filter(session =>
        session &&
        session.employee_id === employee.id &&
        session.date === normalizedDate &&
        !isLeaveEntryType(session.entry_type) &&
        session.entry_type !== 'adjustment',
      )
      : [];

    if (workConflicts.length > 0) {
      const error = new Error('קיימים רישומי עבודה מתנגשים בתאריך זה.');
      error.code = 'TIME_ENTRY_WORK_CONFLICT';
      error.conflicts = workConflicts;
      throw error;
    }

    const existingLedgerEntries = Array.isArray(leaveBalances)
      ? leaveBalances.filter(entry => {
        if (!entry || entry.employee_id !== employee.id) return false;
        const entryDate = getLeaveLedgerEntryDate(entry);
        if (entryDate !== normalizedDate) return false;
        const ledgerType = getLeaveLedgerEntryType(entry) || '';
        return ledgerType.startsWith(TIME_ENTRY_LEAVE_PREFIX);
      })
      : [];

    const ledgerDeleteIds = existingLedgerEntries
      .map(entry => entry?.id)
      .filter(Boolean);

    const existingLedgerDelta = existingLedgerEntries.reduce(
      (sum, entry) => sum + (getLeaveLedgerEntryDelta(entry) || 0),
      0,
    );

    const baseLeaveKind = getLeaveBaseKind(leaveType) || leaveType;
    const isMixed = baseLeaveKind === 'mixed';
    const resolvedMixedSubtype = isMixed
      ? (normalizeMixedSubtype(mixedSubtype) || DEFAULT_MIXED_SUBTYPE)
      : null;
    const leaveSubtype = isMixed ? null : getLeaveSubtypeFromValue(leaveType);
    const entryType = getEntryTypeForLeaveKind(baseLeaveKind) || getEntryTypeForLeaveKind('system_paid');
    if (!entryType) {
      const error = new Error('סוג חופשה לא נתמך.');
      error.code = 'TIME_ENTRY_LEAVE_UNSUPPORTED';
      throw error;
    }

    const allowHalfDay = Boolean(effectivePolicy.allow_half_day);
    const mixedIsPaid = isMixed ? (mixedPaid !== false) : false;
    const mixedHalfDayRequested = isMixed && mixedIsPaid && mixedHalfDay === true;
    const mixedHalfDayEnabled = mixedHalfDayRequested && allowHalfDay;
    if (baseLeaveKind === 'half_day' && !allowHalfDay) {
      const error = new Error('חצי יום אינו מאושר במדיניות הנוכחית.');
      error.code = 'TIME_ENTRY_HALF_DAY_DISABLED';
      throw error;
    }

    const isPayable = isMixed ? mixedIsPaid : isPayableLeaveKind(baseLeaveKind);
    const leaveFraction = baseLeaveKind === 'half_day'
      ? 0.5
      : (isMixed ? (mixedHalfDayEnabled ? 0.5 : 1) : 1);

    const ledgerDelta = getLeaveLedgerDelta(baseLeaveKind) || 0;

    const summary = selectLeaveRemaining(employee.id, normalizedDate, {
      employees,
      leaveBalances,
      policy: effectivePolicy,
    }) || {};

    const remaining = typeof summary.remaining === 'number' ? summary.remaining : 0;
    const baselineRemaining = remaining - existingLedgerDelta;
    const projected = baselineRemaining + ledgerDelta;

    if (ledgerDelta < 0) {
      if (!effectivePolicy.allow_negative_balance) {
        if (baselineRemaining <= 0 || projected < 0) {
          const error = new Error('חריגה ממכסה ימי החופשה המותרים.');
          error.code = 'TIME_ENTRY_LEAVE_BALANCE_EXCEEDED';
          error.details = { baselineRemaining, projected };
          throw error;
        }
      } else {
        const floorLimit = getNegativeBalanceFloor(effectivePolicy);
        if (projected < floorLimit) {
          const error = new Error('חריגה ממכסה ימי החופשה המותרים.');
          error.code = 'TIME_ENTRY_LEAVE_BALANCE_EXCEEDED';
          error.details = { baselineRemaining, projected, floorLimit };
          throw error;
        }
      }
    }

    const canWriteMetadata = await resolveCanWriteMetadata();

    let rateUsed = null;
    let totalPayment = 0;
    let resolvedLeaveValue = 0;

    if (isPayable) {
      const { rate, reason } = getRateForDate(
        employee.id,
        dayReference,
        GENERIC_RATE_SERVICE_ID,
      );
      rateUsed = rate || 0;
      if (!rateUsed && employee.employee_type === 'global') {
        const error = new Error(reason || 'לא הוגדר תעריף עבור תאריך זה.');
        error.code = 'TIME_ENTRY_RATE_MISSING';
        throw error;
      }

      const selectorValue = resolveLeaveValue(employee.id, normalizedDate);
      if (typeof selectorValue === 'number' && Number.isFinite(selectorValue) && selectorValue > 0) {
        resolvedLeaveValue = selectorValue;
      }

      if (employee.employee_type === 'global') {
        if (!(typeof resolvedLeaveValue === 'number' && Number.isFinite(resolvedLeaveValue) && resolvedLeaveValue > 0)) {
          try {
            resolvedLeaveValue = calculateGlobalDailyRate(employee, dayReference, rateUsed);
          } catch (error) {
            error.code = error.code || 'TIME_ENTRY_GLOBAL_RATE_FAILED';
            throw error;
          }
        }
        const fraction = Number.isFinite(leaveFraction) && leaveFraction > 0 ? leaveFraction : 1;
        totalPayment = resolvedLeaveValue * fraction;
      }
    }

    const leaveRow = {
      employee_id: employee.id,
      date: normalizedDate,
      notes: paidLeaveNotes ? paidLeaveNotes : null,
      rate_used: isPayable ? (rateUsed || null) : null,
      total_payment: isPayable && employee.employee_type === 'global' ? totalPayment : 0,
      entry_type: entryType,
      hours: 0,
      service_id: null,
      sessions_count: null,
      students_count: null,
      payable: Boolean(isPayable),
    };

    if (hasDuplicateSession(Array.isArray(workSessions) ? workSessions : [], leaveRow)) {
      const error = new Error('רישום זה כבר קיים.');
      error.code = 'TIME_ENTRY_DUPLICATE';
      throw error;
    }

    if (canWriteMetadata) {
      const payContext = resolveLeavePayMethodContext(employee, leavePayPolicy);
      const dailyValueSnapshot = isPayable
        ? ((typeof resolvedLeaveValue === 'number' && Number.isFinite(resolvedLeaveValue) && resolvedLeaveValue > 0)
          ? resolvedLeaveValue
          : null)
        : null;
      const metadata = buildLeaveMetadata({
        source,
        leaveType: baseLeaveKind,
        leaveKind: baseLeaveKind,
        subtype: isMixed ? resolvedMixedSubtype : leaveSubtype,
        payable: Boolean(isPayable),
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

    const inserts = [];
    const updates = [];

    if (paidLeaveId) {
      updates.push({ id: paidLeaveId, updates: { ...leaveRow } });
    } else {
      inserts.push({ ...leaveRow });
    }

    if (inserts.length) {
      await createWorkSessions({
        session,
        orgId,
        sessions: inserts,
      });
    }

    if (updates.length) {
      await Promise.all(
        updates.map(({ id, updates: payload }) => updateWorkSession({
          session,
          orgId,
          sessionId: id,
          body: { updates: payload },
        })),
      );
    }

    if (ledgerDeleteIds.length) {
      await deleteLeaveBalanceEntries({
        session,
        orgId,
        ids: ledgerDeleteIds,
      });
    }

    let ledgerInsertPayload = null;
    if (ledgerDelta !== 0) {
      ledgerInsertPayload = {
        employee_id: employee.id,
        effective_date: normalizedDate,
        balance: ledgerDelta,
        leave_type: `${TIME_ENTRY_LEAVE_PREFIX}_${leaveType}`,
        notes: paidLeaveNotes ? paidLeaveNotes : null,
      };
      await createLeaveBalanceEntry({
        session,
        orgId,
        body: ledgerInsertPayload,
      });
    }

    return {
      inserted: inserts,
      updated: updates,
      ledgerDeletedIds: ledgerDeleteIds,
      ledgerInserted: ledgerInsertPayload ? [ledgerInsertPayload] : [],
    };
  };

  const saveMixedLeave = async (entries = [], options = {}) => {
    ensureApiPrerequisites();
    const { leaveType = 'mixed' } = options;
    const entryType = getEntryTypeForLeaveKind(leaveType);
    if (!entryType) throw new Error('סוג חופשה לא נתמך');
    const canWriteMetadata = await resolveCanWriteMetadata();
    const inserts = [];
    const conflicts = [];
    const invalidStartDates = [];
    const occupied = new Set(baseRegularSessions);
    for (const item of entries) {
      const employee = employees.find(e => e.id === item.employee_id);
      if (!employee) continue;
      const dateStr = item.date;
      if (!dateStr) continue;
      const key = `${employee.id}-${dateStr}`;
      if (employee.start_date && dateStr < employee.start_date) {
        invalidStartDates.push({
          employeeId: employee.id,
          employeeName: employee.name || '',
          date: dateStr,
          startDate: employee.start_date,
        });
        continue;
      }
      if (occupied.has(key)) {
        conflicts.push({
          employeeId: employee.id,
          employeeName: employee.name || '',
          date: dateStr,
        });
        continue;
      }
      const isPaid = item.paid !== false;
      const mixedSubtype = leaveType === 'mixed'
        ? (normalizeMixedSubtype(item.subtype) || DEFAULT_MIXED_SUBTYPE)
        : null;
      const leaveFraction = leaveType === 'half_day'
        ? 0.5
        : (leaveType === 'mixed'
          ? (isPaid && item.half_day === true ? 0.5 : 1)
          : 1);
      let rateUsed = null;
      let totalPayment = 0;
      if (isPaid) {
        const { rate, reason } = getRateForDate(employee.id, dateStr, GENERIC_RATE_SERVICE_ID);
        const resolvedRate = rate || 0;
        if (!resolvedRate && employee.employee_type === 'global') {
          throw new Error(reason || 'missing rate');
        }
        if (employee.employee_type === 'global') {
          rateUsed = resolvedRate;
          let baseValue = resolveLeaveValue(employee.id, dateStr, leaveFraction || 1);
          if (!(typeof baseValue === 'number' && Number.isFinite(baseValue) && baseValue > 0)) {
            try {
              const dailyRate = calculateGlobalDailyRate(employee, dateStr, resolvedRate);
              baseValue = (typeof dailyRate === 'number' && Number.isFinite(dailyRate) ? dailyRate : 0)
                * (leaveFraction || 1);
            } catch {
              baseValue = 0;
            }
          }
          totalPayment = baseValue;
        } else {
          rateUsed = resolvedRate || null;
        }
      }
      inserts.push({
        employee_id: employee.id,
        date: dateStr,
        entry_type: entryType,
        service_id: null,
        hours: 0,
        sessions_count: null,
        students_count: null,
        notes: item.notes || null,
        rate_used: rateUsed,
        total_payment: totalPayment,
        payable: isPaid,
      });
      const payload = inserts[inserts.length - 1];
      if (canWriteMetadata) {
        const payContext = resolveLeavePayMethodContext(employee, leavePayPolicy);
        const metadata = buildLeaveMetadata({
          source: 'multi_date_leave',
          leaveType,
          leaveKind: leaveType,
          subtype: leaveType === 'mixed' ? mixedSubtype : getLeaveSubtypeFromValue(leaveType),
          payable: isPaid,
          fraction: isPaid ? leaveFraction : null,
          halfDay: leaveType === 'half_day' || (leaveType === 'mixed' && isPaid && item.half_day === true),
          mixedPaid: leaveType === 'mixed' ? Boolean(isPaid) : null,
          method: payContext.method,
          lookbackMonths: payContext.lookback_months,
          legalAllow12mIfBetter: payContext.legal_allow_12m_if_better,
          dailyValueSnapshot: (typeof totalPayment === 'number' && Number.isFinite(totalPayment) && totalPayment > 0)
            ? (leaveFraction ? totalPayment / leaveFraction : totalPayment)
            : null,
          overrideApplied: payContext.override_applied,
        });
        if (metadata) {
          payload.metadata = metadata;
        }
      }
      occupied.add(key);
    }
    if (!inserts.length) {
      if (conflicts.length > 0 || invalidStartDates.length > 0) {
        const error = new Error('leave_conflicts');
        error.code = 'TIME_ENTRY_LEAVE_CONFLICT';
        error.conflicts = conflicts;
        error.invalidStartDates = invalidStartDates;
        throw error;
      }
      throw new Error('no valid rows');
    }
    await createWorkSessions({ session, orgId, sessions: inserts });
    return { inserted: inserts, conflicts, invalidStartDates };
  };

  const saveAdjustments = async (input = {}) => {
    ensureApiPrerequisites();

    const isLegacyArrayInput = Array.isArray(input);
    const source = isLegacyArrayInput
      ? 'multi_date'
      : (input?.source || 'table');

    const adjustments = isLegacyArrayInput
      ? input
      : (Array.isArray(input?.adjustments) ? input.adjustments : []);

    if (!adjustments.length) {
      throw new Error('אין התאמות לשמירה.');
    }

    const canWriteMetadata = await resolveCanWriteMetadata();

    const newEntries = [];
    const updates = [];

    for (const item of adjustments) {
      const employeeId = item?.employee_id || input?.employee?.id;
      if (!employeeId) {
        throw new Error('נדרש עובד לשמירת ההתאמות.');
      }
      const employeeRecord = employees.find(emp => emp.id === employeeId) || input?.employee;
      if (!employeeRecord) {
        throw new Error('העובד המבוקש לא נמצא.');
      }

      const dateValue = item?.date || input?.date;
      if (!dateValue) {
        throw new Error('יש לבחור תאריך לכל התאמה.');
      }

      const amountRaw = typeof item?.amount === 'number'
        ? item.amount
        : parseFloat(item?.amount);
      if (!amountRaw || Number.isNaN(amountRaw) || amountRaw <= 0) {
        throw new Error('נא להזין סכום גדול מ-0 עבור כל התאמה.');
      }

      const notesValue = typeof item?.notes === 'string' ? item.notes.trim() : '';
      if (!notesValue) {
        throw new Error('נא למלא סכום והערה עבור כל התאמה.');
      }

      const normalizedAmount = item?.type === 'debit'
        ? -Math.abs(amountRaw)
        : Math.abs(amountRaw);

      const basePayload = {
        employee_id: employeeId,
        date: dateValue,
        entry_type: 'adjustment',
        notes: notesValue,
        total_payment: normalizedAmount,
        rate_used: normalizedAmount,
        hours: null,
        service_id: null,
        sessions_count: null,
        students_count: null,
      };

      if (canWriteMetadata) {
        const metadata = buildSourceMetadata(source);
        if (metadata) {
          basePayload.metadata = metadata;
        }
      }

      if (item?.id) {
        updates.push({ id: item.id, updates: basePayload });
      } else {
        newEntries.push(basePayload);
      }
    }

    if (!newEntries.length && !updates.length) {
      throw new Error('אין התאמות לשמירה.');
    }

    if (newEntries.length) {
      await createWorkSessions({ session, orgId, sessions: newEntries });
    }

    if (updates.length) {
      await Promise.all(
        updates.map(({ id, updates: payload }) => {
          const updateValues = { ...payload };
          return updateWorkSession({
            session,
            orgId,
            sessionId: id,
            body: { updates: updateValues },
          });
        }),
      );
    }

    return {
      createdCount: newEntries.length,
      updatedCount: updates.length,
    };
  };

  return {
    saveRows,
    saveWorkDay,
    saveLeaveDay,
    saveMixedLeave,
    saveAdjustments,
  };
}
