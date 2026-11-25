import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { prisma, upsertPlatformMetricIdempotent } from '@toantrung/database';
import type {
  GoogleOAuthStatusDto,
  GoogleOAuthClientConfigDto,
  GoogleAccessibleResourceItem,
  GoogleTestConnectionResultDto,
  SelectGoogleResourcesDto,
} from '@toantrung/contracts';
import { encryptSecret, decryptSecret, maskSecret } from '../../core/security/vault';
import { getSessionSecret } from '../../core/config';
import { safeSecretEquals } from '../../core/http';
import { getCanonicalDateRange, countInclusiveCalendarDays } from '../../core/reporting-dates';
import { bumpDomainRevisions } from '../../core/cache/server-data-cache';
import { invalidateConfiguredWebsitesCache } from '../../core/website-catalog';
import { invalidateGa4LiveCaches } from './ga4-live-cache.service';
import { retryUnresolvedGclids } from './service';
import { refreshKeywordDerivedCacheFromCanonicalMetrics } from '../03-keywords-ads/service';

interface StoredGoogleConnection {
  connected: boolean;
  connectedEmail: string | null;
  connectedName: string | null;
  connectedPicture: string | null;
  connectedAt: string | null;
  scopes: string[];
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: string | null;
  isSandboxDemo?: boolean;
  lastSyncAt: string | null;
  detectedGa4PropertyId?: string | null;
  detectedGadsCustomerId?: string | null;
  selectedGa4PropertyId?: string | null;
  selectedGadsCustomerId?: string | null;
  selectedGscSiteUrl?: string | null;
  lastSuccessfulSyncAt?: string | null;
  lastAttemptAt?: string | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  lastRequestId?: string | null;
  connectionStatus?: 'CONNECTED' | 'EXPIRED' | 'PERMISSION_ERROR' | 'SYNC_ERROR' | 'DISCONNECTED';
  accessibleResources?: GoogleAccessibleResourceItem[];
}

interface StoredClientConfig {
  clientId: string;
  clientSecret: string;
}

export interface StoredGoogleAdsApiConfig {
  developerToken: string | null;
  customerId: string | null;
  loginCustomerId: string | null;
}

export interface GoogleAdsApiConfigDto {
  hasDeveloperToken: boolean;
  developerTokenMasked: string | null;
  customerId: string | null;
  loginCustomerId: string | null;
  oauthDirectSupported?: boolean;
}

const SETTING_KEY_CONNECTION = 'google_oauth_connection';
const SETTING_KEY_CLIENT_CONFIG = 'google_oauth_client_config';
const SETTING_KEY_ADS_CONFIG = 'google_ads_api_config_v1';
const SETTING_KEY_GADS_FINAL_URLS = 'google_ads_campaign_final_urls_v1';

interface StoredCampaignFinalUrlsPayload {
  updatedAt: string;
  byCampaignId: Record<string, string[]>;
}

const globalGadsFinalUrls = globalThis as unknown as {
  __toantrungGadsFinalUrlsCache?: {
    hydrated: boolean;
    updatedAtMs: number;
    byCampaignId: Record<string, string[]>;
  };
  __toantrungGadsFinalUrlsInFlight?: Promise<Record<string, string[]>> | null;
};

function getFinalUrlsMemCache() {
  if (!globalGadsFinalUrls.__toantrungGadsFinalUrlsCache) {
    globalGadsFinalUrls.__toantrungGadsFinalUrlsCache = {
      hydrated: false,
      updatedAtMs: 0,
      byCampaignId: {},
    };
  }
  return globalGadsFinalUrls.__toantrungGadsFinalUrlsCache;
}

async function mergeAndPersistCampaignFinalUrls(
  freshMap: Map<string, string[]> | Record<string, string[]>,
): Promise<Record<string, string[]>> {
  const mem = getFinalUrlsMemCache();
  let existing: Record<string, string[]> = { ...mem.byCampaignId };
  try {
    const row = await prisma.systemSetting.findUnique({
      where: { key: SETTING_KEY_GADS_FINAL_URLS },
    });
    if (row?.value) {
      const parsed = JSON.parse(row.value) as StoredCampaignFinalUrlsPayload;
      if (parsed?.byCampaignId && typeof parsed.byCampaignId === 'object') {
        existing = { ...parsed.byCampaignId, ...existing };
      }
    }
  } catch {
    // ignore corrupt setting
  }

  const entries =
    freshMap instanceof Map ? Array.from(freshMap.entries()) : Object.entries(freshMap);
  const merged: Record<string, string[]> = { ...existing };
  for (const [cid, urls] of entries) {
    if (!cid || !Array.isArray(urls) || urls.length === 0) continue;
    const clean = urls.map((u) => String(u).trim()).filter(Boolean);
    if (clean.length > 0) {
      merged[cid] = Array.from(new Set(clean)).slice(0, 12);
    }
  }

  const nowIso = new Date().toISOString();
  const payload: StoredCampaignFinalUrlsPayload = {
    updatedAt: nowIso,
    byCampaignId: merged,
  };
  mem.hydrated = true;
  mem.updatedAtMs = Date.now();
  mem.byCampaignId = merged;

  await prisma.systemSetting
    .upsert({
      where: { key: SETTING_KEY_GADS_FINAL_URLS },
      update: { value: JSON.stringify(payload) },
      create: { key: SETTING_KEY_GADS_FINAL_URLS, value: JSON.stringify(payload) },
    })
    .catch(() => null);

  return merged;
}

function getRealtimeConfigPath(): string {
  const dir = path.join(process.cwd(), 'config');
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // ignore
    }
  }
  return path.join(dir, 'google-realtime-config.json');
}

function syncToLegacyFile(conn: StoredGoogleConnection | null) {
  try {
    const p = getRealtimeConfigPath();
    let current: Record<string, unknown> = {};
    if (fs.existsSync(p)) {
      try {
        current = JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch {
        // ignore
      }
    }
    if (conn && conn.connected) {
      // Never store real plaintext bearer tokens in plain json config file
      current.ga4AccessToken = conn.isSandboxDemo ? 'DEMO_SANDBOX_TOKEN' : 'VAULT_PROTECTED_TOKEN';
      current.ga4PropertyId = conn.selectedGa4PropertyId || conn.detectedGa4PropertyId || '';
      current.gadsCustomerId = conn.selectedGadsCustomerId || conn.detectedGadsCustomerId || '';
      current.autoRealtimeEnabled = true;
      current.lastRealtimeSyncAt = conn.lastSyncAt || new Date().toISOString();
      if (!conn.isSandboxDemo) {
        // Clear any residual sandbox fake realtime counters
        if (current.lastActiveUsers30m === 34) {
          current.lastActiveUsers30m = 0;
          current.lastActivePages = [];
          current.lastActiveEvents = [];
        }
      }
    } else {
      current.ga4AccessToken = '';
      current.lastActiveUsers30m = 0;
      current.lastActivePages = [];
      current.lastActiveEvents = [];
    }
    fs.writeFileSync(p, JSON.stringify(current, null, 2), 'utf8');
  } catch {
    // ignore
  }
}

const globalOAuthHelpers = globalThis as typeof globalThis & {
  __toantrungEnvClientCache?: StoredClientConfig | null;
  __toantrungEnvClientLoaded?: boolean;
  __toantrungTokenRefreshInFlight?: Promise<string | null> | null;
  __toantrungOAuthKeepAliveStarted?: boolean;
};

export async function getGoogleClientConfig(): Promise<StoredClientConfig | null> {
  // 1. Prioritize environment variables (.env) so user can paste privately in local file
  let envClientId = (process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_ADS_CLIENT_ID || '')
    .trim()
    .replace(/^["']+|["']+$/g, '');
  let envClientSecret = (process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_ADS_CLIENT_SECRET || '')
    .trim()
    .replace(/^["']+|["']+$/g, '');

  if (!envClientId || !envClientSecret) {
    if (!globalOAuthHelpers.__toantrungEnvClientLoaded) {
      globalOAuthHelpers.__toantrungEnvClientLoaded = true;
      const envCandidates = [
        path.resolve(process.cwd(), '.env'),
        path.resolve(process.cwd(), '..', '..', '.env'),
      ];
      for (const envPath of envCandidates) {
        try {
          if (fs.existsSync(envPath)) {
            const content = fs.readFileSync(envPath, 'utf8');
            for (const line of content.split(/\r?\n/)) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith('#')) continue;
              const eqIdx = trimmed.indexOf('=');
              if (eqIdx <= 0) continue;
              const k = trimmed.slice(0, eqIdx).trim();
              const v = trimmed.slice(eqIdx + 1).trim().replace(/^["']+|["']+$/g, '');
              if ((k === 'GOOGLE_CLIENT_ID' || k === 'GOOGLE_ADS_CLIENT_ID') && v && !envClientId) {
                envClientId = v;
              }
              if ((k === 'GOOGLE_CLIENT_SECRET' || k === 'GOOGLE_ADS_CLIENT_SECRET') && v && !envClientSecret) {
                envClientSecret = v;
              }
            }
          }
        } catch {
          // ignore
        }
      }
      if (envClientId && envClientSecret) {
        globalOAuthHelpers.__toantrungEnvClientCache = { clientId: envClientId, clientSecret: envClientSecret };
      }
    } else if (globalOAuthHelpers.__toantrungEnvClientCache) {
      envClientId = globalOAuthHelpers.__toantrungEnvClientCache.clientId;
      envClientSecret = globalOAuthHelpers.__toantrungEnvClientCache.clientSecret;
    }
  }

  if (envClientId && envClientSecret) {
    return { clientId: envClientId, clientSecret: envClientSecret };
  }

  // 2. Check local encrypted database table
  try {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: SETTING_KEY_CLIENT_CONFIG },
    });
    if (setting?.value) {
      const parsed = JSON.parse(setting.value) as StoredClientConfig;
      const plainId = decryptSecret(parsed.clientId);
      const plainSecret = decryptSecret(parsed.clientSecret);
      if (plainId && plainSecret) {
        return { clientId: plainId, clientSecret: plainSecret };
      }
    }
  } catch {
    // ignore
  }

  return null;
}

export async function saveGoogleClientConfig(input: { clientId: string; clientSecret: string }) {
  const cleanId = input.clientId.trim();
  const cleanSecret = input.clientSecret.trim();
  // Encrypt with AES-256-GCM before writing to database
  const cipherPayload = JSON.stringify({
    clientId: encryptSecret(cleanId),
    clientSecret: encryptSecret(cleanSecret),
  });
  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEY_CLIENT_CONFIG },
    update: { value: cipherPayload },
    create: {
      key: SETTING_KEY_CLIENT_CONFIG,
      value: cipherPayload,
    },
  });
}

export async function getGoogleClientConfigDto(): Promise<GoogleOAuthClientConfigDto> {
  const cfg = await getGoogleClientConfig();
  if (!cfg) {
    return {
      hasClientId: false,
      clientIdMasked: null,
      hasClientSecret: false,
    };
  }
  return {
    hasClientId: true,
    clientIdMasked: maskSecret(cfg.clientId),
    hasClientSecret: Boolean(cfg.clientSecret),
  };
}

function normalizeDigitsId(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '').trim();
  return digits.length > 0 ? digits : null;
}

