import { prisma } from '@toantrung/database';
import type { M03TrendRowDto } from '@toantrung/contracts';
import { bumpDomainRevisions } from '../../core/cache/server-data-cache';

const SETTING_TRENDS_LIVE_CACHE = 'google_trends_vn_live_cache_v1';
const SETTING_TRENDS_SERPAPI_KEY = 'google_trends_serpapi_api_key_v1';
const SETTING_TRENDS_EXPLORE_EXTRAS = 'google_trends_explore_extras_v1';
const TRENDS_CACHE_TTL_MS = 15 * 60 * 1000; // 15 phút
const SUGGEST_CACHE_TTL_MS = 10 * 60 * 1000;

export interface GoogleTrendsRegionRow {
  regionName: string;
  term: string;
  interestValue: number;
}

export interface GoogleTrendsRelatedQueryRow {
  term: string;
  query: string;
  valueLabel: string;
  kind: 'rising' | 'top';
}

export interface GoogleTrendsExploreExtras {
  updatedAt: string;
  regionRows: GoogleTrendsRegionRow[];
  relatedQueries: GoogleTrendsRelatedQueryRow[];
}

export interface ParsedTrendsCsvResult {
  detectedType: 'timeline' | 'geomap';
  terms: string[];
  timelinePoints: Array<{ date: string; term: string; value: number }>;
  regionRows: GoogleTrendsRegionRow[];
}

function splitCsvLine(line: string): string[] {
  const cols: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cols.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cols.push(cur.trim());
  return cols;
}

/**
 * Pure parser tự động nhận diện file multiTimeline.csv (tối đa 5 từ khóa theo ngày/tuần/tháng)
 * hoặc geoMap.csv (mức độ quan tâm theo Tỉnh/Thành phố) xuất từ Google Trends Explore.
 */
export function parseGoogleTrendsCsvAuto(csvContent: string): ParsedTrendsCsvResult {
  const lines = csvContent
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let detectedType: 'timeline' | 'geomap' | null = null;
  let headerIdx = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i];
    if (/^"?(?:ngày|tuần|tháng|thời gian|day|week|month|date|time)[^,"]*"?\s*,/i.test(l)) {
      headerIdx = i;
      detectedType = 'timeline';
      break;
    }
    if (
      /^"?(?:khu vực|tỉnh|thành phố|vùng|tiểu vùng|region|subregion|dma|metro|city|country)[^,"]*"?\s*,/i.test(
        l,
      )
    ) {
      headerIdx = i;
      detectedType = 'geomap';
      break;
    }
  }

  if (headerIdx === -1 || headerIdx + 1 >= lines.length || !detectedType) {
    throw new Error(
      'Không tìm thấy dòng tiêu đề hợp lệ (Ngày/Tuần hoặc Khu vực/Region) trong file CSV xuất từ Google Trends.',
    );
  }

  const headerCols = splitCsvLine(lines[headerIdx]);
  const terms = headerCols
    .slice(1)
    .map((col) => col.replace(/:\s*\([^)]*\)\s*$/, '').trim())
    .filter(Boolean)
    .slice(0, 5);

  if (terms.length === 0) {
    throw new Error('File CSV không có cột từ khóa nào.');
  }

  const timelinePoints: Array<{ date: string; term: string; value: number }> = [];
  const regionRows: GoogleTrendsRegionRow[] = [];

  for (let i = headerIdx + 1; i < lines.length; i += 1) {
    const cols = splitCsvLine(lines[i]);
    const label = (cols[0] || '').trim();
    if (!label) continue;

    if (detectedType === 'timeline') {
      const normalizedDate = /^\d{4}-\d{2}-\d{2}$/.test(label)
        ? label
        : /^\d{4}-\d{2}$/.test(label)
          ? `${label}-01`
          : null;
      if (!normalizedDate) continue;

      for (let tIdx = 0; tIdx < terms.length; tIdx += 1) {
        const rawVal = (cols[tIdx + 1] || '').replace(/%$/, '').trim();
        if (!rawVal) continue;
        const numericVal = rawVal.includes('<') ? 1 : Number(rawVal);
        if (!Number.isFinite(numericVal)) continue;
        timelinePoints.push({
          date: normalizedDate,
          term: terms[tIdx],
          value: Math.max(0, Math.min(100, Math.round(numericVal))),
        });
      }
    } else {
      for (let tIdx = 0; tIdx < terms.length; tIdx += 1) {
        const rawVal = (cols[tIdx + 1] || '').replace(/%$/, '').trim();
        if (!rawVal) continue;
        const numericVal = rawVal.includes('<') ? 1 : Number(rawVal);
        if (!Number.isFinite(numericVal)) continue;
        regionRows.push({
          regionName: label,
          term: terms[tIdx],
          interestValue: Math.max(0, Math.min(100, Math.round(numericVal))),
        });
      }
    }
  }

  return { detectedType, terms, timelinePoints, regionRows };
}

