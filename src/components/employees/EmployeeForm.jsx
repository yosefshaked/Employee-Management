import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Save, X, User, DollarSign } from "lucide-react";
import RateHistoryManager from './RateHistoryManager';
import { useSupabase } from '@/context/SupabaseContext.jsx';

const GENERIC_RATE_SERVICE_ID = '00000000-0000-0000-0000-000000000000';

export default function EmployeeForm({ employee, onSubmit, onCancel }) {
  const [formData, setFormData] = useState({
    name: employee?.name || '',
    employee_id: employee?.employee_id || '',
    employee_type: employee?.employee_type || 'hourly',
    current_rate: '',
    phone: employee?.phone || '',
    email: employee?.email || '',
    start_date: employee?.start_date || new Date().toISOString().split('T')[0],
    is_active: employee?.is_active !== undefined ? employee.is_active : true,
    notes: employee?.notes || '',
    working_days: employee?.working_days || ['SUN','MON','TUE','WED','THU'],
    annual_leave_days: employee?.annual_leave_days ?? 0
  });

  useEffect(() => {
  // This effect resets the form whenever the employee to be edited changes.
  setFormData({
    name: employee?.name || '',
    employee_id: employee?.employee_id || '',
    employee_type: employee?.employee_type || 'hourly',
    current_rate: '', // Always start with a blank rate
    phone: employee?.phone || '',
    email: employee?.email || '',
    start_date: employee?.start_date || new Date().toISOString().split('T')[0],
    is_active: employee?.is_active !== undefined ? employee.is_active : true,
    notes: employee?.notes || '',
    working_days: employee?.working_days || ['SUN','MON','TUE','WED','THU'],
    annual_leave_days: employee?.annual_leave_days ?? 0
  });
  
  // Also reset the instructor-specific rates
  setServiceRates({});

}, [employee]); // This dependency is crucial!

  const [services, setServices] = useState([]);
  const [rateHistory, setRateHistory] = useState([]);
  const [serviceRates, setServiceRates] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const { dataClient } = useSupabase();

useEffect(() => {
  const loadServicesAndRates = async () => {
    if (!dataClient) {
      setServices([]);
      setRateHistory([]);
      return;
    }
    // Load services only if the employee is an instructor
    if (formData.employee_type === 'instructor') {
      const { data: servicesData } = await dataClient.from('Services').select('*').order('name');
      const filteredServices = (servicesData || []).filter(service => service.id !== GENERIC_RATE_SERVICE_ID);
      setServices(filteredServices);
    } else {
      setServices([]);
    }

    // Load rate history FOR ANY existing employee
    if (employee) {
      const { data: ratesData } = await dataClient.from('RateHistory').select('*').eq('employee_id', employee.id);
      setRateHistory(ratesData || []);
      setFormData(prev => ({ ...prev, current_rate: '' }));
    }
  };
  loadServicesAndRates();
}, [dataClient, formData.employee_type, employee]);

useEffect(() => {
     if (employee && rateHistory.length > 0) {
          const latestRatesByService = {};

          // Find the latest rate for each service_id (including the generic one)
          rateHistory.forEach(rate => {
            // Use the actual service_id as the key. If it's the generic one, use it.
            const key = rate.service_id; 
            if (!latestRatesByService[key] || new Date(rate.effective_date) > new Date(latestRatesByService[key].effective_date)) {
              latestRatesByService[key] = rate;
            }
          });

          const initialServiceRates = {};
          Object.keys(latestRatesByService).forEach(key => {
            // Only populate serviceRates for actual services, not the generic one.
            if (key !== GENERIC_RATE_SERVICE_ID) {
              initialServiceRates[key] = latestRatesByService[key].rate;
            }
          });
          setServiceRates(initialServiceRates);

          // Set the hourly/global rate in the main form data by looking for the generic ID
          if (latestRatesByService[GENERIC_RATE_SERVICE_ID]) {
            setFormData(prev => ({
              ...prev,
              current_rate: latestRatesByService[GENERIC_RATE_SERVICE_ID].rate
            }));
          }
        }
      }, [employee, rateHistory]);

  const handleServiceRateChange = (serviceId, value) => {
    setServiceRates(prev => ({ ...prev, [serviceId]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await onSubmit({
        employeeData: formData,
        serviceRates,
        rateHistory,
      });
    } catch (error) {
      console.error("Form submission error", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const toggleWorkingDay = (day) => {
    setFormData(prev => {
      const exists = prev.working_days.includes(day);
      const working_days = exists ? prev.working_days.filter(d => d !== day) : [...prev.working_days, day];
      return { ...prev, working_days };
    });
  };

  const daysMap = [
    { code: 'SUN', label: 'א׳' },
    { code: 'MON', label: 'ב׳' },
    { code: 'TUE', label: 'ג׳' },
    { code: 'WED', label: 'ד׳' },
    { code: 'THU', label: 'ה׳' },
    { code: 'FRI', label: 'ו׳' },
    { code: 'SAT', label: 'ש׳' },
  ];

  // Helper object for dynamic labels
  const rateLabels = {
    hourly: 'תעריף שעתי (₪) *',
    global: 'שכר חודשי (₪) *',
  };

  return (
    <Card className="max-w-2xl mx-auto bg-white/80 backdrop-blur-sm border-0 shadow-xl">
      <CardHeader className="p-6 border-b">
        <CardTitle className="flex items-center gap-2 text-xl font-bold text-slate-900">
          <User className="w-5 h-5 text-blue-500" />
          {employee ? 'עריכת עובד' : 'הוספת עובד חדש'}
        </CardTitle>
      </CardHeader>
      
      <CardContent className="p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="name" className="text-sm font-semibold text-slate-700">שם מלא *</Label>
              <Input id="name" value={formData.name} onChange={(e) => handleChange('name', e.target.value)} placeholder="הכנס שם מלא" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="employee_id" className="text-sm font-semibold text-slate-700">מספר עובד</Label>
              <Input id="employee_id" value={formData.employee_id} onChange={(e) => handleChange('employee_id', e.target.value)} placeholder="מספר זהות עובד" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="employee_type" className="text-sm font-semibold text-slate-700">סוג עובד *</Label>
              <Select value={formData.employee_type} onValueChange={(value) => handleChange('employee_type', value)}>
                <SelectTrigger><SelectValue placeholder="בחר סוג עובד" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hourly">עובד שעתי</SelectItem>
                  <SelectItem value="instructor">מדריך</SelectItem>
                  <SelectItem value="global">עובד גלובלי</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(formData.employee_type === 'hourly' || formData.employee_type === 'global') && (
              <div className="space-y-2">
                <Label htmlFor="current_rate" className="text-sm font-semibold text-slate-700">
                  {rateLabels[formData.employee_type]}
                </Label>
                <Input 
                  id="current_rate" 
                  type="number" 
                  step="0.01" 
                  value={formData.current_rate} 
                  onChange={(e) => handleChange('current_rate', e.target.value)} 
                  placeholder="0.00" 
                  required 
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="phone" className="text-sm font-semibold text-slate-700">טלפון</Label>
              <Input id="phone" value={formData.phone} onChange={(e) => handleChange('phone', e.target.value)} placeholder="050-1234567" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-semibold text-slate-700">אימייל</Label>
              <Input id="email" type="email" value={formData.email} onChange={(e) => handleChange('email', e.target.value)} placeholder="example@email.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="start_date" className="text-sm font-semibold text-slate-700">תאריך התחלה</Label>
              <Input id="start_date" type="date" value={formData.start_date} onChange={(e) => handleChange('start_date', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="annual_leave_days" className="text-sm font-semibold text-slate-700">מכסת חופשה שנתית (ימים)</Label>
              <Input
                id="annual_leave_days"
                type="number"
                min={0}
                step="0.5"
                value={formData.annual_leave_days}
                onChange={(e) => handleChange('annual_leave_days', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="is_active" className="text-sm font-semibold text-slate-700">סטטוס עובד</Label>
              <div className="flex items-center gap-3 pt-2">
                <Switch
                  id="is_active"
                  checked={formData.is_active}
                  onCheckedChange={(checked) => handleChange('is_active', checked)}
                />
                <span className="text-sm text-slate-600">{formData.is_active ? 'פעיל' : 'לא פעיל'}</span>
              </div>
            </div>
            {formData.employee_type === 'global' && (
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">ימי עבודה</Label>
                <div className="grid grid-cols-7 gap-2">
                  {daysMap.map(d => (
                    <div key={d.code} className="flex flex-col items-center">
                      <Switch checked={formData.working_days.includes(d.code)} onCheckedChange={() => toggleWorkingDay(d.code)} />
                      <span className="text-xs mt-1">{d.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          {formData.employee_type === 'instructor' && (
            <div className="space-y-4 pt-4 border-t">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-green-600" />
                תעריפים לפי שירות
              </h3>
              {services.length === 0 ? <p className="text-sm text-slate-500">טוען שירותים...</p> : (
                <div className="space-y-3">
                  {services.map(service => (
                    <div key={service.id} className="grid grid-cols-3 gap-4 items-center">
                      <Label htmlFor={`rate-${service.id}`} className="col-span-1">{service.name}</Label>
                      <div className="col-span-2">
                        <Input
                          id={`rate-${service.id}`}
                          type="number"
                          step="0.01"
                          placeholder="הזן תעריף"
                          value={serviceRates[service.id] || ''}
                          onChange={(e) => handleServiceRateChange(service.id, e.target.value)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {employee && (
            <div className="space-y-4 pt-4 border-t">
              <RateHistoryManager
                rateHistory={rateHistory}
                services={services}
                employeeType={formData.employee_type}
                onChange={setRateHistory}
              />
            </div>
          )}
          <div className="flex gap-3 pt-4">
            <Button type="submit" disabled={isLoading} className="flex-1 bg-gradient-to-r from-green-500 to-blue-500 hover:from-green-600 hover:to-blue-600 text-white">
              <Save className="w-4 h-4 ml-2" />
              {isLoading ? "שומר..." : (employee ? 'עדכן עובד' : 'הוסף עובד')}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading} className="flex-1">
              <X className="w-4 h-4 ml-2" />
              בטל
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}