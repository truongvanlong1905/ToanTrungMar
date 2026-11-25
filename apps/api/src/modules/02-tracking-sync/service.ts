import {
  prisma,
  ingestLeadWithTrackingIdempotent,
  parseBigIntString,
  upsertPlatformMetricIdempotent,
} from '@toantrung/database';
import {
  CONTACT_CHANNEL_LABELS,
  isL2Valid,
  isL3Effective,
  toMonetaryAmountDto,
  type AttributionSummaryRowDto,
  type CampaignItemDto,
  type ContactChannel,
  type DeclareExternalCampaignDto,
  type LeadReconciliationItemDto,
  type MarketingPlatform,
  type PlatformSyncStatusDto,
  type ResolveReconciliationDto,
  type SessionUserDto,
  type TrackingDashboardDto,
  type TriggerPlatformSyncDto,
  type WebhookIntakeErrorItemDto,
  type WebhookLeadIntakeDto,
} from '@toantrung/contracts';
import {
  generateNextLeadCode,
  inspectDuplicateAndPriceCheck,
  normalizeVietnamPhone,
  selectAutoAssignedSales,
} from '../01-leads/service';
import { normalizeWebsiteDomain } from '../01-leads/gmail-form-parser';
import { refreshKeywordDerivedCacheFromCanonicalMetrics } from '../03-keywords-ads/service';
import {
  getGoogleConnection,
  syncAllGoogleDataAcrossModules,
  getGscDataStateMetadataMap,
  classifyGscDateBySourceMetadata,
  ALLOWED_COMPANY_GA4_PROPERTY_IDS,
  ALLOWED_COMPANY_GSC_SITES,
} from './google-oauth.service';
import {
  getCanonicalDateRange,
  countInclusiveCalendarDays,
  resolveDatePresetRange,
} from '../../core/reporting-dates';
import { getGmailLeadSyncStatus } from '../01-leads/gmail-sync.service';
import {
  bumpDomainRevisions,
  getOrComputeScopedCache,
  getVietnamDateKey,
} from '../../core/cache/server-data-cache';

export { ALLOWED_COMPANY_GA4_PROPERTY_IDS, ALLOWED_COMPANY_GSC_SITES };

export function resolveAttributionBySignals(input: {
  provider: 'WEBSITE_FORM' | 'GOOGLE_LEAD_FORM';
  gclid?: string | null;
  googleCampaignCode?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  referrerUrl?: string | null;
  matchedCampaignByGclid?: { id: number; campaignCode: string; campaignName: string } | null;
  matchedCampaignByUtm?: { id: number; campaignCode: string; campaignName: string } | null;
}) {
  if (input.provider === 'GOOGLE_LEAD_FORM') {
    return {
      marketingSource: 'Google Ads',
      sourceResolutionMethod: 'google_lead_form',
      campaignId: input.matchedCampaignByGclid?.id ?? input.matchedCampaignByUtm?.id ?? null,
      campaignName:
        input.matchedCampaignByGclid?.campaignName ??
        input.matchedCampaignByUtm?.campaignName ??
        input.googleCampaignCode ??
        null,
      isUnknownSource: false,
      isUnknownCampaign: !input.matchedCampaignByGclid && !input.matchedCampaignByUtm && !input.googleCampaignCode,
      isUtmGclidMismatch: false,
      isUnmatchedUtm: false,
    };
  }

  const gclid = input.gclid?.trim() || null;
  const utmSource = input.utmSource?.trim().toLowerCase() || null;
  const utmMedium = input.utmMedium?.trim().toLowerCase() || null;
  const utmCampaign = input.utmCampaign?.trim() || null;
  const ref = input.referrerUrl?.trim().toLowerCase() || null;

  // 1. Có gclid (Ưu tiên cao nhất theo BR4: gclid > UTM > Referrer)
  if (gclid) {
    const hasMismatchWithUtm =
      Boolean(utmSource && utmSource !== 'google') ||
      Boolean(
        input.matchedCampaignByGclid &&
          input.matchedCampaignByUtm &&
          input.matchedCampaignByGclid.id !== input.matchedCampaignByUtm.id,
      );

    if (input.matchedCampaignByGclid) {
      return {
        marketingSource: 'Google Ads',
        sourceResolutionMethod: 'gclid',
        campaignId: input.matchedCampaignByGclid.id,
        campaignName: input.matchedCampaignByGclid.campaignName,
        isUnknownSource: false,
        isUnknownCampaign: false,
        isUtmGclidMismatch: hasMismatchWithUtm,
        isUnmatchedUtm: false,
      };
    }

    // Chưa tra ra chiến dịch từ gclid ngay -> tạm gắn theo UTM ('utm_temp') hoặc chờ A2 tra lại
    return {
      marketingSource: 'Google Ads',
      sourceResolutionMethod: input.matchedCampaignByUtm ? 'utm_temp' : 'gclid',
      campaignId: input.matchedCampaignByUtm?.id ?? null,
      campaignName: input.matchedCampaignByUtm?.campaignName ?? utmCampaign ?? null,
      isUnknownSource: false,
      isUnknownCampaign: !input.matchedCampaignByUtm,
      isUtmGclidMismatch: hasMismatchWithUtm,
      isUnmatchedUtm: Boolean(utmCampaign && !input.matchedCampaignByUtm),
    };
  }

  // 2. Không có gclid, xét UTM (BR1 & A3)
  if (utmSource || utmCampaign) {
    let marketingSource = 'Khác';
    if (utmSource === 'google' && (utmMedium === 'cpc' || utmMedium === 'ppc' || !utmMedium)) {
      marketingSource = 'Google Ads';
    } else if (
      utmSource &&
      ['facebook', 'fb', 'zalo', 'youtube', 'tiktok'].some((s) => utmSource.includes(s))
    ) {
      marketingSource = 'Mạng xã hội';
    }

    return {
      marketingSource,
      sourceResolutionMethod: 'utm',
      campaignId: input.matchedCampaignByUtm?.id ?? null,
      campaignName: input.matchedCampaignByUtm?.campaignName ?? null,
      isUnknownSource: false,
      isUnknownCampaign: !input.matchedCampaignByUtm,
      isUtmGclidMismatch: false,
      isUnmatchedUtm: Boolean(utmCampaign && !input.matchedCampaignByUtm),
    };
  }

  // 3. Không có gclid và UTM, xét Referrer (BR1)
  if (ref) {
    if (['google.', 'bing.', 'coccoc.', 'yahoo.', 'duckduckgo.'].some((s) => ref.includes(s))) {
      return {
        marketingSource: 'Tìm kiếm tự nhiên',
        sourceResolutionMethod: 'referrer',
        campaignId: null,
        campaignName: null,
        isUnknownSource: false,
        isUnknownCampaign: false,
        isUtmGclidMismatch: false,
        isUnmatchedUtm: false,
      };
    }
    if (['facebook.', 'zalo.', 'youtube.', 'tiktok.'].some((s) => ref.includes(s))) {
      return {
        marketingSource: 'Mạng xã hội',
        sourceResolutionMethod: 'referrer',
        campaignId: null,
        campaignName: null,
        isUnknownSource: false,
        isUnknownCampaign: false,
        isUtmGclidMismatch: false,
        isUnmatchedUtm: false,
      };
    }
    return {
      marketingSource: 'Website giới thiệu',
      sourceResolutionMethod: 'referrer',
      campaignId: null,
      campaignName: null,
      isUnknownSource: false,
      isUnknownCampaign: false,
      isUtmGclidMismatch: false,
      isUnmatchedUtm: false,
    };
  }

  // 4. Có khối tracking nhưng rỗng hoàn toàn -> Truy cập trực tiếp
  return {
    marketingSource: 'Truy cập trực tiếp',
    sourceResolutionMethod: 'referrer',
    campaignId: null,
    campaignName: null,
    isUnknownSource: false,
    isUnknownCampaign: false,
    isUtmGclidMismatch: false,
    isUnmatchedUtm: false,
  };
}

