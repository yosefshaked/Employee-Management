import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Check,
  CheckCircle2,
  ClipboardCopy,
  Loader2,
  Play,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { supabase, SUPABASE_ANON_KEY, SUPABASE_URL } from '@/supabaseClient.js';

const TABLES = [
  'Employees',
  'WorkSessions',
  'LeaveBalances',
  'RateHistory',
  'Services',
  'Settings',
];

const BASELINE_SQL = `-- Baseline RLS for Employee Management (single-tenant)
-- Run in the Supabase SQL editor while connected as the project owner.

ALTER TABLE public."Employees" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated select Employees" ON public."Employees"
  FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Authenticated insert Employees" ON public."Employees"
  FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY "Authenticated update Employees" ON public."Employees"
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);
CREATE POLICY "Authenticated delete Employees" ON public."Employees"
  FOR DELETE TO authenticated
  USING (true);

ALTER TABLE public."WorkSessions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated select WorkSessions" ON public."WorkSessions"
  FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Authenticated insert WorkSessions" ON public."WorkSessions"
  FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY "Authenticated update WorkSessions" ON public."WorkSessions"
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);
CREATE POLICY "Authenticated delete WorkSessions" ON public."WorkSessions"
  FOR DELETE TO authenticated
  USING (true);

ALTER TABLE public."LeaveBalances" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated select LeaveBalances" ON public."LeaveBalances"
  FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Authenticated insert LeaveBalances" ON public."LeaveBalances"
  FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY "Authenticated update LeaveBalances" ON public."LeaveBalances"
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);
CREATE POLICY "Authenticated delete LeaveBalances" ON public."LeaveBalances"
  FOR DELETE TO authenticated
  USING (true);

ALTER TABLE public."RateHistory" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated select RateHistory" ON public."RateHistory"
  FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Authenticated insert RateHistory" ON public."RateHistory"
  FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY "Authenticated update RateHistory" ON public."RateHistory"
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);
CREATE POLICY "Authenticated delete RateHistory" ON public."RateHistory"
  FOR DELETE TO authenticated
  USING (true);

ALTER TABLE public."Services" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated select Services" ON public."Services"
  FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Authenticated insert Services" ON public."Services"
  FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY "Authenticated update Services" ON public."Services"
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);
CREATE POLICY "Authenticated delete Services" ON public."Services"
  FOR DELETE TO authenticated
  USING (true);

ALTER TABLE public."Settings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated select Settings" ON public."Settings"
  FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Authenticated insert Settings" ON public."Settings"
  FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY "Authenticated update Settings" ON public."Settings"
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);
CREATE POLICY "Authenticated delete Settings" ON public."Settings"
  FOR DELETE TO authenticated
  USING (true);
`;

