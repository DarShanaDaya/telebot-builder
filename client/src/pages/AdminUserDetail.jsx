import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { admin, apiError } from '../api';
import AdminTabs from '../components/AdminTabs';

export default function AdminUserDetail() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await admin.getUser(userId);
      setData(res);
      setName(res.user.name || '');
    } catch (err) { setError(apiError(err)); }
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  const saveName = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await admin.updateUser(userId, { name }); await load(); } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  };

  const toggleAdmin = async () => {
    setBusy(true); setError('');
    try { await admin.updateUser(userId, { is_admin: !data.user.is_admin }); await load(); } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  };

  const removeUser = async () => {
    if (!window.confirm(`Delete ${data.user.email} and ALL their data? This cannot be undone.`)) return;
    setBusy(true); setError('');
    try { await admin.deleteUser(userId); navigate('/admin/users'); } catch (err) { setError(apiError(err)); setBusy(false); }
  };

  const deleteBot = async (bot) => {
    if (!window.confirm(`Delete bot "${bot.name}"?`)) return;
    setBusy(true); setError('');
    try { await admin.deleteBot(bot.id); await load(); } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  };

  const deleteCredential = async (cred) => {
    if (!window.confirm(`Delete credential "${cred.name}"?`)) return;
    setBusy(true); setError('');
    try { await admin.deleteCredential(cred.id); await load(); } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  };

  const deleteChat = async (chat) => {
    if (!window.confirm(`Delete subscription chat "${chat.title || chat.telegram_chat_id}" and all its plans/subscribers?`)) return;
    setBusy(true); setError('');
    try { await admin.deleteSubscriptionChat(chat.id); await load(); } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  };

  if (!data) {
    return <div className="page"><AdminTabs active="users" />{error && <p className="form-error">{error}</p>}<p className="muted">Loading…</p></div>;
  }

  const { user, bots, credentials, subscription_chats: chats } = data;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <button className="btn ghost sm" onClick={() => navigate('/admin/users')}>← All accounts</button>
          <h1>{user.email}</h1>
          <p className="muted">{user.is_admin ? 'Administrator' : 'Standard user'} · joined {new Date(user.created_at).toLocaleString()}</p>
        </div>
        <div className="row-actions">
          <button className="btn ghost sm" disabled={busy} onClick={toggleAdmin}>{user.is_admin ? 'Demote' : 'Promote'}</button>
          <button className="btn danger sm" disabled={busy} onClick={removeUser}>Delete account</button>
        </div>
      </div>
      <AdminTabs active="users" />
      {error && <p className="form-error">{error}</p>}

      <div className="panel">
        <h3>Profile</h3>
        <form className="inline-form" onSubmit={saveName}>
          <label className="field"><span className="field-label">Display name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <button className="btn primary sm" disabled={busy || name === user.name}>Save</button>
        </form>
      </div>

      <h2 className="section-title">Developments · {bots.length} bot{bots.length === 1 ? '' : 's'}</h2>
      <div className="panel">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Name</th><th>Username</th><th>Mode</th><th>Status</th><th>Nodes</th><th /></tr></thead>
            <tbody>
              {bots.map((b) => (
                <tr key={b.id}>
                  <td><a className="link" onClick={() => navigate(`/admin/bots/${b.id}`)}>{b.name}</a></td>
                  <td className="muted">{b.username || '—'}</td>
                  <td>{b.mode}</td>
                  <td><span className={`pill ${b.live?.running ? 'ok' : ''}`}>{b.status}</span></td>
                  <td className="muted">{b.draft_nodes}{b.published_nodes ? ` / ${b.published_nodes} pub` : ''}</td>
                  <td><button className="btn danger sm" disabled={busy} onClick={() => deleteBot(b)}>Delete</button></td>
                </tr>
              ))}
              {!bots.length && <tr><td colSpan={6} className="muted">No bots.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <h2 className="section-title">Content · {credentials.length} credential{credentials.length === 1 ? '' : 's'}</h2>
      <div className="panel">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Name</th><th>Type</th><th>Masked</th><th /></tr></thead>
            <tbody>
              {credentials.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td className="muted">{c.type}</td>
                  <td className="muted">{Object.entries(c.masked || {}).map(([k, v]) => `${k}: ${v}`).join('  ·  ')}</td>
                  <td><button className="btn danger sm" disabled={busy} onClick={() => deleteCredential(c)}>Delete</button></td>
                </tr>
              ))}
              {!credentials.length && <tr><td colSpan={4} className="muted">No credentials.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <h2 className="section-title">Subscriptions · {chats.length} chat{chats.length === 1 ? '' : 's'}</h2>
      <div className="panel">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Title</th><th>Chat ID</th><th>Type</th><th>Status</th><th /></tr></thead>
            <tbody>
              {chats.map((c) => (
                <tr key={c.id}>
                  <td>{c.title || '—'}</td>
                  <td className="muted">{c.telegram_chat_id}</td>
                  <td>{c.chat_type}</td>
                  <td><span className="pill">{c.status}</span></td>
                  <td><button className="btn danger sm" disabled={busy} onClick={() => deleteChat(c)}>Delete</button></td>
                </tr>
              ))}
              {!chats.length && <tr><td colSpan={5} className="muted">No subscription chats.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
