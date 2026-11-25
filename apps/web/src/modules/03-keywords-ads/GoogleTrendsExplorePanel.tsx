'use client';

import React, { useMemo, useState } from 'react';
import type { M03AdsSeoDashboardDto } from '@toantrung/contracts';
import { UI_VOCABULARY } from '@toantrung/contracts';
import { apiRequest, invalidateApiCacheByDomains } from '@/core/http/client';
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Flame,
  Globe,
  MapPin,
  Plus,
  Search,
  Sparkles,
  TrendingUp,
  Upload,
  X,
} from 'lucide-react';

const TREND_COLORS = [
  '#1A73E8', // Google Blue
  '#EA4335', // Google Red
  '#FBBC04', // Google Yellow/Amber
  '#34A853', // Google Green
  '#A142F4', // Purple
];

const GEO_OPTIONS = [
  { code: 'VN', label: 'Việt Nam' },
  { code: 'VN-SG', label: 'TP. Hồ Chí Minh' },
  { code: 'VN-HN', label: 'Hà Nội' },
  { code: 'VN-DN', label: 'Đà Nẵng' },
];

const DATE_RANGE_OPTIONS = [
  { value: 'now 7-d', label: '7 ngày qua' },
  { value: 'today 1-m', label: '30 ngày qua' },
  { value: 'today 3-m', label: '90 ngày qua' },
  { value: 'today 12-m', label: '12 tháng qua' },
  { value: 'today 5-y', label: '5 năm qua' },
];

