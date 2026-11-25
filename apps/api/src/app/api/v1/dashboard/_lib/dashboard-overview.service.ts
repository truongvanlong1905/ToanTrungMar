import { prisma } from '@toantrung/database';
import { buildStandardXlsxBuffer } from '../../../../../core/export/xlsx-builder';
import { getOrComputeScopedCache } from '../../../../../core/cache/server-data-cache';
import {
  countInclusiveCalendarDays,
  formatVietnamDateTime,
  getCanonicalDateRange,
  getCustomCanonicalDateRange,
  getVietnamDateParts,
  resolveDatePresetRange,
} from '../../../../../core/reporting-dates';
import {
  getConfiguredWebsites,
  matchesWebsiteDomain,
  normalizeDomainKey,
} from '../../../../../core/website-catalog';
import {
  PIPELINE_STATUS_LABELS,
  formatContactChannelClean,
  hasBaPermission,
  isL2Valid,
  isL3Effective,
  normalizeMarketingChannelDisplay,
  sanitizeProjectOrSubjectText,
  sanitizeWebsiteSourceDisplay,
  toMonetaryAmountDto,
  type ActionableTaskItemDto,
  type ContactChannel,
  type DetailedReportLeadRowDto,
  type LeadTrendPointDto,
  type MarketingSourcePerformanceRowDto,
  type PipelineStatus,
  type ProductInsightRowDto,
  type ReportsDashboardDto,
  type SalesPerformanceRowDto,
  type SessionUserDto,
  type UnansweredQuoteItemDto,
  type WebsiteConfigItemDto,
  type WebsiteOverviewItemDto,
} from '@toantrung/contracts';
import { shouldAnonymizeLeadForRole } from '../../../../../modules/01-leads/service';
import { getUserCoverMap } from '../../../../../core/auth/service';
import { getGa4LiveSnapshotsForProperties } from '../../../../../modules/02-tracking-sync/ga4-live-cache.service';
import { getGoogleConnection } from '../../../../../modules/02-tracking-sync/google-oauth.service';
import { AiDesignProviderFactory } from '../../../../../modules/05-ai-design/providers';

function isAnonymizedViewerRole(roleCode: SessionUserDto['roleCode']): boolean {
  return shouldAnonymizeLeadForRole(roleCode) || roleCode === 'DESIGNER';
}

function maskPhoneForReport(phone: string | null): string {
  if (!phone || phone.length < 7) return '***';
  return `${phone.slice(0, 4)}***${phone.slice(-3)}`;
}

function maskCustomerCompanyForReport(text: string): string {
  if (!text) return 'Khách hàng ẩn danh';
  return 'Khách hàng ẩn danh (Bảo mật kinh doanh)';
}

function mapProductCategory(group: string): ProductInsightRowDto['category'] {
  if (group === 'led_screen') return 'MAN_HINH_LED';
  if (group === 'electronic_board') return 'BANG_DIEN_TU';
  return 'KHAC';
}

function getScopeInfo(
  user: SessionUserDto,
  websiteLabel: string,
): { scopeRole: string; scopeDescription: string } {
  const siteSuffix = websiteLabel ? ` · ${websiteLabel}` : '';
  switch (user.roleCode) {
    case 'BOD':
    case 'ADMIN':
      return {
        scopeRole: user.roleCode,
        scopeDescription: `Phạm vi toàn công ty${siteSuffix}`,
      };
    case 'SALES_LEAD':
      return {
        scopeRole: user.roleCode,
        scopeDescription: `Phạm vi Phòng Kinh doanh${siteSuffix}`,
      };
    case 'SALES':
      return {
        scopeRole: user.roleCode,
        scopeDescription: `Phạm vi cá nhân (${user.fullName})${siteSuffix}`,
      };
    case 'MKT_LEAD':
    case 'MKT_STAFF':
    case 'ADS':
      return {
        scopeRole: user.roleCode,
        scopeDescription: `Phạm vi Marketing & Quảng cáo (che thông tin liên hệ khách hàng)${siteSuffix}`,
      };
    case 'DESIGNER':
      return {
        scopeRole: user.roleCode,
        scopeDescription: `Phạm vi Thiết kế AI${siteSuffix}`,
      };
    default:
      return {
        scopeRole: user.roleCode,
        scopeDescription: `Phạm vi theo vai trò${siteSuffix}`,
      };
  }
}

interface FlexibleReportScope {
  normalizedPreset: '7d' | '30d' | 'all' | 'custom';
  presetLabelKey: string;
  websiteId: string;
  websiteLabel: string;
  selectedWebsite: WebsiteConfigItemDto | null;
  availableWebsites: WebsiteConfigItemDto[];
  fromDate: Date;
  toDate: Date;
  fromDateStr: string;
  toDateStr: string;
  prevFromDate: Date;
  prevToDate: Date;
  isAllTime: boolean;
  isTodayIncluded: boolean;
}

async function resolveFlexibleReportScope(rawQuery: unknown): Promise<FlexibleReportScope> {
  const q = (rawQuery && typeof rawQuery === 'object' ? rawQuery : {}) as Record<string, unknown>;
  const availableWebsites = await getConfiguredWebsites();
  const rawWeb = String(q.websiteId || 'all').trim().toLowerCase();
  const selectedWebsite =
    rawWeb && rawWeb !== 'all'
      ? availableWebsites.find(
          (w) =>
            w.websiteId.toLowerCase() === rawWeb ||
            w.domain.toLowerCase() === rawWeb ||
            w.ga4PropertyId === rawWeb,
        ) || null
      : null;

  const websiteId = selectedWebsite ? selectedWebsite.websiteId : 'all';
  const websiteLabel = selectedWebsite
    ? `${selectedWebsite.shortName} (${selectedWebsite.domain})`
    : 'Tất cả website';

  const rawPreset = String(q.preset || '30d').trim();
  const upperPreset = rawPreset.toUpperCase();
  const fromInput = String(q.from || q.fromDate || '').trim() || undefined;
  const toInput = String(q.to || q.toDate || '').trim() || undefined;

  let fromDate: Date;
  let toDate: Date;
  let fromDateStr: string;
  let toDateStr: string;
  let normalizedPreset: '7d' | '30d' | 'all' | 'custom' = '30d';
  let isAllTime = false;
  let isTodayIncluded = true;

  if (upperPreset === 'TODAY') {
    const r = resolveDatePresetRange('TODAY');
    fromDate = r.startDateTime;
    toDate = r.endDateTime;
    fromDateStr = r.startDateStr;
    toDateStr = r.endDateStr;
    normalizedPreset = 'custom';
    isTodayIncluded = r.isTodayIncluded;
  } else if (upperPreset === 'YESTERDAY') {
    const r = resolveDatePresetRange('YESTERDAY');
    fromDate = r.startDateTime;
    toDate = r.endDateTime;
    fromDateStr = r.startDateStr;
    toDateStr = r.endDateStr;
    normalizedPreset = 'custom';
    isTodayIncluded = r.isTodayIncluded;
  } else if (upperPreset === '7D') {
    const r = getCanonicalDateRange(7);
    fromDate = r.startDateTime;
    toDate = r.endDateTime;
    fromDateStr = r.startDateStr;
    toDateStr = r.endDateStr;
    normalizedPreset = '7d';
    isTodayIncluded = r.isTodayIncluded;
  } else if (upperPreset === '30D') {
    const r = getCanonicalDateRange(30);
    fromDate = r.startDateTime;
    toDate = r.endDateTime;
    fromDateStr = r.startDateStr;
    toDateStr = r.endDateStr;
    normalizedPreset = '30d';
    isTodayIncluded = r.isTodayIncluded;
  } else if ((upperPreset === 'CUSTOM' || (fromInput && toInput)) && fromInput && toInput) {
    const r = getCustomCanonicalDateRange(fromInput, toInput);
    fromDate = r.startDateTime;
    toDate = r.endDateTime;
    fromDateStr = r.startDateStr;
    toDateStr = r.endDateStr;
    normalizedPreset = 'custom';
    isTodayIncluded = r.isTodayIncluded;
  } else {
    fromDate = new Date('2025-01-01T00:00:00.000+07:00');
    const nowRange = getCanonicalDateRange(1);
    toDate = nowRange.endDateTime;
    fromDateStr = '2025-01-01';
    toDateStr = nowRange.endDateStr;
    normalizedPreset = 'all';
    isAllTime = true;
    isTodayIncluded = true;
  }

  const spanDays = Math.max(1, countInclusiveCalendarDays(fromDateStr, toDateStr));
  const curStartNoon = new Date(`${fromDateStr}T12:00:00+07:00`);
  const prevEndD = new Date(curStartNoon.getTime() - 24 * 60 * 60 * 1000);
  const prevStartD = new Date(curStartNoon.getTime() - spanDays * 24 * 60 * 60 * 1000);
  const prevStartStr = getVietnamDateParts(prevStartD).dateStr;
  const prevEndStr = getVietnamDateParts(prevEndD).dateStr;

  return {
    normalizedPreset,
    presetLabelKey: upperPreset,
    websiteId,
    websiteLabel,
    selectedWebsite,
    availableWebsites,
    fromDate,
    toDate,
    fromDateStr,
    toDateStr,
    prevFromDate: new Date(`${prevStartStr}T00:00:00.000+07:00`),
    prevToDate: new Date(`${prevEndStr}T23:59:59.999+07:00`),
    isAllTime,
    isTodayIncluded,
  };
}

