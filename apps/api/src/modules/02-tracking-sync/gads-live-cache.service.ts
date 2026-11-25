import { prisma } from '@toantrung/database';
import type {
  M02AdsLandingPageRowDto,
  M02AdsSearchTermRowDto,
  M02AdsTimeScheduleRowDto,
} from '@toantrung/contracts';
import { bumpDomainRevisions } from '../../core/cache/server-data-cache';
import {
  getGoogleAdsApiConfig,
  getGoogleConnection,
  getValidAccessToken,
} from './google-oauth.service';

export interface GadsCampaignDailyItem {
  campaignId: string;
  campaignName: string;
  status: string;
  date: string;
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
}

export interface GadsAdGroupItem {
  adGroupId: string;
  adGroupName: string;
  campaignName: string;
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
  cpa: number | null;
}

export interface GadsKeywordItem {
  keywordText: string;
  matchType: string;
  adGroupName: string;
  campaignName: string;
  impressions: number;
  clicks: number;
  ctrPct: number | null;
  cost: number;
  conversions: number;
}

export interface GoogleAdsLivePeriodSnapshot {
  customerId: string;
  startDate: string;
  endDate: string;
  fetchedAt: string;
  campaignDaily: GadsCampaignDailyItem[];
  adGroups: GadsAdGroupItem[];
  keywords: GadsKeywordItem[];
  searchTerms: M02AdsSearchTermRowDto[];
  landingPages: M02AdsLandingPageRowDto[];
  devices: Array<{ device: string; cost: number; clicks: number; impressions: number }>;
  timeSchedule: M02AdsTimeScheduleRowDto[];
}

const GADS_CACHE_TTL_MS = 5 * 60 * 1000;
const GADS_MAX_CACHE_ENTRIES = 30;
const DB_GADS_CACHE_KEY = 'google_ads_live_snapshot_cache_v1';

interface GlobalGadsStore {
  memCache: Map<string, { expiresAt: number; data: GoogleAdsLivePeriodSnapshot }>;
  inFlight: Map<string, Promise<GoogleAdsLivePeriodSnapshot | null>>;
  backoffUntil: Map<string, { untilMs: number; failures: number }>;
  dbHydrated: boolean;
  dbHydratePromise: Promise<void> | null;
  persistTimer: ReturnType<typeof setTimeout> | null;
}

const globalGadsObj = globalThis as unknown as {
  __toantrungGadsLiveCache?: GlobalGadsStore;
};

function getGadsStore(): GlobalGadsStore {
  if (!globalGadsObj.__toantrungGadsLiveCache) {
    globalGadsObj.__toantrungGadsLiveCache = {
      memCache: new Map(),
      inFlight: new Map(),
      backoffUntil: new Map(),
      dbHydrated: false,
      dbHydratePromise: null,
      persistTimer: null,
    };
  }
  return globalGadsObj.__toantrungGadsLiveCache;
}

function toVndFromMicros(raw: unknown): number {
  const num = Number(raw || 0);
  if (!Number.isFinite(num)) return 0;
  return Number((num / 1_000_000).toFixed(2));
}

function toNum(raw: unknown): number {
  const num = Number(raw || 0);
  return Number.isFinite(num) ? num : 0;
}

const DEVICE_VI_MAP: Record<string, string> = {
  MOBILE: 'Điện thoại di động',
  DESKTOP: 'Máy tính',
  TABLET: 'Máy tính bảng',
  CONNECTED_TV: 'TV kết nối',
  OTHER: 'Thiết bị khác',
};

const DOW_VI_MAP: Record<string, string> = {
  MONDAY: 'Thứ 2',
  TUESDAY: 'Thứ 3',
  WEDNESDAY: 'Thứ 4',
  THURSDAY: 'Thứ 5',
  FRIDAY: 'Thứ 6',
  SATURDAY: 'Thứ 7',
  SUNDAY: 'Chủ nhật',
};