export async function getGoogleAdsApiConfig(): Promise<StoredGoogleAdsApiConfig | null> {
  // 1. Check encrypted DB setting first (so UI-saved config takes effect immediately without restart)
  let dbCustomerId: string | null = null;
  let dbLoginCustomerId: string | null = null;
  try {
    const row = await prisma.systemSetting.findUnique({
      where: { key: SETTING_KEY_ADS_CONFIG },
    });
    if (row?.value) {
      const parsed = JSON.parse(row.value) as {
        developerToken?: string | null;
        customerId?: string | null;
        loginCustomerId?: string | null;
      };
      const plainToken = parsed.developerToken ? decryptSecret(parsed.developerToken).trim() : '';
      dbCustomerId = normalizeDigitsId(parsed.customerId) || normalizeDigitsId(process.env.GOOGLE_ADS_CUSTOMER_ID);
      dbLoginCustomerId =
        normalizeDigitsId(parsed.loginCustomerId) || normalizeDigitsId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);

      if (plainToken || dbCustomerId || dbLoginCustomerId) {
        return {
          developerToken: plainToken || null,
          customerId: dbCustomerId,
          loginCustomerId: dbLoginCustomerId,
        };
      }
    }
  } catch {
    // ignore
  }

  // 2. Fallback to environment variables
  const envToken = (process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '').trim().replace(/^["']+|["']+$/g, '');
  const envCust = normalizeDigitsId(process.env.GOOGLE_ADS_CUSTOMER_ID);
  const envMcc = normalizeDigitsId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
  if (envToken || envCust || envMcc) {
    return {
      developerToken: envToken || null,
      customerId: envCust,
      loginCustomerId: envMcc,
    };
  }

  return null;
}

export async function saveGoogleAdsApiConfig(input: {
  developerToken?: string | null;
  customerId?: string | null;
  loginCustomerId?: string | null;
}): Promise<void> {
  const existing = await getGoogleAdsApiConfig();
  const rawInputToken = typeof input.developerToken === 'string' ? input.developerToken.trim() : '';
  const finalToken = rawInputToken || existing?.developerToken || null;
  const cleanCust = normalizeDigitsId(input.customerId);
  const cleanMcc = normalizeDigitsId(input.loginCustomerId);

  const payload = JSON.stringify({
    developerToken: finalToken ? encryptSecret(finalToken) : null,
    customerId: cleanCust,
    loginCustomerId: cleanMcc,
  });

  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEY_ADS_CONFIG },
    update: { value: payload },
    create: { key: SETTING_KEY_ADS_CONFIG, value: payload },
  });

  if (cleanCust) {
    const conn = await getGoogleConnection();
    if (conn) {
      conn.selectedGadsCustomerId = cleanCust;
      await saveGoogleConnection(conn);
    }
  }
}

export async function getGoogleAdsApiConfigDto(): Promise<GoogleAdsApiConfigDto> {
  const cfg = await getGoogleAdsApiConfig();
  const conn = await getGoogleConnection();
  const resolvedCustomerId =
    cfg?.customerId ||
    normalizeDigitsId(conn?.selectedGadsCustomerId) ||
    normalizeDigitsId(conn?.detectedGadsCustomerId) ||
    normalizeDigitsId(process.env.GOOGLE_ADS_CUSTOMER_ID);

  return {
    hasDeveloperToken: Boolean(cfg?.developerToken),
    developerTokenMasked: cfg?.developerToken ? maskSecret(cfg.developerToken) : null,
    customerId: resolvedCustomerId,
    loginCustomerId: cfg?.loginCustomerId || normalizeDigitsId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID),
    oauthDirectSupported: true,
  };
}

export async function getGoogleConnection(): Promise<StoredGoogleConnection | null> {
  try {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: SETTING_KEY_CONNECTION },
    });
    if (setting?.value) {
      const parsed = JSON.parse(setting.value) as StoredGoogleConnection;
      return {
        ...parsed,
        accessToken: parsed.accessToken ? decryptSecret(parsed.accessToken) : null,
        refreshToken: parsed.refreshToken ? decryptSecret(parsed.refreshToken) : null,
      };
    }
  } catch {
    // ignore
  }
  return null;
}

export async function saveGoogleConnection(conn: StoredGoogleConnection | null) {
  if (!conn) {
    await prisma.systemSetting.deleteMany({
      where: { key: SETTING_KEY_CONNECTION },
    });
    syncToLegacyFile(null);
    return;
  }

  // Encrypt all OAuth tokens at rest with AES-256-GCM before writing to database
  const cipherConn: StoredGoogleConnection = {
    ...conn,
    accessToken: conn.accessToken ? encryptSecret(conn.accessToken) : null,
    refreshToken: conn.refreshToken ? encryptSecret(conn.refreshToken) : null,
  };

  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEY_CONNECTION },
    update: { value: JSON.stringify(cipherConn) },
    create: { key: SETTING_KEY_CONNECTION, value: JSON.stringify(cipherConn) },
  });
  syncToLegacyFile(conn);
}

export async function getGoogleOAuthStatusDto(): Promise<GoogleOAuthStatusDto> {
  const conn = await getGoogleConnection();
  if (!conn || !conn.connected) {
    return {
      connected: false,
      connectedEmail: null,
      connectedName: null,
      connectedPicture: null,
      connectedAt: null,
      scopes: [],
      hasRefreshToken: false,
      expiresAt: null,
      isSandboxDemo: false,
      autoSyncSlots: ['02:00', '11:00', '17:00'],
      lastSyncAt: null,
      lastSuccessfulSyncAt: null,
      lastAttemptAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      lastRequestId: null,
      connectionStatus: 'DISCONNECTED',
      detectedGa4PropertyId: null,
      detectedGadsCustomerId: null,
      selectedGa4PropertyId: null,
      selectedGadsCustomerId: null,
      selectedGscSiteUrl: null,
      accessibleResources: [],
    };
  }

  // Check expiration
  let status = conn.connectionStatus || 'CONNECTED';
  const now = Date.now();
  const exp = conn.expiresAt ? new Date(conn.expiresAt).getTime() : 0;
  if (exp > 0 && exp <= now && !conn.refreshToken) {
    status = 'EXPIRED';
  }

  return {
    connected: true,
    connectedEmail: conn.connectedEmail,
    connectedName: conn.connectedName,
    connectedPicture: conn.connectedPicture,
    connectedAt: conn.connectedAt,
    scopes: conn.scopes || [],
    hasRefreshToken: Boolean(conn.refreshToken),
    expiresAt: conn.expiresAt,
    isSandboxDemo: Boolean(conn.isSandboxDemo),
    autoSyncSlots: ['02:00', '11:00', '17:00'],
    lastSyncAt: conn.lastSyncAt,
    lastSuccessfulSyncAt: conn.lastSuccessfulSyncAt || conn.lastSyncAt,
    lastAttemptAt: conn.lastAttemptAt || conn.lastSyncAt,
    lastErrorCode: conn.lastErrorCode || null,
    lastErrorMessage: conn.lastErrorMessage || null,
    lastRequestId: conn.lastRequestId || null,
    connectionStatus: status,
    detectedGa4PropertyId: conn.detectedGa4PropertyId || null,
    detectedGadsCustomerId: conn.detectedGadsCustomerId || null,
    selectedGa4PropertyId: conn.selectedGa4PropertyId || conn.detectedGa4PropertyId || null,
    selectedGadsCustomerId: conn.selectedGadsCustomerId || conn.detectedGadsCustomerId || null,
    selectedGscSiteUrl: conn.selectedGscSiteUrl || null,
    accessibleResources: conn.accessibleResources || [],
  };
}

export async function testGoogleConnection(): Promise<GoogleTestConnectionResultDto> {
  const token = await getValidAccessToken();
  const conn = await getGoogleConnection();
  const nowStr = new Date().toISOString();
  const requestId = crypto.randomUUID();

  if (!conn || !conn.connected || !token) {
    return {
      success: false,
      checkedAt: nowStr,
      connectionStatus: 'DISCONNECTED',
      userEmail: conn?.connectedEmail || 'Chưa kết nối',
      canAccessGa4: false,
      ga4PropertiesCount: 0,
      canAccessSearchConsole: false,
      gscSitesCount: 0,
      canAccessGoogleAds: false,
      adsAccessibleCustomersCount: 0,
      accessibleResources: [],
      message: 'Chưa có kết nối Google OAuth 2.0 hoặc mã truy cập đã hết hạn.',
    };
  }

  const accessibleResources: GoogleAccessibleResourceItem[] = [];
  let canAccessGa4 = false;
  let canAccessGsc = false;
  let canAccessAds = false;
  let ga4PropertiesCount = 0;
  let gscSitesCount = 0;
  let adsCustomersCount = 0;

  // 1. Probe GA4 Admin API
  try {
    const resAdmin = await fetch('https://analyticsadmin.googleapis.com/v1beta/accountSummaries', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resAdmin.ok) {
      canAccessGa4 = true;
      const adminData = (await resAdmin.json()) as {
        accountSummaries?: Array<{
          displayName?: string;
          propertySummaries?: Array<{
            property: string;
            displayName: string;
          }>;
        }>;
      };
      for (const acc of adminData.accountSummaries || []) {
        for (const p of acc.propertySummaries || []) {
          const propId = p.property.replace('properties/', '');
          ga4PropertiesCount++;
          accessibleResources.push({
            id: propId,
            name: `${p.displayName} (${propId})`,
            type: 'GA4_PROPERTY',
            permissionLevel: 'Viewer (Read-Only)',
            isAccessible: true,
          });
        }
      }
    }
  } catch {
    // non-fatal
  }

  // 2. Probe Google Search Console Sites API
  try {
    const resSC = await fetch('https://www.googleapis.com/webmasters/v3/sites', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resSC.ok) {
      canAccessGsc = true;
      const scData = (await resSC.json()) as {
        siteEntry?: Array<{ siteUrl: string; permissionLevel?: string }>;
      };
      for (const site of scData.siteEntry || []) {
        gscSitesCount++;
        accessibleResources.push({
          id: site.siteUrl,
          name: site.siteUrl,
          type: 'SEARCH_CONSOLE_SITE',
          permissionLevel: site.permissionLevel || 'siteRestrictedUser (Read-Only)',
          isAccessible: true,
        });
      }
    }
  } catch {
    // non-fatal
  }

  // 3. Probe Google Ads Accessible Customers (Google Ads v26 supports OAuth directly; developer-token optional)
  try {
    const adsCfg = await getGoogleAdsApiConfig();
    const adsHeaders: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };
    if (adsCfg?.developerToken) {
      adsHeaders['developer-token'] = adsCfg.developerToken;
    }
    if (adsCfg?.loginCustomerId) {
      adsHeaders['login-customer-id'] = adsCfg.loginCustomerId;
    }

    let resAds: Response | null = null;
    for (const apiVer of ['v26', 'v25', 'v24']) {
      resAds = await fetch(`https://googleads.googleapis.com/${apiVer}/customers:listAccessibleCustomers`, {
        headers: adsHeaders,
      });
      if (resAds.status !== 404) break;
    }

    if (resAds?.ok) {
      canAccessAds = true;
      const adsData = (await resAds.json()) as { resourceNames?: string[] };
      for (const resName of adsData.resourceNames || []) {
        const custId = resName.replace('customers/', '').replace(/\D/g, '');
        if (!custId) continue;
        adsCustomersCount++;
        if (!conn.detectedGadsCustomerId) {
          conn.detectedGadsCustomerId = custId;
        }
        if (!conn.selectedGadsCustomerId) {
          conn.selectedGadsCustomerId = custId;
        }
        let customerLabel = `Tài khoản Google Ads ${custId}`;
        try {
          const infoRes = await fetchGoogleAdsWithFallback(`customers/${custId}/googleAds:search`, {
            method: 'POST',
            headers: {
              ...adsHeaders,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              query:
                'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.test_account FROM customer LIMIT 1',
            }),
          });
          if (infoRes.ok) {
            const infoJson = (await infoRes.json()) as {
              results?: Array<{
                customer?: { descriptiveName?: string; currencyCode?: string };
              }>;
            };
            const cInfo = infoJson.results?.[0]?.customer;
            const dName = (cInfo?.descriptiveName || '').trim();
            const cCode = (cInfo?.currencyCode || '').trim();
            if (dName) {
              customerLabel = `${dName} (${custId}${cCode ? ` · ${cCode}` : ''})`;
            } else if (cCode) {
              customerLabel = `Tài khoản Google Ads ${custId} · ${cCode}`;
            }
          }
        } catch {
          // non-fatal fallback to default customer label
        }
        accessibleResources.push({
          id: custId,
          name: customerLabel,
          type: 'GOOGLE_ADS_CUSTOMER',
          permissionLevel: 'Viewer (Read-Only)',
          isAccessible: true,
        });
      }
    }
  } catch {
    // non-fatal
  }

  // Update connection audit fields
  conn.lastAttemptAt = nowStr;
  conn.lastRequestId = requestId;
  conn.accessibleResources = accessibleResources.length > 0 ? accessibleResources : conn.accessibleResources;

  const isHealthy = canAccessGa4 && canAccessGsc;
  conn.connectionStatus = isHealthy ? 'CONNECTED' : canAccessGa4 || canAccessGsc ? 'CONNECTED' : 'PERMISSION_ERROR';
  if (isHealthy) {
    conn.lastErrorCode = null;
    conn.lastErrorMessage = null;
  }

  await saveGoogleConnection(conn);
  invalidateConfiguredWebsitesCache();
  invalidateGa4LiveCaches();
  bumpDomainRevisions(['websites', 'tracking', 'ads', 'reports'], 'google_test_connection');

  return {
    success: isHealthy,
    checkedAt: nowStr,
    connectionStatus: conn.connectionStatus,
    userEmail: conn.connectedEmail || 'connected-user@google.com',
    userName: conn.connectedName,
    canAccessGa4,
    ga4PropertiesCount,
    canAccessSearchConsole: canAccessGsc,
    gscSitesCount,
    canAccessGoogleAds: canAccessAds,
    adsAccessibleCustomersCount: adsCustomersCount,
    accessibleResources: conn.accessibleResources || accessibleResources,
    message: isHealthy
      ? `Kiểm tra kết nối thành công! Đã xác thực quyền xem (Viewer / Read-only) đối với ${ga4PropertiesCount} website GA4, ${gscSitesCount} website Search Console${canAccessAds ? ` và ${adsCustomersCount} tài khoản Google Ads (${conn.selectedGadsCustomerId || conn.detectedGadsCustomerId})` : ''}.`
      : `Đã kết nối tài khoản nhưng một số dịch vụ cần kiểm tra quyền truy cập.`,
  };
}