const globalTrendsStore = globalThis as unknown as {
  __toantrungTrendsMemCache?: {
    expiresAt: number;
    payload: GoogleTrendsLiveCachePayload;
  } | null;
  __toantrungTrendsInFlight?: Promise<GoogleTrendsLiveCachePayload> | null;
  __toantrungSuggestCache?: Map<string, { expiresAt: number; items: string[] }>;
  __toantrungSuggestInFlight?: Map<string, Promise<string[]>>;
};

function getSuggestCache() {
  if (!globalTrendsStore.__toantrungSuggestCache) {
    globalTrendsStore.__toantrungSuggestCache = new Map();
  }
  if (!globalTrendsStore.__toantrungSuggestInFlight) {
    globalTrendsStore.__toantrungSuggestInFlight = new Map();
  }
  return {
    cache: globalTrendsStore.__toantrungSuggestCache,
    inflight: globalTrendsStore.__toantrungSuggestInFlight,
  };
}

const DEFAULT_LED_SEED_TERMS = [
  'màn hình led',
  'bảng điện tử led',
  'màn hình led hội trường',
  'màn hình led ngoài trời',
];

export interface GoogleTrendsLiveCachePayload {
  fetchedAt: string;
  dailyRssTrends: M03TrendRowDto[];
  industrySuggestions: Array<{
    seedTerm: string;
    suggestions: string[];
    checkedAt: string;
  }>;
  errorMessage?: string | null;
}

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .trim();
}

function extractXmlTag(block: string, tagName: string): string | null {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i');
  const m = block.match(re);
  return m ? decodeXmlEntities(m[1]) : null;
}

/**
 * Đọc RSS chính thức của Google Trends Việt Nam (https://trends.google.com/trending/rss?geo=VN)
 */
export async function fetchGoogleTrendsVietnamRss(): Promise<M03TrendRowDto[]> {
  const res = await fetch('https://trends.google.com/trending/rss?geo=VN', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ToanTrungAnalytics/2.0)',
      Accept: 'application/rss+xml, application/xml, text/xml',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`Google Trends RSS trả mã lỗi HTTP ${res.status}`);
  }
  const xml = await res.text();
  const itemMatches = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
  const rows: M03TrendRowDto[] = [];

  for (const itemXml of itemMatches.slice(0, 20)) {
    const title = extractXmlTag(itemXml, 'title');
    if (!title) continue;
    const approxTraffic = extractXmlTag(itemXml, 'ht:approx_traffic');
    const pubDateRaw = extractXmlTag(itemXml, 'pubDate');
    const newsHeadline = extractXmlTag(itemXml, 'ht:news_item_title');
    const newsSource = extractXmlTag(itemXml, 'ht:news_item_source');

    let dateYmd = new Date().toISOString().slice(0, 10);
    if (pubDateRaw) {
      const parsed = new Date(pubDateRaw);
      if (!Number.isNaN(parsed.getTime())) {
        dateYmd = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Ho_Chi_Minh',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(parsed);
      }
    }

    rows.push({
      term: title,
      geoCode: 'VN',
      geoName: 'Việt Nam',
      date: dateYmd,
      interestValue: null,
      scaleType: 'DAILY_TRENDING_RSS',
      comparisonGroupId: 'vn_daily_rss',
      sourceType: 'GOOGLE_TRENDS_RSS',
      approxTrafficLabel: approxTraffic || null,
      newsHeadline: newsHeadline || null,
      newsSource: newsSource || null,
    });
  }

  return rows;
}

