const ALL_DOMAINS = [
  'leads',
  'tracking',
  'ads',
  'seo_articles',
  'seo_reports',
  'reports',
  'design',
  'notifications',
  'branding',
  'websites',
  'auth',
] as const;

export type CacheDomain = (typeof ALL_DOMAINS)[number];

interface ServerCacheEntry {
  data: unknown;
  expiresAt: number;
  storedAt: number;
  domains: CacheDomain[];
}

export interface RealtimeRevisionEvent {
  type: 'revision';
  domains: CacheDomain[];
  reason?: string;
  revisions: Record<CacheDomain, number>;
  serverDateVn: string;
  serverTime: string;
}

interface GlobalServerCacheStore {
  revisions: Record<CacheDomain, number>;
  lastUpdatedAt: Record<CacheDomain, string>;
  responseCache: Map<string, ServerCacheEntry>;
  inflight: Map<string, Promise<unknown>>;
  listeners: Set<(event: RealtimeRevisionEvent) => void>;
  epoch: number;
}

const MAX_RESPONSE_CACHE_ENTRIES = 320;

const globalStore = globalThis as unknown as {
  __toantrungServerCacheV2?: GlobalServerCacheStore;
};

function createInitialStore(): GlobalServerCacheStore {
  const nowIso = new Date().toISOString();
  const revisions = {} as Record<CacheDomain, number>;
  const lastUpdatedAt = {} as Record<CacheDomain, string>;
  for (const d of ALL_DOMAINS) {
    revisions[d] = 1;
    lastUpdatedAt[d] = nowIso;
  }
  return {
    revisions,
    lastUpdatedAt,
    responseCache: new Map(),
    inflight: new Map(),
    listeners: new Set(),
    epoch: 1,
  };
}

function getStore(): GlobalServerCacheStore {
  if (!globalStore.__toantrungServerCacheV2) {
    globalStore.__toantrungServerCacheV2 = createInitialStore();
  }
  if (!globalStore.__toantrungServerCacheV2.listeners) {
    globalStore.__toantrungServerCacheV2.listeners = new Set();
  }
  return globalStore.__toantrungServerCacheV2;
}