interface GoogleTrendsExplorePanelProps {
  trends: M03AdsSeoDashboardDto['trends'] | undefined;
  csrfToken?: string;
  canEditContent: boolean;
  onQuickPlanKeyword: (kw: string) => void;
  onRefreshed: () => Promise<void>;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

export function GoogleTrendsExplorePanel({
  trends,
  csrfToken,
  canEditContent,
  onQuickPlanKeyword,
  onRefreshed,
  onError,
  onSuccess,
}: GoogleTrendsExplorePanelProps) {
  const indexRows = useMemo(
    () => (trends?.rows || []).filter((r) => r.scaleType === 'INDEX_0_100'),
    [trends?.rows],
  );

  const [compareTerms, setCompareTerms] = useState<string[]>(() => {
    const fromData = Array.from(
      new Set(
        (trends?.rows || [])
          .filter((r) => r.scaleType === 'INDEX_0_100')
          .map((r) => r.term),
      ),
    ).slice(0, 5);
    if (fromData.length > 0) return fromData;
    return ['màn hình led', 'bảng điện tử led'];
  });
  const [newTermInput, setNewTermInput] = useState('');
  const [geo, setGeo] = useState('VN');
  const [dateRange, setDateRange] = useState('today 12-m');

  const [busy, setBusy] = useState(false);
  const [suggestResults, setSuggestResults] = useState<
    Array<{ term: string; suggestions: string[] }> | null
  >(null);
  const [hoverDateIdx, setHoverDateIdx] = useState<number | null>(null);
  const [showSerpAdvanced, setShowSerpAdvanced] = useState(false);
  const [serpKeyInput, setSerpKeyInput] = useState('');
  const [savingKey, setSavingKey] = useState(false);

  const addCompareTerm = () => {
    const clean = newTermInput.trim();
    if (clean.length < 2) return;
    if (compareTerms.length >= 5) {
      onError('Google Trends so sánh tối đa 5 cụm từ khóa cùng lúc.');
      return;
    }
    if (!compareTerms.some((t) => t.toLowerCase() === clean.toLowerCase())) {
      setCompareTerms((prev) => [...prev, clean]);
    }
    setNewTermInput('');
  };

  const removeCompareTerm = (term: string) => {
    setCompareTerms((prev) => prev.filter((t) => t !== term));
  };

  const googleTrendsExploreUrl = useMemo(() => {
    const q = compareTerms.join(',');
    const sp = new URLSearchParams({
      date: dateRange,
      geo,
      q,
    });
    return `https://trends.google.com/trends/explore?${sp.toString()}`;
  }, [compareTerms, dateRange, geo]);

  // Xây dựng dữ liệu đồ thị 0–100 cho các từ khóa từ CSV / SerpApi đã nhập
  const chartModel = useMemo(() => {
    if (indexRows.length === 0) return null;
    const allDates = Array.from(new Set(indexRows.map((r) => r.date))).sort();
    const availableTerms = Array.from(new Set(indexRows.map((r) => r.term)));
    // Ưu tiên thứ tự theo compareTerms trước, sau đó mới thêm các từ khóa khác trong indexRows
    const orderedTerms: string[] = [];
    for (const ct of compareTerms) {
      const hit = availableTerms.find((t) => t.toLowerCase() === ct.toLowerCase());
      if (hit && !orderedTerms.includes(hit)) orderedTerms.push(hit);
    }
    for (const at of availableTerms) {
      if (!orderedTerms.includes(at) && orderedTerms.length < 5) orderedTerms.push(at);
    }

    const byTermDate = new Map<string, Map<string, number>>();
    for (const row of indexRows) {
      if (!orderedTerms.includes(row.term) || row.interestValue === null) continue;
      const m = byTermDate.get(row.term) || new Map<string, number>();
      m.set(row.date, row.interestValue);
      byTermDate.set(row.term, m);
    }

    const seriesList = orderedTerms.map((term, idx) => {
      const m = byTermDate.get(term) || new Map<string, number>();
      const values = allDates.map((d) => m.get(d) ?? null);
      const validNums = values.filter((v): v is number => v !== null);
      const avg =
        validNums.length > 0
          ? Math.round(validNums.reduce((s, v) => s + v, 0) / validNums.length)
          : 0;
      return {
        term,
        color: TREND_COLORS[idx % TREND_COLORS.length],
        values,
        avg,
      };
    });

    return { dates: allDates, seriesList };
  }, [indexRows, compareTerms]);

  const width = 760;
  const height = 240;
  const padLeft = 36;
  const padRight = 18;
  const padTop = 18;
  const padBottom = 28;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const baselineY = padTop + plotH;

  const handleFreeSuggestLookup = async () => {
    if (compareTerms.length === 0 || busy) return;
    setBusy(true);
    try {
      const res = await apiRequest<{
        results: Array<{ term: string; suggestions: string[] }>;
      }>('/api/v1/ads/trends', {
        method: 'POST',
        csrfToken,
        body: { action: 'compare_suggest', keywords: compareTerms },
      });
      setSuggestResults(res.results || []);
      onSuccess(
        `Đã tra cứu xong ${res.results.length} cụm từ khóa từ Google Suggest VN (Miễn phí).`,
      );
      await onRefreshed();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Không thể tra cứu gợi ý Google VN.');
    } finally {
      setBusy(false);
    }
  };

  const handleCsvUpload = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const reader = new FileReader();
    reader.onload = async () => {
      setBusy(true);
      try {
        const csvText = String(reader.result || '');
        const res = await apiRequest<{
          detectedType: 'timeline' | 'geomap';
          importedRows: number;
          terms: string[];
        }>('/api/v1/ads/trends', {
          method: 'POST',
          csrfToken,
          body: { action: 'import_csv', csvText },
        });
        if (res.terms?.length > 0) {
          setCompareTerms(res.terms.slice(0, 5));
        }
        onSuccess(
          res.detectedType === 'geomap'
            ? `Đã nhập ${res.importedRows} dòng Tỉnh/Thành từ file geoMap.csv cho: ${res.terms.join(', ')}`
            : `Đã nhập ${res.importedRows} điểm chỉ số 0–100 từ multiTimeline.csv cho: ${res.terms.join(', ')}`,
        );
        invalidateApiCacheByDomains(['ads']);
        await onRefreshed();
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Không thể đọc file CSV Google Trends.');
      } finally {
        setBusy(false);
      }
    };
    reader.readAsText(file);
  };

  const regionRows = trends?.regionRows || [];
  const relatedQueries = trends?.relatedQueries || [];
  const rssTrends = trends?.dailyRssTrends || [];

