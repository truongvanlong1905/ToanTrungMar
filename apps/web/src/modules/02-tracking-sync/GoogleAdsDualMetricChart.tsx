'use client';

import React, { useMemo, useState } from 'react';
import type { M02AdsSectionDto } from '@toantrung/contracts';

type AdsSeriesPoint = NonNullable<M02AdsSectionDto['series']>[number];
export type AdsChartMetricKey =
  | 'cost'
  | 'clicks'
  | 'impressions'
  | 'conversions'
  | 'ctrPct'
  | 'avgCpc';

interface MetricMeta {
  key: AdsChartMetricKey;
  label: string;
  format: (v: number | null | undefined) => string;
  axisFormat: (v: number) => string;
}

const METRIC_META: Record<AdsChartMetricKey, MetricMeta> = {
  cost: {
    key: 'cost',
    label: 'Chi phí',
    format: (v) =>
      v === null || v === undefined ? '—' : `${Math.round(v).toLocaleString('vi-VN')} ₫`,
    axisFormat: (v) =>
      v >= 1_000_000
        ? `${(v / 1_000_000).toFixed(1)}Tr`
        : v >= 1_000
          ? `${Math.round(v / 1_000)}K`
          : `${Math.round(v)}`,
  },
  clicks: {
    key: 'clicks',
    label: 'Lượt nhấp',
    format: (v) =>
      v === null || v === undefined ? '—' : Math.round(v).toLocaleString('vi-VN'),
    axisFormat: (v) => Math.round(v).toLocaleString('vi-VN'),
  },
  impressions: {
    key: 'impressions',
    label: 'Lượt hiển thị',
    format: (v) =>
      v === null || v === undefined ? '—' : Math.round(v).toLocaleString('vi-VN'),
    axisFormat: (v) =>
      v >= 1_000 ? `${(v / 1_000).toFixed(1)}K` : Math.round(v).toLocaleString('vi-VN'),
  },
  conversions: {
    key: 'conversions',
    label: 'Chuyển đổi',
    format: (v) =>
      v === null || v === undefined
        ? '—'
        : Number.isInteger(v)
          ? v.toLocaleString('vi-VN')
          : v.toFixed(2),
    axisFormat: (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1)),
  },
  ctrPct: {
    key: 'ctrPct',
    label: 'CTR (%)',
    format: (v) => (v === null || v === undefined ? '—' : `${v.toFixed(2)}%`),
    axisFormat: (v) => `${v.toFixed(1)}%`,
  },
  avgCpc: {
    key: 'avgCpc',
    label: 'CPC trung bình',
    format: (v) =>
      v === null || v === undefined ? '—' : `${Math.round(v).toLocaleString('vi-VN')} ₫`,
    axisFormat: (v) =>
      v >= 1_000 ? `${Math.round(v / 1_000)}K` : `${Math.round(v)}`,
  },
};

function readMetricVal(pt: AdsSeriesPoint | undefined, key: AdsChartMetricKey): number | null {
  if (!pt) return null;
  if (key === 'cost') return pt.cost ?? null;
  if (key === 'clicks') return pt.clicks ?? null;
  if (key === 'impressions') return pt.impressions ?? null;
  if (key === 'conversions') return pt.conversions ?? null;
  if (key === 'ctrPct') {
    if (pt.ctrPct !== undefined && pt.ctrPct !== null) return pt.ctrPct;
    if (pt.impressions && pt.impressions > 0 && pt.clicks !== null) {
      return Number(((pt.clicks / pt.impressions) * 100).toFixed(2));
    }
    return null;
  }
  if (key === 'avgCpc') {
    if (pt.avgCpc !== undefined && pt.avgCpc !== null) return pt.avgCpc;
    if (pt.clicks && pt.clicks > 0 && pt.cost !== null) {
      return Math.round(pt.cost / pt.clicks);
    }
    return null;
  }
  return null;
}

