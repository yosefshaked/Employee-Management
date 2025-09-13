import React from 'react';
import { Button } from '@/components/ui/button';

const weekNames = ['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'];

export default function DayHeader({ employee, date, dayType, onChange, dayTypeError }) {
  const dayLabel = React.useMemo(() => {
    const d = new Date(date + 'T00:00:00');
    const dayName = weekNames[d.getDay()];
    const dayStr = d.toLocaleDateString('he-IL');
    return `${dayStr} · יום ${dayName}`;
  }, [date]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="text-lg font-semibold truncate">{employee.name}</div>
        <div className="text-sm text-slate-600">{dayLabel}</div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex rounded-md overflow-hidden ring-1 ring-slate-200">
          <Button
            type="button"
            variant={dayType === 'regular' ? 'default' : 'ghost'}
            className="rounded-none"
            onClick={() => onChange('regular')}
          >
            יום רגיל
          </Button>
          <Button
            type="button"
            variant={dayType === 'paid_leave' ? 'default' : 'ghost'}
            className="rounded-none"
            onClick={() => onChange('paid_leave')}
          >
            חופשה בתשלום
          </Button>
        </div>
      </div>
      {dayTypeError && <p className="text-sm text-red-600">יש לבחור סוג יום</p>}
      <p className="text-sm text-slate-600">שכר גלובלי נספר לפי יום; הוספת מקטע שעות לא מכפילה שכר.</p>
    </div>
  );
}
