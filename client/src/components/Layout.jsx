import { Suspense, useEffect, useRef, useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/auth';
import { LayoutDashboard, Columns3, List, LogOut, Settings, FileText, Bot } from 'lucide-react';
import { toast } from '../services/toast';
import { errorMessage } from '../services/api';
import { Menu, X } from 'lucide-react';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/board', label: 'Kanban Board', icon: Columns3 },
  { to: '/applications', label: 'Applications', icon: List },
  { to: '/resume', label: 'Resume', icon: FileText },
  { to: '/copilot', label: 'Copilot', icon: Bot },
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

  // Below 768px the sidebar becomes a drawer opened from the top bar.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef(null);
  const sidebarRef = useRef(null);

  const handleLogout = () => { logout(); navigate('/login'); };

  const closeMenu = () => {
    if (!menuOpen) return;
    setMenuOpen(false);
    menuButtonRef.current?.focus();
  };

  useEffect(() => {
    if (!menuOpen) return;
    sidebarRef.current?.querySelector('a')?.focus();
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    // Widening past the breakpoint shows the normal sidebar, so drop the drawer state.
    const wide = window.matchMedia('(min-width: 769px)');
    const onWide = (e) => { if (e.matches) setMenuOpen(false); };
    document.addEventListener('keydown', onKeyDown);
    wide.addEventListener('change', onWide);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      wide.removeEventListener('change', onWide);
    };
  }, [menuOpen]);

  return (
    <div className="layout">
      <header className="mobile-topbar">
        <div className="logo">
          <div className="logo-icon">📋</div>
          <span>HireBoard</span>
        </div>
        <button
          ref={menuButtonRef}
          className="btn-icon"
          aria-label="Menu"
          aria-expanded={menuOpen}
          aria-controls="app-sidebar"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </header>
      {menuOpen && <div className="sidebar-backdrop" aria-hidden="true" onClick={closeMenu} />}
      <aside id="app-sidebar" ref={sidebarRef} className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="logo">
          <div className="logo-icon">📋</div>
          <span>HireBoard</span>
        </div>
        <nav className="nav-links">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} onClick={closeMenu} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
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
      {/* inert keeps Tab inside the top bar and drawer while the drawer is open. */}
      <main className="main-content" inert={menuOpen}>
        {user?.isDemo && <DemoBanner />}
        {/* Keeps the sidebar on screen while the next page's code loads. */}
        <Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', paddingTop: 100 }}><div className="spinner" /></div>}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