/**
 * Tra cứu gợi ý tìm kiếm thực tế tại Việt Nam từ Google Autocomplete Suggest
 */
export async function fetchGoogleVietnamSuggestions(seedQuery: string): Promise<string[]> {
  const q = seedQuery.trim();
  if (!q) return [];
  const norm = q.toLowerCase();
  const { cache, inflight } = getSuggestCache();
  const hit = cache.get(norm);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.items;
  }
  const existingFlight = inflight.get(norm);
  if (existingFlight) return existingFlight;

  const p = (async () => {
    try {
      const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=vi&gl=vn&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ToanTrungAnalytics/2.0)' },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return [];
      const json = (await res.json()) as unknown;
      if (!Array.isArray(json) || !Array.isArray(json[1])) return [];
      const items = (json[1] as unknown[])
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((s) => s.trim());
      if (cache.size > 200) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(norm, { expiresAt: Date.now() + SUGGEST_CACHE_TTL_MS, items });
      return items;
    } finally {
      inflight.delete(norm);
    }
  })();
  inflight.set(norm, p);
  return p;
}

async function refreshGoogleTrendsCacheInternal(): Promise<GoogleTrendsLiveCachePayload> {
  const checkedAt = new Date().toISOString();
  const [rssRes, suggestResults] = await Promise.all([
    fetchGoogleTrendsVietnamRss().catch((err) => {
      return { __err: err instanceof Error ? err.message : 'Lỗi tải Google Trends RSS' };
    }),
    Promise.all(
      DEFAULT_LED_SEED_TERMS.map(async (seedTerm) => {
        const suggestions = await fetchGoogleVietnamSuggestions(seedTerm).catch(() => []);
        return {
          seedTerm,
          suggestions: suggestions.filter((s) => s.toLowerCase() !== seedTerm.toLowerCase()).slice(0, 8),
          checkedAt,
        };
      }),
    ),
  ]);

  const dailyRssTrends = Array.isArray(rssRes) ? rssRes : [];
  const errorMessage = !Array.isArray(rssRes) ? rssRes.__err : null;

  const payload: GoogleTrendsLiveCachePayload = {
    fetchedAt: checkedAt,
    dailyRssTrends,
    industrySuggestions: suggestResults.filter((g) => g.suggestions.length > 0),
    errorMessage,
  };

  globalTrendsStore.__toantrungTrendsMemCache = {
    expiresAt: Date.now() + TRENDS_CACHE_TTL_MS,
    payload,
  };

  await prisma.systemSetting
    .upsert({
      where: { key: SETTING_TRENDS_LIVE_CACHE },
      update: { value: JSON.stringify(payload) },
      create: {
        key: SETTING_TRENDS_LIVE_CACHE,
        value: JSON.stringify(payload),
      },
    })
    .catch(() => {});

  bumpDomainRevisions(['ads'], 'google_trends_refreshed');
  return payload;
}

export async function getSerpApiTrendsKey(): Promise<string | null> {
  if (process.env.SERPAPI_API_KEY && process.env.SERPAPI_API_KEY.trim()) {
    return process.env.SERPAPI_API_KEY.trim();
  }
  const row = await prisma.systemSetting
    .findUnique({ where: { key: SETTING_TRENDS_SERPAPI_KEY } })
    .catch(() => null);
  return row?.value?.trim() || null;
}

