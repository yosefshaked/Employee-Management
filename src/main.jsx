import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';

// ייבוא של כל העמודים והתבנית הראשית שלך (ללא שינוי)
import Layout from './Layout.jsx';
import Dashboard from './Pages/Dashboard.jsx';
import Employees from './Pages/Employees.jsx';
import TimeEntry from './Pages/TimeEntry.jsx';
import Adjustments from './Pages/Adjustments.jsx';
import Reports from './Pages/Reports.jsx';
import ReportsErrorBoundary from './components/reports/ReportsErrorBoundary.js';
import Services from './Pages/Services.jsx';
import Settings from './Pages/Settings.jsx';

// קומפוננטה ראשית שמגדירה את הניווט (עכשיו עם לוגיקת טעינה)
function App() {
  return (
    <Layout>
      <Routes>
        {/* ניתוב אוטומטי מהעמוד הראשי לדשבורד */}
        <Route path="/" element={<Navigate to="/Dashboard" replace />} />
        
        {/* הגדרת כל העמודים */}
        <Route path="/Dashboard" element={<Dashboard />} />
        <Route path="/Employees" element={<Employees />} />
        <Route path="/TimeEntry" element={<TimeEntry />} />
        <Route path="/Adjustments" element={<Adjustments />} />
        <Route path="/Reports" element={<ReportsErrorBoundary><Reports /></ReportsErrorBoundary>} />
        <Route path="/Services" element={<Services />} />
        <Route path="/Settings" element={<Settings />} />
      </Routes>
    </Layout>
  );
}

// הקוד שמפעיל את כל האפליקציה (ללא שינוי)
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
);

export default App;
