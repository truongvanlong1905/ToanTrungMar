import { prisma } from '@toantrung/database';
import type {
  DashboardDatePreset,
  WebsiteConfigItemDto,
} from '@toantrung/contracts';
import {
  countInclusiveCalendarDays,
  getCustomCanonicalDateRange,
  getVietnamDateParts,
  resolveDatePresetRange,
} from './reporting-dates';
import { bumpDomainRevisions } from './cache/server-data-cache';

const SENSITIVE_QUERY_PARAMS = new Set([
  'token',
  'access_token',
  'refresh_token',
  'auth',
  'key',
  'secret',
  'password',
  'pwd',
  'email',
  'phone',
  'sdt',
  'mobile',
  'otp',
]);

export function sanitizeLandingPageUrl(rawUrl: string | null | undefined): string {
  if (!rawUrl) return '/';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '/';
  try {
    const isFull = /^https?:\/\//i.test(trimmed);
    const url = new URL(isFull ? trimmed : `https://placeholder.local${trimmed.startsWith('/') ? '' : '/'}${trimmed}`);
    for (const param of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_QUERY_PARAMS.has(param.toLowerCase())) {
        url.searchParams.delete(param);
      }
    }
    const qs = url.searchParams.toString();
    if (isFull) {
      return `${url.pathname}${qs ? `?${qs}` : ''}`;
    }
    return `${url.pathname}${qs ? `?${qs}` : ''}`;
  } catch {
    return trimmed.split('#')[0] || '/';
  }
}

export function normalizeDomainKey(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '')
    .split('/')[0];
}

const FRIENDLY_DOMAIN_NAMES: Record<string, string> = {
  'toantrung.com.vn': 'Website Toàn Trung',
  'bangled.vn': 'Chuyên trang Bảng LED',
  'manhinhled.net.vn': 'Chuyên trang Màn hình LED',
  'bangdientu.com.vn': 'Chuyên trang Bảng điện tử',
  'ledtoantrung.vn': 'LED Toàn Trung',
};

function resolveFriendlyWebsiteName(domain: string, fallbackName?: string | null): string {
  const norm = normalizeDomainKey(domain);
  if (FRIENDLY_DOMAIN_NAMES[norm]) {
    return FRIENDLY_DOMAIN_NAMES[norm];
  }
  const clean = (fallbackName || '').trim();
  if (clean && normalizeDomainKey(clean) !== norm && !/^ga4[-\s]/i.test(clean)) {
    return clean;
  }
  return domain;
}

const globalWebsites = globalThis as unknown as {
  __toantrungWebsitesCache?: { expiresAt: number; items: WebsiteConfigItemDto[] } | null;
};

export function invalidateConfiguredWebsitesCache(): void {
  globalWebsites.__toantrungWebsitesCache = null;
  bumpDomainRevisions(['websites', 'tracking', 'ads', 'reports'], 'websites_cache_invalidated');
}

