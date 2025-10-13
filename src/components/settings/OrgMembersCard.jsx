import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Trash2, UserMinus } from 'lucide-react';
import { toast } from 'sonner';
import { useOrg } from '@/org/OrgContext.jsx';
import { useAuth } from '@/auth/AuthContext.jsx';
import InviteUserForm from '@/components/settings/InviteUserForm.jsx';

function formatDate(isoString) {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    return new Intl.DateTimeFormat('he-IL', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return isoString;
  }
}

function translateInviteStatus(status) {
  switch ((status || '').toLowerCase()) {
    case 'pending':
      return 'ממתינה להצטרפות';
    case 'sent':
      return 'נשלחה בהצלחה';
    case 'accepted':
      return 'התקבלה';
    case 'declined':
      return 'נדחתה';
    default:
      return 'סטטוס לא ידוע';
  }
}

export default function OrgMembersCard() {
  const {
    activeOrg,
    members,
    pendingInvites,
    pendingInvitesStatus,
    revokeInvite,
    removeMember,
  } = useOrg();
  const { user } = useAuth();
  const userRole = activeOrg?.membership?.role;
  const canManageMembers = userRole === 'admin' || userRole === 'owner';
  const isLoadingInvites = pendingInvitesStatus === 'loading';
  const invitesFailed = pendingInvitesStatus === 'error';
  const hasPendingInvites = Array.isArray(pendingInvites) && pendingInvites.length > 0;

  if (!activeOrg) {
    return null;
  }

  const handleRevoke = async (inviteId) => {
    try {
      await revokeInvite(inviteId);
      toast.success('ההזמנה בוטלה.');
    } catch (error) {
      console.error('Failed to revoke invite', error);
      toast.error('לא ניתן לבטל את ההזמנה. נסה שוב.');
    }
  };

  const handleRemoveMember = async (membershipId) => {
    try {
      await removeMember(membershipId);
      toast.success('החבר הוסר מהארגון.');
    } catch (error) {
      console.error('Failed to remove member', error);
      toast.error('הסרת החבר נכשלה.');
    }
  };

  return (
    <Card className="border-0 shadow-xl bg-white/90" dir="rtl">
      <CardHeader className="border-b border-slate-200">
        <CardTitle className="text-xl font-semibold text-slate-900">חברי ארגון</CardTitle>
        <p className="text-sm text-slate-600 mt-2">
          כל המשתמשים בארגון חולקים את אותו חיבור Supabase. מנהלים יכולים להזמין ולנהל חברים נוספים.
        </p>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-700">חברים פעילים</h3>
          <div className="space-y-3">
            {(members || []).map((member) => {
              const isCurrentUser = member.user_id === user?.id;
              return (
                <div
                  key={member.id || member.user_id}
                  className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border border-slate-200 rounded-xl px-4 py-3"
                >
                  <div className="text-right space-y-1">
                    <p className="text-sm font-medium text-slate-900">
                      {member.name || member.email || 'משתמש ללא שם'}
                    </p>
                    <p className="text-xs text-slate-500" dir="ltr">
                      {member.email || member.user_id}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span>הצטרף: {formatDate(member.joined_at)}</span>
                      {member.role ? (
                        <Badge variant="outline" className="text-blue-700 border-blue-200 bg-blue-50">
                          {member.role === 'admin' ? 'מנהל' : 'חבר'}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  {canManageMembers && !isCurrentUser ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="text-red-600 hover:bg-red-50 gap-2"
                      onClick={() => handleRemoveMember(member.id)}
                    >
                      <UserMinus className="w-4 h-4" />
                      הסר מהארגון
                    </Button>
                  ) : null}
                </div>
              );
            })}
            {!members?.length ? (
              <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2" role="status">
                <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                <span>עדיין לא נוספו חברים נוספים לארגון.</span>
              </div>
            ) : null}
          </div>
        </section>

        {canManageMembers ? (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-700">הזמן חבר חדש</h3>
            <InviteUserForm orgId={activeOrg.id} />
          </section>
        ) : null}

        {canManageMembers ? (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-700">הזמנות ממתינות</h3>
            <div className="space-y-3">
              {isLoadingInvites ? (
                <p className="text-xs text-slate-500" role="status">טוען הזמנות...</p>
              ) : null}
              {invitesFailed ? (
                <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2" role="alert">
                  <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                  <span>טעינת ההזמנות נכשלה. נסה לרענן את הדף.</span>
                </div>
              ) : null}
              {hasPendingInvites
                ? pendingInvites.map((invite) => (
                    <div
                      key={invite.id}
                      className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border border-slate-200 rounded-xl px-4 py-3"
                    >
                      <div className="text-right space-y-1">
                        <p className="text-sm font-medium text-slate-900" dir="ltr">{invite.email}</p>
                        <p className="text-xs text-slate-500">נשלח: {formatDate(invite.created_at)}</p>
                        <Badge variant="outline" className="text-indigo-700 border-indigo-200 bg-indigo-50">
                          {translateInviteStatus(invite.status)}
                        </Badge>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        className="text-slate-600 hover:bg-slate-100 gap-2"
                        onClick={() => handleRevoke(invite.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                        בטל הזמנה
                      </Button>
                    </div>
                  ))
                : null}
              {!hasPendingInvites && !isLoadingInvites && !invitesFailed ? (
                <p className="text-xs text-slate-500">אין הזמנות ממתינות.</p>
              ) : null}
            </div>
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
