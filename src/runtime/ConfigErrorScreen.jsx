import React from 'react';
import ReactDOM from 'react-dom/client';

// eslint-disable-next-line react-refresh/only-export-components
export function renderConfigError(error) {
  const container = document.getElementById('root');
  if (!container) {
    return;
  }

  const root = ReactDOM.createRoot(container);
  root.render(<ConfigErrorScreen error={error} />);
}

function ConfigErrorScreen({ error }) {
  const message = error?.message || 'לא נמצאה תצורת Supabase לטעינת המערכת.';

  return (
    <div style={styles.wrapper} dir="rtl">
      <div style={styles.card}>
        <h1 style={styles.title}>הגדרת חיבור חסרה</h1>
        <p style={styles.message}>{message}</p>
        <ol style={styles.list}>
          <li>ודא שפונקציית <code>/api/config</code> קיימת ומחזירה JSON תקין עם <code>supabase_url</code> ו-<code>anon_key</code>.</li>
          <li>בפיתוח לוקלי הפעל את אמולציית Azure Static Web Apps (למשל <code>swa start --api-location api</code>) כדי לחשוף את הפונקציה.</li>
          <li>ב-Azure Static Web Apps יש להגדיר ב-API את <code>APP_SUPABASE_URL</code>, <code>APP_SUPABASE_ANON_KEY</code> ו-<code>APP_SUPABASE_SERVICE_ROLE</code> כדי שתפקוד /api/config יוכל לשרת ארגונים.</li>
        </ol>
        <button type="button" style={styles.button} onClick={() => window.location.reload()}>
          נסה שוב
        </button>
      </div>
    </div>
  );
}

const styles = {
  wrapper: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #fdf2f8 0%, #e0f2fe 100%)',
    padding: '24px',
  },
  card: {
    maxWidth: '520px',
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: '16px',
    boxShadow: '0 12px 40px rgba(15, 23, 42, 0.12)',
    padding: '32px',
    textAlign: 'right',
  },
  title: {
    fontSize: '28px',
    marginBottom: '16px',
    color: '#0f172a',
  },
  message: {
    fontSize: '18px',
    color: '#475569',
    marginBottom: '20px',
    lineHeight: 1.6,
  },
  list: {
    paddingInlineStart: '20px',
    color: '#334155',
    fontSize: '16px',
    lineHeight: 1.8,
    marginBottom: '24px',
  },
  button: {
    background: 'linear-gradient(90deg, #6366f1 0%, #3b82f6 100%)',
    color: '#fff',
    border: 'none',
    borderRadius: '9999px',
    padding: '12px 24px',
    fontSize: '16px',
    fontWeight: 600,
    cursor: 'pointer',
    boxShadow: '0 10px 30px rgba(59, 130, 246, 0.35)',
  },
};

export default ConfigErrorScreen;
