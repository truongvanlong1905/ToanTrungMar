import type { IGoogleAdsClient } from './google-ads-client.interface';
import { GoogleAdsMockAdapter } from './google-ads-mock.adapter';
import { GoogleAdsApiAdapter } from './google-ads-api.adapter';
import type { GoogleAdsConnectionInfoDto } from '@toantrung/contracts/02-tracking-sync';

export * from './google-ads.types';
export * from './google-ads-client.interface';
export * from './google-ads-mock.adapter';
export * from './google-ads-api.adapter';
export * from './google-ads.normalizer';

export interface CreateGoogleAdsClientOptions {
  forceMock?: boolean;
  accountPropertyId?: string;
}

export function createGoogleAdsClient(options: CreateGoogleAdsClientOptions = {}): IGoogleAdsClient {
  const provider = (process.env.GOOGLE_ADS_PROVIDER || 'live').trim().toLowerCase();
  const customerId = (process.env.GOOGLE_ADS_CUSTOMER_ID || '').trim();
  const clientId = (process.env.GOOGLE_ADS_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_ADS_CLIENT_SECRET || '').trim();
  const refreshToken = (process.env.GOOGLE_ADS_REFRESH_TOKEN || '').trim();
  const loginCustomerId = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').trim();
  const developerToken = (process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '').trim();
  const apiVersion = (process.env.GOOGLE_ADS_API_VERSION || 'v26').trim();

  // Ưu tiên kết nối trực tiếp LIVE khi có credentials và không bị ép mock
  if (!options.forceMock && (provider === 'live' || (customerId && clientId && clientSecret && refreshToken))) {
    return new GoogleAdsApiAdapter({
      customerId,
      loginCustomerId: loginCustomerId || undefined,
      clientId,
      clientSecret,
      refreshToken,
      developerToken: developerToken || undefined,
      apiVersion,
    });
  }

  return new GoogleAdsMockAdapter(options.accountPropertyId || 'GADS-SYNTH-MOCK-01');
}

export async function checkGoogleAdsConnectionStatus(): Promise<GoogleAdsConnectionInfoDto> {
  const provider = (process.env.GOOGLE_ADS_PROVIDER || 'live').trim().toLowerCase();
  const customerId = (process.env.GOOGLE_ADS_CUSTOMER_ID || '').trim();
  const loginCustomerId = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').trim();
  const clientId = (process.env.GOOGLE_ADS_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_ADS_CLIENT_SECRET || '').trim();
  const refreshToken = (process.env.GOOGLE_ADS_REFRESH_TOKEN || '').trim();
  const apiVersion = (process.env.GOOGLE_ADS_API_VERSION || 'v26').trim();
  const checkedAt = new Date().toISOString();

  if (!customerId || !clientId || !clientSecret || !refreshToken) {
    return {
      provider: 'mock',
      targetCustomerId: customerId || 'Chưa cấu hình',
      loginCustomerId: loginCustomerId || undefined,
      accountPropertyId: customerId ? `gads:${customerId.replace(/-/g, '')}` : 'none',
      apiVersion,
      isConnected: false,
      status: 'CONFIG_MISSING',
      statusLabel: 'Chưa cấu hình Google Ads',
      message: 'Thiếu thông tin Google Ads Client ID, Secret hoặc Refresh Token trong .env.',
      checkedAt,
    };
  }

  const client = new GoogleAdsApiAdapter({
    customerId,
    loginCustomerId: loginCustomerId || undefined,
    clientId,
    clientSecret,
    refreshToken,
    apiVersion,
  });

  const health = await client.getHealthStatus();
  const healthMsg = health.message || '';
  let status: GoogleAdsConnectionInfoDto['status'] = health.ok ? 'CONNECTED' : 'API_ERROR';
  if (!health.ok) {
    if (healthMsg.includes('CUSTOMER_NOT_ENABLED')) {
      status = 'CUSTOMER_NOT_ENABLED';
    } else if (healthMsg.includes('CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION')) {
      status = 'TEST_ACCOUNT_REQUIRED';
    } else if (healthMsg.includes('OAuth') || healthMsg.includes('Token')) {
      status = 'AUTH_ERROR';
    }
  }

  let liveCampaigns: GoogleAdsConnectionInfoDto['liveCampaigns'] = undefined;
  if (health.ok) {
    try {
      liveCampaigns = await client.fetchLiveCampaignList();
    } catch {
      // bỏ qua nếu lỗi
    }
  }

  return {
    provider: 'live',
    targetCustomerId: customerId,
    loginCustomerId: loginCustomerId || undefined,
    accountPropertyId: client.accountPropertyId,
    apiVersion,
    isConnected: health.ok,
    status,
    statusLabel: health.ok
      ? 'Đã kết nối trực tiếp (Live)'
      : status === 'CUSTOMER_NOT_ENABLED'
        ? 'Kết nối trực tiếp (Cần kích hoạt tài khoản)'
        : 'Lỗi kết nối trực tiếp',
    message: healthMsg || (health.ok ? 'Kết nối thành công.' : 'Kết nối thất bại.'),
    liveCampaigns,
    checkedAt,
  };
}