  return (
    <div className="p-4 sm:p-5 space-y-4 text-xs">
      {/* Thanh trạng thái + Hướng dẫn luồng miễn phí 100% */}
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="font-bold text-slate-900 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-700" />
            <span>Google Trends Việt Nam</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                trends?.status === 'CONNECTED'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-amber-100 text-amber-800'
              }`}
            >
              {trends?.status === 'CONNECTED'
                ? 'Đã có dữ liệu'
                : UI_VOCABULARY.fallbacks.unconnected}
            </span>
          </div>
          <p className="text-[11px] text-slate-600">
            So sánh tối đa 5 từ khóa qua Google Suggest hoặc nhập trực tiếp{' '}
            <code className="px-1 rounded bg-white border border-emerald-200">multiTimeline.csv</code> /{' '}
            <code className="px-1 rounded bg-white border border-emerald-200">geoMap.csv</code>.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowSerpAdvanced((p) => !p)}
          className="h-8 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-semibold text-slate-600 inline-flex items-center gap-1"
        >
          <span>{trends?.serpApiConfigured ? 'SerpApi: Đã gắn khóa' : 'Tùy chọn SerpApi nâng cao'}</span>
          {showSerpAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Khung SerpApi thu gọn (tùy chọn cho ai muốn kéo tự động) */}
      {showSerpAdvanced && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold text-slate-800">
              Cấu hình SerpApi (Kéo chuỗi 0–100, Tỉnh/Thành & Rising tự động)
            </span>
            {trends?.serpApiConfigured && (
              <button
                type="button"
                disabled={busy || compareTerms.length === 0}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const res = await apiRequest<{ syncedPoints: number; terms: string[] }>(
                      '/api/v1/ads/trends',
                      {
                        method: 'POST',
                        csrfToken,
                        body: {
                          action: 'sync_serpapi',
                          keywords: compareTerms,
                          geo,
                          dateRange,
                        },
                      },
                    );
                    onSuccess(
                      `Đã đồng bộ ${res.syncedPoints} mốc chỉ số (0–100) cho ${res.terms.join(', ')}.`,
                    );
                    invalidateApiCacheByDomains(['ads']);
                    await onRefreshed();
                  } catch (err) {
                    onError(err instanceof Error ? err.message : 'Đồng bộ SerpApi thất bại.');
                  } finally {
                    setBusy(false);
                  }
                }}
                className="h-8 px-3 rounded-lg bg-emerald-700 text-white font-semibold hover:bg-emerald-800 disabled:opacity-50"
              >
                Kéo tự động {compareTerms.length} từ khóa ngay
              </button>
            )}
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!serpKeyInput.trim() || savingKey) return;
              setSavingKey(true);
              try {
                await apiRequest('/api/v1/ads/trends', {
                  method: 'POST',
                  csrfToken,
                  body: { action: 'save_serpapi_key', apiKey: serpKeyInput.trim() },
                });
                setSerpKeyInput('');
                onSuccess('Đã lưu khóa SerpApi.');
                invalidateApiCacheByDomains(['ads']);
                await onRefreshed();
              } catch (err) {
                onError(err instanceof Error ? err.message : 'Không thể lưu khóa SerpApi.');
              } finally {
                setSavingKey(false);
              }
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <input
              type="password"
              value={serpKeyInput}
              onChange={(e) => setSerpKeyInput(e.target.value)}
              placeholder="Dán SERPAPI_API_KEY (không bắt buộc nếu dùng CSV miễn phí)..."
              className="flex-1 min-w-[240px] h-8 px-3 rounded-lg border border-slate-200 bg-white"
            />
            <button
              type="submit"
              disabled={savingKey}
              className="h-8 px-3 rounded-lg bg-[#0B1D48] text-white font-semibold hover:bg-[#172D6E] disabled:opacity-50"
            >
              {savingKey ? 'Đang lưu...' : 'Lưu khóa'}
            </button>
          </form>
        </div>
      )}

      {/* THANH SO SÁNH TỐI ĐA 5 TỪ KHÓA + BỘ LỌC KHU VỰC & THỜI GIAN CHUẨN GOOGLE TRENDS */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3 shadow-2xs">
        <div className="flex flex-wrap items-center gap-2">
          {compareTerms.map((term, idx) => (
            <div
              key={term}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 font-semibold text-slate-900"
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: TREND_COLORS[idx % TREND_COLORS.length] }}
              />
              <span>{term}</span>
              <button
                type="button"
                aria-label={`Xóa từ khóa ${term}`}
                onClick={() => removeCompareTerm(term)}
                className="text-slate-400 hover:text-rose-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}

          {compareTerms.length < 5 && (
            <div className="inline-flex items-center gap-1.5">
              <input
                type="text"
                value={newTermInput}
                onChange={(e) => setNewTermInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addCompareTerm();
                  }
                }}
                placeholder="+ Thêm cụm từ so sánh (tối đa 5)..."
                className="h-8 px-3 rounded-full border border-slate-300 bg-white text-xs text-slate-800 w-56 focus:outline-2 focus:outline-[#1A73E8]"
              />
              <button
                type="button"
                onClick={addCompareTerm}
                className="h-8 px-2.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold inline-flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Thêm</span>
              </button>
            </div>
          )}
        </div>

        {/* Bộ lọc Khu vực / Mốc thời gian + Hành động Miễn phí */}
        <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 h-8">
              <Globe className="w-3.5 h-3.5 text-slate-500" />
              <select
                aria-label="Khu vực Google Trends"
                value={geo}
                onChange={(e) => setGeo(e.target.value)}
                className="bg-transparent font-semibold text-slate-800 focus:outline-none cursor-pointer"
              >
                {GEO_OPTIONS.map((g) => (
                  <option key={g.code} value={g.code}>
                    {g.label}
                  </option>
                ))}
              </select>
            </label>

            <select
              aria-label="Khoảng thời gian Google Trends"
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              className="h-8 rounded-lg border border-slate-200 bg-slate-50 px-2.5 font-semibold text-slate-800 focus:outline-none cursor-pointer"
            >
              {DATE_RANGE_OPTIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy || compareTerms.length === 0}
              onClick={() => void handleFreeSuggestLookup()}
              className="h-8 px-3 rounded-lg bg-[#1A73E8] hover:bg-[#1558B0] text-white font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <Search className="w-3.5 h-3.5" />
              <span>{busy ? 'Đang tra cứu...' : 'Tra cứu gợi ý Google VN (Miễn phí)'}</span>
            </button>

            <a
              href={googleTrendsExploreUrl}
              target="_blank"
              rel="noreferrer"
              className="h-8 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold inline-flex items-center gap-1.5"
            >
              <span>Mở trên Google Trends ↗</span>
              <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
            </a>

            <label className="h-8 px-3 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 font-semibold inline-flex items-center gap-1.5 cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              <span>Nhập CSV (multiTimeline / geoMap)</span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  handleCsvUpload(e.target.files);
                  e.currentTarget.value = '';
                }}
              />
            </label>
          </div>
        </div>
      </section>

      {/* BIỂU ĐỒ ĐA TỪ KHÓA (0–100) + CỘT TRUNG BÌNH */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Mức độ quan tâm theo thời gian (Thang 0–100)
            </h3>
            <p className="text-[11px] text-slate-500">
              Hiển thị đồng thời tối đa 5 cụm từ khóa so sánh từ file multiTimeline.csv (hoặc SerpApi nếu có)
            </p>
          </div>
          {chartModel && (
            <span className="text-[11px] text-slate-500 tabular-nums">
              {chartModel.dates.length} mốc thời gian
            </span>
          )}
        </div>

        {!chartModel || chartModel.dates.length === 0 ? (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              handleCsvUpload(e.dataTransfer.files);
            }}
            className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-6 text-center space-y-2"
          >
            <div className="font-semibold text-slate-700">
              Chưa có chuỗi điểm 0–100 trong kỳ lọc hiện tại
            </div>
            <p className="text-[11px] text-slate-500 max-w-xl mx-auto">
              Bấm nút <strong>&ldquo;Mở trên Google Trends ↗&rdquo;</strong> để tải file{' '}
              <code>multiTimeline.csv</code> hoặc <code>geoMap.csv</code> miễn phí rồi kéo thả vào đây.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
            {/* Cột trái 3/12: Biểu đồ cột trung bình giống Google Trends */}
            <div className="lg:col-span-3 space-y-2 border-b lg:border-b-0 lg:border-r border-slate-100 pb-3 lg:pb-0 lg:pr-4">
              <div className="text-[11px] font-bold text-slate-600 uppercase">Trung bình kỳ</div>
              <div className="space-y-2">
                {chartModel.seriesList.map((s) => (
                  <div key={s.term} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="font-semibold text-slate-800 truncate">{s.term}</span>
                      <strong className="tabular-nums text-slate-900">{s.avg}</strong>
                    </div>
                    <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(4, s.avg)}%`,
                          backgroundColor: s.color,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Cột phải 9/12: Đồ thị đường 0–100 */}
            <div className="lg:col-span-9 relative select-none">
              {hoverDateIdx !== null && chartModel.dates[hoverDateIdx] && (
                <div
                  className="pointer-events-none absolute top-1 z-20 rounded-xl bg-slate-900/95 text-white px-3 py-2 text-xs shadow-xl border border-slate-700 space-y-1 min-w-[190px]"
                  style={{
                    left:
                      hoverDateIdx > chartModel.dates.length * 0.62
                        ? 'auto'
                        : `${Math.max(5, (hoverDateIdx / Math.max(1, chartModel.dates.length - 1)) * 85)}%`,
                    right:
                      hoverDateIdx > chartModel.dates.length * 0.62
                        ? `${Math.max(4, (1 - hoverDateIdx / Math.max(1, chartModel.dates.length - 1)) * 85)}%`
                        : 'auto',
                  }}
                >
                  <div className="font-bold text-sky-300 border-b border-white/10 pb-1">
                    {chartModel.dates[hoverDateIdx]}
                  </div>
                  {chartModel.seriesList.map((s) => (
                    <div key={s.term} className="flex items-center justify-between gap-4">
                      <span className="inline-flex items-center gap-1.5 text-slate-200 truncate">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: s.color }}
                        />
                        {s.term}
                      </span>
                      <strong className="tabular-nums font-bold">
                        {s.values[hoverDateIdx] ?? '—'}
                      </strong>
                    </div>
                  ))}
                </div>
              )}

              <svg
                viewBox={`0 0 ${width} ${height}`}
                className="w-full h-[240px] overflow-visible"
                onMouseLeave={() => setHoverDateIdx(null)}
                role="img"
                aria-label="Biểu đồ so sánh Google Trends 0-100"
              >
                {[100, 75, 50, 25, 0].map((tick) => {
                  const y = baselineY - (tick / 100) * plotH;
                  return (
                    <g key={tick}>
                      <line
                        x1={padLeft}
                        y1={y}
                        x2={width - padRight}
                        y2={y}
                        stroke={tick === 0 ? '#CBD5E1' : '#F1F5F9'}
                        strokeWidth={1}
                      />
                      <text
                        x={padLeft - 6}
                        y={y + 3.5}
                        textAnchor="end"
                        className="fill-slate-400 text-[10px] tabular-nums"
                      >
                        {tick}
                      </text>
                    </g>
                  );
                })}

                {chartModel.seriesList.map((s) => {
                  let d = '';
                  let penUp = true;
                  const n = chartModel.dates.length;
                  s.values.forEach((v, i) => {
                    if (v === null) {
                      penUp = true;
                      return;
                    }
                    const x = n <= 1 ? padLeft + plotW / 2 : padLeft + (i / (n - 1)) * plotW;
                    const y = baselineY - (v / 100) * plotH;
                    d += `${penUp ? 'M' : ' L'} ${x.toFixed(1)} ${y.toFixed(1)} `;
                    penUp = false;
                  });
                  return d ? (
                    <path
                      key={s.term}
                      d={d.trim()}
                      fill="none"
                      stroke={s.color}
                      strokeWidth={2.3}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ) : null;
                })}

                {chartModel.dates.map((dt, idx) => {
                  const n = chartModel.dates.length;
                  const x = n <= 1 ? padLeft + plotW / 2 : padLeft + (idx / (n - 1)) * plotW;
                  const hitW = Math.max(8, plotW / Math.max(1, n));
                  const showLabel =
                    n <= 10 || idx === 0 || idx === n - 1 || idx % Math.ceil(n / 7) === 0;
                  return (
                    <g key={dt}>
                      {showLabel && (
                        <text
                          x={x}
                          y={baselineY + 17}
                          textAnchor="middle"
                          className="fill-slate-500 text-[10px] tabular-nums"
                        >
                          {dt.slice(5)}
                        </text>
                      )}
                      <rect
                        x={x - hitW / 2}
                        y={padTop}
                        width={hitW}
                        height={plotH + 20}
                        fill="transparent"
                        className="cursor-crosshair"
                        onMouseEnter={() => setHoverDateIdx(idx)}
                      />
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
        )}
      </section>

      {/* 2 KHUNG PHÍA DƯỚI: TỈNH/THÀNH PHỐ + CỤM TỪ LIÊN QUAN / GỢI Ý GOOGLE VN */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Tỉnh / Thành phố */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-[#1A73E8]" />
              <span>Mức độ quan tâm theo Tỉnh / Thành phố</span>
            </h3>
            <span className="text-[11px] text-slate-400">geoMap.csv / SerpApi</span>
          </div>
          {regionRows.length === 0 ? (
            <p className="text-[11px] text-slate-500 py-5 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
              Chưa có dữ liệu Tỉnh/Thành. Hãy nhập file <code>geoMap.csv</code> xuất từ Google Trends.
            </p>
          ) : (
            <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
              {regionRows.slice(0, 20).map((r, i) => (
                <div
                  key={`${r.regionName}-${r.term}-${i}`}
                  className="py-2 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-800 truncate">{r.regionName}</div>
                    <div className="text-[10px] text-slate-400">{r.term}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 w-36">
                    <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#1A73E8]"
                        style={{ width: `${Math.max(4, r.interestValue)}%` }}
                      />
                    </div>
                    <strong className="w-7 text-right tabular-nums text-slate-900">
                      {r.interestValue}
                    </strong>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Cụm từ tìm kiếm liên quan & Google Suggest VN */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-emerald-600" />
              <span>Cụm từ tìm kiếm thực tế liên quan tại Việt Nam</span>
            </h3>
            <span className="text-[11px] text-slate-400">Đề xuất viết bài SEO</span>
          </div>

          {suggestResults && suggestResults.length > 0 ? (
            <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
              {suggestResults.map((group) => (
                <div key={group.term} className="space-y-1.5">
                  <div className="font-bold text-[#0B1D48] text-[11px]">
                    Gợi ý cho: {group.term}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {group.suggestions.map((sug) => (
                      <div
                        key={sug}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50/40 px-2.5 py-1"
                      >
                        <span className="font-medium text-slate-800">{sug}</span>
                        {canEditContent && (
                          <button
                            type="button"
                            onClick={() => onQuickPlanKeyword(sug)}
                            className="text-[#1A73E8] font-semibold hover:underline"
                          >
                            + Lên bài
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : relatedQueries.length > 0 ? (
            <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
              {relatedQueries.slice(0, 20).map((rq, idx) => (
                <div
                  key={`${rq.term}-${rq.query}-${idx}`}
                  className="py-2 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-slate-800 truncate">{rq.query}</div>
                    <div className="text-[10px] text-slate-400">
                      {rq.term} · {rq.valueLabel}
                    </div>
                  </div>
                  {canEditContent && (
                    <button
                      type="button"
                      onClick={() => onQuickPlanKeyword(rq.query)}
                      className="shrink-0 px-2 py-1 rounded-md bg-blue-50 text-[#1A73E8] font-semibold hover:bg-blue-100"
                    >
                      + Lên bài
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (trends?.industrySuggestions?.length || 0) > 0 ? (
            <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
              {trends!.industrySuggestions!.map((group) => (
                <div key={group.seedTerm} className="space-y-1">
                  <div className="font-bold text-[#0B1D48] text-[11px]">{group.seedTerm}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {group.suggestions.map((kw) => (
                      <div
                        key={kw}
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5"
                      >
                        <span className="text-slate-800">{kw}</span>
                        {canEditContent && (
                          <button
                            type="button"
                            onClick={() => onQuickPlanKeyword(kw)}
                            className="text-[#1A73E8] font-semibold hover:underline"
                          >
                            + Bài
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-slate-500 py-5 text-center">
              Bấm &ldquo;Tra cứu gợi ý Google VN (Miễn phí)&rdquo; để tải nhanh các từ khóa thực tế đang tìm nhiều.
            </p>
          )}
        </section>
      </div>

      {/* TIN TỨC / XU HƯỚNG NỔI BẬT TRONG NGÀY TẠI VIỆT NAM (GOOGLE TRENDS RSS) */}
      {rssTrends.length > 0 && (
        <details className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
          <summary className="cursor-pointer font-bold text-slate-800 inline-flex items-center gap-1.5 select-none">
            <Flame className="w-4 h-4 text-rose-500" />
            <span>Xu hướng tìm kiếm nổi bật trong ngày tại Việt Nam ({rssTrends.length} chủ đề RSS)</span>
          </summary>
          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <th className="py-2 px-3 text-left font-semibold">Chủ đề / Từ khóa</th>
                  <th className="py-2 px-3 text-right font-semibold">Lưu lượng xấp xỉ</th>
                  <th className="py-2 px-3 text-left font-semibold">Ngữ cảnh / Tin tức</th>
                  <th className="py-2 px-3 text-right font-semibold">Ngày</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rssTrends.map((tr, idx) => (
                  <tr key={`${tr.term}-${idx}`} className="hover:bg-slate-50/70">
                    <td className="py-2 px-3 font-semibold text-slate-900">{tr.term}</td>
                    <td className="py-2 px-3 text-right font-bold text-[#0B1D48] tabular-nums">
                      {tr.approxTrafficLabel || 'Đang tăng'}
                    </td>
                    <td className="py-2 px-3 text-slate-600 max-w-[340px] truncate">
                      {tr.newsHeadline || 'Google Trends RSS VN'}
                    </td>
                    <td className="py-2 px-3 text-right text-slate-500 tabular-nums">{tr.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
