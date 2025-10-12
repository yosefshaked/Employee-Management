import React, { useEffect, useMemo, useState } from 'react';
import * as Icons from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useOrg } from '@/org/OrgContext.jsx';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { fetchWorkSessions } from '@/api/work-sessions.js';
import { fetchEmployeesList } from '@/api/employees.js';
import { getActivityTypeDetails } from '@/lib/activity-helpers.js';

const MAX_RECENT_ITEMS = 5;
const POSITIVE_PAYMENT_COLOR = '#0F766E';
const NEGATIVE_PAYMENT_COLOR = '#DC2626';
const NEUTRAL_PAYMENT_COLOR = '#6B7280';
const TIMESTAMP_LOCALE = 'he-IL';

function LoadingTimelineSkeleton() {
  return (
    <div className="space-y-6">
      {Array.from({ length: MAX_RECENT_ITEMS }).map((_, index, arr) => (
        <div key={`timeline-skeleton-${index}`} className="relative ps-12">
          <div className="absolute ltr:left-5 rtl:right-5 top-0 bottom-0 flex flex-col items-center">
            <span className="relative z-10 mt-2 flex h-3 w-3 items-center justify-center">
              <span className="h-3 w-3 rounded-full bg-slate-200/80" aria-hidden />
              <span className="absolute inset-0 rounded-full bg-slate-200/50 blur-[1px]" aria-hidden />
            </span>
            {index < arr.length - 1 && (
              <span className="mt-1 w-px flex-1 bg-slate-200/60" aria-hidden />
            )}
          </div>
          <div className="overflow-hidden rounded-3xl border border-slate-200/70 bg-white/60 p-5 shadow-sm">
            <div className="flex flex-row items-center gap-4 md:gap-6">
              <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-slate-200/70 bg-white">
                <span className="h-6 w-6 rounded-full bg-slate-200/70" aria-hidden />
                <span className="absolute inset-0 animate-pulse rounded-full bg-slate-100/60" aria-hidden />
              </span>
              <div className="min-w-0 flex-1 space-y-3">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-48" />
              </div>
              <div className="flex w-40 shrink-0 flex-col items-end gap-2 text-right">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyTimelineState() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-10 text-center">
      <div className="relative flex h-28 w-28 items-center justify-center">
        <span className="absolute inset-0 animate-pulse rounded-full bg-slate-100/70" aria-hidden />
        <span className="relative flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-white via-slate-50 to-slate-100 shadow-inner">
          <Icons.CalendarClock className="h-10 w-10 text-slate-400" aria-hidden />
        </span>
      </div>
      <p className="max-w-xs text-sm font-medium text-slate-600">
        אין פעילות אחרונה עדיין—הוסיפו תיעוד חדש
      </p>
    </div>
  );
}

function getIconComponent(iconName) {
  if (iconName && Icons[iconName]) {
    return Icons[iconName];
  }
  return Icons.Clock;
}

function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function addAlphaToHex(hexColor, alpha = 0.16) {
  if (typeof hexColor !== 'string') {
    return `rgba(148, 163, 184, ${alpha})`;
  }

  let hex = hexColor.replace('#', '').trim();
  if (hex.length === 3) {
    hex = hex.split('').map((char) => char + char).join('');
  }

  if (hex.length !== 6) {
    return `rgba(148, 163, 184, ${alpha})`;
  }

  const numeric = parseInt(hex, 16);
  const r = (numeric >> 16) & 255;
  const g = (numeric >> 8) & 255;
  const b = numeric & 255;

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function parseDate(value) {
  if (!value) {
    return null;
  }
  try {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function formatActivityTimestamp(workSession) {
  const createdDate = parseDate(workSession?.created_at);
  const sessionDate = parseDate(workSession?.date);

  const primaryDate = createdDate || sessionDate;
  if (!primaryDate) {
    return { primary: '—', secondary: null, createdDiffers: false, recordedFor: null };
  }

  const now = new Date();
  const isSameDay = primaryDate.toDateString() === now.toDateString();
  const timeFormatter = new Intl.DateTimeFormat(TIMESTAMP_LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
  });
  const weekdayFormatter = new Intl.DateTimeFormat(TIMESTAMP_LOCALE, {
    weekday: 'short',
  });
  const longDateFormatter = new Intl.DateTimeFormat(TIMESTAMP_LOCALE, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const shortDateFormatter = new Intl.DateTimeFormat(TIMESTAMP_LOCALE, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const primary = isSameDay
    ? `היום · ${timeFormatter.format(primaryDate)}`
    : `${weekdayFormatter.format(primaryDate)} · ${longDateFormatter.format(primaryDate)}`;

  const secondary = `${shortDateFormatter.format(primaryDate)} · ${timeFormatter.format(primaryDate)}`;

  const createdDiffers = Boolean(createdDate && sessionDate
    && createdDate.toDateString() !== sessionDate.toDateString());
  const recordedFor = createdDiffers
    ? `${weekdayFormatter.format(sessionDate)} · ${longDateFormatter.format(sessionDate)}`
    : null;

  return { primary, secondary, createdDiffers, recordedFor };
}

function formatCurrency(amount, { includeSign = true } = {}) {
  if (amount === null || typeof amount === 'undefined') {
    return null;
  }
  const numeric = toNumber(amount);
  if (numeric === null) {
    return null;
  }

  const formatter = new Intl.NumberFormat(TIMESTAMP_LOCALE, {
    style: 'currency',
    currency: 'ILS',
    minimumFractionDigits: Math.abs(numeric % 1) > 0 ? 2 : 0,
    maximumFractionDigits: 2,
  });

  const formattedAbsolute = formatter.format(Math.abs(numeric));
  const prefix = !includeSign
    ? ''
    : numeric > 0
      ? '+'
      : numeric < 0
        ? '−'
        : '';

  return {
    display: numeric === 0 ? formattedAbsolute : `${prefix}${formattedAbsolute}`,
    numeric,
  };
}

function determinePaymentColor(numeric) {
  if (numeric > 0) {
    return POSITIVE_PAYMENT_COLOR;
  }
  if (numeric < 0) {
    return NEGATIVE_PAYMENT_COLOR;
  }
  return NEUTRAL_PAYMENT_COLOR;
}

function formatHours(hours) {
  const numeric = toNumber(hours);
  if (numeric === null || numeric === 0) {
    return null;
  }

  const hasFraction = Math.abs(numeric % 1) > 0;
  const display = hasFraction ? numeric.toFixed(1) : numeric.toString();
  return `${display} שעות`;
}

function formatSessionsCount(count) {
  const numeric = toNumber(count);
  if (numeric === null || numeric === 0) {
    return null;
  }
  return `${numeric} מפגשים`;
}

function isSalariedEmployee(employee) {
  if (!employee || typeof employee !== 'object') {
    return false;
  }

  const normalizedType = typeof employee.employee_type === 'string'
    ? employee.employee_type.trim().toLowerCase()
    : '';

  if (!normalizedType) {
    // fall through to employment scope heuristics when type is missing
  } else if (normalizedType === 'global'
    || normalizedType === 'salary'
    || normalizedType === 'salaried'
    || (normalizedType !== 'hourly' && normalizedType !== 'instructor')) {
    return true;
  }

  const employmentScopeCandidates = [
    employee.employment_scope,
    employee.employmentScope,
    employee?.metadata?.employment_scope,
    employee?.metadata?.employmentScope,
  ];

  return employmentScopeCandidates.some((value) => typeof value === 'string' && value.trim() !== '');
}

function formatRate(activity) {
  const numeric = toNumber(activity?.rate_used);
  if (numeric === null || numeric <= 0) {
    return null;
  }

  if (activity?.entry_type === 'work_global') {
    return null;
  }

  if (isSalariedEmployee(activity?.employee)) {
    return null;
  }

  const { display } = formatCurrency(numeric, { includeSign: false }) || {};
  if (!display) {
    return null;
  }

  if (activity?.entry_type === 'session') {
    return `${display} למפגש`;
  }
  if (activity?.entry_type && activity.entry_type.startsWith('leave')) {
    return `${display} ליום`;
  }
  return `${display} לשעה`;
}

function buildScopeDescriptor(activity) {
  const parts = [];
  const formattedHours = formatHours(activity?.hours);
  const formattedSessions = formatSessionsCount(activity?.sessions_count);

  if (formattedHours) {
    parts.push(formattedHours);
  }
  if (formattedSessions) {
    parts.push(formattedSessions);
  }

  if (!parts.length) {
    return null;
  }

  return `היקף: ${parts.join(' · ')}`;
}

function buildSubMetrics(activity, paymentNumeric) {
  if (paymentNumeric === 0) {
    return [];
  }

  const metrics = [];
  const hours = formatHours(activity?.hours);
  const sessions = formatSessionsCount(activity?.sessions_count);
  const rate = formatRate(activity);

  if (hours) {
    metrics.push(hours);
  }
  if (sessions) {
    metrics.push(sessions);
  }
  if (rate) {
    metrics.push(rate);
  }

  return metrics;
}

function extractNotes(activity) {
  const candidates = [
    activity?.notes,
    activity?.note,
    activity?.description,
    activity?.metadata?.notes,
    activity?.metadata?.note,
    activity?.metadata?.description,
    activity?.metadata?.reason,
  ];

  return candidates.find((value) => typeof value === 'string' && value.trim().length > 0) || null;
}

function resolveServiceName(activity) {
  const candidates = [
    activity?.service?.name,
    activity?.service_name,
    activity?.metadata?.service?.name,
    activity?.metadata?.service_name,
  ];

  return candidates.find((value) => typeof value === 'string' && value.trim().length > 0) || null;
}

function resolveStatusDescriptor(activity) {
  if (activity?.entry_type === 'leave_system_paid') {
    return 'סטטוס: על חשבון המערכת';
  }
  if (activity?.entry_type === 'leave_unpaid') {
    return 'סטטוס: ללא תשלום';
  }
  if (activity?.entry_type === 'leave_employee_paid') {
    return 'סטטוס: חופשה בתשלום';
  }
  if (activity?.entry_type === 'leave_half_day') {
    return 'סטטוס: חצי יום';
  }
  if (activity?.entry_type === 'adjustment') {
    return activity?.total_payment > 0 ? 'סוג: זיכוי' : activity?.total_payment < 0 ? 'סוג: חיוב' : 'סוג: התאמה';
  }
  return null;
}

function buildContextLine(activity) {
  const contextParts = [];
  const serviceName = resolveServiceName(activity);
  if (serviceName) {
    contextParts.push(serviceName);
  }

  const scopeDescriptor = buildScopeDescriptor(activity);
  if (scopeDescriptor) {
    contextParts.push(scopeDescriptor);
  }

  const statusDescriptor = resolveStatusDescriptor(activity);
  if (statusDescriptor) {
    contextParts.push(statusDescriptor);
  }

  const notes = extractNotes(activity);
  if (notes) {
    contextParts.push(notes);
  }

  return contextParts;
}

export default function RecentActivityTimeline() {
  const { tenantClientReady, activeOrgHasConnection, activeOrgId } = useOrg();
  const { session, loading: supabaseLoading } = useSupabase();
  const [activities, setActivities] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const canFetch = tenantClientReady
    && activeOrgHasConnection
    && Boolean(session)
    && Boolean(activeOrgId);

  useEffect(() => {
    let isCancelled = false;

    async function loadRecentActivity() {
      if (!canFetch) {
        setActivities([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const [sessionsResponse, employeesResponse] = await Promise.all([
          fetchWorkSessions({ session, orgId: activeOrgId }),
          fetchEmployeesList({ session, orgId: activeOrgId }),
        ]);

        if (isCancelled) {
          return;
        }

        const rawSessions = Array.isArray(sessionsResponse?.sessions)
          ? sessionsResponse.sessions.filter((item) => item && item.deleted !== true)
          : [];

        rawSessions.sort((a, b) => {
          const createdA = a?.created_at ? new Date(a.created_at).getTime() : 0;
          const createdB = b?.created_at ? new Date(b.created_at).getTime() : 0;
          return createdB - createdA;
        });

        const employeeRecords = Array.isArray(employeesResponse?.employees)
          ? employeesResponse.employees
          : [];

        const employeesById = new Map(
          employeeRecords.map((employee) => [employee.id, employee]),
        );

        const slicedSessions = rawSessions.slice(0, MAX_RECENT_ITEMS).map((sessionItem) => ({
          ...sessionItem,
          employee: employeesById.get(sessionItem.employee_id) || null,
        }));

        setActivities(slicedSessions);
        setIsLoading(false);
      } catch (fetchError) {
        if (isCancelled) {
          return;
        }
        console.error('Failed to load recent activity timeline', fetchError);
        setError(fetchError?.message || 'שגיאה בטעינת פעילות אחרונה.');
        setActivities([]);
        setIsLoading(false);
      }
    }

    loadRecentActivity();

    return () => {
      isCancelled = true;
    };
  }, [canFetch, session, activeOrgId]);

  const content = useMemo(() => {
    if (supabaseLoading || isLoading) {
      return <LoadingTimelineSkeleton />;
    }

    if (!canFetch) {
      return (
        <div className="text-sm text-slate-500">
          בחרו ארגון פעיל כדי לצפות בפעילות האחרונה.
        </div>
      );
    }

    if (error) {
      return (
        <div className="text-sm text-red-600">
          {error}
        </div>
      );
    }

    if (!activities.length) {
      return <EmptyTimelineState />;
    }

    return (
      <ol className="relative space-y-6">
        {activities.map((activity, index) => {
          const { icon, color, label } = getActivityTypeDetails(activity);
          const IconComponent = getIconComponent(icon);
          const employeeName = activity?.employee?.name || 'עובד לא מזוהה';
          const {
            primary: primaryTimestamp,
            secondary: secondaryTimestamp,
            createdDiffers,
            recordedFor,
          } = formatActivityTimestamp(activity);
          const payment = formatCurrency(activity?.total_payment);
          const paymentColor = payment
            ? determinePaymentColor(payment.numeric)
            : NEUTRAL_PAYMENT_COLOR;
          const subMetrics = buildSubMetrics(activity, payment?.numeric ?? null);
          const contextParts = buildContextLine(activity);

          return (
            <li
              key={activity.id || `${activity.employee_id}-${activity.date}-${activity.entry_type}`}
              className="relative ps-12"
            >
              <div className="absolute ltr:left-5 rtl:right-5 top-0 bottom-0 flex flex-col items-center">
                <span className="relative z-10 mt-2 flex h-3 w-3 items-center justify-center">
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: color }}
                    aria-hidden
                  />
                </span>
                {index < activities.length - 1 && (
                  <span className="mt-1 w-px flex-1 bg-slate-200" aria-hidden />
                )}
              </div>

              <article className="relative flex flex-row items-stretch gap-4 rounded-3xl border border-slate-200/80 bg-white/90 p-5 shadow-sm transition-shadow duration-200 hover:shadow-lg md:gap-6">
                <div className="flex w-14 shrink-0 items-center justify-center">
                  <span
                    className="flex h-12 w-12 items-center justify-center rounded-full border-2"
                    style={{
                      borderColor: color,
                      backgroundColor: addAlphaToHex(color),
                    }}
                  >
                    <IconComponent className="h-6 w-6" style={{ color }} aria-hidden />
                  </span>
                </div>

                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="max-w-[12rem] truncate text-sm font-semibold text-slate-900 sm:max-w-[18rem]">
                      {employeeName}
                    </span>
                    <span
                      className="flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold"
                      style={{
                        color,
                        borderColor: color,
                        backgroundColor: addAlphaToHex(color, 0.18),
                      }}
                    >
                      <IconComponent className="h-3.5 w-3.5" aria-hidden />
                      <span>{label}</span>
                    </span>
                    <span
                      className="ml-auto text-xs text-slate-500"
                      title={secondaryTimestamp || undefined}
                    >
                      {primaryTimestamp}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
                    {contextParts.length ? (
                      contextParts.map((part, idx) => (
                        <React.Fragment key={idx}>
                          <span className="truncate">{part}</span>
                          {idx < contextParts.length - 1 && (
                            <span aria-hidden>·</span>
                          )}
                        </React.Fragment>
                      ))
                    ) : (
                      <span className="truncate">—</span>
                    )}
                  </div>

                  {createdDiffers && recordedFor && (
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5">
                        נרשם עבור: {recordedFor}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex w-40 shrink-0 flex-col items-end gap-2 text-right">
                  <span
                    className="text-lg font-semibold"
                    style={{ color: paymentColor }}
                  >
                    {payment?.display || '—'}
                  </span>
                  {subMetrics.length > 0 && (
                    <div className="flex flex-col items-end gap-1 text-xs text-slate-500">
                      {subMetrics.map((metric, idx) => (
                        <span key={idx}>{metric}</span>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            </li>
          );
        })}
      </ol>
    );
  }, [activities, canFetch, error, isLoading, supabaseLoading]);

  return (
    <Card className="h-full bg-white/70 backdrop-blur-sm">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center justify-between text-base font-semibold text-slate-900">
          <span>פעילות אחרונה</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        {content}
      </CardContent>
    </Card>
  );
}