export async function ingestWebhookLeadWithErrorProtection(input: WebhookLeadIntakeDto) {
  return withSerializedWebhookIntakeLock(async () => {
    const providerInternal =
      input.intakeSourceProvider === 'GOOGLE_LEAD_FORM' ? 'google_lead_form' : 'website_webhook';
    const accountKey = input.intakeSourceAccountKey.trim().toLowerCase();
    const submissionId = input.externalSubmissionId.trim();

    try {
      const { normalizedPhone, isUnstandardized } = normalizeVietnamPhone(input.phone);
      const dupCheck = await inspectDuplicateAndPriceCheck({
        phone: normalizedPhone,
        email: input.email,
        companyName: input.companyName,
        projectName: input.projectName,
      });

      const assignment = await selectAutoAssignedSales(dupCheck.matchedOldLead?.assignedSalesId);
      const leadCode = await generateNextLeadCode();

      const gclid = input.tracking?.gclid?.trim() || null;
      const utmCampaign = input.tracking?.utmCampaign?.trim() || null;
      const googleCampaignCode = input.tracking?.googleCampaignCode?.trim() || null;

      const allCampaigns = await prisma.campaign.findMany({ where: { isActive: true } });
      const matchedByGclid = googleCampaignCode
        ? allCampaigns.find((c) => c.campaignCode.toLowerCase() === googleCampaignCode.toLowerCase()) ||
          null
        : null;

      const matchedByUtm = utmCampaign
        ? allCampaigns.find(
            (c) =>
              c.utmCampaignSlug?.toLowerCase() === utmCampaign.toLowerCase() ||
              c.campaignCode.toLowerCase() === utmCampaign.toLowerCase(),
          ) || null
        : null;

      const resolvedAttr = input.tracking
        ? resolveAttributionBySignals({
            provider: input.intakeSourceProvider,
            gclid,
            googleCampaignCode,
            utmSource: input.tracking.utmSource,
            utmMedium: input.tracking.utmMedium,
            utmCampaign,
            referrerUrl: input.tracking.referrerUrl,
            matchedCampaignByGclid: matchedByGclid,
            matchedCampaignByUtm: matchedByUtm,
          })
        : {
            marketingSource:
              input.intakeSourceProvider === 'GOOGLE_LEAD_FORM' ? 'Google Ads' : 'Chưa xác định',
            sourceResolutionMethod:
              input.intakeSourceProvider === 'GOOGLE_LEAD_FORM' ? 'google_lead_form' : 'unknown',
            campaignId: null,
            campaignName: null,
            isUnknownSource: input.intakeSourceProvider !== 'GOOGLE_LEAD_FORM',
            isUnknownCampaign: true,
            isUtmGclidMismatch: false,
            isUnmatchedUtm: false,
          };

      const resolvedWebsite =
        normalizeWebsiteDomain(input.sourceWebsite) ||
        normalizeWebsiteDomain(input.tracking?.landingPageUrl) ||
        (providerInternal === 'website_webhook' ? normalizeWebsiteDomain(accountKey) : null);

      const ingested = await ingestLeadWithTrackingIdempotent(prisma, {
        intakeSourceProvider: providerInternal,
        intakeSourceAccountKey: accountKey,
        externalSubmissionId: submissionId,
        leadCode,
        contactChannel:
          input.intakeSourceProvider === 'GOOGLE_LEAD_FORM' ? 'google_lead_form' : 'form_web',
        phone: normalizedPhone,
        email: input.email || null,
        contactName: input.contactName || null,
        companyName: input.companyName || null,
        projectName: input.projectName || null,
        areaType: input.areaType === 'hcm' ? 'tphcm' : input.areaType === 'other_province' ? 'other_province' : null,
        province: input.areaType === 'hcm' ? 'TP. Hồ Chí Minh' : input.province || null,
        district: input.hcmDistrict || null,
        installationAddress: input.installationAddress || null,
        sourceWebsite: resolvedWebsite,
        assignedSalesId: assignment.assignedSalesId,
        marketingSource: resolvedAttr.marketingSource,
        sourceResolutionMethod: resolvedAttr.sourceResolutionMethod,
        utmSource: input.tracking?.utmSource || null,
        utmMedium: input.tracking?.utmMedium || null,
        utmCampaign: input.tracking?.utmCampaign || null,
        campaignName: resolvedAttr.campaignName,
        gclid,
        referrerUrl: input.tracking?.referrerUrl || null,
        landingPageUrl: input.tracking?.landingPageUrl || null,
        deviceType: input.tracking?.deviceType || null,
      });

      if (!ingested.deduplicated) {
        await prisma.$transaction(async (tx) => {
          await tx.lead.update({
            where: { id: ingested.lead.id },
            data: {
              isPhoneUnstandardized: isUnstandardized,
              normalizedLookupKey: dupCheck.lookupKey,
              isDuplicateAlert: dupCheck.isDuplicateAlert,
              duplicateStatus: dupCheck.duplicateStatus,
              matchedOldLeadId: dupCheck.matchedOldLead?.id ?? null,
              isSuspectedPriceCheck: dupCheck.isSuspectedPriceCheck,
              needsManagerAttention: assignment.needsManagerAttention,
            },
          });

          await tx.marketingTracking.update({
            where: { leadId: ingested.lead.id },
            data: {
              campaignId: resolvedAttr.campaignId,
              isUnknownSource: resolvedAttr.isUnknownSource,
              isUnknownCampaign: resolvedAttr.isUnknownCampaign,
              isUtmGclidMismatch: resolvedAttr.isUtmGclidMismatch,
              isUnmatchedUtm: resolvedAttr.isUnmatchedUtm,
              isRepeatLead: Boolean(dupCheck.matchedOldLead),
            },
          });
        });
        bumpDomainRevisions(['leads', 'tracking', 'reports', 'ads', 'notifications'], 'webhook_lead_ingested');
      }

      return {
        ok: true as const,
        leadId: ingested.lead.id,
        leadCode: ingested.lead.leadCode,
        deduplicated: ingested.deduplicated,
        marketingSource: ingested.tracking.marketingSource,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Lỗi xử lý Webhook Intake.';
      await prisma.webhookIntakeErrorLog.upsert({
        where: {
          uq_webhook_error_source_submission: {
            sourcePlatform: providerInternal,
            intakeSourceAccountKey: accountKey,
            externalSubmissionId: submissionId,
          },
        },
        update: {
          rawPayloadJson: JSON.stringify(input),
          errorMessage: errorMsg,
          retryCount: { increment: 1 },
          lastRetriedAt: new Date(),
        },
        create: {
          sourcePlatform: providerInternal,
          intakeSourceAccountKey: accountKey,
          externalSubmissionId: submissionId,
          rawPayloadJson: JSON.stringify(input),
          errorCode: 'WEBHOOK_VALIDATION_FAILED',
          errorMessage: errorMsg,
        },
      });
      throw err;
    }
  });
}

export async function retryUnresolvedGclids() {
  const windowCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const candidates = await prisma.marketingTracking.findMany({
    where: {
      gclid: { not: null },
      trackedAt: { gte: windowCutoff },
      OR: [{ isUnknownCampaign: true }, { sourceResolutionMethod: 'utm_temp' }],
    },
  });

  const defaultAdsCampaign = await prisma.campaign.findFirst({
    where: { platform: 'google_ads', isActive: true },
    orderBy: { id: 'asc' },
  });

  let resolvedCount = 0;
  for (const tr of candidates) {
    if (defaultAdsCampaign) {
      const utmCampStr = tr.utmCampaign || '';
      const hadDifferentUtm =
        Boolean(utmCampStr) &&
        utmCampStr.toLowerCase() !== (defaultAdsCampaign.utmCampaignSlug || '').toLowerCase() &&
        utmCampStr.toLowerCase() !== defaultAdsCampaign.campaignCode.toLowerCase();

      await prisma.marketingTracking.update({
        where: { id: tr.id },
        data: {
          campaignId: defaultAdsCampaign.id,
          campaignName: defaultAdsCampaign.campaignName,
          sourceResolutionMethod: 'gclid_retried',
          isUnknownCampaign: false,
          isUtmGclidMismatch: tr.isUtmGclidMismatch || hadDifferentUtm,
          gclidRetryCount: { increment: 1 },
          gclidLastTriedAt: new Date(),
        },
      });
      resolvedCount += 1;
    } else {
      await prisma.marketingTracking.update({
        where: { id: tr.id },
        data: {
          gclidRetryCount: { increment: 1 },
          gclidLastTriedAt: new Date(),
        },
      });
    }
  }

  return { scanned: candidates.length, resolved: resolvedCount };
}

export async function declareExternalCampaignAndRemapUtm(input: DeclareExternalCampaignDto) {
  const platformNorm = input.platform.toLowerCase();
  const budgetMicros = parseBigIntString(input.dailyBudgetMicrosString);
  const slug = input.campaignCode.trim().toLowerCase();

  const campaign = await prisma.campaign.upsert({
    where: {
      uq_campaign_platform_account_code: {
        platform: platformNorm,
        accountExternalId: input.accountExternalId.trim(),
        campaignCode: input.campaignCode.trim(),
      },
    },
    update: {
      campaignName: input.campaignName.trim(),
      utmCampaignSlug: slug,
      dailyBudgetMicros: budgetMicros,
      isActive: true,
    },
    create: {
      platform: platformNorm,
      accountExternalId: input.accountExternalId.trim(),
      campaignCode: input.campaignCode.trim(),
      campaignName: input.campaignName.trim(),
      utmCampaignSlug: slug,
      dailyBudgetMicros: budgetMicros,
      isActive: true,
    },
  });

  // UC03 A3: Tự động quét và gắn lại cho các Lead có UTM chưa khớp nay đã khớp
  const unmatchedTrackings = await prisma.marketingTracking.findMany({
    where: {
      OR: [{ isUnmatchedUtm: true }, { isUnknownCampaign: true }],
      utmCampaign: { not: null },
    },
  });

  let remappedCount = 0;
  for (const tr of unmatchedTrackings) {
    if (tr.utmCampaign && tr.utmCampaign.trim().toLowerCase() === slug) {
      await prisma.marketingTracking.update({
        where: { id: tr.id },
        data: {
          campaignId: campaign.id,
          campaignName: campaign.campaignName,
          isUnmatchedUtm: false,
          isUnknownCampaign: false,
        },
      });
      remappedCount += 1;
    }
  }

  return { campaign, remappedCount };
}

const globalForTrackingSync = globalThis as typeof globalThis & {
  __trackingSyncInFlight?: Promise<Awaited<ReturnType<typeof runTriggerPlatformSyncInternal>>> | null;
  __trackingSchedulerStarted?: boolean;
};

async function runTriggerPlatformSyncInternal(input: TriggerPlatformSyncDto) {
  const syncRes = await syncAllGoogleDataAcrossModules(input.scheduleSlot);
  const latestLog = await prisma.platformSyncLog.findFirst({
    orderBy: { id: 'desc' },
  });

  const gclidRetryResult = input.runGclidResolution
    ? await retryUnresolvedGclids()
    : { scanned: 0, resolved: syncRes.gclidResolved || 0 };

  if (input.runReconciliation && input.scheduleSlot === 'FULL_0200') {
    try {
      const { runDailyGoogleLeadFormReconciliationJob } = await import('../../workers');
      await runDailyGoogleLeadFormReconciliationJob();
    } catch {
      // non-fatal reconciliation guard
    }
  }

  bumpDomainRevisions(['tracking', 'ads', 'reports', 'leads', 'websites'], `trigger_sync_${input.scheduleSlot}`);

  return {
    syncLogId: latestLog?.id || 0,
    recordsSynced: syncRes.syncedRecords,
    gclidRetryResult,
    liveIntegrationMode: 'LIVE_CONFIGURED' as const,
    ga4Status: syncRes.ga4Status,
    scStatus: syncRes.scStatus,
    ga4Error: syncRes.ga4Error,
    scError: syncRes.scError,
  };
}

export async function triggerPlatformSyncExecution(input: TriggerPlatformSyncDto) {
  if (globalForTrackingSync.__trackingSyncInFlight) {
    return globalForTrackingSync.__trackingSyncInFlight;
  }
  const runPromise = runTriggerPlatformSyncInternal(input).finally(() => {
    globalForTrackingSync.__trackingSyncInFlight = null;
  });
  globalForTrackingSync.__trackingSyncInFlight = runPromise;
  return runPromise;
}

export function ensureTrackingBackgroundSchedulerStarted(): void {
  if (process.env.NODE_TEST_CONTEXT) return;
  if (globalForTrackingSync.__trackingSchedulerStarted) return;
  globalForTrackingSync.__trackingSchedulerStarted = true;

  const checkAndRunScheduledSync = async () => {
    try {
      const conn = await getGoogleConnection();
      if (!conn?.connected || conn.isSandboxDemo || conn.connectionStatus === 'EXPIRED') return;
      const now = new Date();
      const vnHour = (now.getUTCHours() + 7) % 24;
      const vnMinute = now.getUTCMinutes();
      const currentVnDay = getVietnamDateKey(now);

      let slot: TriggerPlatformSyncDto['scheduleSlot'] | null = null;
      if (vnHour === 2 && vnMinute < 20) slot = 'FULL_0200';
      else if (vnHour === 11 && vnMinute < 20) slot = 'LIGHT_1100';
      else if (vnHour === 17 && vnMinute < 20) slot = 'LIGHT_1700';

      if (slot) {
        const expectedRunType = slot === 'FULL_0200' ? 'full' : 'light';
        const lastSlotSync = await prisma.platformSyncLog.findFirst({
          where: { runType: { in: [slot, expectedRunType] } },
          orderBy: { completedAt: 'desc' },
        });
        if (lastSlotSync?.completedAt && Date.now() - lastSlotSync.completedAt.getTime() < 2 * 60 * 60 * 1000) {
          return;
        }
      } else {
        // Automatic catch-up when server missed a scheduled window (e.g. PC was turned off)
        const latestSync = await prisma.platformSyncLog.findFirst({
          where: { status: { in: ['completed', 'success'] } },
          orderBy: { completedAt: 'desc' },
        });
        const completedAt = latestSync?.completedAt ?? null;
        const ageMs = completedAt ? Date.now() - completedAt.getTime() : Number.POSITIVE_INFINITY;
        if (ageMs < 2 * 60 * 60 * 1000) return;

        const lastSyncVnDay = completedAt ? getVietnamDateKey(completedAt) : '';
        if (!completedAt || ageMs >= 20 * 60 * 60 * 1000 || (lastSyncVnDay && lastSyncVnDay !== currentVnDay)) {
          slot = 'FULL_0200';
        } else if (ageMs >= 6 * 60 * 60 * 1000) {
          slot = 'LIGHT_1100';
        }
      }

      if (!slot) return;
      await triggerPlatformSyncExecution({
        scheduleSlot: slot,
        runGclidResolution: true,
        runReconciliation: true,
      });
    } catch {
      // Background scheduler errors must not crash server process
    }
  };

  const bootTimer = setTimeout(() => {
    void checkAndRunScheduledSync();
  }, 25_000);
  if (typeof bootTimer.unref === 'function') {
    bootTimer.unref();
  }

  const timer = setInterval(() => {
    void checkAndRunScheduledSync();
  }, 15 * 60 * 1000);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
}

const SETTING_KEY_TOUCHPOINTS = 'tracking_touchpoints_v1';

interface StoredTouchpointRecord {
  eventId: string;
  eventType: 'product_view' | 'contact_click' | 'form_submit_success';
  sourceWebsite: string;
  pageUrl: string | null;
  leadCode: string | null;
  submissionId: string | null;
  visitorId: string | null;
  occurredAt: string;
}

const globalForTrackingLocks = globalThis as unknown as {
  __toantrungTouchpointWriteQueue?: Promise<unknown>;
  __toantrungWebhookIntakeQueue?: Promise<unknown>;
  __toantrungTouchpointMigrationDone?: boolean;
};

function withSerializedTouchpointLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = globalForTrackingLocks.__toantrungTouchpointWriteQueue ?? Promise.resolve();
  const next = prev.then(fn, fn);
  globalForTrackingLocks.__toantrungTouchpointWriteQueue = next.catch(() => undefined);
  return next;
}

function withSerializedWebhookIntakeLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = globalForTrackingLocks.__toantrungWebhookIntakeQueue ?? Promise.resolve();
  const next = prev.then(fn, fn);
  globalForTrackingLocks.__toantrungWebhookIntakeQueue = next.catch(() => undefined);
  return next;
}

export async function migrateLegacyTouchpointsSettingToTable(): Promise<{
  migratedCount: number;
  skippedCount: number;
}> {
  const legacyRow = await prisma.systemSetting.findUnique({
    where: { key: SETTING_KEY_TOUCHPOINTS },
  });
  if (!legacyRow?.value) {
    globalForTrackingLocks.__toantrungTouchpointMigrationDone = true;
    return { migratedCount: 0, skippedCount: 0 };
  }

  let parsed: unknown = [];
  try {
    parsed = JSON.parse(legacyRow.value);
  } catch {
    return { migratedCount: 0, skippedCount: 0 };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    globalForTrackingLocks.__toantrungTouchpointMigrationDone = true;
    return { migratedCount: 0, skippedCount: 0 };
  }

  let migratedCount = 0;
  let skippedCount = 0;

  for (const rawItem of parsed) {
    if (!rawItem || typeof rawItem !== 'object') continue;
    const item = rawItem as Partial<StoredTouchpointRecord>;
    const eventId = typeof item.eventId === 'string' ? item.eventId.trim() : '';
    if (!eventId) continue;

    const occurredDate = item.occurredAt ? new Date(item.occurredAt) : new Date();
    const validOccurredAt = Number.isNaN(occurredDate.getTime()) ? new Date() : occurredDate;

    try {
      await prisma.trackingTouchpoint.create({
        data: {
          eventId,
          eventType: item.eventType || 'product_view',
          sourceWebsite:
            normalizeWebsiteDomain(item.sourceWebsite) ||
            String(item.sourceWebsite || 'unknown').trim().toLowerCase(),
          pageUrl: item.pageUrl?.trim() || null,
          leadCode: item.leadCode?.trim() || null,
          submissionId: item.submissionId?.trim() || null,
          visitorId: item.visitorId?.trim() || null,
          occurredAt: validOccurredAt,
        },
      });
      migratedCount += 1;
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'P2002') {
        skippedCount += 1;
      } else {
        throw err;
      }
    }
  }

  globalForTrackingLocks.__toantrungTouchpointMigrationDone = true;
  return { migratedCount, skippedCount };
}

export async function getStoredTouchpoints(): Promise<StoredTouchpointRecord[]> {
  if (!globalForTrackingLocks.__toantrungTouchpointMigrationDone) {
    await withSerializedTouchpointLock(() => migrateLegacyTouchpointsSettingToTable());
  }

  const rows = await prisma.trackingTouchpoint.findMany({
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: 5000,
  });

  return rows.map((r) => ({
    eventId: r.eventId,
    eventType: (r.eventType as StoredTouchpointRecord['eventType']) || 'product_view',
    sourceWebsite: r.sourceWebsite,
    pageUrl: r.pageUrl,
    leadCode: r.leadCode,
    submissionId: r.submissionId,
    visitorId: r.visitorId,
    occurredAt: r.occurredAt.toISOString(),
  }));
}

export async function recordTrackingTouchpoint(input: {
  eventId: string;
  eventType: 'product_view' | 'contact_click' | 'form_submit_success';
  sourceWebsite: string;
  pageUrl?: string | null;
  leadCode?: string | null;
  submissionId?: string | null;
  visitorId?: string | null;
  occurredAt?: string | null;
}): Promise<{ ok: true; deduplicated: boolean; linkedLeadCode: string | null }> {
  return withSerializedTouchpointLock(async () => {
    const normalizedEventId = input.eventId.trim();
    const existingRow = await prisma.trackingTouchpoint.findUnique({
      where: { eventId: normalizedEventId },
      select: { leadCode: true },
    });
    if (existingRow) {
      return { ok: true, deduplicated: true, linkedLeadCode: existingRow.leadCode };
    }

    let linkedLeadCode = input.leadCode?.trim() || null;
    if (!linkedLeadCode && input.submissionId?.trim()) {
      const matchedTracking = await prisma.marketingTracking.findFirst({
        where: { externalSubmissionId: input.submissionId.trim() },
        include: { lead: { select: { leadCode: true } } },
      });
      linkedLeadCode = matchedTracking?.lead?.leadCode || null;
    }

    const occurredDate = input.occurredAt?.trim() ? new Date(input.occurredAt.trim()) : new Date();
    const validOccurredAt = Number.isNaN(occurredDate.getTime()) ? new Date() : occurredDate;

    try {
      await prisma.trackingTouchpoint.create({
        data: {
          eventId: normalizedEventId,
          eventType: input.eventType,
          sourceWebsite:
            normalizeWebsiteDomain(input.sourceWebsite) || input.sourceWebsite.trim().toLowerCase(),
          pageUrl: input.pageUrl?.trim() || null,
          leadCode: linkedLeadCode,
          submissionId: input.submissionId?.trim() || null,
          visitorId: input.visitorId?.trim() || null,
          occurredAt: validOccurredAt,
        },
      });
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'P2002') {
        const winner = await prisma.trackingTouchpoint.findUnique({
          where: { eventId: normalizedEventId },
          select: { leadCode: true },
        });
        return {
          ok: true,
          deduplicated: true,
          linkedLeadCode: winner?.leadCode ?? linkedLeadCode,
        };
      }
      throw err;
    }

    bumpDomainRevisions(['tracking', 'reports'], 'touchpoint_recorded');
    return { ok: true, deduplicated: false, linkedLeadCode };
  });
}

