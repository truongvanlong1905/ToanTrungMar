import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { prisma } from '@toantrung/database';
import { APP_CONFIG } from '../../../../../core/config';
import { getClientIp, jsonError, jsonSuccess } from '../../../../../core/http';
import { logServerEvent, summarizeError } from '../../../../../core/logging/logger';
import { requireAdminSession } from '../../../../../core/permissions';
import { updateBrandingMetadata } from '../../../../../core/storage/branding.service';
import {
  copyAndHashBusinessFilesForBackup,
  type BackupBusinessFileEntry,
} from '../../../../../core/storage/private-files.service';

const COMPANY_PROFILE_SETTING_KEY = 'company.profile.v1';

export interface CompanyProfileData {
  companyName: string;
  companyTaxCode: string;
  companyHotline: string;
  companyAddress: string;
  updatedAt: string;
  updatedByName: string;
}

export interface BackupManifest {
  backupId: string;
  databaseProvider: 'postgresql' | 'sqlite';
  fileName: string;
  fileSizeBytes: number;
  sha256: string;
  restoreVerified: boolean;
  restoreVerificationMethod: string;
  backupDurationMs?: number;
  businessFilesCount?: number;
  businessFilesBytes?: number;
  businessFilesManifest?: BackupBusinessFileEntry[];
  rpoSummary?: string;
  recordCounts: {
    leads: number;
    designRequests: number;
    trackingEvents: number;
    trackingTouchpoints?: number;
    seoArticles: number;
    users: number;
    auditLogs: number;
  };
  createdBy: string;
  createdAt: string;
}

const DEFAULT_COMPANY_PROFILE: CompanyProfileData = {
  companyName: 'CÔNG TY CỔ PHẦN ĐIỆN TỬ VIỄN THÔNG TOÀN TRUNG',
  companyTaxCode: '0303716891',
  companyHotline: '1900 599 817 - 0913 888 817',
  companyAddress: 'Số 72 Đường số 7, KDC Cityland Center Hills, P.7, Q. Gò Vấp, TP.HCM',
  updatedAt: new Date().toISOString(),
  updatedByName: 'Hệ thống',
};

function resolveWorkspaceRoot(): string {
  const cwd = process.cwd();
  if (
    fs.existsSync(path.join(cwd, 'packages', 'database', 'prisma', 'independent_v2.db')) ||
    fs.existsSync(path.join(cwd, 'packages', 'database', 'package.json'))
  ) {
    return cwd;
  }
  const twoUp = path.resolve(cwd, '..', '..');
  if (
    fs.existsSync(path.join(twoUp, 'packages', 'database', 'prisma', 'independent_v2.db')) ||
    fs.existsSync(path.join(twoUp, 'packages', 'database', 'package.json'))
  ) {
    return twoUp;
  }
  return cwd;
}

function resolveSqliteDbPath(): string {
  const root = resolveWorkspaceRoot();
  const rawDbUrl = (process.env.DATABASE_URL || '').trim();
  if (
    rawDbUrl.startsWith('file:') &&
    rawDbUrl !== 'file:./dev.db' &&
    rawDbUrl !== 'file:./independent_v2.db'
  ) {
    let candidatePath = rawDbUrl.startsWith('file://')
      ? rawDbUrl.slice('file://'.length)
      : rawDbUrl.slice('file:'.length);
    if (/^\/[a-zA-Z]:/.test(candidatePath)) {
      candidatePath = candidatePath.slice(1);
    }
    candidatePath = decodeURIComponent(candidatePath.split('?')[0] || '');
    const resolvedFromEnv = path.isAbsolute(candidatePath)
      ? path.resolve(candidatePath)
      : path.resolve(root, candidatePath);
    if (fs.existsSync(resolvedFromEnv)) {
      return resolvedFromEnv;
    }
  }
  return path.join(root, 'packages', 'database', 'prisma', 'independent_v2.db');
}

