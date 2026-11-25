'use client';

import React, { useMemo, useState } from 'react';
import { formatSafePeriodComparison, type M03SeoDailyPointDto } from '@toantrung/contracts';
import { Check } from 'lucide-react';

type GscSeriesKey = 'clicks' | 'impressions' | 'ctrPct' | 'averagePosition';

interface GscMetricCardDef {
  key: GscSeriesKey;
  label: string;
  color: string;
  bgActive: string;
  borderTop: string;
  format: (v: number | null | undefined) => string;
}

const GSC_CARDS: GscMetricCardDef[] = [
  {
    key: 'clicks',
    label: 'Tổng số lượt nhấp',
    color: '#1A73E8',
    bgActive: 'bg-blue-50/70',
    borderTop: 'border-t-[#1A73E8]',
    format: (v) => (v === null || v === undefined ? '—' : v.toLocaleString('vi-VN')),
  },
  {
    key: 'impressions',
    label: 'Tổng số lượt hiển thị',
    color: '#7E22CE',
    bgActive: 'bg-purple-50/70',
    borderTop: 'border-t-[#7E22CE]',
    format: (v) => (v === null || v === undefined ? '—' : v.toLocaleString('vi-VN')),
  },
  {
    key: 'ctrPct',
    label: 'CTR trung bình',
    color: '#0F766E',
    bgActive: 'bg-teal-50/70',
    borderTop: 'border-t-[#0F766E]',
    format: (v) => (v === null || v === undefined ? '—' : `${v.toFixed(2)}%`),
  },
  {
    key: 'averagePosition',
    label: 'Vị trí trung bình',
    color: '#D97706',
    bgActive: 'bg-amber-50/70',
    borderTop: 'border-t-[#D97706]',
    format: (v) => (v === null || v === undefined ? '—' : v.toFixed(1)),
  },
];

function buildPath(pts: Array<{ x: number; y: number | null }>): string {
  let d = '';
  let penUp = true;
  for (const p of pts) {
    if (p.y === null || !Number.isFinite(p.y)) {
      penUp = true;
      continue;
    }
    d += `${penUp ? 'M' : ' L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)} `;
    penUp = false;
  }
  return d.trim();
}

export interface GscPerformanceChartProps {
  clicks: number | null;
  impressions: number | null;
  ctrPct: number | null;
  avgPosition: number | null;
  previousClicks: number | null;
  previousImpressions: number | null;
  series: M03SeoDailyPointDto[];
  previousSeries?: M03SeoDailyPointDto[];
  compareEnabled?: boolean;
  loading?: boolean;
}

