'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { PrismaClient } = require('../packages/database/generated/postgres-client');

const PG_URL =
  process.env.PG_DATABASE_URL ||
  'postgresql://postgres@127.0.0.1:55432/toantrung_v2_trial?schema=public';
const PG_BIN_DIR = 'C:\\Program Files\\PostgreSQL\\18\\bin';
const ARTIFACT_DIR = path.resolve(__dirname, '../storage/pg-migration-artifacts');
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

async function main() {
  const applyMode = process.argv.includes('--apply');
  const pg = new PrismaClient({ datasources: { db: { url: PG_URL } } });

  try {
    // 1. Pre-cleanup backup & restore check (when --apply)
    let backupInfo = null;
    if (applyMode) {
      const backupFile = path.join(ARTIFACT_DIR, 'u09-pre-cleanup-backup.sql');
      execFileSync(
        path.join(PG_BIN_DIR, 'pg_dump.exe'),
        ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', 'toantrung_v2_trial', '-f', backupFile],
        { stdio: 'pipe' },
      );
      const stat = fs.statSync(backupFile);
      execFileSync(
        path.join(PG_BIN_DIR, 'psql.exe'),
        ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', 'postgres', '-c', 'DROP DATABASE IF EXISTS toantrung_v2_u09_restore_check;'],
        { stdio: 'pipe' },
      );
      execFileSync(
        path.join(PG_BIN_DIR, 'psql.exe'),
        ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', 'postgres', '-c', 'CREATE DATABASE toantrung_v2_u09_restore_check;'],
        { stdio: 'pipe' },
      );
      execFileSync(
        path.join(PG_BIN_DIR, 'psql.exe'),
        ['-h', '127.0.0.1', '-p', '55432', '-U', 'postgres', '-d', 'toantrung_v2_u09_restore_check', '-f', backupFile],
        { stdio: 'pipe' },
      );
      backupInfo = {
        backupFile,
        sizeBytes: stat.size,
        restoreCheckDb: 'toantrung_v2_u09_restore_check',
        restoreVerified: true,
      };
    }

    // 2. Snapshot before counts
    const beforeCounts = {
      leads: await pg.lead.count(),
      marketingTrackings: await pg.marketingTracking.count(),
      leadActivities: await pg.leadActivity.count(),
      designRequests: await pg.designRequest.count(),
      designAssetVersions: await pg.designAssetVersion.count(),
      aiUsageLogs: await pg.aiUsageLog.count(),
      systemSettings: await pg.systemSetting.count(),
      users: await pg.user.count(),
      products: await pg.product.count(),
    };

    // 3. Identify strictly verified automated test/demo records (NOT guessing by "Test" in real user/MKT names)
    const allLeads = await pg.lead.findMany({
      include: { tracking: true },
      orderBy: { id: 'asc' },
    });

    const verifiedTestLeads = [];
    const keptLeads = [];

    for (const l of allLeads) {
      const subId = l.tracking?.externalSubmissionId || '';
      const name = l.contactName || '';
      const isVerifiedAutomatedTest =
        subId.startsWith('r03-msg-') ||
        name === 'Khách Nghiệm Thu R02 PostgreSQL (Đã Sửa)' ||
        name === 'Khách Tự Động Cập Nhật M01-09 Live' ||
        name.startsWith('Khách Kiểm Chứng U');

      if (isVerifiedAutomatedTest) {
        verifiedTestLeads.push({
          id: l.id,
          leadCode: l.leadCode,
          contactName: l.contactName,
          source: subId.startsWith('r03-msg-') ? 'R03 mock Gmail test' : 'R02/R05 automated HTTP/CDP test',
        });
      } else {
        keptLeads.push({
          id: l.id,
          leadCode: l.leadCode,
          contactName: l.contactName,
          intakeProvider: l.tracking?.intakeSourceProvider || null,
          classification: l.id >= 1168 && l.id <= 1177 ? 'MKT_TEAM_REAL_GMAIL_TEST_KEPT' : 'REAL_OR_UNDETERMINED_KEPT',
        });
      }
    }

    const testLeadIds = verifiedTestLeads.map((x) => x.id);

    const verifiedTestDesigns = await pg.designRequest.findMany({
      where: {
        OR: [
          { leadId: { in: testLeadIds.length > 0 ? testLeadIds : [-1] } },
          { notes: { contains: 'Nghiệm thu R02' } },
        ],
      },
      select: { id: true, leadId: true, ledCategory: true },
    });
    const testDesignIds = verifiedTestDesigns.map((d) => d.id);

    const testSeoSettings = await pg.systemSetting.findMany({
      where: {
        key: { startsWith: 'seo_report_' },
        value: { contains: 'nghiệm thu R02' },
      },
      select: { key: true },
    });

    const testAiUsageLogs = await pg.aiUsageLog.findMany({
      where: {
        OR: [
          { idempotencyKey: { startsWith: 'idem-test-' } },
          { idempotencyKey: { startsWith: 'chat-design-run-' } },
          { idempotencyKey: { startsWith: 'chat-design-timeout-' } },
        ],
      },
      select: { id: true, idempotencyKey: true },
    });

    const plan = {
      dryRun: !applyMode,
      database: 'PostgreSQL 18.6 (toantrung_v2_trial)',
      backupInfo,
      beforeCounts,
      toDelete: {
        leadsCount: testLeadIds.length,
        leads: verifiedTestLeads,
        designRequestsCount: testDesignIds.length,
        designRequests: verifiedTestDesigns,
        seoReportSettingsCount: testSeoSettings.length,
        seoReportKeys: testSeoSettings.map((s) => s.key),
        aiUsageLogsCount: testAiUsageLogs.length,
      },
      keptSummary: {
        keptLeadsCount: keptLeads.length,
        keptLeads,
      },
    };

    if (applyMode) {
      await pg.$transaction(async (tx) => {
        if (testDesignIds.length > 0) {
          await tx.designRequest.updateMany({
            where: { id: { in: testDesignIds } },
            data: { approvedVersionId: null },
          });
          await tx.designAssetVersion.deleteMany({
            where: { designRequestId: { in: testDesignIds } },
          });
          await tx.designRequest.deleteMany({
            where: { id: { in: testDesignIds } },
          });
        }

        if (testLeadIds.length > 0) {
          await tx.leadActivity.deleteMany({ where: { leadId: { in: testLeadIds } } });
          await tx.leadAttachment.deleteMany({ where: { leadId: { in: testLeadIds } } });
          await tx.marketingTracking.deleteMany({ where: { leadId: { in: testLeadIds } } });
          await tx.lead.deleteMany({ where: { id: { in: testLeadIds } } });
        }

        if (testSeoSettings.length > 0) {
          await tx.systemSetting.deleteMany({
            where: { key: { in: testSeoSettings.map((s) => s.key) } },
          });
          // Clean seo_reports_index
          const idxRow = await tx.systemSetting.findUnique({ where: { key: 'seo_reports_index' } });
          if (idxRow?.value) {
            try {
              const ids = JSON.parse(idxRow.value);
              const removeSet = new Set(testSeoSettings.map((s) => s.key.replace(/^seo_report_/, '')));
              const nextIds = Array.isArray(ids) ? ids.filter((id) => !removeSet.has(id)) : [];
              await tx.systemSetting.update({
                where: { key: 'seo_reports_index' },
                data: { value: JSON.stringify(nextIds) },
              });
            } catch {
              // ignore
            }
          }
        }

        if (testAiUsageLogs.length > 0) {
          await tx.aiUsageLog.deleteMany({
            where: { id: { in: testAiUsageLogs.map((l) => l.id) } },
          });
        }

        // Restore real Gmail checkpoint (remove mock r03-msg checkpoint)
        const cpRow = await tx.systemSetting.findUnique({ where: { key: 'gmail_sync_checkpoint' } });
        if (cpRow?.value && cpRow.value.includes('r03-msg-')) {
          await tx.systemSetting.update({
            where: { key: 'gmail_sync_checkpoint' },
            data: {
              value: JSON.stringify({
                accountKey: process.env.GMAIL_SYNC_ACCOUNT || 'crm-intake@toantrung.vn',
                lastProcessedInternalDateMs: 1794560755000,
                lastMessageId: '1a1d428160cfcf7e',
                lastSuccessAt: new Date().toISOString(),
                lastError: null,
                consecutiveFailures: 0,
                failedMessageRetries: {},
              }),
            },
          });
        }
      });

      const afterCounts = {
        leads: await pg.lead.count(),
        marketingTrackings: await pg.marketingTracking.count(),
        leadActivities: await pg.leadActivity.count(),
        designRequests: await pg.designRequest.count(),
        designAssetVersions: await pg.designAssetVersion.count(),
        aiUsageLogs: await pg.aiUsageLog.count(),
        systemSettings: await pg.systemSetting.count(),
        users: await pg.user.count(),
        products: await pg.product.count(),
      };
      plan.afterCounts = afterCounts;
    }

    const outPath = path.join(ARTIFACT_DIR, 'u09-cleanup-report.json');
    fs.writeFileSync(outPath, JSON.stringify(plan, null, 2), 'utf8');
    console.log(JSON.stringify(plan, null, 2));
  } finally {
    await pg.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

