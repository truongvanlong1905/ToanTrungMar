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
const TEMP_DB_PATH = path.join(REPO_ROOT, 'packages/database/prisma/test_m01_website_verify.db');

const {
  parseStructuredFormEmailBody,
  normalizeWebsiteDomain,
} = require('../../modules/01-leads/gmail-form-parser.ts');
const {
  findProvinceEntry,
  inferAreaTypeFromProvince,
} = require('../../../../../packages/contracts/src/01-leads/vietnam-address.ts');
const {
  ingestLeadWithTrackingIdempotent,
} = require('../../../../../packages/database/src/operations-runtime.js');

const parserDeps = { findProvinceEntry, inferAreaTypeFromProvince };

test('M01-05.1: Form từ bangled.vn gửi vào Gmail quản lý -> Website nguồn bangled.vn', () => {
  const body =
    'Họ tên: Nhóm mkt xin test lần 4 Số điện thoại: 0945348464 Địa chỉ: TP.HCM Sản phẩm: Bảng LED P10 Ghi chú: Cần báo giá -- This is a notification that a contact form was submitted on your website...';
  const res = parseStructuredFormEmailBody(
    'Form báo giá - Họ tên: Nhóm mkt xin test lần 4',
    body,
    'bangled <noreply@gmail.com>',
    parserDeps,
  );
  assert.equal(res.sourceWebsite, 'bangled.vn');
  assert.equal(res.contactChannel, 'form_web');
  assert.equal(res.websiteResolutionMethod, 'verified_form_template');
});

test('M01-05.2: Form từ toantrung.com.vn cùng Gmail nhận -> Website nguồn toantrung.com.vn', () => {
  const body =
    'Gửi đến từ: form báo giá lắp đặt - Khách hàng: Ads test - Số điện thoại: 0900000000 - Địa chỉ: Bình Dương - Sản phẩm: Màn hình LED P3 -- Thông báo biểu mẫu liên hệ';
  const res = parseStructuredFormEmailBody(
    'Thông tin khách hàng gửi từ form báo giá',
    body,
    'toantrungco <noreply@gmail.com>',
    parserDeps,
  );
  assert.equal(res.sourceWebsite, 'toantrung.com.vn');
  assert.equal(res.contactChannel, 'form_web');
  assert.equal(res.websiteResolutionMethod, 'structured_field');
});

test('M01-05.3: Hai website dùng chung địa chỉ gửi thư vẫn phân biệt được bằng metadata hoặc mẫu form', () => {
  const sharedSender = 'mailer <mailer@chung-he-thong.vn>';

  const fromBangled = parseStructuredFormEmailBody(
    'Liên hệ mới',
    'Website: https://www.bangled.vn/bao-gia\nTrang gửi: https://www.bangled.vn/bao-gia?utm_source=google\nHọ tên: Anh Minh\nSố điện thoại: 0912345678\nSản phẩm: Bảng LED P5',
    sharedSender,
    parserDeps,
  );
  assert.equal(fromBangled.sourceWebsite, 'bangled.vn');
  assert.equal(fromBangled.landingPageUrl, 'https://www.bangled.vn/bao-gia?utm_source=google');
  assert.equal(fromBangled.websiteResolutionMethod, 'metadata_url');

  const fromToanTrung = parseStructuredFormEmailBody(
    'Thông tin khách hàng gửi từ form báo giá',
    'Khách hàng: Chị Lan\nSố điện thoại: 0987654321\nSản phẩm: Màn hình LED P2.5\n-- Thông báo biểu mẫu liên hệ',
    sharedSender,
    parserDeps,
  );
  assert.equal(fromToanTrung.sourceWebsite, 'toantrung.com.vn');
  assert.equal(fromToanTrung.websiteResolutionMethod, 'verified_form_template');
});

