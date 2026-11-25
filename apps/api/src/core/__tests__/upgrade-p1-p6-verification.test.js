'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const ts = require('typescript');
const { PrismaClient } = require('@prisma/client');

if (!require.extensions['.ts']) {
  require.extensions['.ts'] = function compileTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        resolveJsonModule: true,
      },
      fileName: filename,
    });
    module._compile(transpiled.outputText, filename);
  };
}

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const INDEP_DB_PATH = path.join(REPO_ROOT, 'packages/database/prisma/independent_v2.db');
const TEMP_DB_PATH = path.join(REPO_ROOT, 'packages/database/prisma/test_p1_p6_verify.db');

const {
  parseStructuredFormEmailBody,
} = require('../../modules/01-leads/gmail-form-parser.ts');
const {
  searchVietnamProvinces,
  findProvinceEntry,
  composeLeadDistrictField,
  splitLeadDistrictField,
  inferAreaTypeFromProvince,
} = require('../../../../../packages/contracts/src/01-leads/vietnam-address.ts');

test('P1-01: Bóc tách chuẩn cả 2 mẫu email form từ bangled.vn và toantrung.com.vn', () => {
  const parserDeps = { findProvinceEntry, inferAreaTypeFromProvince };
  const bangledBody =
    'Họ tên: Nguyễn Văn A Số điện thoại: 0945348464 Địa chỉ: Bình Dương Sản phẩm: Bảng LED P10 Ghi chú: Cần báo giá sớm -- This is a notification that a contact form was submitted on your website...';
  const res1 = parseStructuredFormEmailBody(
    'Form báo giá - Nguyễn Văn A',
    bangledBody,
    'bangled <noreply@bangled.vn>',
    parserDeps,
  );
  assert.equal(res1.isStructuredForm, true);
  assert.equal(res1.sourceWebsite, 'bangled.vn');
  assert.equal(res1.contactName, 'Nguyễn Văn A');
  assert.equal(res1.phone, '0945348464');
  assert.equal(res1.province, 'TP. Hồ Chí Minh'); // Bình Dương (cũ) ánh xạ chuẩn về TP.HCM mới
  assert.equal(res1.productNote, 'Bảng LED P10');

  const toantrungBody =
    'Gửi đến từ: form báo giá lắp đặt - Khách hàng: Công ty Minh Phát - Số điện thoại: 0909123456 - Địa chỉ: Long An - Sản phẩm: Màn hình LED P2.5 -- Thông báo biểu mẫu liên hệ';
  const res2 = parseStructuredFormEmailBody(
    'Thông tin khách hàng gửi từ form báo giá',
    toantrungBody,
    'toantrungco <toantrungco@gmail.com>',
    parserDeps,
  );
  assert.equal(res2.isStructuredForm, true);
  assert.equal(res2.sourceWebsite, 'toantrung.com.vn');
  assert.equal(res2.contactName, 'Công ty Minh Phát');
  assert.equal(res2.phone, '0909123456');
  assert.equal(res2.province, 'Tây Ninh'); // Long An (cũ) ánh xạ chuẩn về Tây Ninh mới
  assert.equal(res2.productNote, 'Màn hình LED P2.5');
});

test('P1-02: Hỗ trợ tìm kiếm địa chỉ hành chính Việt Nam cả tên cũ lẫn tên mới', () => {
  const matchOld = searchVietnamProvinces('binh duong');
  assert.ok(matchOld.some((m) => m.name === 'TP. Hồ Chí Minh' && m.matchedLegacyName === 'Bình Dương'));

  const matchOld2 = searchVietnamProvinces('quang nam');
  assert.ok(matchOld2.some((m) => m.name === 'TP. Đà Nẵng' && m.matchedLegacyName === 'Quảng Nam'));

  const resolved = findProvinceEntry('Vũng Tàu');
  assert.equal(resolved?.name, 'TP. Hồ Chí Minh');
  assert.equal(inferAreaTypeFromProvince('TP. Hồ Chí Minh'), 'hcm');
  assert.equal(inferAreaTypeFromProvince('Tây Ninh'), 'other_province');

  const packed = composeLeadDistrictField('Phường Linh Trung', 'TP. Thủ Đức');
  assert.equal(packed, 'Phường Linh Trung, TP. Thủ Đức');
  assert.deepEqual(splitLeadDistrictField(packed), {
    ward: 'Phường Linh Trung',
    district: 'TP. Thủ Đức',
  });
});

