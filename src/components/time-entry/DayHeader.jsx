import React from 'react';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Label } from '@/components/ui/label';

export default function DayHeader({ dayType, onChange }) {
  return (
    <div className="bg-slate-50 ring-1 ring-slate-200 rounded-xl px-3 py-2 mb-3">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
        <div className="space-y-1">
          <Label className="text-sm font-medium text-slate-700">סוג יום</Label>
          <Select value={dayType || ''} onValueChange={onChange}>
            <SelectTrigger className="bg-white h-10 text-base leading-6">
              <SelectValue placeholder="בחר סוג יום" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="regular">יום רגיל</SelectItem>
              <SelectItem value="paid_leave">חופשה בתשלום</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-sm text-slate-600 mt-2">שכר גלובלי נספר לפי יום; הוספת מקטע שעות לא מכפילה שכר.</p>
    </div>
  );
}
