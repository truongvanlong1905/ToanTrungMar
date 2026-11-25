import { prisma } from '@toantrung/database';
import {
  isL2Valid,
  normalizeMarketingChannelDisplay,
  type M03AdsSeoDashboardDto,
  type M03SeoComparisonRowDto,
  type M03SeoContentRowDto,
  type M03SeoDailyPointDto,
  type M03SeoDeviceCountryRowDto,
  type RoleCode,
} from '@toantrung/contracts';
import {
  matchesWebsiteDomain,
  paginateArray,
  resolveDashboardScope,
  sanitizeLandingPageUrl,
} from '../../core/website-catalog';
import { getOrComputeScopedCache } from '../../core/cache/server-data-cache';
import {
  classifyGscDateBySourceMetadata,
  getGoogleAdsApiConfig,
  getGoogleConnection,
  getGscDataStateMetadataMap,
} from '../02-tracking-sync/google-oauth.service';
import {
  getCachedGscSiteStatus,
  getGa4LiveSnapshotsForProperties,
} from '../02-tracking-sync/ga4-live-cache.service';
import { getGscLiveSnapshotsForSites } from './gsc-live-cache.service';
import {
  getGoogleTrendsExploreExtras,
  getGoogleTrendsLiveSnapshot,
  getSerpApiTrendsKey,
} from './google-trends.service';

/**
 * T10: Công thức CPL chuẩn duy nhất trên toàn hệ thống (M02, M03, M04, Excel Export):
 * - Mẫu số = số Lead quảng cáo hợp lệ (L2/attributed valid ad leads)
 * - Nếu chưa có Lead hợp lệ (validAdLeadCount <= 0) hoặc chưa tách được chi phí (adCost === null) -> null (không hiện 0đ giả)
 * - Nếu chi phí = 0đ và có >= 1 Lead hợp lệ -> trả về 0
 * - Làm tròn theo VNĐ nguyên (Math.round) để khớp 100% giữa API M02/M03/M04, UI và file Excel
 */
export function computeCostPerValidAdLead(
  adCost: number | null,
  validAdLeadCount: number,
): number | null {
  if (adCost === null || !Number.isFinite(adCost) || validAdLeadCount <= 0) {
    return null;
  }
  return Math.round(adCost / validAdLeadCount);
}

function mapSeoWorkflowLabel(status: string, hasError: boolean): string {
  if (status === 'published') return 'Đã xuất bản';
  if (status === 'approved_scheduled') {
    return hasError ? 'Lỗi xuất bản' : 'Đã duyệt lịch đăng';
  }
  return 'Bản nháp';
}

