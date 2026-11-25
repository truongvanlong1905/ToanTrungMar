import { prisma } from '@toantrung/database';
import {
  PIPELINE_STATUS_LABELS,
  formatContactChannelClean,
  isL2Valid,
  isL3Effective,
  normalizeMarketingChannelDisplay,
  sanitizeProjectOrSubjectText,
  sanitizeWebsiteSourceDisplay,
  type ContactChannel,
  type M04ResultsReportDto,
  type PipelineStatus,
  type SessionUserDto,
} from '@toantrung/contracts';
import {
  matchesWebsiteDomain,
  paginateArray,
  resolveDashboardScope,
} from '../../../../../core/website-catalog';
import { getOrComputeScopedCache } from '../../../../../core/cache/server-data-cache';
import { getVietnamDateParts } from '../../../../../core/reporting-dates';
import {
  shouldAnonymizeLeadForRole,
} from '../../../../../modules/01-leads/service';
import { computeCostPerValidAdLead } from '../../../../../modules/03-keywords-ads/m03-spec.service';
import { listSeoAiReports } from '../../../../../modules/03-keywords-ads/seo-report.service';
import {
  classifyCampaignWebsiteAttribution,
  getGoogleAdsApiConfig,
  getGoogleConnection,
} from '../../../../../modules/02-tracking-sync/google-oauth.service';

function maskPhoneForReportSpec(phone: string | null): string {
  if (!phone || phone.length < 7) return '***';
  return `${phone.slice(0, 4)}***${phone.slice(-3)}`;
}

