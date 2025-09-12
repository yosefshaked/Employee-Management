import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

export default function EmployeePicker({ employees, value, onChange }) {
  const [open, setOpen] = useState(false);
  const toggle = (id) => {
    if (value.includes(id)) {
      onChange(value.filter(v => v !== id));
    } else {
      onChange([...value, id]);
    }
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">בחר עובדים</Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 max-h-60 overflow-auto p-2">
        {employees.map(emp => (
          <label key={emp.id} className="flex items-center gap-2 py-1 cursor-pointer">
            <input type="checkbox" checked={value.includes(emp.id)} onChange={() => toggle(emp.id)} />
            <span className="text-sm">{emp.name}</span>
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}
