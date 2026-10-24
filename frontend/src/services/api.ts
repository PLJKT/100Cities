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
  let data: any = {};

  if (method === 'post' && url === '/auth/login') {
    const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
    data.token = 'mock-token-' + Date.now();
    data.user = {
      id: 1,
      username: body?.username || 'admin',
      partner_name: 'PT Kawasan Industri Jababeka Tbk',
      role_name: 'Super Admin',
      menu_permissions: ['dashboard', 'partner.form', 'partner.my', 'review', 'admin.users', 'admin.roles', 'admin.templates'],
      profile: { id: 1, company_name: 'PT Kawasan Industri Jababeka Tbk', nationality: 'ID', tier: 'existing', status: 'active' },
    };
  } else if (method === 'get' && url === '/dashboard/summary') {
    data.total = 24; data.approved = 12; data.overdue = 2; data.progress = 50; data.completion = 50;
  } else if (method === 'get' && url === '/dashboard/detail') {
    data = [
      { id: 1, doc_no: 'P1-MVMBIXNC-3', partner_name: 'Test Partner Co', status: 'pending', submit_time: '2026-10-24 09:12' },
      { id: 2, doc_no: 'P1-FS-2026-001', partner_name: 'PT Sinar Mas', status: 'approved', submit_time: '2026-10-20 14:30' },
      { id: 3, doc_no: 'P1-FS-2026-002', partner_name: 'Hangzhou GreenTech', status: 'approved', submit_time: '2026-10-18 11:02' },
      { id: 4, doc_no: 'P1-FS-2026-003', partner_name: 'Shenyang Auto Parts', status: 'pending', submit_time: '2026-10-15 16:45' },
      { id: 5, doc_no: 'P1-FS-2026-004', partner_name: 'Foshan Ceramics', status: 'rejected', submit_time: '2026-10-12 10:20' },
      { id: 6, doc_no: 'P1-FS-2026-005', partner_name: 'Singapore SMEs Consortium', status: 'pending', submit_time: '2026-10-10 09:55' },
    ];
  } else if (method === 'get' && url === '/review/submits') {
    data = [
      { id: 1, doc_no: 'P1-MVMBIXNC-3', status: 'pending', submit_time: '2026-10-24 09:12', partner_name: 'Test Partner Co' },
      { id: 2, doc_no: 'P1-FS-2026-001', status: 'approved', submit_time: '2026-10-20 14:30', partner_name: 'PT Sinar Mas' },
      { id: 3, doc_no: 'P1-FS-2026-002', status: 'approved', submit_time: '2026-10-18 11:02', partner_name: 'Hangzhou GreenTech' },
      { id: 4, doc_no: 'P1-FS-2026-004', status: 'rejected', submit_time: '2026-10-12 10:20', partner_name: 'Foshan Ceramics' },
    ];
  } else if (method === 'get' && url === '/admin/users') {
    data = [
      { id: 1, username: 'admin', partner_name: 'Jababeka HQ', role_id: 1, role_name: 'Super Admin', enabled: 1 },
      { id: 2, username: 'partner1', partner_name: 'PT Sinar Mas', role_id: 2, role_name: 'Partner Filler', enabled: 1 },
      { id: 3, username: 'reviewer', partner_name: 'Jababeka Review Desk', role_id: 3, role_name: 'Reviewer', enabled: 1 },
      { id: 4, username: 'bod', partner_name: 'Board Member', role_id: 4, role_name: 'BOD Read-only', enabled: 1 },
    ];
  } else if (method === 'post' && url === '/admin/users') {
    data.ok = true; data.id = 99;
  } else if (method === 'get' && url === '/admin/templates') {
    data = [mockPhase1Template()];
  } else if (method === 'get' && url === '/forms/phase1') {
    data = mockPhase1Template();
  } else if (method === 'get' && url === '/admin/roles') {
    data = [
      { id: 1, role_name: 'Super Admin', data_scope: 'all' },
      { id: 2, role_name: 'Partner Filler', data_scope: 'self' },
      { id: 3, role_name: 'Reviewer', data_scope: 'review' },
      { id: 4, role_name: 'BOD Read-only', data_scope: 'summary' },
    ];
  } else if (method === 'get' && url === '/admin/settings/email') {
    data = { host: 'smtp.gmail.com', port: 587, secure: false, user: 'club@example.com', pass: '***', fromAddr: '100 Cities Club <no-reply@example.com>', toAddr: 'ops@example.com' };
  } else if (method === 'get' && url === '/forms/my/submits') {
    data = [
      { id: 1, doc_no: 'P1-FS-2026-001', status: 'approved', submit_time: '2026-10-20 14:30' },
      { id: 2, doc_no: 'P1-FS-2026-003', status: 'pending', submit_time: '2026-10-15 16:45' },
    ];
  } else if (method === 'post' && (url === '/forms/submit' || url === '/forms/draft')) {
    data.ok = true; data.id = 99; data.locked = true;
  } else if (method === 'get' && url === '/partners/my') {
    data = {
      id: 1, company_name: 'PT Kawasan Industri Jababeka Tbk', nationality: 'ID',
      industry: 'Township & Industrial Estates', tier: 'existing', status: 'active',
      contact_email: 'partners@jababeka.com', contact_phone: '+62 21 1234 5678',
      account: { id: 1, username: 'admin', email: 'admin@100cities.local', phone: '+62 812 0000 0000', enabled: 1 },
    };
  } else if (method === 'get' && url === '/partners') {
    data = [
      { id: 1, company_name: 'PT Sinar Mas', nationality: 'ID', industry: 'Pulp & Paper', tier: 'existing', status: 'active' },
      { id: 2, company_name: 'Hangzhou GreenTech', nationality: 'CN', industry: 'Renewables', tier: 'manufacturer', status: 'active' },
      { id: 3, company_name: 'Shenyang Auto Parts', nationality: 'CN', industry: 'Automotive', tier: 'manufacturer', status: 'invited' },
      { id: 4, company_name: 'Foshan Ceramics', nationality: 'CN', industry: 'Building Materials', tier: 'explorer', status: 'paused' },
    ];
  } else if (method === 'get' && /\/partners\/\d+\/pipeline/.test(url)) {
    data = {
      pipeline: { id: 1, partner_id: 1, stage: 'site_visit', stage_note: 'Site visit scheduled at Cikarang' },
      events: [
        { id: 1, from_stage: null, to_stage: 'intake', note: 'Profile created', created_at: '2026-10-01' },
        { id: 2, from_stage: 'intake', to_stage: 'matching', note: 'First matching call done', created_at: '2026-10-10' },
        { id: 3, from_stage: 'matching', to_stage: 'site_visit', note: 'Site visit scheduled at Cikarang', created_at: '2026-10-20' },
      ],
    };
  } else if (method === 'put' && /\/partners\/\d+\/pipeline/.test(url)) {
    data.ok = true;
  } else if (method === 'post' && /\/review\/.+\/(approve|reject|remind)/.test(url)) {
    data.ok = true;
  } else if (method === 'get' && url === '/public/project') {
    data = { name: '100 Cities Club', cities: 100, population: 287, intro: 'KIJA-led national urbanization initiative.' };
  } else {
    data = [];
  }

  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  };
}

