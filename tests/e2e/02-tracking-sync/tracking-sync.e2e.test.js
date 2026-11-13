'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const CLI_PATH = path.join(REPO_ROOT, 'apps/api/src/workers/tracking-sync-cli.js');
const FIXTURE_PATH = path.join(REPO_ROOT, 'tests/fixtures/02-tracking-sync/google-ads-sync-input.sample.json');
const PRISMA_DIR = path.join(REPO_ROOT, 'packages/database/prisma');

function resolveDbUrl() {
  const independentDbFile = path.join(PRISMA_DIR, 'independent_v2.db').replace(/\\/g, '/');
  const devDbFile = path.join(PRISMA_DIR, 'dev.db').replace(/\\/g, '/');
  const chosenDbFile =
    fs.existsSync(independentDbFile) && fs.statSync(independentDbFile).size > 0
      ? independentDbFile
      : fs.existsSync(devDbFile) && fs.statSync(devDbFile).size > 0
        ? devDbFile
        : independentDbFile;
  const defaultDbUrl = chosenDbFile.startsWith('/') ? `file://${chosenDbFile}` : `file:${chosenDbFile}`;
  return process.env.DATABASE_URL &&
    process.env.DATABASE_URL !== 'file:./dev.db' &&
    process.env.DATABASE_URL !== 'file:./independent_v2.db'
    ? process.env.DATABASE_URL
    : defaultDbUrl;
}

const dbUrl = resolveDbUrl();
const prisma = new PrismaClient({
  datasources: { db: { url: dbUrl } },
});

const {
  MetricsQueryService,
  SyncOrchestratorService,
  getVietnamTodayDateString,
} = require('../../../apps/api/src/modules/02-tracking-sync');

test('E2E 1: Kích hoạt đồng bộ bằng CLI Runner qua file input fixture (google-ads-sync-input.sample.json)', () => {
  assert.ok(fs.existsSync(FIXTURE_PATH), 'File input fixture phải tồn tại');

  // Chạy CLI runner nạp file input fixture
  const output = execFileSync(
    process.execPath,
    [CLI_PATH, '--input', FIXTURE_PATH],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: dbUrl },
    },
  );

  assert.ok(output.includes('[TrackingSyncCLI] Đã nạp cấu hình từ file input:'));
  assert.ok(output.includes('Status: success'));
  assert.ok(output.includes('RecordsSynced:'));
});

test('E2E 2: Đối soát dữ liệu đã ghi vào database (platform_daily_metrics, campaigns, platform_sync_logs)', async () => {
  // 1. Kiểm tra bản ghi log đồng bộ mới nhất
  const latestLog = await prisma.platformSyncLog.findFirst({
    where: { platform: 'google_ads' },
    orderBy: { id: 'desc' },
  });
  assert.ok(latestLog, 'Phải có log đồng bộ trong platform_sync_logs');
  assert.equal(latestLog.status, 'success');
  assert.equal(latestLog.consecutiveFailures, 0);
  assert.ok(latestLog.recordsSynced > 0);

  // 2. Kiểm tra danh mục campaigns đã được cập nhật
  const campaigns = await prisma.campaign.findMany({
    where: { platform: 'google_ads' },
  });
  assert.ok(campaigns.length >= 3, 'Phải có ít nhất 3 chiến dịch Toàn Trung');
  const campCodes = campaigns.map((c) => c.campaignCode);
  assert.ok(campCodes.includes('CMP-LED-INDOOR-P25'));
  assert.ok(campCodes.includes('CMP-LED-OUTDOOR-P4'));
  assert.ok(campCodes.includes('CMP-BOARD-FACTORY'));

  // 3. Kiểm tra các dòng metric chuẩn hóa
  const metrics = await prisma.platformDailyMetric.findMany({
    where: { platform: 'google_ads', accountPropertyId: 'GADS-SYNTH-MOCK-01' },
    take: 20,
    orderBy: { id: 'desc' },
  });
  assert.ok(metrics.length > 0, 'Phải có bản ghi metric trong platform_daily_metrics');

  const todayVn = getVietnamTodayDateString();
  for (const m of metrics) {
    assert.equal(m.currencyCode, 'VND', 'Đơn vị tiền tệ phải là VND');
    assert.ok(m.spendMicros >= 0n, 'Chi phí phải là BigInt không âm');
    if (m.metricDate < todayVn) {
      assert.equal(m.isFinalized, true, 'Ngày quá khứ phải có isFinalized: true');
    } else {
      assert.equal(m.isFinalized, false, 'Ngày hôm nay phải có isFinalized: false');
    }
  }
});

test('E2E 3: Kiểm tra tính lũy đẳng (Idempotency) khi chạy lại nhiều lần cùng file input', async () => {
  const countBefore = await prisma.platformDailyMetric.count({
    where: { platform: 'google_ads', accountPropertyId: 'GADS-SYNTH-MOCK-01' },
  });

  // Chạy lại chính xác cùng file input fixture lần 2
  execFileSync(
    process.execPath,
    [CLI_PATH, '--input', FIXTURE_PATH],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: dbUrl },
    },
  );

  const countAfter = await prisma.platformDailyMetric.count({
    where: { platform: 'google_ads', accountPropertyId: 'GADS-SYNTH-MOCK-01' },
  });

  assert.equal(
    countAfter,
    countBefore,
    'Số lượng bản ghi không được tăng thêm sau khi chạy lặp (Không bị nhân bản dữ liệu)',
  );
});

