/**
 * Background Worker Scheduler & Job Runners (Mục 1.5)
 * Thực thi các tác vụ định kỳ theo đặc tả BA:
 * 1. Đồng bộ D3 đầy đủ (02:00) và nhẹ (11:00, 17:00) — UC03 Luồng B
 * 2. Tra lại gclid chưa rõ chiến dịch (mỗi giờ, Lead <= 7 ngày) — UC03 A2
 * 3. Đối soát Google Lead Form T-1 (sau sync 02:00) — UC03 Luồng D
 * 4. Đẩy bài SEO đến giờ hẹn (mỗi 5 phút) — UC05 Bước 7
 * 5. Cảnh báo báo giá > 7 ngày chưa phản hồi (hằng ngày) — UC02
 */

import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '@toantrung/database';
import { AiDesignProviderFactory } from '../modules/05-ai-design/providers';
import { logServerEvent, summarizeError } from '../core/logging/logger';
import { upsertActionableNotification } from '../core/notifications/service';
import { bumpDomainRevisions, getVietnamDateKey } from '../core/cache/server-data-cache';
import {
  retryUnresolvedGclids,
  triggerPlatformSyncExecution,
} from '../modules/02-tracking-sync/service';
import {
  publishArticleViaWordPressAdapter,
  refreshKeywordDerivedCacheFromCanonicalMetrics,
} from '../modules/03-keywords-ads/service';
import {
  getGmailLeadSyncConfig,
  syncLeadsFromGmail,
} from '../modules/01-leads/gmail-sync.service';

/**
 * 1. Đồng bộ D3 đầy đủ (02:00) hoặc nhẹ (11:00 / 17:00)
 */
export async function runScheduledD3SyncJob(slot: 'FULL_0200' | 'LIGHT_1100' | 'LIGHT_1700') {
  const result = await triggerPlatformSyncExecution({
    scheduleSlot: slot,
    platforms: ['GOOGLE_ADS', 'GA4', 'SEARCH_CONSOLE', 'FANPAGE', 'GOOGLE_TRENDS'],
    runGclidResolution: true,
    runReconciliation: slot === 'FULL_0200',
  });

  await refreshKeywordDerivedCacheFromCanonicalMetrics({ force: true });
  bumpDomainRevisions(['tracking', 'ads', 'reports', 'leads', 'websites'], `d3_sync_${slot}`);

  return result;
}

/**
 * 2. Tra lại gclid mỗi giờ cho Lead <= 7 ngày (UC03 A2)
 */
export async function runHourlyGclidRetryJob() {
  const res = await retryUnresolvedGclids();
  if (res.resolved > 0) {
    bumpDomainRevisions(['leads', 'tracking', 'reports'], 'gclid_retry_resolved');
  }
  return res;
}

/**
 * 3. Đối soát Google Lead Form ngày T-1 sau phiên đồng bộ 02:00 (UC03 Luồng D)
 */
export async function runDailyGoogleLeadFormReconciliationJob(targetDateStr?: string) {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const reconcileDate = targetDateStr || getVietnamDateKey(yesterday);
  const dayStart = new Date(`${reconcileDate}T00:00:00.000+07:00`);
  const dayEnd = new Date(`${reconcileDate}T23:59:59.999+07:00`);

  const [crmLeadCount, crmErrorLogCount, metrics] = await Promise.all([
    prisma.lead.count({
      where: {
        contactChannel: 'google_lead_form',
        createdAt: { gte: dayStart, lte: dayEnd },
      },
    }),
    prisma.webhookIntakeErrorLog.count({
      where: {
        sourcePlatform: 'google_lead_form',
        createdAt: { gte: dayStart, lte: dayEnd },
      },
    }),
    prisma.platformDailyMetric.findMany({
      where: {
        platform: 'google_ads',
        grain: 'campaign',
        metricDate: reconcileDate,
      },
      select: { googleLeadFormCount: true },
    }),
  ]);

  const platformReportedCount = metrics.reduce((sum, m) => sum + m.googleLeadFormCount, 0);
  const discrepancy = Math.abs(platformReportedCount - crmLeadCount);
  const status = discrepancy > 0 ? 'alert_open' : 'ok';

  let accountPropertyId = 'GADS-UNCONFIGURED';
  try {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: 'google_oauth_connection' },
    });
    if (setting?.value) {
      const conn = JSON.parse(setting.value);
      accountPropertyId = conn.detectedGadsCustomerId || conn.connectedEmail || accountPropertyId;
    }
  } catch (err) {
    logServerEvent('warn', 'workers', 'Failed to parse google_oauth_connection setting', summarizeError(err));
  }

  return prisma.leadReconciliation.upsert({
    where: {
      uq_reconcile_date_platform_account: {
        reconcileDate,
        platform: 'google_ads',
        accountPropertyId,
      },
    },
    update: {
      crmLeadCount,
      crmErrorLogCount,
      platformReportedCount,
      discrepancy,
      status,
    },
    create: {
      reconcileDate,
      platform: 'google_ads',
      accountPropertyId,
      crmLeadCount,
      crmErrorLogCount,
      platformReportedCount,
      discrepancy,
      status,
    },
  });
}

