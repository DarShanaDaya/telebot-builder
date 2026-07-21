import { NavLink } from 'react-router-dom';

const TABS = [
  { id: 'users', to: '/admin/users', label: '👥 Accounts' },
  { id: 'bots', to: '/admin/bots', label: '🤖 Bots' },
  { id: 'credentials', to: '/admin/credentials', label: '🔑 Credentials' },
  { id: 'subscriptions', to: '/admin/subscriptions', label: '💳 Subscriptions' },
];

export default function AdminTabs({ active }) {
  return (
    <nav className="admin-tabs">
      {TABS.map((t) => (
        <NavLink key={t.id} to={t.to} className={`admin-tab ${active === t.id ? 'active' : ''}`}>
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
