import { prisma } from '@toantrung/database';
import { getValidAccessToken } from './google-oauth.service';
import { getGoogleAdsLiveSnapshotNonBlocking } from './gads-live-cache.service';
import { resolveDashboardScope } from '../../core/website-catalog';
import {
  bumpDomainRevisions,
  runWithConcurrency,
} from '../../core/cache/server-data-cache';
import type {
  DashboardDatePreset,
  M03SiteStatusRowDto,
  WebsiteConfigItemDto,
} from '@toantrung/contracts';

export interface Ga4PropertyPeriodSnapshot {
  propertyId: string;
  startDate: string;
  endDate: string;
  fetchedAt: string;
  totals: {
    totalUsers: number;
    newUsers: number;
    activeUsers: number;
    sessions: number;
    screenPageViews: number;
    engagedSessions: number;
    engagementRatePct: number | null;
    userEngagementDurationSec: number;
  };
  daily: Array<{
    date: string; // YYYY-MM-DD
    sessions: number;
    pageViews: number;
    users: number;
    newUsers?: number;
  }>;
  channels: Array<{
    channelGroup: string;
    sessions: number;
    engagedSessions: number;
    engagementRatePct: number | null;
  }>;
  sourceMediums?: Array<{
    sourceMedium: string;
    sessions: number;
    newUsers: number;
    engagedSessions: number;
    engagementRatePct: number | null;
  }>;
  events: Array<{
    eventName: string;
    eventCount: number;
    totalUsers: number;
  }>;
  devices: Array<{
    deviceCategory: string;
    sessions: number;
  }>;
  locations: Array<{
    country: string;
    region: string;
    city: string;
    sessions: number;
  }>;
  landingPages: Array<{
    landingPage: string;
    sessions: number;
    engagedSessions: number;
    engagementRatePct: number | null;
    conversions: number;
    newUsers?: number;
    totalUsers?: number;
  }>;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const REALTIME_TTL_MS = 90 * 1000;
const MAX_PERIOD_CACHE_ENTRIES = 60;
const DB_CACHE_KEY = 'ga4_live_snapshot_cache_v2';
const DB_REALTIME_CACHE_KEY = 'ga4_realtime_snapshot_cache_v1';
const GSC_INSPECT_CACHE_KEY = 'gsc_url_inspection_cache_v1';

export interface Ga4RealtimePropSnapshot {
  propertyId: string;
  fetchedAt: string;
  activeUsers30m: number | null;
  minutesSeries: Array<{ minutesAgo: number; activeUsers: number }>;
  events?: Array<{ eventName: string; eventCount: number }>;
  activePages?: Array<{ pageTitle: string; activeUsers: number }>;
}

interface GlobalGa4LiveCacheStore {
  memCache: Map<string, { expiresAt: number; data: Ga4PropertyPeriodSnapshot }>;
  inFlight: Map<string, Promise<Ga4PropertyPeriodSnapshot | null>>;
  backoffUntil: Map<string, { untilMs: number; failures: number }>;
  realtimeMem: Map<string, { expiresAt: number; data: Ga4RealtimePropSnapshot }>;
  realtimeInFlight: Map<string, Promise<Ga4RealtimePropSnapshot | null>>;
  realtimeBackoffUntil: Map<string, { untilMs: number; failures: number }>;
  gscInspectMem: Map<string, { expiresAt: number; rows: M03SiteStatusRowDto[] }>;
  dbCacheHydrated: boolean;
  dbCacheHydratePromise: Promise<void> | null;
  dbGscHydrated: boolean;
  warmerStarted: boolean;
  warmerRunning: boolean;
  persistTimer: ReturnType<typeof setTimeout> | null;
}

const globalGa4Store = globalThis as unknown as {
  __toantrungGa4LiveCache?: GlobalGa4LiveCacheStore;
};

function getGa4Store(): GlobalGa4LiveCacheStore {
  if (!globalGa4Store.__toantrungGa4LiveCache) {
    globalGa4Store.__toantrungGa4LiveCache = {
      memCache: new Map(),
      inFlight: new Map(),
      backoffUntil: new Map(),
      realtimeMem: new Map(),
      realtimeInFlight: new Map(),
      realtimeBackoffUntil: new Map(),
      gscInspectMem: new Map(),
      dbCacheHydrated: false,
      dbCacheHydratePromise: null,
      dbGscHydrated: false,
      warmerStarted: false,
      warmerRunning: false,
      persistTimer: null,
    };
  }
  return globalGa4Store.__toantrungGa4LiveCache;
}

const MEM_CACHE = getGa4Store().memCache;
const IN_FLIGHT = getGa4Store().inFlight;
const BACKOFF_UNTIL = getGa4Store().backoffUntil;
const REALTIME_MEM = getGa4Store().realtimeMem;
const REALTIME_IN_FLIGHT = getGa4Store().realtimeInFlight;
const REALTIME_BACKOFF_UNTIL = getGa4Store().realtimeBackoffUntil;
const GSC_INSPECT_MEM = getGa4Store().gscInspectMem;

export function invalidateGa4LiveCaches(): void {
  const store = getGa4Store();
  store.memCache.clear();
  store.realtimeMem.clear();
  store.gscInspectMem.clear();
  store.backoffUntil.clear();
  store.realtimeBackoffUntil.clear();
  store.dbCacheHydrated = false;
  store.dbCacheHydratePromise = null;
  store.dbGscHydrated = false;
}

function formatGa4Date(raw: string): string {
  // YYYYMMDD -> YYYY-MM-DD
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  return raw;
}

async function hydrateFromDbIfNeeded(): Promise<void> {
  const store = getGa4Store();
  if (store.dbCacheHydrated) return;
  if (store.dbCacheHydratePromise) return store.dbCacheHydratePromise;

  const p = (async () => {
    try {
      const [row, rtRow] = await Promise.all([
        prisma.systemSetting.findUnique({ where: { key: DB_CACHE_KEY } }),
        prisma.systemSetting.findUnique({ where: { key: DB_REALTIME_CACHE_KEY } }),
      ]);
      const now = Date.now();
      if (row?.value) {
        const parsed = JSON.parse(row.value) as Record<string, Ga4PropertyPeriodSnapshot>;
        for (const [k, snap] of Object.entries(parsed)) {
          if (snap && snap.fetchedAt) {
            const fetchedMs = new Date(snap.fetchedAt).getTime();
            const age = now - fetchedMs;
            // Giữ snapshot tối đa 30 ngày trong DB để không làm mất dữ liệu lịch sử đúng kỳ; nếu >5 phút thì đánh dấu hết hạn mềm để làm mới ngầm khi OAuth hoạt động
            if (age < 30 * 24 * 60 * 60 * 1000) {
              MEM_CACHE.set(k, {
                expiresAt: age < CACHE_TTL_MS ? fetchedMs + CACHE_TTL_MS : now - 1,
                data: snap,
              });
            }
          }
        }
      }
      if (rtRow?.value) {
        const parsedRt = JSON.parse(rtRow.value) as Record<string, Ga4RealtimePropSnapshot>;
        for (const [propId, snap] of Object.entries(parsedRt)) {
          if (snap && snap.fetchedAt) {
            const fetchedMs = new Date(snap.fetchedAt).getTime();
            const age = now - fetchedMs;
            if (age < 30 * 60 * 1000) {
              REALTIME_MEM.set(propId, {
                expiresAt: age < REALTIME_TTL_MS ? fetchedMs + REALTIME_TTL_MS : now - 1,
                data: snap,
              });
            }
          }
        }
      }
    } catch {
      // ignore corrupt cache
    } finally {
      store.dbCacheHydrated = true;
      store.dbCacheHydratePromise = null;
    }
  })();

  store.dbCacheHydratePromise = p;
  return p;
}

function pruneMemCache(): void {
  const now = Date.now();
  for (const [k, v] of MEM_CACHE.entries()) {
    const fetchedMs = new Date(v.data.fetchedAt).getTime();
    if (!Number.isFinite(fetchedMs) || now - fetchedMs > 30 * 24 * 60 * 60 * 1000) {
      MEM_CACHE.delete(k);
    }
  }
  while (MEM_CACHE.size > MAX_PERIOD_CACHE_ENTRIES) {
    const oldestKey = MEM_CACHE.keys().next().value;
    if (oldestKey === undefined) break;
    MEM_CACHE.delete(oldestKey);
  }
}

async function persistMemCacheToDb(): Promise<void> {
  try {
    pruneMemCache();
    const out: Record<string, Ga4PropertyPeriodSnapshot> = {};
    for (const [k, entry] of MEM_CACHE.entries()) {
      out[k] = entry.data;
    }
    await prisma.systemSetting.upsert({
      where: { key: DB_CACHE_KEY },
      update: { value: JSON.stringify(out) },
      create: { key: DB_CACHE_KEY, value: JSON.stringify(out) },
    });
  } catch {
    // ignore
  }
}

function schedulePersistMemCache(): void {
  const store = getGa4Store();
  if (store.persistTimer) return;
  store.persistTimer = setTimeout(() => {
    store.persistTimer = null;
    void persistMemCacheToDb();
  }, 1500);
  store.persistTimer.unref?.();
}

async function persistRealtimeCacheToDb(): Promise<void> {
  try {
    const out: Record<string, Ga4RealtimePropSnapshot> = {};
    for (const [k, entry] of REALTIME_MEM.entries()) {
      out[k] = entry.data;
    }
    await prisma.systemSetting.upsert({
      where: { key: DB_REALTIME_CACHE_KEY },
      update: { value: JSON.stringify(out) },
      create: { key: DB_REALTIME_CACHE_KEY, value: JSON.stringify(out) },
    });
  } catch {
    // ignore
  }
}

async function fetchPropertyPeriodFromGa4(
  propertyId: string,
  startDate: string,
  endDate: string,
  accessToken: string,
): Promise<Ga4PropertyPeriodSnapshot | null> {
  try {
    // batchRunReports supports up to 5 reports per call
    const batchRes = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:batchRunReports`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [
            // 0: Period Totals (no date dimension -> exact unique totalUsers & activeUsers)
            {
              dateRanges: [{ startDate, endDate }],
              metrics: [
                { name: 'totalUsers' },
                { name: 'newUsers' },
                { name: 'activeUsers' },
                { name: 'sessions' },
                { name: 'screenPageViews' },
                { name: 'engagedSessions' },
                { name: 'engagementRate' },
                { name: 'userEngagementDuration' },
              ],
            },
            // 1: Channel group breakdown
            {
              dateRanges: [{ startDate, endDate }],
              dimensions: [{ name: 'sessionDefaultChannelGroup' }],
              metrics: [
                { name: 'sessions' },
                { name: 'engagedSessions' },
                { name: 'engagementRate' },
              ],
              orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
              limit: 20,
            },
            // 2: Events
            {
              dateRanges: [{ startDate, endDate }],
              dimensions: [{ name: 'eventName' }],
              metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
              orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
              limit: 50,
            },
            // 3: Device category
            {
              dateRanges: [{ startDate, endDate }],
              dimensions: [{ name: 'deviceCategory' }],
              metrics: [{ name: 'sessions' }],
              orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
              limit: 10,
            },
            // 4: Daily series
            {
              dateRanges: [{ startDate, endDate }],
              dimensions: [{ name: 'date' }],
              metrics: [
                { name: 'sessions' },
                { name: 'screenPageViews' },
                { name: 'totalUsers' },
                { name: 'newUsers' },
              ],
              orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }],
              limit: 400,
            },
          ],
        }),
      },
    );

    if (!batchRes.ok) {
      return null;
    }

    const batchJson = (await batchRes.json()) as {
      reports?: Array<{
        rows?: Array<{
          dimensionValues?: Array<{ value?: string }>;
          metricValues?: Array<{ value?: string }>;
        }>;
      }>;
    };

    const reports = batchJson.reports || [];
    const totRow = reports[0]?.rows?.[0]?.metricValues || [];
    const totalUsers = Number(totRow[0]?.value || 0);
    const newUsers = Number(totRow[1]?.value || 0);
    const activeUsers = Number(totRow[2]?.value || 0);
    const sessions = Number(totRow[3]?.value || 0);
    const screenPageViews = Number(totRow[4]?.value || 0);
    const engagedSessions = Number(totRow[5]?.value || 0);
    const rawRate = Number(totRow[6]?.value || 0);
    const userEngagementDurationSec = Number(totRow[7]?.value || 0);

    const channels = (reports[1]?.rows || []).map((r) => {
      const chSessions = Number(r.metricValues?.[0]?.value || 0);
      const chEngaged = Number(r.metricValues?.[1]?.value || 0);
      const chRate = Number(r.metricValues?.[2]?.value || 0);
      return {
        channelGroup: r.dimensionValues?.[0]?.value || 'Unassigned',
        sessions: chSessions,
        engagedSessions: chEngaged,
        engagementRatePct: chSessions > 0 ? Number((chRate * 100).toFixed(2)) : null,
      };
    });

    const events = (reports[2]?.rows || []).map((r) => ({
      eventName: r.dimensionValues?.[0]?.value || '',
      eventCount: Number(r.metricValues?.[0]?.value || 0),
      totalUsers: Number(r.metricValues?.[1]?.value || 0),
    }));

    const devices = (reports[3]?.rows || []).map((r) => ({
      deviceCategory: r.dimensionValues?.[0]?.value || 'unknown',
      sessions: Number(r.metricValues?.[0]?.value || 0),
    }));

    const daily = (reports[4]?.rows || []).map((r) => ({
      date: formatGa4Date(r.dimensionValues?.[0]?.value || ''),
      sessions: Number(r.metricValues?.[0]?.value || 0),
      pageViews: Number(r.metricValues?.[1]?.value || 0),
      users: Number(r.metricValues?.[2]?.value || 0),
      newUsers: Number(r.metricValues?.[3]?.value || 0),
    }));

    // Fetch location, landingPagePlusQueryString, and sessionSourceMedium in parallel
    let locations: Ga4PropertyPeriodSnapshot['locations'] = [];
    let landingPages: Ga4PropertyPeriodSnapshot['landingPages'] = [];
    let sourceMediums: NonNullable<Ga4PropertyPeriodSnapshot['sourceMediums']> = [];
    try {
      const [locRes, lpRes, srcMedRes] = await Promise.all([
        fetch(
          `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              dateRanges: [{ startDate, endDate }],
              dimensions: [{ name: 'country' }, { name: 'region' }, { name: 'city' }],
              metrics: [{ name: 'sessions' }],
              orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
              limit: 20,
            }),
          },
        ),
        fetch(
          `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              dateRanges: [{ startDate, endDate }],
              dimensions: [{ name: 'landingPagePlusQueryString' }],
              metrics: [
                { name: 'sessions' },
                { name: 'engagedSessions' },
                { name: 'engagementRate' },
                { name: 'conversions' },
                { name: 'newUsers' },
                { name: 'totalUsers' },
              ],
              orderBys: [{ metric: { metricName: 'newUsers' }, desc: true }],
              limit: 100,
            }),
          },
        ),
        fetch(
          `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              dateRanges: [{ startDate, endDate }],
              dimensions: [{ name: 'sessionSourceMedium' }],
              metrics: [
                { name: 'sessions' },
                { name: 'newUsers' },
                { name: 'engagedSessions' },
                { name: 'engagementRate' },
              ],
              orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
              limit: 40,
            }),
          },
        ),
      ]);

      if (locRes.ok) {
        const locJson = (await locRes.json()) as {
          rows?: Array<{
            dimensionValues?: Array<{ value?: string }>;
            metricValues?: Array<{ value?: string }>;
          }>;
        };
        locations = (locJson.rows || []).map((r) => ({
          country: r.dimensionValues?.[0]?.value || '',
          region: r.dimensionValues?.[1]?.value || '',
          city: r.dimensionValues?.[2]?.value || '',
          sessions: Number(r.metricValues?.[0]?.value || 0),
        }));
      }

      if (lpRes.ok) {
        const lpJson = (await lpRes.json()) as {
          rows?: Array<{
            dimensionValues?: Array<{ value?: string }>;
            metricValues?: Array<{ value?: string }>;
          }>;
        };
        landingPages = (lpJson.rows || []).map((r) => {
          const s = Number(r.metricValues?.[0]?.value || 0);
          const es = Number(r.metricValues?.[1]?.value || 0);
          const er = Number(r.metricValues?.[2]?.value || 0);
          const conv = Math.round(Number(r.metricValues?.[3]?.value || 0));
          const nu = Number(r.metricValues?.[4]?.value || 0);
          const tu = Number(r.metricValues?.[5]?.value || 0);
          return {
            landingPage: r.dimensionValues?.[0]?.value || '/',
            sessions: s,
            engagedSessions: es,
            engagementRatePct: s > 0 ? Number((er * 100).toFixed(2)) : null,
            conversions: conv,
            newUsers: nu,
            totalUsers: tu,
          };
        });
      }

      if (srcMedRes.ok) {
        const smJson = (await srcMedRes.json()) as {
          rows?: Array<{
            dimensionValues?: Array<{ value?: string }>;
            metricValues?: Array<{ value?: string }>;
          }>;
        };
        sourceMediums = (smJson.rows || []).map((r) => {
          const s = Number(r.metricValues?.[0]?.value || 0);
          const nu = Number(r.metricValues?.[1]?.value || 0);
          const es = Number(r.metricValues?.[2]?.value || 0);
          const er = Number(r.metricValues?.[3]?.value || 0);
          return {
            sourceMedium: r.dimensionValues?.[0]?.value || '(not set)',
            sessions: s,
            newUsers: nu,
            engagedSessions: es,
            engagementRatePct: s > 0 ? Number((er * 100).toFixed(2)) : null,
          };
        });
      }
    } catch {
      // non-fatal
    }

    return {
      propertyId,
      startDate,
      endDate,
      fetchedAt: new Date().toISOString(),
      totals: {
        totalUsers,
        newUsers,
        activeUsers,
        sessions,
        screenPageViews,
        engagedSessions,
        engagementRatePct: sessions > 0 ? Number((rawRate * 100).toFixed(2)) : null,
        userEngagementDurationSec,
      },
      daily,
      channels,
      sourceMediums,
      events,
      devices,
      locations,
      landingPages,
    };
  } catch {
    return null;
  }
}

