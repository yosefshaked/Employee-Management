import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Plus, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import EmployeeList from "../components/employees/EmployeeList";
import EmployeeForm from "../components/employees/EmployeeForm";
import { supabase } from "../supabaseClient";

export default function Employees() {
  const [employees, setEmployees] = useState([]);
  const [rateHistories, setRateHistories] = useState([]);
  const [filteredEmployees, setFilteredEmployees] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [isLoading, setIsLoading] = useState(true);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [employeesData, ratesData] = await Promise.all([
        supabase.from('Employees').select('*').order('name'),
        supabase.from('RateHistory').select('*')
      ]);
      if (employeesData.error) throw employeesData.error;
      if (ratesData.error) throw ratesData.error;
      setEmployees(employeesData.data);
      setRateHistories(ratesData.data);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error("שגיאה בטעינת הנתונים");
    }
    setIsLoading(false);
  };

  const filterEmployees = useCallback(() => {
    let filtered = employees;
    if (activeTab === "active") filtered = filtered.filter(emp => emp.is_active);
    else if (activeTab === "inactive") filtered = filtered.filter(emp => !emp.is_active);
    if (searchTerm) {
      filtered = filtered.filter(emp =>
        emp.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        emp.employee_id?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    setFilteredEmployees(filtered);
  }, [employees, searchTerm, activeTab]);

  useEffect(() => { loadData(); }, []);
  useEffect(() => { filterEmployees(); }, [filterEmployees]);

  const handleSubmit = async ({ employeeData, serviceRates }) => {
    try {
      let employeeId;
      const isNewEmployee = !editingEmployee;

      if (isNewEmployee) {
        const { data, error } = await supabase.from('Employees').insert([employeeData]).select('id').single();
        if (error) throw error;
        employeeId = data.id;
        toast.success("העובד נוצר בהצלחה!");
      } else {
        employeeId = editingEmployee.id;
        const { error } = await supabase.from('Employees').update(employeeData).eq('id', employeeId);
        if (error) throw error;
        toast.success("פרטי העובד עודכנו בהצלחה!");
      }

      if (employeeData.employee_type === 'instructor') {
        const rateUpdates = Object.keys(serviceRates).map(serviceId => {
          const rateValue = parseFloat(serviceRates[serviceId]);
          if (!isNaN(rateValue)) {
            return {
              employee_id: employeeId,
              service_id: serviceId,
              effective_date: new Date().toISOString().split('T')[0],
              rate: rateValue,
              notes: isNewEmployee ? 'תעריף התחלתי' : 'שינוי תעריף',
            };
          }
          return null;
        }).filter(Boolean);

        if (rateUpdates.length > 0) {
          const { error } = await supabase.from('RateHistory').upsert(rateUpdates, { onConflict: 'employee_id,service_id,effective_date' });
          if (error) throw error;
        }
      }
      setShowForm(false);
      setEditingEmployee(null);
      loadData();
    } catch (error) {
      console.error("Error in handleSubmit:", error);
      toast.error(`שגיאה בשמירת הנתונים: ${error.message}`);
      throw error;
    }
  };

  const handleEdit = (employee) => {
    setEditingEmployee(employee);
    setShowForm(true);
  };

  const handleToggleActive = async (employee) => {
    const { error } = await supabase.from('Employees').update({ is_active: !employee.is_active }).eq('id', employee.id);
    if (!error) loadData();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 mb-2">ניהול עובדים</h1>
            <p className="text-slate-600">נהל את פרטי העובדים ותעריפיהם</p>
          </div>
          <Button onClick={() => { setEditingEmployee(null); setShowForm(true); }} className="bg-gradient-to-r from-blue-500 to-green-500 hover:from-blue-600 hover:to-green-600 text-white shadow-lg">
            <Plus className="w-5 h-5 ml-2" />
            הוסף עובד חדש
          </Button>
        </div>
        {showForm ? (
          <EmployeeForm
            employee={editingEmployee}
            onSubmit={handleSubmit}
            onCancel={() => { setShowForm(false); setEditingEmployee(null); }}
          />
        ) : (
          <>
            <div className="mb-6 flex flex-col md:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
                <Input placeholder="חפש עובד..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pr-10" />
              </div>
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full md:w-auto">
                <TabsList className="grid w-full md:w-auto grid-cols-3 bg-white">
                  <TabsTrigger value="all">הכל</TabsTrigger>
                  <TabsTrigger value="active">פעילים</TabsTrigger>
                  <TabsTrigger value="inactive">לא פעילים</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <EmployeeList employees={filteredEmployees} onEdit={handleEdit} onToggleActive={handleToggleActive} isLoading={isLoading} />
          </>
        )}
      </div>
    </div>
  );
}