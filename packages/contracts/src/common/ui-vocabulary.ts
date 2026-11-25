import { CONTACT_CHANNEL_LABELS, PIPELINE_STATUS_LABELS, type ContactChannel, type PipelineStatus } from '../01-leads';

/**
 * C03 — Bộ nhãn & từ điển giao diện thống nhất toàn hệ thống (Sentence case, không từ viết tắt kỹ thuật)
 */
export const UI_VOCABULARY = {
  menu: {
    dashboard: 'Tổng quan',
    leads: 'Lead',
    campaigns: 'Chiến dịch',
    seo: 'Từ khóa & SEO',
    reports: 'Báo cáo',
    design: 'Thiết kế AI',
    notifications: 'Thông báo',
    profile: 'Tài khoản',
    users: 'Nhân sự',
    settings: 'Cài đặt',
  },
  salesStatus: PIPELINE_STATUS_LABELS,
  acceptanceStatus: {
    pending: 'Chờ tiếp nhận',
    accepted: 'Đã tiếp nhận',
  },
  qualityFlags: {
    needsReview: 'Cần kiểm tra',
    suspectedDuplicate: 'Nghi trùng',
    returningCustomer: 'Quay lại',
    suspectedSpam: 'Nghi spam',
  },
  leadTiers: {
    L1: {
      shortLabel: 'Lead tiếp nhận (L1)',
      fullLabel: 'Tổng Lead tiếp nhận (L1)',
      description: 'Toàn bộ yêu cầu liên hệ được ghi nhận trong phạm vi thời gian và website đang chọn.',
    },
    L2: {
      shortLabel: 'Lead hợp lệ (L2)',
      fullLabel: 'Lead hợp lệ (L2)',
      description: 'Lead sau khi trừ các bản ghi đã xác minh là spam; nghi trùng vẫn giữ là Lead hợp lệ.',
    },
    L3: {
      shortLabel: 'Lead hiệu quả (L3)',
      fullLabel: 'Lead hiệu quả (L3)',
      description: 'Lead hợp lệ sau khi trừ spam loại trừ quảng cáo và yêu cầu gửi lặp ngắn hạn theo quy tắc BA.',
    },
  },
  dimensions: {
    sourceWebsite: 'Website nguồn',
    marketingChannel: 'Kênh marketing',
    campaign: 'Chiến dịch',
    contactChannel: 'Hình thức liên hệ',
  },
  fallbacks: {
    unknown: 'Chưa xác định',
    unclassified: 'Chưa phân loại',
    loadError: 'Không tải được dữ liệu',
    unconnected: 'Chưa kết nối',
    insufficientData: 'Chưa đủ dữ liệu',
  },
  freshness: {
    updatedAtPrefix: 'Cập nhật lúc',
    dataThroughPrefix: 'Dữ liệu đến',
    updating: 'Đang cập nhật',
    stale: 'Cập nhật chậm',
    preliminaryToday: 'Số liệu trong ngày đang tạm tính',
  },
  timePresets: {
    TODAY: 'Hôm nay',
    YESTERDAY: 'Hôm qua',
    '7D': '7 ngày gần nhất',
    '30D': '30 ngày gần nhất',
    CUSTOM: 'Tùy chọn',
  },
  actions: {
    createLead: 'Tạo Lead',
    viewDetails: 'Xem chi tiết',
    refresh: 'Làm mới',
    exportExcel: 'Xuất Excel',
    exportWord: 'Xuất Word',
    importExcel: 'Nhập Excel',
  },
} as const;

/**
 * C04 — Từ điển định nghĩa chỉ số chuẩn dùng chung (Canonical Metric Registry)
 */
export interface CanonicalMetricDefinition {
  key: string;
  label: string;
  sourceField: string;
  formula: string;
  unit: 'count' | 'percent' | 'seconds' | 'currency_vnd' | 'position';
  validityCondition: string;
  distinctRule: string;
  timeBasis: string;
  emptyOrZeroDenominatorHandling: string;
}

