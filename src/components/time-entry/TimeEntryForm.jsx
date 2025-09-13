import React, { useState, useMemo } from 'react';
import SingleDayEntryShell from './shared/SingleDayEntryShell.jsx';
import GlobalSegment from './segments/GlobalSegment.jsx';
import HourlySegment from './segments/HourlySegment.jsx';
import InstructorSegment from './segments/InstructorSegment.jsx';
import { calculateGlobalDailyRate } from '@/lib/payroll.js';
import { sumHours } from './dayUtils.js';

export default function TimeEntryForm({ employee, services = [], onSubmit, getRateForDate, initialRows = null, selectedDate, formId }) {
  const isGlobal = employee.employee_type === 'global';
  const isHourly = employee.employee_type === 'hourly';

  const createSeg = () => ({ id: crypto.randomUUID(), hours: '', service_id: '', sessions_count: '', students_count: '', notes: '' });
  const [segments, setSegments] = useState(initialRows && initialRows.length > 0 ? initialRows.map(r => ({ ...r, id: r.id || crypto.randomUUID() })) : [createSeg()]);
  const [dayType, setDayType] = useState('regular');
  const [errors, setErrors] = useState({});

  const dailyRate = useMemo(() => {
    if (!isGlobal) return 0;
    const { rate } = getRateForDate(employee.id, selectedDate, null);
    try { return calculateGlobalDailyRate(employee, selectedDate, rate); } catch { return 0; }
  }, [employee, selectedDate, getRateForDate, isGlobal]);

  const addSeg = () => setSegments(prev => [...prev, createSeg()]);
  const duplicateSeg = (id) => {
    setSegments(prev => {
      const idx = prev.findIndex(s => s.id === id);
      const copy = { ...prev[idx], id: crypto.randomUUID() };
      return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
    });
  };
  const deleteSeg = (id) => setSegments(prev => prev.filter(s => s.id !== id || prev.length === 1));
  const changeSeg = (id, patch) => setSegments(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));

  const validate = () => {
    const err = {};
    segments.forEach(s => {
      if (isGlobal || isHourly) {
        const h = parseFloat(s.hours);
        if (!h || h <= 0) err[s.id] = 'שעות נדרשות וגדולות מ־0';
      } else {
        if (!s.service_id) err[s.id] = 'חסר שירות';
        if (!(parseInt(s.sessions_count) >= 1)) err[s.id] = 'מספר שיעורים נדרש';
        if (!(parseInt(s.students_count) >= 1)) err[s.id] = 'מספר תלמידים נדרש';
      }
    });
    setErrors(err);
    return Object.keys(err).length === 0;
  };

  const handleSave = (e) => {
    e.preventDefault();
    if (!validate()) return;
    onSubmit({ rows: segments, dayType });
  };

  const summary = useMemo(() => {
    if (isGlobal) return `שכר יומי: ₪${dailyRate.toFixed(2)}`;
    if (isHourly) {
      const { rate } = getRateForDate(employee.id, selectedDate, null);
      const h = sumHours(segments);
      return `שכר יומי: ₪${(h * rate).toFixed(2)} | סה"כ שעות: ${h}`;
    }
    const total = segments.reduce((acc, s) => {
      const { rate } = getRateForDate(employee.id, selectedDate, s.service_id || null);
      return acc + (parseFloat(s.sessions_count || 0) * parseFloat(s.students_count || 0) * rate);
    }, 0);
    return `שכר יומי: ₪${total.toFixed(2)}`;
  }, [segments, isGlobal, isHourly, dailyRate, employee, selectedDate, getRateForDate]);

  const renderSegment = (seg, idx) => {
    if (isGlobal) {
      return <GlobalSegment key={seg.id} segment={seg} onChange={changeSeg} onDuplicate={duplicateSeg} onDelete={deleteSeg} isFirst={idx === 0} dailyRate={dailyRate} error={errors[seg.id]} />;
    }
    if (isHourly) {
      const { rate } = getRateForDate(employee.id, selectedDate, null);
      return <HourlySegment key={seg.id} segment={seg} onChange={changeSeg} onDuplicate={duplicateSeg} onDelete={deleteSeg} rate={rate} error={errors[seg.id]} />;
    }
    const { rate } = getRateForDate(employee.id, selectedDate, seg.service_id || null);
    return <InstructorSegment key={seg.id} segment={seg} services={services} onChange={changeSeg} onDuplicate={duplicateSeg} onDelete={deleteSeg} rate={rate} errors={{ service: !seg.service_id && errors[seg.id], sessions_count: errors[seg.id] && seg.service_id ? errors[seg.id] : null, students_count: errors[seg.id] && seg.service_id ? errors[seg.id] : null }} />;
  };

  const addLabel = isHourly || isGlobal ? 'הוסף מקטע שעות' : 'הוסף רישום';

  return (
    <SingleDayEntryShell
      employee={employee}
      date={selectedDate}
      showDayType={isGlobal}
      dayType={dayType}
      onDayTypeChange={setDayType}
      segments={segments}
      renderSegment={renderSegment}
      onAddSegment={addSeg}
      addLabel={addLabel}
      summary={summary}
      onCancel={() => onSubmit(null)}
      onSave={handleSave}
      formId={formId}
    />
  );
}
