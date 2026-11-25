'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const V2_ROOT_CANDIDATE = path.resolve(__dirname, '../../../..');
const REPO_ROOT = fs.existsSync(
  path.join(V2_ROOT_CANDIDATE, 'packages/database/prisma/independent_v2.db'),
)
  ? V2_ROOT_CANDIDATE
  : path.resolve(__dirname, '../../../../..');
const INDEP_DB_PATH = path.join(REPO_ROOT, 'packages/database/prisma/independent_v2.db');
const INDEP_DB_NORM = INDEP_DB_PATH.replace(/\\/g, '/');
const INDEP_DB_URL = INDEP_DB_NORM.startsWith('/')
  ? `file://${INDEP_DB_NORM}`
  : `file:${INDEP_DB_NORM}`;

process.env.DATABASE_URL = INDEP_DB_URL;

// Register on-the-fly TypeScript compiler hook for importing TypeScript services in node:test
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

const origResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveWorkspaceAliases(request, parent, isMain, options) {
  if (request === '@toantrung/contracts') {
    return path.join(REPO_ROOT, 'packages/contracts/src/common/index.ts');
  }
  if (request === '@toantrung/database') {
    return path.join(REPO_ROOT, 'packages/database/src/index.ts');
  }
  try {
    return origResolveFilename.call(this, request, parent, isMain, options);
  } catch (err) {
    if (request.startsWith('.') && parent && parent.filename) {
      const candidateTs = path.resolve(path.dirname(parent.filename), `${request}.ts`);
      if (fs.existsSync(candidateTs)) {
        return candidateTs;
      }
      const candidateIndexTs = path.resolve(path.dirname(parent.filename), request, 'index.ts');
      if (fs.existsSync(candidateIndexTs)) {
        return candidateIndexTs;
      }
    }
    throw err;
  }
};

const { prisma, ensureSqlitePerformanceReady } = require('@toantrung/database');
const { encryptSecret, decryptSecret } = require('../../core/security/vault.ts');
const {
  getOrComputeScopedCache,
  bumpDomainRevisions,
  getDomainRevisionsSnapshot,
  clearAllServerDataCache,
} = require('../../core/cache/server-data-cache.ts');
const {
  getGa4LivePropertySnapshot,
  invalidateGa4LiveCaches,
} = require('../../modules/02-tracking-sync/ga4-live-cache.service.ts');
const { encodeRgbToPng } = require('../../modules/05-ai-design/perspective-compositor.ts');
const {
  createDesignRequestWithAiDraft,
  addProjectPhoto,
  processChatDesignRequest,
  getDesignProjectForUser,
  deleteDesignProject,
} = require('../../modules/05-ai-design/service.ts');

test.after(async () => {
  await prisma.$disconnect();
});

test('PERF-01: Vault encrypt/decrypt roundtrip and memoized scrypt derived keys', () => {
  const sampleSecret = 'MOCK_VAULT_SECRET_TOANTRUNG_2026';
  const encrypted = encryptSecret(sampleSecret);
  assert.ok(encrypted.startsWith('vault$v1$'));
  assert.equal(decryptSecret(encrypted), sampleSecret);

  const memoMap = globalThis.__toantrungDerivedVaultKeys;
  assert.ok(memoMap instanceof Map, 'Vault derived key memo map should exist on globalThis');
  const sizeAfterFirst = memoMap.size;
  assert.ok(sizeAfterFirst >= 1, 'At least one scrypt derived key should be memoized');

  // Calling encrypt/decrypt again reuses the cached scrypt Buffer without deriving more keys
  const refBefore = Array.from(memoMap.values())[0];
  const t0 = performance.now();
  for (let i = 0; i < 20; i += 1) {
    const cipher = encryptSecret(`${sampleSecret}_${i}`);
    assert.equal(decryptSecret(cipher), `${sampleSecret}_${i}`);
  }
  const elapsedMs = performance.now() - t0;
  assert.equal(memoMap.size, sizeAfterFirst);
  assert.equal(Array.from(memoMap.values())[0], refBefore);
  assert.ok(elapsedMs < 200, `Expected 20 roundtrips under 200ms with memoized scrypt, got ${elapsedMs.toFixed(1)}ms`);
});

test('PERF-02: ensureSqlitePerformanceReady is idempotent, enables WAL, and ensures hot indexes', async () => {
  await ensureSqlitePerformanceReady(prisma);
  await ensureSqlitePerformanceReady(prisma);

  const modeRows = await prisma.$queryRawUnsafe('PRAGMA journal_mode;');
  const mode = String(modeRows[0]?.journal_mode || '').toLowerCase();
  assert.equal(mode, 'wal');

  const expectedIndexes = [
    'leads_is_spam_created_at_id_idx',
    'platform_daily_metrics_platform_grain_metric_date_idx',
    'platform_sync_logs_started_at_idx',
    'notifications_user_id_is_read_category_title_idx',
    'design_requests_created_at_idx',
  ];
  const indexRows = await prisma.$queryRawUnsafe(
    `SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (${expectedIndexes
      .map((n) => `'${n}'`)
      .join(', ')});`,
  );
  const foundNames = new Set(indexRows.map((r) => r.name));
  for (const idxName of expectedIndexes) {
    assert.ok(foundNames.has(idxName), `Missing expected SQLite hot index: ${idxName}`);
  }
});