export async function saveSerpApiTrendsKey(apiKey: string): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: SETTING_TRENDS_SERPAPI_KEY },
    update: { value: apiKey.trim() },
    create: {
      key: SETTING_TRENDS_SERPAPI_KEY,
      value: apiKey.trim(),
    },
  });
}

/**
 * Đọc snapshot Google Trends nhanh (non-blocking khi đã có cache DB/RAM; tự làm mới lần đầu nếu chưa có cache).
 */
export async function getGoogleTrendsLiveSnapshot(
  forceRefresh = false,
): Promise<GoogleTrendsLiveCachePayload> {
  const now = Date.now();
  const mem = globalTrendsStore.__toantrungTrendsMemCache;
  if (!forceRefresh && mem && mem.expiresAt > now) {
    return mem.payload;
  }

  const triggerBackground = () => {
    if (process.env.NODE_TEST_CONTEXT) return;
    if (!globalTrendsStore.__toantrungTrendsInFlight) {
      globalTrendsStore.__toantrungTrendsInFlight = refreshGoogleTrendsCacheInternal().finally(() => {
        globalTrendsStore.__toantrungTrendsInFlight = null;
      });
    }
  };

  if (!forceRefresh) {
    const dbRow = await prisma.systemSetting
      .findUnique({ where: { key: SETTING_TRENDS_LIVE_CACHE } })
      .catch(() => null);
    if (dbRow?.value) {
      try {
        const parsed = JSON.parse(dbRow.value) as GoogleTrendsLiveCachePayload;
        const ageMs = now - new Date(parsed.fetchedAt).getTime();
        globalTrendsStore.__toantrungTrendsMemCache = {
          expiresAt: now + Math.max(30_000, TRENDS_CACHE_TTL_MS - ageMs),
          payload: parsed,
        };
        if (ageMs > TRENDS_CACHE_TTL_MS) {
          triggerBackground();
        }
        return parsed;
      } catch {
        // fall through to non-blocking placeholder + background refresh
      }
    }
    triggerBackground();
    return {
      fetchedAt: '',
      dailyRssTrends: [],
      industrySuggestions: [],
      errorMessage: 'Đang tải xu hướng Google Trends trong nền...',
    };
  }

  if (!globalTrendsStore.__toantrungTrendsInFlight) {
    globalTrendsStore.__toantrungTrendsInFlight = refreshGoogleTrendsCacheInternal().finally(() => {
      globalTrendsStore.__toantrungTrendsInFlight = null;
    });
  }
  return globalTrendsStore.__toantrungTrendsInFlight;
}

async function saveGoogleTrendsExploreExtras(
  patch: Partial<Pick<GoogleTrendsExploreExtras, 'regionRows' | 'relatedQueries'>>,
): Promise<GoogleTrendsExploreExtras> {
  const current = await getGoogleTrendsExploreExtras();
  const next: GoogleTrendsExploreExtras = {
    updatedAt: new Date().toISOString(),
    regionRows:
      patch.regionRows !== undefined && patch.regionRows.length > 0
        ? patch.regionRows
        : current.regionRows,
    relatedQueries:
      patch.relatedQueries !== undefined && patch.relatedQueries.length > 0
        ? patch.relatedQueries
        : current.relatedQueries,
  };
  await prisma.systemSetting
    .upsert({
      where: { key: SETTING_TRENDS_EXPLORE_EXTRAS },
      update: { value: JSON.stringify(next) },
      create: { key: SETTING_TRENDS_EXPLORE_EXTRAS, value: JSON.stringify(next) },
    })
    .catch(() => null);
  return next;
}

export async function getGoogleTrendsExploreExtras(): Promise<GoogleTrendsExploreExtras> {
  try {
    const row = await prisma.systemSetting.findUnique({
      where: { key: SETTING_TRENDS_EXPLORE_EXTRAS },
    });
    if (row?.value) {
      const parsed = JSON.parse(row.value) as GoogleTrendsExploreExtras;
      return {
        updatedAt: parsed.updatedAt || '',
        regionRows: Array.isArray(parsed.regionRows) ? parsed.regionRows : [],
        relatedQueries: Array.isArray(parsed.relatedQueries) ? parsed.relatedQueries : [],
      };
    }
  } catch {
    // ignore corrupt
  }
  return { updatedAt: '', regionRows: [], relatedQueries: [] };
}

