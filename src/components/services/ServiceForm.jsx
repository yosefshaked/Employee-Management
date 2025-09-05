import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, X, Settings } from "lucide-react";

export default function ServiceForm({ service, onSubmit, onCancel }) {
  const [formData, setFormData] = useState({
    name: service?.name || '',
    duration_minutes: service?.duration_minutes || '',
    payment_model: service?.payment_model || 'fixed_rate',
  });
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await onSubmit({
        ...formData,
        duration_minutes: parseInt(formData.duration_minutes, 10) || null,
      });
    } catch (error) {
      console.error("Failed to submit service form:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <Card className="max-w-lg mx-auto bg-white/80 backdrop-blur-sm border-0 shadow-xl">
      <CardHeader className="p-6 border-b">
        <CardTitle className="flex items-center gap-2 text-xl font-bold text-slate-900">
          <Settings className="w-5 h-5 text-blue-500" />
          {service ? 'עריכת שירות' : 'הוספת שירות חדש'}
        </CardTitle>
      </CardHeader>
      
      <CardContent className="p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="name" className="font-semibold">שם השירות *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => handleChange('name', e.target.value)}
              placeholder="למשל: מפגש 45 דקות (לתלמיד)"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="duration_minutes" className="font-semibold">משך בדקות</Label>
            <Input
              id="duration_minutes"
              type="number"
              value={formData.duration_minutes}
              onChange={(e) => handleChange('duration_minutes', e.target.value)}
              placeholder="למשל: 45"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="payment_model" className="font-semibold">מודל תשלום *</Label>
            <Select
              value={formData.payment_model}
              onValueChange={(value) => handleChange('payment_model', value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="בחר מודל תשלום" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed_rate">תעריף קבוע</SelectItem>
                <SelectItem value="per_student">תעריף לתלמיד</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-3 pt-4">
            <Button type="submit" disabled={isLoading} className="flex-1 bg-gradient-to-r from-blue-500 to-green-500 text-white">
              <Save className="w-4 h-4 ml-2" />
              {isLoading ? 'שומר...' : (service ? 'עדכן שירות' : 'הוסף שירות')}
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