export async function saveSelectedResources(input: {
  selectedGa4PropertyId?: string | null;
  selectedGadsCustomerId?: string | null;
  selectedGscSiteUrl?: string | null;
}) {
  const conn = await getGoogleConnection();
  if (!conn) throw new Error('Chưa có kết nối Google.');

  if (input.selectedGa4PropertyId !== undefined) {
    conn.selectedGa4PropertyId = input.selectedGa4PropertyId;
  }
  if (input.selectedGadsCustomerId !== undefined) {
    conn.selectedGadsCustomerId = input.selectedGadsCustomerId;
  }
  if (input.selectedGscSiteUrl !== undefined) {
    conn.selectedGscSiteUrl = input.selectedGscSiteUrl;
  }

  await saveGoogleConnection(conn);
  invalidateConfiguredWebsitesCache();
  invalidateGa4LiveCaches();
  bumpDomainRevisions(['websites', 'tracking', 'ads', 'reports'], 'google_select_resources');
  return getGoogleOAuthStatusDto();
}

const OAUTH_STATE_MAX_AGE_MS = 15 * 60 * 1000;

function getOAuthStateHmacSecret(): string {
  return (process.env.VAULT_MASTER_KEY || '').trim() || getSessionSecret();
}

export function sanitizeOAuthReturnPath(rawPath?: string | null): string {
  if (!rawPath || typeof rawPath !== 'string') return '/tracking';
  const trimmed = rawPath.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || /[\r\n\0\\]/.test(trimmed)) {
    return '/tracking';
  }
  const pathOnly = trimmed.split('?')[0].split('#')[0];
  if (!/^\/[a-zA-Z0-9/_-]*$/.test(pathOnly)) {
    return '/tracking';
  }
  return pathOnly || '/tracking';
}

export function signOAuthStatePayload(returnPath: string): string {
  const safePath = sanitizeOAuthReturnPath(returnPath);
  const payloadB64 = Buffer.from(
    JSON.stringify({
      returnPath: safePath,
      nonce: crypto.randomBytes(12).toString('hex'),
      time: Date.now(),
    }),
  ).toString('base64url');
  const sigB64 = crypto
    .createHmac('sha256', getOAuthStateHmacSecret())
    .update(payloadB64)
    .digest('base64url');
  return `${payloadB64}.${sigB64}`;
}

export function verifySignedOAuthState(
  stateStr?: string | null,
): { valid: boolean; returnPath: string; reason?: string } {
  if (!stateStr || typeof stateStr !== 'string') {
    return { valid: false, returnPath: '/tracking', reason: 'MISSING_OAUTH_STATE' };
  }
  const parts = stateStr.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { valid: false, returnPath: '/tracking', reason: 'UNSIGNED_OAUTH_STATE' };
  }
  const [payloadB64, providedSig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', getOAuthStateHmacSecret())
    .update(payloadB64)
    .digest('base64url');
  if (!safeSecretEquals(providedSig, expectedSig)) {
    return { valid: false, returnPath: '/tracking', reason: 'INVALID_OAUTH_STATE_SIGNATURE' };
  }
  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
      returnPath?: string;
      time?: number;
    };
    const safeReturnPath = sanitizeOAuthReturnPath(parsed.returnPath);
    if (
      typeof parsed.time !== 'number' ||
      !Number.isFinite(parsed.time) ||
      Math.abs(Date.now() - parsed.time) > OAUTH_STATE_MAX_AGE_MS
    ) {
      return { valid: false, returnPath: safeReturnPath, reason: 'EXPIRED_OAUTH_STATE' };
    }
    return { valid: true, returnPath: safeReturnPath };
  } catch {
    return { valid: false, returnPath: '/tracking', reason: 'MALFORMED_OAUTH_STATE' };
  }
}

export function redactGoogleSecretsFromText(message: string): string {
  if (!message) return '';
  return message
    .replace(/ya29\.[a-zA-Z0-9_-]+/g, '[REDACTED_ACCESS_TOKEN]')
    .replace(/1\/\/[a-zA-Z0-9_-]+/g, '[REDACTED_REFRESH_TOKEN]')
    .replace(/GOCSPX-[a-zA-Z0-9_-]+/g, '[REDACTED_CLIENT_SECRET]')
    .replace(/(Bearer\s+)[a-zA-Z0-9._-]+/gi, '$1[REDACTED]')
    .replace(/((?:access_token|refresh_token|client_secret|developer_token)["'=:\s]+)[^\s"&,}]+/gi, '$1[REDACTED]');
}

export async function buildGoogleAuthorizeUrl(origin: string, returnPath = '/tracking') {
  const cfg = await getGoogleClientConfig();
  const safePath = sanitizeOAuthReturnPath(returnPath);
  if (!cfg) {
    return {
      needsConfig: true,
      authUrl: null,
      message: 'Chưa cấu hình Google Client ID & Client Secret. Bạn có thể nhập trong Cài đặt hoặc dùng Chế độ Kiểm thử Mẫu.',
    };
  }

  const redirectUri = `${origin}/api/v1/auth/google/callback`;
  const statePayload = signOAuthStatePayload(safePath);

  const scopes = [
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/analytics.readonly',
    'https://www.googleapis.com/auth/adwords',
    'https://www.googleapis.com/auth/webmasters.readonly',
    'https://www.googleapis.com/auth/gmail.readonly',
  ].join(' ');

  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: statePayload,
  });

  return {
    needsConfig: false,
    authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    message: null,
  };
}

export async function handleGoogleOAuthCallback(code: string, origin: string, stateStr?: string | null) {
  const verifiedState = verifySignedOAuthState(stateStr);
  if (!verifiedState.valid) {
    throw new Error(`Phiên ủy quyền Google OAuth không hợp lệ hoặc đã hết hạn (${verifiedState.reason}). Vui lòng thực hiện kết nối lại.`);
  }
  const cfg = await getGoogleClientConfig();
  if (!cfg) {
    throw new Error('Chưa cấu hình Google Client ID & Secret trên hệ thống.');
  }

  const redirectUri = `${origin}/api/v1/auth/google/callback`;

  // 1. Exchange code for tokens
  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });

  if (!tokenResp.ok) {
    const errTxt = redactGoogleSecretsFromText(await tokenResp.text());
    throw new Error(`Google từ chối cấp mã truy cập: ${errTxt.slice(0, 200)}`);
  }

  const tokenData = (await tokenResp.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  };

  // 2. Fetch User Info
  let email = 'connected-user@google.com';
  let name = 'Tài khoản Google';
  let picture: string | null = null;
  try {
    const userResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (userResp.ok) {
      const uInfo = (await userResp.json()) as { email?: string; name?: string; picture?: string };
      if (uInfo.email) email = uInfo.email;
      if (uInfo.name) name = uInfo.name;
      if (uInfo.picture) picture = uInfo.picture;
    }
  } catch {
    // ignore
  }

  const existingConn = await getGoogleConnection();
  const expiresAt = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString();
  const scopes = (tokenData.scope || '').split(' ').filter(Boolean);

  const updatedConn: StoredGoogleConnection = {
    connected: true,
    connectedEmail: email,
    connectedName: name,
    connectedPicture: picture,
    connectedAt: new Date().toISOString(),
    scopes: scopes.length > 0 ? scopes : ['analytics.readonly', 'adwords', 'webmasters.readonly'],
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || existingConn?.refreshToken || null,
    expiresAt,
    isSandboxDemo: false,
    connectionStatus: 'CONNECTED',
    lastErrorCode: null,
    lastErrorMessage: null,
    lastSyncAt: new Date().toISOString(),
    detectedGa4PropertyId: existingConn?.detectedGa4PropertyId && existingConn.detectedGa4PropertyId !== '213025502' ? existingConn.detectedGa4PropertyId : null,
    detectedGadsCustomerId: existingConn?.detectedGadsCustomerId && existingConn.detectedGadsCustomerId !== '889-102-4451' ? existingConn.detectedGadsCustomerId : null,
  };

  await saveGoogleConnection(updatedConn);

  // Reset any stale Gmail 401/expired-token error state immediately upon fresh OAuth connection
  try {
    const cpRow = await prisma.systemSetting.findUnique({ where: { key: 'gmail_sync_checkpoint' } });
    if (cpRow?.value) {
      const parsedCp = JSON.parse(cpRow.value) as Record<string, unknown>;
      parsedCp.accountKey = email.trim().toLowerCase();
      parsedCp.lastError = null;
      parsedCp.consecutiveFailures = 0;
      await prisma.systemSetting.update({
        where: { key: 'gmail_sync_checkpoint' },
        data: { value: JSON.stringify(parsedCp) },
      });
    }
  } catch {
    // non-fatal checkpoint reset
  }
  bumpDomainRevisions(['leads', 'websites', 'tracking', 'ads', 'reports'], 'google_oauth_connected');

  // Non-destructive initial connection test & initial sync
  try {
    await testGoogleConnection();
    await syncAllGoogleDataAcrossModules('FULL_0200');
  } catch {
    // non-fatal
  }

  const returnPath = verifiedState.returnPath;

  return { email, name, returnPath };
}

export async function connectSandboxDemo(email = 'toantrung.marketing@gmail.com') {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const demoConn: StoredGoogleConnection = {
    connected: true,
    connectedEmail: email,
    connectedName: 'Toàn Trung Marketing (Google Ads & GA4 Quản trị)',
    connectedPicture: null,
    connectedAt: new Date().toISOString(),
    scopes: [
      'https://www.googleapis.com/auth/analytics.readonly',
      'https://www.googleapis.com/auth/adwords',
      'https://www.googleapis.com/auth/webmasters.readonly',
      'https://www.googleapis.com/auth/gmail.readonly',
      'openid',
      'email',
      'profile',
    ],
    accessToken: 'DEMO_SANDBOX_TOKEN',
    refreshToken: 'DEMO_SANDBOX_REFRESH_TOKEN',
    expiresAt,
    isSandboxDemo: true,
    lastSyncAt: new Date().toISOString(),
    detectedGa4PropertyId: '213025502',
    detectedGadsCustomerId: '889-102-4451',
  };

  await saveGoogleConnection(demoConn);
  await syncAllGoogleDataAcrossModules('FULL_0200');
  return demoConn;
}

export async function disconnectGoogleOAuth() {
  await saveGoogleConnection(null);
  invalidateConfiguredWebsitesCache();
  invalidateGa4LiveCaches();
  bumpDomainRevisions(['websites', 'tracking', 'ads', 'reports'], 'google_oauth_disconnected');
}

