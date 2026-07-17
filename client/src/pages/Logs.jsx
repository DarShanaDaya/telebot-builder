import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, apiError } from '../api';

const LEVELS = ['all', 'info', 'warn', 'error'];

export default function Logs() {
  const { botId } = useParams();
  const [bot, setBot] = useState(null);
  const [logs, setLogs] = useState(null);
  const [level, setLevel] = useState('all');
  const [expanded, setExpanded] = useState(null);
  const bottomRef = useRef(null);

  const load = useCallback(() => {
    Promise.all([api.get(`/bots/${botId}`), api.get(`/bots/${botId}/logs`, { params: { level, limit: 250 } })])
      .then(([b, l]) => {
        setBot(b.data.bot);
        setLogs([...l.data.logs].reverse());
      })
      .catch(() => {});
  }, [botId, level]);

  useEffect(() => {
    setLogs(null);
    load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  const clear = async () => {
    if (!confirm('Clear all logs for this bot?')) return;
    await api.delete(`/bots/${botId}/logs`);
    setLogs([]);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link to="/" className="back-link">← Bots</Link>
          <h1>Logs — {bot?.name || '…'}</h1>
          <p className="muted">Runtime events, errors and node-level tracing. Auto-refreshes every 4s.</p>
        </div>
        <div className="row-gap">
          {LEVELS.map((l) => (
            <button key={l} className={`btn ghost sm ${level === l ? 'active' : ''}`} onClick={() => setLevel(l)}>
              {l}
            </button>
          ))}
          <button className="btn danger sm" onClick={clear}>Clear</button>
        </div>
      </div>
      {logs === null ? (
        <div className="full-center tall"><div className="spinner" /></div>
      ) : logs.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">📜</span>
          <h2>No logs yet</h2>
          <p className="muted">Deploy the bot and send it a message — every step is traced here.</p>
        </div>
      ) : (
        <div className="log-stream">
          {logs.map((l) => (
            <div key={l.id} className={`log-line ${l.level} ${expanded === l.id ? 'open' : ''}`} onClick={() => setExpanded(expanded === l.id ? null : l.id)}>
              <span className="log-time">{new Date(l.created_at).toLocaleTimeString()}</span>
              <span className={`log-level ${l.level}`}>{l.level}</span>
              {l.chat_id && <span className="log-chat mono">…{String(l.chat_id).slice(-6)}</span>}
              <span className="log-msg">{l.message}</span>
              {expanded === l.id && l.data && <pre className="json-preview">{JSON.stringify(JSON.parse(l.data), null, 2)}</pre>}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
