import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

// ייבוא של קובץ ה-CSS שיצרנו
import './index.css';

// ייבוא של כל העמודים והתבנית הראשית שלך
import Layout from './Layout.jsx';
import Dashboard from './Pages/Dashboard.jsx';
import Employees from './Pages/Employees.jsx';
import TimeEntry from './Pages/TimeEntry.jsx';
import Reports from './Pages/Reports.jsx';
import Services from './Pages/Services.jsx';

// קומפוננטה ראשית שמגדירה את הניווט
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
        <Route path="/Reports" element={<Reports />} />
        <Route path="/Services" element={<Services />} />
      </Routes>
    </Layout>
  );
}

// הקוד שמפעיל את כל האפליקציה
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);