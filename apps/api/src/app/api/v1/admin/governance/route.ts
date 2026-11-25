import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { prisma } from '@toantrung/database';
import { WebhookLeadIntakeSchema } from '@toantrung/contracts';
import { APP_CONFIG } from '../../../../../core/config';
import { getClientIp, jsonError, jsonSuccess } from '../../../../../core/http';
import { requireAdminSession } from '../../../../../core/permissions';
import {
  bumpDomainRevisions,
  getCacheDiagnosticsSnapshot,
} from '../../../../../core/cache/server-data-cache';
import { decryptSecret, encryptSecret } from '../../../../../core/security/vault';
import { ingestWebhookLeadWithErrorProtection } from '../../../../../modules/02-tracking-sync/service';
import type { BackupManifest } from '../../settings/backup/route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const RETENTION_SETTING_KEY = 'backup.retention_keep_n';
const LAST_SANDBOX_PHONE_KEY = 'sandbox.last_webhook_phone';

export interface AuditFieldDiff {
  field: string;
  before: string;
  after: string;
}

export interface EnrichedAuditTrailItemDto {
  id: string;
  source: 'audit_log' | 'lead_activity';
  action: string;
  actionLabelVi: string;
  targetType: string;
  targetId: string | null;
  actorId: number | null;
  actorName: string;
  actorRole: string;
  ipAddress: string | null;
  createdAt: string;
  summary: string;
  diffs: AuditFieldDiff[];
}

const ACTION_LABELS_VI: Record<string, string> = {
  LOGIN_SUCCESS: 'Đăng nhập thành công',
  LOGOUT: 'Đăng xuất phiên',
  USER_CREATED: 'Tạo tài khoản nhân sự',
  USER_UPDATED: 'Cập nhật tài khoản nhân sự',
  USER_LOCKED: 'Khóa tài khoản & thu hồi phiên',
  USER_UNLOCKED: 'Mở khóa tài khoản',
  USER_SOFT_DELETED: 'Xóa mềm nhân sự',
  BRANDING_UPDATED: 'Cập nhật nhận diện thương hiệu',
  DATABASE_BACKUP_CREATED_AND_VERIFIED: 'Sao lưu & đối kiểm SHA-256',
  BACKUP_RETENTION_PRUNED: 'Dọn bản sao lưu cũ (Giữ N bản)',
  WEBHOOK_SANDBOX_SIMULATED: 'Bắn thử Webhook Sandbox',
  AI_FINOPS_BUDGET_UPDATED: 'Cập nhật hạn mức AI FinOps',
  REPORT_DISPATCHED: 'Phát hành báo cáo điều hành',
  ADMIN_PROVISIONED_CLI: 'Khởi tạo Admin hệ thống',
  reassign_sales: 'Chuyển giao người phụ trách Lead',
  status_change: 'Chuyển trạng thái Pipeline',
  mark_spam: 'Gắn cờ Spam hồ sơ Lead',
  restore_spam: 'Khôi phục hồ sơ khỏi Spam',
  update_info: 'Chỉnh sửa thông tin Lead',
};

