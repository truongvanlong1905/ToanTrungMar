export type SyncDomain =
  | 'leads'
  | 'tracking'
  | 'ads'
  | 'seo_articles'
  | 'seo_reports'
  | 'reports'
  | 'design'
  | 'notifications'
  | 'branding'
  | 'websites'
  | 'auth';

export interface DataSyncEventPayload {
  domains: SyncDomain[];
  reason?: string;
  timestamp: number;
  source?: 'local' | 'broadcast';
}

export function inferDomainsFromApiPath(rawPath: string): SyncDomain[] {
  const path = rawPath.split('?')[0] || '';
  if (path.startsWith('/api/v1/leads')) {
    return ['leads', 'reports', 'tracking', 'notifications', 'design'];
  }
  if (
    path.startsWith('/api/v1/tracking') ||
    path.startsWith('/api/v1/auth/google/sync') ||
    path.startsWith('/api/v1/auth/google/select-resources')
  ) {
    return ['tracking', 'ads', 'reports', 'leads', 'websites'];
  }
  if (path.startsWith('/api/v1/ads/seo-reports')) {
    return ['seo_reports', 'ads', 'seo_articles'];
  }
  if (path.startsWith('/api/v1/ads/articles')) {
    return ['seo_articles', 'ads', 'reports'];
  }
  if (path.startsWith('/api/v1/ads')) {
    return ['ads', 'seo_articles', 'seo_reports', 'reports'];
  }
  if (path.startsWith('/api/v1/reports')) {
    return ['reports'];
  }
  if (path.startsWith('/api/v1/design')) {
    return ['design', 'leads', 'reports', 'notifications'];
  }
  if (path.startsWith('/api/v1/notifications')) {
    return ['notifications'];
  }
  if (path.startsWith('/api/v1/settings/branding') || path.startsWith('/api/v1/settings/backup')) {
    return ['branding'];
  }
  if (path.startsWith('/api/v1/users')) {
    return ['auth', 'leads', 'design'];
  }
  if (path.startsWith('/api/v1/workers')) {
    return [
      'leads',
      'tracking',
      'ads',
      'seo_articles',
      'seo_reports',
      'reports',
      'design',
      'notifications',
      'websites',
    ];
  }
  return ['leads', 'tracking', 'ads', 'reports', 'design', 'notifications'];
}

export function inferReadDependenciesForApiPath(rawPath: string): SyncDomain[] {
  const path = rawPath.split('?')[0] || '';
  if (path.startsWith('/api/v1/leads')) {
    return ['leads', 'design', 'auth'];
  }
  if (path.startsWith('/api/v1/tracking')) {
    return ['tracking', 'leads', 'ads', 'websites'];
  }
  if (path.startsWith('/api/v1/ads/seo-reports')) {
    return ['seo_reports', 'ads', 'seo_articles', 'websites'];
  }
  if (path.startsWith('/api/v1/ads')) {
    return ['ads', 'seo_articles', 'seo_reports', 'tracking', 'websites'];
  }
  if (path.startsWith('/api/v1/reports')) {
    return ['reports', 'leads', 'tracking', 'ads', 'seo_articles', 'design', 'websites'];
  }
  if (path.startsWith('/api/v1/design')) {
    return ['design', 'leads'];
  }
  if (path.startsWith('/api/v1/notifications')) {
    return ['notifications'];
  }
  if (path.startsWith('/api/v1/settings/branding')) {
    return ['branding'];
  }
  if (path.startsWith('/api/v1/users')) {
    return ['auth'];
  }
  return ['leads', 'tracking', 'ads', 'reports', 'design', 'notifications'];
}

const CHANNEL_NAME = 'toantrung_v2_data_sync';
const EVENT_NAME = 'tt-data-sync';

const busTarget = typeof EventTarget !== 'undefined' ? new EventTarget() : null;
let broadcastChannel: BroadcastChannel | null = null;
let channelInitialized = false;

function dispatchLocalPayload(payload: DataSyncEventPayload): void {
  if (!busTarget || typeof CustomEvent === 'undefined') return;
  busTarget.dispatchEvent(new CustomEvent<DataSyncEventPayload>(EVENT_NAME, { detail: payload }));
}

function ensureBroadcastChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return null;
  }
  if (!channelInitialized) {
    channelInitialized = true;
    try {
      broadcastChannel = new BroadcastChannel(CHANNEL_NAME);
      broadcastChannel.addEventListener('message', (msg: MessageEvent<DataSyncEventPayload>) => {
        if (!msg.data || !Array.isArray(msg.data.domains)) return;
        dispatchLocalPayload({
          domains: msg.data.domains,
          reason: msg.data.reason,
          timestamp: msg.data.timestamp || Date.now(),
          source: 'broadcast',
        });
      });
    } catch {
      broadcastChannel = null;
    }
  }
  return broadcastChannel;
}

/**
 * Phát tín hiệu đồng bộ theo phạm vi domain trong tab hiện tại và sang các tab cùng trình duyệt.
 */
export function publishDataSync(domains: SyncDomain[], reason?: string): void {
  if (domains.length === 0) return;
  const uniqueDomains = Array.from(new Set(domains));
  const payload: DataSyncEventPayload = {
    domains: uniqueDomains,
    reason,
    timestamp: Date.now(),
    source: 'local',
  };
  dispatchLocalPayload(payload);
  const bc = ensureBroadcastChannel();
  if (bc) {
    try {
      bc.postMessage(payload);
    } catch {
      // ignore BroadcastChannel post failures
    }
  }
}

/**
 * Đăng ký lắng nghe sự kiện cập nhật dữ liệu cho tập domain quan tâm. Trả về hàm hủy đăng ký.
 */
export function subscribeDataSync(
  domains: SyncDomain[] | '*',
  handler: (payload: DataSyncEventPayload) => void,
): () => void {
  if (!busTarget || typeof window === 'undefined') {
    return () => {};
  }
  ensureBroadcastChannel();
  const domainSet = domains === '*' ? null : new Set<SyncDomain>(domains);

  const listener = (ev: Event) => {
    const customEv = ev as CustomEvent<DataSyncEventPayload>;
    const detail = customEv.detail;
    if (!detail || !Array.isArray(detail.domains)) return;
    if (domainSet && !detail.domains.some((d) => domainSet.has(d))) {
      return;
    }
    handler(detail);
  };

  busTarget.addEventListener(EVENT_NAME, listener);
  return () => {
    busTarget.removeEventListener(EVENT_NAME, listener);
  };
}
