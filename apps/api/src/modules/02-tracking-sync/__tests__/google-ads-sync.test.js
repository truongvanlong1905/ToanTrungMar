'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const {
  GoogleAdsMockAdapter,
  GoogleAdsAuthError,
  GoogleAdsRateLimitError,
  GoogleAdsTimeoutError,
  normalizeGoogleAdsCampaignRow,
  normalizeGoogleAdsKeywordRow,
  getVietnamTodayDateString,
  SyncOrchestratorService,
  MetricsQueryService,
} = require('../');

const REPO_ROOT = path.resolve(__dirname, '../../../../../..');
const PRISMA_DIR = path.join(REPO_ROOT, 'packages/database/prisma');

function createDisposableDbUrl(t, prefix) {
  const folderName = `.tmp-tt-db-${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpDir = path.join(PRISMA_DIR, folderName);
  fs.mkdirSync(tmpDir, { recursive: true });
  t.after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore Windows file lock delay
    }
  });
  const dbUrl = `file:./${folderName}/disposable.db`;
  return { tmpDir, dbUrl };
}

function splitSqlStatements(sqlText) {
  return sqlText
    .replace(/^\s*--.*$/gm, '')
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function applyMigrations(client) {
  const mig1 = fs.readFileSync(
    path.join(PRISMA_DIR, 'migrations/20261105000000_0001_core_baseline/migration.sql'),
    'utf8',
  );
  const mig2 = fs.readFileSync(
    path.join(PRISMA_DIR, 'migrations/20261106000000_0002_five_modules_shared_schema/migration.sql'),
    'utf8',
  );
  for (const sqlText of [mig1, mig2]) {
    for (const stmt of splitSqlStatements(sqlText)) {
      await client.$executeRawUnsafe(stmt);
    }
  }
}

test('Unit 1: GoogleAdsMockAdapter returns synthetic campaigns and keywords with deterministic idempotency', async () => {
  const adapter = new GoogleAdsMockAdapter('TEST-MOCK-ACCOUNT');
  const window = { startDate: '2026-11-01', endDate: '2026-11-03' };

  const campaigns = await adapter.fetchCampaignMetrics(window);
  assert.equal(campaigns.length, 9); // 3 days x 3 campaigns = 9 rows

  const first = campaigns[0];
  assert.ok(first.campaignId);
  assert.ok(first.campaignName);
  assert.ok(BigInt(first.costMicros) > 0n);
  assert.ok(first.clicks > 0);
  assert.ok(first.impressions > first.clicks);
  assert.equal(first.currencyCode, 'VND');

  // Verify deterministic repeatability
  const campaigns2 = await adapter.fetchCampaignMetrics(window);
  assert.deepEqual(campaigns, campaigns2);

  const keywords = await adapter.fetchKeywordMetrics(window);
  assert.equal(keywords.length, 21); // 3 days x 7 keywords = 21 rows
  const kw = keywords[0];
  assert.ok(['EXACT', 'PHRASE', 'BROAD'].includes(kw.matchType));
  assert.ok(BigInt(kw.costMicros) > 0n);
  assert.equal(kw.currencyCode, 'VND');
});

test('Unit 2: GoogleAdsMockAdapter simulates errors and empty results accurately', async () => {
  const adapter = new GoogleAdsMockAdapter();
  const window = { startDate: '2026-11-01', endDate: '2026-11-01' };

  await assert.rejects(
    () => adapter.fetchCampaignMetrics(window, { simulateError: 'AUTH_ERROR' }),
    GoogleAdsAuthError,
  );

  await assert.rejects(
    () => adapter.fetchCampaignMetrics(window, { simulateError: 'RATE_LIMIT' }),
    GoogleAdsRateLimitError,
  );

  await assert.rejects(
    () => adapter.fetchCampaignMetrics(window, { simulateError: 'TIMEOUT' }),
    GoogleAdsTimeoutError,
  );

  const empty = await adapter.fetchCampaignMetrics(window, { simulateError: 'EMPTY' });
  assert.deepEqual(empty, []);
});

test('Unit 3: Normalizer converts rows to BigInt micros and assigns correct finalized status', () => {
  const todayVn = getVietnamTodayDateString();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const yesterdayCamp = normalizeGoogleAdsCampaignRow(
    {
      campaignId: 'CMP-01',
      campaignName: 'Chiến dịch LED',
      campaignStatus: 'ENABLED',
      date: yesterday,
      costMicros: '15000000000000', // 15,000,000 VND
      dailyBudgetMicros: '5000000000000',
      averageCpcMicros: '30000000000',
      impressions: 10000,
      clicks: 500,
      conversions: 8.5,
      currencyCode: 'VND',
    },
    'GADS-01',
    todayVn,
  );

  assert.equal(yesterdayCamp.spendMicros, 15000000000000n);
  assert.equal(yesterdayCamp.dailyBudgetMicros, 5000000000000n);
  assert.equal(yesterdayCamp.cpcMicros, 30000000000n);
  assert.equal(yesterdayCamp.conversionsMicros, 8500000n); // 8.5 x 1M
  assert.equal(yesterdayCamp.currencyCode, 'VND');
  assert.equal(yesterdayCamp.isFinalized, true);

  const todayCamp = normalizeGoogleAdsCampaignRow(
    {
      campaignId: 'CMP-01',
      campaignName: 'Chiến dịch LED',
      campaignStatus: 'ENABLED',
      date: todayVn,
      costMicros: '2000000000000',
      impressions: 1200,
      clicks: 60,
      conversions: 1.0,
      currencyCode: 'VND',
    },
    'GADS-01',
    todayVn,
  );

  assert.equal(todayCamp.isFinalized, false); // Today is preliminary
});

test('Integration: SyncOrchestratorService idempotency, error recovery and notification on 3 failures', async (t) => {
  const { dbUrl } = createDisposableDbUrl(t, 'sync-orch');
  const client = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  t.after(() => client.$disconnect());

  await applyMigrations(client);

  // Tạo một tài khoản Admin để nhận notification
  const adminRole = await client.role.upsert({
    where: { roleCode: 'ADMIN' },
    update: {},
    create: {
      roleCode: 'ADMIN',
      roleName: 'Quản trị viên',
    },
  });
  const adminUser = await client.user.create({
    data: {
      roleId: adminRole.id,
      email: 'admin.sync.test@toantrung.vn',
      fullName: 'Quản trị viên Hệ thống',
      passwordHash: 'dummy',
    },
  });

  const orchestrator = new SyncOrchestratorService(client);

  // 1. Chạy đồng bộ lần 1 cho 2 ngày
  const res1 = await orchestrator.executeGoogleAdsSync({
    runType: 'replay',
    startDate: '2026-11-05',
    endDate: '2026-11-06',
    forceMock: true,
  });

  assert.equal(res1.status, 'success');
  assert.ok(res1.recordsSynced > 0);

  const countAfterRun1 = await client.platformDailyMetric.count();
  assert.equal(countAfterRun1, res1.recordsSynced);

  // Kiểm tra bảng campaigns đã được cập nhật
  const campaignsInDb = await client.campaign.findMany({ where: { platform: 'google_ads' } });
  assert.equal(campaignsInDb.length, 3);

  // 2. Chạy lặp lại chính xác cùng khoảng ngày -> Số lượng dòng KHÔNG ĐƯỢC TĂNG (Tính lũy đẳng)
  const res2 = await orchestrator.executeGoogleAdsSync({
    runType: 'replay',
    startDate: '2026-11-05',
    endDate: '2026-11-06',
    forceMock: true,
  });

  assert.equal(res2.status, 'success');
  const countAfterRun2 = await client.platformDailyMetric.count();
  assert.equal(countAfterRun2, countAfterRun1, 'Số dòng không được tăng sau khi chạy lặp (Idempotent upsert)');

  // 3. Kiểm tra kết quả rỗng (EMPTY): ghi nhận success với 0 records, KHÔNG phải lỗi
  const resEmpty = await orchestrator.executeGoogleAdsSync({
    runType: 'replay',
    startDate: '2026-11-05',
    endDate: '2026-11-06',
    simulateError: 'EMPTY',
  });
  assert.equal(resEmpty.status, 'success');
  assert.equal(resEmpty.recordsSynced, 0);

  // 4. Kiểm tra mô phỏng lỗi 3 lần liên tiếp và phát cảnh báo UC03 E2
  const fail1 = await orchestrator.executeGoogleAdsSync({
    runType: 'replay',
    startDate: '2026-11-05',
    endDate: '2026-11-06',
    simulateError: 'AUTH_ERROR',
  });
  assert.equal(fail1.status, 'failed');

  const log1 = await client.platformSyncLog.findUnique({ where: { id: fail1.logId } });
  assert.equal(log1.consecutiveFailures, 1);

  const fail2 = await orchestrator.executeGoogleAdsSync({
    runType: 'replay',
    startDate: '2026-11-05',
    endDate: '2026-11-06',
    simulateError: 'RATE_LIMIT',
  });
  const log2 = await client.platformSyncLog.findUnique({ where: { id: fail2.logId } });
  assert.equal(log2.consecutiveFailures, 2);

  const fail3 = await orchestrator.executeGoogleAdsSync({
    runType: 'replay',
    startDate: '2026-11-05',
    endDate: '2026-11-06',
    simulateError: 'TIMEOUT',
  });
  const log3 = await client.platformSyncLog.findUnique({ where: { id: fail3.logId } });
  assert.equal(log3.consecutiveFailures, 3);

  // Xác nhận Notification cảnh báo đã được gửi tới Admin
  const notifications = await client.notification.findMany({
    where: { userId: adminUser.id, category: 'Hệ thống' },
  });
  assert.ok(notifications.length >= 1);
  assert.ok(notifications[0].title.includes('3 lần thất bại'));

  // 5. Kiểm tra MetricsQueryService trả về DTO chuẩn cho M03/M04
  const queryService = new MetricsQueryService(client);
  const summary = await queryService.getMetricsSummary({
    platform: 'google_ads',
    metricDateFrom: '2026-11-05',
    metricDateTo: '2026-11-06',
    limit: 100,
    offset: 0,
  });

  assert.equal(summary.platform, 'google_ads');
  assert.ok(summary.totalRecords > 0);
  assert.ok(BigInt(summary.totalSpend.rawAmountString) > 0n);
  assert.equal(summary.totalSpend.currency, 'VND');
  assert.ok(summary.totalImpressions > 0);
  assert.ok(summary.totalClicks > 0);
  assert.ok(summary.avgCtr > 0);
});
