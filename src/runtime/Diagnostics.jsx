import React, { useMemo } from 'react';
import { useRuntimeConfig } from './RuntimeConfigContext.jsx';

function maskValue(value) {
  if (!value) {
    return '—';
  }
  const trimmed = String(value).trim();
  if (trimmed.length <= 4) {
    return trimmed;
  }
  const suffix = trimmed.slice(-4);
  return `••••${suffix}`;
}

export default function Diagnostics() {
  const config = useRuntimeConfig();
  const sourceLabel = useMemo(() => {
    switch (config?.source) {
      case 'file':
        return 'קובץ runtime-config.json';
      case 'window':
        return 'הזרקת window.__EMPLOYEE_MANAGEMENT_PUBLIC_CONFIG__';
      default:
        return 'מקור לא ידוע';
    }
  }, [config]);

  return (
    <div className="max-w-2xl mx-auto mt-16 bg-white shadow-xl rounded-2xl p-8 space-y-6" dir="rtl">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">אבחון קונפיגורציה</h1>
        <p className="text-slate-600">סקירה מהירה של מקור ההגדרות הציבוריות.</p>
      </div>
      <dl className="grid grid-cols-1 gap-4">
        <div className="border border-slate-200 rounded-xl p-4 bg-slate-50">
          <dt className="text-sm text-slate-500">מקור</dt>
          <dd className="text-lg font-semibold text-slate-900">{sourceLabel}</dd>
        </div>
        <div className="border border-slate-200 rounded-xl p-4">
          <dt className="text-sm text-slate-500">Supabase URL</dt>
          <dd className="text-lg font-semibold text-slate-900">{maskValue(config?.supabaseUrl)}</dd>
        </div>
        <div className="border border-slate-200 rounded-xl p-4">
          <dt className="text-sm text-slate-500">Supabase anon key</dt>
          <dd className="text-lg font-semibold text-slate-900">{maskValue(config?.supabaseAnonKey)}</dd>
        </div>
      </dl>
    </div>
  );
}