// ============================================================================
// Pure GAQL Parsers (exported for testing & reuse)
// ============================================================================

export function parseGadsCampaignDailyRows(
  results: Array<Record<string, unknown>>,
): GadsCampaignDailyItem[] {
  const out: GadsCampaignDailyItem[] = [];
  for (const row of results || []) {
    const camp = (row.campaign || {}) as Record<string, unknown>;
    const seg = (row.segments || {}) as Record<string, unknown>;
    const met = (row.metrics || {}) as Record<string, unknown>;
    const cid = String(camp.id || '').trim();
    const date = String(seg.date || '').trim();
    if (!cid || !date) continue;
    out.push({
      campaignId: cid,
      campaignName: String(camp.name || `Chiến dịch #${cid}`).trim(),
      status: String(camp.status || 'ENABLED').trim(),
      date,
      cost: Math.round(toVndFromMicros(met.costMicros)),
      impressions: Math.round(toNum(met.impressions)),
      clicks: Math.round(toNum(met.clicks)),
      conversions: Number(toNum(met.conversions).toFixed(2)),
    });
  }
  return out;
}

export function parseGadsAdGroupRows(
  results: Array<Record<string, unknown>>,
): GadsAdGroupItem[] {
  const map = new Map<string, GadsAdGroupItem>();
  for (const row of results || []) {
    const ag = (row.adGroup || {}) as Record<string, unknown>;
    const camp = (row.campaign || {}) as Record<string, unknown>;
    const met = (row.metrics || {}) as Record<string, unknown>;
    const agId = String(ag.id || '').trim();
    const agName = String(ag.name || '').trim();
    if (!agName && !agId) continue;
    const key = agId || `${String(camp.name || '')}::${agName}`;
    const cur = map.get(key) || {
      adGroupId: agId || agName,
      adGroupName: agName || `Nhóm QC #${agId}`,
      campaignName: String(camp.name || 'Chiến dịch').trim(),
      cost: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      cpa: null,
    };
    cur.cost += toVndFromMicros(met.costMicros);
    cur.impressions += Math.round(toNum(met.impressions));
    cur.clicks += Math.round(toNum(met.clicks));
    cur.conversions += toNum(met.conversions);
    map.set(key, cur);
  }
  return Array.from(map.values())
    .map((item) => ({
      ...item,
      cost: Math.round(item.cost),
      conversions: Number(item.conversions.toFixed(2)),
      cpa: item.conversions > 0 ? Math.round(item.cost / item.conversions) : null,
    }))
    .sort((a, b) => b.cost - a.cost || b.clicks - a.clicks)
    .slice(0, 60);
}

export function parseGadsKeywordRows(
  results: Array<Record<string, unknown>>,
): GadsKeywordItem[] {
  const map = new Map<string, GadsKeywordItem>();
  for (const row of results || []) {
    const crit = (row.adGroupCriterion || {}) as Record<string, unknown>;
    const kwObj = (crit.keyword || {}) as Record<string, unknown>;
    const ag = (row.adGroup || {}) as Record<string, unknown>;
    const camp = (row.campaign || {}) as Record<string, unknown>;
    const met = (row.metrics || {}) as Record<string, unknown>;
    const kwText = String(kwObj.text || '').trim();
    if (!kwText) continue;
    const matchType = String(kwObj.matchType || 'BROAD').trim();
    const campaignName = String(camp.name || 'Chiến dịch').trim();
    const adGroupName = String(ag.name || 'Nhóm quảng cáo').trim();
    const key = `${campaignName}::${adGroupName}::${kwText}::${matchType}`;
    const cur = map.get(key) || {
      keywordText: kwText,
      matchType,
      adGroupName,
      campaignName,
      impressions: 0,
      clicks: 0,
      ctrPct: null,
      cost: 0,
      conversions: 0,
    };
    cur.impressions += Math.round(toNum(met.impressions));
    cur.clicks += Math.round(toNum(met.clicks));
    cur.cost += toVndFromMicros(met.costMicros);
    cur.conversions += toNum(met.conversions);
    map.set(key, cur);
  }
  return Array.from(map.values())
    .map((item) => ({
      ...item,
      cost: Math.round(item.cost),
      conversions: Number(item.conversions.toFixed(2)),
      ctrPct:
        item.impressions > 0
          ? Number(((item.clicks / item.impressions) * 100).toFixed(2))
          : null,
    }))
    .sort((a, b) => b.cost - a.cost || b.clicks - a.clicks)
    .slice(0, 100);
}

