import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { supabase } from '@/supabaseClient.js';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCopy,
  Loader2,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';

const REQUIRED_TABLES = ['Employees', 'WorkSessions', 'LeaveBalances', 'RateHistory', 'Services', 'Settings'];

const TABLE_LABELS = {
  Employees: 'טבלת עובדים',
  WorkSessions: 'רישומי שעות ועבודה',
  LeaveBalances: 'יתרות חופשה',
  RateHistory: 'היסטוריית תעריפים',
  Services: 'שירותים והצעות',
  Settings: 'הגדרות ארגון',
};

const SCHEMA_SQL = `-- שלב 1: יצירת סכימה מלאה ו-אובייקט עזר לאימות
set search_path = public;

create extension if not exists "pgcrypto";

create table if not exists public."Employees" (
  "id" uuid not null default gen_random_uuid(),
  "name" text not null,
  "employee_id" text not null,
  "employee_type" text,
  "current_rate" numeric,
  "phone" text,
  "email" text,
  "start_date" date,
  "is_active" boolean default true,
  "notes" text,
  "working_days" jsonb,
  "annual_leave_days" numeric default 12,
  "leave_pay_method" text,
  "leave_fixed_day_rate" numeric,
  "metadata" jsonb,
  constraint "Employees_pkey" primary key ("id")
);

create table if not exists public."Services" (
  "id" uuid not null default gen_random_uuid(),
  "name" text not null,
  "duration_minutes" bigint,
  "payment_model" text,
  "color" text,
  "metadata" jsonb,
  constraint "Services_pkey" primary key ("id")
);

create table if not exists public."RateHistory" (
  "id" uuid not null default gen_random_uuid(),
  "rate" numeric not null,
  "effective_date" date not null,
  "notes" text,
  "employee_id" uuid not null default gen_random_uuid(),
  "service_id" uuid default gen_random_uuid(),
  "metadata" jsonb,
  constraint "RateHistory_pkey" primary key ("id"),
  constraint "RateHistory_employee_id_fkey" foreign key ("employee_id") references public."Employees"("id"),
  constraint "RateHistory_service_id_fkey" foreign key ("service_id") references public."Services"("id")
);

create table if not exists public."WorkSessions" (
  "id" uuid not null default gen_random_uuid(),
  "employee_id" uuid not null default gen_random_uuid(),
  "service_id" uuid default gen_random_uuid(),
  "date" date not null,
  "session_type" text,
  "hours" numeric,
  "sessions_count" bigint,
  "students_count" bigint,
  "rate_used" numeric,
  "total_payment" numeric,
  "notes" text,
  "created_at" timestamptz default now(),
  "entry_type" text not null default 'hours',
  "payable" boolean,
  "metadata" jsonb,
  "deleted" boolean not null default false,
  "deleted_at" timestamptz,
  constraint "WorkSessions_pkey" primary key ("id"),
  constraint "WorkSessions_employee_id_fkey" foreign key ("employee_id") references public."Employees"("id"),
  constraint "WorkSessions_service_id_fkey" foreign key ("service_id") references public."Services"("id")
);

create table if not exists public."LeaveBalances" (
  "id" bigint generated always as identity primary key,
  "created_at" timestamptz not null default now(),
  "employee_id" uuid not null default gen_random_uuid(),
  "leave_type" text not null,
  "balance" numeric not null default 0,
  "effective_date" date not null,
  "notes" text,
  "metadata" jsonb,
  constraint "LeaveBalances_employee_id_fkey" foreign key ("employee_id") references public."Employees"("id")
);

create table if not exists public."Settings" (
  "id" uuid not null default gen_random_uuid(),
  "created_at" timestamptz not null default now(),
  "settings_value" jsonb not null,
  "updated_at" timestamptz default now(),
  "key" text not null unique,
  "metadata" jsonb,
  constraint "Settings_pkey" primary key ("id")
);

create index if not exists "RateHistory_employee_service_idx" on public."RateHistory" ("employee_id", "service_id", "effective_date");
create index if not exists "LeaveBalances_employee_date_idx" on public."LeaveBalances" ("employee_id", "effective_date");
create index if not exists "WorkSessions_employee_date_idx" on public."WorkSessions" ("employee_id", "date");
create index if not exists "WorkSessions_service_idx" on public."WorkSessions" ("service_id");
create index if not exists "WorkSessions_deleted_idx" on public."WorkSessions" ("deleted") where "deleted" = true;

create or replace function public.setup_assistant_diagnostics()
returns table (
  table_name text,
  has_table boolean,
  rls_enabled boolean,
  missing_policies text[],
  delta_sql text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  required_tables constant text[] := array['Employees', 'WorkSessions', 'LeaveBalances', 'RateHistory', 'Services', 'Settings'];
  required_policy_names text[];
  required_commands constant text[] := array['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
  table_reg regclass;
  existing_policies text[];
  idx integer;
begin
  foreach table_name in array required_tables loop
    required_policy_names := array[
      format('Authenticated select %s', table_name),
      format('Authenticated insert %s', table_name),
      format('Authenticated update %s', table_name),
      format('Authenticated delete %s', table_name)
    ];

    table_reg := to_regclass(format('public.%I', table_name));
    has_table := table_reg is not null;
    rls_enabled := false;
    missing_policies := array[]::text[];
    delta_sql := '';

    if not has_table then
      missing_policies := required_policy_names;
      delta_sql := format('-- הטבלה "%s" חסרה. הרץ את בלוק הסכימה המלא.', table_name);
      return next;
      continue;
    end if;

    select coalesce(c.relrowsecurity, false)
      into rls_enabled
    from pg_class c
    where c.oid = table_reg;

    select coalesce(array_agg(policyname order by policyname), array[]::text[])
      into existing_policies
    from pg_policies
    where schemaname = 'public'
      and tablename = lower(table_name);

    missing_policies := array(
      select policy_name
      from unnest(required_policy_names) as policy_name
      where not (policy_name = any(existing_policies))
    );

    if not rls_enabled then
      delta_sql := delta_sql || format('ALTER TABLE public."%s" ENABLE ROW LEVEL SECURITY;', table_name) || E'\n';
    end if;

    if array_length(missing_policies, 1) is null then
      missing_policies := array[]::text[];
    else
      for idx in 1..array_length(required_policy_names, 1) loop
        if array_position(missing_policies, required_policy_names[idx]) is not null then
          if required_commands[idx] = 'SELECT' then
            delta_sql := delta_sql || format(
              'CREATE POLICY "%s" ON public."%s"%s  FOR SELECT TO authenticated%s  USING (true);%s',
              required_policy_names[idx],
              table_name,
              E'\n',
              E'\n',
              E'\n'
            );
          elsif required_commands[idx] = 'INSERT' then
            delta_sql := delta_sql || format(
              'CREATE POLICY "%s" ON public."%s"%s  FOR INSERT TO authenticated%s  WITH CHECK (true);%s',
              required_policy_names[idx],
              table_name,
              E'\n',
              E'\n',
              E'\n'
            );
          elsif required_commands[idx] = 'UPDATE' then
            delta_sql := delta_sql || format(
              'CREATE POLICY "%s" ON public."%s"%s  FOR UPDATE TO authenticated%s  USING (true)%s  WITH CHECK (true);%s',
              required_policy_names[idx],
              table_name,
              E'\n',
              E'\n',
              E'\n',
              E'\n'
            );
          elsif required_commands[idx] = 'DELETE' then
            delta_sql := delta_sql || format(
              'CREATE POLICY "%s" ON public."%s"%s  FOR DELETE TO authenticated%s  USING (true);%s',
              required_policy_names[idx],
              table_name,
              E'\n',
              E'\n',
              E'\n'
            );
          end if;
        end if;
      end loop;
    end if;
    if delta_sql = '' then
      delta_sql := null;
    end if;

    return next;
  end loop;

  return;
end;
$$;

grant execute on function public.setup_assistant_diagnostics() to authenticated;
`;