/**
 * 4. Đẩy bài SEO đến giờ hẹn mỗi 5 phút (UC05 Bước 7)
 * Tự động chuyển giữa LIVE_CMS (WordPress REST API Application Password) và SIMULATED_CMS.
 */
export async function runScheduledSeoPublishJob() {
  const now = new Date();
  const dueArticles = await prisma.seoArticle.findMany({
    where: {
      status: 'approved_scheduled',
      scheduledPublishAt: { lte: now },
    },
  });

  let publishedCount = 0;
  for (const article of dueArticles) {
    try {
      const cmsRes = await publishArticleViaWordPressAdapter(article);
      await prisma.seoArticle.update({
        where: { id: article.id },
        data: {
          status: 'published',
          publishedAt: now,
          publishedUrl: cmsRes.publishedUrl,
          lastPublishError: null,
          publishAttemptCount: { increment: 1 },
          version: { increment: 1 },
        },
      });
      publishedCount += 1;
    } catch (err) {
      await prisma.seoArticle.update({
        where: { id: article.id },
        data: {
          lastPublishError:
            err instanceof Error ? err.message : 'Lỗi kết nối CMS khi chạy tác vụ hẹn giờ.',
          publishAttemptCount: { increment: 1 },
        },
      });
    }
  }

  if (publishedCount > 0) {
    bumpDomainRevisions(['seo_articles', 'ads', 'reports', 'notifications'], 'seo_scheduled_publish');
  }

  return { scanned: dueArticles.length, publishedCount };
}

/**
 * 5. Cảnh báo báo giá > 7 ngày chưa phản hồi (UC02)
 */
export async function runDailyOverdueQuoteReminderJob() {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const overdueLeads = await prisma.lead.findMany({
    where: {
      isSpam: false,
      pipelineStatus: 'quote_sent',
      firstQuoteSentAt: { lte: sevenDaysAgo },
      quoteRespondedAt: null,
      OR: [
        { lastQuoteReminderAt: null },
        { lastQuoteReminderAt: { lte: oneDayAgo } },
      ],
    },
    select: {
      id: true,
      leadCode: true,
      companyName: true,
      contactName: true,
      assignedSalesId: true,
      firstQuoteSentAt: true,
    },
  });

  let notifiedCount = 0;
  for (const lead of overdueLeads) {
    if (lead.assignedSalesId) {
      await upsertActionableNotification({
        userId: lead.assignedSalesId,
        title: `Nhắc báo giá quá 7 ngày: ${lead.leadCode}`,
        summary: `Hồ sơ ${lead.companyName || lead.contactName || lead.leadCode} đã gửi báo giá quá 7 ngày nhưng chưa ghi nhận phản hồi từ khách hàng.`,
        category: 'Nhắc báo giá',
        actionLabel: 'Xem chi tiết',
        actionUrl: `/leads?leadId=${lead.id}`,
        requiredPermission: 'LEAD_VIEW_OWN',
      });
      notifiedCount += 1;
    }

    await prisma.lead.update({
      where: { id: lead.id },
      data: { lastQuoteReminderAt: now },
    });
  }

  if (notifiedCount > 0) {
    bumpDomainRevisions(['leads', 'notifications'], 'overdue_quote_reminder');
  }

  return { scanned: overdueLeads.length, notifiedCount };
}

export async function runGmailLeadSyncJob(force = false) {
  const cfg = await getGmailLeadSyncConfig();
  if (!force && !cfg.enabled) {
    return { skipped: true, reason: 'Chưa bật tự động đồng bộ Gmail.', created: 0, scanned: 0 };
  }
  const res = await syncLeadsFromGmail();
  return {
    skipped: false,
    ok: res.ok,
    message: res.message,
    created: res.summary.created,
    scanned: res.summary.scanned,
  };
}

