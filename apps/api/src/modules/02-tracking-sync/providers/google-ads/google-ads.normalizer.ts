import type { UpsertPlatformMetricInput } from '@toantrung/database';
import type {
  GoogleAdsCampaignMetricRow,
  GoogleAdsKeywordMetricRow,
} from './google-ads.types';

/**
 * Lấy chuỗi ngày YYYY-MM-DD theo múi giờ Việt Nam (Asia/Ho_Chi_Minh - UTC+7)
 */
export function getVietnamTodayDateString(refDate: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(refDate);
  return parts; // Định dạng YYYY-MM-DD
}

/**
 * Chuyển đổi số float chuyển đổi thành BigInt micros để bảo toàn độ chính xác
 * VD: 2.5 conversions -> 2,500,000 micros
 */
export function floatConversionsToMicros(conversions: number): bigint {
  if (conversions <= 0 || !Number.isFinite(conversions)) return 0n;
  return BigInt(Math.round(conversions * 1_000_000));
}

/**
 * Chuẩn hóa một dòng Campaign từ Google Ads sang UpsertPlatformMetricInput
 */
export function normalizeGoogleAdsCampaignRow(
  row: GoogleAdsCampaignMetricRow,
  accountPropertyId: string,
  todayVn: string = getVietnamTodayDateString(),
): UpsertPlatformMetricInput {
  const spendMicros = BigInt(row.costMicros || '0');
  const dailyBudgetMicros = row.dailyBudgetMicros ? BigInt(row.dailyBudgetMicros) : null;
  const cpcMicros = row.averageCpcMicros ? BigInt(row.averageCpcMicros) : null;
  const conversionsMicros = floatConversionsToMicros(row.conversions);

  // Số liệu quá khứ coi là đã chốt (isFinalized: true); số liệu hôm nay chưa chốt (isFinalized: false)
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
    googleLeadFormCount: Math.round(row.conversions), // Ước lượng/đối soát ban đầu cho Lead Form
    isFinalized,
  };
}

/**
 * Chuẩn hóa một dòng Keyword từ Google Ads sang UpsertPlatformMetricInput
 */
export function normalizeGoogleAdsKeywordRow(
  row: GoogleAdsKeywordMetricRow,
  accountPropertyId: string,
  todayVn: string = getVietnamTodayDateString(),
): UpsertPlatformMetricInput {
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