export function GscPerformanceChart({
  clicks,
  impressions,
  ctrPct,
  avgPosition,
  previousClicks,
  previousImpressions,
  series,
  previousSeries,
  compareEnabled = false,
  loading = false,
}: GscPerformanceChartProps) {
  const [activeKeys, setActiveKeys] = useState<GscSeriesKey[]>(['clicks', 'impressions']);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const toggleKey = (key: GscSeriesKey) => {
    setActiveKeys((prev) => {
      if (prev.includes(key)) {
        return prev.length <= 1 ? prev : prev.filter((k) => k !== key);
      }
      return [...prev, key];
    });
  };

  const clicksComp = formatSafePeriodComparison(clicks, previousClicks);
  const imprComp = formatSafePeriodComparison(impressions, previousImpressions);

  const cardValues: Record<GscSeriesKey, { val: number | null; hint: string }> = {
    clicks: { val: clicks, hint: `So kỳ trước: ${clicksComp.label}` },
    impressions: { val: impressions, hint: `So kỳ trước: ${imprComp.label}` },
    ctrPct: { val: ctrPct, hint: 'Click / Hiển thị tự nhiên' },
    averagePosition: { val: avgPosition, hint: 'Hạng càng nhỏ càng tốt (#1 trên cùng)' },
  };

  const width = 820;
  const height = 250;
  const padLeft = 52;
  const padRight = activeKeys.length > 1 ? 52 : 20;
  const padTop = 20;
  const padBottom = 30;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const baselineY = padTop + plotH;

  const primaryKey = activeKeys[0] || 'clicks';
  const secondaryKey = activeKeys[1] || null;

  const computed = useMemo(() => {
    const n = series.length;
    const scaleFor = (key: GscSeriesKey) => {
      const vals: number[] = [];
      for (let i = 0; i < n; i += 1) {
        const v = series[i]?.[key];
        if (typeof v === 'number' && Number.isFinite(v)) vals.push(v);
        const pv = compareEnabled ? previousSeries?.[i]?.[key] : null;
        if (typeof pv === 'number' && Number.isFinite(pv)) vals.push(pv);
      }
      if (key === 'averagePosition') {
        const maxPos = Math.max(10, Math.ceil(Math.max(1, ...vals) * 1.15));
        return {
          min: 1,
          max: maxPos,
          toY: (val: number | null | undefined) => {
            if (val === null || val === undefined || !Number.isFinite(val)) return null;
            const clamped = Math.max(1, Math.min(maxPos, val));
            // Vị trí #1 ở trên cùng (padTop), hạng thấp hơn nằm dưới (baselineY)
            return padTop + ((clamped - 1) / Math.max(1, maxPos - 1)) * plotH;
          },
        };
      }
      const rawMax = Math.max(1, ...vals);
      const niceMax =
        key === 'ctrPct'
          ? Math.max(2, Math.ceil(rawMax * 1.15))
          : rawMax <= 5
            ? Math.max(4, Math.ceil(rawMax))
            : Math.ceil(rawMax * 1.15);
      return {
        min: 0,
        max: niceMax,
        toY: (val: number | null | undefined) => {
          if (val === null || val === undefined || !Number.isFinite(val)) return null;
          return baselineY - (Math.min(niceMax, Math.max(0, val)) / niceMax) * plotH;
        },
      };
    };

    const scales = new Map<GscSeriesKey, ReturnType<typeof scaleFor>>();
    for (const k of activeKeys) {
      scales.set(k, scaleFor(k));
    }

    const xs = series.map((_, i) =>
      n <= 1 ? padLeft + plotW / 2 : padLeft + (i / (n - 1)) * plotW,
    );

    const seriesLines = activeKeys.map((k) => {
      const sc = scales.get(k)!;
      const meta = GSC_CARDS.find((c) => c.key === k)!;
      const mainPts = series.map((pt, i) => ({
        x: xs[i],
        y: sc.toY(pt[k]),
        isPrelim: pt.completenessState === 'PRELIMINARY' || pt.completenessState === 'UNKNOWN',
      }));
      const prevPts = compareEnabled && previousSeries
        ? series.map((_, i) => ({
            x: xs[i],
            y: sc.toY(previousSeries[i]?.[k]),
          }))
        : [];
      return {
        key: k,
        meta,
        scale: sc,
        mainPath: buildPath(mainPts),
        prevPath: buildPath(prevPts),
        mainPts,
      };
    });

    const pScale = scales.get(primaryKey)!;
    const sScale = secondaryKey ? scales.get(secondaryKey)! : null;
    const yTicks = [1, 0.66, 0.33, 0].map((ratio) => {
      const y = padTop + plotH * (1 - ratio);
      const valP =
        primaryKey === 'averagePosition'
          ? pScale.min + (1 - ratio) * (pScale.max - pScale.min)
          : pScale.max * ratio;
      const valS = sScale
        ? secondaryKey === 'averagePosition'
          ? sScale.min + (1 - ratio) * (sScale.max - sScale.min)
          : sScale.max * ratio
        : null;
      return { ratio, y, valP, valS };
    });

    return { xs, seriesLines, yTicks };
  }, [series, previousSeries, compareEnabled, activeKeys, primaryKey, secondaryKey, padLeft, plotW, plotH, baselineY]);

  const activePt = hoverIdx !== null ? series[hoverIdx] : null;
  const activePrevPt = hoverIdx !== null && compareEnabled ? previousSeries?.[hoverIdx] : null;
  const activeX = hoverIdx !== null ? computed.xs[hoverIdx] : 0;
  const hitWidth = Math.max(10, plotW / Math.max(1, series.length));

  const formatAxisVal = (key: GscSeriesKey, val: number) => {
    if (key === 'ctrPct') return `${val.toFixed(1)}%`;
    if (key === 'averagePosition') return `#${Math.round(val)}`;
    return val >= 1000 ? `${(val / 1000).toFixed(1)}K` : String(Math.round(val));
  };

  return (
    <section className="bg-white border border-slate-200/90 rounded-2xl shadow-2xs overflow-hidden">
      {/* 4 Thẻ KPI có thể bấm Bật/Tắt từng đường biểu đồ kiểu Google Search Console */}
      <div className="grid grid-cols-2 lg:grid-cols-4 border-b border-slate-200 divide-y lg:divide-y-0 divide-x divide-slate-200">
        {GSC_CARDS.map((card) => {
          const isOn = activeKeys.includes(card.key);
          const info = cardValues[card.key];
          return (
            <button
              key={card.key}
              type="button"
              aria-pressed={isOn}
              onClick={() => toggleKey(card.key)}
              className={`text-left p-4 transition-all border-t-4 ${
                isOn ? `${card.borderTop} ${card.bgActive}` : 'border-t-transparent bg-white hover:bg-slate-50/80'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-700">{card.label}</span>
                <span
                  className="w-4 h-4 rounded-sm grid place-items-center border transition-colors shrink-0"
                  style={{
                    backgroundColor: isOn ? card.color : '#FFFFFF',
                    borderColor: isOn ? card.color : '#CBD5E1',
                  }}
                >
                  {isOn && <Check className="w-3 h-3 text-white stroke-[3]" />}
                </span>
              </div>
              <div className="mt-1.5 text-2xl font-bold text-slate-900 tabular-nums">
                {card.format(info.val)}
              </div>
              <div className="mt-1 text-[11px] text-slate-500 truncate">{info.hint}</div>
            </button>
          );
        })}
      </div>

      {/* Biểu đồ SVG đa đường GSC */}
      <div className="p-4 space-y-2">
        {loading && series.length === 0 ? (
          <div className="h-[250px] rounded-xl bg-slate-50 animate-pulse" />
        ) : series.length === 0 ? (
          <div className="h-[230px] rounded-xl bg-slate-50 border border-dashed border-slate-200 grid place-items-center text-xs text-slate-500">
            Chưa có dữ liệu Search Console theo ngày trong kỳ đang chọn.
          </div>
        ) : (
          <div className="relative select-none">
            {activePt && (
              <div
                className="pointer-events-none absolute top-1 z-20 rounded-xl bg-slate-900/95 text-white px-3 py-2 text-xs shadow-xl border border-slate-700 space-y-1 min-w-[215px]"
                style={{
                  left: activeX > width * 0.6 ? 'auto' : `${Math.max(6, (activeX / width) * 100)}%`,
                  right: activeX > width * 0.6 ? `${Math.max(4, ((width - activeX) / width) * 100)}%` : 'auto',
                }}
              >
                <div className="font-bold text-sky-300 border-b border-white/10 pb-1 flex items-center justify-between gap-2">
                  <span>{activePt.date}</span>
                  {(activePt.completenessState === 'PRELIMINARY' ||
                    activePt.completenessState === 'UNKNOWN') && (
                    <span className="text-[10px] text-amber-300">Sơ bộ</span>
                  )}
                </div>
                {activeKeys.map((k) => {
                  const meta = GSC_CARDS.find((c) => c.key === k)!;
                  const val = activePt[k];
                  const prevVal = activePrevPt?.[k];
                  return (
                    <div key={k} className="space-y-0.5">
                      <div className="flex items-center justify-between gap-4">
                        <span className="inline-flex items-center gap-1.5 text-slate-200">
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: meta.color }}
                          />
                          {meta.label}:
                        </span>
                        <strong className="tabular-nums font-bold">{meta.format(val)}</strong>
                      </div>
                      {compareEnabled && prevVal !== null && prevVal !== undefined && (
                        <div className="flex items-center justify-between gap-4 text-[10px] text-slate-400 pl-3.5">
                          <span>Kỳ trước ({activePrevPt?.date}):</span>
                          <span className="tabular-nums">{meta.format(prevVal)}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="w-full h-[250px] overflow-visible"
              onMouseLeave={() => setHoverIdx(null)}
              role="img"
              aria-label="Biểu đồ hiệu suất Google Search Console"
            >
              {computed.yTicks.map((t, i) => {
                const pColor = GSC_CARDS.find((c) => c.key === primaryKey)!.color;
                const sColor = secondaryKey
                  ? GSC_CARDS.find((c) => c.key === secondaryKey)!.color
                  : undefined;
                return (
                  <g key={i}>
                    <line
                      x1={padLeft}
                      y1={t.y}
                      x2={width - padRight}
                      y2={t.y}
                      stroke={t.ratio === 0 ? '#CBD5E1' : '#F1F5F9'}
                      strokeWidth={1}
                    />
                    <text
                      x={padLeft - 8}
                      y={t.y + 3.5}
                      textAnchor="end"
                      fontSize="10"
                      fontWeight={600}
                      fill={pColor}
                    >
                      {formatAxisVal(primaryKey, t.valP)}
                    </text>
                    {secondaryKey && t.valS !== null && sColor && (
                      <text
                        x={width - padRight + 8}
                        y={t.y + 3.5}
                        textAnchor="start"
                        fontSize="10"
                        fontWeight={600}
                        fill={sColor}
                      >
                        {formatAxisVal(secondaryKey, t.valS)}
                      </text>
                    )}
                  </g>
                );
              })}

              {computed.seriesLines.map((line) => (
                <g key={line.key}>
                  {line.prevPath && (
                    <path
                      d={line.prevPath}
                      fill="none"
                      stroke={line.meta.color}
                      strokeOpacity={0.35}
                      strokeDasharray="5 4"
                      strokeWidth={1.8}
                    />
                  )}
                  {line.mainPath && (
                    <path
                      d={line.mainPath}
                      fill="none"
                      stroke={line.meta.color}
                      strokeWidth={2.4}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                </g>
              ))}

              {hoverIdx !== null && (
                <line
                  x1={activeX}
                  y1={padTop}
                  x2={activeX}
                  y2={baselineY}
                  stroke="#94A3B8"
                  strokeDasharray="3 3"
                  strokeWidth={1.2}
                />
              )}

              {series.map((pt, idx) => {
                const x = computed.xs[idx];
                const isHovered = hoverIdx === idx;
                const showXLabel =
                  series.length <= 12 ||
                  idx === 0 ||
                  idx === series.length - 1 ||
                  idx % Math.ceil(series.length / 8) === 0;
                return (
                  <g key={pt.date}>
                    {computed.seriesLines.map((line) => {
                      const mp = line.mainPts[idx];
                      if (mp?.y === null || mp?.y === undefined) return null;
                      return (
                        <circle
                          key={`${line.key}-${idx}`}
                          cx={x}
                          cy={mp.y}
                          r={isHovered ? 4.8 : mp.isPrelim ? 3 : 2}
                          fill={mp.isPrelim ? '#F59E0B' : isHovered ? line.meta.color : '#FFFFFF'}
                          stroke={mp.isPrelim ? '#D97706' : line.meta.color}
                          strokeWidth={isHovered ? 2.4 : 1.5}
                        />
                      );
                    })}
                    {showXLabel && (
                      <text
                        x={x}
                        y={baselineY + 18}
                        textAnchor="middle"
                        className={`text-[10px] tabular-nums ${
                          isHovered ? 'fill-slate-900 font-bold' : 'fill-slate-500'
                        }`}
                      >
                        {pt.date.slice(8, 10)}/{pt.date.slice(5, 7)}
                      </text>
                    )}
                    <rect
                      x={x - hitWidth / 2}
                      y={padTop}
                      width={hitWidth}
                      height={plotH + 22}
                      fill="transparent"
                      className="cursor-crosshair"
                      onMouseEnter={() => setHoverIdx(idx)}
                    />
                  </g>
                );
              })}
            </svg>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500">
          <span>Chọn thẻ phía trên để bật hoặc tắt từng đường chỉ số</span>
          <span>Điểm vàng: dữ liệu sơ bộ · Nét đứt: kỳ trước</span>
        </div>
      </div>
    </section>
  );
}
