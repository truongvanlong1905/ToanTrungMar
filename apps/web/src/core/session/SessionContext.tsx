'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { NotificationDto, PublicBrandingDto, SessionUserDto } from '@toantrung/contracts';
import {
  apiRequest,
  clearAllApiCache,
  invalidateApiCacheByDomains,
  setApiCacheUserScope,
} from '../http/client';
import { publishDataSync, subscribeDataSync, type SyncDomain } from '../http/data-sync-bus';
import { setRouteStateUserScope } from '../http/route-state';

const DEFAULT_BRANDING: PublicBrandingDto = {
  organizationName: 'Toàn Trung',
  workspaceName: 'Toàn Trung',
  loginHeadline: 'Đăng nhập',
  loginSubheadline: 'Chào mừng bạn quay trở lại hệ thống nội bộ Toàn Trung',
  footerText: '© 2026 Toàn Trung · Hệ thống quản lý nội bộ dành cho nhân sự công ty',
  logo: {
    slot: 'logo',
    url: '/brand/logo-toan-trung.png',
    isDefault: true,
    altText: 'Logo Công ty Toàn Trung',
    coverPosition: 'center',
    crop: { zoom: 1, offsetX: 0, offsetY: 0, frameScale: 1 },
    mimeType: 'image/png',
    fileSizeBytes: null,
    width: null,
    height: null,
    updatedAt: null,
    updatedByName: null,
    recommendedSpec: 'PNG/WebP nền trong suốt · Tỷ lệ ~3.5:1 (khuyến nghị 420×120px, tối đa 2 MB)',
  },
  loginHero: {
    slot: 'login_hero',
    url: '/brand/login-hero-led-building.jpg',
    isDefault: true,
    altText: 'Không gian trưng bày giải pháp màn hình LED Toàn Trung',
    coverPosition: 'center',
    crop: { zoom: 1, offsetX: 0, offsetY: 0, frameScale: 1 },
    mimeType: 'image/webp',
    fileSizeBytes: null,
    width: null,
    height: null,
    updatedAt: null,
    updatedByName: null,
    recommendedSpec: 'WebP/JPG/PNG thực tế công ty · Tỷ lệ 16:9 hoặc 16:10 (khuyến nghị 1200×750px, tối đa 5 MB)',
  },
  dashboardBanner: {
    headline: 'Quản lý tập trung. Phối hợp hiệu quả.',
    description:
      'Kết nối xuyên suốt hoạt động Kinh doanh, Marketing, Quảng cáo và Thiết kế trên một nền tảng thống nhất theo đúng ma trận phân quyền 8 vai trò BA.',
    showButton: true,
    buttonLabel: 'Khám phá 5 phân hệ',
    buttonHref: '/leads',
    showImage: true,
    imageUrl: '/brand/showroom-toan-trung.webp',
    imageAlt: 'Phòng trưng bày giải pháp màn hình LED Toàn Trung',
    isDefaultImage: true,
    updatedAt: null,
    updatedByName: null,
  },
};

interface SystemRevisionsDto {
  revisions: Record<string, number>;
  lastUpdatedAt?: Record<string, string>;
  serverDateVn: string;
  serverTime?: string;
  unreadCount?: number;
}

