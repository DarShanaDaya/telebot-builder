import { useCallback, useEffect, useState } from 'react';
import { api, apiError } from '../api';

function PlanForm({ chatId, onCreated }) {
  const [form, setForm] = useState({ name: '', description: '', duration_value: 30, duration_unit: 'days', price_stars: 500, price_fiat_amount: '', price_fiat_currency: 'USD', crypto_currency: 'usdttrc20', is_lifetime: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const payload = { ...form, duration_value: form.is_lifetime ? undefined : Number(form.duration_value), price_stars: Number(form.price_stars), price_fiat_amount: form.price_fiat_amount === '' ? undefined : Number(form.price_fiat_amount) };
      const { data } = await api.post(`/subscriptions/chats/${chatId}/plans`, payload);
      onCreated(data.plan);
      setForm({ name: '', description: '', duration_value: 30, duration_unit: 'days', price_stars: 500, price_fiat_amount: '', price_fiat_currency: 'USD', crypto_currency: 'usdttrc20', is_lifetime: false });
    } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  };
  return <form className="panel" onSubmit={submit}>
    <h3>Create a plan</h3>
    <label className="field"><span className="field-label">Name</span><input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="30 days access" required /></label>
    <label className="field"><span className="field-label">Description</span><input value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Premium community access" /></label>
    <div className="form-grid">
      {!form.is_lifetime && <label className="field"><span className="field-label">Duration</span><input type="number" min="1" value={form.duration_value} onChange={(e) => set('duration_value', e.target.value)} required /></label>}
      {!form.is_lifetime && <label className="field"><span className="field-label">Unit</span><select value={form.duration_unit} onChange={(e) => set('duration_unit', e.target.value)}><option value="days">Days</option><option value="weeks">Weeks</option><option value="months">Months</option></select></label>}
      <label className="field"><span className="field-label">Price in Telegram Stars</span><input type="number" min="1" max="10000" value={form.price_stars} onChange={(e) => set('price_stars', e.target.value)} required /></label>
      <label className="field"><span className="field-label">Crypto price <em>(optional)</em></span><input type="number" min="0.01" step="0.01" value={form.price_fiat_amount} onChange={(e) => set('price_fiat_amount', e.target.value)} placeholder="10.00" /></label>
      <label className="field"><span className="field-label">Crypto currency</span><input value={form.crypto_currency} onChange={(e) => set('crypto_currency', e.target.value)} placeholder="usdttrc20" /></label>
    </div>
    <label className="check-row"><input type="checkbox" checked={form.is_lifetime} onChange={(e) => set('is_lifetime', e.target.checked)} /> Lifetime access</label>
    {error && <p className="form-error">{error}</p>}
    <button className="btn primary" disabled={busy}>{busy ? 'Creating…' : 'Create plan'}</button>
  </form>;
}

