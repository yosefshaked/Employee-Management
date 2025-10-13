import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Loader2, LogIn, LogOut, MailPlus, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import {
  acceptInvitation as acceptInvitationRequest,
  declineInvitation as declineInvitationRequest,
  getInvitationByToken,
} from '@/api/invitations.js';
import { Button } from '@/components/ui/button';

function normalizeEmail(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase();
}

function buildLoginState(token, message) {
  if (!token) {
    return { from: { pathname: '/Dashboard' }, message };
  }

  const search = `?token=${encodeURIComponent(token)}`;
  return {
    from: {
      pathname: '/accept-invite',
      search,
    },
    inviteToken: token,
    message,
  };
}

function InvitationStatus({ state, message }) {
  if (state === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" aria-hidden="true" />
        <p className="text-lg font-medium text-slate-700">טוען את פרטי ההזמנה...</p>
        <p className="text-sm text-slate-500">אנא המתינו רגע בזמן שאנו מאמתים את הקישור.</p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-right space-y-2" role="alert">
        <div className="flex items-center justify-end gap-3 text-red-700">
          <ShieldAlert className="h-6 w-6" aria-hidden="true" />
          <h2 className="text-lg font-semibold">אירעה שגיאה</h2>
        </div>
        <p className="text-sm text-red-700">{message || 'לא הצלחנו לאמת את קישור ההזמנה. בדקו אם הקישור עדיין בתוקף ונסו שוב.'}</p>
      </div>
    );
  }

  return null;
}

function AnonymousInvitationView({ onCreateAccount, onLogin }) {
  return (
    <div className="space-y-6">
      <p className="text-slate-700 text-right leading-relaxed">
        כדי להצטרף לארגון, התחברו עם חשבון קיים או צרו חשבון חדש באמצעות הקישור שנשלח אליכם.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Button onClick={onCreateAccount} className="w-full" variant="secondary">
          <MailPlus className="h-4 w-4" aria-hidden="true" />
          <span>יצירת חשבון חדש</span>
        </Button>
        <Button onClick={onLogin} className="w-full">
          <LogIn className="h-4 w-4" aria-hidden="true" />
          <span>התחברות לחשבון קיים</span>
        </Button>
      </div>
    </div>
  );
}

function MismatchView({ inviteEmail, userEmail, onLogout }) {
  return (
    <div className="space-y-6">
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-right">
        <p className="text-amber-800 font-medium">נראה שקישור ההזמנה מיועד לכתובת אחרת.</p>
        <p className="text-amber-700 text-sm mt-2">
          הקישור נשלח אל {inviteEmail} אך אתם מחוברים כ-{userEmail || 'משתמש אחר'}. התנתקו והתחברו עם החשבון הנכון כדי להמשיך.
        </p>
      </div>
      <Button onClick={onLogout} variant="outline" className="w-full">
        <LogOut className="h-4 w-4" aria-hidden="true" />
        <span>התנתקות והחלפת חשבון</span>
      </Button>
    </div>
  );
}