interface SessionContextValue {
  user: SessionUserDto | null;
  loading: boolean;
  branding: PublicBrandingDto;
  unreadCount: number;
  latestAlertNotification: NotificationDto | null;
  desktopNotifPermission: NotificationPermission | 'unsupported';
  refreshSession: () => Promise<SessionUserDto | null>;
  refreshBranding: () => Promise<void>;
  refreshUnreadCount: () => Promise<void>;
  setBrandingState: (next: PublicBrandingDto) => void;
  setUnreadCountState: (count: number) => void;
  dismissLatestAlert: () => void;
  requestDesktopNotifPermission: () => Promise<NotificationPermission | 'unsupported'>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue>({
  user: null,
  loading: true,
  branding: DEFAULT_BRANDING,
  unreadCount: 0,
  latestAlertNotification: null,
  desktopNotifPermission: 'unsupported',
  refreshSession: async () => null,
  refreshBranding: async () => {},
  refreshUnreadCount: async () => {},
  setBrandingState: () => {},
  setUnreadCountState: () => {},
  dismissLatestAlert: () => {},
  requestDesktopNotifPermission: async () => 'unsupported',
  logout: async () => {},
});

function SessionAuthRedirect({
  loading,
  user,
}: {
  loading: boolean;
  user: SessionUserDto | null;
}) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user && pathname && pathname !== '/login') {
      router.replace('/login');
    }
  }, [loading, user, pathname, router]);

  return null;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUserDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [branding, setBranding] = useState<PublicBrandingDto>(DEFAULT_BRANDING);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [latestAlertNotification, setLatestAlertNotification] = useState<NotificationDto | null>(null);
  const [desktopNotifPermission, setDesktopNotifPermission] = useState<NotificationPermission | 'unsupported'>('unsupported');
  const router = useRouter();

  const prevRevisionsRef = useRef<Record<string, number> | null>(null);
  const prevVnDateRef = useRef<string | null>(null);
  const lastRevisionCheckAtRef = useRef<number>(0);
  const pollInFlightRef = useRef<boolean>(false);
  const seenNotificationIdsRef = useRef<Set<number>>(new Set());
  const notifBaselineLoadedRef = useRef<boolean>(false);
  const prevUnreadCountRef = useRef<number>(0);
  const baseTitleRef = useRef<string>('Toàn Trung CRM');

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setDesktopNotifPermission(Notification.permission);
    } else {
      setDesktopNotifPermission('unsupported');
    }
    if (typeof document !== 'undefined' && document.title) {
      baseTitleRef.current = document.title;
    }
  }, []);

  const dismissLatestAlert = useCallback(() => {
    setLatestAlertNotification(null);
    if (typeof document !== 'undefined') {
      document.title = baseTitleRef.current;
    }
  }, []);

  const requestDesktopNotifPermission = useCallback(async (): Promise<NotificationPermission | 'unsupported'> => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setDesktopNotifPermission('unsupported');
      return 'unsupported';
    }
    try {
      const perm = await Notification.requestPermission();
      setDesktopNotifPermission(perm);
      return perm;
    } catch {
      return Notification.permission;
    }
  }, []);

  const refreshBranding = useCallback(async () => {
    try {
      const res = await apiRequest<{ branding: PublicBrandingDto }>('/api/v1/settings/branding');
      if (res.branding) {
        setBranding(res.branding);
      }
    } catch {
      // Fallback to verified official assets in public/brand
    }
  }, []);

  const refreshUnreadCount = useCallback(async () => {
    try {
      const res = await apiRequest<{ unreadCount: number }>('/api/v1/notifications?countOnly=1', {
        skipCache: true,
      });
      setUnreadCount(res.unreadCount ?? 0);
    } catch {
      setUnreadCount(0);
    }
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const res = await apiRequest<{ user: SessionUserDto | null }>('/api/v1/auth/me?optional=1', {
        skipCache: true,
      });
      if (!res?.user) {
        setApiCacheUserScope(null);
        setRouteStateUserScope(null);
        clearAllApiCache();
        setUser(null);
        return null;
      }
      const scope = `${res.user.id}:${res.user.roleCode}`;
      setApiCacheUserScope(scope);
      setRouteStateUserScope(scope);
      setUser(res.user);
      return res.user;
    } catch {
      setApiCacheUserScope(null);
      setRouteStateUserScope(null);
      clearAllApiCache();
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshBranding();
    void refreshSession().then((u) => {
      if (u) {
        void refreshUnreadCount();
      }
    });
  }, [refreshBranding, refreshSession, refreshUnreadCount]);

  // Central visibility-aware revision poller, cross-machine incoming transfer alert & midnight rollover detector
  useEffect(() => {
    if (!user) {
      prevRevisionsRef.current = null;
      prevVnDateRef.current = null;
      seenNotificationIdsRef.current.clear();
      notifBaselineLoadedRef.current = false;
      prevUnreadCountRef.current = 0;
      setLatestAlertNotification(null);
      return;
    }

    let cancelled = false;

    const surfaceNewNotifications = async () => {
      try {
        const res = await apiRequest<{ items: NotificationDto[]; unreadCount: number }>(
          '/api/v1/notifications?summary=1',
          { skipCache: true },
        );
        if (cancelled) return;
        const items = res.items || [];
        const newUnread = items.filter(
          (item) => !item.isRead && !seenNotificationIdsRef.current.has(item.id),
        );
        for (const item of items) {
          seenNotificationIdsRef.current.add(item.id);
        }
        const nextCount = res.unreadCount ?? 0;
        setUnreadCount((prev) => (prev === nextCount ? prev : nextCount));
        prevUnreadCountRef.current = nextCount;

        if (!notifBaselineLoadedRef.current) {
          notifBaselineLoadedRef.current = true;
          return;
        }
        if (newUnread.length > 0) {
          const priorityNotif =
            newUnread.find(
              (n) =>
                n.title.toLowerCase().includes('bàn giao lead') ||
                n.category.toLowerCase() === 'lead',
            ) || newUnread[0];
          setLatestAlertNotification(priorityNotif);

          if (
            typeof window !== 'undefined' &&
            'Notification' in window &&
            Notification.permission === 'granted'
          ) {
            try {
              const desktopNotif = new Notification(priorityNotif.title, {
                body: priorityNotif.summary,
                tag: `tt-notif-${priorityNotif.id}`,
                silent: true,
              });
              desktopNotif.onclick = () => {
                window.focus();
                if (priorityNotif.actionUrl) {
                  router.push(priorityNotif.actionUrl);
                }
                setLatestAlertNotification(null);
                desktopNotif.close();
              };
            } catch {
              // Ignore OS notification error
            }
          }
        }
      } catch {
        // Ignore transient notification fetch error
      }
    };

    void surfaceNewNotifications();

    const checkRevisions = async (force = false) => {
      if (cancelled || pollInFlightRef.current) return;
      const isHidden = typeof document !== 'undefined' && document.hidden;
      if (!force && isHidden && Date.now() - lastRevisionCheckAtRef.current < 60_000) {
        return;
      }
      pollInFlightRef.current = true;
      try {
        const res = await apiRequest<SystemRevisionsDto>('/api/v1/system/revisions', {
          skipCache: true,
        });
        if (cancelled) return;
        lastRevisionCheckAtRef.current = Date.now();

        const nextUnread = typeof res.unreadCount === 'number' ? res.unreadCount : undefined;
        const unreadIncreased =
          typeof nextUnread === 'number' && nextUnread > prevUnreadCountRef.current;
        if (typeof nextUnread === 'number') {
          setUnreadCount((prev) => (prev === nextUnread ? prev : nextUnread));
          prevUnreadCountRef.current = nextUnread;
        }

        const prevDate = prevVnDateRef.current;
        if (prevDate && res.serverDateVn && prevDate !== res.serverDateVn) {
          const dateDomains: SyncDomain[] = ['leads', 'tracking', 'ads', 'reports'];
          invalidateApiCacheByDomains(dateDomains);
          publishDataSync(dateDomains, 'vn_midnight_rollover');
        }
        if (res.serverDateVn) {
          prevVnDateRef.current = res.serverDateVn;
        }

        const prevRev = prevRevisionsRef.current;
        let notificationsDomainChanged = false;
        if (prevRev && res.revisions) {
          const changedDomains: SyncDomain[] = [];
          for (const [domain, rev] of Object.entries(res.revisions)) {
            if (prevRev[domain] !== rev) {
              changedDomains.push(domain as SyncDomain);
              if (domain === 'notifications') notificationsDomainChanged = true;
            }
          }
          if (changedDomains.length > 0) {
            invalidateApiCacheByDomains(changedDomains);
            publishDataSync(changedDomains, 'server_revision');
            if (changedDomains.includes('branding')) {
              void refreshBranding();
            }
          }
        }
        if (res.revisions) {
          prevRevisionsRef.current = { ...res.revisions };
        }

        if (notifBaselineLoadedRef.current && (unreadIncreased || notificationsDomainChanged)) {
          void surfaceNewNotifications();
        }
      } catch {
        // Silent background check error; retry on next cadence
      } finally {
        pollInFlightRef.current = false;
      }
    };

    void checkRevisions(true);

    // Realtime Server-Sent Events (SSE) stream (<50ms push, zero Redis) with automatic fallback to polling
    let sseConnected = false;
    let eventSource: EventSource | null = null;
    let sseSyncDebounceTimer: number | null = null;
    let pendingSyncDomains = new Set<SyncDomain>();

    const flushDebouncedSync = (sourceLabel: string) => {
      if (cancelled || pendingSyncDomains.size === 0) return;
      const batch = Array.from(pendingSyncDomains);
      pendingSyncDomains = new Set<SyncDomain>();
      invalidateApiCacheByDomains(batch);
      publishDataSync(batch, sourceLabel);
      if (batch.includes('branding')) {
        void refreshBranding();
      }
    };

    const applyIncomingRevisionPayload = (res: SystemRevisionsDto, sourceLabel: string) => {
      if (cancelled) return;
      lastRevisionCheckAtRef.current = Date.now();

      const nextUnread = typeof res.unreadCount === 'number' ? res.unreadCount : undefined;
      const unreadIncreased =
        typeof nextUnread === 'number' && nextUnread > prevUnreadCountRef.current;
      if (typeof nextUnread === 'number') {
        setUnreadCount((prev) => (prev === nextUnread ? prev : nextUnread));
        prevUnreadCountRef.current = nextUnread;
      }

      const prevDate = prevVnDateRef.current;
      if (prevDate && res.serverDateVn && prevDate !== res.serverDateVn) {
        const dateDomains: SyncDomain[] = ['leads', 'tracking', 'ads', 'reports'];
        invalidateApiCacheByDomains(dateDomains);
        publishDataSync(dateDomains, 'vn_midnight_rollover');
      }
      if (res.serverDateVn) {
        prevVnDateRef.current = res.serverDateVn;
      }

      const prevRev = prevRevisionsRef.current;
      let notificationsDomainChanged = false;
      if (prevRev && res.revisions) {
        const urgentDomains: SyncDomain[] = [];
        for (const [domain, rev] of Object.entries(res.revisions)) {
          if (prevRev[domain] !== rev) {
            const typed = domain as SyncDomain;
            if (typed === 'notifications') notificationsDomainChanged = true;
            if (typed === 'notifications' || typed === 'leads' || typed === 'design') {
              urgentDomains.push(typed);
            } else {
              pendingSyncDomains.add(typed);
            }
          }
        }
        if (urgentDomains.length > 0) {
          invalidateApiCacheByDomains(urgentDomains);
          publishDataSync(urgentDomains, sourceLabel);
        }
        if (pendingSyncDomains.size > 0) {
          if (sseSyncDebounceTimer !== null) {
            window.clearTimeout(sseSyncDebounceTimer);
          }
          sseSyncDebounceTimer = window.setTimeout(() => {
            sseSyncDebounceTimer = null;
            flushDebouncedSync(sourceLabel);
          }, 1200);
        }
      }
      if (res.revisions) {
        prevRevisionsRef.current = { ...res.revisions };
      }

      if (notifBaselineLoadedRef.current && (unreadIncreased || notificationsDomainChanged)) {
        void surfaceNewNotifications();
      }
    };

    if (typeof window !== 'undefined' && typeof EventSource !== 'undefined') {
      try {
        eventSource = new EventSource('/api/v1/system/stream', { withCredentials: true });
        eventSource.onopen = () => {
          sseConnected = true;
        };
        eventSource.onerror = () => {
          sseConnected = false;
        };
        const onSseData = (ev: MessageEvent) => {
          try {
            const parsed = JSON.parse(ev.data) as SystemRevisionsDto;
            applyIncomingRevisionPayload(parsed, 'sse_realtime');
          } catch {
            // ignore malformed SSE payload
          }
        };
        eventSource.addEventListener('snapshot', onSseData);
        eventSource.addEventListener('revision', onSseData);
      } catch {
        sseConnected = false;
      }
    }

    const intervalId = window.setInterval(() => {
      if (!sseConnected) {
        void checkRevisions(false);
      }
    }, 30_000);

    const onVisibilityChange = () => {
      if (typeof document !== 'undefined') {
        if (!document.hidden) {
          document.title = baseTitleRef.current;
          if (Date.now() - lastRevisionCheckAtRef.current >= 20_000) {
            void checkRevisions(true);
          }
        }
      }
    };

    const unsubNotif = subscribeDataSync(['notifications'], (ev) => {
      if (ev.reason && ev.reason.startsWith('mutation:')) {
        void refreshUnreadCount();
      }
    });

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }

    const onUnauthorized = () => {
      setApiCacheUserScope(null);
      setRouteStateUserScope(null);
      clearAllApiCache();
      setUser(null);
      setUnreadCount(0);
      setLatestAlertNotification(null);
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('tt-session-unauthorized', onUnauthorized);
    }

    return () => {
      cancelled = true;
      if (sseSyncDebounceTimer !== null) {
        window.clearTimeout(sseSyncDebounceTimer);
      }
      if (eventSource) {
        try {
          eventSource.close();
        } catch {
          // ignore
        }
        eventSource = null;
      }
      window.clearInterval(intervalId);
      unsubNotif();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('tt-session-unauthorized', onUnauthorized);
      }
    };
  }, [user, router, refreshBranding, refreshUnreadCount]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (latestAlertNotification && unreadCount > 0 && document.hidden) {
      document.title = `🔔 (${unreadCount}) ${latestAlertNotification.title}`;
    } else if (!latestAlertNotification || unreadCount === 0) {
      document.title = baseTitleRef.current;
    }
  }, [latestAlertNotification, unreadCount]);

  const logout = useCallback(async () => {
    try {
      await apiRequest('/api/v1/auth/logout', {
        method: 'POST',
        csrfToken: user?.csrfToken,
      });
    } catch {
      // Clear local session state regardless
    }
    setApiCacheUserScope(null);
    setRouteStateUserScope(null);
    clearAllApiCache();
    prevRevisionsRef.current = null;
    prevVnDateRef.current = null;
    seenNotificationIdsRef.current.clear();
    notifBaselineLoadedRef.current = false;
    prevUnreadCountRef.current = 0;
    setUser(null);
    setUnreadCount(0);
    setLatestAlertNotification(null);
    router.replace('/login');
  }, [router, user?.csrfToken]);

  const contextValue = useMemo<SessionContextValue>(
    () => ({
      user,
      loading,
      branding,
      unreadCount,
      latestAlertNotification,
      desktopNotifPermission,
      refreshSession,
      refreshBranding,
      refreshUnreadCount,
      setBrandingState: setBranding,
      setUnreadCountState: setUnreadCount,
      dismissLatestAlert,
      requestDesktopNotifPermission,
      logout,
    }),
    [
      user,
      loading,
      branding,
      unreadCount,
      latestAlertNotification,
      desktopNotifPermission,
      refreshSession,
      refreshBranding,
      refreshUnreadCount,
      dismissLatestAlert,
      requestDesktopNotifPermission,
      logout,
    ],
  );

  return (
    <SessionContext.Provider value={contextValue}>
      {children}
      <SessionAuthRedirect loading={loading} user={user} />
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}