export default function Subscriptions() {
  const [chats, setChats] = useState([]);
  const [selected, setSelected] = useState(null);
  const [plans, setPlans] = useState([]);
  const [entitlements, setEntitlements] = useState([]);
  const [payments, setPayments] = useState([]);
  const [chatId, setChatId] = useState('');
  const [connection, setConnection] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [grantUser, setGrantUser] = useState('');
  const [grantPlan, setGrantPlan] = useState('');

  const loadChats = useCallback(async () => {
    try { const { data } = await api.get('/subscriptions/chats'); setChats(data.chats); setSelected((current) => current || data.chats[0] || null); } catch (err) { setError(apiError(err)); }
  }, []);
  const loadSelected = useCallback(async (chat) => {
    if (!chat) return;
    try {
      const [plansRes, entitlementsRes, paymentsRes] = await Promise.all([
        api.get(`/subscriptions/chats/${chat.id}/plans`),
        api.get(`/subscriptions/chats/${chat.id}/entitlements`),
        api.get(`/subscriptions/payments?chat_id=${encodeURIComponent(chat.id)}`),
      ]);
      setPlans(plansRes.data.plans); setEntitlements(entitlementsRes.data.entitlements); setPayments(paymentsRes.data.payments);
    } catch (err) { setError(apiError(err)); }
  }, []);
  useEffect(() => { loadChats(); }, [loadChats]);
  useEffect(() => { loadSelected(selected); }, [selected, loadSelected]);

  const createConnection = async () => {
    setBusy(true); setError('');
    try { const { data } = await api.post('/subscriptions/connections'); setConnection(data); } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  };
  const connectChat = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try { await api.post('/subscriptions/chats', { telegram_chat_id: chatId }); setChatId(''); setConnection(null); await loadChats(); } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  };
  const revoke = async (id) => {
    if (!window.confirm('Revoke this member access?')) return;
    try { await api.post(`/subscriptions/entitlements/${id}/revoke`); await loadSelected(selected); } catch (err) { setError(apiError(err)); }
  };
  const grant = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try { await api.post(`/subscriptions/chats/${selected.id}/grant`, { plan_id: grantPlan, telegram_user_id: grantUser }); setGrantUser(''); await loadSelected(selected); } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  };
  const refreshPayment = async (id) => {
    setBusy(true); setError('');
    try { await api.post(`/subscriptions/payments/${id}/refresh`); await loadSelected(selected); } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  };
  const refundPayment = async (id) => {
    if (!window.confirm('Refund this Telegram Stars payment and revoke access?')) return;
    setBusy(true); setError('');
    try { await api.post(`/subscriptions/payments/${id}/refund`); await loadSelected(selected); } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  };

  return <div className="page">
    <div className="page-head"><div><h1>Subscriptions</h1><p className="muted">Connect private Telegram communities, create Stars plans, and manage paid access.</p></div><button className="btn primary" onClick={createConnection} disabled={busy}>🔗 Link Telegram account</button></div>
    {error && <p className="form-error">{error}</p>}
    {connection && <div className="panel connection-panel"><h3>Finish Telegram linking</h3><p className="muted">Open your subscription bot and send this command:</p><code>/connect {connection.code}</code><p className="field-hint">The code expires at {new Date(connection.expires_at).toLocaleString()}.</p><form className="join" onSubmit={connectChat}><input value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="Private chat ID, e.g. -1001234567890" required /><button className="btn primary" disabled={busy}>Verify and connect</button></form></div>}
    {!chats.length ? <div className="empty-state"><span className="empty-icon">🔒</span><h2>No managed communities</h2><p className="muted">Link your Telegram account, add the system bot as an administrator, then enter the chat ID.</p></div> : <>
      <div className="subscription-layout">
        <div className="panel"><h3>Managed communities</h3>{chats.map((chat) => <button key={chat.id} className={`chat-choice ${selected?.id === chat.id ? 'selected' : ''}`} onClick={() => setSelected(chat)}><strong>{chat.title || chat.telegram_chat_id}</strong><span className="muted">{chat.chat_type} · {chat.telegram_chat_id}</span></button>)}</div>
        {selected && <div className="subscription-main"><PlanForm chatId={selected.id} onCreated={(plan) => setPlans((items) => [plan, ...items])} /><div className="panel"><h3>Plans</h3>{plans.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Name</th><th>Duration</th><th>Price</th><th>Status</th></tr></thead><tbody>{plans.map((plan) => <tr key={plan.id}><td><strong>{plan.name}</strong><br /><span className="muted">{plan.id}</span></td><td>{plan.is_lifetime ? 'Lifetime' : `${plan.duration_value} ${plan.duration_unit}`}</td><td>{plan.price_stars} ⭐</td><td><span className={`pill ${plan.active ? 'ok' : ''}`}>{plan.active ? 'active' : 'inactive'}</span></td></tr>)}</tbody></table></div> : <p className="muted">No plans yet.</p>}</div><div className="panel"><h3>Subscribers</h3><form className="join" onSubmit={grant}><input value={grantUser} onChange={(e) => setGrantUser(e.target.value)} placeholder="Telegram user ID" required /><select value={grantPlan} onChange={(e) => setGrantPlan(e.target.value)} required><option value="">Grant plan…</option>{plans.filter((plan) => plan.active).map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select><button className="btn ghost sm" disabled={busy || !grantPlan}>Grant</button></form>{entitlements.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Telegram user</th><th>Status</th><th>Expires</th><th /></tr></thead><tbody>{entitlements.map((item) => <tr key={item.id}><td>{item.telegram_user_id}</td><td><span className="pill">{item.status}</span></td><td>{item.expires_at ? new Date(item.expires_at).toLocaleDateString() : 'Lifetime'}</td><td>{!['expired', 'revoked'].includes(item.status) && <button className="btn danger sm" onClick={() => revoke(item.id)}>Revoke</button>}</td></tr>)}</tbody></table></div> : <p className="muted">No subscriber entitlements yet.</p>}</div><div className="panel"><h3>Payment history</h3>{payments.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Provider</th><th>Amount</th><th>Status</th><th>Created</th><th /></tr></thead><tbody>{payments.map((payment) => <tr key={payment.id}><td>{payment.provider}</td><td>{payment.amount} {payment.currency}</td><td><span className="pill">{payment.status}</span></td><td>{new Date(payment.created_at).toLocaleString()}</td><td>{payment.provider === 'nowpayments' && !['paid', 'refunded'].includes(payment.status) && <button className="btn ghost sm" disabled={busy} onClick={() => refreshPayment(payment.id)}>Refresh</button>} {payment.provider === 'telegram_stars' && payment.status === 'paid' && <button className="btn danger sm" disabled={busy} onClick={() => refundPayment(payment.id)}>Refund</button>}</td></tr>)}</tbody></table></div> : <p className="muted">No payments yet.</p>}</div></div>}
      </div>
    </>}
  </div>;
}