function triggerPropertyRefreshSingleflight(
  propertyId: string,
  startDate: string,
  endDate: string,
): Promise<Ga4PropertyPeriodSnapshot | null> {
  const key = `${propertyId}:${startDate}:${endDate}`;
  const existingFlight = IN_FLIGHT.get(key);
  if (existingFlight) return existingFlight;

  const backoff = BACKOFF_UNTIL.get(key);
  if (backoff && backoff.untilMs > Date.now()) {
    return Promise.resolve(MEM_CACHE.get(key)?.data || null);
  }

  const promise = (async () => {
    try {
      const token = await getValidAccessToken();
      if (!token) return MEM_CACHE.get(key)?.data || null;
      const fresh = await fetchPropertyPeriodFromGa4(propertyId, startDate, endDate, token);
      if (fresh) {
        BACKOFF_UNTIL.delete(key);
        MEM_CACHE.delete(key);
        MEM_CACHE.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, data: fresh });
        pruneMemCache();
        schedulePersistMemCache();
        bumpDomainRevisions(['tracking', 'reports', 'ads'], 'ga4_live_snapshot_refreshed');
        return fresh;
      }
      const prevFails = (BACKOFF_UNTIL.get(key)?.failures || 0) + 1;
      const delayMs = Math.min(5 * 60 * 1000, 30_000 * Math.pow(2, prevFails - 1));
      BACKOFF_UNTIL.set(key, { untilMs: Date.now() + delayMs, failures: prevFails });
      return MEM_CACHE.get(key)?.data || null;
    } finally {
      IN_FLIGHT.delete(key);
    }
  })();

  IN_FLIGHT.set(key, promise);
  return promise;
}

