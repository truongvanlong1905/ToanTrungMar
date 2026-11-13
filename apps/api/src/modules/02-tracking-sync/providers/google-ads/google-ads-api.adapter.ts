import type { IGoogleAdsClient, GoogleAdsHealthCheckResult } from './google-ads-client.interface';
import {
  type GoogleAdsCampaignMetricRow,
  type GoogleAdsKeywordMetricRow,
  type GoogleAdsSyncWindow,
  type GoogleAdsSyncOptions,
  GoogleAdsError,
  GoogleAdsAuthError,
  GoogleAdsRateLimitError,
  GoogleAdsTimeoutError,
} from './google-ads.types';

export interface GoogleAdsApiConfig {
  customerId: string; // 10 digits
  loginCustomerId?: string; // MCC ID
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  developerToken?: string;
  apiVersion?: string; // default: 'v26'
}

export function parseGoogleAdsApiError(rawErrorText: string): { code: string; message: string } {
  try {
    const parsed = JSON.parse(rawErrorText);
    const item = Array.isArray(parsed) ? parsed[0] : parsed;
    const firstDetail = item?.error?.details?.[0] || item?.details?.[0];
    const firstError = firstDetail?.errors?.[0];
    if (firstError) {
      const errorCategory = Object.keys(firstError.errorCode || {})[0];
      const specificCode = errorCategory ? firstError.errorCode[errorCategory] : 'UNKNOWN_ERROR';
      const rawMsg = firstError.message || item?.error?.message || 'Lỗi không xác định từ Google Ads API';

      if (specificCode === 'CUSTOMER_NOT_ENABLED') {
        return {
          code: 'CUSTOMER_NOT_ENABLED',
          message: `Tài khoản Google Ads chưa được kích hoạt hoặc đã bị vô hiệu hóa trên Google Console (${rawMsg}).`,
        };
      }
      if (specificCode === 'CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION') {
        return {
          code: 'CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION',
          message: `Google Cloud Project chỉ cho phép truy cập tài khoản Test Account. Cần đăng ký quyền Explorer/Standard Access (${rawMsg}).`,
        };
      }
      return {
        code: specificCode,
        message: `${specificCode}: ${rawMsg}`,
      };
    }
    if (item?.error?.message) {
      return { code: item.error.status || 'GOOGLE_ERROR', message: item.error.message };
    }
  } catch {
    // Không phải JSON
  }
  return { code: 'RAW_ERROR', message: rawErrorText.slice(0, 300) };
}

export class GoogleAdsApiAdapter implements IGoogleAdsClient {
  public readonly accountPropertyId: string;
  public readonly isMock = false;
  private readonly config: GoogleAdsApiConfig;
  private cachedAccessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(config: GoogleAdsApiConfig) {
    this.config = {
      ...config,
      customerId: config.customerId.replace(/-/g, '').trim(),
      loginCustomerId: config.loginCustomerId ? config.loginCustomerId.replace(/-/g, '').trim() : undefined,
      developerToken: config.developerToken || process.env.GOOGLE_ADS_DEVELOPER_TOKEN || 'developer-token',
      apiVersion: config.apiVersion || process.env.GOOGLE_ADS_API_VERSION || 'v26',
    };
    this.accountPropertyId = `gads:${this.config.customerId}`;
  }

  public async getHealthStatus(): Promise<GoogleAdsHealthCheckResult> {
    try {
      const token = await this.getValidAccessToken();
      const pingUrl = `https://googleads.googleapis.com/${this.config.apiVersion}/customers:listAccessibleCustomers`;
      const pingResp = await fetch(pingUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'developer-token': this.config.developerToken || 'developer-token',
        },
      });

      if (!pingResp.ok) {
        const errText = await pingResp.text();
        const parsed = parseGoogleAdsApiError(errText);
        return {
          ok: false,
          provider: 'live',
          accountPropertyId: this.accountPropertyId,
          message: `Kết nối Google Ads thất bại: ${parsed.message}`,
        };
      }

