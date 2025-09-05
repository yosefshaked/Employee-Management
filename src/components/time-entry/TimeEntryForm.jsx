import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Calendar as CalendarIcon, Save, Info } from "lucide-react";
import { format } from "date-fns";
import { he } from "date-fns/locale";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { supabase } from '@/supabaseClient';

const initialFormState = {
  employee_id: '',
  date: new Date().toISOString().split('T')[0],
  service_id: '',
  hours: '',
  sessions_count: '1',
  students_count: '',
  notes: ''
};

export default function TimeEntryForm({ employees, onSubmit, isLoading, getRateForDate }) {
  const [formData, setFormData] = useState(initialFormState);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [calculatedPayment, setCalculatedPayment] = useState(0);
  const [rateUsed, setRateUsed] = useState(0);
  const [services, setServices] = useState([]);
  const [selectedService, setSelectedService] = useState(null);
  const [isServicesLoading, setIsServicesLoading] = useState(true);
  
  // State לניהול חלון האישור
  const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState(false);
  const [pendingEmployeeId, setPendingEmployeeId] = useState(null);

  useEffect(() => {
    const fetchServices = async () => {
      setIsServicesLoading(true);
      const { data, error } = await supabase.from('Services').select('*').order('name');
      if (error) console.error("Failed to fetch services:", error);
      else setServices(data);
      setIsServicesLoading(false);
    };
    fetchServices();
  }, []);

  useEffect(() => {
    const service = services.find(s => s.id === formData.service_id);
    setSelectedService(service || null);
  }, [formData.service_id, services]);

  useEffect(() => {
    if (selectedEmployee && formData.date && (selectedService || selectedEmployee.employee_type === 'hourly')) {
      const rate = getRateForDate(selectedEmployee.id, formData.date, selectedService?.id);
      setRateUsed(rate);
      let payment = 0;
      if (selectedEmployee.employee_type === 'hourly') {
        payment = (parseFloat(formData.hours) || 0) * rate;
      } else if (selectedService) {
        const sessions = parseInt(formData.sessions_count) || 0;
        if (selectedService.payment_model === 'per_student') {
          const students = parseInt(formData.students_count) || 0;
          payment = sessions * students * rate;
        } else {
          payment = sessions * rate;
        }
      }
      setCalculatedPayment(payment);
    } else {
      setCalculatedPayment(0);
      setRateUsed(0);
    }
  }, [formData, selectedEmployee, selectedService, getRateForDate]);

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleEmployeeChange = (newEmployeeId) => {
    const newEmployee = employees.find(e => e.id === newEmployeeId);
    if (!selectedEmployee || newEmployee.employee_type === selectedEmployee.employee_type) {
      // אם אין עובד קודם או שסוג העובד זהה - פשוט תחליף
      setFormData(prev => ({...prev, employee_id: newEmployeeId}));
      setSelectedEmployee(newEmployee);
    } else {
      // אם סוג העובד שונה - פתח חלון אזהרה
      setPendingEmployeeId(newEmployeeId);
      setIsConfirmDialogOpen(true);
    }
  };

  const handleConfirmChange = () => {
    // אישור - בצע איפוס חלקי והחלף עובד
    const newEmployee = employees.find(e => e.id === pendingEmployeeId);
    setFormData(prev => ({
      ...prev,
      employee_id: pendingEmployeeId,
      service_id: '',
      hours: '',
      sessions_count: '1',
      students_count: ''
    }));
    setSelectedEmployee(newEmployee);
    setIsConfirmDialogOpen(false);
    setPendingEmployeeId(null);
  };

  const handleCancelChange = () => {
    // ביטול - סגור חלון, אל תשנה כלום
    setIsConfirmDialogOpen(false);
    setPendingEmployeeId(null);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      hours: parseFloat(formData.hours) || null,
      sessions_count: parseInt(formData.sessions_count) || null,
      students_count: parseInt(formData.students_count) || null,
    });
    setFormData(prev => ({...initialFormState, employee_id: prev.employee_id}));
  };

  if (isLoading || isServicesLoading) { /* ... Skeleton ... */ }

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="employee" className="font-semibold">עובד</Label>
          <Select value={formData.employee_id} onValueChange={handleEmployeeChange} required>
            <SelectTrigger><SelectValue placeholder="בחר עובד..." /></SelectTrigger>
            <SelectContent>{employees.map(emp => (<SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>))}</SelectContent>
          </Select>
        </div>

        {selectedEmployee && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="date" className="font-semibold">תאריך</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-right font-normal">
                      <CalendarIcon className="ml-2 h-4 w-4" />
                      {format(new Date(formData.date), 'dd/MM/yyyy')}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar mode="single" selected={new Date(formData.date)} onSelect={(date) => handleChange('date', format(date, 'yyyy-MM-dd'))} initialFocus locale={he} />
                  </PopoverContent>
                </Popover>
              </div>

              {selectedEmployee.employee_type === 'hourly' ? (
                <div className="space-y-2">
                  <Label htmlFor="hours" className="font-semibold">שעות עבודה</Label>
                  <Input id="hours" type="number" step="0.1" value={formData.hours} onChange={(e) => handleChange('hours', e.target.value)} placeholder="למשל 8.5" required />
                </div>
              ) : ( // Instructor
                <>
                  <div className="space-y-2">
                    <Label htmlFor="service_id" className="font-semibold">סוג שירות</Label>
                    <Select value={formData.service_id} onValueChange={(value) => handleChange('service_id', value)} required>
                      <SelectTrigger><SelectValue placeholder="בחר סוג שירות..." /></SelectTrigger>
                      <SelectContent>
                        {services.map(service => (<SelectItem key={service.id} value={service.id}>{service.name}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  {selectedService && (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="sessions_count" className="font-semibold">כמות מפגשים</Label>
                        <Input id="sessions_count" type="number" value={formData.sessions_count} onChange={(e) => handleChange('sessions_count', e.target.value)} placeholder="כמות" required />
                      </div>
                      
                      {selectedService.payment_model === 'per_student' && (
                        <div className="space-y-2">
                          <Label htmlFor="students_count" className="font-semibold">כמות תלמידים</Label>
                          <Input id="students_count" type="number" value={formData.students_count} onChange={(e) => handleChange('students_count', e.target.value)} placeholder="סה״כ תלמידים" required />
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes" className="font-semibold">הערות</Label>
              <Textarea id="notes" value={formData.notes} onChange={(e) => handleChange('notes', e.target.value)} placeholder="הערות נוספות (אופציונלי)" />
            </div>

            <Alert variant="info" className="bg-blue-50 border-blue-200">
              <Info className="h-4 w-4 text-blue-700" />
              <AlertTitle className="text-blue-800">סיכום לתשלום</AlertTitle>
              <AlertDescription className="text-blue-700">
                תעריף לחישוב: ₪{rateUsed.toFixed(2)} | סה״כ לתשלום: <span className="font-bold">₪{calculatedPayment.toFixed(2)}</span>
              </AlertDescription>
            </Alert>

            <Button type="submit" className="w-full bg-gradient-to-r from-green-500 to-blue-500 hover:from-green-600 hover:to-blue-600 text-white">
              <Save className="w-4 h-4 ml-2" />
              שמור רישום
            </Button>
          </>
        )}
      </form>

      <AlertDialog open={isConfirmDialogOpen} onOpenChange={setIsConfirmDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>שינוי סוג עובד</AlertDialogTitle>
            <AlertDialogDescription>
              שינוי לסוג עובד אחר (מעובד שעתי למדריך או להפך) יאפס את נתוני המפגש/שעות שהזנת.
              התאריך וההערות יישמרו. האם להמשיך?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelChange}>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmChange}>אישור והמשך</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}