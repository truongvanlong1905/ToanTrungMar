'use client';

import React, { useEffect, useId, useMemo, useState } from 'react';

export interface StockChartPoint {
  date: string;
  value: number | null;
  isMissingData?: boolean;
  isPreliminary?: boolean;
}

interface StockAreaChartProps {
  points: StockChartPoint[];
  metricLabel: string;
  accentColor?: 'blue' | 'emerald';
  loading?: boolean;
}

export function StockAreaChart({
  points,
  metricLabel,
  accentColor = 'blue',
  loading = false,
}: StockAreaChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const chartUid = useId().replace(/:/g, '');

  useEffect(() => {
    setHoverIdx(null);
  }, [points]);

  const width = 760;
  const height = 240;
  const padLeft = 56;
  const padRight = 22;
  const padTop = 26;
  const padBottom = 32;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const palette =
    accentColor === 'emerald'
      ? {
          stroke: '#059669',
          gradStart: 'rgba(16, 185, 129, 0.28)',
          gradEnd: 'rgba(16, 185, 129, 0.02)',
          dot: '#059669',
        }
      : {
          stroke: '#2563EB',
          gradStart: 'rgba(37, 99, 235, 0.28)',
          gradEnd: 'rgba(37, 99, 235, 0.02)',
          dot: '#2563EB',
        };

  const { maxVal, coords, linePath, areaPath, yTicks } = useMemo(() => {
    const validVals = points.map((p) => (p.value !== null ? p.value : 0));
    const rawMax = Math.max(1, ...validVals);
    const niceMax = rawMax <= 10 ? Math.max(4, rawMax) : Math.ceil(rawMax * 1.12);
    const n = points.length;

    const pts = points.map((p, i) => {
      const x = n <= 1 ? padLeft + plotW / 2 : padLeft + (i / (n - 1)) * plotW;
      const v = p.value ?? 0;
      const y = padTop + plotH - (v / niceMax) * plotH;
      return { ...p, x, y, i };
    });

    const segments: string[] = [];
    const areaSegments: string[] = [];
    let currentLine: typeof pts = [];

    const flushSegment = () => {
      if (currentLine.length === 0) return;
      const d = currentLine.map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' ');
      segments.push(d);
      if (currentLine.length >= 2) {
        const first = currentLine[0];
        const last = currentLine[currentLine.length - 1];
        const baseY = (padTop + plotH).toFixed(1);
        areaSegments.push(`${d} L ${last.x.toFixed(1)} ${baseY} L ${first.x.toFixed(1)} ${baseY} Z`);
      }
      currentLine = [];
    };

    for (const pt of pts) {
      if (pt.isMissingData || pt.value === null) {
        flushSegment();
      } else {
        currentLine.push(pt);
      }
    }
    flushSegment();

    const ticks = [1, 0.75, 0.5, 0.25, 0].map((ratio) => ({
      ratio,
      val: Math.round(niceMax * ratio),
      y: padTop + plotH * (1 - ratio),
    }));

    return {
      maxVal: niceMax,
      coords: pts,
      linePath: segments.join(' '),
      areaPath: areaSegments.join(' '),
      yTicks: ticks,
    };
  }, [points, plotW, plotH]);

  if (loading && points.length === 0) {
    return (
      <div className="h-[265px] flex items-center justify-center text-xs text-slate-400">
        Đang tải biểu đồ...
      </div>
    );
  }

  if (points.length === 0) {
    return (
      <div className="h-[265px] flex items-center justify-center text-xs text-slate-400">
        Chưa đủ dữ liệu
      </div>
    );
  }

  const gradId = `stockGrad-${accentColor}-${chartUid}`;
  const activePt = hoverIdx !== null ? coords[hoverIdx] : null;
  const prevPt = hoverIdx !== null && hoverIdx > 0 ? coords[hoverIdx - 1] : null;
  const deltaPct =
    activePt &&
    activePt.value !== null &&
    prevPt &&
    prevPt.value !== null &&
    prevPt.value > 0
      ? ((activePt.value - prevPt.value) / prevPt.value) * 100
      : null;

  const showAllLabels = coords.length <= 14;
  const xStep = coords.length <= 10 ? 1 : coords.length <= 20 ? 2 : 5;

  return (
    <div className="relative w-full h-[265px] select-none">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-full overflow-visible"
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={palette.gradStart} />
            <stop offset="100%" stopColor={palette.gradEnd} />
          </linearGradient>
        </defs>

        {/* Horizontal gridlines + Y-axis ticks */}
        {yTicks.map((t) => (
          <g key={t.ratio}>
            <line
              x1={padLeft}
              y1={t.y}
              x2={width - padRight}
              y2={t.y}
              stroke="#E2E8F0"
              strokeDasharray={t.ratio === 0 ? undefined : '4 4'}
              strokeWidth={1}
            />
            <text
              x={padLeft - 8}
              y={t.y + 3.5}
              textAnchor="end"
              fontSize="10.5"
              fill="#64748B"
              fontWeight={500}
            >
              {t.val.toLocaleString('vi-VN')}
            </text>
          </g>
        ))}

        {/* Area fill */}
        {areaPath && <path d={areaPath} fill={`url(#${gradId})`} />}

        {/* Main stock line */}
        {linePath && (
          <path
            d={linePath}
            fill="none"
            stroke={palette.stroke}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Crosshair on hover */}
        {activePt && (
          <line
            x1={activePt.x}
            y1={padTop}
            x2={activePt.x}
            y2={padTop + plotH}
            stroke="#94A3B8"
            strokeDasharray="3 3"
            strokeWidth={1.2}
          />
        )}

        {/* Data points + value labels + X-axis dates */}
        {coords.map((pt, idx) => {
          const isHovered = hoverIdx === idx;
          const isMissing = pt.isMissingData || pt.value === null;
          const showVal = showAllLabels || isHovered || pt.value === maxVal;

          return (
            <g key={pt.date}>
              {/* Invisible wide hit target for smooth hover */}
              <rect
                x={pt.x - plotW / Math.max(1, coords.length) / 2}
                y={padTop}
                width={Math.max(16, plotW / Math.max(1, coords.length))}
                height={plotH + padBottom}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(idx)}
              />

              {isMissing ? (
                <circle
                  cx={pt.x}
                  cy={padTop + plotH - 4}
                  r={4}
                  fill="#F1F5F9"
                  stroke="#94A3B8"
                  strokeDasharray="2 2"
                  strokeWidth={1.5}
                />
              ) : (
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={isHovered ? 5.5 : 3.5}
                  fill={pt.isPreliminary ? '#F59E0B' : '#FFFFFF'}
                  stroke={pt.isPreliminary ? '#D97706' : palette.dot}
                  strokeWidth={isHovered ? 3 : 2}
                />
              )}

              {showVal && !isMissing && pt.value !== null && (
                <text
                  x={pt.x}
                  y={Math.max(13, pt.y - 9)}
                  textAnchor="middle"
                  fontSize="10.5"
                  fontWeight={700}
                  fill="#0F172A"
                >
                  {pt.value.toLocaleString('vi-VN')}
                </text>
              )}

              {(idx % xStep === 0 || idx === coords.length - 1) && (
                <text
                  x={pt.x}
                  y={height - 10}
                  textAnchor="middle"
                  fontSize="10"
                  fill={isHovered ? '#0F172A' : '#64748B'}
                  fontWeight={isHovered ? 700 : 500}
                >
                  {pt.date.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Floating Stock Tooltip */}
      {activePt && (
        <div
          className="pointer-events-none absolute top-1 z-10 rounded-xl bg-slate-900/95 px-3 py-2 text-xs text-white shadow-lg border border-slate-700"
          style={{
            left: `${Math.min(72, Math.max(8, (activePt.x / width) * 100))}%`,
          }}
        >
          <div className="text-[10px] text-slate-300 font-medium">{activePt.date}</div>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="font-bold text-sm">
              {activePt.isMissingData || activePt.value === null
                ? 'Thiếu dữ liệu'
                : `${activePt.value.toLocaleString('vi-VN')} ${metricLabel}`}
            </span>
            {deltaPct !== null && (
              <span
                className={`text-[11px] font-bold ${
                  deltaPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {deltaPct >= 0 ? `+${deltaPct.toFixed(1)}% ▲` : `${deltaPct.toFixed(1)}% ▼`}
              </span>
            )}
          </div>
          {activePt.isPreliminary && (
            <div className="text-[10px] text-amber-300 mt-0.5">Số liệu trong ngày còn sơ bộ</div>
          )}
        </div>
      )}
    </div>
  );
}

