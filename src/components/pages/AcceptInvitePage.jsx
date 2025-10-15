import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthContext.jsx';
import { useOrg } from '@/org/OrgContext.jsx';
import {
  getInvitationByToken,
  acceptInvitation,
  declineInvitation,
} from '@/api/invitations.js';

function useInviteToken(location) {
  return useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    const tokenFromQuery = params.get('token');
    if (typeof tokenFromQuery === 'string' && tokenFromQuery.trim()) {
      return tokenFromQuery.trim();
    }
    const tokenFromState = typeof location.state?.inviteToken === 'string'
      ? location.state.inviteToken.trim()
      : '';
    return tokenFromState;
  }, [location.search, location.state?.inviteToken]);
}

function LoadingView() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16">
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-200 border-t-blue-500" aria-hidden="true" />
      <p className="text-slate-600 text-lg font-medium">טוען את פרטי ההזמנה...</p>
    </div>
  );
}

function ErrorView({ message, onBack }) {
  return (
    <div className="bg-white shadow-xl rounded-3xl border border-red-100 p-10 space-y-6 text-right" role="alert">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-red-600">לא ניתן לאמת את ההזמנה</h1>
        <p className="text-slate-600 leading-relaxed">{message}</p>
      </div>
      {onBack ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onBack}
            className="px-6 py-3 rounded-xl bg-gradient-to-l from-slate-600 to-slate-800 text-white font-semibold shadow-lg hover:shadow-xl transition"
          >
            חזרה לדף ההתחברות
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function AcceptInvitePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const token = useInviteToken(location);
  const { status: authStatus, session, user, signOut } = useAuth();
  const { refreshOrganizations } = useOrg();

  const [invitation, setInvitation] = useState(null);
  const [loadStatus, setLoadStatus] = useState('loading');
  const [error, setError] = useState(null);
  const [actionState, setActionState] = useState('idle');

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    async function fetchInvitationDetails() {
      if (!token) {
        setError('קישור ההזמנה חסר או פג תוקף. ודא שהשתמשת בקישור שנשלח אליך בדוא"ל.');
        setLoadStatus('error');
        return;
      }

      setLoadStatus('loading');
      setError(null);

      try {
        const record = await getInvitationByToken(token, { signal: controller.signal });
        if (!isMounted) return;
        if (!record || record.status !== 'pending') {
          setError('ההזמנה כבר אינה פעילה. פנה למנהל הארגון לקבלת קישור חדש.');
          setLoadStatus('error');
          return;
        }
        setInvitation(record);
        setLoadStatus('ready');
      } catch (fetchError) {
        if (!isMounted || fetchError?.name === 'AbortError') {
          return;
        }
        setError(fetchError?.message || 'לא ניתן היה לטעון את ההזמנה.');
        setLoadStatus('error');
      }
    }

    fetchInvitationDetails();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [token]);

  useEffect(() => {
    if (loadStatus !== 'ready' || !invitation) {
      return;
    }

    const queryToken = new URLSearchParams(location.search || '').get('token');
    if (!queryToken && token) {
      navigate(`/accept-invite?token=${encodeURIComponent(token)}`, { replace: true, state: { inviteToken: token } });
    }
  }, [loadStatus, invitation, location.search, token, navigate]);

  const authReady = authStatus === 'ready';
  const isAuthenticated = authReady && Boolean(session);
  const normalizedInviteEmail = (invitation?.email || '').toLowerCase();
  const normalizedUserEmail = (user?.email || '').toLowerCase();
  const emailMatches = isAuthenticated && normalizedInviteEmail && normalizedInviteEmail === normalizedUserEmail;

  const organizationName = invitation?.organization?.name || 'הארגון';
  const inviterName = invitation?.invitedBy || 'מנהל הארגון';

  const buildLoginState = (message) => ({
    from: {
      pathname: '/accept-invite',
      search: token ? `?token=${encodeURIComponent(token)}` : '',
    },
    inviteToken: token,
    message,
  });

  const handleNavigateToLogin = (intent) => {
    const message = intent === 'signup'
      ? 'כדי להצטרף לארגון, צור חשבון חדש באמצעות אחת מאפשרויות ההתחברות.'
      : 'התחבר לחשבון הקיים שלך כדי להשלים את ההצטרפות לארגון.';
    navigate('/login', { state: buildLoginState(message) });
  };

  const handleAccept = async () => {
    if (!invitation?.id || !session || actionState !== 'idle') {
      return;
    }
    setActionState('accepting');
    try {
      await acceptInvitation(invitation.id, { session });
      toast.success('הצטרפת בהצלחה לארגון! מעדכן את סביבת העבודה...');
      await refreshOrganizations();
      navigate('/Dashboard', { replace: true });
    } catch (acceptError) {
      console.error('Failed to accept invitation', acceptError);
      toast.error(acceptError?.message || 'אישור ההזמנה נכשל. נסה שוב.');
      setActionState('idle');
    }
  };

  const handleDecline = async () => {
    if (!invitation?.id || !session || actionState !== 'idle') {
      return;
    }
    setActionState('declining');
    try {
      await declineInvitation(invitation.id, { session });
      toast.success('ההזמנה סומנה כנדחתה. ניתן להמשיך לשימוש הרגיל במערכת.');
      navigate('/Dashboard', { replace: true });
    } catch (declineError) {
      console.error('Failed to decline invitation', declineError);
      toast.error(declineError?.message || 'דחיית ההזמנה נכשלה. נסה שוב.');
      setActionState('idle');
    }
  };

  const handleSwitchAccount = async () => {
    if (actionState !== 'idle') {
      return;
    }
    setActionState('signingOut');
    try {
      await signOut();
      navigate('/login', {
        replace: true,
        state: buildLoginState('התנתקת מהחשבון הנוכחי. התחבר עם הכתובת הנכונה כדי להשלים את ההצטרפות.'),
      });
    } catch (signOutError) {
      console.error('Failed to sign out before switching account', signOutError);
      toast.error('התנתקות נכשלה. נסה שוב.');
      setActionState('idle');
    }
  };

  if (loadStatus === 'loading' || authStatus === 'loading') {
    return (
      <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-slate-100 flex items-center justify-center px-4" dir="rtl">
        <LoadingView />
      </main>
    );
  }

  if (loadStatus === 'error' || !invitation) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-slate-100 flex items-center justify-center px-4" dir="rtl">
        <ErrorView
          message={error || 'ההזמנה אינה זמינה.'}
          onBack={() => handleNavigateToLogin('signin')}
        />
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-slate-100 flex items-center justify-center px-4" dir="rtl">
        <div className="max-w-xl w-full bg-white shadow-2xl rounded-3xl border border-slate-100 p-10 space-y-8 text-right">
          <div className="space-y-2">
            <p className="text-sm text-blue-500 font-semibold">הזמנת הצטרפות</p>
            <h1 className="text-3xl font-bold text-slate-900">הוזמנת להצטרף ל{organizationName}</h1>
            <p className="text-slate-600 leading-relaxed">
              כדי להשלים את התהליך, התחבר באמצעות החשבון שנשלח אליו הקישור או צור חשבון חדש אם זו הפעם הראשונה שלך במערכת.
            </p>
          </div>
          <div className="space-y-4">
            <button
              type="button"
              className="w-full px-6 py-4 rounded-xl bg-gradient-to-l from-emerald-500 to-teal-500 text-white font-semibold shadow-lg hover:shadow-xl transition"
              onClick={() => handleNavigateToLogin('signup')}
            >
              יצירת חשבון חדש
            </button>
            <button
              type="button"
              className="w-full px-6 py-4 rounded-xl border border-blue-500 text-blue-600 font-semibold hover:bg-blue-50 transition"
              onClick={() => handleNavigateToLogin('signin')}
            >
              התחברות לחשבון קיים
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (!emailMatches) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-slate-100 flex items-center justify-center px-4" dir="rtl">
        <div className="max-w-xl w-full bg-white shadow-2xl rounded-3xl border border-amber-100 p-10 space-y-8 text-right">
          <div className="space-y-3">
            <p className="text-sm text-amber-500 font-semibold">נדרש חשבון אחר</p>
            <h1 className="text-3xl font-bold text-slate-900">האימייל אינו תואם להזמנה</h1>
            <p className="text-slate-600 leading-relaxed">
              ההזמנה נשלחה אל <span className="font-semibold text-slate-900">{normalizedInviteEmail}</span>, אך כרגע אתה מחובר כ
              <span className="font-semibold text-slate-900"> {normalizedUserEmail || 'משתמש אחר'}</span>.
              כדי להמשיך, התנתק והתחבר עם החשבון המתאים.
            </p>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleSwitchAccount}
              disabled={actionState !== 'idle'}
              className="px-6 py-3 rounded-xl bg-gradient-to-l from-rose-500 to-red-600 text-white font-semibold shadow-lg hover:shadow-xl transition disabled:opacity-60"
            >
              {actionState === 'signingOut' ? 'מתנתק...' : 'התנתקות והחלפת חשבון'}
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-slate-100 flex items-center justify-center px-4" dir="rtl">
      <div className="max-w-xl w-full bg-white shadow-2xl rounded-3xl border border-slate-100 p-10 space-y-8 text-right">
        <div className="space-y-3">
          <p className="text-sm text-green-500 font-semibold">אישור הזמנה</p>
          <h1 className="text-3xl font-bold text-slate-900">{inviterName} מזמין אותך להצטרף ל{organizationName}</h1>
          <p className="text-slate-600 leading-relaxed">
            החשבון המחובר ({normalizedUserEmail}) תואם להזמנה. בחר האם להצטרף לארגון או לדחות את ההזמנה.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={handleAccept}
            disabled={actionState !== 'idle'}
            className="w-full px-6 py-4 rounded-xl bg-gradient-to-l from-emerald-500 to-green-600 text-white font-semibold shadow-lg hover:shadow-xl transition disabled:opacity-60"
          >
            {actionState === 'accepting' ? 'מצטרף...' : 'אישור והצטרפות'}
          </button>
          <button
            type="button"
            onClick={handleDecline}
            disabled={actionState !== 'idle'}
            className="w-full px-6 py-4 rounded-xl border border-slate-300 text-slate-700 font-semibold hover:bg-slate-50 transition disabled:opacity-60"
          >
            {actionState === 'declining' ? 'מעדכן...' : 'דחיית ההזמנה'}
          </button>
        </div>
      </div>
    </main>
  );
}