export async function getGa4LivePropertySnapshot(
  propertyId: string,
  startDate: string,
  endDate: string,
  forceBlocking = false,
): Promise<Ga4PropertyPeriodSnapshot | null> {
  ensureM02M04BackgroundWarmerStarted();
  await hydrateFromDbIfNeeded();
  const key = `${propertyId}:${startDate}:${endDate}`;
  const now = Date.now();
  const cached = MEM_CACHE.get(key);
  const missingLpNewUsers = Boolean(
    cached &&
      cached.data.landingPages.length > 0 &&
      cached.data.landingPages[0].newUsers === undefined,
  );
  const missingSourceMediums = Boolean(
    cached && cached.data.sourceMediums === undefined,
  );
  if (
    !forceBlocking &&
    cached &&
    cached.expiresAt > now &&
    !missingLpNewUsers &&
    !missingSourceMediums
  ) {
    return cached.data;
  }

  // Non-blocking on page load: return exact-scope cached snapshot if available;
  // NEVER return a different date window's snapshot and NEVER block UI waiting for external GA4 HTTP calls.
  if (!forceBlocking) {
    if (!process.env.NODE_TEST_CONTEXT) {
      void triggerPropertyRefreshSingleflight(propertyId, startDate, endDate);
    }
    return cached?.data || null;
  }

  return triggerPropertyRefreshSingleflight(propertyId, startDate, endDate);
}