export async function getConfiguredWebsites(): Promise<WebsiteConfigItemDto[]> {
  if (globalWebsites.__toantrungWebsitesCache && globalWebsites.__toantrungWebsitesCache.expiresAt > Date.now()) {
    return globalWebsites.__toantrungWebsitesCache.items;
  }

  const byDomain = new Map<string, WebsiteConfigItemDto>();

  try {
    const row = await prisma.systemSetting.findUnique({
      where: { key: 'google_oauth_connection' },
    });
    if (row?.value) {
      const parsed = JSON.parse(row.value) as {
        accessibleResources?: Array<{ id: string; name: string; type: string; isAccessible?: boolean }>;
      };
      const resources = Array.isArray(parsed.accessibleResources) ? parsed.accessibleResources : [];
      for (const r of resources) {
        if (r.isAccessible === false) continue;
        if (r.type === 'GA4_PROPERTY') {
          const cleanName = (r.name || r.id).replace(/\s*\(\d+\)\s*$/, '').trim();
          const domainMatch = cleanName.match(/([a-z0-9.-]+\.[a-z]{2,})/i);
          const inferredSpecialDomain =
            r.id === '508951192' || /bảng điện tử|bangdientu/i.test(cleanName)
              ? 'bangdientu.com.vn'
              : null;
          const domain = domainMatch
            ? normalizeDomainKey(domainMatch[1])
            : inferredSpecialDomain || `ga4-${r.id}`;
          const resolvedDomain = domainMatch ? domain : inferredSpecialDomain || cleanName;
          const existing = byDomain.get(domain);
          byDomain.set(domain, {
            websiteId: domain,
            shortName: existing?.shortName || resolveFriendlyWebsiteName(resolvedDomain, cleanName),
            domain: resolvedDomain,
            ga4PropertyId: r.id,
            gscSiteUrl: existing?.gscSiteUrl || null,
            adsCustomerId: existing?.adsCustomerId || null,
          });
        } else if (r.type === 'SEARCH_CONSOLE_SITE') {
          const domain = normalizeDomainKey(r.id);
          if (!domain) continue;
          const existing = byDomain.get(domain);
          byDomain.set(domain, {
            websiteId: domain,
            shortName: existing?.shortName || resolveFriendlyWebsiteName(domain),
            domain,
            ga4PropertyId: existing?.ga4PropertyId || null,
            gscSiteUrl: r.id,
            adsCustomerId: existing?.adsCustomerId || null,
          });
        }
      }
    }
  } catch {
    // Fallback below
  }

  if (byDomain.size === 0) {
    byDomain.set('toantrung.com.vn', {
      websiteId: 'toantrung.com.vn',
      shortName: 'Website Toàn Trung',
      domain: 'toantrung.com.vn',
      ga4PropertyId: '512879968',
      gscSiteUrl: 'https://toantrung.com.vn/',
      adsCustomerId: null,
    });
    byDomain.set('bangled.vn', {
      websiteId: 'bangled.vn',
      shortName: 'Chuyên trang Bảng LED',
      domain: 'bangled.vn',
      ga4PropertyId: '538179128',
      gscSiteUrl: 'https://bangled.vn/',
      adsCustomerId: null,
    });
    byDomain.set('manhinhled.net.vn', {
      websiteId: 'manhinhled.net.vn',
      shortName: 'Chuyên trang Màn hình LED',
      domain: 'manhinhled.net.vn',
      ga4PropertyId: '509190194',
      gscSiteUrl: 'https://manhinhled.net.vn/',
      adsCustomerId: null,
    });
  }

  const items = Array.from(byDomain.values());
  globalWebsites.__toantrungWebsitesCache = { expiresAt: Date.now() + 60_000, items };
  return items;
}

export interface ResolvedDashboardScope {
  websiteId: string;
  selectedWebsite: WebsiteConfigItemDto | null;
  availableWebsites: WebsiteConfigItemDto[];
  websiteLabel: string;
  domain: string | null;
  ga4PropertyIds: string[];
  gscSiteUrls: string[];
  preset: DashboardDatePreset;
  startDateStr: string;
  endDateStr: string;
  startDateTime: Date;
  endDateTime: Date;
  prevStartDateStr: string;
  prevEndDateStr: string;
  prevStartDateTime: Date;
  prevEndDateTime: Date;
  totalCalendarDays: number;
  isTodayIncluded: boolean;
  timezone: string;
}

