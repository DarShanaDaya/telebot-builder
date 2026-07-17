import { useEffect, useState } from 'react';
import { api, apiError } from '../api';

// Fields rendered per credential type; `secret` fields are password inputs and
// are left blank on edit to keep the existing value.
const TYPE_FIELDS = {
  bearer: [{ key: 'token', label: 'Token', secret: true }],
  apikey: [
    { key: 'key', label: 'API key', secret: true },
    { key: 'headerName', label: 'Header name (e.g. X-API-Key)', secret: false },
    { key: 'queryParam', label: '…or query param name', secret: false },
  ],
  basic: [
    { key: 'username', label: 'Username', secret: false },
    { key: 'password', label: 'Password', secret: true },
  ],
  openai: [
    { key: 'apiKey', label: 'API key (sk-…)', secret: true },
    { key: 'model', label: 'Default model', secret: false, placeholder: 'gpt-4o-mini' },
    { key: 'baseUrl', label: 'Base URL (optional, for proxies)', secret: false, placeholder: 'https://api.openai.com' },
  ],
};

const TYPE_ICONS = { bearer: '🎟️', apikey: '🗝️', basic: '🔐', openai: '🤖' };

function CredentialModal({ existing, onClose, onSaved }) {
  const [name, setName] = useState(existing?.name || '');
  const [type, setType] = useState(existing?.type || 'bearer');
  const [values, setValues] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fields = TYPE_FIELDS[type] || [];

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (existing) {
        const { data } = await api.put(`/credentials/${existing.id}`, { name: name.trim(), data: values });
        onSaved(data.credential, true);
      } else {
        const { data } = await api.post('/credentials', { name: name.trim(), type, data: values });
        onSaved(data.credential, false);
      }
    } catch (err) {
      setError(apiError(err));
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{existing ? 'Edit credential' : 'Add credential'}</h3>
        <p className="muted">Encrypted at rest with AES-256-GCM. Secrets are never shown again after saving.</p>
        <form onSubmit={submit}>
          <label className="field">
            <span className="field-label">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Production API" />
          </label>
          {!existing && (
            <label className="field">
              <span className="field-label">Type</span>
              <select value={type} onChange={(e) => { setType(e.target.value); setValues({}); }}>
                <option value="bearer">🎟️ Bearer token</option>
                <option value="apikey">🗝️ API key</option>
                <option value="basic">🔐 Basic auth</option>
                <option value="openai">🤖 OpenAI</option>
              </select>
            </label>
          )}
          {fields.map((f) => (
            <label className="field" key={f.key}>
              <span className="field-label">
                {f.label}
                {existing && existing.masked[f.key] && <em className="muted"> — current: {existing.masked[f.key]}</em>}
              </span>
              <input
                type={f.secret ? 'password' : 'text'}
                value={values[f.key] || ''}
                placeholder={existing ? '(leave blank to keep current)' : f.placeholder || ''}
                required={!existing && f.secret}
                autoComplete="new-password"
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
            </label>
          ))}
          {error && <p className="form-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save credential'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Credentials() {
  const [items, setItems] = useState(null);
  const [modal, setModal] = useState(null); // {existing} | 'new'
  const [error, setError] = useState('');

  const load = () => api.get('/credentials').then(({ data }) => setItems(data.credentials)).catch((err) => setError(apiError(err)));
  useEffect(() => { load(); }, []);

  const remove = async (cred) => {
    if (!confirm(`Delete credential "${cred.name}"? Nodes referencing it will fail at runtime.`)) return;
    await api.delete(`/credentials/${cred.id}`);
    setItems((xs) => xs.filter((c) => c.id !== cred.id));
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Credentials</h1>
          <p className="muted">API keys and tokens your flows can use in HTTP Request and AI nodes.</p>
        </div>
        <button className="btn primary" onClick={() => setModal('new')}>+ Add credential</button>
      </div>
      {error && <p className="form-error">{error}</p>}
      {items === null ? (
        <div className="full-center tall"><div className="spinner" /></div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">🔑</span>
          <h2>No credentials yet</h2>
          <p className="muted">Store API keys once, reuse them across every bot flow.</p>
          <button className="btn primary" onClick={() => setModal('new')}>Add your first credential</button>
        </div>
      ) : (
        <div className="cred-list">
          {items.map((c) => (
            <div className="cred-row" key={c.id}>
              <span className="cred-icon">{TYPE_ICONS[c.type] || '🔑'}</span>
              <div className="cred-meta">
                <strong>{c.name}</strong>
                <span className="muted mono">
                  {Object.entries(c.masked).filter(([, v]) => v).map(([k, v]) => `${k}: ${String(v).slice(0, 24)}`).join('   ')}
                </span>
              </div>
              <span className="pill">{c.type}</span>
              <button className="btn ghost sm" onClick={() => setModal({ existing: c })}>Edit</button>
              <button className="icon-btn" title="Delete" onClick={() => remove(c)}>🗑</button>
            </div>
          ))}
        </div>
      )}
      {modal && (
        <CredentialModal
          existing={modal === 'new' ? null : modal.existing}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            load();
          }}
        />
      )}
    </div>
  );
}
