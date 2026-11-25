const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const BASE_URL = 'http://127.0.0.1:3000';
const ARTIFACT_DIR = 'C:\\Users\\vtv55\\.gemini\\antigravity\\brain\\a04b1bb4-54f0-43d1-a010-b12c6cf33c00';

async function loginAndGetCookie(email, password) {
  const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: email, password }),
  });
  assert.equal(res.status, 200, `Login failed for ${email}: ${res.status}`);
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
  const cookieHeader = setCookies.map((c) => c.split(';')[0]).join('; ');
  const body = await res.json();
  return { cookieHeader, body };
}

async function apiGet(pathUrl, cookieHeader) {
  const res = await fetch(`${BASE_URL}${pathUrl}`, {
    headers: { Cookie: cookieHeader },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

function findBrowserExe() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('Could not find Chrome or Edge executable for headless verification.');
}

async function connectCdp(port) {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) {
        return page.webSocketDebuggerUrl;
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Timed out waiting for Chrome DevTools Protocol.');
}

function createCdpClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });

  async function send(method, params = {}) {
    await ready;
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  return { send, close: () => ws.close() };
}

async function main() {
  console.log('1. Verifying API contracts & BA permissions...');
  const adminAuth = await loginAndGetCookie('admin@toantrung.vn', 'ToanTrung@2026');

  const m02All = await apiGet('/api/v1/tracking?view=spec&websiteId=all&preset=7D', adminAuth.cookieHeader);
  assert.equal(m02All.status, 200, 'M02 all failed');
  const m02Data = m02All.json.data || m02All.json;
  assert.ok(Array.isArray(m02Data.coverage.availableWebsites), 'availableWebsites should be array');
  assert.ok(m02Data.coverage.availableWebsites.length >= 2, 'Expected >= 2 configured websites');
  console.log('   Websites:', m02Data.coverage.availableWebsites.map((w) => `${w.shortName}(${w.domain})`).join(', '));

  const firstSite = m02Data.coverage.availableWebsites[0];
  const m02One = await apiGet(`/api/v1/tracking?view=spec&websiteId=${encodeURIComponent(firstSite.websiteId)}&preset=7D`, adminAuth.cookieHeader);
  assert.equal(m02One.status, 200);
  const m02OneData = m02One.json.data || m02One.json;
  assert.equal(m02OneData.scope.websiteId, firstSite.websiteId);

  const m03Yest = await apiGet(`/api/v1/ads?view=spec&websiteId=${encodeURIComponent(firstSite.websiteId)}&preset=YESTERDAY`, adminAuth.cookieHeader);
  assert.equal(m03Yest.status, 200);
  const m03YestData = m03Yest.json.data || m03Yest.json;
  assert.equal(m03YestData.scope.isTodayIncluded, false, 'YESTERDAY must have isTodayIncluded=false');
  assert.equal(m03YestData.scope.startDate, m03YestData.scope.endDate, 'YESTERDAY must be 1-day exact range');

  const m04All = await apiGet('/api/v1/reports?view=spec&websiteId=all&preset=7D', adminAuth.cookieHeader);
  assert.equal(m04All.status, 200);
  const m04Data = m04All.json.data || m04All.json;
  assert.equal(m04Data.scope.cohortDefinition, 'Lead được tạo trong kỳ đã chọn, với kết quả xử lý hiện tại.');

  // Verify SALES role restrictions
  const salesAuth = await loginAndGetCookie('sales@toantrung.vn', 'ToanTrung@2026');
  const salesM02 = await apiGet('/api/v1/tracking?view=spec', salesAuth.cookieHeader);
  assert.equal(salesM02.status, 403, 'SALES must be blocked (403) on /api/v1/tracking');
  const salesM03 = await apiGet('/api/v1/ads?view=spec', salesAuth.cookieHeader);
  assert.equal(salesM03.status, 403, 'SALES must be blocked (403) on /api/v1/ads');
  const salesM04 = await apiGet('/api/v1/reports?view=spec', salesAuth.cookieHeader);
  assert.equal(salesM04.status, 200, 'SALES must have access (200) to own-scoped /api/v1/reports');
  const salesM04Data = salesM04.json.data || salesM04.json;
  assert.equal(salesM04Data.scopeRole, 'SALES', 'SALES report must enforce SALES scopeRole');

  console.log('   API & RBAC checks PASSED!');
  console.log('   Real-data sample (All 7D):', {
    m02Sessions: m02Data.metrics.sessions,
    m02PageViews: m02Data.metrics.pageViews,
    m02ValidFormLeads: m02Data.metrics.validFormLeadCount,
    m03SeoClicks: m03YestData.seo?.metrics?.organicClicks,
    m04TotalLeads: m04Data.metrics.totalLeadCount,
    m04ValidLeads: m04Data.metrics.validLeadCount,
    m04WonLeads: m04Data.metrics.wonLeadCount,
  });

  console.log('2. Launching headless browser for UI, scope persistence, and screenshot verification...');
  const browserExe = findBrowserExe();
  const userDataDir = path.join(process.env.TEMP || 'C:\\Temp', `tt-cdp-${Date.now()}`);
  fs.mkdirSync(userDataDir, { recursive: true });

  const cdpPort = 9229;
  const proc = spawn(
    browserExe,
    [
      `--remote-debugging-port=${cdpPort}`,
      '--headless=new',
      '--disable-gpu',
      '--window-size=1440,960',
      `--user-data-dir=${userDataDir}`,
      `${BASE_URL}/login`,
    ],
    { stdio: 'ignore' }
  );

  try {
    const wsUrl = await connectCdp(cdpPort);
    const cdp = createCdpClient(wsUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    async function waitMs(ms) {
      await new Promise((r) => setTimeout(r, ms));
    }

    async function evalJs(expression) {
      const res = await cdp.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (res.exceptionDetails) {
        throw new Error(`JS error: ${JSON.stringify(res.exceptionDetails)}`);
      }
      return res.result?.value;
    }

    // Wait for /login page
    await waitMs(1500);
    await evalJs(`
      (async () => {
        const res = await fetch('/api/v1/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: 'admin@toantrung.vn', password: 'ToanTrung@2026' })
        });
        return res.status;
      })()
    `);

    // Pre-set shared scope to verify preservation across M02 -> M03 -> M04
    const targetSite = firstSite.websiteId;
    await evalJs(`localStorage.setItem('tt_dashboard_scope_v1', JSON.stringify({ websiteId: '${targetSite}', preset: '30D', from: '', to: '' }))`);

    const pages = [
      { route: '/tracking', file: 'm02-spec.png', mustContain: ['Bảng điều khiển website', 'Truy cập & tương tác', 'Người dùng hoạt động / 30 phút gần nhất'] },
      { route: '/ads', file: 'm03-spec.png', mustContain: ['Bảng điều khiển website', 'Quảng cáo', 'Từ khóa & SEO', 'Tình trạng trang', 'Xu hướng'] },
      { route: '/reports', file: 'm04-spec.png', mustContain: ['Bảng điều khiển website', 'Báo cáo kết quả', 'Tiến trình xử lý Lead', 'Bảng cần xử lý'] },
    ];

    const forbidden = ['Nguồn GA4', 'Dữ liệu Search Console', 'API Google Ads'];

    for (const p of pages) {
      await cdp.send('Page.navigate', { url: `${BASE_URL}${p.route}` });
      await waitMs(2500);

      const state = await evalJs(`
        (() => ({
          text: document.body.innerText,
          scopeRaw: localStorage.getItem('tt_dashboard_scope_v1'),
          overflowX: document.documentElement.scrollWidth > window.innerWidth + 2
        }))()
      `);

      for (const f of forbidden) {
        assert.ok(!state.text.includes(f), `${p.route} exposed forbidden provider text: ${f}`);
      }
      for (const req of p.mustContain) {
        assert.ok(state.text.includes(req), `${p.route} missing expected label: ${req}`);
      }
      const parsedScope = JSON.parse(state.scopeRaw || '{}');
      assert.equal(parsedScope.websiteId, targetSite, `${p.route} lost websiteId scope`);
      assert.equal(parsedScope.preset, '30D', `${p.route} lost preset scope`);
      assert.equal(state.overflowX, false, `${p.route} has horizontal page overflow on desktop`);

      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const outPath = path.join(ARTIFACT_DIR, p.file);
      fs.writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
      console.log(`   Verified & captured ${p.route} -> ${outPath}`);
    }

    cdp.close();
  } finally {
    proc.kill();
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup error on Windows
    }
  }

  console.log('ALL VERIFICATION CHECKS PASSED!');
}

main().catch((err) => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
