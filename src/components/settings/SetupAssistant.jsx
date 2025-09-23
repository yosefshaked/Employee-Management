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
import { useOrg } from '@/org/OrgContext.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { mapSupabaseError } from '@/org/errors.js';
import { SECURE_API_WORKER_SOURCE } from '@/lib/edge-function-code.js';
import { JWT_SECRET_PLACEHOLDER, buildFullSetupSql } from '@/lib/setup-sql.js';
import { Building2, ClipboardCopy, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

const INITIAL_CONNECTION_VALUES = {
  supabase_url: '',
  anon_key: '',
};

const WIZARD_STEPS = [
  { number: 1, title: 'Step 1: Connect to Supabase' },
  { number: 2, title: 'Step 2: Deploy Secure Worker' },
  { number: 3, title: 'Step 3: Run Setup SQL & Generate Key' },
  { number: 4, title: 'Step 4: Save Dedicated Key' },
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

function CopyButton({ text, ariaLabel, label = 'העתק' }) {
  const [state, setState] = useState('idle');

  const handleCopy = async () => {
    try {
      if (!navigator?.clipboard?.writeText) {
        toast.error('הדפדפן אינו תומך בהעתקה אוטומטית. העתיקו ידנית.');
        return;
      }
      await navigator.clipboard.writeText(text);
      setState('copied');
      toast.success('הטקסט הועתק ללוח.');
      setTimeout(() => setState('idle'), 2000);
    } catch (error) {
      console.error('Failed to copy text', error);
      toast.error('ההעתקה נכשלה. נסו שוב.');
    }
  };

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
      {state === 'copied' ? 'הועתק!' : label}
    </Button>
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
    updateConnection,
    createOrganization,
  } = useOrg();
  const {
    authClient,
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
  const [activeStep, setActiveStep] = useState(1);
  const [jwtSecret, setJwtSecret] = useState('');
  const [dedicatedKey, setDedicatedKey] = useState('');
  const [dedicatedKeyError, setDedicatedKeyError] = useState('');
  const [isSavingDedicatedKey, setIsSavingDedicatedKey] = useState(false);
  const [dedicatedKeySavedAt, setDedicatedKeySavedAt] = useState(activeOrg?.dedicated_key_saved_at || null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [createOrgError, setCreateOrgError] = useState('');
  const [isCreatingOrg, setIsCreatingOrg] = useState(false);

  const hasConnectionValues = useMemo(
    () => Boolean(connection.supabase_url.trim() && connection.anon_key.trim()),
    [connection],
  );
  const hasSavedConnection = useMemo(
    () => Boolean(originalConnection.supabase_url.trim() && originalConnection.anon_key.trim()),
    [originalConnection],
  );
  const hasUnsavedChanges = useMemo(
    () => connection.supabase_url !== originalConnection.supabase_url
      || connection.anon_key !== originalConnection.anon_key,
    [connection, originalConnection],
  );
  const totalWizardSteps = WIZARD_STEPS.length;
  const fullSqlScript = useMemo(() => buildFullSetupSql(jwtSecret), [jwtSecret]);
  const onboardingComplete = hasSavedConnection && Boolean(dedicatedKeySavedAt);

  useEffect(() => {
    if (!activeOrg) {
      setConnection({ ...INITIAL_CONNECTION_VALUES });
      setOriginalConnection({ ...INITIAL_CONNECTION_VALUES });
      setLastSavedAt(null);
      setActiveStep(1);
      setJwtSecret('');
      setDedicatedKey('');
      setDedicatedKeyError('');
      setDedicatedKeySavedAt(null);
      return;
    }

    const snapshot = activeOrgConnection || {
      supabaseUrl: '',
      supabaseAnonKey: '',
      updatedAt: null,
    };

    const nextConnection = {
      supabase_url: snapshot.supabaseUrl || '',
      anon_key: snapshot.supabaseAnonKey || '',
    };

    setConnection(nextConnection);
    setOriginalConnection(nextConnection);
    const updatedAt = activeOrg.org_settings_updated_at
      || snapshot.updatedAt
      || activeOrg.updated_at
      || null;
    setLastSavedAt(updatedAt);
    setActiveStep(1);
    setJwtSecret('');
    setDedicatedKey('');
    setDedicatedKeyError('');
    setDedicatedKeySavedAt(activeOrg.dedicated_key_saved_at || null);
  }, [activeOrg, activeOrgConnection]);

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
    setIsCreatingOrg(true);
    setCreateOrgError('');
    try {
      await createOrganization({ name: trimmedName });
      toast.success('הארגון נוצר בהצלחה.');
      setIsCreateDialogOpen(false);
      setNewOrgName('');
    } catch (error) {
      console.error('Failed to create organization', error);
      setCreateOrgError('יצירת הארגון נכשלה. נסו שם אחר או בדקו את ההרשאות.');
    } finally {
      setIsCreatingOrg(false);
    }
  };

  const handleConnectionChange = (field) => (event) => {
    const value = event.target.value;
    setConnection((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveConnection = async (event) => {
    event.preventDefault();
    if (!activeOrg || !hasConnectionValues || isSavingConnection) {
      return;
    }

    setIsSavingConnection(true);
    try {
      const now = new Date().toISOString();
      await updateConnection(activeOrg.id, {
        supabaseUrl: connection.supabase_url.trim(),
        supabaseAnonKey: connection.anon_key.trim(),
        policyLinks: [],
        legalSettings: {},
      });
      setOriginalConnection({ ...connection });
      setLastSavedAt(now);
      toast.success('פרטי ה-Supabase נשמרו בהצלחה.');
    } catch (error) {
      console.error('Failed to save Supabase connection details', error);
      toast.error('שמירת פרטי החיבור נכשלה. בדוק את ההרשאות ונסה שוב.');
    } finally {
      setIsSavingConnection(false);
    }
  };

  const handlePasteDedicatedKey = async () => {
    try {
      if (!navigator?.clipboard?.readText) {
        toast.error('הדפדפן אינו מאפשר קריאה מהלוח. העתיקו ידנית.');
        return;
      }
      const text = await navigator.clipboard.readText();
      if (!text) {
        toast.error('הלוח ריק. העתקו את המפתח ונסו שוב.');
        return;
      }
      setDedicatedKey(text.trim());
      setDedicatedKeyError('');
      toast.success('המפתח הועתק מהלוח.');
    } catch (error) {
      console.error('Failed to read dedicated key from clipboard', error);
      toast.error('לא ניתן לקרוא את הלוח. אפשרו הרשאות הדבקה ונסו שוב.');
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
      const message = 'יש להדביק את ה-APP_DEDICATED_KEY לפני השמירה.';
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

      const response = await authenticatedFetch('save-org-credentials', {
        method: 'POST',
        body: {
          org_id: activeOrg.id,
          dedicated_key: trimmedKey,
        },
        session: sessionData?.session,
      });

      const savedAt = typeof response?.saved_at === 'string' && response.saved_at
        ? response.saved_at
        : new Date().toISOString();

      setDedicatedKey('');
      setDedicatedKeySavedAt(savedAt);
      toast.success('מפתח ה-APP נשמר בהצלחה. הפרוקסי יוכל כעת לקרוא לפונקציה המאובטחת.');
    } catch (error) {
      console.error('Failed to save dedicated key', error);
      const message = mapSupabaseError(error) || 'שמירת המפתח נכשלה. בדוק את החיבור ונסה שוב.';
      setDedicatedKeyError(message);
      toast.error(message);
    } finally {
      setIsSavingDedicatedKey(false);
    }
  };

  const canProceedToNextStep = useMemo(() => {
    if (activeStep === 1) {
      return hasConnectionValues && hasSavedConnection && !hasUnsavedChanges;
    }
    if (activeStep === 3) {
      return Boolean(jwtSecret.trim());
    }
    return true;
  }, [activeStep, hasConnectionValues, hasSavedConnection, hasUnsavedChanges, jwtSecret]);

  const nextDisabledHint = useMemo(() => {
    if (activeStep === 1) {
      if (!hasConnectionValues) {
        return 'מלאו את כתובת ה-URL והמפתח הציבורי של Supabase.';
      }
      if (hasUnsavedChanges) {
        return 'שמרו את פרטי החיבור לפני מעבר לשלב הבא.';
      }
      if (!hasSavedConnection) {
        return 'שמרו את פרטי החיבור לפני מעבר לשלב הבא.';
      }
    }
    if (activeStep === 3 && !jwtSecret.trim()) {
      return 'הדביקו את ה-JWT Secret כדי לעדכן את הסקריפט.';
    }
    return '';
  }, [activeStep, hasConnectionValues, hasUnsavedChanges, hasSavedConnection, jwtSecret]);

  const handleNext = () => {
    setActiveStep((prev) => Math.min(prev + 1, totalWizardSteps));
  };

  const handlePrev = () => {
    setActiveStep((prev) => Math.max(prev - 1, 1));
  };

  const renderConnectionStatusBadge = () => {
    if (isSavingConnection) {
      return (
        <Badge className="gap-1 bg-slate-100 text-slate-600 border border-slate-200">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          <span>שומר חיבור</span>
        </Badge>
      );
    }

    if (hasSavedConnection && !hasUnsavedChanges) {
      return (
        <Badge className="gap-1 bg-emerald-100 text-emerald-700 border border-emerald-200">
          <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
          <span>החיבור נשמר</span>
        </Badge>
      );
    }

    if (hasUnsavedChanges) {
      return (
        <Badge className="gap-1 bg-amber-100 text-amber-800 border border-amber-200">
          <AlertCircle className="w-4 h-4" aria-hidden="true" />
          <span>יש שינויים שלא נשמרו</span>
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
          <span>המפתח נשמר</span>
        </Badge>
      );
    }

    if (dedicatedKey.trim()) {
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
        <span>נדרש מפתח ייעודי</span>
      </Badge>
    );
  };

  const renderStepProgress = () => (
    <ol className="grid gap-4 md:grid-cols-4">
      {WIZARD_STEPS.map((step) => {
        const isActive = activeStep === step.number;
        const isCompleted = activeStep > step.number;
        const circleClass = isActive
          ? 'bg-blue-600 text-white border-blue-600'
          : isCompleted
            ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
            : 'bg-slate-100 text-slate-600 border-slate-200';
        return (
          <li key={step.number} className="flex items-center gap-3">
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-full border text-sm font-semibold ${circleClass}`}
            >
              {isCompleted ? <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> : step.number}
            </div>
            <span className={`text-sm font-medium ${isActive ? 'text-slate-900' : 'text-slate-600'}`}>
              {step.title}
            </span>
          </li>
        );
      })}
    </ol>
  );

  const renderStepNavigation = () => (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" onClick={handlePrev} disabled={activeStep === 1}>
          חזרה
        </Button>
        {activeStep < totalWizardSteps ? (
          <Button type="button" onClick={handleNext} disabled={!canProceedToNextStep} className="gap-2">
            {activeStep === totalWizardSteps - 1 ? 'עבור לשלב הסופי' : 'המשך'}
          </Button>
        ) : null}
      </div>
      {activeStep < totalWizardSteps && nextDisabledHint ? (
        <p className="text-xs text-amber-600">{nextDisabledHint}</p>
      ) : null}
    </div>
  );

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

  const renderActiveStep = () => {
    switch (activeStep) {
      case 1:
        return (
          <StepSection
            number={1}
            title="שלב 1: חיבור ל-Supabase"
            description="הזינו את כתובת הפרויקט וה-ANON KEY הציבורי. נשמור אותם בחשבון הבקרה."
            statusBadge={renderConnectionStatusBadge()}
          >
            <form className="space-y-6" onSubmit={handleSaveConnection}>
              <div className="grid gap-4">
                <div className="space-y-2">
                  <Label htmlFor="supabase-url">Supabase URL</Label>
                  <Input
                    id="supabase-url"
                    dir="ltr"
                    value={connection.supabase_url}
                    onChange={handleConnectionChange('supabase_url')}
                    placeholder="https://YOUR-PROJECT.supabase.co"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="supabase-anon-key">Supabase anon key</Label>
                  <Textarea
                    id="supabase-anon-key"
                    dir="ltr"
                    rows={4}
                    value={connection.anon_key}
                    onChange={handleConnectionChange('anon_key')}
                    placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                {lastSavedAt ? (
                  <span className="text-xs text-slate-500">
                    נשמר לאחרונה: {formatDateTime(lastSavedAt)}
                  </span>
                ) : (
                  <span className="text-xs text-slate-500">
                    שמרו את הפרטים כדי לאפשר שלבים מתקדמים יותר.
                  </span>
                )}
                <Button type="submit" disabled={!hasConnectionValues || isSavingConnection} className="gap-2">
                  {isSavingConnection ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
                  {isSavingConnection ? 'שומר...' : 'שמור פרטי חיבור'}
                </Button>
              </div>
            </form>
          </StepSection>
        );
      case 2:
        return (
          <StepSection
            number={2}
            title="שלב 2: פריסת פונקציית ה-Edge"
            description="פרסו את הפונקציה המאובטחת דרך ממשק הדפדפן של Supabase (ללא CLI)."
          >
            <div className="space-y-6">
              <p className="text-sm text-slate-600">
                כל ההגדרה נעשית ישירות מלוח הבקרה של Supabase. בצעו את השלבים הבאים בפרויקט של הלקוח:
              </p>
              <ol className="list-decimal pr-5 space-y-2 text-sm text-slate-600">
                <li>
                  היכנסו ללוח הבקרה של Supabase, פתחו את הפרויקט ובחרו בתפריט{' '}
                  <strong>Edge Functions</strong>.
                </li>
                <li>
                  לחצו על <strong>New Function</strong>, הזינו את השם{' '}
                  <code className="rounded bg-slate-100 px-1">secure-api-worker</code>, בחרו באפשרות "Empty Function" ואשרו את
                  היצירה.
                </li>
                <li>
                  בחלון העריכה שנפתח הדביקו את הקוד המלא בקובץ{' '}
                  <code className="rounded bg-slate-100 px-1">index.ts</code>, ודאו שהאפשרות "Verify JWT" כבויה, ולאחר מכן לחצו
                  על <strong>Deploy</strong> כדי לפרסם את הפונקציה.
                </li>
                <li>
                  לאחר הפריסה לחצו על <strong>Run</strong> (או Test) כדי לאשר שהפונקציה מגיבה בנתיב{' '}
                  <code className="rounded bg-slate-100 px-1">/functions/v1/secure-api-worker</code>.
                </li>
              </ol>
              <p className="text-xs text-slate-500 bg-blue-50 border border-blue-200 rounded-lg p-3">
                אין צורך בהתקנת Supabase CLI. כל השלבים מתבצעים בדפדפן ומייצרים את אותה פונקציה מאובטחת.
              </p>
              <div className="space-y-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <Label htmlFor="edge-function-code">קוד פונקציית secure-api-worker</Label>
                  <CopyButton
                    text={SECURE_API_WORKER_SOURCE}
                    ariaLabel="העתק את קוד פונקציית ה-Edge"
                    label="העתק קוד"
                  />
                </div>
                <Textarea
                  id="edge-function-code"
                  dir="ltr"
                  readOnly
                  value={SECURE_API_WORKER_SOURCE}
                  rows={20}
                  className="font-mono text-xs leading-relaxed bg-slate-900 text-slate-100 border border-slate-800 rounded-lg"
                />
              </div>
              <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">
                בסיום, הפונקציה תהיה זמינה בנתיב{' '}
                <code className="bg-slate-100 px-1 rounded">/functions/v1/secure-api-worker</code> ומוכנה לקבל קריאות מה-API
                Proxy שלנו.
              </p>
            </div>
          </StepSection>
        );
      case 3:
        return (
          <StepSection
            number={3}
            title="שלב 3: הריצו SQL מלא והפיקו מפתח ייעודי"
            description="הדביקו את ה-JWT Secret של הפרויקט כדי לעדכן את הסקריפט והפיקו את APP_DEDICATED_KEY."
          >
            <div className="space-y-6">
              <p className="text-sm text-slate-600">
                הסקריפט הבא יוצר את כל הטבלאות, מפעיל את מדיניות ה-RLS, ומקצה את התפקיד{' '}
                <code className="bg-slate-100 px-1 rounded">app_user</code>. בסיום הריצה הוא יחזיר עמודה בשם{' '}
                <code className="bg-slate-100 px-1 rounded">APP_DEDICATED_KEY</code> עם המפתח הייחודי של הארגון.
              </p>
              <div className="space-y-2">
                <Label htmlFor="jwt-secret">Supabase JWT Secret</Label>
                <Input
                  id="jwt-secret"
                  dir="ltr"
                  value={jwtSecret}
                  onChange={(event) => setJwtSecret(event.target.value)}
                  placeholder="הדביקו כאן את ה-JWT Secret מתוך Project Settings → API"
                />
                <p className="text-xs text-slate-500">
                  מוצאים את המפתח תחת Project Settings → API → JWT Settings → JWT Secret.
                </p>
              </div>
              {!jwtSecret.trim() ? (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  ללא סוד, הסקריפט ישתמש במחרוזת{' '}
                  <code className="bg-slate-100 px-1 rounded">{JWT_SECRET_PLACEHOLDER}</code>. החליפו אותה בסוד האמיתי כדי לקבל מפתח אמיתי.
                </p>
              ) : null}
              <div className="space-y-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <Label htmlFor="full-setup-sql">סקריפט ההגדרה המלא</Label>
                  <CopyButton
                    text={fullSqlScript}
                    ariaLabel="העתק את סקריפט ההגדרה"
                    label="העתק SQL"
                  />
                </div>
                <Textarea
                  id="full-setup-sql"
                  dir="ltr"
                  readOnly
                  value={fullSqlScript}
                  rows={24}
                  className="font-mono text-xs leading-relaxed bg-slate-900 text-slate-100 border border-slate-800 rounded-lg"
                />
              </div>
              <p className="text-sm text-slate-600">
                העתיקו את כל הסקריפט והדביקו אותו ב-Supabase SQL Editor. לאחר הריצה העתיקו את הערך{' '}
                <code className="bg-slate-100 px-1 rounded">APP_DEDICATED_KEY</code> שמופיע בתוצאת השאילתה.
              </p>
            </div>
          </StepSection>
        );
      case 4:
        return (
          <StepSection
            number={4}
            title="שלב 4: שמירת המפתח הייעודי"
            description="הדביקו את ה-APP_DEDICATED_KEY שהתקבל והעבירו אותו לאחסון מוצפן דרך ה-API."
            statusBadge={renderDedicatedKeyStatusBadge()}
          >
            <div className="space-y-6">
              <p className="text-sm text-slate-600">
                הדביקו כאן את הערך <code className="bg-slate-100 px-1 rounded">APP_DEDICATED_KEY</code> שהתקבל בשלב הקודם ולחצו על "שמור מפתח ייעודי". המערכת תקרא ל-
                <code className="bg-slate-100 px-1 rounded">/api/save-org-credentials</code> ותאחסן את המפתח בצורה מוצפנת.
              </p>
              <div className="space-y-2">
                <Label htmlFor="dedicated-key">APP_DEDICATED_KEY</Label>
                <Textarea
                  id="dedicated-key"
                  dir="ltr"
                  rows={4}
                  value={dedicatedKey}
                  onChange={(event) => {
                    setDedicatedKey(event.target.value);
                    setDedicatedKeyError('');
                  }}
                  placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                />
              </div>
              {dedicatedKeyError ? <p className="text-xs text-red-600">{dedicatedKeyError}</p> : null}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handlePasteDedicatedKey}
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
                  disabled={isSavingDedicatedKey || !dedicatedKey.trim()}
                >
                  נקה
                </Button>
                <Button
                  type="button"
                  onClick={handleSaveDedicatedKey}
                  disabled={!dedicatedKey.trim() || isSavingDedicatedKey || !activeOrg || !supabaseReady}
                  className="gap-2"
                >
                  {isSavingDedicatedKey ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
                  {isSavingDedicatedKey ? 'שומר...' : 'שמור מפתח ייעודי'}
                </Button>
              </div>
              {dedicatedKeySavedAt ? (
                <span className="text-xs text-slate-500">
                  נשמר לאחרונה: {formatDateTime(dedicatedKeySavedAt)}
                </span>
              ) : (
                <span className="text-xs text-slate-500">
                  שמירת המפתח נדרשת כדי שה-API Proxy יוכל לאמת מול פונקציית ה-Edge.
                </span>
              )}
              <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">
                המפתח נשמר בעמודת dedicated_key_encrypted בטבלת organizations ויעשה בו שימוש רק מהשרת.
              </p>
            </div>
          </StepSection>
        );
      default:
        return null;
    }
  };

  if (!activeOrg) {
    return (
      <>
        <Card className="border-0 shadow-xl bg-white/90" dir="rtl">
          <CardHeader>
            <CardTitle className="text-2xl font-semibold text-slate-900">אשף הגדרת Supabase</CardTitle>
            <p className="text-sm text-slate-600 mt-2">
              בחרו או צרו ארגון חדש כדי להתחיל את תהליך ההגדרה.
            </p>
          </CardHeader>
          <CardContent>
            <Button onClick={handleOpenCreateDialog} className="gap-2">
              <Building2 className="w-4 h-4" aria-hidden="true" />
              צור ארגון חדש
            </Button>
          </CardContent>
        </Card>
        {renderCreateOrgDialog()}
      </>
    );
  }

  return (
    <>
      <Card className="border-0 shadow-xl bg-white/90" dir="rtl">
        <CardHeader className="border-b border-slate-200">
          <CardTitle className="text-2xl font-semibold text-slate-900 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>אשף הגדרת Supabase</span>
            {onboardingComplete ? (
              <Badge className="gap-1 bg-emerald-100 text-emerald-700 border border-emerald-200">
                <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                <span>ההגדרה הושלמה</span>
              </Badge>
            ) : null}
          </CardTitle>
          <p className="text-sm text-slate-600 mt-2">
            עברו על ארבעת השלבים: שמירת פרטי החיבור, פריסת פונקציית ה-Edge, הרצת סקריפט ההתקנה והחזרת המפתח הייעודי. כל שלב כולל הוראות מפורטות וכפתורי העתקה מהירים.
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
