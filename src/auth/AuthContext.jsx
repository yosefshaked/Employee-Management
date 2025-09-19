import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { coreSupabase } from '@/supabaseClient';

const AuthContext = createContext(null);

function extractProfile(session) {
  const user = session?.user;
  if (!user) return null;
  const metadata = user.user_metadata || {};
  const name = metadata.full_name
    || metadata.name
    || [metadata.given_name, metadata.family_name].filter(Boolean).join(' ')
    || metadata.preferred_username
    || null;

  return {
    id: user.id,
    email: user.email || metadata.email || null,
    name,
  };
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let isMounted = true;

    const resolveSession = async () => {
      try {
        const { data, error } = await coreSupabase.auth.getSession();
        if (!isMounted) return;
        if (error) throw error;
        setSession(data.session);
        setProfile(extractProfile(data.session));
      } catch (error) {
        console.error('Failed to resolve session', error);
        if (!isMounted) return;
        setSession(null);
        setProfile(null);
      } finally {
        if (isMounted) setStatus('ready');
      }
    };

    resolveSession();

    const { data: listener } = coreSupabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!isMounted) return;
      setSession(nextSession);
      setProfile(extractProfile(nextSession));
      setStatus('ready');
    });

    return () => {
      isMounted = false;
      listener?.subscription?.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await coreSupabase.auth.signOut();
    if (error) throw error;
  }, []);

  const signInWithEmail = useCallback(async (email, password) => {
    const { data, error } = await coreSupabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }, []);

  const signInWithOAuth = useCallback(async (provider) => {
    const origin = typeof window === 'undefined' ? undefined : window.location.origin;
    const pathname = typeof window === 'undefined' ? undefined : window.location.pathname;
    const redirectTo = origin && pathname ? `${origin}${pathname}` : undefined;
    const { data, error } = await coreSupabase.auth.signInWithOAuth({
      provider,
      options: redirectTo ? { redirectTo } : {},
    });
    if (error) throw error;
    return data;
  }, []);

  const value = useMemo(() => ({
    status,
    session,
    user: profile,
    signOut,
    signInWithEmail,
    signInWithOAuth,
  }), [status, session, profile, signOut, signInWithEmail, signInWithOAuth]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
