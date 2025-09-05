import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isToday, parseISO, addMonths, subMonths, isSameMonth, getDay } from "date-fns";
import { he } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";

const HEBREW_DAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

export default function MonthlyCalendar({ currentDate, setCurrentDate, workSessions, employees, isLoading }) {
  const [popover, setPopover] = useState({ open: false, anchor: null, day: null, sessions: [] });
  const popoverBubbleRef = useRef();
  const anchorRef = useRef(null);
  // Close popover on click outside
  useEffect(() => {
    if (!popover.open) return;
    function handleClick(e) {
      if (popoverBubbleRef.current && !popoverBubbleRef.current.contains(e.target) && popover.anchor && !popover.anchor.contains(e.target)) {
        setPopover(p => ({ ...p, open: false }));
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [popover.open, popover.anchor]);
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const getSessionsForDate = (date) => {
    return workSessions.filter(session => {
      const sessionDate = parseISO(session.date);
      return format(sessionDate, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd');
    });
  };
    // Close popover on click outside

  // Get unique employees for a date
  const getUniqueEmployeesForDate = (date) => {
    const sessions = getSessionsForDate(date);
    const seen = new Set();
    return sessions.filter(s => {
      if (seen.has(s.employee_id)) return false;
      seen.add(s.employee_id);
      return true;
    });
  };

  const getEmployeeName = (employeeId) => {
    const employee = employees.find(emp => emp.id === employeeId);
    return employee ? employee.name : 'לא ידוע';
  };

  const navigateMonth = (direction) => {
    if (direction === 'next') {
      setCurrentDate(addMonths(currentDate, 1));
    } else {
      setCurrentDate(subMonths(currentDate, 1));
    }
  };

  return (
    <Card className="bg-white/70 backdrop-blur-sm border-0 shadow-lg">
      <CardHeader className="p-6 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => navigateMonth('prev')}>
              <ChevronRight className="w-5 h-5" />
            </Button>
            <CardTitle className="flex items-center gap-2 text-xl font-bold text-slate-900">
              <Calendar className="w-5 h-5 text-blue-500" />
              {format(currentDate, 'MMMM yyyy', { locale: he })}
            </CardTitle>
            <Button variant="ghost" size="icon" onClick={() => navigateMonth('next')}>
              <ChevronLeft className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
  {/* ...existing code... */}
        <div className="grid grid-cols-7 gap-2 mt-4">
          {days.map((day, index) => {
            const isCurrentDay = isToday(day);
            const uniqueEmployees = getUniqueEmployeesForDate(day);
            return (
              <div
                key={index}
                className={`min-h-20 p-2 rounded-lg border transition-all duration-200 ${
                  isCurrentDay 
                    ? 'bg-blue-50 border-blue-200 shadow-sm' 
                    : 'bg-white border-slate-200 hover:bg-slate-50'
                } ${!isSameMonth(day, currentDate) ? 'opacity-30' : ''}`}
                style={{ cursor: 'pointer', position: 'relative' }}
                onClick={e => {
                  setPopover({
                    open: true,
                    anchor: e.currentTarget,
                    day,
                    sessions: uniqueEmployees
                  });
                }}
              >
                <div className={`text-sm font-semibold mb-1 ${isCurrentDay ? 'text-blue-700' : 'text-slate-700'}`}>
                  {format(day, 'd')}
                </div>
                <div className="space-y-1">
                  {uniqueEmployees.slice(0, 2).map((session, idx) => (
                    <Badge
                      key={idx}
                      variant="secondary"
                      className={`text-xs w-full justify-center ${
                        session.session_type === 'hourly' 
                          ? 'bg-green-100 text-green-700 border-green-200' 
                          : 'bg-purple-100 text-purple-700 border-purple-200'
                      }`}
                    >
                      {getEmployeeName(session.employee_id).split(' ')[0]}
                    </Badge>
                  ))}
                  {uniqueEmployees.length > 2 && (
                    <Badge
                      variant="outline"
                      className="text-xs w-full justify-center text-slate-500"
                    >
                      +{uniqueEmployees.length - 2}
                    </Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {/* Popover bubble for showing all employees for a day (React, absolutely positioned, rendered at root) */}
        {popover.open && popover.anchor && (
          <PopoverBubble anchor={popover.anchor} ref={popoverBubbleRef}>
            <div className="font-bold text-sm mb-2 text-center">
              כל העובדים ליום {popover.day ? format(popover.day, 'dd/MM/yyyy', { locale: he }) : ''}
            </div>
            <div className="space-y-2 mb-2">
              {popover.sessions.map((session, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 bg-slate-100 rounded px-2 py-1 text-xs text-slate-700 border border-slate-200"
                >
                  <span className="font-semibold">{getEmployeeName(session.employee_id)}</span>
                </div>
              ))}
            </div>
            {/* ...existing code... */}
          </PopoverBubble>
        )}
      </CardContent>
    </Card>
  );
}

// Helper component for absolutely positioned popover using React portal
const PopoverBubble = React.forwardRef(function PopoverBubble({ anchor, children }, ref) {
  const [style, setStyle] = React.useState({});
  useEffect(() => {
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setStyle({
      position: 'fixed',
      left: rect.left + rect.width / 2 - 140,
      top: rect.bottom + 16,
      zIndex: 99999,
      minWidth: 260,
      maxWidth: 340,
      background: 'linear-gradient(135deg, #f8fafc 80%, #e0e7ff 100%)',
      border: '1.5px solid #a5b4fc',
      borderRadius: 16,
      boxShadow: '0 6px 32px 0 rgba(60,60,120,0.18)',
      padding: '24px 20px 16px 20px',
      direction: 'rtl',
      transition: 'opacity 0.2s',
      fontFamily: 'inherit',
    });
  }, [anchor]);
  if (!anchor) return null;
  return ReactDOM.createPortal(
    <div ref={ref} style={style}>
      {/* Arrow */}
      <div style={{
        position: 'absolute',
        top: -12,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 0,
        height: 0,
        borderLeft: '12px solid transparent',
        borderRight: '12px solid transparent',
        borderBottom: '12px solid #a5b4fc',
        zIndex: 100001,
      }} />
      <div style={{
        position: 'absolute',
        top: -10,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 0,
        height: 0,
        borderLeft: '10px solid transparent',
        borderRight: '10px solid transparent',
        borderBottom: '10px solid #f8fafc',
        zIndex: 100002,
      }} />
      <div style={{marginTop: 8}}>
        {/* Remove סגור link if present in children */}
        {Array.isArray(children)
          ? children.filter(child => !(typeof child === 'string' && child.includes('סגור')))
          : children}
      </div>
      <div style={{display:'flex',justifyContent:'center',marginTop:20}}>
        <button
          onClick={() => {
            // Close the popover reliably
            document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          }}
          style={{
            background: 'linear-gradient(90deg, #6366f1 0%, #60a5fa 100%)',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '8px 32px',
            fontSize: 17,
            fontWeight: 500,
            boxShadow: '0 2px 8px 0 rgba(60,60,120,0.10)',
            cursor: 'pointer',
            letterSpacing: '0.5px',
            transition: 'background 0.2s',
          }}
          aria-label="סגור חלון מידע"
        >סגור</button>
      </div>
    </div>,
    document.body
  );
});