export const METRIC_DICTIONARY: Record<string, CanonicalMetricDefinition> = {
  receivedLeadCount: {
    key: 'receivedLeadCount',
    label: 'Lead tiếp nhận',
    sourceField: 'leads.id',
    formula: 'COUNT(DISTINCT leads.id)',
    unit: 'count',
    validityCondition: 'Mọi Lead thuộc phạm vi quyền, website và khoảng ngày tạo (createdAt).',
    distinctRule: 'Mỗi hồ sơ Lead là một yêu cầu độc lập; cùng SĐT gửi nhiều dự án hợp lệ không bị gộp.',
    timeBasis: 'leads.createdAt theo múi giờ Asia/Ho_Chi_Minh',
    emptyOrZeroDenominatorHandling: 'Trả 0 khi đã truy vấn thành công nhưng không có phát sinh.',
  },
  validLeadCount: {
    key: 'validLeadCount',
    label: 'Lead hợp lệ',
    sourceField: 'leads.is_spam',
    formula: 'COUNT(DISTINCT leads.id WHERE is_spam = false)',
    unit: 'count',
    validityCondition: 'is_spam = false (nghi trùng hoặc chưa tiếp nhận vẫn tính hợp lệ).',
    distinctRule: 'COUNT DISTINCT theo leads.id',
    timeBasis: 'leads.createdAt theo kỳ đang chọn, trạng thái is_spam hiện tại',
    emptyOrZeroDenominatorHandling: 'Trả 0 khi không có Lead hợp lệ.',
  },
  effectiveLeadCount: {
    key: 'effectiveLeadCount',
    label: 'Lead hiệu quả',
    sourceField: 'leads.is_spam, leads.spam_ads_exclusion_status, marketing_tracking.is_repeat_lead',
    formula: 'COUNT(DISTINCT leads.id WHERE is_spam = false AND spam_ads_exclusion_status NOT IN (auto_excluded, confirmed_excluded) AND COALESCE(is_repeat_lead, false) = false)',
    unit: 'count',
    validityCondition: 'Lead hợp lệ, không thuộc diện loại trừ Ads và không phải yêu cầu lặp ngắn hạn.',
    distinctRule: 'COUNT DISTINCT theo leads.id',
    timeBasis: 'leads.createdAt theo kỳ đang chọn',
    emptyOrZeroDenominatorHandling: 'Trả 0 khi không có Lead hiệu quả.',
  },
  validLead: {
    key: 'validLeadCount',
    label: 'Lead hợp lệ (L2)',
    sourceField: 'leads.is_spam',
    formula: 'COUNT(DISTINCT leads.id WHERE is_spam = false)',
    unit: 'count',
    validityCondition: 'is_spam = false (nghi trùng hoặc chưa tiếp nhận vẫn tính hợp lệ).',
    distinctRule: 'COUNT DISTINCT theo leads.id',
    timeBasis: 'leads.createdAt theo kỳ đang chọn, trạng thái is_spam hiện tại',
    emptyOrZeroDenominatorHandling: 'Trả 0 khi không có Lead hợp lệ.',
  },
  effectiveLead: {
    key: 'effectiveLeadCount',
    label: 'Lead hiệu quả (L3)',
    sourceField: 'leads.is_spam, leads.spam_ads_exclusion_status, marketing_tracking.is_repeat_lead',
    formula: 'COUNT(DISTINCT leads.id WHERE is_spam = false AND spam_ads_exclusion_status NOT IN (auto_excluded, confirmed_excluded) AND COALESCE(is_repeat_lead, false) = false)',
    unit: 'count',
    validityCondition: 'Lead hợp lệ, không thuộc diện loại trừ Ads và không phải yêu cầu lặp ngắn hạn.',
    distinctRule: 'COUNT DISTINCT theo leads.id',
    timeBasis: 'leads.createdAt theo kỳ đang chọn',
    emptyOrZeroDenominatorHandling: 'Trả 0 khi không có Lead hiệu quả.',
  },
  winRatePct: {
    key: 'winRatePct',
    label: 'Tỷ lệ chốt',
    sourceField: 'leads.pipeline_status, leads.is_spam',
    formula: '(wonLeadCount / validLeadCount) * 100',
    unit: 'percent',
    validityCondition: 'Tính trên tập Lead tạo trong kỳ đã chọn với trạng thái xử lý hiện tại.',
    distinctRule: 'Tử số và mẫu số cùng tập cohort Lead tạo trong kỳ.',
    timeBasis: 'Cohort theo leads.createdAt, kết quả pipeline_status hiện tại',
    emptyOrZeroDenominatorHandling: 'Nếu validLeadCount = 0 trả null (hiển thị Chưa đủ dữ liệu).',
  },
  ctrPct: {
    key: 'ctrPct',
    label: 'CTR',
    sourceField: 'platform_daily_metrics.clicks, impressions',
    formula: '(SUM(clicks) / SUM(impressions)) * 100',
    unit: 'percent',
    validityCondition: 'SUM(impressions) > 0 ở cấp tổng hợp phù hợp (account grain).',
    distinctRule: 'Tổng hợp từ tổng click chia tổng hiển thị, không trung bình cộng % từng dòng.',
    timeBasis: 'metric_date theo múi giờ cấu hình nguồn',
    emptyOrZeroDenominatorHandling: 'Nếu SUM(impressions) = 0 hoặc chưa kết nối trả null.',
  },
  cpc: {
    key: 'cpc',
    label: 'CPC trung bình',
    sourceField: 'platform_daily_metrics.spend_micros, clicks',
    formula: '(SUM(spend_micros) / 1_000_000) / SUM(clicks)',
    unit: 'currency_vnd',
    validityCondition: 'Nguồn quảng cáo đã kết nối và SUM(clicks) > 0.',
    distinctRule: 'Không cộng tiền khác đơn vị tiền tệ.',
    timeBasis: 'metric_date trong kỳ chọn',
    emptyOrZeroDenominatorHandling: 'Nếu SUM(clicks) = 0 hoặc chưa kết nối trả null.',
  },
  costPerValidAdLead: {
    key: 'costPerValidAdLead',
    label: 'CPL Lead quảng cáo hợp lệ',
    sourceField: 'platform_daily_metrics.spend_micros, leads + marketing_tracking',
    formula: 'attributedAdCost / validAdLeadCount',
    unit: 'currency_vnd',
    validityCondition: 'Có chi phí quảng cáo thực tế cùng phạm vi và validAdLeadCount > 0 có bằng chứng gclid/utm/google_lead_form.',
    distinctRule: 'Đếm Lead quảng cáo hợp lệ duy nhất.',
    timeBasis: 'Cùng khoảng ngày và phạm vi website đối soát được',
    emptyOrZeroDenominatorHandling: 'Thiếu chi phí hoặc mẫu số = 0 trả null (ghi rõ lý do thiếu đối soát).',
  },
};

