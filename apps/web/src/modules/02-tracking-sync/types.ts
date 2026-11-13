import type {
  PlatformDailyMetricDto,
  PlatformMetricsSummaryDto,
  PlatformSyncLogDto,
  SyncExecutionResultDto,
  SyncRunType,
  GoogleAdsConnectionInfoDto,
  LiveCampaignItemDto,
  GetSyncLogsResponseDto,
} from '@toantrung/contracts/02-tracking-sync';

export interface CampaignMetricsAggregate {
  code: string;
  name: string;
  platform: string;
  dailyBudgetVnd: number;
  totalSpendVnd: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number;
  avgCpcVnd: number;
  recordCount: number;
}

export type {
  PlatformDailyMetricDto,
  PlatformMetricsSummaryDto,
  PlatformSyncLogDto,
  SyncExecutionResultDto,
  SyncRunType,
  GoogleAdsConnectionInfoDto,
  LiveCampaignItemDto,
  GetSyncLogsResponseDto,
};