function AcceptanceView({
  invitation,
  onAccept,
  isAccepting,
  onDecline,
  isDeclining,
}) {
  return (
    <div className="space-y-6">
      <div className="text-right space-y-2">
        <h2 className="text-2xl font-semibold text-slate-800">הזמנה להצטרף ל{invitation.organization?.name || 'ארגון'}</h2>
        <p className="text-slate-600">
          {`ההזמנה נשלחה אל ${invitation.email}. בחרו אם להצטרף לארגון כעת.`}
        </p>
      </div>
      <div className="flex flex-col sm:flex-row gap-3 sm:justify-end">
        <Button
          onClick={onDecline}
          variant="outline"
          className="sm:w-40"
          disabled={isDeclining || isAccepting}
        >
          {isDeclining ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              <span>דוחה...</span>
            </>
          ) : (
            <span>דחיית ההזמנה</span>
          )}
        </Button>
        <Button onClick={onAccept} disabled={isAccepting || isDeclining} className="sm:w-40">
          {isAccepting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              <span>מצטרפים...</span>
            </>
          ) : (
            <span>אישור הצטרפות</span>
          )}
        </Button>
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { status: authStatus, session, user, signOut } = useAuth();
  const { refreshOrganizations, selectOrg } = useOrg();
  const [inviteStatus, setInviteStatus] = useState('idle');
  const [invitation, setInvitation] = useState(null);
  const [inviteError, setInviteError] = useState('');
  const [isAccepting, setIsAccepting] = useState(false);
  const [isDeclining, setIsDeclining] = useState(false);

  const token = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return (params.get('token') || '').trim();
  }, [location.search]);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    async function loadInvitation() {
      if (!token) {
        setInviteStatus('error');
        setInviteError('קישור ההזמנה חסר או פגום.');
        setInvitation(null);
        return;
      }

      setInviteStatus('loading');
      setInviteError('');

      try {
        const payload = await getInvitationByToken({ token, signal: controller.signal, session });
        if (!isMounted) return;

        const invitationPayload = payload?.invitation || {
          id: payload?.invitationId || null,
          email: payload?.email || null,
          organization: payload?.organization || null,
          status: payload?.status || null,
          supabaseLink: payload?.supabaseLink || null,
        };

        const normalized = {
          id: invitationPayload.id,
          email: invitationPayload.email ? invitationPayload.email.toLowerCase() : null,
          organization: invitationPayload.organization || null,
          status: invitationPayload.status || null,
          supabaseLink: payload?.supabaseLink || invitationPayload.supabaseLink || null,
        };

        if (!normalized.id) {
          throw new Error('ההזמנה לא נמצאה או פגה תוקפה.');
        }

        setInvitation(normalized);
        setInviteStatus('ready');
      } catch (error) {
        if (!isMounted || error.name === 'AbortError') {
          return;
        }
        console.error('Failed to load invitation by token', error);
        setInvitation(null);
        setInviteStatus('error');
        setInviteError(error?.message || 'קישור ההזמנה אינו תקין.');
      }
    }

    loadInvitation();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [token, session]);

  const handleCreateAccount = useCallback(() => {
    if (!invitation?.supabaseLink) {
      toast.info('לא נמצא קישור ישיר להרשמה. בדקו את הדוא"ל שקיבלתם מהמערכת.');
      return;
    }

    window.location.assign(invitation.supabaseLink);
  }, [invitation]);

  const handleLogin = useCallback(() => {
    const message = 'התחברו כדי להשלים את קבלת ההזמנה.';
    navigate('/login', {
      state: buildLoginState(token, message),
    });
  }, [navigate, token]);

  const handleAccept = useCallback(async () => {
    if (!session || !invitation?.id) {
      toast.error('דרושה התחברות פעילה לפני הצטרפות לארגון.');
      return;
    }

    setIsAccepting(true);
    try {
      const response = await acceptInvitationRequest({
        session,
        invitationId: invitation.id,
      });
      const targetOrgId = response?.organization?.id
        || response?.invitation?.org_id
        || response?.invitation?.orgId
        || invitation.organization?.id
        || null;

      await refreshOrganizations({ keepSelection: false });

      if (targetOrgId) {
        await selectOrg(targetOrgId);
      }

      toast.success('הצטרפתם לארגון בהצלחה!');
      navigate('/Dashboard', { replace: true });
    } catch (error) {
      console.error('Failed to accept invitation', error);
      const message = error?.message || 'הצטרפות לארגון נכשלה. נסו שוב מאוחר יותר.';
      toast.error(message);
    } finally {
      setIsAccepting(false);
    }
  }, [session, invitation, refreshOrganizations, selectOrg, navigate]);

  const handleDecline = useCallback(async () => {
    if (!session || !invitation?.id) {
      toast.error('נדרש חיבור פעיל כדי לדחות הזמנה.');
      return;
    }

    setIsDeclining(true);
    try {
      await declineInvitationRequest({
        session,
        invitationId: invitation.id,
      });

      await refreshOrganizations({ keepSelection: true });
      toast.success('ההזמנה נדחתה בהצלחה.');
      navigate('/select-org', { replace: true });
    } catch (error) {
      console.error('Failed to decline invitation', error);
      const message = error?.message || 'דחיית ההזמנה נכשלה. נסו שוב מאוחר יותר.';
      toast.error(message);
    } finally {
      setIsDeclining(false);
    }
  }, [session, invitation, refreshOrganizations, navigate]);

  const handleLogout = useCallback(async () => {
    try {
      await signOut();
      toast.success('התנתקתם בהצלחה. התחברו עם החשבון הנכון כדי להמשיך.');
    } catch (error) {
      console.error('Failed to sign out for invitation switch', error);
      toast.error('אירעה שגיאה במהלך ההתנתקות. נסו שוב.');
    }
  }, [signOut]);

  const authReady = authStatus === 'ready';
  const hasSession = authReady && Boolean(session);
  const inviteEmail = invitation?.email ? normalizeEmail(invitation.email) : '';
  const userEmail = user?.email ? normalizeEmail(user.email) : '';

  let content = null;

  if (inviteStatus === 'loading' || authStatus === 'loading') {
    content = <InvitationStatus state="loading" />;
  } else if (inviteStatus === 'error') {
    content = <InvitationStatus state="error" message={inviteError} />;
  } else if (!invitation) {
    content = (
      <InvitationStatus
        state="error"
        message="פרטי ההזמנה לא נמצאו. ודאו שהקישור שהוזן הוא העדכני ביותר."
      />
    );
  } else if (!hasSession) {
    content = (
      <AnonymousInvitationView
        onCreateAccount={handleCreateAccount}
        onLogin={handleLogin}
      />
    );
  } else if (inviteEmail && inviteEmail === userEmail) {
    content = (
      <AcceptanceView
        invitation={invitation}
        onAccept={handleAccept}
        onDecline={handleDecline}
        isAccepting={isAccepting}
        isDeclining={isDeclining}
      />
    );
  } else {
    content = (
      <MismatchView
        inviteEmail={invitation.email || inviteEmail}
        userEmail={user?.email || userEmail}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50 to-slate-100 flex items-center justify-center px-4">
      <div className="max-w-2xl w-full bg-white border border-slate-200 shadow-xl rounded-3xl overflow-hidden" dir="rtl">
        <div className="bg-gradient-to-l from-indigo-500 to-blue-500 text-white px-8 py-10 text-right">
          <div className="space-y-3">
            <h1 className="text-3xl font-bold">הצטרפות לארגון</h1>
            <p className="text-indigo-100 text-sm">
              קבלו הזמנה והמשיכו בהגדרת החשבון כדי להתחיל לעבוד עם הצוות שלכם.
            </p>
            {invitation?.organization?.name ? (
              <p className="text-sm text-indigo-100">
                {`ההזמנה עבור "${invitation.organization.name}"`}
              </p>
            ) : null}
          </div>
        </div>
        <div className="p-8 space-y-8">
          {content}
        </div>
      </div>
    </div>
  );
}