      // Ping customer cụ thể
      const query = 'SELECT customer.id, customer.status FROM customer LIMIT 1';
      const checkResp = await fetch(
        `https://googleads.googleapis.com/${this.config.apiVersion}/customers/${this.config.customerId}/googleAds:searchStream`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'developer-token': this.config.developerToken || 'developer-token',
            ...(this.config.loginCustomerId ? { 'login-customer-id': this.config.loginCustomerId } : {}),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query }),
        },
      );

      if (checkResp.ok) {
        return {
          ok: true,
          provider: 'live',
          accountPropertyId: this.accountPropertyId,
          accessLevel: 'Live Verified',
          message: `Đã kết nối trực tiếp tài khoản Google Ads ${this.config.customerId} thành công.`,
        };
      }

      const checkErrText = await checkResp.text();
      const checkParsed = parseGoogleAdsApiError(checkErrText);
      return {
        ok: false,
        provider: 'live',
        accountPropertyId: this.accountPropertyId,
        message: `Tài khoản ${this.config.customerId}: ${checkParsed.message}`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        provider: 'live',
        accountPropertyId: this.accountPropertyId,
        message: `Kết nối Google Ads API thất bại: ${msg}`,
      };
    }
  }

  private async getValidAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedAccessToken && this.tokenExpiresAt > now + 60_000) {
      return this.cachedAccessToken;
    }

    if (!this.config.clientId || !this.config.clientSecret || !this.config.refreshToken) {
      throw new GoogleAdsAuthError(
        'Thiếu thông tin Google Ads OAuth Credential (Client ID, Client Secret hoặc Refresh Token).',
      );
    }

    try {
      const resp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          refresh_token: this.config.refreshToken,
          grant_type: 'refresh_token',
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new GoogleAdsAuthError(`Không thể làm mới Google Access Token (HTTP ${resp.status}): ${errText}`);
      }

      const data = (await resp.json()) as { access_token: string; expires_in: number };
      this.cachedAccessToken = data.access_token;
      this.tokenExpiresAt = now + (data.expires_in || 3600) * 1000;
      return this.cachedAccessToken;
    } catch (err: unknown) {
      if (err instanceof GoogleAdsError) throw err;
      throw new GoogleAdsAuthError(`Lỗi kết nối OAuth Google: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async executeGaqlStream(query: string, timeoutMs = 30000): Promise<any[]> {
    const accessToken = await this.getValidAccessToken();
    const url = `https://googleads.googleapis.com/${this.config.apiVersion}/customers/${this.config.customerId}/googleAds:searchStream`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': this.config.developerToken || 'developer-token',
      'Content-Type': 'application/json',
    };
    if (this.config.loginCustomerId) {
      headers['login-customer-id'] = this.config.loginCustomerId;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const errorText = await resp.text();
        const parsed = parseGoogleAdsApiError(errorText);
        if (resp.status === 401 || resp.status === 403) {
          throw new GoogleAdsAuthError(
            `Google Ads API từ chối truy cập tài khoản ${this.config.customerId} (HTTP ${resp.status}): ${parsed.message}`,
          );
        }
        if (resp.status === 429) {
          throw new GoogleAdsRateLimitError(
            `Google Ads API báo vượt hạn mức Quota/Rate Limit: ${parsed.message}`,
          );
        }
        throw new GoogleAdsError(
          `Google Ads API trả về lỗi HTTP ${resp.status}: ${parsed.message}`,
          parsed.code,
          resp.status,
          resp.status >= 500,
        );
      }

      const streamChunks = (await resp.json()) as Array<{ results?: any[] }>;
      const allRows: any[] = [];
      for (const chunk of streamChunks) {
        if (Array.isArray(chunk.results)) {
          allRows.push(...chunk.results);
        }
      }
      return allRows;
    } catch (err: unknown) {
      if (err instanceof GoogleAdsError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new GoogleAdsTimeoutError(`Google Ads API quá thời gian chờ (${timeoutMs}ms).`);
      }
      throw new GoogleAdsError(
        `Lỗi gọi Google Ads API: ${err instanceof Error ? err.message : String(err)}`,
        'GOOGLE_ADS_CALL_FAILED',
        undefined,
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  public async fetchCampaignMetrics(
    window: GoogleAdsSyncWindow,
    _options?: GoogleAdsSyncOptions,
  ): Promise<GoogleAdsCampaignMetricRow[]> {
    const gaql = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        segments.date,
        metrics.cost_micros,
        campaign_budget.amount_micros,
        metrics.average_cpc,
        metrics.impressions,
        metrics.clicks,
        metrics.conversions,
        customer.currency_code
      FROM campaign
      WHERE segments.date BETWEEN '${window.startDate}' AND '${window.endDate}'
        AND campaign.status != 'REMOVED'
      ORDER BY segments.date DESC
    `.trim();

    const rawRows = await this.executeGaqlStream(gaql);
    return rawRows.map((r) => {
      const c = r.campaign || {};
      const seg = r.segments || {};
      const m = r.metrics || {};
      const b = r.campaignBudget || {};
      const cust = r.customer || {};

      return {
        campaignId: String(c.id || ''),
        campaignName: String(c.name || ''),
        campaignStatus: (c.status as 'ENABLED' | 'PAUSED' | 'REMOVED') || 'ENABLED',
        date: String(seg.date || ''),
        costMicros: String(m.costMicros || '0'),
        dailyBudgetMicros: b.amountMicros ? String(b.amountMicros) : null,
        averageCpcMicros: m.averageCpc ? String(Math.round(Number(m.averageCpc))) : null,
        impressions: Number(m.impressions || 0),
        clicks: Number(m.clicks || 0),
        conversions: Number(m.conversions || 0),
        currencyCode: String(cust.currencyCode || 'VND'),
      };
    });
  }

  public async fetchKeywordMetrics(
    window: GoogleAdsSyncWindow,
    _options?: GoogleAdsSyncOptions,
  ): Promise<GoogleAdsKeywordMetricRow[]> {
    const gaql = `
      SELECT
        campaign.id,
        campaign.name,
        ad_group_criterion.criterion_id,
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        segments.date,
        metrics.cost_micros,
        metrics.average_cpc,
        metrics.impressions,
        metrics.clicks,
        metrics.conversions,
        customer.currency_code
      FROM keyword_view
      WHERE segments.date BETWEEN '${window.startDate}' AND '${window.endDate}'
        AND campaign.status != 'REMOVED'
      ORDER BY segments.date DESC
    `.trim();

    const rawRows = await this.executeGaqlStream(gaql);
    return rawRows.map((r) => {
      const c = r.campaign || {};
      const crit = r.adGroupCriterion || {};
      const kw = crit.keyword || {};
      const seg = r.segments || {};
      const m = r.metrics || {};
      const cust = r.customer || {};

      return {
        campaignId: String(c.id || ''),
        campaignName: String(c.name || ''),
        criterionId: String(crit.criterionId || ''),
        keywordText: String(kw.text || ''),
        matchType: (kw.matchType as 'EXACT' | 'PHRASE' | 'BROAD') || 'PHRASE',
        date: String(seg.date || ''),
        costMicros: String(m.costMicros || '0'),
        averageCpcMicros: m.averageCpc ? String(Math.round(Number(m.averageCpc))) : null,
        impressions: Number(m.impressions || 0),
        clicks: Number(m.clicks || 0),
        conversions: Number(m.conversions || 0),
        currencyCode: String(cust.currencyCode || 'VND'),
      };
    });
  }

  public async fetchLiveCampaignList(): Promise<Array<{
    id: string;
    name: string;
    status: string;
    dailyBudgetMicros: string;
    dailyBudgetVnd: number;
    costMicros: string;
    costVnd: number;
    clicks: number;
    impressions: number;
    conversions: number;
    currencyCode: string;
  }>> {
    const gaql = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign_budget.amount_micros,
        metrics.cost_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.conversions,
        customer.currency_code
      FROM campaign
      WHERE campaign.status != 'REMOVED'
      ORDER BY campaign.name ASC
    `.trim();

    try {
      const rawRows = await this.executeGaqlStream(gaql);
      return rawRows.map((r) => {
        const c = r.campaign || {};
        const b = r.campaignBudget || {};
        const m = r.metrics || {};
        const cust = r.customer || {};
        const budgetMicrosStr = String(b.amountMicros || '0');
        const costMicrosStr = String(m.costMicros || '0');
        let budgetVnd = 0;
        let costVnd = 0;
        try {
          budgetVnd = Math.round(Number(BigInt(budgetMicrosStr) / 1_000_000n));
          costVnd = Math.round(Number(BigInt(costMicrosStr) / 1_000_000n));
        } catch {
          // fallback
        }

        return {
          id: String(c.id || ''),
          name: String(c.name || `Chiến dịch ${c.id}`),
          status: String(c.status || 'ENABLED'),
          dailyBudgetMicros: budgetMicrosStr,
          dailyBudgetVnd: budgetVnd,
          costMicros: costMicrosStr,
          costVnd: costVnd,
          clicks: Number(m.clicks || 0),
          impressions: Number(m.impressions || 0),
          conversions: Number(m.conversions || 0),
          currencyCode: String(cust.currencyCode || 'VND'),
        };
      });
    } catch {
      return [];
    }
  }
}
