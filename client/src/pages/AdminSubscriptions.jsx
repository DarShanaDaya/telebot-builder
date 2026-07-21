import { useCallback, useEffect, useState } from 'react';
import { admin, apiError } from '../api';
import AdminTabs from '../components/AdminTabs';

const EMPTY_MAIN = {
  enabled: true,
  name: '',
  description: '',
  duration_value: 30,
  duration_unit: 'days',
  price_stars: 500,
  price_fiat_amount: '',
  price_fiat_currency: 'USD',
  crypto_currency: 'usdttrc20',
  is_lifetime: false,
};

function MainSubscriptionForm() {
  const [form, setForm] = useState(EMPTY_MAIN);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const { subscription } = await admin.getMainSubscription();
      if (subscription) setForm((prev) => ({ ...prev, ...subscription, price_fiat_amount: subscription.price_fiat_amount ?? '' }));
    } catch (err) { setError(apiError(err)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = (key, value) => { setForm((cur) => ({ ...cur, [key]: value })); setSaved(false); };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const payload = {
        ...form,
        duration_value: form.is_lifetime ? undefined : Number(form.duration_value),
        price_stars: Number(form.price_stars),
        price_fiat_amount: form.price_fiat_amount === '' ? undefined : Number(form.price_fiat_amount),
        enabled: Boolean(form.enabled),
      };
      await admin.saveMainSubscription(payload);
      setSaved(true);
    } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  };

  return (
    <form className="panel" onSubmit={submit}>
      <h3>Platform main subscription</h3>
      <p className="muted">This offer is configured by an admin and shown to every user as the platform's primary subscription. Enable it and set the terms below.</p>
      <label className="check-row"><input type="checkbox" checked={Boolean(form.enabled)} onChange={(e) => set('enabled', e.target.checked)} /> Enabled (visible to users)</label>
      <label className="field"><span className="field-label">Name</span><input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Platform Pro" required /></label>
      <label className="field"><span className="field-label">Description</span><input value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Full access to the platform community" /></label>
      <div className="form-grid">
        {!form.is_lifetime && <label className="field"><span className="field-label">Duration</span><input type="number" min="1" value={form.duration_value} onChange={(e) => set('duration_value', e.target.value)} required /></label>}
        {!form.is_lifetime && <label className="field"><span className="field-label">Unit</span><select value={form.duration_unit} onChange={(e) => set('duration_unit', e.target.value)}><option value="days">Days</option><option value="weeks">Weeks</option><option value="months">Months</option></select></label>}
        <label className="field"><span className="field-label">Price in Telegram Stars</span><input type="number" min="1" max="10000" value={form.price_stars} onChange={(e) => set('price_stars', e.target.value)} required /></label>
        <label className="field"><span className="field-label">Crypto price <em>(optional)</em></span><input type="number" min="0.01" step="0.01" value={form.price_fiat_amount} onChange={(e) => set('price_fiat_amount', e.target.value)} placeholder="10.00" /></label>
        <label className="field"><span className="field-label">Crypto currency</span><input value={form.crypto_currency} onChange={(e) => set('crypto_currency', e.target.value)} placeholder="usdttrc20" /></label>
      </div>
      <label className="check-row"><input type="checkbox" checked={Boolean(form.is_lifetime)} onChange={(e) => set('is_lifetime', e.target.checked)} /> Lifetime access</label>
      {error && <p className="form-error">{error}</p>}
      {saved && !error && <p className="pill ok" style={{ display: 'inline-block' }}>Saved ✓</p>}
      <div><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save main subscription'}</button></div>
    </form>
  );
}

function ChatRow({ chat, onChanged }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const toggle = async () => {
    if (open) { setOpen(false); return; }
    setBusy(true); setError('');
    try { setDetail(await admin.getSubscriptionChat(chat.id)); setOpen(true); } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  };

  const togglePlan = async (plan) => {
    setBusy(true); setError('');
    try { await admin.updatePlan(plan.id, { active: !plan.active }); await toggle(); } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  };
  const deletePlan = async (plan) => {
    if (!window.confirm('Deactivate this plan?')) return;
    setBusy(true); setError('');
    try { await admin.deletePlan(plan.id); await toggle(); } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  };
  const deleteChat = async () => {
    if (!window.confirm(`Delete chat "${chat.title || chat.telegram_chat_id}" and all plans/subscribers?`)) return;
    setBusy(true); setError('');
    try { await admin.deleteSubscriptionChat(chat.id); setOpen(false); onChanged(); } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  };

  return (
    <>
      <tr>
        <td><button className="link" onClick={toggle}>{open ? '▾' : '▸'} {chat.title || '—'}</button></td>
        <td className="muted">{chat.owner_email}</td>
        <td className="muted">{chat.telegram_chat_id}</td>
        <td>{chat.chat_type}</td>
        <td><span className="pill">{chat.status}</span></td>
        <td>{chat.plans_count}</td>
        <td><button className="btn danger sm" disabled={busy} onClick={deleteChat}>Delete</button></td>
      </tr>
      {open && detail && (
        <tr>
          <td colSpan={7}>
            <div style={{ padding: '8px 4px' }}>
              {error && <p className="form-error">{error}</p>}
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Plan</th><th>Duration</th><th>Price</th><th>Status</th><th /></tr></thead>
                  <tbody>
                    {detail.plans.map((p) => (
                      <tr key={p.id}>
                        <td><strong>{p.name}</strong></td>
                        <td>{p.is_lifetime ? 'Lifetime' : `${p.duration_value} ${p.duration_unit}`}</td>
                        <td>{p.price_stars} ⭐</td>
                        <td><span className={`pill ${p.active ? 'ok' : ''}`}>{p.active ? 'active' : 'inactive'}</span></td>
                        <td>
                          <div className="row-actions">
                            <button className="btn ghost sm" disabled={busy} onClick={() => togglePlan(p)}>{p.active ? 'Deactivate' : 'Activate'}</button>
                            <button className="btn danger sm" disabled={busy} onClick={() => deletePlan(p)}>Delete</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!detail.plans.length && <tr><td colSpan={5} className="muted">No plans.</td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="muted" style={{ marginTop: 8 }}>{detail.entitlements.length} subscriber(s) · {detail.payments.length} payment(s)</p>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function AdminSubscriptions() {
  const [chats, setChats] = useState([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { setChats((await admin.listSubscriptions()).chats); } catch (err) { setError(apiError(err)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Admin · Subscriptions</h1>
          <p className="muted">Configure the platform main subscription and manage every user's subscription chats.</p>
        </div>
      </div>
      <AdminTabs active="subscriptions" />
      {error && <p className="form-error">{error}</p>}
      <MainSubscriptionForm />

      <h2 className="section-title">All managed chats · {chats.length}</h2>
      <div className="panel">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Chat</th><th>Owner</th><th>Chat ID</th><th>Type</th><th>Status</th><th>Plans</th><th /></tr></thead>
            <tbody>
              {chats.map((c) => <ChatRow key={c.id} chat={c} onChanged={load} />)}
              {!chats.length && <tr><td colSpan={7} className="muted">No managed subscription chats yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