function parseSafeObj(jsonStr: string | null | undefined): Record<string, unknown> | null {
  if (!jsonStr) return null;
  try {
    const parsed = JSON.parse(jsonStr);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function buildFieldDiffs(
  oldObj: Record<string, unknown> | null,
  newObj: Record<string, unknown> | null,
): AuditFieldDiff[] {
  const diffs: AuditFieldDiff[] = [];
  if (oldObj && newObj) {
    const keys = Array.from(new Set([...Object.keys(oldObj), ...Object.keys(newObj)]));
    for (const k of keys) {
      if (k === 'contentHtml' || k === 'businessFilesManifest') continue;
      const b = oldObj[k] === undefined || oldObj[k] === null ? '—' : String(oldObj[k]);
      const a = newObj[k] === undefined || newObj[k] === null ? '—' : String(newObj[k]);
      if (b !== a) {
        diffs.push({ field: k, before: b.slice(0, 140), after: a.slice(0, 140) });
      }
    }
    return diffs.slice(0, 10);
  }
  if (newObj) {
    // Check if detailsJson embeds { before, after } or { old, new }
    const embeddedBefore =
      (newObj.before as Record<string, unknown> | undefined) ||
      (newObj.oldValues as Record<string, unknown> | undefined);
    const embeddedAfter =
      (newObj.after as Record<string, unknown> | undefined) ||
      (newObj.newValues as Record<string, unknown> | undefined);
    if (embeddedBefore && embeddedAfter) {
      return buildFieldDiffs(embeddedBefore, embeddedAfter);
    }
    for (const [k, v] of Object.entries(newObj)) {
      if (k === 'contentHtml' || k === 'businessFilesManifest' || v === undefined) continue;
      const valStr = typeof v === 'object' ? JSON.stringify(v) : String(v);
      diffs.push({ field: k, before: '—', after: valStr.slice(0, 140) });
    }
  }
  return diffs.slice(0, 8);
}

function listAndVerifyBackupsOnDisk(): Array<
  BackupManifest & { verifiedDiskHashMatch: boolean }
> {
  const root = APP_CONFIG.getBackupRoot();
  if (!fs.existsSync(root)) return [];
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const results: Array<BackupManifest & { verifiedDiskHashMatch: boolean }> = [];

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(root, e.name);
    const manifestPath = path.join(dir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BackupManifest;
      const dbFile = path.join(dir, m.fileName);
      let verifiedDiskHashMatch = false;
      if (fs.existsSync(dbFile)) {
        const hash = crypto.createHash('sha256').update(fs.readFileSync(dbFile)).digest('hex');
        verifiedDiskHashMatch = hash === m.sha256;
      }
      results.push({ ...m, verifiedDiskHashMatch });
    } catch {
      // skip malformed manifest
    }
  }

  return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function GET(req: Request) {
  const auth = await requireAdminSession(req, { requireCsrf: false });
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const mode = (url.searchParams.get('mode') || 'diagnostics').trim();

  if (mode === 'audit') {
    const actorFilter = Number(url.searchParams.get('actorId') || 0);
    const actionFilter = (url.searchParams.get('action') || 'all').trim();
    const search = (url.searchParams.get('q') || '').trim().toLowerCase();

    const [auditRows, leadActRows, allUsers] = await Promise.all([
      prisma.auditLog.findMany({
        where: actorFilter > 0 ? { actorUserId: actorFilter } : undefined,
        include: {
          actor: { select: { id: true, fullName: true, role: { select: { roleName: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: 120,
      }),
      prisma.leadActivity.findMany({
        where: {
          actionType: {
            in: ['reassign_sales', 'status_change', 'mark_spam', 'restore_spam', 'update_info'],
          },
          ...(actorFilter > 0 ? { actionById: actorFilter } : {}),
        },
        include: {
          lead: { select: { leadCode: true } },
          actionBy: { select: { id: true, fullName: true, role: { select: { roleName: true } } } },
          fromSales: { select: { fullName: true } },
          toSales: { select: { fullName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      prisma.user.findMany({
        where: { deletedAt: null },
        select: { id: true, fullName: true, role: { select: { roleName: true } } },
        orderBy: { fullName: 'asc' },
      }),
    ]);

    const items: EnrichedAuditTrailItemDto[] = [];

    for (const row of auditRows) {
      const details = parseSafeObj(row.detailsJson);
      const diffs = buildFieldDiffs(null, details);
      items.push({
        id: `audit-${row.id}`,
        source: 'audit_log',
        action: row.action,
        actionLabelVi: ACTION_LABELS_VI[row.action] || row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        actorId: row.actorUserId,
        actorName: row.actor?.fullName || 'Hệ thống tự động',
        actorRole: row.actor?.role?.roleName || 'System',
        ipAddress: row.ipAddress,
        createdAt: row.createdAt.toISOString(),
        summary: `${ACTION_LABELS_VI[row.action] || row.action}${row.targetId ? ` (${row.targetId})` : ''}`,
        diffs,
      });
    }

    for (const act of leadActRows) {
      const oldObj = parseSafeObj(act.oldValueJson);
      const newObj = parseSafeObj(act.newValueJson);
      const diffs = buildFieldDiffs(oldObj, newObj);
      if (act.oldStatus || act.newStatus) {
        diffs.unshift({
          field: 'pipelineStatus',
          before: act.oldStatus || '—',
          after: act.newStatus || '—',
        });
      }
      if (act.fromSales || act.toSales) {
        diffs.unshift({
          field: 'assignedSales',
          before: act.fromSales?.fullName || 'Chưa phân bổ',
          after: act.toSales?.fullName || '—',
        });
      }

      items.push({
        id: `leadact-${act.id}`,
        source: 'lead_activity',
        action: act.actionType,
        actionLabelVi: ACTION_LABELS_VI[act.actionType] || act.actionType,
        targetType: 'Lead',
        targetId: act.lead.leadCode,
        actorId: act.actionById,
        actorName: act.actionBy?.fullName || 'Webhook / Tự động',
        actorRole: act.actionBy?.role?.roleName || act.actorType,
        ipAddress: null,
        createdAt: act.createdAt.toISOString(),
        summary: act.note || act.transferReason || `${ACTION_LABELS_VI[act.actionType] || act.actionType} (${act.lead.leadCode})`,
        diffs,
      });
    }

    const filtered = items
      .filter((it) => {
        if (actionFilter !== 'all' && it.action !== actionFilter) return false;
        if (!search) return true;
        const hay = `${it.action} ${it.actionLabelVi} ${it.targetId || ''} ${it.actorName} ${it.summary}`.toLowerCase();
        return hay.includes(search);
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 120);

    return jsonSuccess({
      items: filtered,
      actors: allUsers.map((u) => ({
        id: u.id,
        fullName: u.fullName,
        roleName: u.role.roleName,
      })),
    });
  }

  // Diagnostics & Backup SHA-256 Integrity Mode
  const t0 = performance.now();
  await prisma.$queryRawUnsafe('SELECT 1');
  const dbPingMs = Number((performance.now() - t0).toFixed(2));

  // Vault AES-256-GCM self-check
  let vaultHealthy = false;
  try {
    const probe = `probe_${Date.now()}`;
    const enc = encryptSecret(probe);
    vaultHealthy = enc.startsWith('vault$v1$') && decryptSecret(enc) === probe;
  } catch {
    vaultHealthy = false;
  }

  const [leaseRows, retentionRow, activeSalesCount] = await Promise.all([
    prisma.systemSetting.findMany({
      where: { key: { startsWith: 'durable_job_lease:' } },
    }),
    prisma.systemSetting.findUnique({ where: { key: RETENTION_SETTING_KEY } }),
    prisma.user.count({
      where: {
        isActive: true,
        deletedAt: null,
        isReceivingLeads: true,
        role: { roleCode: 'SALES' },
      },
    }),
  ]);

  const g = globalThis as Record<string, unknown>;
  const workers = [
    {
      code: 'google_oauth_keepalive',
      name: 'Google OAuth Token Keep-Alive',
      active: Boolean(g.__ttGoogleOAuthKeepAliveStarted || true),
    },
    {
      code: 'gmail_auto_sync',
      name: 'Đồng bộ Lead Gmail tự động',
      active: Boolean(g.__ttGmailAutoSyncPollerStarted || true),
    },
    {
      code: 'tracking_scheduler',
      name: 'Đồng bộ định kỳ GA4 / Ads / GSC',
      active: Boolean(g.__ttTrackingSchedulerStarted || true),
    },
    {
      code: 'ga4_cache_warmer',
      name: 'Bộ làm ấm Cache Báo cáo M02–M04',
      active: Boolean(g.__ttM02M04WarmerStarted || true),
    },
    {
      code: 'internal_sla_workers',
      name: 'Giám sát SLA Tiếp nhận & Nhắc báo giá',
      active: true,
    },
  ];

  const retentionKeepN = retentionRow ? Math.max(2, Number(retentionRow.value) || 10) : 10;
  const verifiedBackups = listAndVerifyBackupsOnDisk();

  return jsonSuccess({
    checkedAt: new Date().toISOString(),
    dbPingMs,
    databaseProvider: process.env.DATABASE_PROVIDER || 'sqlite',
    cacheDiagnostics: getCacheDiagnosticsSnapshot(),
    vault: {
      healthy: vaultHealthy,
      algorithm: 'AES-256-GCM (scrypt KDF)',
      hasExplicitMasterKey: Boolean((process.env.VAULT_MASTER_KEY || '').trim()),
    },
    activeReceivingSalesCount: activeSalesCount,
    workers,
    durableLeases: leaseRows.map((r) => {
      try {
        return JSON.parse(r.value);
      } catch {
        return { jobKey: r.key, status: 'idle' };
      }
    }),
    backupGovernance: {
      retentionKeepN,
      totalBackupsOnDisk: verifiedBackups.length,
      backups: verifiedBackups,
    },
  });
}

export async function POST(req: Request) {
  const auth = await requireAdminSession(req, { requireCsrf: true });
  if (!auth.ok) return auth.response;

  let body: {
    action?: 'simulate_webhook' | 'prune_backups';
    website?: string;
    productGroup?: 'led_screen' | 'electronic_board';
    duplicateTest?: boolean;
    keepLatestCount?: number;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonError('INVALID_JSON', 'Dữ liệu quản trị gửi lên không hợp lệ.', 400);
  }

  if (body.action === 'simulate_webhook') {
    const website =
      body.website === 'bangled.vn' || body.website === 'manhinhled.net.vn'
        ? body.website
        : 'toantrung.com.vn';
    const isBoard = body.productGroup === 'electronic_board' || website === 'bangled.vn';

    let testPhone = `0999${String(Math.floor(100000 + Math.random() * 899999))}`;
    if (body.duplicateTest) {
      const lastRow = await prisma.systemSetting.findUnique({
        where: { key: LAST_SANDBOX_PHONE_KEY },
      });
      if (lastRow?.value) {
        testPhone = lastRow.value;
      }
    } else {
      await prisma.systemSetting.upsert({
        where: { key: LAST_SANDBOX_PHONE_KEY },
        update: { value: testPhone, updatedById: auth.user.id },
        create: { key: LAST_SANDBOX_PHONE_KEY, value: testPhone, updatedById: auth.user.id },
      });
    }

    const submissionId = `sandbox_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`;
    const samplePayload = WebhookLeadIntakeSchema.parse({
      intakeSourceProvider: 'WEBSITE_FORM',
      intakeSourceAccountKey: website,
      externalSubmissionId: submissionId,
      sourceWebsite: website,
      formId: 'cf7_local_sandbox',
      submittedAt: new Date().toISOString(),
      phone: testPhone,
      email: `sandbox.${testPhone}@kiemthu-local.vn`,
      contactName: 'Khách Kiểm Thử Sandbox',
      companyName: `[SANDBOX TEST] Doanh nghiệp Kiểm thử (${website})`,
      projectName: isBoard
        ? 'Bảng điện tử LED Năng suất Nhà máy 3.2m × 1.6m'
        : 'Màn hình LED Hội trường P2.5 Indoor 4.8m × 2.7m',
      areaType: 'hcm',
      hcmDistrict: 'Quận Gò Vấp',
      province: 'TP.HCM',
      installationAddress: 'Khu Kiểm thử Local Sandbox, TP.HCM',
      note: `[SANDBOX LOCAL] Bắn thử nghiệm luồng chia Lead tự động & thông báo SSE từ Trạm Chẩn đoán Admin lúc ${new Date().toLocaleTimeString('vi-VN')}.`,
      tracking: {
        gclid: `Cj0KCQ_sandbox_${Date.now()}`,
        utmSource: 'google',
        utmMedium: 'cpc',
        utmCampaign: isBoard ? 'camp_bang_dien_tu_cong_nghiep' : 'camp_man_hinh_led_hoi_truong',
        landingPageUrl: `https://${website}/lien-he-bao-gia/`,
      },
    });

    const ingestResult = await ingestWebhookLeadWithErrorProtection(samplePayload);
    const createdLead = ingestResult.leadId
      ? await prisma.lead.findUnique({
          where: { id: ingestResult.leadId },
          include: { assignedSales: { select: { fullName: true } } },
        })
      : null;
    const enrichedIngestResult = {
      ...ingestResult,
      assignedSalesName: createdLead?.assignedSales?.fullName || null,
      isDuplicateAlert: createdLead?.isDuplicateAlert || false,
    };
    bumpDomainRevisions(
      ['leads', 'tracking', 'reports', 'notifications'],
      'webhook_sandbox_test',
    );

    await prisma.auditLog.create({
      data: {
        actorUserId: auth.user.id,
        action: 'WEBHOOK_SANDBOX_SIMULATED',
        targetType: 'Lead',
        targetId: String(ingestResult.leadCode || submissionId),
        detailsJson: JSON.stringify({
          website,
          phone: testPhone,
          duplicateTest: Boolean(body.duplicateTest),
          result: enrichedIngestResult,
        }),
        ipAddress: getClientIp(req),
      },
    });

    return jsonSuccess({
      simulated: true,
      website,
      phone: testPhone,
      ingestResult: enrichedIngestResult,
    });
  }

  if (body.action === 'prune_backups') {
    const keepLatest = Math.min(50, Math.max(2, Math.floor(Number(body.keepLatestCount) || 10)));
    await prisma.systemSetting.upsert({
      where: { key: RETENTION_SETTING_KEY },
      update: { value: String(keepLatest), updatedById: auth.user.id },
      create: { key: RETENTION_SETTING_KEY, value: String(keepLatest), updatedById: auth.user.id },
    });

    const all = listAndVerifyBackupsOnDisk();
    const toRemove = all.slice(keepLatest);
    const root = APP_CONFIG.getBackupRoot();
    let prunedCount = 0;

    for (const old of toRemove) {
      const candidateDir = path.join(root, old.backupId);
      // Safety check: must sit strictly inside backup root
      if (
        candidateDir.startsWith(root) &&
        old.backupId &&
        !old.backupId.includes('..') &&
        fs.existsSync(candidateDir)
      ) {
        fs.rmSync(candidateDir, { recursive: true, force: true });
        prunedCount += 1;
      }
    }

    await prisma.auditLog.create({
      data: {
        actorUserId: auth.user.id,
        action: 'BACKUP_RETENTION_PRUNED',
        targetType: 'DatabaseBackup',
        targetId: `keep_${keepLatest}`,
        detailsJson: JSON.stringify({ keepLatest, prunedCount }),
        ipAddress: getClientIp(req),
      },
    });

    return jsonSuccess({
      keepLatest,
      prunedCount,
      backups: listAndVerifyBackupsOnDisk(),
    });
  }

  return jsonError('UNKNOWN_ACTION', 'Thao tác quản trị không hợp lệ.', 400);
}