function buildLinearPath(pts: Array<{ x: number; y: number | null }>): string {
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

export interface GoogleAdsDualMetricChartProps {
  series: NonNullable<M02AdsSectionDto['series']>;
  previousSeries?: M02AdsSectionDto['previousSeries'];
  compareEnabled?: boolean;
  adsConnected: boolean;
  loading?: boolean;
}

export function GoogleAdsDualMetricChart({
  series,
  previousSeries,
  compareEnabled = false,
  adsConnected,
  loading = false,
}: GoogleAdsDualMetricChartProps) {
  const [leftMetric, setLeftMetric] = useState<AdsChartMetricKey>('cost');
  const [rightMetric, setRightMetric] = useState<AdsChartMetricKey | 'none'>('clicks');
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const width = 820;
  const height = 236;
  const padLeft = 58;
  const padRight = rightMetric !== 'none' ? 54 : 20;
  const padTop = 20;
  const padBottom = 30;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const baselineY = padTop + plotH;

  const leftMeta = METRIC_META[leftMetric];
  const rightMeta = rightMetric !== 'none' ? METRIC_META[rightMetric] : null;

  const geom = useMemo(() => {
    const n = series.length;
    const leftVals: number[] = [];
    const rightVals: number[] = [];
    for (let i = 0; i < n; i += 1) {
      const lv = readMetricVal(series[i], leftMetric);
      if (lv !== null) leftVals.push(lv);
      if (rightMetric !== 'none') {
        const rv = readMetricVal(series[i], rightMetric);
        if (rv !== null) rightVals.push(rv);
      }
      if (compareEnabled && previousSeries?.[i]) {
        const plv = readMetricVal(previousSeries[i], leftMetric);
        if (plv !== null) leftVals.push(plv);
        if (rightMetric !== 'none') {
          const prv = readMetricVal(previousSeries[i], rightMetric);
          if (prv !== null) rightVals.push(prv);
        }
      }
    }

    const rawMaxL = Math.max(1, ...leftVals);
    const maxL = rawMaxL <= 5 ? Math.max(4, Math.ceil(rawMaxL)) : Math.ceil(rawMaxL * 1.15);
    const rawMaxR = Math.max(1, ...rightVals);
    const maxR = rawMaxR <= 5 ? Math.max(4, Math.ceil(rawMaxR)) : Math.ceil(rawMaxR * 1.15);

    const nodes = series.map((pt, idx) => {
      const x = n <= 1 ? padLeft + plotW / 2 : padLeft + (idx / (n - 1)) * plotW;
      const lv = readMetricVal(pt, leftMetric);
      const rv = rightMetric !== 'none' ? readMetricVal(pt, rightMetric) : null;
      const prevPt = compareEnabled ? previousSeries?.[idx] : undefined;
      const prevLv = prevPt ? readMetricVal(prevPt, leftMetric) : null;
      const prevRv = prevPt && rightMetric !== 'none' ? readMetricVal(prevPt, rightMetric) : null;

      return {
        idx,
        date: pt.date,
        prevDate: prevPt?.date,
        label: pt.date.length >= 10 ? `${pt.date.slice(8, 10)}/${pt.date.slice(5, 7)}` : pt.date,
        x,
        lv,
        rv,
        prevLv,
        prevRv,
        yL: lv !== null ? baselineY - (lv / maxL) * plotH : null,
        yR: rv !== null ? baselineY - (rv / maxR) * plotH : null,
        yPrevL: prevLv !== null ? baselineY - (prevLv / maxL) * plotH : null,
        yPrevR: prevRv !== null ? baselineY - (prevRv / maxR) * plotH : null,
      };
    });

    return {
      maxL,
      maxR,
      nodes,
      leftPath: buildLinearPath(nodes.map((nd) => ({ x: nd.x, y: nd.yL }))),
      rightPath:
        rightMetric !== 'none'
          ? buildLinearPath(nodes.map((nd) => ({ x: nd.x, y: nd.yR })))
          : '',
      prevLeftPath: compareEnabled
        ? buildLinearPath(nodes.map((nd) => ({ x: nd.x, y: nd.yPrevL })))
        : '',
      prevRightPath:
        compareEnabled && rightMetric !== 'none'
          ? buildLinearPath(nodes.map((nd) => ({ x: nd.x, y: nd.yPrevR })))
          : '',
      yTicks: [1, 0.66, 0.33, 0].map((ratio) => ({
        ratio,
        y: padTop + plotH * (1 - ratio),
        valL: maxL * ratio,
        valR: maxR * ratio,
      })),
    };
  }, [series, previousSeries, compareEnabled, leftMetric, rightMetric, plotW, plotH, baselineY, padLeft]);

  if (!adsConnected) {
    return (
      <section className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs">
        <div className="h-[220px] rounded-xl bg-slate-50 border border-dashed border-slate-200 grid place-items-center text-xs text-slate-500 px-4 text-center">
          Chưa kết nối tài khoản Google Ads.
        </div>
      </section>
    );
  }

  if (loading && series.length === 0) {
    return (
      <section className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs">
        <div className="h-[236px] rounded-xl bg-slate-50 animate-pulse" />
      </section>
    );
  }

  const activeNode = hoverIdx !== null ? geom.nodes[hoverIdx] : null;
  const hitWidth = Math.max(12, plotW / Math.max(1, geom.nodes.length));

  return (
    <section
      aria-labelledby="m02-ads-chart-heading"
      className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs space-y-3"
    >
      {/* Thanh tiêu đề + 2 Dropdown chọn chỉ số giống Google Ads */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="m02-ads-chart-heading" className="text-sm font-bold text-slate-900">
            Biểu đồ hiệu suất Google Ads theo ngày
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Chọn 2 chỉ số cần đối chiếu trên cùng trục ngày.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Dropdown 1: Xanh dương #1A73E8 */}
          <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 h-8 shadow-2xs">
            <span className="w-2.5 h-2.5 rounded-xs bg-[#1A73E8] shrink-0" />
            <select
              aria-label="Chọn chỉ số trục trái Google Ads"
              value={leftMetric}
              onChange={(e) => setLeftMetric(e.target.value as AdsChartMetricKey)}
              className="bg-transparent font-semibold text-slate-800 focus:outline-none cursor-pointer"
            >
              {(Object.keys(METRIC_META) as AdsChartMetricKey[]).map((k) => (
                <option key={k} value={k}>
                  {METRIC_META[k].label}
                </option>
              ))}
            </select>
          </label>

          {/* Dropdown 2: Đỏ #D93025 */}
          <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 h-8 shadow-2xs">
            <span
              className={`w-2.5 h-2.5 rounded-xs shrink-0 ${
                rightMetric === 'none' ? 'bg-slate-300' : 'bg-[#D93025]'
              }`}
            />
            <select
              aria-label="Chọn chỉ số trục phải Google Ads"
              value={rightMetric}
              onChange={(e) => setRightMetric(e.target.value as AdsChartMetricKey | 'none')}
              className="bg-transparent font-semibold text-slate-800 focus:outline-none cursor-pointer"
            >
              <option value="none">Không có</option>
              {(Object.keys(METRIC_META) as AdsChartMetricKey[]).map((k) => (
                <option key={k} value={k}>
                  {METRIC_META[k].label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* Vùng SVG 2 trục */}
      <div className="relative select-none">
        {activeNode && (
          <div
            className="pointer-events-none absolute top-1 z-20 rounded-xl bg-slate-900/95 text-white px-3 py-2 text-xs shadow-xl border border-slate-700 space-y-1 min-w-[210px]"
            style={{
              left: activeNode.x > width * 0.62 ? 'auto' : `${Math.max(6, (activeNode.x / width) * 100)}%`,
              right: activeNode.x > width * 0.62 ? `${Math.max(4, ((width - activeNode.x) / width) * 100)}%` : 'auto',
            }}
          >
            <div className="font-bold text-sky-300 border-b border-white/10 pb-1 flex items-center justify-between gap-2">
              <span>{activeNode.date}</span>
              {compareEnabled && activeNode.prevDate && (
                <span className="text-[10px] font-normal text-slate-400">
                  vs {activeNode.prevDate}
                </span>
              )}
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="inline-flex items-center gap-1.5 text-slate-200">
                <span className="w-2 h-2 rounded-full bg-[#60A5FA]" />
                {leftMeta.label}:
              </span>
              <strong className="tabular-nums font-bold">{leftMeta.format(activeNode.lv)}</strong>
            </div>
            {compareEnabled && activeNode.prevLv !== null && (
              <div className="flex items-center justify-between gap-4 text-[11px] text-slate-400 pl-3.5">
                <span>Kỳ trước:</span>
                <span className="tabular-nums">{leftMeta.format(activeNode.prevLv)}</span>
              </div>
            )}

            {rightMeta && (
              <>
                <div className="flex items-center justify-between gap-4 pt-0.5">
                  <span className="inline-flex items-center gap-1.5 text-slate-200">
                    <span className="w-2 h-2 rounded-full bg-[#F87171]" />
                    {rightMeta.label}:
                  </span>
                  <strong className="tabular-nums font-bold">{rightMeta.format(activeNode.rv)}</strong>
                </div>
                {compareEnabled && activeNode.prevRv !== null && (
                  <div className="flex items-center justify-between gap-4 text-[11px] text-slate-400 pl-3.5">
                    <span>Kỳ trước:</span>
                    <span className="tabular-nums">{rightMeta.format(activeNode.prevRv)}</span>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-[236px] overflow-visible"
          onMouseLeave={() => setHoverIdx(null)}
          role="img"
          aria-label="Biểu đồ hiệu suất Google Ads 2 chỉ số"
        >
          {geom.yTicks.map((t, idx) => (
            <g key={`yt-${idx}`}>
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
                className="fill-[#1A73E8] text-[10px] font-medium tabular-nums"
              >
                {leftMeta.axisFormat(t.valL)}
              </text>
              {rightMeta && (
                <text
                  x={width - padRight + 8}
                  y={t.y + 3.5}
                  textAnchor="start"
                  className="fill-[#D93025] text-[10px] font-medium tabular-nums"
                >
                  {rightMeta.axisFormat(t.valR)}
                </text>
              )}
            </g>
          ))}

          {/* Đường kỳ trước (nét đứt) nếu bật So sánh */}
          {geom.prevLeftPath && (
            <path
              d={geom.prevLeftPath}
              fill="none"
              stroke="#1A73E8"
              strokeOpacity={0.38}
              strokeDasharray="5 4"
              strokeWidth={1.8}
            />
          )}
          {geom.prevRightPath && (
            <path
              d={geom.prevRightPath}
              fill="none"
              stroke="#D93025"
              strokeOpacity={0.38}
              strokeDasharray="5 4"
              strokeWidth={1.8}
            />
          )}

          {/* Đường chính kỳ này */}
          {geom.leftPath && (
            <path
              d={geom.leftPath}
              fill="none"
              stroke="#1A73E8"
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {geom.rightPath && (
            <path
              d={geom.rightPath}
              fill="none"
              stroke="#D93025"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {activeNode && (
            <line
              x1={activeNode.x}
              y1={padTop}
              x2={activeNode.x}
              y2={baselineY}
              stroke="#94A3B8"
              strokeDasharray="3 3"
              strokeWidth={1.2}
            />
          )}

          {geom.nodes.map((nd, idx) => {
            const isHovered = hoverIdx === idx;
            const showXLabel =
              geom.nodes.length <= 12 ||
              idx === 0 ||
              idx === geom.nodes.length - 1 ||
              idx % Math.ceil(geom.nodes.length / 8) === 0;
            return (
              <g key={nd.date}>
                {nd.yL !== null && (
                  <circle
                    cx={nd.x}
                    cy={nd.yL}
                    r={isHovered ? 4.8 : 2.5}
                    fill={isHovered ? '#1A73E8' : '#FFFFFF'}
                    stroke="#1A73E8"
                    strokeWidth={isHovered ? 2.4 : 1.6}
                  />
                )}
                {nd.yR !== null && (
                  <circle
                    cx={nd.x}
                    cy={nd.yR}
                    r={isHovered ? 4.5 : 2.3}
                    fill={isHovered ? '#D93025' : '#FFFFFF'}
                    stroke="#D93025"
                    strokeWidth={isHovered ? 2.2 : 1.5}
                  />
                )}
                {showXLabel && (
                  <text
                    x={nd.x}
                    y={baselineY + 18}
                    textAnchor="middle"
                    className={`text-[10px] tabular-nums ${
                      isHovered ? 'fill-slate-900 font-bold' : 'fill-slate-500'
                    }`}
                  >
                    {nd.label}
                  </text>
                )}
                <rect
                  x={nd.x - hitWidth / 2}
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
    </section>
  );
}