export async function resolveLeadReconciliationAlert(
  actor: SessionUserDto,
  input: ResolveReconciliationDto,
) {
  return prisma.leadReconciliation.update({
    where: { id: input.reconciliationId },
    data: {
      status: 'resolved',
      resolutionNote: input.resolutionNote.trim(),
      resolvedByUserId: actor.id,
      resolvedAt: new Date(),
    },
  });
}

function formatRatioPct(numerator: number, denominator: number): string {
  if (denominator <= 0) return '—';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

export async function getTrackingDashboardData(
  periodDays = 30,
  dateFilter?: { preset?: string; from?: string; to?: string },
): Promise<TrackingDashboardDto> {
  const dateRange = dateFilter?.preset || (dateFilter?.from && dateFilter?.to)
    ? resolveDatePresetRange(dateFilter.preset || 'CUSTOM', dateFilter.from, dateFilter.to)
    : getCanonicalDateRange(periodDays);
  const cutoffDate = dateRange.startDateTime;
  const endDateTime = dateRange.endDateTime;
  const cutoffDateStr = dateRange.startDateStr;
  const todayStr = dateRange.endDateStr;

  const cacheResult = await getOrComputeScopedCache<TrackingDashboardDto>({
    key: `tracking-default:${dateFilter?.preset || `${periodDays}D`}:${cutoffDateStr}:${todayStr}`,
    domains: ['tracking', 'leads', 'ads', 'websites'],
    ttlMs: 30_000,
    compute: async () => {
      const [
        leads,
        campaigns,
        syncLogs,
        reconciliations,
        webhookErrors,
        touchpoints,
        trendsSetting,
        googleConnSetting,
        gmailStatus,
        adsCfg,
      ] = await Promise.all([
        prisma.lead.findMany({
          where: { createdAt: { gte: cutoffDate, lte: endDateTime } },
          select: {
            id: true,
            leadCode: true,
            contactChannel: true,
            sourceWebsite: true,
            selfReportedSource: true,
            isSpam: true,
            spamAdsExclusionStatus: true,
            pipelineStatus: true,
            createdAt: true,
            activities: {
              orderBy: { createdAt: 'desc' },
              take: 3,
              select: { actionType: true, note: true, createdAt: true },
            },
            tracking: {
              select: {
                marketingSource: true,
                landingPageUrl: true,
                externalSubmissionId: true,
                isRepeatLead: true,
                isUnknownSource: true,
                isUnknownCampaign: true,
                isUtmGclidMismatch: true,
                isUnmatchedUtm: true,
                campaign: {
                  select: { id: true, campaignCode: true, campaignName: true },
                },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.campaign.findMany({
          where: {
            NOT: [
              { accountExternalId: { startsWith: 'GA4-' } },
              { campaignCode: { startsWith: 'ga4_' } },
            ],
          },
          include: {
            dailyMetrics: {
              where: {
                grain: 'campaign',
                metricDate: { gte: cutoffDateStr, lte: todayStr },
                NOT: [
                  { accountPropertyId: { startsWith: 'GA4-' } },
                  { campaignExternalId: { startsWith: 'ga4_' } },
                ],
              },
              select: { grain: true, spendMicros: true },
            },
            trackings: {
              where: {
                lead: {
                  createdAt: { gte: cutoffDate, lte: endDateTime },
                },
              },
              select: {
                isRepeatLead: true,
                lead: {
                  select: {
                    isSpam: true,
                    spamAdsExclusionStatus: true,
                    pipelineStatus: true,
                  },
                },
              },
            },
          },
          orderBy: { id: 'asc' },
        }),
        prisma.platformSyncLog.findMany({
          orderBy: { startedAt: 'desc' },
          take: 25,
        }),
        prisma.leadReconciliation.findMany({
          include: { resolvedBy: { select: { fullName: true } } },
          orderBy: { reconcileDate: 'desc' },
          take: 10,
        }),
        prisma.webhookIntakeErrorLog.findMany({
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        getStoredTouchpoints(),
        prisma.systemSetting.findUnique({ where: { key: 'google_trends_vn_live_cache_v1' } }).catch(() => null),
        prisma.systemSetting.findUnique({ where: { key: 'google_oauth_connection' } }).catch(() => null),
        getGmailLeadSyncStatus().catch(() => null),
        (async () => {
          const { getGoogleAdsApiConfig } = await import('./google-oauth.service');
          return getGoogleAdsApiConfig();
        })(),
      ]);

      let trendsFetchedAt: string | null = null;
      if (trendsSetting?.value) {
        try {
          const tp = JSON.parse(trendsSetting.value) as { fetchedAt?: string | null };
          trendsFetchedAt = tp?.fetchedAt || null;
        } catch {
          // ignore
        }
      }

      let googleConn: any = null;
      if (googleConnSetting?.value) {
        try {
          googleConn = JSON.parse(googleConnSetting.value);
        } catch {
          // ignore
        }
      }

  const touchpointsInPeriod = touchpoints.filter((tp) => new Date(tp.occurredAt) >= cutoffDate);

  const rawLeadsL1 = leads.length;
  const validLeadsL2 = leads.filter(isL2Valid).length;
  const effectiveLeadsL3 = leads.filter(isL3Effective).length;
  const repeatLeads = leads.filter((l) => l.tracking?.isRepeatLead).length;
  const unknownSourceLeads = leads.filter((l) => l.tracking?.isUnknownSource).length;
  const unknownCampaignLeads = leads.filter((l) => l.tracking?.isUnknownCampaign).length;
  const utmGclidMismatchCount = leads.filter((l) => l.tracking?.isUtmGclidMismatch).length;
  const unmatchedUtmCount = leads.filter((l) => l.tracking?.isUnmatchedUtm).length;

  // Group by Marketing Source (including mandatory rows for "Chưa xác định" & "Nhập tay" so sum is 100%)
  const sourceLabels = [
    'Google Ads',
    'Tìm kiếm tự nhiên',
    'Mạng xã hội',
    'Website giới thiệu',
    'Truy cập trực tiếp',
    'Khác',
    'Chưa xác định',
    'Nhập tay',
  ];

  const bySource: AttributionSummaryRowDto[] = sourceLabels.map((srcLabel) => {
    const bucket = leads.filter(
      (l) => (l.tracking?.marketingSource || 'Chưa xác định') === srcLabel,
    );
    const l1 = bucket.length;
    const l2 = bucket.filter(isL2Valid).length;
    const l3 = bucket.filter(isL3Effective).length;
    const rep = bucket.filter((l) => l.tracking?.isRepeatLead).length;
    const quoted = bucket.filter(
      (l) =>
        isL3Effective(l) &&
        (l.pipelineStatus === 'quote_sent' || l.pipelineStatus === 'won'),
    ).length;
    const won = bucket.filter((l) => isL3Effective(l) && l.pipelineStatus === 'won').length;

    return {
      dimensionType: 'SOURCE',
      dimensionKey: srcLabel,
      dimensionLabel: srcLabel,
      rawLeadsL1: l1,
      validLeadsL2: l2,
      effectiveLeadsL3: l3,
      repeatLeads: rep,
      quoteSentCount: quoted,
      wonCount: won,
      quoteRateText: formatRatioPct(quoted, l3),
      winRateText: formatRatioPct(won, l3),
    };
  });

  const channelKeys: ContactChannel[] = ['form_web', 'google_lead_form', 'hotline', 'zalo'];
  const byChannel: AttributionSummaryRowDto[] = channelKeys.map((ch) => {
    const bucket = leads.filter((l) => l.contactChannel === ch);
    const l1 = bucket.length;
    const l2 = bucket.filter(isL2Valid).length;
    const l3 = bucket.filter(isL3Effective).length;
    const rep = bucket.filter((l) => l.tracking?.isRepeatLead).length;
    const quoted = bucket.filter(
      (l) =>
        isL3Effective(l) &&
        (l.pipelineStatus === 'quote_sent' || l.pipelineStatus === 'won'),
    ).length;
    const won = bucket.filter((l) => isL3Effective(l) && l.pipelineStatus === 'won').length;

    return {
      dimensionType: 'CHANNEL',
      dimensionKey: ch,
      dimensionLabel: CONTACT_CHANNEL_LABELS[ch] || ch,
      rawLeadsL1: l1,
      validLeadsL2: l2,
      effectiveLeadsL3: l3,
      repeatLeads: rep,
      quoteSentCount: quoted,
      wonCount: won,
      quoteRateText: formatRatioPct(quoted, l3),
      winRateText: formatRatioPct(won, l3),
    };
  });

  const campaignDtos: CampaignItemDto[] = campaigns.map((c) => {
    const campLeads = c.trackings.map((t) => t.lead);
    const l1 = campLeads.length;
    const l2 = campLeads.filter(isL2Valid).length;
    const l3 = campLeads.filter(isL3Effective).length;
    const rep = c.trackings.filter((t) => t.isRepeatLead).length;
    const quoted = campLeads.filter(
      (l) =>
        isL3Effective(l) &&
        (l.pipelineStatus === 'quote_sent' || l.pipelineStatus === 'won'),
    ).length;
    const won = campLeads.filter((l) => isL3Effective(l) && l.pipelineStatus === 'won').length;

    const totalSpendMicros = c.dailyMetrics
      .filter((m) => m.grain === 'campaign')
      .reduce((acc, m) => acc + m.spendMicros, 0n);

    const cplMicros = l3 > 0 && totalSpendMicros > 0n ? totalSpendMicros / BigInt(l3) : null;
    const costPerQuoteMicros =
      quoted > 0 && totalSpendMicros > 0n ? totalSpendMicros / BigInt(quoted) : null;
    const costPerWonMicros =
      won > 0 && totalSpendMicros > 0n ? totalSpendMicros / BigInt(won) : null;

    return {
      id: c.id,
      platform: (c.platform.toUpperCase() as MarketingPlatform) || 'GOOGLE_ADS',
      accountExternalId: c.accountExternalId,
      campaignCode: c.campaignCode,
      campaignName: c.campaignName,
      status: c.isActive ? 'ACTIVE' : 'PAUSED',
      dailyBudget: toMonetaryAmountDto(c.dailyBudgetMicros, 'VND', 'micros'),
      isAutoSynced: c.platform === 'google_ads',
      startDate: c.createdAt.toISOString(),
      endDate: null,
      leadsCountL1: l1,
      leadsCountL2: l2,
      leadsCountL3: l3,
      repeatLeadsCount: rep,
      quoteSentCount: quoted,
      wonCount: won,
      totalSpend: toMonetaryAmountDto(totalSpendMicros, 'VND', 'micros'),
      cplEffective: toMonetaryAmountDto(cplMicros, 'VND', 'micros'),
      costPerQuote: toMonetaryAmountDto(costPerQuoteMicros, 'VND', 'micros'),
      costPerWon: toMonetaryAmountDto(costPerWonMicros, 'VND', 'micros'),
    };
  });

  const syncLogDtos: PlatformSyncStatusDto[] = syncLogs.map((s) => ({
    id: s.id,
    platform: (s.platform.toUpperCase() as MarketingPlatform) || 'GOOGLE_ADS',
    accountPropertyId: s.accountPropertyId,
    scheduleSlot: s.runType === 'full' ? 'FULL_0200' : 'LIGHT_1100',
    windowDays: s.runType === 'full' ? 30 : 2,
    status: s.status === 'success' ? 'SUCCESS' : 'FAILED',
    recordsUpserted: s.recordsSynced,
    errorMessage: s.errorMessage,
    consecutiveFailureCount: s.consecutiveFailures,
    startedAt: s.startedAt.toISOString(),
    finishedAt: s.completedAt ? s.completedAt.toISOString() : null,
  }));

  const reconciliationDtos: LeadReconciliationItemDto[] = reconciliations.map((r) => ({
    id: r.id,
    reconcileDate: r.reconcileDate,
    platform: r.platform,
    accountPropertyId: r.accountPropertyId,
    campaignExternalId: 'ALL_GOOGLE_FORMS',
    crmLeadCount: r.crmLeadCount,
    errorIntakeCount: r.crmErrorLogCount,
    platformReportedCount: r.platformReportedCount,
    discrepancyCount: r.discrepancy,
    status:
      r.status === 'alert_open'
        ? 'ALERT_OPEN'
        : r.status === 'resolved'
          ? 'RESOLVED'
          : 'MATCHED',
    resolutionNote: r.resolutionNote,
    resolvedByName: r.resolvedBy?.fullName || null,
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
  }));

  const webhookErrorDtos: WebhookIntakeErrorItemDto[] = webhookErrors.map((w) => ({
    id: w.id,
    intakeSourceProvider: w.sourcePlatform,
    intakeSourceAccountKey: w.intakeSourceAccountKey,
    sourceChannel: w.sourcePlatform,
    externalSubmissionId: w.externalSubmissionId,
    errorReason: w.errorMessage,
    status: w.isResolved ? 'REPLAYED' : 'FAILED',
    createdAt: w.createdAt.toISOString(),
    replayedAt: w.lastRetriedAt ? w.lastRetriedAt.toISOString() : null,
  }));

  const isSmallSample = rawLeadsL1 < 30;

  const isLiveGoogle = Boolean(googleConn?.connected && !googleConn?.isSandboxDemo);
  const googleAssetsHub = await buildGoogleAssetsHub(dateRange.totalCalendarDays, googleConn);

  const latestByPlatform = (platformKey: string) => {
    const allLogs = syncLogs.filter((s) => s.platform.toLowerCase() === platformKey);
    const lastAttempt = allLogs[0] || null;
    const lastSuccess = allLogs.find((s) => s.status === 'success' || s.status === 'partial') || null;
    return { lastAttempt, lastSuccess };
  };

  const ga4Sync = latestByPlatform('ga4');
  const gscSync =
    latestByPlatform('search_console').lastAttempt || latestByPlatform('search_console').lastSuccess
      ? latestByPlatform('search_console')
      : latestByPlatform('google_search_console');
  const adsSync = latestByPlatform('google_ads');
  const hasAdsConnected = Boolean(
    adsCfg?.developerToken ||
      (isLiveGoogle &&
        ((Array.isArray(googleConn?.scopes) &&
          googleConn.scopes.some((s: unknown) => String(s).includes('adwords'))) ||
          googleConn?.selectedGadsCustomerId ||
          googleConn?.detectedGadsCustomerId ||
          adsSync.lastSuccess)),
  );

  const sourceStatuses = [
    {
      sourceKey: 'CRM_LEADS',
      sourceName: 'Lead nội bộ CRM',
      connectionStatus: 'CONNECTED',
      backendSchedule: 'Ghi nhận tức thời + kiểm tra nền mỗi 15–30 giây',
      sourceLatency: 'Thời gian thực (< 1 giây)',
      lastAttemptAt: leads[0]?.createdAt?.toISOString() || null,
      lastSuccessAt: leads[0]?.createdAt?.toISOString() || null,
      dataRangeCovered: `${cutoffDateStr} → ${todayStr}`,
      quotaOrLimitNote: 'Truy vấn DB nội bộ; không giới hạn quota Google.',
      isUsingCachedData: false,
    },
    {
      sourceKey: 'GMAIL_INTAKE',
      sourceName: 'Gmail tiếp nhận Lead',
      connectionStatus:
        gmailStatus?.serverStatus === 'RUNNING'
          ? 'CONNECTED'
          : gmailStatus?.serverStatus === 'PAUSED'
            ? 'PAUSED'
            : 'ERROR',
      backendSchedule:
        gmailStatus?.syncMode === 'GMAIL_PUSH_WITH_RECONCILIATION'
          ? `Gmail Push + đối soát mỗi ${gmailStatus.config.pollIntervalSec}s`
          : `Poller backend mỗi ${gmailStatus?.config.pollIntervalSec || 30}s`,
      sourceLatency: '~30–60 giây (Poller); Push vẫn có thể trễ nên luôn có quét đối soát dự phòng',
      lastAttemptAt: gmailStatus?.lastAttemptAt || gmailStatus?.config.lastSyncAt || null,
      lastSuccessAt: gmailStatus?.checkpoint?.lastSuccessAt || null,
      dataRangeCovered: gmailStatus?.checkpoint?.lastProcessedInternalDateMs
        ? `Checkpoint đến ${new Date(gmailStatus.checkpoint.lastProcessedInternalDateMs).toLocaleString('vi-VN')}`
        : 'Chưa có checkpoint',
      quotaOrLimitNote:
        gmailStatus?.pushLimitationReason ||
        'Quyền gmail.readonly; phân trang nextPageToken tối đa 250 thư/lượt.',
      isUsingCachedData: false,
    },
    {
      sourceKey: 'GA4_REALTIME',
      sourceName: 'GA4 Realtime (30 phút)',
      connectionStatus: isLiveGoogle
        ? ga4Sync.lastAttempt?.status === 'failed'
          ? 'ERROR_CACHED'
          : 'CONNECTED'
        : 'UNCONFIGURED',
      backendSchedule: 'Cache dùng chung ở server (TTL 60s), không gọi API theo từng tab người dùng',
      sourceLatency: 'Cửa sổ 30 phút gần nhất (activeUsers30m)',
      lastAttemptAt: ga4Sync.lastAttempt?.startedAt?.toISOString() || null,
      lastSuccessAt: ga4Sync.lastSuccess?.completedAt?.toISOString() || null,
      dataRangeCovered: '30 phút gần nhất',
      quotaOrLimitNote: 'Google Analytics Data API runRealtimeReport (giới hạn quota theo property).',
      isUsingCachedData: ga4Sync.lastAttempt?.status === 'failed' && Boolean(ga4Sync.lastSuccess),
    },
    {
      sourceKey: 'GA4_REPORTS',
      sourceName: 'GA4 Báo cáo chuẩn',
      connectionStatus: isLiveGoogle
        ? ga4Sync.lastAttempt?.status === 'failed'
          ? 'ERROR_CACHED'
          : 'CONNECTED'
        : 'UNCONFIGURED',
      backendSchedule: 'Lịch nền 02:00 / 11:00 / 17:00 (đối soát tăng dần 2–30 ngày gần nhất)',
      sourceLatency: 'Không mới theo phút; Standard intraday thường trễ 2–6 giờ và còn thay đổi',
      lastAttemptAt: ga4Sync.lastAttempt?.startedAt?.toISOString() || null,
      lastSuccessAt: ga4Sync.lastSuccess?.completedAt?.toISOString() || null,
      dataRangeCovered: `${cutoffDateStr} → ${todayStr}`,
      quotaOrLimitNote: 'Unique users toàn kỳ dùng PERIOD_SNAPSHOT; không cộng dồn từng ngày.',
      isUsingCachedData: ga4Sync.lastAttempt?.status === 'failed' && Boolean(ga4Sync.lastSuccess),
    },
    {
      sourceKey: 'GOOGLE_ADS',
      sourceName: 'Google Ads',
      connectionStatus: hasAdsConnected
        ? adsSync.lastAttempt?.status === 'failed'
          ? 'ERROR_CACHED'
          : 'CONNECTED'
        : 'UNCONFIGURED',
      backendSchedule: hasAdsConnected
        ? 'Lịch nền 02:00 / 11:00 / 17:00 (đối soát tăng dần)'
        : 'Chưa kết nối Google OAuth quyền Google Ads',
      sourceLatency: 'Clicks, impressions, cost cập nhật theo giờ; search terms chậm hơn',
      lastAttemptAt: adsSync.lastAttempt?.startedAt?.toISOString() || null,
      lastSuccessAt: adsSync.lastSuccess?.completedAt?.toISOString() || null,
      dataRangeCovered: hasAdsConnected ? `${cutoffDateStr} → ${todayStr}` : 'Chưa cấu hình',
      quotaOrLimitNote: hasAdsConnected
        ? adsCfg?.developerToken
          ? 'Google Ads API v17+'
          : 'Google Ads API v26 (OAuth 2.0)'
        : 'Chưa kết nối tài khoản Google OAuth quyền Google Ads (không hiển thị số 0 giả).',
      isUsingCachedData: false,
    },
    {
      sourceKey: 'SEARCH_CONSOLE',
      sourceName: 'Google Search Console',
      connectionStatus: isLiveGoogle
        ? gscSync.lastAttempt?.status === 'failed'
          ? 'ERROR_CACHED'
          : 'CONNECTED'
        : 'UNCONFIGURED',
      backendSchedule: 'Lịch nền 02:00 / 11:00 / 17:00 (đối soát lại 7–30 ngày gần nhất)',
      sourceLatency: 'Có dữ liệu theo giờ nhưng dữ liệu gần nhất vẫn trễ và có thể chưa đầy đủ (xác định từ dataState)',
      lastAttemptAt: gscSync.lastAttempt?.startedAt?.toISOString() || null,
      lastSuccessAt: gscSync.lastSuccess?.completedAt?.toISOString() || null,
      dataRangeCovered: `${cutoffDateStr} → ${todayStr}`,
      quotaOrLimitNote: 'Phân biệt FINALIZED / PRELIMINARY / UNKNOWN / QUERY_ERROR theo metadata nguồn.',
      isUsingCachedData: gscSync.lastAttempt?.status === 'failed' && Boolean(gscSync.lastSuccess),
    },
    {
      sourceKey: 'GOOGLE_TRENDS',
      sourceName: 'Google Trends Việt Nam',
      connectionStatus: trendsFetchedAt ? 'CONNECTED' : 'UNCONFIGURED',
      backendSchedule: 'Cache tự động 15 phút (RSS xu hướng ngày VN + Google Suggest VN) & nhập CSV / SerpApi',
      sourceLatency: 'Gần thời gian thực (TTL 15 phút)',
      lastAttemptAt: trendsFetchedAt,
      lastSuccessAt: trendsFetchedAt,
      dataRangeCovered: 'Xu hướng ngày Việt Nam + Chủ đề ngành LED',
      quotaOrLimitNote: 'Tích hợp trực tiếp Google Trends RSS VN + Google Suggest VN; hỗ trợ SerpApi (0–100) & multiTimeline.csv.',
      isUsingCachedData: Boolean(trendsFetchedAt),
    },
  ];

  const hostingLimitationNote =
    'Tác vụ nền (Gmail Poller & Scheduler 02:00/11:00/17:00) chạy trong tiến trình Node.js khi server đang bật; nếu triển khai lên môi trường serverless/tự ngủ (auto-sleep), cần cấu hình cron ngoài gọi vào worker.';

  return {
    periodDays: dateRange.totalCalendarDays,
    dateRange: {
      startDateStr: dateRange.startDateStr,
      endDateStr: dateRange.endDateStr,
      totalCalendarDays: dateRange.totalCalendarDays,
      isTodayIncluded: dateRange.isTodayIncluded,
      timezone: dateRange.timezone,
    },
    isSmallSample,
    smallSampleNote: isSmallSample
      ? 'Mẫu nhỏ (< 30 Lead trong kỳ lọc), tỷ lệ chuyển đổi chỉ mang tính tham khảo (UC03 Luồng C).'
      : null,
    todayPreliminaryNotice:
      'Số liệu ngày hôm nay chưa kết thúc ngày; lịch đồng bộ 02:00 / 11:00 / 17:00 chỉ là thời điểm kéo dữ liệu, không bảo đảm nguồn Google đã chốt xong số liệu (kiểm tra theo metadata/dataState của từng nguồn).',
    sourceStatuses,
    hostingLimitationNote,
    liveIntegrationMode: (isLiveGoogle || process.env.GOOGLE_ADS_DEVELOPER_TOKEN)
      ? ('LIVE_CONFIGURED' as const)
      : ('FIXTURE_SIMULATION' as const),
    lastSyncedAt:
      syncLogs.find((s) => s.status === 'success' || s.status === 'partial')?.completedAt?.toISOString() ||
      syncLogs[0]?.completedAt?.toISOString() ||
      null,
    totals: {
      rawLeadsL1,
      validLeadsL2,
      effectiveLeadsL3,
      repeatLeads,
      unknownSourceLeads,
      unknownCampaignLeads,
      utmGclidMismatchCount,
      unmatchedUtmCount,
      openReconciliationAlerts: reconciliationDtos.filter((r) => r.status === 'ALERT_OPEN').length,
      consecutiveSyncFailureAlerts: syncLogs.filter((s) => s.consecutiveFailures >= 3).length,
    },
    bySource,
    byChannel,
    campaigns: campaignDtos,
    syncLogs: syncLogDtos,
    reconciliations: reconciliationDtos,
    webhookErrors: webhookErrorDtos,
    googleAssetsHub,
    sourceVsSelfReported: leads.slice(0, 15).map((l) => ({
      leadCode: l.leadCode,
      sourceWebsite: l.sourceWebsite || 'Chưa xác định website',
      contactChannel: CONTACT_CHANNEL_LABELS[l.contactChannel as ContactChannel] || l.contactChannel,
      marketingSource: l.tracking?.marketingSource || 'Chưa xác định',
      selfReportedSource: l.selfReportedSource,
      utmGclidMismatch: l.tracking?.isUtmGclidMismatch ?? false,
      createdAt: l.createdAt.toISOString(),
    })),
    touchpointSummary: {
      productViews: touchpointsInPeriod.filter((t) => t.eventType === 'product_view').length,
      contactClicks: touchpointsInPeriod.filter((t) => t.eventType === 'contact_click').length,
      formSubmits: touchpointsInPeriod.filter((t) => t.eventType === 'form_submit_success').length,
      createdLeads: leads.length,
    },
    leadJourneys: leads.slice(0, 15).map((l) => {
      const linkedTouchpoints = touchpointsInPeriod.filter(
        (t) =>
          (t.leadCode && t.leadCode === l.leadCode) ||
          (t.submissionId && l.tracking?.externalSubmissionId && t.submissionId === l.tracking.externalSubmissionId),
      );
      return {
        leadCode: l.leadCode,
        sourceWebsite: l.sourceWebsite || 'Chưa xác định website',
        landingPageUrl: l.tracking?.landingPageUrl || null,
        marketingSource: l.tracking?.marketingSource || 'Chưa xác định',
        campaignName: l.tracking?.campaign?.campaignName || null,
        pipelineStatus: l.pipelineStatus,
        touchpointsCount: linkedTouchpoints.length,
        recentActions:
          l.activities?.map((a) => a.actionType).filter(Boolean) || [],
        createdAt: l.createdAt.toISOString(),
      };
    }),
  };
    },
  });
  return cacheResult.data;
}

async function buildGoogleAssetsHub(periodDays: number = 30, preloadedConn?: any) {
  let conn: any = preloadedConn ?? null;
  if (!preloadedConn) {
    try {
      const setting = await prisma.systemSetting.findUnique({
        where: { key: 'google_oauth_connection' },
      });
      if (setting?.value) {
        conn = JSON.parse(setting.value);
      }
    } catch {
      // ignore
    }
  }

  const dateRange = getCanonicalDateRange(periodDays);
  const windowStartDate = dateRange.startDateStr;
  const todayStr = dateRange.endDateStr;
  const fallback30Range = getCanonicalDateRange(30);

  const minStartDate =
    windowStartDate < fallback30Range.startDateStr
      ? windowStartDate
      : fallback30Range.startDateStr;

  // Retrieve sync logs, GA4/GSC/Ads daily metrics, active Ads campaigns, and GSC metadata in parallel
  const [ga4Logs, scLogs, combinedMetrics, gscMetadataMap, realAdsCampaigns, realAdsMetrics] = await Promise.all([
    prisma.platformSyncLog.findMany({
      where: { platform: 'ga4' },
      orderBy: { startedAt: 'desc' },
      take: 10,
    }),
    prisma.platformSyncLog.findMany({
      where: { platform: 'search_console' },
      orderBy: { startedAt: 'desc' },
      take: 10,
    }),
    prisma.platformDailyMetric.findMany({
      where: {
        platform: { in: ['ga4', 'search_console'] },
        metricDate: {
          gte: minStartDate,
          lte: todayStr,
        },
      },
      orderBy: { metricDate: 'desc' },
    }),
    getGscDataStateMetadataMap(),
    prisma.campaign.findMany({
      where: {
        platform: 'google_ads',
        isActive: true,
        NOT: [
          { accountExternalId: { startsWith: 'GA4-' } },
          { campaignCode: { startsWith: 'ga4_' } },
        ],
      },
    }),
    prisma.platformDailyMetric.findMany({
      where: {
        platform: 'google_ads',
        grain: 'campaign',
        metricDate: {
          gte: windowStartDate,
          lte: todayStr,
        },
        NOT: [
          { accountPropertyId: { startsWith: 'GA4-' } },
          { campaignExternalId: { startsWith: 'ga4_' } },
        ],
      },
    }),
  ]);

  const rawGa4Metrics = combinedMetrics.filter(
    (m) => m.platform === 'ga4' && m.metricDate >= windowStartDate,
  );
  const rawScMetrics = combinedMetrics.filter(
    (m) => m.platform === 'search_console' && m.metricDate >= windowStartDate,
  );
  const fallbackGa4Metrics = combinedMetrics.filter(
    (m) => m.platform === 'ga4' && m.metricDate >= fallback30Range.startDateStr,
  );
  const fallbackScMetrics = combinedMetrics.filter(
    (m) => m.platform === 'search_console' && m.metricDate >= fallback30Range.startDateStr,
  );

  const ga4Metrics = rawGa4Metrics.length > 0 ? rawGa4Metrics : fallbackGa4Metrics;
  const scMetrics = rawScMetrics.length > 0 ? rawScMetrics : fallbackScMetrics;
  const usingGa4FallbackWindow = rawGa4Metrics.length === 0 && fallbackGa4Metrics.length > 0;
  const usingScFallbackWindow = rawScMetrics.length === 0 && fallbackScMetrics.length > 0;

  const latestGa4Success = ga4Logs.find((l) => l.status === 'success');
  const latestGa4Log = ga4Logs[0];

  const latestScSuccess = scLogs.find((l) => l.status === 'success');
  const latestScLog = scLogs[0];

  // Discover properties strictly constrained to authorized company property IDs
  const defaultProps = [
    { id: '512879968', name: 'toantrung.com.vn', domain: 'toantrung.com.vn', url: 'https://toantrung.com.vn' },
    { id: '509190194', name: 'manhinhled.net.vn', domain: 'manhinhled.net.vn', url: 'https://manhinhled.net.vn' },
    { id: '538179128', name: 'bangled.vn', domain: 'bangled.vn', url: 'https://bangled.vn' },
    { id: '508951192', name: 'Toàn Trung - Bảng điện tử', domain: 'toantrung.com.vn', url: 'https://toantrung.com.vn' },
  ];

  const discoveredGa4Resources: Array<{ id: string; name: string }> = Array.isArray(conn?.accessibleResources)
    ? conn.accessibleResources.filter((r: any) => r.type === 'GA4_PROPERTY')
    : [];

  const ga4PropertiesDefs =
    discoveredGa4Resources.length > 0
      ? discoveredGa4Resources
          .filter((r) => ALLOWED_COMPANY_GA4_PROPERTY_IDS.includes(r.id))
          .map((r) => {
            const cleanName = r.name.replace(/^GA4:\s*/i, '').trim();
            const matchedDefault = defaultProps.find((d) => d.id === r.id);
            return {
              id: r.id,
              name: cleanName,
              domain: matchedDefault?.domain || cleanName,
              url: matchedDefault?.url || `https://${cleanName}`,
            };
          })
      : defaultProps;

  const ga4Properties = ga4PropertiesDefs.map((def) => {
    const propMetrics = ga4Metrics.filter((m) => m.accountPropertyId === def.id);
    const snapshotKey = `PERIOD_SNAPSHOT:${dateRange.totalCalendarDays}D:${dateRange.startDateStr}_${dateRange.endDateStr}`;
    const accountRows = propMetrics.filter((m) => m.grain === 'account' && !m.campaignExternalId?.startsWith('PERIOD_SNAPSHOT'));
    const pageRows = propMetrics.filter((m) => m.grain === 'page');
    const periodSnapshot = propMetrics.find((m) => m.grain === 'account' && m.campaignExternalId === snapshotKey && m.metricDate === todayStr);

    const hasAccountRows = accountRows.length > 0;
    const totalViews = hasAccountRows ? accountRows.reduce((sum, r) => sum + r.pageViews, 0) : null;
    const totalEvents = hasAccountRows ? accountRows.reduce((sum, r) => sum + r.impressions, 0) : null;

    // Multi-day deduplication handling:
    // 1. For 1 day (today), daily activeUsers is the exact unique active users.
    // 2. For multi-day periods, if periodSnapshot exists from provider matching exact period metadata, that is the true deduplicated count.
    // 3. If period snapshot is pending, fallback to sumDailyActiveUsers with isEstimatedPeriodUsers flag so UI is never blank.
    const sumDailyActiveUsers = hasAccountRows ? accountRows.reduce((sum, r) => sum + r.clicks, 0) : null;
    const deduplicatedPeriodUsers = periodSnapshot ? periodSnapshot.clicks : null;

    let activeUsers: number | null = null;
    let isEstimatedPeriodUsers = false;
    if (periodDays <= 1) {
      activeUsers = sumDailyActiveUsers;
    } else if (deduplicatedPeriodUsers !== null) {
      activeUsers = deduplicatedPeriodUsers;
    } else {
      activeUsers = sumDailyActiveUsers;
      isEstimatedPeriodUsers = true;
    }

    let status: 'HAS_DATA' | 'CONFIRMED_ZERO' | 'FAILED_SYNC' | 'STALE_DATA_WITH_ERROR' | 'LEGACY_UNVERIFIED' | 'NOT_SYNCED' | 'NOT_CONNECTED' = 'NOT_SYNCED';
    let statusMessage = 'Chưa có bản ghi đồng bộ cho khoảng thời gian này (Bấm Đồng bộ ngay)';

    const hasSuccessfulSyncLog = ga4Logs.some((l) => l.status === 'success' || l.status === 'partial');
    const isHistoricalSnapshotOnly = !hasSuccessfulSyncLog && accountRows.length > 0;

    if (!conn?.connected) {
      status = 'NOT_CONNECTED';
      statusMessage = 'Chưa liên kết tài khoản Google OAuth';
    } else if (latestGa4Log && latestGa4Log.status === 'failed') {
      status = hasAccountRows ? 'STALE_DATA_WITH_ERROR' : 'FAILED_SYNC';
      statusMessage = `Đồng bộ thất bại: ${latestGa4Log.errorMessage || 'Lỗi GA4 API'}`;
    } else if (hasAccountRows) {
      if (isHistoricalSnapshotOnly) {
        status = 'LEGACY_UNVERIFIED';
        statusMessage = 'Bản ghi lịch sử (Chưa đối soát qua phiên đồng bộ Google API chính thức)';
      } else if ((totalViews ?? 0) === 0 && (sumDailyActiveUsers ?? 0) === 0) {
        status = 'CONFIRMED_ZERO';
        statusMessage = 'Xác minh từ GA4 API: 0 lượt truy cập trong kỳ';
      } else {
        status = 'HAS_DATA';
        statusMessage = periodDays <= 1
          ? 'Xác minh từ GA4 API: Người dùng hoạt động thực tế trong ngày'
          : deduplicatedPeriodUsers !== null
            ? 'Xác minh từ GA4 API: Người dùng duy nhất đã khử trùng lặp toàn kỳ'
            : `Xác minh từ GA4 API: Đã có ${totalViews} lượt xem (Người dùng đa ngày cần snapshot khử trùng lặp khớp kỳ ${dateRange.startDateStr} đến ${dateRange.endDateStr})`;
      }
    }

    // Group top landing pages
    const pageMap = new Map<string, { views: number; totalDur: number }>();
    for (const p of pageRows) {
      const url = p.pageUrlRaw || '/';
      const cur = pageMap.get(url) || { views: 0, totalDur: 0 };
      cur.views += p.pageViews;
      cur.totalDur += (p.avgTimeOnPageSec || 0) * p.pageViews;
      pageMap.set(url, cur);
    }
    const topPages = Array.from(pageMap.entries())
      .sort((a, b) => b[1].views - a[1].views)
      .slice(0, 6)
      .map(([path, stats]) => ({
        path,
        views: stats.views,
        avgDurationSec: stats.views > 0 ? Math.round((stats.totalDur / stats.views) * 10) / 10 : 0,
      }));

    return {
      id: def.id,
      name: def.name,
      domain: def.domain,
      url: def.url,
      activeUsers,
      sumDailyActiveUsers,
      deduplicatedPeriodUsers,
      pageViews: totalViews,
      eventCount: totalEvents,
      status,
      statusMessage,
      source: `Google Analytics 4 API (property/${def.id})`,
      reportingPeriod: usingGa4FallbackWindow
        ? `${fallback30Range.startDateStr} đến ${todayStr} (Lũy kế gần nhất · Google trễ 24h cho ngày hôm nay)`
        : `${windowStartDate} đến ${todayStr}`,
      lastSyncAt: latestGa4Success?.completedAt?.toISOString() || (conn as any)?.ga4LastSyncAt || null,
      lastAttemptAt: latestGa4Log?.startedAt?.toISOString() || (conn as any)?.lastAttemptAt || null,
      consecutiveFailures: latestGa4Log?.consecutiveFailures ?? 0,
      isEstimatedPeriodUsers: periodDays > 1 && deduplicatedPeriodUsers === null,
      isPartialDay: periodDays <= 1,
      topPages,
    };
  });

  const discoveredScSites: Array<{ id: string; name: string }> = Array.isArray(conn?.accessibleResources)
    ? conn.accessibleResources.filter((r: any) => r.type === 'SEARCH_CONSOLE_SITE')
    : [];

  const sitesDefs =
    discoveredScSites.length > 0
      ? discoveredScSites
          .filter((s) => ALLOWED_COMPANY_GSC_SITES.includes(s.id))
          .map((s) => s.id)
      : ['https://toantrung.com.vn/', 'https://manhinhled.net.vn/', 'https://bangled.vn/'];

  const searchConsoleSites = sitesDefs.map((siteUrl) => {
    const siteMeta = gscMetadataMap[siteUrl] || null;
    const siteRows = scMetrics.filter((m) => m.accountPropertyId === siteUrl);
    const siteAccountRows = siteRows.filter((m) => m.grain === 'account');
    // Exclude the 75 legacy cumulative snapshot rows (id <= 1000) that were incorrectly stored as daily records on 2026-11-11
    const siteKeywordRows = siteRows.filter((m) => m.grain === 'keyword' && m.id > 1000);

    const hasAccountRows = siteAccountRows.length > 0;
    const totalClicks = hasAccountRows
      ? siteAccountRows.reduce((sum, r) => sum + r.clicks, 0)
      : null;
    const totalImpressions = hasAccountRows
      ? siteAccountRows.reduce((sum, r) => sum + r.impressions, 0)
      : null;

    let status: 'HAS_DATA' | 'CONFIRMED_ZERO' | 'KEYWORD_ONLY' | 'FAILED_SYNC' | 'STALE_DATA_WITH_ERROR' | 'NOT_SYNCED' | 'NOT_CONNECTED' = 'NOT_SYNCED';
    let statusMessage = 'Chưa có bản ghi đồng bộ tổng site trong khoảng thời gian này';

    if (!conn?.connected) {
      status = 'NOT_CONNECTED';
      statusMessage = 'Chưa liên kết tài khoản Google OAuth';
    } else if (siteMeta?.lastQueryStatus === 'QUERY_ERROR' || (latestScLog && latestScLog.status === 'failed')) {
      status = hasAccountRows ? 'STALE_DATA_WITH_ERROR' : 'FAILED_SYNC';
      statusMessage = `Truy vấn lỗi: ${siteMeta?.lastQueryError || latestScLog?.errorMessage || 'Lỗi Search Console'}`;
    } else if (hasAccountRows) {
      if ((totalClicks ?? 0) === 0 && (totalImpressions ?? 0) === 0) {
        status = 'CONFIRMED_ZERO';
        statusMessage = 'Xác nhận từ Search Console: 0 click & 0 hiển thị trong kỳ';
      } else {
        status = 'HAS_DATA';
        statusMessage = 'Dữ liệu xác minh từ Google Search Console';
      }
    } else if (siteKeywordRows.length > 0) {
      status = 'KEYWORD_ONLY';
      statusMessage = 'Đã có danh sách từ khóa theo ngày, chưa có bản ghi tổng hợp site';
    } else if (siteMeta?.lastQueryStatus === 'OK') {
      // R01: Không coi ngày không có dòng luôn là lỗi đồng bộ — nếu truy vấn thành công nhưng 0 dòng tức là 0 lượt hiển thị
      status = 'CONFIRMED_ZERO';
      statusMessage = 'Truy vấn GSC thành công: Không phát sinh dòng hiển thị/click trong kỳ';
    }

    // Group keywords
    const kwMap = new Map<string, { clicks: number; impressions: number }>();
    for (const r of siteKeywordRows) {
      const kw = (r.keywordRaw || '').trim();
      if (!kw || kw.toLowerCase() === 'null' || kw === '(not set)') continue;
      const cur = kwMap.get(kw) || { clicks: 0, impressions: 0 };
      cur.clicks += r.clicks;
      cur.impressions += r.impressions;
      kwMap.set(kw, cur);
    }

    const topQueries = Array.from(kwMap.entries())
      .sort((a, b) => b[1].clicks - a[1].clicks || b[1].impressions - a[1].impressions)
      .slice(0, 10)
      .map(([keyword, stats]) => ({
        keyword,
        clicks: stats.clicks,
        impressions: stats.impressions,
        ctrText: stats.impressions > 0 ? `${((stats.clicks / stats.impressions) * 100).toFixed(1)}%` : '0%',
      }));

    const sortedAccountDates = Array.from(new Set(siteAccountRows.map((r) => r.metricDate))).sort();
    const earliestMetricDate = sortedAccountDates[0] || null;
    const latestMetricDate = sortedAccountDates[sortedAccountDates.length - 1] || null;
    const observedInclusiveDays =
      earliestMetricDate && latestMetricDate
        ? countInclusiveCalendarDays(earliestMetricDate, latestMetricDate)
        : 0;

    // R01: Phân loại từng ngày theo metadata nguồn (`FINALIZED` | `PRELIMINARY` | `UNKNOWN` | `QUERY_ERROR`), không đoán theo >= 3 ngày
    let finalizedDaysCount = 0;
    let preliminaryDaysCount = 0;
    let unknownStateDaysCount = 0;

    for (const d of sortedAccountDates) {
      const dState = classifyGscDateBySourceMetadata(d, siteMeta);
      if (dState === 'FINALIZED') finalizedDaysCount++;
      else if (dState === 'PRELIMINARY') preliminaryDaysCount++;
      else unknownStateDaysCount++;
    }

    const zeroRowDaysCount =
      observedInclusiveDays > 0
        ? Math.max(0, observedInclusiveDays - sortedAccountDates.length)
        : 0;

    const dataCompletenessState: 'FINALIZED' | 'PRELIMINARY' | 'UNKNOWN' | 'QUERY_ERROR' =
      siteMeta?.lastQueryStatus === 'QUERY_ERROR' || (latestScLog && latestScLog.status === 'failed')
        ? 'QUERY_ERROR'
        : sortedAccountDates.length === 0
          ? siteMeta?.lastQueryStatus === 'OK'
            ? 'FINALIZED'
            : 'UNKNOWN'
          : unknownStateDaysCount > 0
            ? 'UNKNOWN'
            : preliminaryDaysCount > 0
              ? 'PRELIMINARY'
              : 'FINALIZED';

    return {
      siteUrl,
      domain: siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''),
      totalQueries: kwMap.size,
      totalClicks,
      totalImpressions,
      daysWithDataCount: sortedAccountDates.length,
      observedInclusiveDays,
      zeroRowDaysCount,
      finalizedDaysCount,
      unfinalizedDaysCount: preliminaryDaysCount,
      preliminaryDaysCount,
      unknownStateDaysCount,
      dataCompletenessState,
      earliestMetricDate,
      latestMetricDate,
      hasIncompleteData: dataCompletenessState === 'PRELIMINARY' || dataCompletenessState === 'UNKNOWN',
      status,
      statusMessage,
      source: `Google Search Console API (${siteUrl})`,
      reportingPeriod: usingScFallbackWindow
        ? `${fallback30Range.startDateStr} đến ${todayStr} (Lũy kế gần nhất · GSC trễ 24-48h cho ngày hôm nay)`
        : `${windowStartDate} đến ${todayStr}`,
      lastSyncAt: latestScSuccess?.completedAt?.toISOString() || (conn as any)?.scLastSyncAt || null,
      lastAttemptAt: latestScLog?.startedAt?.toISOString() || (conn as any)?.lastAttemptAt || null,
      consecutiveFailures: latestScLog?.consecutiveFailures ?? 0,
      topQueries,
    };
  });

  // Aggregate Google Ads spend from parallel pre-fetched metrics
  const hasAdsMetrics = realAdsMetrics.length > 0;
  const totalAdsSpendMicros = realAdsMetrics.reduce((sum, m) => sum + (m.spendMicros || 0n), 0n);
  const totalAdsSpendVnd = hasAdsMetrics ? Number(totalAdsSpendMicros / 1_000_000n) : null;

  let adsStatus: 'ACTIVE_SPEND' | 'ZERO_SPEND_READY' | 'CONFIRMED_ZERO' | 'UNAVAILABLE' | 'UNCONFIGURED' = 'UNAVAILABLE';
  let adsMessage = '';

  if (!conn?.connected) {
    adsStatus = 'UNCONFIGURED';
    adsMessage = 'Chưa liên kết tài khoản Google OAuth';
  } else if (!conn?.selectedGadsCustomerId && !conn?.detectedGadsCustomerId) {
    adsStatus = 'UNCONFIGURED';
    adsMessage = 'Chưa chọn Customer ID Google Ads trong cấu hình kết nối';
  } else if (hasAdsMetrics) {
    if (totalAdsSpendVnd !== null && totalAdsSpendVnd > 0) {
      adsStatus = 'ACTIVE_SPEND';
      adsMessage = `Đang quản lý ${realAdsCampaigns.length} chiến dịch Google Ads với chi phí ${totalAdsSpendVnd.toLocaleString('vi-VN')} đ trong kỳ`;
    } else {
      adsStatus = 'CONFIRMED_ZERO';
      adsMessage = 'Xác minh từ Google Ads API: 0 đ chi phí trong kỳ';
    }
  } else {
    adsStatus = 'UNAVAILABLE';
    adsMessage = 'Chưa có bản ghi chi phí Google Ads cho kỳ này (Nhập từ file Excel/CSV hoặc kích hoạt Google Ads API)';
  }

  return {
    connectedEmail: conn?.connectedEmail || null,
    connectedName: conn?.connectedName || null,
    lastSyncAt: conn?.lastSyncAt || null,
    ga4: {
      totalProperties: ga4Properties.length,
      properties: ga4Properties,
    },
    searchConsole: {
      totalSites: searchConsoleSites.length,
      sites: searchConsoleSites,
    },
    googleAds: {
      connectedEmail: conn?.connectedEmail || null,
      customerId: conn?.selectedGadsCustomerId || conn?.detectedGadsCustomerId || 'Chưa liên kết Customer ID',
      status: adsStatus as any,
      activeCampaignsCount: realAdsCampaigns.length,
      totalSpendVnd: totalAdsSpendVnd,
      spendVndText: totalAdsSpendVnd !== null ? `${totalAdsSpendVnd.toLocaleString('vi-VN')} đ` : '—',
      source: 'Google Ads API / Nhập file Excel báo cáo Ads',
      statusMessage: adsMessage,
    },
    googleTrends: (() => {
      const mergedQueries = searchConsoleSites
        .flatMap((s) =>
          s.topQueries.map((q) => ({
            ...q,
            domain: s.domain,
          })),
        )
        .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
        .slice(0, 6);
      const maxImp = Math.max(...mergedQueries.map((q) => q.impressions), 100);
      const derivedTopics = mergedQueries.map((q) => ({
        topic: `${q.keyword} (${q.domain})`,
        interestScore: Math.min(100, Math.max(25, Math.round((q.impressions / maxImp) * 85 + (q.clicks > 5 ? 15 : 5)))),
        trend: (q.clicks >= 10 || q.impressions >= 200 ? 'rising' : 'stable') as 'rising' | 'stable',
        searchQuery: `${q.clicks} clicks · ${q.impressions.toLocaleString('vi-VN')} hiển thị (${q.ctrText} CTR)`,
      }));
      return {
        status: derivedTopics.length > 0 ? ('LIVE_SEARCH_DEMAND' as const) : ('RESTRICTED_ACCESS' as const),
        marketCluster:
          derivedTopics.length > 0
            ? 'Tổng hợp trực tiếp từ Xu hướng Tìm kiếm Thực tế trên Google Search Console (3 Website Toàn Trung)'
            : 'Chưa có dữ liệu từ khóa tìm kiếm thực tế trong kỳ.',
        topics: derivedTopics,
      };
    })(),
  };
}
