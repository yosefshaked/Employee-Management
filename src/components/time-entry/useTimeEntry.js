import { calculateGlobalDailyRate } from '../../lib/payroll.js';
import { getEntryTypeForLeaveKind, isLeaveEntryType } from '../../lib/leave.js';

export function useTimeEntry({ employees, services, getRateForDate, supabaseClient }) {
  const saveRows = async (rows, dayTypeMap = {}) => {
    const client = supabaseClient || (await import('../../supabaseClient.js')).supabase;
    const inserts = [];
    for (const row of rows) {
      const employee = employees.find(e => e.id === row.employee_id);
      if (!employee) continue;
      const isHourlyOrGlobal = employee.employee_type === 'hourly' || employee.employee_type === 'global';
      const { rate: rateUsed, reason } = getRateForDate(employee.id, row.date, isHourlyOrGlobal ? null : row.service_id);
      if (!rateUsed) throw new Error(reason || 'missing rate');
      let totalPayment = 0;
      const empDayType = dayTypeMap[row.employee_id];
      const originalType = row.entry_type;
      let entryType;
      if (employee.employee_type === 'global') {
        entryType = empDayType === 'paid_leave' ? getEntryTypeForLeaveKind('system_paid') : 'hours';
      } else {
        entryType = employee.employee_type === 'instructor' ? 'session' : 'hours';
        if (originalType && isLeaveEntryType(originalType)) {
          row.notes = row.notes ? `${row.notes} (סומן בעבר כחופשה)` : 'סומן בעבר כחופשה';
        }
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
      }
      inserts.push(payload);
    }
    if (!inserts.length) throw new Error('no valid rows');
    const { error } = await client.from('WorkSessions').insert(inserts);
    if (error) throw error;
    return inserts;
  };

  return { saveRows };
}
