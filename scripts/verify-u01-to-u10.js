'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');
const { PrismaClient } = require('../packages/database/generated/postgres-client');

const BASE_URL = 'http://127.0.0.1:3000';
const PG_URL =
  process.env.PG_DATABASE_URL ||
  'postgresql://postgres@127.0.0.1:55432/toantrung_v2_trial?schema=public';
const ARTIFACT_DIR = path.resolve(__dirname, '../storage/pg-migration-artifacts');
const SQLITE_PATH = path.resolve(__dirname, '../packages/database/prisma/independent_v2.db');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

async function apiFetch(pathname, { method = 'GET', cookie = '', csrfToken = '', body } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (csrfToken) headers['x-csrf-token'] = csrfToken;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    return { status: res.status, headers: res.headers, json: await res.json() };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, buffer: buf };
}

async function loginAs(identifier, password) {
  const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  const setCookie = res.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';')[0];
  const json = await res.json();
  return { cookie, csrfToken: json.data?.user?.csrfToken || '' };
}

async function captureScreenshots(cookie) {
  if (!fs.existsSync(CHROME_PATH)) {
    return { skipped: true, reason: 'Chrome not found' };
  }
  const userDataDir = path.join(
    process.env.LOCALAPPDATA || 'C:\\Temp',
    `chrome-u06-verify-${Date.now()}`,
  );
  fs.mkdirSync(userDataDir, { recursive: true });
  const cdpPort = 9355;
  const proc = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${userDataDir}`,
      '--window-size=1440,900',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  await new Promise((r) => setTimeout(r, 1500));
  const targetsResp = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
  const targets = await targetsResp.json();
  const pageTarget = targets.find((t) => t.type === 'page') || targets[0];
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);

  let cmdId = 1;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  };
  await new Promise((resolve) => {
    ws.onopen = resolve;
  });

  const cdp = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = cmdId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  const eqIdx = cookie.indexOf('=');
  const cookieName = eqIdx > 0 ? cookie.slice(0, eqIdx).trim() : '';
  const cookieVal = eqIdx > 0 ? cookie.slice(eqIdx + 1).trim() : '';
  await cdp('Network.enable');
  if (cookieName && cookieVal) {
    await cdp('Network.setCookie', {
      url: BASE_URL,
      name: cookieName,
      value: cookieVal,
      path: '/',
    });
  }

  const shots = {};
  for (const route of [
    { key: 'leads', url: `${BASE_URL}/leads`, file: 'u06-after-leads.png' },
    { key: 'tracking', url: `${BASE_URL}/tracking`, file: 'u06-after-tracking.png' },
    { key: 'reports', url: `${BASE_URL}/reports`, file: 'u06-after-reports.png' },
  ]) {
    await cdp('Page.navigate', { url: route.url });
    await new Promise((r) => setTimeout(r, 2500));
    const headerCheck = await cdp('Runtime.evaluate', {
      expression: `({
        hasRealtimeBadgeInHeader: document.querySelector('header')?.innerText.includes('Realtime Live') || false,
        hasTickerBanner: document.body.innerText.includes('HỆ THỐNG THEO DÕI') || document.body.innerText.includes('Hệ Thống Theo Dõi'),
        has15sCountdown: /\\b1[0-5]s\\b/.test(document.body.innerText),
        title: document.title
      })`,
      returnByValue: true,
    });
    const shot = await cdp('Page.captureScreenshot', { format: 'png' });
    const outFile = path.join(ARTIFACT_DIR, route.file);
    fs.writeFileSync(outFile, Buffer.from(shot.data, 'base64'));
    shots[route.key] = {
      path: outFile,
      sizeBytes: fs.statSync(outFile).size,
      domChecks: headerCheck.result.value,
    };
  }

  ws.close();
  proc.kill();
  return shots;
}

async function main() {
  const sqliteBefore = sha256File(SQLITE_PATH);
  const pg = new PrismaClient({ datasources: { db: { url: PG_URL } } });
  const admin = await loginAs('admin@toantrung.vn', 'ToanTrung@2026');
  const sales = await loginAs('sales@toantrung.vn', 'ToanTrung@2026');
  const report = { verifiedAt: new Date().toISOString() };

  const createdLeadIdsToCleanup = [];
  const origCheckpoint = await pg.systemSetting.findUnique({ where: { key: 'gmail_sync_checkpoint' } });
  const origConfig = await pg.systemSetting.findUnique({ where: { key: 'gmail_lead_sync_config' } });

  try {
    // U01 + U02: Burst pagination (5 emails with maxMessages=2 => 3 pages), signature phone rejection, 2 websites + unresolved, idempotency
    const baseMs = Date.now();
    const mockEmails = [
      {
        id: `u01-msg-1-${baseMs}`,
        internalDate: String(baseMs - 5000),
        from: 'bangled <noreply@gmail.com>',
        subject: 'Form báo giá - Khách U01 Bangled',
        bodyText: 'Website: https://www.bangled.vn/bao-gia-led\nTrang gửi: https://www.bangled.vn/bao-gia-led?utm_source=google&utm_medium=cpc&gclid=u01gclid1\nMã gửi: sub-u01-bangled-1\nHọ tên: Khách Kiểm Chứng U01A\nSố điện thoại: 0945111222\nSản phẩm: Bảng LED P10\n-- This is a notification that a contact form was submitted on your website',
      },
      {
        id: `u01-msg-2-${baseMs}`,
        internalDate: String(baseMs - 4000),
        from: 'toantrungco <noreply@gmail.com>',
        subject: 'Thông tin khách hàng gửi từ form báo giá',
        bodyText: 'Website: toantrung.com.vn\nGửi đến từ: form báo giá lắp đặt\nKhách hàng: Khách Kiểm Chứng U01B\nSố điện thoại: 0987222333\nĐịa chỉ: Bình Dương\nSản phẩm: Màn hình LED P3\n-- Thông báo biểu mẫu liên hệ',
      },
      {
        id: `u01-msg-3-${baseMs}`,
        internalDate: String(baseMs - 3000),
        from: 'promo@quangcao-ngoai.vn',
        subject: 'Ưu đãi tên miền tháng 11',
        bodyText: 'Đăng ký ngay hôm nay để nhận ưu đãi!\n--\nTrân trọng\nHotline: 0911222333\nWebsite: https://quangcao-ngoai.vn',
      },
      {
        id: `u01-msg-4-${baseMs}`,
        internalDate: String(baseMs - 2000),
        from: 'khach-truc-tiep@gmail.com',
        subject: 'Hỏi giá lắp đặt màn hình LED hội trường',
        bodyText: 'Chào công ty, bên mình cần báo giá màn hình LED P2.5 kích thước 4x2m, liên hệ 0933444555.\n--\nBest regards\nFacebook: https://facebook.com/abc',
      },
      {
        id: `u01-msg-5-${baseMs}`,
        internalDate: String(baseMs - 1000),
        from: 'no-reply@accounts.google.com',
        subject: 'Security alert',
        bodyText: 'Your verification code is 123456. Hotline hỗ trợ: 0900111222',
      },
    ];

    const u01Pass1 = await apiFetch('/api/v1/leads/gmail-sync', {
      method: 'POST',
      cookie: admin.cookie,
      csrfToken: admin.csrfToken,
      body: {
        action: 'sync_now',
        maxMessages: 2,
        onlyLeadKeywords: true,
        mockMessages: mockEmails,
        mockConnectedEmail: 'crm-intake@toantrung.vn',
      },
    });
    for (const cl of u01Pass1.json.data?.createdLeads || []) {
      createdLeadIdsToCleanup.push(cl.id);
    }

    const u01Pass2 = await apiFetch('/api/v1/leads/gmail-sync', {
      method: 'POST',
      cookie: admin.cookie,
      csrfToken: admin.csrfToken,
      body: {
        action: 'sync_now',
        maxMessages: 2,
        onlyLeadKeywords: true,
        mockMessages: mockEmails,
        mockConnectedEmail: 'crm-intake@toantrung.vn',
      },
    });

    const u01LeadsInDb = await pg.lead.findMany({
      where: { id: { in: createdLeadIdsToCleanup } },
      include: { tracking: true },
      orderBy: { id: 'asc' },
    });

    report.u01_u02 = {
      pass1Status: u01Pass1.status,
      pass1Summary: u01Pass1.json.data?.summary,
      pass2DedupSummary: u01Pass2.json.data?.summary,
      statusEndpoint: (await apiFetch('/api/v1/leads/gmail-sync', { cookie: admin.cookie })).json.data?.serverStatus,
      syncMode: (await apiFetch('/api/v1/leads/gmail-sync', { cookie: admin.cookie })).json.data?.syncMode,
      createdLeadWebsites: u01LeadsInDb.map((l) => ({
        id: l.id,
        contactName: l.contactName,
        sourceWebsite: l.sourceWebsite,
        contactChannel: l.contactChannel,
        marketingSource: l.tracking?.marketingSource,
      })),
    };

    // U03 + U05: Tracking & Reports with YESTERDAY
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const trackingYesterday = await apiFetch(`/api/v1/tracking?periodDays=1&preset=YESTERDAY`, {
      cookie: admin.cookie,
    });
    const reportsYesterday = await apiFetch(
      `/api/v1/reports?preset=custom&fromDate=${yesterday}&toDate=${yesterday}`,
      { cookie: admin.cookie },
    );
    const reportsExportYesterday = await apiFetch(
      `/api/v1/reports/export?preset=custom&fromDate=${yesterday}&toDate=${yesterday}`,
      { cookie: admin.cookie },
    );

    report.u03_u05 = {
      trackingHttp: trackingYesterday.status,
      trackingDateRange: trackingYesterday.json.data?.dateRange,
      trackingTodayNotice: trackingYesterday.json.data?.todayPreliminaryNotice,
      sourceStatusesCount: trackingYesterday.json.data?.sourceStatuses?.length || 0,
      sourceStatusesSummary: (trackingYesterday.json.data?.sourceStatuses || []).map((s) => ({
        sourceKey: s.sourceKey,
        connectionStatus: s.connectionStatus,
        lastSuccessAt: s.lastSuccessAt,
      })),
      reportsYesterdayHttp: reportsYesterday.status,
      reportsYesterdayExportHttp: reportsExportYesterday.status,
      reportsYesterdayExportBytes: reportsExportYesterday.buffer?.length || 0,
    };

    // U08: Check ZIP download on DesignRequest #148
    const zipResp = await apiFetch('/api/v1/design/148/download-zip', { cookie: admin.cookie });
    report.u08_zip = {
      httpStatus: zipResp.status,
      sizeBytes: zipResp.buffer?.length || 0,
      isPkZip: Boolean(zipResp.buffer && zipResp.buffer.slice(0, 2).toString('utf8') === 'PK'),
    };

    // U10: Permission checks (SALES cannot access /api/v1/users or /api/v1/tracking or /api/v1/settings/backup)
    const salesUsersCheck = await apiFetch('/api/v1/users', { cookie: sales.cookie });
    const salesTrackingCheck = await apiFetch('/api/v1/tracking', { cookie: sales.cookie });
    const salesBackupCheck = await apiFetch('/api/v1/settings/backup', { cookie: sales.cookie });
    report.u10_permissions = {
      salesUsersHttp: salesUsersCheck.status,
      salesTrackingHttp: salesTrackingCheck.status,
      salesBackupHttp: salesBackupCheck.status,
    };

    // U06: Live Chrome screenshots
    report.u06_screenshots = await captureScreenshots(admin.cookie);
  } finally {
    // Cleanup temporary U01 test leads & restore original checkpoint/config
    if (createdLeadIdsToCleanup.length > 0) {
      await pg.leadActivity.deleteMany({ where: { leadId: { in: createdLeadIdsToCleanup } } });
      await pg.marketingTracking.deleteMany({ where: { leadId: { in: createdLeadIdsToCleanup } } });
      await pg.lead.deleteMany({ where: { id: { in: createdLeadIdsToCleanup } } });
    }
    if (origCheckpoint) {
      await pg.systemSetting.upsert({
        where: { key: 'gmail_sync_checkpoint' },
        update: { value: origCheckpoint.value },
        create: { key: 'gmail_sync_checkpoint', value: origCheckpoint.value },
      });
    }
    if (origConfig) {
      await pg.systemSetting.upsert({
        where: { key: 'gmail_lead_sync_config' },
        update: { value: origConfig.value },
        create: { key: 'gmail_lead_sync_config', value: origConfig.value },
      });
    }
    report.pgLeadsAfterVerification = await pg.lead.count();
    await pg.$disconnect();
  }

  const sqliteAfter = sha256File(SQLITE_PATH);
  report.sqliteUnchanged = sqliteBefore === sqliteAfter;

  const outPath = path.join(ARTIFACT_DIR, 'u01-u10-verification-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
