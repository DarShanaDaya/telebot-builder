import axios from 'axios';

export const api = axios.create({ baseURL: '/api' });

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
