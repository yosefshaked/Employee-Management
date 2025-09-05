import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Plus, Settings } from "lucide-react";
import { toast } from "sonner";
import ServiceList from "../components/services/ServiceList";
import ServiceForm from "../components/services/ServiceForm";
import { supabase } from "../supabaseClient";

export default function Services() {
  const [services, setServices] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingService, setEditingService] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadServices = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('Services')
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      toast.error("שגיאה בטעינת השירותים");
      console.error('Error fetching services:', error);
    } else {
      setServices(data);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    loadServices();
  }, []);

  const handleSubmit = async (serviceData) => {
    try {
      if (editingService) {
        const { error } = await supabase
          .from('Services')
          .update(serviceData)
          .eq('id', editingService.id);
        if (error) throw error;
        toast.success("השירות עודכן בהצלחה!");
      } else {
        const { error } = await supabase
          .from('Services')
          .insert([serviceData]);
        if (error) throw error;
        toast.success("השירות נוצר בהצלחה!");
      }
      setShowForm(false);
      setEditingService(null);
      loadServices();
    } catch (error) {
      toast.error(`שגיאה בשמירת השירות: ${error.message}`);
      console.error("Error submitting service:", error);
      // חשוב לזרוק את השגיאה כדי שהטופס ידע שנכשלנו
      throw error;
    }
  };

  const handleEdit = (service) => {
    setEditingService(service);
    setShowForm(true);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 mb-2 flex items-center gap-3">
              <Settings />
              ניהול שירותים
            </h1>
            <p className="text-slate-600">הוסף וערוך את סוגי הסשנים שהמדריכים יכולים לבצע</p>
          </div>
          <Button
            onClick={() => {
              setEditingService(null);
              setShowForm(true);
            }}
            className="bg-gradient-to-r from-blue-500 to-green-500 text-white shadow-lg"
          >
            <Plus className="w-5 h-5 ml-2" />
            הוסף שירות חדש
          </Button>
        </div>

        {showForm ? (
          <ServiceForm
            service={editingService}
            onSubmit={handleSubmit}
            onCancel={() => {
              setShowForm(false);
              setEditingService(null);
            }}
          />
        ) : (
          <ServiceList
            services={services}
            onEdit={handleEdit}
            isLoading={isLoading}
          />
        )}
      </div>
    </div>
  );
}