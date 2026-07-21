import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { admin, apiError } from '../api';
import AdminTabs from '../components/AdminTabs';

export default function AdminBots() {
  const navigate = useNavigate();
  const [bots, setBots] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { setBots((await admin.listBots()).bots); } catch (err) { setError(apiError(err)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const remove = async (bot) => {
    if (!window.confirm(`Delete bot "${bot.name}" (owner ${bot.owner_email})? This also removes its sessions and logs.`)) return;
    setBusy(true); setError('');
    try { await admin.deleteBot(bot.id); await load(); } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Admin · Bots</h1>
          <p className="muted">Every bot across all accounts. View developments and content, edit or delete.</p>
        </div>
      </div>
      <AdminTabs active="bots" />
      {error && <p className="form-error">{error}</p>}
      <div className="panel">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Name</th><th>Owner</th><th>Username</th><th>Mode</th><th>Status</th><th>Nodes</th><th /></tr></thead>
            <tbody>
              {bots.map((b) => (
                <tr key={b.id}>
                  <td><a className="link" onClick={() => navigate(`/admin/bots/${b.id}`)}>{b.name}</a></td>
                  <td className="muted">{b.owner_email}</td>
                  <td className="muted">{b.username || '—'}</td>
                  <td>{b.mode}</td>
                  <td><span className={`pill ${b.live?.running ? 'ok' : ''}`}>{b.status}</span></td>
                  <td className="muted">{b.draft_nodes}{b.published_nodes ? ` / ${b.published_nodes} pub` : ''}</td>
                  <td><button className="btn danger sm" disabled={busy} onClick={() => remove(b)}>Delete</button></td>
                </tr>
              ))}
              {!bots.length && <tr><td colSpan={7} className="muted">No bots yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
