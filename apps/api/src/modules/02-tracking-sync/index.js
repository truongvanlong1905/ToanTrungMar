'use strict';

const path = require('node:path');

let operationsRuntime;
try {
  operationsRuntime = require('../../../../../packages/database/src/operations-runtime');
} catch {
  operationsRuntime = require(path.resolve(process.cwd(), 'packages/database/src/operations-runtime'));
}
const { upsertPlatformMetricIdempotent } = operationsRuntime;

class GoogleAdsError extends Error {
  constructor(message, code, statusCode, isRetryable = false) {
    super(message);
    this.name = 'GoogleAdsError';
    this.code = code;
    this.statusCode = statusCode;
    this.isRetryable = isRetryable;
  }
}

class GoogleAdsAuthError extends GoogleAdsError {
  constructor(message = 'Lỗi xác thực Google Ads API: Credential không hợp lệ hoặc hết hạn.') {
    super(message, 'GOOGLE_ADS_AUTH_FAILED', 401, false);
    this.name = 'GoogleAdsAuthError';
  }
}

class GoogleAdsRateLimitError extends GoogleAdsError {
  constructor(message = 'Google Ads API vượt ngưỡng giới hạn tần suất (Rate Limit / Quota Exceeded).') {
    super(message, 'GOOGLE_ADS_RATE_LIMITED', 429, true);
    this.name = 'GoogleAdsRateLimitError';
  }
}

class GoogleAdsTimeoutError extends GoogleAdsError {
  constructor(message = 'Google Ads API yêu cầu quá thời gian chờ (Timeout).') {
    super(message, 'GOOGLE_ADS_TIMEOUT', 408, true);
    this.name = 'GoogleAdsTimeoutError';
  }
}

const MOCK_CAMPAIGNS = [
  {
    id: 'CMP-LED-INDOOR-P25',
    name: 'Chiến dịch Màn hình LED Hội trường P2.5 Q4',
    budgetMicros: '3500000000000',
    baseImpressions: 8200,
    baseCpcVnd: 28500,
  },
  {
    id: 'CMP-LED-OUTDOOR-P4',
    name: 'Chiến dịch Màn hình LED Ngoài trời P4/P5 Q4',
    budgetMicros: '5000000000000',
    baseImpressions: 11400,
    baseCpcVnd: 31200,
  },
  {
    id: 'CMP-BOARD-FACTORY',
    name: 'Bảng điện tử Năng suất & An toàn Nhà máy',
    budgetMicros: '1500000000000',
    baseImpressions: 4300,
    baseCpcVnd: 19800,
  },
];

const MOCK_KEYWORDS = [
  {
    criterionId: 'KW-01',
    campaignId: 'CMP-LED-INDOOR-P25',
    campaignName: 'Chiến dịch Màn hình LED Hội trường P2.5 Q4',
    text: 'báo giá màn hình led hội trường p2.5',
    matchType: 'PHRASE',
    shareOfCampaignClicks: 0.45,
  },
  {
    criterionId: 'KW-02',
    campaignId: 'CMP-LED-INDOOR-P25',
    campaignName: 'Chiến dịch Màn hình LED Hội trường P2.5 Q4',
    text: 'màn hình led p2.5 trong nhà',
    matchType: 'EXACT',
    shareOfCampaignClicks: 0.35,
  },
  {
    criterionId: 'KW-03',
    campaignId: 'CMP-LED-INDOOR-P25',
    campaignName: 'Chiến dịch Màn hình LED Hội trường P2.5 Q4',
    text: 'màn hình led hội trường',
    matchType: 'BROAD',
    shareOfCampaignClicks: 0.2,
  },
  {
    criterionId: 'KW-04',
    campaignId: 'CMP-LED-OUTDOOR-P4',
    campaignName: 'Chiến dịch Màn hình LED Ngoài trời P4/P5 Q4',
    text: 'màn hình led ngoài trời p4',
    matchType: 'EXACT',
    shareOfCampaignClicks: 0.5,
  },
  {
    criterionId: 'KW-05',
    campaignId: 'CMP-LED-OUTDOOR-P4',
    campaignName: 'Chiến dịch Màn hình LED Ngoài trời P4/P5 Q4',
    text: 'báo giá led p5 outdoor chống nước',
    matchType: 'PHRASE',
    shareOfCampaignClicks: 0.35,
  },
  {
    criterionId: 'KW-06',
    campaignId: 'CMP-BOARD-FACTORY',
    campaignName: 'Bảng điện tử Năng suất & An toàn Nhà máy',
    text: 'bảng điện tử năng suất nhà máy',
    matchType: 'EXACT',
    shareOfCampaignClicks: 0.6,
  },
  {
    criterionId: 'KW-07',
    campaignId: 'CMP-BOARD-FACTORY',
    campaignName: 'Bảng điện tử Năng suất & An toàn Nhà máy',
    text: 'bảng led an toàn lao động cổng công ty',
    matchType: 'PHRASE',
    shareOfCampaignClicks: 0.4,
  },
];

