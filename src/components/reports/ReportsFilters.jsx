import React from 'react';
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Filter } from "lucide-react";

export default function ReportsFilters({ filters, setFilters, employees, services = [], errors = {}, onDateBlur }) {
  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  return (
    <Card className="bg-white/70 backdrop-blur-sm border-0 shadow-lg">
      <CardContent className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="w-5 h-5 text-blue-500" />
          <h3 className="text-lg font-semibold text-slate-900">מסננים</h3>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="space-y-2">
            <Label className="text-sm font-semibold">עובד ספציפי</Label>
            <Select
              value={filters.selectedEmployee}
              onValueChange={(value) => handleFilterChange('selectedEmployee', value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="כל העובדים" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>כל העובדים</SelectItem>
                {employees.map(emp => (
                  <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold">תאריך מ</Label>
            <Input
              type="text"
              placeholder="DD/MM/YYYY"
              value={filters.dateFrom}
              onChange={(e) => handleFilterChange('dateFrom', e.target.value)}
              onBlur={() => onDateBlur && onDateBlur('dateFrom', filters.dateFrom)}
              className={errors.dateFrom ? 'border-red-500' : ''}
            />
            {errors.dateFrom && <p className="text-sm text-red-500">{errors.dateFrom}</p>}
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold">תאריך עד</Label>
            <Input
              type="text"
              placeholder="DD/MM/YYYY"
              value={filters.dateTo}
              onChange={(e) => handleFilterChange('dateTo', e.target.value)}
              onBlur={() => onDateBlur && onDateBlur('dateTo', filters.dateTo)}
              className={errors.dateTo ? 'border-red-500' : ''}
            />
            {errors.dateTo && <p className="text-sm text-red-500">{errors.dateTo}</p>}
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold">סוג עובד</Label>
            <Select
              value={filters.employeeType}
              onValueChange={(value) => handleFilterChange('employeeType', value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל הסוגים</SelectItem>
                <SelectItem value="hourly">עובדים שעתיים</SelectItem>
                <SelectItem value="instructor">מדריכים</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold">סוג שירות</Label>
            <Select
              value={filters.serviceId}
              onValueChange={(value) => handleFilterChange('serviceId', value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל הסוגים</SelectItem>
                {services.map(service => (
                  <SelectItem key={service.id} value={service.id}>{service.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {errors.range && (
            <div className="md:col-span-2 lg:col-span-5 text-sm text-red-500">
              {errors.range}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}