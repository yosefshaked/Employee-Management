import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils.js';
import {
  bytesToGigabytes,
  calculateUsagePercent,
  formatGigabytes,
  resolvePlanQuotas,
  STORAGE_USAGE_SQL_SNIPPET,
} from '@/lib/storage.js';

const PLAN_LABELS = {
  Free: 'חינמי',
  Pro: 'מקצועי',
  Custom: 'מותאם אישית',
};

const formatPercentLabel = (percent) => {
  if (typeof percent !== 'number' || Number.isNaN(percent)) {
    return '—';
  }
  return `${percent}%`;
};

const UsageRow = ({ label, usedBytes, quotaGb, percent, highlight }) => {
  const hasNumericUsage = Number.isFinite(usedBytes);
  const usedGb = hasNumericUsage ? bytesToGigabytes(usedBytes) : null;
  const usedLabel = hasNumericUsage ? formatGigabytes(usedGb) : '—';
  const quotaLabel = formatGigabytes(quotaGb);
  const percentValue = typeof percent === 'number' ? percent : 0;
  const showProgress = hasNumericUsage && typeof percent === 'number';
  const progressWidth = showProgress ? `${percentValue}%` : '0%';
  const summaryText = hasNumericUsage
    ? `${usedLabel} מתוך ${quotaLabel} (${formatPercentLabel(percent)})`
    : `הנתון אינו זמין (מכסה: ${quotaLabel})`;

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center justify-between text-sm text-slate-700 gap-2">
        <span className="font-medium text-slate-900">{label}</span>
        <span>{summaryText}</span>
      </div>
      <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden" aria-hidden="true">
        <div
          className={cn('h-full bg-blue-500 transition-all', highlight && showProgress && 'bg-amber-500')}
          style={{ width: progressWidth }}
        />
      </div>
    </div>
  );
};

