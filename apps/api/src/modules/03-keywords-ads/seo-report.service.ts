import { prisma, recordAiUsageAttempt } from '@toantrung/database';
import type { SessionUserDto } from '@toantrung/contracts';
import { bumpDomainRevisions, getOrComputeScopedCache } from '../../core/cache/server-data-cache';
import { buildStandardXlsxBuffer, ZipArchive } from '../../core/export/xlsx-builder';
import { AiDesignProviderFactory } from '../05-ai-design/providers';

function resolveLiveGeminiApiKey(): string {
  const envKey = process.env.GEMINI_API_KEY?.trim();
  if (envKey) return envKey;
  try {
    const catalog = AiDesignProviderFactory.getCatalog();
    const gKey = catalog?.config?.providers?.google_imagen?.apiKey?.trim();
    if (gKey) return gKey;
  } catch {
    // ignore catalog read errors
  }
  return '';
}

const SETTING_KEY_SEO_AI_REPORTS = 'seo_ai_reports_history_v1';

export interface SeoPeriodMetrics {
  startDate: string;
  endDate: string;
  daysWithData: number;
  totalClicks: number;
  totalImpressions: number;
  overallCtrPct: number;
  weightedAvgPosition: number | null;
}

export interface SeoKeywordSnapshotRow {
  keyword: string;
  clicks: number;
  impressions: number;
  ctrPct: number;
  avgPosition: number | null;
  prevClicks: number;
  clicksDelta: number;
  clicksDeltaPct: number | null;
}

export interface SeoPageSnapshotRow {
  pageUrl: string;
  clicks: number;
  impressions: number;
  ctrPct: number;
  avgPosition: number | null;
}

export interface SeoTopicRecommendationRow {
  keyword: string;
  targetWebsite: string;
  suggestedTopicTitle: string;
  priorityCategory: 'HIGH_IMPRESSION_LOW_CTR' | 'STRIKE_DISTANCE_POS_4_15' | 'RISING_DEMAND_LEAD_FIT';
  impressions: number;
  clicks: number;
  ctrPct: number;
  avgPosition: number | null;
  leadsFromWebsiteCount: number;
  dataEvidenceReason: string;
}

export interface SeoComparisonSnapshot {
  website: string;
  sourcePlatform: 'Google Search Console';
  generatedAt: string;
  periodDays: number;
  current: SeoPeriodMetrics;
  previous: SeoPeriodMetrics;
  comparison: {
    clicksDelta: number;
    clicksDeltaPct: number | null;
    clicksDeltaLabel: string;
    impressionsDelta: number;
    impressionsDeltaPct: number | null;
    impressionsDeltaLabel: string;
    ctrDeltaPctPoints: number;
  };
  dataCompleteness: {
    expectedDays: number;
    currentDaysWithData: number;
    previousDaysWithData: number;
    hasMissingCurrent: boolean;
    hasMissingPrevious: boolean;
    warnings: string[];
  };
  leadsFromWebsiteCount: number;
  topKeywords: SeoKeywordSnapshotRow[];
  topPages: SeoPageSnapshotRow[];
  recommendedTopics?: SeoTopicRecommendationRow[];
}

export interface SeoClaimValidationResult {
  valid: boolean;
  violations: string[];
}

