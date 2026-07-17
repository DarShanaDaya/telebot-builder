import axios from 'axios';

// Default: same-origin /api (works with the Vite dev proxy and single-host
// deployments). For split hosting (frontend on Vercel, backend elsewhere) set
// VITE_API_URL at build time, e.g. https://api.example.com
const base = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
export const api = axios.create({ baseURL: base ? `${base}/api` : '/api' });

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('tb_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && localStorage.getItem('tb_token')) {
      localStorage.removeItem('tb_token');
      if (!location.pathname.startsWith('/auth')) location.href = '/auth';
    }
    return Promise.reject(err);
  }
);

export const apiError = (err, fallback = 'Something went wrong') =>
  err?.response?.data?.error || err?.message || fallback;