export async function getValidAccessToken(): Promise<string | null> {
  const conn = await getGoogleConnection();
  if (!conn || !conn.connected) return null;
  if (conn.isSandboxDemo || conn.accessToken === 'DEMO_SANDBOX_TOKEN') {
    return 'DEMO_SANDBOX_TOKEN';
  }

  const now = Date.now();
  const exp = conn.expiresAt ? new Date(conn.expiresAt).getTime() : 0;
  // If still valid for at least 2 minutes:
  if (conn.accessToken && exp - now > 120 * 1000) {
    return conn.accessToken;
  }

  // Needs refresh: coalesce concurrent refresh attempts across routes & warmers
  if (!conn.refreshToken) {
    return exp > 0 && exp <= now ? null : conn.accessToken;
  }

  if (globalOAuthHelpers.__toantrungTokenRefreshInFlight) {
    return globalOAuthHelpers.__toantrungTokenRefreshInFlight;
  }

  const refreshPromise = (async () => {
    try {
      const cfg = await getGoogleClientConfig();
      if (!cfg) return exp > 0 && exp <= now ? null : conn.accessToken;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: cfg.clientId,
              client_secret: cfg.clientSecret,
              refresh_token: conn.refreshToken || '',
              grant_type: 'refresh_token',
            }).toString(),
          });
          if (tokenResp.ok) {
            const data = (await tokenResp.json()) as {
              access_token?: string;
              expires_in?: number;
              refresh_token?: string;
            };
            if (data.access_token) {
              conn.accessToken = data.access_token;
              if (data.refresh_token) {
                conn.refreshToken = data.refresh_token;
              }
              conn.expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();
              conn.connectionStatus = 'CONNECTED';
              conn.lastErrorCode = null;
              conn.lastErrorMessage = null;
              await saveGoogleConnection(conn);
              return data.access_token;
            }
          } else {
            const errBody = await tokenResp.text().catch(() => '');
            if (/invalid_grant|invalid_client|revoked/i.test(errBody)) {
              conn.connectionStatus = 'EXPIRED';
              conn.lastErrorCode = 'OAUTH_TOKEN_EXPIRED';
              conn.lastErrorMessage =
                'Phiên kết nối Google OAuth đã hết hạn hoặc bị thu hồi (Google OAuth chế độ Testing giới hạn 7 ngày). Vui lòng bấm Kết nối lại Google.';
              conn.lastAttemptAt = new Date().toISOString();
              await saveGoogleConnection(conn);
              bumpDomainRevisions(['leads', 'tracking', 'ads', 'reports'], 'google_oauth_expired');
              return null;
            }
            if (tokenResp.status >= 500 && attempt === 0) {
              await new Promise((resolve) => setTimeout(resolve, 800));
              continue;
            }
            break;
          }
        } catch {
          if (attempt === 0) {
            await new Promise((resolve) => setTimeout(resolve, 800));
            continue;
          }
        }
      }
    } finally {
      globalOAuthHelpers.__toantrungTokenRefreshInFlight = null;
    }
    return exp > 0 && exp <= now ? null : conn.accessToken;
  })();

  globalOAuthHelpers.__toantrungTokenRefreshInFlight = refreshPromise;
  return refreshPromise;
}

/**
 * Proactive OAuth Keep-Alive (independent of browser):
 * Checks every 30 minutes and preemptively refreshes the Google access token
 * when it is missing an expiry or within 20 minutes of expiring.
 */
export function ensureGoogleOAuthKeepAliveStarted(): void {
  if (process.env.NODE_TEST_CONTEXT) return;
  if (globalOAuthHelpers.__toantrungOAuthKeepAliveStarted) return;
  globalOAuthHelpers.__toantrungOAuthKeepAliveStarted = true;

  const runKeepAliveTick = async () => {
    try {
      const conn = await getGoogleConnection();
      if (!conn?.connected || conn.isSandboxDemo || !conn.refreshToken || conn.connectionStatus === 'EXPIRED') {
        return;
      }
      const exp = conn.expiresAt ? new Date(conn.expiresAt).getTime() : 0;
      if (!exp || exp - Date.now() <= 20 * 60_000) {
        await getValidAccessToken();
      }
    } catch {
      // Keep-alive tick must never crash background server
    }
  };

  const bootTimer = setTimeout(() => {
    void runKeepAliveTick();
  }, 15_000);
  if (typeof bootTimer.unref === 'function') {
    bootTimer.unref();
  }

  const interval = setInterval(() => {
    void runKeepAliveTick();
  }, 30 * 60 * 1000);
  if (typeof interval.unref === 'function') {
    interval.unref();
  }
}

export const ALLOWED_COMPANY_GA4_PROPERTY_IDS = [
  '512879968', // toantrung.com.vn
  '509190194', // manhinhled.net.vn
  '538179128', // bangled.vn
  '508951192', // Toàn Trung - Bảng điện tử
];

export const ALLOWED_COMPANY_GSC_SITES = [
  'https://toantrung.com.vn/',
  'sc-domain:toantrung.com.vn',
  'https://manhinhled.net.vn/',
  'sc-domain:manhinhled.net.vn',
  'https://bangled.vn/',
  'sc-domain:bangled.vn',
];

const globalForTrackingSync = globalThis as typeof globalThis & {
  __googleTrackingAutoSyncInFlight?: Promise<unknown> | null;
  __googleTrackingLastAutoSyncAttemptMs?: number;
  __toantrungUnifiedSyncInFlight?: Promise<Awaited<ReturnType<typeof runSyncAllGoogleDataAcrossModulesInternal>>> | null;
};

/**
 * Tự động kích hoạt đồng bộ nền nhẹ (2 ngày gần nhất) khi dữ liệu đã cũ (>15 phút hoặc sang ngày mới)
 * để trang /tracking luôn có số liệu ngày mới mà không cần chờ ca 02:00 / 11:00 / 17:00.
 */
export function triggerBackgroundTrackingSyncIfStale(): void {
  if (globalForTrackingSync.__googleTrackingAutoSyncInFlight) return;
  const now = Date.now();
  const lastAttempt = globalForTrackingSync.__googleTrackingLastAutoSyncAttemptMs || 0;
  if (now - lastAttempt < 5 * 60_000) return;

  globalForTrackingSync.__googleTrackingLastAutoSyncAttemptMs = now;
  const run = (async () => {
    try {
      const conn = await getGoogleConnection();
      if (!conn?.connected || conn.isSandboxDemo) return;
      const lastIso = conn.lastSuccessfulSyncAt || conn.lastSyncAt;
      if (lastIso) {
        const lastMs = Date.parse(lastIso);
        const todayVn = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(now));
        const lastVn = Number.isFinite(lastMs)
          ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(lastMs))
          : '';
        if (lastVn === todayVn && Number.isFinite(lastMs) && now - lastMs < 15 * 60_000) {
          return;
        }
      }
      await syncAllGoogleDataAcrossModules('LIGHT_1100');
    } catch {
      // Never block or throw from background refresh
    } finally {
      globalForTrackingSync.__googleTrackingAutoSyncInFlight = null;
    }
  })();
  globalForTrackingSync.__googleTrackingAutoSyncInFlight = run;
}

/**
 * FULL SYNC ACROSS ALL MODULES (02, 03, 04)
 * Called during manual sync button, OAuth callback, or scheduled worker slots (02:00, 11:00, 17:00)
 */
export async function syncAllGoogleDataAcrossModules(slot: 'FULL_0200' | 'LIGHT_1100' | 'LIGHT_1700' | 'MANUAL_RETRY' = 'MANUAL_RETRY') {
  if (globalForTrackingSync.__toantrungUnifiedSyncInFlight) {
    return globalForTrackingSync.__toantrungUnifiedSyncInFlight;
  }
  const run = runSyncAllGoogleDataAcrossModulesInternal(slot).finally(() => {
    globalForTrackingSync.__toantrungUnifiedSyncInFlight = null;
  });
  globalForTrackingSync.__toantrungUnifiedSyncInFlight = run;
  return run;
}

async function runSyncAllGoogleDataAcrossModulesInternal(slot: 'FULL_0200' | 'LIGHT_1100' | 'LIGHT_1700' | 'MANUAL_RETRY' = 'MANUAL_RETRY') {
  const syncStartedAt = new Date();
  const token = await getValidAccessToken();
  const conn = await getGoogleConnection();
  const windowDays = slot === 'FULL_0200' ? 30 : 7;
  const dateRange = getCanonicalDateRange(windowDays);
  const startStr = dateRange.startDateStr;
  const todayStr = dateRange.endDateStr;

  let syncedRecords = 0;
  let realGa4Count = 0;
  let realScCount = 0;
  let realAdsCount = 0;

  let ga4Outcome: { success: boolean; synced: number; isPartial?: boolean; isEmpty?: boolean; error?: string } = {
    success: false,
    synced: 0,
    error: 'Chưa cấu hình hoặc thiếu token',
  };
  let scOutcome: { success: boolean; synced: number; isPartial?: boolean; isEmpty?: boolean; error?: string } = {
    success: false,
    synced: 0,
    error: 'Chưa cấu hình hoặc thiếu token',
  };
  let adsOutcome: { success: boolean; synced: number; error?: string } | null = null;

  // Attempt verified Google APIs sync if live token is available
  if (token && !conn?.isSandboxDemo && token !== 'DEMO_SANDBOX_TOKEN') {
    try {
      ga4Outcome = await syncRealGoogleAnalytics(token, conn, windowDays);
      realGa4Count = ga4Outcome.synced;
      syncedRecords += realGa4Count;
    } catch (err) {
      ga4Outcome = {
        success: false,
        synced: 0,
        error: err instanceof Error ? err.message : 'Lỗi đồng bộ GA4',
      };
      console.warn('Real GA4 sync error:', err);
    }

    try {
      scOutcome = await syncRealSearchConsole(token, conn, windowDays);
      realScCount = scOutcome.synced;
      syncedRecords += realScCount;
    } catch (err) {
      scOutcome = {
        success: false,
        synced: 0,
        error: err instanceof Error ? err.message : 'Lỗi đồng bộ Search Console',
      };
      console.warn('Real Search Console sync error:', err);
    }

    const adsCfg = await getGoogleAdsApiConfig();
    const hasAdsScope = Boolean(conn?.scopes?.some((s) => s.includes('adwords')));
    if (hasAdsScope || adsCfg?.developerToken) {
      try {
        adsOutcome = await syncRealGoogleAds(token, conn, adsCfg, Math.max(windowDays, 30));
        realAdsCount = adsOutcome.synced;
        syncedRecords += realAdsCount;
      } catch (err) {
        adsOutcome = {
          success: false,
          synced: 0,
          error: err instanceof Error ? err.message : 'Lỗi đồng bộ Google Ads API',
        };
      }

      const lastAdsLog = await prisma.platformSyncLog.findFirst({
        where: { platform: 'google_ads' },
        orderBy: { startedAt: 'desc' },
      });
      const adsConsecutive = adsOutcome.success ? 0 : ((lastAdsLog?.consecutiveFailures ?? 0) + 1);
      await prisma.platformSyncLog.create({
        data: {
          platform: 'google_ads',
          accountPropertyId:
            adsCfg?.customerId || conn?.selectedGadsCustomerId || conn?.detectedGadsCustomerId || 'GADS_ACCOUNT',
          runType: slot === 'FULL_0200' ? 'full' : 'light',
          windowStartDate: startStr,
          windowEndDate: todayStr,
          recordsSynced: realAdsCount,
          status: adsOutcome.success ? 'success' : 'failed',
          errorMessage: adsOutcome.success ? null : (adsOutcome.error?.slice(0, 500) || 'Lỗi Google Ads API'),
          consecutiveFailures: adsConsecutive,
          startedAt: syncStartedAt,
          completedAt: new Date(),
        },
      });
    }

    // Accumulate consecutive failures correctly from previous logs
    const lastGa4Log = await prisma.platformSyncLog.findFirst({
      where: { platform: 'ga4' },
      orderBy: { startedAt: 'desc' },
    });
    const ga4Consecutive = ga4Outcome.success ? 0 : ((lastGa4Log?.consecutiveFailures ?? 0) + 1);

    const lastScLog = await prisma.platformSyncLog.findFirst({
      where: { platform: 'search_console' },
      orderBy: { startedAt: 'desc' },
    });
    const scConsecutive = scOutcome.success ? 0 : ((lastScLog?.consecutiveFailures ?? 0) + 1);

    const ga4LogStatus = !ga4Outcome.success
      ? 'failed'
      : ga4Outcome.isPartial
        ? 'partial'
        : 'success';

    const scLogStatus = !scOutcome.success
      ? 'failed'
      : scOutcome.isPartial
        ? 'partial'
        : 'success';

    // Log sync execution separately per provider to maintain truthful status
    await prisma.platformSyncLog.create({
      data: {
        platform: 'ga4',
        accountPropertyId: conn?.detectedGa4PropertyId || conn?.selectedGa4PropertyId || 'GA4_MULTI_PROPERTY',
        runType: slot === 'FULL_0200' ? 'full' : 'light',
        windowStartDate: startStr,
        windowEndDate: todayStr,
        recordsSynced: realGa4Count,
        status: ga4LogStatus,
        errorMessage: ga4Outcome.success
          ? (ga4Outcome.isPartial ? ga4Outcome.error?.slice(0, 500) || null : null)
          : (ga4Outcome.error?.slice(0, 500) || 'Lỗi không xác định'),
        consecutiveFailures: ga4Consecutive,
        startedAt: syncStartedAt,
        completedAt: new Date(),
      },
    });

    await prisma.platformSyncLog.create({
      data: {
        platform: 'search_console',
        accountPropertyId: conn?.selectedGscSiteUrl || 'SC_MULTI_SITE',
        runType: slot === 'FULL_0200' ? 'full' : 'light',
        windowStartDate: startStr,
        windowEndDate: todayStr,
        recordsSynced: realScCount,
        status: scLogStatus,
        errorMessage: scOutcome.success
          ? (scOutcome.isPartial ? scOutcome.error?.slice(0, 500) || null : null)
          : (scOutcome.error?.slice(0, 500) || 'Lỗi không xác định'),
        consecutiveFailures: scConsecutive,
        startedAt: syncStartedAt,
        completedAt: new Date(),
      },
    });
  }

  // 6. GCLID Attribution & Matching
  const gclidResult = await retryUnresolvedGclids();

  // 7. Refresh Module 03 Keyword & Ads Derived Cache
  await refreshKeywordDerivedCacheFromCanonicalMetrics({ force: true });

  // 8. Update connection timestamps: record attempt time always, lastSyncAt ONLY per successful provider
  if (conn) {
    (conn as any).lastAttemptAt = new Date().toISOString();
    if (ga4Outcome.success) {
      (conn as any).ga4LastSyncAt = new Date().toISOString();
      (conn as any).ga4LastStatus = ga4Outcome.isPartial ? 'partial' : 'success';
      (conn as any).ga4LastError = null;
    } else {
      (conn as any).ga4LastStatus = 'failed';
      (conn as any).ga4LastError = ga4Outcome.error || 'Thất bại';
    }

    if (scOutcome.success) {
      (conn as any).scLastSyncAt = new Date().toISOString();
      (conn as any).scLastStatus = scOutcome.isPartial ? 'partial' : 'success';
      (conn as any).scLastError = null;
    } else {
      (conn as any).scLastStatus = 'failed';
      (conn as any).scLastError = scOutcome.error || 'Thất bại';
    }

    if (ga4Outcome.success || scOutcome.success) {
      conn.lastSyncAt = new Date().toISOString();
    }
    await saveGoogleConnection(conn);
  }

  const overallSuccess = ga4Outcome.success || scOutcome.success;

  invalidateConfiguredWebsitesCache();
  invalidateGa4LiveCaches();
  bumpDomainRevisions(['tracking', 'ads', 'reports', 'leads', 'websites'], `google_sync_${slot}`);

  return {
    success: overallSuccess,
    slot,
    syncedRecords,
    realGa4Count,
    realScCount,
    ga4Status: ga4Outcome.success ? (ga4Outcome.isPartial ? 'partial' : 'success') : 'failed',
    scStatus: scOutcome.success ? (scOutcome.isPartial ? 'partial' : 'success') : 'failed',
    ga4Error: ga4Outcome.success ? null : ga4Outcome.error,
    scError: scOutcome.success ? null : scOutcome.error,
    gclidResolved: gclidResult.resolved,
    lastSyncAt: conn?.lastSyncAt || null,
    ga4LastSyncAt: (conn as any)?.ga4LastSyncAt || null,
    scLastSyncAt: (conn as any)?.scLastSyncAt || null,
    connectionEmail: conn?.connectedEmail || null,
    isSandboxDemo: Boolean(conn?.isSandboxDemo),
  };
}

