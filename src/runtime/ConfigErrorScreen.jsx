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
          <li>בפריסת Azure Static Web Apps יש להגדיר את המשתנים SUPABASE_URL ו-SUPABASE_ANON_KEY בהגדרות ה-API ולפרוס מחדש.</li>
          <li>בפיתוח לוקלי ניתן להשתמש ב־.env.development עם VITE_SUPABASE_URL ו־VITE_SUPABASE_ANON_KEY או להריץ את Azure Static Web Apps CLI עם local.settings.json תחת api/.</li>
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
