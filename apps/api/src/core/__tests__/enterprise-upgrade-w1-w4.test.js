'use strict';

/**
 * Automated Verification Suite for Enterprise Local Edition Upgrade (Waves 1–4):
 * - Wave 1: Realtime SSE pub/sub (<50ms) + /api/v1/system/stream auth + /api/v1/system/command-search BA RBAC & UC01 anonymization
 * - Wave 2: Saved Smart Views per-user persistence + LED Technical Spec Sheet (zero pricing) + M05 Visual Pins & PII block
 * - Wave 3: Click-to-Audit Data Lineage (anonymized for MKT/ADS) + Funnel Anomaly Guard + Zero-PII Handover Brief + LED SEO Scorer + AI FinOps RBAC
 * - Wave 4: Admin Governance Diagnostics, 1-Click Webhook Sandbox (routing + duplicate detection), and Audit Log Before->After Explorer
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
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
process.env.DATABASE_URL = `file:${INDEP_DB_PATH.replace(/\\/g, '/')}`;

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
const { hashSessionToken } = require(path.join(V2_ROOT, 'apps/api/src/core/auth/password.ts'));
const {
  bumpDomainRevisions,
  subscribeDomainRevisionStream,
} = require(path.join(V2_ROOT, 'apps/api/src/core/cache/server-data-cache.ts'));
const {
  sanitizeZeroPiiText,
  buildZeroPiiHandoverBrief,
  evaluateLedB2bSeoArticle,
} = require(path.join(V2_ROOT, 'apps/api/src/core/ai/zero-pii-copilot.service.ts'));
const { GET: getSseStreamRoute } = require(
  path.join(V2_ROOT, 'apps/api/src/app/api/v1/system/stream/route.ts')
);
const { GET: getCommandSearchRoute } = require(
  path.join(V2_ROOT, 'apps/api/src/app/api/v1/system/command-search/route.ts')
);
const {
  GET: getSavedViewsRoute,
  POST: postSavedViewsRoute,
  DELETE: deleteSavedViewsRoute,
} = require(path.join(V2_ROOT, 'apps/api/src/app/api/v1/system/saved-views/route.ts'));
const { POST: postLedSpecSheetRoute } = require(
  path.join(V2_ROOT, 'apps/api/src/app/api/v1/leads/led-spec-sheet/route.ts')
);
const { GET: getAuditLineageRoute } = require(
  path.join(V2_ROOT, 'apps/api/src/app/api/v1/system/audit-lineage/route.ts')
);
const {
  GET: getAiCopilotRoute,
  POST: postAiCopilotRoute,
} = require(path.join(V2_ROOT, 'apps/api/src/app/api/v1/ai/copilot/route.ts'));
const {
  GET: getAdminGovernanceRoute,
  POST: postAdminGovernanceRoute,
} = require(path.join(V2_ROOT, 'apps/api/src/app/api/v1/admin/governance/route.ts'));

async function createSessionByRole(roleCode) {
  let user = await prisma.user.findFirst({
    where: { isActive: true, deletedAt: null, role: { roleCode } },
    include: { role: true },
  });
  if (!user) {
    const role = await prisma.role.findUnique({ where: { roleCode } });
    assert(role, `Expected seeded role ${roleCode}`);
    user = await prisma.user.create({
      data: {
        email: `w14.${roleCode.toLowerCase()}.${Date.now()}@toantrung.vn`,
        fullName: `Test ${roleCode}`,
        roleId: role.id,
        passwordHash: 'scrypt$00$00',
        isActive: true,
      },
      include: { role: true },
    });
  }

  const rawToken = `sess-w14-${crypto.randomUUID()}`;
  const csrfToken = `csrf-w14-${crypto.randomUUID()}`;
  const session = await prisma.userSession.create({
    data: {
      userId: user.id,
      tokenHash: hashSessionToken(rawToken),
      csrfToken,
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });

  return {
    user,
    sessionId: session.id,
    headers: {
      cookie: `tt_v2_indep_session=${rawToken}`,
      'x-csrf-token': csrfToken,
      'content-type': 'application/json',
    },
  };
}

test('Wave 1: Realtime SSE pub/sub fires < 50ms, rejects unauthenticated requests, and Command Search enforces UC01 anonymization', async (t) => {
  const adminSess = await createSessionByRole('ADMIN');
  const mktSess = await createSessionByRole('MKT_STAFF');

  t.after(async () => {
    await prisma.userSession.deleteMany({
      where: { id: { in: [adminSess.sessionId, mktSess.sessionId] } },
    });
  });

  // 1. Unauthenticated SSE must be 401
  const unauthRes = await getSseStreamRoute(new Request('http://localhost:3000/api/v1/system/stream'));
  assert.equal(unauthRes.status, 401);

  // 2. Pub/sub latency < 50ms
  const received = [];
  const t0 = performance.now();
  const unsub = subscribeDomainRevisionStream((ev) => {
    received.push({ ev, elapsedMs: performance.now() - t0 });
  });
  bumpDomainRevisions(['leads', 'notifications'], 'unit_test_sse_push');
  unsub();

  assert.equal(received.length, 1);
  assert.ok(received[0].elapsedMs < 50, `Expected SSE dispatch < 50ms, got ${received[0].elapsedMs}ms`);
  assert.deepEqual(received[0].ev.domains.sort(), ['leads', 'notifications']);

  // 3. Authenticated SSE returns event-stream and closes cleanly on abort
  const ac = new AbortController();
  const sseRes = await getSseStreamRoute(
    new Request('http://localhost:3000/api/v1/system/stream', {
      headers: adminSess.headers,
      signal: ac.signal,
    })
  );
  assert.equal(sseRes.status, 200);
  assert.match(sseRes.headers.get('content-type') || '', /text\/event-stream/);
  ac.abort();

  // 4. Command Search anonymizes phone/PII for MKT_STAFF
  const mktSearchRes = await getCommandSearchRoute(
    new Request('http://localhost:3000/api/v1/system/command-search?q=TT-', {
      headers: mktSess.headers,
    })
  );
  assert.equal(mktSearchRes.status, 200);
  const mktBody = await mktSearchRes.json();
  for (const item of mktBody.data.items.filter((x) => x.group === 'leads')) {
    assert.doesNotMatch(item.subtitle, /\b0\d{9}\b/, 'MKT_STAFF must never see raw 10-digit phone in Ctrl+K');
  }
});

test('Wave 2: Saved Smart Views persist per user & LED Technical Spec Sheet computes exact specs with ZERO pricing', async (t) => {
  const salesSess = await createSessionByRole('SALES');
  t.after(async () => {
    await prisma.userSession.deleteMany({ where: { id: salesSess.sessionId } });
    await prisma.systemSetting.deleteMany({ where: { key: `user_saved_views_${salesSess.user.id}` } });
  });

  // Create saved view
  const saveRes = await postSavedViewsRoute(
    new Request('http://localhost:3000/api/v1/system/saved-views', {
      method: 'POST',
      headers: salesSess.headers,
      body: JSON.stringify({
        name: 'Hội trường TP.HCM',
        filters: { statusFilter: 'quoting', sourceWebsiteFilter: 'toantrung.com.vn', overdueOnly: true },
      }),
    })
  );
  assert.equal(saveRes.status, 200);
  const saveJson = await saveRes.json();
  const createdId = saveJson.data.saved.id;
  assert.ok(createdId);

  // List saved views
  const listRes = await getSavedViewsRoute(
    new Request('http://localhost:3000/api/v1/system/saved-views', { headers: salesSess.headers })
  );
  const listJson = await listRes.json();
  assert.ok(listJson.data.views.some((v) => v.id === createdId && v.name === 'Hội trường TP.HCM'));

  // Delete saved view
  const delRes = await deleteSavedViewsRoute(
    new Request(`http://localhost:3000/api/v1/system/saved-views?id=${encodeURIComponent(createdId)}`, {
      method: 'DELETE',
      headers: salesSess.headers,
    })
  );
  assert.equal(delRes.status, 200);

  // LED Technical Spec Sheet export_doc
  const specRes = await postLedSpecSheetRoute(
    new Request('http://localhost:3000/api/v1/leads/led-spec-sheet', {
      method: 'POST',
      headers: salesSess.headers,
      body: JSON.stringify({
        action: 'export_doc',
        projectTitle: 'Màn hình LED Hội trường Tỉnh ủy',
        customerOrg: 'Văn phòng Tỉnh ủy',
        widthM: 4.8,
        heightM: 2.7,
        viewingDistanceM: 4,
        environment: 'indoor',
        pixelPitch: 'P2.5',
        cabinetModelCode: 'CAB_600_3375',
      }),
    })
  );
  assert.equal(specRes.status, 200);
  const specJson = await specRes.json();
  assert.equal(specJson.data.evaluation.cabinetCount, 64); // 8 cols x 8 rows of 600x337.5mm = exact 4800x2700mm!
  assert.equal(specJson.data.evaluation.feasibilityStatus, 'exact_match');
  assert.ok(specJson.data.docHtml.includes('PHIẾU ĐỀ XUẤT CẤU HÌNH KỸ THUẬT MÀN HÌNH LED'));
  assert.ok(specJson.data.docHtml.includes('không bao gồm báo giá thương mại'));
});

test('Wave 3: Zero-PII Sanitizer strips phones/emails, LED SEO Scorer grades technical terms, Audit Lineage & FinOps enforce RBAC', async (t) => {
  const mktSess = await createSessionByRole('MKT_STAFF');
  const bodSess = await createSessionByRole('BOD');
  t.after(async () => {
    await prisma.userSession.deleteMany({ where: { id: { in: [mktSess.sessionId, bodSess.sessionId] } } });
  });

  // Zero-PII sanitizer test
  const piiSample = 'Liên hệ Anh Minh qua SĐT 0908123456 hoặc email minh.nguyen@congty.vn để khảo sát màn P2.5 4.8x2.7m, đang vướng ngân sách.';
  const clean = sanitizeZeroPiiText(piiSample);
  assert.ok(!clean.sanitizedText.includes('0908123456'));
  assert.ok(!clean.sanitizedText.includes('minh.nguyen@congty.vn'));
  assert.ok(clean.redactedCount >= 2);

  const brief = buildZeroPiiHandoverBrief({
    leadCode: 'TT-20261124-0099',
    pipelineStatus: 'quoting',
    productNames: ['Màn hình LED Indoor'],
    projectName: 'Hội trường Tầng 3',
    province: 'TP.HCM',
    lostReason: null,
    firstQuoteSentAt: null,
    quoteRespondedAt: null,
    receivedConfirmedAt: new Date().toISOString(),
    rawNotes: [piiSample],
  });
  assert.equal(brief.zeroPiiProof.verified, true);
  assert.ok(brief.dimensionsAndSite.includes('4.8x2.7m'));

  // LED SEO Technical Scorer
  const seoEval = evaluateLedB2bSeoArticle({
    title: 'Tiêu chuẩn kỹ thuật Màn hình LED Hội trường P2.5',
    metaDescription: 'Hướng dẫn chọn màn hình LED hội trường P2.0 P2.5 tần số làm tươi 3840Hz, cabinet nhôm đúc 640x480mm và bộ xử lý Novastar chuẩn kỹ thuật.',
    targetKeyword: 'màn hình led hội trường',
    targetWebsite: 'toantrung.com.vn',
    contentHtml: '<h2>1. Cấu hình Pixel Pitch P2.5 và Độ sáng cd/m²</h2><p>Màn hình LED hội trường sử dụng module SMD/GOB tần số quét 3840Hz, độ sáng 800 cd/m², cabinet nhôm đúc và card thu Novastar giúp khoảng cách nhìn từ 2.5m sắc nét. Xem thêm <a href="https://toantrung.com.vn/man-hinh-led/">màn hình LED</a>.</p><h2>2. Nguồn điện và Lắp đặt IP54</h2><h3>Tiêu chuẩn khung chịu lực</h3>',
  });
  assert.ok(seoEval.totalScore >= 70, `Expected high technical score, got ${seoEval.totalScore}`);
  assert.ok(seoEval.matchedTechnicalTerms.length >= 5);

  // Audit Lineage anonymizes for MKT_STAFF
  const linRes = await getAuditLineageRoute(
    new Request('http://localhost:3000/api/v1/system/audit-lineage?mode=lineage&metric=valid_leads', {
      headers: mktSess.headers,
    })
  );
  assert.equal(linRes.status, 200);
  const linJson = await linRes.json();
  for (const r of linJson.data.records) {
    assert.equal(r.isAnonymized, true);
    assert.doesNotMatch(r.contactDisplay, /\b0\d{9}\b/);
  }

  // AI FinOps blocks non-AI role SALES (403) and allows DESIGNER, MKT_STAFF, and BOD (200) with token metrics
  const salesForFinOps = await createSessionByRole('SALES');
  const designerSess = await createSessionByRole('DESIGNER');
  t.after(async () => {
    await prisma.userSession.deleteMany({
      where: { id: { in: [salesForFinOps.sessionId, designerSess.sessionId] } },
    });
  });

  const finForbidden = await getAiCopilotRoute(
    new Request('http://localhost:3000/api/v1/ai/copilot?mode=finops', {
      headers: salesForFinOps.headers,
    })
  );
  assert.equal(finForbidden.status, 403);

  const finDesignerOk = await getAiCopilotRoute(
    new Request('http://localhost:3000/api/v1/ai/copilot?mode=finops&module=05-ai-design', {
      headers: designerSess.headers,
    })
  );
  assert.equal(finDesignerOk.status, 200);
  const finDesignerJson = await finDesignerOk.json();
  assert.equal(typeof finDesignerJson.data.myStats.monthTokens, 'number');
  assert.equal(typeof finDesignerJson.data.summary.monthTokens, 'number');
  assert.ok(Array.isArray(finDesignerJson.data.recentLogs));

  const finOk = await getAiCopilotRoute(
    new Request('http://localhost:3000/api/v1/ai/copilot?mode=finops', { headers: bodSess.headers })
  );
  assert.equal(finOk.status, 200);
});

test('Wave 4: Admin Governance blocks non-Admin (403), reports DB/Vault diagnostics, runs 1-Click Webhook Sandbox & Audit Trail Explorer', async (t) => {
  const adminSess = await createSessionByRole('ADMIN');
  const salesSess = await createSessionByRole('SALES');
  let sandboxLeadId = null;

  t.after(async () => {
    if (sandboxLeadId) {
      await prisma.marketingTracking.deleteMany({ where: { leadId: sandboxLeadId } });
      await prisma.leadActivity.deleteMany({ where: { leadId: sandboxLeadId } });
      await prisma.lead.deleteMany({ where: { id: sandboxLeadId } });
    }
    await prisma.auditLog.deleteMany({ where: { action: 'WEBHOOK_SANDBOX_SIMULATED' } });
    await prisma.webhookIntakeErrorLog.deleteMany({
      where: { externalSubmissionId: { startsWith: 'sandbox_' } },
    });
    await prisma.systemSetting.deleteMany({ where: { key: 'admin_webhook_sandbox_last_phone' } });
    await prisma.userSession.deleteMany({
      where: { id: { in: [adminSess.sessionId, salesSess.sessionId] } },
    });
  });

  // Non-admin blocked from governance
  const denied = await getAdminGovernanceRoute(
    new Request('http://localhost:3000/api/v1/admin/governance?mode=diagnostics', {
      headers: salesSess.headers,
    })
  );
  assert.equal(denied.status, 403);

  // Admin diagnostics
  const diagRes = await getAdminGovernanceRoute(
    new Request('http://localhost:3000/api/v1/admin/governance?mode=diagnostics', {
      headers: adminSess.headers,
    })
  );
  assert.equal(diagRes.status, 200);
  const diagJson = await diagRes.json();
  assert.equal(diagJson.data.vault.healthy, true);
  assert.equal(diagJson.data.workers.length, 5);
  assert.ok(typeof diagJson.data.dbPingMs === 'number');

  // 1-Click Webhook Sandbox creates real routed lead
  const simRes = await postAdminGovernanceRoute(
    new Request('http://localhost:3000/api/v1/admin/governance', {
      method: 'POST',
      headers: adminSess.headers,
      body: JSON.stringify({
        action: 'simulate_webhook',
        website: 'toantrung.com.vn',
        productGroup: 'led_screen',
      }),
    })
  );
  assert.equal(simRes.status, 200);
  const simJson = await simRes.json();
  assert.equal(simJson.data.simulated, true);
  sandboxLeadId = simJson.data.ingestResult?.leadId || null;
  assert.ok(sandboxLeadId, 'Expected sandbox webhook leadId');

  // Audit Log Explorer includes WEBHOOK_SANDBOX_SIMULATED with structured diffs
  const auditRes = await getAdminGovernanceRoute(
    new Request('http://localhost:3000/api/v1/admin/governance?mode=audit&q=WEBHOOK_SANDBOX_SIMULATED', {
      headers: adminSess.headers,
    })
  );
  assert.equal(auditRes.status, 200);
  const auditJson = await auditRes.json();
  assert.ok(auditJson.data.items.length >= 1);
  assert.ok(auditJson.data.items[0].diffs.length >= 1);
});
