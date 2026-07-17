import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiError } from '../api';

function NewBotModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [mode, setMode] = useState('polling');
  const [check, setCheck] = useState(null); // {ok, bot?, error?}
  const [checking, setChecking] = useState(false);
  const [skipValidation, setSkipValidation] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const validateToken = async () => {
    setChecking(true);
    setCheck(null);
    try {
      const { data } = await api.post('/bots/validate-token', { token: token.trim() });
      setCheck(data);
      if (data.ok && !name) setName(data.bot.name || `@${data.bot.username}`);
    } catch (err) {
      setCheck({ ok: false, error: apiError(err) });
    } finally {
      setChecking(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/bots', { name: name.trim(), token: token.trim(), mode, skipValidation: skipValidation || check?.ok === false });
      onCreated(data.bot);
    } catch (err) {
      setError(apiError(err));
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Add a new bot</h3>
        <p className="muted">Create a bot with <b>@BotFather</b> on Telegram, then paste the token here.</p>
        <form onSubmit={submit}>
          <label className="field">
            <span className="field-label">BotFather token</span>
            <div className="join">
              <input value={token} onChange={(e) => { setToken(e.target.value); setCheck(null); }} placeholder="123456789:AAE…" required />
              <button type="button" className="btn ghost sm" disabled={!token.trim() || checking} onClick={validateToken}>
                {checking ? '…' : 'Check'}
              </button>
            </div>
          </label>
          {check?.ok && <p className="form-ok">✅ Connected to <b>@{check.bot.username}</b> ({check.bot.name})</p>}
          {check && !check.ok && <p className="form-error">{check.error}</p>}
          <label className="field">
            <span className="field-label">Display name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My awesome bot" required />
          </label>
          <label className="field">
            <span className="field-label">Connection mode</span>
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="polling">Long polling (no public URL needed)</option>
              <option value="webhook">Webhook (requires PUBLIC_BASE_URL on server)</option>
            </select>
          </label>
          {check && !check.ok && (
            <label className="check-row">
              <input type="checkbox" checked={skipValidation} onChange={(e) => setSkipValidation(e.target.checked)} />
              Telegram unreachable — save anyway
            </label>
          )}
          {error && <p className="form-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={busy || (check && !check.ok && !skipValidation)}>
              {busy ? 'Creating…' : 'Create bot'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SettingsModal({ bot, onClose, onUpdated, onDeleted }) {
  const [name, setName] = useState(bot.name);
  const [mode, setMode] = useState(bot.mode);
  const [newToken, setNewToken] = useState('');
  const [confirmDelete, setConfirmDelete] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const payload = { name: name.trim(), mode };
      if (newToken.trim()) payload.token = newToken.trim();
      const { data } = await api.patch(`/bots/${bot.id}`, payload);
      onUpdated(data.bot);
    } catch (err) {
      setError(apiError(err));
      setBusy(false);
    }
  };

  const destroy = async () => {
    setBusy(true);
    try {
      await api.delete(`/bots/${bot.id}`);
      onDeleted(bot.id);
    } catch (err) {
      setError(apiError(err));
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Bot settings</h3>
        <form onSubmit={save}>
          <label className="field">
            <span className="field-label">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="field">
            <span className="field-label">Connection mode {bot.status === 'running' && <em>(stop the bot to change)</em>}</span>
            <select value={mode} onChange={(e) => setMode(e.target.value)} disabled={bot.status === 'running'}>
              <option value="polling">Long polling</option>
              <option value="webhook">Webhook</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Rotate token (optional)</span>
            <input value={newToken} onChange={(e) => setNewToken(e.target.value)} placeholder="Paste a new BotFather token" disabled={bot.status === 'running'} />
          </label>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
        <div className="danger-zone">
          <h4>Danger zone</h4>
          <p className="muted">Deletes the bot, its sessions and logs. Type <b>{bot.name}</b> to confirm.</p>
          <div className="join">
            <input value={confirmDelete} onChange={(e) => setConfirmDelete(e.target.value)} placeholder={bot.name} />
            <button className="btn danger" disabled={confirmDelete !== bot.name || busy} onClick={destroy}>Delete</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BotCard({ bot, onDeploy, onStop, onSettings, busyId }) {
  const busy = busyId === bot.id;
  const running = bot.live?.running;
  return (
    <div className="bot-card">
      <div className="bot-card-head">
        <span className={`status-dot ${running ? 'on' : bot.last_error ? 'err' : 'off'}`} />
        <div className="bot-card-title">
          <strong>{bot.name}</strong>
          <span className="muted">{bot.username ? `@${bot.username}` : 'token not verified'}</span>
        </div>
        <button className="icon-btn" title="Settings" onClick={() => onSettings(bot)}>⚙️</button>
      </div>
      {bot.last_error && <p className="bot-error">⚠️ {bot.last_error}</p>}
      <div className="bot-card-meta">
        <span className="pill">{bot.mode}</span>
        <span className={`pill ${running ? 'ok' : ''}`}>{running ? 'running' : 'stopped'}</span>
        {!bot.published_at && <span className="pill warn">unpublished</span>}
      </div>
      <div className="bot-card-actions">
        <Link className="btn primary sm" to={`/bots/${bot.id}/builder`}>🎛 Builder</Link>
        {running
          ? <button className="btn ghost sm" disabled={busy} onClick={() => onStop(bot)}>■ Stop</button>
          : <button className="btn ghost sm" disabled={busy} onClick={() => onDeploy(bot)}>▶ Deploy</button>}
        <Link className="btn ghost sm" to={`/bots/${bot.id}/sessions`}>👥 Sessions</Link>
        <Link className="btn ghost sm" to={`/bots/${bot.id}/logs`}>📜 Logs</Link>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [bots, setBots] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [settingsBot, setSettingsBot] = useState(null);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get('/bots').then(({ data }) => setBots(data.bots)).catch((err) => setError(apiError(err)));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  const deploy = async (bot) => {
    setBusyId(bot.id);
    try {
      const { data } = await api.post(`/bots/${bot.id}/deploy`);
      setBots((bs) => bs.map((b) => (b.id === bot.id ? data.bot : b)));
    } catch (err) {
      alert(apiError(err));
      load();
    } finally {
      setBusyId('');
    }
  };

  const stop = async (bot) => {
    setBusyId(bot.id);
    try {
      const { data } = await api.post(`/bots/${bot.id}/stop`);
      setBots((bs) => bs.map((b) => (b.id === bot.id ? data.bot : b)));
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>My Bots</h1>
          <p className="muted">Create, design and deploy Telegram bots. Bots with “running” badge are live right now.</p>
        </div>
        <button className="btn primary" onClick={() => setShowNew(true)}>+ New bot</button>
      </div>
      {error && <p className="form-error">{error}</p>}
      {bots === null ? (
        <div className="full-center tall"><div className="spinner" /></div>
      ) : bots.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">🤖</span>
          <h2>No bots yet</h2>
          <p className="muted">Grab a token from <b>@BotFather</b> on Telegram and build your first bot — no code needed.</p>
          <button className="btn primary" onClick={() => setShowNew(true)}>Create your first bot</button>
        </div>
      ) : (
        <div className="bot-grid">
          {bots.map((b) => (
            <BotCard key={b.id} bot={b} onDeploy={deploy} onStop={stop} onSettings={setSettingsBot} busyId={busyId} />
          ))}
        </div>
      )}

      {showNew && (
        <NewBotModal
          onClose={() => setShowNew(false)}
          onCreated={(bot) => {
            setShowNew(false);
            setBots((bs) => [bot, ...(bs || [])]);
          }}
        />
      )}
      {settingsBot && (
        <SettingsModal
          bot={settingsBot}
          onClose={() => setSettingsBot(null)}
          onUpdated={(bot) => {
            setBots((bs) => bs.map((b) => (b.id === bot.id ? bot : b)));
            setSettingsBot(null);
          }}
          onDeleted={(id) => {
            setBots((bs) => bs.filter((b) => b.id !== id));
            setSettingsBot(null);
          }}
        />
      )}
    </div>
  );
}
