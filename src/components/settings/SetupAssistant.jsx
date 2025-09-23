import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { maskSupabaseCredential } from '@/lib/supabase-utils.js';
import {
  SETUP_SQL_SCRIPT_STEP_2_TABLES,
  SETUP_SQL_SCRIPT_STEP_3_POLICIES,
  SETUP_SQL_SCRIPT_STEP_4_JWT,
} from '@/lib/setup-sql.js';
import { useOrg } from '@/org/OrgContext.jsx';
import { resolveControlAccessToken } from '@/lib/api-client.js';
import { verifyOrgConnection } from '@/runtime/verification.js';
import { fetchLeavePolicySettings } from '@/lib/settings-client.js';
import { asError } from '@/lib/error-utils.js';
import { mapSupabaseError } from '@/org/errors.js';
import {
  Building2,
  AlertCircle,
  CheckCircle2,
  ClipboardCopy,
  Loader2,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';

const INITIAL_CONNECTION_VALUES = {
  supabase_url: '',
  anon_key: '',
  policy_links_text: '',
  legal_contact_email: '',
  legal_terms_url: '',
  legal_privacy_url: '',
};

const INITIAL_CONNECTION_TEST = {
  status: 'idle',
  message: '',
  diagnostics: null,
  supabaseError: null,
  completedAt: null,
};

const INITIAL_LEAVE_POLICY_STATUS = {
  state: 'idle',
  policy: null,
  error: null,
  fetchedAt: null,
};

const REQUIRED_TABLES = ['Employees', 'WorkSessions', 'LeaveBalances', 'RateHistory', 'Services', 'Settings'];

const TABLE_LABELS = {
  Employees: 'טבלת עובדים',
  WorkSessions: 'רישומי שעות ועבודה',
  LeaveBalances: 'יתרות חופשה',
  RateHistory: 'היסטוריית תעריפים',
  Services: 'שירותים והצעות',
  Settings: 'הגדרות ארגון',
};

const WIZARD_STEPS = [
  { number: 1, title: 'Step 1: Connect to Supabase' },
  { number: 2, title: 'Step 2: Create Tables' },
  { number: 3, title: 'Step 3: Create Rules & Policies' },
  { number: 4, title: 'Step 4: Create Dedicated JWT' },
  { number: 5, title: 'Step 5: Verification & Save' },
];



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

function formatDiagnosticsTimestamp(timestamp) {
  if (!timestamp) return '';
  try {
    const iso = new Date(timestamp).toISOString();
    return formatDateTime(iso);
  } catch (error) {
    console.error('Failed to format diagnostics timestamp', error);
    return '';
  }
}

function maskDiagnosticsPayload(payload) {
  if (Array.isArray(payload)) {
    return payload.map((item) => maskDiagnosticsPayload(item));
  }

  if (payload && typeof payload === 'object') {
    const next = {};
    for (const [key, value] of Object.entries(payload)) {
      if (value && typeof value === 'object') {
        next[key] = maskDiagnosticsPayload(value);
        continue;
      }
      if (typeof value === 'string') {
        const lowerKey = key.toLowerCase();
        if (lowerKey.includes('key')) {
          next[key] = maskSupabaseCredential(value);
          continue;
        }
      }
      next[key] = value;
    }
    return next;
  }

  return payload;
}

function maskDiagnosticsText(text) {
  if (typeof text !== 'string' || !text) {
    return '';
  }
  return text.replace(/[A-Za-z0-9-_]{24,}/g, (match) => maskSupabaseCredential(match));
}

function interpretDiagnostics(diagnostics) {
  if (!diagnostics || !diagnostics.error) {
    return null;
  }

  const { error, scope, status } = diagnostics;
  const suggestions = [];
  let message = null;

  switch (error) {
    case 'network-failure':
      message = 'לא ניתן ליצור קשר עם פונקציית ה-API של הארגון.';
      suggestions.push('ודא שהפונקציה פרוסה ופועלת בסביבת Azure Functions.');
      suggestions.push('בדוק שאין חסימה על ידי חומת אש או פרוקסי ארגוני.');
      break;
    case 'missing-org':
      message = 'לא נבחר ארגון פעיל עבור הבקשה.';
      suggestions.push('בחר מחדש ארגון פעיל ונסה שוב.');
      break;
    case 'missing-token':
      message = 'בקשת המפתחות לא כללה אסימון זיהוי.';
      suggestions.push('התחבר מחדש כדי לרענן את אסימון ה-Supabase.');
      break;
    case 'response-not-json':
      message = 'הפונקציה החזירה תשובה שאינה JSON.';
      suggestions.push('ודא ש-Content-Type מוגדר ל-application/json ושנעשה שימוש ב-json() בצד השרת.');
      break;
    case 'invalid-json':
      message = 'התגובה מהפונקציה לא ניתנת לפענוח כ-JSON תקין.';
      suggestions.push('בדוק שהתגובה אינה מכילה הערות או תוכן נוסף מעבר ל-JSON.');
      break;
    case 'missing-keys':
      message = 'התגובה לא הכילה supabase_url ו-anon_key.';
      suggestions.push('ודא שטבלת org_settings מכילה את פרטי החיבור והפונקציה מחזירה אותם.');
      break;
    default: {
      const normalized = typeof error === 'string' ? error.toLowerCase() : '';
      if (normalized.includes('missing bearer')) {
        message = 'הפונקציה סירבה לבקשה ללא כותרת Authorization.';
        suggestions.push('ודא שהמשתמש מחובר ושהפונקציה קוראת את הכותרת x-supabase-authorization.');
      } else if (normalized.includes('org not found') || normalized.includes('no access')) {
        message = 'הפונקציה לא מצאה את הארגון או שאין למשתמש הרשאה.';
        suggestions.push('בדוק שהמשתמש משויך לארגון ב-Supabase ושלטבלת org_memberships יש את הרשומות הנכונות.');
      } else {
        message = typeof error === 'string' ? error : null;
      }
      break;
    }
  }

  if (!message) {
    message = 'אירעה שגיאה בטעינת הגדרות הארגון.';
  }

  if (status && scope === 'org' && (status === 401 || status === 403)) {
    suggestions.push('ודא שהמפתח הציבורי של הארגון מעודכן והמשתמש בעל הרשאות לקרוא את הנתונים.');
  }

  return { message, suggestions };
}

function createDiagnosticsSnapshot(orgId, overrides = {}) {
  return {
    status: null,
    scope: 'org',
    endpoint: null,
    orgId: orgId || null,
    accessTokenPreview: null,
    ok: false,
    timestamp: Date.now(),
    error: null,
    body: null,
    bodyIsJson: false,
    bodyText: null,
    ...overrides,
  };
}

function extractErrorStatus(error) {
  if (!error) {
    return null;
  }
  if (typeof error.status === 'number') {
    return error.status;
  }
  if (typeof error.statusCode === 'number') {
    return error.statusCode;
  }
  if (typeof error.status === 'string') {
    const parsed = Number(error.status);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  if (typeof error.statusCode === 'string') {
    const parsed = Number(error.statusCode);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function describeVerificationError(error) {
  const status = extractErrorStatus(error);
  const code = typeof error?.code === 'string' ? error.code.trim() : '';
  const rawMessage = typeof error?.message === 'string' ? error.message.trim() : '';
  const normalizedMessage = rawMessage.toLowerCase();

  if (status === 404 || code === 'PGRST301' || normalizedMessage.includes('setup_assistant_diagnostics')) {
    return 'פונקציית setup_assistant_diagnostics לא נמצאה או שאינה זמינה. ודא שהרצת את בלוק הסכימה בסביבת Supabase.';
  }
  if (status === 401) {
    return 'אסימון Supabase חסר או פג תוקף (401). התחבר מחדש ונסה שוב.';
  }
  if (status === 403) {
    return 'למשתמש אין הרשאה להריץ את בדיקת האימות (403). בדוק שהמשתמש משויך לארגון.';
  }
  if (status && status >= 500) {
    return `שרת Supabase החזיר שגיאה בעת הרצת האימות (סטטוס ${status}).`;
  }
  if (rawMessage) {
    return rawMessage;
  }
  return 'בדיקת האימות נכשלה. נסה שוב או פנה לתמיכה.';
}

function collectVerificationDetails(error, summary) {
  const status = extractErrorStatus(error);
  const code = typeof error?.code === 'string' && error.code.trim() ? error.code.trim() : null;
  const details = [];

  const rawMessage = typeof error?.message === 'string' ? error.message.trim() : '';
  if (rawMessage && rawMessage !== summary) {
    details.push(rawMessage);
  }
  if (typeof error?.details === 'string' && error.details.trim()) {
    details.push(error.details.trim());
  }
  if (typeof error?.hint === 'string' && error.hint.trim()) {
    details.push(error.hint.trim());
  }

  return { status, code, details };
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
  const {
    activeOrg: orgActiveOrg,
    activeOrgConnection,
    activeOrgHasConnection,
    updateConnection,
    recordVerification,
    createOrganization,
  } = useOrg();
  const {
    authClient,
    dataClient,
    user,
    loading,
    activeOrg: supabaseActiveOrg,
  } = useSupabase();
  const activeOrg = orgActiveOrg ?? supabaseActiveOrg ?? null;
  const supabaseReady = !loading && Boolean(authClient) && Boolean(user);
  const [connection, setConnection] = useState({ ...INITIAL_CONNECTION_VALUES });
  const [originalConnection, setOriginalConnection] = useState({ ...INITIAL_CONNECTION_VALUES });
  const [isSavingConnection, setIsSavingConnection] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [verificationStatus, setVerificationStatus] = useState(activeOrg?.setup_completed ? 'success' : 'idle');
  const [verifyResults, setVerifyResults] = useState([]);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState('');
  const [verifyErrorInfo, setVerifyErrorInfo] = useState(null);
  const [lastVerifiedAt, setLastVerifiedAt] = useState(activeOrg?.verified_at || null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [createOrgError, setCreateOrgError] = useState('');
  const [isCreatingOrg, setIsCreatingOrg] = useState(false);
  const [connectionTest, setConnectionTest] = useState(INITIAL_CONNECTION_TEST);
  const [leavePolicyStatus, setLeavePolicyStatus] = useState(INITIAL_LEAVE_POLICY_STATUS);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [activeStep, setActiveStep] = useState(1);
  const [jwtSecret, setJwtSecret] = useState('');
  const [dedicatedKey, setDedicatedKey] = useState('');
  const [dedicatedKeyError, setDedicatedKeyError] = useState('');
  const [isSavingDedicatedKey, setIsSavingDedicatedKey] = useState(false);
  const [dedicatedKeySavedAt, setDedicatedKeySavedAt] = useState(activeOrg?.dedicated_key_saved_at || null);
  const activeOrgId = activeOrg?.id || null;

  const hasConnectionValues = Boolean(connection.supabase_url.trim() && connection.anon_key.trim());
  const hasSavedConnection = Boolean(
    activeOrgHasConnection
    && originalConnection.supabase_url
    && originalConnection.anon_key
  );
  const orgSelected = useMemo(() => Boolean(activeOrg?.id), [activeOrg?.id]);

  const handleOpenCreateDialog = () => {
    setCreateOrgError('');
    setNewOrgName('');
    setIsCreateDialogOpen(true);
  };

  const handleCreateOrg = async (event) => {
    event.preventDefault();
    if (isCreatingOrg) return;
    const trimmedName = newOrgName.trim();
    if (!trimmedName) {
      setCreateOrgError('יש להזין שם ארגון.');
      return;
    }
    setCreateOrgError('');
    setIsCreatingOrg(true);
    try {
      await createOrganization({ name: trimmedName });
      setIsCreateDialogOpen(false);
      setNewOrgName('');
    } catch (error) {
      console.error('Failed to create organization from setup assistant', error);
      const message = mapSupabaseError(error);
      setCreateOrgError(message);
      toast.error(message);
    } finally {
      setIsCreatingOrg(false);
    }
  };

  const renderCreateOrgDialog = () => (
    <Dialog
      open={isCreateDialogOpen}
      onOpenChange={(open) => {
        setIsCreateDialogOpen(open);
        if (!open) {
          setCreateOrgError('');
          setIsCreatingOrg(false);
        }
      }}
    >
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader className="text-right">
          <DialogTitle>יצירת ארגון חדש</DialogTitle>
          <DialogDescription>
            לאחר יצירת הארגון ניתן להזין כאן את פרטי ה-Supabase ולשמור אותם בהגדרות המשותפות.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleCreateOrg}>
          <div className="space-y-2 text-right">
            <Label htmlFor="setup-org-name">שם הארגון</Label>
            <Input
              id="setup-org-name"
              value={newOrgName}
              onChange={(event) => setNewOrgName(event.target.value)}
              placeholder="למשל: המרכז הקהילתי העירוני"
              autoFocus
            />
            {createOrgError ? <p className="text-xs text-red-600">{createOrgError}</p> : null}
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setIsCreateDialogOpen(false)} disabled={isCreatingOrg}>
              ביטול
            </Button>
            <Button type="submit" disabled={isCreatingOrg || !newOrgName.trim()} className="gap-2">
              {isCreatingOrg ? 'יוצר...' : 'צור ארגון'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );

  useEffect(() => {
    if (!activeOrg) {
      setConnection({ ...INITIAL_CONNECTION_VALUES });
      setOriginalConnection({ ...INITIAL_CONNECTION_VALUES });
      setLastSavedAt(null);
      setVerificationStatus('idle');
      setLastVerifiedAt(null);
      setConnectionTest(INITIAL_CONNECTION_TEST);
      setLeavePolicyStatus(INITIAL_LEAVE_POLICY_STATUS);
      setVerifyResults([]);
      setVerifyError('');
      setVerifyErrorInfo(null);
      setDedicatedKey('');
      setDedicatedKeyError('');
      setDedicatedKeySavedAt(null);
      return;
    }

    const policyLinks = Array.isArray(activeOrg.policy_links)
      ? activeOrg.policy_links
          .map((item) => {
            if (!item) return '';
            if (typeof item === 'string') return item.trim();
            if (typeof item.url === 'string') return item.url.trim();
            if (typeof item.href === 'string') return item.href.trim();
            return '';
          })
          .filter(Boolean)
      : [];

    const legalSettings = activeOrg.legal_settings || {};
    const connectionSnapshot = activeOrgConnection || {
      supabaseUrl: '',
      supabaseAnonKey: '',
      metadata: null,
      updatedAt: null,
    };

    const nextConnection = {
      supabase_url: connectionSnapshot.supabaseUrl || '',
      anon_key: connectionSnapshot.supabaseAnonKey || '',
      policy_links_text: policyLinks.join('\n'),
      legal_contact_email: (legalSettings.contact_email || legalSettings.email || '').trim(),
      legal_terms_url: (legalSettings.terms_url || legalSettings.terms || '').trim(),
      legal_privacy_url: (
        legalSettings.privacy_url
        || legalSettings.privacy
        || legalSettings.legal_info_url
        || ''
      ).trim(),
    };

    setConnection(nextConnection);
    setOriginalConnection(nextConnection);
    const updatedAt =
      activeOrg.org_settings_updated_at
      || connectionSnapshot.updatedAt
      || activeOrg.updated_at
      || null;
    setLastSavedAt(updatedAt);

    if (activeOrg.setup_completed) {
      setVerificationStatus('success');
      setLastVerifiedAt(activeOrg.verified_at || updatedAt);
    } else {
      setVerificationStatus('idle');
      setLastVerifiedAt(activeOrg.verified_at || null);
    }
    setConnectionTest(INITIAL_CONNECTION_TEST);
    setLeavePolicyStatus(INITIAL_LEAVE_POLICY_STATUS);
    setVerifyResults([]);
    setVerifyError('');
    setVerifyErrorInfo(null);
    setDedicatedKey('');
    setDedicatedKeyError('');
    setDedicatedKeySavedAt(activeOrg.dedicated_key_saved_at || null);
  }, [activeOrg, activeOrgConnection]);

  const hasUnsavedChanges = useMemo(() => {
    return (
      connection.supabase_url !== originalConnection.supabase_url
      || connection.anon_key !== originalConnection.anon_key
      || connection.policy_links_text !== originalConnection.policy_links_text
      || connection.legal_contact_email !== originalConnection.legal_contact_email
      || connection.legal_terms_url !== originalConnection.legal_terms_url
      || connection.legal_privacy_url !== originalConnection.legal_privacy_url
    );
  }, [connection, originalConnection]);

  const totalWizardSteps = WIZARD_STEPS.length;

  const hasDedicatedKeyValue = useMemo(() => Boolean(dedicatedKey.trim()), [dedicatedKey]);

  const jwtSecretToken = useMemo(() => {
    const trimmed = jwtSecret.trim();
    return trimmed || 'YOUR_SUPER_SECRET_AND_LONG_JWT_SECRET_HERE';
  }, [jwtSecret]);

  const step4SqlBlock = useMemo(
    () => SETUP_SQL_SCRIPT_STEP_4_JWT.replace('__REPLACE_WITH_JWT_SECRET__', jwtSecretToken),
    [jwtSecretToken],
  );

  const canProceedToNextStep = useMemo(() => {
    if (activeStep === 1) {
      return hasSavedConnection && !hasUnsavedChanges;
    }
    if (activeStep === 4) {
      return Boolean(jwtSecret.trim());
    }
    return true;
  }, [activeStep, hasSavedConnection, hasUnsavedChanges, jwtSecret]);

  const nextButtonLabel = useMemo(() => {
    switch (activeStep) {
      case 1:
        return 'המשך ליצירת טבלאות';
      case 2:
        return 'המשך למדיניות RLS';
      case 3:
        return 'המשך ליצירת JWT';
      case 4:
        return 'המשך לאימות ולשמירה';
      default:
        return 'המשך';
    }
  }, [activeStep]);

  const nextDisabledHint = useMemo(() => {
    if (activeStep === 1) {
      if (!hasConnectionValues) {
        return 'מלאו את כתובת ה-URL והמפתח הציבורי של Supabase.';
      }
      if (!hasSavedConnection) {
        return 'שמור את פרטי החיבור לפני המעבר לשלב הבא.';
      }
      if (hasUnsavedChanges) {
        return 'שמור את השינויים לפני המעבר לשלב הבא.';
      }
    }
    if (activeStep === 4 && !jwtSecret.trim()) {
      return 'הדביקו את ה-JWT Secret תחת Project Settings -> API -> JWT Secret כדי להמשיך.';
    }
    return '';
  }, [activeStep, hasConnectionValues, hasSavedConnection, hasUnsavedChanges, jwtSecret]);

  const renderStepProgress = () => (
    <ol className="grid gap-3 sm:grid-cols-5">
      {WIZARD_STEPS.map((step) => {
        const status = step.number < activeStep ? 'complete' : step.number === activeStep ? 'active' : 'upcoming';
        const borderClass =
          status === 'complete'
            ? 'border-emerald-200 bg-emerald-50'
            : status === 'active'
              ? 'border-blue-200 bg-blue-50'
              : 'border-slate-200 bg-white';
        const circleClass =
          status === 'complete'
            ? 'bg-emerald-600 text-white'
            : status === 'active'
              ? 'bg-blue-600 text-white'
              : 'bg-slate-200 text-slate-600';
        const titleClass =
          status === 'complete'
            ? 'text-emerald-700'
            : status === 'active'
              ? 'text-blue-700'
              : 'text-slate-600';
        const canNavigateBackward = step.number < activeStep;
        return (
          <li key={step.number}>
            <button
              type="button"
              onClick={canNavigateBackward ? () => setActiveStep(step.number) : undefined}
              disabled={!canNavigateBackward}
              className={`w-full rounded-xl border ${borderClass} p-3 text-right transition focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-60`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className={`w-9 h-9 ${circleClass} rounded-full flex items-center justify-center text-sm font-semibold`}>
                  {status === 'complete' ? (
                    <CheckCircle2 className="w-5 h-5 text-white" aria-hidden="true" />
                  ) : (
                    step.number
                  )}
                </div>
                <span className={`text-xs font-medium ${titleClass}`}>{step.title}</span>
              </div>
            </button>
          </li>
        );
      })}
    </ol>
  );

  const renderStepNavigation = () => (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Button type="button" variant="outline" onClick={handlePreviousStep} disabled={activeStep === 1} className="gap-2">
        חזרה
      </Button>
      {activeStep < totalWizardSteps ? (
        <div className="flex flex-col items-end gap-1">
          <Button
            type="button"
            onClick={handleNextStep}
            disabled={!canProceedToNextStep}
            className="gap-2"
          >
            {nextButtonLabel}
          </Button>
          {!canProceedToNextStep && nextDisabledHint ? (
            <span className="text-xs text-amber-600 text-right">{nextDisabledHint}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  const renderActiveStep = () => {
    switch (activeStep) {
      case 1:
        return (
          <StepSection
            number={1}
            title="שלב 1: חיבור ל-Supabase"
            description="הזינו את פרטי Supabase, שמרו אותם ואז המשיכו לשלב הבא."
            statusBadge={renderConnectionStatusBadge()}
          >
            <form className="space-y-6" onSubmit={handleSaveConnection}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="supabase_url">Supabase URL</Label>
                  <Input
                    id="supabase_url"
                    dir="ltr"
                    placeholder="https://xyzcompany.supabase.co"
                    value={connection.supabase_url}
                    onChange={handleConnectionChange('supabase_url')}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="anon_key">Anon Key</Label>
                  <Input
                    id="anon_key"
                    dir="ltr"
                    placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                    value={connection.anon_key}
                    onChange={handleConnectionChange('anon_key')}
                    required
                  />
                  <p className="text-xs text-slate-500">{connectionHelperText}</p>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="policy_links">קישורי מדיניות (שורה לכל קישור)</Label>
                <Textarea
                  id="policy_links"
                  dir="ltr"
                  rows={3}
                  placeholder="https://supabase.example.com/policies"
                  value={connection.policy_links_text}
                  onChange={handleConnectionChange('policy_links_text')}
                />
                <p className="text-xs text-slate-500">
                  הוסף כאן קישורים למסמכי SQL, נהלי אבטחה או הערות רלוונטיות עבור מנהלים נוספים.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="legal_contact_email">אימייל איש קשר משפטי</Label>
                  <Input
                    id="legal_contact_email"
                    type="email"
                    dir="ltr"
                    placeholder="legal@example.com"
                    value={connection.legal_contact_email}
                    onChange={handleConnectionChange('legal_contact_email')}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="legal_terms_url">קישור לתנאי שימוש</Label>
                  <Input
                    id="legal_terms_url"
                    type="url"
                    dir="ltr"
                    placeholder="https://example.com/terms"
                    value={connection.legal_terms_url}
                    onChange={handleConnectionChange('legal_terms_url')}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="legal_privacy_url">קישור למדיניות פרטיות</Label>
                  <Input
                    id="legal_privacy_url"
                    type="url"
                    dir="ltr"
                    placeholder="https://example.com/privacy"
                    value={connection.legal_privacy_url}
                    onChange={handleConnectionChange('legal_privacy_url')}
                  />
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
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleTestConnection}
                    disabled={
                      !activeOrg
                      || isTestingConnection
                      || hasUnsavedChanges
                      || !hasConnectionValues
                      || !dataClient
                      || !supabaseReady
                    }
                    className="gap-2"
                  >
                    {isTestingConnection ? (
                      <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <ShieldCheck className="w-4 h-4" aria-hidden="true" />
                    )}
                    {isTestingConnection ? 'מריץ בדיקה...' : 'בדוק חיבור שמור'}
                  </Button>
                </div>
              </div>
              {hasUnsavedChanges ? (
                <p className="text-xs text-amber-600">שמור את השינויים לפני בדיקת החיבור.</p>
              ) : null}
              {renderConnectionTestFeedback()}
              {renderConnectionDiagnostics()}
              {renderLeavePolicyStatusNotice()}
            </form>
          </StepSection>
        );
      case 2:
        return (
          <StepSection
            number={2}
            title="שלב 2: יצירת טבלאות"
            description="העתיקו והריצו את בלוק הסכימה בעורך ה-SQL של Supabase (מומלץ כבעלים)."
          >
            <div className="space-y-4">
              <CodeBlock
                title="בלוק יצירת טבלאות והרחבות"
                code={SETUP_SQL_SCRIPT_STEP_2_TABLES}
                ariaLabel="העתק את בלוק יצירת הטבלאות"
              />
              <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">
                הריצו את ה-SQL בפרויקט Supabase שלכם כדי ליצור את כל הטבלאות, ההרחבות והאינדקסים הנדרשים.
              </p>
            </div>
          </StepSection>
        );
      case 3:
        return (
          <StepSection
            number={3}
            title="שלב 3: מדיניות RLS"
            description="הפעלת RLS, יצירת המדיניות והתקנת פונקציית האבחון."
          >
            <div className="space-y-4">
              <CodeBlock
                title="בלוק RLS ומדיניות"
                code={SETUP_SQL_SCRIPT_STEP_3_POLICIES}
                ariaLabel="העתק את בלוק ה-RLS"
              />
              <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">
                הבלוק מפעיל RLS לכל הטבלאות, מגדיר מדיניות מאובטחת ומרענן את הפונקציה setup_assistant_diagnostics שתשמש בבדיקות.
              </p>
            </div>
          </StepSection>
        );
      case 4:
        return (
          <StepSection
            number={4}
            title="שלב 4: יצירת JWT ייעודי"
            description="הדביקו את ה-JWT Secret כדי שנפיק SQL עם המפתח הנכון."
          >
            <div className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="jwt_secret">Supabase JWT Secret</Label>
                <Input
                  id="jwt_secret"
                  type="password"
                  dir="ltr"
                  placeholder="YOUR_SUPER_SECRET_AND_LONG_JWT_SECRET_HERE"
                  value={jwtSecret}
                  onChange={handleJwtSecretChange}
                  onPaste={handleJwtSecretPaste}
                  autoComplete="off"
                />
                <p className="text-xs text-slate-500">
                  מצאו את הערך תחת Project Settings → API → JWT Settings → JWT Secret.
                </p>
                <p className="text-xs text-slate-500">
                  ה-SQL למטה יתעדכן אוטומטית עם הסוד שהזנתם כדי ליצור את המפתח הייעודי.
                </p>
              </div>
              <CodeBlock
                title="בלוק יצירת JWT ייעודי"
                code={step4SqlBlock}
                ariaLabel="העתק את בלוק יצירת ה-JWT הייעודי"
              />
              <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">
                הריצו את הבלוק כבעלים. הוא יוודא שהתפקיד app_user קיים ויחזיר ערך בשם "APP_DEDICATED_KEY (COPY THIS BACK TO THE APP)".
              </p>
            </div>
          </StepSection>
        );
      case 5:
        return (
          <StepSection
            number={5}
            title="שלב 5: אימות ושמירת המפתח"
            description="הריצו אימות, פענחו תקלות והחזירו את המפתח הייעודי לאפליקציה."
            statusBadge={renderStepFiveStatusBadges()}
          >
            <div className="space-y-8">
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-slate-600">
                    הבדיקה משתמשת בפונקציית setup_assistant_diagnostics ומחזירה SQL משלים במידה שחסרות פעולות. אין צורך במפתחות שירות – הבדיקה רצה עם המפתח הציבורי (anon) בלבד.
                  </p>
                  <div className="flex items-center gap-3">
                    {lastVerifiedAt ? (
                      <span className="text-xs text-slate-500">בדיקה אחרונה: {formatDateTime(lastVerifiedAt)}</span>
                    ) : null}
                    <Button
                      type="button"
                      onClick={handleVerify}
                      disabled={
                        isVerifying
                        || !hasSavedConnection
                        || !orgSelected
                        || hasUnsavedChanges
                        || !dataClient
                        || !supabaseReady
                      }
                      className="gap-2"
                    >
                      {isVerifying ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
                      {isVerifying ? 'מריץ בדיקות...' : 'הרץ אימות'}
                    </Button>
                  </div>
                </div>
                {hasUnsavedChanges ? (
                  <p className="text-xs text-amber-600">שמור את פרטי החיבור לפני הרצת האימות.</p>
                ) : null}
                {verifyError ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm p-3 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 mt-0.5" aria-hidden="true" />
                    <div className="space-y-2">
                      <span className="block">{verifyError}</span>
                      {verifyErrorInfo ? (
                        <ul className="list-disc pr-4 text-xs text-red-600 space-y-1">
                          {verifyErrorInfo.status !== null && verifyErrorInfo.status !== undefined ? (
                            <li>סטטוס HTTP: {verifyErrorInfo.status}</li>
                          ) : null}
                          {verifyErrorInfo.code ? <li>קוד Supabase: {verifyErrorInfo.code}</li> : null}
                          {Array.isArray(verifyErrorInfo.details)
                            ? verifyErrorInfo.details.map((detail, index) => (
                                <li key={`${detail}-${index}`}>{detail}</li>
                              ))
                            : null}
                        </ul>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                {verifyResults.length === 0 && !verifyError && !isVerifying ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-500 p-3">
                    עדיין לא הרצנו אימות בפרויקט הזה. לאחר הרצת בלוקי ה-SQL, לחץ על "הרץ אימות" כדי לוודא שהכל מוכן.
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
                                {hasFullPolicies ? 'כל ארבע המדיניות קיימות.' : `מדיניות חסרות: ${result.missing_policies.join(', ')}`}
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
              <div className="space-y-4">
                <p className="text-sm text-slate-600">
                  לאחר שה-SQL מהשלב הקודם יצר את המפתח "APP_DEDICATED_KEY", הדביקו אותו כאן כדי שנשמור אותו מוצפן.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="dedicated_key">APP_DEDICATED_KEY</Label>
                  <Textarea
                    id="dedicated_key"
                    dir="ltr"
                    rows={3}
                    value={dedicatedKey}
                    onChange={handleDedicatedKeyChange}
                    onPaste={handleDedicatedKeyPaste}
                    placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                  />
                  <p className="text-xs text-slate-400">(טיפ: בחרו את הערך בעורך ה-SQL, העתיקו והדביקו כאן.)</p>
                </div>
                {dedicatedKeyError ? <p className="text-xs text-red-600">{dedicatedKeyError}</p> : null}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {dedicatedKeySavedAt ? (
                    <span className="text-xs text-slate-500">נשמר לאחרונה: {formatDateTime(dedicatedKeySavedAt)}</span>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleDedicatedKeyClipboardPaste}
                      disabled={isSavingDedicatedKey}
                      className="gap-2"
                    >
                      <ClipboardCopy className="w-4 h-4" aria-hidden="true" />
                      הדבק מהמחשב
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={handleClearDedicatedKey}
                      disabled={isSavingDedicatedKey || (!hasDedicatedKeyValue && !dedicatedKeyError)}
                      className="gap-2"
                    >
                      נקה
                    </Button>
                    <Button
                      type="button"
                      onClick={handleSaveDedicatedKey}
                      disabled={!hasDedicatedKeyValue || isSavingDedicatedKey || !activeOrg || !supabaseReady}
                      className="gap-2"
                    >
                      {isSavingDedicatedKey ? (
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                      ) : null}
                      {isSavingDedicatedKey ? 'שומר...' : 'שמור מפתח'}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </StepSection>
        );
      default:
        return null;
    }
  };

  useEffect(() => {
    let cancelled = false;

    if (!activeOrgId || !dataClient) {
      setLeavePolicyStatus(INITIAL_LEAVE_POLICY_STATUS);
      return () => {
        cancelled = true;
      };
    }

    setLeavePolicyStatus((prev) => ({
      state: 'loading',
      policy: prev.policy,
      error: null,
      fetchedAt: prev.fetchedAt,
    }));

    const loadLeavePolicyStatus = async () => {
      try {
        const { value } = await fetchLeavePolicySettings(dataClient);
        if (cancelled) {
          return;
        }
        setLeavePolicyStatus({
          state: value ? 'configured' : 'missing',
          policy: value,
          error: null,
          fetchedAt: new Date().toISOString(),
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        setLeavePolicyStatus({
          state: 'error',
          policy: null,
          error: asError(error),
          fetchedAt: new Date().toISOString(),
        });
      }
    };

    loadLeavePolicyStatus();

    return () => {
      cancelled = true;
    };
  }, [activeOrgId, dataClient]);

  const handleConnectionChange = (field) => (event) => {
    const value = event.target.value;
    setConnection((prev) => ({ ...prev, [field]: value }));

    const isSensitiveField = field === 'supabase_url' || field === 'anon_key';
    if (!isSensitiveField) {
      return;
    }

    const originalValue = originalConnection[field] || '';
    const nextValue = typeof value === 'string' ? value : '';

    if (nextValue === originalValue) {
      return;
    }

    setLeavePolicyStatus(INITIAL_LEAVE_POLICY_STATUS);
    setConnectionTest(INITIAL_CONNECTION_TEST);
  };

  const handleNextStep = () => {
    if (activeStep >= totalWizardSteps) {
      return;
    }
    setActiveStep((prev) => Math.min(prev + 1, totalWizardSteps));
  };

  const handlePreviousStep = () => {
    if (activeStep <= 1) {
      return;
    }
    setActiveStep((prev) => Math.max(prev - 1, 1));
  };

  const handleJwtSecretChange = (event) => {
    setJwtSecret(event.target.value || '');
  };

  const handleJwtSecretPaste = (event) => {
    if (!event?.clipboardData) {
      return;
    }
    event.preventDefault();
    const pasted = event.clipboardData.getData('text') || '';
    setJwtSecret(pasted.trim());
  };

  const handleDedicatedKeyPaste = (event) => {
    if (!event?.clipboardData) {
      return;
    }
    event.preventDefault();
    const pasted = event.clipboardData.getData('text') || '';
    if (!pasted) {
      return;
    }
    setDedicatedKey(pasted.trim());
    setDedicatedKeyError('');
  };

  const handleDedicatedKeyChange = (event) => {
    setDedicatedKey(event.target.value || '');
    setDedicatedKeyError('');
  };

  const handleDedicatedKeyClipboardPaste = async () => {
    if (!navigator?.clipboard?.readText) {
      toast.error('הדבקה אוטומטית אינה זמינה בדפדפן זה. השתמש ב-Ctrl+V להדבקה ידנית.');
      return;
    }

    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        toast.error('הלוח ריק. העתק את המפתח מה-SQL ונסה שוב.');
        return;
      }
      setDedicatedKey(text.trim());
      setDedicatedKeyError('');
      toast.success('המפתח הועתק מהלוח.');
    } catch (error) {
      console.error('Failed to read dedicated key from clipboard', error);
      toast.error('לא ניתן לקרוא את הלוח. אפשר הרשאות הדבקה ונסה שוב.');
    }
  };

  const handleClearDedicatedKey = () => {
    setDedicatedKey('');
    setDedicatedKeyError('');
  };

  const handleSaveDedicatedKey = async () => {
    if (!activeOrg || isSavingDedicatedKey) {
      return;
    }

    const trimmedKey = dedicatedKey.trim();
    if (!trimmedKey) {
      const message = 'יש להדביק את המפתח הייעודי לפני השמירה.';
      setDedicatedKeyError(message);
      toast.error(message);
      return;
    }

    if (!authClient) {
      const message = 'לקוח Supabase אינו זמין כרגע. רענן את הדף ונסה שוב.';
      setDedicatedKeyError(message);
      toast.error(message);
      return;
    }

    setIsSavingDedicatedKey(true);
    setDedicatedKeyError('');

    try {
      const { data: sessionData, error: sessionError } = await authClient.auth.getSession();
      if (sessionError) {
        throw sessionError;
      }

      const token = resolveControlAccessToken(sessionData?.session);
      const bearer = `Bearer ${token}`;
      const response = await fetch('/api/save-org-credentials', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: bearer,
          Authorization: bearer,
          'x-supabase-authorization': bearer,
          'X-Supabase-Authorization': bearer,
        },
        body: JSON.stringify({
          org_id: activeOrg.id,
          dedicated_key: trimmedKey,
        }),
      });

      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      if (!response.ok) {
        const message = typeof payload?.message === 'string' && payload.message
          ? payload.message
          : 'שמירת המפתח הייעודי נכשלה. בדוק את ההרשאות ונסה שוב.';
        throw new Error(message);
      }

      const savedAt = typeof payload?.saved_at === 'string' && payload.saved_at
        ? payload.saved_at
        : new Date().toISOString();

      setDedicatedKey('');
      setDedicatedKeySavedAt(savedAt);
      toast.success('המפתח הייעודי נשמר בהצלחה.');
    } catch (error) {
      console.error('Failed to save dedicated key for organization', error);
      const message = typeof error?.message === 'string' && error.message
        ? error.message
        : 'שמירת המפתח הייעודי נכשלה. בדוק את ההרשאות ונסה שוב.';
      setDedicatedKeyError(message);
      toast.error(message);
    } finally {
      setIsSavingDedicatedKey(false);
    }
  };

  const extractSupabaseError = (error) => {
    if (!error || typeof error !== 'object') {
      return null;
    }

    const message = typeof error.message === 'string' ? error.message : '';
    const code = typeof error.code === 'string' ? error.code : null;
    const hint = typeof error.hint === 'string' ? error.hint : null;
    const rawDetails = error.details;
    const details = Array.isArray(rawDetails)
      ? rawDetails.map((detail) => String(detail)).filter(Boolean)
      : typeof rawDetails === 'string'
        ? rawDetails.trim()
          ? [rawDetails.trim()]
          : []
        : rawDetails && typeof rawDetails === 'object'
          ? [JSON.stringify(rawDetails)]
          : [];

    if (!message && !code && !hint && details.length === 0) {
      return null;
    }

    return {
      message,
      code,
      hint,
      details,
    };
  };

  const handleSaveConnection = async (event) => {
    event.preventDefault();
    if (!activeOrg || !hasConnectionValues || isSavingConnection) return;

    setIsSavingConnection(true);
    try {
      const now = new Date().toISOString();
      const policyLinks = connection.policy_links_text
        .split(/\n+/)
        .map((item) => item.trim())
        .filter(Boolean);

      const legalSettings = {
        contact_email: connection.legal_contact_email.trim() || null,
        terms_url: connection.legal_terms_url.trim() || null,
        privacy_url: connection.legal_privacy_url.trim() || null,
      };

      await updateConnection(activeOrg.id, {
        supabaseUrl: connection.supabase_url.trim(),
        supabaseAnonKey: connection.anon_key.trim(),
        policyLinks,
        legalSettings,
      });

      setOriginalConnection({ ...connection });
      setLastSavedAt(now);
      setConnectionTest(INITIAL_CONNECTION_TEST);
      setLeavePolicyStatus(INITIAL_LEAVE_POLICY_STATUS);
      toast.success('חיבור ה-Supabase נשמר בהצלחה.');
    } catch (error) {
      console.error('Failed to save Supabase connection details', error);
      toast.error('שמירת פרטי החיבור נכשלה. בדוק את ההרשאות ונסה שוב.');
    } finally {
      setIsSavingConnection(false);
    }
  };

  const handleTestConnection = async () => {
    if (!activeOrg || isTestingConnection) return;
    if (!dataClient) {
      toast.error('חיבור Supabase עדיין נטען. נסו שוב בעוד רגע.');
      return;
    }
    if (hasUnsavedChanges) {
      toast.error('שמור את פרטי החיבור לפני בדיקת הקישוריות.');
      return;
    }

    setIsTestingConnection(true);
    setConnectionTest({ ...INITIAL_CONNECTION_TEST, status: 'running' });
    setLeavePolicyStatus({
      state: 'loading',
      policy: null,
      error: null,
      fetchedAt: null,
    });

    try {
      const verification = await verifyOrgConnection(dataClient);
      const leavePolicyValue = verification?.settingsValue ?? null;
      const policyState = leavePolicyValue ? 'configured' : 'missing';
      const now = new Date().toISOString();
      const diagnostics = createDiagnosticsSnapshot(activeOrg.id, {
        status: 200,
        ok: true,
      });

      setLeavePolicyStatus({
        state: policyState,
        policy: leavePolicyValue,
        error: null,
        fetchedAt: now,
      });

      setConnectionTest({
        status: 'success',
        message:
          policyState === 'configured'
            ? 'חיבור Supabase אומת בהצלחה ונמצאה מדיניות leave_policy פעילה בטבלת Settings.'
            : 'חיבור Supabase אומת בהצלחה. טבלת Settings נגישה אך leave_policy טרם הוגדרה – ניתן להמשיך עם ברירות המחדל עד שתגדרו מדיניות.',
        diagnostics,
        supabaseError: null,
        completedAt: now,
      });
      toast.success('חיבור הארגון אומת בהצלחה.');
    } catch (error) {
      console.error('Setup assistant connection test failed', error);
      const supabaseErrorInfo = extractSupabaseError(error);
      const normalizedError = asError(error);
      const fallbackMessage = supabaseErrorInfo?.message
        || (typeof normalizedError?.message === 'string' && normalizedError.message.trim()
          ? normalizedError.message
          : 'בדיקת החיבור נכשלה. ודא שהפונקציה /api/org/{orgId}/keys זמינה ומחזירה JSON תקין.');
      const diagnostics = createDiagnosticsSnapshot(activeOrg?.id ?? null, {
        ok: false,
        error: fallbackMessage,
      });

      setConnectionTest({
        status: 'error',
        message: fallbackMessage,
        diagnostics,
        supabaseError: supabaseErrorInfo,
        completedAt: new Date().toISOString(),
      });
      setLeavePolicyStatus({
        state: 'error',
        policy: null,
        error: normalizedError,
        fetchedAt: new Date().toISOString(),
      });
      toast.error(fallbackMessage);
    } finally {
      setIsTestingConnection(false);
    }
  };

  const markSetupComplete = async (verifiedAt) => {
    if (!activeOrg) return;
    try {
      await recordVerification(activeOrg.id, verifiedAt);
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
    if (!activeOrg) return;
    if (!hasSavedConnection) {
      toast.error('קודם שמור את כתובת ה-URL והמפתח לפני הרצת האימות.');
      return;
    }
    if (!orgSelected) {
      toast.error('בחר ארגון פעיל לפני הרצת האימות.');
      return;
    }
    if (!supabaseReady) {
      toast.error('חיבור Supabase עדיין נטען. נסו שוב בעוד רגע.');
      return;
    }
    if (!dataClient) {
      toast.error('חיבור Supabase עדיין נטען. נסו שוב בעוד רגע.');
      return;
    }
    setIsVerifying(true);
    setVerifyError('');
    setVerifyErrorInfo(null);
    setVerifyResults([]);
    setVerificationStatus('running');

    try {
      const { data, error } = await dataClient.rpc('setup_assistant_diagnostics');

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
      const summary = describeVerificationError(error);
      const details = collectVerificationDetails(error, summary);
      setVerifyError(summary);
      setVerifyErrorInfo(details);
      toast.error(summary);
    } finally {
      setIsVerifying(false);
    }
  };

  const renderConnectionTestFeedback = () => {
    if (connectionTest.status === 'idle') {
      return null;
    }

    if (connectionTest.status === 'running') {
      return (
        <div className="rounded-xl border border-blue-200 bg-blue-50 text-blue-700 text-sm p-3 flex items-start gap-2">
          <Loader2 className="w-4 h-4 mt-0.5 animate-spin" aria-hidden="true" />
          <span>בודק את החיבור השמור מול פונקציית ה-API של הארגון...</span>
        </div>
      );
    }

    if (connectionTest.status === 'success') {
      return (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 text-sm p-3 flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 mt-0.5" aria-hidden="true" />
          <div className="space-y-1">
            <span>{connectionTest.message || 'חיבור Supabase אומת בהצלחה.'}</span>
            {connectionTest.completedAt ? (
              <span className="block text-xs text-emerald-600">
                בוצע: {formatDateTime(connectionTest.completedAt)}
              </span>
            ) : null}
          </div>
        </div>
      );
    }

    if (connectionTest.status === 'error') {
      return (
        <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm p-3 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5" aria-hidden="true" />
          <div className="space-y-1">
            <span>{connectionTest.message || 'בדיקת החיבור נכשלה.'}</span>
            {connectionTest.completedAt ? (
              <span className="block text-xs text-red-600">
                בוצע: {formatDateTime(connectionTest.completedAt)}
              </span>
            ) : null}
          </div>
        </div>
      );
    }

    return null;
  };

  const renderConnectionDiagnostics = () => {
    if (!connectionTest.diagnostics || connectionTest.status === 'running') {
      return null;
    }

    const diagnostics = connectionTest.diagnostics;
    const rows = [
      { label: 'סטטוס HTTP', value: diagnostics.status ?? '—' },
      { label: 'טווח', value: diagnostics.scope === 'org' ? 'ארגון' : 'אפליקציה' },
      ...(diagnostics.endpoint ? [{ label: 'מסלול', value: diagnostics.endpoint }] : []),
      { label: 'מזהה ארגון', value: diagnostics.orgId || '—' },
      { label: 'אסימון', value: diagnostics.accessTokenPreview || '—' },
      { label: 'מצב', value: diagnostics.ok ? 'הצלחה' : 'שגיאה' },
      { label: 'זמן', value: formatDiagnosticsTimestamp(diagnostics.timestamp) || '—' },
    ];

    const interpretation = interpretDiagnostics(diagnostics);
    const supabaseError = connectionTest.supabaseError;
    const rawBodyText = typeof diagnostics.bodyText === 'string' ? diagnostics.bodyText : '';
    const hasRawBodyText = Boolean(rawBodyText.trim());
    const shouldShowRawError = diagnostics.error
      && (!interpretation || (interpretation && interpretation.message !== diagnostics.error));

    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-600 p-3 space-y-2">
        <div className="flex flex-wrap gap-4">
          {rows.map((row) => (
            <div key={row.label} className="flex gap-1">
              <span className="font-medium">{row.label}:</span>
              <span>{row.value}</span>
            </div>
          ))}
        </div>
        {interpretation ? (
          <div className="space-y-2">
            <p className="text-sm text-slate-700 font-medium">פענוח השגיאה</p>
            <p className="text-xs sm:text-sm text-slate-600">{interpretation.message}</p>
            {interpretation.suggestions.length ? (
              <ul className="list-disc pr-4 text-xs text-slate-500 space-y-1">
                {interpretation.suggestions.map((suggestion, index) => (
                  <li key={`${suggestion}-${index}`}>{suggestion}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {supabaseError ? (
          <div className="space-y-2">
            <p className="text-sm text-slate-700 font-medium">שגיאת Supabase</p>
            {supabaseError.message ? (
              <p className="text-xs sm:text-sm text-slate-600">{supabaseError.message}</p>
            ) : null}
            {(supabaseError.code || supabaseError.hint) ? (
              <div className="flex flex-wrap gap-4">
                {supabaseError.code ? (
                  <div className="flex gap-1">
                    <span className="font-medium">קוד:</span>
                    <span>{supabaseError.code}</span>
                  </div>
                ) : null}
                {supabaseError.hint ? (
                  <div className="flex gap-1">
                    <span className="font-medium">רמז:</span>
                    <span>{supabaseError.hint}</span>
                  </div>
                ) : null}
              </div>
            ) : null}
            {Array.isArray(supabaseError.details) && supabaseError.details.length ? (
              <ul className="list-disc pr-4 text-xs text-slate-500 space-y-1">
                {supabaseError.details.map((detail, index) => (
                  <li key={`${detail}-${index}`}>{detail}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {shouldShowRawError ? (
          <p className="text-red-600">הודעת שרת: {diagnostics.error}</p>
        ) : null}
        {diagnostics.body && diagnostics.bodyIsJson ? (
          <pre
            dir="ltr"
            className="bg-white border border-slate-200 rounded-lg p-3 text-[11px] leading-relaxed overflow-x-auto text-slate-700"
          >
            {JSON.stringify(maskDiagnosticsPayload(diagnostics.body), null, 2)}
          </pre>
        ) : null}
        {hasRawBodyText && !diagnostics.bodyIsJson ? (
          <pre
            dir="ltr"
            className="bg-white border border-slate-200 rounded-lg p-3 text-[11px] leading-relaxed overflow-x-auto text-slate-700"
          >
            {maskDiagnosticsText(rawBodyText)}
          </pre>
        ) : null}
      </div>
    );
  };

  const renderLeavePolicyStatusNotice = () => {
    if (leavePolicyStatus.state === 'idle') {
      return null;
    }

    if (leavePolicyStatus.state === 'loading') {
      return (
        <div className="rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-600 p-3 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          <span>טוען את סטטוס leave_policy מטבלת Settings...</span>
        </div>
      );
    }

    if (leavePolicyStatus.state === 'configured') {
      return (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 text-xs text-emerald-700 p-3">
          נמצאה מדיניות leave_policy בטבלת Settings. ניתן לערוך אותה במסך ההגדרות לאחר סיום האשף.
        </div>
      );
    }

    if (leavePolicyStatus.state === 'missing') {
      return (
        <div className="rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-700 p-3">
          טבלת Settings נגישה אך אינה מכילה ערך leave_policy. האפליקציה תשתמש בערכי ברירת המחדל עד שתשמרו מדיניות במסך ההגדרות.
        </div>
      );
    }

    if (leavePolicyStatus.state === 'error') {
      const message = leavePolicyStatus.error?.message || 'שגיאה בקריאת leave_policy.';
      return (
        <div className="rounded-xl border border-red-200 bg-red-50 text-xs text-red-700 p-3">
          <span>שגיאה בטעינת leave_policy: {message}</span>
        </div>
      );
    }

    return null;
  };

  const renderConnectionStatusBadge = () => {
    if (!activeOrg) {
      return (
        <Badge className="gap-1 bg-slate-100 text-slate-600 border border-slate-200">
          <AlertCircle className="w-4 h-4" aria-hidden="true" />
          <span>בחר ארגון</span>
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
        <span>נדרש חיבור</span>
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

  const renderDedicatedKeyStatusBadge = () => {
    if (isSavingDedicatedKey) {
      return (
        <Badge className="gap-1 bg-slate-100 text-slate-600 border border-slate-200">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          <span>שומר מפתח</span>
        </Badge>
      );
    }

    if (dedicatedKeySavedAt) {
      return (
        <Badge className="gap-1 bg-emerald-100 text-emerald-700 border border-emerald-200">
          <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
          <span>מפתח שמור</span>
        </Badge>
      );
    }

    if (hasDedicatedKeyValue) {
      return (
        <Badge className="gap-1 bg-amber-100 text-amber-800 border border-amber-200">
          <AlertCircle className="w-4 h-4" aria-hidden="true" />
          <span>מוכן לשמירה</span>
        </Badge>
      );
    }

    return (
      <Badge className="gap-1 bg-slate-100 text-slate-600 border border-slate-200">
        <AlertCircle className="w-4 h-4" aria-hidden="true" />
        <span>נדרש מפתח</span>
      </Badge>
    );
  };

  const renderStepFiveStatusBadges = () => {
    const badges = [];
    const verificationBadge = renderVerificationStatusBadge();
    if (verificationBadge) {
      badges.push({ key: 'verification', node: verificationBadge });
    }
    const dedicatedBadge = renderDedicatedKeyStatusBadge();
    if (dedicatedBadge) {
      badges.push({ key: 'dedicated', node: dedicatedBadge });
    }
    if (!badges.length) {
      return null;
    }
    return (
      <div className="flex flex-wrap gap-2">
        {badges.map((badge) => (
          <React.Fragment key={badge.key}>{badge.node}</React.Fragment>
        ))}
      </div>
    );
  };

  const connectionHelperText = hasSavedConnection
    ? 'ניתן לעדכן את הפרטים בכל עת – הם נשמרים בהגדרות הארגון.'
    : 'נשמור עבורך את הכתובת והמפתח בחשבון הארגון כדי שכל המנהלים יוכלו להמשיך את העבודה.';

  if (!activeOrg || (activeOrgHasConnection && !dataClient)) {
    return <div>Loading organization data...</div>;
  }

  return (
    <>
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
            התקדמו שלב-אחר-שלב: חיבור Supabase, יצירת סכימה, הפעלת מדיניות RLS, הפקת JWT ייעודי ולבסוף אימות ושמירה. בכל שלב תמצאו הוראות מדויקות וכפתורי העתקה מהירים.
          </p>
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500 mt-3">
            <span>ההגדרות נשמרות עבור: {activeOrg?.name || 'ארגון ללא שם'}</span>
            <Button variant="outline" size="sm" onClick={handleOpenCreateDialog} className="gap-2">
              <Building2 className="w-4 h-4" aria-hidden="true" />
              צור ארגון חדש
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="space-y-10">
            {renderStepProgress()}
            {renderActiveStep()}
            {renderStepNavigation()}
          </div>
        </CardContent>
      </Card>
      {renderCreateOrgDialog()}
    </>
  );
}