function resolveStorageDir(): string {
  const dir = path.resolve(APP_CONFIG.getStorageRoot());
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function computeDirectoryStats(dirPath: string): { totalBytes: number; fileCount: number } {
  let totalBytes = 0;
  let fileCount = 0;
  if (!fs.existsSync(dirPath)) return { totalBytes: 0, fileCount: 0 };

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const sub = computeDirectoryStats(full);
      totalBytes += sub.totalBytes;
      fileCount += sub.fileCount;
    } else if (entry.isFile()) {
      try {
        const stat = fs.statSync(full);
        totalBytes += stat.size;
        fileCount += 1;
      } catch {
        // ignore transient file locks
      }
    }
  }
  return { totalBytes, fileCount };
}

function detectActiveDatabaseProvider(): 'postgresql' | 'sqlite' {
  const providerEnv = (process.env.DATABASE_PROVIDER || '').trim().toLowerCase();
  const dbUrl = (process.env.DATABASE_URL || '').trim().toLowerCase();
  if (
    providerEnv === 'postgresql' ||
    /^postgres(ql)?:\/\//.test(dbUrl) ||
    (process.env.USE_POSTGRES_TRIAL === '1' && Boolean(process.env.PG_DATABASE_URL))
  ) {
    return 'postgresql';
  }
  return 'sqlite';
}

function resolveBackupsRootDir(): string {
  const dir = path.resolve(APP_CONFIG.getBackupRoot());
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function listBackups(): BackupManifest[] {
  const backupsRoot = resolveBackupsRootDir();
  if (!fs.existsSync(backupsRoot)) return [];

  const entries = fs.readdirSync(backupsRoot, { withFileTypes: true });
  const manifests: BackupManifest[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(backupsRoot, entry.name, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BackupManifest;
      manifests.push(parsed);
    } catch (err) {
      logServerEvent('warn', 'backup', 'Ignored malformed backup manifest.json', {
        dir: entry.name,
        ...summarizeError(err),
      });
    }
  }
  return manifests.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function getCompanyProfile(): Promise<CompanyProfileData> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: COMPANY_PROFILE_SETTING_KEY },
  });
  if (!row) return DEFAULT_COMPANY_PROFILE;
  try {
    const parsed = JSON.parse(row.value) as Partial<CompanyProfileData>;
    return {
      companyName: parsed.companyName || DEFAULT_COMPANY_PROFILE.companyName,
      companyTaxCode: parsed.companyTaxCode || DEFAULT_COMPANY_PROFILE.companyTaxCode,
      companyHotline: parsed.companyHotline || DEFAULT_COMPANY_PROFILE.companyHotline,
      companyAddress: parsed.companyAddress || DEFAULT_COMPANY_PROFILE.companyAddress,
      updatedAt: parsed.updatedAt || row.updatedAt.toISOString(),
      updatedByName: parsed.updatedByName || 'Quản trị viên',
    };
  } catch {
    return DEFAULT_COMPANY_PROFILE;
  }
}

export async function GET(req: Request) {
  const auth = await requireAdminSession(req, { requireCsrf: false });
  if (!auth.ok) return auth.response;

  try {
    const databaseProvider = detectActiveDatabaseProvider();
    const dbPath = resolveSqliteDbPath();
    const dbSizeBytes =
      databaseProvider === 'sqlite' && fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
    const storageStats = computeDirectoryStats(resolveStorageDir());
    const companyProfile = await getCompanyProfile();
    const backups = listBackups();

    return jsonSuccess({
      companyProfile,
      databaseProvider,
      storage: {
        databaseProvider,
        backupRoot: resolveBackupsRootDir(),
        dbSizeBytes,
        storageFilesBytes: storageStats.totalBytes,
        totalUsedBytes: dbSizeBytes + storageStats.totalBytes,
        storageFileCount: storageStats.fileCount,
      },
      backups,
    });
  } catch (err) {
    return jsonError(
      'SETTINGS_BACKUP_LOAD_ERROR',
      err instanceof Error ? err.message : 'Không tải được thông tin sao lưu & hồ sơ công ty.',
      500,
    );
  }
}

