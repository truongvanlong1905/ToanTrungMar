'use strict';

/**
 * Verification Suite for 21/11/2026 Fixes (Module 01 Leads + Module 05 AI Studio)
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
const {
  createProductCatalogItem,
  updateProductCatalogItem,
  createManualLead,
} = require('../../modules/01-leads/service.ts');
const { AiDesignProviderFactory } = require('../../modules/05-ai-design/providers/index.ts');
const {
  createDesignRequestWithAiDraft,
  processChatDesignRequest,
  addProjectPhoto,
  deleteDesignProject,
} = require('../../modules/05-ai-design/service.ts');

test.after(async () => {
  await prisma.$disconnect();
});

test('QA-01 (M01): Admin can add detailed LED catalog item & custom product group; non-Admin blocked; clean multi-product + transfer CRM notification', async (t) => {
  const adminUser = await prisma.user.findFirst({
    where: { isActive: true, deletedAt: null, role: { roleCode: 'ADMIN' } },
    select: { id: true, email: true, fullName: true },
  });
  const salesUsers = await prisma.user.findMany({
    where: { isActive: true, deletedAt: null, role: { roleCode: { in: ['SALES', 'SALES_LEAD'] } } },
    select: { id: true, email: true, fullName: true },
    take: 2,
  });
  assert.ok(adminUser, 'Admin user must exist in test DB');
  assert.ok(salesUsers.length >= 2, 'At least 2 Sales users must exist in test DB');

  const adminActor = { ...adminUser, roleCode: 'ADMIN' };
  const salesActor = { ...salesUsers[0], roleCode: 'SALES' };
  const targetSales = salesUsers[1];

  const prevLabelsSetting = await prisma.systemSetting.findUnique({
    where: { key: 'lead_product_group_labels_v1' },
  });
  const createdProductIds = [];
  let createdLeadId = null;

  t.after(async () => {
    if (createdLeadId) {
      await prisma.notification.deleteMany({
        where: { actionUrl: `/leads?leadId=${createdLeadId}` },
      }).catch(() => {});
      await prisma.lead.delete({ where: { id: createdLeadId } }).catch(() => {});
    }
    for (const pid of createdProductIds) {
      await prisma.leadProduct.deleteMany({ where: { productId: pid } }).catch(() => {});
      await prisma.product.delete({ where: { id: pid } }).catch(() => {});
    }
    if (prevLabelsSetting) {
      await prisma.systemSetting.upsert({
        where: { key: 'lead_product_group_labels_v1' },
        create: { key: prevLabelsSetting.key, value: prevLabelsSetting.value, updatedById: prevLabelsSetting.updatedById },
        update: { value: prevLabelsSetting.value, updatedById: prevLabelsSetting.updatedById },
      });
    } else {
      await prisma.systemSetting.delete({ where: { key: 'lead_product_group_labels_v1' } }).catch(() => {});
    }
  });

  // 1. Non-Admin cannot mutate product catalog
  await assert.rejects(
    () =>
      createProductCatalogItem(salesActor, {
        productName: 'LED P1.86 Unauthorized',
        categoryGroup: 'led_screen',
        unit: 'm2',
      }),
    /FORBIDDEN/,
  );

  // 2. Admin adds detailed P2.5 Indoor & custom group item
  const p25Res = await createProductCatalogItem(adminActor, {
    productName: `[TEST] LED P2.5 Indoor ${Date.now()}`,
    categoryGroup: 'led_screen',
    unit: 'm2',
  });
  createdProductIds.push(p25Res.product.id);
  assert.equal(p25Res.product.categoryGroup, 'led_screen');
  assert.equal(p25Res.product.categoryGroupLabel, 'Màn hình LED');

  const customGrpRes = await createProductCatalogItem(adminActor, {
    productName: `[TEST] Bộ xử lý hình ảnh Novastar ${Date.now()}`,
    categoryGroup: 'bo_xu_ly_tin_hieu_test',
    categoryGroupLabel: 'Bộ xử lý & Điều khiển',
    unit: 'bộ',
  });
  createdProductIds.push(customGrpRes.product.id);
  assert.equal(customGrpRes.product.categoryGroup, 'bo_xu_ly_tin_hieu_test');
  assert.equal(customGrpRes.product.categoryGroupLabel, 'Bộ xử lý & Điều khiển');

  const toggled = await updateProductCatalogItem(adminActor, {
    productId: customGrpRes.product.id,
    isActive: false,
  });
  assert.equal(toggled.product.isActive, false);

  // 3. Multi-product selection within same group + cross group & CRM notification on immediate transfer
  const uniquePhone = `098${String(Date.now()).slice(-7)}`;
  const createdLead = await createManualLead(salesActor, {
    contactChannel: 'hotline',
    phone: uniquePhone,
    projectName: '[TEST] Dự án Trung tâm Văn hóa',
    productIds: [1, 2, p25Res.product.id, 9],
    reassignToSalesId: targetSales.id,
    reassignReason: 'Không đúng thế mạnh',
  });
  createdLeadId = createdLead.id;

  const savedLeadProducts = await prisma.leadProduct.findMany({
    where: { leadId: createdLead.id },
  });
  assert.equal(savedLeadProducts.length, 4, 'Lead must retain all 4 selected products across groups and within led_screen');

  const notif = await prisma.notification.findFirst({
    where: { userId: targetSales.id, actionUrl: `/leads?leadId=${createdLead.id}` },
    orderBy: { createdAt: 'desc' },
  });
  assert.ok(notif, 'Target Sales must receive an in-app CRM notification linking directly to ?leadId=');
  assert.match(notif.summary, /Không đúng thế mạnh/);
});

test('QA-02 (M05): executeBannerWithFallback NEVER falls back to plain LocalSandbox gradient on Cloud failure & bannerMode splits flows cleanly', async (t) => {
  const designerUser = await prisma.user.findFirst({
    where: { isActive: true, deletedAt: null, role: { roleCode: 'DESIGNER' } },
    select: { id: true, email: true, fullName: true },
  });
  assert.ok(designerUser, 'Designer user must exist');
  const designerActor = { ...designerUser, roleCode: 'DESIGNER' };

  // 1. Failing Cloud Banner request must NEVER return LocalSandbox synthetic gradient
  const fakePng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const originalFetch = global.fetch;
  const hadOpenAiKey = Object.prototype.hasOwnProperty.call(process.env, 'OPENAI_API_KEY');
  const prevOpenAiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'FAKE_QA_UNIT_TEST_KEY';
  global.fetch = async () =>
    new Response(JSON.stringify({ error: { message: 'Simulated upstream edit failure' } }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });

  let projId = null;
  t.after(async () => {
    global.fetch = originalFetch;
    if (hadOpenAiKey) process.env.OPENAI_API_KEY = prevOpenAiKey;
    else delete process.env.OPENAI_API_KEY;
    if (projId) {
      await deleteDesignProject(designerActor, projId).catch(() => {});
    }
  });

  const failedCloudBanner = await AiDesignProviderFactory.executeBannerWithFallback(
    {
      workflow: 'banner',
      prompt: 'Banner LED showroom ô tô màu đen vàng',
      productReferenceBuffers: [{ buffer: fakePng, mimeType: 'image/png', name: 'led-sample.png' }],
      dimensions: { widthPx: 1920, heightPx: 1080, aspectRatio: '16:9' },
      quality: 'draft',
      modelId: 'gpt-image-1',
      idempotencyKey: `qa-anti-gradient-${Date.now()}`,
    },
    'openai_dalle',
  );
  assert.equal(failedCloudBanner.status, 'failed');
  assert.notEqual(failedCloudBanner.provider, 'local_sandbox');
  assert.equal(Boolean(failedCloudBanner.isLocalFallback), false);

  global.fetch = originalFetch;
  if (hadOpenAiKey) process.env.OPENAI_API_KEY = prevOpenAiKey;
  else delete process.env.OPENAI_API_KEY;

  // 2. bannerMode='with_product' requires at least 1 product image; bannerMode='prompt_only' ignores product photos
  const proj = await createDesignRequestWithAiDraft(designerActor, {
    designType: 'banner',
    projectName: '[TEST] Separate Banner Flows QA',
    bannerWidthPx: 1920,
    bannerHeightPx: 1080,
    aiPrompt: '[INIT_PROJECT] Test split banner modes',
    quality: 'draft',
  });
  projId = proj.id;

  await assert.rejects(
    () =>
      processChatDesignRequest(designerActor, proj.id, {
        prompt: '@TaoAnhPoster Tạo banner có sản phẩm công ty',
        bannerMode: 'with_product',
        taskCode: 'banner_generate',
        chatMode: 'image_generator',
        providerId: 'local_sandbox',
        modelId: 'toantrung-studio-v3',
        referenceProductPhotoIds: [],
      }),
    /MISSING_PRODUCT_REFERENCE_IMAGE/,
  );

  // Add a project product_reference photo and verify 'prompt_only' strips it completely
  const addedProd = await addProjectPhoto(designerActor, proj.id, {
    photoName: 'SP Cabinet Mẫu.png',
    fileName: 'cabinet-sample.png',
    mimeType: 'image/png',
    base64Data: fakePng.toString('base64'),
    photoRole: 'product_reference',
  });

  const purePromptRes = await processChatDesignRequest(designerActor, proj.id, {
    prompt: '@TaoAnhPoster Banner khai trương tông đỏ vàng rực rỡ',
    bannerMode: 'prompt_only',
    taskCode: 'banner_generate',
    chatMode: 'image_generator',
    providerId: 'local_sandbox',
    modelId: 'toantrung-studio-v3',
  });
  assert.ok(purePromptRes.versionId > 0, 'Banner prompt_only version created under explicit local_sandbox');
  const savedVersionRow = await prisma.designAssetVersion.findUnique({
    where: { id: purePromptRes.versionId },
  });
  const savedParams = JSON.parse(savedVersionRow.parametersJson);
  assert.equal(
    (savedParams.referenceProductPhotoIds || []).length,
    0,
    'bannerMode="prompt_only" MUST NOT attach product_reference photos',
  );
  assert.equal(
    (savedParams.inputAssetIds || []).some((id) => id === `product:${addedProd.id}`),
    false,
    'bannerMode="prompt_only" MUST NOT include product_reference photos in inputAssetIds',
  );
});