const RLS_SQL = `-- שלב 2: הפעלת RLS והוספת מדיניות מאובטחת
alter table public."Employees" enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'Employees'
      and policyname = 'Authenticated select Employees'
  ) then
    create policy "Authenticated select Employees" on public."Employees"
      for select to authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'Employees'
      and policyname = 'Authenticated insert Employees'
  ) then
    create policy "Authenticated insert Employees" on public."Employees"
      for insert to authenticated
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'Employees'
      and policyname = 'Authenticated update Employees'
  ) then
    create policy "Authenticated update Employees" on public."Employees"
      for update to authenticated
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'Employees'
      and policyname = 'Authenticated delete Employees'
  ) then
    create policy "Authenticated delete Employees" on public."Employees"
      for delete to authenticated
      using (true);
  end if;
end;
$$;

alter table public."WorkSessions" enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'WorkSessions'
      and policyname = 'Authenticated select WorkSessions'
  ) then
    create policy "Authenticated select WorkSessions" on public."WorkSessions"
      for select to authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'WorkSessions'
      and policyname = 'Authenticated insert WorkSessions'
  ) then
    create policy "Authenticated insert WorkSessions" on public."WorkSessions"
      for insert to authenticated
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'WorkSessions'
      and policyname = 'Authenticated update WorkSessions'
  ) then
    create policy "Authenticated update WorkSessions" on public."WorkSessions"
      for update to authenticated
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'WorkSessions'
      and policyname = 'Authenticated delete WorkSessions'
  ) then
    create policy "Authenticated delete WorkSessions" on public."WorkSessions"
      for delete to authenticated
      using (true);
  end if;
end;
$$;

alter table public."LeaveBalances" enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'LeaveBalances'
      and policyname = 'Authenticated select LeaveBalances'
  ) then
    create policy "Authenticated select LeaveBalances" on public."LeaveBalances"
      for select to authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'LeaveBalances'
      and policyname = 'Authenticated insert LeaveBalances'
  ) then
    create policy "Authenticated insert LeaveBalances" on public."LeaveBalances"
      for insert to authenticated
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'LeaveBalances'
      and policyname = 'Authenticated update LeaveBalances'
  ) then
    create policy "Authenticated update LeaveBalances" on public."LeaveBalances"
      for update to authenticated
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'LeaveBalances'
      and policyname = 'Authenticated delete LeaveBalances'
  ) then
    create policy "Authenticated delete LeaveBalances" on public."LeaveBalances"
      for delete to authenticated
      using (true);
  end if;
end;
$$;

alter table public."RateHistory" enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'RateHistory'
      and policyname = 'Authenticated select RateHistory'
  ) then
    create policy "Authenticated select RateHistory" on public."RateHistory"
      for select to authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'RateHistory'
      and policyname = 'Authenticated insert RateHistory'
  ) then
    create policy "Authenticated insert RateHistory" on public."RateHistory"
      for insert to authenticated
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'RateHistory'
      and policyname = 'Authenticated update RateHistory'
  ) then
    create policy "Authenticated update RateHistory" on public."RateHistory"
      for update to authenticated
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'RateHistory'
      and policyname = 'Authenticated delete RateHistory'
  ) then
    create policy "Authenticated delete RateHistory" on public."RateHistory"
      for delete to authenticated
      using (true);
  end if;
end;
$$;

alter table public."Services" enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'Services'
      and policyname = 'Authenticated select Services'
  ) then
    create policy "Authenticated select Services" on public."Services"
      for select to authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'Services'
      and policyname = 'Authenticated insert Services'
  ) then
    create policy "Authenticated insert Services" on public."Services"
      for insert to authenticated
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'Services'
      and policyname = 'Authenticated update Services'
  ) then
    create policy "Authenticated update Services" on public."Services"
      for update to authenticated
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'Services'
      and policyname = 'Authenticated delete Services'
  ) then
    create policy "Authenticated delete Services" on public."Services"
      for delete to authenticated
      using (true);
  end if;
end;
$$;

alter table public."Settings" enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'Settings'
      and policyname = 'Authenticated select Settings'
  ) then
    create policy "Authenticated select Settings" on public."Settings"
      for select to authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'Settings'
      and policyname = 'Authenticated insert Settings'
  ) then
    create policy "Authenticated insert Settings" on public."Settings"
      for insert to authenticated
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'Settings'
      and policyname = 'Authenticated update Settings'
  ) then
    create policy "Authenticated update Settings" on public."Settings"
      for update to authenticated
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'Settings'
      and policyname = 'Authenticated delete Settings'
  ) then
    create policy "Authenticated delete Settings" on public."Settings"
      for delete to authenticated
      using (true);
  end if;
end;
$$;
`
function formatDateTime(isoString) {
  if (!isoString) return '';
  try {
    return new Date(isoString).toLocaleString('he-IL', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  } catch (error) {
    console.error('Failed to format datetime', error);
    return '';
  }
}

function CopyButton({ text, ariaLabel }) {
  const [state, setState] = useState('idle');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
      setTimeout(() => setState('idle'), 2000);
    } catch (error) {
      console.error('Failed to copy SQL block', error);
      setState('error');
      setTimeout(() => setState('idle'), 2000);
    }
  };

  const label = state === 'copied' ? 'הועתק!' : state === 'error' ? 'שגיאה' : 'העתק';

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleCopy}
      aria-label={ariaLabel}
      className="gap-2"
    >
      {state === 'copied' ? (
        <CheckCircle2 className="w-4 h-4 text-emerald-600" aria-hidden="true" />
      ) : (
        <ClipboardCopy className="w-4 h-4" aria-hidden="true" />
      )}
      {label}
    </Button>
  );
}

