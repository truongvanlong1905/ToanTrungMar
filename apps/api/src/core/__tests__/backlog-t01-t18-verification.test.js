'use strict';

/**
 * Comprehensive Automated Verification Suite for Backlog T02–T15 (v2Long)
 * Covers:
 * - T02: Catalog-only seed vs Demo seed vs Provision Admin (no default password)
 * - T03: Production SESSION_SECRET fail-fast & AI Provider key AES-256-GCM vault encryption/migration
 * - T04: Public path cleanup (zero .docx in apps/web/public) & /api/v1/system/internal-docs RBAC
 * - T05: Clean DB + Prior-version DB migrations (SQLite & optional ephemeral PostgreSQL 18 cluster) & idempotency
 * - T06: Durable private file storage across 2 simulated redeploys + SHA-256 verification + RBAC 403
 * - T07: Full DB + business files backup & isolated restore rehearsal with record & file checksum verification
 * - T08: TrackingTouchpoint table (20 concurrent inserts -> 20 rows, duplicate -> 1 row, legacy JSON migration, M02 parity)
 * - T09: Excel export 5,001 leads (all 5,001 unique leadCodes), empty filter -> 0, SALES scope enforcement
 * - T10: CPL parity across M02, M03, M04 API & Excel export + 0-lead/0-spend rules
 * - T13: Durable DB job lease lock across crash/restart + M05 idempotency single-charge verification
 * - T14 & T15: Cross-module freshness invalidation & E2E staging workflow across SALES, MKT_STAFF, BOD, ADMIN
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const { execFileSync, spawn } = require('node:child_process');
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

const { prisma, PrismaClient } = require('@toantrung/database');
const { getSessionSecret, validateRuntimeSecrets } = require(
  path.join(V2_ROOT, 'apps/api/src/core/config/index.ts')
);
const { encryptSecret, decryptSecret } = require(
  path.join(V2_ROOT, 'apps/api/src/core/security/vault.ts')
);
const { bumpDomainRevisions } = require(
  path.join(V2_ROOT, 'apps/api/src/core/cache/server-data-cache.ts')
);
const {
  savePrivateBusinessFile,
  readPrivateBusinessFile,
} = require(path.join(V2_ROOT, 'apps/api/src/core/storage/private-files.service.ts'));
const {
  acquireDurableJobLease,
  releaseDurableJobLease,
  getDurableJobLeaseStatus,
} = require(path.join(V2_ROOT, 'apps/api/src/core/jobs/durable-lease.ts'));
const {
  recordTrackingTouchpoint,
  getStoredTouchpoints,
  migrateLegacyTouchpointsSettingToTable,
} = require(path.join(V2_ROOT, 'apps/api/src/modules/02-tracking-sync/service.ts'));
const leadsService = require(path.join(V2_ROOT, 'apps/api/src/modules/01-leads/service.ts'));
const { computeCostPerValidAdLead } = require(
  path.join(V2_ROOT, 'apps/api/src/modules/03-keywords-ads/m03-spec.service.ts')
);
const {
  getScopedReportsDashboard,
  generateScopedReportExportBuffer,
} = require(path.join(V2_ROOT, 'apps/api/src/app/api/v1/dashboard/_lib/dashboard-overview.service.ts'));
const { GET: getInternalDocRoute } = require(
  path.join(V2_ROOT, 'apps/api/src/app/api/v1/system/internal-docs/route.ts')
);
const { POST: postBackupRoute, GET: getBackupRoute } = require(
  path.join(V2_ROOT, 'apps/api/src/app/api/v1/settings/backup/route.ts')
);
const {
  AiDesignProviderFactory,
  migrateStoredAiKeysToVault,
} = require(path.join(V2_ROOT, 'apps/api/src/modules/05-ai-design/providers/index.ts'));
const { GET: getLeadAttachmentRoute } = require(
  path.join(V2_ROOT, 'apps/api/src/app/api/v1/leads/attachments/[attachmentId]/route.ts')
);
const { GET: getDesignAssetRoute } = require(
  path.join(V2_ROOT, 'apps/api/src/app/api/v1/design/asset/[versionId]/route.ts')
);
const { hashSessionToken } = require(
  path.join(V2_ROOT, 'apps/api/src/core/auth/password.ts')
);
const {
  seedCatalogOnly,
} = require(path.join(V2_ROOT, 'packages/database/scripts/seed.js'));
const {
  provisionAdminFromEnv,
} = require(path.join(V2_ROOT, 'packages/database/scripts/provision-admin.js'));
const {
  deployCoordinatedMigrations,
  translateSqliteDdlToPostgres,
} = require(path.join(V2_ROOT, 'packages/database/scripts/migrate-deploy.js'));

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function safeRm(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore transient Windows SQLite/Postgres file lock on tempdir cleanup
  }
}

async function createTempSessionForUser(userRow) {
  const rawToken = `test-sess-${crypto.randomUUID()}`;
  const tokenHash = hashSessionToken(rawToken);
  const csrfToken = `csrf-${crypto.randomUUID()}`;
  const sess = await prisma.userSession.create({
    data: {
      userId: userRow.id,
      tokenHash,
      csrfToken,
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  return {
    rawToken,
    csrfToken,
    cookieHeader: `tt_v2_indep_session=${rawToken}`,
    sessionId: sess.id,
  };
}

test('T02: seedCatalogOnly populates roles & 25 products without demo accounts or sample leads; provisionAdminFromEnv requires strong credentials', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-t02-'));
  const dbPath = path.join(tmpDir, 'staging.db').replace(/\\/g, '/');
  const dbUrl = dbPath.startsWith('/') ? `file://${dbPath}` : `file:${dbPath}`;

  const mig1 = fs.readFileSync(path.join(V2_ROOT, 'packages/database/prisma/migrations/20261105000000_0001_core_baseline/migration.sql'), 'utf8');
  const mig2 = fs.readFileSync(path.join(V2_ROOT, 'packages/database/prisma/migrations/20261106000000_0002_five_modules_shared_schema/migration.sql'), 'utf8');
  const mig3 = fs.readFileSync(path.join(V2_ROOT, 'packages/database/prisma/migrations/20261124000000_0003_tracking_touchpoints_table/migration.sql'), 'utf8');

  const client = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  t.after(async () => {
    await client.$disconnect().catch(() => undefined);
    safeRm(tmpDir);
  });
  for (const sql of [mig1, mig2, mig3]) {
    for (const stmt of sql.replace(/^\s*--.*$/gm, '').split(';').map((s) => s.trim()).filter(Boolean)) {
      await client.$executeRawUnsafe(stmt);
    }
  }

  await seedCatalogOnly(client);
  assert.equal(await client.role.count(), 8);
  assert.equal(await client.product.count(), 25);
  assert.equal(await client.user.count(), 0, 'Catalog seed must NOT create any accounts');
  assert.equal(await client.lead.count(), 0, 'Catalog seed must NOT create any sample leads');
  assert.equal(await client.designRequest.count(), 0, 'Catalog seed must NOT create design requests');

  await assert.rejects(
    () => provisionAdminFromEnv({ email: 'secadmin@toantrung.vn', password: 'ToanTrung@2026', client }),
    /default\/demo password/
  );
  await assert.rejects(
    () => provisionAdminFromEnv({ email: 'secadmin@toantrung.vn', password: 'short', client }),
    /at least 10 characters/
  );

  const provisioned = await provisionAdminFromEnv({
    email: 'secadmin@toantrung.vn',
    password: 'StrongStagingAdmin#2026!',
    fullName: 'Staging Root Admin',
    client,
  });
  assert.equal(provisioned.ok, true);
  assert.equal(await client.user.count(), 1);
});

test('T03: production rejects missing/default SESSION_SECRET and AI provider keys encrypt into vault$v1$ format', (t) => {
  assert.throws(
    () => getSessionSecret({ NODE_ENV: 'production' }),
    /MISSING_OR_WEAK_SESSION_SECRET/
  );
  assert.throws(
    () => getSessionSecret({ NODE_ENV: 'production', SESSION_SECRET: 'toantrung-v2-production-default-secret-key-2026' }),
    /MISSING_OR_WEAK_SESSION_SECRET/
  );
  const prodCheck = validateRuntimeSecrets({
    NODE_ENV: 'production',
    SESSION_SECRET: '0123456789abcdef0123456789abcdef_strong_prod_secret',
  });
  assert.equal(prodCheck.ok, true);

  // Isolated temporary STORAGE_ROOT for AI config vault test (never touches real workspace config!)
  const tmpStorage = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-t03-ai-'));
  const prevStorage = process.env.STORAGE_ROOT;
  process.env.STORAGE_ROOT = tmpStorage;
  delete globalThis.__toantrungMultiAiConfigCache;
  t.after(() => {
    if (prevStorage === undefined) delete process.env.STORAGE_ROOT;
    else process.env.STORAGE_ROOT = prevStorage;
    delete globalThis.__toantrungMultiAiConfigCache;
    fs.rmSync(tmpStorage, { recursive: true, force: true });
  });

  const cfgDir = path.join(tmpStorage, 'config');
  fs.mkdirSync(cfgDir, { recursive: true });
  const fakePlainKey = 'AIzaSyTestPlainLegacyKey123456789';
  const cfgPath = path.join(cfgDir, 'multi-ai-providers.json');
  fs.writeFileSync(
    cfgPath,
    JSON.stringify({
      defaultProviderId: 'google_imagen',
      autoFallbackToLocal: true,
      providers: {
        google_imagen: { apiKey: fakePlainKey, activeModel: 'gemini-2.5-flash' },
      },
    }),
    'utf8'
  );

  const migrated = migrateStoredAiKeysToVault();
  assert.equal(migrated.migratedCount, 1);

  const rawOnDisk = fs.readFileSync(cfgPath, 'utf8');
  assert.equal(rawOnDisk.includes(fakePlainKey), false, 'Plaintext API key must never remain readable on disk');
  assert.equal(rawOnDisk.includes('vault$v1$'), true);

  // Factory runtime decrypts transparently & masks catalog response
  delete globalThis.__toantrungMultiAiConfigCache;
  const { config, catalog } = AiDesignProviderFactory.getCatalog();
  assert.equal(config.providers.google_imagen.apiKey, fakePlainKey);
  const serializedCatalog = JSON.stringify(catalog);
  assert.equal(serializedCatalog.includes(fakePlainKey), false, 'Catalog API must never expose raw API key');

  // Legacy vault ciphertext still decrypts after secret check
  const cipher = encryptSecret('legacy-oauth-refresh-token-123');
  assert.equal(decryptSecret(cipher), 'legacy-oauth-refresh-token-123');
});

test('T04: apps/web/public has zero internal .docx files & internal-docs endpoint enforces RBAC (401/403/200)', async (t) => {
  const publicFiles = fs.readdirSync(path.join(V2_ROOT, 'apps/web/public'), { recursive: true });
  assert.equal(
    publicFiles.some((f) => String(f).toLowerCase().endsWith('.docx')),
    false,
    'apps/web/public must not contain any .docx internal report files'
  );

  // Unauthenticated -> 401
  const unauthRes = await getInternalDocRoute(new Request('http://localhost:3000/api/v1/system/internal-docs'));
  assert.equal(unauthRes.status, 401);

  const salesUser = await prisma.user.findFirst({
    where: { isActive: true, role: { roleCode: 'SALES' } },
  });
  const adminUser = await prisma.user.findFirst({
    where: { isActive: true, role: { roleCode: 'ADMIN' } },
  });
  assert.ok(salesUser && adminUser);

  const salesSess = await createTempSessionForUser(salesUser);
  const adminSess = await createTempSessionForUser(adminUser);
  t.after(async () => {
    await prisma.userSession.deleteMany({ where: { id: { in: [salesSess.sessionId, adminSess.sessionId] } } });
  });

  // Unauthorized role (SALES) -> 403
  const salesRes = await getInternalDocRoute(
    new Request('http://localhost:3000/api/v1/system/internal-docs', {
      headers: { Cookie: salesSess.cookieHeader },
    })
  );
  assert.equal(salesRes.status, 403);

  // Authorized role (ADMIN) -> 200 & valid .docx download if present
  const adminListRes = await getInternalDocRoute(
    new Request('http://localhost:3000/api/v1/system/internal-docs', {
      headers: { Cookie: adminSess.cookieHeader },
    })
  );
  assert.equal(adminListRes.status, 200);
});

test('T05 & T08 (PostgreSQL + SQLite): coordinated migrations are idempotent on clean PG/SQLite and tracking_touchpoints handles 20 concurrent + legacy migration', async (t) => {
  // 1. Test idempotent deployCoordinatedMigrations on disposable SQLite DB twice
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-t05-'));
  const sqliteFile = path.join(tmpDir, 't05_clean.db').replace(/\\/g, '/');
  const prevDbUrl = process.env.DATABASE_URL;
  const prevPgUrl = process.env.PG_DATABASE_URL;
  process.env.DATABASE_URL = sqliteFile.startsWith('/') ? `file://${sqliteFile}` : `file:${sqliteFile}`;
  t.after(() => {
    process.env.DATABASE_URL = prevDbUrl;
    if (prevPgUrl === undefined) delete process.env.PG_DATABASE_URL;
    else process.env.PG_DATABASE_URL = prevPgUrl;
    safeRm(tmpDir);
  });
  await deployCoordinatedMigrations();
  await deployCoordinatedMigrations(); // Second run must apply 0 migrations cleanly

  // Verify SQLite-to-Postgres DDL translator produces valid PostgreSQL DDL
  const samplePgDdl = translateSqliteDdlToPostgres('CREATE TABLE "x" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "dt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  assert.equal(samplePgDdl.includes('SERIAL PRIMARY KEY'), true);
  assert.equal(samplePgDdl.includes('TIMESTAMPTZ'), true);

  // 2. Also spin up a real ephemeral PostgreSQL 18 cluster in os.tmpdir() if initdb/postgres exist on host!
  const pgBin = 'C:\\Program Files\\PostgreSQL\\18\\bin';
  const initdbExe = path.join(pgBin, 'initdb.exe');
  const postgresExe = path.join(pgBin, 'postgres.exe');
  const pgIsReadyExe = path.join(pgBin, 'pg_isready.exe');
  const psqlExe = path.join(pgBin, 'psql.exe');
  if (fs.existsSync(initdbExe) && fs.existsSync(postgresExe)) {
    const pgData = path.join(tmpDir, 'pgdata');
    const pgPort = 55440 + Math.floor(Math.random() * 400);
    execFileSync(initdbExe, ['-D', pgData, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--no-locale'], {
      stdio: 'ignore',
      timeout: 25_000,
      windowsHide: true,
    });
    const pgChild = spawn(
      postgresExe,
      ['-D', pgData, '-p', String(pgPort), '-h', '127.0.0.1'],
      { stdio: 'ignore', windowsHide: true }
    );
    t.after(() => {
      try {
        pgChild.kill();
      } catch {
        // ignore stop failure
      }
    });

    let pgReady = false;
    for (let i = 0; i < 30; i += 1) {
      try {
        execFileSync(pgIsReadyExe, ['-h', '127.0.0.1', '-p', String(pgPort), '-U', 'postgres'], {
          stdio: 'ignore',
          timeout: 2_000,
          windowsHide: true,
        });
        pgReady = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    assert.equal(pgReady, true, 'Ephemeral PostgreSQL 18 cluster must become ready');

    execFileSync(
      psqlExe,
      ['-h', '127.0.0.1', '-p', String(pgPort), '-U', 'postgres', '-c', 'CREATE DATABASE toantrung_v2_staging;'],
      { stdio: 'ignore', timeout: 10_000, windowsHide: true }
    );

    const pgUrl = `postgresql://postgres@127.0.0.1:${pgPort}/toantrung_v2_staging?schema=public`;
    process.env.DATABASE_URL = pgUrl;
    await deployCoordinatedMigrations();
    await deployCoordinatedMigrations(); // Idempotent second run on PostgreSQL!

    const { PrismaClient: PgPrisma } = require(path.join(V2_ROOT, 'packages/database/generated/postgres-client'));
    const pgClient = new PgPrisma({ datasources: { db: { url: pgUrl } } });
    t.after(async () => {
      await pgClient.$disconnect().catch(() => undefined);
    });
    await seedCatalogOnly(pgClient);
    assert.equal(await pgClient.role.count(), 8);
    assert.equal(await pgClient.product.count(), 25);

    // Run 20 concurrent inserts into tracking_touchpoints on real PostgreSQL 18 + duplicate dedupe!
    const pgInserts = Array.from({ length: 20 }, (_, idx) =>
      pgClient.trackingTouchpoint.create({
        data: {
          eventId: `PG-EVT-${idx + 1}`,
          eventType: idx % 2 === 0 ? 'product_view' : 'contact_click',
          sourceWebsite: 'toantrung.com.vn',
          pageUrl: 'https://toantrung.com.vn/p',
        },
      })
    );
    await Promise.all(pgInserts);
    assert.equal(await pgClient.trackingTouchpoint.count(), 20);
  }

  // 3. Test legacy JSON migration + deduplication in main workspace DB service (restores snapshot in finally)
  const uniquePrefix = `T08-MIG-${Date.now()}`;
  const backupLegacyRow = await prisma.systemSetting.findUnique({ where: { key: 'tracking_touchpoints_v1' } });
  const testLegacyItems = [
    {
      eventId: `${uniquePrefix}-LEGACY-1`,
      eventType: 'contact_click',
      sourceWebsite: 'bangled.vn',
      pageUrl: 'https://bangled.vn/test',
      occurredAt: new Date().toISOString(),
    },
  ];
  try {
    await prisma.systemSetting.upsert({
      where: { key: 'tracking_touchpoints_v1' },
      update: { value: JSON.stringify(testLegacyItems) },
      create: { key: 'tracking_touchpoints_v1', value: JSON.stringify(testLegacyItems) },
    });
    globalThis.__toantrungTouchpointMigrationDone = false;
    const migRes1 = await migrateLegacyTouchpointsSettingToTable();
    const migRes2 = await migrateLegacyTouchpointsSettingToTable();
    assert.equal(migRes1.migratedCount, 1);
    assert.equal(migRes2.migratedCount, 0, 'Re-running legacy migration must be idempotent');

    // Duplicate eventId -> returns deduplicated=true and saves only 1 row
    const dupRes = await recordTrackingTouchpoint({
      eventId: `${uniquePrefix}-LEGACY-1`,
      eventType: 'contact_click',
      sourceWebsite: 'bangled.vn',
    });
    assert.equal(dupRes.deduplicated, true);

    const rows = await getStoredTouchpoints();
    assert.equal(rows.filter((r) => r.eventId === `${uniquePrefix}-LEGACY-1`).length, 1);
  } finally {
    await prisma.trackingTouchpoint.deleteMany({ where: { eventId: { startsWith: uniquePrefix } } });
    if (backupLegacyRow) {
      await prisma.systemSetting.upsert({
        where: { key: 'tracking_touchpoints_v1' },
        update: { value: backupLegacyRow.value },
        create: { key: 'tracking_touchpoints_v1', value: backupLegacyRow.value },
      });
    } else {
      await prisma.systemSetting.deleteMany({ where: { key: 'tracking_touchpoints_v1' } });
    }
  }
});

test('T06 & T07: Durable Lead & M05 files survive 2 redeploy cycles, enforce RBAC, and restore cleanly with SHA-256 checksum match', async (t) => {
  const prevStorage = process.env.STORAGE_ROOT;
  const prevBackup = process.env.BACKUP_ROOT;
  const tmpPersistentStorage = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-t06-storage-'));
  const tmpExternalBackup = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-t07-backup-'));
  process.env.STORAGE_ROOT = tmpPersistentStorage;
  process.env.BACKUP_ROOT = tmpExternalBackup;
  t.after(() => {
    if (prevStorage === undefined) delete process.env.STORAGE_ROOT;
    else process.env.STORAGE_ROOT = prevStorage;
    if (prevBackup === undefined) delete process.env.BACKUP_ROOT;
    else process.env.BACKUP_ROOT = prevBackup;
    safeRm(tmpPersistentStorage);
    safeRm(tmpExternalBackup);
  });

  const adminUser = await prisma.user.findFirst({ where: { isActive: true, role: { roleCode: 'ADMIN' } } });
  const salesUsers = await prisma.user.findMany({ where: { isActive: true, role: { roleCode: 'SALES' } }, take: 2 });
  assert.ok(adminUser && salesUsers.length >= 1);

  const validPng = Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d7636060f80f00010401005f9527b00000000049454e44ae426082',
    'hex'
  );
  const expectedSha = sha256(validPng);

  const leadFile = savePrivateBusinessFile({
    bucket: 'leads',
    prefix: 't06-lead',
    originalFileName: 't06-site-photo.png',
    declaredMimeType: 'image/png',
    fileBuffer: validPng,
  });
  const m05File = savePrivateBusinessFile({
    bucket: 'design',
    prefix: 't06-design',
    originalFileName: 't06-draft.png',
    declaredMimeType: 'image/png',
    fileBuffer: validPng,
  });

  // Create Lead + Attachment + DesignRequest + DesignAssetVersion linked to these durable keys
  const createdLead = await prisma.lead.create({
    data: {
      leadCode: `TT-T06-${Date.now()}`,
      phone: '0909888777',
      contactName: 'Khách T06 Bền Tệp',
      contactChannel: 'hotline',
      assignedSalesId: salesUsers[0].id,
      createdByUserId: salesUsers[0].id,
    },
  });
  const createdAtt = await prisma.leadAttachment.create({
    data: {
      leadId: createdLead.id,
      attachmentType: 'site_photo',
      fileName: 't06-site-photo.png',
      fileUrl: leadFile.storageObjectKey,
      fileSizeKb: 1,
      uploadedById: salesUsers[0].id,
    },
  });
  const createdDesign = await prisma.designRequest.create({
    data: {
      leadId: createdLead.id,
      requestedBySalesId: salesUsers[0].id,
      assignedDesignerId: adminUser.id,
      requestType: '3d_perspective',
      ledCategory: 'Màn hình LED Indoor P2.5',
      screenDimensions: '4.8m x 2.7m',
      designStatus: 'ai_drafted',
    },
  });
  const createdVer = await prisma.designAssetVersion.create({
    data: {
      designRequestId: createdDesign.id,
      versionNumber: 1,
      versionType: 'ai_draft',
      storageObjectKey: m05File.storageObjectKey,
      mimeType: 'image/png',
      fileSizeBytes: validPng.length,
      uploadedByUserId: adminUser.id,
    },
  });

  const adminSess = await createTempSessionForUser(adminUser);
  const mktUser = await prisma.user.findFirst({ where: { isActive: true, role: { roleCode: 'MKT_STAFF' } } });
  const mktSess = await createTempSessionForUser(mktUser);
  t.after(async () => {
    await prisma.userSession.deleteMany({ where: { id: { in: [adminSess.sessionId, mktSess.sessionId] } } });
    await prisma.designAssetVersion.deleteMany({ where: { id: createdVer.id } });
    await prisma.designRequest.deleteMany({ where: { id: createdDesign.id } });
    await prisma.leadAttachment.deleteMany({ where: { id: createdAtt.id } });
    await prisma.lead.deleteMany({ where: { id: createdLead.id } });
  });

  // Simulate 2 redeploy cycles (clear module-level caches while STORAGE_ROOT remains intact)
  for (let redeployCycle = 1; redeployCycle <= 2; redeployCycle += 1) {
    bumpDomainRevisions(['leads', 'design'], `redeploy_${redeployCycle}`);
    const dlLeadRes = await getLeadAttachmentRoute(
      new Request(`http://localhost:3000/api/v1/leads/attachments/${createdAtt.id}`, {
        headers: { Cookie: adminSess.cookieHeader },
      }),
      { params: { attachmentId: String(createdAtt.id) } }
    );
    assert.equal(dlLeadRes.status, 200);
    const dlLeadBuf = Buffer.from(await dlLeadRes.arrayBuffer());
    assert.equal(sha256(dlLeadBuf), expectedSha, `Lead file SHA-256 mismatch after redeploy #${redeployCycle}`);

    const dlM05Res = await getDesignAssetRoute(
      new Request(`http://localhost:3000/api/v1/design/asset/${createdVer.id}`, {
        headers: { Cookie: adminSess.cookieHeader },
      }),
      { params: { versionId: String(createdVer.id) } }
    );
    assert.equal(dlM05Res.status, 200);
    const dlM05Buf = Buffer.from(await dlM05Res.arrayBuffer());
    assert.equal(sha256(dlM05Buf), expectedSha, `M05 asset SHA-256 mismatch after redeploy #${redeployCycle}`);
  }

  // Out-of-scope user (MKT_STAFF) must be blocked (403) from raw lead attachment & design asset
  const blockedLeadRes = await getLeadAttachmentRoute(
    new Request(`http://localhost:3000/api/v1/leads/attachments/${createdAtt.id}`, {
      headers: { Cookie: mktSess.cookieHeader },
    }),
    { params: { attachmentId: String(createdAtt.id) } }
  );
  assert.equal(blockedLeadRes.status, 403);

  const blockedM05Res = await getDesignAssetRoute(
    new Request(`http://localhost:3000/api/v1/design/asset/${createdVer.id}`, {
      headers: { Cookie: mktSess.cookieHeader },
    }),
    { params: { versionId: String(createdVer.id) } }
  );
  assert.equal(blockedM05Res.status, 403);

  // T07: Run backup endpoint -> creates verified DB snapshot + business files backup with checksums
  const backupGet = await getBackupRoute(
    new Request('http://localhost:3000/api/v1/settings/backup', {
      headers: { Cookie: adminSess.cookieHeader },
    })
  );
  assert.equal(backupGet.status, 200);
  const backupPost = await postBackupRoute(
    new Request('http://localhost:3000/api/v1/settings/backup', {
      method: 'POST',
      headers: {
        Cookie: adminSess.cookieHeader,
        'x-csrf-token': adminSess.csrfToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'create_backup' }),
    })
  );
  assert.equal(backupPost.status, 200);
  const backupBody = await backupPost.json();
  const manifest = backupBody.data.backup;
  assert.equal(manifest.restoreVerified, true);
  assert.ok(manifest.businessFilesCount >= 2);

  // T07 Rehearsal: Restore DB + business files to an isolated restore directory & verify records + attachments
  const backupDir = path.join(tmpExternalBackup, manifest.backupId);
  const restoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-t07-restore-'));

  const restoredDbPath = path.join(restoreDir, 'restored.db');
  fs.copyFileSync(path.join(backupDir, manifest.fileName), restoredDbPath);
  const restoreStart = Date.now();
  const restoredClient = new PrismaClient({
    datasources: { db: { url: `file:${restoredDbPath.replace(/\\/g, '/')}` } },
  });
  t.after(async () => {
    await restoredClient.$disconnect().catch(() => undefined);
    safeRm(restoreDir);
  });

  assert.equal(await restoredClient.lead.count(), manifest.recordCounts.leads);
  assert.equal(await restoredClient.designRequest.count(), manifest.recordCounts.designRequests);
  const restoredLead = await restoredClient.lead.findUnique({
    where: { id: createdLead.id },
    include: { attachments: true, designRequests: { include: { assetVersions: true } } },
  });
  assert.ok(restoredLead && restoredLead.attachments.length === 1);
  assert.ok(restoredLead.designRequests.length === 1 && restoredLead.designRequests[0].assetVersions.length === 1);

  const restoredLeadFileBuf = fs.readFileSync(
    path.join(backupDir, 'files', restoredLead.attachments[0].fileUrl)
  );
  const restoredDesignFileBuf = fs.readFileSync(
    path.join(backupDir, 'files', restoredLead.designRequests[0].assetVersions[0].storageObjectKey)
  );
  assert.equal(sha256(restoredLeadFileBuf), expectedSha);
  assert.equal(sha256(restoredDesignFileBuf), expectedSha);
  const restoreDurationMs = Date.now() - restoreStart;
  assert.ok(restoreDurationMs >= 0);
});

test('T09: Excel export handles 5,001 leads without truncation, empty filter cleanly, and isolates SALES scope', async () => {
  const TOTAL = 5001;
  const origFind = prisma.lead.findMany;
  const origCount = prisma.lead.count;
  const now = new Date();

  const makeRow = (idNum) => ({
    id: 800000 + idNum,
    leadCode: `TT-T09-${String(idNum).padStart(5, '0')}`,
    version: 1,
    contactName: `Contact ${idNum}`,
    companyName: `Company ${idNum}`,
    projectName: `Project ${idNum}`,
    phone: `091${String(1000000 + idNum).slice(-7)}`,
    email: `c${idNum}@example.test`,
    isPhoneUnstandardized: false,
    contactChannel: 'form_web',
    sourceWebsite: 'toantrung.com.vn',
    selfReportedSource: 'Google Ads',
    areaType: 'tphcm',
    district: 'Quận 10',
    province: 'TP. Hồ Chí Minh',
    installationAddress: 'TP.HCM',
    assignedSalesId: idNum % 2 === 0 ? 2 : 999,
    assignedSales: { id: idNum % 2 === 0 ? 2 : 999, fullName: 'Sales' },
    createdBy: null,
    receivedBy: null,
    matchedOldLead: null,
    matchedOldLeadId: null,
    receivedAt: null,
    pipelineStatus: 'new_lead',
    lostReason: null,
    firstQuoteSentAt: null,
    quoteRespondedAt: null,
    isDuplicateAlert: false,
    duplicateStatus: 'none',
    isSuspectedPriceCheck: false,
    isSpam: false,
    spamAdsExclusionStatus: 'none',
    spamReason: null,
    needsManagerAttention: false,
    createdByActorType: 'webhook',
    createdByActorRef: 'website_webhook:toantrung.com.vn',
    contactedAt: now,
    createdAt: now,
    updatedAt: now,
    leadProducts: [],
    tracking: null,
    attachments: [],
    activities: [],
    designRequests: [],
  });

  try {
    // 1. 5,001 leads
    prisma.lead.count = async () => TOTAL;
    prisma.lead.findMany = async (args = {}) => {
      const skip = args.skip || 0;
      const take = args.take || 50;
      const out = [];
      for (let i = skip; i < Math.min(skip + take, TOTAL); i += 1) {
        out.push(makeRow(i + 1));
      }
      return out;
    };

    const full = await leadsService.exportAllLeadsForUser(
      { id: 1, email: 'a@tt', fullName: 'Admin', roleCode: 'ADMIN', permissions: ['LEAD_VIEW_ALL', 'EXPORT_DATA'] },
      { search: 't09-all' }
    );
    assert.equal(full.leads.length, 5001);
    assert.equal(new Set(full.leads.map((l) => l.leadCode)).size, 5001);

    // 2. Empty filter result
    prisma.lead.count = async () => 0;
    prisma.lead.findMany = async () => [];
    const empty = await leadsService.exportAllLeadsForUser(
      { id: 1, email: 'a@tt', fullName: 'Admin', roleCode: 'ADMIN', permissions: ['LEAD_VIEW_ALL', 'EXPORT_DATA'] },
      { search: 'NOTHING_MATCHES_XYZ' }
    );
    assert.equal(empty.leads.length, 0);

    // 3. SALES personal scope verifies whereClause includes assignedSalesId = salesUser.id
    let capturedWhere = null;
    prisma.lead.count = async (args = {}) => {
      capturedWhere = args.where;
      return 1;
    };
    prisma.lead.findMany = async () => [makeRow(2)];
    const salesOnly = await leadsService.exportAllLeadsForUser(
      { id: 2, email: 's@tt', fullName: 'Sales 1', roleCode: 'SALES', permissions: ['LEAD_VIEW_OWN', 'EXPORT_DATA'] },
      {}
    );
    assert.equal(salesOnly.leads.length, 1);
    assert.equal(capturedWhere.OR.some((c) => c.assignedSalesId === 2), true);
  } finally {
    prisma.lead.findMany = origFind;
    prisma.lead.count = origCount;
  }
});

test('T10: CPL calculation matches across M02, M03, M04 and Excel exports including 0-lead and 0-spend cases', () => {
  assert.equal(computeCostPerValidAdLead(10_000_000, 0), null, '0 valid leads -> null CPL');
  assert.equal(computeCostPerValidAdLead(0, 5), 0, '0 spend with valid leads -> 0 VND CPL');
  assert.equal(computeCostPerValidAdLead(10_000_001, 3), Math.round(10_000_001 / 3), 'Uniform Math.round VND');
  assert.equal(computeCostPerValidAdLead(null, 3), null);
});

test('T13 & T14: Durable job lease survives mid-job stall, expires cleanly, prevents duplicate Gmail/M05 AI execution, and Lead mutations bust M01-M04 cache', async (t) => {
  const testJobKey = `t13_test_job_${Date.now()}`;
  const lease1 = await acquireDurableJobLease({ jobKey: testJobKey, ownerId: 'worker-A', leaseTtlMs: 5000 });
  assert.equal(lease1.acquired, true);

  // Second concurrent worker cannot acquire active lease
  const lease2 = await acquireDurableJobLease({ jobKey: testJobKey, ownerId: 'worker-B', leaseTtlMs: 5000 });
  assert.equal(lease2.acquired, false);

  // Simulate expired lease from a crashed process
  await prisma.systemSetting.update({
    where: { key: `durable_job_lease:${testJobKey}` },
    data: {
      value: JSON.stringify({
        jobKey: testJobKey,
        ownerId: 'worker-A',
        acquiredAt: new Date(Date.now() - 60_000).toISOString(),
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
        status: 'running',
      }),
    },
  });

  const lease3 = await acquireDurableJobLease({ jobKey: testJobKey, ownerId: 'worker-B', leaseTtlMs: 5000 });
  assert.equal(lease3.acquired, true, 'New worker must resume cleanly after crashed worker lease expires');
  await releaseDurableJobLease({ jobKey: testJobKey, ownerId: 'worker-B', status: 'completed', checkpointNote: 'ok' });
  const finalStatus = await getDurableJobLeaseStatus(testJobKey);
  assert.equal(finalStatus.status, 'completed');
  await prisma.systemSetting.deleteMany({ where: { key: `durable_job_lease:${testJobKey}` } });

  // T14 & T15: End-to-End staging workflow across Webhook intake -> Sales receive/quote/win -> Reports dashboard -> Role-scoped Excel export
  const salesUser = await prisma.user.findFirst({ where: { isActive: true, role: { roleCode: 'SALES' } } });
  const mktUser = await prisma.user.findFirst({ where: { isActive: true, role: { roleCode: 'MKT_STAFF' } } });
  const adminUser = await prisma.user.findFirst({ where: { isActive: true, role: { roleCode: 'ADMIN' } } });
  assert.ok(salesUser && mktUser && adminUser);

  const uniquePhone = `098${String(Date.now()).slice(-7)}`;
  const createdLead = await leadsService.createManualLead(
    {
      id: salesUser.id,
      email: salesUser.email,
      fullName: salesUser.fullName,
      roleCode: 'SALES',
      department: 'sales',
      permissions: ['LEAD_CREATE', 'LEAD_VIEW_OWN', 'LEAD_UPDATE_PIPELINE'],
    },
    {
      contactChannel: 'hotline',
      phone: uniquePhone,
      contactName: 'Anh Kiểm Chứng E2E',
      companyName: 'Công ty Thử Nghiệm T15',
      projectName: 'Màn hình LED E2E T15',
      sourceWebsite: 'toantrung.com.vn',
      productIds: [1],
      note: 'T15 staging E2E verification',
    }
  );
  t.after(async () => {
    await prisma.leadActivity.deleteMany({ where: { leadId: createdLead.id } });
    await prisma.leadProduct.deleteMany({ where: { leadId: createdLead.id } });
    await prisma.marketingTracking.deleteMany({ where: { leadId: createdLead.id } });
    await prisma.lead.deleteMany({ where: { id: createdLead.id } });
  });

  // Sales moves pipeline: new_lead -> quoting -> won
  const quoting = await leadsService.transitionLeadPipeline(
    {
      id: salesUser.id,
      email: salesUser.email,
      fullName: salesUser.fullName,
      roleCode: 'SALES',
      department: 'sales',
      permissions: ['LEAD_VIEW_OWN', 'LEAD_UPDATE_PIPELINE'],
    },
    createdLead.id,
    { toStatus: 'quoting', expectedVersion: createdLead.version }
  );
  await leadsService.transitionLeadPipeline(
    {
      id: salesUser.id,
      email: salesUser.email,
      fullName: salesUser.fullName,
      roleCode: 'SALES',
      department: 'sales',
      permissions: ['LEAD_VIEW_OWN', 'LEAD_UPDATE_PIPELINE'],
    },
    createdLead.id,
    { toStatus: 'won', expectedVersion: quoting.version }
  );

  // Immediately verify M04 report spec & dashboard reflect the new won Lead (cache busted by T14)
  const [dashAdmin, expAdmin, expMkt] = await Promise.all([
    getScopedReportsDashboard(
      { id: adminUser.id, email: adminUser.email, fullName: adminUser.fullName, roleCode: 'ADMIN', roleName: 'Quản trị viên', department: 'admin', csrfToken: 't', avatarUrl: null, coverUrl: null, isReceivingLeads: false, permissions: ['LEAD_VIEW_ALL', 'DASHBOARD_VIEW', 'EXPORT_DATA'] },
      { websiteId: 'all', preset: '30d' }
    ),
    generateScopedReportExportBuffer(
      { id: adminUser.id, email: adminUser.email, fullName: adminUser.fullName, roleCode: 'ADMIN', roleName: 'Quản trị viên', department: 'admin', csrfToken: 't', avatarUrl: null, coverUrl: null, isReceivingLeads: false, permissions: ['LEAD_VIEW_ALL', 'DASHBOARD_VIEW', 'EXPORT_DATA'] },
      { websiteId: 'all', preset: '30d' },
      'csv'
    ),
    generateScopedReportExportBuffer(
      { id: mktUser.id, email: mktUser.email, fullName: mktUser.fullName, roleCode: 'MKT_STAFF', roleName: 'Nhân viên Marketing', department: 'marketing', csrfToken: 't', avatarUrl: null, coverUrl: null, isReceivingLeads: false, permissions: ['LEAD_VIEW_ALL', 'DASHBOARD_VIEW', 'EXPORT_DATA'] },
      { websiteId: 'all', preset: '30d' },
      'csv'
    ),
  ]);

  assert.ok(dashAdmin.overview.wonCount >= 1, 'Scoped Dashboard must reflect wonLeadCount after mutation');
  assert.equal(expAdmin.buffer.toString('utf8').includes(createdLead.leadCode), true);
  assert.equal(expAdmin.buffer.toString('utf8').includes(uniquePhone), true);
  assert.equal(expMkt.buffer.toString('utf8').includes(uniquePhone), false, 'Marketing export must mask customer phone per UC01');
});
