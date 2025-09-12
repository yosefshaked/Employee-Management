import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell, LineChart, Line } from 'recharts';
import { Skeleton } from "@/components/ui/skeleton";
import { format, parseISO, startOfMonth, endOfMonth, eachMonthOfInterval } from "date-fns";
import { he } from "date-fns/locale";
import { getProratedBaseSalary } from "@/lib/salaryUtils";

const COLORS = ['#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444', '#06B6D4'];

export default function ChartsOverview({ sessions, employees, isLoading, services, workSessions = [], getRateForDate, dateFrom, dateTo, scopedEmployeeIds, rateHistories = [] }) {
  const [pieType, setPieType] = React.useState('count');
  const [trendType, setTrendType] = React.useState('payment');

  const monthsInRange = React.useMemo(() => eachMonthOfInterval({
    start: startOfMonth(parseISO(dateFrom)),
    end: endOfMonth(parseISO(dateTo))
  }), [dateFrom, dateTo]);
  const monthsSet = React.useMemo(() => new Set(monthsInRange.map(m => format(m, 'yyyy-MM'))), [monthsInRange]);
  
  // Aggregate sessions by type for the pie chart (count vs time)
  // Must be declared before any early returns to preserve hook order
  const sessionsByType = React.useMemo(() => {
    if (!sessions || !employees || !services) return [];

    const totals = new Map();
    const employeeById = new Map(employees.map(e => [e.id, e]));
    const serviceById = new Map(services.map(s => [s.id, s]));

    const sessionTypeToHours = (session) => {
      if (session.hours != null) return session.hours;
      switch (session.session_type) {
        case 'session_30':
          return 0.5 * (session.sessions_count || 0);
        case 'session_45':
          return 0.75 * (session.sessions_count || 0);
        case 'session_150':
          return 2.5 * (session.sessions_count || 0);
        default:
          return 0;
      }
    };

    for (const s of sessions) {
      const emp = employeeById.get(s.employee_id);
      if (!emp || !emp.is_active) continue;

      // Only include instructor sessions in the pie
      if (emp.employee_type !== 'instructor') continue;

      const service = serviceById.get(s.service_id);
      const name = service ? service.name : 'Unknown Service';
      const value = pieType === 'count'
        ? (s.sessions_count || 0)
        : (service && service.duration_minutes
            ? (service.duration_minutes / 60) * (s.sessions_count || 0)
            : sessionTypeToHours(s));
      if (!value) continue;
      totals.set(name, (totals.get(name) || 0) + value);
    }

    return Array.from(totals, ([name, value]) => ({ name, value }));
  }, [sessions, employees, services, pieType]);

  if (isLoading) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-80 w-full" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <Skeleton className="h-60" />
          <Skeleton className="h-60" />
        </div>
      </div>
    );
  }

  // No rate calculations needed for chart totals; rely on stored session payments

  // Payment by employee (active employees only)
  const paymentByEmployee = employees.filter(e => e.is_active && scopedEmployeeIds.has(e.id)).map(employee => {
    const employeeSessions = sessions.filter(
      s => s.employee_id === employee.id && (!employee.start_date || s.date >= employee.start_date)
    );

    const sessionTotals = employeeSessions.reduce((acc, session) => {
      const sessionDate = parseISO(session.date);
      if (session.entry_type === 'adjustment') {
        acc.totalAdjustments += session.total_payment || 0;
      } else {
        if (employee.employee_type === 'instructor') {
          const service = services.find(se => se.id === session.service_id);
          const rate = getRateForDate(employee.id, sessionDate, session.service_id).rate;
          let payment = 0;
          if (service && service.payment_model === 'per_student') {
            payment = (session.sessions_count || 0) * (session.students_count || 0) * rate;
          } else {
            payment = (session.sessions_count || 0) * rate;
          }
          acc.sessionPayment += payment;
          acc.totalSessions += session.sessions_count || 0;
        } else if (employee.employee_type === 'hourly') {
          const rate = getRateForDate(employee.id, sessionDate).rate;
          acc.sessionPayment += (session.hours || 0) * rate;

        }
      }
      return acc;
    }, { sessionPayment: 0, totalSessions: 0, totalAdjustments: 0 });

    const filteredIds = new Set(employeeSessions.map(s => s.id));
    const extraAdjustments = (workSessions || [])
      .filter(
        s =>
          s.employee_id === employee.id &&
          s.entry_type === 'adjustment' &&
          (!employee.start_date || s.date >= employee.start_date)
      )
      .filter(s => monthsSet.has(format(parseISO(s.date), 'yyyy-MM')))
      .filter(s => !filteredIds.has(s.id))
      .reduce((sum, s) => sum + (s.total_payment || 0), 0);

    let totalPayment = 0;
    if (employee.employee_type === 'global') {
      const monthsWithSessions = new Set(
        (workSessions.length ? workSessions : sessions)
          .filter(s =>
            s.employee_id === employee.id &&
            s.entry_type !== 'adjustment' &&
            monthsSet.has(format(parseISO(s.date), 'yyyy-MM'))
          )
          .map(s => format(parseISO(s.date), 'yyyy-MM'))
      );
      let baseTotal = 0;
      monthsInRange.forEach(m => {
        const key = format(m, 'yyyy-MM');
        const monthStart = startOfMonth(m);
        const monthEnd = endOfMonth(m);
        if (monthsWithSessions.has(key) && (!employee.start_date || parseISO(employee.start_date) <= monthEnd)) {
          baseTotal += getProratedBaseSalary(employee, monthStart, monthEnd, rateHistories);
        }
      });
      totalPayment = baseTotal + sessionTotals.totalAdjustments + extraAdjustments;
    } else {
      totalPayment = sessionTotals.sessionPayment + sessionTotals.totalAdjustments + extraAdjustments;
    }

    return {
      name: employee.name,
      payment: totalPayment,
      sessions: employeeSessions.length
    };
  }).filter(item => item.payment !== 0);

  // Monthly trend based on filtered range (fallback to last 6 months)
  const months = monthsInRange;
  const monthlyData = months.map(month => {
    const monthStart = startOfMonth(month);
    const monthEnd = endOfMonth(month);
    const monthSessions = sessions.filter(session => {
      const sessionDate = parseISO(session.date);
      return sessionDate >= monthStart && sessionDate <= monthEnd;
    });
    const monthAllSessions = (workSessions.length ? workSessions : sessions).filter(session => {
      const sessionDate = parseISO(session.date);
      return sessionDate >= monthStart && sessionDate <= monthEnd;
    });
    let payment = 0, hours = 0, sessionsCount = 0;
    monthSessions.forEach(session => {
      const employee = employees.find(e => e.id === session.employee_id);
      if (!employee || !employee.is_active) return;
      if (employee.start_date && session.date < employee.start_date) return;

      if (session.entry_type === 'adjustment') {
        payment += session.total_payment || 0;
        return;
      }

      if (session.hours != null) {
        if (employee.employee_type === 'hourly') {
          const rate = getRateForDate(employee.id, session.date).rate;
          payment += (session.hours || 0) * rate;
        }
        if (session.entry_type !== 'adjustment') {
          hours += session.hours;
          sessionsCount += session.hours || 0;
        }
      } else {
        const service = services.find(s => s.id === session.service_id);
        const rate = getRateForDate(employee.id, session.date, session.service_id).rate;
        let pay = 0;
        if (service && service.payment_model === 'per_student') {
          pay = (session.sessions_count || 0) * (session.students_count || 0) * rate;
        } else {
          pay = (session.sessions_count || 0) * rate;
        }
        payment += pay;
        if (session.session_type === 'session_30') {
          const inc = 0.5 * (session.sessions_count || 0);
          hours += inc;
          sessionsCount += (session.sessions_count || 0);
        } else if (session.session_type === 'session_45') {
          const inc = 0.75 * (session.sessions_count || 0);
          hours += inc;
          sessionsCount += (session.sessions_count || 0);
        } else if (session.session_type === 'session_150') {
          const inc = 2.5 * (session.sessions_count || 0);
          hours += inc;
          sessionsCount += (session.sessions_count || 0);
        }
      }
    });

    // Include adjustments outside the filtered range but within this month
    const monthSessionIds = new Set(monthSessions.map(s => s.id));
    const extraAdjustments = monthAllSessions
      .filter(s => s.entry_type === 'adjustment' && !monthSessionIds.has(s.id))
      .filter(s => {
        const emp = employees.find(e => e.id === s.employee_id);
        return !emp || !emp.start_date || s.date >= emp.start_date;
      })
      .reduce((sum, s) => sum + (s.total_payment || 0), 0);
    payment += extraAdjustments;

    const globalEmployees = employees.filter(e => e.employee_type === 'global' && scopedEmployeeIds.has(e.id));
    globalEmployees.forEach(emp => {
      const hasSession = monthAllSessions.some(s => s.employee_id === emp.id && s.entry_type !== 'adjustment');
      if (hasSession && (!emp.start_date || parseISO(emp.start_date) <= monthEnd)) {
        payment += getProratedBaseSalary(emp, monthStart, monthEnd, rateHistories);
      }
    });
    return {
      month: format(month, 'MMM', { locale: he }),
      payment,
      sessions: sessionsCount,
      hours
    };
  });

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-lg font-semibold mb-4">תשלומים לפי עובד</h3>
        <div className="w-full overflow-x-auto">
          <BarChart width={Math.max(800, paymentByEmployee.length * 120)} height={320} data={paymentByEmployee} margin={{ left: 50, right: 30, top: 20, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis 
              dataKey="name"
              tick={{ fontSize: 15, angle: 0, textAnchor: 'middle', width: 120, wordBreak: 'break-all' }}
              interval={0}
              height={60}
              padding={{ left: 30, right: 10 }}
            />
            <YAxis />
            <Tooltip formatter={(value) => [`₪${value.toLocaleString()}`, 'שכר']} />
            <Legend verticalAlign="top" align="center" layout="horizontal" height={36} />
            <Bar dataKey="payment" fill="#3B82F6" name="שכר (₪)" barSize={40} radius={[8, 8, 0, 0]} label={{ position: 'top', fill: '#3B82F6', fontSize: 14 }} />
          </BarChart>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div>
          <h3 className="text-lg font-semibold mb-4">התפלגות לפי סוג מפגש</h3>
          {sessions.length === 0 ? (
            <div className="text-center text-slate-500 py-12">אין נתונים להצגה</div>
          ) : sessionsByType.length === 0 ? (
            <div className="text-center text-slate-500 py-12">כל המפגשים הם מסוג לא ידוע</div>
          ) : (
            <div>
              <div className="mb-2 flex gap-2 justify-center">
                <button
                  className={`px-3 py-1 rounded ${pieType === 'count' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
                  onClick={() => setPieType('count')}
                >
                  לפי מספר מפגשים
                </button>
                <button
                  className={`px-3 py-1 rounded ${pieType === 'time' ? 'bg-green-500 text-white' : 'bg-gray-200'}`}
                  onClick={() => setPieType('time')}
                >
                  לפי שעות
                </button>
              </div>
              <PieChart width={400} height={280}>
                <Pie
                  data={sessionsByType}
                  cx={200}
                  cy={140}
                  labelLine={false}
                  label={({ percent, x, y }) => (
                    <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={16} fill="#222">
                      {`${(percent * 100).toFixed(0)}%`}
                    </text>
                  )}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                  paddingAngle={2}
                >
                  {sessionsByType.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value, name, props) => {
                  const entry = props && props.payload;
                  // Show service name and value type
                  const labelType = pieType === 'count' ? 'מפגשים' : 'שעות';
                  const text = `${entry.name}:\n${value} ${labelType}`;
                  const lines = text.length > 40 ? text.match(/.{1,40}/g) : [text];
                  return [lines.map((line, i) => <div key={i}>{line}</div>)];
                }} />
              </PieChart>
              <div className="flex flex-wrap justify-center mt-4 gap-4">
                {sessionsByType.map((entry, index) => (
                  <div key={entry.name} className="flex items-center gap-2">
                    <span style={{ width: 16, height: 16, background: COLORS[index % COLORS.length], display: 'inline-block', borderRadius: 4 }}></span>
                    <span className="text-sm text-slate-700">{entry.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div>
          <h3 className="text-lg font-semibold mb-4">מגמה חודשית (6 חודשים אחרונים)</h3>
          <div className="mb-2 flex gap-2">
            <button
              className={`px-3 py-1 rounded ${trendType === 'payment' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
              onClick={() => setTrendType('payment')}
            >
              שכר
            </button>
            <button
              className={`px-3 py-1 rounded ${trendType === 'sessions' ? 'bg-green-500 text-white' : 'bg-gray-200'}`}
              onClick={() => setTrendType('sessions')}
            >
              מפגשים
            </button>
          </div>
          <LineChart width={440} height={270} data={monthlyData} margin={{ left: 20, right: 20, top: 20, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" tick={{ fontSize: 13 }} padding={{ left: 10, right: 10 }} />
            <YAxis />
            <Tooltip formatter={(value, name) => {
              if (trendType === 'payment') {
                return [`₪${value.toLocaleString()}`, 'תשלום (₪)'];
              }
              if (trendType === 'sessions') {
                return [value, 'מפגשים'];
              }
              return [value, name];
            }} />
            <Legend verticalAlign="top" height={36} />
            {trendType === 'payment' && (
              <Line type="monotone" dataKey="payment" stroke="#3B82F6" name="שכר (₪)" dot={{ r: 5 }} strokeWidth={3} label={({ x, y, value }) => <text x={x} y={y - 10} textAnchor="middle" fontSize={13} fill="#3B82F6">₪{value.toLocaleString()}</text>} />
            )}
            {trendType === 'sessions' && (
              <Line type="monotone" dataKey="sessions" stroke="#10B981" name="מפגשים" dot={{ r: 5 }} strokeWidth={3} label={({ x, y, value }) => <text x={x} y={y - 10} textAnchor="middle" fontSize={13} fill="#10B981">{value}</text>} />
            )}
          </LineChart>
        </div>
      </div>
    </div>
  );
}