export function getVietnamDateKey(date: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return new Date(date.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
}

export function getDomainRevisionsSnapshot(): {
  revisions: Record<CacheDomain, number>;
  lastUpdatedAt: Record<CacheDomain, string>;
  serverDateVn: string;
  serverTime: string;
} {
  const store = getStore();
  return {
    revisions: { ...store.revisions },
    lastUpdatedAt: { ...store.lastUpdatedAt },
    serverDateVn: getVietnamDateKey(),
    serverTime: new Date().toISOString(),
  };
}

export function getDomainRevisionSignature(domains: CacheDomain[]): string {
  const store = getStore();
  const unique = Array.from(new Set(domains)).sort();
  return unique.map((d) => `${d}=${store.revisions[d] ?? 1}`).join(',');
}

export function subscribeDomainRevisionStream(
  listener: (event: RealtimeRevisionEvent) => void,
): () => void {
  const store = getStore();
  store.listeners.add(listener);
  return () => {
    store.listeners.delete(listener);
  };
}

export function getCacheDiagnosticsSnapshot(): {
  epoch: number;
  cachedEntryCount: number;
  inflightCount: number;
  sseSubscriberCount: number;
} {
  const store = getStore();
  return {
    epoch: store.epoch,
    cachedEntryCount: store.responseCache.size,
    inflightCount: store.inflight.size,
    sseSubscriberCount: store.listeners.size,
  };
}

const SILENT_CACHE_EVICTION_REASONS = new Set<string>([
  'ga4_live_snapshot_refreshed',
  'ga4_realtime_refreshed',
  'background_ga4_warmer',
  'gads_live_snapshot_refreshed',
  'gsc_live_snapshot_refreshed',
  'keyword_derived_cache_refreshed',
  'google_trends_refreshed',
  'design_stale_job_expired',
]);

export function bumpDomainRevisions(domains: CacheDomain[], reason?: string): void {
  const store = getStore();
  const nowIso = new Date().toISOString();
  const targetSet = new Set<CacheDomain>(domains);
  const isSilentReadCacheRefresh = Boolean(reason && SILENT_CACHE_EVICTION_REASONS.has(reason));

  for (const [key, entry] of store.responseCache.entries()) {
    if (entry.domains.some((d) => targetSet.has(d))) {
      store.responseCache.delete(key);
    }
  }

  // Passive read-cache refreshes only evict stale responseCache entries;
  // they MUST NOT bump revision counters or broadcast SSE events (prevents read->SSE->read feedback loops).
  if (isSilentReadCacheRefresh) {
    return;
  }

  store.epoch += 1;
  for (const domain of targetSet) {
    store.revisions[domain] = (store.revisions[domain] || 1) + 1;
    store.lastUpdatedAt[domain] = nowIso;
  }

  // Delete matching inflight entries so future readers don't join a pre-invalidation compute
  const escapedDomains = domains.map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const domainRe = new RegExp(`(?:^|[|,])(?:${escapedDomains.join('|')})=`);
  for (const key of Array.from(store.inflight.keys())) {
    if (domainRe.test(key)) {
      store.inflight.delete(key);
    }
  }

  if (store.listeners.size > 0 && targetSet.size > 0) {
    const eventPayload: RealtimeRevisionEvent = {
      type: 'revision',
      domains: Array.from(targetSet),
      reason,
      revisions: { ...store.revisions },
      serverDateVn: getVietnamDateKey(),
      serverTime: nowIso,
    };
    for (const listener of Array.from(store.listeners)) {
      try {
        listener(eventPayload);
      } catch {
        // Isolate subscriber callback errors
      }
    }
  }
}

export function clearAllServerDataCache(): void {
  const store = getStore();
  store.epoch += 1;
  store.responseCache.clear();
  store.inflight.clear();
}

export async function getOrComputeScopedCache<T>(options: {
  key: string;
  domains: CacheDomain[];
  ttlMs: number;
  bypassCache?: boolean;
  compute: () => Promise<T>;
}): Promise<{ data: T; fromCache: boolean; cachedAt: string }> {
  const store = getStore();
  const now = Date.now();
  const vnDay = getVietnamDateKey(new Date(now));
  const revSig = getDomainRevisionSignature(options.domains);
  const fullKey = `${vnDay}|${revSig}|${options.key}`;

  if (!options.bypassCache) {
    const hit = store.responseCache.get(fullKey);
    if (hit && hit.expiresAt > now) {
      // Touch for LRU ordering
      store.responseCache.delete(fullKey);
      store.responseCache.set(fullKey, hit);
      return {
        data: hit.data as T,
        fromCache: true,
        cachedAt: new Date(hit.storedAt).toISOString(),
      };
    }
    const existingFlight = store.inflight.get(fullKey);
    if (existingFlight) {
      const resolved = (await existingFlight) as T;
      return {
        data: resolved,
        fromCache: true,
        cachedAt: new Date().toISOString(),
      };
    }
  }

  const startEpoch = store.epoch;
  const startSig = revSig;

  const rawPromise = (async () => {
    const value = await options.compute();
    const endNow = Date.now();
    const endDay = getVietnamDateKey(new Date(endNow));
    const endSig = getDomainRevisionSignature(options.domains);

    // Only cache if no overlapping invalidation or midnight rollover invalidated this scope
    if (store.epoch === startEpoch || (endSig === startSig && endDay === vnDay)) {
      if (store.responseCache.size >= MAX_RESPONSE_CACHE_ENTRIES) {
        const oldestKey = store.responseCache.keys().next().value;
        if (oldestKey !== undefined) {
          store.responseCache.delete(oldestKey);
        }
      }
      store.responseCache.set(fullKey, {
        data: value,
        expiresAt: endNow + options.ttlMs,
        storedAt: endNow,
        domains: options.domains,
      });
    }
    return value;
  })();

  const trackedPromise = rawPromise.finally(() => {
    if (store.inflight.get(fullKey) === trackedPromise) {
      store.inflight.delete(fullKey);
    }
  });

  if (!options.bypassCache) {
    store.inflight.set(fullKey, trackedPromise);
  }

  const result = await trackedPromise;
  return {
    data: result,
    fromCache: false,
    cachedAt: new Date().toISOString(),
  };
}

export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const safeLimit = Math.max(1, limit);
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function runLane() {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await worker(items[idx], idx);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(safeLimit, items.length) }, () => runLane()),
  );
  return results;
}
