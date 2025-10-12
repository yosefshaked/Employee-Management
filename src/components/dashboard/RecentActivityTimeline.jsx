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

function getIconComponent(iconName) {
  if (iconName && Icons[iconName]) {
    return Icons[iconName];
  }
  return Icons.Clock;
}

function formatActivityDate(workSession) {
  if (!workSession?.created_at && !workSession?.date) {
    return '—';
  }
  const dateToUse = workSession.created_at || workSession.date;
  try {
    return new Date(dateToUse).toLocaleString('he-IL', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateToUse;
  }
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
      return (
        <div className="space-y-4">
          {Array.from({ length: MAX_RECENT_ITEMS }).map((_, index) => (
            <div key={index} className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      );
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
      return (
        <div className="text-sm text-slate-500">
          אין פעילות להצגה כרגע.
        </div>
      );
    }

    return (
      <ul className="space-y-3">
        {activities.map((activity) => {
          const { icon, color, label } = getActivityTypeDetails(activity);
          const IconComponent = getIconComponent(icon);
          const employeeName = activity?.employee?.name || 'עובד לא מזוהה';
          const formattedDate = formatActivityDate(activity);

          return (
            <li
              key={activity.id || `${activity.employee_id}-${activity.date}-${activity.entry_type}`}
              className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white/60 p-3"
            >
              <span
                className="flex h-10 w-10 items-center justify-center rounded-full border"
                style={{ borderColor: color }}
              >
                <IconComponent className="h-5 w-5" style={{ color }} />
              </span>
              <div className="flex flex-1 flex-col">
                <span className="text-sm font-semibold text-slate-900">{employeeName}</span>
                <span className="text-xs text-slate-500">{formattedDate}</span>
              </div>
              <span className="text-sm font-medium" style={{ color }}>
                {label}
              </span>
            </li>
          );
        })}
      </ul>
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
