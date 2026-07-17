import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, apiError } from '../api';

const STATUS_LABEL = {
  idle: 'idle',
  awaiting_input: '⌨️ waiting for input',
  awaiting_callback: '🔘 waiting for button',
  ended: '🏁 ended',
};

function JsonPreview({ obj }) {
  return <pre className="json-preview">{JSON.stringify(obj, null, 2)}</pre>;
}

export default function Sessions() {
  const { botId } = useParams();
  const [bot, setBot] = useState(null);
  const [sessions, setSessions] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    Promise.all([api.get(`/bots/${botId}`), api.get(`/bots/${botId}/sessions`)])
      .then(([b, s]) => {
        setBot(b.data.bot);
        setSessions(s.data.sessions);
      })
      .catch((err) => setError(apiError(err)));
  }, [botId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const reset = async (chatId) => {
    await api.delete(`/bots/${botId}/sessions/${chatId}`);
    setSessions((ss) => ss.filter((s) => s.chat_id !== chatId));
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link to="/" className="back-link">← Bots</Link>
          <h1>Sessions — {bot?.name || '…'}</h1>
          <p className="muted">Live per-chat state: current node, variables and pending actions. Auto-refreshes every 5s.</p>
        </div>
        <Link className="btn primary sm" to={`/bots/${botId}/builder`}>Open builder</Link>
      </div>
      {error && <p className="form-error">{error}</p>}
      {sessions === null ? (
        <div className="full-center tall"><div className="spinner" /></div>
      ) : sessions.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">👥</span>
          <h2>No sessions yet</h2>
          <p className="muted">Sessions appear here as soon as people start chatting with your deployed bot.</p>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Chat</th>
              <th>User</th>
              <th>Status</th>
              <th>Node</th>
              <th>Variables</th>
              <th>Last active</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <FragmentRow
                key={s.id}
                s={s}
                expanded={expanded === s.id}
                onToggle={() => setExpanded(expanded === s.id ? null : s.id)}
                onReset={() => reset(s.chat_id)}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function FragmentRow({ s, expanded, onToggle, onReset }) {
  const varCount = Object.keys(s.variables || {}).filter((k) => k !== 'text').length;
  return (
    <>
      <tr className="clickable" onClick={onToggle}>
        <td className="mono">…{String(s.chat_id).slice(-8)}</td>
        <td>{s.user?.first_name || '—'} {s.user?.username && <span className="muted">@{s.user.username}</span>}</td>
        <td><span className={`pill session-${s.status}`}>{STATUS_LABEL[s.status] || s.status}</span></td>
        <td className="mono">{s.node_id || '—'}</td>
        <td>{varCount} var{varCount === 1 ? '' : 's'}</td>
        <td className="muted">{new Date(s.last_activity).toLocaleString()}</td>
        <td onClick={(e) => e.stopPropagation()}>
          <button className="btn ghost sm" title="Delete state — user starts fresh" onClick={onReset}>Reset</button>
        </td>
      </tr>
      {expanded && (
        <tr className="expand-row">
          <td colSpan={7}>
            <div className="session-detail">
              <div>
                <h4>Variables</h4>
                <JsonPreview obj={s.variables} />
              </div>
              <div>
                <h4>Pending</h4>
                <JsonPreview obj={s.pending} />
              </div>
              <div>
                <h4>Telegram user</h4>
                <JsonPreview obj={s.user} />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
