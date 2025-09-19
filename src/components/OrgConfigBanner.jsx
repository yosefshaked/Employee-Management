import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { supabase } from '@/supabaseClient';
import { useAuth } from '@/auth/AuthContext.jsx';

const ORG_SETTING_KEYS = ['organization', 'organization_profile', 'org_profile', 'org_settings'];

export default function OrgConfigBanner() {
  const { session } = useAuth();
  const [shouldShow, setShouldShow] = useState(false);
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => {
    let isActive = true;
    if (!session) {
      setShouldShow(false);
      setIsChecking(false);
      return () => {
        isActive = false;
      };
    }

    const checkSettings = async () => {
      setIsChecking(true);
      try {
        const { count, error } = await supabase
          .from('Settings')
          .select('id', { count: 'exact', head: true })
          .in('key', ORG_SETTING_KEYS);

        if (!isActive) return;

        if (error && error.code !== 'PGRST116') {
          throw error;
        }

        const hasConfiguration = typeof count === 'number' ? count > 0 : false;
        setShouldShow(!hasConfiguration);
      } catch (error) {
        console.error('Failed to verify organization configuration', error);
        if (isActive) setShouldShow(true);
      } finally {
        if (isActive) setIsChecking(false);
      }
    };

    checkSettings();

    return () => {
      isActive = false;
    };
  }, [session]);

  if (isChecking || !shouldShow) {
    return null;
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-2 flex items-center gap-3 text-amber-800 text-sm mt-4 mr-6 ml-6" role="status">
      <AlertTriangle className="w-4 h-4" aria-hidden="true" />
      <p className="font-medium">
        נראה שאין עדיין הגדרות ארגון. השלם את ההגדרה במסך ההגדרות כדי לאפשר חוויה מלאה למשתמשים.
      </p>
    </div>
  );
}
