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
    // 与后端 /api/dashboard/summary v3 结构一致
    data.total = 24; data.approved = 12; data.overdue = 2; data.progress = 50; data.completion = 50;
    data.submits = { total: 24, approved: 12, overdue: 2, progress: 50 };
    data.assets = {
      total: 8,
      byCategory: { industrial: 2, sez: 2, power: 1, dryport: 1, water: 1, education: 1 },
      byStatus: { available: 6, planning: 2 },
    };
    data.leads = {
      total: 5,
      byStatus: { new: 1, under_review: 2, approved: 1, rejected: 1 },
    };
    data.projects = {
      total: 3,
      byStage: { intake: 1, matching: 1, site_visit: 1 },
      byStatus: { active: 2, completed: 1 },
    };
    data.partners = {
      total: 12,
      byTier: { explorer: 3, manufacturer: 4, tech: 2, existing: 2, investor: 1 },
    };
    data.pipeline = { byStage: { intake: 1, matching: 1, site_visit: 2, proposal: 1 }, totalEvents: 14 };
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
  } else if (method === 'get' && (url === '/assets' || /^\/assets\/category\//.test(url))) {
    data = [
      { id: 1, name: 'Cikarang Jababeka City – Industrial Plots', category: 'industrial', location: 'Cikarang, West Java', size_desc: '~2,000 ha developed',
        description: "Indonesia's pioneer township & industrial estate since 1989. Ready-to-build factory plots, road grid, power, water and dry port inside the estate.",
        status: 'available', price_desc: 'From IDR 2.5M/m², HGB 30+20 years', min_area: '2,000 m²', max_area: '50,000 m²',
        key_specs: '3-phase power to plot, 6m road grid, 20m main arteries, water & fiber available', owner_contact: 'Ms. Febiyanti — febiyanti@jababeka.com', sort: 1 },
      { id: 2, name: 'Kendal Industrial Park', category: 'industrial', location: 'Kendal, Central Java', size_desc: '~2,200 ha SEZ',
        description: 'Jointly opened Nov 2016 by the President of Indonesia and the Prime Minister of Singapore. Ideal for export-oriented manufacturers.',
        status: 'available', price_desc: 'On application (SEZ incentives: tax holiday 10–15 yrs)', min_area: '5,000 m²', max_area: '100,000 m²',
        key_specs: 'SEZ incentives, deep-water port access via Semarang, dedicated power', owner_contact: 'Juliani Kusumaningrum — juliani.kusumaningrum@kik.co.id', sort: 2 },
      { id: 3, name: 'Tanjung Lesung SEZ', category: 'sez', location: 'Pandeglang, Banten', size_desc: '~1,500 ha',
        description: 'Tourism & MICE special economic zone on the Sunda Strait coast, with international hotel operators and resort land.',
        status: 'planning', price_desc: 'On application', min_area: '10,000 m²', max_area: '200,000 m²',
        key_specs: 'Beachfront resort land, MICE venues, airport proximity', owner_contact: 'Jababeka Investor Desk', sort: 3 },
      { id: 4, name: 'Morotai SEZ', category: 'sez', location: 'Morotai, North Maluku', size_desc: '~800 ha',
        description: 'Island logistics & fisheries hub SEZ in eastern Indonesia, part of the national growth corridor.',
        status: 'planning', price_desc: 'On application', min_area: '10,000 m²', max_area: '150,000 m²',
        key_specs: 'Fisheries/logistics incentives, island port access', owner_contact: 'Jababeka Investor Desk', sort: 4 },
      { id: 5, name: 'Jababeka Gas-Fired Power Plant', category: 'power', location: 'Cikarang, West Java', size_desc: '130 MW',
        description: 'Captive gas-fired power supporting estate industries with stable, own-grid electricity supply.',
        status: 'available', price_desc: 'PPA/offtake on application', key_specs: '130 MW capacity, own-grid, 24/7 reliability', owner_contact: 'Jababeka Utilities Division', sort: 5 },
      { id: 6, name: 'Jababeka Dry Port (CTC)', category: 'dryport', location: 'Cikarang, West Java', size_desc: '~200 ha',
        description: 'Integrated container terminal & customs facility inside the estate, connecting to Tanjung Priok and Tanjung Perak.',
        status: 'available', price_desc: 'Service/land lease on application', key_specs: 'Customs bonded zone, rail & road connectivity, 1M TEU capacity', owner_contact: 'Jababeka Port Division', sort: 6 },
      { id: 7, name: 'Water Treatment & Estate Utilities', category: 'water', location: 'Cikarang, West Java', size_desc: 'multiple plants',
        description: 'Water treatment, wastewater and estate-wide utilities serving 1.2M residents and 2,000+ factories.',
        status: 'available', price_desc: 'Utility tariffs per PAM/PLN benchmark', key_specs: 'Treated water, wastewater, fiber, estate security', owner_contact: 'Jababeka Utilities Division', sort: 7 },
      { id: 8, name: 'Jababeka University & Teaching Hospital', category: 'education', location: 'Cikarang, West Java', size_desc: 'campus + hospital',
        description: 'President University and Jababeka Hospital – education & healthcare anchors for talent and community life.',
        status: 'available', price_desc: 'Partnership/JV on application', key_specs: 'President University (4,000+ students), 250-bed teaching hospital', owner_contact: 'Jababeka Education & Health Division', sort: 8 },
    ].filter((a: any) => !/^\/assets\/category\//.test(url) || a.category === url.split('/').pop());
  } else if (method === 'post' && url === '/assets/match') {
    const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
    data.results = [
      { id: 1, name: 'Cikarang Jababeka City – Industrial Plots', category: 'industrial', location: 'Cikarang, West Java', size_desc: '~2,000 ha developed', price_desc: 'From IDR 2.5M/m², HGB 30+20 years', match_score: 9 },
      { id: 2, name: 'Kendal Industrial Park', category: 'industrial', location: 'Kendal, Central Java', size_desc: '~2,200 ha SEZ', price_desc: 'On application (SEZ incentives)', match_score: 7 },
      { id: 6, name: 'Jababeka Dry Port (CTC)', category: 'dryport', location: 'Cikarang, West Java', size_desc: '~200 ha', price_desc: 'Service/land lease on application', match_score: 5 },
      { id: 5, name: 'Jababeka Gas-Fired Power Plant', category: 'power', location: 'Cikarang, West Java', size_desc: '130 MW', price_desc: 'PPA/offtake on application', match_score: 4 },
    ];
  } else if (method === 'get' && url === '/partners/my') {    data = {
      id: 1, company_name: 'PT Kawasan Industri Jababeka Tbk', nationality: 'ID',
      industry: 'Township & Industrial Estates', tier: 'existing', status: 'active',
      contact_email: 'partners@jababeka.com', contact_phone: '+62 21 1234 5678',
      account: { id: 1, username: 'admin', email: 'admin@100cities.local', phone: '+62 812 0000 0000', enabled: 1 },
    };
  } else if (method === 'get' && url === '/partners') {
    data = [
      { id: 1, company_name: 'PT Kawasan Industri Jababeka Tbk', nationality: 'ID', industry: 'Township & Industrial Estates', tier: 'existing', status: 'active',
        account: { id: 1, username: 'admin', enabled: 1 }, submits: 2, leads: 3, projects: 2, pipeline_stage: 'site_visit', last_active: '2026-10-23 09:12:00' },
      { id: 2, company_name: 'Hangzhou GreenTech', nationality: 'CN', industry: 'Renewable Energy', tier: 'manufacturer', status: 'active',
        account: { id: 2, username: 'partner1', enabled: 1 }, submits: 1, leads: 2, projects: 1, pipeline_stage: 'matching', last_active: '2026-10-22 14:30:00' },
      { id: 3, company_name: 'Shenyang Auto Parts', nationality: 'CN', industry: 'Automotive', tier: 'manufacturer', status: 'invited',
        account: { id: 3, username: 'partner2', enabled: 1 }, submits: 0, leads: 1, projects: 0, pipeline_stage: 'intake', last_active: '2026-10-18 11:02:00' },
      { id: 4, company_name: 'Foshan Ceramics', nationality: 'CN', industry: 'Building Materials', tier: 'explorer', status: 'paused',
        account: { id: 4, username: 'partner3', enabled: 1 }, submits: 0, leads: 0, projects: 0, pipeline_stage: null, last_active: '2026-09-30 10:20:00' },
      { id: 5, company_name: 'Singapore SMEs Consortium', nationality: 'SG', industry: 'Manufacturing', tier: 'explorer', status: 'active',
        account: { id: 5, username: 'partner4', enabled: 1 }, submits: 1, leads: 0, projects: 0, pipeline_stage: 'intake', last_active: '2026-10-20 09:55:00' },
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
  } else if (method === 'get' && url === '/cases') {
    data = { items: mockCases(), total: mockCases().length };
  } else if (method === 'get' && /^\/cases\/\d+$/.test(url)) {
    data = mockCaseDetail(url);
  } else if (method === 'get' && /^\/cases\/\d+\/timeline$/.test(url)) {
    data = mockTimeline(url);
  } else if (method === 'get' && /^\/cases\/\d+\/explain$/.test(url)) {
    data = { runs: mockRuns(url), tasks: [] };
  } else if (method === 'post' && /^\/cases\/\d+\/(stage|won|lost)$/.test(url)) {
    data = { ok: true, from: 'matching', to: 'site_visit', automation: { processed: 1, errors: 0 } };
  } else if (method === 'put' && /^\/cases\/\d+\/(asset|owner)$/.test(url)) {
    data = { ok: true };
  } else if (method === 'get' && url === '/tasks') {
    const params: any = (config as any).params || {};
    let rows = mockTasks();
    if (params.status) rows = rows.filter((x) => x.status === params.status);
    if (params.overdue) rows = rows.filter((x) => x.is_overdue === 1);
    data = { items: rows, total: rows.length };
  } else if (method === 'get' && /^\/tasks\/\d+$/.test(url)) {
    data = mockTasks().find((x) => x.id === Number(url.split('/').pop())) || null;
  } else if (method === 'put' && /^\/tasks\/\d+\/(status|assign)$/.test(url)) {
    data = { ok: true };
  } else if (method === 'get' && url === '/automation/rules') {
    data = mockRules();
  } else if (method === 'put' && /^\/automation\/rules\/.+/.test(url)) {
    data = { ok: true };
  } else if (method === 'get' && url === '/automation/events') {
    data = mockEvents();
  } else if (method === 'get' && url === '/automation/runs') {
    data = mockRuns('/cases/1/explain');
  } else if (method === 'post' && url === '/automation/sweep') {
    data = { tasks: { escalated: 2 }, stages: { breached: 1 }, holds: { released: 1 }, drained: { processed: 0, errors: 0 } };
  } else if (method === 'post' && /^\/automation\/replay\/\d+$/.test(url)) {
    data = { ok: true, processed: 1, errors: 0 };
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

/** ---------------- v5 mock：案件 / 任务 / 自动化台 ---------------- */
function mockCases() {
  return [
    {
      id: 1, case_no: 'C-202611-0001', org_name: 'Hangzhou GreenTech Co., Ltd.', country: 'CN',
      lifecycle: 'active', review_status: 'approved', stage: 'proposal', stage_entered_at: '2026-11-02 09:00:00',
      stage_age_days: 6, open_tasks: 3, overdue_tasks: 1, asset_id: 1,
      asset_name: 'Cikarang Jababeka City – Industrial Plots',
    },
    {
      id: 2, case_no: 'C-202611-0002', org_name: 'Acme Singapore Pte Ltd', country: 'SG',
      lifecycle: 'qualified', review_status: 'approved', stage: 'site_visit', stage_entered_at: '2026-11-05 10:00:00',
      stage_age_days: 3, open_tasks: 2, overdue_tasks: 0, asset_id: 2,
      asset_name: 'Kendal Industrial Park',
    },
    {
      id: 3, case_no: 'C-202611-0003', org_name: 'PT Sinar Mas', country: 'ID',
      lifecycle: 'inquiry', review_status: 'pending', stage: 'intake', stage_entered_at: '2026-11-07 08:00:00',
      stage_age_days: 1, open_tasks: 1, overdue_tasks: 0, asset_id: null, asset_name: null,
    },
    {
      id: 4, case_no: 'C-202610-0009', org_name: 'Singapore SMEs Consortium', country: 'SG',
      lifecycle: 'won', review_status: 'approved', stage: 'decision', stage_entered_at: '2026-10-20 08:00:00',
      stage_age_days: 0, open_tasks: 1, overdue_tasks: 0, asset_id: 6, asset_name: 'Jababeka Dry Port (CTC)',
    },
  ];
}

function mockTasks() {
  return [
    {
      id: 1, task_key: 'proposal.prepare:1:12', case_id: 1, case_no: 'C-202611-0001', org_name: 'Hangzhou GreenTech Co., Ltd.',
      task_type: 'proposal.prepare', title: 'Prepare commercial proposal', title_id: 'Siapkan proposal komersial',
      title_zh: '编制商务方案', detail: 'Hard hold on the asset is active for 30 days — the proposal must be issued within this window.',
      assignee_user_id: 3, assignee_name: 'reviewer', priority: 'high', status: 'open',
      due_at: '2026-11-09 09:00:00', is_overdue: 1, escalation_level: 1,
    },
    {
      id: 2, task_key: 'matching.shortlist:1:9', case_id: 1, case_no: 'C-202611-0001', org_name: 'Hangzhou GreenTech Co., Ltd.',
      task_type: 'matching.shortlist', title: 'Shortlist matching assets', title_id: 'Susun daftar aset yang cocok',
      title_zh: '筛选匹配资产', detail: 'Use the asset match endpoint to shortlist up to 3 assets.',
      assignee_user_id: 3, assignee_name: 'reviewer', priority: 'normal', status: 'open',
      due_at: '2026-11-10 09:00:00', is_overdue: 0, escalation_level: 0,
    },
    {
      id: 3, task_key: 'site_visit.schedule:2:14', case_id: 2, case_no: 'C-202611-0002', org_name: 'Acme Singapore Pte Ltd',
      task_type: 'site_visit.schedule', title: 'Schedule site visit and confirm logistics', title_id: 'Jadwalkan kunjungan lokasi',
      title_zh: '安排实地考察', detail: 'Asset hold expires in 72 hours — confirm the visit date before the hold is released.',
      assignee_user_id: 3, assignee_name: 'reviewer', priority: 'high', status: 'open',
      due_at: '2026-11-08 18:00:00', is_overdue: 1, escalation_level: 0,
    },
    {
      id: 4, task_key: 'handover.contract:4:21', case_id: 4, case_no: 'C-202610-0009', org_name: 'Singapore SMEs Consortium',
      task_type: 'handover.contract', title: 'Issue agreement and handover pack', title_id: 'Terbitkan perjanjian dan paket serah terima',
      title_zh: '出具协议与交付包', detail: null,
      assignee_user_id: 1, assignee_name: 'admin', priority: 'high', status: 'open',
      due_at: '2026-11-11 09:00:00', is_overdue: 0, escalation_level: 0,
    },
    {
      id: 5, task_key: 'review.completeness:3:18', case_id: 3, case_no: 'C-202611-0003', org_name: 'PT Sinar Mas',
      task_type: 'review.completeness', title: 'Verify submission completeness', title_id: 'Verifikasi kelengkapan dokumen',
      title_zh: '资料齐全性复核', detail: 'Check that all required Phase 1 fields and attachments were received.',
      assignee_user_id: 3, assignee_name: 'reviewer', priority: 'high', status: 'done',
      due_at: '2026-11-07 10:00:00', is_overdue: 0, escalation_level: 0,
    },
  ];
}

function mockRules() {
  return [
    {
      rule_key: 'R01_submission_approved', name: 'Submission approved → open case', event_type: 'submission.approved',
      condition: {}, enabled: 1, stats: { applied: 6, skipped: 0 },
      description: '审核通过不再只改一个状态：建会员档案 → 开案 → 生成复核任务 → 通知申请人。',
      actions: [
        { type: 'ensure_partner', params: { status: 'active' } },
        { type: 'ensure_case', params: { origin: 'submission', lifecycle: 'qualified' } },
        { type: 'create_task', params: { task_type: 'review.completeness', sla_hours: 24 } },
        { type: 'notify', params: { channel: 'email', to: 'applicant' } },
      ],
    },
    {
      rule_key: 'R06_stage_proposal', name: 'Stage → proposal (opens project + hard hold)', event_type: 'case.stage_changed',
      condition: { to_stage: 'proposal' }, enabled: 1, stats: { applied: 3, skipped: 2 },
      description: '进入方案阶段：自动建项目、下硬预留（30 天）、铺 5 个里程碑、生成方案任务。',
      actions: [
        { type: 'ensure_project', params: {} },
        { type: 'hold_asset', params: { hold_type: 'hard', ttl_hours: 720 } },
        { type: 'seed_milestones', params: { items: ['allocation 14d', 'terms 30d', 'DD 45d', 'agreement 60d', 'handover 90d'] } },
        { type: 'create_task', params: { task_type: 'proposal.prepare', sla_hours: 72 } },
      ],
    },
    {
      rule_key: 'R10_task_overdue', name: 'Task overdue → escalate', event_type: 'task.overdue',
      condition: {}, enabled: 1, stats: { applied: 4, skipped: 0, error: 1 },
      description: '任务逾期自动升级并通知，不再依赖人盯着表格。',
      actions: [{ type: 'escalate_task', params: {} }, { type: 'notify', params: { channel: 'whatsapp' } }],
    },
  ];
}

function mockEvents() {
  return [
    { id: 21, event_type: 'case.won', entity_type: 'biz_case', entity_id: 4, case_id: 4, actor: 'user', status: 'processed', occurred_at: '2026-11-07 17:20:00', payload: { case_no: 'C-202610-0009', note: 'signed' } },
    { id: 20, event_type: 'case.stage_changed', entity_type: 'biz_case', entity_id: 1, case_id: 1, actor: 'user', status: 'processed', occurred_at: '2026-11-02 09:00:00', payload: { from_stage: 'site_visit', to_stage: 'proposal' } },
    { id: 19, event_type: 'asset.conflict', entity_type: 'asset', entity_id: 2, case_id: 2, actor: 'system', status: 'pending', occurred_at: '2026-11-06 11:05:00', payload: { asset_id: 2, message: 'Asset already hard-held by C-202611-0002' } },
    { id: 18, event_type: 'submission.approved', entity_type: 'form_submit', entity_id: 2, case_id: 3, actor: 'user', status: 'processed', occurred_at: '2026-11-07 08:00:00', payload: { submit_id: 2 } },
  ];
}

function mockRuns(_url?: string) {
  return [
    { id: 9, rule_key: 'R08_case_won', rule_name: 'Case won → lease asset + close project', event_type: 'case.won', outcome: 'applied', detail: 'lease_asset: asset 6 leased; release_holds: 1 released; create_task: 1 created', created_at: '2026-11-07 17:20:03' },
    { id: 8, rule_key: 'R12_asset_conflict', rule_name: 'Asset hold conflict → resolve', event_type: 'asset.conflict', outcome: 'applied', detail: 'create_task: 1 created', created_at: '2026-11-06 11:05:01' },
    { id: 7, rule_key: 'R06_stage_proposal', rule_name: 'Stage → proposal', event_type: 'case.stage_changed', outcome: 'applied', detail: 'ensure_project: project 7 created; hold_asset: hard 30d; seed_milestones: 5; create_task: 1', created_at: '2026-11-02 09:00:02' },
    { id: 6, rule_key: 'R04_stage_matching', rule_name: 'Stage → matching', event_type: 'case.stage_changed', outcome: 'skipped', detail: 'condition to_stage=matching not matched', created_at: '2026-11-02 09:00:02' },
  ];
}

function mockTimeline(url: string) {
  const id = Number(url.split('/')[2] || 1);
  const c = mockCases().find((x) => x.id === id) || mockCases()[0];
  return [
    { at: '2026-10-28 09:12:00', kind: 'event', title: `Case ${c.case_no} opened`, detail: 'submission.approved' },
    { at: '2026-10-28 09:12:01', kind: 'task', title: 'Verify submission completeness', detail: 'review.completeness · 24h' },
    { at: '2026-10-30 14:00:00', kind: 'stage', title: 'intake → matching', detail: 'shortlist confirmed' },
    { at: '2026-11-02 09:00:00', kind: 'event', title: 'Stage changed to proposal', detail: 'case.stage_changed' },
    { at: '2026-11-02 09:00:02', kind: 'task', title: 'Prepare commercial proposal', detail: 'proposal.prepare · 72h' },
    { at: '2026-11-02 09:00:02', kind: 'hold', title: 'Hard hold on asset #1 for 30 days', detail: 'asset_hold confirmed' },
    { at: '2026-11-04 16:30:00', kind: 'notification', title: 'Applicant notified by email', detail: 'submission approved' },
  ];
}

function mockCaseDetail(url: string) {
  const id = Number(url.split('/').pop());
  const c = mockCases().find((x) => x.id === id) || mockCases()[0];
  return {
    case: {
      ...c, origin: 'submission', industry: null, company_size: null, source_channel: 'submission',
      owner_user_id: null, value_desc: null, lead_id: null, partner_profile_id: 1, submit_id: 1,
      project_id: c.stage === 'proposal' || c.stage === 'decision' ? 7 : null,
      created_at: '2026-10-28 09:12:00', updated_at: '2026-11-02 09:00:00',
    },
    stage: c.stage, stage_entered_at: c.stage_entered_at, stage_age_days: c.stage_age_days,
    stage_sla_days: { intake: 14, matching: 14, site_visit: 21, proposal: 21, decision: 14 }[c.stage] ?? 14,
    partner: { id: 1, company_name: c.org_name, nationality: c.country, tier: 'manufacturer', status: 'active' },
    lead: null, submit: { id: 1, doc_no: 'P1-FS-2026-001', status: 'approved' },
    submit_data: [{ field_key: 'partner_name', field_value: c.org_name }],
    project: c.stage === 'proposal' || c.stage === 'decision'
      ? { id: 7, name: `${c.org_name} – Cikarang`, stage: 'proposal', status: 'active', progress_pct: 35 }
      : null,
    milestones: c.stage === 'proposal' || c.stage === 'decision'
      ? [
        { id: 1, name: 'Land / space allocation confirmed', due_date: '2026-11-16', status: 'open' },
        { id: 2, name: 'Commercial terms agreed', due_date: '2026-12-02', status: 'open' },
        { id: 3, name: 'Due diligence completed', due_date: '2026-12-17', status: 'open' },
        { id: 4, name: 'Agreement signed', due_date: '2027-01-01', status: 'open' },
        { id: 5, name: 'Handover and fit-out start', due_date: '2027-01-31', status: 'open' },
      ]
      : [],
    asset: c.asset_id ? { id: c.asset_id, name: c.asset_name, status: c.stage === 'decision' ? 'leased' : 'reserved' } : null,
    holds: c.asset_id
      ? [{ id: 1, asset_id: c.asset_id, case_id: c.id, hold_type: c.stage === 'site_visit' ? 'soft' : 'hard', status: 'active', expires_at: '2026-12-02 09:00:00', created_at: '2026-11-02 09:00:00' }]
      : [],
    tasks: mockTasks().filter((t) => t.case_id === c.id).map((t) => ({ ...t, status: t.status === 'open' ? 'open' : 'done' })),
    stage_history: [
      { id: 1, from_stage: null, to_stage: 'intake', note: 'case opened', created_at: '2026-10-28 09:12:00' },
      { id: 2, from_stage: 'intake', to_stage: 'matching', note: 'shortlist confirmed', created_at: '2026-10-30 14:00:00' },
      { id: 3, from_stage: 'matching', to_stage: 'site_visit', note: 'site visit done', created_at: '2026-10-30 14:00:00' },
      { id: 4, from_stage: 'site_visit', to_stage: 'proposal', note: 'terms drafted', created_at: '2026-11-02 09:00:00' },
    ],
    events: mockEvents(),
  };
}

if (USE_MOCK) {
  // @ts-ignore: replace adapter for standalone mock
  api.defaults.adapter = mockHandler;
  console.info('[100Cities] MOCK MODE on — frontend running standalone, no backend calls.');
}

export default api;
export const MOCK_MODE = USE_MOCK;
