'use client';

import React, { useMemo, useState } from 'react';
import { Activity, Clock, Eye } from 'lucide-react';
import type { M02Ga4EventItemDto } from '@toantrung/contracts';

interface Ga4RealtimeBarCardProps {
  activeUsers30m: number | null;
  minutesSeries: Array<{ minutesAgo: number; activeUsers: number }>;
  activePages?: Array<{ pageTitle: string; activeUsers: number }>;
  realtimeEvents?: M02Ga4EventItemDto[];
  checkedAt?: string | null;
}

export function Ga4RealtimeBarCard({
  activeUsers30m,
  minutesSeries,
  activePages = [],
  realtimeEvents = [],
  checkedAt,
}: Ga4RealtimeBarCardProps) {
  const [hoverMin, setHoverMin] = useState<number | null>(null);

  const normalizedMinutes = useMemo(() => {
    const byAgo = new Map(minutesSeries.map((m) => [m.minutesAgo, m.activeUsers]));
    return Array.from({ length: 30 }, (_, idx) => {
      const minutesAgo = 29 - idx;
      return { minutesAgo, activeUsers: byAgo.get(minutesAgo) || 0 };
    });
  }, [minutesSeries]);

  const maxBar = useMemo(
    () => Math.max(1, ...normalizedMinutes.map((m) => m.activeUsers)),
    [normalizedMinutes],
  );

  const checkedHm = useMemo(() => {
    if (!checkedAt) return null;
    try {
      return new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(checkedAt));
    } catch {
      return null;
    }
  }, [checkedAt]);

  return (
    <section
      aria-label="Báo cáo Realtime 30 phút kiểu GA4"
      className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs grid grid-cols-1 lg:grid-cols-12 gap-4"
    >
      {/* Cột trái 5/12: Người dùng trong 30 phút qua + Biểu đồ 30 cột từng phút */}
      <div className="lg:col-span-5 flex flex-col justify-between space-y-3 border-b lg:border-b-0 lg:border-r border-slate-100 pb-3 lg:pb-0 lg:pr-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-emerald-600" />
              <span>Người dùng trong 30 phút qua</span>
            </div>
            <div className="mt-1 text-3xl font-bold text-[#0F275C] tabular-nums">
              {activeUsers30m !== null ? activeUsers30m.toLocaleString('vi-VN') : '—'}
            </div>
          </div>

          {checkedHm && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-medium">
              <Clock className="w-3 h-3" />
              {checkedHm}
            </span>
          )}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <span>Người dùng hoạt động theo từng phút</span>
            {hoverMin !== null && (
              <span className="font-semibold text-[#1A73E8] tabular-nums">
                {hoverMin === 0 ? 'Phút hiện tại' : `${hoverMin} phút trước`}:{' '}
                {normalizedMinutes.find((x) => x.minutesAgo === hoverMin)?.activeUsers ?? 0} user
              </span>
            )}
          </div>

          <div
            className="h-20 border-b border-slate-200 flex items-end gap-[2px] pt-2"
            onMouseLeave={() => setHoverMin(null)}
          >
            {normalizedMinutes.map((pt) => {
              const hPct = pt.activeUsers > 0 ? Math.max(10, Math.round((pt.activeUsers / maxBar) * 100)) : 4;
              const isHover = hoverMin === pt.minutesAgo;
              return (
                <div
                  key={pt.minutesAgo}
                  onMouseEnter={() => setHoverMin(pt.minutesAgo)}
                  title={`${pt.minutesAgo === 0 ? 'Vừa xong' : `${pt.minutesAgo} phút trước`}: ${pt.activeUsers} user`}
                  className="flex-1 h-full flex items-end cursor-pointer"
                >
                  <div
                    style={{ height: `${hPct}%` }}
                    className={`w-full rounded-t-[2px] transition-colors ${
                      pt.activeUsers === 0
                        ? 'bg-slate-200'
                        : isHover
                          ? 'bg-[#0F275C]'
                          : 'bg-[#1A73E8]'
                    }`}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between text-[10px] text-slate-400">
            <span>29 phút trước</span>
            <span>15 phút trước</span>
            <span>Vừa xong</span>
          </div>
        </div>
      </div>

      {/* Cột phải 7/12: Trang đang xem trực tiếp & Top Event 30 phút */}
      <div className="lg:col-span-7 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3 space-y-2">
          <div className="font-bold text-slate-800 flex items-center gap-1.5">
            <Eye className="w-3.5 h-3.5 text-[#1A73E8]" />
            <span>Trang khách đang xem (30p)</span>
          </div>
          {activePages.length === 0 ? (
            <p className="text-[11px] text-slate-500 py-4 text-center">
              Chưa ghi nhận trang đang xem trong 30 phút qua.
            </p>
          ) : (
            <ul className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
              {activePages.slice(0, 6).map((pg) => (
                <li
                  key={pg.pageTitle}
                  className="flex items-center justify-between gap-2 text-[11px] bg-white rounded-lg border border-slate-100 px-2.5 py-1.5"
                >
                  <span className="truncate text-slate-700" title={pg.pageTitle}>
                    {pg.pageTitle}
                  </span>
                  <strong className="shrink-0 font-bold text-[#0F275C] tabular-nums">
                    {pg.activeUsers}
                  </strong>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3 space-y-2">
          <div className="font-bold text-slate-800 flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-emerald-600" />
            <span>Top sự kiện 30 phút qua</span>
          </div>
          {realtimeEvents.length === 0 ? (
            <p className="text-[11px] text-slate-500 py-4 text-center">
              Chưa ghi nhận sự kiện realtime trong 30 phút qua.
            </p>
          ) : (
            <ul className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
              {realtimeEvents.slice(0, 6).map((ev) => (
                <li
                  key={ev.eventName}
                  className="flex items-center justify-between gap-2 text-[11px] bg-white rounded-lg border border-slate-100 px-2.5 py-1.5"
                >
                  <span className="font-mono text-slate-800 truncate">{ev.eventName}</span>
                  <strong className="shrink-0 font-bold text-emerald-700 tabular-nums">
                    {ev.eventCount}
                  </strong>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