export function parseGadsSearchTermRows(
  results: Array<Record<string, unknown>>,
): M02AdsSearchTermRowDto[] {
  const map = new Map<string, M02AdsSearchTermRowDto>();
  for (const row of results || []) {
    const stv = (row.searchTermView || {}) as Record<string, unknown>;
    const ag = (row.adGroup || {}) as Record<string, unknown>;
    const camp = (row.campaign || {}) as Record<string, unknown>;
    const met = (row.metrics || {}) as Record<string, unknown>;
    const searchTerm = String(stv.searchTerm || '').trim();
    if (!searchTerm) continue;
    const campaignName = String(camp.name || 'Chiến dịch').trim();
    const adGroupName = String(ag.name || 'Nhóm quảng cáo').trim();
    const key = `${campaignName}::${adGroupName}::${searchTerm.toLowerCase()}`;
    const cur = map.get(key) || {
      searchTerm,
      campaignName,
      adGroupName,
      status: String(stv.status || 'NONE').trim(),
      impressions: 0,
      clicks: 0,
      ctrPct: null,
      cost: 0,
      conversions: 0,
    };
    cur.impressions += Math.round(toNum(met.impressions));
    cur.clicks += Math.round(toNum(met.clicks));
    cur.cost += toVndFromMicros(met.costMicros);
    cur.conversions += toNum(met.conversions);
    map.set(key, cur);
  }
  return Array.from(map.values())
    .map((item) => ({
      ...item,
      cost: Math.round(item.cost),
      conversions: Number(item.conversions.toFixed(2)),
      ctrPct:
        item.impressions > 0
          ? Number(((item.clicks / item.impressions) * 100).toFixed(2))
          : null,
    }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, 150);
}

export function parseGadsLandingPageRows(
  results: Array<Record<string, unknown>>,
): M02AdsLandingPageRowDto[] {
  const map = new Map<string, M02AdsLandingPageRowDto>();
  for (const row of results || []) {
    const lpv = (row.landingPageView || {}) as Record<string, unknown>;
    const camp = (row.campaign || {}) as Record<string, unknown>;
    const met = (row.metrics || {}) as Record<string, unknown>;
    const url = String(lpv.unexpandedFinalUrl || '').trim();
    if (!url) continue;
    const campaignName = String(camp.name || 'Chiến dịch').trim();
    const key = `${url}::${campaignName}`;
    const cur = map.get(key) || {
      url,
      campaignName,
      clicks: 0,
      impressions: 0,
      ctrPct: null,
      avgCpc: null,
      cost: 0,
      conversions: 0,
    };
    cur.clicks += Math.round(toNum(met.clicks));
    cur.impressions += Math.round(toNum(met.impressions));
    cur.cost += toVndFromMicros(met.costMicros);
    cur.conversions += toNum(met.conversions);
    map.set(key, cur);
  }
  return Array.from(map.values())
    .map((item) => ({
      ...item,
      cost: Math.round(item.cost),
      conversions: Number(item.conversions.toFixed(2)),
      ctrPct:
        item.impressions > 0
          ? Number(((item.clicks / item.impressions) * 100).toFixed(2))
          : null,
      avgCpc: item.clicks > 0 ? Math.round(item.cost / item.clicks) : null,
    }))
    .sort((a, b) => b.cost - a.cost || b.clicks - a.clicks)
    .slice(0, 100);
}

export function parseGadsDeviceRows(
  results: Array<Record<string, unknown>>,
): Array<{ device: string; cost: number; clicks: number; impressions: number }> {
  const map = new Map<string, { device: string; cost: number; clicks: number; impressions: number }>();
  for (const row of results || []) {
    const seg = (row.segments || {}) as Record<string, unknown>;
    const met = (row.metrics || {}) as Record<string, unknown>;
    const rawDev = String(seg.device || 'OTHER').toUpperCase();
    const label = DEVICE_VI_MAP[rawDev] || rawDev;
    const cur = map.get(label) || { device: label, cost: 0, clicks: 0, impressions: 0 };
    cur.cost += toVndFromMicros(met.costMicros);
    cur.clicks += Math.round(toNum(met.clicks));
    cur.impressions += Math.round(toNum(met.impressions));
    map.set(label, cur);
  }
  return Array.from(map.values())
    .map((d) => ({ ...d, cost: Math.round(d.cost) }))
    .sort((a, b) => b.cost - a.cost || b.clicks - a.clicks);
}

export function parseGadsTimeScheduleRows(
  results: Array<Record<string, unknown>>,
): M02AdsTimeScheduleRowDto[] {
  const map = new Map<string, M02AdsTimeScheduleRowDto>();
  for (const row of results || []) {
    const seg = (row.segments || {}) as Record<string, unknown>;
    const met = (row.metrics || {}) as Record<string, unknown>;
    const rawDow = String(seg.dayOfWeek || '').toUpperCase();
    const hour = Number(seg.hour);
    if (!rawDow || !Number.isFinite(hour)) continue;
    const dayLabel = DOW_VI_MAP[rawDow] || rawDow;
    const key = `${rawDow}:${hour}`;
    const cur = map.get(key) || {
      dayOfWeek: dayLabel,
      hour,
      clicks: 0,
      impressions: 0,
      cost: 0,
      conversions: 0,
    };
    cur.clicks += Math.round(toNum(met.clicks));
    cur.impressions += Math.round(toNum(met.impressions));
    cur.cost += toVndFromMicros(met.costMicros);
    cur.conversions += toNum(met.conversions);
    map.set(key, cur);
  }
  return Array.from(map.values())
    .map((x) => ({
      ...x,
      cost: Math.round(x.cost),
      conversions: Number(x.conversions.toFixed(2)),
    }))
    .filter((x) => x.impressions > 0 || x.clicks > 0 || x.cost > 0)
    .sort((a, b) => b.clicks - a.clicks || b.cost - a.cost)
    .slice(0, 60);
}

// ============================================================================
// DB Cache Hydration & Persistence (SystemSetting JSON)
// ============================================================================

async function hydrateGadsFromDbIfNeeded(): Promise<void> {
  const store = getGadsStore();
  if (store.dbHydrated) return;
  if (store.dbHydratePromise) return store.dbHydratePromise;

  const p = (async () => {
    try {
      const row = await prisma.systemSetting.findUnique({
        where: { key: DB_GADS_CACHE_KEY },
      });
      if (row?.value) {
        const parsed = JSON.parse(row.value) as Record<string, GoogleAdsLivePeriodSnapshot>;
        const now = Date.now();
        for (const [k, snap] of Object.entries(parsed)) {
          if (snap?.fetchedAt) {
            const age = now - new Date(snap.fetchedAt).getTime();
            if (Number.isFinite(age) && age < 30 * 24 * 60 * 60 * 1000) {
              store.memCache.set(k, {
                expiresAt: age < GADS_CACHE_TTL_MS ? now + GADS_CACHE_TTL_MS - age : now - 1,
                data: snap,
              });
            }
          }
        }
      }
    } catch {
      // ignore corrupt setting
    } finally {
      store.dbHydrated = true;
      store.dbHydratePromise = null;
    }
  })();

  store.dbHydratePromise = p;
  return p;
}

function pruneGadsMemCache(): void {
  const store = getGadsStore();
  const now = Date.now();
  for (const [k, v] of store.memCache.entries()) {
    const fetchedMs = new Date(v.data.fetchedAt).getTime();
    if (!Number.isFinite(fetchedMs) || now - fetchedMs > 30 * 24 * 60 * 60 * 1000) {
      store.memCache.delete(k);
    }
  }
  while (store.memCache.size > GADS_MAX_CACHE_ENTRIES) {
    const oldest = store.memCache.keys().next().value;
    if (oldest === undefined) break;
    store.memCache.delete(oldest);
  }
}

function schedulePersistGadsCache(): void {
  const store = getGadsStore();
  if (store.persistTimer) return;
  store.persistTimer = setTimeout(() => {
    store.persistTimer = null;
    void (async () => {
      try {
        pruneGadsMemCache();
        const out: Record<string, GoogleAdsLivePeriodSnapshot> = {};
        for (const [k, entry] of store.memCache.entries()) {
          out[k] = entry.data;
        }
        await prisma.systemSetting.upsert({
          where: { key: DB_GADS_CACHE_KEY },
          update: { value: JSON.stringify(out) },
          create: { key: DB_GADS_CACHE_KEY, value: JSON.stringify(out) },
        });
      } catch {
        // ignore
      }
    })();
  }, 1500);
  store.persistTimer.unref?.();
}

async function runGaqlQuery(
  customerId: string,
  headers: Record<string, string>,
  query: string,
): Promise<Array<Record<string, unknown>> | null> {
  for (const ver of ['v26', 'v25', 'v24']) {
    try {
      const res = await fetch(
        `https://googleads.googleapis.com/${ver}/customers/${customerId}/googleAds:search`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ query }),
          signal: AbortSignal.timeout(10000),
        },
      );
      if (res.status === 404) continue;
      if (!res.ok) return null;
      const json = (await res.json()) as { results?: Array<Record<string, unknown>> };
      return json.results || [];
    } catch {
      return null;
    }
  }
  return null;
}