test('PERF-03: server-data-cache isolates scopes, dedupes concurrent loads, and invalidates on revision bump', async () => {
  clearAllServerDataCache();
  let computeCountA = 0;
  let computeCountB = 0;

  const [r1, r2, r3] = await Promise.all([
    getOrComputeScopedCache({
      key: 'test-report:siteA:7D:ADMIN',
      domains: ['reports', 'leads'],
      ttlMs: 30_000,
      compute: async () => {
        computeCountA += 1;
        await new Promise((r) => setTimeout(r, 15));
        return { scope: 'siteA', count: computeCountA };
      },
    }),
    getOrComputeScopedCache({
      key: 'test-report:siteA:7D:ADMIN',
      domains: ['reports', 'leads'],
      ttlMs: 30_000,
      compute: async () => {
        computeCountA += 1;
        return { scope: 'siteA', count: computeCountA };
      },
    }),
    getOrComputeScopedCache({
      key: 'test-report:siteB:7D:SALES',
      domains: ['reports', 'leads'],
      ttlMs: 30_000,
      compute: async () => {
        computeCountB += 1;
        return { scope: 'siteB', count: computeCountB };
      },
    }),
  ]);

  assert.equal(computeCountA, 1, 'Concurrent identical cache key calls must singleflight to 1 compute');
  assert.equal(computeCountB, 1, 'Different scope key must compute independently');
  assert.deepEqual(r1.data, { scope: 'siteA', count: 1 });
  assert.deepEqual(r2.data, { scope: 'siteA', count: 1 });
  assert.deepEqual(r3.data, { scope: 'siteB', count: 1 });

  // Warm cache hit
  const hit = await getOrComputeScopedCache({
    key: 'test-report:siteA:7D:ADMIN',
    domains: ['reports', 'leads'],
    ttlMs: 30_000,
    compute: async () => {
      computeCountA += 1;
      return { scope: 'siteA', count: computeCountA };
    },
  });
  assert.equal(hit.fromCache, true);
  assert.equal(computeCountA, 1);

  // Domain revision bump invalidates affected scopes
  const snapBefore = getDomainRevisionsSnapshot();
  bumpDomainRevisions(['leads'], 'test_mutation');
  const snapAfter = getDomainRevisionsSnapshot();
  assert.ok(snapAfter.revisions.leads > snapBefore.revisions.leads);

  const afterBump = await getOrComputeScopedCache({
    key: 'test-report:siteA:7D:ADMIN',
    domains: ['reports', 'leads'],
    ttlMs: 30_000,
    compute: async () => {
      computeCountA += 1;
      return { scope: 'siteA', count: computeCountA };
    },
  });
  assert.equal(afterBump.fromCache, false);
  assert.equal(computeCountA, 2);
  clearAllServerDataCache();
});

test('PERF-04: GA4 live cache enforces exact date-range keys with zero cross-date fallback', async () => {
  invalidateGa4LiveCaches();
  const store = globalThis.__toantrungGa4LiveCache;
  assert.ok(store, 'Global GA4 cache store should be initialized');
  store.dbCacheHydrated = true;

  const propId = '999000111';
  const oldRangeKey = `${propId}:2026-11-10:2026-11-12`;
  store.memCache.set(oldRangeKey, {
    expiresAt: Date.now() + 60_000,
    data: {
      propertyId: propId,
      startDate: '2026-11-10',
      endDate: '2026-11-12',
      fetchedAt: '2026-11-12T10:00:00.000Z',
      totals: {
        totalUsers: 120,
        newUsers: 80,
        activeUsers: 110,
        sessions: 150,
        screenPageViews: 340,
        engagedSessions: 95,
        engagementRatePct: 63.3,
        userEngagementDurationSec: 4200,
      },
      daily: [],
      channels: [],
      landingPages: [],
      devices: [],
    },
  });

  // Exact range hit works
  const exactHit = await getGa4LivePropertySnapshot(propId, '2026-11-10', '2026-11-12', false);
  assert.ok(exactHit);
  assert.equal(exactHit.sessions, undefined);
  assert.equal(exactHit.totals.sessions, 150);

  // Different date range MUST return null rather than falling back to 2026-11-10..2026-11-12
  const missOtherDate = await getGa4LivePropertySnapshot(propId, '2026-11-19', '2026-11-19', false);
  assert.equal(missOtherDate, null);
  invalidateGa4LiveCaches();
});

