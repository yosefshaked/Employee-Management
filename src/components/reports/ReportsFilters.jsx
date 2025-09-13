import React from 'react';
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Calendar as CalendarIcon, Filter } from "lucide-react";
import { parseDateStrict } from '@/lib/date.js';
import { format } from 'date-fns';

export default function ReportsFilters({ filters, setFilters, employees, services = [], onDateBlur }) {
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
            <div className="flex items-center gap-2">
              <Input
                type="text"
                placeholder="DD/MM/YYYY"
                value={filters.dateFrom}
                onChange={(e) => handleFilterChange('dateFrom', e.target.value)}
                onBlur={() => onDateBlur && onDateBlur('dateFrom', filters.dateFrom)}
              />
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="icon"><CalendarIcon className="w-4 h-4" /></Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={parseDateStrict(filters.dateFrom).date}
                    onSelect={(date) => date && handleFilterChange('dateFrom', format(date, 'dd/MM/yyyy'))}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold">תאריך עד</Label>
            <div className="flex items-center gap-2">
              <Input
                type="text"
                placeholder="DD/MM/YYYY"
                value={filters.dateTo}
                onChange={(e) => handleFilterChange('dateTo', e.target.value)}
                onBlur={() => onDateBlur && onDateBlur('dateTo', filters.dateTo)}
              />
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="icon"><CalendarIcon className="w-4 h-4" /></Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={parseDateStrict(filters.dateTo).date}
                    onSelect={(date) => date && handleFilterChange('dateTo', format(date, 'dd/MM/yyyy'))}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
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
                <SelectItem value="global">עובדים גלובליים</SelectItem>
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
        </div>
      </CardContent>
    </Card>
  );
}