async function fetchLiveGoogleAdsPeriod(
  customerId: string,
  startDate: string,
  endDate: string,
  headers: Record<string, string>,
): Promise<GoogleAdsLivePeriodSnapshot | null> {
  const qCampaignDaily = `SELECT campaign.id, campaign.name, campaign.status, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`;
  const qAdGroups = `SELECT ad_group.id, ad_group.name, campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM ad_group WHERE segments.date BETWEEN '${startDate}' AND '${endDate}' ORDER BY metrics.cost_micros DESC LIMIT 80`;
  const qKeywords = `SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group.name, campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM keyword_view WHERE segments.date BETWEEN '${startDate}' AND '${endDate}' ORDER BY metrics.cost_micros DESC LIMIT 120`;
  const qSearchTerms = `SELECT search_term_view.search_term, search_term_view.status, ad_group.name, campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM search_term_view WHERE segments.date BETWEEN '${startDate}' AND '${endDate}' ORDER BY metrics.impressions DESC LIMIT 150`;
  const qLandingPages = `SELECT landing_page_view.unexpanded_final_url, campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM landing_page_view WHERE segments.date BETWEEN '${startDate}' AND '${endDate}' ORDER BY metrics.clicks DESC LIMIT 100`;
  const qDevices = `SELECT segments.device, metrics.impressions, metrics.clicks, metrics.cost_micros FROM campaign WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`;
  const qTimeSchedule = `SELECT segments.day_of_week, segments.hour, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`;

  const [resDaily, resAg, resKw, resSt, resLp, resDev, resTime] = await Promise.all([
    runGaqlQuery(customerId, headers, qCampaignDaily),
    runGaqlQuery(customerId, headers, qAdGroups),
    runGaqlQuery(customerId, headers, qKeywords),
    runGaqlQuery(customerId, headers, qSearchTerms),
    runGaqlQuery(customerId, headers, qLandingPages),
    runGaqlQuery(customerId, headers, qDevices),
    runGaqlQuery(customerId, headers, qTimeSchedule),
  ]);

  if (
    resDaily === null &&
    resAg === null &&
    resKw === null &&
    resSt === null &&
    resLp === null &&
    resDev === null &&
    resTime === null
  ) {
    return null;
  }

  return {
    customerId,
    startDate,
    endDate,
    fetchedAt: new Date().toISOString(),
    campaignDaily: parseGadsCampaignDailyRows(resDaily || []),
    adGroups: parseGadsAdGroupRows(resAg || []),
    keywords: parseGadsKeywordRows(resKw || []),
    searchTerms: parseGadsSearchTermRows(resSt || []),
    landingPages: parseGadsLandingPageRows(resLp || []),
    devices: parseGadsDeviceRows(resDev || []),
    timeSchedule: parseGadsTimeScheduleRows(resTime || []),
  };
}