export async function getGa4LiveSnapshotsForProperties(
  propertyIds: string[],
  startDate: string,
  endDate: string,
  forceBlocking = false,
): Promise<Ga4PropertyPeriodSnapshot[]> {
  if (propertyIds.length === 0) return [];
  const results = await Promise.all(
    propertyIds.map((pid) => getGa4LivePropertySnapshot(pid, startDate, endDate, forceBlocking)),
  );
  return results.filter((r): r is Ga4PropertyPeriodSnapshot => r !== null);
}

async function fetchRealtimePropFromGa4(
  propId: string,
  token: string,
): Promise<Ga4RealtimePropSnapshot | null> {
  try {
    const [respTotal, respMin, respEvents, respPages] = await Promise.all([
      fetch(
        `https://analyticsdata.googleapis.com/v1beta/properties/${propId}:runRealtimeReport`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ metrics: [{ name: 'activeUsers' }] }),
        },
      ),
      fetch(
        `https://analyticsdata.googleapis.com/v1beta/properties/${propId}:runRealtimeReport`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            dimensions: [{ name: 'minutesAgo' }],
            metrics: [{ name: 'activeUsers' }],
          }),
        },
      ),
      fetch(
        `https://analyticsdata.googleapis.com/v1beta/properties/${propId}:runRealtimeReport`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            dimensions: [{ name: 'eventName' }],
            metrics: [{ name: 'eventCount' }],
            limit: 30,
          }),
        },
      ),
      fetch(
        `https://analyticsdata.googleapis.com/v1beta/properties/${propId}:runRealtimeReport`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            dimensions: [{ name: 'unifiedScreenName' }],
            metrics: [{ name: 'activeUsers' }],
            limit: 15,
          }),
        },
      ),
    ]);

    let activeUsers30m: number | null = null;
    const minutesSeries: Array<{ minutesAgo: number; activeUsers: number }> = [];
    const events: Array<{ eventName: string; eventCount: number }> = [];
    const activePages: Array<{ pageTitle: string; activeUsers: number }> = [];

    if (respTotal.ok) {
      const j = (await respTotal.json()) as {
        rows?: Array<{ metricValues?: Array<{ value?: string }> }>;
      };
      const val = Number(j.rows?.[0]?.metricValues?.[0]?.value || 0);
      if (Number.isFinite(val)) activeUsers30m = val;
    }

    if (respMin.ok) {
      const jm = (await respMin.json()) as {
        rows?: Array<{
          dimensionValues?: Array<{ value?: string }>;
          metricValues?: Array<{ value?: string }>;
        }>;
      };
      for (const r of jm.rows || []) {
        const minAgo = Number(r.dimensionValues?.[0]?.value);
        const cnt = Number(r.metricValues?.[0]?.value || 0);
        if (Number.isFinite(minAgo) && minAgo >= 0 && minAgo <= 29) {
          minutesSeries.push({ minutesAgo: minAgo, activeUsers: cnt });
        }
      }
    }

    if (respEvents.ok) {
      const je = (await respEvents.json()) as {
        rows?: Array<{
          dimensionValues?: Array<{ value?: string }>;
          metricValues?: Array<{ value?: string }>;
        }>;
      };
      for (const r of je.rows || []) {
        const eventName = r.dimensionValues?.[0]?.value || '';
        const eventCount = Number(r.metricValues?.[0]?.value || 0);
        if (eventName && Number.isFinite(eventCount) && eventCount > 0) {
          events.push({ eventName, eventCount });
        }
      }
      events.sort((a, b) => b.eventCount - a.eventCount);
    }

    if (respPages.ok) {
      const jp = (await respPages.json()) as {
        rows?: Array<{
          dimensionValues?: Array<{ value?: string }>;
          metricValues?: Array<{ value?: string }>;
        }>;
      };
      for (const r of jp.rows || []) {
        const pageTitle = r.dimensionValues?.[0]?.value || '';
        const activeU = Number(r.metricValues?.[0]?.value || 0);
        if (pageTitle && Number.isFinite(activeU) && activeU > 0) {
          activePages.push({ pageTitle, activeUsers: activeU });
        }
      }
      activePages.sort((a, b) => b.activeUsers - a.activeUsers);
    }

    if (activeUsers30m === null && minutesSeries.length === 0 && events.length === 0) {
      return null;
    }

    return {
      propertyId: propId,
      fetchedAt: new Date().toISOString(),
      activeUsers30m: activeUsers30m ?? 0,
      minutesSeries,
      events,
      activePages,
    };
  } catch {
    return null;
  }
}

