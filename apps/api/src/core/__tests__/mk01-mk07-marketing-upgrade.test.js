'use strict';

/**
 * Automated Verification Suite for MK01-MK07 Marketing Workbench Upgrade
 * Directly tests compiled/transpiled production TS services & helpers (zero mocked formulas).
 */

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
const INDEP_DB_PATH = path.join(V2_ROOT, 'packages/database/prisma/independent_v2.db');
const INDEP_DB_URL = `file:${INDEP_DB_PATH.replace(/\\/g, '/')}`;
process.env.DATABASE_URL = INDEP_DB_URL;

const origResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveWorkspaceAliases(request, parent, isMain, options) {
  if (request === '@toantrung/contracts') {
    return path.join(V2_ROOT, 'packages/contracts/src/common/index.ts');
  }
  if (request.startsWith('@toantrung/contracts/')) {
    const sub = request.slice('@toantrung/contracts/'.length);
    return path.join(V2_ROOT, 'packages/contracts/src', sub, 'index.ts');
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

const { prisma } = require('@toantrung/database');
const { formatSafePeriodComparison, hasBaPermission } = require('@toantrung/contracts');
const { classifyCampaignWebsiteAttribution } = require('../../modules/02-tracking-sync/google-oauth.service.ts');
const { computeCostPerValidAdLead } = require('../../modules/03-keywords-ads/m03-spec.service.ts');
const { getScopedReportsDashboard, generateScopedReportExportBuffer } = require('../../app/api/v1/dashboard/_lib/dashboard-overview.service.ts');
const {
  validateSafeHttpUrl,
  classifyUpstreamAiHttpError,
  AiModelRegistryService,
} = require('../../modules/05-ai-design/providers/model-registry.service.ts');
const { AiDesignProviderFactory, UniversalCloudAiProvider } = require('../../modules/05-ai-design/providers/index.ts');
const {
  createMarketingDesignBrief,
  deleteDesignProject,
  processChatDesignRequest,
} = require('../../modules/05-ai-design/service.ts');

test.after(async () => {
  await prisma.$disconnect();
});

test('MK02: Multi-website campaign attribution rule prevents 100% spend assignment to single site', () => {
  const single = classifyCampaignWebsiteAttribution(
    'Search_BangLed_HCM',
    ['https://bangled.vn/bao-gia', 'https://www.bangled.vn/san-pham'],
  );
  assert.equal(single.status, 'SINGLE_WEBSITE');
  assert.equal(single.domain, 'bangled.vn');

  const multi = classifyCampaignWebsiteAttribution(
    'Search_MultiSite_ToanTrung_BangLed',
    ['https://toantrung.com.vn/man-hinh-led', 'https://bangled.vn/bang-led-ma-tran'],
  );
  assert.equal(multi.status, 'MULTI_WEBSITE_UNSPLIT');
  assert.equal(multi.domain, null);
  assert.deepEqual(multi.detectedDomains, ['bangled.vn', 'toantrung.com.vn']);

  const multiBySlug = classifyCampaignWebsiteAttribution('Generic Campaign', [], 'multi_website_unsplit');
  assert.equal(multiBySlug.status, 'MULTI_WEBSITE_UNSPLIT');
  assert.equal(multiBySlug.domain, null);
});

test('MK02: CPL strict denominator (valid attributed ad leads only) & safe previous-period 0/null math', async () => {
  assert.equal(computeCostPerValidAdLead(10_000_000, 0), null);
  assert.equal(computeCostPerValidAdLead(null, 5), null);
  assert.equal(computeCostPerValidAdLead(10_000_000, 4), 2_500_000);

  const compZeroPrev = formatSafePeriodComparison(12, 0);
  assert.equal(compZeroPrev.pctChange, null);
  assert.ok(!compZeroPrev.label.includes('Infinity') && !compZeroPrev.label.includes('NaN'));

  const compNullPrev = formatSafePeriodComparison(12, null);
  assert.equal(compNullPrev.pctChange, null);

  const adminUser = {
    id: 1,
    email: 'admin@toantrung.vn',
    fullName: 'Nguyễn Quản Trị',
    roleCode: 'ADMIN',
  };
  const dash = await getScopedReportsDashboard(adminUser, { websiteId: 'all', preset: '30d' });
  assert.ok(dash.overview.effectiveLeadsL3 <= dash.overview.validLeadsL2);
  assert.equal('revenue' in dash.overview, false);

  // Scoped CSV & XLSX exports succeed on exact same scope
  const csvExp = await generateScopedReportExportBuffer(
    adminUser,
    { websiteId: 'all', preset: '30d' },
    'csv',
  );
  assert.ok(csvExp.buffer.toString('utf8').includes('CPL quảng cáo hợp lệ'));
  const xlsxExp = await generateScopedReportExportBuffer(
    adminUser,
    { websiteId: 'all', preset: '30d' },
    'xlsx',
  );
  assert.equal(xlsxExp.buffer.subarray(0, 2).toString('utf8'), 'PK');
});

test('MK03: URL SSRF validation, upstream HTTP error taxonomy & vision-vs-image task blocking', async () => {
  assert.equal(validateSafeHttpUrl('http://127.0.0.1:8080/v1').valid, false);
  assert.equal(validateSafeHttpUrl('http://169.254.169.254/latest').valid, false);
  assert.equal(validateSafeHttpUrl('https://192.168.1.5/v1').valid, false);
  const gUrl = validateSafeHttpUrl('https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict');
  assert.equal(gUrl.valid, true);
  assert.equal(gUrl.normalizedBaseUrl, 'https://generativelanguage.googleapis.com/v1beta');

  assert.equal(classifyUpstreamAiHttpError(401, 'Unauthorized').statusKind, 'blocked_permission');
  assert.equal(classifyUpstreamAiHttpError(429, 'RESOURCE_EXHAUSTED limit: 0').statusKind, 'blocked_quota_billing');
  assert.equal(classifyUpstreamAiHttpError(404, 'no longer available').statusKind, 'deprecated');
  assert.equal(classifyUpstreamAiHttpError(400, 'model does not support images').statusKind, 'unsupported');

  // Chat/Vision models must ALWAYS be rejected on image generation tasks
  const rejectChatRes = await AiDesignProviderFactory.executeBannerWithFallback({
    workflow: 'banner',
    prompt: 'Test banner',
    dimensions: { widthPx: 1536, heightPx: 1024, aspectRatio: '3:2' },
    quality: 'draft',
    modelId: 'gemini-3.8-flash',
    idempotencyKey: 'test-chat-reject',
  });
  assert.equal(rejectChatRes.status, 'failed');
  assert.equal(rejectChatRes.errorCode, 'CHAT_MODEL_NO_IMAGE_OUTPUT');

  // Simulated provider: requireReferenceEdit MUST NOT fall back to text-only /images/generations on 4xx/5xx
  const provider = new UniversalCloudAiProvider({
    providerId: 'custom_endpoint',
    providerName: 'Test Gateway',
    apiKey: 'sk-test-key',
    apiEndpoint: 'https://example.invalid/v1/images/generations',
    activeModel: 'gpt-image-2',
    costPerImageUsd: 0.04,
    notes: 'test',
  });
  const missingRefRes = await provider.generateBannerDraft({
    workflow: 'banner',
    prompt: 'Edit existing banner',
    dimensions: { widthPx: 1024, heightPx: 1024, aspectRatio: '1:1' },
    quality: 'draft',
    modelId: 'gpt-image-2',
    idempotencyKey: 'test-missing-ref',
    requireReferenceEdit: true,
  });
  assert.equal(missingRefRes.status, 'failed');
  assert.equal(missingRefRes.errorCode, 'MISSING_REFERENCE_IMAGE_BUFFER');
});

test('MK03 Pagination & Probe Budget Guard (simulated fetch fixture — zero network)', async () => {
  const cacheFile = path.join(V2_ROOT, 'storage_independent_v2/config/ai-model-registry-cache.json');
  const prevCacheBackup = fs.existsSync(cacheFile) ? fs.readFileSync(cacheFile, 'utf8') : null;
  if (fs.existsSync(cacheFile)) {
    fs.unlinkSync(cacheFile);
  }
  const originalFetch = global.fetch;
  let requestedUrls = [];
  let probeHttpCalls = 0;
  global.fetch = async (url) => {
    const u = String(url);
    requestedUrls.push(u);
    if (u.includes('generateContent') || u.includes('images/generations')) {
      probeHttpCalls += 1;
    }
    if (u.includes('pageToken=page2')) {
      return new Response(
        JSON.stringify({
          models: [
            {
              name: 'models/gemini-3-flash-preview',
              displayName: 'Gemini 3 Flash Preview',
              supportedGenerationMethods: ['generateContent'],
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({
        models: [
          {
            name: 'models/gemini-2.5-flash-image',
            displayName: 'Gemini 2.5 Flash Image',
            supportedGenerationMethods: ['generateContent'],
          },
        ],
        nextPageToken: 'page2',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  try {
    const fakeCfg = {
      defaultProviderId: 'google_imagen',
      defaultModelId: 'gemini-3-flash-preview',
      autoFallbackToLocal: false,
      providers: {
        google_imagen: {
          apiKey: 'FAKE_UNIT_TEST_KEY_VALUE',
          apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta',
        },
      },
    };
    const snap = await AiModelRegistryService.getModelRegistrySnapshot(fakeCfg, {
      forceRefresh: true,
      onlyProviderId: 'google_imagen',
    });
    assert.ok(requestedUrls.some((u) => u.includes('pageToken=page2')), 'Must consume Google nextPageToken');
    const visionModel = snap.models.find((m) => m.modelId === 'gemini-3-flash-preview');
    assert.ok(visionModel, 'Must find model from page 2');
    assert.equal(visionModel.taskStatuses.banner_generate, 'unsupported');
    assert.equal(visionModel.taskStatuses.brief_analyze, 'listed_unverified');

    // Enforce $0.08 probe budget cap: write spent = 0.08 to test cache, then probeSelectedModelTask MUST block without HTTP call
    const cachedDisk = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    cachedDisk.probeBudgetMaxUsd = 0.08;
    cachedDisk.probeBudgetSpentUsd = 0.08;
    fs.writeFileSync(cacheFile, JSON.stringify(cachedDisk, null, 2), 'utf8');

    const probeBeforeHttp = probeHttpCalls;
    const budgetBlockedRes = await AiModelRegistryService.probeSelectedModelTask({
      stored: fakeCfg,
      providerId: 'google_imagen',
      modelId: 'gemini-2.5-flash-image',
      taskCode: 'banner_generate',
    });
    assert.equal(budgetBlockedRes.ok, false);
    assert.equal(budgetBlockedRes.taskStatus, 'blocked_quota_billing');
    assert.equal(probeHttpCalls, probeBeforeHttp, 'Must block over-budget probe before making upstream HTTP calls');
  } finally {
    global.fetch = originalFetch;
    if (prevCacheBackup !== null) {
      fs.writeFileSync(cacheFile, prevCacheBackup, 'utf8');
    } else if (fs.existsSync(cacheFile)) {
      fs.unlinkSync(cacheFile);
    }
  }
});

test('MK04 & MK05: Marketing brief RBAC, zero fake 4.8x2.7m on unmeasured briefs & design_edit requires reference', async (t) => {
  // BA RBAC check: MKT_LEAD/MKT_STAFF have AI_MARKETING_SEO/TRACKING_ADS_OPTIMIZE but NOT AI_DESIGN; DESIGNER has AI_DESIGN
  assert.equal(hasBaPermission('MKT_LEAD', 'AI_MARKETING_SEO'), true);
  assert.equal(hasBaPermission('MKT_LEAD', 'AI_DESIGN'), false);
  assert.equal(hasBaPermission('MKT_STAFF', 'TRACKING_ADS_OPTIMIZE'), true);
  assert.equal(hasBaPermission('DESIGNER', 'AI_DESIGN'), true);
  assert.equal(hasBaPermission('SALES', 'TRACKING_ADS_OPTIMIZE'), false);
  assert.equal(hasBaPermission('SALES', 'AI_MARKETING_SEO'), false);

  const mktUser = {
    id: 7,
    email: 'mkt-lead@toantrung.vn',
    fullName: 'Võ Trưởng Phòng Marketing',
    roleCode: 'MKT_LEAD',
  };
  const designerUser = {
    id: 5,
    email: 'designer@toantrung.vn',
    fullName: 'Phạm Thiết Kế',
    roleCode: 'DESIGNER',
  };

  let createdProjectId = null;
  t.after(async () => {
    if (createdProjectId) {
      await deleteDesignProject(designerUser, createdProjectId).catch(() => {});
    }
  });

  const briefRes = await createMarketingDesignBrief(mktUser, {
    action: 'submit_marketing_brief',
    projectName: '[TEST] Brief Banner BangLed T11',
    taskCode: 'banner_generate',
    designType: 'banner',
    sourceModule: 'reports',
    designBrief: {
      objective: 'Tăng lượng gửi form P2.5',
      websiteDomain: 'bangled.vn',
      outputWidthPx: 1536,
      outputHeightPx: 1024,
      headlineText: 'Màn hình LED Toàn Trung',
      ctaText: 'Báo giá ngay',
      baselineSnapshot: {
        capturedAt: new Date().toISOString(),
        sourceModule: 'reports',
        scopeLabel: 'bangled.vn (2026-10-20 -> 2026-11-18)',
        websiteDomain: 'bangled.vn',
      },
    },
  });
  createdProjectId = briefRes.projectId;
  assert.equal(briefRes.ok, true);
  assert.ok(createdProjectId > 0);

  // Verify database row has banner dimensions WITHOUT fake 4.8m x 2.7m LED dims
  const row = await prisma.designRequest.findUnique({ where: { id: createdProjectId } });
  assert.ok(row);
  assert.equal(row.screenDimensions, '1536x1024px');
  const meta = JSON.parse(row.installPositionJson);
  assert.equal(meta.screenWidthM, undefined);
  assert.equal(meta.designBrief.websiteDomain, 'bangled.vn');

  // Calling design_edit with zero source versions and zero uploaded photos must fail cleanly instead of generating an unrelated text image
  await assert.rejects(
    () =>
      processChatDesignRequest(designerUser, createdProjectId, {
        prompt: 'Chỉnh sửa sáng hơn',
        taskCode: 'design_edit',
        chatMode: 'image_generator',
        quality: 'draft',
        providerId: 'custom_endpoint',
        modelId: 'gpt-image-2',
        bannerWidthPx: 1536,
        bannerHeightPx: 1024,
      }),
    /MISSING_REFERENCE_IMAGE_BUFFER/,
  );
});
