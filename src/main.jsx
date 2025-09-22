import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import Layout from './Layout.jsx';
import Dashboard from './Pages/Dashboard.jsx';
import Employees from './Pages/Employees.jsx';
import TimeEntry from './Pages/TimeEntry.jsx';
import Reports from './Pages/Reports.jsx';
import ReportsErrorBoundary from './components/reports/ReportsErrorBoundary.js';
import Services from './Pages/Services.jsx';
import Settings from './Pages/Settings.jsx';
import { RuntimeConfigProvider } from './runtime/RuntimeConfigContext.jsx';
import { SupabaseProvider } from './context/SupabaseContext.jsx';
import Diagnostics from './runtime/Diagnostics.jsx';
import Login from './Pages/Login.jsx';
import { AuthProvider } from './auth/AuthContext.jsx';
import AuthGuard from './auth/AuthGuard.jsx';
import { OrgProvider } from './org/OrgContext.jsx';
import OrgSelection from './Pages/OrgSelection.jsx';

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<AuthGuard />}>
        <Route path="/select-org" element={<OrgSelection />} />
        <Route element={<Layout />}>
          {/* ניתוב אוטומטי מהעמוד הראשי לדשבורד */}
          <Route path="/" element={<Navigate to="/Dashboard" replace />} />

          {/* הגדרת כל העמודים */}
          <Route path="/Dashboard" element={<Dashboard />} />
          <Route path="/Employees" element={<Employees />} />
          <Route path="/TimeEntry" element={<TimeEntry />} />
          <Route path="/Adjustments" element={<Navigate to="/TimeEntry?tab=adjustments" replace />} />
          <Route path="/Reports" element={<ReportsErrorBoundary><Reports /></ReportsErrorBoundary>} />
          <Route path="/Services" element={<Services />} />
          <Route path="/Settings" element={<Settings />} />
          <Route path="/diagnostics" element={<Diagnostics />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/Dashboard" replace />} />
    </Routes>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function renderApp(config = null) {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <RuntimeConfigProvider config={config}>
        <SupabaseProvider>
          <AuthProvider>
            <OrgProvider>
              <HashRouter>
                <App />
              </HashRouter>
            </OrgProvider>
          </AuthProvider>
        </SupabaseProvider>
      </RuntimeConfigProvider>
    </React.StrictMode>,
  );
}

export default App;