export async function getScopedReportsDashboard(
  user: SessionUserDto,
  rawQuery: unknown,
  options?: { compact?: boolean; bypassCache?: boolean },
): Promise<
  ReportsDashboardDto & {
    websiteId?: string;
    websiteLabel?: string;
    availableWebsites?: WebsiteConfigItemDto[];
    trendGranularity?: 'day' | 'week';
    previousOverview?: {
      totalLeadsL1: number;
      validLeadsL2: number;
      unreceivedLeadsCount: number;
      quoteSentCount: number;
      wonCount: number;
    } | null;
    dataQualitySummary?: {
      missingWebsiteCount: number;
      missingProductCount: number;
      needsAttentionCount: number;
      failingConnectionsCount: number;
    };
  }
> {
  const scope = await resolveFlexibleReportScope(rawQuery);
  const { fromDate, toDate, fromDateStr, toDateStr } = scope;
  const { scopeRole, scopeDescription } = getScopeInfo(user, scope.websiteLabel);
  const anonymized = isAnonymizedViewerRole(user.roleCode);
  const isCompact = Boolean(
    options?.compact ||
      (rawQuery && typeof rawQuery === 'object' && (rawQuery as Record<string, unknown>).compact === '1'),
  );
  const scopedUserKey =
    user.roleCode === 'SALES' || user.roleCode === 'DESIGNER'
      ? `${user.roleCode}:${user.id}`
      : `${user.roleCode}:${anonymized ? 'anon' : 'full'}`;

  const cacheResult = await getOrComputeScopedCache({
    key: `m04-dash:${scopedUserKey}:${scope.websiteId}:${scope.presetLabelKey}:${fromDateStr}:${toDateStr}:${isCompact ? 'compact' : 'full'}`,
    domains: ['reports', 'leads', 'tracking', 'ads', 'seo_articles', 'design', 'websites', 'auth'],
    ttlMs: 30_000,
    bypassCache: options?.bypassCache,
    compute: async () => {
      const roleLeadWhere: Record<string, unknown> =
        user.roleCode === 'SALES'
          ? { assignedSalesId: user.id }
          : user.roleCode === 'DESIGNER'
            ? { designRequests: { some: {} } }
            : {};
      const allGa4PropIds = scope.availableWebsites
        .map((w) => w.ga4PropertyId)
        .filter((id): id is string => Boolean(id));

      const [
        rawLeads,
        prevRawLeads,
        salesUsers,
        allProducts,
        userCoverMap,
        metrics,
        seoArticles,
        designRequests,
        aiLogAgg,
        recentSyncLogs,
        openAlertsCount,
        siteTrafficMetrics,
        ga4LiveSnaps,
        googleOAuthConn,
        gmailSyncSettings,
      ] = await Promise.all([
        prisma.lead.findMany({
          where: {
            createdAt: { gte: fromDate, lte: toDate },
            ...roleLeadWhere,
          },
          include: {
            assignedSales: {
              include: { role: true },
            },
            tracking: true,
            leadProducts: {
              include: {
                product: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        scope.isAllTime
          ? Promise.resolve([])
          : prisma.lead.findMany({
              where: {
                createdAt: { gte: scope.prevFromDate, lte: scope.prevToDate },
                ...roleLeadWhere,
              },
              select: {
                id: true,
                isSpam: true,
                pipelineStatus: true,
                receivedAt: true,
                sourceWebsite: true,
              },
            }),
        prisma.user.findMany({
          where: {
            isActive: true,
            role: {
              roleCode: { in: ['SALES', 'SALES_LEAD'] },
            },
          },
          include: { role: true },
          orderBy: { id: 'asc' },
        }),
        prisma.product.findMany({
          where: { isActive: true },
          orderBy: { id: 'asc' },
        }),
        getUserCoverMap(),
        prisma.platformDailyMetric.findMany({
          where: {
            platform: { in: ['google_ads', 'facebook', 'facebook_ads'] },
            grain: 'campaign',
            metricDate: {
              gte: fromDateStr,
              lte: toDateStr,
            },
            NOT: [
              { accountPropertyId: { startsWith: 'GA4-' } },
              { campaignExternalId: { startsWith: 'ga4_' } },
            ],
          },
          include: {
            campaign: {
              select: {
                campaignName: true,
                campaignCode: true,
              },
            },
          },
        }),
        prisma.seoArticle.findMany({
          where: {
            createdAt: {
              gte: fromDate,
              lte: toDate,
            },
          },
          select: {
            targetWebsite: true,
            status: true,
            lastPublishError: true,
            needsOptimization: true,
          },
        }),
        prisma.designRequest.findMany({
          where: {
            createdAt: {
              gte: fromDate,
              lte: toDate,
            },
            ...(user.roleCode === 'SALES'
              ? { requestedBySalesId: user.id }
              : user.roleCode === 'DESIGNER'
                ? { assignedDesignerId: user.id }
                : {}),
          },
          select: {
            designStatus: true,
            requestType: true,
            processingTimeMs: true,
          },
        }),
        prisma.aiUsageLog.aggregate({
          where: {
            moduleCode: '05-ai-design',
            createdAt: {
              gte: fromDate,
              lte: toDate,
            },
          },
          _sum: {
            totalTokens: true,
            costMicros: true,
          },
        }),
        prisma.platformSyncLog.findMany({
          orderBy: { startedAt: 'desc' },
          take: 15,
        }),
        prisma.leadReconciliation.count({
          where: { status: 'alert_open' },
        }),
        prisma.platformDailyMetric.findMany({
          where: {
            platform: { in: ['ga4', 'search_console'] },
            grain: 'account',
            metricDate: { gte: fromDateStr, lte: toDateStr },
            NOT: { campaignExternalId: { startsWith: 'PERIOD_SNAPSHOT:' } },
          },
          select: {
            platform: true,
            accountPropertyId: true,
            clicks: true,
            impressions: true,
            pageViews: true,
          },
        }),
        scope.isAllTime
          ? Promise.resolve([])
          : getGa4LiveSnapshotsForProperties(allGa4PropIds, fromDateStr, toDateStr, false),
        getGoogleConnection(),
        prisma.systemSetting.findMany({
          where: { key: { in: ['gmail_lead_sync_config', 'gmail_sync_checkpoint'] } },
          select: { key: true, value: true },
        }),
      ]);

      const latestSync = recentSyncLogs.find((s) => s.status === 'success' && s.completedAt) || null;

  const ga4SnapByProp = new Map(ga4LiveSnaps.map((s) => [s.propertyId, s]));

  // Tổng hợp đồng thời TẤT CẢ các website trên cùng 1 màn hình Tổng quan (không bắt bấm từng tab web)
  const matchedLeadIds = new Set<number>();
  const allSystemLeadsCount = rawLeads.length;
  const websiteSummaries: WebsiteOverviewItemDto[] = scope.availableWebsites.map((site) => {
    const siteLeads = rawLeads.filter((l) => matchesWebsiteDomain(l.sourceWebsite, site));
    for (const sl of siteLeads) matchedLeadIds.add(sl.id);
    const siteValid = siteLeads.filter(isL2Valid);

    const liveSnap = site.ga4PropertyId ? ga4SnapByProp.get(site.ga4PropertyId) : undefined;
    const ga4Rows = site.ga4PropertyId
      ? siteTrafficMetrics.filter(
          (m) => m.platform === 'ga4' && m.accountPropertyId === site.ga4PropertyId,
        )
      : [];
    const siteNormDomain = normalizeDomainKey(site.domain);
    const gscRows = siteTrafficMetrics.filter((m) => {
      if (m.platform !== 'search_console') return false;
      if (site.gscSiteUrl && m.accountPropertyId === site.gscSiteUrl) return true;
      return siteNormDomain ? normalizeDomainKey(m.accountPropertyId) === siteNormDomain : false;
    });

    const pageViews = site.ga4PropertyId
      ? liveSnap
        ? liveSnap.totals.screenPageViews
        : ga4Rows.reduce((s, r) => s + (r.pageViews || 0), 0)
      : null;
    const gscClicks =
      site.gscSiteUrl || gscRows.length > 0
        ? gscRows.reduce((s, r) => s + (r.clicks || 0), 0)
        : null;
    const gscImpressions =
      site.gscSiteUrl || gscRows.length > 0
        ? gscRows.reduce((s, r) => s + (r.impressions || 0), 0)
        : null;

    return {
      websiteId: site.websiteId,
      shortName: site.shortName,
      domain: site.domain,
      pageViews,
      gscClicks,
      gscImpressions,
      totalLeadsL1: siteLeads.length,
      validLeadsL2: siteValid.length,
      unreceivedCount: siteValid.filter((l) => l.pipelineStatus === 'new_lead' && !l.receivedAt).length,
      quotingAndSentCount: siteValid.filter(
        (l) => l.pipelineStatus === 'quoting' || l.pipelineStatus === 'quote_sent',
      ).length,
      wonCount: siteValid.filter((l) => l.pipelineStatus === 'won').length,
      sharePct:
        allSystemLeadsCount > 0
          ? Number(((siteLeads.length / allSystemLeadsCount) * 100).toFixed(1))
          : 0,
    };
  });

  const unmappedLeads = rawLeads.filter((l) => !matchedLeadIds.has(l.id));
  if (unmappedLeads.length > 0) {
    const unmappedValid = unmappedLeads.filter(isL2Valid);
    websiteSummaries.push({
      websiteId: 'direct_unmapped',
      shortName: 'Kênh trực tiếp & Nguồn chưa gắn tên miền',
      domain: 'Zalo · Hotline · Email · Nhập tay',
      isDirectOrUnmapped: true,
      pageViews: null,
      gscClicks: null,
      gscImpressions: null,
      totalLeadsL1: unmappedLeads.length,
      validLeadsL2: unmappedValid.length,
      unreceivedCount: unmappedValid.filter((l) => l.pipelineStatus === 'new_lead' && !l.receivedAt)
        .length,
      quotingAndSentCount: unmappedValid.filter(
        (l) => l.pipelineStatus === 'quoting' || l.pipelineStatus === 'quote_sent',
      ).length,
      wonCount: unmappedValid.filter((l) => l.pipelineStatus === 'won').length,
      sharePct:
        allSystemLeadsCount > 0
          ? Number(((unmappedLeads.length / allSystemLeadsCount) * 100).toFixed(1))
          : 0,
    });
  }

  const leads = rawLeads.filter((l) => matchesWebsiteDomain(l.sourceWebsite, scope.selectedWebsite));
  const prevLeads = prevRawLeads.filter((l) =>
    matchesWebsiteDomain(l.sourceWebsite, scope.selectedWebsite),
  );

  const totalLeadsL1 = leads.length;
  const validLeads = leads.filter(isL2Valid);
  const validLeadsL2 = validLeads.length;
  const effectiveLeads = leads.filter(isL3Effective);
  const effectiveLeadsL3 = effectiveLeads.length;

  const newLeadCount = validLeads.filter((l) => l.pipelineStatus === 'new_lead').length;
  const quotingCount = validLeads.filter((l) => l.pipelineStatus === 'quoting').length;
  const quoteSentCount = validLeads.filter((l) => l.pipelineStatus === 'quote_sent').length;
  const wonCount = validLeads.filter((l) => l.pipelineStatus === 'won').length;
  const lostCount = validLeads.filter((l) => l.pipelineStatus === 'lost').length;
  const activeLeadsCount = newLeadCount + quotingCount + quoteSentCount;
  const unreceivedLeadsCount = validLeads.filter(
    (l) => l.pipelineStatus === 'new_lead' && !l.receivedAt,
  ).length;

  const previousOverview = scope.isAllTime
    ? null
    : (() => {
        const pvValid = prevLeads.filter(isL2Valid);
        return {
          totalLeadsL1: prevLeads.length,
          validLeadsL2: pvValid.length,
          unreceivedLeadsCount: pvValid.filter(
            (l) => l.pipelineStatus === 'new_lead' && !l.receivedAt,
          ).length,
          quoteSentCount: pvValid.filter((l) => l.pipelineStatus === 'quote_sent').length,
          wonCount: pvValid.filter((l) => l.pipelineStatus === 'won').length,
        };
      })();

  // C05: Biểu đồ dùng chuỗi ngày liên tục DD/MM; khoảng dài (> 45 ngày) nhóm theo tuần và ghi rõ độ hạt
  const trendMap = new Map<string, { totalL1: number; validL2: number; wonCount: number }>();
  let minLeadDayStr: string | null = null;
  for (const lead of leads) {
    const dayKey = getVietnamDateParts(lead.createdAt).dateStr;
    if (!minLeadDayStr || dayKey < minLeadDayStr) minLeadDayStr = dayKey;
    const cur = trendMap.get(dayKey) ?? { totalL1: 0, validL2: 0, wonCount: 0 };
    cur.totalL1 += 1;
    if (isL2Valid(lead)) {
      cur.validL2 += 1;
      if (lead.pipelineStatus === 'won') {
        cur.wonCount += 1;
      }
    }
    trendMap.set(dayKey, cur);
  }

  const chartStartStr = scope.isAllTime ? minLeadDayStr || toDateStr : fromDateStr;
  const chartDays = Math.max(1, countInclusiveCalendarDays(chartStartStr, toDateStr));
  let trendGranularity: 'day' | 'week' = 'day';
  const leadTrend: LeadTrendPointDto[] = [];

  if (chartDays <= 45) {
    const startNoon = new Date(`${chartStartStr}T12:00:00+07:00`);
    for (let i = 0; i < chartDays; i += 1) {
      const d = new Date(startNoon.getTime() + i * 24 * 60 * 60 * 1000);
      const dayStr = getVietnamDateParts(d).dateStr;
      const counts = trendMap.get(dayStr) ?? { totalL1: 0, validL2: 0, wonCount: 0 };
      const [, mm, dd] = dayStr.split('-');
      leadTrend.push({
        date: dayStr,
        label: `${dd}/${mm}`,
        totalL1: counts.totalL1,
        validL2: counts.validL2,
        wonCount: counts.wonCount,
      });
    }
  } else {
    trendGranularity = 'week';
    const startNoon = new Date(`${chartStartStr}T12:00:00+07:00`);
    for (let i = 0; i < chartDays; i += 7) {
      let bucketL1 = 0;
      let bucketL2 = 0;
      let bucketWon = 0;
      const bucketStartD = new Date(startNoon.getTime() + i * 24 * 60 * 60 * 1000);
      const bucketStartStr = getVietnamDateParts(bucketStartD).dateStr;
      const [, mm, dd] = bucketStartStr.split('-');
      for (let j = 0; j < 7 && i + j < chartDays; j += 1) {
        const d = new Date(startNoon.getTime() + (i + j) * 24 * 60 * 60 * 1000);
        const dayStr = getVietnamDateParts(d).dateStr;
        const c = trendMap.get(dayStr);
        if (c) {
          bucketL1 += c.totalL1;
          bucketL2 += c.validL2;
          bucketWon += c.wonCount;
        }
      }
      leadTrend.push({
        date: bucketStartStr,
        label: `${dd}/${mm}`,
        totalL1: bucketL1,
        validL2: bucketL2,
        wonCount: bucketWon,
      });
    }
  }

  const nowMs = Date.now();
  const unansweredQuotes: UnansweredQuoteItemDto[] = [];
  for (const lead of validLeads) {
    if (lead.pipelineStatus === 'quote_sent' && !lead.quoteRespondedAt) {
      const refTime = lead.firstQuoteSentAt ?? lead.updatedAt ?? lead.createdAt;
      const daysWaiting = Math.max(
        0,
        Math.floor((nowMs - refTime.getTime()) / (24 * 3600 * 1000)),
      );
      const isOverdue7Days = daysWaiting >= 7;
      const cleanCompany = lead.companyName
        ? lead.companyName.replace(/\s*\(Dữ liệu tổng hợp\)/gi, '')
        : null;
      const rawName = cleanCompany || lead.contactName || `Lead #${lead.leadCode}`;
      unansweredQuotes.push({
        leadId: lead.id,
        leadCode: lead.leadCode,
        companyOrContact: anonymized ? maskCustomerCompanyForReport(rawName) : rawName,
        phone: anonymized ? maskPhoneForReport(lead.phone) : lead.phone || 'Chưa cập nhật',
        assignedSalesName: lead.assignedSales?.fullName || 'Chưa phân bổ',
        quoteSentAt: refTime.toISOString(),
        daysWaiting,
        isOverdue7Days,
        productSummary:
          lead.leadProducts.map((lp) => lp.product.productName).join(', ') || 'Chưa phân loại',
      });
    }
  }

  unansweredQuotes.sort((a, b) => b.daysWaiting - a.daysWaiting);
  const overdue7DaysQuoteCount = unansweredQuotes.filter((q) => q.isOverdue7Days).length;

  // C04: Thống nhất công thức Tỷ lệ chốt = Chốt thành công / Lead hợp lệ (L2) trong cùng phạm vi
  const winRateText =
    validLeadsL2 > 0 ? `${((wonCount / validLeadsL2) * 100).toFixed(1)}%` : 'Chưa đủ dữ liệu';

  const channelCounts = new Map<string, number>();
  for (const lead of validLeads) {
    channelCounts.set(lead.contactChannel, (channelCounts.get(lead.contactChannel) ?? 0) + 1);
  }
  const byChannel = Array.from(channelCounts.entries()).map(([channel, count]) => ({
    channel,
    label: formatContactChannelClean(channel as ContactChannel),
    count,
  }));

  // Đối soát nhân sự Sales + phần giao ngoài nhóm Sales / chưa phân bổ để khớp tổng Lead hợp lệ (C04 & C09)
  const scopedSalesUsers =
    user.roleCode === 'SALES' ? salesUsers.filter((s) => s.id === user.id) : salesUsers;
  const knownSalesIdSet = new Set<number>(scopedSalesUsers.map((s) => s.id));

  const overdueLeadIdSet = new Set(unansweredQuotes.filter((q) => q.isOverdue7Days).map((q) => q.leadId));

  const buildSalesPerfRow = (
    salesUserId: number,
    salesFullName: string,
    isOnline: boolean,
    isReceivingLeads: boolean,
    sLeads: typeof validLeads,
    avatarUrl?: string | null,
  ): SalesPerformanceRowDto => {
    const sWon = sLeads.filter((l) => l.pipelineStatus === 'won').length;
    const sLost = sLeads.filter((l) => l.pipelineStatus === 'lost').length;
    const sOverdue = sLeads.reduce((acc, l) => acc + (overdueLeadIdSet.has(l.id) ? 1 : 0), 0);

    return {
      salesUserId,
      salesFullName,
      avatarUrl: avatarUrl ?? null,
      coverUrl: salesUserId > 0 ? userCoverMap[String(salesUserId)] || null : null,
      isOnline,
      isReceivingLeads,
      totalLeads: sLeads.length,
      newLeads: sLeads.filter((l) => l.pipelineStatus === 'new_lead').length,
      quotingLeads: sLeads.filter((l) => l.pipelineStatus === 'quoting').length,
      quoteSentLeads: sLeads.filter((l) => l.pipelineStatus === 'quote_sent').length,
      wonLeads: sWon,
      lostLeads: sLost,
      unansweredOverdue7d: sOverdue,
      winRateText: sLeads.length > 0 ? `${((sWon / sLeads.length) * 100).toFixed(1)}%` : '0.0%',
    };
  };

  const salesPerformance: SalesPerformanceRowDto[] = scopedSalesUsers.map((s) =>
    buildSalesPerfRow(
      s.id,
      s.fullName,
      s.isOnline,
      s.isReceivingLeads,
      validLeads.filter((l) => l.assignedSalesId === s.id),
      s.avatarUrl,
    ),
  );

  if (user.roleCode !== 'SALES') {
    const otherAssignedMap = new Map<number, { label: string; rows: typeof validLeads }>();
    const unassignedRows: typeof validLeads = [];

    for (const l of validLeads) {
      if (!l.assignedSalesId) {
        unassignedRows.push(l);
      } else if (!knownSalesIdSet.has(l.assignedSalesId)) {
        const cur = otherAssignedMap.get(l.assignedSalesId) || {
          label: l.assignedSales
            ? `${l.assignedSales.fullName} (${l.assignedSales.role?.roleName || 'Ngoài nhóm Sales'})`
            : `Nhân sự #${l.assignedSalesId}`,
          rows: [],
        };
        cur.rows.push(l);
        otherAssignedMap.set(l.assignedSalesId, cur);
      }
    }

    for (const [uid, entry] of otherAssignedMap.entries()) {
      salesPerformance.push(buildSalesPerfRow(uid, entry.label, false, false, entry.rows));
    }
    if (unassignedRows.length > 0) {
      salesPerformance.push(buildSalesPerfRow(0, 'Chưa phân bổ', false, false, unassignedRows));
    }
  }

  salesPerformance.sort((a, b) => b.totalLeads - a.totalLeads);

  const productMap = new Map<number, { inquiryCount: number; wonCount: number }>();
  for (const lead of validLeads) {
    for (const lp of lead.leadProducts) {
      const current = productMap.get(lp.productId) ?? { inquiryCount: 0, wonCount: 0 };
      current.inquiryCount += 1;
      if (lead.pipelineStatus === 'won') {
        current.wonCount += 1;
      }
      productMap.set(lp.productId, current);
    }
  }

  const productInsights: ProductInsightRowDto[] = allProducts
    .map((p) => {
      const counts = productMap.get(p.id) ?? { inquiryCount: 0, wonCount: 0 };
      return {
        productId: p.id,
        productCode: p.productCode,
        productName: p.productName,
        category: mapProductCategory(p.categoryGroup),
        inquiryCount: counts.inquiryCount,
        wonCount: counts.wonCount,
      };
    })
    .filter((p) => p.inquiryCount > 0)
    .sort((a, b) => b.inquiryCount - a.inquiryCount);

  const hasAdsMetrics = metrics.length > 0 && !scope.selectedWebsite;
  const totalAdsSpendMicros = hasAdsMetrics
    ? metrics.reduce((acc, m) => acc + (m.spendMicros ?? 0n), 0n)
    : 0n;
  const platformReportedConversions = hasAdsMetrics
    ? Number(
        metrics
          .reduce((acc, m) => acc + Number(m.conversionsMicros ?? 0n) / 1_000_000, 0)
          .toFixed(2),
      )
    : 0;
  const effectiveLeadsFromAds = effectiveLeads.filter((l) => {
    const ch = normalizeMarketingChannelDisplay({
      marketingSource: l.tracking?.marketingSource,
      utmSource: l.tracking?.utmSource,
      utmMedium: l.tracking?.utmMedium,
      gclid: l.tracking?.gclid,
      contactChannel: l.contactChannel,
    });
    return ch === 'Google Ads' || ch === 'Quảng cáo Facebook';
  }).length;
  const cplEffectiveMicros =
    hasAdsMetrics && effectiveLeadsFromAds > 0
      ? totalAdsSpendMicros / BigInt(effectiveLeadsFromAds)
      : null;

  // Source / Campaign performance table (chuẩn hóa C04: không lộ structured_field, không gán thiếu UTM vào Nguồn tự nhiên / Trực tiếp)
  const sourceCampaignMap = new Map<
    string,
    {
      sourceName: string;
      campaignName: string;
      spendMicros: bigint;
      platformConversions: number;
      crmLeadsL1: number;
      crmValidL2: number;
      crmEffectiveL3: number;
      wonCount: number;
    }
  >();

  if (!scope.selectedWebsite) {
    for (const m of metrics) {
      const srcName =
        m.platform === 'google_ads'
          ? 'Google Ads'
          : m.platform === 'facebook' || m.platform === 'facebook_ads'
            ? 'Quảng cáo Facebook'
            : m.platform;
      const campName = m.campaign?.campaignName || 'Chiến dịch chưa đặt tên';
      const key = `${srcName}::${campName}`;
      const entry = sourceCampaignMap.get(key) ?? {
        sourceName: srcName,
        campaignName: campName,
        spendMicros: 0n,
        platformConversions: 0,
        crmLeadsL1: 0,
        crmValidL2: 0,
        crmEffectiveL3: 0,
        wonCount: 0,
      };
      entry.spendMicros += m.spendMicros ?? 0n;
      entry.platformConversions += Number((Number(m.conversionsMicros ?? 0n) / 1_000_000).toFixed(2));
      sourceCampaignMap.set(key, entry);
    }
  }

  for (const lead of leads) {
    const srcName = normalizeMarketingChannelDisplay({
      marketingSource: lead.tracking?.marketingSource,
      utmSource: lead.tracking?.utmSource,
      utmMedium: lead.tracking?.utmMedium,
      gclid: lead.tracking?.gclid,
      contactChannel: lead.contactChannel,
    });
    const campName = lead.tracking?.utmCampaign || lead.tracking?.campaignName || 'Chưa xác định chiến dịch';
    const key = `${srcName}::${campName}`;
    const entry = sourceCampaignMap.get(key) ?? {
      sourceName: srcName,
      campaignName: campName,
      spendMicros: 0n,
      platformConversions: 0,
      crmLeadsL1: 0,
      crmValidL2: 0,
      crmEffectiveL3: 0,
      wonCount: 0,
    };
    entry.crmLeadsL1 += 1;
    if (isL2Valid(lead)) {
      entry.crmValidL2 += 1;
      if (lead.pipelineStatus === 'won') {
        entry.wonCount += 1;
      }
    }
    if (isL3Effective(lead)) {
      entry.crmEffectiveL3 += 1;
    }
    sourceCampaignMap.set(key, entry);
  }

  const bySourceCampaign: MarketingSourcePerformanceRowDto[] = Array.from(
    sourceCampaignMap.entries(),
  )
    .map(([key, item]) => ({
      key,
      sourceName: item.sourceName,
      campaignName: item.campaignName,
      spend:
        item.spendMicros > 0n ? toMonetaryAmountDto(item.spendMicros, 'VND', 'micros') : null,
      platformConversions: item.platformConversions,
      crmLeadsL1: item.crmLeadsL1,
      crmValidL2: item.crmValidL2,
      crmEffectiveL3: item.crmEffectiveL3,
      wonCount: item.wonCount,
    }))
    .sort((a, b) => b.crmLeadsL1 - a.crmLeadsL1 || b.platformConversions - a.platformConversions)
    .slice(0, 10);

  const scopedSeoArticles = seoArticles.filter((a) =>
    matchesWebsiteDomain(a.targetWebsite, scope.selectedWebsite),
  );
  const publishedSeoArticles = scopedSeoArticles.filter((a) => a.status === 'published').length;
  const draftSeoArticles = scopedSeoArticles.filter((a) => a.status === 'draft').length;
  const scheduledSeoArticles = scopedSeoArticles.filter(
    (a) => a.status === 'approved_scheduled' || a.status === 'scheduled',
  ).length;
  const failedPublishArticles = scopedSeoArticles.filter((a) => Boolean(a.lastPublishError)).length;
  const optimizationNeededArticles = scopedSeoArticles.filter((a) => a.needsOptimization).length;

  const pendingDesignCount = designRequests.filter((d) => d.designStatus !== 'completed').length;
  const inReviewDesignCount = designRequests.filter((d) => d.designStatus === 'in_review').length;
  const completed3dCount = designRequests.filter(
    (d) => d.requestType === '3d_perspective' && d.designStatus === 'completed',
  ).length;
  const completedBannerCount = designRequests.filter(
    (d) => d.requestType === 'banner' && d.designStatus === 'completed',
  ).length;
  const withDuration = designRequests.filter((d) => d.processingTimeMs != null);
  const avgProcessingSec =
    withDuration.length > 0
      ? withDuration.reduce((sum, d) => sum + (d.processingTimeMs ?? 0) / 1000, 0) /
        withDuration.length
      : 0;

  const totalAiTokens = aiLogAgg._sum.totalTokens ?? 0;
  const totalAiCostMicros = aiLogAgg._sum.costMicros ?? 0n;

  const isOAuthConnectedLive = Boolean(googleOAuthConn?.connected && !googleOAuthConn.isSandboxDemo);
  const liveIntegrationMode =
    process.env.TOANTRUNG_LIVE_INTEGRATION === 'true' || isOAuthConnectedLive;
  const distinctPlatforms = new Set(recentSyncLogs.map((c) => c.platform));
  const configuredConnectionsCount = liveIntegrationMode
    ? Math.max(distinctPlatforms.size, isOAuthConnectedLive ? 3 : 0)
    : 0;
  let gmailAutoSyncEnabled = false;
  let gmailConsecutiveFailures = 0;
  for (const s of gmailSyncSettings) {
    try {
      const parsed = JSON.parse(s.value || '{}') as Record<string, unknown>;
      if (s.key === 'gmail_lead_sync_config') gmailAutoSyncEnabled = Boolean(parsed.enabled);
      if (s.key === 'gmail_sync_checkpoint') {
        gmailConsecutiveFailures = Number(parsed.consecutiveFailures || 0);
      }
    } catch {
      // ignore malformed setting JSON
    }
  }
  const hasOAuthFailure = Boolean(
    googleOAuthConn?.connected &&
      !googleOAuthConn.isSandboxDemo &&
      (googleOAuthConn.connectionStatus === 'EXPIRED' ||
        googleOAuthConn.connectionStatus === 'PERMISSION_ERROR' ||
        googleOAuthConn.connectionStatus === 'SYNC_ERROR'),
  );
  const hasGmailSyncFailure = gmailAutoSyncEnabled && gmailConsecutiveFailures >= 3;
  const failingConnectionsCount =
    recentSyncLogs.filter((c) => c.consecutiveFailures >= 3).length +
    (hasOAuthFailure ? 1 : 0) +
    (hasGmailSyncFailure ? 1 : 0);
  const gclidPendingRetryCount = leads.filter(
    (l) => Boolean(l.tracking?.gclid && l.tracking?.isUnknownCampaign),
  ).length;
  const wordpressConfigured = Boolean(
    process.env.WORDPRESS_SITE_URL &&
      process.env.WORDPRESS_USERNAME &&
      process.env.WORDPRESS_APP_PASSWORD,
  );
  let geminiConfigured = Boolean(process.env.GEMINI_API_KEY?.trim());
  if (!geminiConfigured) {
    try {
      geminiConfigured = Boolean(
        AiDesignProviderFactory.getCatalog()?.config?.providers?.google_imagen?.apiKey?.trim(),
      );
    } catch {
      geminiConfigured = false;
    }
  }

  const needsReviewLeadsCount = leads.filter(
    (l) => l.needsManagerAttention || l.isDuplicateAlert || l.isPhoneUnstandardized,
  ).length;
  const missingWebsiteCount = leads.filter(
    (l) => !sanitizeWebsiteSourceDisplay(l.sourceWebsite).cleanLabel,
  ).length;
  const missingProductCount = leads.filter((l) => l.leadProducts.length === 0).length;

  // C05: "Cần xử lý" chỉ chứa nhóm thực sự đang có việc (count > 0), tối đa 5 nhóm, không hiển thị "Hoàn tất"
  const candidateTasks: ActionableTaskItemDto[] = [];
  const canWorkLeads = ['ADMIN', 'BOD', 'SALES_LEAD', 'SALES'].includes(user.roleCode);
  const canWorkDesigns = hasBaPermission(user.roleCode, 'AI_DESIGN');
  const canWorkSeo = hasBaPermission(user.roleCode, 'AI_MARKETING_SEO');
  const canWorkTracking = hasBaPermission(user.roleCode, 'TRACKING_ADS_OPTIMIZE');
  const webQuerySuffix = scope.websiteId !== 'all' ? `&websiteId=${encodeURIComponent(scope.websiteId)}` : '';

  if (canWorkLeads) {
    if (unreceivedLeadsCount > 0) {
      candidateTasks.push({
        id: 'unaccepted_leads',
        title: 'Lead chờ tiếp nhận',
        description: 'Hồ sơ mới nhận thông tin chưa được Sales xác nhận tiếp nhận.',
        count: unreceivedLeadsCount,
        severity: 'critical',
        moduleLabel: 'Lead',
        href: `/leads?status=new_lead&unreceived=1${webQuerySuffix}`,
      });
    }
    if (overdue7DaysQuoteCount > 0) {
      candidateTasks.push({
        id: 'overdue_quotes',
        title: 'Báo giá quá hạn 7 ngày',
        description: 'Hồ sơ đã gửi báo giá trên 7 ngày chưa cập nhật phản hồi khách hàng.',
        count: overdue7DaysQuoteCount,
        severity: 'warning',
        moduleLabel: 'Lead',
        href: `/leads?status=quote_sent&overdueOnly=true${webQuerySuffix}`,
      });
    }
    if (needsReviewLeadsCount > 0) {
      candidateTasks.push({
        id: 'leads_need_review',
        title: 'Lead cần kiểm tra chất lượng / nghi trùng',
        description: 'Hồ sơ có cảnh báo nghi trùng, thiếu SĐT chuẩn hoặc cần kiểm tra nội dung.',
        count: needsReviewLeadsCount,
        severity: 'warning',
        moduleLabel: 'Lead',
        href: `/leads?needsReview=1${webQuerySuffix}`,
      });
    }
  }

  if (canWorkDesigns && pendingDesignCount > 0) {
    candidateTasks.push({
      id: 'pending_designs',
      title: 'Yêu cầu phối cảnh / banner đang xử lý',
      description: 'Yêu cầu thiết kế đang chờ hoàn tất trong Thiết kế AI.',
      count: pendingDesignCount,
      severity: 'warning',
      moduleLabel: 'Thiết kế AI',
      href: '/design',
    });
  }

  if (canWorkSeo) {
    const seoActionCount = draftSeoArticles + optimizationNeededArticles + failedPublishArticles;
    if (seoActionCount > 0) {
      candidateTasks.push({
        id: 'seo_approvals',
        title: 'Nội dung SEO cần duyệt hoặc cập nhật',
        description: `${draftSeoArticles} bản nháp, ${optimizationNeededArticles} bài cần cập nhật, ${failedPublishArticles} lỗi xuất bản.`,
        count: seoActionCount,
        severity: failedPublishArticles > 0 ? 'critical' : 'warning',
        moduleLabel: 'Từ khóa & SEO',
        href: `/ads?tab=content${webQuerySuffix}`,
      });
    }
  }

  if (canWorkTracking) {
    const syncIssueCount = openAlertsCount + failingConnectionsCount;
    if (syncIssueCount > 0) {
      candidateTasks.push({
        id: 'sync_failures',
        title: 'Cảnh báo kết nối / đối soát dữ liệu',
        description: `${openAlertsCount} cảnh báo đối soát, ${failingConnectionsCount} kết nối lỗi liên tiếp.`,
        count: syncIssueCount,
        severity: 'critical',
        moduleLabel: 'Chiến dịch',
        href: `/tracking?websiteId=${encodeURIComponent(scope.websiteId)}`,
      });
    }
  }

  const actionableTasks = candidateTasks.slice(0, 5);

  const detailedLeads: DetailedReportLeadRowDto[] = isCompact
    ? []
    : leads.map((lead, idx) => {
    const cleanCompany = lead.companyName
      ? lead.companyName.replace(/\s*\(Dữ liệu tổng hợp\)/gi, '')
      : null;
    const rawCompanyOrContact =
      [cleanCompany, lead.contactName].filter(Boolean).join(' — ') ||
      `Khách hàng #${lead.leadCode}`;
    const receivedDate = lead.createdAt;
    const cleanProject = sanitizeProjectOrSubjectText(lead.projectName);
    const cleanWeb = sanitizeWebsiteSourceDisplay(lead.sourceWebsite).cleanLabel || 'Chưa xác định';
    const cleanMkt = normalizeMarketingChannelDisplay({
      marketingSource: lead.tracking?.marketingSource,
      utmSource: lead.tracking?.utmSource,
      utmMedium: lead.tracking?.utmMedium,
      gclid: lead.tracking?.gclid,
      contactChannel: lead.contactChannel,
    });

    return {
      stt: idx + 1,
      leadCode: lead.leadCode,
      receivedAt: receivedDate.toISOString(),
      assignedSalesName: lead.assignedSales?.fullName || 'Chưa phân bổ',
      companyOrCustomer: anonymized
        ? maskCustomerCompanyForReport(rawCompanyOrContact)
        : rawCompanyOrContact,
      phone: anonymized ? maskPhoneForReport(lead.phone) : lead.phone || 'Chưa xác định',
      sourceWebsite: cleanWeb,
      contactChannel: formatContactChannelClean(lead.contactChannel),
      marketingSource: cleanMkt,
      productsText:
        lead.leadProducts.map((lp) => lp.product.productName).join(', ') || 'Chưa phân loại',
      pipelineStatusLabel: lead.isSpam
        ? 'Nghi spam (đã loại trừ)'
        : PIPELINE_STATUS_LABELS[lead.pipelineStatus as PipelineStatus] ?? lead.pipelineStatus,
      noteOrReason: anonymized
        ? lead.lostReason || (lead.isSpam ? 'Đã loại trừ spam' : '—')
        : lead.lostReason || lead.spamReason || cleanProject || '—',
      isAnonymized: anonymized,
    };
  });

  const isSmallSample = totalLeadsL1 < 30;

  return {
    scopeRole,
    scopeDescription,
    preset: scope.normalizedPreset,
    fromDate: fromDateStr,
    toDate: toDateStr,
    websiteId: scope.websiteId,
    websiteLabel: scope.websiteLabel,
    availableWebsites: scope.availableWebsites,
    websiteSummaries,
    trendGranularity,
    previousOverview,
    dataQualitySummary: {
      missingWebsiteCount,
      missingProductCount,
      needsAttentionCount: needsReviewLeadsCount,
      failingConnectionsCount,
    },
    generatedAt: new Date().toISOString(),
    isSmallSample,
    smallSampleNotice: isSmallSample
      ? 'Mẫu dữ liệu nhỏ (< 30 Lead trong phạm vi đang chọn): Tỷ lệ chốt và CPL mang tính tham khảo.'
      : null,
    todayPreliminaryNotice: scope.isTodayIncluded
      ? 'Số liệu trong ngày đang tạm tính.'
      : '',
    lastSyncedAt: latestSync?.completedAt ? latestSync.completedAt.toISOString() : null,
    overview: {
      totalLeadsL1,
      validLeadsL2,
      effectiveLeadsL3,
      activeLeadsCount,
      unreceivedLeadsCount,
      newLeadCount,
      quotingCount,
      quoteSentCount,
      wonCount,
      lostCount,
      unansweredQuoteCount: unansweredQuotes.length,
      overdue7DaysQuoteCount,
      winRateText,
    },
    leadTrend,
    actionableTasks,
    byChannel,
    salesPerformance,
    productInsights,
    unansweredQuotes,
    marketingSummary: {
      totalAdsSpend: hasAdsMetrics ? toMonetaryAmountDto(totalAdsSpendMicros, 'VND', 'micros') : null,
      platformReportedConversions,
      effectiveLeadsFromAds,
      cplEffective:
        cplEffectiveMicros != null
          ? toMonetaryAmountDto(cplEffectiveMicros, 'VND', 'micros')
          : null,
      publishedSeoArticles,
      draftSeoArticles,
      scheduledSeoArticles,
      failedPublishArticles,
      optimizationNeededArticles,
      bySourceCampaign,
    },
    trackingOperationalSummary: {
      liveIntegrationMode,
      configuredConnectionsCount,
      totalConnectionsCount: Math.max(distinctPlatforms.size, 3),
      openAlertsCount,
      failingConnectionsCount,
      gclidPendingRetryCount,
      wordpressConfigured,
      geminiConfigured,
    },
    designSummary: {
      totalRequests: designRequests.length,
      pendingCount: pendingDesignCount,
      inReviewCount: inReviewDesignCount,
      completed3dCount,
      completedBannerCount,
      avgProcessingSecText:
        withDuration.length > 0 ? `${avgProcessingSec.toFixed(1)} giây` : 'Chưa phát sinh',
      totalAiTokens,
      totalAiCost: toMonetaryAmountDto(totalAiCostMicros, 'USD', 'micros'),
    },
    detailedLeads,
  };
    },
  });
  return {
    ...cacheResult.data,
    generatedAt: new Date().toISOString(),
  };
}

import { getM04ResultsReportSpec } from './m04-spec.service';

function escapeCsvCell(val: string | number): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function generateScopedReportExportBuffer(
  user: SessionUserDto,
  rawQuery: unknown,
  format: 'xlsx' | 'csv' = 'xlsx',
): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
  const qObj = (rawQuery && typeof rawQuery === 'object' ? rawQuery : {}) as Record<string, unknown>;
  const [dashboard, m04Spec] = await Promise.all([
    getScopedReportsDashboard(user, rawQuery),
    getM04ResultsReportSpec(user, {
      websiteId: typeof qObj.websiteId === 'string' ? qObj.websiteId : 'all',
      preset: typeof qObj.preset === 'string' ? qObj.preset.toUpperCase() : '30D',
      from: typeof qObj.fromDate === 'string' ? qObj.fromDate : typeof qObj.from === 'string' ? qObj.from : undefined,
      to: typeof qObj.toDate === 'string' ? qObj.toDate : typeof qObj.to === 'string' ? qObj.to : undefined,
    }),
  ]);
  const dateStamp = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  await prisma.auditLog.create({
    data: {
      actorUserId: user.id,
      action: 'REPORT_EXPORTED',
      targetType: 'ReportExport',
      targetId: `${dashboard.scopeRole}_${dashboard.websiteId || 'all'}_${dashboard.fromDate}_${dashboard.toDate}_${format}`,
      detailsJson: JSON.stringify({
        scopeRole: dashboard.scopeRole,
        websiteId: dashboard.websiteId || 'all',
        fromDate: dashboard.fromDate,
        toDate: dashboard.toDate,
        format,
        leadCount: dashboard.detailedLeads.length,
      }),
    },
  });

  if (format === 'csv') {
    const cplLabel =
      m04Spec.metrics.costPerValidAdLead !== null
        ? `${Math.round(m04Spec.metrics.costPerValidAdLead).toLocaleString('vi-VN')} VND`
        : 'Chưa đủ dữ liệu';
    const adCostLabel =
      m04Spec.metrics.attributedAdCost !== null && m04Spec.metrics.attributedAdCost !== undefined
        ? `${m04Spec.metrics.attributedAdCost.toLocaleString('vi-VN')} VND`
        : 'Chưa kết nối/chưa tách riêng';
    const lines: string[] = [
      `Hiệu quả Marketing Toàn Trung - ${dashboard.scopeDescription}`,
      `Kỳ báo cáo,${m04Spec.scope.startDate} đến ${m04Spec.scope.endDate}`,
      `Website nguồn,${m04Spec.scope.websiteLabel}`,
      `Chi phí quảng cáo,${adCostLabel},Lead tiếp nhận,${m04Spec.metrics.receivedLeadCount ?? m04Spec.metrics.totalLeadCount},Lead hợp lệ,${m04Spec.metrics.validLeadCount},CPL quảng cáo hợp lệ,${cplLabel},Chốt thành công,${m04Spec.metrics.wonLeadCount},Tỷ lệ chốt,${m04Spec.metrics.winRatePct !== null ? `${m04Spec.metrics.winRatePct}%` : '—'}`,
      '',
      [
        'STT',
        'Mã Lead',
        'Ngày nhận',
        'Sales phụ trách',
        'Khách hàng / dự án',
        'Số điện thoại',
        'Website nguồn',
        'Hình thức liên hệ',
        'Kênh marketing',
        'Sản phẩm',
        'Trạng thái bán hàng',
        'Ghi chú',
      ]
        .map(escapeCsvCell)
        .join(','),
    ];

    for (const row of dashboard.detailedLeads) {
      lines.push(
        [
          row.stt,
          row.leadCode,
          formatVietnamDateTime(row.receivedAt),
          row.assignedSalesName,
          row.companyOrCustomer,
          row.phone,
          row.sourceWebsite,
          row.contactChannel,
          row.marketingSource,
          row.productsText,
          row.pipelineStatusLabel,
          row.noteOrReason,
        ]
          .map(escapeCsvCell)
          .join(','),
      );
    }

    const csvContent = '\uFEFF' + lines.join('\r\n');
    return {
      buffer: Buffer.from(csvContent, 'utf8'),
      fileName: `BaoCao_HieuQuaMarketing_${dashboard.websiteId || 'all'}_${dateStamp}.csv`,
      mimeType: 'text/csv; charset=utf-8',
    };
  }

  const attributionLabels: Record<string, string> = {
    SINGLE_WEBSITE: 'Riêng 1 website',
    MULTI_WEBSITE_UNSPLIT: 'Đa website (chưa tách)',
    UNATTRIBUTED: 'Chưa xác định domain',
  };

  const xlsxBuffer = buildStandardXlsxBuffer([
    {
      name: 'HieuQuaMarketing',
      title: `HIỆU QUẢ MARKETING — ${m04Spec.scope.websiteLabel} (${m04Spec.scope.startDate} → ${m04Spec.scope.endDate})`,
      metadata: [
        { label: 'Kỳ báo cáo', value: `${m04Spec.scope.startDate} đến ${m04Spec.scope.endDate} (Asia/Ho_Chi_Minh)` },
        { label: 'Phạm vi website', value: m04Spec.scope.websiteLabel },
      ],
      kpiSummary: [
        {
          label: 'Chi phí Ads',
          value:
            m04Spec.metrics.attributedAdCost !== null && m04Spec.metrics.attributedAdCost !== undefined
              ? `${m04Spec.metrics.attributedAdCost.toLocaleString('vi-VN')} ₫`
              : 'Chưa tách riêng',
        },
        {
          label: 'Lead L1 / Hợp lệ',
          value: `${m04Spec.metrics.receivedLeadCount ?? m04Spec.metrics.totalLeadCount} / ${m04Spec.metrics.validLeadCount}`,
        },
        {
          label: 'CPL Ads hợp lệ',
          value:
            m04Spec.metrics.costPerValidAdLead !== null
              ? `${Math.round(m04Spec.metrics.costPerValidAdLead).toLocaleString('vi-VN')} ₫`
              : 'Chưa đủ dữ liệu',
        },
        {
          label: 'Chốt Won / Tỷ lệ',
          value: `${m04Spec.metrics.wonLeadCount} (${m04Spec.metrics.winRatePct !== null ? `${m04Spec.metrics.winRatePct}%` : '—'})`,
        },
      ],
      columns: [
        { header: 'Website', key: 'website', width: 26, type: 'string' },
        { header: 'Lead tiếp nhận', key: 'leadCount', width: 16, type: 'number', summaryAgg: 'sum' },
        { header: 'Lead hợp lệ', key: 'validCount', width: 16, type: 'number', summaryAgg: 'sum' },
        { header: 'Lead từ Ads', key: 'adLeadCount', width: 16, type: 'number', summaryAgg: 'sum' },
        { header: 'Chi phí Ads (VNĐ)', key: 'adCost', width: 22, type: 'currency', summaryAgg: 'sum' },
        {
          header: 'CPL Ads (VNĐ)',
          key: 'cpl',
          width: 20,
          type: 'currency',
          rowFormula: ({ rowNum, colLetters }) =>
            `IF(${colLetters.adLeadCount}${rowNum}>0,ROUND(${colLetters.adCost}${rowNum}/${colLetters.adLeadCount}${rowNum},0),"")`,
          summaryAgg: ({ summaryRowNum, colLetters }) =>
            `IF(${colLetters.adLeadCount}${summaryRowNum}>0,ROUND(${colLetters.adCost}${summaryRowNum}/${colLetters.adLeadCount}${summaryRowNum},0),"")`,
        },
        { header: 'Chốt thành công', key: 'wonCount', width: 16, type: 'number', summaryAgg: 'sum' },
        {
          header: 'Tỷ lệ chốt (%)',
          key: 'winRate',
          width: 16,
          type: 'percent',
          rowFormula: ({ rowNum, colLetters }) =>
            `IFERROR(${colLetters.wonCount}${rowNum}/${colLetters.validCount}${rowNum},0)`,
          summaryAgg: ({ summaryRowNum, colLetters }) =>
            `IFERROR(${colLetters.wonCount}${summaryRowNum}/${colLetters.validCount}${summaryRowNum},0)`,
        },
      ],
      rows: m04Spec.tables.byWebsite.map((w) => ({
        website: w.website,
        leadCount: w.leadCount,
        validCount: w.validCount,
        adLeadCount: w.adLeadCount,
        adCost: w.adCost ?? 0,
        cpl: w.cpl !== null && w.cpl !== undefined ? Math.round(w.cpl) : null,
        wonCount: w.wonCount,
        winRate: w.validCount > 0 ? Number((w.wonCount / w.validCount).toFixed(4)) : 0,
      })),
      summaryRow: {
        website: 'TỔNG CỘNG TOÀN PHẠM VI',
        leadCount: m04Spec.tables.byWebsite.reduce((s, w) => s + w.leadCount, 0),
        validCount: m04Spec.tables.byWebsite.reduce((s, w) => s + w.validCount, 0),
        adLeadCount: m04Spec.tables.byWebsite.reduce((s, w) => s + w.adLeadCount, 0),
        adCost: m04Spec.tables.byWebsite.reduce((s, w) => s + (w.adCost ?? 0), 0),
        cpl: m04Spec.metrics.costPerValidAdLead !== null ? Math.round(m04Spec.metrics.costPerValidAdLead) : null,
        wonCount: m04Spec.tables.byWebsite.reduce((s, w) => s + w.wonCount, 0),
        winRate: m04Spec.metrics.winRatePct !== null ? Number((m04Spec.metrics.winRatePct / 100).toFixed(4)) : 0,
      },
      footerNotes: [
        'Công thức Excel tự động tính lại trực tiếp khi chỉnh sửa số liệu: CPL = Chi phí / Lead từ Ads; Tỷ lệ chốt = Won / Lead hợp lệ.',
      ],
    },
    {
      name: 'KenhVaChienDich',
      title: `ĐỐI CHIẾU HIỆU QUẢ THEO CHIẾN DỊCH — ${m04Spec.scope.websiteLabel}`,
      metadata: [
        { label: 'Kỳ báo cáo', value: `${m04Spec.scope.startDate} đến ${m04Spec.scope.endDate}` },
        { label: 'Ghi chú đối soát Ads', value: m04Spec.metrics.adReconciliationNote || 'Chuẩn Lead hợp lệ CRM' },
      ],
      columns: [
        { header: 'Chiến dịch', key: 'campaignName', width: 34, type: 'string' },
        { header: 'Website gắn', key: 'websiteDomain', width: 22, type: 'string' },
        { header: 'Phân bổ', key: 'attributionStatus', width: 24, type: 'string' },
        { header: 'Chi phí (VNĐ)', key: 'adCost', width: 22, type: 'currency', summaryAgg: 'sum' },
        { header: 'Clicks', key: 'clicks', width: 14, type: 'number', summaryAgg: 'sum' },
        {
          header: 'CPC (VNĐ)',
          key: 'cpc',
          width: 18,
          type: 'currency',
          rowFormula: ({ rowNum, colLetters }) =>
            `IFERROR(ROUND(${colLetters.adCost}${rowNum}/${colLetters.clicks}${rowNum},0),0)`,
          summaryAgg: ({ summaryRowNum, colLetters }) =>
            `IFERROR(ROUND(${colLetters.adCost}${summaryRowNum}/${colLetters.clicks}${summaryRowNum},0),0)`,
        },
        { header: 'Lead từ quảng cáo', key: 'validAdLeads', width: 18, type: 'number', summaryAgg: 'sum' },
        {
          header: 'CPL (VNĐ)',
          key: 'cpl',
          width: 20,
          type: 'currency',
          rowFormula: ({ rowNum, colLetters }) =>
            `IF(${colLetters.validAdLeads}${rowNum}>0,ROUND(${colLetters.adCost}${rowNum}/${colLetters.validAdLeads}${rowNum},0),"")`,
          summaryAgg: ({ summaryRowNum, colLetters }) =>
            `IF(${colLetters.validAdLeads}${summaryRowNum}>0,ROUND(${colLetters.adCost}${summaryRowNum}/${colLetters.validAdLeads}${summaryRowNum},0),"")`,
        },
      ],
      rows: (m04Spec.tables.byCampaign || []).map((c) => ({
        campaignName: c.campaignName,
        websiteDomain: c.websiteDomain || 'Chung/Chưa tách',
        attributionStatus: attributionLabels[c.attributionStatus] || c.attributionStatus,
        adCost: c.adCost ?? 0,
        clicks: c.clicks,
        cpc: c.clicks > 0 && c.adCost ? Math.round(c.adCost / c.clicks) : 0,
        validAdLeads: c.validAttributedAdLeadCount,
        cpl:
          c.costPerValidAdLead !== null && c.costPerValidAdLead !== undefined
            ? Math.round(c.costPerValidAdLead)
            : null,
      })),
      summaryRow: {
        campaignName: `TỔNG (${(m04Spec.tables.byCampaign || []).length} chiến dịch)`,
        websiteDomain: '',
        attributionStatus: '',
        adCost: (m04Spec.tables.byCampaign || []).reduce((s, c) => s + (c.adCost ?? 0), 0),
        clicks: (m04Spec.tables.byCampaign || []).reduce((s, c) => s + c.clicks, 0),
        cpc: 0,
        validAdLeads: (m04Spec.tables.byCampaign || []).reduce((s, c) => s + c.validAttributedAdLeadCount, 0),
        cpl: null,
      },
    },
    {
      name: 'TongHopSales',
      title: `TỔNG HỢP XỬ LÝ THEO SALES — ${dashboard.scopeDescription}`,
      metadata: [
        { label: 'Kỳ báo cáo', value: `${dashboard.fromDate} đến ${dashboard.toDate}` },
        { label: 'Lead tiếp nhận / Hợp lệ', value: `${dashboard.overview.totalLeadsL1} / ${dashboard.overview.validLeadsL2}` },
      ],
      columns: [
        { header: 'Nhân sự / Nhóm đối soát', key: 'salesName', width: 34, type: 'string' },
        { header: 'Lead hợp lệ', key: 'totalLeads', width: 15, type: 'number', summaryAgg: 'sum' },
        { header: 'Vừa nhận thông tin', key: 'newLeads', width: 18, type: 'number', summaryAgg: 'sum' },
        { header: 'Đang soạn báo giá', key: 'quotingLeads', width: 18, type: 'number', summaryAgg: 'sum' },
        { header: 'Đã gửi báo giá', key: 'quoteSentLeads', width: 16, type: 'number', summaryAgg: 'sum' },
        { header: 'Quá hạn >7 ngày', key: 'overdue7d', width: 16, type: 'number', summaryAgg: 'sum' },
        { header: 'Chốt thành công', key: 'wonLeads', width: 16, type: 'number', summaryAgg: 'sum' },
        {
          header: 'Tỷ lệ chốt (%)',
          key: 'winRate',
          width: 16,
          type: 'percent',
          rowFormula: ({ rowNum, colLetters }) =>
            `IFERROR(${colLetters.wonLeads}${rowNum}/${colLetters.totalLeads}${rowNum},0)`,
          summaryAgg: ({ summaryRowNum, colLetters }) =>
            `IFERROR(${colLetters.wonLeads}${summaryRowNum}/${colLetters.totalLeads}${summaryRowNum},0)`,
        },
      ],
      rows: dashboard.salesPerformance.map((sp) => ({
        salesName: sp.salesFullName,
        totalLeads: sp.totalLeads,
        newLeads: sp.newLeads,
        quotingLeads: sp.quotingLeads,
        quoteSentLeads: sp.quoteSentLeads,
        overdue7d: sp.unansweredOverdue7d,
        wonLeads: sp.wonLeads,
        winRate: sp.totalLeads > 0 ? Number((sp.wonLeads / sp.totalLeads).toFixed(4)) : 0,
      })),
      summaryRow: {
        salesName: 'TỔNG CỘNG ĐỘI NGŨ SALES',
        totalLeads: dashboard.salesPerformance.reduce((s, sp) => s + sp.totalLeads, 0),
        newLeads: dashboard.salesPerformance.reduce((s, sp) => s + sp.newLeads, 0),
        quotingLeads: dashboard.salesPerformance.reduce((s, sp) => s + sp.quotingLeads, 0),
        quoteSentLeads: dashboard.salesPerformance.reduce((s, sp) => s + sp.quoteSentLeads, 0),
        overdue7d: dashboard.salesPerformance.reduce((s, sp) => s + sp.unansweredOverdue7d, 0),
        wonLeads: dashboard.salesPerformance.reduce((s, sp) => s + sp.wonLeads, 0),
        winRate: 0,
      },
    },
    {
      name: 'NhuCauSanPham',
      title: `NHU CẦU THEO DÒNG SẢN PHẨM — ${m04Spec.scope.websiteLabel}`,
      metadata: [
        { label: 'Kỳ báo cáo', value: `${m04Spec.scope.startDate} đến ${m04Spec.scope.endDate}` },
      ],
      columns: [
        { header: 'Sản phẩm', key: 'productName', width: 32, type: 'string' },
        { header: 'Lead quan tâm', key: 'leadCount', width: 16, type: 'number', summaryAgg: 'sum' },
        { header: 'Lead hợp lệ', key: 'validCount', width: 15, type: 'number', summaryAgg: 'sum' },
        { header: 'Đã báo giá', key: 'quotedCount', width: 15, type: 'number', summaryAgg: 'sum' },
        { header: 'Chốt thành công', key: 'wonCount', width: 16, type: 'number', summaryAgg: 'sum' },
        {
          header: 'Tỷ lệ chốt (%)',
          key: 'winRate',
          width: 16,
          type: 'percent',
          rowFormula: ({ rowNum, colLetters }) =>
            `IFERROR(${colLetters.wonCount}${rowNum}/${colLetters.validCount}${rowNum},0)`,
          summaryAgg: ({ summaryRowNum, colLetters }) =>
            `IFERROR(${colLetters.wonCount}${summaryRowNum}/${colLetters.validCount}${summaryRowNum},0)`,
        },
      ],
      rows: (m04Spec.tables.byProduct || []).map((p) => ({
        productName: p.productName,
        leadCount: p.leadCount,
        validCount: p.validCount,
        quotedCount: p.quotedCount,
        wonCount: p.wonCount,
        winRate: p.validCount > 0 ? Number((p.wonCount / p.validCount).toFixed(4)) : 0,
      })),
      summaryRow: {
        productName: 'TỔNG CỘNG SẢN PHẨM',
        leadCount: (m04Spec.tables.byProduct || []).reduce((s, p) => s + p.leadCount, 0),
        validCount: (m04Spec.tables.byProduct || []).reduce((s, p) => s + p.validCount, 0),
        quotedCount: (m04Spec.tables.byProduct || []).reduce((s, p) => s + p.quotedCount, 0),
        wonCount: (m04Spec.tables.byProduct || []).reduce((s, p) => s + p.wonCount, 0),
        winRate: 0,
      },
    },
    {
      name: 'ChiTietLead',
      title: `DANH SÁCH CHI TIẾT LEAD CÙNG PHẠM VI — ${dashboard.scopeDescription}`,
      metadata: [
        { label: 'Kỳ báo cáo', value: `${dashboard.fromDate} đến ${dashboard.toDate}` },
        { label: 'Website nguồn', value: dashboard.websiteLabel || 'Tất cả website' },
        { label: 'Tổng bản ghi xuất', value: String(dashboard.detailedLeads.length) },
      ],
      columns: [
        { header: 'STT', key: 'stt', width: 8, type: 'number' },
        { header: 'Mã Lead', key: 'leadCode', width: 16, type: 'string' },
        { header: 'Ngày nhận', key: 'receivedAt', width: 20, type: 'string' },
        { header: 'Sales phụ trách', key: 'assignedSalesName', width: 24, type: 'string' },
        { header: 'Khách hàng / công ty', key: 'companyOrCustomer', width: 32, type: 'string' },
        { header: 'Số điện thoại', key: 'phone', width: 16, type: 'string' },
        { header: 'Website nguồn', key: 'sourceWebsite', width: 20, type: 'string' },
        { header: 'Hình thức liên hệ', key: 'contactChannel', width: 18, type: 'string' },
        { header: 'Kênh marketing', key: 'marketingSource', width: 20, type: 'string' },
        { header: 'Sản phẩm', key: 'productsText', width: 28, type: 'string' },
        { header: 'Trạng thái bán hàng', key: 'pipelineStatusLabel', width: 22, type: 'string' },
        { header: 'Ghi chú / dự án', key: 'noteOrReason', width: 34, type: 'string' },
      ],
      rows: dashboard.detailedLeads.map((r) => ({
        stt: r.stt,
        leadCode: r.leadCode,
        receivedAt: formatVietnamDateTime(r.receivedAt),
        assignedSalesName: r.assignedSalesName,
        companyOrCustomer: r.companyOrCustomer,
        phone: r.phone,
        sourceWebsite: r.sourceWebsite,
        contactChannel: r.contactChannel,
        marketingSource: r.marketingSource,
        productsText: r.productsText,
        pipelineStatusLabel: r.pipelineStatusLabel,
        noteOrReason: r.noteOrReason,
      })),
    },
  ]);

  return {
    buffer: xlsxBuffer,
    fileName: `BaoCao_HieuQuaMarketing_${dashboard.websiteId || 'all'}_${dateStamp}.xlsx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}
