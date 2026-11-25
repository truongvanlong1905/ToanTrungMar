import type { ApiErrorPayload, ApiSuccess } from '@toantrung/contracts';
import {
  inferDomainsFromApiPath,
  inferReadDependenciesForApiPath,
  publishDataSync,
  type SyncDomain,
} from './data-sync-bus';

export class ApiClientError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public requestId?: string,
  ) {
    super(message);
  }
}

interface CacheEntry {
  data: unknown;
  timestamp: number;
  vnDate: string;
}

export interface PeekCacheEntryResult<T> {
  data: T;
  timestamp: number;
  isFresh: boolean;
}

const GET_CACHE_FRESH_TTL_MS = 20_000;
const GET_CACHE_STALE_TTL_MS = 180_000;
const MAX_CACHE_ENTRIES = 150;

const apiGetCache = new Map<string, CacheEntry>();
const inflightGetRequests = new Map<string, Promise<unknown>>();
const cacheUpdateListeners = new Map<string, Set<(fresh: unknown) => void>>();

let currentCacheUserScope = 'anon';
let cacheEpoch = 1;

export function getVietnamDateKeyClient(date: Date = new Date()): string {
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

function buildScopedCacheKey(path: string, vnDate = getVietnamDateKeyClient()): string {
  return `${currentCacheUserScope}::${vnDate}::${path}`;
}

function extractPathFromScopedKey(scopedKey: string): string {
  const firstIdx = scopedKey.indexOf('::');
  if (firstIdx === -1) return scopedKey;
  const secondIdx = scopedKey.indexOf('::', firstIdx + 2);
  if (secondIdx === -1) return scopedKey.slice(firstIdx + 2);
  return scopedKey.slice(secondIdx + 2);
}

function setLruCacheEntry(scopedKey: string, data: unknown, vnDate: string): void {
  apiGetCache.delete(scopedKey);
  apiGetCache.set(scopedKey, { data, timestamp: Date.now(), vnDate });
  while (apiGetCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = apiGetCache.keys().next().value;
    if (!oldestKey) break;
    apiGetCache.delete(oldestKey);
  }
}

function notifyCacheListeners(scopedKey: string, freshData: unknown): void {
  const set = cacheUpdateListeners.get(scopedKey);
  if (!set || set.size === 0) return;
  for (const cb of Array.from(set)) {
    try {
      cb(freshData);
    } catch {
      // listener failure must not break cache update
    }
  }
}

function withAbortSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(
      signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'),
    );
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(
        signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'),
      );
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (val) => {
        signal.removeEventListener('abort', onAbort);
        resolve(val);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

/**
 * Gắn phạm vi cache theo phiên người dùng + vai trò hiện tại.
 * Khi đăng xuất, đổi tài khoản hoặc đổi quyền, toàn bộ cache nhạy cảm bị xóa tức thì.
 */
export function setApiCacheUserScope(userScopeKey: string | null): void {
  const normalized = userScopeKey?.trim() || 'anon';
  if (normalized !== currentCacheUserScope) {
    cacheEpoch += 1;
    apiGetCache.clear();
    inflightGetRequests.clear();
    currentCacheUserScope = normalized;
  }
}

export function clearAllApiCache(): void {
  cacheEpoch += 1;
  apiGetCache.clear();
  inflightGetRequests.clear();
}

export function peekApiCacheEntry<T>(path: string): PeekCacheEntryResult<T> | null {
  const vnDate = getVietnamDateKeyClient();
  const scopedKey = buildScopedCacheKey(path, vnDate);
  const entry = apiGetCache.get(scopedKey);
  if (!entry) return null;
  const age = Date.now() - entry.timestamp;
  if (entry.vnDate !== vnDate || age > GET_CACHE_STALE_TTL_MS) {
    apiGetCache.delete(scopedKey);
    return null;
  }
  // Touch LRU order on read
  apiGetCache.delete(scopedKey);
  apiGetCache.set(scopedKey, entry);
  return {
    data: entry.data as T,
    timestamp: entry.timestamp,
    isFresh: age <= GET_CACHE_FRESH_TTL_MS,
  };
}

export function peekApiCache<T>(path: string): T | null {
  return peekApiCacheEntry<T>(path)?.data ?? null;
}

export function subscribeApiCacheUpdates<T>(path: string, callback: (fresh: T) => void): () => void {
  const scopedKey = buildScopedCacheKey(path);
  let set = cacheUpdateListeners.get(scopedKey);
  if (!set) {
    set = new Set();
    cacheUpdateListeners.set(scopedKey, set);
  }
  const wrapped = callback as (fresh: unknown) => void;
  set.add(wrapped);
  return () => {
    const current = cacheUpdateListeners.get(scopedKey);
    if (!current) return;
    current.delete(wrapped);
    if (current.size === 0) {
      cacheUpdateListeners.delete(scopedKey);
    }
  };
}

export function invalidateApiCache(pathPrefix?: string): void {
  cacheEpoch += 1;
  if (!pathPrefix) {
    apiGetCache.clear();
    inflightGetRequests.clear();
    return;
  }
  for (const key of Array.from(apiGetCache.keys())) {
    const p = extractPathFromScopedKey(key);
    if (p.startsWith(pathPrefix)) {
      apiGetCache.delete(key);
    }
  }
  for (const key of Array.from(inflightGetRequests.keys())) {
    const p = extractPathFromScopedKey(key);
    if (p.startsWith(pathPrefix)) {
      inflightGetRequests.delete(key);
    }
  }
}

export function invalidateApiCacheByDomains(domains: SyncDomain[]): void {
  if (domains.length === 0) return;
  cacheEpoch += 1;
  const domainSet = new Set<SyncDomain>(domains);

  for (const key of Array.from(apiGetCache.keys())) {
    const path = extractPathFromScopedKey(key);
    const deps = inferReadDependenciesForApiPath(path);
    if (deps.some((d) => domainSet.has(d))) {
      apiGetCache.delete(key);
    }
  }
  for (const key of Array.from(inflightGetRequests.keys())) {
    const path = extractPathFromScopedKey(key);
    const deps = inferReadDependenciesForApiPath(path);
    if (deps.some((d) => domainSet.has(d))) {
      inflightGetRequests.delete(key);
    }
  }
}

export function prefetchApiCache(path: string): void {
  if (typeof window === 'undefined') return;
  const entry = peekApiCacheEntry(path);
  if (entry?.isFresh) {
    return;
  }
  const scopedKey = buildScopedCacheKey(path);
  if (inflightGetRequests.has(scopedKey)) {
    return;
  }
  void apiRequest(path).catch(() => {});
}

async function performNetworkFetch<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: unknown;
    csrfToken?: string;
    isFormData?: boolean;
    signal?: AbortSignal;
  },
): Promise<T> {
  const method = options.method || 'GET';
  const headers: Record<string, string> = {};

  if (!options.isFormData && options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (options.csrfToken && method !== 'GET') {
    headers['x-csrf-token'] = options.csrfToken;
  }

  headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
  headers['Pragma'] = 'no-cache';

  const res = await fetch(path, {
    method,
    headers,
    cache: 'no-store',
    credentials: 'include',
    signal: options.signal,
    body: options.isFormData
      ? (options.body as FormData)
      : options.body !== undefined
        ? typeof options.body === 'string'
          ? options.body
          : JSON.stringify(options.body)
        : undefined,
  });

  const payload = (await res.json().catch(() => null)) as
    | ApiSuccess<T>
    | ApiErrorPayload
    | null;

  if (!res.ok || !payload || 'error' in payload) {
    if (
      res.status === 401 &&
      typeof window !== 'undefined' &&
      path !== '/api/v1/auth/login' &&
      path !== '/api/v1/auth/me'
    ) {
      clearAllApiCache();
      window.dispatchEvent(new CustomEvent('tt-session-unauthorized'));
    }
    const errObj = payload && 'error' in payload ? payload.error : null;
    throw new ApiClientError(
      errObj?.code || 'HTTP_ERROR',
      errObj?.message || `Yêu cầu thất bại (Mã ${res.status}).`,
      res.status,
      errObj?.requestId,
    );
  }

  return payload.data;
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: unknown;
    csrfToken?: string;
    isFormData?: boolean;
    signal?: AbortSignal;
    skipCache?: boolean;
    onRevalidated?: (freshData: T) => void;
  } = {},
): Promise<T> {
  const method = options.method || 'GET';

  if (method !== 'GET') {
    const affectedDomains = inferDomainsFromApiPath(path);
    invalidateApiCacheByDomains(affectedDomains);
    const result = await performNetworkFetch<T>(path, options);
    invalidateApiCacheByDomains(affectedDomains);
    publishDataSync(affectedDomains, `mutation:${method}:${path.split('?')[0]}`);
    return result;
  }

  const vnDate = getVietnamDateKeyClient();
  const scopedKey = buildScopedCacheKey(path, vnDate);
  const scopeSnapshot = currentCacheUserScope;
  const now = Date.now();

  if (!options.skipCache && !options.signal?.aborted) {
    const cached = apiGetCache.get(scopedKey);
    if (cached && cached.vnDate === vnDate) {
      const age = now - cached.timestamp;
      if (age <= GET_CACHE_FRESH_TTL_MS) {
        return cached.data as T;
      }
      if (age <= GET_CACHE_STALE_TTL_MS) {
        if (!inflightGetRequests.has(scopedKey)) {
          const startEpoch = cacheEpoch;
          const bgPromise = performNetworkFetch<T>(path, { method: 'GET' })
            .then((freshData) => {
              if (currentCacheUserScope === scopeSnapshot && startEpoch === cacheEpoch) {
                setLruCacheEntry(scopedKey, freshData, vnDate);
                notifyCacheListeners(scopedKey, freshData);
                options.onRevalidated?.(freshData);
              }
              return freshData;
            })
            .catch(() => cached.data as T)
            .finally(() => {
              if (inflightGetRequests.get(scopedKey) === bgPromise) {
                inflightGetRequests.delete(scopedKey);
              }
            });
          inflightGetRequests.set(scopedKey, bgPromise);
        } else if (options.onRevalidated) {
          void inflightGetRequests.get(scopedKey)?.then((fresh) => {
            if (!options.signal?.aborted) {
              options.onRevalidated?.(fresh as T);
            }
          });
        }
        return cached.data as T;
      }
      apiGetCache.delete(scopedKey);
    }
  }

  if (!options.skipCache) {
    const existingInflight = inflightGetRequests.get(scopedKey);
    if (existingInflight) {
      return withAbortSignal(existingInflight as Promise<T>, options.signal);
    }
  }

  const startEpoch = cacheEpoch;
  const fetchPromise = performNetworkFetch<T>(path, {
    method: 'GET',
    // When cacheable, share network flight across callers rather than aborting shared fetch on single unmount
    signal: options.skipCache ? options.signal : undefined,
  })
    .then((data) => {
      if (
        currentCacheUserScope === scopeSnapshot &&
        startEpoch === cacheEpoch &&
        path !== '/api/v1/auth/me' &&
        !path.startsWith('/api/v1/system/revisions')
      ) {
        setLruCacheEntry(scopedKey, data, vnDate);
      }
      return data;
    })
    .finally(() => {
      if (!options.skipCache && inflightGetRequests.get(scopedKey) === fetchPromise) {
        inflightGetRequests.delete(scopedKey);
      }
    });

  if (!options.skipCache) {
    inflightGetRequests.set(scopedKey, fetchPromise);
    return withAbortSignal(fetchPromise, options.signal);
  }

  return fetchPromise;
}