/**
 * So sánh miễn phí 1–5 từ khóa trên Google Suggest VN (không cần API Key trả phí)
 */
export async function compareKeywordsViaFreeSuggest(keywords: string[]): Promise<{
  results: Array<{ term: string; suggestions: string[] }>;
  checkedAt: string;
}> {
  const cleanTerms = Array.from(
    new Set(keywords.map((k) => k.trim()).filter((k) => k.length >= 2)),
  ).slice(0, 5);
  if (cleanTerms.length === 0) {
    throw new Error('Vui lòng nhập ít nhất 1 từ khóa (tối thiểu 2 ký tự).');
  }
  const checkedAt = new Date().toISOString();
  const results = await Promise.all(
    cleanTerms.map(async (term) => {
      const suggestions = await fetchGoogleVietnamSuggestions(term).catch(() => []);
      return {
        term,
        suggestions: suggestions
          .filter((s) => s.toLowerCase() !== term.toLowerCase())
          .slice(0, 10),
      };
    }),
  );

  const relatedQueries: GoogleTrendsRelatedQueryRow[] = [];
  for (const r of results) {
    for (const s of r.suggestions) {
      relatedQueries.push({
        term: r.term,
        query: s,
        valueLabel: 'Google VN đề xuất',
        kind: 'top',
      });
    }
  }
  if (relatedQueries.length > 0) {
    await saveGoogleTrendsExploreExtras({ relatedQueries });
  }
  return { results, checkedAt };
}

/**
 * Đồng bộ chuỗi chỉ số quan tâm (0–100) của 1–5 từ khóa qua SerpApi Google Trends (khi có khóa SERPAPI_API_KEY)
 */