export async function getM03AdsSeoDashboardSpec(params?: {
  websiteId?: string | null;
  preset?: string | null;
  from?: string | null;
  to?: string | null;
  page?: number;
  pageSize?: number;
  contentPage?: number;
  minImpr?: number;
  maxCtr?: number;
  compare?: boolean;
  roleCode?: RoleCode;
  bypassCache?: boolean;
}): Promise<M03AdsSeoDashboardDto> {
  const scope = await resolveDashboardScope(params);
  const cacheKey = `m03-spec:${params?.roleCode || 'ANON'}:${scope.websiteId}:${scope.preset}:${scope.startDateStr}:${scope.endDateStr}:${params?.page || 1}:${params?.pageSize || 20}:${params?.contentPage || 1}:${params?.minImpr ?? 30}:${params?.maxCtr ?? 3}:${params?.compare ? 'cmp' : 'nocmp'}`;

  const cached = await getOrComputeScopedCache<M03AdsSeoDashboardDto>({
    key: cacheKey,
    domains: ['ads', 'seo_articles', 'seo_reports', 'tracking', 'leads', 'websites'],
    ttlMs: 30_000,
    bypassCache: params?.bypassCache,
    compute: async () => {
      const checkedAt = new Date().toISOString();
      const [googleConn, adsCfg, realAdsCatalogCount] = await Promise.all([
    getGoogleConnection(),
    getGoogleAdsApiConfig(),
    prisma.campaign.count({
      where: {
        platform: 'google_ads',
        NOT: [{ accountExternalId: 'default' }, { accountExternalId: { startsWith: 'GA4-' } }],
      },
    }),
  ]);
  const hasAdsToken =
    Boolean(adsCfg?.developerToken) ||
    Boolean(
      googleConn?.connected &&
        !googleConn.isSandboxDemo &&
        googleConn.scopes?.some((s) => s.includes('adwords')),
    ) ||
    realAdsCatalogCount > 0;
  const isAdsReadOnly = params?.roleCode === 'ADS';

  const gscSites = scope.gscSiteUrls;
  const [
    gscAccountCur,
    gscAccountPrev,
    gscQueryCur,
    gscQueryPrev,
    gscPageCur,
    gscPagePrev,
    leads,
    gscMetaMap,
    syncLogs,
    ga4LiveSnaps,
    gscLiveSnaps,
    gscPrevLiveSnaps,
    siteStatusRows,
    trendMetricRows,
    seoArticles,
    liveTrendsSnap,
    serpApiKey,
    trendsExtras,
  ] = await Promise.all([
    gscSites.length > 0
      ? prisma.platformDailyMetric.findMany({
          where: {
            platform: 'search_console',
            grain: 'account',
            accountPropertyId: { in: gscSites },
            metricDate: { gte: scope.startDateStr, lte: scope.endDateStr },
          },
          orderBy: { metricDate: 'asc' },
        })
      : Promise.resolve([]),
    gscSites.length > 0
      ? prisma.platformDailyMetric.findMany({
          where: {
            platform: 'search_console',
            grain: 'account',
            accountPropertyId: { in: gscSites },
            metricDate: { gte: scope.prevStartDateStr, lte: scope.prevEndDateStr },
          },
        })
      : Promise.resolve([]),
    gscSites.length > 0
      ? prisma.platformDailyMetric.findMany({
          where: {
            platform: 'search_console',
            grain: 'keyword',
            accountPropertyId: { in: gscSites },
            metricDate: { gte: scope.startDateStr, lte: scope.endDateStr },
          },
        })
      : Promise.resolve([]),
    gscSites.length > 0
      ? prisma.platformDailyMetric.findMany({
          where: {
            platform: 'search_console',
            grain: 'keyword',
            accountPropertyId: { in: gscSites },
            metricDate: { gte: scope.prevStartDateStr, lte: scope.prevEndDateStr },
          },
        })
      : Promise.resolve([]),
    gscSites.length > 0
      ? prisma.platformDailyMetric.findMany({
          where: {
            platform: 'search_console',
            grain: 'page',
            accountPropertyId: { in: gscSites },
            metricDate: { gte: scope.startDateStr, lte: scope.endDateStr },
          },
        })
      : Promise.resolve([]),
    gscSites.length > 0
      ? prisma.platformDailyMetric.findMany({
          where: {
            platform: 'search_console',
            grain: 'page',
            accountPropertyId: { in: gscSites },
            metricDate: { gte: scope.prevStartDateStr, lte: scope.prevEndDateStr },
          },
        })
      : Promise.resolve([]),
    prisma.lead.findMany({
      where: {
        createdAt: { gte: scope.startDateTime, lte: scope.endDateTime },
      },
      include: { tracking: true },
    }),
    getGscDataStateMetadataMap(),
    prisma.platformSyncLog.findMany({
      where: { platform: { in: ['search_console', 'google_ads'] } },
      orderBy: { id: 'desc' },
      take: 10,
    }),
    getGa4LiveSnapshotsForProperties(scope.ga4PropertyIds, scope.startDateStr, scope.endDateStr, false),
    getGscLiveSnapshotsForSites(gscSites, scope.startDateStr, scope.endDateStr, false),
    params?.compare && gscSites.length > 0
      ? getGscLiveSnapshotsForSites(gscSites, scope.prevStartDateStr, scope.prevEndDateStr, false)
      : Promise.resolve([]),
    getCachedGscSiteStatus(gscSites),
    prisma.platformDailyMetric.findMany({
      where: {
        platform: 'google_trends',
        metricDate: { gte: scope.startDateStr, lte: scope.endDateStr },
      },
      orderBy: { metricDate: 'asc' },
      take: 500,
    }),
    isAdsReadOnly
      ? Promise.resolve([])
      : prisma.seoArticle.findMany({
          include: {
            keyword: { select: { keyword: true } },
            createdBy: { select: { fullName: true } },
          },
          orderBy: { updatedAt: 'desc' },
          take: 200,
        }),
    getGoogleTrendsLiveSnapshot(false).catch(() => null),
    getSerpApiTrendsKey().catch(() => null),
    getGoogleTrendsExploreExtras().catch(() => null),
  ]);

  let organicSessionsFromGa4: number | null = null;
  let organicEngagedSessionsFromGa4 = 0;
  if (ga4LiveSnaps.length > 0) {
    organicSessionsFromGa4 = 0;
    for (const snap of ga4LiveSnaps) {
      const org = snap.channels.find((c) =>
        c.channelGroup.toLowerCase().includes('organic search'),
      );
      if (org) {
        organicSessionsFromGa4 += org.sessions;
        organicEngagedSessionsFromGa4 += org.engagedSessions;
      }
    }
  }
  const organicEngagementRatePct =
    organicSessionsFromGa4 !== null && organicSessionsFromGa4 > 0
      ? Number(((organicEngagedSessionsFromGa4 / organicSessionsFromGa4) * 100).toFixed(2))
      : null;

  const scopedLeads = leads.filter((l) => matchesWebsiteDomain(l.sourceWebsite, scope.selectedWebsite));
  const validLeads = scopedLeads.filter((l) => isL2Valid(l));

  const validAdLeads = validLeads.filter((l) => {
    const ch = normalizeMarketingChannelDisplay({
      marketingSource: l.tracking?.marketingSource,
      utmSource: l.tracking?.utmSource,
      utmMedium: l.tracking?.utmMedium,
      gclid: l.tracking?.gclid,
      contactChannel: l.contactChannel,
    });
    return ch === 'Google Ads' || ch === 'Quảng cáo Facebook';
  });

  // C08 & C04: Chỉ tính Lead từ tìm kiếm tự nhiên khi có bằng chứng UTM/marketingSource rõ ràng; không tự suy từ thiếu UTM
  const organicValidLeads = validLeads.filter((l) => {
    const ch = normalizeMarketingChannelDisplay({
      marketingSource: l.tracking?.marketingSource,
      utmSource: l.tracking?.utmSource,
      utmMedium: l.tracking?.utmMedium,
      gclid: l.tracking?.gclid,
      contactChannel: l.contactChannel,
    });
    return ch === 'Tìm kiếm tự nhiên';
  });

  const websiteFormLeadsWithoutUtm = validLeads.filter(
    (l) =>
      l.contactChannel === 'form_web' &&
      !l.tracking?.utmSource &&
      !l.tracking?.utmMedium &&
      !l.tracking?.gclid &&
      normalizeMarketingChannelDisplay({
        marketingSource: l.tracking?.marketingSource,
        contactChannel: l.contactChannel,
      }) === 'Chưa xác định',
  );

  const organicLeadVerificationState: 'VERIFIED' | 'INSUFFICIENT_EVIDENCE' =
    organicValidLeads.length === 0 && websiteFormLeadsWithoutUtm.length > 0
      ? 'INSUFFICIENT_EVIDENCE'
      : 'VERIFIED';

  // -------------------------------------------------------------------------
  // SEO CALCULATIONS (Ưu tiên live GSC snapshot khớp 100% Search Console UI, fallback DB)
  // -------------------------------------------------------------------------
  const hasLiveGsc = gscLiveSnaps.length > 0 && gscLiveSnaps.some((s) => s.daily.length > 0 || s.queries.length > 0);
  const finalizedLiveDates = new Set<string>();
  const liveDayMap = new Map<
    string,
    { clicks: number; impressions: number; posWeighted: number; posImpr: number }
  >();
  if (hasLiveGsc) {
    for (const snap of gscLiveSnaps) {
      for (const fd of snap.finalizedDates) finalizedLiveDates.add(fd);
      for (const d of snap.daily) {
        const cur = liveDayMap.get(d.date) || {
          clicks: 0,
          impressions: 0,
          posWeighted: 0,
          posImpr: 0,
        };
        cur.clicks += d.clicks;
        cur.impressions += d.impressions;
        if (d.averagePosition !== null && d.impressions > 0) {
          cur.posWeighted += d.averagePosition * d.impressions;
          cur.posImpr += d.impressions;
        }
        liveDayMap.set(d.date, cur);
      }
    }
  }

  const hasGscData = hasLiveGsc || gscAccountCur.length > 0;
  const totalClicks = hasLiveGsc
    ? Array.from(liveDayMap.values()).reduce((s, d) => s + d.clicks, 0)
    : gscAccountCur.length > 0
      ? gscAccountCur.reduce((s, r) => s + r.clicks, 0)
      : null;
  const totalImpr = hasLiveGsc
    ? Array.from(liveDayMap.values()).reduce((s, d) => s + d.impressions, 0)
    : gscAccountCur.length > 0
      ? gscAccountCur.reduce((s, r) => s + r.impressions, 0)
      : null;
  const overallCtrPct =
    totalClicks !== null && totalImpr !== null && totalImpr > 0
      ? Number(((totalClicks / totalImpr) * 100).toFixed(2))
      : null;

  let weightedPosSum = 0;
  let weightedImprSum = 0;
  if (hasLiveGsc) {
    for (const d of liveDayMap.values()) {
      weightedPosSum += d.posWeighted;
      weightedImprSum += d.posImpr;
    }
  } else {
    for (const r of gscAccountCur) {
      if (r.avgPosition !== null && r.impressions > 0) {
        weightedPosSum += r.avgPosition * r.impressions;
        weightedImprSum += r.impressions;
      }
    }
  }
  const avgSearchPosition =
    weightedImprSum > 0 ? Number((weightedPosSum / weightedImprSum).toFixed(2)) : null;

  const hasPrevLiveGsc = gscPrevLiveSnaps.length > 0 && gscPrevLiveSnaps.some((s) => s.daily.length > 0);
  const prevLiveDayMap = new Map<
    string,
    { clicks: number; impressions: number; posWeighted: number; posImpr: number }
  >();
  if (hasPrevLiveGsc) {
    for (const snap of gscPrevLiveSnaps) {
      for (const d of snap.daily) {
        const cur = prevLiveDayMap.get(d.date) || {
          clicks: 0,
          impressions: 0,
          posWeighted: 0,
          posImpr: 0,
        };
        cur.clicks += d.clicks;
        cur.impressions += d.impressions;
        if (d.averagePosition !== null && d.impressions > 0) {
          cur.posWeighted += d.averagePosition * d.impressions;
          cur.posImpr += d.impressions;
        }
        prevLiveDayMap.set(d.date, cur);
      }
    }
  }

  const hasPrevGsc = hasPrevLiveGsc || gscAccountPrev.length > 0;
  const prevTotalClicks = hasPrevLiveGsc
    ? Array.from(prevLiveDayMap.values()).reduce((s, d) => s + d.clicks, 0)
    : gscAccountPrev.length > 0
      ? gscAccountPrev.reduce((s, r) => s + r.clicks, 0)
      : null;
  const prevTotalImpr = hasPrevLiveGsc
    ? Array.from(prevLiveDayMap.values()).reduce((s, d) => s + d.impressions, 0)
    : gscAccountPrev.length > 0
      ? gscAccountPrev.reduce((s, r) => s + r.impressions, 0)
      : null;
  const periodClickChangePct =
    totalClicks !== null && prevTotalClicks !== null && prevTotalClicks > 0
      ? Number((((totalClicks - prevTotalClicks) / prevTotalClicks) * 100).toFixed(2))
      : null;

  const gscDayMap = new Map<
    string,
    {
      clicks: number;
      impressions: number;
      posWeighted: number;
      posImpr: number;
      completeness: M03SeoDailyPointDto['completenessState'];
    }
  >();
  if (hasLiveGsc) {
    for (const [dt, v] of liveDayMap.entries()) {
      gscDayMap.set(dt, {
        ...v,
        completeness: finalizedLiveDates.has(dt) ? 'FINALIZED' : 'PRELIMINARY',
      });
    }
  } else {
    for (const r of gscAccountCur) {
      const cur = gscDayMap.get(r.metricDate) || {
        clicks: 0,
        impressions: 0,
        posWeighted: 0,
        posImpr: 0,
        completeness: 'UNKNOWN' as M03SeoDailyPointDto['completenessState'],
      };
      cur.clicks += r.clicks;
      cur.impressions += r.impressions;
      if (r.avgPosition !== null && r.impressions > 0) {
        cur.posWeighted += r.avgPosition * r.impressions;
        cur.posImpr += r.impressions;
      }
      const siteMeta = gscMetaMap[r.accountPropertyId];
      const state = classifyGscDateBySourceMetadata(r.metricDate, siteMeta);
      if (
        state === 'FINALIZED' ||
        state === 'PRELIMINARY' ||
        state === 'UNKNOWN' ||
        state === 'QUERY_ERROR'
      ) {
        cur.completeness = state;
      }
      gscDayMap.set(r.metricDate, cur);
    }
  }

  const seoDailySeries: M03SeoDailyPointDto[] = [];
  const startNoon = new Date(`${scope.startDateStr}T12:00:00+07:00`);
  for (let i = 0; i < scope.totalCalendarDays; i += 1) {
    const d = new Date(startNoon.getTime() + i * 24 * 60 * 60 * 1000);
    const dateStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
    const hit = gscDayMap.get(dateStr);
    seoDailySeries.push({
      date: dateStr,
      clicks: hit ? hit.clicks : null,
      impressions: hit ? hit.impressions : null,
      ctrPct:
        hit && hit.impressions > 0
          ? Number(((hit.clicks / hit.impressions) * 100).toFixed(2))
          : null,
      averagePosition:
        hit && hit.posImpr > 0 ? Number((hit.posWeighted / hit.posImpr).toFixed(2)) : null,
      completenessState: hit ? hit.completeness : 'NO_DATA',
    });
  }

  let previousSeoDailySeries: M03SeoDailyPointDto[] | undefined;
  if (params?.compare) {
    const prevMap = new Map<
      string,
      { clicks: number; impressions: number; posWeighted: number; posImpr: number }
    >(prevLiveDayMap);
    if (!hasPrevLiveGsc) {
      for (const r of gscAccountPrev) {
        const cur = prevMap.get(r.metricDate) || {
          clicks: 0,
          impressions: 0,
          posWeighted: 0,
          posImpr: 0,
        };
        cur.clicks += r.clicks;
        cur.impressions += r.impressions;
        if (r.avgPosition !== null && r.impressions > 0) {
          cur.posWeighted += r.avgPosition * r.impressions;
          cur.posImpr += r.impressions;
        }
        prevMap.set(r.metricDate, cur);
      }
    }
    previousSeoDailySeries = [];
    const prevStartNoon = new Date(`${scope.prevStartDateStr}T12:00:00+07:00`);
    for (let i = 0; i < scope.totalCalendarDays; i += 1) {
      const d = new Date(prevStartNoon.getTime() + i * 24 * 60 * 60 * 1000);
      const dateStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(d);
      const hit = prevMap.get(dateStr);
      previousSeoDailySeries.push({
        date: dateStr,
        clicks: hit ? hit.clicks : null,
        impressions: hit ? hit.impressions : null,
        ctrPct:
          hit && hit.impressions > 0
            ? Number(((hit.clicks / hit.impressions) * 100).toFixed(2))
            : null,
        averagePosition:
          hit && hit.posImpr > 0 ? Number((hit.posWeighted / hit.posImpr).toFixed(2)) : null,
        completenessState: hit ? 'FINALIZED' : 'NO_DATA',
      });
    }
  }

  const aggregateLiveBreakdown = (
    curLiveLists: Array<Array<{ key: string; clicks: number; impressions: number; averagePosition: number | null }>>,
    prevLiveLists: Array<Array<{ key: string; clicks: number; impressions: number; averagePosition: number | null }>>,
    prevDbRows: typeof gscQueryPrev,
    sanitizeUrl: boolean,
  ): M03SeoComparisonRowDto[] => {
    const curMap = new Map<string, { clicks: number; impr: number; posW: number; posI: number }>();
    for (const list of curLiveLists) {
      for (const item of list) {
        const k = sanitizeUrl ? sanitizeLandingPageUrl(item.key) : item.key.trim();
        if (!k) continue;
        const cur = curMap.get(k) || { clicks: 0, impr: 0, posW: 0, posI: 0 };
        cur.clicks += item.clicks;
        cur.impr += item.impressions;
        if (item.averagePosition !== null && item.impressions > 0) {
          cur.posW += item.averagePosition * item.impressions;
          cur.posI += item.impressions;
        }
        curMap.set(k, cur);
      }
    }

    const prevMap = new Map<string, { clicks: number; impr: number; posW: number; posI: number }>();
    let hasPrevAny = false;
    for (const list of prevLiveLists) {
      for (const item of list) {
        hasPrevAny = true;
        const k = sanitizeUrl ? sanitizeLandingPageUrl(item.key) : item.key.trim();
        if (!k) continue;
        const prev = prevMap.get(k) || { clicks: 0, impr: 0, posW: 0, posI: 0 };
        prev.clicks += item.clicks;
        prev.impr += item.impressions;
        if (item.averagePosition !== null && item.impressions > 0) {
          prev.posW += item.averagePosition * item.impressions;
          prev.posI += item.impressions;
        }
        prevMap.set(k, prev);
      }
    }
    if (!hasPrevAny && prevDbRows.length > 0) {
      hasPrevAny = true;
      for (const r of prevDbRows) {
        const k = sanitizeUrl
          ? sanitizeLandingPageUrl(r.pageUrlRaw || r.pagePathNorm || r.campaignExternalId)
          : (r.keywordRaw || r.keywordTextNorm || r.campaignExternalId || '').trim();
        if (!k) continue;
        const prev = prevMap.get(k) || { clicks: 0, impr: 0, posW: 0, posI: 0 };
        prev.clicks += r.clicks;
        prev.impr += r.impressions;
        if (r.avgPosition !== null && r.impressions > 0) {
          prev.posW += r.avgPosition * r.impressions;
          prev.posI += r.impressions;
        }
        prevMap.set(k, prev);
      }
    }

    const allKeys = new Set<string>([...curMap.keys(), ...prevMap.keys()]);
    return Array.from(allKeys)
      .map((key) => {
        const c = curMap.get(key) || { clicks: 0, impr: 0, posW: 0, posI: 0 };
        const p = prevMap.get(key);
        const curCtr = c.impr > 0 ? Number(((c.clicks / c.impr) * 100).toFixed(2)) : null;
        const avgPos = c.posI > 0 ? Number((c.posW / c.posI).toFixed(2)) : null;
        const prevClicks = hasPrevAny ? (p ? p.clicks : 0) : null;
        const prevImpr = hasPrevAny ? (p ? p.impr : 0) : null;
        const prevCtr =
          p && p.impr > 0 ? Number(((p.clicks / p.impr) * 100).toFixed(2)) : hasPrevAny ? 0 : null;
        const prevPos = p && p.posI > 0 ? Number((p.posW / p.posI).toFixed(2)) : null;
        const clickChange = prevClicks !== null ? c.clicks - prevClicks : null;
        const clickChangePct =
          clickChange !== null && prevClicks !== null && prevClicks > 0
            ? Number(((clickChange / prevClicks) * 100).toFixed(2))
            : null;
        const impressionChange = prevImpr !== null ? c.impr - prevImpr : null;
        const ctrChangePctPt =
          curCtr !== null && prevCtr !== null ? Number((curCtr - prevCtr).toFixed(2)) : null;
        const positionImprovement =
          avgPos !== null && prevPos !== null ? Number((prevPos - avgPos).toFixed(2)) : null;
        return {
          key,
          clicks: c.clicks,
          impressions: c.impr,
          ctrPct: curCtr,
          averagePosition: avgPos,
          previousClicks: prevClicks,
          clickChange,
          clickChangePct,
          previousImpressions: prevImpr,
          impressionChange,
          previousCtrPct: prevCtr,
          ctrChangePctPt,
          previousPosition: prevPos,
          positionImprovement,
        };
      })
      .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
  };

  const aggregateBreakdown = (
    curRows: typeof gscQueryCur,
    prevRows: typeof gscQueryPrev,
    sanitizeUrl: boolean,
  ): M03SeoComparisonRowDto[] => {
    const hasPrevAny = prevRows.length > 0;
    const curMap = new Map<string, { clicks: number; impr: number; posW: number; posI: number }>();
    for (const r of curRows) {
      const k = sanitizeUrl
        ? sanitizeLandingPageUrl(r.pageUrlRaw || r.pagePathNorm || r.campaignExternalId)
        : (r.keywordRaw || r.keywordTextNorm || r.campaignExternalId || '').trim();
      if (!k) continue;
      const cur = curMap.get(k) || { clicks: 0, impr: 0, posW: 0, posI: 0 };
      cur.clicks += r.clicks;
      cur.impr += r.impressions;
      if (r.avgPosition !== null && r.impressions > 0) {
        cur.posW += r.avgPosition * r.impressions;
        cur.posI += r.impressions;
      }
      curMap.set(k, cur);
    }

    const prevMap = new Map<string, { clicks: number; impr: number; posW: number; posI: number }>();
    for (const r of prevRows) {
      const k = sanitizeUrl
        ? sanitizeLandingPageUrl(r.pageUrlRaw || r.pagePathNorm || r.campaignExternalId)
        : (r.keywordRaw || r.keywordTextNorm || r.campaignExternalId || '').trim();
      if (!k) continue;
      const prev = prevMap.get(k) || { clicks: 0, impr: 0, posW: 0, posI: 0 };
      prev.clicks += r.clicks;
      prev.impr += r.impressions;
      if (r.avgPosition !== null && r.impressions > 0) {
        prev.posW += r.avgPosition * r.impressions;
        prev.posI += r.impressions;
      }
      prevMap.set(k, prev);
    }

    // Bao gồm cả những trang/từ khóa có ở kỳ trước nhưng giảm về 0 ở kỳ này để phát hiện suy giảm chính xác!
    const allKeys = new Set<string>([...curMap.keys(), ...prevMap.keys()]);

    return Array.from(allKeys)
      .map((key) => {
        const c = curMap.get(key) || { clicks: 0, impr: 0, posW: 0, posI: 0 };
        const p = prevMap.get(key);
        const curCtr = c.impr > 0 ? Number(((c.clicks / c.impr) * 100).toFixed(2)) : null;
        const avgPos = c.posI > 0 ? Number((c.posW / c.posI).toFixed(2)) : null;

        const prevClicks = hasPrevAny ? (p ? p.clicks : 0) : null;
        const prevImpr = hasPrevAny ? (p ? p.impr : 0) : null;
        const prevCtr =
          p && p.impr > 0 ? Number(((p.clicks / p.impr) * 100).toFixed(2)) : hasPrevAny ? 0 : null;
        const prevPos = p && p.posI > 0 ? Number((p.posW / p.posI).toFixed(2)) : null;

        const clickChange = prevClicks !== null ? c.clicks - prevClicks : null;
        const clickChangePct =
          clickChange !== null && prevClicks !== null && prevClicks > 0
            ? Number(((clickChange / prevClicks) * 100).toFixed(2))
            : null;
        const impressionChange = prevImpr !== null ? c.impr - prevImpr : null;
        const ctrChangePctPt =
          curCtr !== null && prevCtr !== null ? Number((curCtr - prevCtr).toFixed(2)) : null;
        const positionImprovement =
          avgPos !== null && prevPos !== null ? Number((prevPos - avgPos).toFixed(2)) : null;

        return {
          key,
          clicks: c.clicks,
          impressions: c.impr,
          ctrPct: curCtr,
          averagePosition: avgPos,
          previousClicks: prevClicks,
          clickChange,
          clickChangePct,
          previousImpressions: prevImpr,
          impressionChange,
          previousCtrPct: prevCtr,
          ctrChangePctPt,
          previousPosition: prevPos,
          positionImprovement,
        };
      })
      .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
  };

  const hasLiveQueries = gscLiveSnaps.some((s) => s.queries.length > 0);
  const hasLivePages = gscLiveSnaps.some((s) => s.pages.length > 0);

  const allQueryRows = hasLiveQueries
    ? aggregateLiveBreakdown(
        gscLiveSnaps.map((s) => s.queries),
        gscPrevLiveSnaps.map((s) => s.queries),
        gscQueryPrev,
        false,
      )
    : aggregateBreakdown(gscQueryCur, gscQueryPrev, false);

  const allPageRows = hasLivePages
    ? aggregateLiveBreakdown(
        gscLiveSnaps.map((s) => s.pages),
        gscPrevLiveSnaps.map((s) => s.pages),
        gscPagePrev,
        true,
      )
    : aggregateBreakdown(gscPageCur, gscPagePrev, true);

  // Cặp (query, page) phục vụ lọc chéo chuẩn Search Console
  const qpMap = new Map<
    string,
    { query: string; page: string; clicks: number; impressions: number; posW: number }
  >();
  for (const snap of gscLiveSnaps) {
    for (const ln of snap.queryPages) {
      const key = `${ln.query.toLowerCase()}|||${ln.page.toLowerCase()}`;
      const cur = qpMap.get(key) || {
        query: ln.query,
        page: ln.page,
        clicks: 0,
        impressions: 0,
        posW: 0,
      };
      cur.clicks += ln.clicks;
      cur.impressions += ln.impressions;
      if (ln.averagePosition !== null && ln.impressions > 0) {
        cur.posW += ln.averagePosition * ln.impressions;
      }
      qpMap.set(key, cur);
    }
  }
  const queryPageLinks = Array.from(qpMap.values())
    .map((x) => ({
      query: x.query,
      page: x.page,
      clicks: x.clicks,
      impressions: x.impressions,
      ctrPct: x.impressions > 0 ? Number(((x.clicks / x.impressions) * 100).toFixed(2)) : null,
      averagePosition:
        x.impressions > 0 && x.posW > 0 ? Number((x.posW / x.impressions).toFixed(2)) : null,
    }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, 1500);

  // Trang tăng / giảm cho cột 4/12 (C08)
  const risingPages = allPageRows
    .filter((p) => (p.clickChange ?? 0) > 0 || ((p.clickChange ?? 0) === 0 && (p.impressionChange ?? 0) > 10))
    .sort((a, b) => (b.clickChange ?? 0) - (a.clickChange ?? 0) || (b.impressionChange ?? 0) - (a.impressionChange ?? 0))
    .slice(0, 5);

  const decliningPages = allPageRows
    .filter((p) => (p.clickChange ?? 0) < 0 || ((p.clickChange ?? 0) === 0 && (p.impressionChange ?? 0) < -10))
    .sort((a, b) => (a.clickChange ?? 0) - (b.clickChange ?? 0) || (a.impressionChange ?? 0) - (b.impressionChange ?? 0))
    .slice(0, 5);

  // Điều kiện cơ hội có thể cấu hình (C08)
  const opportunityThresholdMinImpr =
    params?.minImpr && Number.isFinite(params.minImpr) && params.minImpr > 0
      ? Math.round(params.minImpr)
      : 15;
  const ctrCeiling =
    params?.maxCtr && Number.isFinite(params.maxCtr) && params.maxCtr > 0
      ? Number(params.maxCtr.toFixed(2))
      : Number((overallCtrPct ?? 3).toFixed(2));

  const opportunityQueries = allQueryRows
    .filter(
      (q) =>
        q.impressions >= opportunityThresholdMinImpr &&
        (q.ctrPct === null || q.ctrPct < ctrCeiling),
    )
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 12)
    .map((q) => ({
      query: q.key,
      impressions: q.impressions,
      ctrPct: q.ctrPct,
      averagePosition: q.averagePosition,
    }));

  // Tab Nội dung (C08: contentId, targetWebsite, targetUrl, targetQuery, owner, workflowStatus, updatedAt, publishedAt, publishError)
  const scopedArticles = seoArticles.filter((a) =>
    matchesWebsiteDomain(a.targetWebsite, scope.selectedWebsite),
  );
  const contentRows: M03SeoContentRowDto[] = scopedArticles.map((a) => ({
    contentId: a.id,
    title: a.title,
    targetWebsite: a.targetWebsite || null,
    targetUrl: a.publishedUrl || (a.slug ? `/${a.slug}` : null),
    targetQuery: a.keyword?.keyword || a.topic || 'Chưa gắn từ khóa',
    owner: a.createdBy?.fullName || 'Phòng Marketing',
    workflowStatus: mapSeoWorkflowLabel(a.status, Boolean(a.lastPublishError)),
    updatedAt: a.updatedAt.toISOString(),
    publishedAt: a.publishedAt ? a.publishedAt.toISOString() : null,
    publishError: a.lastPublishError || null,
  }));

  // Thiết bị & Quốc gia: Ưu tiên GSC live thật, chỉ fallback GA4 nếu thiếu GSC
  const deviceCountryRows: M03SeoDeviceCountryRowDto[] = [];
  const hasLiveGscDim = gscLiveSnaps.some(
    (s) => s.devices.length > 0 || s.countries.length > 0,
  );
  if (hasLiveGscDim) {
    const aggMap = new Map<
      string,
      {
        dimensionType: 'DEVICE' | 'COUNTRY';
        dimensionKey: string;
        clicks: number;
        impressions: number;
        posW: number;
      }
    >();
    for (const snap of gscLiveSnaps) {
      for (const row of [...snap.devices, ...snap.countries]) {
        const k = `${row.dimensionType}::${row.dimensionKey}`;
        const cur = aggMap.get(k) || {
          dimensionType: row.dimensionType,
          dimensionKey: row.dimensionKey,
          clicks: 0,
          impressions: 0,
          posW: 0,
        };
        cur.clicks += row.clicks;
        cur.impressions += row.impressions;
        if (row.averagePosition !== null && row.impressions > 0) {
          cur.posW += row.averagePosition * row.impressions;
        }
        aggMap.set(k, cur);
      }
    }
    for (const v of aggMap.values()) {
      deviceCountryRows.push({
        dimensionType: v.dimensionType,
        dimensionKey: v.dimensionKey,
        clicks: v.clicks,
        impressions: v.impressions,
        ctrPct: v.impressions > 0 ? Number(((v.clicks / v.impressions) * 100).toFixed(2)) : null,
        averagePosition:
          v.impressions > 0 && v.posW > 0 ? Number((v.posW / v.impressions).toFixed(2)) : null,
      });
    }
    deviceCountryRows.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
  } else {
    for (const snap of ga4LiveSnaps) {
      for (const d of snap.devices) {
        const existing = deviceCountryRows.find(
          (x) => x.dimensionType === 'DEVICE' && x.dimensionKey === d.deviceCategory,
        );
        if (existing) {
          existing.clicks += d.sessions;
        } else {
          deviceCountryRows.push({
            dimensionType: 'DEVICE',
            dimensionKey: d.deviceCategory,
            clicks: d.sessions,
            impressions: 0,
            ctrPct: null,
            averagePosition: null,
          });
        }
      }
    }
  }

  const gscLogs = syncLogs.filter((s) => s.platform === 'search_console');
  const lastGscLog = gscLogs[0] || null;
  const lastGscSuccess = gscLogs.find((s) => s.status === 'success' || s.status === 'partial') || null;
  const isError = lastGscLog?.status === 'failed' && !hasGscData;
  const liveDatesSorted = Array.from(liveDayMap.keys()).sort();
  const latestDataThrough = hasLiveGsc
    ? liveDatesSorted[liveDatesSorted.length - 1] || null
    : gscAccountCur[gscAccountCur.length - 1]?.metricDate || null;
  const realLastSuccessAt =
    (hasLiveGsc
      ? gscLiveSnaps.map((s) => s.fetchedAt).sort().pop()
      : null) ||
    lastGscSuccess?.completedAt?.toISOString() ||
    null;

  // Derive FINALIZED / PRELIMINARY honestly from GSC dataState metadata when available
  let hasPreliminaryGsc = false;
  if (hasLiveGsc && latestDataThrough) {
    hasPreliminaryGsc = !finalizedLiveDates.has(latestDataThrough);
  } else if (hasGscData && latestDataThrough) {
    for (const sUrl of gscSites) {
      const meta = gscMetaMap[sUrl] || null;
      const cls = classifyGscDateBySourceMetadata(latestDataThrough, meta);
      if (cls !== 'FINALIZED') {
        hasPreliminaryGsc = true;
        break;
      }
    }
  } else if (scope.isTodayIncluded) {
    hasPreliminaryGsc = true;
  }

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
        'Dữ liệu tìm kiếm tự nhiên (Search Console cấp site), lưu lượng tìm kiếm tự nhiên (GA4) và bài viết SEO trong kỳ',
      previousStartDate: scope.prevStartDateStr,
      previousEndDate: scope.prevEndDateStr,
    },
    freshness: {
      lastCheckedAt: checkedAt,
      checkedAt,
      lastSuccessAt: realLastSuccessAt,
      lastSyncedAt: realLastSuccessAt,
      dataThrough: latestDataThrough,
      latestSourceDataAt: latestDataThrough,
      fromCache: false,
      state: isError
        ? 'ERROR'
        : !hasGscData
          ? 'NO_DATA'
          : hasPreliminaryGsc || scope.isTodayIncluded
            ? 'PRELIMINARY'
            : 'FINALIZED',
      statusMessage: isError
        ? 'Không tải được dữ liệu Search Console mới.'
        : !hasGscData
          ? 'Chưa có dữ liệu Search Console trong khoảng ngày đang chọn (Search Console có độ trễ chuẩn 24–48 giờ).'
          : latestDataThrough
            ? `Dữ liệu đến ${latestDataThrough} (Search Console trễ chuẩn 1–2 ngày)`
            : 'Đã đồng bộ dữ liệu Search Console.',
    },
    coverage: {
      availableWebsites: scope.availableWebsites,
      includedWebsites: scope.selectedWebsite
        ? [scope.selectedWebsite.domain]
        : scope.availableWebsites.filter((w) => Boolean(w.gscSiteUrl)).map((w) => w.domain),
      missingWebsites: scope.availableWebsites
        .filter((w) => !w.gscSiteUrl)
        .map((w) => w.domain),
      note:
        organicLeadVerificationState === 'INSUFFICIENT_EVIDENCE'
          ? `Có ${websiteFormLeadsWithoutUtm.length} Lead biểu mẫu từ website chưa gắn tham số UTM/nguồn tìm kiếm nên không tự cộng vào "Lead từ tìm kiếm tự nhiên".`
          : null,
    },
    version: `m03-${scope.websiteId}-${scope.startDateStr}-${scope.endDateStr}-${totalClicks ?? 'null'}`,
    ads: {
      status: hasAdsToken ? 'CONNECTED' : 'UNCONFIGURED',
      statusMessage: hasAdsToken
        ? 'Đã kết nối tài khoản Google Ads v26 qua OAuth. Xem chi tiết chiến dịch và chi tiêu tại mục Chiến dịch → Quảng cáo.'
        : 'Chưa kết nối tài khoản Google OAuth có quyền Google Ads. Vui lòng xem chi tiết kết nối tại mục Cài đặt hoặc Chiến dịch.',
      currencyCode: 'VND',
      metrics: {
        adCost: null,
        adImpressions: null,
        adClicks: null,
        adCtrPct: null,
        averageCpc: null,
        averageCpm: null,
        adConversions: null,
        costPerConversion: null,
        validAdLeadCount: validAdLeads.length,
        costPerValidAdLead: computeCostPerValidAdLead(null, validAdLeads.length),
      },
      charts: {
        adDailySeries: [],
        topCampaigns: [],
      },
      tables: {
        campaigns: paginateArray([], params?.page || 1, params?.pageSize || 20),
        adGroups: [],
        keywords: [],
        keywordAvailabilityNote: hasAdsToken
          ? null
          : 'Chưa kết nối tài khoản quảng cáo.',
        deviceBreakdown: [],
        geoBreakdown: [],
      },
    },
    seo: {
      metrics: {
        organicSearchClicks: totalClicks,
        organicSearchImpressions: totalImpr,
        organicSearchCtrPct: overallCtrPct,
        averageSearchPosition: avgSearchPosition,
        organicSessions: organicSessionsFromGa4,
        organicEngagementRatePct,
        organicFormEvents: null,
        organicValidLeadCount: organicValidLeads.length,
        organicLeadVerificationState,
      },
      comparison: {
        previousStartDate: scope.prevStartDateStr,
        previousEndDate: scope.prevEndDateStr,
        previousClicks: prevTotalClicks,
        previousImpressions: prevTotalImpr,
        clickChangePct: periodClickChangePct,
      },
      charts: {
        seoDailySeries,
        previousSeoDailySeries,
        opportunityQueries,
        opportunityThresholdNote: `Điều kiện lọc cơ hội: Hiển thị ≥ ${opportunityThresholdMinImpr} và CTR < ${ctrCeiling}% (gợi ý cần kiểm chứng, không khẳng định kết quả chắc chắn)`,
        pagesDeltaSummary: {
          risingPages,
          decliningPages,
          comparisonNote:
            !hasPrevLiveGsc && gscPagePrev.length === 0
              ? `Kỳ trước (${scope.prevStartDateStr} → ${scope.prevEndDateStr}) chưa có dữ liệu trang chi tiết để đối chiếu tăng/giảm.`
              : `So sánh kỳ hiện tại với kỳ trước (${scope.prevStartDateStr} → ${scope.prevEndDateStr})`,
        },
      },
      tables: {
        queries: paginateArray(allQueryRows, params?.page || 1, params?.pageSize || 20),
        pages: paginateArray(allPageRows, params?.page || 1, params?.pageSize || 20),
        content: paginateArray(contentRows, params?.contentPage || 1, params?.pageSize || 20),
        deviceCountry: deviceCountryRows,
        queryPageLinks,
      },
      opportunityConfig: {
        minImpressionsForLowCtr: opportunityThresholdMinImpr,
        maxCtrPctForOpportunity: ctrCeiling,
        staleContentDays: 30,
      },
    },
    siteStatus: {
      status: siteStatusRows.length > 0 ? 'CONNECTED' : 'UNCONFIGURED',
      statusMessage:
        siteStatusRows.length > 0
          ? 'Kiểm tra lập chỉ mục từng URL tiêu biểu qua URL Inspection API (không phải báo cáo toàn bộ lỗi lập chỉ mục toàn site).'
          : 'Chưa có kết quả kiểm tra URL tiêu biểu cho website đang chọn.',
      rows: siteStatusRows,
    },
    trends: (() => {
      const dbTrendRows = trendMetricRows.map((t) => ({
        term: t.keywordRaw || t.keywordTextNorm || t.campaignExternalId || 'Từ khóa',
        geoCode: t.accountPropertyId || 'VN',
        geoName: 'Việt Nam',
        date: t.metricDate,
        interestValue: t.trendInterestScore ?? t.impressions ?? 0,
        scaleType: 'INDEX_0_100',
        comparisonGroupId: t.campaignExternalId || 'default',
        sourceType: 'GOOGLE_TRENDS_INDEX' as const,
      }));
      const rssRows = liveTrendsSnap?.dailyRssTrends || [];
      const industrySuggestions = liveTrendsSnap?.industrySuggestions || [];
      const regionRows = trendsExtras?.regionRows || [];
      const relatedQueries = trendsExtras?.relatedQueries || [];
      const hasAnyLiveTrends =
        dbTrendRows.length > 0 ||
        rssRows.length > 0 ||
        industrySuggestions.length > 0 ||
        regionRows.length > 0;

      return {
        status: hasAnyLiveTrends ? 'CONNECTED' : 'UNCONFIGURED',
        statusMessage: hasAnyLiveTrends
          ? `Đã kết nối Google Trends Việt Nam (Suggest miễn phí & CSV${
              serpApiKey ? ' + SerpApi' : ''
            }). Cập nhật lúc ${
              liveTrendsSnap?.fetchedAt
                ? new Date(liveTrendsSnap.fetchedAt).toLocaleTimeString('vi-VN', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : 'hiện tại'
            }.`
          : liveTrendsSnap?.errorMessage ||
            'Chưa tải được dữ liệu Google Trends trực tuyến; không hiển thị điểm số ước lượng giả.',
        rows: dbTrendRows.length > 0 ? dbTrendRows : rssRows,
        dailyRssTrends: rssRows,
        industrySuggestions,
        regionRows,
        relatedQueries,
        serpApiConfigured: Boolean(serpApiKey),
        lastSyncedAt: liveTrendsSnap?.fetchedAt || null,
      };
    })(),
  };
    },
  });

  if (cached.fromCache) {
    return {
      ...cached.data,
      freshness: {
        ...cached.data.freshness,
        lastCheckedAt: new Date().toISOString(),
        checkedAt: new Date().toISOString(),
        fromCache: true,
      },
    };
  }
  return cached.data;
}
