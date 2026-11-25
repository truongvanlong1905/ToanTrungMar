import { prisma } from '@toantrung/database';
import type { M03SeoDeviceCountryRowDto } from '@toantrung/contracts';
import { bumpDomainRevisions } from '../../core/cache/server-data-cache';
import { sanitizeLandingPageUrl } from '../../core/website-catalog';
import {
  ALLOWED_COMPANY_GSC_SITES,
  getValidAccessToken,
} from '../02-tracking-sync/google-oauth.service';

export interface GscDailyMetricItem {
  date: string;
  clicks: number;
  impressions: number;
  ctrPct: number | null;
  averagePosition: number | null;
}

export interface GscBreakdownMetricItem {
  key: string;
  clicks: number;
  impressions: number;
  ctrPct: number | null;
  averagePosition: number | null;
}

export interface GscQueryPageLinkItem {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctrPct: number | null;
  averagePosition: number | null;
}

export interface GscSiteLiveSnapshot {
  siteUrl: string;
  startDate: string;
  endDate: string;
  fetchedAt: string;
  finalizedDates: string[];
  daily: GscDailyMetricItem[];
  queries: GscBreakdownMetricItem[];
  pages: GscBreakdownMetricItem[];
  queryPages: GscQueryPageLinkItem[];
  devices: M03SeoDeviceCountryRowDto[];
  countries: M03SeoDeviceCountryRowDto[];
}

const GSC_CACHE_TTL_MS = 10 * 60 * 1000;
const GSC_MAX_CACHE_ENTRIES = 40;
const DB_GSC_CACHE_KEY = 'gsc_live_snapshot_cache_v1';

interface GlobalGscStore {
  memCache: Map<string, { expiresAt: number; data: GscSiteLiveSnapshot }>;
  inFlight: Map<string, Promise<GscSiteLiveSnapshot | null>>;
  backoffUntil: Map<string, { untilMs: number; failures: number }>;
  dbHydrated: boolean;
  dbHydratePromise: Promise<void> | null;
  persistTimer: ReturnType<typeof setTimeout> | null;
}

const globalGscObj = globalThis as unknown as {
  __toantrungGscLiveCache?: GlobalGscStore;
};

function getGscStore(): GlobalGscStore {
  if (!globalGscObj.__toantrungGscLiveCache) {
    globalGscObj.__toantrungGscLiveCache = {
      memCache: new Map(),
      inFlight: new Map(),
      backoffUntil: new Map(),
      dbHydrated: false,
      dbHydratePromise: null,
      persistTimer: null,
    };
  }
  return globalGscObj.__toantrungGscLiveCache;
}

export interface RawGscRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}

/**
 * Pure helper gom cặp (từ khóa, trang đích) để lọc chéo trên UI (exported cho unit test).
 */
export function aggregateGscQueryPageLinks(
  rows: RawGscRow[],
  limit = 1500,
): GscQueryPageLinkItem[] {
  const map = new Map<
    string,
    {
      query: string;
      page: string;
      clicks: number;
      impressions: number;
      posWeighted: number;
    }
  >();
  for (const r of rows || []) {
    const query = String(r.keys?.[0] || '').trim();
    const rawPage = String(r.keys?.[1] || '').trim();
    const page = sanitizeLandingPageUrl(rawPage);
    if (!query || !page) continue;
    const clicks = Number(r.clicks || 0);
    const impressions = Number(r.impressions || 0);
    const pos = Number(r.position || 0);
    const key = `${query.toLowerCase()}|||${page.toLowerCase()}`;
    const cur = map.get(key) || {
      query,
      page,
      clicks: 0,
      impressions: 0,
      posWeighted: 0,
    };
    cur.clicks += clicks;
    cur.impressions += impressions;
    if (pos > 0 && impressions > 0) {
      cur.posWeighted += pos * impressions;
    }
    map.set(key, cur);
  }

  return Array.from(map.values())
    .map((x) => ({
      query: x.query,
      page: x.page,
      clicks: x.clicks,
      impressions: x.impressions,
      ctrPct: x.impressions > 0 ? Number(((x.clicks / x.impressions) * 100).toFixed(2)) : null,
      averagePosition:
        x.impressions > 0 && x.posWeighted > 0
          ? Number((x.posWeighted / x.impressions).toFixed(2))
          : null,
    }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, limit);
}

const GSC_DEVICE_VI: Record<string, string> = {
  MOBILE: 'Di động (Mobile)',
  DESKTOP: 'Máy tính (Desktop)',
  TABLET: 'Máy tính bảng (Tablet)',
};

const COUNTRY_CODE_VI: Record<string, string> = {
  vnm: 'Việt Nam (VNM)',
  usa: 'Hoa Kỳ (USA)',
  sgp: 'Singapore (SGP)',
  jpn: 'Nhật Bản (JPN)',
  kor: 'Hàn Quốc (KOR)',
  aus: 'Úc (AUS)',
  deu: 'Đức (DEU)',
  gbr: 'Anh (GBR)',
  can: 'Canada (CAN)',
  twn: 'Đài Loan (TWN)',
  tha: 'Thái Lan (THA)',
  khm: 'Campuchia (KHM)',
  lao: 'Lào (LAO)',
};

async function queryGscApi(
  siteUrl: string,
  accessToken: string,
  body: Record<string, unknown>,
): Promise<RawGscRow[] | null> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { rows?: RawGscRow[] };
    return json.rows || [];
  } catch {
    return null;
  }
}