export async function syncKeywordInterestViaSerpApi(params: {
  keyword?: string;
  keywords?: string[];
  geo?: string;
  dateRange?: string;
}): Promise<{ syncedPoints: number; terms: string[]; relatedRising: string[] }> {
  const apiKey = await getSerpApiTrendsKey();
  if (!apiKey) {
    throw new Error(
      'Chưa cấu hình khóa SERPAPI_API_KEY để lấy chuỗi chỉ số 0–100 tự động. Bạn vẫn có thể tra cứu miễn phí hoặc tải trực tiếp file multiTimeline.csv / geoMap.csv từ Google Trends.',
    );
  }
  const inputList =
    Array.isArray(params.keywords) && params.keywords.length > 0
      ? params.keywords
      : params.keyword
        ? [params.keyword]
        : [];
  const cleanTerms = Array.from(
    new Set(inputList.map((k) => k.trim()).filter((k) => k.length >= 2)),
  ).slice(0, 5);
  if (cleanTerms.length === 0) {
    throw new Error('Từ khóa cần tối thiểu 2 ký tự.');
  }
  const geo = params.geo || 'VN';
  const dateRange = params.dateRange || 'today 1-m';
  const qJoined = cleanTerms.join(',');

  const tsUrl = new URL('https://serpapi.com/search.json');
  tsUrl.searchParams.set('engine', 'google_trends');
  tsUrl.searchParams.set('q', qJoined);
  tsUrl.searchParams.set('geo', geo);
  tsUrl.searchParams.set('date', dateRange);
  tsUrl.searchParams.set('data_type', 'TIMESERIES');
  tsUrl.searchParams.set('hl', 'vi');
  tsUrl.searchParams.set('api_key', apiKey);

  const startedAt = new Date();
  const res = await fetch(tsUrl.toString(), { signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`SerpApi Google Trends trả lỗi HTTP ${res.status}: ${errText.slice(0, 180)}`);
  }

  const json = (await res.json()) as {
    error?: string;
    interest_over_time?: {
      timeline_data?: Array<{
        timestamp?: string;
        date?: string;
        values?: Array<{ query?: string; extracted_value?: number }>;
      }>;
    };
  };
  if (json.error) {
    throw new Error(`SerpApi báo lỗi: ${json.error}`);
  }

  const timeline = json.interest_over_time?.timeline_data || [];
  let syncedPoints = 0;

  for (const pt of timeline) {
    const tsSec = Number(pt.timestamp);
    if (!Number.isFinite(tsSec) || tsSec <= 0) continue;
    const metricDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(tsSec * 1000));

    for (let idx = 0; idx < cleanTerms.length; idx += 1) {
      const valObj = pt.values?.[idx];
      const term = (valObj?.query || cleanTerms[idx]).trim();
      const val = valObj?.extracted_value;
      if (typeof val !== 'number' || !Number.isFinite(val)) continue;
      const clampedScore = Math.max(0, Math.min(100, Math.round(val)));
      const normKw = term.toLowerCase();
      const fingerprint = `google_trends|${geo}|${metricDate}|topic|${normKw}`;

      await prisma.platformDailyMetric.upsert({
        where: {
          uq_platform_metric_scope: {
            platform: 'google_trends',
            accountPropertyId: geo,
            metricDate,
            grain: 'topic',
            campaignExternalId: 'serpapi_timeseries',
            keywordMatchType: '',
            keywordTextNorm: normKw,
            pagePathNorm: '',
          },
        },
        update: {
          keywordRaw: term,
          trendInterestScore: clampedScore,
          impressions: clampedScore,
          dimensionFingerprint: fingerprint,
          syncedAt: new Date(),
        },
        create: {
          platform: 'google_trends',
          accountPropertyId: geo,
          metricDate,
          grain: 'topic',
          campaignExternalId: 'serpapi_timeseries',
          keywordMatchType: '',
          keywordTextNorm: normKw,
          pagePathNorm: '',
          dimensionFingerprint: fingerprint,
          keywordRaw: term,
          trendInterestScore: clampedScore,
          impressions: clampedScore,
        },
      });
      syncedPoints += 1;
    }
  }

  // Kéo thêm GEO_MAP & RELATED_QUERIES cho từ khóa đầu tiên nếu SerpApi hỗ trợ
  try {
    const geoUrl = new URL('https://serpapi.com/search.json');
    geoUrl.searchParams.set('engine', 'google_trends');
    geoUrl.searchParams.set('q', cleanTerms[0]);
    geoUrl.searchParams.set('geo', geo);
    geoUrl.searchParams.set('date', dateRange);
    geoUrl.searchParams.set('data_type', 'GEO_MAP_0');
    geoUrl.searchParams.set('hl', 'vi');
    geoUrl.searchParams.set('api_key', apiKey);

    const relUrl = new URL('https://serpapi.com/search.json');
    relUrl.searchParams.set('engine', 'google_trends');
    relUrl.searchParams.set('q', cleanTerms[0]);
    relUrl.searchParams.set('geo', geo);
    relUrl.searchParams.set('date', dateRange);
    relUrl.searchParams.set('data_type', 'RELATED_QUERIES');
    relUrl.searchParams.set('hl', 'vi');
    relUrl.searchParams.set('api_key', apiKey);

    const [geoRes, relRes] = await Promise.all([
      fetch(geoUrl.toString(), { signal: AbortSignal.timeout(10000) }).catch(() => null),
      fetch(relUrl.toString(), { signal: AbortSignal.timeout(10000) }).catch(() => null),
    ]);

    const nextRegions: GoogleTrendsRegionRow[] = [];
    const nextRelated: GoogleTrendsRelatedQueryRow[] = [];

    if (geoRes?.ok) {
      const geoJson = (await geoRes.json()) as {
        interest_by_region?: Array<{ location?: string; extracted_value?: number }>;
      };
      for (const r of geoJson.interest_by_region || []) {
        if (r.location && typeof r.extracted_value === 'number') {
          nextRegions.push({
            regionName: r.location,
            term: cleanTerms[0],
            interestValue: Math.max(0, Math.min(100, Math.round(r.extracted_value))),
          });
        }
      }
    }

    if (relRes?.ok) {
      const relJson = (await relRes.json()) as {
        related_queries?: {
          rising?: Array<{ query?: string; value?: string }>;
          top?: Array<{ query?: string; value?: string }>;
        };
      };
      for (const r of relJson.related_queries?.rising || []) {
        if (r.query) {
          nextRelated.push({
            term: cleanTerms[0],
            query: r.query,
            valueLabel: r.value || 'Đang tăng',
            kind: 'rising',
          });
        }
      }
      for (const t of relJson.related_queries?.top || []) {
        if (t.query) {
          nextRelated.push({
            term: cleanTerms[0],
            query: t.query,
            valueLabel: t.value || '100',
            kind: 'top',
          });
        }
      }
    }

    if (nextRegions.length > 0 || nextRelated.length > 0) {
      await saveGoogleTrendsExploreExtras({
        regionRows: nextRegions,
        relatedQueries: nextRelated,
      });
    }
  } catch {
    // non-fatal
  }

  await prisma.platformSyncLog.create({
    data: {
      platform: 'google_trends',
      accountPropertyId: geo,
      status: 'success',
      recordsSynced: syncedPoints,
      startedAt,
      completedAt: new Date(),
    },
  });

  const relatedRising = await fetchGoogleVietnamSuggestions(cleanTerms[0]).catch(() => []);
  return { syncedPoints, terms: cleanTerms, relatedRising };
}

