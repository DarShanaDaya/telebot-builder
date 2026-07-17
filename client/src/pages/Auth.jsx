import { useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { apiError } from '../api';

export default function Auth() {
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={location.state?.from?.pathname || '/'} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'login') await login(email.trim(), password);
      else await register(email.trim(), password, name.trim());
      navigate(location.state?.from?.pathname || '/', { replace: true });
    } catch (err) {
      setError(apiError(err, 'Authentication failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark big">🤖</span>
          <h1>Telebot Builder</h1>
          <p className="muted">Design Telegram bots visually. No code required.</p>
        </div>
        <form onSubmit={submit} className="auth-form">
          <h2>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
          {mode === 'register' && (
            <label className="field">
              <span className="field-label">Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" autoComplete="name" />
            </label>
          )}
          <label className="field">
            <span className="field-label">Email</span>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
          </label>
          <label className="field">
            <span className="field-label">Password</span>
            <input type="password" required minLength={mode === 'register' ? 8 : 1} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === 'register' ? 'At least 8 characters' : '••••••••'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="btn primary block" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Sign up'}
          </button>
          <p className="auth-switch muted">
            {mode === 'login' ? (
              <>New here? <button type="button" className="link" onClick={() => setMode('register')}>Create an account</button></>
            ) : (
              <>Already have an account? <button type="button" className="link" onClick={() => setMode('login')}>Sign in</button></>
            )}
          </p>
        </form>
      </div>
    </div>
  );
}
