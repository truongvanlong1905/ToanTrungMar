'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRightLeft,
  ArrowUpRight,
  BarChart3,
  Bell,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  Clock,
  Crosshair,
  FileSpreadsheet,
  LayoutGrid,
  LogOut,
  Megaphone,
  Menu,
  Search,
  Settings,
  Sparkles,
  UserCircle2,
  Users,
  X,
} from 'lucide-react';
import {
  UI_VOCABULARY,
  hasBaPermission,
  type BaPermissionKey,
  type NotificationDto,
} from '@toantrung/contracts';
import { apiRequest } from '../http/client';
import { publishDataSync, subscribeDataSync } from '../http/data-sync-bus';
import { useSession } from '../session/SessionContext';
import { formatCompactLeadCode } from '@/modules/01-leads/leads-helpers';
import { SectionErrorBoundary } from '../components/common/WorkspaceFaultIsolation';

const GlobalCommandPalette = dynamic(
  () => import('../components/common/GlobalCommandPalette'),
  { ssr: false },
);

interface NavItem {
  href: string;
  label: string;
  shortLabel?: string;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
  badge?: number;
  adminOnly?: boolean;
  requiredPermission?: BaPermissionKey;
}

interface IncomingHandoverLite {
  leadId: number;
  leadCode: string;
  version: number;
  customerLabel: string;
  projectName: string | null;
  fromSalesName: string | null;
  transferReason: string | null;
  waitingMinutes: number;
  slaLevel: 'normal' | 'warning' | 'overdue';
}

const ROUTE_REQUIRED_PERMISSION: Record<string, BaPermissionKey> = {
  '/dashboard': 'DASHBOARD_VIEW',
  '/leads': 'LEAD_VIEW_OWN',
  '/tracking': 'TRACKING_ADS_OPTIMIZE',
  '/ads': 'AI_MARKETING_SEO',
  '/reports': 'DASHBOARD_VIEW',
  '/design': 'AI_DESIGN',
  '/admin/users': 'SYSTEM_USER_ADMIN',
  '/settings': 'SYSTEM_USER_ADMIN',
};