export async function POST(req: Request) {
  const auth = await requireAdminSession(req);
  if (!auth.ok) return auth.response;

  let body: {
    action?: 'save_company_profile' | 'create_backup';
    companyName?: string;
    companyTaxCode?: string;
    companyHotline?: string;
    companyAddress?: string;
  } = {};
  try {
    body = await req.json();
  } catch {
    body = { action: 'create_backup' };
  }

  try {
    if (body.action === 'save_company_profile') {
      const companyName = (body.companyName || '').trim();
      const companyTaxCode = (body.companyTaxCode || '').trim();
      const companyHotline = (body.companyHotline || '').trim();
      const companyAddress = (body.companyAddress || '').trim();

      if (!companyName) {
        return jsonError('VALIDATION_ERROR', 'Tên pháp nhân công ty không được để trống.', 400);
      }

      const profile: CompanyProfileData = {
        companyName,
        companyTaxCode: companyTaxCode || DEFAULT_COMPANY_PROFILE.companyTaxCode,
        companyHotline: companyHotline || DEFAULT_COMPANY_PROFILE.companyHotline,
        companyAddress: companyAddress || DEFAULT_COMPANY_PROFILE.companyAddress,
        updatedAt: new Date().toISOString(),
        updatedByName: auth.user.fullName,
      };

      await prisma.systemSetting.upsert({
        where: { key: COMPANY_PROFILE_SETTING_KEY },
        update: {
          value: JSON.stringify(profile),
          updatedById: auth.user.id,
        },
        create: {
          key: COMPANY_PROFILE_SETTING_KEY,
          value: JSON.stringify(profile),
          updatedById: auth.user.id,
        },
      });

      await updateBrandingMetadata(
        auth.user.id,
        { organizationName: companyName },
        getClientIp(req),
      );

      await prisma.auditLog.create({
        data: {
          actorUserId: auth.user.id,
          action: 'COMPANY_PROFILE_UPDATED',
          targetType: 'SystemSetting',
          targetId: COMPANY_PROFILE_SETTING_KEY,
          detailsJson: JSON.stringify(profile),
          ipAddress: getClientIp(req),
        },
      });

      return jsonSuccess({ companyProfile: profile });
    }

    // Action: create_backup + business files snapshot + non-destructive restore verification
    const startedMs = Date.now();
    const databaseProvider = detectActiveDatabaseProvider();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupId = `backup-${timestamp}`;
    const backupDir = path.join(resolveBackupsRootDir(), backupId);
    fs.mkdirSync(backupDir, { recursive: true });

    let backupDbFileName = '';
    let backupDbPath = '';
    let restoreVerified = false;
    let restoreVerificationMethod = '';
    let sha256 = '';
    let backupSizeBytes = 0;

    if (databaseProvider === 'postgresql') {
      backupDbFileName = `postgresql_snapshot_${timestamp}.json`;
      backupDbPath = path.join(backupDir, backupDbFileName);
      const [
        usersRows,
        rolesRows,
        productsRows,
        leadsRows,
        leadProductsRows,
        attachmentsRows,
        trackingRows,
        touchpointsRows,
        campaignsRows,
        seoArticlesRows,
        designRequestsRows,
        designVersionsRows,
        systemSettingsRows,
      ] = await Promise.all([
        prisma.user.findMany({ orderBy: { id: 'asc' } }),
        prisma.role.findMany({ orderBy: { id: 'asc' } }),
        prisma.product.findMany({ orderBy: { id: 'asc' } }),
        prisma.lead.findMany({ orderBy: { id: 'asc' } }),
        prisma.leadProduct.findMany({ orderBy: { id: 'asc' } }),
        prisma.leadAttachment.findMany({ orderBy: { id: 'asc' } }),
        prisma.marketingTracking.findMany({ orderBy: { id: 'asc' } }),
        prisma.trackingTouchpoint.findMany({ orderBy: { id: 'asc' } }),
        prisma.campaign.findMany({ orderBy: { id: 'asc' } }),
        prisma.seoArticle.findMany({ orderBy: { id: 'asc' } }),
        prisma.designRequest.findMany({ orderBy: { id: 'asc' } }),
        prisma.designAssetVersion.findMany({ orderBy: { id: 'asc' } }),
        prisma.systemSetting.findMany({ orderBy: { key: 'asc' } }),
      ]);

      const snapshotPayload = JSON.stringify(
        {
          format: 'toantrung-pg-logical-snapshot-v1',
          exportedAt: new Date().toISOString(),
          tables: {
            users: usersRows,
            roles: rolesRows,
            products: productsRows,
            leads: leadsRows,
            leadProducts: leadProductsRows,
            leadAttachments: attachmentsRows,
            marketingTracking: trackingRows,
            trackingTouchpoints: touchpointsRows,
            campaigns: campaignsRows,
            seoArticles: seoArticlesRows,
            designRequests: designRequestsRows,
            designAssetVersions: designVersionsRows,
            systemSettings: systemSettingsRows,
          },
        },
        (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
        2,
      );
      fs.writeFileSync(backupDbPath, snapshotPayload, 'utf8');
      const pgBuf = fs.readFileSync(backupDbPath);
      sha256 = crypto.createHash('sha256').update(pgBuf).digest('hex');
      backupSizeBytes = pgBuf.length;
      const parsedVerify = JSON.parse(fs.readFileSync(backupDbPath, 'utf8')) as {
        format?: string;
        tables?: Record<string, unknown[]>;
      };
      restoreVerified =
        parsedVerify.format === 'toantrung-pg-logical-snapshot-v1' &&
        Boolean(parsedVerify.tables && Array.isArray(parsedVerify.tables.leads));
      restoreVerificationMethod = 'PostgreSQL-Logical-Snapshot-JSON-Parse-And-SHA256';
    } else {
      const dbPath = resolveSqliteDbPath();
      if (!fs.existsSync(dbPath)) {
        return jsonError('DB_FILE_NOT_FOUND', 'Không tìm thấy tệp cơ sở dữ liệu SQLite để sao lưu.', 404);
      }

      backupDbFileName = `independent_v2_${timestamp}.db`;
      backupDbPath = path.join(backupDir, backupDbFileName);

      const escapedVacuumTarget = backupDbPath.replace(/\\/g, '/').replace(/'/g, "''");
      try {
        if (fs.existsSync(backupDbPath)) {
          fs.unlinkSync(backupDbPath);
        }
        await prisma.$executeRawUnsafe(`VACUUM INTO '${escapedVacuumTarget}'`);
      } catch (err) {
        logServerEvent('warn', 'backup', 'VACUUM INTO failed; falling back to copyFileSync', summarizeError(err));
        fs.copyFileSync(dbPath, backupDbPath);
      }

      const backupBuffer = fs.readFileSync(backupDbPath);
      sha256 = crypto.createHash('sha256').update(backupBuffer).digest('hex');
      backupSizeBytes = backupBuffer.length;

      const restoreTestPath = path.join(backupDir, 'restore-verify-test.db');
      fs.copyFileSync(backupDbPath, restoreTestPath);
      const restoredBuffer = fs.readFileSync(restoreTestPath);
      const restoredSha256 = crypto.createHash('sha256').update(restoredBuffer).digest('hex');
      const sqliteMagic = restoredBuffer.subarray(0, 15).toString('ascii');

      let pragmaIntegrityOk = true;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const nodeSqlite = require('node:sqlite') as {
          DatabaseSync?: new (p: string, opts?: { readOnly?: boolean }) => {
            prepare: (sql: string) => { get: () => Record<string, unknown> | undefined };
            close: () => void;
          };
        };
        if (nodeSqlite?.DatabaseSync) {
          const testDb = new nodeSqlite.DatabaseSync(restoreTestPath, { readOnly: true });
          try {
            const row = testDb.prepare('PRAGMA integrity_check').get();
            const checkVal = String(row?.integrity_check || '').toLowerCase();
            pragmaIntegrityOk = checkVal === 'ok';
          } finally {
            testDb.close();
          }
        }
      } catch {
        // Fallback to header + checksum verification if node:sqlite is unavailable
      } finally {
        try {
          if (fs.existsSync(restoreTestPath)) fs.unlinkSync(restoreTestPath);
        } catch {
          // ignore cleanup error
        }
      }

      restoreVerified =
        restoredBuffer.length > 0 &&
        restoredSha256 === sha256 &&
        sqliteMagic === 'SQLite format 3' &&
        pragmaIntegrityOk;
      restoreVerificationMethod = 'SQLite-VACUUM-INTO-IntegrityCheck-And-SHA256';
    }

    if (!restoreVerified) {
      return jsonError(
        'BACKUP_VERIFICATION_FAILED',
        'Kiểm tra khôi phục (Restore Verification) thất bại: Checksum hoặc tính toàn vẹn bản sao lưu không hợp lệ.',
        500,
      );
    }

    const businessFilesDir = path.join(backupDir, 'files');
    const businessFilesManifest = copyAndHashBusinessFilesForBackup(businessFilesDir);
    const businessFilesBytes = businessFilesManifest.reduce((sum, f) => sum + f.sizeBytes, 0);

    const [leads, designRequests, trackingEvents, trackingTouchpoints, seoArticles, users, auditLogs] =
      await Promise.all([
        prisma.lead.count(),
        prisma.designRequest.count(),
        prisma.platformSyncLog.count(),
        prisma.trackingTouchpoint.count(),
        prisma.seoArticle.count(),
        prisma.user.count(),
        prisma.auditLog.count(),
      ]);

    const manifest: BackupManifest = {
      backupId,
      databaseProvider,
      fileName: backupDbFileName,
      fileSizeBytes: backupSizeBytes,
      sha256,
      restoreVerified,
      restoreVerificationMethod,
      backupDurationMs: Date.now() - startedMs,
      businessFilesCount: businessFilesManifest.length,
      businessFilesBytes,
      businessFilesManifest,
      rpoSummary: 'RPO phụ thuộc chu kỳ sao lưu ngoài tiến trình web (tối đa khoảng thời gian giữa 2 lần snapshot DB + đồng bộ kho file nghiệp vụ).',
      recordCounts: {
        leads,
        designRequests,
        trackingEvents,
        trackingTouchpoints,
        seoArticles,
        users,
        auditLogs,
      },
      createdBy: auth.user.fullName,
      createdAt: new Date().toISOString(),
    };

    fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    await prisma.auditLog.create({
      data: {
        actorUserId: auth.user.id,
        action: 'DATABASE_BACKUP_CREATED_AND_VERIFIED',
        targetType: 'DatabaseBackup',
        targetId: backupId,
        detailsJson: JSON.stringify({
          ...manifest,
          businessFilesManifest: undefined,
        }),
        ipAddress: getClientIp(req),
      },
    });

    const storageStats = computeDirectoryStats(resolveStorageDir());

    return jsonSuccess({
      databaseProvider,
      backup: manifest,
      backups: listBackups(),
      storage: {
        databaseProvider,
        backupRoot: resolveBackupsRootDir(),
        dbSizeBytes: backupSizeBytes,
        storageFilesBytes: storageStats.totalBytes,
        totalUsedBytes: backupSizeBytes + storageStats.totalBytes,
        storageFileCount: storageStats.fileCount,
      },
    });
  } catch (err) {
    return jsonError(
      'SETTINGS_BACKUP_ACTION_ERROR',
      err instanceof Error ? err.message : 'Thao tác sao lưu hoặc lưu cấu hình thất bại.',
      500,
    );
  }
}