test('PERF-05: M05 asyncMode returns early jobId immediately, enforces idempotency, and completes cleanly', async () => {
  const adminUser = await prisma.user.findFirst({
    where: { email: 'admin@toantrung.vn', isActive: true },
    select: { id: true, fullName: true, email: true },
  });
  assert.ok(adminUser, 'Seeded active ADMIN user is required in independent_v2.db');

  const actor = {
    id: adminUser.id,
    username: 'admin',
    fullName: adminUser.fullName,
    roleCode: 'ADMIN',
    email: adminUser.email,
  };

  const maxNotif = await prisma.notification.findFirst({
    orderBy: { id: 'desc' },
    select: { id: true },
  });
  const maxNotifId = maxNotif?.id ?? 0;

  const W = 80;
  const H = 60;
  const rgb = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i += 1) {
    rgb[i * 3] = 30;
    rgb[i * 3 + 1] = 80;
    rgb[i * 3 + 2] = 160;
  }
  const tinyPng = encodeRgbToPng({ width: W, height: H, rgb });
  const quad = {
    topLeft: { x: 20, y: 20 },
    topRight: { x: 80, y: 20 },
    bottomRight: { x: 80, y: 80 },
    bottomLeft: { x: 20, y: 80 },
  };

  const proj = await createDesignRequestWithAiDraft(actor, {
    designType: 'perspective_3d',
    projectName: '[TEST] Async Perf Regression Project',
    productId: 1,
    ledModuleSpec: 'P2.5 Indoor',
    screenWidthM: 4.8,
    screenHeightM: 2.7,
    placementQuad: quad,
    aiPrompt: '[INIT_PROJECT] Async Perf Test',
    quality: 'draft',
  });

  try {
    await addProjectPhoto(actor, proj.id, {
      photoName: 'test-survey.png',
      fileName: 'test-survey.png',
      mimeType: 'image/png',
      base64Data: tinyPng.toString('base64'),
    });

    const idemKey = `test-async-idem-${proj.id}-${Date.now()}`;
    const t0 = performance.now();
    const firstRes = await processChatDesignRequest(actor, proj.id, {
      prompt: '@taoanh Ghép màn hình LED P2.5 thử nghiệm hiệu năng bất đồng bộ',
      taskCode: 'perspective_compose',
      chatMode: 'image_generator',
      providerId: 'local_sandbox',
      modelId: 'toantrung-studio-v3',
      placementQuad: quad,
      screenWidthM: 4.8,
      screenHeightM: 2.7,
      compositingMode: 'STRICT',
      triggerSource: 'user_button',
      asyncMode: true,
      idempotencyKey: idemKey,
    });
    const queueLatencyMs = performance.now() - t0;

    assert.equal(firstRes.accepted, true);
    assert.equal(firstRes.asyncQueued, true);
    assert.equal(firstRes.status, 'running');
    assert.ok(firstRes.jobId, 'Async queue must return a non-empty jobId');
    assert.ok(queueLatencyMs < 1500, `Early jobId return should be non-blocking, got ${queueLatencyMs.toFixed(1)}ms`);

    // Immediate replay with the same idempotencyKey MUST not create a second billable job/version
    const replayRes = await processChatDesignRequest(actor, proj.id, {
      prompt: '@taoanh Ghép màn hình LED P2.5 thử nghiệm hiệu năng bất đồng bộ',
      taskCode: 'perspective_compose',
      chatMode: 'image_generator',
      providerId: 'local_sandbox',
      modelId: 'toantrung-studio-v3',
      placementQuad: quad,
      screenWidthM: 4.8,
      screenHeightM: 2.7,
      compositingMode: 'STRICT',
      triggerSource: 'user_button',
      asyncMode: true,
      idempotencyKey: idemKey,
    });
    assert.equal(replayRes.idempotentReplay, true);

    // Wait for background job completion (poll up to 5s)
    let detail = await getDesignProjectForUser(actor, proj.id);
    for (let i = 0; i < 40; i += 1) {
      if (detail.project.activeJob?.status !== 'running' && detail.project.assetVersions.length >= 1) {
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
      detail = await getDesignProjectForUser(actor, proj.id);
    }

    assert.equal(detail.project.activeJob?.status, 'succeeded');
    assert.equal(detail.project.assetVersions.length, 1, 'Exactly one version should be produced for an idempotent async job');
  } finally {
    // Wait briefly for lock release if needed before deleting synthetic project
    for (let i = 0; i < 20; i += 1) {
      try {
        await deleteDesignProject(actor, proj.id);
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    await prisma.notification.deleteMany({
      where: {
        OR: [
          { id: { gt: maxNotifId }, userId: actor.id },
          { title: { contains: '[TEST]' } },
        ],
      },
    });
  }
});
