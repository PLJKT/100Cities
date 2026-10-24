// backend v3 smoke test — assets / leads / pipeline / projects / member profile
const http = require('http');
const BASE = 'http://127.0.0.1:8080';

function req(method, path, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(
      BASE + path,
      { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => {
          let j = null;
          try { j = JSON.parse(b); } catch { j = b; }
          resolve({ status: res.statusCode, data: j });
        });
      }
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function main() {
  const results = [];
  const check = (name, cond, extra = '') => {
    results.push({ name, ok: cond, extra });
    console.log(`${cond ? 'OK  ' : 'FAIL'} ${name} ${extra}`);
  };

  // admin login
  const login = await req('POST', '/api/auth/login', { body: { username: 'admin', password: 'ChangeMe!2026' } });
  check('admin login', login.status === 200, `role=${login.data?.user?.role_name}`);
  const admin = login.data.token;

  // 1) Assets
  const assets = await req('GET', '/api/assets', { token: admin });
  check('assets list', assets.status === 200 && Array.isArray(assets.data), `count=${Array.isArray(assets.data) ? assets.data.length : '-'}`);
  if (assets.data && assets.data.length) check('assets seeded 8 blocks', assets.data.length >= 8, `first=${assets.data[0]?.name}`);
  const cat = await req('GET', '/api/assets/category/sez', { token: admin });
  check('assets by category sez', cat.status === 200 && cat.data.length === 2, `count=${cat.data.length}`);
  const newAsset = await req('POST', '/api/assets', { token: admin, body: { name: 'Test Dry Port Plot B', category: 'dryport', location: 'Cikarang', size_desc: '25 ha', description: 'Smoke test asset', status: 'available' } });
  check('asset create', newAsset.status === 200, `id=${newAsset.data?.id}`);
  const updAsset = await req('PUT', `/api/assets/${newAsset.data.id}`, { token: admin, body: { status: 'reserved' } });
  check('asset update', updAsset.status === 200);

  // 2) Lead: create as channel partner
  const partner = await req('POST', '/api/auth/login', { body: { username: 'partner_test1', password: 'Passw0rd!' } });
  check('partner login', partner.status === 200);
  const pTok = partner.data.token;
  const leadNew = await req('POST', '/api/leads', { token: pTok, body: { company_name: 'Singapore MedTech Pte Ltd', industry: 'Medical Devices', company_size: 'SME', need_description: 'Need 2–5 ha for medtech manufacturing + cleanroom, target Jakarta/Cikarang.', contact_name: 'Ms Tan', contact_phone: '+65 9xxx xxxx', contact_email: 'tan@medtech.example', source_channel: 'SG Enterprise Federation' } });
  check('lead create (channel)', leadNew.status === 200, `id=${leadNew.data?.id} status=${leadNew.data?.status}`);
  const leadId = leadNew.data.id;

  const myLeads = await req('GET', '/api/leads/my', { token: pTok });
  check('lead /my (channel)', myLeads.status === 200 && myLeads.data.length >= 1, `count=${myLeads.data.length}`);
  const forbidden = await req('GET', '/api/leads', { token: pTok });
  check('lead list forbidden for channel', forbidden.status === 403);

  const leadList = await req('GET', '/api/leads', { token: admin });
  check('lead list (admin)', leadList.status === 200, `count=${Array.isArray(leadList.data) ? leadList.data.length : '-'}`);

  // 3) Review pipeline on lead
  const pipe = await req('GET', `/api/leads/${leadId}/pipeline`, { token: admin });
  check('lead pipeline view (admin)', pipe.status === 200 && pipe.data.pipeline, `stage=${pipe.data.pipeline?.stage} events=${pipe.data.events?.length}`);
  const adv1 = await req('PUT', `/api/leads/${leadId}/pipeline`, { token: admin, body: { stage: 'matching', note: 'Qualified, matching to Cikarang plots' } });
  check('lead pipeline advance intake->matching', adv1.status === 200 && adv1.data.to === 'matching');
  const adv2 = await req('PUT', `/api/leads/${leadId}/pipeline`, { token: admin, body: { stage: 'site_visit', note: 'Site visit confirmed 28 Oct' } });
  check('lead pipeline advance matching->site_visit', adv2.status === 200 && adv2.data.to === 'site_visit');
  const pipe2 = await req('GET', `/api/leads/${leadId}/pipeline`, { token: pTok });
  check('lead pipeline view (channel sees own)', pipe2.status === 200, `events=${pipe2.data.events?.length}`);
  const st = await req('GET', '/api/leads', { token: admin });
  const myLead = st.data.find((l) => l.id === leadId);
  check('lead status auto under_review', myLead && myLead.status === 'under_review', `status=${myLead?.status}`);
  const stUpd = await req('PUT', `/api/leads/${leadId}/status`, { token: admin, body: { status: 'approved' } });
  check('lead status approve', stUpd.status === 200);

  // 4) Projects
  const projects = await req('GET', '/api/projects', { token: admin });
  check('projects list', projects.status === 200 && Array.isArray(projects.data), `count=${Array.isArray(projects.data) ? projects.data.length : '-'}`);
  const proj = await req('POST', '/api/projects', { token: admin, body: { lead_id: leadId, name: 'MedTech Cleanroom Plant – Cikarang', description: 'Cleanroom medical device manufacturing, 3–5 ha plot.', stage: 'intake', progress_note: 'Lead approved; land options shared.', status: 'active' } });
  check('project create', proj.status === 200, `id=${proj.data?.id}`);
  const projUpd = await req('PUT', `/api/projects/${proj.data.id}`, { token: admin, body: { stage: 'proposal', progress_note: 'Proposal issued: Plot A7, 4.2 ha, 30-yr HGB.' } });
  check('project progress update', projUpd.status === 200);
  const projDetail = await req('GET', '/api/projects', { token: admin });
  const p1 = projDetail.data.find((p) => p.id === proj.data.id);
  check('project enriched with lead/member', p1 && p1.lead && p1.lead.company_name === 'Singapore MedTech Pte Ltd', p1 ? `lead=${p1.lead?.company_name}` : 'n/a');

  // 5) Member profile (existing)
  const members = await req('GET', '/api/partners', { token: admin });
  check('member profiles list', members.status === 200 && Array.isArray(members.data), `count=${Array.isArray(members.data) ? members.data.length : '-'}`);

  // Pipeline migration check
  const pipeCols = await req('GET', '/api/leads/1/pipeline', { token: admin });
  check('seed lead pipeline usable (lead_id migration)', pipeCols.status === 200, `stage=${pipeCols.data?.pipeline?.stage}`);

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n===== ${results.length - failed}/${results.length} PASSED =====`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('ERR', e); process.exit(1); });
