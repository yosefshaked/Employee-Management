import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Calendar as CalendarIcon, Save, DollarSign } from "lucide-react";
import { format } from "date-fns";
import { he } from "date-fns/locale";
import { toast } from "sonner";
import { supabase } from "../supabaseClient";
import { InfoTooltip } from "../components/InfoTooltip"; // ודא שהקובץ הזה קיים

export default function Adjustments() {
  const [employees, setEmployees] = React.useState([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [formData, setFormData] = React.useState({
  employee_id: '',
  adjustment_type: 'credit', // 'credit' for bonus, 'debit' for deduction
  amount: '',
  notes: '',
  date: new Date().toISOString().split('T')[0],
});

  // Load active employees when the component mounts
  React.useEffect(() => {
    const loadEmployees = async () => {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('Employees')
        .select('*')
        .eq('is_active', true)
        .order('name');
      
      if (error) {
        toast.error("שגיאה בטעינת העובדים");
      } else {
        setEmployees(data);
      }
      setIsLoading(false);
    };
    loadEmployees();
  }, []);

  const handleFormChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Convert amount to negative if it's a debit
    const finalAmount = formData.adjustment_type === 'debit'
        ? -Math.abs(parseFloat(formData.amount))
        : Math.abs(parseFloat(formData.amount));

    if (isNaN(finalAmount)) {
        toast.error("הסכום שהוזן אינו תקין.");
        return;
    }
    
    const dataToSave = {
        ...formData,
        amount: finalAmount,
    };

    toast.info("לוגיקת השמירה עדיין לא מומשה.");
    console.log("Data to save:", dataToSave);
    };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">התאמות שכר</h1>
          <p className="text-slate-600">הזן בונוסים, ניכויים או התאמות שכר אחרות לעובדים</p>
        </div>

        <div className="grid lg:grid-cols-5 gap-8">
          {/* Main Form Column */}
          <div className="lg:col-span-3">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="w-5 h-5 text-green-500" /> הזנת התאמה חדשה
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <form onSubmit={handleSubmit} className="space-y-6">
                  {/* Employee Selector */}
                  <div className="space-y-2">
                    <Label htmlFor="employee_id">עבור מי ההתאמה?</Label>
                    <Select value={formData.employee_id} onValueChange={(value) => handleFormChange('employee_id', value)} required>
                      <SelectTrigger><SelectValue placeholder="בחר/י עובד..." /></SelectTrigger>
                      <SelectContent>{employees.map(emp => (<SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>))}</SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* NEW Adjustment Type Field */}
                    <div className="space-y-2">
                        <Label htmlFor="adjustment_type">סוג ההתאמה</Label>
                        <Select value={formData.adjustment_type} onValueChange={(value) => handleFormChange('adjustment_type', value)}>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="credit">זיכוי (בונוס)</SelectItem>
                            <SelectItem value="debit">ניכוי</SelectItem>
                        </SelectContent>
                        </Select>
                    </div>

                    {/* Amount Field */}
                    <div className="space-y-2">
                        <Label htmlFor="amount">סכום (₪)</Label>
                        <Input 
                        id="amount" 
                        type="number" 
                        step="0.01" 
                        value={formData.amount} 
                        onChange={(e) => handleFormChange('amount', e.target.value)} 
                        placeholder="לדוגמה: 500" 
                        required 
                        />
                    </div>

                    {/* Date Field */}
                    <div className="space-y-2">
                      <Label htmlFor="date" className="flex items-center gap-2">
                        תאריך חיוב/זיכוי
                            <InfoTooltip 
                            text={`התאריך קובע לאיזה חודש תשלום ההתאמה שייכת.
                                • לאירוע יומי: אם זהו ניכוי על איחור ב-15.05, יש לבחור 15/05.
                                • לבונוס חודשי: אם זהו בונוס על הצטיינות בחודש מאי, אפשר לבחור את היום האחרון של החודש, 31/05.`
                            }
                        />
                        </Label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" className="w-full justify-start text-right font-normal bg-white">
                                        <CalendarIcon className="ml-2 h-4 w-4" />
                                        {format(new Date(formData.date), 'dd/MM/yyyy')}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0">
                                    <Calendar mode="single" selected={new Date(formData.date)} onSelect={(date) => date && handleFormChange('date', format(date, 'yyyy-MM-dd'))} initialFocus locale={he} />
                                </PopoverContent>
                            </Popover>
                        </div>
                    </div>
                  {/* Notes Field */}
                  <div className="space-y-2">
                    <Label htmlFor="notes">סיבה / תיאור ההתאמה</Label>
                    <Input id="notes" value={formData.notes} onChange={(e) => handleFormChange('notes', e.target.value)} placeholder="לדוגמה: בונוס חג או ניכוי על נזק לציוד" required />
                  </div>

                  <div className="pt-4 flex justify-end">
                    <Button type="submit" className="bg-gradient-to-r from-green-500 to-blue-500 text-white">
                      <Save className="w-4 h-4 ml-2" />
                      שמור התאמה
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>

          {/* Recent Activity Column */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader><CardTitle>התאמות אחרונות</CardTitle></CardHeader>
              <CardContent><p className="text-slate-500">יוצג כאן בקרוב...</p></CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}