function triggerRealtimePropRefreshSingleflight(propId: string): Promise<Ga4RealtimePropSnapshot | null> {
  const existing = REALTIME_IN_FLIGHT.get(propId);
  if (existing) return existing;

  const backoff = REALTIME_BACKOFF_UNTIL.get(propId);
  if (backoff && backoff.untilMs > Date.now()) {
    return Promise.resolve(REALTIME_MEM.get(propId)?.data || null);
  }

  const p = (async () => {
    try {
      const token = await getValidAccessToken();
      if (!token) return REALTIME_MEM.get(propId)?.data || null;
      const snap = await fetchRealtimePropFromGa4(propId, token);
      if (snap) {
        REALTIME_BACKOFF_UNTIL.delete(propId);
        REALTIME_MEM.set(propId, { expiresAt: Date.now() + REALTIME_TTL_MS, data: snap });
        void persistRealtimeCacheToDb();
        bumpDomainRevisions(['tracking'], 'ga4_realtime_refreshed');
        return snap;
      }
      const prevFails = (REALTIME_BACKOFF_UNTIL.get(propId)?.failures || 0) + 1;
      REALTIME_BACKOFF_UNTIL.set(propId, {
        untilMs: Date.now() + Math.min(5 * 60 * 1000, 30_000 * Math.pow(2, prevFails - 1)),
        failures: prevFails,
      });
      return REALTIME_MEM.get(propId)?.data || null;
    } finally {
      REALTIME_IN_FLIGHT.delete(propId);
    }
  })();

  REALTIME_IN_FLIGHT.set(propId, p);
  return p;
}