export async function resolveDashboardScope(params?: {
  websiteId?: string | null;
  preset?: string | null;
  from?: string | null;
  to?: string | null;
}): Promise<ResolvedDashboardScope> {
  const availableWebsites = await getConfiguredWebsites();
  const reqWebsite = (params?.websiteId || 'all').trim().toLowerCase();
  const selectedWebsite =
    reqWebsite && reqWebsite !== 'all'
      ? availableWebsites.find(
          (w) =>
            w.websiteId.toLowerCase() === reqWebsite ||
            w.domain.toLowerCase() === reqWebsite ||
            w.ga4PropertyId === reqWebsite ||
            (w.ga4PropertyId &&
              (reqWebsite === `ga4-${w.ga4PropertyId}` || reqWebsite === `ga4_${w.ga4PropertyId}`)),
        ) || null
      : null;

  const rawPreset = String(params?.preset || '7D').toUpperCase();
  const normalizedPreset = rawPreset === 'ALL' ? '30D' : rawPreset;
  const preset: DashboardDatePreset =
    normalizedPreset === 'TODAY' ||
    normalizedPreset === 'YESTERDAY' ||
    normalizedPreset === '7D' ||
    normalizedPreset === '30D' ||
    normalizedPreset === 'CUSTOM'
      ? normalizedPreset
      : '7D';

  const range =
    preset === 'CUSTOM' && params?.from && params?.to
      ? getCustomCanonicalDateRange(params.from, params.to)
      : resolveDatePresetRange(preset, params?.from || undefined, params?.to || undefined);

  const days = Math.max(1, countInclusiveCalendarDays(range.startDateStr, range.endDateStr));
  const curStartNoon = new Date(`${range.startDateStr}T12:00:00+07:00`);
  const prevEndD = new Date(curStartNoon.getTime() - 24 * 60 * 60 * 1000);
  const prevStartD = new Date(curStartNoon.getTime() - days * 24 * 60 * 60 * 1000);
  const prevStartDateStr = getVietnamDateParts(prevStartD).dateStr;
  const prevEndDateStr = getVietnamDateParts(prevEndD).dateStr;

  return {
    websiteId: selectedWebsite ? selectedWebsite.websiteId : 'all',
    selectedWebsite,
    availableWebsites,
    websiteLabel: selectedWebsite
      ? `${selectedWebsite.shortName} (${selectedWebsite.domain})`
      : 'Tất cả website',
    domain: selectedWebsite ? selectedWebsite.domain : null,
    ga4PropertyIds: selectedWebsite
      ? selectedWebsite.ga4PropertyId
        ? [selectedWebsite.ga4PropertyId]
        : []
      : availableWebsites.map((w) => w.ga4PropertyId).filter((v): v is string => Boolean(v)),
    gscSiteUrls: selectedWebsite
      ? selectedWebsite.gscSiteUrl
        ? [selectedWebsite.gscSiteUrl]
        : []
      : availableWebsites.map((w) => w.gscSiteUrl).filter((v): v is string => Boolean(v)),
    preset,
    startDateStr: range.startDateStr,
    endDateStr: range.endDateStr,
    startDateTime: range.startDateTime,
    endDateTime: range.endDateTime,
    prevStartDateStr,
    prevEndDateStr,
    prevStartDateTime: new Date(`${prevStartDateStr}T00:00:00.000+07:00`),
    prevEndDateTime: new Date(`${prevEndDateStr}T23:59:59.999+07:00`),
    totalCalendarDays: days,
    isTodayIncluded: range.isTodayIncluded,
    timezone: range.timezone,
  };
}

export function safeDiv(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return numerator / denominator;
}

export function paginateArray<T>(rows: T[], page = 1, pageSize = 20) {
  const safeSize = Math.min(100, Math.max(5, Math.round(pageSize || 20)));
  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / safeSize));
  const safePage = Math.min(totalPages, Math.max(1, Math.round(page || 1)));
  const start = (safePage - 1) * safeSize;
  return {
    rows: rows.slice(start, start + safeSize),
    totalRows,
    page: safePage,
    pageSize: safeSize,
  };
}

export function matchesWebsiteDomain(
  leadSourceWebsite: string | null | undefined,
  selectedWebsite: WebsiteConfigItemDto | null,
): boolean {
  if (!selectedWebsite) return true;
  if (!leadSourceWebsite) return false;
  const normLead = normalizeDomainKey(leadSourceWebsite);
  const normTarget = normalizeDomainKey(selectedWebsite.domain);
  return normLead === normTarget || normLead === selectedWebsite.websiteId.toLowerCase();
}

