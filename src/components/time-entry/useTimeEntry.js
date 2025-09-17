import { calculateGlobalDailyRate } from '../../lib/payroll.js';
import { getEntryTypeForLeaveKind, getLeaveKindFromEntryType, isLeaveEntryType } from '../../lib/leave.js';
import {
  buildLeaveMetadata,
  buildSourceMetadata,
  canUseWorkSessionMetadata,
} from '../../lib/workSessionsMetadata.js';

const GENERIC_RATE_SERVICE_ID = '00000000-0000-0000-0000-000000000000';

export function useTimeEntry({ employees, services, getRateForDate, supabaseClient, workSessions = [] }) {
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

  const saveRows = async (rows, dayTypeMap = {}) => {
    const client = supabaseClient || (await import('../../supabaseClient.js')).supabase;
    const canWriteMetadata = await canUseWorkSessionMetadata(client);
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
          const metadata = buildLeaveMetadata({
            source: 'multi_date',
            leaveType: leaveKind,
            leaveKind,
            payable: true,
            fraction: leaveKind === 'half_day' ? 0.5 : 1,
            halfDay: leaveKind === 'half_day',
            method: employee.employee_type === 'global' ? 'global_contract' : null,
            dailyValueSnapshot: totalPayment || null,
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
    const { error } = await client.from('WorkSessions').insert(inserts);
    if (error) throw error;
    return { inserted: inserts, conflicts: leaveConflicts };
  };

  const saveMixedLeave = async (entries = [], options = {}) => {
    const client = supabaseClient || (await import('../../supabaseClient.js')).supabase;
    const { leaveType = 'mixed' } = options;
    const entryType = getEntryTypeForLeaveKind(leaveType);
    if (!entryType) throw new Error('סוג חופשה לא נתמך');
    const canWriteMetadata = await canUseWorkSessionMetadata(client);
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
      const leaveFraction = leaveType === 'half_day' ? 0.5 : 1;
      let rateUsed = null;
      let totalPayment = 0;
      if (isPaid) {
        const { rate, reason } = getRateForDate(employee.id, dateStr, GENERIC_RATE_SERVICE_ID);
        const resolvedRate = rate || 0;
        if (!resolvedRate && employee.employee_type === 'global') {
          throw new Error(reason || 'missing rate');
        }
        if (employee.employee_type === 'global') {
          const dailyRate = calculateGlobalDailyRate(employee, dateStr, resolvedRate);
          rateUsed = resolvedRate;
          totalPayment = dailyRate * leaveFraction;
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
        const metadata = buildLeaveMetadata({
          source: 'multi_date_leave',
          leaveType,
          leaveKind: leaveType,
          payable: isPaid,
          fraction: leaveFraction,
          halfDay: leaveType === 'half_day',
          mixedPaid: leaveType === 'mixed' ? Boolean(isPaid) : null,
          method: employee.employee_type === 'global' ? 'global_contract' : null,
          dailyValueSnapshot: totalPayment && leaveFraction ? totalPayment / leaveFraction : totalPayment || null,
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
    const { error } = await client.from('WorkSessions').insert(inserts);
    if (error) throw error;
    return { inserted: inserts, conflicts, invalidStartDates };
  };

  return { saveRows, saveMixedLeave };
}