export interface SeoAiReportRecord {
  id: string;
  website: string;
  periodDays: number;
  snapshot: SeoComparisonSnapshot;
  aiOriginalContent: string;
  editedContent: string;
  modelUsed: string;
  generationMode: 'LIVE_AI' | 'DETERMINISTIC_FALLBACK';
  fallbackReason: string | null;
  validationResult: SeoClaimValidationResult;
  createdByUserId: number;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

function formatDateYmd(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function shiftDaysYmd(baseYmd: string, deltaDays: number): string {
  const d = new Date(`${baseYmd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return formatDateYmd(d);
}

export function computeSeoComparisonDelta(
  currentValue: number,
  previousValue: number,
  previousDaysWithData: number,
): { delta: number; deltaPct: number | null; label: string } {
  const delta = currentValue - previousValue;
  if (previousDaysWithData === 0) {
    return { delta, deltaPct: null, label: 'Thiếu dữ liệu kỳ trước' };
  }
  if (previousValue === 0) {
    return {
      delta,
      deltaPct: null,
      label: currentValue === 0 ? '0.0% (Kỳ trước bằng 0)' : 'Kỳ trước bằng 0',
    };
  }
  const pct = Number((((currentValue - previousValue) / previousValue) * 100).toFixed(2));
  const sign = pct > 0 ? '+' : '';
  return { delta, deltaPct: pct, label: `${sign}${pct.toFixed(1)}%` };
}

export function computePeriodMetricsFromRows(
  rows: Array<{
    metricDate: string;
    clicks: number;
    impressions: number;
    avgPosition: number | null;
  }>,
  startDate: string,
  endDate: string,
): SeoPeriodMetrics {
  const distinctDays = new Set<string>();
  let totalClicks = 0;
  let totalImpressions = 0;
  let weightedPosSum = 0;
  let weightedPosDenom = 0;

  for (const r of rows) {
    distinctDays.add(r.metricDate);
    totalClicks += r.clicks || 0;
    totalImpressions += r.impressions || 0;
    if (typeof r.avgPosition === 'number' && r.avgPosition > 0 && (r.impressions || 0) > 0) {
      weightedPosSum += r.avgPosition * r.impressions;
      weightedPosDenom += r.impressions;
    }
  }

  // Tính CTR tổng từ tổng clicks / tổng impressions (không lấy trung bình cộng đơn giản của CTR từng dòng)
  const overallCtrPct =
    totalImpressions > 0 ? Number(((totalClicks / totalImpressions) * 100).toFixed(2)) : 0;
  const weightedAvgPosition =
    weightedPosDenom > 0 ? Number((weightedPosSum / weightedPosDenom).toFixed(2)) : null;

  return {
    startDate,
    endDate,
    daysWithData: distinctDays.size,
    totalClicks,
    totalImpressions,
    overallCtrPct,
    weightedAvgPosition,
  };
}

export async function buildSeoComparisonSnapshot(params: {
  website: string;
  periodDays: number;
  endDate?: string;
}): Promise<SeoComparisonSnapshot> {
  const website = (params.website || 'all').trim().toLowerCase();
  const periodDays = Math.min(Math.max(Math.round(params.periodDays || 30), 1), 90);
  const currentEnd = params.endDate || formatDateYmd(new Date());
  const currentStart = shiftDaysYmd(currentEnd, -(periodDays - 1));
  const prevEnd = shiftDaysYmd(currentStart, -1);
  const prevStart = shiftDaysYmd(prevEnd, -(periodDays - 1));

  const siteFilter =
    website === 'all'
      ? {}
      : {
          accountPropertyId: { contains: website },
        };

  const [currAccountRows, prevAccountRows, currKeywordRows, prevKeywordRows, currPageRows, leadsCount] =
    await Promise.all([
      prisma.platformDailyMetric.findMany({
        where: {
          platform: 'search_console',
          grain: 'account',
          metricDate: { gte: currentStart, lte: currentEnd },
          ...siteFilter,
        },
        select: { metricDate: true, clicks: true, impressions: true, avgPosition: true },
      }),
      prisma.platformDailyMetric.findMany({
        where: {
          platform: 'search_console',
          grain: 'account',
          metricDate: { gte: prevStart, lte: prevEnd },
          ...siteFilter,
        },
        select: { metricDate: true, clicks: true, impressions: true, avgPosition: true },
      }),
      prisma.platformDailyMetric.findMany({
        where: {
          platform: 'search_console',
          grain: 'keyword',
          metricDate: { gte: currentStart, lte: currentEnd },
          ...siteFilter,
        },
        select: { keywordRaw: true, keywordTextNorm: true, clicks: true, impressions: true, avgPosition: true },
      }),
      prisma.platformDailyMetric.findMany({
        where: {
          platform: 'search_console',
          grain: 'keyword',
          metricDate: { gte: prevStart, lte: prevEnd },
          ...siteFilter,
        },
        select: { keywordRaw: true, keywordTextNorm: true, clicks: true },
      }),
      prisma.platformDailyMetric.findMany({
        where: {
          platform: 'search_console',
          grain: 'page',
          metricDate: { gte: currentStart, lte: currentEnd },
          ...siteFilter,
        },
        select: { pageUrlRaw: true, pagePathNorm: true, clicks: true, impressions: true, avgPosition: true },
      }),
      prisma.lead.count({
        where: {
          isSpam: false,
          createdAt: {
            gte: new Date(`${currentStart}T00:00:00.000+07:00`),
            lte: new Date(`${currentEnd}T23:59:59.999+07:00`),
          },
          ...(website === 'all' ? {} : { sourceWebsite: website }),
        },
      }),
    ]);

  const current = computePeriodMetricsFromRows(currAccountRows, currentStart, currentEnd);
  const previous = computePeriodMetricsFromRows(prevAccountRows, prevStart, prevEnd);

  const clicksComp = computeSeoComparisonDelta(
    current.totalClicks,
    previous.totalClicks,
    previous.daysWithData,
  );
  const impComp = computeSeoComparisonDelta(
    current.totalImpressions,
    previous.totalImpressions,
    previous.daysWithData,
  );

  const prevKwMap = new Map<string, number>();
  for (const r of prevKeywordRows) {
    const k = (r.keywordRaw || r.keywordTextNorm || '').trim().toLowerCase();
    if (!k || k === 'null' || k === '(not set)') continue;
    prevKwMap.set(k, (prevKwMap.get(k) || 0) + (r.clicks || 0));
  }

  const kwAgg = new Map<
    string,
    { keyword: string; clicks: number; impressions: number; posSum: number; posDenom: number }
  >();
  for (const r of currKeywordRows) {
    const label = (r.keywordRaw || r.keywordTextNorm || '').trim();
    const key = label.toLowerCase();
    if (!key || key === 'null' || key === '(not set)') continue;
    const entry = kwAgg.get(key) || { keyword: label, clicks: 0, impressions: 0, posSum: 0, posDenom: 0 };
    entry.clicks += r.clicks || 0;
    entry.impressions += r.impressions || 0;
    if (typeof r.avgPosition === 'number' && r.avgPosition > 0 && (r.impressions || 0) > 0) {
      entry.posSum += r.avgPosition * r.impressions;
      entry.posDenom += r.impressions;
    }
    kwAgg.set(key, entry);
  }

  const topKeywords: SeoKeywordSnapshotRow[] = Array.from(kwAgg.entries())
    .sort((a, b) => b[1].clicks - a[1].clicks || b[1].impressions - a[1].impressions)
    .slice(0, 15)
    .map(([key, v]) => {
      const prevClicks = prevKwMap.get(key) || 0;
      const d = computeSeoComparisonDelta(v.clicks, prevClicks, previous.daysWithData);
      return {
        keyword: v.keyword,
        clicks: v.clicks,
        impressions: v.impressions,
        ctrPct: v.impressions > 0 ? Number(((v.clicks / v.impressions) * 100).toFixed(2)) : 0,
        avgPosition: v.posDenom > 0 ? Number((v.posSum / v.posDenom).toFixed(1)) : null,
        prevClicks,
        clicksDelta: d.delta,
        clicksDeltaPct: d.deltaPct,
      };
    });

  const pageAgg = new Map<
    string,
    { pageUrl: string; clicks: number; impressions: number; posSum: number; posDenom: number }
  >();
  for (const r of currPageRows) {
    const label = (r.pageUrlRaw || r.pagePathNorm || '').trim();
    if (!label) continue;
    const entry = pageAgg.get(label) || { pageUrl: label, clicks: 0, impressions: 0, posSum: 0, posDenom: 0 };
    entry.clicks += r.clicks || 0;
    entry.impressions += r.impressions || 0;
    if (typeof r.avgPosition === 'number' && r.avgPosition > 0 && (r.impressions || 0) > 0) {
      entry.posSum += r.avgPosition * r.impressions;
      entry.posDenom += r.impressions;
    }
    pageAgg.set(label, entry);
  }

  const topPages: SeoPageSnapshotRow[] = Array.from(pageAgg.values())
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, 10)
    .map((v) => ({
      pageUrl: v.pageUrl,
      clicks: v.clicks,
      impressions: v.impressions,
      ctrPct: v.impressions > 0 ? Number(((v.clicks / v.impressions) * 100).toFixed(2)) : 0,
      avgPosition: v.posDenom > 0 ? Number((v.posSum / v.posDenom).toFixed(1)) : null,
    }));

  const warnings: string[] = [];
  if (current.daysWithData === 0) {
    warnings.push(`Chưa có dữ liệu Search Console trong kỳ hiện tại (${currentStart} → ${currentEnd}).`);
  } else if (current.daysWithData < periodDays) {
    warnings.push(`Kỳ hiện tại mới có dữ liệu ${current.daysWithData}/${periodDays} ngày (Google Search Console có độ trễ 1-2 ngày hoặc một số ngày không phát sinh lượt hiển thị).`);
  }
  if (previous.daysWithData === 0) {
    warnings.push(`Thiếu dữ liệu kỳ trước (${prevStart} → ${prevEnd}) nên không tính % tăng trưởng.`);
  } else if (previous.daysWithData < periodDays) {
    warnings.push(`Kỳ trước mới có dữ liệu ${previous.daysWithData}/${periodDays} ngày.`);
  }

  const resolvedSiteLabel = website === 'all' ? 'toantrung.com.vn' : website;
  const recommendedTopics: SeoTopicRecommendationRow[] = topKeywords
    .slice(0, 8)
    .map((kw): SeoTopicRecommendationRow => {
      const isStrikeDistance = kw.avgPosition != null && kw.avgPosition >= 4 && kw.avgPosition <= 15;
      const isHighImpLowCtr = kw.impressions >= 20 && kw.ctrPct < 3.5;
      const priorityCategory: SeoTopicRecommendationRow['priorityCategory'] = isStrikeDistance
        ? 'STRIKE_DISTANCE_POS_4_15'
        : isHighImpLowCtr
          ? 'HIGH_IMPRESSION_LOW_CTR'
          : 'RISING_DEMAND_LEAD_FIT';

      const reason = isStrikeDistance
        ? `Từ khóa "${kw.keyword}" đang ở vị trí TB ${kw.avgPosition} với ${kw.impressions} impressions và ${kw.clicks} clicks (CTR ${kw.ctrPct}%). Đẩy bài chuẩn SEO & internal link để vào Top 3 trên ${resolvedSiteLabel} (hiện ghi nhận ${leadsCount} Lead từ website).`
        : isHighImpLowCtr
          ? `Từ khóa "${kw.keyword}" có ${kw.impressions} impressions nhưng CTR mới đạt ${kw.ctrPct}% (${kw.clicks} clicks). Cần viết/cập nhật bài chuyên sâu kèm báo giá để thu hút nhấp chuột và tăng trên ${leadsCount} Lead hiện có.`
          : `Từ khóa "${kw.keyword}" đạt ${kw.clicks} clicks (${kw.clicksDelta >= 0 ? '+' : ''}${kw.clicksDelta} so với kỳ trước), ${kw.impressions} impressions, phù hợp nhu cầu chuyển đổi Lead (${leadsCount} Lead trong kỳ).`;

      return {
        keyword: kw.keyword,
        targetWebsite: resolvedSiteLabel,
        suggestedTopicTitle: `Báo giá & Giải pháp ${kw.keyword} chuẩn kỹ thuật tại ${resolvedSiteLabel}`,
        priorityCategory,
        impressions: kw.impressions,
        clicks: kw.clicks,
        ctrPct: kw.ctrPct,
        avgPosition: kw.avgPosition,
        leadsFromWebsiteCount: leadsCount,
        dataEvidenceReason: reason,
      };
    })
    .slice(0, 5);

  return {
    website: website === 'all' ? 'Tất cả website Toàn Trung' : website,
    sourcePlatform: 'Google Search Console',
    generatedAt: new Date().toISOString(),
    periodDays,
    current,
    previous,
    comparison: {
      clicksDelta: clicksComp.delta,
      clicksDeltaPct: clicksComp.deltaPct,
      clicksDeltaLabel: clicksComp.label,
      impressionsDelta: impComp.delta,
      impressionsDeltaPct: impComp.deltaPct,
      impressionsDeltaLabel: impComp.label,
      ctrDeltaPctPoints: Number((current.overallCtrPct - previous.overallCtrPct).toFixed(2)),
    },
    dataCompleteness: {
      expectedDays: periodDays,
      currentDaysWithData: current.daysWithData,
      previousDaysWithData: previous.daysWithData,
      hasMissingCurrent: current.daysWithData < periodDays,
      hasMissingPrevious: previous.daysWithData < periodDays,
      warnings,
    },
    leadsFromWebsiteCount: leadsCount,
    topKeywords,
    topPages,
    recommendedTopics,
  };
}

function buildFallbackSeoReportText(snapshot: SeoComparisonSnapshot): string {
  const siteLabel =
    snapshot.website === 'all' ? 'toàn bộ hệ thống website' : snapshot.website;

  const topKwLines = snapshot.topKeywords
    .slice(0, 5)
    .map(
      (k, idx) =>
        `  ${idx + 1}. Từ khóa "${k.keyword}": đạt ${k.clicks} lượt nhấp (${k.clicksDelta >= 0 ? 'tăng +' : 'giảm '}${k.clicksDelta} so với kỳ trước), ${k.impressions} lượt hiển thị, tỷ lệ nhấp (CTR) đạt ${k.ctrPct}%${k.avgPosition ? `, vị trí trung bình ${k.avgPosition}` : ''} [Tham chiếu: bảng topKeywords].`,
    )
    .join('\n');

  const topPageLines = snapshot.topPages
    .slice(0, 5)
    .map(
      (p, idx) =>
        `  ${idx + 1}. Trang ${p.pageUrl}: thu hút ${p.clicks} lượt nhấp từ ${p.impressions} lượt hiển thị (CTR ${p.ctrPct}%) [Tham chiếu: bảng topPages].`,
    )
    .join('\n');

  const clicksTrendText =
    snapshot.comparison.clicksDelta >= 0
      ? `tăng ${snapshot.comparison.clicksDelta} lượt nhấp (${snapshot.comparison.clicksDeltaLabel})`
      : `giảm ${Math.abs(snapshot.comparison.clicksDelta)} lượt nhấp (${snapshot.comparison.clicksDeltaLabel})`;

  return [
    `BÁO CÁO PHÂN TÍCH TÌM KIẾM TỰ NHIÊN & TỪ KHÓA (${siteLabel})`,
    `Kỳ báo cáo: ${snapshot.current.startDate} đến ${snapshot.current.endDate} (Đối chiếu kỳ trước: ${snapshot.previous.startDate} đến ${snapshot.previous.endDate})`,
    '',
    'I. TỔNG QUAN HIỆU SUẤT TÌM KIẾM & ĐỐI CHIẾU KỲ TRƯỚC',
    `• Lượt nhấp tìm kiếm (Clicks): đạt ${snapshot.current.totalClicks} lượt (kỳ trước đạt ${snapshot.previous.totalClicks} lượt, ${clicksTrendText}) [Đối chiếu GSC: Tổng Clicks kỳ hiện tại & kỳ trước].`,
    `• Lượt hiển thị tìm kiếm (Impressions): đạt ${snapshot.current.totalImpressions} lượt (kỳ trước đạt ${snapshot.previous.totalImpressions} lượt, biến động ${snapshot.comparison.impressionsDeltaLabel}) [Đối chiếu GSC: Tổng Impressions kỳ hiện tại & kỳ trước].`,
    `• Tỷ lệ nhấp tổng hợp (CTR): đạt ${snapshot.current.overallCtrPct}% (kỳ trước đạt ${snapshot.previous.overallCtrPct}%, chênh lệch ${snapshot.comparison.ctrDeltaPctPoints >= 0 ? '+' : ''}${snapshot.comparison.ctrDeltaPctPoints} điểm phần trăm) [Đối chiếu GSC: CTR trung bình toàn kỳ].`,
    `• Lead hợp lệ ghi nhận từ website trong kỳ: ${snapshot.leadsFromWebsiteCount} Lead (lưu ý: chỉ các Lead có tham số UTM/nguồn tìm kiếm mới khẳng định từ kênh Organic; phần thiếu UTM chưa đủ bằng chứng phân bổ kênh) [Đối chiếu CRM: Hồ sơ Lead L2 trong kỳ].`,
    ...(snapshot.dataCompleteness.warnings.length > 0
      ? ['', 'Lưu ý về độ mới và phần thiếu dữ liệu:', ...snapshot.dataCompleteness.warnings.map((w) => `• ${w}`)]
      : []),
    '',
    'II. BẰNG CHỨNG DỮ LIỆU TỪ TỪ KHÓA & TRANG ĐÍCH (GSC)',
    '1. Nhóm từ khóa đóng góp lượt nhấp / hiển thị cao nhất:',
    topKwLines.replace(/\[Tham chiếu: bảng topKeywords\]/g, '[Đối chiếu GSC: Bảng từ khóa topKeywords]') ||
      '• Chưa ghi nhận từ khóa chi tiết phát sinh lượt nhấp trong kỳ này [Đối chiếu GSC: topKeywords].',
    ...(topPageLines
      ? ['', '2. Các trang đích đóng góp truy cập tìm kiếm cao nhất:', topPageLines.replace(/\[Tham chiếu: bảng topPages\]/g, '[Đối chiếu GSC: Bảng trang đích topPages]')]
      : []),
    '',
    'III. GIẢ THUYẾT NGUYÊN NHÂN (CẦN KIỂM CHỨNG THÊM)',
    snapshot.current.overallCtrPct < 3
      ? `• Giả thuyết 1: CTR tổng hợp đạt ${snapshot.current.overallCtrPct}% trên ${snapshot.current.totalImpressions} lượt hiển thị cho thấy thẻ tiêu đề (Title) hoặc mô tả tìm kiếm (Meta Description) có thể chưa sát ý định tra cứu báo giá thực tế${snapshot.current.weightedAvgPosition ? ` ở vùng vị trí trung bình ${snapshot.current.weightedAvgPosition}` : ''} (giả thuyết phân tích, chưa đủ bằng chứng kết luận nguyên nhân thuật toán).`
      : `• Giả thuyết 1: CTR đạt ${snapshot.current.overallCtrPct}% cho thấy thông điệp tiêu đề đang phù hợp nhóm truy vấn thương hiệu và sản phẩm cốt lõi; biến động lượt nhấp chủ yếu phụ thuộc nhu cầu tìm kiếm theo tuần.`,
    snapshot.comparison.clicksDelta < 0
      ? `• Giả thuyết 2: Mức giảm ${Math.abs(snapshot.comparison.clicksDelta)} lượt nhấp có thể đến từ độ trễ chốt sổ tự nhiên của Google Search Console ở những ngày cuối kỳ hoặc biến động hiển thị trên nhóm từ khóa ngách.`
      : `• Giả thuyết 2: Mức tăng hoặc giữ nhịp lượt nhấp phản ánh các URL chủ lực đang giữ ổn định chỉ mục tìm kiếm.`,
    '',
    'IV. ĐỀ XUẤT CÔNG VIỆC ƯU TIÊN & CÁCH ĐO LƯỜNG KẾT QUẢ',
    '1. Tối ưu Title & Meta Description cho nhóm từ khóa có hiển thị cao nhưng CTR thấp trong bảng Cơ hội; đưa trực tiếp các chủ đề đề xuất bên dưới vào Kế hoạch nội dung SEO.',
    '2. Rà soát nội dung kỹ thuật, hình ảnh dự án thực tế và biểu mẫu liên hệ có gắn tham số nguồn trên các trang đích top đầu để đủ bằng chứng đối soát Lead.',
    '3. Cách kiểm chứng: So sánh lại CTR, vị trí trung bình và lượt nhấp của đúng các URL/từ khóa đã chỉnh sửa trên Search Console sau 14 ngày kể từ thời điểm Google thu thập lại dữ liệu.',
  ]
    .filter((s) => s !== undefined)
    .join('\n');
}

export function validateAiClaimsAgainstSnapshot(
  content: string,
  snapshot: SeoComparisonSnapshot,
): SeoClaimValidationResult {
  const violations: string[] = [];
  const clicksSet = new Set<number>([
    snapshot.current.totalClicks,
    snapshot.previous.totalClicks,
    Math.abs(snapshot.comparison.clicksDelta),
  ]);
  const impressionsSet = new Set<number>([
    snapshot.current.totalImpressions,
    snapshot.previous.totalImpressions,
    Math.abs(snapshot.comparison.impressionsDelta),
  ]);
  const ctrSet = new Set<number>([
    snapshot.current.overallCtrPct,
    snapshot.previous.overallCtrPct,
    Math.abs(snapshot.comparison.ctrDeltaPctPoints),
  ]);
  const positionSet = new Set<number>();
  if (snapshot.current.weightedAvgPosition != null) positionSet.add(snapshot.current.weightedAvgPosition);
  if (snapshot.previous.weightedAvgPosition != null) positionSet.add(snapshot.previous.weightedAvgPosition);
  const leadsSet = new Set<number>([snapshot.leadsFromWebsiteCount]);

  for (const kw of snapshot.topKeywords) {
    clicksSet.add(kw.clicks);
    clicksSet.add(kw.prevClicks);
    clicksSet.add(Math.abs(kw.clicksDelta));
    impressionsSet.add(kw.impressions);
    ctrSet.add(kw.ctrPct);
    if (kw.avgPosition != null) positionSet.add(kw.avgPosition);
  }
  for (const pg of snapshot.topPages) {
    clicksSet.add(pg.clicks);
    impressionsSet.add(pg.impressions);
    ctrSet.add(pg.ctrPct);
    if (pg.avgPosition != null) positionSet.add(pg.avgPosition);
  }

  const keywordEmbeddedNumbers = new Set<number>();
  for (const kw of [...snapshot.topKeywords, ...(snapshot.recommendedTopics || [])]) {
    const matches = String(kw.keyword || '').match(/\d+(?:\.\d+)?/g) || [];
    for (const m of matches) {
      const n = Number(m);
      if (Number.isFinite(n)) keywordEmbeddedNumbers.add(n);
    }
    const r = kw as { impressions?: number; clicks?: number; ctrPct?: number; avgPosition?: number | null };
    if (typeof r.impressions === 'number') impressionsSet.add(r.impressions);
    if (typeof r.clicks === 'number') clicksSet.add(r.clicks);
    if (typeof r.ctrPct === 'number') ctrSet.add(r.ctrPct);
    if (typeof r.avgPosition === 'number') positionSet.add(r.avgPosition);
  }

  const allAllowedNumbers = new Set<number>([
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 20, 24, 28, 30, 48, 60, 90, 100,
    2025, 2026, 2027,
    snapshot.periodDays,
    snapshot.dataCompleteness.expectedDays,
    snapshot.dataCompleteness.currentDaysWithData,
    snapshot.dataCompleteness.previousDaysWithData,
    ...clicksSet,
    ...impressionsSet,
    ...ctrSet,
    ...positionSet,
    ...leadsSet,
    ...keywordEmbeddedNumbers,
  ]);
  if (snapshot.comparison.clicksDeltaPct != null) {
    allAllowedNumbers.add(Math.abs(snapshot.comparison.clicksDeltaPct));
    allAllowedNumbers.add(Number(Math.abs(snapshot.comparison.clicksDeltaPct).toFixed(1)));
  }
  if (snapshot.comparison.impressionsDeltaPct != null) {
    allAllowedNumbers.add(Math.abs(snapshot.comparison.impressionsDeltaPct));
    allAllowedNumbers.add(Number(Math.abs(snapshot.comparison.impressionsDeltaPct).toFixed(1)));
  }

  const normalizeClauseNumbers = (raw: string): string => {
    // Normalize dot-grouped thousands (e.g. 1.409 or 59.464 -> 1409 or 59464) when matching allowed totals
    let out = raw.replace(/\b(\d{1,3}(?:\.\d{3})+)\b/g, (full) => {
      const plain = Number(full.replace(/\./g, ''));
      return allAllowedNumbers.has(plain) ? String(plain) : full;
    });
    // Normalize comma decimal notation in Vietnamese percentages/decimals (3,08 -> 3.08)
    out = out.replace(/(\d+),(\d+)/g, '$1.$2');
    return out;
  };

  const allowedDates = new Set<string>([
    snapshot.current.startDate,
    snapshot.current.endDate,
    snapshot.previous.startDate,
    snapshot.previous.endDate,
  ]);

  // 1. Kiểm tra ngày/kỳ báo cáo (PERIOD_MISATTRIBUTION theo ngày YYYY-MM-DD)
  const dateMatches = content.match(/\b20\d{2}-\d{2}-\d{2}\b/g) || [];
  for (const d of dateMatches) {
    if (!allowedDates.has(d)) {
      violations.push(`PERIOD_MISATTRIBUTION: Ngày ${d} không thuộc kỳ hiện tại (${snapshot.current.startDate}..${snapshot.current.endDate}) hoặc kỳ trước (${snapshot.previous.startDate}..${snapshot.previous.endDate}).`);
    }
  }

  const knownDomains = ['toantrung.com.vn', 'bangled.vn', 'manhinhled.net.vn'];
  const normalizedSnapshotSite = snapshot.website.toLowerCase();
  const isSingleSiteSnapshot = knownDomains.includes(normalizedSnapshotSite);

  const clauses = content.split(/\r?\n|(?<=[.!?;])\s+/);

  for (const rawClause of clauses) {
    const clause = normalizeClauseNumbers(rawClause.trim());
    if (!clause) continue;
    const lowerClause = clause.toLowerCase();

    // 2. Kiểm tra gán nhầm Website (WEBSITE_MISATTRIBUTION)
    if (isSingleSiteSnapshot) {
      for (const dom of knownDomains) {
        if (dom !== normalizedSnapshotSite && lowerClause.includes(dom)) {
          violations.push(`WEBSITE_MISATTRIBUTION: Snapshot của "${snapshot.website}" nhưng nội dung lại gán dữ liệu cho website "${dom}".`);
        }
      }
    }

    // 3. Kiểm tra gán nhầm URL trang đích (URL_METRIC_MISATTRIBUTION)
    const matchedPages = snapshot.topPages.filter(
      (pg) => pg.pageUrl && lowerClause.includes(pg.pageUrl.toLowerCase()),
    );
    if (matchedPages.length === 1) {
      const targetPage = matchedPages[0];
      const pageAllowedMetrics = new Set<number>([
        targetPage.clicks,
        targetPage.impressions,
        targetPage.ctrPct,
        ...(targetPage.avgPosition != null ? [targetPage.avgPosition] : []),
      ]);
      const clickMatches = Array.from(lowerClause.matchAll(/(\d+(?:\.\d+)?)\s*(?:clicks|lượt nhấp)/gi));
      for (const m of clickMatches) {
        const val = Number(m[1]);
        if (val !== targetPage.clicks) {
          violations.push(
            `URL_METRIC_MISATTRIBUTION: URL "${targetPage.pageUrl}" có ${targetPage.clicks} clicks trong snapshot nhưng bị gán nhầm thành ${val} clicks.`,
          );
        }
      }
      const imprMatches = Array.from(lowerClause.matchAll(/(\d+(?:\.\d+)?)\s*(?:impressions|lượt hiển thị)/gi));
      for (const m of imprMatches) {
        const val = Number(m[1]);
        if (val !== targetPage.impressions) {
          violations.push(
            `URL_METRIC_MISATTRIBUTION: URL "${targetPage.pageUrl}" có ${targetPage.impressions} impressions trong snapshot nhưng bị gán nhầm thành ${val} impressions.`,
          );
        }
      }
      void pageAllowedMetrics;
    }

    // 4. Kiểm tra gán nhầm Chỉ số (METRIC_TYPE_MISATTRIBUTION)
    const clickPairs = [
      ...Array.from(lowerClause.matchAll(/(\d+(?:\.\d+)?)\s*(?:clicks|lượt nhấp)/gi)).map((m) => Number(m[1])),
      ...Array.from(lowerClause.matchAll(/(?:lượt nhấp\s*\(clicks\)|lượt nhấp|clicks)\s*[:=]\s*(\d+(?:\.\d+)?)/gi)).map((m) => Number(m[1])),
    ];
    for (const val of clickPairs) {
      if (!clicksSet.has(val)) {
        violations.push(`METRIC_TYPE_MISATTRIBUTION: Con số ${val} được gán là Clicks/Lượt nhấp nhưng không khớp bất kỳ chỉ số Clicks nào trong snapshot.`);
      }
    }

    const imprPairs = [
      ...Array.from(lowerClause.matchAll(/(\d+(?:\.\d+)?)\s*(?:impressions|lượt hiển thị)/gi)).map((m) => Number(m[1])),
      ...Array.from(lowerClause.matchAll(/(?:lượt hiển thị\s*\(impressions\)|lượt hiển thị|impressions)\s*[:=]\s*(\d+(?:\.\d+)?)/gi)).map((m) => Number(m[1])),
    ];
    for (const val of imprPairs) {
      if (!impressionsSet.has(val)) {
        violations.push(`METRIC_TYPE_MISATTRIBUTION: Con số ${val} được gán là Impressions/Lượt hiển thị nhưng không khớp bất kỳ chỉ số Impressions nào trong snapshot.`);
      }
    }

    const leadPairs = [
      ...Array.from(lowerClause.matchAll(/(\d+(?:\.\d+)?)\s*lead\b/gi)).map((m) => Number(m[1])),
      ...Array.from(lowerClause.matchAll(/(?:số lead[^:=\d]*|lead ghi nhận[^:=\d]*)\s*[:=]\s*(\d+(?:\.\d+)?)/gi)).map((m) => Number(m[1])),
    ];
    for (const val of leadPairs) {
      if (!leadsSet.has(val)) {
        violations.push(`METRIC_TYPE_MISATTRIBUTION: Con số ${val} được gán là số Lead nhưng snapshot ghi nhận ${snapshot.leadsFromWebsiteCount} Lead.`);
      }
    }

    // 5. Kiểm tra gán nhầm Kỳ báo cáo (PERIOD_MISATTRIBUTION giữa kỳ này và kỳ trước)
    const mentionsPrevOnly =
      (lowerClause.includes('kỳ trước') || lowerClause.includes('ky truoc')) &&
      !lowerClause.includes('kỳ hiện tại') &&
      !lowerClause.includes('kỳ này') &&
      !lowerClause.includes('so với kỳ trước') &&
      !lowerClause.includes('lượt nhấp (clicks):') &&
      !lowerClause.includes('lượt hiển thị (impressions):');
    if (mentionsPrevOnly) {
      for (const val of clickPairs) {
        const prevClickAllowed = new Set<number>([
          snapshot.previous.totalClicks,
          ...snapshot.topKeywords.map((k) => k.prevClicks),
        ]);
        if (!prevClickAllowed.has(val) && val === snapshot.current.totalClicks && snapshot.current.totalClicks !== snapshot.previous.totalClicks) {
          violations.push(`PERIOD_MISATTRIBUTION: Con số ${val} clicks của kỳ hiện tại bị gán nhầm sang kỳ trước (kỳ trước là ${snapshot.previous.totalClicks}).`);
        }
      }
      for (const val of imprPairs) {
        if (val === snapshot.current.totalImpressions && snapshot.current.totalImpressions !== snapshot.previous.totalImpressions) {
          violations.push(`PERIOD_MISATTRIBUTION: Con số ${val} impressions của kỳ hiện tại bị gán nhầm sang kỳ trước (kỳ trước là ${snapshot.previous.totalImpressions}).`);
        }
      }
    }

    // 6. Kiểm tra số bịa ngoài snapshot (UNVERIFIED_NUMBER)
    const strippedClause = clause
      .replace(/\b20\d{2}-\d{2}-\d{2}\b/g, ' ')
      .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, ' ')
      .replace(/https?:\/\/[^\s)]+/gi, ' ')
      .replace(/\/[a-z0-9._/-]+/gi, ' ');
    const numTokens = strippedClause.match(/(?<![a-zA-Z0-9_])\d+(?:\.\d+)?(?![a-zA-Z0-9_])/g) || [];
    for (const tok of numTokens) {
      const n = Number(tok);
      if (!Number.isFinite(n)) continue;
      if (!allAllowedNumbers.has(n)) {
        violations.push(`UNVERIFIED_NUMBER: Con số ${n} không tồn tại trong dữ liệu snapshot đã tính.`);
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

const globalSeoReportStore = globalThis as unknown as {
  __toantrungSeoReportLocks?: Map<string, Promise<SeoAiReportRecord>>;
};

function getInFlightSeoReportLocks(): Map<string, Promise<SeoAiReportRecord>> {
  if (!globalSeoReportStore.__toantrungSeoReportLocks) {
    globalSeoReportStore.__toantrungSeoReportLocks = new Map();
  }
  return globalSeoReportStore.__toantrungSeoReportLocks;
}

export async function listSeoAiReports(): Promise<SeoAiReportRecord[]> {
  const cached = await getOrComputeScopedCache<SeoAiReportRecord[]>({
    key: 'seo-ai-reports-list',
    domains: ['seo_reports'],
    ttlMs: 60_000,
    compute: async () => {
      const row = await prisma.systemSetting.findUnique({
        where: { key: SETTING_KEY_SEO_AI_REPORTS },
      });
      if (!row?.value) return [];
      try {
        const parsed = JSON.parse(row.value);
        if (!Array.isArray(parsed)) return [];
        return parsed.map((item: SeoAiReportRecord) => ({
          ...item,
          generationMode:
            item.generationMode ||
            (item.modelUsed && item.modelUsed !== 'grounded-snapshot-template' && item.modelUsed !== 'deterministic-snapshot-engine'
              ? 'LIVE_AI'
              : 'DETERMINISTIC_FALLBACK'),
          fallbackReason: item.fallbackReason ?? null,
          validationResult: item.validationResult || { valid: true, violations: [] },
        }));
      } catch {
        return [];
      }
    },
  });
  return cached.data;
}

export async function getLatestSeoAiReportExcerptCached(): Promise<{
  id: string;
  title: string;
  generatedAt: string;
  excerpt: string;
} | null> {
  const list = await listSeoAiReports();
  const latest = list[0];
  if (!latest) return null;
  const rawContent = (latest.editedContent || latest.aiOriginalContent || '').trim();
  const firstLines = rawContent
    .split(/\r?\n/)
    .map((l: string) => l.replace(/^[#*\-\s]+/, '').trim())
    .filter(Boolean);
  const excerpt = firstLines.slice(0, 3).join(' · ').slice(0, 220);
  return {
    id: latest.id,
    title: firstLines[0] || `Báo cáo SEO AI (${latest.website || 'Toàn hệ thống'})`,
    generatedAt: latest.snapshot?.generatedAt || latest.updatedAt || latest.createdAt,
    excerpt,
  };
}

async function saveSeoAiReportsList(reports: SeoAiReportRecord[]): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEY_SEO_AI_REPORTS },
    update: { value: JSON.stringify(reports.slice(0, 50)) },
    create: {
      key: SETTING_KEY_SEO_AI_REPORTS,
      value: JSON.stringify(reports.slice(0, 50)),
    },
  });
  bumpDomainRevisions(['seo_reports', 'ads', 'reports'], 'seo_ai_report_saved');
}

export async function generateSeoAiReportFromSnapshot(params: {
  user: SessionUserDto;
  website: string;
  periodDays: number;
  endDate?: string;
}): Promise<SeoAiReportRecord> {
  const lockKey = `${params.user.id}:${params.website}:${params.periodDays}:${params.endDate || 'today'}`;
  const locks = getInFlightSeoReportLocks();
  const existingLock = locks.get(lockKey);
  if (existingLock) {
    return existingLock;
  }

  const run = async (): Promise<SeoAiReportRecord> => {
    const snapshot = await buildSeoComparisonSnapshot({
      website: params.website,
      periodDays: params.periodDays,
      endDate: params.endDate,
    });

    let aiContent = buildFallbackSeoReportText(snapshot);
    let modelUsed = 'deterministic-snapshot-engine';
    let generationMode: 'LIVE_AI' | 'DETERMINISTIC_FALLBACK' = 'DETERMINISTIC_FALLBACK';
    let fallbackReason: string | null = 'MISSING_GEMINI_API_KEY';
    let validationResult: SeoClaimValidationResult = validateAiClaimsAgainstSnapshot(aiContent, snapshot);

    const apiKey = resolveLiveGeminiApiKey();
    if (apiKey) {
      const candidateModels = Array.from(
        new Set(
          [
            process.env.GEMINI_TEXT_MODEL?.trim(),
            'gemini-3-flash-preview',
            'gemini-2.5-flash',
          ].filter((m): m is string => Boolean(m)),
        ),
      );
      const compactSnapshot = {
        website: snapshot.website,
        periodDays: snapshot.periodDays,
        current: snapshot.current,
        previous: snapshot.previous,
        comparison: snapshot.comparison,
        leadsFromWebsiteCount: snapshot.leadsFromWebsiteCount,
        dataCompleteness: snapshot.dataCompleteness,
        topKeywords: snapshot.topKeywords.slice(0, 12),
        topPages: snapshot.topPages.slice(0, 8),
        recommendedTopics: (snapshot.recommendedTopics || []).slice(0, 6).map((t) => ({
          keyword: t.keyword,
          targetWebsite: t.targetWebsite,
          priorityCategory: t.priorityCategory,
          impressions: t.impressions,
          clicks: t.clicks,
          ctrPct: t.ctrPct,
          avgPosition: t.avgPosition,
        })),
      };
      const prompt = [
        'Bạn là chuyên gia phân tích SEO B2B cho Công ty Điện tử Viễn thông Toàn Trung (Màn hình LED, Bảng điện tử).',
        'QUY TẮC BẮT BUỘC:',
        '1. CHỈ ĐƯỢC sử dụng đúng con số, từ khóa và URL có trong JSON SNAPSHOT bên dưới. TUYỆT ĐỐI KHÔNG tự suy đoán hay thêm bất kỳ con số nào khác ngoài snapshot.',
        '2. KHÔNG dùng dấu chấm phân tách hàng nghìn khi viết số (ví dụ viết 1409 thay vì 1.409, viết 59464 thay vì 59.464); giữ nguyên dấu chấm thập phân (ví dụ 2.37%).',
        '3. Không gán nhầm số liệu giữa các website, giữa các từ khóa/URL, giữa Clicks với Impressions hay giữa kỳ này với kỳ trước.',
        '4. Trình bày đúng 4 đề mục tiếng Việt theo thứ tự sau (không dùng ký tự Markdown # hay bảng):',
        `BÁO CÁO PHÂN TÍCH TÌM KIẾM TỰ NHIÊN & TỪ KHÓA (${snapshot.website === 'all' ? 'toàn bộ hệ thống website' : snapshot.website})`,
        `Kỳ báo cáo: ${snapshot.current.startDate} đến ${snapshot.current.endDate} (Đối chiếu kỳ trước: ${snapshot.previous.startDate} đến ${snapshot.previous.endDate})`,
        'I. TỔNG QUAN HIỆU SUẤT TÌM KIẾM & ĐỐI CHIẾU KỲ TRƯỚC',
        'II. BẰNG CHỨNG DỮ LIỆU TỪ TỪ KHÓA & TRANG ĐÍCH (GSC)',
        'III. GIẢ THUYẾT NGUYÊN NHÂN (CẦN KIỂM CHỨNG THÊM)',
        'IV. ĐỀ XUẤT CÔNG VIỆC ƯU TIÊN & CÁCH ĐO LƯỜNG KẾT QUẢ',
        '5. Ở cuối mỗi nhận định có số liệu thuộc Mục I và Mục II, gắn nhãn trích dẫn ngắn: [Đối chiếu GSC: <mô tả ngắn nguồn từ khóa/URL/chỉ số>].',
        '6. Mục III phải nêu rõ là "Giả thuyết" cần kiểm chứng, không khẳng định chắc chắn nguyên nhân khi dữ liệu GSC chưa đủ bằng chứng.',
        '',
        'JSON SNAPSHOT:',
        JSON.stringify(compactSnapshot),
      ].join('\n');

      for (let i = 0; i < candidateModels.length; i++) {
        const model = candidateModels[i];
        const startedAt = Date.now();
        try {
          const resp = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.15, maxOutputTokens: 2048 },
              }),
              signal: AbortSignal.timeout(22_000),
            },
          );
          const durationMs = Date.now() - startedAt;

          if (!resp.ok) {
            const errTxt = (await resp.text()).slice(0, 200);
            fallbackReason = `GEMINI_HTTP_${resp.status}`;
            await recordAiUsageAttempt(prisma, {
              idempotencyKey: `seo-report-${params.user.id}-${startedAt}-${model}`,
              attemptNumber: i + 1,
              moduleCode: '03-keywords-ads',
              taskType: 'seo_draft',
              userId: params.user.id,
              modelName: model,
              durationMs,
              status: 'failed',
              errorMessage: `HTTP ${resp.status}: ${errTxt}`,
            }).catch(() => null);
            continue;
          }

          const json = (await resp.json()) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
            usageMetadata?: {
              promptTokenCount?: number;
              candidatesTokenCount?: number;
              totalTokenCount?: number;
            };
          };
          const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n').trim();
          if (!text || text.length <= 80) {
            fallbackReason = 'AI_EMPTY_RESPONSE';
            await recordAiUsageAttempt(prisma, {
              idempotencyKey: `seo-report-${params.user.id}-${startedAt}-${model}`,
              attemptNumber: i + 1,
              moduleCode: '03-keywords-ads',
              taskType: 'seo_draft',
              userId: params.user.id,
              modelName: model,
              durationMs,
              promptTokens: json.usageMetadata?.promptTokenCount ?? null,
              completionTokens: json.usageMetadata?.candidatesTokenCount ?? null,
              totalTokens: json.usageMetadata?.totalTokenCount ?? null,
              status: 'failed',
              errorMessage: 'AI_EMPTY_RESPONSE',
            }).catch(() => null);
            continue;
          }

          const check = validateAiClaimsAgainstSnapshot(text, snapshot);
          await recordAiUsageAttempt(prisma, {
            idempotencyKey: `seo-report-${params.user.id}-${startedAt}-${model}`,
            attemptNumber: i + 1,
            moduleCode: '03-keywords-ads',
            taskType: 'seo_draft',
            userId: params.user.id,
            modelName: model,
            durationMs,
            promptTokens: json.usageMetadata?.promptTokenCount ?? null,
            completionTokens: json.usageMetadata?.candidatesTokenCount ?? null,
            totalTokens: json.usageMetadata?.totalTokenCount ?? null,
            status: check.valid ? 'success' : 'failed',
            errorMessage: check.valid ? null : check.violations[0] || 'AI_CLAIM_REJECTED',
          }).catch(() => null);

          if (check.valid) {
            aiContent = text;
            modelUsed = model;
            generationMode = 'LIVE_AI';
            fallbackReason = null;
            validationResult = check;
            break;
          } else {
            fallbackReason = `AI_CLAIM_REJECTED: ${check.violations[0]}`;
          }
        } catch (err) {
          const durationMs = Date.now() - startedAt;
          const msg = err instanceof Error ? err.message : 'unknown';
          fallbackReason = `GEMINI_NETWORK_ERROR: ${msg}`;
          await recordAiUsageAttempt(prisma, {
            idempotencyKey: `seo-report-${params.user.id}-${startedAt}-${model}`,
            attemptNumber: i + 1,
            moduleCode: '03-keywords-ads',
            taskType: 'seo_draft',
            userId: params.user.id,
            modelName: model,
            durationMs,
            status: /abort|timeout/i.test(msg) ? 'timeout' : 'failed',
            errorMessage: msg,
          }).catch(() => null);
        }
      }
    }

    const nowIso = new Date().toISOString();
    const record: SeoAiReportRecord = {
      id: `seo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      website: snapshot.website,
      periodDays: snapshot.periodDays,
      snapshot,
      aiOriginalContent: aiContent,
      editedContent: aiContent,
      modelUsed,
      generationMode,
      fallbackReason,
      validationResult,
      createdByUserId: params.user.id,
      createdByName: params.user.fullName,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const existing = await listSeoAiReports();
    await saveSeoAiReportsList([record, ...existing]);
    return record;
  };

  const promise = run().finally(() => {
    locks.delete(lockKey);
  });
  locks.set(lockKey, promise);
  return promise;
}

export async function updateSeoAiReportEditedContent(params: {
  reportId: string;
  editedContent: string;
}): Promise<SeoAiReportRecord | null> {
  const existing = await listSeoAiReports();
  const idx = existing.findIndex((r) => r.id === params.reportId);
  if (idx === -1) return null;

  const validationResult = validateAiClaimsAgainstSnapshot(
    params.editedContent,
    existing[idx].snapshot,
  );

  // Giữ nguyên aiOriginalContent và snapshot gốc, chỉ cập nhật editedContent & updatedAt (M03-08)
  const updated: SeoAiReportRecord = {
    ...existing[idx],
    editedContent: params.editedContent,
    validationResult,
    updatedAt: new Date().toISOString(),
  };
  existing[idx] = updated;
  await saveSeoAiReportsList(existing);
  return updated;
}

export function exportSeoReportXlsxBuffer(report: SeoAiReportRecord): Buffer {
  const s = report.snapshot;
  const contentLines = (report.editedContent || '').split(/\r?\n/).map((line, i) => ({
    lineNo: i + 1,
    content: line,
  }));

  return buildStandardXlsxBuffer([
    {
      name: 'Tong_Quan_SEO',
      title: `Báo cáo SEO Snapshot — ${report.website}`,
      metadata: [
        { label: 'Mã báo cáo', value: report.id },
        { label: 'Website', value: report.website },
        { label: 'Nguồn dữ liệu', value: s.sourcePlatform },
        { label: 'Chế độ sinh báo cáo', value: report.generationMode === 'LIVE_AI' ? `AI Thật (${report.modelUsed})` : `Đối chứng tự động từ Snapshot (Fallback: ${report.fallbackReason || 'N/A'})` },
        { label: 'Kỳ hiện tại', value: `${s.current.startDate} → ${s.current.endDate} (${s.current.daysWithData}/${s.periodDays} ngày có dữ liệu)` },
        { label: 'Kỳ trước', value: `${s.previous.startDate} → ${s.previous.endDate} (${s.previous.daysWithData}/${s.periodDays} ngày có dữ liệu)` },
        { label: 'Thời điểm tạo snapshot', value: s.generatedAt },
      ],
      columns: [
        { header: 'Chỉ số', key: 'metric', width: 34, type: 'string' },
        { header: 'Kỳ hiện tại', key: 'currentVal', width: 20, type: 'string' },
        { header: 'Kỳ trước', key: 'prevVal', width: 20, type: 'string' },
        { header: 'Biến động', key: 'deltaLabel', width: 26, type: 'string' },
      ],
      rows: [
        {
          metric: 'Lượt nhấp (Clicks)',
          currentVal: String(s.current.totalClicks),
          prevVal: String(s.previous.totalClicks),
          deltaLabel: s.comparison.clicksDeltaLabel,
        },
        {
          metric: 'Lượt hiển thị (Impressions)',
          currentVal: String(s.current.totalImpressions),
          prevVal: String(s.previous.totalImpressions),
          deltaLabel: s.comparison.impressionsDeltaLabel,
        },
        {
          metric: 'CTR tổng hợp (%)',
          currentVal: `${s.current.overallCtrPct}%`,
          prevVal: `${s.previous.overallCtrPct}%`,
          deltaLabel: `${s.comparison.ctrDeltaPctPoints >= 0 ? '+' : ''}${s.comparison.ctrDeltaPctPoints} điểm %`,
        },
        {
          metric: 'Vị trí trung bình có trọng số',
          currentVal: s.current.weightedAvgPosition != null ? String(s.current.weightedAvgPosition) : '—',
          prevVal: s.previous.weightedAvgPosition != null ? String(s.previous.weightedAvgPosition) : '—',
          deltaLabel: 'Theo Impressions',
        },
        {
          metric: 'Lead ghi nhận từ Website',
          currentVal: String(s.leadsFromWebsiteCount),
          prevVal: '—',
          deltaLabel: 'Trong kỳ hiện tại',
        },
      ],
      footerNotes: s.dataCompleteness.warnings,
    },
    {
      name: 'Top_Tu_Khoa',
      title: `Từ khóa Search Console — ${report.website}`,
      columns: [
        { header: 'Từ khóa', key: 'keyword', width: 36, type: 'string' },
        { header: 'Clicks', key: 'clicks', width: 12, type: 'number' },
        { header: 'Impressions', key: 'impressions', width: 14, type: 'number' },
        { header: 'CTR (%)', key: 'ctrPct', width: 12, type: 'number' },
        { header: 'Vị trí TB', key: 'avgPosition', width: 12, type: 'string' },
        { header: 'Clicks kỳ trước', key: 'prevClicks', width: 16, type: 'number' },
        { header: 'Chênh lệch Clicks', key: 'clicksDelta', width: 16, type: 'number' },
      ],
      rows: s.topKeywords.map((k) => ({
        keyword: k.keyword,
        clicks: k.clicks,
        impressions: k.impressions,
        ctrPct: k.ctrPct,
        avgPosition: k.avgPosition != null ? String(k.avgPosition) : '—',
        prevClicks: k.prevClicks,
        clicksDelta: k.clicksDelta,
      })),
    },
    {
      name: 'Top_Trang_Dich',
      title: `Trang đích SEO — ${report.website}`,
      columns: [
        { header: 'URL Trang đích', key: 'pageUrl', width: 48, type: 'string' },
        { header: 'Clicks', key: 'clicks', width: 12, type: 'number' },
        { header: 'Impressions', key: 'impressions', width: 14, type: 'number' },
        { header: 'CTR (%)', key: 'ctrPct', width: 12, type: 'number' },
        { header: 'Vị trí TB', key: 'avgPosition', width: 12, type: 'string' },
      ],
      rows: s.topPages.map((p) => ({
        pageUrl: p.pageUrl,
        clicks: p.clicks,
        impressions: p.impressions,
        ctrPct: p.ctrPct,
        avgPosition: p.avgPosition != null ? String(p.avgPosition) : '—',
      })),
    },
    {
      name: 'Noi_Dung_Bao_Cao',
      title: `Nội dung phân tích SEO (${report.website})`,
      columns: [
        { header: 'Dòng', key: 'lineNo', width: 8, type: 'number' },
        { header: 'Nội dung báo cáo', key: 'content', width: 90, type: 'string' },
      ],
      rows: contentLines,
    },
  ]);
}

function escXml(val: unknown): string {
  if (val == null) return '';
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildDocxTableXml(headers: string[], rows: string[][]): string {
  const headerCells = headers
    .map(
      (h) =>
        `<w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="1E3A8A"/></w:tcPr><w:p><w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">${escXml(h)}</w:t></w:r></w:p></w:tc>`,
    )
    .join('');

  const bodyRows = rows
    .map((r) => {
      const cells = r
        .map(
          (c) =>
            `<w:tc><w:p><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">${escXml(c)}</w:t></w:r></w:p></w:tc>`,
        )
        .join('');
      return `<w:tr>${cells}</w:tr>`;
    })
    .join('');

  return `<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/></w:tblBorders></w:tblPr><w:tr>${headerCells}</w:tr>${bodyRows}</w:tbl>`;
}

export function exportSeoReportDocxBuffer(report: SeoAiReportRecord): Buffer {
  const s = report.snapshot;
  const modeLabel =
    report.generationMode === 'LIVE_AI'
      ? `AI Thật (${report.modelUsed})`
      : `Đối chứng tự động từ Snapshot (Fallback: ${report.fallbackReason || 'N/A'})`;

  const headerLines = [
    `BÁO CÁO PHÂN TÍCH SEO — ${report.website}`,
    `Mã báo cáo: ${report.id} | Chế độ: ${modeLabel}`,
    `Nguồn: ${s.sourcePlatform} | Kỳ hiện tại: ${s.current.startDate} → ${s.current.endDate} (${s.current.daysWithData}/${s.periodDays} ngày) | Kỳ trước: ${s.previous.startDate} → ${s.previous.endDate} (${s.previous.daysWithData}/${s.periodDays} ngày)`,
    `Thời điểm snapshot: ${s.generatedAt} | Người tạo: ${report.createdByName}`,
  ];

  const kpiTableXml = buildDocxTableXml(
    ['Chỉ số', 'Kỳ hiện tại', 'Kỳ trước', 'Biến động'],
    [
      ['Lượt nhấp (Clicks)', String(s.current.totalClicks), String(s.previous.totalClicks), s.comparison.clicksDeltaLabel],
      ['Lượt hiển thị (Impressions)', String(s.current.totalImpressions), String(s.previous.totalImpressions), s.comparison.impressionsDeltaLabel],
      ['CTR tổng hợp (%)', `${s.current.overallCtrPct}%`, `${s.previous.overallCtrPct}%`, `${s.comparison.ctrDeltaPctPoints >= 0 ? '+' : ''}${s.comparison.ctrDeltaPctPoints} điểm %`],
      ['Vị trí TB có trọng số', s.current.weightedAvgPosition != null ? String(s.current.weightedAvgPosition) : '—', s.previous.weightedAvgPosition != null ? String(s.previous.weightedAvgPosition) : '—', 'Theo Impressions'],
      ['Lead ghi nhận từ Website', String(s.leadsFromWebsiteCount), '—', 'Trong kỳ hiện tại'],
    ],
  );

  const kwTableXml =
    s.topKeywords.length > 0
      ? buildDocxTableXml(
          ['Từ khóa', 'Clicks', 'Impressions', 'CTR (%)', 'Vị trí TB', 'Clicks kỳ trước'],
          s.topKeywords.map((k) => [
            k.keyword,
            String(k.clicks),
            String(k.impressions),
            `${k.ctrPct}%`,
            k.avgPosition != null ? String(k.avgPosition) : '—',
            String(k.prevClicks),
          ]),
        )
      : '';

  const pageTableXml =
    s.topPages.length > 0
      ? buildDocxTableXml(
          ['URL Trang đích', 'Clicks', 'Impressions', 'CTR (%)', 'Vị trí TB'],
          s.topPages.map((p) => [
            p.pageUrl,
            String(p.clicks),
            String(p.impressions),
            `${p.ctrPct}%`,
            p.avgPosition != null ? String(p.avgPosition) : '—',
          ]),
        )
      : '';

  const toParagraph = (line: string, isTitle = false) => {
    const isHeading = isTitle || /^#+\s/.test(line);
    const cleanLine = line.replace(/^#+\s*/, '');
    return `<w:p><w:pPr><w:spacing w:before="60" w:after="100"/></w:pPr><w:r><w:rPr>${
      isHeading ? '<w:b/><w:color w:val="1E3A8A"/>' : ''
    }<w:sz w:val="${isTitle ? 30 : 22}"/></w:rPr><w:t xml:space="preserve">${escXml(cleanLine)}</w:t></w:r></w:p>`;
  };

  const bodyXmlParts = [
    ...headerLines.map((l, idx) => toParagraph(l, idx === 0)),
    toParagraph('## Bảng đối chứng KPI từ Snapshot'),
    kpiTableXml,
    ...(kwTableXml ? [toParagraph('## Bảng Top Từ khóa từ Snapshot'), kwTableXml] : []),
    ...(pageTableXml ? [toParagraph('## Bảng Top Trang đích từ Snapshot'), pageTableXml] : []),
    toParagraph('## Nội dung Báo cáo Phân tích'),
    ...report.editedContent.split(/\r?\n/).map((l) => toParagraph(l, false)),
  ];

  const zip = new ZipArchive();
  zip.addFile(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.addFile(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.addFile(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${bodyXmlParts.join('')}<w:sectPr/></w:body>
</w:document>`,
  );

  return zip.toBuffer();
}