/**
 * DEPRECATED: Non-destructive stub to protect business records.
 * Destructive deletion of leads, campaigns, designs, and keywords has been permanently disabled.
 */
export async function purgeDemoMetrics() {
  console.info('[DataSafety] purgeDemoMetrics is permanently disabled to preserve company business records.');
  return { success: true, message: 'Purge disabled for safety.' };
}

async function syncRealGoogleAnalytics(
  token: string,
  conn: StoredGoogleConnection | null,
  windowDays = 30,
): Promise<{ success: boolean; synced: number; isPartial?: boolean; isEmpty?: boolean; error?: string }> {
  let synced = 0;
  const dateRange = getCanonicalDateRange(windowDays);
  const startStr = dateRange.startDateStr;
  const todayStr = dateRange.endDateStr;

  const resAdmin = await fetch('https://analyticsadmin.googleapis.com/v1beta/accountSummaries', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resAdmin.ok) {
    const errText = await resAdmin.text();
    return {
      success: false,
      synced: 0,
      error: `GA4 Admin API (${resAdmin.status}): ${errText.slice(0, 200)}`,
    };
  }

  const adminData = (await resAdmin.json()) as {
    accountSummaries?: Array<{
      displayName?: string;
      propertySummaries?: Array<{
        property: string;
        displayName: string;
      }>;
    }>;
  };

  const allProps = adminData.accountSummaries?.flatMap((a) => a.propertySummaries || []) || [];

  // Scope enforcement: Synchronize ONLY explicitly authorized company properties
  let targetProps: Array<{ property: string; displayName: string }> = [];

  if (conn?.selectedGa4PropertyId) {
    const matched = allProps.find((p) => p.property.replace('properties/', '') === conn.selectedGa4PropertyId);
    if (!matched) {
      return {
        success: false,
        synced: 0,
        error: `Thuộc tính GA4 được chọn (ID: ${conn.selectedGa4PropertyId}) không tìm thấy trong tài khoản Google được cấp quyền.`,
      };
    }
    targetProps = [matched];
  } else {
    targetProps = allProps.filter((p) => {
      const propId = p.property.replace('properties/', '');
      return ALLOWED_COMPANY_GA4_PROPERTY_IDS.includes(propId);
    });

    if (targetProps.length === 0) {
      return {
        success: false,
        synced: 0,
        error: 'Không tìm thấy thuộc tính GA4 nào thuộc danh sách cho phép của công ty Toàn Trung trong tài khoản này.',
      };
    }
  }

  const propOutcomes: Array<{ propId: string; ok: boolean; count: number; error?: string; secondaryError?: string }> = [];

  for (const prop of targetProps) {
    const propId = prop.property.replace('properties/', '');
    let propSynced = 0;
    let propError: string | undefined;
    const propSecondaryErrors: string[] = [];

    // 1. Query daily account metrics with dimension "date" so daily facts represent their actual date
    try {
      const reportResp = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propId}:runReport`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          dateRanges: [{ startDate: startStr, endDate: todayStr }],
          dimensions: [{ name: 'date' }],
          metrics: [
            { name: 'activeUsers' },
            { name: 'screenPageViews' },
            { name: 'eventCount' },
            { name: 'userEngagementDuration' },
          ],
        }),
      });

      if (!reportResp.ok) {
        const errText = await reportResp.text();
        propError = `HTTP ${reportResp.status}: ${errText.slice(0, 150)}`;
      } else {
        const repData = (await reportResp.json()) as {
          rows?: Array<{
            dimensionValues: Array<{ value: string }>;
            metricValues: Array<{ value: string }>;
          }>;
        };

        for (const row of repData.rows || []) {
          const dateVal = row.dimensionValues?.[0]?.value || '';
          if (!dateVal || dateVal.length !== 8) continue;
          const metricDate = `${dateVal.slice(0, 4)}-${dateVal.slice(4, 6)}-${dateVal.slice(6, 8)}`;
          const activeUsers = parseInt(row.metricValues?.[0]?.value || '0', 10);
          const pageViews = parseInt(row.metricValues?.[1]?.value || '0', 10);
          const eventCount = parseInt(row.metricValues?.[2]?.value || '0', 10);
          const totalDuration = parseFloat(row.metricValues?.[3]?.value || '0');
          const avgTime = activeUsers > 0 ? totalDuration / activeUsers : 0;

          await upsertPlatformMetricIdempotent(prisma, {
            platform: 'ga4',
            accountPropertyId: propId,
            metricDate,
            grain: 'account',
            clicks: activeUsers,
            impressions: eventCount,
            pageViews,
            avgTimeOnPageSec: Math.round(avgTime * 10) / 10,
            isFinalized: false,
          });
          propSynced++;
          synced++;
        }

        if (conn && (!conn.detectedGa4PropertyId || prop.displayName.toLowerCase().includes('toantrung'))) {
          conn.detectedGa4PropertyId = propId;
        }
      }
    } catch (err) {
      propError = err instanceof Error ? err.message : 'Lỗi kết nối GA4 Data API';
    }

    // 2. Query period-level deduplicated unique users (no date dimension) for standard windows (windowDays, 7d, 30d)
    if (!propError) {
      const targetWindows = Array.from(new Set([windowDays, 7, 30]));
      for (const sDays of targetWindows) {
        const sRange = getCanonicalDateRange(sDays);
        try {
          const periodResp = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propId}:runReport`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              dateRanges: [{ startDate: sRange.startDateStr, endDate: sRange.endDateStr }],
              metrics: [
                { name: 'activeUsers' },
                { name: 'screenPageViews' },
                { name: 'eventCount' },
              ],
            }),
          });

          if (periodResp.ok) {
            const pData = (await periodResp.json()) as {
              rows?: Array<{
                metricValues: Array<{ value: string }>;
              }>;
            };
            const periodRow = pData.rows?.[0];
            if (periodRow) {
              const periodUsers = parseInt(periodRow.metricValues?.[0]?.value || '0', 10);
              const periodViews = parseInt(periodRow.metricValues?.[1]?.value || '0', 10);
              const periodEvents = parseInt(periodRow.metricValues?.[2]?.value || '0', 10);

              // Store period-level deduplicated snapshot safely with exact period metadata encoded
              const snapshotKey = `PERIOD_SNAPSHOT:${sDays}D:${sRange.startDateStr}_${sRange.endDateStr}`;
              await upsertPlatformMetricIdempotent(prisma, {
                platform: 'ga4',
                accountPropertyId: propId,
                metricDate: todayStr,
                grain: 'account',
                campaignExternalId: snapshotKey,
                clicks: periodUsers, // Deduplicated unique users for this period
                impressions: periodEvents,
                pageViews: periodViews,
                isFinalized: false,
              });
              propSynced++;
              synced++;
            }
          } else if (sDays === windowDays) {
            const errText = await periodResp.text();
            propSecondaryErrors.push(`Snapshot toàn kỳ lỗi HTTP ${periodResp.status}: ${errText.slice(0, 100)}`);
          }
        } catch (err) {
          if (sDays === windowDays) {
            propSecondaryErrors.push(`Snapshot toàn kỳ lỗi kết nối: ${err instanceof Error ? err.message : 'Unknown'}`);
          }
        }
      }
    }

    // 3. Query daily page-level report for top landing pages
    if (!propError) {
      try {
        const pageResp = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propId}:runReport`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            dateRanges: [{ startDate: startStr, endDate: todayStr }],
            dimensions: [{ name: 'date' }, { name: 'pagePath' }],
            metrics: [
              { name: 'screenPageViews' },
              { name: 'userEngagementDuration' },
            ],
            limit: 100,
          }),
        });

        if (pageResp.ok) {
          const pageData = (await pageResp.json()) as {
            rows?: Array<{
              dimensionValues: Array<{ value: string }>;
              metricValues: Array<{ value: string }>;
            }>;
          };
          for (const pRow of pageData.rows || []) {
            const dateVal = pRow.dimensionValues?.[0]?.value || '';
            if (!dateVal || dateVal.length !== 8) continue;
            const metricDate = `${dateVal.slice(0, 4)}-${dateVal.slice(4, 6)}-${dateVal.slice(6, 8)}`;
            const path = pRow.dimensionValues?.[1]?.value || '/';
            const views = parseInt(pRow.metricValues?.[0]?.value || '0', 10);
            const dur = parseFloat(pRow.metricValues?.[1]?.value || '0');

            await upsertPlatformMetricIdempotent(prisma, {
              platform: 'ga4',
              accountPropertyId: propId,
              metricDate,
              grain: 'page',
              pageUrlRaw: `https://${prop.displayName.toLowerCase().replace(/[^a-z0-9.-]/g, '')}${path}`,
              pageViews: views,
              avgTimeOnPageSec: views > 0 ? Math.round((dur / views) * 10) / 10 : 0,
              isFinalized: false,
            });
            propSynced++;
            synced++;
          }
        } else {
          const errText = await pageResp.text();
          propSecondaryErrors.push(`Top trang lỗi HTTP ${pageResp.status}: ${errText.slice(0, 100)}`);
        }
      } catch (err) {
        propSecondaryErrors.push(`Top trang lỗi kết nối: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    }

    propOutcomes.push({
      propId,
      ok: !propError,
      count: propSynced,
      error: propError,
      secondaryError: propSecondaryErrors.length > 0 ? propSecondaryErrors.join('; ') : undefined,
    });
  }

  const failedProps = propOutcomes.filter((p) => !p.ok);
  const successProps = propOutcomes.filter((p) => p.ok);
  const secondaryErrorProps = propOutcomes.filter((p) => p.ok && p.secondaryError);

  // If ALL properties failed primary report requests, return failure! Never swallow and return success!
  if (successProps.length === 0) {
    const errDetails = failedProps.map((p) => `${p.propId}: ${p.error}`).join('; ');
    return {
      success: false,
      synced: 0,
      error: `Tất cả thuộc tính GA4 đều bị lỗi truy vấn báo cáo (${errDetails})`,
    };
  }

  // Partial success when some properties failed or secondary queries failed
  if (failedProps.length > 0 || secondaryErrorProps.length > 0) {
    const msgParts: string[] = [];
    if (failedProps.length > 0) {
      msgParts.push(`${failedProps.length} thuộc tính bị lỗi chính (${failedProps.map((p) => p.propId).join(', ')})`);
    }
    if (secondaryErrorProps.length > 0) {
      msgParts.push(`Báo cáo phụ bị gián đoạn: ${secondaryErrorProps.map((p) => `${p.propId}: ${p.secondaryError}`).join('; ')}`);
    }
    return {
      success: true,
      synced,
      isPartial: true,
      error: `Đồng bộ một phần: ${msgParts.join(' | ')}`,
    };
  }

  return { success: true, synced, isEmpty: synced === 0 };
}

export type GscDataCompletenessState = 'FINALIZED' | 'PRELIMINARY' | 'UNKNOWN' | 'QUERY_ERROR';

export interface GscSiteDataStateMetadata {
  siteUrl: string;
  queriedStartDate: string | null;
  queriedEndDate: string | null;
  queriedInclusiveDays: number;
  finalizedDates: string[];
  preliminaryDates: string[];
  lastQueryStatus: 'OK' | 'QUERY_ERROR';
  lastQueryError: string | null;
  updatedAt: string;
}

export const SETTING_KEY_GSC_DATA_STATE_METADATA = 'gsc_data_state_metadata_v1';

export async function getGscDataStateMetadataMap(): Promise<Record<string, GscSiteDataStateMetadata>> {
  try {
    const row = await prisma.systemSetting.findUnique({
      where: { key: SETTING_KEY_GSC_DATA_STATE_METADATA },
    });
    if (!row?.value) return {};
    const parsed = JSON.parse(row.value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function saveGscSiteDataStateMetadata(meta: GscSiteDataStateMetadata): Promise<void> {
  const current = await getGscDataStateMetadataMap();
  current[meta.siteUrl] = meta;
  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEY_GSC_DATA_STATE_METADATA },
    update: { value: JSON.stringify(current) },
    create: { key: SETTING_KEY_GSC_DATA_STATE_METADATA, value: JSON.stringify(current) },
  });
}

/**
 * R01: Không tự suy diễn dữ liệu đã hoàn chỉnh chỉ vì cách hiện tại >= 3 ngày.
 * Chỉ đánh dấu FINALIZED khi ngày đó có mặt trong tập kết quả truy vấn `dataState: 'final'` từ GSC API,
 * PRELIMINARY khi có trong `dataState: 'all'` nhưng chưa có trong `dataState: 'final'`,
 * QUERY_ERROR khi truy vấn GSC trả lỗi, và UNKNOWN khi thiếu metadata nguồn đối chứng.
 */
export function classifyGscDateBySourceMetadata(
  metricDateStr: string,
  siteMeta?: GscSiteDataStateMetadata | null,
): GscDataCompletenessState {
  if (!siteMeta) return 'UNKNOWN';
  if (siteMeta.finalizedDates?.includes(metricDateStr)) {
    return 'FINALIZED';
  }
  if (siteMeta.preliminaryDates?.includes(metricDateStr)) {
    return 'PRELIMINARY';
  }
  if (siteMeta.lastQueryStatus === 'QUERY_ERROR') {
    return 'QUERY_ERROR';
  }
  return 'UNKNOWN';
}

export function isGscDateFinalized(
  metricDateStr: string,
  sourceFinalizedDatesOrMeta?: Set<string> | GscSiteDataStateMetadata | string | null,
): boolean {
  if (!metricDateStr || !sourceFinalizedDatesOrMeta) return false;
  if (sourceFinalizedDatesOrMeta instanceof Set) {
    return sourceFinalizedDatesOrMeta.has(metricDateStr);
  }
  if (typeof sourceFinalizedDatesOrMeta === 'object') {
    return classifyGscDateBySourceMetadata(metricDateStr, sourceFinalizedDatesOrMeta) === 'FINALIZED';
  }
  // R01: Khi chỉ truyền chuỗi ngày tham chiếu mà không có metadata `dataState: 'final'` từ GSC, tuyệt đối không tự khẳng định đã chốt theo khoảng cách >= 3 ngày.
  return false;
}

async function syncRealSearchConsole(
  token: string,
  conn: StoredGoogleConnection | null,
  windowDays = 30,
): Promise<{ success: boolean; synced: number; isPartial?: boolean; isEmpty?: boolean; error?: string }> {
  let synced = 0;
  const dateRange = getCanonicalDateRange(windowDays);
  const startStr = dateRange.startDateStr;
  const todayStr = dateRange.endDateStr;

  const resSC = await fetch('https://www.googleapis.com/webmasters/v3/sites', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resSC.ok) {
    const errText = await resSC.text();
    return {
      success: false,
      synced: 0,
      error: `Search Console API (${resSC.status}): ${errText.slice(0, 200)}`,
    };
  }

  const scData = (await resSC.json()) as {
    siteEntry?: Array<{ siteUrl: string }>;
  };

  const allSites = scData.siteEntry || [];

  // Scope enforcement: Synchronize ONLY explicitly authorized company sites
  let targetSites: Array<{ siteUrl: string }> = [];

  if (conn?.selectedGscSiteUrl) {
    const matched = allSites.find((s) => s.siteUrl === conn.selectedGscSiteUrl);
    if (!matched) {
      return {
        success: false,
        synced: 0,
        error: `Website Search Console được chọn (${conn.selectedGscSiteUrl}) không tìm thấy trong tài khoản Google được cấp quyền.`,
      };
    }
    targetSites = [matched];
  } else {
    targetSites = allSites.filter((s) => ALLOWED_COMPANY_GSC_SITES.includes(s.siteUrl));

    if (targetSites.length === 0) {
      return {
        success: false,
        synced: 0,
        error: 'Không tìm thấy website nào thuộc danh sách Search Console cho phép của công ty Toàn Trung trong tài khoản này.',
      };
    }
  }

  const siteOutcomes: Array<{ siteUrl: string; ok: boolean; count: number; error?: string; secondaryError?: string }> = [];

  for (const site of targetSites) {
    let siteSynced = 0;
    let siteError: string | undefined;
    const siteSecondaryErrors: string[] = [];
    const finalizedDateSet = new Set<string>();
    const allDateSet = new Set<string>();

    // 1. Query daily site performance with `dataState: 'final'` AND `dataState: 'all'` to distinguish FINALIZED vs PRELIMINARY from source metadata
    try {
      const [finalResp, dailyResp] = await Promise.all([
        fetch(
          `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site.siteUrl)}/searchAnalytics/query`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              startDate: startStr,
              endDate: todayStr,
              dimensions: ['date'],
              dataState: 'final',
              rowLimit: 100,
            }),
          },
        ),
        fetch(
          `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site.siteUrl)}/searchAnalytics/query`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              startDate: startStr,
              endDate: todayStr,
              dimensions: ['date'],
              dataState: 'all',
              rowLimit: 100,
            }),
          },
        ),
      ]);

      if (finalResp.ok) {
        const finalData = (await finalResp.json()) as {
          rows?: Array<{ keys: string[] }>;
        };
        for (const r of finalData.rows || []) {
          const d = r.keys?.[0];
          if (d) finalizedDateSet.add(d);
        }
      }

      if (!dailyResp.ok) {
        const errText = await dailyResp.text();
        siteError = `Daily HTTP ${dailyResp.status}: ${errText.slice(0, 150)}`;
        await saveGscSiteDataStateMetadata({
          siteUrl: site.siteUrl,
          queriedStartDate: startStr,
          queriedEndDate: todayStr,
          queriedInclusiveDays: countInclusiveCalendarDays(startStr, todayStr),
          finalizedDates: [],
          preliminaryDates: [],
          lastQueryStatus: 'QUERY_ERROR',
          lastQueryError: siteError,
          updatedAt: new Date().toISOString(),
        });
      } else {
        const dailyData = (await dailyResp.json()) as {
          rows?: Array<{
            keys: string[];
            clicks: number;
            impressions: number;
            ctr: number;
            position: number;
          }>;
        };

        for (const row of dailyData.rows || []) {
          const rowDate = row.keys?.[0];
          if (!rowDate) continue;
          allDateSet.add(rowDate);
          await upsertPlatformMetricIdempotent(prisma, {
            platform: 'search_console',
            accountPropertyId: site.siteUrl,
            metricDate: rowDate,
            grain: 'account',
            clicks: row.clicks,
            impressions: row.impressions,
            avgPosition: Math.round(row.position * 10) / 10,
            isFinalized: isGscDateFinalized(rowDate, finalizedDateSet),
          });
          siteSynced++;
          synced++;
        }

        const preliminaryDates = Array.from(allDateSet).filter((d) => !finalizedDateSet.has(d)).sort();
        await saveGscSiteDataStateMetadata({
          siteUrl: site.siteUrl,
          queriedStartDate: startStr,
          queriedEndDate: todayStr,
          queriedInclusiveDays: countInclusiveCalendarDays(startStr, todayStr),
          finalizedDates: Array.from(finalizedDateSet).sort(),
          preliminaryDates,
          lastQueryStatus: 'OK',
          lastQueryError: null,
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      siteError = err instanceof Error ? err.message : 'Lỗi kết nối Search Console Daily';
      await saveGscSiteDataStateMetadata({
        siteUrl: site.siteUrl,
        queriedStartDate: startStr,
        queriedEndDate: todayStr,
        queriedInclusiveDays: countInclusiveCalendarDays(startStr, todayStr),
        finalizedDates: [],
        preliminaryDates: [],
        lastQueryStatus: 'QUERY_ERROR',
        lastQueryError: siteError,
        updatedAt: new Date().toISOString(),
      });
    }

    // 2. Query daily keyword facts with dimensions ["date", "query"] so keywords retain their TRUE source date
    if (!siteError) {
      try {
        const qResp = await fetch(
          `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site.siteUrl)}/searchAnalytics/query`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              startDate: startStr,
              endDate: todayStr,
              dimensions: ['date', 'query'], // Both date and query dimensions
              dataState: 'all',
              rowLimit: 1500,
            }),
          },
        );

        if (qResp.ok) {
          const qData = (await qResp.json()) as {
            rows?: Array<{
              keys: string[];
              clicks: number;
              impressions: number;
              ctr: number;
              position: number;
            }>;
          };

          const kwAggMap = new Map<string, { keyword: string; clicks: number; impressions: number; totalPos: number; count: number }>();

          for (const row of qData.rows || []) {
            const rowDate = row.keys?.[0];
            const kw = row.keys?.[1];
            if (!rowDate || !kw) continue;

            // Store daily keyword fact under actual source date!
            await upsertPlatformMetricIdempotent(prisma, {
              platform: 'search_console',
              accountPropertyId: site.siteUrl,
              metricDate: rowDate, // Actual source date
              grain: 'keyword',
              keywordRaw: kw,
              clicks: row.clicks,
              impressions: row.impressions,
              avgPosition: Math.round(row.position * 10) / 10,
              isFinalized: isGscDateFinalized(rowDate, finalizedDateSet),
            });
            siteSynced++;
            synced++;

            // Aggregate keyword across dates for 30-day SeoKeyword cache snapshot
            const norm = kw.toLowerCase().trim();
            const existing = kwAggMap.get(norm) || { keyword: kw, clicks: 0, impressions: 0, totalPos: 0, count: 0 };
            existing.clicks += row.clicks;
            existing.impressions += row.impressions;
            existing.totalPos += row.position;
            existing.count += 1;
            kwAggMap.set(norm, existing);
          }

          // Populate SeoKeyword cache with aggregated totals across the window
          for (const [norm, agg] of kwAggMap.entries()) {
            const avgPos = agg.count > 0 ? Math.round((agg.totalPos / agg.count) * 10) / 10 : 0;
            try {
              await prisma.seoKeyword.upsert({
                where: { keywordNorm: norm },
                update: {
                  cachedSearchVolume: agg.impressions,
                  cachedOrganicClicks: agg.clicks,
                  cachedAvgPosition: avgPos,
                  cacheSourceAccountKey: site.siteUrl,
                  cacheWindowStartDate: startStr,
                  cacheWindowEndDate: todayStr,
                  cacheRefreshedAt: new Date(),
                  trendDirection: agg.clicks > 0 ? 'rising' : 'stable',
                },
                create: {
                  keyword: agg.keyword,
                  keywordNorm: norm,
                  cachedSearchVolume: agg.impressions,
                  cachedOrganicClicks: agg.clicks,
                  cachedAvgPosition: avgPos,
                  cacheSourceAccountKey: site.siteUrl,
                  cacheWindowStartDate: startStr,
                  cacheWindowEndDate: todayStr,
                  cacheRefreshedAt: new Date(),
                  trendDirection: agg.clicks > 0 ? 'rising' : 'stable',
                },
              });
            } catch {
              // non-fatal cache refresh
            }
          }
        } else {
          const errText = await qResp.text();
          siteSecondaryErrors.push(`Từ khóa lỗi HTTP ${qResp.status}: ${errText.slice(0, 100)}`);
        }
      } catch (err) {
        siteSecondaryErrors.push(`Từ khóa lỗi kết nối: ${err instanceof Error ? err.message : 'Unknown'}`);
      }

      // 3. Query daily page facts with dimensions ["date", "page"] (M02-03)
      try {
        const pResp = await fetch(
          `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site.siteUrl)}/searchAnalytics/query`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              startDate: startStr,
              endDate: todayStr,
              dimensions: ['date', 'page'],
              dataState: 'all',
              rowLimit: 1000,
            }),
          },
        );
        if (pResp.ok) {
          const pData = (await pResp.json()) as {
            rows?: Array<{
              keys: string[];
              clicks: number;
              impressions: number;
              ctr: number;
              position: number;
            }>;
          };
          for (const row of pData.rows || []) {
            const rowDate = row.keys?.[0];
            const pageUrl = row.keys?.[1];
            if (!rowDate || !pageUrl) continue;
            await upsertPlatformMetricIdempotent(prisma, {
              platform: 'search_console',
              accountPropertyId: site.siteUrl,
              metricDate: rowDate,
              grain: 'page',
              pageUrlRaw: pageUrl,
              clicks: row.clicks,
              impressions: row.impressions,
              avgPosition: Math.round(row.position * 10) / 10,
              isFinalized: isGscDateFinalized(rowDate, finalizedDateSet),
            });
            siteSynced++;
            synced++;
          }
        } else {
          const errText = await pResp.text();
          siteSecondaryErrors.push(`Trang đích lỗi HTTP ${pResp.status}: ${errText.slice(0, 100)}`);
        }
      } catch (err) {
        siteSecondaryErrors.push(`Trang đích lỗi kết nối: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    }

    siteOutcomes.push({
      siteUrl: site.siteUrl,
      ok: !siteError,
      count: siteSynced,
      error: siteError,
      secondaryError: siteSecondaryErrors.length > 0 ? siteSecondaryErrors.join('; ') : undefined,
    });
  }

  const failedSites = siteOutcomes.filter((s) => !s.ok);
  const successSites = siteOutcomes.filter((s) => s.ok);
  const secondaryErrorSites = siteOutcomes.filter((s) => s.ok && s.secondaryError);

  // If ALL sites failed report requests, return failure!
  if (successSites.length === 0) {
    const errDetails = failedSites.map((s) => `${s.siteUrl}: ${s.error}`).join('; ');
    return {
      success: false,
      synced: 0,
      error: `Tất cả website Search Console đều bị lỗi truy vấn báo cáo (${errDetails})`,
    };
  }

  if (failedSites.length > 0 || secondaryErrorSites.length > 0) {
    const msgParts: string[] = [];
    if (failedSites.length > 0) {
      msgParts.push(`${failedSites.length} website bị lỗi chính (${failedSites.map((s) => s.siteUrl).join(', ')})`);
    }
    if (secondaryErrorSites.length > 0) {
      msgParts.push(`Báo cáo từ khóa bị gián đoạn: ${secondaryErrorSites.map((s) => `${s.siteUrl}: ${s.secondaryError}`).join('; ')}`);
    }
    return {
      success: true,
      synced,
      isPartial: true,
      error: `Đồng bộ một phần: ${msgParts.join(' | ')}`,
    };
  }

  return { success: true, synced, isEmpty: synced === 0 };
}

