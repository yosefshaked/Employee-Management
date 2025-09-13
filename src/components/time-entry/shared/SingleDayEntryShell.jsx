import React from 'react';
import DayHeader from '../DayHeader.jsx';
import { Button } from '@/components/ui/button';

export default function SingleDayEntryShell({
  employee,
  date,
  showDayType = false,
  dayType,
  onDayTypeChange,
  segments,
  renderSegment,
  onAddSegment,
  addLabel,
  summary,
  onCancel
}) {
  return (
    <div className="flex flex-col w-full h-full">
      <div className="sticky top-0 z-20 bg-background border-b px-4 py-3">
        <DayHeader
          employee={employee}
          date={date}
          dayType={dayType}
          onChange={onDayTypeChange}
          hideDayType={!showDayType}
        />
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 pb-28">
        {segments.map(renderSegment)}
        <Button type="button" variant="outline" onClick={onAddSegment} className="self-start">
          {addLabel}
        </Button>
      </div>
      <div className="sticky bottom-0 z-20 bg-background border-t px-4 py-3 flex justify-between items-center">
        <div className="text-sm text-slate-700">{summary}</div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>בטל</Button>
          <Button type="submit">שמור רישומים</Button>
        </div>
      </div>
    </div>
  );
}