export async function runSessionCleanupJob() {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const now = new Date();
  const res = await prisma.userSession.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: now } },
        { revokedAt: { lt: cutoff } },
      ],
    },
  });
  return { deletedCount: res.count };
}

export type WorkerJobCode =
  | 'D3_SYNC_FULL'
  | 'GCLID_HOURLY_RETRY'
  | 'GOOGLE_LEAD_RECONCILE'
  | 'SEO_SCHEDULED_PUBLISH'
  | 'OVERDUE_QUOTE_REMINDER'
  | 'GMAIL_LEAD_SYNC'
  | 'SESSION_CLEANUP'
  | 'ALL_JOBS';

export interface AdapterConnectionStatusItem {
  code: string;
  name: string;
  moduleScope: string;
  mode: 'LIVE_CONNECTED' | 'SIMULATED_FALLBACK';
  envKeysRequired: string[];
  description: string;
}

export interface WorkerJobHistoryItem {
  id: number;
  jobCode: string;
  summary: string;
  durationMs: number;
  executedAt: string;
}

function hasLiveOAuthVaultRuntime(): { connected: boolean; hasAdsCustomer: boolean } {
  const candidates = [
    path.join(process.cwd(), 'config', 'google-realtime-config.json'),
    path.join(process.cwd(), 'apps', 'web', 'config', 'google-realtime-config.json'),
  ];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as {
        ga4AccessToken?: string;
        gadsCustomerId?: string;
      };
      if (parsed.ga4AccessToken === 'VAULT_PROTECTED_TOKEN') {
        return { connected: true, hasAdsCustomer: Boolean(parsed.gadsCustomerId) };
      }
    } catch (err) {
      logServerEvent('warn', 'workers', 'Failed to read google-realtime-config.json', summarizeError(err));
    }
  }
  return { connected: false, hasAdsCustomer: false };
}

export function getAdapterReadinessMatrix(): AdapterConnectionStatusItem[] {
  const oauthRuntime = hasLiveOAuthVaultRuntime();
  const hasGoogleAds = Boolean(
    oauthRuntime.connected ||
      process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim() ||
      process.env.GOOGLE_ADS_CLIENT_ID?.trim(),
  );
  const hasGa4Gsc = Boolean(
    oauthRuntime.connected || process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim(),
  );
  const hasWebhookSecret = Boolean(process.env.WEBHOOK_SHARED_SECRET?.trim());
  let hasCatalogGeminiKey = false;
  try {
    hasCatalogGeminiKey = Boolean(
      AiDesignProviderFactory.getCatalog()?.config?.providers?.google_imagen?.apiKey?.trim(),
    );
  } catch {
    hasCatalogGeminiKey = false;
  }
  const hasGeminiKey = Boolean(
    process.env.GEMINI_API_KEY?.trim() ||
      process.env.GOOGLE_GENAI_API_KEY?.trim() ||
      hasCatalogGeminiKey,
  );

  return [
    {
      code: 'WEB_WEBHOOK_GTM',
      name: 'Webhook Form Website & GTM (toantrung.com.vn, bangled.vn, manhinhled.net.vn, bangdientu.com.vn)',
      moduleScope: 'M01 Leads & M02 Tracking',
      mode: hasWebhookSecret ? 'LIVE_CONNECTED' : 'SIMULATED_FALLBACK',
      envKeysRequired: ['WEBHOOK_SHARED_SECRET'],
      description: hasWebhookSecret
        ? 'Đã cấu hình khóa xác thực Webhook nhận Lead trực tiếp từ các website.'
        : 'Đang mở chế độ nhận Payload thử nghiệm nội bộ (chưa khóa WEBHOOK_SHARED_SECRET).',
    },
    {
      code: 'GOOGLE_ADS_API',
      name: 'Google Ads API v26 (OAuth Direct) & Google Lead Form',
      moduleScope: 'M02 Tracking & M03 Ads',
      mode: hasGoogleAds ? 'LIVE_CONNECTED' : 'SIMULATED_FALLBACK',
      envKeysRequired: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
      description: hasGoogleAds
        ? 'Kết nối trực tiếp Google Ads API v26 qua OAuth 2.0 để đồng bộ danh mục chiến dịch, chi phí và tra cứu gclid.'
        : 'Chưa kết nối tài khoản Google OAuth có quyền Google Ads.',
    },
    {
      code: 'GA4_SEARCH_CONSOLE',
      name: 'Google Analytics 4 (Data API) & Google Search Console',
      moduleScope: 'M02 Tracking & M03 SEO',
      mode: hasGa4Gsc ? 'LIVE_CONNECTED' : 'SIMULATED_FALLBACK',
      envKeysRequired: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
      description: hasGa4Gsc
        ? 'Đang đồng bộ trực tiếp phiên GA4, trang đích, click/hiển thị và vị trí từ khóa Search Console qua Google OAuth.'
        : 'Chưa kết nối Google OAuth cho GA4 / Search Console.',
    },
    {
      code: 'GEMINI_IMAGEN_AI',
      name: 'Google Gemini & Imagen AI (Phân tích SEO & Hỗ trợ Thiết kế)',
      moduleScope: 'M03 SEO & M05 AI Design',
      mode: hasGeminiKey ? 'LIVE_CONNECTED' : 'SIMULATED_FALLBACK',
      envKeysRequired: ['GEMINI_API_KEY'],
      description: hasGeminiKey
        ? 'Đã cấu hình khóa Google Gemini API; báo cáo SEO AI sử dụng model Gemini sống và ghi nhận AiUsageLog.'
        : 'Chưa cấu hình khóa Gemini API; đang dùng bộ tổng hợp dự phòng nội bộ.',
    },
  ];
}