export type CampaignAttributionStatus =
  | 'SINGLE_WEBSITE'
  | 'MULTI_WEBSITE_UNSPLIT'
  | 'UNATTRIBUTED';

export interface CampaignWebsiteAttributionResult {
  status: CampaignAttributionStatus;
  domain: string | null;
  detectedDomains: string[];
}

export function classifyCampaignWebsiteAttribution(
  campaignName: string,
  finalUrls?: string[],
  existingSlug?: string | null,
): CampaignWebsiteAttributionResult {
  const uniqueHosts = new Set<string>();
  for (const rawUrl of finalUrls || []) {
    try {
      const host = new URL(rawUrl).hostname.replace(/^www\./i, '').toLowerCase();
      if (host) uniqueHosts.add(host);
    } catch {
      // ignore invalid url
    }
  }

  const detectedFromUrls = Array.from(uniqueHosts).sort();
  if (detectedFromUrls.length > 1) {
    return {
      status: 'MULTI_WEBSITE_UNSPLIT',
      domain: null,
      detectedDomains: detectedFromUrls,
    };
  }
  if (detectedFromUrls.length === 1) {
    return {
      status: 'SINGLE_WEBSITE',
      domain: detectedFromUrls[0],
      detectedDomains: detectedFromUrls,
    };
  }

  if (existingSlug === 'multi_website_unsplit') {
    return {
      status: 'MULTI_WEBSITE_UNSPLIT',
      domain: null,
      detectedDomains: [],
    };
  }
  if (existingSlug && existingSlug.startsWith('domain:')) {
    const dom = existingSlug.slice('domain:'.length).trim().toLowerCase();
    if (dom) {
      return {
        status: 'SINGLE_WEBSITE',
        domain: dom,
        detectedDomains: [dom],
      };
    }
  }

  const lower = (campaignName || '').toLowerCase();
  const matchedByName = new Set<string>();
  if (lower.includes('bangdientu')) matchedByName.add('bangdientu.com.vn');
  if (lower.includes('bangled')) matchedByName.add('bangled.vn');
  if (lower.includes('manhinhled')) matchedByName.add('manhinhled.net.vn');
  if (lower.includes('toantrung') || lower.includes('tđtt') || lower.includes('tdtt') || lower.endsWith('_tt')) {
    matchedByName.add('toantrung.com.vn');
  }

  const nameDomains = Array.from(matchedByName);
  if (nameDomains.length > 1) {
    return {
      status: 'MULTI_WEBSITE_UNSPLIT',
      domain: null,
      detectedDomains: nameDomains,
    };
  }
  if (nameDomains.length === 1) {
    return {
      status: 'SINGLE_WEBSITE',
      domain: nameDomains[0],
      detectedDomains: nameDomains,
    };
  }

  return {
    status: 'UNATTRIBUTED',
    domain: null,
    detectedDomains: [],
  };
}

