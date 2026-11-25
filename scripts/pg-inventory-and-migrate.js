#!/usr/bin/env node
'use strict';

/**
 * DB-01, DB-02, DB-03, DB-04, DB-05:
 * Công cụ kiểm kê toàn bộ 23 bảng SQLite, xuất snapshot, nạp sang PostgreSQL 18.6 thật,
 * đối soát trực tiếp SQLite <-> PostgreSQL, kiểm thử tạo bản ghi mới + tệp đính kèm +
 * sao lưu pg_dump & khôi phục psql trên PostgreSQL thử nghiệm.
 *
 * Bảo toàn tuyệt đối tệp SQLite nguồn (kiểm tra SHA-256 trước và sau).
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { PrismaClient: SqlitePrismaClient } = require('@prisma/client');

// Toàn bộ 23 model chuẩn trong schema Prisma theo thứ tự cha -> con
const ORDERED_MODELS = [
  'role',
  'user',
  'userSession',
  'notification',
  'brandingAsset',
  'systemSetting',
  'auditLog',
  'product',
  'campaign',
  'lead',
  'leadProduct',
  'leadAttachment',
  'leadActivity',
  'priceCheckAlert',
  'marketingTracking',
  'leadReconciliation',
  'webhookIntakeErrorLog',
  'platformDailyMetric',
  'platformSyncLog',
  'seoKeyword',
  'seoArticle',
  'seoArticleRevision',
  'designRequest',
  'aiUsageLog',
  'designAssetVersion',
];

const TABLE_NAME_MAP = {
  role: 'roles',
  user: 'users',
  userSession: null, // String cuid PK
  notification: 'notifications',
  brandingAsset: 'branding_assets',
  systemSetting: null, // String key PK
  auditLog: 'audit_logs',
  product: 'products',
  campaign: 'campaigns',
  lead: 'leads',
  leadProduct: 'lead_products',
  leadAttachment: 'lead_attachments',
  leadActivity: 'lead_activities',
  priceCheckAlert: 'price_check_alerts',
  marketingTracking: 'marketing_tracking',
  leadReconciliation: 'lead_reconciliations',
  webhookIntakeErrorLog: 'webhook_intake_error_logs',
  platformDailyMetric: 'platform_daily_metrics',
  platformSyncLog: 'platform_sync_logs',
  seoKeyword: 'seo_keywords',
  seoArticle: 'seo_articles',
  seoArticleRevision: 'seo_article_revisions',
  designRequest: 'design_requests',
  aiUsageLog: 'ai_usage_logs',
  designAssetVersion: 'design_asset_versions',
};

const BIGINT_FIELDS = new Set([
  'quoteValueVnd',
  'dealValueVnd',
  'dailyBudgetMicros',
  'spendMicros',
  'cpcMicros',
  'conversionsMicros',
  'totalCostMicros',
  'costMicros',
]);

function redactPgUrl(url) {
  if (!url) return 'N/A';
  return String(url).replace(/(:\/\/[^:/?#]+):([^@]+)@/, '$1:***@');
}

function getSqliteFileHash() {
  const sqlitePath = path.resolve(process.cwd(), 'packages/database/prisma/independent_v2.db');
  if (!fs.existsSync(sqlitePath)) return null;
  const buf = fs.readFileSync(sqlitePath);
  return {
    path: sqlitePath,
    sizeBytes: buf.length,
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
  };
}

function createPgPrismaClient() {
  const pgClientPath = path.resolve(process.cwd(), 'packages/database/generated/postgres-client');
  if (!fs.existsSync(pgClientPath)) {
    throw new Error(
      `Chưa tìm thấy PostgreSQL Prisma Client tại ${pgClientPath}. Hãy chạy: npx prisma generate --schema=packages/database/prisma-postgres`,
    );
  }
  const { PrismaClient: PgPrismaClient } = require(pgClientPath);
  const pgUrl =
    process.env.PG_DATABASE_URL ||
    'postgresql://postgres@127.0.0.1:55432/toantrung_v2_trial?schema=public';
  return new PgPrismaClient({
    datasources: { db: { url: pgUrl } },
  });
}

async function runInventory(sqlitePrisma) {
  const counts = {};
  let totalRows = 0;

  for (const model of ORDERED_MODELS) {
    if (!sqlitePrisma[model] || typeof sqlitePrisma[model].count !== 'function') {
      counts[model] = 'N/A';
      continue;
    }
    const c = await sqlitePrisma[model].count();
    counts[model] = c;
    totalRows += c;
  }

  const sampleLeads = await sqlitePrisma.lead.findMany({
    take: 3,
    orderBy: { id: 'asc' },
    select: {
      id: true,
      leadCode: true,
      phone: true,
      sourceWebsite: true,
      contactedAt: true,
    },
  });

  const attachments = await sqlitePrisma.leadAttachment.findMany({
    select: { id: true, leadId: true, fileName: true, fileUrl: true },
  });

  const designAssets = await sqlitePrisma.designAssetVersion.findMany({
    take: 5,
    select: { id: true, designRequestId: true, versionNumber: true, storageObjectKey: true },
  });

  console.log(
    JSON.stringify(
      {
        sqliteSource: getSqliteFileHash(),
        totalRows,
        tableCounts: counts,
        sampleLeads,
        attachmentsCount: attachments.length,
        sampleAttachments: attachments.slice(0, 5),
        sampleDesignAssets: designAssets,
      },
      (_, v) => (typeof v === 'bigint' ? v.toString() : v),
      2,
    ),
  );
}

async function exportSnapshot(sqlitePrisma, outFile) {
  const payload = {
    exportedAt: new Date().toISOString(),
    sqliteSource: getSqliteFileHash(),
    orderedModels: ORDERED_MODELS,
    tables: {},
  };

  for (const model of ORDERED_MODELS) {
    if (!sqlitePrisma[model] || typeof sqlitePrisma[model].findMany !== 'function') continue;
    payload.tables[model] = await sqlitePrisma[model].findMany();
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(
    outFile,
    JSON.stringify(payload, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2),
    'utf8',
  );
  console.log(`Exported snapshot to ${outFile}`);
}

async function importSnapshotToPostgres(pgPrisma, snapshotPath) {
  const sqliteBefore = getSqliteFileHash();
  const payload = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  const pgInfo = await pgPrisma.$queryRawUnsafe(
    `SELECT version() AS version, current_database() AS db_name, inet_server_addr()::text AS addr, inet_server_port() AS port;`,
  );

  // Gỡ các khóa ngoại vòng trước khi xóa sạch dữ liệu cũ trên PG thử nghiệm
  await pgPrisma.seoArticle.updateMany({
    data: { currentRevisionId: null, approvedRevisionId: null },
  });
  await pgPrisma.designRequest.updateMany({
    data: { approvedVersionId: null },
  });
  await pgPrisma.lead.updateMany({
    data: { matchedOldLeadId: null },
  });

  for (const model of [...ORDERED_MODELS].reverse()) {
    if (pgPrisma[model] && typeof pgPrisma[model].deleteMany === 'function') {
      await pgPrisma[model].deleteMany({});
    }
  }

  const importedCounts = {};
  let totalImported = 0;

  const deferredLeadMatches = [];
  const deferredArticleRevs = [];
  const deferredDesignApprovals = [];

  for (const model of ORDERED_MODELS) {
    const rows = payload.tables[model];
    if (!Array.isArray(rows) || rows.length === 0 || !pgPrisma[model]) {
      importedCounts[model] = 0;
      continue;
    }

    for (const row of rows) {
      const normalized = { ...row };
      for (const k of Object.keys(normalized)) {
        if (BIGINT_FIELDS.has(k) && normalized[k] != null) {
          normalized[k] = BigInt(normalized[k]);
        }
      }

      if (model === 'lead' && normalized.matchedOldLeadId != null) {
        deferredLeadMatches.push({ id: normalized.id, matchedOldLeadId: normalized.matchedOldLeadId });
        normalized.matchedOldLeadId = null;
      }
      if (model === 'seoArticle' && (normalized.currentRevisionId != null || normalized.approvedRevisionId != null)) {
        deferredArticleRevs.push({
          id: normalized.id,
          currentRevisionId: normalized.currentRevisionId,
          approvedRevisionId: normalized.approvedRevisionId,
        });
        normalized.currentRevisionId = null;
        normalized.approvedRevisionId = null;
      }
      if (model === 'designRequest' && normalized.approvedVersionId != null) {
        deferredDesignApprovals.push({
          id: normalized.id,
          approvedVersionId: normalized.approvedVersionId,
        });
        normalized.approvedVersionId = null;
      }

      await pgPrisma[model].create({ data: normalized });
    }

    const sqlTable = TABLE_NAME_MAP[model];
    if (sqlTable) {
      await pgPrisma.$executeRawUnsafe(
        `SELECT setval(pg_get_serial_sequence('"${sqlTable}"', 'id'), COALESCE((SELECT MAX(id) FROM "${sqlTable}"), 1), true);`,
      );
    }
    importedCounts[model] = rows.length;
    totalImported += rows.length;
  }

  // Khôi phục các liên kết FK vòng sau khi bảng đích đã có bản ghi
  for (const item of deferredLeadMatches) {
    await pgPrisma.lead.update({
      where: { id: item.id },
      data: { matchedOldLeadId: item.matchedOldLeadId },
    });
  }
  for (const item of deferredArticleRevs) {
    await pgPrisma.seoArticle.update({
      where: { id: item.id },
      data: {
        currentRevisionId: item.currentRevisionId,
        approvedRevisionId: item.approvedRevisionId,
      },
    });
  }
  for (const item of deferredDesignApprovals) {
    await pgPrisma.designRequest.update({
      where: { id: item.id },
      data: { approvedVersionId: item.approvedVersionId },
    });
  }

  const sqliteAfter = getSqliteFileHash();
  console.log(
    JSON.stringify(
      {
        action: 'IMPORT_SQLITE_SNAPSHOT_TO_POSTGRESQL',
        targetPostgresUrl: redactPgUrl(
          process.env.PG_DATABASE_URL ||
            'postgresql://postgres:***@127.0.0.1:55432/toantrung_v2_trial?schema=public',
        ),
        postgresServerInfo: pgInfo[0],
        totalImported,
        importedCounts,
        deferredCircularForeignKeysRestored: {
          leadMatchedOldLead: deferredLeadMatches.length,
          seoArticleRevisions: deferredArticleRevs.length,
          designApprovedVersions: deferredDesignApprovals.length,
        },
        sqliteSourceUnchanged: sqliteBefore?.sha256 === sqliteAfter?.sha256,
        sqliteSha256: sqliteAfter?.sha256,
      },
      null,
      2,
    ),
  );
}

async function verifySqliteAgainstRealPostgres(sqlitePrisma, pgPrisma) {
  const pgInfo = await pgPrisma.$queryRawUnsafe(
    `SELECT version() AS version, current_database() AS db_name, inet_server_addr()::text AS addr, inet_server_port() AS port;`,
  );

  const tableComparison = {};
  const mismatches = [];
  let totalSqlite = 0;
  let totalPostgres = 0;

  for (const model of ORDERED_MODELS) {
    if (!sqlitePrisma[model] || !pgPrisma[model]) continue;
    const sqliteCount = await sqlitePrisma[model].count();
    const pgCount = await pgPrisma[model].count();
    totalSqlite += sqliteCount;
    totalPostgres += pgCount;
    tableComparison[model] = { sqlite: sqliteCount, postgres: pgCount, match: sqliteCount === pgCount };
    if (sqliteCount !== pgCount) {
      mismatches.push({ model, sqliteCount, pgCount });
    }
  }

  // Đối chiếu quan hệ khóa ngoại (Relational Integrity) trên PostgreSQL
  const [
    pgUsersWithRole,
    pgLeadsWithSales,
    pgLeadProductsWithJoin,
    pgTrackingsWithLead,
    pgArticlesWithKeyword,
    pgDesignsWithVersions,
  ] = await Promise.all([
    pgPrisma.user.findMany({
      include: { role: { select: { roleCode: true, roleName: true } } },
    }),
    pgPrisma.lead.findMany({
      include: { assignedSales: { select: { id: true, email: true } } },
      orderBy: { id: 'asc' },
      take: 5,
    }),
    pgPrisma.leadProduct.findMany({
      include: { lead: { select: { leadCode: true } }, product: { select: { productCode: true } } },
    }),
    pgPrisma.marketingTracking.findMany({
      include: { lead: { select: { leadCode: true } }, campaign: { select: { campaignCode: true } } },
      take: 5,
    }),
    pgPrisma.seoArticle.findMany({
      include: { keyword: { select: { keyword: true } }, revisions: { select: { id: true, revisionNumber: true } } },
    }),
    pgPrisma.designRequest.findMany({
      include: { assetVersions: { select: { id: true, versionNumber: true, storageObjectKey: true } } },
    }),
  ]);

  // Đối chiếu dữ liệu mẫu chi tiết giữa SQLite và PostgreSQL (ID, SĐT có số 0 đầu, thời gian, website)
  const sqliteSampleLeads = await sqlitePrisma.lead.findMany({
    orderBy: { id: 'asc' },
    take: 5,
    select: { id: true, leadCode: true, phone: true, sourceWebsite: true, contactedAt: true },
  });
  const pgSampleLeads = await pgPrisma.lead.findMany({
    orderBy: { id: 'asc' },
    take: 5,
    select: { id: true, leadCode: true, phone: true, sourceWebsite: true, contactedAt: true },
  });

  const sampleDiffs = [];
  for (let i = 0; i < sqliteSampleLeads.length; i++) {
    const s = sqliteSampleLeads[i];
    const p = pgSampleLeads[i];
    if (
      !p ||
      s.id !== p.id ||
      s.leadCode !== p.leadCode ||
      s.phone !== p.phone ||
      s.sourceWebsite !== p.sourceWebsite ||
      new Date(s.contactedAt).toISOString() !== new Date(p.contactedAt).toISOString()
    ) {
      sampleDiffs.push({ index: i, sqlite: s, postgres: p });
    }
  }

  const result = {
    ok: mismatches.length === 0 && sampleDiffs.length === 0,
    targetPostgresUrl: redactPgUrl(
      process.env.PG_DATABASE_URL ||
        'postgresql://postgres:***@127.0.0.1:55432/toantrung_v2_trial?schema=public',
    ),
    postgresServerInfo: pgInfo[0],
    totalSqliteRows: totalSqlite,
    totalPostgresRows: totalPostgres,
    mismatches,
    sampleDiffs,
    tableComparison,
    relationalChecks: {
      usersJoinedWithRoles: pgUsersWithRole.length,
      leadsJoinedWithAssignedSales: pgLeadsWithSales.length,
      leadProductsJoinedWithLeadAndProduct: pgLeadProductsWithJoin.length,
      marketingTrackingsJoinedWithLead: pgTrackingsWithLead.length,
      seoArticlesJoinedWithKeywordAndRevisions: pgArticlesWithKeyword.length,
      designRequestsJoinedWithAssetVersions: pgDesignsWithVersions.length,
    },
    sampleVerifiedLeads: pgSampleLeads,
  };

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

async function testPostgresOperationsAndBackupRestore(pgPrisma) {
  const sqliteBefore = getSqliteFileHash();

  // 1. Kiểm thử tạo bản ghi mới + bản ghi đính kèm + hoạt động trên PostgreSQL (kiểm tra sequence auto-increment hoạt động đúng)
  const firstUser = await pgPrisma.user.findFirst({ orderBy: { id: 'asc' } });
  const createdLead = await pgPrisma.lead.create({
    data: {
      leadCode: 'LD-PG-TRIAL-9999',
      phone: '0909888777',
      contactName: 'Khách hàng Kiểm thử PostgreSQL',
      companyName: 'Công ty Thử nghiệm PG18',
      projectName: 'Màn hình LED P2.5 Hội trường PG',
      contactChannel: 'form_web',
      sourceWebsite: 'toantrung.com.vn',
      createdByActorType: 'webhook',
      createdByActorRef: 'gmail_auto_sync',
      assignedSalesId: firstUser ? firstUser.id : null,
      contactedAt: new Date('2026-11-15T01:30:00.000Z'),
    },
  });

  const createdAttachment = await pgPrisma.leadAttachment.create({
    data: {
      leadId: createdLead.id,
      attachmentType: 'customer_drawing_doc',
      fileName: 'ban_ve_hoi_truong_pg.pdf',
      fileUrl: 'leads/pg_trial_ban_ve.pdf',
      fileSizeKb: 24,
      uploadedById: firstUser ? firstUser.id : 1,
    },
  });

  const createdActivity = await pgPrisma.leadActivity.create({
    data: {
      leadId: createdLead.id,
      actionType: 'add_note',
      note: 'Kiểm thử ghi chú & khóa ngoại trên PostgreSQL 18.6',
      actionById: firstUser ? firstUser.id : 1,
      actorType: 'user',
    },
  });

  // Kiểm tra đọc lại bản ghi vừa tạo kèm quan hệ
  const fetchedTrialLead = await pgPrisma.lead.findUnique({
    where: { id: createdLead.id },
    include: { attachments: true, activities: true },
  });

  // Xóa bản ghi thử nghiệm để giữ đúng số bản ghi gốc trước khi tạo bản sao lưu chuẩn
  await pgPrisma.leadActivity.delete({ where: { id: createdActivity.id } });
  await pgPrisma.leadAttachment.delete({ where: { id: createdAttachment.id } });
  await pgPrisma.lead.delete({ where: { id: createdLead.id } });

  // 2. Kiểm tra tính toàn vẹn tệp đính kèm vật lý trên ổ đĩa
  const designVersions = await pgPrisma.designAssetVersion.findMany({
    select: { id: true, storageObjectKey: true },
  });
  const storageRoot = path.resolve(process.cwd(), 'storage_independent_v2');
  let existingFilesCount = 0;
  for (const v of designVersions) {
    const absFile = path.join(storageRoot, v.storageObjectKey);
    if (fs.existsSync(absFile)) existingFilesCount++;
  }

  // 3. Chạy pg_dump sao lưu database `toantrung_v2_trial` và khôi phục sang `toantrung_v2_restore_check`
  const pgBin = 'C:\\Program Files\\PostgreSQL\\18\\bin';
  const backupFile = path.resolve(
    process.cwd(),
    'storage_independent_v2/backups/toantrung_v2_pg18_trial.sql',
  );
  fs.mkdirSync(path.dirname(backupFile), { recursive: true });

  execFileSync(
    path.join(pgBin, 'pg_dump.exe'),
    [
      '-h',
      '127.0.0.1',
      '-p',
      '55432',
      '-U',
      'postgres',
      '--clean',
      '--if-exists',
      '-f',
      backupFile,
      'toantrung_v2_trial',
    ],
    { stdio: 'pipe' },
  );

  execFileSync(
    path.join(pgBin, 'psql.exe'),
    ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', 'toantrung_v2_restore_check', '-f', backupFile],
    { stdio: 'pipe' },
  );

  // Kết nối vào database vừa khôi phục `toantrung_v2_restore_check` để đếm đối chứng
  const { PrismaClient: PgPrismaClient } = require(
    path.resolve(process.cwd(), 'packages/database/generated/postgres-client'),
  );
  const restoredPrisma = new PgPrismaClient({
    datasources: {
      db: { url: 'postgresql://postgres@127.0.0.1:55432/toantrung_v2_trial?schema=public'.replace('toantrung_v2_trial', 'toantrung_v2_restore_check') },
    },
  });

  let restoredTotalRows = 0;
  const restoredCounts = {};
  try {
    for (const model of ORDERED_MODELS) {
      if (!restoredPrisma[model]) continue;
      const c = await restoredPrisma[model].count();
      restoredCounts[model] = c;
      restoredTotalRows += c;
    }
  } finally {
    await restoredPrisma.$disconnect();
  }

  const sqliteAfter = getSqliteFileHash();

  console.log(
    JSON.stringify(
      {
        ok: true,
        crudAndSequenceCheck: {
          createdLeadId: createdLead.id,
          leadCode: fetchedTrialLead.leadCode,
          phonePreservedLeadingZero: fetchedTrialLead.phone === '0909888777',
          attachmentsLinkedCount: fetchedTrialLead.attachments.length,
          activitiesLinkedCount: fetchedTrialLead.activities.length,
          cleanedUpAfterTest: true,
        },
        attachmentStorageCheck: {
          storageRoot,
          designAssetRecordsInPg: designVersions.length,
          verifiedFilesOnDisk: existingFilesCount,
        },
        backupAndRestoreCheck: {
          backupFile,
          backupFileSizeBytes: fs.statSync(backupFile).size,
          restoredDatabase: 'postgresql://postgres:***@127.0.0.1:55432/toantrung_v2_restore_check',
          restoredTotalRows,
          restoredCounts,
        },
        sqliteSourceProtection: {
          sqlitePath: sqliteAfter?.path,
          sha256Before: sqliteBefore?.sha256,
          sha256After: sqliteAfter?.sha256,
          unchanged: sqliteBefore?.sha256 === sqliteAfter?.sha256,
        },
      },
      null,
      2,
    ),
  );
}

async function main() {
  const args = process.argv.slice(2);
  const sqlitePrisma = new SqlitePrismaClient();
  let pgPrisma = null;
  try {
    if (args.includes('--export-json')) {
      const idx = args.indexOf('--export-json');
      const outPath = args[idx + 1] || 'storage_independent_v2/backups/sqlite_snapshot.json';
      await exportSnapshot(sqlitePrisma, path.resolve(process.cwd(), outPath));
    } else if (args.includes('--import-pg')) {
      const idx = args.indexOf('--import-pg');
      const inPath = args[idx + 1] || 'storage_independent_v2/backups/sqlite_snapshot.json';
      pgPrisma = createPgPrismaClient();
      await importSnapshotToPostgres(pgPrisma, path.resolve(process.cwd(), inPath));
    } else if (args.includes('--verify-pg')) {
      pgPrisma = createPgPrismaClient();
      await verifySqliteAgainstRealPostgres(sqlitePrisma, pgPrisma);
    } else if (args.includes('--test-pg-ops')) {
      pgPrisma = createPgPrismaClient();
      await testPostgresOperationsAndBackupRestore(pgPrisma);
    } else {
      await runInventory(sqlitePrisma);
    }
  } finally {
    await sqlitePrisma.$disconnect();
    if (pgPrisma) await pgPrisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
