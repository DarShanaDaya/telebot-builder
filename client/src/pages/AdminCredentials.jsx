import { useCallback, useEffect, useState } from 'react';
import { admin, apiError } from '../api';
import AdminTabs from '../components/AdminTabs';

export default function AdminCredentials() {
  const [credentials, setCredentials] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { setCredentials((await admin.listCredentials()).credentials); } catch (err) { setError(apiError(err)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const remove = async (cred) => {
    if (!window.confirm(`Delete credential "${cred.name}" (owner ${cred.owner_email})?`)) return;
    setBusy(true); setError('');
    try { await admin.deleteCredential(cred.id); await load(); } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Admin · Credentials</h1>
          <p className="muted">Stored action credentials across all accounts. Secrets are masked and never exposed.</p>
        </div>
      </div>
      <AdminTabs active="credentials" />
      {error && <p className="form-error">{error}</p>}
      <div className="panel">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Name</th><th>Owner</th><th>Type</th><th>Masked secret</th><th /></tr></thead>
            <tbody>
              {credentials.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td className="muted">{c.owner_email}</td>
                  <td>{c.type}</td>
                  <td className="muted">{Object.entries(c.masked || {}).map(([k, v]) => `${k}: ${v}`).join('  ·  ')}</td>
                  <td><button className="btn danger sm" disabled={busy} onClick={() => remove(c)}>Delete</button></td>
                </tr>
              ))}
              {!credentials.length && <tr><td colSpan={5} className="muted">No credentials yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