function inferDomainFromCampaignMetadata(campaignName: string, finalUrls?: string[]): string | null {
  const classified = classifyCampaignWebsiteAttribution(campaignName, finalUrls);
  return classified.status === 'SINGLE_WEBSITE' ? classified.domain : null;
}

async function fetchGoogleAdsWithFallback(
  relativePath: string,
  init: RequestInit,
): Promise<Response> {
  let lastRes: Response | null = null;
  for (const apiVer of ['v26', 'v25', 'v24']) {
    const res = await fetch(`https://googleads.googleapis.com/${apiVer}/${relativePath}`, init);
    lastRes = res;
    if (res.status !== 404) return res;
  }
  return lastRes!;
}

async function syncRealGoogleAds(
  token: string,
  conn: StoredGoogleConnection | null,
  adsCfg: StoredGoogleAdsApiConfig | null,
  windowDays = 30,
): Promise<{ success: boolean; synced: number; error?: string }> {
  const dateRange = getCanonicalDateRange(windowDays);
  const startStr = dateRange.startDateStr;
  const endStr = dateRange.endDateStr;

  const baseHeaders: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  if (adsCfg?.developerToken) {
    baseHeaders['developer-token'] = adsCfg.developerToken;
  }
  if (adsCfg?.loginCustomerId) {
    baseHeaders['login-customer-id'] = adsCfg.loginCustomerId;
  }

  let targetCustomerId =
    adsCfg?.customerId ||
    normalizeDigitsId(conn?.selectedGadsCustomerId) ||
    normalizeDigitsId(conn?.detectedGadsCustomerId);

  if (!targetCustomerId) {
    const listRes = await fetchGoogleAdsWithFallback('customers:listAccessibleCustomers', {
      headers: baseHeaders,
    });
    if (!listRes.ok) {
      const errTxt = await listRes.text();
      return {
        success: false,
        synced: 0,
        error: `Google Ads listAccessibleCustomers (${listRes.status}): ${errTxt.slice(0, 200)}`,
      };
    }
    const listJson = (await listRes.json()) as { resourceNames?: string[] };
    const first = listJson.resourceNames?.[0]?.replace('customers/', '').replace(/\D/g, '');
    if (!first) {
      return {
        success: false,
        synced: 0,
        error: 'Tài khoản Google này chưa có quyền truy cập vào tài khoản Google Ads nào.',
      };
    }
    targetCustomerId = first;
    if (conn) {
      conn.detectedGadsCustomerId = first;
      if (!conn.selectedGadsCustomerId) {
        conn.selectedGadsCustomerId = first;
      }
      const hasCustResource = conn.accessibleResources?.some(
        (r) => r.type === 'GOOGLE_ADS_CUSTOMER' && r.id === first,
      );
      if (!hasCustResource) {
        conn.accessibleResources = [
          ...(conn.accessibleResources || []),
          {
            id: first,
            name: `Khách hàng Google Ads ${first}`,
            type: 'GOOGLE_ADS_CUSTOMER',
            permissionLevel: 'Viewer (Read-Only)',
            isAccessible: true,
          },
        ];
      }
      await saveGoogleConnection(conn).catch(() => null);
    }
  }

  // Step A: Sync campaign catalog + ad landing final_urls (captures PAUSED campaigns with 0 daily metrics)
  const finalUrlsByCampaign = new Map<string, string[]>();
  const urlsGaql =
    `SELECT campaign.id, ad_group_ad.ad.final_urls FROM ad_group_ad WHERE campaign.status != 'REMOVED' AND ad_group_ad.status != 'REMOVED'`;
  const urlsRes = await fetchGoogleAdsWithFallback(`customers/${targetCustomerId}/googleAds:search`, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({ query: urlsGaql }),
  });
  if (urlsRes.ok) {
    const urlsJson = (await urlsRes.json()) as {
      results?: Array<{
        campaign?: { id?: string };
        adGroupAd?: { ad?: { finalUrls?: string[] } };
      }>;
    };
    for (const row of urlsJson.results || []) {
      const cid = String(row.campaign?.id || '').trim();
      const urls = row.adGroupAd?.ad?.finalUrls || [];
      if (!cid || urls.length === 0) continue;
      const existing = finalUrlsByCampaign.get(cid) || [];
      for (const u of urls) {
        if (!existing.includes(u)) existing.push(u);
      }
      finalUrlsByCampaign.set(cid, existing);
    }
  }

  // Fallback for PMax/DemandGen/Video campaigns lacking ad_group_ad.ad.final_urls
  try {
    const lpViewGaql = `SELECT campaign.id, landing_page_view.unexpanded_final_url FROM landing_page_view WHERE segments.date DURING LAST_30_DAYS`;
    const lpViewRes = await fetchGoogleAdsWithFallback(
      `customers/${targetCustomerId}/googleAds:search`,
      {
        method: 'POST',
        headers: baseHeaders,
        body: JSON.stringify({ query: lpViewGaql }),
      },
    );
    if (lpViewRes.ok) {
      const lpJson = (await lpViewRes.json()) as {
        results?: Array<{
          campaign?: { id?: string };
          landingPageView?: { unexpandedFinalUrl?: string };
        }>;
      };
      for (const row of lpJson.results || []) {
        const cid = String(row.campaign?.id || '').trim();
        const url = String(row.landingPageView?.unexpandedFinalUrl || '').trim();
        if (!cid || !url) continue;
        const existing = finalUrlsByCampaign.get(cid) || [];
        if (!existing.includes(url)) existing.push(url);
        finalUrlsByCampaign.set(cid, existing);
      }
    }
  } catch {
    // non-fatal
  }

  if (finalUrlsByCampaign.size > 0) {
    await mergeAndPersistCampaignFinalUrls(finalUrlsByCampaign);
  }

  const catalogGaql =
    `SELECT campaign.id, campaign.name, campaign.status, campaign_budget.amount_micros FROM campaign WHERE campaign.status != 'REMOVED'`;
  const catalogRes = await fetchGoogleAdsWithFallback(`customers/${targetCustomerId}/googleAds:search`, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({ query: catalogGaql }),
  });
  if (!catalogRes.ok) {
    const errTxt = await catalogRes.text();
    return {
      success: false,
      synced: 0,
      error: `Google Ads API (${catalogRes.status}) cho Customer ${targetCustomerId}: ${errTxt.slice(0, 220)}`,
    };
  }

  const catalogData = (await catalogRes.json()) as {
    results?: Array<{
      campaign?: { id?: string; name?: string; status?: string };
      campaignBudget?: { amountMicros?: string | number };
    }>;
  };

  let synced = 0;
  const domainByCampaignId = new Map<string, string | null>();
  for (const row of catalogData.results || []) {
    const extId = String(row.campaign?.id || '').trim();
    const campName = String(row.campaign?.name || `Chiến dịch #${extId}`).trim();
    if (!extId) continue;

    const attribution = classifyCampaignWebsiteAttribution(
      campName,
      finalUrlsByCampaign.get(extId),
    );
    const resolvedDomain = attribution.status === 'SINGLE_WEBSITE' ? attribution.domain : null;
    const slugToPersist =
      attribution.status === 'MULTI_WEBSITE_UNSPLIT'
        ? 'multi_website_unsplit'
        : resolvedDomain
          ? `domain:${resolvedDomain}`
          : null;
    domainByCampaignId.set(extId, resolvedDomain);

    const campCode = `GADS_${extId}`;
    const isActive = row.campaign?.status === 'ENABLED';
    const budgetMicros = row.campaignBudget?.amountMicros
      ? BigInt(String(row.campaignBudget.amountMicros))
      : null;

    await prisma.campaign.upsert({
      where: {
        uq_campaign_platform_account_code: {
          platform: 'google_ads',
          accountExternalId: targetCustomerId,
          campaignCode: campCode,
        },
      },
      update: {
        campaignName: campName,
        isActive,
        ...(budgetMicros !== null ? { dailyBudgetMicros: budgetMicros } : {}),
        ...(slugToPersist ? { utmCampaignSlug: slugToPersist } : {}),
      },
      create: {
        campaignCode: campCode,
        campaignName: campName,
        platform: 'google_ads',
        accountExternalId: targetCustomerId,
        isActive,
        dailyBudgetMicros: budgetMicros,
        utmCampaignSlug: slugToPersist,
      },
    });
    synced += 1;
  }

  // Step B: Sync daily campaign performance metrics within window
  const gaql = `SELECT campaign.id, campaign.name, campaign.status, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${startStr}' AND '${endStr}'`;
  const searchRes = await fetchGoogleAdsWithFallback(`customers/${targetCustomerId}/googleAds:search`, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({ query: gaql }),
  });

  if (!searchRes.ok) {
    const errTxt = await searchRes.text();
    return {
      success: false,
      synced,
      error: `Google Ads metrics (${searchRes.status}) cho Customer ${targetCustomerId}: ${errTxt.slice(0, 220)}`,
    };
  }

  const data = (await searchRes.json()) as {
    results?: Array<{
      campaign?: { id?: string; name?: string; status?: string };
      segments?: { date?: string };
      metrics?: {
        impressions?: string | number;
        clicks?: string | number;
        costMicros?: string | number;
        conversions?: number;
      };
    }>;
  };

  // Remove legacy domain-suffixed fingerprints on campaign grain to enforce strict 1-to-1 idempotency per (campaign, date)
  await prisma.platformDailyMetric.deleteMany({
    where: {
      platform: 'google_ads',
      accountPropertyId: targetCustomerId,
      grain: 'campaign',
      metricDate: { gte: startStr, lte: endStr },
      NOT: { pagePathNorm: '' },
    },
  });

  for (const row of data.results || []) {
    const extId = String(row.campaign?.id || '').trim();
    const campName = String(row.campaign?.name || `Chiến dịch #${extId}`).trim();
    const metricDate = String(row.segments?.date || '').trim();
    if (!extId || !metricDate) continue;

    const resolvedDomain =
      domainByCampaignId.get(extId) ?? inferDomainFromCampaignMetadata(campName);
    const campCode = `GADS_${extId}`;
    const isActive = row.campaign?.status === 'ENABLED';
    const campRecord = await prisma.campaign.upsert({
      where: {
        uq_campaign_platform_account_code: {
          platform: 'google_ads',
          accountExternalId: targetCustomerId,
          campaignCode: campCode,
        },
      },
      update: {
        campaignName: campName,
        isActive,
      },
      create: {
        campaignCode: campCode,
        campaignName: campName,
        platform: 'google_ads',
        accountExternalId: targetCustomerId,
        isActive,
        utmCampaignSlug: resolvedDomain ? `domain:${resolvedDomain}` : null,
      },
    });

    const impressions = Number(row.metrics?.impressions || 0);
    const clicks = Number(row.metrics?.clicks || 0);
    const spendMicros = BigInt(String(row.metrics?.costMicros || '0'));
    const conversionsVal = Number(row.metrics?.conversions || 0);
    const conversionsMicros = BigInt(Math.round(conversionsVal * 1_000_000));

    await upsertPlatformMetricIdempotent(prisma, {
      platform: 'google_ads',
      accountPropertyId: targetCustomerId,
      metricDate,
      grain: 'campaign',
      campaignId: campRecord.id,
      campaignExternalId: extId,
      impressions,
      clicks,
      spendMicros,
      conversionsMicros,
      isFinalized: false,
    });
    synced += 1;
  }

  return { success: true, synced };
}

