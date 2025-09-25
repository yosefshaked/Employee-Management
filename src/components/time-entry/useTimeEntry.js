import { createWorkSessions } from '@/api/work-sessions.js';
import { calculateGlobalDailyRate } from '../../lib/payroll.js';
import {
  getEntryTypeForLeaveKind,
  getLeaveKindFromEntryType,
  getLeaveBaseKind,
  getLeaveSubtypeFromValue,
  inferLeaveType,
  getLeaveValueMultiplier,
  isLeaveEntryType,
  resolveLeavePayMethodContext,
  normalizeMixedSubtype,
  DEFAULT_MIXED_SUBTYPE,
} from '../../lib/leave.js';
import {
  buildLeaveMetadata,
  buildSourceMetadata,
  canUseWorkSessionMetadata,
} from '../../lib/workSessionsMetadata.js';
import { selectLeaveDayValue } from '../../selectors.js';

const GENERIC_RATE_SERVICE_ID = '00000000-0000-0000-0000-000000000000';

export function useTimeEntry({
  employees,
  services,
  getRateForDate,
  supabaseClient,
  dataClient = null,
  session = null,
  orgId = null,
  workSessions = [],
  leavePayPolicy = null,
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

  const metadataClient = dataClient || supabaseClient || null;

  const resolveCanWriteMetadata = async () => {
    if (!metadataClient) {
      return false;
    }
    try {
      return await canUseWorkSessionMetadata(metadataClient);
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

  const saveAdjustments = async (items = []) => {
    ensureApiPrerequisites();
    const canWriteMetadata = await resolveCanWriteMetadata();
    const inserts = [];
    const invalidNotes = [];
    for (const item of items) {
      const employee = employees.find(e => e.id === item.employee_id);
      if (!employee) continue;
      if (!item.date) continue;
      const amountValue = parseFloat(item.amount);
      if (!item.amount || Number.isNaN(amountValue) || amountValue <= 0) continue;
      const notesValue = typeof item.notes === 'string' ? item.notes.trim() : '';
      if (!notesValue) {
        invalidNotes.push({ employee_id: employee.id, date: item.date });
        continue;
      }
      const normalizedAmount = item.type === 'debit' ? -Math.abs(amountValue) : Math.abs(amountValue);
      const payload = {
        employee_id: employee.id,
        date: item.date,
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
        const metadata = buildSourceMetadata('multi_date');
        if (metadata) {
          payload.metadata = metadata;
        }
      }
      inserts.push(payload);
    }
    if (invalidNotes.length > 0) {
      const error = new Error('כל התאמה חייבת לכלול הערה.');
      error.code = 'TIME_ENTRY_ADJUSTMENT_NOTE_REQUIRED';
      error.invalidEntries = invalidNotes;
      throw error;
    }
    if (!inserts.length) {
      throw new Error('לא נמצאו התאמות לשמירה');
    }
    await createWorkSessions({ session, orgId, sessions: inserts });
    return { inserted: inserts };
  };

  return { saveRows, saveMixedLeave, saveAdjustments };
}