function getDatesInRange(startDate, endDate) {
  const dates = [];
  const curr = new Date(startDate);
  const end = new Date(endDate);
  while (curr <= end) {
    dates.push(curr.toISOString().slice(0, 10));
    curr.setDate(curr.getDate() + 1);
  }
  return dates;
}

function deterministicHash(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

class GoogleAdsMockAdapter {
  constructor(accountPropertyId = 'GADS-SYNTH-MOCK-01') {
    this.accountPropertyId = accountPropertyId;
    this.isMock = true;
  }

  async getHealthStatus() {
    return {
      ok: true,
      provider: 'mock',
      accountPropertyId: this.accountPropertyId,
      accessLevel: 'Synthetic Mock Adapter (No Cloud Connection Required)',
      message: 'Bộ giả lập Google Ads đang hoạt động với dữ liệu tổng hợp chuẩn UC03.',
    };
  }

  checkSimulatedError(options) {
    if (!options || !options.simulateError) return;
    switch (options.simulateError) {
      case 'AUTH_ERROR':
        throw new GoogleAdsAuthError();
      case 'RATE_LIMIT':
        throw new GoogleAdsRateLimitError();
      case 'TIMEOUT':
        throw new GoogleAdsTimeoutError();
      case 'EMPTY':
        break;
    }
  }

  async fetchCampaignMetrics(window, options) {
    this.checkSimulatedError(options);
    if (options && options.simulateError === 'EMPTY') return [];

    const dates = getDatesInRange(window.startDate, window.endDate);
    const rows = [];

    for (const date of dates) {
      for (const camp of MOCK_CAMPAIGNS) {
        const seed = `${date}|${camp.id}`;
        const hash = deterministicHash(seed);
        const varianceFactor = 0.9 + ((hash % 200) / 1000);
        const impressions = Math.round(camp.baseImpressions * varianceFactor);
        const ctr = 0.038 + ((hash % 15) / 1000);
        const clicks = Math.max(1, Math.round(impressions * ctr));
        const cpcVnd = Math.round(camp.baseCpcVnd * (0.95 + ((hash % 100) / 1000)));
        const costVnd = clicks * cpcVnd;
        const conversions = Math.round((1 + ((hash % 60) / 10)) * 10) / 10;

        const costMicros = (BigInt(costVnd) * 1000000n).toString(10);
        const cpcMicros = (BigInt(cpcVnd) * 1000000n).toString(10);

        rows.push({
          campaignId: camp.id,
          campaignName: camp.name,
          campaignStatus: 'ENABLED',
          date,
          costMicros,
          dailyBudgetMicros: camp.budgetMicros,
          averageCpcMicros: cpcMicros,
          impressions,
          clicks,
          conversions,
          currencyCode: 'VND',
        });
      }
    }
    return rows;
  }

  async fetchKeywordMetrics(window, options) {
    this.checkSimulatedError(options);
    if (options && options.simulateError === 'EMPTY') return [];

    const dates = getDatesInRange(window.startDate, window.endDate);
    const rows = [];

    for (const date of dates) {
      for (const kw of MOCK_KEYWORDS) {
        const camp = MOCK_CAMPAIGNS.find((c) => c.id === kw.campaignId);
        if (!camp) continue;

        const seed = `${date}|${kw.criterionId}|${kw.text}`;
        const hash = deterministicHash(seed);
        const campVariance = 0.9 + ((deterministicHash(`${date}|${camp.id}`) % 200) / 1000);
        const campClicks = Math.round(camp.baseImpressions * campVariance * 0.045);

        const kwClicks = Math.max(1, Math.round(campClicks * kw.shareOfCampaignClicks));
        const kwImpressions = Math.round(kwClicks * (20 + (hash % 10)));
        const cpcVnd = Math.round(camp.baseCpcVnd * (0.9 + ((hash % 200) / 1000)));
        const costVnd = kwClicks * cpcVnd;
        const conversions = Math.max(0, Math.round((kwClicks * 0.04) * 10) / 10);

        const costMicros = (BigInt(costVnd) * 1000000n).toString(10);
        const cpcMicros = (BigInt(cpcVnd) * 1000000n).toString(10);

        rows.push({
          campaignId: kw.campaignId,
          campaignName: kw.campaignName,
          criterionId: kw.criterionId,
          keywordText: kw.text,
          matchType: kw.matchType,
          date,
          costMicros,
          averageCpcMicros: cpcMicros,
          impressions: kwImpressions,
          clicks: kwClicks,
          conversions,
          currencyCode: 'VND',
        });
      }
    }
    return rows;
  }
}

function getVietnamTodayDateString(refDate = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(refDate);
}

function floatConversionsToMicros(conversions) {
  if (conversions <= 0 || !Number.isFinite(conversions)) return 0n;
  return BigInt(Math.round(conversions * 1000000));
}

function normalizeGoogleAdsCampaignRow(row, accountPropertyId, todayVn = getVietnamTodayDateString()) {
  const spendMicros = BigInt(row.costMicros || '0');
  const dailyBudgetMicros = row.dailyBudgetMicros ? BigInt(row.dailyBudgetMicros) : null;
  const cpcMicros = row.averageCpcMicros ? BigInt(row.averageCpcMicros) : null;
  const conversionsMicros = floatConversionsToMicros(row.conversions);
  const isFinalized = row.date < todayVn;

  return {
    platform: 'google_ads',
    accountPropertyId,
    metricDate: row.date,
    grain: 'campaign',
    campaignExternalId: row.campaignId,
    campaignName: row.campaignName,
    currencyCode: row.currencyCode || 'VND',
    spendMicros,
    dailyBudgetMicros,
    cpcMicros,
    impressions: row.impressions,
    clicks: row.clicks,
    conversionsMicros,
    googleLeadFormCount: Math.round(row.conversions),
    isFinalized,
  };
}

function normalizeGoogleAdsKeywordRow(row, accountPropertyId, todayVn = getVietnamTodayDateString()) {
  const spendMicros = BigInt(row.costMicros || '0');
  const cpcMicros = row.averageCpcMicros ? BigInt(row.averageCpcMicros) : null;
  const conversionsMicros = floatConversionsToMicros(row.conversions);
  const isFinalized = row.date < todayVn;

  return {
    platform: 'google_ads',
    accountPropertyId,
    metricDate: row.date,
    grain: 'keyword',
    campaignExternalId: row.campaignId,
    campaignName: row.campaignName,
    keywordRaw: row.keywordText,
    keywordMatchType: row.matchType,
    currencyCode: row.currencyCode || 'VND',
    spendMicros,
    cpcMicros,
    impressions: row.impressions,
    clicks: row.clicks,
    conversionsMicros,
    isFinalized,
  };
}

function calculateSyncWindow(runType, explicitStart, explicitEnd) {
  const todayVn = getVietnamTodayDateString();
  if (explicitStart && explicitEnd) {
    return { startDate: explicitStart, endDate: explicitEnd };
  }
  const today = new Date(`${todayVn}T00:00:00+07:00`);
  if (runType === 'full') {
    const past30 = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    return {
      startDate: past30.toISOString().slice(0, 10),
      endDate: todayVn,
    };
  }
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  return {
    startDate: yesterday.toISOString().slice(0, 10),
    endDate: todayVn,
  };
}

class SyncOrchestratorService {
  constructor(prisma) {
    this.prisma = prisma;
  }

  async executeGoogleAdsSync(params = {}) {
    const runType = params.runType || 'light';
    const { startDate, endDate } = calculateSyncWindow(runType, params.startDate, params.endDate);
    const client =
      params.clientOverride ||
      new GoogleAdsMockAdapter(params.accountPropertyId || 'GADS-SYNTH-MOCK-01');

    const accountPropertyId = client.accountPropertyId;
    const startTime = Date.now();
    const startedAt = new Date();

    const lastLog = await this.prisma.platformSyncLog.findFirst({
      where: {
        platform: 'google_ads',
        accountPropertyId,
      },
      orderBy: { startedAt: 'desc' },
    });
    const prevConsecutiveFailures = lastLog?.status === 'failed' ? lastLog.consecutiveFailures : 0;

    const syncLog = await this.prisma.platformSyncLog.create({
      data: {
        platform: 'google_ads',
        accountPropertyId,
        runType,
        windowStartDate: startDate,
        windowEndDate: endDate,
        status: 'running',
        consecutiveFailures: prevConsecutiveFailures,
        startedAt,
      },
    });

    try {
      const syncOptions = {
        simulateError: params.simulateError,
        forceMock: params.forceMock,
      };

      const [campaignRows, keywordRows] = await Promise.all([
        client.fetchCampaignMetrics({ startDate, endDate }, syncOptions),
        client.fetchKeywordMetrics({ startDate, endDate }, syncOptions),
      ]);

      const todayVn = getVietnamTodayDateString();
      let recordsUpserted = 0;

      const distinctCampaigns = new Map();
      for (const r of campaignRows) {
        if (!distinctCampaigns.has(r.campaignId)) {
          distinctCampaigns.set(r.campaignId, { id: r.campaignId, name: r.campaignName });
        }
      }

      for (const camp of distinctCampaigns.values()) {
        await this.prisma.campaign.upsert({
          where: {
            uq_campaign_platform_account_code: {
              platform: 'google_ads',
              accountExternalId: accountPropertyId,
              campaignCode: camp.id,
            },
          },
          update: {
            campaignName: camp.name,
            isActive: true,
          },
          create: {
            platform: 'google_ads',
            accountExternalId: accountPropertyId,
            campaignCode: camp.id,
            campaignName: camp.name,
            currencyCode: 'VND',
            isActive: true,
          },
        });
      }

      const dbCampaigns = await this.prisma.campaign.findMany({
        where: {
          platform: 'google_ads',
          accountExternalId: accountPropertyId,
        },
      });
      const campaignCodeToIdMap = new Map(dbCampaigns.map((c) => [c.campaignCode, c.id]));

      for (const row of campaignRows) {
        const normalized = normalizeGoogleAdsCampaignRow(row, accountPropertyId, todayVn);
        normalized.campaignId = campaignCodeToIdMap.get(row.campaignId) ?? null;
        await upsertPlatformMetricIdempotent(this.prisma, normalized);
        recordsUpserted++;
      }

      for (const row of keywordRows) {
        const normalized = normalizeGoogleAdsKeywordRow(row, accountPropertyId, todayVn);
        normalized.campaignId = campaignCodeToIdMap.get(row.campaignId) ?? null;
        await upsertPlatformMetricIdempotent(this.prisma, normalized);
        recordsUpserted++;
      }

      const completedAt = new Date();
      const durationMs = Date.now() - startTime;

      await this.prisma.platformSyncLog.update({
        where: { id: syncLog.id },
        data: {
          status: 'success',
          recordsSynced: recordsUpserted,
          errorMessage: null,
          consecutiveFailures: 0,
          completedAt,
        },
      });

      return {
        logId: syncLog.id,
        platform: 'google_ads',
        accountPropertyId,
        runType,
        windowStartDate: startDate,
        windowEndDate: endDate,
        recordsSynced: recordsUpserted,
        status: 'success',
        errorMessage: null,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs,
      };
    } catch (err) {
      const completedAt = new Date();
      const durationMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);
      const newConsecutiveFailures = prevConsecutiveFailures + 1;

      await this.prisma.platformSyncLog.update({
        where: { id: syncLog.id },
        data: {
          status: 'failed',
          errorMessage,
          consecutiveFailures: newConsecutiveFailures,
          completedAt,
        },
      });

      if (newConsecutiveFailures >= 3) {
        try {
          const adminUser = await this.prisma.user.findFirst({
            where: { role: { roleCode: 'ADMIN' }, isActive: true },
            select: { id: true },
          });
          if (adminUser) {
            await this.prisma.notification.create({
              data: {
                userId: adminUser.id,
                title: 'Cảnh báo đồng bộ Google Ads (3 lần thất bại liên tiếp)',
                summary: `Đồng bộ Google Ads cho tài khoản ${accountPropertyId} đã thất bại ${newConsecutiveFailures} lần liên tiếp. Lỗi: ${errorMessage}`,
                category: 'Hệ thống',
                actionLabel: 'Kiểm tra đồng bộ',
                actionUrl: '/tracking',
              },
            });
          }
        } catch {
          // Bỏ qua nếu bảng notification chưa khả dụng
        }
      }

      return {
        logId: syncLog.id,
        platform: 'google_ads',
        accountPropertyId,
        runType,
        windowStartDate: startDate,
        windowEndDate: endDate,
        recordsSynced: 0,
        status: 'failed',
        errorMessage,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs,
      };
    }
  }
}