function triggerGadsRefreshSingleflight(
  customerId: string,
  startDate: string,
  endDate: string,
  headers: Record<string, string>,
): Promise<GoogleAdsLivePeriodSnapshot | null> {
  const store = getGadsStore();
  const key = `${customerId}:${startDate}:${endDate}`;
  const existing = store.inFlight.get(key);
  if (existing) return existing;

  const backoff = store.backoffUntil.get(key);
  if (backoff && backoff.untilMs > Date.now()) {
    return Promise.resolve(store.memCache.get(key)?.data || null);
  }

  const p = (async () => {
    try {
      const fresh = await fetchLiveGoogleAdsPeriod(customerId, startDate, endDate, headers);
      if (fresh) {
        store.backoffUntil.delete(key);
        store.memCache.delete(key);
        store.memCache.set(key, { expiresAt: Date.now() + GADS_CACHE_TTL_MS, data: fresh });
        pruneGadsMemCache();
        schedulePersistGadsCache();
        bumpDomainRevisions(['tracking', 'ads', 'reports'], 'gads_live_snapshot_refreshed');
        return fresh;
      }
      const prevFails = (store.backoffUntil.get(key)?.failures || 0) + 1;
      store.backoffUntil.set(key, {
        untilMs: Date.now() + Math.min(5 * 60 * 1000, 30_000 * Math.pow(2, prevFails - 1)),
        failures: prevFails,
      });
      return store.memCache.get(key)?.data || null;
    } finally {
      store.inFlight.delete(key);
    }
  })();

  store.inFlight.set(key, p);
  return p;
}