const StorageUsageWidget = ({
  settings,
  metrics,
  isLoading = false,
  className,
  onRefresh,
  showRefreshButton = false,
}) => {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [copyState, setCopyState] = useState('idle');
  const quotas = useMemo(() => resolvePlanQuotas(settings), [settings]);
  const storagePercent = useMemo(() => {
    if (!metrics) return null;
    return calculateUsagePercent(metrics.storageBytes, quotas.storageQuotaGb);
  }, [metrics, quotas.storageQuotaGb]);

  const dbPercent = useMemo(() => {
    if (!metrics || !settings?.show_db_and_storage) return null;
    if (metrics.dbBytes == null) return null;
    return calculateUsagePercent(metrics.dbBytes, quotas.dbQuotaGb);
  }, [metrics, quotas.dbQuotaGb, settings?.show_db_and_storage]);

  const summaryTarget = useMemo(() => {
    if (settings?.show_db_and_storage && typeof dbPercent === 'number' && typeof storagePercent === 'number') {
      return dbPercent >= storagePercent ? 'database' : 'storage';
    }
    return 'storage';
  }, [dbPercent, settings?.show_db_and_storage, storagePercent]);

  const summaryPercent = summaryTarget === 'database' ? dbPercent : storagePercent;
  const summaryUsedBytes = summaryTarget === 'database'
    ? metrics?.dbBytes
    : metrics?.storageBytes;
  const summaryQuotaGb = summaryTarget === 'database'
    ? quotas.dbQuotaGb
    : quotas.storageQuotaGb;
  const summaryLabel = summaryTarget === 'database' ? 'מסד נתונים' : 'אחסון';
  const summaryHighlight = typeof summaryPercent === 'number' && summaryPercent >= 85;
  const hasBreakdown = Boolean(settings?.show_db_and_storage);
  const isBusy = isLoading || !metrics;

  const planLabel = PLAN_LABELS[quotas.plan] || quotas.plan;
  const storageError = metrics?.errors?.storage;
  const dbError = metrics?.errors?.database;
  const fallbackError = metrics?.errors?.storageFallback;
  const hasError = Boolean(storageError || dbError);
  const hints = metrics?.hints || {};
  const edgeMissing = Boolean(hints.storageEdgeMissing);
  const rpcMissing = Boolean(hints.storageRpcMissing);
  const usingFallback = hints.storageSource === 'rpc';

  const errorMessages = useMemo(() => {
    if (!hasError) return [];
    const messages = [];
    if (storageError) {
      const message = typeof storageError.message === 'string'
        ? storageError.message
        : 'לא ניתן לטעון את נתוני האחסון כרגע.';
      messages.push(message);
    }
    if (dbError) {
      const message = typeof dbError.message === 'string'
        ? dbError.message
        : 'לא ניתן לטעון את נתוני מסד הנתונים כרגע.';
      messages.push(message);
    }
    if (fallbackError && fallbackError !== storageError) {
      const message = typeof fallbackError.message === 'string'
        ? fallbackError.message
        : 'נסיון החישוב החלופי נכשל.';
      messages.push(message);
    }
    return messages;
  }, [dbError, fallbackError, hasError, storageError]);

  const handleCopySetup = async () => {
    if (!navigator?.clipboard) {
      setCopyState('error');
      return;
    }
    try {
      await navigator.clipboard.writeText(`${STORAGE_USAGE_SQL_SNIPPET}\n`);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 3000);
    } catch (error) {
      console.error('Failed to copy storage setup snippet', error);
      setCopyState('error');
      setTimeout(() => setCopyState('idle'), 4000);
    }
  };

  return (
    <Card className={cn('bg-white/80 border-0 shadow-lg', className)}>
      <CardHeader className="flex flex-col gap-2 border-b">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-lg font-semibold text-slate-900">שימוש באחסון</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
              תוכנית: {planLabel}
            </Badge>
            {summaryHighlight && (
              <Badge variant="outline" className="border-amber-200 bg-amber-100 text-amber-800">
                כמעט מלא
              </Badge>
            )}
          </div>
        </div>
        <p className="text-sm text-slate-500">
          החישוב מבוסס על סכימת קבצים ב-Supabase Storage ועל pg_database_size לפי ההגדרות שלכם.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {(edgeMissing || rpcMissing) && (
          <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 space-y-2">
            <p className="font-semibold text-sm text-blue-900">
              עוד לא התקנו את חישוב האחסון האוטומטי.
            </p>
            <p>
              בלחיצה על הכפתור נעתיק עבורכם את הסקריפט המוכן. הדביקו אותו ב-SQL של Supabase ולחצו Run, ואז חזרו לכאן ולחצו על "רענן נתונים".
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={handleCopySetup}>
                {copyState === 'copied' ? 'הסקריפט הועתק!' : 'העתיקו את הסקריפט בשבילי'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowInstallHelp(prev => !prev)}
              >
                {showInstallHelp ? 'הסתר הסבר מפורט' : 'הסבר בשלבים פשוטים'}
              </Button>
            </div>
            {copyState === 'error' && (
              <p className="text-xs text-amber-700">
                לא הצלחנו להעתיק אוטומטית. אפשר לבחור ולהעתיק ידנית מההודעה מתחת.
              </p>
            )}
            {showInstallHelp && (
              <ol className="list-decimal pr-4 space-y-1 text-[11px] leading-5">
                <li>פתחו את Supabase Dashboard והיכנסו לפרויקט שלכם.</li>
                <li>בצד שמאל לחצו על "SQL Editor" ואז על כפתור יצירת סקריפט חדש.</li>
                <li>הדביקו את הטקסט שהועתק ולחצו על Run.</li>
                <li>חזרו לכאן, לחצו "רענן נתונים" והמספרים יתעדכנו.</li>
              </ol>
            )}
            <details className="rounded bg-white/60 p-2 text-[11px] text-slate-700">
              <summary className="cursor-pointer font-medium text-slate-800">
                הסקריפט שנעתיק עבורכם
              </summary>
              <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-[10px] leading-4">
                {STORAGE_USAGE_SQL_SNIPPET}
              </pre>
            </details>
          </div>
        )}

        {hasError && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 space-y-2">
            {errorMessages.map((message, index) => (
              <p key={index}>{message}</p>
            ))}
          </div>
        )}
        {isBusy ? (
          <div className="space-y-3">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        ) : (
          <>
            <UsageRow
              label={`סיכום ${summaryLabel}`}
              usedBytes={summaryUsedBytes}
              quotaGb={summaryQuotaGb}
              percent={summaryPercent}
              highlight={summaryHighlight}
            />

            {hasBreakdown ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowBreakdown(prev => !prev)}
                >
                  {showBreakdown ? 'הסתר פירוט' : 'הצג פירוט'}
                </Button>
                <span className="text-xs text-slate-500">
                  נתונים מדויקים לפי storage.objects ו-pg_database_size
                </span>
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                נתונים מדויקים לפי storage.objects ב-Supabase.
              </p>
            )}

            {hasBreakdown && showBreakdown && (
              <div className="space-y-3">
                <UsageRow
                  label="אחסון"
                  usedBytes={metrics.storageBytes}
                  quotaGb={quotas.storageQuotaGb}
                  percent={storagePercent}
                  highlight={typeof storagePercent === 'number' && storagePercent >= 85}
                />
                <UsageRow
                  label="מסד נתונים"
                  usedBytes={metrics.dbBytes}
                  quotaGb={quotas.dbQuotaGb}
                  percent={dbPercent}
                  highlight={typeof dbPercent === 'number' && dbPercent >= 85}
                />
              </div>
            )}

            {showRefreshButton && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onRefresh}
                disabled={isLoading || !onRefresh}
              >
                רענן נתונים
              </Button>
            )}

            {settings?.note && settings.note.trim() && (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 leading-relaxed">
                {settings.note}
              </div>
            )}

            <p className="text-xs text-slate-500 leading-relaxed">
              אם אינכם משלמים לסופבייס, התוכנית החינמית מתאימה ואפשר להשאיר את ברירת המחדל. ניתן לעדכן את המכסה דרך ההגדרות.
            </p>
            {usingFallback && (
              <p className="text-[11px] text-slate-500">
                החישוב מתבסס על פונקציות SQL שנוצרו בפרויקט. ניתן לפרוס את פונקציית ה-Edge בהמשך, אך זה אינו חובה.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default StorageUsageWidget;