class MetricsQueryService {
  constructor(prisma) {
    this.prisma = prisma;
  }

  async getDailyMetrics(query) {
    const where = { platform: query.platform || 'google_ads' };
    if (query.accountPropertyId) where.accountPropertyId = query.accountPropertyId;
    if (query.grain) where.grain = query.grain;
    if (query.campaignExternalId) where.campaignExternalId = query.campaignExternalId;
    if (query.keywordTextNorm) where.keywordTextNorm = query.keywordTextNorm;

    if (query.metricDateFrom || query.metricDateTo) {
      const dateFilter = {};
      if (query.metricDateFrom) dateFilter.gte = query.metricDateFrom;
      if (query.metricDateTo) dateFilter.lte = query.metricDateTo;
      where.metricDate = dateFilter;
    }

    const [rows, total] = await Promise.all([
      this.prisma.platformDailyMetric.findMany({
        where,
        orderBy: [{ metricDate: 'desc' }, { spendMicros: 'desc' }],
        take: query.limit || 100,
        skip: query.offset || 0,
      }),
      this.prisma.platformDailyMetric.count({ where }),
    ]);

    const data = rows.map((r) => this.mapToDto(r));
    return { data, total };
  }

  async getMetricsSummary(query) {
    const { data: metrics, total } = await this.getDailyMetrics(query);

    let totalSpendMicros = 0n;
    let totalImpressions = 0;
    let totalClicks = 0;
    let totalConversionsMicros = 0n;
    let totalGoogleLeadForms = 0;

    for (const m of metrics) {
      totalSpendMicros += BigInt(m.spend.rawAmountString);
      totalImpressions += m.impressions;
      totalClicks += m.clicks;
      totalConversionsMicros += BigInt(m.conversionsMicrosString);
      totalGoogleLeadForms += m.googleLeadFormCount;
    }

    const avgCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
    const totalConversions = Number(totalConversionsMicros) / 1000000;

    const totalSpend = {
      rawAmountString: totalSpendMicros.toString(10),
      currency: 'VND',
      scale: 'micros',
      formattedDecimal: (totalSpendMicros / 1000000n).toString(10),
    };

    const windowStartDate = query.metricDateFrom || (metrics.length ? metrics[metrics.length - 1].metricDate : '');
    const windowEndDate = query.metricDateTo || (metrics.length ? metrics[0].metricDate : '');

    return {
      platform: query.platform || 'google_ads',
      accountPropertyId: query.accountPropertyId || 'all',
      windowStartDate,
      windowEndDate,
      totalRecords: total,
      totalSpend,
      totalImpressions,
      totalClicks,
      avgCtr: Math.round(avgCtr * 10000) / 10000,
      totalConversions: Math.round(totalConversions * 10) / 10,
      totalGoogleLeadForms,
      metrics,
    };
  }