/**
 * Nhập trực tiếp file multiTimeline.csv hoặc geoMap.csv tải về từ trang Google Trends Explore
 */
export async function importGoogleTrendsTimelineCsv(csvContent: string): Promise<{
  detectedType: 'timeline' | 'geomap';
  importedRows: number;
  terms: string[];
}> {
  const parsed = parseGoogleTrendsCsvAuto(csvContent);

  if (parsed.detectedType === 'geomap') {
    if (parsed.regionRows.length === 0) {
      throw new Error('Không đọc được dòng dữ liệu Tỉnh/Thành nào trong file CSV.');
    }
    await saveGoogleTrendsExploreExtras({ regionRows: parsed.regionRows });
    return {
      detectedType: 'geomap',
      importedRows: parsed.regionRows.length,
      terms: parsed.terms,
    };
  }

  if (parsed.timelinePoints.length === 0) {
    throw new Error('Không đọc được điểm dữ liệu ngày YYYY-MM-DD nào từ file CSV.');
  }

  let importedRows = 0;
  for (const pt of parsed.timelinePoints) {
    const normKw = pt.term.toLowerCase();
    const fingerprint = `google_trends|VN|${pt.date}|topic|${normKw}`;
    await prisma.platformDailyMetric.upsert({
      where: {
        uq_platform_metric_scope: {
          platform: 'google_trends',
          accountPropertyId: 'VN',
          metricDate: pt.date,
          grain: 'topic',
          campaignExternalId: 'csv_import',
          keywordMatchType: '',
          keywordTextNorm: normKw,
          pagePathNorm: '',
        },
      },
      update: {
        keywordRaw: pt.term,
        trendInterestScore: pt.value,
        impressions: pt.value,
        dimensionFingerprint: fingerprint,
        syncedAt: new Date(),
      },
      create: {
        platform: 'google_trends',
        accountPropertyId: 'VN',
        metricDate: pt.date,
        grain: 'topic',
        campaignExternalId: 'csv_import',
        keywordMatchType: '',
        keywordTextNorm: normKw,
        pagePathNorm: '',
        dimensionFingerprint: fingerprint,
        keywordRaw: pt.term,
        trendInterestScore: pt.value,
        impressions: pt.value,
      },
    });
    importedRows += 1;
  }

  return {
    detectedType: 'timeline',
    importedRows,
    terms: parsed.terms,
  };
}