/** 与后端 schema v2 一致的默认 Phase1 模板（7 字段，三语标签 + 选项） */
function mockPhase1Template() {
  return {
    id: 1,
    template_key: 'phase1',
    version: 1,
    section_config: { sections: [{ title: 'Partner Information', fields: ['partner_name', 'entity_nationality'] }, { title: 'Assets', fields: ['asset_summary', 'qualifications'] }] },
    fields: [
      { id: 1, field_key: 'partner_name', field_type: 'text', required: 1, sort: 1, en_label: 'Partner / Company Name', id_label: 'Nama Mitra / Perusahaan', zh_label: '合作方 / 公司名称', options: null, enabled: 1 },
      { id: 2, field_key: 'entity_nationality', field_type: 'text', required: 1, sort: 2, en_label: 'Entity Nationality (ID / SG / CN)', id_label: 'Kebangsaan Entitas (ID / SG / CN)', zh_label: '主体国籍（ID / SG / CN）', options: null, enabled: 1 },
      { id: 3, field_key: 'asset_summary', field_type: 'textarea', required: 1, sort: 3, en_label: 'Asset Summary', id_label: 'Ringkasan Aset', zh_label: '资产摘要', options: null, enabled: 1 },
      { id: 4, field_key: 'qualifications', field_type: 'textarea', required: 0, sort: 4, en_label: 'Qualifications', id_label: 'Kualifikasi', zh_label: '资质与优势', options: null, enabled: 1 },
      { id: 5, field_key: 'cooperation_intent', field_type: 'select', required: 1, sort: 5, en_label: 'Cooperation Intent', id_label: 'Niat Kerja Sama', zh_label: '合作意向', options: [
        { value: 'market_entry', en: 'Market entry', id: 'Masuk pasar', zh: '市场进入' },
        { value: 'capacity', en: 'Capacity relocation', id: 'Relokasi kapasitas', zh: '产能转移' },
        { value: 'tech', en: 'Technology partnership', id: 'Kemitraan teknologi', zh: '技术合作' },
        { value: 'invest', en: 'Investment', id: 'Investasi', zh: '投资' },
        { value: 'tenancy', en: 'Industrial tenancy', id: 'Sewa kawasan', zh: '园区入驻' },
      ], enabled: 1 },
      { id: 6, field_key: 'target_segment', field_type: 'multiselect', required: 0, sort: 6, en_label: 'Target Segment', id_label: 'Segmen Sasaran', zh_label: '目标板块', options: [
        { value: 'industrial', en: 'Industrial', id: 'Industri', zh: '工业' },
        { value: 'residential', en: 'Residential', id: 'Perumahan', zh: '住宅' },
        { value: 'commercial', en: 'Commercial', id: 'Komersial', zh: '商业' },
        { value: 'infra', en: 'Infrastructure', id: 'Infrastruktur', zh: '基础设施' },
        { value: 'power', en: 'Power', id: 'Ketenagalistrikan', zh: '电力' },
        { value: 'water', en: 'Water & Estate', id: 'Air & Kawasan', zh: '水务与园区' },
        { value: 'dryport', en: 'Dry Port', id: 'Dry Port', zh: '内陆港' },
      ], enabled: 1 },
      { id: 7, field_key: 'attachments', field_type: 'file', required: 0, sort: 7, en_label: 'Attachments', id_label: 'Lampiran', zh_label: '附件', options: null, enabled: 1 },
    ],
  };
}

if (USE_MOCK) {
  // @ts-ignore: replace adapter for standalone mock
  api.defaults.adapter = mockHandler;
  console.info('[100Cities] MOCK MODE on — frontend running standalone, no backend calls.');
}

export default api;
export const MOCK_MODE = USE_MOCK;
