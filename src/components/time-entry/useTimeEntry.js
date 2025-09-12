import { calculateGlobalDailyRate } from '../../lib/payroll.js';

export function useTimeEntry({ employees, services, getRateForDate, supabaseClient }) {
  const saveRows = async (rows) => {
    const client = supabaseClient || (await import('../../supabaseClient.js')).supabase;
    const inserts = [];
    for (const row of rows) {
      const employee = employees.find(e => e.id === row.employee_id);
      if (!employee) continue;
      const isHourlyOrGlobal = employee.employee_type === 'hourly' || employee.employee_type === 'global';
      const { rate: rateUsed, reason } = getRateForDate(employee.id, row.date, isHourlyOrGlobal ? null : row.service_id);
      if (!rateUsed) throw new Error(reason || 'missing rate');
      let totalPayment = 0;
      if (row.entry_type === 'session') {
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
      inserts.push({
        employee_id: employee.id,
        date: row.date,
        entry_type: row.entry_type,
        service_id: row.service_id || null,
        hours: row.entry_type === 'hours' ? (parseFloat(row.hours) || null) : null,
        sessions_count: row.entry_type === 'session' ? (parseInt(row.sessions_count, 10) || null) : null,
        students_count: row.entry_type === 'session' ? (parseInt(row.students_count, 10) || null) : null,
        notes: row.entry_type === 'paid_leave' ? 'paid_leave' : null,
        rate_used: rateUsed,
        total_payment: totalPayment,
      });
    }
    if (!inserts.length) throw new Error('no valid rows');
    const { error } = await client.from('WorkSessions').insert(inserts);
    if (error) throw error;
    return inserts;
  };

  return { saveRows };
}
