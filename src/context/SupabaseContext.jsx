// src/context/SupabaseContext.jsx
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  createDataClient,
  getAuthClient,
  initializeAuthClient,
  isAuthClientInitialized,
} from '../lib/supabase-manager.js';
import { useRuntimeConfig } from '../runtime/RuntimeConfigContext.jsx';

const SupabaseContext = createContext(undefined);

export const SupabaseProvider = ({ children }) => {
  const runtimeConfig = useRuntimeConfig();
  const [authClient, setAuthClient] = useState(null);
  const [session, setSession] = useState(null);
  const [activeOrg, setActiveOrg] = useState(null);
  const [dataClient, setDataClient] = useState(null);
  const [loading, setLoading] = useState(true);

  const normalizedConfig = useMemo(() => {
    if (!runtimeConfig?.supabaseUrl || !runtimeConfig?.supabaseAnonKey) {
      return null;
    }
    return {
      supabaseUrl: runtimeConfig.supabaseUrl,
      supabaseAnonKey: runtimeConfig.supabaseAnonKey,
    };
  }, [runtimeConfig?.supabaseUrl, runtimeConfig?.supabaseAnonKey]);

  const supabaseConfigKey = normalizedConfig
    ? `${normalizedConfig.supabaseUrl}::${normalizedConfig.supabaseAnonKey}`
    : null;

  useEffect(() => {
    let isMounted = true;
    let unsubscribe = null;

    async function bootstrapAuthClient(config) {
      if (!config?.supabaseUrl || !config?.supabaseAnonKey) {
        if (isMounted) {
          setAuthClient(null);
          setSession(null);
          setLoading(false);
        }
        return;
      }

      try {
        initializeAuthClient(config);
        const client = getAuthClient();
        if (!isMounted) {
          return;
        }
        setAuthClient(client);

        const { data } = await client.auth.getSession();
        if (!isMounted) {
          return;
        }
        setSession(data?.session ?? null);
        setLoading(false);

        const { data: subscriptionData } = client.auth.onAuthStateChange((_event, nextSession) => {
          if (isMounted) {
            setSession(nextSession);
          }
        });
        if (subscriptionData?.subscription) {
          unsubscribe = () => subscriptionData.subscription.unsubscribe();
        } else {
          unsubscribe = null;
        }
      } catch (error) {
        console.error('[SupabaseProvider] Failed to initialize auth client', error);
        if (isMounted) {
          setAuthClient(null);
          setSession(null);
          setLoading(false);
        }
      }
    }

    setLoading(true);
    bootstrapAuthClient(normalizedConfig);

    return () => {
      isMounted = false;
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [normalizedConfig, supabaseConfigKey]);

  useEffect(() => {
    if (activeOrg) {
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
    loading: loading || !isAuthClientInitialized(),
  }), [authClient, dataClient, session, activeOrg, loading]);

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
