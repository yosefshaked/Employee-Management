// src/context/SupabaseContext.jsx
import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { authClient, createDataClient } from '../lib/supabase-manager'; // Using the new manager

const SupabaseContext = createContext();

export const SupabaseProvider = ({ children }) => {
  const [session, setSession] = useState(null);
  const [activeOrg, setActiveOrg] = useState(null);
  const [dataClient, setDataClient] = useState(null);
  const [loading, setLoading] = useState(true);

  // Effect for managing the main authentication session
  useEffect(() => {
    authClient.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = authClient.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // Effect for creating/switching the data client when the active org changes
  useEffect(() => {
    if (activeOrg && activeOrg.supabase_url && activeOrg.supabase_anon_key) {
      const newClient = createDataClient(activeOrg);
      setDataClient(newClient);
    } else {
      setDataClient(null);
    }
  }, [activeOrg]);

  const value = useMemo(() => ({
    authClient,
    dataClient,
    session,
    user: session?.user ?? null,
    activeOrg,
    setActiveOrg,
    loading,
  }), [dataClient, session, activeOrg, loading]);

  return (
    <SupabaseContext.Provider value={value}>
      {children}
    </SupabaseContext.Provider>
  );
};

export const useSupabase = () => {
  const context = useContext(SupabaseContext);
  if (context === undefined) {
    throw new Error('useSupabase must be used within a SupabaseProvider');
  }
  return context;
};
