import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Plus, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import EmployeeList from "../components/employees/EmployeeList";
import { searchVariants } from "@/lib/layoutSwap";
import EmployeeForm from "../components/employees/EmployeeForm";
import { supabase } from "../supabaseClient";

export default function Employees() {
  const [employees, setEmployees] = useState([]);
  const [rateHistories, setRateHistories] = useState([]);
  const [filteredEmployees, setFilteredEmployees] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("active");
  const [isLoading, setIsLoading] = useState(true);
  const [services, setServices] = useState([]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [employeesData, ratesData, servicesData] = await Promise.all([
        supabase.from('Employees').select('*').order('name'),
        supabase.from('RateHistory').select('*'),
        supabase.from('Services').select('*')
      ]);

      if (employeesData.error) throw employeesData.error;
      if (ratesData.error) throw ratesData.error;
      if (servicesData.error) throw servicesData.error; 

      setEmployees(employeesData.data);
      setRateHistories(ratesData.data);
      setServices(servicesData.data); 
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
      const variants = searchVariants(searchTerm);
      filtered = filtered.filter(emp => {
        const name = (emp.name || '').toLowerCase();
        const id = (emp.employee_id || '').toLowerCase();
        return variants.some(v => name.includes(v) || id.includes(v));
      });
    }
    setFilteredEmployees(filtered);
  }, [employees, searchTerm, activeTab]);

  useEffect(() => { loadData(); }, []);
  useEffect(() => { filterEmployees(); }, [filterEmployees]);

  const handleSubmit = async ({ employeeData, serviceRates, rateHistory }) => {
    try {
      // Separate the rate from the main employee data to avoid saving it in the Employees table
      const { current_rate, ...employeeDetails } = employeeData;
      const GENERIC_RATE_SERVICE_ID = '00000000-0000-0000-0000-000000000000';
      const isNewEmployee = !editingEmployee;
      let employeeId;

      // Step 1: Insert or Update the employee in the 'Employees' table
      if (isNewEmployee) {
        const { data, error } = await supabase.from('Employees').insert([employeeDetails]).select('id').single();
        if (error) throw error;
        employeeId = data.id;
        toast.success("העובד נוצר בהצלחה!");
      } else {
        employeeId = editingEmployee.id;
        const { error } = await supabase.from('Employees').update(employeeDetails).eq('id', employeeId);
        if (error) throw error;
        toast.success("פרטי העובד עודכנו בהצלחה!");
      }

      // Step 2: Prepare the rate updates for the 'RateHistory' table only when rates change
      const rateUpdates = [];
      const effective_date = isNewEmployee
        ? (employeeDetails.start_date || new Date().toISOString().split('T')[0])
        : new Date().toISOString().split('T')[0];
      const notes = isNewEmployee ? 'תעריף התחלתי' : 'שינוי תעריף';

      let latestRates = {};
      if (!isNewEmployee) {
        const history = rateHistory && rateHistory.length > 0
          ? rateHistory
          : rateHistories.filter(r => r.employee_id === employeeId);
        history.forEach(r => {
          if (!latestRates[r.service_id] || new Date(r.effective_date) > new Date(latestRates[r.service_id].effective_date)) {
            latestRates[r.service_id] = r;
          }
        });
      }

      // Handle hourly and global employees
      if (employeeData.employee_type === 'hourly' || employeeData.employee_type === 'global') {
        const rateValue = parseFloat(current_rate);
        const existingRate = latestRates[GENERIC_RATE_SERVICE_ID]
          ? parseFloat(latestRates[GENERIC_RATE_SERVICE_ID].rate)
          : null;
        if (!isNaN(rateValue) && (isNewEmployee || existingRate === null || rateValue !== existingRate)) {
          rateUpdates.push({
            employee_id: employeeId,
            service_id: GENERIC_RATE_SERVICE_ID,
            effective_date,
            rate: rateValue,
            notes,
          });
        }
      }

      // Handle instructor employees
      if (employeeData.employee_type === 'instructor') {
        Object.keys(serviceRates).forEach(serviceId => {
          const rateValue = parseFloat(serviceRates[serviceId]);
          const existingRate = latestRates[serviceId]
            ? parseFloat(latestRates[serviceId].rate)
            : null;
          if (!isNaN(rateValue) && (isNewEmployee || existingRate === null || rateValue !== existingRate)) {
            rateUpdates.push({
              employee_id: employeeId,
              service_id: serviceId,
              effective_date,
              rate: rateValue,
              notes,
            });
          }
        });
      }

      // Step 3: Upsert all prepared rate updates into 'RateHistory'
      if (rateUpdates.length > 0) {
        const { error } = await supabase.from('RateHistory').upsert(rateUpdates, { onConflict: 'employee_id,service_id,effective_date' });
        if (error) throw error;
      }

      // Step 3b: Handle manual rate history edits for existing employees
      if (!isNewEmployee && rateHistory) {
        const rateUpdateKeys = new Set(
          rateUpdates.map(r => `${r.service_id}-${r.effective_date}`)
        );
        const entriesToUpsert = rateHistory
          .filter(r => !rateUpdateKeys.has(`${r.service_id}-${r.effective_date}`))
          .map(({ id, ...rest }) => ({
            ...rest,
            employee_id: employeeId,
            ...(id ? { id } : {}),
          }));
        if (entriesToUpsert.length > 0) {
          const { error } = await supabase
            .from('RateHistory')
            .upsert(entriesToUpsert, { onConflict: 'id' });
          if (error) throw error;
        }
      }

      // Step 4: Cleanup and reload
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
            <EmployeeList 
              employees={filteredEmployees} 
              rateHistories={rateHistories}
              services={services}
              onEdit={handleEdit} 
              onToggleActive={handleToggleActive} 
              isLoading={isLoading} 
            />
          </>
        )}
      </div>
    </div>
  );
}