function triggerBackgroundFinalUrlsRefresh(): void {
  if (process.env.NODE_TEST_CONTEXT) return;
  if (globalGadsFinalUrls.__toantrungGadsFinalUrlsInFlight) return;

  const p = (async () => {
    try {
      const [token, conn, adsCfg] = await Promise.all([
        getValidAccessToken(),
        getGoogleConnection(),
        getGoogleAdsApiConfig(),
      ]);
      if (!token || token === 'DEMO_SANDBOX_TOKEN') return getFinalUrlsMemCache().byCampaignId;
      const targetCustomerId =
        adsCfg?.customerId ||
        normalizeDigitsId(conn?.selectedGadsCustomerId) ||
        normalizeDigitsId(conn?.detectedGadsCustomerId);
      if (!targetCustomerId) {
        return getFinalUrlsMemCache().byCampaignId;
      }

      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      };
      if (adsCfg?.developerToken) {
        headers['developer-token'] = adsCfg.developerToken;
      }
      if (adsCfg?.loginCustomerId) {
        headers['login-customer-id'] = adsCfg.loginCustomerId;
      }

      const map = new Map<string, string[]>();
      const urlsRes = await fetchGoogleAdsWithFallback(
        `customers/${targetCustomerId}/googleAds:search`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            query: `SELECT campaign.id, ad_group_ad.ad.final_urls FROM ad_group_ad WHERE campaign.status != 'REMOVED' AND ad_group_ad.status != 'REMOVED'`,
          }),
        },
      );
      if (urlsRes.ok) {
        const urlsJson = (await urlsRes.json()) as {
          results?: Array<{
            campaign?: { id?: string };
            adGroupAd?: { ad?: { finalUrls?: string[] } };
          }>;
        };
        for (const row of urlsJson.results || []) {
          const cid = String(row.campaign?.id || '').trim();
          const urls = row.adGroupAd?.ad?.finalUrls || [];
          if (!cid || urls.length === 0) continue;
          const existing = map.get(cid) || [];
          for (const u of urls) {
            if (!existing.includes(u)) existing.push(u);
          }
          map.set(cid, existing);
        }
      }

      try {
        const lpRes = await fetchGoogleAdsWithFallback(
          `customers/${targetCustomerId}/googleAds:search`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              query: `SELECT campaign.id, landing_page_view.unexpanded_final_url FROM landing_page_view WHERE segments.date DURING LAST_30_DAYS`,
            }),
          },
        );
        if (lpRes.ok) {
          const lpJson = (await lpRes.json()) as {
            results?: Array<{
              campaign?: { id?: string };
              landingPageView?: { unexpandedFinalUrl?: string };
            }>;
          };
          for (const row of lpJson.results || []) {
            const cid = String(row.campaign?.id || '').trim();
            const url = String(row.landingPageView?.unexpandedFinalUrl || '').trim();
            if (!cid || !url) continue;
            const existing = map.get(cid) || [];
            if (!existing.includes(url)) existing.push(url);
            map.set(cid, existing);
          }
        }
      } catch {
        // non-fatal
      }

      if (map.size > 0) {
        const merged = await mergeAndPersistCampaignFinalUrls(map);
        bumpDomainRevisions(['tracking', 'ads'], 'google_ads_final_urls_synced');
        return merged;
      }
      getFinalUrlsMemCache().updatedAtMs = Date.now();
      return getFinalUrlsMemCache().byCampaignId;
    } catch {
      return getFinalUrlsMemCache().byCampaignId;
    } finally {
      globalGadsFinalUrls.__toantrungGadsFinalUrlsInFlight = null;
    }
  })();

  globalGadsFinalUrls.__toantrungGadsFinalUrlsInFlight = p;
}

export async function getCampaignFinalUrlsMapNonBlocking(): Promise<Record<string, string[]>> {
  const mem = getFinalUrlsMemCache();
  if (!mem.hydrated) {
    mem.hydrated = true;
    try {
      const row = await prisma.systemSetting.findUnique({
        where: { key: SETTING_KEY_GADS_FINAL_URLS },
      });
      if (row?.value) {
        const parsed = JSON.parse(row.value) as StoredCampaignFinalUrlsPayload;
        if (parsed?.byCampaignId && typeof parsed.byCampaignId === 'object') {
          mem.byCampaignId = parsed.byCampaignId;
          mem.updatedAtMs = parsed.updatedAt ? new Date(parsed.updatedAt).getTime() || 0 : 0;
        }
      }
    } catch {
      // ignore
    }
  }

  const sixHoursMs = 6 * 60 * 60 * 1000;
  if (
    Object.keys(mem.byCampaignId).length === 0 ||
    Date.now() - mem.updatedAtMs > sixHoursMs
  ) {
    triggerBackgroundFinalUrlsRefresh();
  }

  return mem.byCampaignId;
}