test('M01-05.4: Thư được chuyển tiếp giữ nguyên website gốc khi còn đủ căn cứ', () => {
  const forwardedBody =
    '---------- Forwarded message ---------\n' +
    'From: Mailer <mailer@gmail.com>\n\n' +
    '> Gửi đến từ: form báo giá lắp đặt\n' +
    '> Khách hàng: Công ty An Khang\n' +
    '> Số điện thoại: 0908111222\n' +
    '> Sản phẩm: LED P4 Outdoor\n' +
    '> -- Thông báo biểu mẫu liên hệ';
  const res = parseStructuredFormEmailBody(
    'Fwd: Thông tin khách hàng gửi từ form báo giá',
    forwardedBody,
    'quanly@toantrung.vn',
    parserDeps,
  );
  assert.equal(res.sourceWebsite, 'toantrung.com.vn');
  assert.equal(res.contactChannel, 'form_web');
  assert.equal(res.phone, '0908111222');
});

test('M01-05.5: Thư chỉ có tên và SĐT, không có dấu hiệu website (kể cả có chữ ký/mạng xã hội) -> Chưa xác định website (null)', () => {
  const bodyWithSignature =
    'Họ tên: Anh Tuấn\n' +
    'Số điện thoại: 0933444555\n' +
    'Nhu cầu: Tư vấn màn hình hội trường\n' +
    '-- \n' +
    'Trân trọng,\n' +
    'Phòng Kinh Doanh\n' +
    'Facebook: https://facebook.com/toantrung\n' +
    'Website: https://toantrung.com.vn';
  const res = parseStructuredFormEmailBody(
    'Khách cần tư vấn gấp',
    bodyWithSignature,
    'sales@bangled.vn',
    parserDeps,
  );
  assert.equal(res.sourceWebsite, null);
  assert.equal(res.websiteResolutionMethod, 'unresolved');
  assert.equal(normalizeWebsiteDomain('https://facebook.com/toantrung'), null);
});

test('M01-05.6: Email khách gửi trực tiếp -> Kênh email, website nguồn để chưa xác định nếu không có căn cứ', () => {
  const res = parseStructuredFormEmailBody(
    'Hỏi báo giá màn hình LED cho nhà hàng',
    'Chào công ty, tôi cần báo giá màn hình LED 15m2. SĐT liên hệ: 0911222333.',
    'khachhang@gmail.com',
    parserDeps,
  );
  assert.equal(res.contactChannel, 'email');
  assert.equal(res.sourceWebsite, null);
  assert.equal(res.websiteResolutionMethod, 'unresolved');
});

test('M01-05.7: Xử lý lại cùng thư không tạo thêm Lead và không ghi đè website đã xác định bằng Gmail', async (t) => {
  assert.ok(fs.existsSync(INDEP_DB_PATH), 'independent_v2.db must exist');
  fs.copyFileSync(INDEP_DB_PATH, TEMP_DB_PATH);
  const dbUrl = `file:${TEMP_DB_PATH.replace(/\\/g, '/')}`;
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  t.after(async () => {
    await prisma.$disconnect();
    if (fs.existsSync(TEMP_DB_PATH)) fs.unlinkSync(TEMP_DB_PATH);
  });

  const first = await ingestLeadWithTrackingIdempotent(prisma, {
    intakeSourceProvider: 'gmail_sync',
    intakeSourceAccountKey: 'quanly@gmail.com',
    externalSubmissionId: 'gmail-msg-m01-05-unique',
    leadCode: 'TT-M01-05-001',
    contactChannel: 'form_web',
    phone: '0945348464',
    contactName: 'Khách Form Bangled',
    sourceWebsite: 'bangled.vn',
    landingPageUrl: 'https://www.bangled.vn/bao-gia',
    marketingSource: 'Chưa xác định',
    sourceResolutionMethod: 'unknown',
  });
  assert.equal(first.deduplicated, false);
  assert.equal(first.lead.sourceWebsite, 'bangled.vn');
  assert.equal(first.lead.contactChannel, 'form_web');

  const second = await ingestLeadWithTrackingIdempotent(prisma, {
    intakeSourceProvider: 'gmail_sync',
    intakeSourceAccountKey: 'quanly@gmail.com',
    externalSubmissionId: 'gmail-msg-m01-05-unique',
    leadCode: 'TT-M01-05-002',
    contactChannel: 'email',
    phone: '0945348464',
    contactName: 'Khách Form Bangled',
    sourceWebsite: 'quanly@gmail.com',
  });
  assert.equal(second.deduplicated, true);
  assert.equal(second.lead.id, first.lead.id);
  assert.equal(second.lead.sourceWebsite, 'bangled.vn');
});

