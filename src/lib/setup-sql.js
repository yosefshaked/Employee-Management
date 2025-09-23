export const SETUP_SQL_SCRIPT = `
CREATE EXTENSION IF NOT EXISTS pgjwt WITH SCHEMA extensions;

-- שלב 1: יצירת סכימה מלאה ו-אובייקט עזר לאימות
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
      and lower(tablename) = lower(table_name);

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
              'DROP POLICY IF EXISTS "%s" ON public."%s";%sCREATE POLICY "%s" ON public."%s"%s  FOR SELECT TO authenticated%s  USING (true);%s',
              required_policy_names[idx],
              table_name,
              E'\n',
              required_policy_names[idx],
              table_name,
              E'\n',
              E'\n',
              E'\n'
            );
          elsif required_commands[idx] = 'INSERT' then
            delta_sql := delta_sql || format(
              'DROP POLICY IF EXISTS "%s" ON public."%s";%sCREATE POLICY "%s" ON public."%s"%s  FOR INSERT TO authenticated%s  WITH CHECK (true);%s',
              required_policy_names[idx],
              table_name,
              E'\n',
              required_policy_names[idx],
              table_name,
              E'\n',
              E'\n',
              E'\n'
            );
          elsif required_commands[idx] = 'UPDATE' then
            delta_sql := delta_sql || format(
              'DROP POLICY IF EXISTS "%s" ON public."%s";%sCREATE POLICY "%s" ON public."%s"%s  FOR UPDATE TO authenticated%s  USING (true)%s  WITH CHECK (true);%s',
              required_policy_names[idx],
              table_name,
              E'\n',
              required_policy_names[idx],
              table_name,
              E'\n',
              E'\n',
              E'\n',
              E'\n'
            );
          elsif required_commands[idx] = 'DELETE' then
            delta_sql := delta_sql || format(
              'DROP POLICY IF EXISTS "%s" ON public."%s";%sCREATE POLICY "%s" ON public."%s"%s  FOR DELETE TO authenticated%s  USING (true);%s',
              required_policy_names[idx],
              table_name,
              E'\n',
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

-- שלב 3: יצירת תפקיד מאובטח ומוגבל הרשאות עבור האפליקציה
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_user;
GRANT ALL ON ALL TABLES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- שלב 4: יצירת מפתח גישה ייעודי (JWT) עבור התפקיד החדש
-- החלף את 'YOUR_SUPER_SECRET_JWT_SIGNATURE' בסוד חזק ובטוח
-- שים לב: המפתח הזה יהיה תקף לשנה אחת
SELECT sign(
  json_build_object(
    'role', 'app_user',
    'exp', (EXTRACT(epoch FROM (NOW() + INTERVAL '1 year')))::integer,
    'iat', (EXTRACT(epoch FROM NOW()))::integer
  ),
  current_setting('app.settings.jwt_secret') -- This uses the project's own secret
) AS "APP_DEDICATED_KEY (COPY THIS BACK TO THE APP)";
`;