export async function executeWorkerJobByCode(
  jobCode: WorkerJobCode,
  actorUserId?: number,
): Promise<{
  jobCode: WorkerJobCode;
  summary: string;
  durationMs: number;
  executedAt: string;
}> {
  const startMs = Date.now();
  let summary = '';

  if (jobCode === 'D3_SYNC_FULL') {
    const res = await runScheduledD3SyncJob('FULL_0200');
    summary = `Đồng bộ D3 hoàn tất (${res.recordsSynced} bản ghi metric) & làm mới bộ nhớ đệm từ khóa SEO.`;
  } else if (jobCode === 'GCLID_HOURLY_RETRY') {
    const res = await runHourlyGclidRetryJob();
    summary = `Quét ${res.scanned} Lead thiếu chiến dịch -> Khớp thành công ${res.resolved} mã gclid.`;
  } else if (jobCode === 'GOOGLE_LEAD_RECONCILE') {
    const res = await runDailyGoogleLeadFormReconciliationJob();
    summary = `Đối soát Google Lead Form ngày ${res.reconcileDate}: CRM=${res.crmLeadCount}, Google=${res.platformReportedCount} (Chênh lệch: ${res.discrepancy}).`;
  } else if (jobCode === 'SEO_SCHEDULED_PUBLISH') {
    const res = await runScheduledSeoPublishJob();
    summary = `Quét ${res.scanned} bài SEO đến hạn -> Đã xuất bản tự động ${res.publishedCount} bài viết.`;
  } else if (jobCode === 'OVERDUE_QUOTE_REMINDER') {
    const res = await runDailyOverdueQuoteReminderJob();
    summary = `Quét ${res.scanned} báo giá quá hạn > 7 ngày -> Đã gửi ${res.notifiedCount} thông báo nhắc NVKD.`;
  } else if (jobCode === 'GMAIL_LEAD_SYNC') {
    const res = await runGmailLeadSyncJob(true);
    summary = res.message || `Quét ${res.scanned} thư Gmail -> Tạo ${res.created} Lead mới.`;
  } else if (jobCode === 'SESSION_CLEANUP') {
    const res = await runSessionCleanupJob();
    summary = `Dọn dẹp phiên đăng nhập hết hạn/đã thu hồi -> Đã xóa ${res.deletedCount} bản ghi phiên cũ.`;
  } else {
    const [syncRes, gclidRes, seoRes, quoteRes] = await Promise.all([
      runScheduledD3SyncJob('LIGHT_1100'),
      runHourlyGclidRetryJob(),
      runScheduledSeoPublishJob(),
      runDailyOverdueQuoteReminderJob(),
    ]);
    await runDailyGoogleLeadFormReconciliationJob();
    summary = `Chạy trọn bộ 5 Worker Jobs: Đồng bộ ${syncRes.recordsSynced} metric, khớp ${gclidRes.resolved} gclid, đăng ${seoRes.publishedCount} bài SEO, nhắc ${quoteRes.notifiedCount} báo giá quá hạn.`;
  }

  const durationMs = Math.max(1, Date.now() - startMs);
  const executedAt = new Date().toISOString();

  await prisma.auditLog.create({
    data: {
      actorUserId: actorUserId || null,
      action: jobCode,
      targetType: 'WORKER_JOB',
      targetId: jobCode,
      detailsJson: JSON.stringify({
        summary,
        durationMs,
        executedAt,
      }),
    },
  });

  return {
    jobCode,
    summary,
    durationMs,
    executedAt,
  };
}

