'use client';

import React from 'react';
import Link from 'next/link';
import { BarChart3, Globe, Megaphone, TrendingUp } from 'lucide-react';

export type GooglePlatformKey = 'ga4' | 'ads' | 'gsc' | 'trends';

interface GooglePlatformSwitcherProps {
  active: GooglePlatformKey;
  platforms?: GooglePlatformKey[];
}

const PLATFORMS: Array<{
  key: GooglePlatformKey;
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  dotColor: string;
  activeBg: string;
  activeBorder: string;
  activeText: string;
}> = [
  {
    key: 'ga4',
    label: 'Analytics (GA4)',
    href: '/tracking?section=overview',
    icon: BarChart3,
    dotColor: 'bg-amber-500',
    activeBg: 'bg-amber-50/90',
    activeBorder: 'border-amber-300',
    activeText: 'text-amber-900',
  },
  {
    key: 'ads',
    label: 'Google Ads',
    href: '/tracking?section=ads_campaigns',
    icon: Megaphone,
    dotColor: 'bg-[#1A73E8]',
    activeBg: 'bg-blue-50/90',
    activeBorder: 'border-blue-300',
    activeText: 'text-[#1A73E8]',
  },
  {
    key: 'gsc',
    label: 'Search Console',
    href: '/ads?tab=overview',
    icon: Globe,
    dotColor: 'bg-emerald-600',
    activeBg: 'bg-emerald-50/90',
    activeBorder: 'border-emerald-300',
    activeText: 'text-emerald-800',
  },
  {
    key: 'trends',
    label: 'Google Trends',
    href: '/ads?tab=trends',
    icon: TrendingUp,
    dotColor: 'bg-rose-500',
    activeBg: 'bg-rose-50/90',
    activeBorder: 'border-rose-300',
    activeText: 'text-rose-800',
  },
];

export function GooglePlatformSwitcher({ active, platforms }: GooglePlatformSwitcherProps) {
  const allowedKeys: GooglePlatformKey[] =
    platforms && platforms.length > 0
      ? platforms
      : active === 'ga4' || active === 'ads'
        ? ['ga4', 'ads']
        : ['gsc', 'trends'];
  const visiblePlatforms = PLATFORMS.filter((p) => allowedKeys.includes(p.key));

  return (
    <nav
      aria-label="Công cụ Google"
      className="inline-flex max-w-full items-center gap-1 rounded-2xl bg-white border border-slate-200/90 p-1.5 shadow-2xs overflow-x-auto [scrollbar-width:none]"
    >
      {visiblePlatforms.map((p) => {
        const Icon = p.icon;
        const isActive = active === p.key;
        return (
          <Link
            key={p.key}
            href={p.href}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.dispatchEvent(
                  new CustomEvent('tt-google-platform-click', { detail: p.key }),
                );
              }
            }}
            className={`flex-none inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs transition-all whitespace-nowrap ${
              isActive
                ? `${p.activeBg} ${p.activeBorder} ${p.activeText} font-semibold shadow-2xs`
                : 'border-transparent hover:bg-slate-50 text-slate-600 font-medium'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.dotColor}`} />
            <Icon className="w-3.5 h-3.5 shrink-0 opacity-85" />
            <span>{p.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