const BREADCRUMB_LABELS: Record<string, string> = {
  '/dashboard': UI_VOCABULARY.menu.dashboard,
  '/leads': UI_VOCABULARY.menu.leads,
  '/tracking': UI_VOCABULARY.menu.campaigns,
  '/ads': UI_VOCABULARY.menu.seo,
  '/reports': UI_VOCABULARY.menu.reports,
  '/design': UI_VOCABULARY.menu.design,
  '/notifications': UI_VOCABULARY.menu.notifications,
  '/profile': UI_VOCABULARY.menu.profile,
  '/admin/users': UI_VOCABULARY.menu.users,
  '/settings': UI_VOCABULARY.menu.settings,
};

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return 'TT';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function formatWaitingDuration(minutes: number): string {
  if (minutes < 1) return 'Vừa xong';
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  return `${days} ngày trước`;
}

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/dashboard';
  const router = useRouter();
  const {
    user,
    loading,
    unreadCount,
    setUnreadCountState,
    latestAlertNotification,
    dismissLatestAlert,
    desktopNotifPermission,
    requestDesktopNotifPermission,
    logout,
  } = useSession();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [globalSearchText, setGlobalSearchText] = useState('');
  const globalSearchInputRef = useRef<HTMLInputElement | null>(null);

  const [bellOpen, setBellOpen] = useState(false);
  const [recentNotifications, setRecentNotifications] = useState<NotificationDto[]>([]);
  const [loadingBell, setLoadingBell] = useState(false);
  const bellRef = useRef<HTMLDivElement | null>(null);

  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);

  const [incomingHandovers, setIncomingHandovers] = useState<IncomingHandoverLite[]>([]);
  const [handoverPopoverOpen, setHandoverPopoverOpen] = useState(false);
  const [confirmingLeadId, setConfirmingLeadId] = useState<number | null>(null);

  const currentBreadcrumb = BREADCRUMB_LABELS[pathname] || UI_VOCABULARY.menu.dashboard;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const q = params.get('search');
    if (q !== null) {
      setGlobalSearchText(q);
    } else {
      setGlobalSearchText('');
      window.dispatchEvent(new CustomEvent('tt-global-search', { detail: '' }));
    }
  }, [pathname]);

  useEffect(() => {
    if (
      user?.email &&
      globalSearchText.trim().toLowerCase() === user.email.trim().toLowerCase() &&
      document.activeElement !== globalSearchInputRef.current
    ) {
      setGlobalSearchText('');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('tt-global-search', { detail: '' }));
      }
    }
  }, [user?.email, globalSearchText]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
        return;
      }
      const target = e.target as HTMLElement | null;
      const isInputFocused =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (!isInputFocused && e.key === '/') {
        e.preventDefault();
        globalSearchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const fetchIncomingHandovers = useCallback(async () => {
    if (!user || !hasBaPermission(user.roleCode, 'LEAD_VIEW_OWN')) {
      setIncomingHandovers([]);
      return;
    }
    try {
      const res = await apiRequest<{ incomingHandovers?: IncomingHandoverLite[] }>(
        '/api/v1/dashboard/personal',
        { skipCache: true },
      );
      setIncomingHandovers(res.incomingHandovers || []);
    } catch {
      // silent
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setIncomingHandovers([]);
      return;
    }
    void fetchIncomingHandovers();
    const unsub = subscribeDataSync(['leads', 'notifications'], () => {
      void fetchIncomingHandovers();
    });
    return () => unsub();
  }, [user, fetchIncomingHandovers]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const pendingCount = incomingHandovers.length;
    if (pendingCount > 0) {
      document.title = `(${pendingCount} chờ nhận) Toàn Trung CRM`;
    } else if (unreadCount > 0) {
      document.title = `(${unreadCount}) Toàn Trung CRM`;
    } else {
      document.title = 'Toàn Trung CRM';
    }
  }, [incomingHandovers.length, unreadCount]);

  const handleQuickConfirmHandover = async (item: IncomingHandoverLite) => {
    if (!user || confirmingLeadId !== null) return;
    setConfirmingLeadId(item.leadId);
    try {
      await apiRequest(`/api/v1/leads/${item.leadId}`, {
        method: 'PATCH',
        csrfToken: user.csrfToken,
        body: {
          action: 'confirm_receive',
          expectedVersion: item.version,
        },
      });
      setIncomingHandovers((prev) => prev.filter((x) => x.leadId !== item.leadId));
      publishDataSync(['leads', 'reports', 'notifications'], 'mutation:confirm_receive');
    } catch {
      void fetchIncomingHandovers();
    } finally {
      setConfirmingLeadId(null);
    }
  };

  const fetchBellNotifications = useCallback(async () => {
    setLoadingBell(true);
    try {
      const res = await apiRequest<{ items: NotificationDto[]; unreadCount: number }>(
        '/api/v1/notifications',
        { skipCache: true },
      );
      setRecentNotifications((res.items || []).slice(0, 6));
      setUnreadCountState(res.unreadCount ?? 0);
    } catch {
      // ignore
    } finally {
      setLoadingBell(false);
    }
  }, [setUnreadCountState]);

  useEffect(() => {
    if (bellOpen) {
      void fetchBellNotifications();
    }
  }, [bellOpen, fetchBellNotifications]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false);
      }
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) {
        setAccountMenuOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setBellOpen(false);
        setAccountMenuOpen(false);
        setHandoverPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, []);

  const handleMarkAllReadQuick = async () => {
    if (!user || unreadCount === 0) return;
    try {
      const res = await apiRequest<{ items: NotificationDto[]; unreadCount: number }>(
        '/api/v1/notifications',
        {
          method: 'PATCH',
          csrfToken: user.csrfToken,
          body: { markAll: true },
        },
      );
      setRecentNotifications((res.items || []).slice(0, 6));
      setUnreadCountState(res.unreadCount ?? 0);
    } catch {
      // ignore
    }
  };

  const isFullBleed = pathname === '/design';
  const requiredPermForCurrentRoute = ROUTE_REQUIRED_PERMISSION[pathname];
  const isRouteUnauthorized = Boolean(
    user &&
      requiredPermForCurrentRoute &&
      !hasBaPermission(user.roleCode, requiredPermForCurrentRoute),
  );

  useEffect(() => {
    if (!loading && isRouteUnauthorized) {
      router.replace('/dashboard');
    }
  }, [loading, isRouteUnauthorized, router]);

  const workNav: NavItem[] = [
    {
      href: '/dashboard',
      label: UI_VOCABULARY.menu.dashboard,
      shortLabel: 'Tổng quan',
      icon: LayoutGrid,
      requiredPermission: 'DASHBOARD_VIEW',
    },
    {
      href: '/leads',
      label: UI_VOCABULARY.menu.leads,
      shortLabel: 'Lead',
      icon: FileSpreadsheet,
      badge: incomingHandovers.length > 0 ? incomingHandovers.length : undefined,
      requiredPermission: 'LEAD_VIEW_OWN',
    },
    {
      href: '/tracking',
      label: UI_VOCABULARY.menu.campaigns,
      shortLabel: 'Chiến dịch',
      icon: Crosshair,
      requiredPermission: 'TRACKING_ADS_OPTIMIZE',
    },
    {
      href: '/ads',
      label: UI_VOCABULARY.menu.seo,
      shortLabel: 'SEO',
      icon: Megaphone,
      requiredPermission: 'AI_MARKETING_SEO',
    },
    {
      href: '/reports',
      label: UI_VOCABULARY.menu.reports,
      shortLabel: 'Báo cáo',
      icon: BarChart3,
      requiredPermission: 'DASHBOARD_VIEW',
    },
    {
      href: '/design',
      label: UI_VOCABULARY.menu.design,
      shortLabel: 'Thiết kế AI',
      icon: Sparkles,
      requiredPermission: 'AI_DESIGN',
    },
  ];

  const systemNav: NavItem[] = [
    {
      href: '/admin/users',
      label: UI_VOCABULARY.menu.users,
      shortLabel: 'Nhân sự',
      icon: Users,
      adminOnly: true,
      requiredPermission: 'SYSTEM_USER_ADMIN',
    },
    {
      href: '/settings',
      label: UI_VOCABULARY.menu.settings,
      shortLabel: 'Cài đặt',
      icon: Settings,
      adminOnly: true,
      requiredPermission: 'SYSTEM_USER_ADMIN',
    },
  ];

  const showTopbarSearch =
    pathname === '/dashboard' ||
    pathname === '/leads' ||
    pathname.startsWith('/leads/') ||
    pathname === '/tracking' ||
    pathname === '/reports' ||
    pathname === '/design';

  const topbarSearchPlaceholder =
    pathname === '/leads' || pathname.startsWith('/leads/')
      ? 'Tìm SĐT, khách, mã Lead...'
      : `Tìm nhanh trong ${currentBreadcrumb}...`;

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex flex-col w-full">
        <div className="h-[54px] bg-white/90 border-b border-slate-200/75 px-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-7 w-28 rounded-lg bg-slate-200/80 animate-pulse" />
            <div className="hidden lg:flex items-center gap-2">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="h-7 w-20 rounded-lg bg-slate-100 animate-pulse" />
              ))}
            </div>
          </div>
          <div className="h-8 w-44 rounded-full bg-slate-100 animate-pulse" />
        </div>
        <div className="p-4 space-y-3">
          <div className="h-24 rounded-2xl bg-white border border-slate-200/80 animate-pulse" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-[108px] rounded-2xl bg-white border border-slate-200/80 animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!user || isRouteUnauthorized) {
    return null;
  }

  const visibleWorkNav = workNav.filter(
    (item) =>
      (!item.adminOnly || user.roleCode === 'ADMIN') &&
      (!item.requiredPermission || hasBaPermission(user.roleCode, item.requiredPermission)),
  );

  const visibleSystemNav = systemNav.filter(
    (item) =>
      (!item.adminOnly || user.roleCode === 'ADMIN') &&
      (!item.requiredPermission || hasBaPermission(user.roleCode, item.requiredPermission)),
  );

  const showGlobalHandoverStrip =
    incomingHandovers.length > 0 &&
    pathname !== '/dashboard' &&
    pathname !== '/leads';

  const firstHandover = incomingHandovers[0] || null;

  return (
    <div
      className={
        isFullBleed
          ? 'h-dvh bg-[#F8FAFC] text-slate-800 flex flex-col w-full overflow-hidden'
          : 'min-h-screen bg-[#F8FAFC] text-slate-800 flex flex-col w-full'
      }
    >
      <a
        href="#main-workspace-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-[10px] focus:bg-[#0B1D48] focus:px-4 focus:py-2 focus:text-xs focus:font-semibold focus:text-white focus:shadow-lg"
      >
        Chuyển đến nội dung chính
      </a>

      {/* Drawer điều hướng chỉ dành cho tablet / mobile (< lg) */}
      {mobileOpen && (
        <>
          <button
            type="button"
            aria-label="Đóng thanh điều hướng"
            onClick={() => setMobileOpen(false)}
            className="fixed inset-0 z-40 bg-slate-900/45 backdrop-blur-xs lg:hidden"
          />
          <aside
            aria-label="Menu điều hướng di động"
            className="fixed inset-y-0 left-0 z-50 w-[264px] bg-gradient-to-b from-[#071128] via-[#0B1938] to-[#0E224A] text-white shadow-2xl flex flex-col lg:hidden"
          >
            <div className="h-[54px] px-4 flex items-center justify-between border-b border-white/10">
              <Link
                href="/dashboard"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-2.5"
              >
                <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-sky-500 to-blue-700 text-white font-extrabold text-xs grid place-items-center">
                  TT
                </span>
                <span className="font-display font-bold text-sm text-white">Toàn Trung CRM</span>
              </Link>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Đóng menu"
                className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/10"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
              <ul role="list" className="space-y-1">
                {visibleWorkNav.map((item) => {
                  const Icon = item.icon;
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setMobileOpen(false)}
                        className={`flex items-center gap-3 min-h-10 px-3 rounded-xl text-sm font-medium transition ${
                          active
                            ? 'bg-blue-600/35 text-white font-semibold border border-sky-400/30'
                            : 'text-slate-300 hover:bg-white/10 hover:text-white'
                        }`}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.badge !== undefined && item.badge > 0 && (
                          <span className="px-1.5 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[10px] font-bold">
                            {item.badge}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>

              {visibleSystemNav.length > 0 && (
                <div className="pt-3 border-t border-white/10">
                  <div className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Quản trị hệ thống
                  </div>
                  <ul role="list" className="space-y-1">
                    {visibleSystemNav.map((item) => {
                      const Icon = item.icon;
                      const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            onClick={() => setMobileOpen(false)}
                            className={`flex items-center gap-3 min-h-10 px-3 rounded-xl text-sm font-medium transition ${
                              active
                                ? 'bg-blue-600/35 text-white font-semibold'
                                : 'text-slate-300 hover:bg-white/10 hover:text-white'
                            }`}
                          >
                            <Icon className="w-4 h-4 shrink-0" />
                            <span>{item.label}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </nav>

            <div className="p-3 border-t border-white/10 space-y-2">
              <Link
                href="/profile"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-2.5 p-2 rounded-xl bg-white/5 hover:bg-white/10"
              >
                <span className="w-8 h-8 rounded-full bg-[#2563EB] text-white font-bold text-xs grid place-items-center shrink-0">
                  {getInitials(user.fullName)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-white truncate">{user.fullName}</p>
                  <p className="text-[11px] text-sky-200/80 truncate">{user.roleName}</p>
                </div>
              </Link>
              <button
                type="button"
                onClick={() => {
                  setMobileOpen(false);
                  void logout();
                }}
                className="w-full h-9 px-3 rounded-xl bg-white/5 hover:bg-rose-500/20 text-rose-200 text-xs font-semibold inline-flex items-center justify-center gap-2"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Đăng xuất</span>
              </button>
            </div>
          </aside>
        </>
      )}

      {/* ===================================================================== */}
      {/* TOPBAR TINH GIẢN CHUẨN LINEAR / STRIPE (54px, không khung hộp thô)     */}
      {/* Chỉ 3 điểm chạm bên phải: Tìm nhanh mềm · Chuông mảnh · Menu Avatar   */}
      {/* ===================================================================== */}
      <header className="sticky top-0 z-30 h-[54px] shrink-0 bg-white/88 backdrop-blur-xl border-b border-slate-200/75 px-3 sm:px-5 flex items-center justify-between gap-3">
        {/* Trái: Thương hiệu thanh thoát + Menu 6 phân hệ có vạch nhấn mảnh */}
        <div className="flex items-center gap-2.5 lg:gap-4 min-w-0 h-full">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Mở menu điều hướng"
            className="lg:hidden w-8 h-8 rounded-full text-slate-600 hover:text-slate-900 hover:bg-slate-100 grid place-items-center shrink-0"
          >
            <Menu aria-hidden="true" className="w-4 h-4" />
          </button>

          <Link
            href="/dashboard"
            className="flex items-center gap-2 shrink-0 focus-visible:outline-2 focus-visible:outline-[#1E3A8A] rounded-lg"
          >
            <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#0B1F4D] via-[#1E3A8A] to-[#2563EB] text-white font-extrabold text-[11px] tracking-tight grid place-items-center shadow-xs shrink-0">
              TT
            </span>
            <span className="hidden sm:inline font-display font-bold tracking-tight text-[14px] text-slate-900">
              Toàn Trung
            </span>
          </Link>

          <span className="hidden lg:block h-4 w-px bg-slate-200/90 shrink-0" aria-hidden="true" />

          <span className="lg:hidden text-slate-900 font-bold text-sm truncate">
            {currentBreadcrumb}
          </span>

          {/* Menu chính: nền dịu khi active + vạch nhấn 2px thanh lịch dưới mép */}
          <nav
            aria-label="Điều hướng chính"
            className="hidden lg:flex items-center gap-0.5 xl:gap-1 h-full min-w-0"
          >
            {visibleWorkNav.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={true}
                  aria-current={active ? 'page' : undefined}
                  className={`relative h-full inline-flex items-center px-1 group focus-visible:outline-none`}
                >
                  <span
                    className={`inline-flex items-center gap-1.5 h-8 px-2.5 xl:px-3 rounded-lg text-[13px] whitespace-nowrap transition-colors group-focus-visible:ring-2 group-focus-visible:ring-[#1E3A8A]/40 ${
                      active
                        ? 'bg-blue-50/85 text-[#0F275C] font-semibold'
                        : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100/75 font-medium'
                    }`}
                  >
                    <Icon
                      aria-hidden="true"
                      className={`w-[15px] h-[15px] shrink-0 transition-colors ${
                        active ? 'text-[#1E3A8A]' : 'text-slate-400 group-hover:text-slate-600'
                      }`}
                    />
                    <span className="hidden 2xl:inline">{item.label}</span>
                    <span className="2xl:hidden">{item.shortLabel || item.label}</span>
                    {item.badge !== undefined && item.badge > 0 && (
                      <span
                        title={`${item.badge} Lead chờ xác nhận tiếp nhận`}
                        className="ml-0.5 inline-flex items-center justify-center min-w-[17px] h-[17px] px-1 rounded-full bg-amber-500/15 text-amber-800 ring-1 ring-amber-400/50 text-[10px] font-bold tabular-nums"
                      >
                        {item.badge}
                      </span>
                    )}
                  </span>
                  {active && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-2.5 bottom-0 h-[2px] rounded-t-full bg-[#1E3A8A]"
                    />
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Phải: Chỉ 3 điểm chạm tinh tế — Tìm kiếm mềm · Chuông không viền · Menu Avatar hợp nhất */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {showTopbarSearch && (
            <div className="hidden md:flex w-44 xl:w-56 2xl:w-64 items-center gap-2 h-8 px-3 rounded-full bg-slate-100/80 hover:bg-slate-100 focus-within:bg-white border border-transparent focus-within:border-[#1E3A8A]/35 focus-within:ring-4 focus-within:ring-blue-500/10 text-xs text-slate-800 transition-all">
              <Search aria-hidden="true" className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <label htmlFor="tt-global-search-input" className="sr-only">
                {topbarSearchPlaceholder}
              </label>
              <input
                id="tt-global-search-input"
                ref={globalSearchInputRef}
                type="search"
                name="tt-crm-scoped-search"
                autoComplete="off"
                spellCheck={false}
                value={globalSearchText}
                onChange={(e) => {
                  const val = e.target.value;
                  setGlobalSearchText(val);
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('tt-global-search', { detail: val }));
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && globalSearchText) {
                    setGlobalSearchText('');
                    if (typeof window !== 'undefined') {
                      window.dispatchEvent(new CustomEvent('tt-global-search', { detail: '' }));
                    }
                  }
                }}
                placeholder={topbarSearchPlaceholder}
                className="flex-1 bg-transparent outline-none text-xs text-slate-800 placeholder:text-slate-400 min-w-0"
              />
              {globalSearchText ? (
                <button
                  type="button"
                  aria-label="Xóa từ khóa tìm kiếm"
                  onClick={() => {
                    setGlobalSearchText('');
                    if (typeof window !== 'undefined') {
                      window.dispatchEvent(new CustomEvent('tt-global-search', { detail: '' }));
                    }
                  }}
                  className="w-4 h-4 rounded-full hover:bg-slate-200 text-slate-500 text-xs font-bold grid place-items-center shrink-0"
                >
                  ×
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setCommandPaletteOpen(true)}
                  title="Mở Thanh Lệnh Toàn Cục (Ctrl + K)"
                  className="text-[10px] font-mono text-slate-500 hover:text-[#1E3A8A] bg-white/90 hover:bg-blue-50 px-1.5 py-0.5 rounded-md shadow-[0_1px_0_rgba(15,23,42,0.08)] shrink-0 transition"
                >
                  Ctrl K
                </button>
              )}
            </div>
          )}

          {!showTopbarSearch && (
            <button
              type="button"
              onClick={() => setCommandPaletteOpen(true)}
              title="Mở Thanh Lệnh Toàn Cục (Ctrl + K)"
              className="hidden md:inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-slate-100/80 hover:bg-slate-200/70 text-xs font-medium text-slate-600 transition"
            >
              <Search aria-hidden="true" className="w-3.5 h-3.5 text-slate-400" />
              <span>Tìm &amp; Lệnh nhanh</span>
              <kbd className="text-[10px] font-mono text-slate-500 bg-white px-1.5 py-0.5 rounded-md">
                Ctrl K
              </kbd>
            </button>
          )}

          {showTopbarSearch && (
            <button
              type="button"
              onClick={() => setMobileSearchOpen(!mobileSearchOpen)}
              aria-label="Mở ô tìm kiếm"
              aria-expanded={mobileSearchOpen}
              className="md:hidden w-8 h-8 rounded-full hover:bg-slate-100 text-slate-500 grid place-items-center"
            >
              <Search aria-hidden="true" className="w-4 h-4" />
            </button>
          )}

          {/* Chuông thông báo không viền hộp */}
          <div ref={bellRef} className="relative">
            <button
              type="button"
              onClick={() => {
                setAccountMenuOpen(false);
                setBellOpen((prev) => !prev);
              }}
              aria-label={unreadCount > 0 ? `Thông báo (${unreadCount} chưa đọc)` : 'Thông báo'}
              aria-expanded={bellOpen}
              aria-haspopup="dialog"
              className={`relative w-8 h-8 rounded-full grid place-items-center transition-colors focus-visible:outline-2 focus-visible:outline-[#1E3A8A] ${
                bellOpen
                  ? 'bg-blue-50 text-[#1E3A8A]'
                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Bell aria-hidden="true" className="w-[17px] h-[17px]" />
              {unreadCount > 0 && (
                <span className="absolute top-0.5 right-0.5 min-w-[15px] h-[15px] px-1 rounded-full bg-[#2563EB] text-white text-[9px] font-bold grid place-items-center ring-2 ring-white tabular-nums">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {bellOpen && (
              <div
                role="dialog"
                aria-label="Thông báo gần đây"
                className="absolute right-0 mt-2 w-80 sm:w-96 rounded-2xl bg-white border border-slate-200/90 shadow-2xl shadow-slate-900/10 z-50 overflow-hidden"
              >
                <div className="px-4 py-3 bg-slate-50/70 border-b border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900">Thông báo</span>
                    {unreadCount > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-blue-50 text-[#1E3A8A] text-[11px] font-semibold">
                        {unreadCount} mới
                      </span>
                    )}
                  </div>
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={() => void handleMarkAllReadQuick()}
                      className="text-xs font-semibold text-[#1E3A8A] hover:underline inline-flex items-center gap-1"
                    >
                      <CheckCheck aria-hidden="true" className="w-3.5 h-3.5" />
                      <span>Đọc hết</span>
                    </button>
                  )}
                </div>

                {desktopNotifPermission !== 'unsupported' && desktopNotifPermission === 'default' && (
                  <div className="px-4 py-2 bg-blue-50/50 border-b border-blue-100/80 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-slate-700 font-medium">
                      Nhận báo Lead im lặng khi mở tab khác:
                    </span>
                    <button
                      type="button"
                      onClick={() => void requestDesktopNotifPermission()}
                      className="shrink-0 px-2.5 py-1 rounded-lg bg-[#0F275C] text-white text-[11px] font-semibold hover:bg-[#1E3A8A] transition"
                    >
                      Bật ngay
                    </button>
                  </div>
                )}

                <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                  {loadingBell ? (
                    <div className="p-6 text-center text-xs text-slate-400">Đang tải...</div>
                  ) : recentNotifications.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-400">
                      Không có thông báo mới.
                    </div>
                  ) : (
                    recentNotifications.map((item) => {
                      const isWarn =
                        item.category.toLowerCase().includes('cảnh báo') ||
                        item.category.toLowerCase().includes('quá hạn') ||
                        item.category.toLowerCase().includes('nhắc');
                      return (
                        <Link
                          key={item.id}
                          href={item.actionUrl || '/notifications'}
                          onClick={() => setBellOpen(false)}
                          className={`block px-4 py-3 hover:bg-slate-50/80 transition ${
                            !item.isRead ? 'bg-blue-50/35' : ''
                          }`}
                        >
                          <div className="flex items-start gap-2.5">
                            <div
                              className={`mt-0.5 w-7 h-7 rounded-lg grid place-items-center shrink-0 ${
                                isWarn
                                  ? 'bg-amber-50 text-amber-700'
                                  : 'bg-blue-50 text-[#1E3A8A]'
                              }`}
                            >
                              {isWarn ? (
                                <AlertTriangle aria-hidden="true" className="w-3.5 h-3.5" />
                              ) : (
                                <Bell aria-hidden="true" className="w-3.5 h-3.5" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-xs font-semibold text-slate-900 truncate">
                                  {item.title}
                                </p>
                                {!item.isRead && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-[#2563EB] shrink-0" />
                                )}
                              </div>
                              <p className="text-xs text-slate-600 line-clamp-2 mt-0.5">
                                {item.summary}
                              </p>
                              <span className="text-[11px] text-slate-400 flex items-center gap-1 mt-1">
                                <Clock aria-hidden="true" className="w-3 h-3" />
                                {new Date(item.createdAt).toLocaleString('vi-VN')}
                              </span>
                            </div>
                          </div>
                        </Link>
                      );
                    })
                  )}
                </div>

                <div className="p-2 bg-slate-50/70 border-t border-slate-100 text-center">
                  <Link
                    href="/notifications"
                    onClick={() => setBellOpen(false)}
                    className="w-full h-8 rounded-xl hover:bg-slate-200/60 text-[#1E3A8A] text-xs font-semibold inline-flex items-center justify-center gap-1 transition"
                  >
                    <span>Xem tất cả thông báo</span>
                    <ArrowUpRight aria-hidden="true" className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            )}
          </div>

          <span className="hidden sm:block h-4 w-px bg-slate-200/80" aria-hidden="true" />

          {/* 1 Nút Avatar hợp nhất: Hồ sơ · Nhân sự · Cài đặt · Đăng xuất (không còn khung hộp rời rạc) */}
          <div ref={accountMenuRef} className="relative">
            <button
              type="button"
              onClick={() => {
                setBellOpen(false);
                setAccountMenuOpen((prev) => !prev);
              }}
              aria-label={`Tài khoản ${user.fullName}`}
              aria-expanded={accountMenuOpen}
              aria-haspopup="menu"
              className={`h-8 pl-1 pr-2 rounded-full inline-flex items-center gap-2 transition-colors focus-visible:outline-2 focus-visible:outline-[#1E3A8A] ${
                accountMenuOpen
                  ? 'bg-slate-100 text-slate-900'
                  : 'hover:bg-slate-100/90 text-slate-700'
              }`}
            >
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt=""
                  className="w-6 h-6 rounded-full object-cover ring-1 ring-slate-200 shrink-0"
                />
              ) : (
                <span className="w-6 h-6 rounded-full bg-gradient-to-br from-[#0F275C] to-[#2563EB] text-white font-bold text-[10px] grid place-items-center shrink-0">
                  {getInitials(user.fullName)}
                </span>
              )}
              <span className="hidden sm:inline text-xs font-semibold max-w-[124px] truncate text-slate-800">
                {user.fullName}
              </span>
              <ChevronDown
                aria-hidden="true"
                className={`w-3.5 h-3.5 text-slate-400 transition-transform ${
                  accountMenuOpen ? 'rotate-180 text-slate-700' : ''
                }`}
              />
            </button>

            {accountMenuOpen && (
              <div
                role="menu"
                aria-label="Menu tài khoản và hệ thống"
                className="absolute right-0 mt-2 w-60 rounded-2xl bg-white border border-slate-200/90 shadow-2xl shadow-slate-900/10 py-1.5 z-50"
              >
                <div className="px-3.5 py-2.5 border-b border-slate-100">
                  <p className="text-xs font-bold text-slate-900 truncate">{user.fullName}</p>
                  <p className="text-[11px] text-slate-500 truncate mt-0.5">{user.email}</p>
                  <span className="inline-block mt-1.5 px-2 py-0.5 rounded-md bg-blue-50 text-[#1E3A8A] text-[10px] font-semibold">
                    {user.roleName}
                  </span>
                </div>

                <div className="py-1">
                  <Link
                    href="/profile"
                    role="menuitem"
                    onClick={() => setAccountMenuOpen(false)}
                    className={`flex items-center gap-2.5 px-3.5 py-2 text-xs font-medium transition ${
                      pathname === '/profile'
                        ? 'bg-blue-50/80 text-[#0F275C] font-semibold'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <UserCircle2 className="w-4 h-4 text-slate-400" />
                    <span>Hồ sơ cá nhân</span>
                  </Link>
                  <Link
                    href="/notifications"
                    role="menuitem"
                    onClick={() => setAccountMenuOpen(false)}
                    className={`flex items-center justify-between gap-2.5 px-3.5 py-2 text-xs font-medium transition ${
                      pathname === '/notifications'
                        ? 'bg-blue-50/80 text-[#0F275C] font-semibold'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span className="inline-flex items-center gap-2.5">
                      <Bell className="w-4 h-4 text-slate-400" />
                      <span>Trung tâm thông báo</span>
                    </span>
                    {unreadCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-blue-100 text-[#1E3A8A] text-[10px] font-bold">
                        {unreadCount}
                      </span>
                    )}
                  </Link>
                </div>

                {visibleSystemNav.length > 0 && (
                  <div className="py-1 border-t border-slate-100">
                    <div className="px-3.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Quản trị hệ thống
                    </div>
                    {visibleSystemNav.map((item) => {
                      const Icon = item.icon;
                      const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          role="menuitem"
                          onClick={() => setAccountMenuOpen(false)}
                          className={`flex items-center gap-2.5 px-3.5 py-2 text-xs font-medium transition ${
                            active
                              ? 'bg-blue-50/80 text-[#0F275C] font-semibold'
                              : 'text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <Icon className="w-4 h-4 text-slate-400" />
                          <span>{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}

                <div className="pt-1 border-t border-slate-100">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setAccountMenuOpen(false);
                      void logout();
                    }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50/80 transition text-left"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Đăng xuất</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Dải nhắc Chuyển giao Lead im lặng trên toàn hệ thống (chỉ hiện ngoài trang Tổng quan & Lead) */}
      {showGlobalHandoverStrip && firstHandover && (
        <div
          role="region"
          aria-label="Lead chuyển giao chờ tiếp nhận"
          className="relative z-20 bg-amber-50/90 border-b border-amber-200/80 px-3 sm:px-5 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs"
        >
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-900 ring-1 ring-amber-400/40 text-[11px] font-bold shrink-0">
              <ArrowRightLeft className="w-3 h-3" />
              <span>Chờ tiếp nhận ({incomingHandovers.length})</span>
            </span>
            <span className="text-slate-800 font-medium truncate">
              <strong className="font-mono text-[#0F275C]" title={firstHandover.leadCode}>
                {formatCompactLeadCode(firstHandover.leadCode)}
              </strong>{' '}
              · <strong>{firstHandover.customerLabel}</strong>
              {firstHandover.fromSalesName ? ` (từ ${firstHandover.fromSalesName})` : ''}
              <span className="ml-1.5 text-amber-800">
                · {formatWaitingDuration(firstHandover.waitingMinutes)}
              </span>
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              disabled={confirmingLeadId === firstHandover.leadId}
              onClick={() => void handleQuickConfirmHandover(firstHandover)}
              className="h-7 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold inline-flex items-center gap-1 transition disabled:opacity-50"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{confirmingLeadId === firstHandover.leadId ? 'Đang lưu...' : 'Xác nhận nhận'}</span>
            </button>
            {incomingHandovers.length > 1 && (
              <button
                type="button"
                onClick={() => setHandoverPopoverOpen((p) => !p)}
                className="h-7 px-2.5 rounded-lg bg-white hover:bg-amber-100/70 border border-amber-200 text-amber-950 font-semibold inline-flex items-center gap-1 transition"
              >
                <span>Tất cả ({incomingHandovers.length})</span>
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            )}
            <Link
              href={`/leads?highlight=${firstHandover.leadId}`}
              className="h-7 px-2.5 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-semibold inline-flex items-center"
            >
              Mở hồ sơ
            </Link>
          </div>

          {handoverPopoverOpen && incomingHandovers.length > 1 && (
            <div className="absolute right-5 top-full mt-1 w-[min(460px,calc(100vw-2rem))] rounded-2xl bg-white border border-slate-200 shadow-2xl p-3 space-y-2 z-50">
              <div className="flex items-center justify-between pb-1.5 border-b border-slate-100">
                <span className="font-bold text-slate-900">
                  {incomingHandovers.length} Lead chuyển giao chờ bạn xác nhận
                </span>
                <button
                  type="button"
                  onClick={() => setHandoverPopoverOpen(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-700"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="max-h-64 overflow-y-auto space-y-1.5">
                {incomingHandovers.map((item) => (
                  <div
                    key={item.leadId}
                    className="p-2.5 rounded-xl border border-slate-200/80 bg-slate-50/50 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-[#1E3A8A]" title={item.leadCode}>
                          {formatCompactLeadCode(item.leadCode)}
                        </span>
                        <span className="font-semibold text-slate-900 truncate">
                          {item.customerLabel}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {item.fromSalesName ? `Từ: ${item.fromSalesName} · ` : ''}
                        <span
                          className={
                            item.slaLevel === 'overdue'
                              ? 'text-rose-700 font-semibold'
                              : item.slaLevel === 'warning'
                                ? 'text-amber-700 font-semibold'
                                : ''
                          }
                        >
                          {formatWaitingDuration(item.waitingMinutes)}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={confirmingLeadId === item.leadId}
                      onClick={() => void handleQuickConfirmHandover(item)}
                      className="shrink-0 h-7 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold inline-flex items-center gap-1 disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Xác nhận</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {mobileSearchOpen && (
        <div className="md:hidden bg-white border-b border-slate-200 px-4 py-2.5 flex items-center gap-2 shrink-0">
          <Search aria-hidden="true" className="w-4 h-4 text-slate-400 shrink-0" />
          <label htmlFor="tt-mobile-search-input" className="sr-only">
            Tìm kiếm trong {currentBreadcrumb}
          </label>
          <input
            id="tt-mobile-search-input"
            type="search"
            autoComplete="off"
            value={globalSearchText}
            onChange={(e) => {
              const val = e.target.value;
              setGlobalSearchText(val);
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('tt-global-search', { detail: val }));
              }
            }}
            placeholder={`Tìm kiếm trong ${currentBreadcrumb}...`}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                setMobileSearchOpen(false);
              }
            }}
            className="flex-1 text-xs bg-transparent outline-none text-slate-800"
          />
          <button
            type="button"
            onClick={() => setMobileSearchOpen(false)}
            className="text-xs text-slate-500 px-2 py-1"
          >
            Đóng
          </button>
        </div>
      )}

      {/* Vùng nội dung chính rộng 100% có cô lập lỗi SectionErrorBoundary */}
      <main
        id="main-workspace-content"
        tabIndex={-1}
        className={
          isFullBleed
            ? 'flex-1 min-h-0 w-full overflow-y-auto flex flex-col p-0 pb-16 md:pb-0 bg-[#F8FAFC] focus:outline-none'
            : 'flex-1 w-full px-3 sm:px-4 lg:px-5 py-4 pb-20 md:pb-8 bg-[#F8FAFC] focus:outline-none'
        }
      >
        <SectionErrorBoundary sectionTitle={currentBreadcrumb}>
          {children}
        </SectionErrorBoundary>
      </main>

      {commandPaletteOpen && (
        <GlobalCommandPalette
          open={commandPaletteOpen}
          onClose={() => setCommandPaletteOpen(false)}
          user={user}
        />
      )}

      {/* Thanh điều hướng di động (< 768px) */}
      <nav
        aria-label="Điều hướng di động"
        className="md:hidden fixed bottom-0 inset-x-0 z-30 min-h-14 backdrop-blur-md bg-white/95 border-t border-slate-200 px-2 flex items-center justify-around shadow-md"
      >
        {[
          { href: '/dashboard', label: UI_VOCABULARY.menu.dashboard, icon: LayoutGrid },
          {
            href: '/leads',
            label: UI_VOCABULARY.menu.leads,
            icon: FileSpreadsheet,
            badge: incomingHandovers.length > 0 ? incomingHandovers.length : undefined,
          },
          { href: '/reports', label: UI_VOCABULARY.menu.reports, icon: BarChart3 },
          { href: '/notifications', label: UI_VOCABULARY.menu.notifications, icon: Bell, badge: unreadCount },
        ].map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`relative min-w-[60px] min-h-[44px] px-2 py-1 rounded-[10px] flex flex-col items-center justify-center gap-0.5 text-[11px] transition-colors ${
                active ? 'text-[#1E3A8A] font-bold bg-blue-50/80' : 'text-slate-600 font-medium'
              }`}
            >
              <Icon aria-hidden="true" className="w-4 h-4" />
              <span>{item.label}</span>
              {item.badge !== undefined && item.badge > 0 && (
                <span className="absolute top-0.5 right-2 min-w-[16px] min-h-4 px-1 rounded-full bg-[#2563EB] text-white text-[9px] font-bold grid place-items-center">
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="min-w-[60px] min-h-[44px] px-2 py-1 rounded-[10px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-slate-600"
        >
          <Menu aria-hidden="true" className="w-4 h-4" />
          <span>Menu</span>
        </button>
      </nav>

      {/* Thông báo nổi im lặng (không âm thanh) */}
      {latestAlertNotification && (
        <div
          role="alert"
          data-testid="global-incoming-alert-toast"
          className="fixed bottom-16 md:bottom-5 right-4 z-50 w-[min(380px,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl shadow-slate-900/15"
        >
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-[#1E3A8A] grid place-items-center shrink-0">
              <Bell aria-hidden="true" className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#1E3A8A]">
                  {latestAlertNotification.category || 'Thông báo mới'}
                </span>
                <button
                  type="button"
                  onClick={dismissLatestAlert}
                  aria-label="Đóng thông báo nổi"
                  className="text-slate-400 hover:text-slate-700 p-0.5"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs font-bold text-slate-900 leading-snug">
                {latestAlertNotification.title}
              </p>
              <p className="text-xs text-slate-600 leading-relaxed">
                {latestAlertNotification.summary}
              </p>
              <div className="pt-1.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const targetUrl = latestAlertNotification.actionUrl || '/leads';
                    const nid = latestAlertNotification.id;
                    dismissLatestAlert();
                    if (user) {
                      void apiRequest('/api/v1/notifications', {
                        method: 'PATCH',
                        csrfToken: user.csrfToken,
                        body: { notificationId: nid },
                      })
                        .then(() => setUnreadCountState(Math.max(0, unreadCount - 1)))
                        .catch(() => {});
                    }
                    router.push(targetUrl);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-[#0F275C] hover:bg-[#1E3A8A] text-white text-xs font-semibold inline-flex items-center gap-1 transition"
                >
                  <span>{latestAlertNotification.actionLabel || 'Mở hồ sơ ngay'}</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={dismissLatestAlert}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:bg-slate-100"
                >
                  Để sau
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
