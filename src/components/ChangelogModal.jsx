import React from 'react';

export default function ChangelogModal({ open, onClose }) {
  if (!open) return null;
  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      zIndex: 10000,
      background: 'rgba(255,255,255,0.4)',
      backdropFilter: 'blur(6px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        background: 'white',
        borderRadius: 18,
        boxShadow: '0 8px 32px 0 rgba(60,60,120,0.18)',
        padding: '32px 28px 24px 28px',
        minWidth: 340,
        maxWidth: 1080,
        textAlign: 'center',
        position: 'relative',
      }}>
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 18,
            left: 18,
            background: 'transparent',
            border: 'none',
            fontSize: 22,
            color: '#64748b',
            cursor: 'pointer',
            zIndex: 10001,
          }}
          aria-label="סגור עדכונים"
        >×</button>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#2563eb', marginBottom: 18 }}>עדכונים במערכת</h2>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, color: '#334155', fontSize: 17 }}>
          <li class="mb-4" dir="rtl">
            <article class="space-y-3 text-right">
              <header>
                <h1 class="font-bold text-lg">
                  <time datetime="2025-09-07">07/09/2025</time> – 🎉 ברוכים הבאים לגרסה 1.0.0 של מערכת ניהול עובדים ושכר!
                </h1>
                <p>
                  זוהי ההשקה הרשמית של המערכת החדשה, שנבנתה כדי להחליף את קובצי ה־Excel
                  המורכבים ולאפשר עבודה פשוטה, מדויקת ואמינה.
                </p>
              </header>

              <section>
                <h2 class="font-semibold">מה כולל בשלב זה:</h2>
                <ul class="list-disc pr-5 space-y-1">
                  <li>📋 ניהול עובדים לפי סוג העסקה (שעתי / מדריך לפי שיעור)</li>
                  <li>💰 הגדרת תעריפים דינמיים עם שמירת היסטוריה מלאה</li>
                  <li>🐎 ניהול סוגי שירותים ומעקב אחרי ביצועי מדריכים</li>
                  <li>📊 רישום שעות ושיעורים עם חישוב אוטומטי ושקיפות מלאה</li>
                  <li>🔎 דיווחים אינטראקטיביים עם שמירה על דיוק היסטורי</li>
                </ul>
              </section>

              <section>
                <h2 class="font-semibold">מה חשוב לדעת:</h2>
                <ul class="list-disc pr-5 space-y-1">
                  <li>זוהי גרסת בסיס ראשונה – יתכנו עדכונים ושיפורים בהמשך.</li>
                  <li>הפידבק שלכם קריטי – כל רעיון, תקלה או שאלה יעזרו לשפר.</li>
                  <li>כל הנתונים נשמרים בצורה מאובטחת ונשענים על בסיס נתונים יציב (PostgreSQL + Supabase).</li>
                </ul>
              </section>
            </article>
          </li>
        </ul>
      </div>
    </div>
  );
}