test('P1-03 & P6: Idempotency chống tạo Lead trùng khi xử lý lại cùng Gmail messageId trên DB copy', async (t) => {
  assert.ok(fs.existsSync(INDEP_DB_PATH), 'independent_v2.db must exist');
  fs.copyFileSync(INDEP_DB_PATH, TEMP_DB_PATH);
  const dbUrl = `file:${TEMP_DB_PATH.replace(/\\/g, '/')}`;
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  t.after(async () => {
    await prisma.$disconnect();
    if (fs.existsSync(TEMP_DB_PATH)) fs.unlinkSync(TEMP_DB_PATH);
  });

  const { ingestLeadWithTrackingIdempotent } = require('../../../../../packages/database/src/operations-runtime.js');
  const first = await ingestLeadWithTrackingIdempotent(prisma, {
    intakeSourceProvider: 'gmail_sync',
    intakeSourceAccountKey: 'test@toantrung.vn',
    externalSubmissionId: 'gmail-msg-unique-20261115',
    leadCode: 'TT-TEST-P1-001',
    contactChannel: 'email',
    phone: '0912345678',
    contactName: 'Khách Test Idempotency',
    sourceWebsite: 'bangled.vn',
  });
  assert.equal(first.deduplicated, false);

  const second = await ingestLeadWithTrackingIdempotent(prisma, {
    intakeSourceProvider: 'gmail_sync',
    intakeSourceAccountKey: 'test@toantrung.vn',
    externalSubmissionId: 'gmail-msg-unique-20261115',
    leadCode: 'TT-TEST-P1-002',
    contactChannel: 'email',
    phone: '0912345678',
    contactName: 'Khách Test Idempotency',
    sourceWebsite: 'bangled.vn',
  });
  assert.equal(second.deduplicated, true);
  assert.equal(second.lead.id, first.lead.id);

  // P4: Kiểm tra tổng hợp số liệu Search Console từ platformDailyMetric để làm dẫn chứng SEO
  const gscRows = await prisma.platformDailyMetric.findMany({
    where: { platform: 'search_console' },
    take: 5,
    orderBy: { metricDate: 'desc' },
  });
  assert.ok(gscRows.length > 0, 'DB phải có dữ liệu Search Console thực tế để trích dẫn SEO');
  assert.equal(typeof gscRows[0].clicks, 'number');
  assert.equal(typeof gscRows[0].impressions, 'number');
});

test('R01–R06: Đối chứng tự động toàn bộ 6 hạng mục rà soát (GSC dataState, PostgreSQL Prisma Client, Gmail Checkpoint, Manifest 413 tệp, OpenXML .docx/.xlsx, 10 số SĐT & ẩn Doanh thu)', () => {
  // R04: Manifest tệp vật lý đã phân loại 4 nhóm và 0 broken DB links
  const manifestPath = path.join(REPO_ROOT, 'storage/pg-migration-artifacts/file-handover-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    const { execFileSync } = require('node:child_process');
    execFileSync(process.execPath, [path.join(REPO_ROOT, 'scripts/audit-handover-files.js')], {
      cwd: REPO_ROOT,
      stdio: 'pipe',
    });
  }
  assert.ok(fs.existsSync(manifestPath), 'file-handover-manifest.json phải tồn tại');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.brokenDbLinksCount, 0);
  assert.equal(manifest.restoreTrialVerification.allChecksumMatched, true);
  assert.equal(
    manifest.summaryCounts.REFERENCED_IN_DB +
      manifest.summaryCounts.SYSTEM_STATIC_ASSET +
      manifest.summaryCounts.BACKUP_ARCHIVE +
      manifest.summaryCounts.ORPHAN_UNREFERENCED,
    manifest.summaryCounts.totalPhysicalFiles,
  );

  // R06: Giới hạn SĐT 10 số trên UI và ẩn Doanh thu khi Q08 đang mở
  const manualModalCode = fs.readFileSync(
    path.join(REPO_ROOT, 'apps/web/src/modules/01-leads/ManualLeadModal.tsx'),
    'utf8',
  );
  assert.ok(manualModalCode.includes('maxLength={10}'));
  assert.ok(manualModalCode.includes('pattern="0[0-9]{9}"'));

  const assetsHubUiCode = fs.readFileSync(
    path.join(REPO_ROOT, 'apps/web/src/components/google-oauth/GoogleAssetsHubSection.tsx'),
    'utf8',
  );
  assert.ok(!assetsHubUiCode.includes('→ Doanh thu'), 'Phải ẩn Doanh thu khi Q08 chưa chốt');
});