test('E2E 4: Kiểm thử quy trình Replay lịch sử với khoảng ngày tùy biến', async () => {
  const replayStart = '2026-11-01';
  const replayEnd = '2026-11-04';

  const output = execFileSync(
    process.execPath,
    [CLI_PATH, '--type', 'replay', '--start', replayStart, '--end', replayEnd, '--mock'],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: dbUrl },
    },
  );

  assert.ok(output.includes('Status: success'));
  assert.ok(output.includes(`Window: ${replayStart} -> ${replayEnd}`));

  const replayLog = await prisma.platformSyncLog.findFirst({
    where: { platform: 'google_ads', runType: 'replay', windowStartDate: replayStart },
    orderBy: { id: 'desc' },
  });

  assert.ok(replayLog, 'Phải ghi nhận log replay');
  assert.equal(replayLog.windowStartDate, replayStart);
  assert.equal(replayLog.windowEndDate, replayEnd);
  assert.equal(replayLog.status, 'success');
  // 4 ngày x (3 chiến dịch + 7 từ khóa) = 40 bản ghi
  assert.equal(replayLog.recordsSynced, 40);
});

test('E2E 5: Hợp đồng tiêu thụ dữ liệu cho Module 03 (Từ khóa) và Module 04 (Báo cáo Dashboard)', async () => {
  const queryService = new MetricsQueryService(prisma);

  // 1. Phục vụ Module 04 (Dashboard Báo cáo - Grain Campaign)
  const campaignSummary = await queryService.getMetricsSummary({
    platform: 'google_ads',
    grain: 'campaign',
    metricDateFrom: '2026-11-01',
    metricDateTo: '2026-11-04',
    limit: 50,
    offset: 0,
  });

  assert.equal(campaignSummary.platform, 'google_ads');
  assert.ok(campaignSummary.totalRecords > 0);
  assert.ok(campaignSummary.totalSpend.formattedDecimal);
  assert.equal(campaignSummary.totalSpend.currency, 'VND');
  assert.equal(campaignSummary.totalSpend.scale, 'micros');
  assert.ok(campaignSummary.totalClicks > 0);
  assert.ok(campaignSummary.totalImpressions > 0);
  assert.ok(campaignSummary.avgCtr > 0);

  // 2. Phục vụ Module 03 (Quản lý Từ khóa & Ads - Grain Keyword)
  const keywordResult = await queryService.getDailyMetrics({
    platform: 'google_ads',
    grain: 'keyword',
    metricDateFrom: '2026-11-01',
    metricDateTo: '2026-11-04',
    limit: 100,
    offset: 0,
  });

  assert.ok(keywordResult.total > 0);
  const kwRow = keywordResult.data[0];
  assert.equal(kwRow.grain, 'keyword');
  assert.ok(kwRow.keywordTextNorm, 'Từ khóa phải có keywordTextNorm');
  assert.ok(['EXACT', 'PHRASE', 'BROAD'].includes(kwRow.keywordMatchType));
  assert.ok(kwRow.cpc, 'Từ khóa phải có cpc');
  assert.equal(kwRow.cpc.currency, 'VND');
});

test('E2E 6: Kiểm thử luồng mô phỏng lỗi và khả năng tự phục hồi (Fault Tolerance)', async () => {
  const orchestrator = new SyncOrchestratorService(prisma);

  // Thử nghiệm mô phỏng lỗi xác thực
  const failResult = await orchestrator.executeGoogleAdsSync({
    runType: 'replay',
    startDate: '2026-11-01',
    endDate: '2026-11-02',
    simulateError: 'AUTH_ERROR',
  });

  assert.equal(failResult.status, 'failed');
  assert.ok(failResult.errorMessage.includes('Lỗi xác thực Google Ads API'));
  assert.equal(failResult.recordsSynced, 0);

  // Kiểm tra log ghi nhận chính xác trạng thái lỗi
  const failedLog = await prisma.platformSyncLog.findUnique({
    where: { id: failResult.logId },
  });
  assert.equal(failedLog.status, 'failed');
  assert.ok(failedLog.consecutiveFailures >= 1);
  assert.ok(failedLog.errorMessage);

  // Tiếp tục phiên đồng bộ bình thường -> phải tự động phục hồi về 0 lỗi
  const recoverResult = await orchestrator.executeGoogleAdsSync({
    runType: 'replay',
    startDate: '2026-11-01',
    endDate: '2026-11-02',
    forceMock: true,
  });

  assert.equal(recoverResult.status, 'success');
  const recoveredLog = await prisma.platformSyncLog.findUnique({
    where: { id: recoverResult.logId },
  });
  assert.equal(recoveredLog.status, 'success');
  assert.equal(recoveredLog.consecutiveFailures, 0);
});

test.after(async () => {
  await prisma.$disconnect();
});
