import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { admin, apiError } from '../api';
import AdminTabs from '../components/AdminTabs';

export default function AdminUsers() {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { setUsers((await admin.listUsers()).users); } catch (err) { setError(apiError(err)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggleAdmin = async (user) => {
    setBusy(true); setError('');
    try {
      await admin.updateUser(user.id, { is_admin: !user.is_admin });
      await load();
    } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  };

  const remove = async (user) => {
    if (!window.confirm(`Delete account ${user.email} and ALL of its bots, credentials and subscription data? This cannot be undone.`)) return;
    setBusy(true); setError('');
    try { await admin.deleteUser(user.id); await load(); } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Admin · Accounts</h1>
          <p className="muted">View, edit and delete any user account and its content.</p>
        </div>
      </div>
      <AdminTabs active="users" />
      {error && <p className="form-error">{error}</p>}
      <div className="panel">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Email</th><th>Name</th><th>Role</th><th>Bots</th><th>Credentials</th><th>Sub chats</th><th>Joined</th><th /></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td><a className="link" onClick={() => navigate(`/admin/users/${u.id}`)}>{u.email}</a></td>
                  <td>{u.name}</td>
                  <td>{u.is_admin ? <span className="badge admin">admin</span> : <span className="badge">user</span>}</td>
                  <td>{u.counts.bots}</td>
                  <td>{u.counts.credentials}</td>
                  <td>{u.counts.subscription_chats}</td>
                  <td className="nowrap muted">{new Date(u.created_at).toLocaleDateString()}</td>
                  <td>
                    <div className="row-actions">
                      <button className="btn ghost sm" onClick={() => navigate(`/admin/users/${u.id}`)}>View</button>
                      <button className="btn ghost sm" disabled={busy} onClick={() => toggleAdmin(u)}>{u.is_admin ? 'Demote' : 'Promote'}</button>
                      <button className="btn danger sm" disabled={busy} onClick={() => remove(u)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!users.length && <tr><td colSpan={8} className="muted">No accounts found.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
