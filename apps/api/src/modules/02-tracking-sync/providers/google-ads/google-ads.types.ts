export interface GoogleAdsCampaignMetricRow {
  campaignId: string;
  campaignName: string;
  campaignStatus: 'ENABLED' | 'PAUSED' | 'REMOVED';
  date: string; // YYYY-MM-DD
  costMicros: string; // Google Ads returns cost as string of integer micros
  dailyBudgetMicros?: string | null;
  averageCpcMicros?: string | null;
  impressions: number;
  clicks: number;
  conversions: number; // May be fractional in Google Ads data-driven attribution
  currencyCode: string; // e.g. 'VND'
}

export interface GoogleAdsKeywordMetricRow {
  campaignId: string;
  campaignName: string;
  criterionId: string;
  keywordText: string;
  matchType: 'EXACT' | 'PHRASE' | 'BROAD';
  date: string; // YYYY-MM-DD
  costMicros: string;
  averageCpcMicros?: string | null;
  impressions: number;
  clicks: number;
  conversions: number;
  currencyCode: string;
}

export interface GoogleAdsSyncWindow {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}

export interface GoogleAdsSyncOptions {
  simulateError?: 'AUTH_ERROR' | 'RATE_LIMIT' | 'TIMEOUT' | 'EMPTY';
  forceMock?: boolean;
}

export class GoogleAdsError extends Error {
  public readonly code: string;
  public readonly statusCode?: number;
  public readonly isRetryable: boolean;

  constructor(message: string, code: string, statusCode?: number, isRetryable = false) {
    super(message);
    this.name = 'GoogleAdsError';
    this.code = code;
    this.statusCode = statusCode;
    this.isRetryable = isRetryable;
  }
}

export class GoogleAdsAuthError extends GoogleAdsError {
  constructor(message = 'Lỗi xác thực Google Ads API: Credential không hợp lệ hoặc hết hạn.') {
    super(message, 'GOOGLE_ADS_AUTH_FAILED', 401, false);
    this.name = 'GoogleAdsAuthError';
  }
}

export class GoogleAdsRateLimitError extends GoogleAdsError {
  constructor(message = 'Google Ads API vượt ngưỡng giới hạn tần suất (Rate Limit / Quota Exceeded).') {
    super(message, 'GOOGLE_ADS_RATE_LIMITED', 429, true);
    this.name = 'GoogleAdsRateLimitError';
  }
}

export class GoogleAdsTimeoutError extends GoogleAdsError {
  constructor(message = 'Google Ads API yêu cầu quá thời gian chờ (Timeout).') {
    super(message, 'GOOGLE_ADS_TIMEOUT', 408, true);
    this.name = 'GoogleAdsTimeoutError';
  }
}