  mapToDto(r) {
    const spendMicros = BigInt(r.spendMicros || 0n);
    const dailyBudgetMicros = r.dailyBudgetMicros ? BigInt(r.dailyBudgetMicros) : null;
    const cpcMicros = r.cpcMicros ? BigInt(r.cpcMicros) : null;
    const conversionsMicros = BigInt(r.conversionsMicros || 0n);

    const impressions = Number(r.impressions || 0);
    const clicks = Number(r.clicks || 0);
    const ctr = impressions > 0 ? Math.round((clicks / impressions) * 10000) / 10000 : 0;

    return {
      id: r.id,
      platform: r.platform,
      accountPropertyId: r.accountPropertyId,
      metricDate: r.metricDate,
      grain: r.grain,
      campaignExternalId: r.campaignExternalId,
      campaignId: r.campaignId,
      campaignName: r.campaignName,
      keywordRaw: r.keywordRaw,
      keywordMatchType: r.keywordMatchType,
      keywordTextNorm: r.keywordTextNorm,
      pageUrlRaw: r.pageUrlRaw,
      pagePathNorm: r.pagePathNorm,
      dimensionFingerprint: r.dimensionFingerprint,

      currencyCode: r.currencyCode,
      spend: {
        rawAmountString: spendMicros.toString(10),
        currency: r.currencyCode,
        scale: 'micros',
        formattedDecimal: (spendMicros / 1000000n).toString(10),
      },
      dailyBudget: dailyBudgetMicros
        ? {
            rawAmountString: dailyBudgetMicros.toString(10),
            currency: r.currencyCode,
            scale: 'micros',
            formattedDecimal: (dailyBudgetMicros / 1000000n).toString(10),
          }
        : null,
      cpc: cpcMicros
        ? {
            rawAmountString: cpcMicros.toString(10),
            currency: r.currencyCode,
            scale: 'micros',
            formattedDecimal: (cpcMicros / 1000000n).toString(10),
          }
        : null,

      impressions,
      clicks,
      ctr,
      conversions: Math.round((Number(conversionsMicros) / 1000000) * 10) / 10,
      conversionsMicrosString: conversionsMicros.toString(10),
      googleLeadFormCount: Number(r.googleLeadFormCount || 0),

      pageViews: Number(r.pageViews || 0),
      avgTimeOnPageSec: Number(r.avgTimeOnPageSec || 0),
      avgPosition: r.avgPosition !== null ? Number(r.avgPosition) : null,
      fanpageEngagements: Number(r.fanpageEngagements || 0),
      trendInterestScore: r.trendInterestScore !== null ? Number(r.trendInterestScore) : null,

      isFinalized: Boolean(r.isFinalized),
      syncedAt: r.syncedAt instanceof Date ? r.syncedAt.toISOString() : String(r.syncedAt),
    };
  }
}

let isJobRunning = false;
async function runTrackingSyncWorker(prisma, type, options = {}) {
  if (isJobRunning) {
    throw new Error('Một tiến trình đồng bộ số liệu đang chạy trong nền.');
  }
  isJobRunning = true;
  try {
    const orchestrator = new SyncOrchestratorService(prisma);
    return await orchestrator.executeGoogleAdsSync({
      runType: type,
      startDate: options.startDate,
      endDate: options.endDate,
      forceMock: options.forceMock,
    });
  } finally {
    isJobRunning = false;
  }
}

module.exports = {
  GoogleAdsError,
  GoogleAdsAuthError,
  GoogleAdsRateLimitError,
  GoogleAdsTimeoutError,
  GoogleAdsMockAdapter,
  getVietnamTodayDateString,
  floatConversionsToMicros,
  normalizeGoogleAdsCampaignRow,
  normalizeGoogleAdsKeywordRow,
  SyncOrchestratorService,
  MetricsQueryService,
  runTrackingSyncWorker,
};