async function fetchSiteLiveFromGsc(
  siteUrl: string,
  startDate: string,
  endDate: string,
  accessToken: string,
): Promise<GscSiteLiveSnapshot | null> {
  const [dateFinalRows, dateAllRows, queryRows, pageRows, qpRows, devRows, countryRows] =
    await Promise.all([
      queryGscApi(siteUrl, accessToken, {
        startDate,
        endDate,
        dimensions: ['date'],
        dataState: 'final',
        rowLimit: 500,
      }),
      queryGscApi(siteUrl, accessToken, {
        startDate,
        endDate,
        dimensions: ['date'],
        dataState: 'all',
        rowLimit: 500,
      }),
      queryGscApi(siteUrl, accessToken, {
        startDate,
        endDate,
        dimensions: ['query'],
        dataState: 'all',
        rowLimit: 2500,
      }),
      queryGscApi(siteUrl, accessToken, {
        startDate,
        endDate,
        dimensions: ['page'],
        dataState: 'all',
        rowLimit: 1000,
      }),
      queryGscApi(siteUrl, accessToken, {
        startDate,
        endDate,
        dimensions: ['query', 'page'],
        dataState: 'all',
        rowLimit: 1500,
      }),
      queryGscApi(siteUrl, accessToken, {
        startDate,
        endDate,
        dimensions: ['device'],
        dataState: 'all',
        rowLimit: 10,
      }),
      queryGscApi(siteUrl, accessToken, {
        startDate,
        endDate,
        dimensions: ['country'],
        dataState: 'all',
        rowLimit: 50,
      }),
    ]);

  if (dateAllRows === null && queryRows === null && pageRows === null) {
    return null;
  }

  const finalizedDates = (dateFinalRows || [])
    .map((r) => String(r.keys?.[0] || '').trim())
    .filter(Boolean);

  const daily: GscDailyMetricItem[] = (dateAllRows || [])
    .map((r) => {
      const date = String(r.keys?.[0] || '').trim();
      const clicks = Number(r.clicks || 0);
      const impressions = Number(r.impressions || 0);
      return {
        date,
        clicks,
        impressions,
        ctrPct: impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : null,
        averagePosition: r.position !== undefined ? Number(Number(r.position).toFixed(2)) : null,
      };
    })
    .filter((d) => d.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  const queries: GscBreakdownMetricItem[] = (queryRows || [])
    .map((r) => {
      const key = String(r.keys?.[0] || '').trim();
      const clicks = Number(r.clicks || 0);
      const impressions = Number(r.impressions || 0);
      return {
        key,
        clicks,
        impressions,
        ctrPct: impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : null,
        averagePosition: r.position !== undefined ? Number(Number(r.position).toFixed(2)) : null,
      };
    })
    .filter((q) => q.key);

  const pages: GscBreakdownMetricItem[] = (pageRows || [])
    .map((r) => {
      const key = sanitizeLandingPageUrl(String(r.keys?.[0] || '').trim());
      const clicks = Number(r.clicks || 0);
      const impressions = Number(r.impressions || 0);
      return {
        key,
        clicks,
        impressions,
        ctrPct: impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : null,
        averagePosition: r.position !== undefined ? Number(Number(r.position).toFixed(2)) : null,
      };
    })
    .filter((p) => p.key);

  const queryPages = aggregateGscQueryPageLinks(qpRows || [], 1500);

  const devices: M03SeoDeviceCountryRowDto[] = (devRows || [])
    .map((r) => {
      const rawKey = String(r.keys?.[0] || 'OTHER').toUpperCase();
      const clicks = Number(r.clicks || 0);
      const impressions = Number(r.impressions || 0);
      return {
        dimensionType: 'DEVICE' as const,
        dimensionKey: GSC_DEVICE_VI[rawKey] || rawKey,
        clicks,
        impressions,
        ctrPct: impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : null,
        averagePosition: r.position !== undefined ? Number(Number(r.position).toFixed(2)) : null,
      };
    })
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);

  const countries: M03SeoDeviceCountryRowDto[] = (countryRows || [])
    .map((r) => {
      const rawCode = String(r.keys?.[0] || '').toLowerCase();
      const clicks = Number(r.clicks || 0);
      const impressions = Number(r.impressions || 0);
      return {
        dimensionType: 'COUNTRY' as const,
        dimensionKey: COUNTRY_CODE_VI[rawCode] || rawCode.toUpperCase() || 'Khác',
        clicks,
        impressions,
        ctrPct: impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : null,
        averagePosition: r.position !== undefined ? Number(Number(r.position).toFixed(2)) : null,
      };
    })
    .filter((c) => c.dimensionKey)
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, 30);

  return {
    siteUrl,
    startDate,
    endDate,
    fetchedAt: new Date().toISOString(),
    finalizedDates,
    daily,
    queries,
    pages,
    queryPages,
    devices,
    countries,
  };
}

