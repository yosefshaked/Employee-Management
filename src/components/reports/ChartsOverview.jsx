import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell, LineChart, Line } from 'recharts';
import { Skeleton } from "@/components/ui/skeleton";
import { format, parseISO, startOfMonth, endOfMonth, eachMonthOfInterval } from "date-fns";
import { he } from "date-fns/locale";

const COLORS = ['#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444', '#06B6D4'];

export default function ChartsOverview({ sessions, employees, isLoading, services }) {
  const [pieType, setPieType] = React.useState('count');
  const [trendType, setTrendType] = React.useState('payment');
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

  const getEmployeeName = (employeeId) => {
    const employee = employees.find(emp => emp.id === employeeId);
    return employee ? employee.name : 'לא ידוע';
  };

  // Payment by employee
  const paymentByEmployee = employees.map(employee => {
    const employeeSessions = sessions.filter(s => s.employee_id === employee.id);
    const totalPayment = employeeSessions.reduce((sum, s) => sum + s.total_payment, 0);
    return {
      name: employee.name,
      payment: totalPayment,
      sessions: employeeSessions.length
    };
  }).filter(item => item.payment > 0);

  // Sessions by service (from Supabase)
  const sessionsByType = services.map(service => {
    const serviceSessions = sessions.filter(s => s.service_id === service.id);
  // Count sessions (sum sessions_count)
  const sessionCount = serviceSessions.reduce((sum, s) => sum + (s.sessions_count || 1), 0);
    // Calculate total time (hours)
    const totalTime = serviceSessions.reduce((sum, s) => {
      // If service has duration_minutes, use it, else fallback to 1 hour
      const duration = service.duration_minutes ? service.duration_minutes / 60 : 1;
      return sum + duration * (s.sessions_count || 1);
    }, 0);
    return {
      name: service.name,
      value: pieType === 'count' ? sessionCount : totalTime,
      sessionCount,
      totalTime,
      payment: serviceSessions.reduce((sum, s) => sum + (s.total_payment || 0), 0)
    };
  }).filter(item => item.value > 0);

  // Monthly trend (last 6 months) - match main report logic
  const now = new Date();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const months = eachMonthOfInterval({ start: sixMonthsAgo, end: now });
  const monthlyData = months.map(month => {
    const monthStart = startOfMonth(month);
    const monthEnd = endOfMonth(month);
    const monthSessions = sessions.filter(session => {
      const sessionDate = parseISO(session.date);
      return sessionDate >= monthStart && sessionDate <= monthEnd;
    });
    let payment = 0, hours = 0, sessionsCount = 0;
    const countedSessions = [];
    monthSessions.forEach(session => {
      payment += session.total_payment || 0;
      if (session.hours != null) {
        hours += session.hours;
      } else {
        if (session.session_type === 'session_30') {
          hours += 0.5 * (session.sessions_count || 0);
        } else if (session.session_type === 'session_45') {
          hours += 0.75 * (session.sessions_count || 0);
        } else if (session.session_type === 'session_150') {
          hours += 2.5 * (session.sessions_count || 0);
        }
      }
      // Only count instructor sessions
      if (session.hours == null) {
        sessionsCount += session.sessions_count || 0;
        countedSessions.push({
          id: session.id,
          employee_id: session.employee_id,
          date: session.date,
          sessions_count: session.sessions_count,
          service_id: session.service_id
        });
      }
    });
    if (typeof window !== 'undefined') {
      console.log('ChartsOverview - Counted instructor sessions for month', format(month, 'MMM yyyy', { locale: he }), countedSessions);
    }
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