export async function getWorkerJobsHistory(limit = 10): Promise<WorkerJobHistoryItem[]> {
  const logs = await prisma.auditLog.findMany({
    where: { targetType: 'WORKER_JOB' },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return logs.map((l) => {
    let parsed: { summary?: string; durationMs?: number } = {};
    if (l.detailsJson) {
      try {
        parsed = JSON.parse(l.detailsJson) as { summary?: string; durationMs?: number };
      } catch (err) {
        logServerEvent('warn', 'workers', 'Malformed worker audit log JSON', {
          logId: l.id,
          ...summarizeError(err),
        });
      }
    }
    return {
      id: l.id,
      jobCode: l.action,
      summary: parsed.summary || `Thực thi tác vụ định kỳ ${l.action}`,
      durationMs: parsed.durationMs || 12,
      executedAt: l.createdAt.toISOString(),
    };
  });
}

const globalForInternalWorkers = globalThis as unknown as {
  __toantrungInternalWorkersStarted?: boolean;
  __toantrungSeoPublishRunning?: boolean;
  __toantrungGclidRetryRunning?: boolean;
  __toantrungQuoteReminderRunning?: boolean;
  __toantrungLastOverdueQuoteVnDay?: string;
};

/**
 * Khởi chạy bộ lập lịch nội bộ độc lập với trình duyệt (mỗi timer unref() + khóa chống chạy chồng).
 */
export function ensureInternalWorkersSchedulerStarted(): void {
  if (process.env.NODE_TEST_CONTEXT) return;
  if (globalForInternalWorkers.__toantrungInternalWorkersStarted) return;
  globalForInternalWorkers.__toantrungInternalWorkersStarted = true;

  const runSeoPublishTick = async () => {
    if (globalForInternalWorkers.__toantrungSeoPublishRunning) return;
    globalForInternalWorkers.__toantrungSeoPublishRunning = true;
    try {
      await runScheduledSeoPublishJob();
    } catch (err) {
      logServerEvent('error', 'workers.seo_publish', 'Scheduled SEO publish tick failed', summarizeError(err));
    } finally {
      globalForInternalWorkers.__toantrungSeoPublishRunning = false;
    }
  };

  const runGclidRetryTick = async () => {
    if (globalForInternalWorkers.__toantrungGclidRetryRunning) return;
    globalForInternalWorkers.__toantrungGclidRetryRunning = true;
    try {
      await runHourlyGclidRetryJob();
    } catch (err) {
      logServerEvent('error', 'workers.gclid_retry', 'Hourly GCLID retry tick failed', summarizeError(err));
    } finally {
      globalForInternalWorkers.__toantrungGclidRetryRunning = false;
    }
  };

  const runQuoteReminderTick = async () => {
    if (globalForInternalWorkers.__toantrungQuoteReminderRunning) return;
    const now = new Date();
    const vnHour = (now.getUTCHours() + 7) % 24;
    const vnDay = getVietnamDateKey(now);
    if (vnHour !== 8 || globalForInternalWorkers.__toantrungLastOverdueQuoteVnDay === vnDay) {
      return;
    }
    globalForInternalWorkers.__toantrungQuoteReminderRunning = true;
    globalForInternalWorkers.__toantrungLastOverdueQuoteVnDay = vnDay;
    try {
      await runDailyOverdueQuoteReminderJob();
    } catch (err) {
      logServerEvent('error', 'workers.quote_reminder', 'Daily overdue quote reminder tick failed', summarizeError(err));
    } finally {
      globalForInternalWorkers.__toantrungQuoteReminderRunning = false;
    }
  };

  const seoTimer = setInterval(() => {
    void runSeoPublishTick();
  }, 5 * 60 * 1000);
  const gclidTimer = setInterval(() => {
    void runGclidRetryTick();
  }, 60 * 60 * 1000);
  const quoteTimer = setInterval(() => {
    void runQuoteReminderTick();
  }, 30 * 60 * 1000);

  if (typeof seoTimer.unref === 'function') seoTimer.unref();
  if (typeof gclidTimer.unref === 'function') gclidTimer.unref();
  if (typeof quoteTimer.unref === 'function') quoteTimer.unref();
}

