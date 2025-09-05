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
        maxWidth: 420,
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
          <li style={{ marginBottom: 14 }}>
            <strong>05/09/2025:</strong> שיפורים בחלון הקופץ בלוח השנה, כפתור סגירה חדש ומראה מקצועי.
          </li>
          <li style={{ marginBottom: 14 }}>
            <strong>05/09/2025:</strong> חזרת אפשרות גלילה בין חודשים בלוח השנה.
          </li>
          <li style={{ marginBottom: 14 }}>
            <strong>05/09/2025:</strong> הסרת חלון דיבאג מהמערכת.
          </li>
          <li style={{ marginBottom: 14 }}>
            <strong>05/09/2025:</strong> שיפורי ממשק משתמש בלוח השנה.
          </li>
        </ul>
      </div>
    </div>
  );
}