export async function getGoogleAdsLiveSnapshotNonBlocking(
  startDate: string,
  endDate: string,
  forceBlocking = false,
): Promise<GoogleAdsLivePeriodSnapshot | null> {
  if (!startDate || !endDate) return null;
  await hydrateGadsFromDbIfNeeded();
  const store = getGadsStore();

  const [conn, adsCfg] = await Promise.all([
    getGoogleConnection().catch(() => null),
    getGoogleAdsApiConfig().catch(() => null),
  ]);
  const customerId =
    adsCfg?.customerId ||
    conn?.selectedGadsCustomerId?.replace(/\D/g, '') ||
    conn?.detectedGadsCustomerId?.replace(/\D/g, '') ||
    null;

  if (!customerId) return null;

  const key = `${customerId}:${startDate}:${endDate}`;
  const cached = store.memCache.get(key);
  const now = Date.now();
  if (!forceBlocking && cached && cached.expiresAt > now) {
    return cached.data;
  }

  if (process.env.NODE_TEST_CONTEXT) {
    return cached?.data || null;
  }

  const refreshFn = async () => {
    const token = await getValidAccessToken().catch(() => null);
    if (!token || token === 'DEMO_SANDBOX_TOKEN') {
      return cached?.data || null;
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
    return triggerGadsRefreshSingleflight(customerId, startDate, endDate, headers);
  };

  if (!forceBlocking) {
    void refreshFn();
    return cached?.data || null;
  }

  return refreshFn();
}
