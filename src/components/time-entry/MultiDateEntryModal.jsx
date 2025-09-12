import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { InfoTooltip } from '@/components/InfoTooltip.jsx';
import { format } from 'date-fns';
import { useTimeEntry } from './useTimeEntry.js';
import { copyFromPrevious, fillDown } from './multiDateUtils.js';

export default function MultiDateEntryModal({ open, onClose, employees, services, selectedEmployees, selectedDates, getRateForDate, onSaved }) {
  const initialRows = selectedEmployees.flatMap(empId => {
    const employee = employees.find(e => e.id === empId);
    return selectedDates.map(d => ({
      employee_id: empId,
      date: format(d, 'yyyy-MM-dd'),
      entry_type: employee.employee_type === 'global' ? 'hours' : (employee.employee_type === 'hourly' ? 'hours' : 'session'),
      service_id: '',
      hours: '',
      sessions_count: '1',
      students_count: '',
    }));
  });

  const [rows, setRows] = useState(initialRows);
  const { saveRows } = useTimeEntry({ employees, services, getRateForDate });

  const handleCopy = (index, field) => setRows(prev => copyFromPrevious(prev, index, field));
  const handleFillDown = (field) => setRows(prev => fillDown(prev, field));

  const handleChange = (index, field, value) => {
    setRows(prev => prev.map((r, i) => i === index ? { ...r, [field]: value } : r));
  };

  const handleSave = async () => {
    try {
      await saveRows(rows);
      onSaved();
      onClose();
    } catch (e) {
      alert(e.message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>הזנה מרובה</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 mb-4">
          <Button variant="outline" size="sm" onClick={() => handleFillDown('hours')}>העתק מהראשון לכל השורות (שעות)</Button>
          <Button variant="outline" size="sm" onClick={() => handleFillDown('sessions_count')}>העתק מהראשון לכל השורות (מפגשים)</Button>
          <Button variant="outline" size="sm" onClick={() => handleFillDown('students_count')}>העתק מהראשון לכל השורות (תלמידים)</Button>
        </div>

        <div className="space-y-4">
          {rows.map((row, index) => {
            const employee = employees.find(e => e.id === row.employee_id);
            const isInstructor = employee.employee_type === 'instructor';
            const isGlobal = employee.employee_type === 'global';
            return (
              <div key={index} className="p-2 border rounded-md">
                <div className="grid grid-cols-6 gap-2 items-end">
                  <div className="col-span-1 text-right">
                    <Label>{format(new Date(row.date), 'dd/MM')}</Label>
                  </div>
                  {isInstructor && (
                    <div className="col-span-2">
                      <Label>שירות</Label>
                      <div className="flex gap-1">
                        <Select value={row.service_id} onValueChange={(v) => handleChange(index, 'service_id', v)}>
                          <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                          <SelectContent>{services.map(s => (<SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>))}</SelectContent>
                        </Select>
                        <Button variant="ghost" size="sm" onClick={() => handleCopy(index, 'service_id')}>העתק מהרישום הקודם</Button>
                      </div>
                    </div>
                  )}
                  {employee.employee_type === 'hourly' && (
                    <div className="col-span-2">
                      <Label>שעות</Label>
                      <div className="flex gap-1">
                        <Input type="number" step="0.1" value={row.hours} onChange={e => handleChange(index, 'hours', e.target.value)} className="bg-white" />
                        <Button variant="ghost" size="sm" onClick={() => handleCopy(index, 'hours')}>העתק מהרישום הקודם</Button>
                      </div>
                    </div>
                  )}
                  {isGlobal && (
                    <>
                      <div className="col-span-2">
                        <Label>סוג יום</Label>
                        <Select value={row.entry_type} onValueChange={(v) => handleChange(index, 'entry_type', v)}>
                          <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="hours">יום רגיל</SelectItem>
                            <SelectItem value="paid_leave">חופשה בתשלום</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-2">
                        <Label className="flex items-center gap-1">שעות<InfoTooltip text="בגלובלי השכר מחושב לפי יום; שדה השעות להצגה בלבד." /></Label>
                        <div className="flex gap-1">
                          <Input type="number" step="0.1" value={row.hours} onChange={e => handleChange(index, 'hours', e.target.value)} className="bg-white" />
                          <Button variant="ghost" size="sm" onClick={() => handleCopy(index, 'hours')}>העתק מהרישום הקודם</Button>
                        </div>
                      </div>
                    </>
                  )}
                  {isInstructor && (
                    <div className="col-span-1">
                      <Label>מפגשים</Label>
                      <div className="flex gap-1">
                        <Input type="number" value={row.sessions_count} onChange={e => handleChange(index, 'sessions_count', e.target.value)} className="bg-white" />
                        <Button variant="ghost" size="sm" onClick={() => handleCopy(index, 'sessions_count')}>העתק מהרישום הקודם</Button>
                      </div>
                    </div>
                  )}
                  {isInstructor && (
                    <div className="col-span-1">
                      <Label>תלמידים</Label>
                      <div className="flex gap-1">
                        <Input type="number" value={row.students_count} onChange={e => handleChange(index, 'students_count', e.target.value)} className="bg-white" />
                        <Button variant="ghost" size="sm" onClick={() => handleCopy(index, 'students_count')}>העתק מהרישום הקודם</Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex justify-end mt-4 gap-2">
          <Button variant="outline" onClick={onClose}>בטל</Button>
          <Button onClick={handleSave}>שמור רישומים</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
