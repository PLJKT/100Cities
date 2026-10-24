// backend v4 smoke — assets(match/detail) / leads(stats/detail/followups) / pipeline / projects(milestones) / dashboard v4
const http = require('http');
const BASE = 'http://127.0.0.1:8080';
function req(method, path, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(BASE + path, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }, (res) => {
      let b = ''; res.on('data', (c) => (b += c));
      res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch { j = b; } resolve({ status: res.statusCode, data: j }); });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
async function main() {
  const results = [];
  const check = (name, cond, extra = '') => { results.push({ name, ok: cond }); console.log(`${cond ? 'OK  ' : 'FAIL'} ${name} ${extra}`); };
  const login = await req('POST', '/api/auth/login', { body: { username: 'admin', password: 'ChangeMe!2026' } });
  check('admin login', login.status === 200);
  const admin = login.data.token;
  const partner = await req('POST', '/api/auth/login', { body: { username: 'partner_test1', password: 'Passw0rd!' } });
  const pTok = partner.data.token;

  // --- assets v4 ---
  const a1 = await req('GET', '/api/assets', { token: admin });
  check('assets list v4', a1.status === 200 && a1.data.length >= 8, `count=${a1.data.length}`);
  check('asset has v4 fields', a1.data[0]?.price_desc && a1.data[0]?.owner_contact, `price=${a1.data[0]?.price_desc}`);
  const ad = await req('GET', '/api/assets/1', { token: admin });
  check('asset detail', ad.status === 200 && ad.data.id === 1 && ad.data.key_specs);
  const am = await req('POST', '/api/assets/match', { token: admin, body: { industry: 'Electronics', company_size: 'Large', need_area: '20,000 m²' } });
  check('asset match', am.status === 200 && Array.isArray(am.data.results), `top=${am.data.results?.[0]?.name}`);

  // --- leads v4 ---
  const lead = await req('POST', '/api/leads', { token: pTok, body: {
    company_name: 'Shenzhen AutoParts Co', industry: 'Automotive', company_size: 'Large',
    need_description: '5–10 ha for EV component plant near Cikarang.', contact_name: 'Mr Zhao', contact_phone: '+86 755 8888 0000',
    contact_email: 'zhao@autoparts.example', source_channel: 'Shenzhen Chamber', estimated_value: 'USD 30M', priority: 'high' } });
  check('lead create v4 (value/priority)', lead.status === 200, `id=${lead.data.id}`);
  const lid = lead.data.id;

  const st = await req('GET', '/api/leads/stats', { token: admin });
  check('lead stats', st.status === 200 && st.data.total >= 1 && st.data.bySource, `total=${st.data.total} funnel=${JSON.stringify(st.data.funnel)}`);
  const ld = await req('GET', `/api/leads/${lid}`, { token: admin });
  check('lead detail (pipeline projects)', ld.status === 200 && Array.isArray(ld.data.followups) && Array.isArray(ld.data.projects), `assignee=${ld.data.assignee?.username || 'none'}`);
  const fu = await req('POST', `/api/leads/${lid}/followups`, { token: admin, body: { action: 'call', note: 'Intro call with Mr Zhao; sent land brochure.' } });
  check('lead followup create', fu.status === 200);
  const fu2 = await req('POST', `/api/leads/${lid}/followups`, { token: admin, body: { action: 'site_visit', note: 'Site visit booked 3 Nov.' } });
  check('lead followup site_visit', fu2.status === 200);
  const ld2 = await req('GET', `/api/leads/${lid}`, { token: admin });
  check('lead detail has followups', ld2.data.followups.length === 2);
  const upd = await req('PUT', `/api/leads/${lid}`, { token: admin, body: { assigned_to: 1, next_action: 'Send proposal', next_follow_at: '2026-11-02 10:00' } });
  check('lead ledger update (assignee/next)', upd.status === 200);
  const ld3 = await req('GET', `/api/leads/${lid}`, { token: admin });
  check('lead assignee persisted', ld3.data.assignee?.username === 'admin' && ld3.data.next_action === 'Send proposal');

  // --- pipeline v4 (entered_at) ---
  const pv = await req('GET', `/api/leads/${lid}/pipeline`, { token: admin });
  check('pipeline view', pv.status === 200 && pv.data.pipeline.entered_at, `entered_at=${pv.data.pipeline?.entered_at}`);
  const adv = await req('PUT', `/api/leads/${lid}/pipeline`, { token: admin, body: { stage: 'matching', note: 'Matched to Plot A7' } });
  check('pipeline advance', adv.status === 200 && adv.data.to === 'matching');

  // --- projects v4 ---
  const proj = await req('POST', '/api/projects', { token: admin, body: {
    lead_id: lid, name: 'EV Components Plant – Cikarang A7', description: 'EV component manufacturing, 6 ha plot.',
    stage: 'matching', progress_pct: 20, estimated_value: 'USD 30M', expected_close: '2027-06', asset_id: 1, status: 'active' } });
  check('project create v4', proj.status === 200, `id=${proj.data.id}`);
  const pid = proj.data.id;
  const pd = await req('GET', `/api/projects/${pid}`, { token: admin });
  check('project detail (asset enrich)', pd.status === 200 && pd.data.asset?.name, `asset=${pd.data.asset?.name}`);
  const ms = await req('POST', `/api/projects/${pid}/milestones`, { token: admin, body: { name: 'Land option signed', due_date: '2026-11-15', status: 'in_progress', note: 'HGB 30yr' } });
  check('milestone create', ms.status === 200);
  const ms2 = await req('POST', `/api/projects/${pid}/milestones`, { token: admin, body: { name: 'Building permit', due_date: '2027-01-10', status: 'pending' } });
  check('milestone create 2', ms2.status === 200);
  const msUpd = await req('PUT', `/api/projects/milestones/${ms.data.id}`, { token: admin, body: { status: 'done' } });
  check('milestone update', msUpd.status === 200);
  const pd2 = await req('GET', `/api/projects/${pid}`, { token: admin });
  check('project detail has milestones', pd2.data.milestones.length === 2 && pd2.data.milestones[0].status === 'done');
  const projUpd = await req('PUT', `/api/projects/${pid}`, { token: admin, body: { progress_pct: 45, stage: 'site_visit', progress_note: 'Site visit completed; LOI issued.' } });
  check('project progress update', projUpd.status === 200);

  // --- dashboard v4 ---
  const sum = await req('GET', '/api/dashboard/summary', { token: admin });
  check('dashboard v4 summary', sum.status === 200 && sum.data.assets.occupancy !== undefined, `occupancy=${sum.data.assets?.occupancy}% weighted=${sum.data.pipeline?.weightedValue}`);
  check('dashboard weighted value', typeof sum.data.pipeline?.weightedValue === 'number');
  check('dashboard funnel', sum.data.pipeline?.funnel && typeof sum.data.pipeline.funnel === 'object', `funnel=${JSON.stringify(sum.data.pipeline?.funnel)}`);
  check('dashboard todos', sum.data.todos && typeof sum.data.todos.leadsToReview === 'number', `toReview=${sum.data.todos?.leadsToReview} due=${sum.data.todos?.followupsDue}`);
  check('dashboard leads weekly', Array.isArray(sum.data.leads?.weeklyTrend));
  check('dashboard stageAges', Array.isArray(sum.data.pipeline?.stageAges) && sum.data.pipeline.stageAges.length > 0);
  check('dashboard avgProgress', typeof sum.data.projects?.avgProgress === 'number');

  const failed = results.filter((x) => !x.ok).length;
  console.log(`\n===== ${results.length - failed}/${results.length} PASSED =====`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('ERR', e); process.exit(1); });