function CodeBlock({ title, code, ariaLabel }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-medium text-slate-800">{title}</p>
        <CopyButton text={code} ariaLabel={ariaLabel} />
      </div>
      <pre
        dir="ltr"
        className="whitespace-pre overflow-x-auto text-xs leading-relaxed bg-slate-900 text-slate-100 rounded-lg p-4 border border-slate-800"
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

function StepSection({ number, title, description, statusBadge, children }) {
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center text-base font-semibold shadow-md">
            {number}
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
            {description ? <p className="text-sm text-slate-600 mt-1">{description}</p> : null}
          </div>
        </div>
        {statusBadge ? <div className="flex items-center gap-2">{statusBadge}</div> : null}
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 md:p-6 shadow-sm">
        {children}
      </div>
    </section>
  );
}

export default function SetupAssistant() {
  const [connection, setConnection] = useState({ supabase_url: '', anon_key: '' });
  const [originalConnection, setOriginalConnection] = useState({ supabase_url: '', anon_key: '' });
  const [isLoadingConnection, setIsLoadingConnection] = useState(true);
  const [isSavingConnection, setIsSavingConnection] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [verificationStatus, setVerificationStatus] = useState('idle');
  const [verifyResults, setVerifyResults] = useState([]);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState('');
  const [lastVerifiedAt, setLastVerifiedAt] = useState(null);

  useEffect(() => {
    let isMounted = true;

    const loadInitial = async () => {
      setIsLoadingConnection(true);
      try {
        const [connectionResponse, statusResponse] = await Promise.all([
          supabase
            .from('Settings')
            .select('settings_value, updated_at')
            .eq('key', 'supabase_connection')
            .maybeSingle(),
          supabase
            .from('Settings')
            .select('settings_value, updated_at')
            .eq('key', 'org_settings')
            .maybeSingle(),
        ]);

        if (!isMounted) return;

        if (connectionResponse.error && connectionResponse.error.code !== 'PGRST116') {
          throw connectionResponse.error;
        }

        const rawConnection = connectionResponse.data?.settings_value || {};
        const normalizedConnection = {
          supabase_url: (rawConnection.supabase_url || '').trim(),
          anon_key: (rawConnection.anon_key || rawConnection.supabase_anon_key || '').trim(),
        };

        setConnection(normalizedConnection);
        setOriginalConnection(normalizedConnection);
        setLastSavedAt(rawConnection.saved_at || connectionResponse.data?.updated_at || null);

        if (statusResponse.error && statusResponse.error.code !== 'PGRST116') {
          throw statusResponse.error;
        }

        const statusValue = statusResponse.data?.settings_value || {};
        if (statusValue.setup_completed) {
          setVerificationStatus('success');
          setLastVerifiedAt(statusValue.verified_at || statusResponse.data?.updated_at || null);
        }
      } catch (error) {
        console.error('Failed to load setup assistant data', error);
        toast.error('טעינת פרטי ההגדרה נכשלה. נסה לרענן את הדף.');
      } finally {
        if (isMounted) setIsLoadingConnection(false);
      }
    };

    loadInitial();

    return () => {
      isMounted = false;
    };
  }, []);

  const hasUnsavedChanges = useMemo(() => {
    return (
      connection.supabase_url !== originalConnection.supabase_url ||
      connection.anon_key !== originalConnection.anon_key
    );
  }, [connection, originalConnection]);

  const hasConnectionValues = Boolean(connection.supabase_url.trim() && connection.anon_key.trim());
  const hasSavedConnection = Boolean(originalConnection.supabase_url && originalConnection.anon_key);

  const handleConnectionChange = (field) => (event) => {
    const value = event.target.value;
    setConnection((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveConnection = async (event) => {
    event.preventDefault();
    if (!hasConnectionValues || isSavingConnection) return;

    setIsSavingConnection(true);
    try {
      const now = new Date().toISOString();
      const payload = {
        supabase_url: connection.supabase_url.trim(),
        anon_key: connection.anon_key.trim(),
        saved_at: now,
      };

      const { error } = await supabase
        .from('Settings')
        .upsert(
          {
            key: 'supabase_connection',
            settings_value: payload,
            updated_at: now,
          },
          {
            onConflict: 'key',
            returning: 'minimal',
          },
        );

      if (error) throw error;

      setOriginalConnection({
        supabase_url: payload.supabase_url,
        anon_key: payload.anon_key,
      });
      setLastSavedAt(now);
      toast.success('חיבור ה-Supabase נשמר בהצלחה.');
    } catch (error) {
      console.error('Failed to save Supabase connection details', error);
      toast.error('שמירת פרטי החיבור נכשלה. בדוק את ההרשאות ונסה שוב.');
    } finally {
      setIsSavingConnection(false);
    }
  };

  const markSetupComplete = async (verifiedAt) => {
    try {
      const { error } = await supabase
        .from('Settings')
        .upsert(
          {
            key: 'org_settings',
            settings_value: {
              setup_completed: true,
              setup_version: 'setup_assistant_v1',
              verified_at: verifiedAt,
            },
            updated_at: verifiedAt,
          },
          {
            onConflict: 'key',
            returning: 'minimal',
          },
        );

      if (error) throw error;
    } catch (error) {
      console.error('Failed to mark setup assistant as completed', error);
    } finally {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('setup-assistant:verified', {
            detail: { verifiedAt },
          }),
        );
      }
    }
  };

  const handleVerify = async () => {
    setIsVerifying(true);
    setVerifyError('');
    setVerifyResults([]);
    setVerificationStatus('running');

    try {
      const { data, error } = await supabase.rpc('setup_assistant_diagnostics');

      if (error) {
        throw error;
      }

      const normalized = (data || []).map((item) => ({
        ...item,
        missing_policies: Array.isArray(item.missing_policies) ? item.missing_policies : [],
        delta_sql: typeof item.delta_sql === 'string' ? item.delta_sql.trim() : '',
      }));

      setVerifyResults(normalized);

      const allPassed =
        normalized.length > 0 &&
        normalized.every(
          (item) => item.has_table && item.rls_enabled && (!item.missing_policies || item.missing_policies.length === 0),
        );

      if (allPassed) {
        const now = new Date().toISOString();
        setVerificationStatus('success');
        setLastVerifiedAt(now);
        toast.success('כל הבדיקות עברו! המערכת מוכנה לשימוש.');
        await markSetupComplete(now);
      } else {
        setVerificationStatus('incomplete');
      }
    } catch (error) {
      console.error('Verification failed', error);
      setVerificationStatus('error');
      if (error?.message?.includes('setup_assistant_diagnostics')) {
        setVerifyError('לא נמצאה פונקציית האימות. ודא שהרצת את בלוק הסכימה ונסה שוב.');
      } else {
        setVerifyError('בדיקת האימות נכשלה. נסה שוב או פנה לתמיכה.');
      }
      toast.error('בדיקת האימות נכשלה.');
    } finally {
      setIsVerifying(false);
    }
  };

  const renderConnectionStatusBadge = () => {
    if (isLoadingConnection) {
      return (
        <Badge className="gap-1 bg-slate-100 text-slate-600 border border-slate-200">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          <span>טוען</span>
        </Badge>
      );
    }

    if (hasSavedConnection && !hasUnsavedChanges) {
      return (
        <Badge className="gap-1 bg-emerald-100 text-emerald-700 border border-emerald-200">
          <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
          <span>נשמר</span>
        </Badge>
      );
    }

    if (hasUnsavedChanges) {
      return (
        <Badge className="gap-1 bg-amber-100 text-amber-800 border border-amber-200">
          <AlertCircle className="w-4 h-4" aria-hidden="true" />
          <span>דרושה שמירה</span>
        </Badge>
      );
    }

    return (
      <Badge className="gap-1 bg-slate-100 text-slate-600 border border-slate-200">
        <AlertCircle className="w-4 h-4" aria-hidden="true" />
        <span>מלא את הפרטים</span>
      </Badge>
    );
  };

  const renderVerificationStatusBadge = () => {
    if (isVerifying) {
      return (
        <Badge className="gap-1 bg-slate-100 text-slate-600 border border-slate-200">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          <span>מריץ בדיקות</span>
        </Badge>
      );
    }

    if (verificationStatus === 'success') {
      return (
        <Badge className="gap-1 bg-emerald-100 text-emerald-700 border border-emerald-200">
          <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
          <span>אומת בהצלחה</span>
        </Badge>
      );
    }

    if (verificationStatus === 'incomplete') {
      return (
        <Badge className="gap-1 bg-amber-100 text-amber-800 border border-amber-200">
          <AlertCircle className="w-4 h-4" aria-hidden="true" />
          <span>חסרות פעולות</span>
        </Badge>
      );
    }

    if (verificationStatus === 'error') {
      return (
        <Badge className="gap-1 bg-red-100 text-red-700 border border-red-200">
          <AlertCircle className="w-4 h-4" aria-hidden="true" />
          <span>שגיאה בבדיקה</span>
        </Badge>
      );
    }

    return null;
  };

  const connectionHelperText = hasSavedConnection
    ? 'ניתן לעדכן את הפרטים בכל עת – הם נשמרים בטבלת ההגדרות.'
    : 'נשמור עבורך את ה-URL וה-ANON KEY בטבלת ההגדרות כדי שהצוות ידע מה הוגדר.';

  return (
    <Card className="border-0 shadow-xl bg-white/90" dir="rtl">
      <CardHeader className="border-b border-slate-200">
        <CardTitle className="text-2xl font-semibold text-slate-900 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span>אשף הגדרה ראשוני ל-Supabase</span>
          {verificationStatus === 'success' ? (
            <Badge className="gap-1 bg-emerald-100 text-emerald-700 border border-emerald-200">
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
              <span>הכל מוכן</span>
            </Badge>
          ) : null}
        </CardTitle>
        <p className="text-sm text-slate-600 mt-2">
          שלושה צעדים קצרים: חיבור המפתחות, הרצת ה-SQL המאובטח, ואימות שהטבלאות ומדיניות ה-RLS קיימות. האשף פועל בכיוון ימין-לשמאל ומספק כפתורי העתקה לכל בלוק.
        </p>
      </CardHeader>
      <CardContent className="space-y-10 pt-6">
        <StepSection
          number={1}
          title="חיבור ל-Supabase"
          description="הזן את ה-URL הציבורי ואת מפתח ה-ANON של הפרויקט. נשמור אותם בטבלת ההגדרות של הארגון."
          statusBadge={renderConnectionStatusBadge()}
        >
          <form className="space-y-4" onSubmit={handleSaveConnection}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="supabase_url">Supabase URL (כתובת ציבורית)</Label>
                <Input
                  id="supabase_url"
                  type="url"
                  dir="ltr"
                  placeholder="https://your-project.supabase.co"
                  value={connection.supabase_url}
                  onChange={handleConnectionChange('supabase_url')}
                  required
                />
                <p className="text-xs text-slate-500">העתק מהמסך Project Settings → API בסביבת Supabase.</p>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="supabase_anon_key">Supabase anon key</Label>
                <Textarea
                  id="supabase_anon_key"
                  dir="ltr"
                  rows={3}
                  placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                  value={connection.anon_key}
                  onChange={handleConnectionChange('anon_key')}
                  required
                />
                <p className="text-xs text-slate-500">{connectionHelperText}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              {lastSavedAt ? (
                <span className="text-xs text-slate-500">נשמר לאחרונה: {formatDateTime(lastSavedAt)}</span>
              ) : null}
              <div className="flex items-center gap-2">
                <Button
                  type="submit"
                  disabled={!hasConnectionValues || isSavingConnection || !hasUnsavedChanges}
                  className="gap-2"
                >
                  {isSavingConnection ? (
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  ) : null}
                  {isSavingConnection ? 'שומר...' : 'שמור חיבור'}
                </Button>
              </div>
            </div>
          </form>
        </StepSection>

        <StepSection
          number={2}
          title="הדבק SQL והרץ ב-Supabase"
          description="הרץ את בלוק הסכימה ולאחריו את בלוק מדיניות ה-RLS בעורך ה-SQL של Supabase. מומלץ להריץ כבעלים בלבד."
        >
          <div className="space-y-6">
            <CodeBlock title="בלוק סכימה מלא" code={SCHEMA_SQL} ariaLabel="העתק את בלוק הסכימה" />
            <CodeBlock title="בלוק RLS ומדיניות" code={RLS_SQL} ariaLabel="העתק את בלוק ה-RLS" />
            <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">
              לאחר הרצת שני הבלוקים, עבור לשלב האימות כדי לוודא שהטבלאות, המדיניות ופונקציית הבדיקה קיימות. ניתן להפעיל את ה-SQL כמה פעמים – כל הפקודות ממוסגרות עם IF NOT EXISTS כדי למנוע שגיאות כפולות.
            </p>
          </div>
        </StepSection>

        <StepSection
          number={3}
          title="אימות"
          description="הרץ בדיקת קריאה בלבד שמוודאת שהטבלאות קיימות, RLS פעיל וכל המדיניות מאופיינת."
          statusBadge={renderVerificationStatusBadge()}
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-600">
                הבדיקה משתמשת בפונקציית setup_assistant_diagnostics ומחזירה SQL משלים במידה שחסרות פעולות. אין צורך במפתחות שירות – הבדיקה רצה עם המפתח הציבורי (anon) בלבד.
              </p>
              <div className="flex items-center gap-3">
                {lastVerifiedAt ? (
                  <span className="text-xs text-slate-500">בדיקה אחרונה: {formatDateTime(lastVerifiedAt)}</span>
                ) : null}
                <Button type="button" onClick={handleVerify} disabled={isVerifying} className="gap-2">
                  {isVerifying ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
                  {isVerifying ? 'מריץ בדיקות...' : 'הרץ אימות'}
                </Button>
              </div>
            </div>

            {verifyError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm p-3 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5" aria-hidden="true" />
                <span>{verifyError}</span>
              </div>
            ) : null}

            {verifyResults.length === 0 && !verifyError && !isVerifying ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-500 p-3">
                עדיין לא הרצנו אימות בפרויקט הזה. לאחר הרצת שני בלוקי ה-SQL, לחץ על "הרץ אימות" כדי לוודא שהכל מוכן.
              </div>
            ) : null}

            {verifyResults.length > 0 ? (
              <div className="space-y-4">
                {verifyResults.map((result) => {
                  const hasFullPolicies = result.missing_policies && result.missing_policies.length === 0;
                  const isSuccess = result.has_table && result.rls_enabled && hasFullPolicies;
                  return (
                    <div
                      key={result.table_name}
                      className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5 space-y-3 shadow-sm"
                    >
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div className="flex items-center gap-2 text-slate-900 font-medium">
                          {isSuccess ? (
                            <CheckCircle2 className="w-5 h-5 text-emerald-600" aria-hidden="true" />
                          ) : (
                            <AlertCircle className="w-5 h-5 text-amber-600" aria-hidden="true" />
                          )}
                          <span>{TABLE_LABELS[result.table_name] || result.table_name}</span>
                          <span className="text-xs text-slate-500">({result.table_name})</span>
                        </div>
                        <Badge
                          className={`${
                            isSuccess
                              ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                              : 'bg-amber-100 text-amber-800 border border-amber-200'
                          } gap-1`}
                        >
                          <span>{isSuccess ? 'מאומת' : 'נדרשת פעולה'}</span>
                        </Badge>
                      </div>
                      <ul className="space-y-1 text-xs text-slate-600">
                        <li className="flex items-start gap-2">
                          {result.has_table ? (
                            <ShieldCheck className="w-4 h-4 text-emerald-600 mt-0.5" aria-hidden="true" />
                          ) : (
                            <ShieldAlert className="w-4 h-4 text-amber-600 mt-0.5" aria-hidden="true" />
                          )}
                          <span>{result.has_table ? 'הטבלה קיימת במאגר.' : 'הטבלה חסרה. הרץ שוב את בלוק הסכימה.'}</span>
                        </li>
                        <li className="flex items-start gap-2">
                          {result.rls_enabled ? (
                            <ShieldCheck className="w-4 h-4 text-emerald-600 mt-0.5" aria-hidden="true" />
                          ) : (
                            <ShieldAlert className="w-4 h-4 text-amber-600 mt-0.5" aria-hidden="true" />
                          )}
                          <span>{result.rls_enabled ? 'RLS מופעל עבור הטבלה.' : 'RLS כבוי – הפעל מחדש באמצעות בלוק ה-RLS.'}</span>
                        </li>
                        <li className="flex items-start gap-2">
                          {hasFullPolicies ? (
                            <ShieldCheck className="w-4 h-4 text-emerald-600 mt-0.5" aria-hidden="true" />
                          ) : (
                            <ShieldAlert className="w-4 h-4 text-amber-600 mt-0.5" aria-hidden="true" />
                          )}
                          <span>
                            {hasFullPolicies
                              ? 'כל ארבע המדיניות קיימות.'
                              : `מדיניות חסרות: ${result.missing_policies.join(', ')}`}
                          </span>
                        </li>
                      </ul>
                      {result.delta_sql ? (
                        <CodeBlock
                          title="SQL משלים לטבלה זו"
                          code={result.delta_sql}
                          ariaLabel={`העתק SQL משלים עבור ${result.table_name}`}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </StepSection>
      </CardContent>
    </Card>
  );
}
