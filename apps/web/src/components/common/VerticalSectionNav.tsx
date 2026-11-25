'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, PanelLeftClose, PanelLeftOpen } from 'lucide-react';

export interface VerticalNavItem {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  badge?: string | number | null;
  badgeTone?: 'default' | 'warning' | 'success';
  title?: string;
}

export interface VerticalNavGroup {
  id: string;
  label: string;
  defaultOpen?: boolean;
  items: VerticalNavItem[];
}

export interface VerticalSectionNavProps {
  ariaLabel: string;
  activeId: string;
  onSelect: (id: string) => void;
  topItems?: VerticalNavItem[];
  groups: VerticalNavGroup[];
  footer?: React.ReactNode;
  collapsible?: boolean;
}

/**
 * Thanh điều hướng phân mục dọc chuẩn Google Ads / GA4 / GSC / Looker Studio:
 * - Trên mobile/tablet (< lg): hiển thị dải cuộn ngang.
 * - Trên desktop (>= lg): hiển thị thanh dọc có thể đóng/mở nhóm, hỗ trợ thu gọn.
 */
export function VerticalSectionNav({
  ariaLabel,
  activeId,
  onSelect,
  topItems = [],
  groups,
  footer,
  collapsible = true,
}: VerticalSectionNavProps) {
  const [collapsed, setCollapsed] = useState(false);

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const g of groups) {
      init[g.id] = g.defaultOpen ?? true;
    }
    return init;
  });

  const allFlatItems: VerticalNavItem[] = [
    ...topItems,
    ...groups.flatMap((g) => g.items),
  ];

  const toggleGroup = (groupId: string) => {
    setOpenGroups((prev) => ({ ...prev, [groupId]: !(prev[groupId] ?? true) }));
  };

  const renderBadge = (item: VerticalNavItem, active: boolean) => {
    if (item.badge === undefined || item.badge === null || item.badge === '') return null;
    const toneClass = active
      ? 'bg-white/20 text-white'
      : item.badgeTone === 'warning'
        ? 'bg-amber-100 text-amber-800'
        : item.badgeTone === 'success'
          ? 'bg-emerald-50 text-emerald-700'
          : 'bg-slate-100 text-slate-600';
    return (
      <span
        className={`shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-semibold tabular-nums leading-none ${toneClass}`}
      >
        {item.badge}
      </span>
    );
  };

  const renderDesktopItem = (item: VerticalNavItem) => {
    const Icon = item.icon;
    const active = activeId === item.id;
    return (
      <button
        key={item.id}
        type="button"
        title={item.title || item.label}
        aria-current={active ? 'page' : undefined}
        onClick={() => onSelect(item.id)}
        className={`w-full flex items-center ${
          collapsed ? 'justify-center px-0' : 'justify-between px-3.5'
        } gap-2 min-h-9 py-2 rounded-full text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1A73E8] ${
          active
            ? 'bg-[#1A73E8] text-white font-semibold shadow-xs'
            : 'text-slate-700 hover:bg-slate-100/90 font-medium'
        }`}
      >
        <span className={`flex items-center gap-2.5 min-w-0 ${collapsed ? 'justify-center' : ''}`}>
          {Icon && (
            <Icon
              className={`w-4 h-4 shrink-0 ${
                active ? 'text-white' : 'text-slate-500'
              }`}
            />
          )}
          {!collapsed && <span className="truncate">{item.label}</span>}
        </span>
        {!collapsed && renderBadge(item, active)}
      </button>
    );
  };

  return (
    <>
      {/* Thanh cuộn ngang trên mobile / tablet (<lg) */}
      <nav
        aria-label={ariaLabel}
        className="lg:hidden w-full flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]"
      >
        {allFlatItems.map((item) => {
          const Icon = item.icon;
          const active = activeId === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => onSelect(item.id)}
              className={`flex-none inline-flex items-center gap-1.5 min-h-9 px-3.5 py-1.5 rounded-full text-xs transition-colors ${
                active
                  ? 'bg-[#1A73E8] text-white font-semibold shadow-xs'
                  : 'bg-white border border-slate-200/90 text-slate-700 hover:bg-slate-50 font-medium'
              }`}
            >
              {Icon && (
                <Icon
                  className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-white' : 'text-slate-500'}`}
                />
              )}
              <span>{item.label}</span>
              {renderBadge(item, active)}
            </button>
          );
        })}
      </nav>

      {/* Thanh menu dọc trắng bên trái trên desktop (lg+) */}
      <aside
        aria-label={ariaLabel}
        className={`hidden lg:flex flex-col shrink-0 lg:sticky lg:top-2 lg:self-start bg-white border border-slate-200/90 rounded-2xl shadow-2xs p-2.5 transition-[width] duration-200 ${
          collapsed ? 'w-[58px]' : 'w-[228px]'
        }`}
      >
        {collapsible && (
          <div
            className={`flex items-center ${
              collapsed ? 'justify-center' : 'justify-between px-2'
            } pb-1.5 mb-1 border-b border-slate-100`}
          >
            {!collapsed && (
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 select-none">
                Phân mục
              </span>
            )}
            <button
              type="button"
              onClick={() => setCollapsed((p) => !p)}
              title={collapsed ? 'Mở rộng phân mục' : 'Thu gọn phân mục'}
              aria-label={collapsed ? 'Mở rộng phân mục' : 'Thu gọn phân mục'}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            >
              {collapsed ? (
                <PanelLeftOpen className="w-4 h-4" />
              ) : (
                <PanelLeftClose className="w-4 h-4" />
              )}
            </button>
          </div>
        )}

        <nav className="space-y-2">
          {topItems.length > 0 && (
            <div className="space-y-0.5">{topItems.map((item) => renderDesktopItem(item))}</div>
          )}

          {groups.map((group, gIdx) => {
            const isOpen = openGroups[group.id] ?? true;
            const hasActiveChild = group.items.some((it) => it.id === activeId);
            return (
              <div
                key={group.id}
                className={topItems.length > 0 || gIdx > 0 ? 'pt-1.5 border-t border-slate-100' : ''}
              >
                {!collapsed && (
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => toggleGroup(group.id)}
                    className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs font-semibold transition-colors hover:bg-slate-50 ${
                      hasActiveChild ? 'text-[#1A73E8]' : 'text-slate-600'
                    }`}
                  >
                    <span className="leading-snug">{group.label}</span>
                    {isOpen ? (
                      <ChevronUp className="w-3.5 h-3.5 shrink-0 opacity-75" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-75" />
                    )}
                  </button>
                )}

                {(collapsed || isOpen) && (
                  <div className={`${collapsed ? 'space-y-1' : 'mt-1 space-y-0.5'}`}>
                    {group.items.map((item) => renderDesktopItem(item))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {!collapsed && footer && (
          <div className="border-t border-slate-100 pt-2.5 mt-2.5 px-1.5">{footer}</div>
        )}
      </aside>
    </>
  );
}