async function hydrateGscFromDbIfNeeded(): Promise<void> {
  const store = getGscStore();
  if (store.dbHydrated) return;
  if (store.dbHydratePromise) return store.dbHydratePromise;

  const p = (async () => {
    try {
      const row = await prisma.systemSetting.findUnique({
        where: { key: DB_GSC_CACHE_KEY },
      });
      if (row?.value) {
        const parsed = JSON.parse(row.value) as Record<string, GscSiteLiveSnapshot>;
        const now = Date.now();
        for (const [k, snap] of Object.entries(parsed)) {
          if (snap?.fetchedAt) {
            const age = now - new Date(snap.fetchedAt).getTime();
            if (Number.isFinite(age) && age < 30 * 24 * 60 * 60 * 1000) {
              store.memCache.set(k, {
                expiresAt: age < GSC_CACHE_TTL_MS ? now + GSC_CACHE_TTL_MS - age : now - 1,
                data: snap,
              });
            }
          }
        }
      }
    } catch {
      // ignore
    } finally {
      store.dbHydrated = true;
      store.dbHydratePromise = null;
    }
  })();

  store.dbHydratePromise = p;
  return p;
}

function pruneGscMemCache(): void {
  const store = getGscStore();
  const now = Date.now();
  for (const [k, v] of store.memCache.entries()) {
    const fetchedMs = new Date(v.data.fetchedAt).getTime();
    if (!Number.isFinite(fetchedMs) || now - fetchedMs > 30 * 24 * 60 * 60 * 1000) {
      store.memCache.delete(k);
    }
  }
  while (store.memCache.size > GSC_MAX_CACHE_ENTRIES) {
    const oldest = store.memCache.keys().next().value;
    if (oldest === undefined) break;
    store.memCache.delete(oldest);
  }
}

function schedulePersistGscCache(): void {
  const store = getGscStore();
  if (store.persistTimer) return;
  store.persistTimer = setTimeout(() => {
    store.persistTimer = null;
    void (async () => {
      try {
        pruneGscMemCache();
        const out: Record<string, GscSiteLiveSnapshot> = {};
        for (const [k, entry] of store.memCache.entries()) {
          out[k] = entry.data;
        }
        await prisma.systemSetting.upsert({
          where: { key: DB_GSC_CACHE_KEY },
          update: { value: JSON.stringify(out) },
          create: { key: DB_GSC_CACHE_KEY, value: JSON.stringify(out) },
        });
      } catch {
        // ignore
      }
    })();
  }, 1500);
  store.persistTimer.unref?.();
}

function triggerGscRefreshSingleflight(
  siteUrl: string,
  startDate: string,
  endDate: string,
): Promise<GscSiteLiveSnapshot | null> {
  const store = getGscStore();
  const key = `${siteUrl}:${startDate}:${endDate}`;
  const existing = store.inFlight.get(key);
  if (existing) return existing;

  const backoff = store.backoffUntil.get(key);
  if (backoff && backoff.untilMs > Date.now()) {
    return Promise.resolve(store.memCache.get(key)?.data || null);
  }

  const p = (async () => {
    try {
      const token = await getValidAccessToken().catch(() => null);
      if (!token || token === 'DEMO_SANDBOX_TOKEN') {
        return store.memCache.get(key)?.data || null;
      }
      const fresh = await fetchSiteLiveFromGsc(siteUrl, startDate, endDate, token);
      if (fresh) {
        store.backoffUntil.delete(key);
        store.memCache.delete(key);
        store.memCache.set(key, { expiresAt: Date.now() + GSC_CACHE_TTL_MS, data: fresh });
        pruneGscMemCache();
        schedulePersistGscCache();
        bumpDomainRevisions(['ads', 'reports'], 'gsc_live_snapshot_refreshed');
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

export async function getGscLiveSnapshotsForSites(
  siteUrls: string[],
  startDate: string,
  endDate: string,
  forceBlocking = false,
): Promise<GscSiteLiveSnapshot[]> {
  if (siteUrls.length === 0 || !startDate || !endDate) return [];
  await hydrateGscFromDbIfNeeded();
  const store = getGscStore();
  const allowedSites = siteUrls.filter((s) => ALLOWED_COMPANY_GSC_SITES.includes(s));
  const targets = allowedSites.length > 0 ? allowedSites : siteUrls;

  const results = await Promise.all(
    targets.map(async (siteUrl) => {
      const key = `${siteUrl}:${startDate}:${endDate}`;
      const cached = store.memCache.get(key);
      if (!forceBlocking && cached && cached.expiresAt > Date.now()) {
        return cached.data;
      }
      if (!forceBlocking) {
        if (!process.env.NODE_TEST_CONTEXT) {
          void triggerGscRefreshSingleflight(siteUrl, startDate, endDate);
        }
        return cached?.data || null;
      }
      if (process.env.NODE_TEST_CONTEXT) return cached?.data || null;
      return triggerGscRefreshSingleflight(siteUrl, startDate, endDate);
    }),
  );

  return results.filter((r): r is GscSiteLiveSnapshot => r !== null);
}