export async function getGa4RealtimeSnapshotNonBlocking(propertyIds: string[]): Promise<{
  activeUsers30m: number | null;
  minutesSeries: Array<{ minutesAgo: number; activeUsers: number }>;
  realtimeEvents: Array<{ eventName: string; eventCount: number }>;
  realtimeActivePages: Array<{ pageTitle: string; activeUsers: number }>;
  checkedAt: string | null;
}> {
  if (propertyIds.length === 0) {
    return {
      activeUsers30m: null,
      minutesSeries: [],
      realtimeEvents: [],
      realtimeActivePages: [],
      checkedAt: null,
    };
  }
  ensureM02M04BackgroundWarmerStarted();
  await hydrateFromDbIfNeeded();

  const now = Date.now();
  let total30m = 0;
  let anyHit = false;
  let latestCheckedAt: string | null = null;
  const minuteMap = new Map<number, number>();
  const eventMap = new Map<string, number>();
  const pageMap = new Map<string, number>();

  for (const propId of propertyIds.slice(0, 6)) {
    const entry = REALTIME_MEM.get(propId);
    const missingEventsOrPages = Boolean(
      entry && (entry.data.events === undefined || entry.data.activePages === undefined),
    );
    if (!entry || entry.expiresAt <= now || missingEventsOrPages) {
      void triggerRealtimePropRefreshSingleflight(propId);
    }
    if (entry?.data) {
      if (entry.data.activeUsers30m !== null) {
        total30m += entry.data.activeUsers30m;
        anyHit = true;
      }
      if (!latestCheckedAt || entry.data.fetchedAt > latestCheckedAt) {
        latestCheckedAt = entry.data.fetchedAt;
      }
      for (const m of entry.data.minutesSeries) {
        minuteMap.set(m.minutesAgo, (minuteMap.get(m.minutesAgo) || 0) + m.activeUsers);
      }
      for (const ev of entry.data.events || []) {
        eventMap.set(ev.eventName, (eventMap.get(ev.eventName) || 0) + ev.eventCount);
      }
      for (const pg of entry.data.activePages || []) {
        pageMap.set(pg.pageTitle, (pageMap.get(pg.pageTitle) || 0) + pg.activeUsers);
      }
    }
  }

  const realtimeEvents = Array.from(eventMap.entries())
    .map(([eventName, eventCount]) => ({ eventName, eventCount }))
    .sort((a, b) => b.eventCount - a.eventCount);

  const realtimeActivePages = Array.from(pageMap.entries())
    .map(([pageTitle, activeUsers]) => ({ pageTitle, activeUsers }))
    .sort((a, b) => b.activeUsers - a.activeUsers)
    .slice(0, 15);

  return {
    activeUsers30m: anyHit ? total30m : null,
    minutesSeries: anyHit
      ? Array.from({ length: 30 }, (_, idx) => {
          const minutesAgo = 29 - idx;
          return { minutesAgo, activeUsers: minuteMap.get(minutesAgo) || 0 };
        })
      : [],
    realtimeEvents,
    realtimeActivePages,
    checkedAt: latestCheckedAt,
  };
}

