import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { admin, apiError } from '../api';
import AdminTabs from '../components/AdminTabs';

export default function AdminBotDetail() {
  const { botId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [name, setName] = useState('');
  const [mode, setMode] = useState('polling');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await admin.getBot(botId);
      setData(res);
      setName(res.bot.name || '');
      setMode(res.bot.mode || 'polling');
    } catch (err) { setError(apiError(err)); }
  }, [botId]);
  useEffect(() => { load(); }, [load]);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await admin.updateBot(botId, { name, mode }); await load(); } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!window.confirm(`Delete bot "${data.bot.name}"? This removes its sessions and logs too.`)) return;
    setBusy(true); setError('');
    try { await admin.deleteBot(botId); navigate('/admin/bots'); } catch (err) { setError(apiError(err)); setBusy(false); }
  };

  if (!data) {
    return <div className="page"><AdminTabs active="bots" />{error && <p className="form-error">{error}</p>}<p className="muted">Loading…</p></div>;
  }
  const { bot } = data;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <button className="btn ghost sm" onClick={() => navigate('/admin/bots')}>← All bots</button>
          <h1>{bot.name}</h1>
          <p className="muted">Owner {bot.owner_email} · {bot.username || 'no username'} · created {new Date(bot.created_at).toLocaleString()}</p>
        </div>
        <button className="btn danger sm" disabled={busy} onClick={remove}>Delete bot</button>
      </div>
      <AdminTabs active="bots" />
      {error && <p className="form-error">{error}</p>}

      <div className="panel">
        <h3>Settings</h3>
        <form className="inline-form" onSubmit={save}>
          <label className="field"><span className="field-label">Name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field"><span className="field-label">Connection mode</span>
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="polling">Polling</option>
              <option value="webhook">Webhook</option>
            </select>
          </label>
          <button className="btn primary sm" disabled={busy}>Save</button>
        </form>
        {bot.last_error && <p className="field-hint">Last error: {bot.last_error}</p>}
      </div>

      <div className="panel">
        <h3>Status & content</h3>
        <ul className="muted" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Runtime status: <span className={`pill ${bot.live?.running ? 'ok' : ''}`}>{bot.status}</span> {bot.live?.running && <span className="muted">since {new Date(bot.live.startedAt).toLocaleString()}</span>}</li>
          <li>Draft flow nodes: {bot.draft_nodes}{bot.published_nodes ? ` · Published nodes: ${bot.published_nodes}` : ' · Not published'}</li>
          <li>Active sessions: {data.sessions_count}</li>
          <li>Stored logs: {data.logs_count}</li>
        </ul>
        <div className="row-actions" style={{ marginTop: 12 }}>
          {bot.published_nodes > 0 && <button className="btn ghost sm" onClick={() => navigate(`/bots/${bot.id}/sessions`)}>View sessions</button>}
          {bot.published_nodes > 0 && <button className="btn ghost sm" onClick={() => navigate(`/bots/${bot.id}/logs`)}>View logs</button>}
          <button className="btn ghost sm" onClick={() => navigate(`/bots/${bot.id}/builder`)}>Open builder</button>
        </div>
      </div>
    </div>
  );
}
