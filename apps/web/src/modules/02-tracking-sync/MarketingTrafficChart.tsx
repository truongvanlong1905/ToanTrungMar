'use client';

import React, { useEffect, useId, useMemo, useState } from 'react';
import type { M02ChannelRowDto, M02TrafficSeriesPointDto } from '@toantrung/contracts';
import { TrendingUp } from 'lucide-react';

interface MarketingTrafficChartProps {
  points: M02TrafficSeriesPointDto[];
  previousPoints?: M02TrafficSeriesPointDto[];
  compareEnabled?: boolean;
  loading?: boolean;
}

type ChartFocusMode = 'combo' | 'newUsers' | 'sessions' | 'depth';

function buildSmoothSvgSegments(
  coords: Array<{ x: number; y: number; valid: boolean }>,
  baselineY: number,
): { linePaths: string[]; areaPaths: string[] } {
  const runs: Array<Array<{ x: number; y: number }>> = [];
  let current: Array<{ x: number; y: number }> = [];

  for (const pt of coords) {
    if (pt.valid) {
      current.push({ x: pt.x, y: pt.y });
    } else if (current.length > 0) {
      runs.push(current);
      current = [];
    }
  }
  if (current.length > 0) runs.push(current);

  const linePaths: string[] = [];
  const areaPaths: string[] = [];

  for (const run of runs) {
    if (run.length === 1) {
      const p = run[0];
      linePaths.push(`M ${(p.x - 4).toFixed(1)} ${p.y.toFixed(1)} L ${(p.x + 4).toFixed(1)} ${p.y.toFixed(1)}`);
      continue;
    }
    let d = `M ${run[0].x.toFixed(1)} ${run[0].y.toFixed(1)}`;
    for (let i = 0; i < run.length - 1; i++) {
      const p0 = run[i];
      const p1 = run[i + 1];
      const cx = ((p0.x + p1.x) / 2).toFixed(1);
      d += ` C ${cx} ${p0.y.toFixed(1)}, ${cx} ${p1.y.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
    }
    linePaths.push(d);
    const first = run[0];
    const last = run[run.length - 1];
    areaPaths.push(
      `${d} L ${last.x.toFixed(1)} ${baselineY.toFixed(1)} L ${first.x.toFixed(1)} ${baselineY.toFixed(1)} Z`,
    );
  }

  return { linePaths, areaPaths };
}

export function MarketingTrafficChart({
  points,
  previousPoints,
  compareEnabled = false,
  loading,
}: MarketingTrafficChartProps) {
  const [mode, setMode] = useState<ChartFocusMode>('combo');
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const chartUid = useId().replace(/:/g, '');
  const pvGradId = `mktPvGrad-${chartUid}`;
  const sessGradId = `mktSessGrad-${chartUid}`;

  useEffect(() => {
    setHoverIdx(null);
  }, [points]);

  const summary = useMemo(() => {
    const validPts = points.filter((p) => !p.isMissingData);
    const totalSessions = validPts.reduce((s, p) => s + (p.sessions ?? 0), 0);
    const totalViews = validPts.reduce((s, p) => s + (p.pageViews ?? 0), 0);
    const avgDailySessions =
      validPts.length > 0 ? Math.round(totalSessions / validPts.length) : 0;
    const pagesPerSession =
      totalSessions > 0 ? Number((totalViews / totalSessions).toFixed(2)) : 0;

    let peakDate = '';
    let peakSessions = 0;
    for (const p of validPts) {
      if ((p.sessions ?? 0) > peakSessions) {
        peakSessions = p.sessions ?? 0;
        peakDate = p.date;
      }
    }
    const peakLabel = peakDate ? `${peakDate.slice(8, 10)}/${peakDate.slice(5, 7)}` : '—';
    return {
      totalSessions,
      totalViews,
      avgDailySessions,
      pagesPerSession,
      peakLabel,
      peakSessions,
      activeDays: validPts.length,
    };
  }, [points]);

  const hasNewUsersSeries = useMemo(
    () => points.some((p) => typeof p.newUsers === 'number' && p.newUsers !== null),
    [points],
  );

  const geom = useMemo(() => {
    const W = 760;
    const H = 248;
    const padLeft = 46;
    const padRight = 18;
    const padTop = 20;
    const padBottom = 30;
    const innerW = W - padLeft - padRight;
    const innerH = H - padTop - padBottom;
    const baselineY = padTop + innerH;

    let maxVal = 4;
    for (let i = 0; i < points.length; i += 1) {
      const p = points[i];
      const prev = compareEnabled ? previousPoints?.[i] : undefined;
      if (!p.isMissingData) {
        if (mode === 'depth') {
          const depth = (p.sessions ?? 0) > 0 ? (p.pageViews ?? 0) / (p.sessions || 1) : 0;
          maxVal = Math.max(maxVal, Math.ceil(depth * 1.2));
        } else if (mode === 'newUsers') {
          maxVal = Math.max(maxVal, p.newUsers ?? p.users ?? 0);
        } else if (mode === 'sessions') {
          maxVal = Math.max(maxVal, p.sessions ?? 0);
        } else {
          maxVal = Math.max(maxVal, p.sessions ?? 0, p.pageViews ?? 0);
        }
      }
      if (prev && !prev.isMissingData) {
        if (mode === 'depth') {
          const depthP = (prev.sessions ?? 0) > 0 ? (prev.pageViews ?? 0) / (prev.sessions || 1) : 0;
          maxVal = Math.max(maxVal, Math.ceil(depthP * 1.2));
        } else if (mode === 'newUsers') {
          maxVal = Math.max(maxVal, prev.newUsers ?? prev.users ?? 0);
        } else {
          maxVal = Math.max(maxVal, prev.sessions ?? 0);
        }
      }
    }
    const niceTop = mode === 'depth' ? Math.max(4, Math.ceil(maxVal)) : Math.max(4, Math.ceil(maxVal / 4) * 4);

    const nodes = points.map((p, idx) => {
      const x =
        points.length <= 1
          ? padLeft + innerW / 2
          : padLeft + (idx / (points.length - 1)) * innerW;
      const sVal = p.sessions ?? 0;
      const pvVal = p.pageViews ?? 0;
      const nuVal = p.newUsers ?? p.users ?? 0;
      const depthVal = sVal > 0 ? Number((pvVal / sVal).toFixed(2)) : 0;

      const prev = compareEnabled ? previousPoints?.[idx] : undefined;
      const prevSVal = prev && !prev.isMissingData ? prev.sessions ?? 0 : null;
      const prevNuVal =
        prev && !prev.isMissingData ? (prev.newUsers ?? prev.users ?? null) : null;
      const prevDepthVal =
        prev && !prev.isMissingData && (prev.sessions ?? 0) > 0
          ? Number(((prev.pageViews ?? 0) / (prev.sessions || 1)).toFixed(2))
          : null;

      const ySession = baselineY - (sVal / niceTop) * innerH;
      const yPv = baselineY - (pvVal / niceTop) * innerH;
      const yNewUsers = baselineY - (nuVal / niceTop) * innerH;
      const yDepth = baselineY - (depthVal / niceTop) * innerH;

      const prevMainNumeric =
        mode === 'depth' ? prevDepthVal : mode === 'newUsers' ? prevNuVal : prevSVal;
      const yPrevMain =
        prevMainNumeric !== null ? baselineY - (prevMainNumeric / niceTop) * innerH : null;

      const [, mm, dd] = p.date.split('-');
      return {
        ...p,
        idx,
        label: `${dd}/${mm}`,
        x,
        sVal,
        pvVal,
        nuVal,
        depthVal,
        prevDate: prev?.date,
        prevMainNumeric,
        ySession,
        yPv,
        yNewUsers,
        yDepth,
        yPrevMain,
      };
    });

    const pvCurves = buildSmoothSvgSegments(
      nodes.map((n) => ({ x: n.x, y: n.yPv, valid: !n.isMissingData })),
      baselineY,
    );
    const sessionCurves = buildSmoothSvgSegments(
      nodes.map((n) => ({
        x: n.x,
        y: mode === 'depth' ? n.yDepth : mode === 'newUsers' ? n.yNewUsers : n.ySession,
        valid: !n.isMissingData,
      })),
      baselineY,
    );
    const prevCurves = compareEnabled
      ? buildSmoothSvgSegments(
          nodes.map((n) => ({
            x: n.x,
            y: n.yPrevMain ?? baselineY,
            valid: n.yPrevMain !== null,
          })),
          baselineY,
        )
      : { linePaths: [], areaPaths: [] };

    return {
      W,
      H,
      padLeft,
      padRight,
      padTop,
      baselineY,
      innerH,
      niceTop,
      yTicks: [niceTop, Number((niceTop * 0.66).toFixed(mode === 'depth' ? 1 : 0)), Number((niceTop * 0.33).toFixed(mode === 'depth' ? 1 : 0)), 0],
      nodes,
      pvCurves,
      sessionCurves,
      prevCurves,
    };
  }, [points, previousPoints, compareEnabled, mode]);

  if (loading && points.length === 0) {
    return (
      <div className="h-[140px] rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-xs text-slate-500 animate-pulse">
        Đang tải biểu đồ lưu lượng...
      </div>
    );
  }

  if (points.length === 0) {
    return (
      <div className="h-[120px] rounded-xl bg-slate-50 border border-dashed border-slate-200 grid place-items-center text-xs text-slate-500">
        Chưa có dữ liệu lưu lượng trong khoảng ngày đang chọn.
      </div>
    );
  }

  // Khi xem 1 ngày đơn lẻ (Hôm nay / Hôm qua): hiển thị thanh chỉ số gọn thay vì khung SVG trống 248px
  if (points.length === 1) {
    const pt = points[0];
    const sVal = pt.sessions ?? 0;
    const pvVal = pt.pageViews ?? 0;
    const depth = sVal > 0 ? (pvVal / sVal).toFixed(2) : '0.00';
    const maxBar = Math.max(1, sVal, pvVal);
    return (
      <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-bold text-[#0F275C]">
            Tổng hợp ngày {pt.date.slice(8, 10)}/{pt.date.slice(5, 7)}/{pt.date.slice(0, 4)}
          </span>
          <span className="px-2.5 py-1 rounded-lg bg-sky-50 text-sky-900 border border-sky-200/70 font-semibold tabular-nums">
            Chiều sâu: <strong>{depth}</strong> trang/phiên
          </span>
        </div>
        <div className="space-y-2.5 text-xs">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium text-slate-600">Phiên truy cập</span>
              <strong className="font-bold text-[#0F275C] tabular-nums">{sVal.toLocaleString('vi-VN')} phiên</strong>
            </div>
            <div className="h-2.5 w-full rounded-full bg-slate-200/80 overflow-hidden">
              <div
                className="h-full rounded-full bg-[#0F275C] transition-all"
                style={{ width: `${Math.max(sVal > 0 ? 6 : 0, Math.round((sVal / maxBar) * 100))}%` }}
              />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium text-slate-600">Lượt xem trang</span>
              <strong className="font-bold text-sky-700 tabular-nums">{pvVal.toLocaleString('vi-VN')} lượt</strong>
            </div>
            <div className="h-2.5 w-full rounded-full bg-slate-200/80 overflow-hidden">
              <div
                className="h-full rounded-full bg-sky-500 transition-all"
                style={{ width: `${Math.max(pvVal > 0 ? 6 : 0, Math.round((pvVal / maxBar) * 100))}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const activeNode = hoverIdx !== null ? geom.nodes[hoverIdx] : null;

  return (
    <div className="space-y-3">
      {/* Header điều khiển góc nhìn Marketing + Chỉ số nhanh */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-[#0F275C] border border-blue-200/70 font-semibold tabular-nums">
            TB: <strong>{summary.avgDailySessions.toLocaleString('vi-VN')}</strong> phiên/ngày
          </span>
          <span className="px-2.5 py-1 rounded-lg bg-sky-50 text-sky-900 border border-sky-200/70 font-semibold tabular-nums">
            Chiều sâu: <strong>{summary.pagesPerSession}</strong> trang/phiên
          </span>
          {summary.peakSessions > 0 && (
            <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200/70 font-semibold inline-flex items-center gap-1 tabular-nums">
              <TrendingUp aria-hidden="true" className="w-3.5 h-3.5" />
              Đỉnh {summary.peakLabel}: <strong>{summary.peakSessions.toLocaleString('vi-VN')}</strong> phiên
            </span>
          )}
        </div>

        <div className="inline-flex items-center rounded-xl bg-slate-100 p-0.5 border border-slate-200/80 text-xs">
          {[
            { id: 'combo' as const, label: 'Phiên & Lượt xem' },
            ...(hasNewUsersSeries ? [{ id: 'newUsers' as const, label: 'User mới' }] : []),
            { id: 'sessions' as const, label: 'Chỉ Phiên truy cập' },
            { id: 'depth' as const, label: 'Trang / Phiên' },
          ].map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setMode(opt.id)}
              className={`px-2.5 py-1 rounded-lg font-semibold transition ${
                mode === opt.id
                  ? 'bg-white text-[#0F275C] shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Vùng vẽ SVG Spline + Gradient chuẩn Marketing Analytics */}
      <div className="relative select-none">
        {activeNode && (
          <div
            className="pointer-events-none absolute top-2 z-20 rounded-xl bg-slate-900/95 backdrop-blur-xs text-white px-3 py-2 text-xs shadow-xl border border-slate-700/80 space-y-1"
            style={{
              left:
                activeNode.x > geom.W * 0.62
                  ? 'auto'
                  : `${Math.max(8, (activeNode.x / geom.W) * 100)}%`,
              right:
                activeNode.x > geom.W * 0.62
                  ? `${Math.max(4, ((geom.W - activeNode.x) / geom.W) * 100)}%`
                  : 'auto',
            }}
          >
            <div className="font-bold text-sky-300 border-b border-white/10 pb-1 flex items-center justify-between gap-2">
              <span>Ngày {activeNode.label}/{activeNode.date.slice(0, 4)}</span>
              {compareEnabled && activeNode.prevDate && (
                <span className="text-[10px] font-normal text-slate-400">
                  vs {activeNode.prevDate.slice(8, 10)}/{activeNode.prevDate.slice(5, 7)}
                </span>
              )}
            </div>
            {activeNode.isMissingData ? (
              <div className="text-slate-300">Chưa có dữ liệu đồng bộ ngày này</div>
            ) : (
              <>
                {mode === 'newUsers' && (
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-emerald-200">User mới (GA4):</span>
                    <strong className="font-bold text-emerald-300 tabular-nums">
                      {activeNode.nuVal.toLocaleString('vi-VN')} user
                    </strong>
                  </div>
                )}
                <div className="flex items-center justify-between gap-4">
                  <span className="text-slate-300">Phiên truy cập:</span>
                  <strong className="font-bold tabular-nums">
                    {activeNode.sVal.toLocaleString('vi-VN')} phiên
                  </strong>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sky-200">Lượt xem trang:</span>
                  <strong className="font-bold text-sky-300 tabular-nums">
                    {activeNode.pvVal.toLocaleString('vi-VN')} lượt
                  </strong>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-emerald-200">Chiều sâu đọc:</span>
                  <strong className="font-bold text-emerald-300 tabular-nums">
                    {activeNode.depthVal} trang/phiên
                  </strong>
                </div>
                {compareEnabled && activeNode.prevMainNumeric !== null && (
                  <div className="flex items-center justify-between gap-4 pt-0.5 border-t border-white/10 text-[11px] text-slate-300">
                    <span>Kỳ trước:</span>
                    <strong className="tabular-nums">
                      {activeNode.prevMainNumeric.toLocaleString('vi-VN')}
                    </strong>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <svg
          viewBox={`0 0 ${geom.W} ${geom.H}`}
          className="w-full h-[268px] overflow-visible"
          onMouseLeave={() => setHoverIdx(null)}
          role="img"
          aria-label="Biểu đồ xu hướng lưu lượng chiến dịch marketing"
        >
          <defs>
            <linearGradient id={pvGradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#38BDF8" stopOpacity="0.02" />
            </linearGradient>
            <linearGradient id={sessGradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1E3A8A" stopOpacity="0.26" />
              <stop offset="100%" stopColor="#1E3A8A" stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {/* Lưới ngang & Nhãn trục Y */}
          {geom.yTicks.map((val, i) => {
            const y = geom.baselineY - (val / geom.niceTop) * geom.innerH;
            return (
              <g key={`yt-${i}`}>
                <line
                  x1={geom.padLeft}
                  y1={y}
                  x2={geom.W - geom.padRight}
                  y2={y}
                  stroke={val === 0 ? '#CBD5E1' : '#F1F5F9'}
                  strokeDasharray={val === 0 ? undefined : '4 4'}
                  strokeWidth="1"
                />
                <text
                  x={geom.padLeft - 8}
                  y={y + 3.5}
                  textAnchor="end"
                  className="fill-slate-400 text-[10.5px] tabular-nums"
                >
                  {typeof val === 'number' ? val.toLocaleString('vi-VN') : val}
                </text>
              </g>
            );
          })}

          {/* Đường so sánh kỳ trước (nét đứt) */}
          {compareEnabled &&
            geom.prevCurves.linePaths.map((d, i) => (
              <path
                key={`prl-${i}`}
                d={d}
                fill="none"
                stroke="#64748B"
                strokeOpacity={0.55}
                strokeDasharray="5 4"
                strokeWidth="2"
                strokeLinecap="round"
              />
            ))}

          {/* Lớp phụ: Lượt xem trang (khi ở chế độ combo) */}
          {mode === 'combo' && (
            <>
              {geom.pvCurves.areaPaths.map((d, i) => (
                <path key={`pva-${i}`} d={d} fill={`url(#${pvGradId})`} />
              ))}
              {geom.pvCurves.linePaths.map((d, i) => (
                <path
                  key={`pvl-${i}`}
                  d={d}
                  fill="none"
                  stroke="#0EA5E9"
                  strokeWidth="2"
                  strokeDasharray="5 3"
                  strokeLinecap="round"
                />
              ))}
            </>
          )}

          {/* Lớp chính: Phiên truy cập (hoặc User mới / Trang/Phiên) */}
          {geom.sessionCurves.areaPaths.map((d, i) => (
            <path key={`sa-${i}`} d={d} fill={`url(#${sessGradId})`} />
          ))}
          {geom.sessionCurves.linePaths.map((d, i) => (
            <path
              key={`sl-${i}`}
              d={d}
              fill="none"
              stroke={mode === 'newUsers' ? '#059669' : '#1E3A8A'}
              strokeWidth="2.8"
              strokeLinecap="round"
            />
          ))}

          {/* Crosshair khi rê chuột */}
          {activeNode && (
            <line
              x1={activeNode.x}
              y1={geom.padTop}
              x2={activeNode.x}
              y2={geom.baselineY}
              stroke="#94A3B8"
              strokeDasharray="3 3"
              strokeWidth="1.2"
            />
          )}

          {/* Điểm nút dữ liệu + Nhãn trục X + Vùng bắt hover rộng */}
          {geom.nodes.map((n, idx) => {
            const xStep = Math.max(1, Math.ceil(geom.nodes.length / 8));
            const isLast = idx === geom.nodes.length - 1;
            const tooCloseToLast = !isLast && geom.nodes.length - 1 - idx < Math.max(2, Math.ceil(xStep * 0.65));
            const showXLabel =
              geom.nodes.length <= 10 ||
              idx === 0 ||
              isLast ||
              (idx % xStep === 0 && !tooCloseToLast);
            const isHovered = hoverIdx === idx;
            const mainY =
              mode === 'depth'
                ? n.yDepth
                : mode === 'newUsers'
                  ? n.yNewUsers
                  : n.ySession;
            const mainColor = mode === 'newUsers' ? '#059669' : '#1E3A8A';
            const hitWidth = Math.max(12, (geom.W - geom.padLeft - geom.padRight) / Math.max(1, geom.nodes.length));

            return (
              <g key={n.date}>
                {n.isMissingData ? (
                  <circle
                    cx={n.x}
                    cy={geom.baselineY}
                    r={isHovered ? 4 : 2.5}
                    fill="#F8FAFC"
                    stroke="#CBD5E1"
                    strokeWidth="1.5"
                  />
                ) : (
                  <>
                    {mode === 'combo' && (
                      <circle
                        cx={n.x}
                        cy={n.yPv}
                        r={isHovered ? 4.5 : 2.8}
                        fill="#FFFFFF"
                        stroke="#0EA5E9"
                        strokeWidth="2"
                      />
                    )}
                    <circle
                      cx={n.x}
                      cy={mainY}
                      r={isHovered ? 5.5 : 3.5}
                      fill={isHovered ? mainColor : '#FFFFFF'}
                      stroke={mainColor}
                      strokeWidth="2.4"
                    />
                  </>
                )}

                {showXLabel && (
                  <text
                    x={n.x}
                    y={geom.baselineY + 18}
                    textAnchor="middle"
                    className={`text-[10.5px] tabular-nums ${
                      isHovered ? 'fill-slate-900 font-bold' : 'fill-slate-500'
                    }`}
                  >
                    {n.label}
                  </text>
                )}

                <rect
                  x={n.x - hitWidth / 2}
                  y={geom.padTop}
                  width={hitWidth}
                  height={geom.innerH + 22}
                  fill="transparent"
                  className="cursor-crosshair"
                  onMouseEnter={() => setHoverIdx(idx)}
                />
              </g>
            );
          })}
        </svg>
      </div>

      {/* Chú giải trực quan */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100 text-[11px] text-slate-500">
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
            <span
              className={`w-3 h-1 rounded-full ${
                mode === 'newUsers' ? 'bg-emerald-600' : 'bg-[#1E3A8A]'
              }`}
            />
            {mode === 'depth'
              ? 'Số trang xem trung bình / phiên'
              : mode === 'newUsers'
                ? 'Người dùng mới (GA4)'
                : 'Phiên truy cập thực tế (GA4)'}
          </span>
          {mode === 'combo' && (
            <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
              <span className="w-3 h-0.5 border-t-2 border-dashed border-sky-500" />
              Lượt xem trang (Pageviews)
            </span>
          )}
          {compareEnabled && (
            <span className="inline-flex items-center gap-1.5 font-medium text-slate-600">
              <span className="w-3 h-0.5 border-t-2 border-dashed border-slate-500" />
              Kỳ liền trước
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full border border-slate-300 bg-slate-50" />
            Ngày chưa phát sinh / chưa đồng bộ
          </span>
        </div>
        <span>Rê chuột vào từng ngày trên biểu đồ để xem chi tiết</span>
      </div>
    </div>
  );
}

const CHANNEL_PALETTE = [
  { bar: 'bg-emerald-500', dot: 'bg-emerald-500', pill: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  { bar: 'bg-blue-600', dot: 'bg-blue-600', pill: 'bg-blue-50 text-blue-800 border-blue-200' },
  { bar: 'bg-indigo-500', dot: 'bg-indigo-500', pill: 'bg-indigo-50 text-indigo-800 border-indigo-200' },
  { bar: 'bg-amber-500', dot: 'bg-amber-500', pill: 'bg-amber-50 text-amber-800 border-amber-200' },
  { bar: 'bg-violet-500', dot: 'bg-violet-500', pill: 'bg-violet-50 text-violet-800 border-violet-200' },
  { bar: 'bg-slate-400', dot: 'bg-slate-400', pill: 'bg-slate-100 text-slate-700 border-slate-200' },
];

export function MarketingChannelMixCard({ channels }: { channels: M02ChannelRowDto[] }) {
  const totalSessions = useMemo(
    () => channels.reduce((s, c) => s + (c.sessions || 0), 0),
    [channels],
  );

  if (channels.length === 0) {
    return (
      <div className="py-12 text-center text-xs text-slate-400">
        Chưa có dữ liệu phân bổ kênh trong khoảng ngày đang chọn.
      </div>
    );
  }

  return (
    <div className="space-y-3.5">
      {/* Thanh Stacked Bar tỷ trọng kênh tổng thể chuẩn Marketing */}
      {totalSessions > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <span>Tỷ trọng đóng góp lưu lượng theo kênh</span>
            <strong className="text-slate-800 tabular-nums">{totalSessions.toLocaleString('vi-VN')} phiên</strong>
          </div>
          <div className="h-3 w-full rounded-full bg-slate-100 overflow-hidden flex gap-0.5 p-0.5">
            {channels.slice(0, 6).map((ch, idx) => {
              const pct = totalSessions > 0 ? (ch.sessions / totalSessions) * 100 : 0;
              if (pct <= 0) return null;
              const pal = CHANNEL_PALETTE[idx % CHANNEL_PALETTE.length];
              return (
                <div
                  key={`mix-${ch.channelKey}`}
                  style={{ width: `${Math.max(2, pct)}%` }}
                  title={`${ch.channelLabel}: ${pct.toFixed(1)}%`}
                  className={`h-full first:rounded-l-full last:rounded-r-full ${pal.bar}`}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Danh sách chi tiết hiệu suất từng kênh */}
      <div className="space-y-2.5">
        {channels.slice(0, 6).map((ch, idx) => {
          const sharePct =
            totalSessions > 0 ? Number(((ch.sessions / totalSessions) * 100).toFixed(1)) : 0;
          const pal = CHANNEL_PALETTE[idx % CHANNEL_PALETTE.length];
          return (
            <div
              key={ch.channelKey}
              className="rounded-xl border border-slate-200/80 p-2.5 hover:bg-slate-50/70 transition space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${pal.dot}`} />
                  <span className="font-bold text-slate-900 truncate">{ch.channelLabel}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="font-bold text-slate-900 tabular-nums">
                    {ch.sessions.toLocaleString('vi-VN')}
                  </span>
                  <span className="text-[11px] text-slate-500 tabular-nums">({sharePct}%)</span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                <span>
                  Tương tác:{' '}
                  <strong className="text-slate-700 tabular-nums">
                    {ch.engagementRatePct !== null ? `${ch.engagementRatePct}%` : '—'}
                  </strong>
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full border font-semibold tabular-nums ${
                    ch.validLeadCount > 0 ? pal.pill : 'bg-slate-50 text-slate-500 border-slate-200'
                  }`}
                >
                  {ch.validLeadCount} Lead hợp lệ
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