export default function RlsBaselineCard() {
  const [copyState, setCopyState] = useState('idle');
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState(null);
  const [results, setResults] = useState(null);

  const overallStatus = useMemo(() => {
    if (!results) return null;
    const allPassed = results.every(result => result.authPass && result.anonPass);
    return allPassed ? 'pass' : 'fail';
  }, [results]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(BASELINE_SQL);
      setCopyState('success');
      setTimeout(() => setCopyState('idle'), 2000);
    } catch (error) {
      console.error('Failed to copy RLS SQL', error);
      setCopyState('error');
      setTimeout(() => setCopyState('idle'), 3000);
    }
  };

  const handleVerify = async () => {
    setIsVerifying(true);
    setVerifyError(null);
    setResults(null);

    try {
      const tableResults = [];

      for (const table of TABLES) {
        const authResponse = await supabase
          .from(table)
          .select('id', { count: 'exact', head: true })
          .limit(1);

        const authPass = !authResponse.error;
        const authMessage = authResponse.error ? authResponse.error.message : '';

        let anonPass = false;
        let anonMessage = '';

        try {
          const tablePath = encodeURIComponent(table);
          const response = await fetch(`${SUPABASE_URL}/rest/v1/${tablePath}?select=id&limit=1`, {
            headers: {
              apikey: SUPABASE_ANON_KEY,
              Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
              Prefer: 'count=exact,head=true',
            },
          });

          if (!response.ok) {
            anonPass = response.status === 401 || response.status === 403;
            if (!anonPass) {
              const bodyText = await response.text();
              anonMessage = bodyText ? bodyText.slice(0, 250) : `Unexpected status ${response.status}`;
            }
          } else {
            anonMessage = 'הבקשה האנונימית הצליחה - בדוק שהמדיניות הוחלה.';
          }
        } catch (error) {
          anonMessage = error.message;
        }

        tableResults.push({
          table,
          authPass,
          authMessage,
          anonPass,
          anonMessage,
        });
      }

      setResults(tableResults);
    } catch (error) {
      console.error('Failed to verify RLS configuration', error);
      setVerifyError('בדיקת המדיניות נכשלה. נסה שוב מאוחר יותר.');
    }

    setIsVerifying(false);
  };

  return (
    <Card className="border-0 shadow-lg bg-white/80">
      <CardHeader className="border-b">
        <CardTitle className="text-xl font-semibold text-slate-900">עוזר הקמה: אבטחת Supabase</CardTitle>
        <p className="text-sm text-slate-600 mt-1">
          הפעל RLS לכל טבלאות הליבה והענק גישה רק למשתמשים מחוברים. העתק את ה-SQL, הרץ אותו ב-Supabase ואז אמת שהמדיניות פעילה.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-700">SQL להגדרת מדיניות</h3>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopy}
              className="gap-2"
            >
              {copyState === 'success' ? <Check className="w-4 h-4" /> : <ClipboardCopy className="w-4 h-4" />}
              {copyState === 'success' ? 'הועתק!' : 'העתק'}
            </Button>
          </div>
          <div className="bg-slate-900 text-slate-100 rounded-xl p-4 overflow-x-auto text-sm leading-relaxed" dir="ltr">
            <pre className="whitespace-pre">{BASELINE_SQL}</pre>
          </div>
          {copyState === 'error' && (
            <p className="text-xs text-red-600">לא ניתן להעתיק אוטומטית, העתק ידנית את ה-SQL מהתיבה.</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            onClick={handleVerify}
            disabled={isVerifying}
            className="gap-2"
          >
            {isVerifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {isVerifying ? 'בודק...' : 'בדוק מדיניות'}
          </Button>
          {overallStatus === 'pass' && (
            <span className="flex items-center gap-2 text-sm text-emerald-600 font-medium">
              <ShieldCheck className="w-4 h-4" />
              כל הטבלאות מוגנות
            </span>
          )}
          {overallStatus === 'fail' && (
            <span className="flex items-center gap-2 text-sm text-amber-600 font-medium">
              <ShieldAlert className="w-4 h-4" />
              חלק מהבדיקות נכשלו - בדוק את הפירוט מטה
            </span>
          )}
        </div>

        {verifyError && (
          <p className="text-sm text-red-600">{verifyError}</p>
        )}

        {results && (
          <div className="space-y-3">
            {results.map(result => (
              <div
                key={result.table}
                className="border border-slate-200 rounded-lg p-4 bg-slate-50"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {(result.authPass && result.anonPass) ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-500" />
                    )}
                    <h4 className="text-sm font-semibold text-slate-800">{result.table}</h4>
                  </div>
                  <Badge variant={result.authPass && result.anonPass ? 'secondary' : 'outline'}>
                    {result.authPass && result.anonPass ? 'מאובטח' : 'דורש תשומת לב'}
                  </Badge>
                </div>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 font-medium text-slate-700">
                      {result.authPass ? (
                        <ShieldCheck className="w-4 h-4 text-emerald-600" />
                      ) : (
                        <ShieldAlert className="w-4 h-4 text-red-500" />
                      )}
                      <span>גישה למשתמש מחובר</span>
                    </div>
                    {!result.authPass && result.authMessage && (
                      <p className="text-xs text-red-600 leading-snug">{result.authMessage}</p>
                    )}
                    {result.authPass && (
                      <p className="text-xs text-slate-500 leading-snug">הקריאה מצליחה ומחזירה תוצאות (או כותרות) בהתאם להרשאות RLS.</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 font-medium text-slate-700">
                      {result.anonPass ? (
                        <ShieldCheck className="w-4 h-4 text-emerald-600" />
                      ) : (
                        <ShieldAlert className="w-4 h-4 text-red-500" />
                      )}
                      <span>חסימת גישה לאנונימי</span>
                    </div>
                    {result.anonPass ? (
                      <p className="text-xs text-slate-500 leading-snug">הקריאה ללא טוקן מחזירה 401/403 ולכן נתונים לא נחשפים ללא התחברות.</p>
                    ) : (
                      result.anonMessage && (
                        <p className="text-xs text-red-600 leading-snug">{result.anonMessage}</p>
                      )
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
