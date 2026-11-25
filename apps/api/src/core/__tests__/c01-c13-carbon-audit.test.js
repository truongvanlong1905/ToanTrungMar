'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

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

const V2_ROOT = path.resolve(__dirname, '../../../../..');
const origResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveWorkspaceAliases(request, parent, isMain, options) {
  if (request === '@toantrung/contracts') {
    return path.join(V2_ROOT, 'packages/contracts/src/common/index.ts');
  }
  if (request === '@toantrung/database') {
    return path.join(V2_ROOT, 'packages/database/src/index.ts');
  }
  try {
    return origResolveFilename.call(this, request, parent, isMain, options);
  } catch (err) {
    if (request.startsWith('.') && parent && parent.filename) {
      const candidateTs = path.resolve(path.dirname(parent.filename), `${request}.ts`);
      if (fs.existsSync(candidateTs)) return candidateTs;
      const candidateIndexTs = path.resolve(path.dirname(parent.filename), request, 'index.ts');
      if (fs.existsSync(candidateIndexTs)) return candidateIndexTs;
    }
    throw err;
  }
};

const {
  UI_VOCABULARY,
  hasPlaceholderMacro,
  sanitizeProjectOrSubjectText,
  sanitizeWebsiteSourceDisplay,
  normalizeMarketingChannelDisplay,
  resolveWebsiteScopeDisplay,
  formatSafePeriodComparison,
  isL3Effective,
} = require('@toantrung/contracts');

const {
  evaluateLedTechnicalConfig,
} = require('../../modules/05-ai-design/led-technical.engine.ts');

const {
  validateGeneratedImageBuffer,
} = require('../../modules/05-ai-design/perspective-compositor.ts');

test('C01 #10 & C06: sanitizeProjectOrSubjectText loại bỏ biến mẫu [your-subject] trên UI nhưng phát hiện đúng cờ thiếu tiêu đề', () => {
  assert.equal(hasPlaceholderMacro('Toàn Trung "[your-subject]"'), true);
  assert.equal(sanitizeProjectOrSubjectText('Toàn Trung "[your-subject]"'), null);
  assert.equal(
    sanitizeProjectOrSubjectText('Báo giá màn hình LED P2.5 hội trường [your-subject]'),
    'Báo giá màn hình LED P2.5 hội trường',
  );
  assert.equal(hasPlaceholderMacro('Màn hình LED P3 phòng họp'), false);
});

test('C01 #10 & C06: sanitizeWebsiteSourceDisplay ẩn structured_field / metadata_url ở giao diện thường và giữ technicalMethod cho ngăn kiểm tra', () => {
  const s1 = sanitizeWebsiteSourceDisplay('toantrung.com.vn (structured_field)');
  assert.equal(s1.cleanLabel, 'toantrung.com.vn');
  assert.equal(s1.technicalMethod, 'structured_field');

  const s2 = sanitizeWebsiteSourceDisplay('bangled.vn (metadata_url)');
  assert.equal(s2.cleanLabel, 'bangled.vn');
  assert.equal(s2.technicalMethod, 'metadata_url');

  const s3 = sanitizeWebsiteSourceDisplay(null);
  assert.equal(s3.cleanLabel, null);
  assert.equal(s3.technicalMethod, null);
});

test('C01 #9 & C04: normalizeMarketingChannelDisplay không gán Email / Zalo / Nhập tay thiếu UTM thành Nguồn tự nhiên / Trực tiếp', () => {
  assert.equal(
    normalizeMarketingChannelDisplay({
      marketingSource: 'Nhập tay',
      contactChannel: 'manual',
    }),
    UI_VOCABULARY.fallbacks.unknown,
  );
  assert.equal(
    normalizeMarketingChannelDisplay({
      marketingSource: 'Nguồn tự nhiên / Trực tiếp',
      contactChannel: 'email',
    }),
    UI_VOCABULARY.fallbacks.unknown,
  );
  assert.equal(
    normalizeMarketingChannelDisplay({
      marketingSource: 'Zalo',
      contactChannel: 'zalo',
    }),
    UI_VOCABULARY.fallbacks.unknown,
  );
  assert.equal(
    normalizeMarketingChannelDisplay({
      gclid: 'CjwKCAjw_test_gclid',
      contactChannel: 'form_web',
    }),
    'Google Ads',
  );
  assert.equal(
    normalizeMarketingChannelDisplay({
      utmSource: 'google',
      utmMedium: 'organic',
      contactChannel: 'form_web',
    }),
    'Tìm kiếm tự nhiên',
  );
});

