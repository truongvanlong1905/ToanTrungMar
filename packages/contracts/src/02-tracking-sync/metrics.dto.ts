import { z } from 'zod';
import type { MonetaryAmountDto } from '../common';

export const METRIC_PLATFORMS = [
  'google_ads',
  'ga4',
  'search_console',
  'fanpage',
  'google_trends',
] as const;

export type MetricPlatform = (typeof METRIC_PLATFORMS)[number];

export const METRIC_GRAINS = ['account', 'campaign', 'keyword', 'page', 'topic'] as const;

export type MetricGrain = (typeof METRIC_GRAINS)[number];

export const GetPlatformDailyMetricsQuerySchema = z.object({
  platform: z.enum(METRIC_PLATFORMS).default('google_ads'),
  accountPropertyId: z.string().trim().optional(),
  metricDateFrom: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Định dạng ngày bắt đầu phải là YYYY-MM-DD.')
    .optional(),
  metricDateTo: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Định dạng ngày kết thúc phải là YYYY-MM-DD.')
    .optional(),
  grain: z.enum(METRIC_GRAINS).optional(),
  campaignExternalId: z.string().trim().optional(),
  keywordTextNorm: z.string().trim().optional(),
  limit: z.coerce.number().int().positive().max(1000).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});

export type GetPlatformDailyMetricsQueryDto = z.infer<typeof GetPlatformDailyMetricsQuerySchema>;

export interface PlatformDailyMetricDto {
  id: number;
  platform: string;
  accountPropertyId: string;
  metricDate: string; // YYYY-MM-DD
  grain: MetricGrain;
  campaignExternalId: string;
  campaignId: number | null;
  campaignName: string | null;
  keywordRaw: string | null;
  keywordMatchType: string;
  keywordTextNorm: string;
  pageUrlRaw: string | null;
  pagePathNorm: string;
  dimensionFingerprint: string;

  currencyCode: string;
  spend: MonetaryAmountDto;
  dailyBudget: MonetaryAmountDto | null;
  cpc: MonetaryAmountDto | null;

  impressions: number;
  clicks: number;
  ctr: number; // percentage as float: 0.05 = 5%
  conversions: number; // conversions as float
  conversionsMicrosString: string;
  googleLeadFormCount: number;

  pageViews: number;
  avgTimeOnPageSec: number;
  avgPosition: number | null;
  fanpageEngagements: number;
  trendInterestScore: number | null;

  isFinalized: boolean;
  syncedAt: string;
}

export interface PlatformMetricsSummaryDto {
  platform: string;
  accountPropertyId: string;
  windowStartDate: string;
  windowEndDate: string;
  totalRecords: number;
  totalSpend: MonetaryAmountDto;
  totalImpressions: number;
  totalClicks: number;
  avgCtr: number;
  totalConversions: number;
  totalGoogleLeadForms: number;
  metrics: PlatformDailyMetricDto[];
}