const CF7_MACRO_REGEX = /\[(?:your-[a-z0-9_-]+|text-[a-z0-9_-]+|tel-[a-z0-9_-]+|email-[a-z0-9_-]+|menu-[a-z0-9_-]+|textarea-[a-z0-9_-]+)\]/gi;
const RESOLUTION_SUFFIX_REGEX = /\s*\((?:structured_field|metadata_url|verified_form_template|unresolved|gmail_sync|manual)\)\s*$/i;

/**
 * Kiểm tra chuỗi có chứa biến mẫu biểu mẫu chưa thay thế như `[your-subject]` hay không.
 */
export function hasPlaceholderMacro(raw: string | null | undefined): boolean {
  if (!raw) return false;
  CF7_MACRO_REGEX.lastIndex = 0;
  return CF7_MACRO_REGEX.test(raw);
}

/**
 * C06 — Loại bỏ biến mẫu `[your-subject]` khỏi tên dự án/tiêu đề hiển thị mà không sửa dữ liệu lịch sử gốc.
 */
export function sanitizeProjectOrSubjectText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let cleaned = raw.replace(CF7_MACRO_REGEX, '').replace(/["“”]+/g, ' ').replace(/\s+/g, ' ').trim();
  // Nếu sau khi bỏ `[your-subject]` chỉ còn lại tên thương hiệu chung chung ("Toàn Trung", "Bangled", "-") thì coi như chưa có tên dự án cụ thể
  if (
    !cleaned ||
    /^(?:toàn\s*trung|toantrung|bangled|bảng\s*led|form\s*báo\s*giá|-+|—+)$/i.test(cleaned)
  ) {
    return null;
  }
  return cleaned;
}

/**
 * C06 — Trích xuất phương thức kỹ thuật (`structured_field`, `metadata_url`...) cho phần kiểm tra chi tiết,
 * đồng thời trả về chuỗi sạch cho giao diện thường.
 */
export function sanitizeWebsiteSourceDisplay(raw: string | null | undefined): {
  cleanLabel: string | null;
  technicalMethod: string | null;
} {
  if (!raw) return { cleanLabel: null, technicalMethod: null };
  const match = raw.match(/\((structured_field|metadata_url|verified_form_template|unresolved|gmail_sync)\)\s*$/i);
  const technicalMethod = match ? match[1].toLowerCase() : null;
  const clean = raw.replace(RESOLUTION_SUFFIX_REGEX, '').trim();
  if (!clean || clean.toLowerCase() === 'null' || clean.toLowerCase() === 'undefined') {
    return { cleanLabel: null, technicalMethod };
  }
  return { cleanLabel: clean, technicalMethod };
}

/**
 * C04 & C01 #9 — Tách rõ Kênh marketing thực sự khỏi Hình thức liên hệ và Website nguồn.
 * Không gán Email / Zalo / Nhập tay / thiếu UTM thành "Nguồn tự nhiên / Trực tiếp".
 */
export function normalizeMarketingChannelDisplay(params: {
  marketingSource?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  gclid?: string | null;
  contactChannel?: ContactChannel | string | null;
}): string {
  if (params.gclid || params.contactChannel === 'google_lead_form') {
    return 'Google Ads';
  }
  const med = (params.utmMedium || '').trim().toLowerCase();
  const src = (params.utmSource || '').trim().toLowerCase();
  if (med === 'cpc' || med === 'ppc' || med === 'paid' || src.includes('ads')) {
    return src.includes('facebook') || src.includes('fb') ? 'Quảng cáo Facebook' : 'Google Ads';
  }
  if (med === 'organic') {
    return 'Tìm kiếm tự nhiên';
  }
  if (med === 'social' || src.includes('facebook') || src.includes('tiktok')) {
    return 'Mạng xã hội';
  }
  if (med === 'referral') {
    return 'Website giới thiệu';
  }

  const raw = (params.marketingSource || '').trim();
  const lower = raw.toLowerCase();
  if (!raw || lower === 'chưa xác định' || lower === 'unknown' || lower === '(not set)') {
    return UI_VOCABULARY.fallbacks.unknown;
  }
  // Các giá trị thực chất là hình thức liên hệ hoặc tên website bị lưu nhầm vào marketingSource ở dữ liệu cũ:
  if (
    lower === 'nhập tay' ||
    lower === 'email dự án' ||
    lower === 'email' ||
    lower === 'zalo' ||
    lower === 'hotline' ||
    lower === 'sđt / hotline' ||
    lower === 'website toàn trung' ||
    lower === 'nguồn tự nhiên / trực tiếp'
  ) {
    return UI_VOCABULARY.fallbacks.unknown;
  }
  if (lower.includes('google ads')) return 'Google Ads';
  if (lower.includes('tìm kiếm tự nhiên') || lower === 'organic search') return 'Tìm kiếm tự nhiên';
  if (lower.includes('mạng xã hội') || lower.includes('fanpage')) return 'Mạng xã hội';
  if (lower.includes('giới thiệu')) return 'Website giới thiệu';
  if (lower === 'truy cập trực tiếp' && (params.utmSource || params.utmMedium)) {
    return 'Truy cập trực tiếp';
  }
  return raw;
}

export function formatContactChannelClean(channel: string | null | undefined): string {
  if (!channel) return UI_VOCABULARY.fallbacks.unknown;
  if (channel === 'form_web') return 'Biểu mẫu website';
  if (channel === 'google_lead_form') return 'Biểu mẫu Google Ads';
  return CONTACT_CHANNEL_LABELS[channel as ContactChannel] || channel;
}

export function formatPipelineStatusClean(status: string | null | undefined): string {
  if (!status) return UI_VOCABULARY.fallbacks.unknown;
  return PIPELINE_STATUS_LABELS[status as PipelineStatus] || status;
}

/**
 * C04 & C01 #5 — Hiển thị nhãn phạm vi website đồng bộ tức thì theo bộ lọc đang chọn.
 */
export function resolveWebsiteScopeDisplay(
  websiteId: string | null | undefined,
  availableWebsites: Array<{ websiteId: string; shortName: string; domain: string }> = [],
): string {
  if (!websiteId || websiteId === 'all') {
    return 'Tất cả website';
  }
  const matched = availableWebsites.find(
    (w) => w.websiteId === websiteId || w.domain.toLowerCase() === websiteId.toLowerCase(),
  );
  if (matched) {
    return `${matched.shortName} (${matched.domain})`;
  }
  return websiteId;
}

/**
 * C12 #4 — So sánh kỳ trước an toàn khi mẫu số = 0 (không hiện Infinity% hay phần trăm giả).
 */
export interface SafePeriodComparisonDisplay {
  label: string;
  shortBadge: string;
  tone: 'positive' | 'negative' | 'neutral';
  pctChange: number | null;
  absDiff: number | null;
}

export function formatSafePeriodComparison(
  current: number | null | undefined,
  previous: number | null | undefined,
): SafePeriodComparisonDisplay {
  if (current === null || current === undefined || previous === null || previous === undefined) {
    return {
      label: 'Chưa đủ dữ liệu kỳ trước',
      shortBadge: 'Chưa đủ kỳ trước',
      tone: 'neutral',
      pctChange: null,
      absDiff: null,
    };
  }
  const diff = current - previous;
  if (previous === 0) {
    if (current === 0) {
      return {
        label: 'Không đổi so với kỳ trước (0)',
        shortBadge: '0 → 0',
        tone: 'neutral',
        pctChange: null,
        absDiff: 0,
      };
    }
    return {
      label: `Phát sinh mới +${current.toLocaleString('vi-VN')} (kỳ trước = 0)`,
      shortBadge: `Mới +${current.toLocaleString('vi-VN')}`,
      tone: current > 0 ? 'positive' : 'negative',
      pctChange: null,
      absDiff: diff,
    };
  }

  const pct = Math.round((diff / Math.abs(previous)) * 1000) / 10;
  const sign = diff > 0 ? '+' : '';
  return {
    label: `${sign}${pct}% so với kỳ trước (${previous.toLocaleString('vi-VN')})`,
    shortBadge: `${sign}${pct}%`,
    tone: diff > 0 ? 'positive' : diff < 0 ? 'negative' : 'neutral',
    pctChange: pct,
    absDiff: diff,
  };
}