// ============================================================================
// GSC URL Inspection Background Cache (for M03 Tình trạng trang)
// ============================================================================

async function inspectUrlWithGsc(
  siteUrl: string,
  inspectionUrl: string,
  accessToken: string,
): Promise<M03SiteStatusRowDto | null> {
  try {
    const res = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inspectionUrl,
        siteUrl,
        languageCode: 'vi',
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      inspectionResult?: {
        indexStatusResult?: {
          verdict?: string;
          coverageState?: string;
          lastCrawlTime?: string;
          googleCanonical?: string;
          userCanonical?: string;
        };
      };
    };
    const idx = json.inspectionResult?.indexStatusResult;
    if (!idx) return null;
    const verdict = idx.verdict || 'VERDICT_UNSPECIFIED';
    return {
      url: inspectionUrl,
      verdict: verdict === 'PASS' ? 'Hợp lệ (Đã lập chỉ mục)' : verdict === 'FAIL' ? 'Lỗi lập chỉ mục' : verdict,
      coverageState: idx.coverageState || 'Chưa xác định',
      issuesToReview: verdict === 'PASS' ? null : idx.coverageState || 'Cần kiểm tra lại trạng thái lập chỉ mục',
      lastCrawlTime: idx.lastCrawlTime || null,
      lastCheckedAt: new Date().toISOString(),
      googleCanonical: idx.googleCanonical || null,
      userCanonical: idx.userCanonical || null,
    };
  } catch {
    return null;
  }
}

export async function getCachedGscSiteStatus(
  gscSiteUrls: string[],
): Promise<M03SiteStatusRowDto[]> {
  if (gscSiteUrls.length === 0) return [];
  const store = getGa4Store();
  if (!store.dbGscHydrated && GSC_INSPECT_MEM.size === 0) {
    store.dbGscHydrated = true;
    try {
      const row = await prisma.systemSetting.findUnique({ where: { key: GSC_INSPECT_CACHE_KEY } });
      if (row?.value) {
        const parsed = JSON.parse(row.value) as Record<string, M03SiteStatusRowDto[]>;
        for (const [site, rows] of Object.entries(parsed)) {
          GSC_INSPECT_MEM.set(site, { expiresAt: Date.now() + 6 * 60 * 60 * 1000, rows });
        }
      }
    } catch {
      // ignore
    }
  }

  const out: M03SiteStatusRowDto[] = [];
  for (const site of gscSiteUrls) {
    const hit = GSC_INSPECT_MEM.get(site);
    if (hit) out.push(...hit.rows);
  }
  return out;
}

