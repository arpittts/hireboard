import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { useAuth } from './context/auth';
import Layout from './components/Layout';
import ServerWakeBanner from './components/ServerWakeBanner';
import Login from './pages/Login';
import Register from './pages/Register';
import './index.css';

// Each page is downloaded only when it's first opened, so the login page
// doesn't wait for the charts and drag-and-drop libraries.
const Dashboard = lazy(() => import('./pages/Dashboard'));
const KanbanBoard = lazy(() => import('./pages/KanbanBoard'));
const Applications = lazy(() => import('./pages/Applications'));
const ApplicationDetail = lazy(() => import('./pages/ApplicationDetail'));
const Settings = lazy(() => import('./pages/Settings'));
const Resume = lazy(() => import('./pages/Resume'));
const Interview = lazy(() => import('./pages/Interview'));
const Copilot = lazy(() => import('./pages/Copilot'));

const Spinner = () => <div className="loading-screen"><div className="spinner" /></div>;

function PrivateRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  return user ? children : <Navigate to="/login" />;
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  return user ? <Navigate to="/" /> : children;
}

function AppRoutes() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
        <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />
        <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
          <Route index element={<Dashboard />} />
          <Route path="board" element={<KanbanBoard />} />
          <Route path="applications" element={<Applications />} />
          <Route path="applications/:id" element={<ApplicationDetail />} />
          <Route path="resume" element={<Resume />} />
          <Route path="interviews/:id" element={<Interview />} />
          <Route path="copilot" element={<Copilot />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ServerWakeBanner />
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
