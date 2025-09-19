import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50" dir="rtl">
      <div className="flex flex-col items-center gap-4 text-slate-600">
        <div className="w-12 h-12 border-4 border-slate-200 border-t-blue-500 rounded-full animate-spin" aria-hidden="true" />
        <p className="text-sm font-medium">טוען...</p>
      </div>
    </div>
  );
}

export default function RequireAuth() {
  const { status, session } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return <LoadingScreen />;
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
