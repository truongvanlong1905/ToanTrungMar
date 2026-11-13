import type {
  GoogleAdsCampaignMetricRow,
  GoogleAdsKeywordMetricRow,
  GoogleAdsSyncWindow,
  GoogleAdsSyncOptions,
} from './google-ads.types';

export interface GoogleAdsHealthCheckResult {
  ok: boolean;
  provider: 'mock' | 'live';
  accountPropertyId: string;
  accessLevel?: string;
  message?: string;
}

export interface IGoogleAdsClient {
  readonly accountPropertyId: string;
  readonly isMock: boolean;

  fetchCampaignMetrics(
    window: GoogleAdsSyncWindow,
    options?: GoogleAdsSyncOptions,
  ): Promise<GoogleAdsCampaignMetricRow[]>;

  fetchKeywordMetrics(
    window: GoogleAdsSyncWindow,
    options?: GoogleAdsSyncOptions,
  ): Promise<GoogleAdsKeywordMetricRow[]>;

  getHealthStatus(): Promise<GoogleAdsHealthCheckResult>;
}
