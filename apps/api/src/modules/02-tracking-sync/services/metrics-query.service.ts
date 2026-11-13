import type { PrismaClient } from '@toantrung/database';
import {
  toMonetaryAmountDto,
  formatMicrosToDecimal,
} from '@toantrung/contracts/common';
import type {
  GetPlatformDailyMetricsQueryDto,
  PlatformDailyMetricDto,
  PlatformMetricsSummaryDto,
  MetricGrain,
} from '@toantrung/contracts/02-tracking-sync';

export class MetricsQueryService {
  constructor(private readonly prisma: PrismaClient) {}

  public async getDailyMetrics(
    query: GetPlatformDailyMetricsQueryDto,
  ): Promise<{ data: PlatformDailyMetricDto[]; total: number }> {
    const where: Record<string, unknown> = {
      platform: query.platform,
    };

    if (query.accountPropertyId) {
      where.accountPropertyId = query.accountPropertyId;
    }
    if (query.grain) {
      where.grain = query.grain;
    }
    if (query.campaignExternalId) {
      where.campaignExternalId = query.campaignExternalId;
    }
    if (query.keywordTextNorm) {
      where.keywordTextNorm = query.keywordTextNorm;
    }

    if (query.metricDateFrom || query.metricDateTo) {
      const dateFilter: Record<string, string> = {};
      if (query.metricDateFrom) dateFilter.gte = query.metricDateFrom;
      if (query.metricDateTo) dateFilter.lte = query.metricDateTo;
      where.metricDate = dateFilter;
    }

    const [rows, total] = await Promise.all([
      this.prisma.platformDailyMetric.findMany({
        where,
        orderBy: [{ metricDate: 'desc' }, { spendMicros: 'desc' }],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.platformDailyMetric.count({ where }),
    ]);

    const data = rows.map((r) => this.mapToDto(r));
    return { data, total };
  }

  public async getMetricsSummary(
    query: GetPlatformDailyMetricsQueryDto,
  ): Promise<PlatformMetricsSummaryDto> {
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
    const totalConversions = Number(totalConversionsMicros) / 1_000_000;

    const totalSpend = toMonetaryAmountDto(
      totalSpendMicros,
      'VND',
      'micros',
    )!;

    const windowStartDate = query.metricDateFrom || (metrics.length ? metrics[metrics.length - 1].metricDate : '');
    const windowEndDate = query.metricDateTo || (metrics.length ? metrics[0].metricDate : '');

    return {
      platform: query.platform,
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

  private mapToDto(r: any): PlatformDailyMetricDto {
    const currency = (r.currencyCode === 'USD' ? 'USD' : 'VND') as 'VND' | 'USD';
    const spend = toMonetaryAmountDto(r.spendMicros, currency, 'micros')!;
    const dailyBudget = toMonetaryAmountDto(r.dailyBudgetMicros, currency, 'micros');
    const cpc = toMonetaryAmountDto(r.cpcMicros, currency, 'micros');

    const impressions = Number(r.impressions || 0);
    const clicks = Number(r.clicks || 0);
    const ctr = impressions > 0 ? Math.round((clicks / impressions) * 10000) / 10000 : 0;

    const conversionsMicros = BigInt(r.conversionsMicros || 0n);
    const conversions = Number(conversionsMicros) / 1_000_000;

    return {
      id: r.id,
      platform: r.platform,
      accountPropertyId: r.accountPropertyId,
      metricDate: r.metricDate,
      grain: r.grain as MetricGrain,
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
      spend,
      dailyBudget,
      cpc,

      impressions,
      clicks,
      ctr,
      conversions: Math.round(conversions * 10) / 10,
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