test('C01 #5 & C04: resolveWebsiteScopeDisplay đồng bộ nhãn website ngay tức thì theo websiteId đang chọn', () => {
  const catalog = [
    { websiteId: 'toantrung.com.vn', shortName: 'Website Toàn Trung', domain: 'toantrung.com.vn' },
    { websiteId: 'bangled.vn', shortName: 'Chuyên trang Bảng LED', domain: 'bangled.vn' },
  ];
  assert.equal(resolveWebsiteScopeDisplay('all', catalog), 'Tất cả website');
  assert.equal(
    resolveWebsiteScopeDisplay('toantrung.com.vn', catalog),
    'Website Toàn Trung (toantrung.com.vn)',
  );
  assert.equal(
    resolveWebsiteScopeDisplay('bangled.vn', catalog),
    'Chuyên trang Bảng LED (bangled.vn)',
  );
});

test('C12 #4: formatSafePeriodComparison xử lý an toàn khi kỳ trước = 0 hoặc thiếu dữ liệu, không bao giờ sinh Infinity%', () => {
  const zeroPrevPositive = formatSafePeriodComparison(8, 0);
  assert.equal(zeroPrevPositive.pctChange, null);
  assert.ok(!zeroPrevPositive.label.includes('Infinity'));
  assert.ok(zeroPrevPositive.label.includes('kỳ trước = 0'));

  const zeroBoth = formatSafePeriodComparison(0, 0);
  assert.equal(zeroBoth.pctChange, null);
  assert.equal(zeroBoth.absDiff, 0);

  const missingPrev = formatSafePeriodComparison(12, null);
  assert.equal(missingPrev.pctChange, null);

  const normalGrowth = formatSafePeriodComparison(25, 20);
  assert.equal(normalGrowth.pctChange, 25);
  assert.equal(normalGrowth.tone, 'positive');
});

test('C01 #8 & C04: isL3Effective tuân thủ đúng tiêu chí L1/L2/L3 của BA', () => {
  assert.equal(
    isL3Effective({
      isSpam: false,
      spamAdsExclusionStatus: 'none',
      tracking: { isRepeatLead: false },
    }),
    true,
  );
  assert.equal(
    isL3Effective({
      isSpam: true,
      spamAdsExclusionStatus: 'none',
      tracking: { isRepeatLead: false },
    }),
    false,
  );
  assert.equal(
    isL3Effective({
      isSpam: false,
      spamAdsExclusionStatus: 'confirmed_excluded',
      tracking: { isRepeatLead: false },
    }),
    false,
  );
  assert.equal(
    isL3Effective({
      isSpam: false,
      spamAdsExclusionStatus: 'none',
      tracking: { isRepeatLead: true },
    }),
    false,
  );
});

test('C11: evaluateLedTechnicalConfig tính toán độc lập bằng code và báo insufficient_data khi thiếu kích thước thay vì đoán', () => {
  const missingRes = evaluateLedTechnicalConfig({
    widthMm: null,
    heightMm: null,
    pixelPitch: 'P2.5',
    screenStyle: 'flat',
  });
  assert.equal(missingRes.feasibilityStatus, 'insufficient_data');
  assert.equal(missingRes.cabinetCount, null);

  const validRes = evaluateLedTechnicalConfig({
    widthMm: 3840,
    heightMm: 1920,
    pixelPitch: 'P2.5',
    cabinetModelCode: 'CAB_640_480',
    screenStyle: 'flat',
  });
  assert.equal(validRes.feasibilityStatus, 'exact_match');
  assert.equal(validRes.theoreticalResolutionWidthPx, 1536);
  assert.equal(validRes.theoreticalResolutionHeightPx, 768);
  assert.equal(validRes.cabinetCount, 24);
});

test('C11 Backend Upgrade: validateGeneratedImageBuffer đọc chính xác kích thước ảnh thật từ JPEG và WebP binary header', () => {
  const jpgBuf = fs.readFileSync(
    path.join(V2_ROOT, 'apps/web/public/brand/toantrung-bdu-original.jpg'),
  );
  const jpgMeta = validateGeneratedImageBuffer(jpgBuf);
  assert.equal(jpgMeta.isValid, true);
  assert.equal(jpgMeta.detectedMimeType, 'image/jpeg');
  assert.ok(typeof jpgMeta.widthPx === 'number' && jpgMeta.widthPx > 100);
  assert.ok(typeof jpgMeta.heightPx === 'number' && jpgMeta.heightPx > 100);

  const webpBuf = fs.readFileSync(
    path.join(V2_ROOT, 'apps/web/public/brand/showroom-toan-trung.webp'),
  );
  const webpMeta = validateGeneratedImageBuffer(webpBuf);
  assert.equal(webpMeta.isValid, true);
  assert.equal(webpMeta.detectedMimeType, 'image/webp');
  assert.ok(typeof webpMeta.widthPx === 'number' && webpMeta.widthPx > 100);
  assert.ok(typeof webpMeta.heightPx === 'number' && webpMeta.heightPx > 100);
});
