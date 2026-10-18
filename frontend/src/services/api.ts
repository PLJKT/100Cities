import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { App } from 'antd';

// ============================================================
// MOCK MODE: set VITE_USE_MOCK=true in .env.development to run
// the frontend standalone (no backend needed) for UI fine-tuning.
// Flip to false when you want to reconnect the real API.
// ============================================================
const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  const lang = localStorage.getItem('lang') || 'en';
  config.headers['X-Lang'] = lang;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err: AxiosError) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (!location.pathname.startsWith('/login')) location.href = '/login';
    }
    return Promise.reject(err);
  }
);

// -------- Mock adapter (standalone UI tuning) --------
const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms));

async function mockHandler(config: InternalAxiosRequestConfig) {
  await delay();
  const url = config.url || '';
  const method = (config.method || 'get').toLowerCase();
  const data: any = {};

  if (method === 'post' && url === '/auth/login') {
    const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
    data.token = 'mock-token-' + Date.now();
    data.user = {
      id: 1,
      username: body?.username || 'admin',
      name: 'Demo Admin',
      role: 'Super Admin',
      email: 'demo@100cities.local',
    };
  } else if (method === 'get' && url === '/dashboard/summary') {
    data.total = 24; data.in_review = 6; data.approved = 12; data.overdue = 2; data.completion = 75;
  } else if (method === 'get' && url === '/dashboard/detail') {
    data.rows = [
      { month: '2026-05', submitted: 4, approved: 3, rejected: 1 },
      { month: '2026-06', submitted: 6, approved: 5, rejected: 1 },
      { month: '2026-07', submitted: 5, approved: 4, rejected: 1 },
      { month: '2026-08', submitted: 9, approved: 6, rejected: 3 },
    ];
  } else if (method === 'get' && url === '/review/submits') {
    data.rows = [
      { id: 1, doc_no: 'FS-2026-001', partner: 'PT Sinar Mas', project: 'Cikarang Plot A7', status: 'in_review', updated_at: '2026-10-12' },
      { id: 2, doc_no: 'FS-2026-002', partner: 'Hangzhou GreenTech', project: 'Solar Rooftop Kendal', status: 'approved', updated_at: '2026-10-10' },
      { id: 3, doc_no: 'FS-2026-003', partner: 'Shenyang Auto Parts', project: 'Autoparts Plant Morotai', status: 'draft', updated_at: '2026-10-09' },
      { id: 4, doc_no: 'FS-2026-004', partner: 'Foshan Ceramics', project: 'Tanjung Lesung Resort', status: 'overdue', updated_at: '2026-09-30' },
    ];
  } else if (method === 'get' && url === '/admin/users') {
    data.rows = [
      { id: 1, username: 'admin', name: 'Demo Admin', role: 'Super Admin', status: 'active' },
      { id: 2, username: 'partner1', name: 'Partner Filler', role: 'Partner Filler', status: 'active' },
      { id: 3, username: 'reviewer', name: 'Review Officer', role: 'Reviewer', status: 'active' },
    ];
  } else if (method === 'post' && url === '/admin/users') {
    data.ok = true;
  } else if (method === 'get' && url === '/forms/my/submits') {
    data.rows = [
      { id: 1, doc_no: 'FS-2026-001', project: 'Cikarang Plot A7', status: 'in_review', updated_at: '2026-10-12' },
      { id: 2, doc_no: 'FS-2026-002', project: 'Solar Rooftop Kendal', status: 'approved', updated_at: '2026-10-10' },
    ];
  } else if (method === 'post' && (url === '/forms/submit' || url === '/forms/draft')) {
    data.ok = true; data.id = 99;
  } else if (method === 'post' && /\/review\/.+\/(approve|reject|remind)/.test(url)) {
    data.ok = true;
  } else if (method === 'get' && url === '/public/project') {
    data.name = '100Cities Club'; data.cities = 100; data.population = 286;
  } else {
    data.rows = []; data.ok = true;
  }

  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  };
}

if (USE_MOCK) {
  // @ts-ignore: replace adapter for standalone mock
  api.defaults.adapter = mockHandler;
  console.info('[100Cities] MOCK MODE on — frontend running standalone, no backend calls.');
}

export default api;
export const MOCK_MODE = USE_MOCK;
