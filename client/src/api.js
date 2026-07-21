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

// ---- admin console API -----------------------------------------------------
export const admin = {
  listUsers: () => api.get('/admin/users').then((r) => r.data),
  getUser: (id) => api.get(`/admin/users/${id}`).then((r) => r.data),
  updateUser: (id, patch) => api.patch(`/admin/users/${id}`, patch).then((r) => r.data),
  deleteUser: (id) => api.delete(`/admin/users/${id}`).then((r) => r.data),

  listBots: () => api.get('/admin/bots').then((r) => r.data),
  getBot: (id) => api.get(`/admin/bots/${id}`).then((r) => r.data),
  updateBot: (id, patch) => api.patch(`/admin/bots/${id}`, patch).then((r) => r.data),
  deleteBot: (id) => api.delete(`/admin/bots/${id}`).then((r) => r.data),

  listCredentials: () => api.get('/admin/credentials').then((r) => r.data),
  deleteCredential: (id) => api.delete(`/admin/credentials/${id}`).then((r) => r.data),

  listSubscriptions: () => api.get('/admin/subscriptions').then((r) => r.data),
  getSubscriptionChat: (id) => api.get(`/admin/subscriptions/chats/${id}`).then((r) => r.data),
  updatePlan: (id, patch) => api.patch(`/admin/subscriptions/plans/${id}`, patch).then((r) => r.data),
  deletePlan: (id) => api.delete(`/admin/subscriptions/plans/${id}`).then((r) => r.data),
  deleteSubscriptionChat: (id) => api.delete(`/admin/subscriptions/chats/${id}`).then((r) => r.data),

  getMainSubscription: () => api.get('/admin/subscriptions/main').then((r) => r.data),
  saveMainSubscription: (payload) => api.put('/admin/subscriptions/main', payload).then((r) => r.data),
};

export const getMainSubscription = () => api.get('/subscriptions/main').then((r) => r.data);
