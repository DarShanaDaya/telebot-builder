import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const handleLogout = () => {
    logout();
    navigate('/auth');
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">🤖</span>
          <span className="brand-name">Telebot<br />Builder</span>
        </div>
        <nav className="side-nav">
          <NavLink to="/" end className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}>
            <span>🗂️</span> My Bots
          </NavLink>
          <NavLink to="/credentials" className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}>
            <span>🔑</span> Credentials
          </NavLink>
        </nav>
        <div className="side-footer">
          <div className="user-chip">
            <div className="avatar">{(user?.name || user?.email || '?')[0].toUpperCase()}</div>
            <div className="user-meta">
              <strong>{user?.name}</strong>
              <span className="muted">{user?.email}</span>
            </div>
          </div>
          <button className="btn ghost sm block" onClick={handleLogout}>Sign out</button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
