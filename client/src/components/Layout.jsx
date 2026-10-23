import { Suspense, useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/auth';
import { LayoutDashboard, Columns3, List, LogOut, Settings } from 'lucide-react';
import { toast } from '../services/toast';
import { errorMessage } from '../services/api';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/board', label: 'Kanban Board', icon: Columns3 },
  { to: '/applications', label: 'Applications', icon: List },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function DemoBanner() {
  const { deleteAccount } = useAuth();
  const [leaving, setLeaving] = useState(false);

  // Leaving deletes the demo account straight away instead of waiting 24 hours.
  const signUp = async () => {
    setLeaving(true);
    try {
      await deleteAccount();
      // A full page load: clearing the user makes the private-route guard redirect
      // to /login first, which would override a router navigate() here.
      window.location.assign('/register');
    } catch (err) {
      toast.error(errorMessage(err));
      setLeaving(false);
    }
  };

  return (
    <div className="demo-banner" role="note">
      <span>
        <strong>You're exploring a demo account</strong> with sample data. Change anything you like; it's deleted after 24 hours.
      </span>
      <button className="btn btn-primary btn-sm" onClick={signUp} disabled={leaving}>
        {leaving ? 'Leaving…' : 'Create a free account'}
      </button>
    </div>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => { logout(); navigate('/login'); };

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="logo">
          <div className="logo-icon">📋</div>
          <span>HireBoard</span>
        </div>
        <nav className="nav-links">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <Icon size={18} /> {label}
            </NavLink>
          ))}
        </nav>
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, padding: '0 8px' }}>
            <div className="avatar" style={{ background: user?.avatarColor || '#6C5CE7', width: 32, height: 32, fontSize: 13 }}>
              {user?.name?.charAt(0).toUpperCase()}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{user?.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {user?.isDemo ? 'Demo account' : user?.email}
              </div>
            </div>
          </div>
          <button className="nav-link" onClick={handleLogout} style={{ color: 'var(--red)' }}>
            <LogOut size={18} /> Sign Out
          </button>
        </div>
      </aside>
      <main className="main-content">
        {user?.isDemo && <DemoBanner />}
        {/* Keeps the sidebar on screen while the next page's code loads. */}
        <Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', paddingTop: 100 }}><div className="spinner" /></div>}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