export async function getM04ResultsReportSpec(
  user: SessionUserDto,
  params?: {
    websiteId?: string | null;
    preset?: string | null;
    from?: string | null;
    to?: string | null;
    page?: number;
    pageSize?: number;
    detailPage?: number;
    detailPageSize?: number;
    bypassCache?: boolean;
  },
): Promise<M04ResultsReportDto> {
  const scope = await resolveDashboardScope(params);
  const anonymized = shouldAnonymizeLeadForRole(user.roleCode) || user.roleCode === 'DESIGNER';

  const roleLeadFilter: Record<string, unknown> =
    user.roleCode === 'SALES'
      ? { assignedSalesId: user.id }
      : user.roleCode === 'DESIGNER'
        ? { designRequests: { some: {} } }
        : {};

  const cacheResult = await getOrComputeScopedCache<M04ResultsReportDto>({
    key: `m04-spec:${user.roleCode === 'SALES' ? user.id : user.roleCode}:${anonymized ? 'anon' : 'full'}:${scope.websiteId}:${scope.preset}:${scope.startDateStr}:${scope.endDateStr}:${params?.page || 1}:${params?.pageSize || 20}:${params?.detailPage || 1}:${params?.detailPageSize || 25}`,
    domains: ['reports', 'leads', 'tracking', 'ads', 'seo_articles', 'seo_reports', 'design', 'websites'],
    ttlMs: 30_000,
    bypassCache: params?.bypassCache,
    compute: async () => {
      const checkedAt = new Date().toISOString();
      const [
    rawLeads,
    prevRawLeads,
    adsCampaignMetrics,
    prevAdsCampaignMetrics,
    latestSync,
    googleConn,
    adsCfg,
    realAdsCatalogCount,
    receivedInPeriodRows,
    firstQuoteInPeriodRows,
    closedWonInPeriodRows,
    periodActivityRows,
    seoReports,
  ] = await Promise.all([
    prisma.lead.findMany({
      where: {
        createdAt: {
          gte: scope.startDateTime,
          lte: scope.endDateTime,
        },
        ...roleLeadFilter,
      },
      include: {
        assignedSales: {
          select: {
            id: true,
            fullName: true,
            isActive: true,
            role: { select: { roleCode: true, roleName: true } },
          },
        },
        tracking: true,
        leadProducts: { include: { product: { select: { id: true, productName: true } } } },
        activities: {
          where: { actionType: { in: ['quote_sent', 'status_change'] } },
          select: { actionType: true, note: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.lead.findMany({
      where: {
        createdAt: {
          gte: scope.prevStartDateTime,
          lte: scope.prevEndDateTime,
        },
        ...roleLeadFilter,
      },
      select: {
        id: true,
        isSpam: true,
        pipelineStatus: true,
        sourceWebsite: true,
        contactChannel: true,
        createdAt: true,
        tracking: {
          select: {
            marketingSource: true,
            utmSource: true,
            utmMedium: true,
            gclid: true,
          },
        },
      },
    }),
    prisma.platformDailyMetric.findMany({
      where: {
        platform: { in: ['google_ads', 'facebook_ads', 'facebook'] },
        grain: 'campaign',
        metricDate: { gte: scope.startDateStr, lte: scope.endDateStr },
        NOT: [
          { accountPropertyId: { startsWith: 'GA4-' } },
          { campaignExternalId: { startsWith: 'ga4_' } },
          { campaignExternalId: { startsWith: 'PERIOD_SNAPSHOT:' } },
        ],
      },
      select: {
        platform: true,
        campaignExternalId: true,
        spendMicros: true,
        impressions: true,
        clicks: true,
        conversionsMicros: true,
        metricDate: true,
        pageUrlRaw: true,
        campaign: {
          select: {
            utmCampaignSlug: true,
            campaignName: true,
            campaignCode: true,
          },
        },
      },
    }),
    prisma.platformDailyMetric.findMany({
      where: {
        platform: { in: ['google_ads', 'facebook_ads', 'facebook'] },
        grain: 'campaign',
        metricDate: { gte: scope.prevStartDateStr, lte: scope.prevEndDateStr },
        NOT: [
          { accountPropertyId: { startsWith: 'GA4-' } },
          { campaignExternalId: { startsWith: 'ga4_' } },
          { campaignExternalId: { startsWith: 'PERIOD_SNAPSHOT:' } },
        ],
      },
      select: {
        campaignExternalId: true,
        spendMicros: true,
        pageUrlRaw: true,
        campaign: {
          select: {
            utmCampaignSlug: true,
            campaignName: true,
          },
        },
      },
    }),
    prisma.platformSyncLog.findFirst({
      where: { status: 'success' },
      orderBy: { id: 'desc' },
    }),
    getGoogleConnection(),
    getGoogleAdsApiConfig(),
    prisma.campaign.count({
      where: {
        platform: 'google_ads',
        NOT: [{ accountExternalId: 'default' }, { accountExternalId: { startsWith: 'GA4-' } }],
      },
    }),
    prisma.lead.findMany({
      where: {
        receivedAt: { gte: scope.startDateTime, lte: scope.endDateTime },
        isSpam: false,
        ...roleLeadFilter,
      },
      select: { id: true, sourceWebsite: true },
    }),
    prisma.lead.findMany({
      where: {
        firstQuoteSentAt: { gte: scope.startDateTime, lte: scope.endDateTime },
        isSpam: false,
        ...roleLeadFilter,
      },
      select: { id: true, createdAt: true, sourceWebsite: true },
    }),
    prisma.lead.findMany({
      where: {
        pipelineStatus: 'won',
        closedAt: { gte: scope.startDateTime, lte: scope.endDateTime },
        isSpam: false,
        ...roleLeadFilter,
      },
      select: { id: true, createdAt: true, sourceWebsite: true },
    }),
    prisma.leadActivity.findMany({
      where: {
        createdAt: { gte: scope.startDateTime, lte: scope.endDateTime },
        actionType: { in: ['quote_sent', 'status_change'] },
        lead: { isSpam: false, ...roleLeadFilter },
      },
      select: {
        leadId: true,
        actionType: true,
        newStatus: true,
        lead: { select: { createdAt: true, sourceWebsite: true } },
      },
    }),
    listSeoAiReports().catch(() => []),
  ]);

  const isGoogleOAuthError = Boolean(
    googleConn?.connected &&
      !googleConn.isSandboxDemo &&
      (googleConn.connectionStatus === 'EXPIRED' ||
        googleConn.connectionStatus === 'PERMISSION_ERROR' ||
        googleConn.connectionStatus === 'SYNC_ERROR'),
  );

  const hasAdsToken =
    !isGoogleOAuthError &&
    (Boolean(adsCfg?.developerToken) ||
      Boolean(
        googleConn?.connected &&
          !googleConn.isSandboxDemo &&
          googleConn.scopes?.some((s) => s.includes('adwords')),
      ) ||
      realAdsCatalogCount > 0);

  const isPaidAdLeadRecord = (l: {
    contactChannel?: string | null;
    tracking?: {
      marketingSource?: string | null;
      utmSource?: string | null;
      utmMedium?: string | null;
      gclid?: string | null;
    } | null;
  }) => {
    const med = (l.tracking?.utmMedium || '').toLowerCase();
    const src = (l.tracking?.marketingSource || '').toLowerCase();
    return Boolean(
      l.tracking?.gclid ||
        l.contactChannel === 'google_lead_form' ||
        med === 'cpc' ||
        med === 'ppc' ||
        med === 'paid' ||
        src.includes('google ads') ||
        src.includes('facebook ads'),
    );
  };

  const leads = rawLeads.filter((l) => matchesWebsiteDomain(l.sourceWebsite, scope.selectedWebsite));
  const prevLeads = prevRawLeads.filter((l) =>
    matchesWebsiteDomain(l.sourceWebsite, scope.selectedWebsite),
  );

  const receivedLeadCount = leads.length;
  const validLeads = leads.filter((l) => isL2Valid(l));
  const validLeadCount = validLeads.length;
  const effectiveLeadCount = leads.filter((l) => isL3Effective(l)).length;
  const spamCount = receivedLeadCount - validLeadCount;

  const prevReceivedCount = prevLeads.length;
  const prevValidLeadsList = prevLeads.filter((l) => isL2Valid(l));
  const prevValidCount = prevValidLeadsList.length;
  const prevWonCount = prevValidLeadsList.filter((l) => l.pipelineStatus === 'won').length;
  const prevValidAttributedAdLeadCount = prevValidLeadsList.filter(isPaidAdLeadRecord).length;
  const prevWinRatePct =
    prevValidCount > 0 ? Number(((prevWonCount / prevValidCount) * 100).toFixed(1)) : null;

  const hasQuoteEvidence = (l: (typeof leads)[number]) =>
    Boolean(l.firstQuoteSentAt) ||
    l.pipelineStatus === 'quote_sent' ||
    l.pipelineStatus === 'won' ||
    l.activities.some((a: { actionType: string }) => a.actionType === 'quote_sent');

  const pendingAcceptanceCount = validLeads.filter(
    (l) => l.pipelineStatus === 'new_lead' && !l.receivedAt,
  ).length;
  const newLeadStageCount = validLeads.filter((l) => l.pipelineStatus === 'new_lead').length;
  const draftingQuoteCount = validLeads.filter((l) => l.pipelineStatus === 'quoting').length;
  const waitingQuoteLeads = validLeads.filter((l) => l.pipelineStatus === 'quote_sent');
  const waitingQuoteCount = waitingQuoteLeads.length;
  const wonLeads = validLeads.filter((l) => l.pipelineStatus === 'won');
  const wonLeadCount = wonLeads.length;
  const lostLeadCount = validLeads.filter((l) => l.pipelineStatus === 'lost').length;
  const quotedLeads = validLeads.filter(hasQuoteEvidence);

  const nowMs = Date.now();
  const overdueQuotes = waitingQuoteLeads.filter((l) => {
    const refMs = (l.firstQuoteSentAt || l.updatedAt || l.createdAt).getTime();
    return (nowMs - refMs) / (1000 * 60 * 60 * 24) >= 7;
  });

  const winRateDenominator = validLeadCount;
  const winRateNumerator = wonLeadCount;
  const winRatePct =
    winRateDenominator > 0
      ? Number(((winRateNumerator / winRateDenominator) * 100).toFixed(1))
      : null;

  // Đối soát chi phí quảng cáo và Lead quảng cáo hợp lệ (C04 & C09 & MK02)
  const validAdLeads = validLeads.filter((l) => isPaidAdLeadRecord(l));

  // Phân nhóm từng campaign theo quy tắc: MULTI_WEBSITE_UNSPLIT tuyệt đối không gán 100% chi phí cho từng web
  const campAggMap = new Map<
    string,
    {
      campaignId: string;
      campaignName: string;
      platform: string;
      websiteDomain: string | null;
      attributionStatus: 'SINGLE_WEBSITE' | 'MULTI_WEBSITE_UNSPLIT' | 'UNATTRIBUTED';
      spendMicros: bigint;
      clicks: number;
      impressions: number;
      conversionsMicros: bigint;
      finalUrls: Set<string>;
      existingSlug: string | null;
    }
  >();

  for (const r of adsCampaignMetrics) {
    const cid = (r.campaignExternalId || r.campaign?.campaignCode || r.campaign?.campaignName || 'unknown').trim();
    const cname = (r.campaign?.campaignName || r.campaignExternalId || cid).trim();
    const existing = campAggMap.get(cid) || {
      campaignId: cid,
      campaignName: cname,
      platform: r.platform,
      websiteDomain: null,
      attributionStatus: 'UNATTRIBUTED' as const,
      spendMicros: 0n,
      clicks: 0,
      impressions: 0,
      conversionsMicros: 0n,
      finalUrls: new Set<string>(),
      existingSlug: r.campaign?.utmCampaignSlug || null,
    };
    existing.spendMicros += r.spendMicros ?? 0n;
    existing.clicks += r.clicks || 0;
    existing.impressions += r.impressions || 0;
    existing.conversionsMicros += r.conversionsMicros ?? 0n;
    if (r.pageUrlRaw) existing.finalUrls.add(r.pageUrlRaw);
    campAggMap.set(cid, existing);
  }

  let totalAllCampaignMicros = 0n;
  let singleSiteMatchedMicros = 0n;
  let singleSiteMatchedCount = 0;
  let multiWebsiteExcludedMicros = 0n;
  const multiWebsiteCampIds = new Set<string>();
  const scopedCampIds = new Set<string>();
  const adCostMicrosByWebsite = new Map<string, bigint>();

  for (const camp of campAggMap.values()) {
    const attr = classifyCampaignWebsiteAttribution(
      camp.campaignName,
      Array.from(camp.finalUrls),
      camp.existingSlug,
    );
    camp.attributionStatus = attr.status;
    camp.websiteDomain = attr.domain;
    totalAllCampaignMicros += camp.spendMicros;

    if (!scope.selectedWebsite) {
      scopedCampIds.add(camp.campaignId);
    }

    if (attr.status === 'SINGLE_WEBSITE' && attr.domain) {
      const prevDomMicros = adCostMicrosByWebsite.get(attr.domain) ?? 0n;
      adCostMicrosByWebsite.set(attr.domain, prevDomMicros + camp.spendMicros);
      if (scope.selectedWebsite && matchesWebsiteDomain(attr.domain, scope.selectedWebsite)) {
        singleSiteMatchedMicros += camp.spendMicros;
        singleSiteMatchedCount += 1;
        scopedCampIds.add(camp.campaignId);
      }
    } else if (attr.status === 'MULTI_WEBSITE_UNSPLIT') {
      multiWebsiteExcludedMicros += camp.spendMicros;
      multiWebsiteCampIds.add(camp.campaignId);
    }
  }

  let attributedAdCost: number | null = null;
  let adReconciliationNote = '';
  const multiWebsiteExcludedAdCost =
    multiWebsiteExcludedMicros > 0n
      ? Number((Number(multiWebsiteExcludedMicros) / 1_000_000).toFixed(0))
      : null;

  if (adsCampaignMetrics.length > 0) {
    if (!scope.selectedWebsite) {
      attributedAdCost = Number((Number(totalAllCampaignMicros) / 1_000_000).toFixed(0));
      adReconciliationNote =
        multiWebsiteCampIds.size > 0
          ? `Tổng hợp toàn bộ chiến dịch; ${multiWebsiteCampIds.size} chiến dịch đa website không tự chia về từng domain.`
          : 'Tổng chi phí quảng cáo thực tế đối soát với Lead từ quảng cáo.';
    } else if (singleSiteMatchedCount > 0) {
      attributedAdCost = Number((Number(singleSiteMatchedMicros) / 1_000_000).toFixed(0));
      adReconciliationNote =
        multiWebsiteCampIds.size > 0
          ? `Chi phí chiến dịch riêng của ${scope.selectedWebsite.domain} (đã tách riêng ${multiWebsiteCampIds.size} chiến dịch đa website trị giá ${Number((Number(multiWebsiteExcludedMicros) / 1_000_000).toFixed(0)).toLocaleString('vi-VN')} ₫).`
          : `Chi phí chiến dịch gắn riêng cho ${scope.selectedWebsite.domain}.`;
    } else {
      attributedAdCost = null;
      adReconciliationNote =
        multiWebsiteCampIds.size > 0
          ? `Chưa có chiến dịch riêng cho ${scope.selectedWebsite.domain}; có ${multiWebsiteCampIds.size} chiến dịch chạy chung nhiều web (${Number((Number(multiWebsiteExcludedMicros) / 1_000_000).toFixed(0)).toLocaleString('vi-VN')} ₫).`
          : `Chưa có chi phí chiến dịch gắn riêng cho ${scope.selectedWebsite.domain}.`;
    }
  } else if (isGoogleOAuthError) {
    attributedAdCost = null;
    adReconciliationNote =
      'Kết nối Google Ads đang lỗi hoặc hết hạn — vui lòng kết nối lại trong Cài đặt.';
  } else {
    attributedAdCost = hasAdsToken && !scope.selectedWebsite ? 0 : null;
    adReconciliationNote = hasAdsToken
      ? 'Chưa phát sinh chi phí quảng cáo trong kỳ đang chọn.'
      : 'Chưa kết nối tài khoản Google Ads.';
  }

  let prevAdCost: number | null = null;
  if (prevAdsCampaignMetrics.length > 0) {
    if (!scope.selectedWebsite) {
      const m = prevAdsCampaignMetrics.reduce((s, r) => s + (r.spendMicros ?? 0n), 0n);
      prevAdCost = Number((Number(m) / 1_000_000).toFixed(0));
    } else {
      let prevSingleMicros = 0n;
      let prevSingleHits = 0;
      for (const r of prevAdsCampaignMetrics) {
        const attr = classifyCampaignWebsiteAttribution(
          r.campaign?.campaignName || r.campaignExternalId || '',
          r.pageUrlRaw ? [r.pageUrlRaw] : [],
          r.campaign?.utmCampaignSlug,
        );
        if (attr.status === 'SINGLE_WEBSITE' && attr.domain && matchesWebsiteDomain(attr.domain, scope.selectedWebsite)) {
          prevSingleMicros += r.spendMicros ?? 0n;
          prevSingleHits += 1;
        }
      }
      prevAdCost = prevSingleHits > 0 ? Number((Number(prevSingleMicros) / 1_000_000).toFixed(0)) : null;
    }
  }
  const prevCostPerValidAdLead = computeCostPerValidAdLead(prevAdCost, prevValidAttributedAdLeadCount);

  const costPerValidAdLead = computeCostPerValidAdLead(attributedAdCost, validAdLeads.length);

  // C09: Dùng phân bố trạng thái hiện tại đúng bản chất dữ liệu (không giả làm phễu tích lũy nhiều bước)
  const pctOf = (count: number) =>
    receivedLeadCount > 0 ? Number(((count / receivedLeadCount) * 100).toFixed(1)) : 0;

  const statusDistribution = [
    {
      statusKey: 'new_lead',
      label: PIPELINE_STATUS_LABELS.new_lead,
      count: newLeadStageCount,
      pctOfTotal: pctOf(newLeadStageCount),
    },
    {
      statusKey: 'quoting',
      label: PIPELINE_STATUS_LABELS.quoting,
      count: draftingQuoteCount,
      pctOfTotal: pctOf(draftingQuoteCount),
    },
    {
      statusKey: 'quote_sent',
      label: PIPELINE_STATUS_LABELS.quote_sent,
      count: waitingQuoteCount,
      pctOfTotal: pctOf(waitingQuoteCount),
    },
    {
      statusKey: 'won',
      label: PIPELINE_STATUS_LABELS.won,
      count: wonLeadCount,
      pctOfTotal: pctOf(wonLeadCount),
    },
    {
      statusKey: 'lost',
      label: PIPELINE_STATUS_LABELS.lost,
      count: lostLeadCount,
      pctOfTotal: pctOf(lostLeadCount),
    },
    ...(spamCount > 0
      ? [
          {
            statusKey: 'spam',
            label: 'Đã xác minh spam (loại trừ)',
            count: spamCount,
            pctOfTotal: pctOf(spamCount),
          },
        ]
      : []),
  ];

  // Giữ leadFunnel tương thích ngược với các bài test cũ trên cùng cohort
  const leadFunnel = [
    { stageKey: 'received', label: 'Lead tiếp nhận', distinctLeadCount: receivedLeadCount },
    { stageKey: 'valid', label: 'Lead hợp lệ', distinctLeadCount: validLeadCount },
    { stageKey: 'quoted', label: 'Có gửi báo giá', distinctLeadCount: quotedLeads.length },
    { stageKey: 'won', label: 'Chốt thành công', distinctLeadCount: wonLeadCount },
  ];

  // Phân tích nhu cầu sản phẩm + phần chưa phân loại sản phẩm (C09)
  let unclassifiedProductLeadCount = 0;
  let multiProductLeadCount = 0;
  const prodMap = new Map<
    number,
    {
      productId: number;
      productName: string;
      isUnclassifiedProduct?: boolean;
      leadCount: number;
      validCount: number;
      quotedCount: number;
      wonCount: number;
    }
  >();

  for (const l of leads) {
    const uniqueProds = Array.from(
      new Map(l.leadProducts.map((lp) => [lp.productId, lp])).values(),
    );
    if (uniqueProds.length === 0) {
      unclassifiedProductLeadCount += 1;
      const unclass = prodMap.get(0) || {
        productId: 0,
        productName: 'Chưa phân loại sản phẩm',
        isUnclassifiedProduct: true,
        leadCount: 0,
        validCount: 0,
        quotedCount: 0,
        wonCount: 0,
      };
      unclass.leadCount += 1;
      if (isL2Valid(l)) unclass.validCount += 1;
      if (isL2Valid(l) && hasQuoteEvidence(l)) unclass.quotedCount += 1;
      if (isL2Valid(l) && l.pipelineStatus === 'won') unclass.wonCount += 1;
      prodMap.set(0, unclass);
      continue;
    }

    if (uniqueProds.length > 1) {
      multiProductLeadCount += 1;
    }
    for (const lp of uniqueProds) {
      const cur = prodMap.get(lp.productId) || {
        productId: lp.productId,
        productName: lp.product.productName,
        isUnclassifiedProduct: false,
        leadCount: 0,
        validCount: 0,
        quotedCount: 0,
        wonCount: 0,
      };
      cur.leadCount += 1;
      if (isL2Valid(l)) cur.validCount += 1;
      if (isL2Valid(l) && hasQuoteEvidence(l)) cur.quotedCount += 1;
      if (isL2Valid(l) && l.pipelineStatus === 'won') cur.wonCount += 1;
      prodMap.set(lp.productId, cur);
    }
  }

  const classifiedProductRows = Array.from(prodMap.values())
    .filter((p) => !p.isUnclassifiedProduct)
    .sort((a, b) => b.leadCount - a.leadCount);
  const unclassifiedProductRow = prodMap.get(0);
  const byProduct = [
    ...classifiedProductRows,
    ...(unclassifiedProductRow ? [unclassifiedProductRow] : []),
  ];

  // Đối soát đầy đủ theo nhân sự (C04 & C09: cộng khớp 100% với receivedLeadCount, làm rõ giao ngoài nhóm Sales / chưa giao / ngưng hoạt động)
  const salesMap = new Map<
    number,
    {
      salesId: number;
      salesName: string;
      roleLabel?: string;
      isReconciliationBucket?: boolean;
      leadCount: number;
      validCount: number;
      quotedCount: number;
      waitingCount: number;
      wonCount: number;
      overdueCount: number;
    }
  >();

  for (const l of leads) {
    const sid = l.assignedSalesId || 0;
    const roleCode = l.assignedSales?.role?.roleCode || null;
    const isStandardSales = roleCode === 'SALES' || roleCode === 'SALES_LEAD';
    const isInactive = l.assignedSales ? !l.assignedSales.isActive : false;
    const roleNote = !l.assignedSales
      ? 'Chưa giao nhân sự'
      : !isStandardSales
        ? `Ngoài danh sách Sales (${l.assignedSales.role?.roleName || roleCode})`
        : isInactive
          ? 'Nhân sự ngừng hoạt động'
          : l.assignedSales.role?.roleName || 'Kinh doanh';

    const sname = l.assignedSales
      ? !isStandardSales
        ? `${l.assignedSales.fullName} (${l.assignedSales.role?.roleName || roleCode})`
        : isInactive
          ? `${l.assignedSales.fullName} (Ngừng hoạt động)`
          : l.assignedSales.fullName
      : 'Chưa phân bổ';

    const cur = salesMap.get(sid) || {
      salesId: sid,
      salesName: sname,
      roleLabel: roleNote,
      isReconciliationBucket: !l.assignedSales || !isStandardSales,
      leadCount: 0,
      validCount: 0,
      quotedCount: 0,
      waitingCount: 0,
      wonCount: 0,
      overdueCount: 0,
    };
    cur.leadCount += 1;
    if (isL2Valid(l)) cur.validCount += 1;
    if (isL2Valid(l) && hasQuoteEvidence(l)) cur.quotedCount += 1;
    if (isL2Valid(l) && l.pipelineStatus === 'quote_sent') {
      cur.waitingCount += 1;
      const refMs = (l.firstQuoteSentAt || l.updatedAt || l.createdAt).getTime();
      if ((nowMs - refMs) / (1000 * 60 * 60 * 24) >= 7) cur.overdueCount += 1;
    }
    if (isL2Valid(l) && l.pipelineStatus === 'won') cur.wonCount += 1;
    salesMap.set(sid, cur);
  }

  const bySales = Array.from(salesMap.values()).sort((a, b) => {
    if (Boolean(a.isReconciliationBucket) !== Boolean(b.isReconciliationBucket)) {
      return a.isReconciliationBucket ? 1 : -1;
    }
    return b.leadCount - a.leadCount;
  });

  // Phân tích theo Website nguồn (không cộng lặp, làm rõ phần chưa xác định website)
  const webMap = new Map<
    string,
    {
      website: string;
      isUnclassifiedWebsite?: boolean;
      leadCount: number;
      validCount: number;
      quotedCount: number;
      wonCount: number;
      adLeadCount: number;
      cpl: number | null;
    }
  >();

  for (const l of leads) {
    const cleanWeb = sanitizeWebsiteSourceDisplay(l.sourceWebsite).cleanLabel;
    const isUnclassified = !cleanWeb;
    const wKey = cleanWeb || 'Chưa xác định';
    const cur = webMap.get(wKey) || {
      website: wKey,
      isUnclassifiedWebsite: isUnclassified,
      leadCount: 0,
      validCount: 0,
      quotedCount: 0,
      wonCount: 0,
      adLeadCount: 0,
      cpl: null,
    };
    cur.leadCount += 1;
    if (isL2Valid(l)) {
      cur.validCount += 1;
      if (hasQuoteEvidence(l)) cur.quotedCount += 1;
      const ch = normalizeMarketingChannelDisplay({
        marketingSource: l.tracking?.marketingSource,
        utmSource: l.tracking?.utmSource,
        utmMedium: l.tracking?.utmMedium,
        gclid: l.tracking?.gclid,
        contactChannel: l.contactChannel,
      });
      if (ch === 'Google Ads' || ch === 'Quảng cáo Facebook') {
        cur.adLeadCount += 1;
      }
      if (l.pipelineStatus === 'won') cur.wonCount += 1;
    }
    webMap.set(wKey, cur);
  }

  const byWebsite = Array.from(webMap.values())
    .map((w) => {
      const webMicros = !w.isUnclassifiedWebsite ? adCostMicrosByWebsite.get(w.website.toLowerCase()) ?? null : null;
      const webAdCost = webMicros !== null ? Number((Number(webMicros) / 1_000_000).toFixed(0)) : null;
      return {
        ...w,
        adCost: webAdCost,
        cpl: computeCostPerValidAdLead(webAdCost, w.adLeadCount),
        winRatePct: w.validCount > 0 ? Number(((w.wonCount / w.validCount) * 100).toFixed(1)) : null,
      };
    })
    .sort((a, b) => {
      if (Boolean(a.isUnclassifiedWebsite) !== Boolean(b.isUnclassifiedWebsite)) {
        return a.isUnclassifiedWebsite ? 1 : -1;
      }
      return b.leadCount - a.leadCount;
    });

  // Phân tích theo Kênh marketing chuẩn hóa (C04: tách khỏi hình thức liên hệ, không tự gán Organic/Direct)
  const chMap = new Map<
    string,
    { channel: string; leadCount: number; validCount: number; quotedCount: number; wonCount: number }
  >();
  for (const l of leads) {
    const ch = normalizeMarketingChannelDisplay({
      marketingSource: l.tracking?.marketingSource,
      utmSource: l.tracking?.utmSource,
      utmMedium: l.tracking?.utmMedium,
      gclid: l.tracking?.gclid,
      contactChannel: l.contactChannel,
    });
    const cur = chMap.get(ch) || {
      channel: ch,
      leadCount: 0,
      validCount: 0,
      quotedCount: 0,
      wonCount: 0,
    };
    cur.leadCount += 1;
    if (isL2Valid(l)) {
      cur.validCount += 1;
      if (hasQuoteEvidence(l)) cur.quotedCount += 1;
      if (l.pipelineStatus === 'won') cur.wonCount += 1;
    }
    chMap.set(ch, cur);
  }

  const byChannel = Array.from(chMap.values())
    .map((c) => ({
      ...c,
      winRatePct: c.validCount > 0 ? Number(((c.wonCount / c.validCount) * 100).toFixed(1)) : null,
      shareOfValidPct: validLeadCount > 0 ? Number(((c.validCount / validLeadCount) * 100).toFixed(1)) : null,
    }))
    .sort((a, b) => {
      if ((a.channel === 'Chưa xác định') !== (b.channel === 'Chưa xác định')) {
        return a.channel === 'Chưa xác định' ? 1 : -1;
      }
      return b.validCount - a.validCount || b.leadCount - a.leadCount;
    });

  // Đối chiếu theo từng Chiến dịch (MK02)
  const crmCampaignStats = new Map<
    string,
    { received: number; valid: number; validAd: number; won: number }
  >();
  for (const l of leads) {
    const rawKey = (l.tracking?.utmCampaign || l.tracking?.campaignName || '').trim().toLowerCase();
    if (!rawKey) continue;
    const prev = crmCampaignStats.get(rawKey) || { received: 0, valid: 0, validAd: 0, won: 0 };
    prev.received += 1;
    if (isL2Valid(l)) {
      prev.valid += 1;
      if (isPaidAdLeadRecord(l)) prev.validAd += 1;
      if (l.pipelineStatus === 'won') prev.won += 1;
    }
    crmCampaignStats.set(rawKey, prev);
  }

  const byCampaign = Array.from(campAggMap.values())
    .filter((camp) => {
      if (!scope.selectedWebsite) return true;
      return camp.attributionStatus === 'SINGLE_WEBSITE' && camp.websiteDomain && matchesWebsiteDomain(camp.websiteDomain, scope.selectedWebsite);
    })
    .map((camp) => {
      const adCost = Number((Number(camp.spendMicros) / 1_000_000).toFixed(0));
      const conv = Number((Number(camp.conversionsMicros) / 1_000_000).toFixed(1));
      const strippedId = camp.campaignId.replace(/^GADS_/i, '').trim().toLowerCase();
      const matched =
        crmCampaignStats.get(camp.campaignName.trim().toLowerCase()) ||
        crmCampaignStats.get(camp.campaignId.trim().toLowerCase()) ||
        crmCampaignStats.get(strippedId) ||
        { received: 0, valid: 0, validAd: 0, won: 0 };
      return {
        campaignId: camp.campaignId,
        campaignName: camp.campaignName,
        platform: camp.platform,
        websiteDomain: camp.websiteDomain,
        attributionStatus: camp.attributionStatus,
        adCost,
        clicks: camp.clicks,
        impressions: camp.impressions,
        platformConversions: conv,
        receivedLeadCount: matched.received,
        validLeadCount: matched.valid,
        validAttributedAdLeadCount: matched.validAd,
        costPerValidAdLead: computeCostPerValidAdLead(adCost, matched.validAd),
        wonLeadCount: matched.won,
        winRatePct: matched.valid > 0 ? Number(((matched.won / matched.valid) * 100).toFixed(1)) : null,
      };
    })
    .sort((a, b) => (b.adCost ?? 0) - (a.adCost ?? 0) || b.clicks - a.clicks);

  // Chuỗi thời gian theo ngày (0 cho ngày xác nhận không có Lead, null ngoài ngưỡng tương lai)
  const dayFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const todayStr = dayFmt.format(new Date());
  const leadDayMap = new Map<string, { received: number; valid: number; won: number }>();
  for (const l of leads) {
    const dk = dayFmt.format(l.createdAt);
    const cur = leadDayMap.get(dk) || { received: 0, valid: 0, won: 0 };
    cur.received += 1;
    if (isL2Valid(l)) {
      cur.valid += 1;
      if (l.pipelineStatus === 'won') cur.won += 1;
    }
    leadDayMap.set(dk, cur);
  }
  const adCostDayMap = new Map<string, bigint>();
  if (attributedAdCost !== null) {
    for (const r of adsCampaignMetrics) {
      const cid = (r.campaignExternalId || r.campaign?.campaignCode || r.campaign?.campaignName || 'unknown').trim();
      if (!scopedCampIds.has(cid) || !r.metricDate) continue;
      adCostDayMap.set(r.metricDate, (adCostDayMap.get(r.metricDate) ?? 0n) + (r.spendMicros ?? 0n));
    }
  }

  const timeSeries: NonNullable<M04ResultsReportDto['timeSeries']> = [];
  {
    const cursor = new Date(`${scope.startDateStr}T00:00:00Z`);
    const endDt = new Date(`${scope.endDateStr}T00:00:00Z`);
    let safety = 0;
    while (cursor <= endDt && safety < 400) {
      safety += 1;
      const dStr = cursor.toISOString().slice(0, 10);
      const isFuture = dStr > todayStr;
      const dayCounts = leadDayMap.get(dStr) || { received: 0, valid: 0, won: 0 };
      const dayCost = attributedAdCost !== null
        ? Number((Number(adCostDayMap.get(dStr) ?? 0n) / 1_000_000).toFixed(0))
        : null;
      timeSeries.push({
        bucketStart: dStr,
        bucketEnd: dStr,
        label: `${dStr.slice(8, 10)}/${dStr.slice(5, 7)}`,
        receivedLeadCount: isFuture ? null : dayCounts.received,
        validLeadCount: isFuture ? null : dayCounts.valid,
        wonLeadCount: isFuture ? null : dayCounts.won,
        adCost: isFuture ? null : dayCost,
        isMissingDay: isFuture,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  const prevLeadDayMap = new Map<string, { received: number; valid: number; won: number }>();
  for (const l of prevLeads) {
    const dk = dayFmt.format(l.createdAt);
    const cur = prevLeadDayMap.get(dk) || { received: 0, valid: 0, won: 0 };
    cur.received += 1;
    if (isL2Valid(l)) {
      cur.valid += 1;
      if (l.pipelineStatus === 'won') cur.won += 1;
    }
    prevLeadDayMap.set(dk, cur);
  }
  const previousTimeSeries: NonNullable<M04ResultsReportDto['previousTimeSeries']> = [];
  {
    const cursor = new Date(`${scope.prevStartDateStr}T00:00:00Z`);
    const endDt = new Date(`${scope.prevEndDateStr}T00:00:00Z`);
    let safety = 0;
    while (cursor <= endDt && safety < 400) {
      safety += 1;
      const dStr = cursor.toISOString().slice(0, 10);
      const isFuture = dStr > todayStr;
      const dayCounts = prevLeadDayMap.get(dStr) || { received: 0, valid: 0, won: 0 };
      previousTimeSeries.push({
        bucketStart: dStr,
        label: `${dStr.slice(8, 10)}/${dStr.slice(5, 7)}`,
        receivedLeadCount: isFuture ? null : dayCounts.received,
        validLeadCount: isFuture ? null : dayCounts.valid,
        wonLeadCount: isFuture ? null : dayCounts.won,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  const missingWebsiteCount = leads.filter(
    (l) => !sanitizeWebsiteSourceDisplay(l.sourceWebsite).cleanLabel,
  ).length;
  const unknownChannelCount = leads.filter((l) => {
    const ch = normalizeMarketingChannelDisplay({
      marketingSource: l.tracking?.marketingSource,
      utmSource: l.tracking?.utmSource,
      utmMedium: l.tracking?.utmMedium,
      gclid: l.tracking?.gclid,
      contactChannel: l.contactChannel,
    });
    return ch === 'Chưa xác định';
  }).length;
  const attributionCoveragePct =
    receivedLeadCount > 0
      ? Number((((receivedLeadCount - missingWebsiteCount) / receivedLeadCount) * 100).toFixed(1))
      : null;

  const matchingSeoReport =
    seoReports.find((r) =>
      scope.selectedWebsite
        ? r.website.toLowerCase().includes(scope.selectedWebsite.domain.toLowerCase())
        : r.website.toLowerCase().includes('tất cả') || r.website === 'all',
    ) || seoReports[0] || null;

  const summaryFindings: NonNullable<M04ResultsReportDto['marketingInsights']>['summaryFindings'] = [];
  if (attributedAdCost !== null) {
    summaryFindings.push({
      id: 'ad_efficiency',
      severity: costPerValidAdLead !== null && validAdLeads.length > 0 ? 'info' : 'warning',
      title: 'Chi phí quảng cáo & CPL',
      evidenceText:
        validAdLeads.length > 0 && costPerValidAdLead !== null
          ? `Chi phí ${attributedAdCost.toLocaleString('vi-VN')} ₫ mang về ${validAdLeads.length} Lead quảng cáo hợp lệ (CPL: ${Math.round(costPerValidAdLead).toLocaleString('vi-VN')} ₫/Lead).`
          : `Ghi nhận ${attributedAdCost.toLocaleString('vi-VN')} ₫ chi tiêu trong kỳ nhưng chưa có Lead quảng cáo hợp lệ gắn GCLID/UTM trùng khớp để tính CPL.`,
      actionHref: `/tracking?section=ads_campaigns&websiteId=${encodeURIComponent(scope.websiteId)}`,
      actionLabel: 'Kiểm tra chiến dịch',
    });
  }
  if (multiWebsiteCampIds.size > 0 && scope.selectedWebsite && multiWebsiteExcludedAdCost !== null) {
    summaryFindings.push({
      id: 'multi_site_excluded',
      severity: 'info',
      title: `Có ${multiWebsiteCampIds.size} chiến dịch chạy chung nhiều website`,
      evidenceText: `Tổng ${multiWebsiteExcludedAdCost.toLocaleString('vi-VN')} ₫ chi tiêu chạy chung nhiều tên miền được tách khỏi bộ lọc ${scope.selectedWebsite.domain} để tránh cộng nhầm.`,
    });
  }
  if (validLeadCount > 0) {
    summaryFindings.push({
      id: 'lead_conversion_cohort',
      severity: wonLeadCount > 0 ? 'info' : 'warning',
      title: 'Hiệu quả chuyển đổi trong kỳ',
      evidenceText: `Trong ${receivedLeadCount} Lead tiếp nhận có ${validLeadCount} Lead hợp lệ, tỷ lệ chốt đạt ${winRatePct !== null ? `${winRatePct}%` : '—'} (${wonLeadCount} chốt${overdueQuotes.length > 0 ? `, ${overdueQuotes.length} báo giá quá hạn >7 ngày` : ''}).`,
      actionHref: `/leads?from=${encodeURIComponent(scope.startDateStr)}&to=${encodeURIComponent(scope.endDateStr)}${scope.websiteId !== 'all' ? `&websiteId=${encodeURIComponent(scope.websiteId)}` : ''}`,
      actionLabel: 'Mở danh sách Lead',
    });
  }
  if (unclassifiedProductLeadCount > 0) {
    summaryFindings.push({
      id: 'missing_product_classification',
      severity: 'action',
      title: `${unclassifiedProductLeadCount} Lead chưa gắn sản phẩm quan tâm`,
      evidenceText: `Cần rà soát và gắn dòng sản phẩm cho ${unclassifiedProductLeadCount} hồ sơ để báo cáo theo sản phẩm phản ánh đúng nhu cầu thực tế.`,
      actionHref: `/leads?from=${encodeURIComponent(scope.startDateStr)}&to=${encodeURIComponent(scope.endDateStr)}${scope.websiteId !== 'all' ? `&websiteId=${encodeURIComponent(scope.websiteId)}` : ''}`,
      actionLabel: 'Gắn sản phẩm Lead',
    });
  }

  const recommendedActions: NonNullable<M04ResultsReportDto['marketingInsights']>['recommendedActions'] = [
    {
      id: 'propose_seo_content',
      title: 'Đề xuất bài nội dung SEO',
      reason: matchingSeoReport
        ? `Dựa trên snapshot SEO gần nhất (${matchingSeoReport.snapshot.current.totalClicks} clicks / ${matchingSeoReport.snapshot.current.totalImpressions} impressions).`
        : 'Tạo đề xuất bài viết mới trên module Từ khóa & SEO theo phạm vi website đang chọn.',
      targetType: 'seo_content',
      href: `/ads?tab=content&website=${encodeURIComponent(scope.domain || 'toantrung.com.vn')}`,
    },
    {
      id: 'create_design_brief',
      title: 'Tạo brief thiết kế cho chiến dịch',
      reason: `Giữ nguyên bối cảnh phạm vi ${scope.websiteLabel} (${scope.startDateStr} → ${scope.endDateStr}) để team Thiết kế xử lý banner/ấn phẩm mới.`,
      targetType: 'design_brief',
      href: `/design?fromBrief=1&taskCode=banner_generate&sourceModule=reports&websiteId=${encodeURIComponent(scope.websiteId)}&dateFrom=${encodeURIComponent(scope.startDateStr)}&dateTo=${encodeURIComponent(scope.endDateStr)}`,
      prefillParams: {
        websiteId: scope.websiteId,
        websiteDomain: scope.domain || '',
        dateFrom: scope.startDateStr,
        dateTo: scope.endDateStr,
        sourceModule: 'reports',
      },
    },
  ];

  const pendingActionRows = waitingQuoteLeads
    .map((l) => {
      const refDate = l.firstQuoteSentAt || l.updatedAt || l.createdAt;
      const waitingDays = Math.max(
        0,
        Math.floor((nowMs - refDate.getTime()) / (1000 * 60 * 60 * 24)),
      );
      return {
        leadId: l.id,
        leadCode: l.leadCode,
        customerLabel: anonymized
          ? 'Khách hàng ẩn danh'
          : l.companyName || l.contactName || l.phone || l.leadCode,
        assignedSalesName: l.assignedSales?.fullName || 'Chưa phân bổ',
        website: sanitizeWebsiteSourceDisplay(l.sourceWebsite).cleanLabel || 'Chưa xác định',
        quoteSentAt: refDate.toISOString(),
        waitingDays,
      };
    })
    .sort((a, b) => b.waitingDays - a.waitingDays);

  // Hoạt động xử lý phát sinh trong kỳ [startDateTime..endDateTime], bao gồm cả Lead tạo từ kỳ trước
  const receivedInPeriodCount = receivedInPeriodRows.filter((l) =>
    matchesWebsiteDomain(l.sourceWebsite, scope.selectedWebsite),
  ).length;
  const quotedInPeriodLeadMap = new Map<number, Date>();
  for (const r of firstQuoteInPeriodRows) {
    if (matchesWebsiteDomain(r.sourceWebsite, scope.selectedWebsite)) {
      quotedInPeriodLeadMap.set(r.id, r.createdAt);
    }
  }
  const wonInPeriodLeadMap = new Map<number, Date>();
  for (const r of closedWonInPeriodRows) {
    if (matchesWebsiteDomain(r.sourceWebsite, scope.selectedWebsite)) {
      wonInPeriodLeadMap.set(r.id, r.createdAt);
    }
  }
  const lostInPeriodLeadMap = new Map<number, Date>();
  for (const act of periodActivityRows) {
    if (!matchesWebsiteDomain(act.lead.sourceWebsite, scope.selectedWebsite)) continue;
    if (
      act.actionType === 'quote_sent' ||
      (act.actionType === 'status_change' && act.newStatus === 'quote_sent')
    ) {
      quotedInPeriodLeadMap.set(act.leadId, act.lead.createdAt);
    }
    if (act.actionType === 'status_change' && act.newStatus === 'won') {
      wonInPeriodLeadMap.set(act.leadId, act.lead.createdAt);
    }
    if (act.actionType === 'status_change' && act.newStatus === 'lost') {
      lostInPeriodLeadMap.set(act.leadId, act.lead.createdAt);
    }
  }
  const priorCohortLeadIds = new Set<number>();
  for (const [lid, createdAt] of [
    ...quotedInPeriodLeadMap.entries(),
    ...wonInPeriodLeadMap.entries(),
    ...lostInPeriodLeadMap.entries(),
  ]) {
    if (createdAt < scope.startDateTime) {
      priorCohortLeadIds.add(lid);
    }
  }

  const detailedLeadRows = leads.map((lead, idx) => {
    const cleanCompany = lead.companyName
      ? lead.companyName.replace(/\s*\(Dữ liệu tổng hợp\)/gi, '')
      : null;
    const rawCompanyOrContact =
      [cleanCompany, lead.contactName].filter(Boolean).join(' — ') ||
      `Khách hàng #${lead.leadCode}`;
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
      leadId: lead.id,
      leadCode: lead.leadCode,
      receivedAt: lead.createdAt.toISOString(),
      assignedSalesName: lead.assignedSales?.fullName || 'Chưa phân bổ',
      companyOrCustomer: anonymized ? 'Khách hàng ẩn danh' : rawCompanyOrContact,
      phone: anonymized ? maskPhoneForReportSpec(lead.phone) : lead.phone || 'Chưa xác định',
      sourceWebsite: cleanWeb,
      contactChannel: formatContactChannelClean(lead.contactChannel as ContactChannel),
      marketingSource: cleanMkt,
      productsText:
        lead.leadProducts.map((lp) => lp.product.productName).join(', ') || 'Chưa phân loại',
      pipelineStatus: lead.isSpam ? 'spam' : lead.pipelineStatus,
      pipelineStatusLabel: lead.isSpam
        ? 'Spam (đã loại trừ)'
        : PIPELINE_STATUS_LABELS[lead.pipelineStatus as PipelineStatus] ?? lead.pipelineStatus,
      noteOrReason: anonymized
        ? lead.lostReason || (lead.isSpam ? 'Đã loại trừ spam' : '—')
        : lead.lostReason || lead.spamReason || cleanProject || '—',
      isAnonymized: anonymized,
    };
  });

  const latestLeadDate = leads.length > 0 ? getVietnamDateParts(leads[0].createdAt).dateStr : null;
  let latestAdsMetricDate: string | null = null;
  for (const m of adsCampaignMetrics) {
    if (m.metricDate && (!latestAdsMetricDate || m.metricDate > latestAdsMetricDate)) {
      latestAdsMetricDate = m.metricDate;
    }
  }
  const actualDataThrough =
    latestLeadDate && latestAdsMetricDate
      ? (latestLeadDate > latestAdsMetricDate ? latestLeadDate : latestAdsMetricDate)
      : latestLeadDate || latestAdsMetricDate;
  const hasAnyData = leads.length > 0 || adsCampaignMetrics.length > 0 || receivedInPeriodCount > 0;
  const realLastSuccessAt = latestSync?.completedAt ? latestSync.completedAt.toISOString() : null;

  return {
    scope: {
      websiteId: scope.websiteId,
      websiteLabel: scope.websiteLabel,
      domain: scope.domain,
      startDate: scope.startDateStr,
      endDate: scope.endDateStr,
      timezone: scope.timezone,
      isTodayIncluded: scope.isTodayIncluded,
      cohortDefinition:
        'Tính trên nhóm Lead tạo trong khoảng ngày và phạm vi website đang chọn.',
      previousStartDate: scope.prevStartDateStr,
      previousEndDate: scope.prevEndDateStr,
    },
    freshness: {
      lastCheckedAt: checkedAt,
      checkedAt,
      lastSuccessAt: realLastSuccessAt,
      lastSyncedAt: realLastSuccessAt,
      dataThrough: actualDataThrough,
      latestSourceDataAt: actualDataThrough,
      fromCache: false,
      state: !hasAnyData
        ? 'NO_DATA'
        : scope.isTodayIncluded
          ? 'PRELIMINARY'
          : 'FINALIZED',
      statusMessage: !hasAnyData
        ? 'Chưa có phát sinh Lead hoặc dữ liệu đối soát Ads trong kỳ đang chọn.'
        : scope.isTodayIncluded
          ? 'Số liệu trong ngày đang tạm tính.'
          : actualDataThrough
            ? `Dữ liệu đến ${actualDataThrough}`
            : `Phạm vi ${scope.startDateStr} → ${scope.endDateStr}`,
    },
    coverage: {
      availableWebsites: scope.availableWebsites,
      includedWebsites: scope.selectedWebsite
        ? [scope.selectedWebsite.domain]
        : scope.availableWebsites.map((w) => w.domain),
      missingWebsites: [],
      note:
        !scope.selectedWebsite && webMap.has('Chưa xác định')
          ? `Bao gồm ${webMap.get('Chưa xác định')!.leadCount} Lead chưa xác định website nguồn (từ Hotline, Zalo hoặc nhập tay). Khi lọc 1 website cụ thể, nhóm chưa xác định website được tách riêng.`
          : null,
    },
    version: `m04-${scope.websiteId}-${scope.startDateStr}-${scope.endDateStr}-${receivedLeadCount}-${wonLeadCount}`,
    scopeRole: user.roleCode,
    scopeDescription:
      user.roleCode === 'SALES'
        ? `Phạm vi cá nhân (${user.fullName})`
        : anonymized
          ? 'Phạm vi Marketing / Thiết kế (đã che thông tin liên hệ khách hàng)'
          : 'Phạm vi toàn công ty',
    metrics: {
      totalLeadCount: receivedLeadCount,
      receivedLeadCount,
      validLeadCount,
      effectiveLeadCount,
      l2Count: validLeadCount,
      l3Count: effectiveLeadCount,
      pendingAcceptanceCount,
      draftingQuoteCount,
      waitingQuoteCount,
      wonLeadCount,
      lostLeadCount,
      winRatePct,
      winRateNumerator,
      winRateDenominator,
      winRateDefinition:
        'Tỷ lệ chốt = Chốt thành công / Lead hợp lệ trong cùng kỳ và phạm vi website.',
      attributedAdCost,
      adCost: attributedAdCost,
      validAdLeadCount: validAdLeads.length,
      validAttributedAdLeadCount: validAdLeads.length,
      adReconciliationNote,
      costPerValidAdLead,
      currencyCode: 'VND',
      overdueQuoteCount: overdueQuotes.length,
      unclassifiedProductLeadCount,
      multiWebsiteExcludedAdCost,
      multiWebsiteCampaignCount: multiWebsiteCampIds.size,
      previousReceivedLeadCount: prevReceivedCount,
      previousValidLeadCount: prevValidCount,
      previousWonLeadCount: prevWonCount,
      previousAdCost: prevAdCost,
      previousCostPerValidAdLead: prevCostPerValidAdLead,
      previousWinRatePct: prevWinRatePct,
    },
    previousPeriod: {
      startDate: scope.prevStartDateStr,
      endDate: scope.prevEndDateStr,
      adCost: prevAdCost,
      receivedLeadCount: prevReceivedCount,
      validLeadCount: prevValidCount,
      validAttributedAdLeadCount: prevValidAttributedAdLeadCount,
      costPerValidAdLead: prevCostPerValidAdLead,
      wonLeadCount: prevWonCount,
      winRatePct: prevWinRatePct,
    },
    timeSeries,
    previousTimeSeries,
    dataQuality: {
      missingWebsiteCount,
      missingProductCount: unclassifiedProductLeadCount,
      unknownChannelCount,
      attributionCoveragePct,
    },
    marketingInsights: {
      summaryFindings,
      recommendedActions,
      latestSeoAiReport: matchingSeoReport
        ? {
            id: matchingSeoReport.id,
            website: matchingSeoReport.website,
            generatedAt: matchingSeoReport.snapshot.generatedAt,
            generationMode: matchingSeoReport.generationMode,
            modelUsed: matchingSeoReport.modelUsed,
            excerpt: matchingSeoReport.editedContent.replace(/[#*`>\-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220),
          }
        : null,
    },
    periodActivity: {
      receivedInPeriodCount,
      quotedInPeriodCount: quotedInPeriodLeadMap.size,
      wonInPeriodCount: wonInPeriodLeadMap.size,
      lostInPeriodCount: lostInPeriodLeadMap.size,
      fromPriorCohortCount: priorCohortLeadIds.size,
      definitionNote:
        'Tính theo thời điểm phát sinh xử lý trong kỳ, bao gồm cả Lead tạo từ kỳ trước.',
    },
    charts: {
      leadFunnel,
      progressChartMode: 'CURRENT_STATUS_DISTRIBUTION',
      progressChartTitle: 'Phân bố trạng thái xử lý hiện tại',
      progressChartSubtitle: `Tổng cộng ${receivedLeadCount} hồ sơ tạo trong kỳ (mỗi hồ sơ thuộc đúng một trạng thái hiện tại)`,
      statusDistribution,
      productLeadRows: classifiedProductRows.map((p) => ({
        productId: p.productId,
        productName: p.productName,
        distinctLeadCount: p.leadCount,
      })),
      multiProductNote:
        multiProductLeadCount > 0
          ? `Có ${multiProductLeadCount} Lead quan tâm từ 2 dòng sản phẩm trở lên; bảng Sản phẩm đếm theo lượt quan tâm từng sản phẩm, không cộng gộp thành tổng Lead.`
          : null,
    },
    tables: {
      bySales,
      byWebsite,
      byChannel,
      byCampaign,
      byProduct,
      pendingActionLeads: paginateArray(
        pendingActionRows,
        params?.page || 1,
        params?.pageSize || 20,
      ),
      detailedLeads: paginateArray(
        detailedLeadRows,
        params?.detailPage || 1,
        params?.detailPageSize || 25,
      ),
    },
  };
    },
  });

  if (cacheResult.fromCache) {
    return {
      ...cacheResult.data,
      freshness: {
        ...cacheResult.data.freshness,
        lastCheckedAt: new Date().toISOString(),
        checkedAt: new Date().toISOString(),
        fromCache: true,
      },
    };
  }
  return cacheResult.data;
}