async function warmGscInspectionInBackground(websites: WebsiteConfigItemDto[], accessToken: string): Promise<void> {
  const gscSites = Array.from(
    new Set(websites.map((w) => w.gscSiteUrl).filter((s): s is string => Boolean(s))),
  );
  if (gscSites.length === 0) return;

  const now = Date.now();
  let updated = false;
  for (const siteUrl of gscSites) {
    const existing = GSC_INSPECT_MEM.get(siteUrl);
    if (existing && existing.expiresAt > now && existing.rows.length > 0) {
      continue;
    }

    // Pick top 3 pages for this site from PlatformDailyMetric, fallback to homepage
    const topPages = await prisma.platformDailyMetric.findMany({
      where: {
        platform: 'search_console',
        accountPropertyId: siteUrl,
        grain: 'page',
      },
      orderBy: { clicks: 'desc' },
      take: 10,
      select: { pageUrlRaw: true },
    });

    const candidateUrls = Array.from(
      new Set([
        siteUrl,
        ...topPages.map((p) => p.pageUrlRaw).filter((u): u is string => Boolean(u && u.startsWith('http'))),
      ]),
    ).slice(0, 3);

    const inspected: M03SiteStatusRowDto[] = [];
    for (const u of candidateUrls) {
      const row = await inspectUrlWithGsc(siteUrl, u, accessToken);
      if (row) inspected.push(row);
    }
    if (inspected.length > 0) {
      GSC_INSPECT_MEM.set(siteUrl, {
        expiresAt: Date.now() + 6 * 60 * 60 * 1000,
        rows: inspected,
      });
      updated = true;
    }
  }

  if (updated) {
    try {
      const payload: Record<string, M03SiteStatusRowDto[]> = {};
      for (const [k, v] of GSC_INSPECT_MEM.entries()) payload[k] = v.rows;
      await prisma.systemSetting.upsert({
        where: { key: GSC_INSPECT_CACHE_KEY },
        update: { value: JSON.stringify(payload) },
        create: { key: GSC_INSPECT_CACHE_KEY, value: JSON.stringify(payload) },
      });
    } catch {
      // ignore
    }
  }
}

// ============================================================================
// Background Pre-Warmer (runs at startup + every 4 minutes)
// ============================================================================

export async function warmAllDashboardDataInBackground(): Promise<void> {
  const store = getGa4Store();
  if (store.warmerRunning) return;
  store.warmerRunning = true;
  try {
    const token = await getValidAccessToken();
    if (!token) return;

    const baseScope = await resolveDashboardScope({ websiteId: 'all', preset: '7D' });
    const propIds = Array.from(
      new Set(
        baseScope.availableWebsites
          .map((w) => w.ga4PropertyId)
          .filter((id): id is string => Boolean(id)),
      ),
    );

    const presets: DashboardDatePreset[] = ['TODAY', 'YESTERDAY', '7D', '30D'];
    const presetScopes = await Promise.all(
      presets.map((preset) => resolveDashboardScope({ websiteId: 'all', preset })),
    );

    const periodTargets: Array<{ pid: string; startDate: string; endDate: string; key: string }> = [];
    for (const sc of presetScopes) {
      for (const pid of propIds) {
        const key = `${pid}:${sc.startDateStr}:${sc.endDateStr}`;
        const cached = MEM_CACHE.get(key);
        if (!cached || cached.expiresAt <= Date.now()) {
          periodTargets.push({ pid, startDate: sc.startDateStr, endDate: sc.endDateStr, key });
        }
      }
    }

    const rtTargets = propIds.filter((pid) => {
      const rtCached = REALTIME_MEM.get(pid);
      return !rtCached || rtCached.expiresAt <= Date.now();
    });

    let changedCount = 0;
    await Promise.all([
      runWithConcurrency(periodTargets, 4, async (item) => {
        const fresh = await fetchPropertyPeriodFromGa4(item.pid, item.startDate, item.endDate, token);
        if (fresh) {
          MEM_CACHE.delete(item.key);
          MEM_CACHE.set(item.key, { expiresAt: Date.now() + CACHE_TTL_MS, data: fresh });
          changedCount += 1;
        }
      }),
      runWithConcurrency(rtTargets, 4, async (pid) => {
        const rtSnap = await fetchRealtimePropFromGa4(pid, token);
        if (rtSnap) {
          REALTIME_MEM.set(pid, { expiresAt: Date.now() + REALTIME_TTL_MS, data: rtSnap });
          changedCount += 1;
        }
      }),
    ]);

    if (changedCount > 0) {
      pruneMemCache();
      await Promise.all([persistMemCacheToDb(), persistRealtimeCacheToDb()]);
      bumpDomainRevisions(['tracking', 'reports', 'ads'], 'background_ga4_warmer');
    }
    await Promise.all([
      warmGscInspectionInBackground(baseScope.availableWebsites, token),
      (async () => {
        try {
          await runWithConcurrency(presetScopes, 2, async (sc) => {
            await getGoogleAdsLiveSnapshotNonBlocking(sc.startDateStr, sc.endDateStr, true);
          });
        } catch {
          // non-fatal Google Ads warm
        }
      })(),
    ]);
  } catch {
    // non-fatal background warm
  } finally {
    store.warmerRunning = false;
  }
}

export function ensureM02M04BackgroundWarmerStarted(): void {
  if (process.env.NODE_TEST_CONTEXT) return;
  const store = getGa4Store();
  if (store.warmerStarted) return;
  store.warmerStarted = true;

  // Warm immediately after server boot (500ms delay)
  const initialTimer = setTimeout(() => {
    void warmAllDashboardDataInBackground();
  }, 500);
  initialTimer.unref?.();

  // Refresh silently every 4 minutes so all websites x presets stay hot
  const interval = setInterval(() => {
    void warmAllDashboardDataInBackground();
  }, 4 * 60 * 1000);
  interval.unref?.();
}
