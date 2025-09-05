import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Save, X, User, DollarSign } from "lucide-react";
import { supabase } from '@/supabaseClient';

export default function EmployeeForm({ employee, onSubmit, onCancel }) {
  const [formData, setFormData] = useState({
    name: employee?.name || '',
    employee_id: employee?.employee_id || '',
    employee_type: employee?.employee_type || 'hourly',
    current_rate: employee?.current_rate || '',
    phone: employee?.phone || '',
    email: employee?.email || '',
    start_date: employee?.start_date || new Date().toISOString().split('T')[0],
    is_active: employee?.is_active !== undefined ? employee.is_active : true,
    notes: employee?.notes || ''
  });
  
  const [services, setServices] = useState([]);
  const [rateHistory, setRateHistory] = useState([]);
  const [serviceRates, setServiceRates] = useState({});
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const loadFormData = async () => {
      if (formData.employee_type === 'instructor') {
        const { data: servicesData } = await supabase.from('Services').select('*').order('name');
        setServices(servicesData || []);

        if (employee) {
          const { data: ratesData } = await supabase.from('RateHistory').select('*').eq('employee_id', employee.id);
          setRateHistory(ratesData || []);
        }
      }
    };
    loadFormData();
  }, [formData.employee_type, employee]);

  useEffect(() => {
    if (employee && rateHistory.length > 0) {
      const initialRates = {};
      const latestRates = {};

      rateHistory.forEach(rate => {
        if (rate.service_id) {
          if (!latestRates[rate.service_id] || new Date(rate.effective_date) > new Date(latestRates[rate.service_id].effective_date)) {
            latestRates[rate.service_id] = rate;
          }
        }
      });

      Object.keys(latestRates).forEach(serviceId => {
        initialRates[serviceId] = latestRates[serviceId].rate;
      });
      setServiceRates(initialRates);
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
        employeeData: { ...formData, current_rate: parseFloat(formData.current_rate) || 0 },
        serviceRates,
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
                </SelectContent>
              </Select>
            </div>
            {formData.employee_type === 'hourly' ? (
              <div className="space-y-2">
                <Label htmlFor="current_rate" className="text-sm font-semibold text-slate-700">תעריף שעתי (₪) *</Label>
                <Input id="current_rate" type="number" step="0.01" value={formData.current_rate} onChange={(e) => handleChange('current_rate', e.target.value)} placeholder="0.00" required />
              </div>
            ) : (<div className="md:col-span-1"></div>)}
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
              <Label htmlFor="is_active" className="text-sm font-semibold text-slate-700">סטטוס עובד</Label>
              <div className="flex items-center gap-3 mt-2">
                <Switch id="is_active" checked={formData.is_active} onCheckedChange={(checked) => handleChange('is_active', checked)} />
                <span className="text-sm text-slate-600">{formData.is_active ? 'פעיל' : 'לא פעיל'}</span>
              </div>
            </div>
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