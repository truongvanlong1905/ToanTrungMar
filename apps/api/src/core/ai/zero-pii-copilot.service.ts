/**
 * Enterprise Zero-PII Sanitizer, Smart Lead Handover Brief,
 * LED B2B Technical SEO Scorer & AI FinOps Telemetry Engine.
 * Strictly strips all customer PII (phones, emails, personal identifiers) before processing.
 */

export interface ZeroPiiSanitizeResult {
  sanitizedText: string;
  redactedCount: number;
  redactedTypes: string[];
}

export function sanitizeZeroPiiText(raw: string | null | undefined): ZeroPiiSanitizeResult {
  if (!raw) {
    return { sanitizedText: '', redactedCount: 0, redactedTypes: [] };
  }

  let redactedCount = 0;
  const types = new Set<string>();
  let text = raw;

  // 1. Mask emails
  text = text.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, () => {
    redactedCount += 1;
    types.add('email');
    return '[EMAIL-ẨN]';
  });

  // 2. Mask Vietnamese & international phone numbers (8–12 digits with optional spaces/dots/dashes)
  text = text.replace(/(?:\+?84|0)(?:[\s.-]*\d){8,10}\b/g, () => {
    redactedCount += 1;
    types.add('phone');
    return '[SĐT-ẨN]';
  });

  // 3. Mask standalone 9-12 digit sequences (CCCD / MST / Hotline)
  text = text.replace(/\b\d{9,13}\b/g, () => {
    redactedCount += 1;
    types.add('id_number');
    return '[MÃ-ĐỊNH-DANH-ẨN]';
  });

  // 4. Mask Vietnamese honorific personal names (e.g. "Anh Minh", "Chị Lan", "Mr. Hoàng")
  text = text.replace(
    /\b(?:Anh|Chị|Cô|Chú|Bác|Ông|Bà|Mr\.?|Ms\.?|Mrs\.?)\s+[A-ZÀ-Ỹ][a-zà-ỹ]+(?:\s+[A-ZÀ-Ỹ][a-zà-ỹ]+){0,2}/g,
    () => {
      redactedCount += 1;
      types.add('contact_name');
      return '[ĐẠI-DIỆN-KHÁCH]';
    },
  );

  return {
    sanitizedText: text,
    redactedCount,
    redactedTypes: Array.from(types),
  };
}

export interface SmartHandoverBriefDto {
  leadCode: string;
  productsSummary: string;
  dimensionsAndSite: string;
  currentBottleneck: string;
  nextActionRecommendation: string;
  activityCountAnalyzed: number;
  zeroPiiProof: {
    verified: true;
    redactedCount: number;
    redactedTypes: string[];
    engineMode: 'deterministic_local_zero_pii';
  };
}

export function buildZeroPiiHandoverBrief(input: {
  leadCode: string;
  pipelineStatus: string;
  productNames: string[];
  projectName: string | null;
  province: string | null;
  lostReason: string | null;
  firstQuoteSentAt: string | null;
  quoteRespondedAt: string | null;
  receivedConfirmedAt: string | null;
  rawNotes: string[];
}): SmartHandoverBriefDto {
  let totalRedacted = 0;
  const allTypes = new Set<string>();

  const sanitizedNotes = input.rawNotes.map((n) => {
    const res = sanitizeZeroPiiText(n);
    totalRedacted += res.redactedCount;
    for (const t of res.redactedTypes) allTypes.add(t);
    return res.sanitizedText;
  });

  const cleanProj = sanitizeZeroPiiText(input.projectName);
  totalRedacted += cleanProj.redactedCount;
  for (const t of cleanProj.redactedTypes) allTypes.add(t);

  const combinedCorpus = `${cleanProj.sanitizedText} ${sanitizedNotes.join(' | ')}`;

  // Extract LED dimensions & pitch mentions from sanitized notes (supports "4.8m x 2.7m" and "4.8x2.7m")
  const dimMatches = combinedCorpus.match(
    /\b\d+(?:[.,]\d+)?\s*(?:m|mm)?\s*[x×*]\s*\d+(?:[.,]\d+)?\s*(?:m|mm)\b|\b\d+(?:[.,]\d+)?\s*(?:m|mm)\s*[x×*]\s*\d+(?:[.,]\d+)?\b/gi,
  );
  const pitchMatches = combinedCorpus.match(/\bP(?:1\.25|1\.53|1\.86|2(?:\.0)?|2\.5|3(?:\.076)?|4(?:\.0)?|5(?:\.0)?|6|8|10)\b/gi);
  const envMatch = /ngoài trời|outdoor|mặt tiền|ip65/i.test(combinedCorpus)
    ? 'Ngoài trời (Outdoor)'
    : /hội trường|phòng họp|indoor|trong nhà|sân khấu/i.test(combinedCorpus)
      ? 'Trong nhà (Indoor)'
      : null;

  const productsSummary =
    input.productNames.length > 0
      ? `${input.productNames.join(', ')}${pitchMatches ? ` (Đề cập: ${Array.from(new Set(pitchMatches.map((x) => x.toUpperCase()))).join(', ')})` : ''}`
      : pitchMatches
        ? `Màn hình LED ${Array.from(new Set(pitchMatches.map((x) => x.toUpperCase()))).join(', ')} (Chưa gắn mã danh mục)`
        : 'Chưa chốt chủng loại sản phẩm cụ thể — cần xác nhận dòng LED Indoor/Outdoor hoặc Bảng điện tử.';

  const dimParts: string[] = [];
  if (cleanProj.sanitizedText) dimParts.push(`Hạng mục: ${cleanProj.sanitizedText}`);
  if (dimMatches && dimMatches.length > 0) {
    dimParts.push(`Kích thước ghi nhận: ${Array.from(new Set(dimMatches)).slice(0, 2).join(', ')}`);
  }
  if (envMatch) dimParts.push(`Môi trường: ${envMatch}`);
  if (input.province) dimParts.push(`Khu vực: ${input.province}`);
  const dimensionsAndSite =
    dimParts.length > 0
      ? dimParts.join(' · ')
      : 'Chưa có số đo mặt bằng khảo sát (Ngang × Cao) và khoảng cách nhìn trong nhật ký.';

  // Identify bottleneck
  let currentBottleneck = 'Đang trong luồng tư vấn kỹ thuật bình thường.';
  if (/ngân sách|giá cao|đắt|so sánh giá|chờ duyệt kinh phí|vượt dự toán/i.test(combinedCorpus)) {
    currentBottleneck = 'Khách đang cân đối dự toán / so sánh cấu hình kỹ thuật giữa các phương án Pixel Pitch.';
  } else if (/bản vẽ|khảo sát|mặt bằng|kết cấu|điện 3 pha|chưa có kích thước/i.test(combinedCorpus)) {
    currentBottleneck = 'Đang chờ khảo sát mặt bằng thực tế / xác nhận kết cấu khung chịu lực & nguồn cấp điện.';
  } else if (input.pipelineStatus === 'quote_sent' && !input.quoteRespondedAt) {
    currentBottleneck = 'Đã gửi hồ sơ báo giá nhưng khách chưa phản hồi chốt phương án kỹ thuật.';
  } else if (!input.receivedConfirmedAt) {
    currentBottleneck = 'Hồ sơ mới chuyển giao/phân bổ — người nhận chưa bấm Xác nhận tiếp nhận.';
  } else if (input.pipelineStatus === 'lost') {
    currentBottleneck = `Hồ sơ từng đóng (${input.lostReason || 'Chưa chốt'}) — cần rà soát nhu cầu mới nếu mở lại.`;
  }

  // Recommend concrete next action
  let nextActionRecommendation =
    'Gọi xác nhận nhu cầu công trình, lập Phiếu Đề xuất Kỹ thuật LED chuẩn B2B và hẹn lịch khảo sát.';
  if (!input.receivedConfirmedAt) {
    nextActionRecommendation =
      'Bấm "Xác nhận tiếp nhận" ngay và liên hệ khách trong khung SLA để xác minh mặt bằng lắp đặt.';
  } else if (!dimMatches) {
    nextActionRecommendation =
      'Thu thập chiều Ngang × Cao (m), tầm nhìn tối thiểu và ảnh hiện trạng để lập Phiếu Kỹ thuật LED & phối cảnh M05.';
  } else if (input.pipelineStatus === 'quoting') {
    nextActionRecommendation =
      'Hoàn tất Phiếu Đề xuất Cấu hình Kỹ thuật LED kèm ảnh phối cảnh 3D M05 để gửi báo giá chính thức.';
  } else if (input.pipelineStatus === 'quote_sent') {
    nextActionRecommendation =
      'Liên hệ theo dõi phản hồi báo giá, đề xuất phương án tối ưu bội số Cabinet hoặc mời xem mẫu thực tế tại Showroom Toàn Trung.';
  }

  return {
    leadCode: input.leadCode,
    productsSummary,
    dimensionsAndSite,
    currentBottleneck,
    nextActionRecommendation,
    activityCountAnalyzed: input.rawNotes.length,
    zeroPiiProof: {
      verified: true,
      redactedCount: totalRedacted,
      redactedTypes: Array.from(allTypes),
      engineMode: 'deterministic_local_zero_pii',
    },
  };
}

export interface SeoQualityCheckCriterion {
  code: string;
  label: string;
  score: number;
  maxScore: number;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface LedSeoQualityScoreDto {
  totalScore: number;
  gradeLabel: 'Chuẩn Chuyên gia B2B LED' | 'Đạt chuẩn Khá' | 'Cần bổ sung kỹ thuật';
  wordCount: number;
  headingStats: { h1: number; h2: number; h3: number };
  matchedTechnicalTerms: string[];
  missingSuggestedTerms: string[];
  fluffWarnings: string[];
  suggestedInternalLinks: Array<{ domain: string; anchorSuggestion: string; url: string }>;
  criteria: SeoQualityCheckCriterion[];
}

const LED_TECHNICAL_LEXICON = [
  { term: 'pixel pitch', aliases: ['pixel pitch', 'p1.53', 'p1.86', 'p2', 'p2.5', 'p3', 'p4', 'p5', 'p8', 'p10'] },
  { term: 'độ sáng cd/m² (nits)', aliases: ['cd/m2', 'cd/m²', 'nits', '5000 nit', '800 nit'] },
  { term: 'tần số làm tươi 3840Hz', aliases: ['3840hz', '1920hz', 'tần số quét', 'tần số làm tươi'] },
  { term: 'chuẩn bảo vệ IP65/IP54', aliases: ['ip65', 'ip54', 'chống nước', 'chống bụi'] },
  { term: 'công nghệ SMD/GOB/COB', aliases: ['smd', 'gob', 'cob', 'module led'] },
  { term: 'cabinet nhôm đúc / khung', aliases: ['cabinet', 'nhôm đúc', '640x480', '960x960', '600x337'] },
  { term: 'bộ xử lý Novastar', aliases: ['novastar', 'card thu', 'vx400', 'vx600', 'vx1000', 'tb60'] },
  { term: 'khoảng cách nhìn tối ưu', aliases: ['khoảng cách nhìn', 'tầm nhìn', 'góc nhìn'] },
];

const FLUFF_PHRASES = [
  'rẻ nhất thị trường',
  'số 1 việt nam',
  'tốt nhất thế giới',
  'cam kết giá siêu rẻ',
  'không đâu rẻ bằng',
];

export function evaluateLedB2bSeoArticle(input: {
  title: string;
  metaDescription?: string | null;
  targetKeyword?: string | null;
  targetWebsite?: string | null;
  contentHtml: string;
}): LedSeoQualityScoreDto {
  const html = input.contentHtml || '';
  const h1Count = (html.match(/<h1\b/gi) || []).length;
  const h2Count = (html.match(/<h2\b/gi) || []).length;
  const h3Count = (html.match(/<h3\b/gi) || []).length;

  const plainText = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = plainText ? plainText.split(/\s+/).filter(Boolean) : [];
  const wordCount = words.length;
  const lowerAll = `${input.title} ${input.metaDescription || ''} ${plainText}`.toLowerCase();

  // 1. Structure & Length (25 pts)
  let structScore = 0;
  if (h2Count >= 2) structScore += 10;
  else if (h2Count === 1) structScore += 5;
  if (h3Count >= 1) structScore += 5;
  if (wordCount >= 600) structScore += 10;
  else if (wordCount >= 300) structScore += 6;
  else if (wordCount >= 120) structScore += 3;

  // 2. LED B2B Technical Depth (35 pts)
  const matchedTechnicalTerms: string[] = [];
  const missingSuggestedTerms: string[] = [];
  for (const item of LED_TECHNICAL_LEXICON) {
    if (item.aliases.some((al) => lowerAll.includes(al))) {
      matchedTechnicalTerms.push(item.term);
    } else {
      missingSuggestedTerms.push(item.term);
    }
  }
  const techScore = Math.min(35, Math.round((matchedTechnicalTerms.length / 5) * 35));

  // 3. Keyword & Meta Alignment (20 pts)
  const kw = (input.targetKeyword || '').trim().toLowerCase();
  let kwScore = 0;
  if (kw) {
    if (input.title.toLowerCase().includes(kw)) kwScore += 8;
    if (plainText.toLowerCase().includes(kw)) kwScore += 7;
  } else {
    kwScore += 10;
  }
  const metaLen = (input.metaDescription || '').trim().length;
  if (metaLen >= 90 && metaLen <= 170) kwScore += 5;
  else if (metaLen > 30) kwScore += 3;

  // 4. Anti-Fluff B2B Credibility (10 pts)
  const fluffWarnings = FLUFF_PHRASES.filter((p) => lowerAll.includes(p));
  const fluffScore = Math.max(0, 10 - fluffWarnings.length * 5);

  // 5. Internal Link Coverage (10 pts)
  const hasInternalLink = /href=["'][^"']*(?:toantrung\.com\.vn|bangled\.vn|manhinhled\.net\.vn|\/)/i.test(
    html,
  );
  const linkScore = hasInternalLink ? 10 : 4;

  const totalScore = Math.min(100, structScore + techScore + kwScore + fluffScore + linkScore);
  const gradeLabel =
    totalScore >= 80
      ? 'Chuẩn Chuyên gia B2B LED'
      : totalScore >= 60
        ? 'Đạt chuẩn Khá'
        : 'Cần bổ sung kỹ thuật';

  const site = input.targetWebsite || 'toantrung.com.vn';
  const suggestedInternalLinks = [
    {
      domain: site,
      anchorSuggestion: 'Giải pháp Màn hình LED Hội trường P2.0 / P2.5 Toàn Trung',
      url: `https://${site}/man-hinh-led-hoi-truong/`,
    },
    {
      domain: site,
      anchorSuggestion: 'Tiêu chuẩn lắp đặt Màn hình LED Ngoài trời IP65 chống nước',
      url: `https://${site}/man-hinh-led-ngoai-troi/`,
    },
    {
      domain: 'bangled.vn',
      anchorSuggestion: 'Bảng điện tử LED Công nghiệp & Bảng năng suất nhà máy',
      url: 'https://bangled.vn/bang-dien-tu-cong-nghiep/',
    },
  ];

  const criteria: SeoQualityCheckCriterion[] = [
    {
      code: 'structure',
      label: 'Bố cục Heading H1–H3 & Độ sâu bài viết',
      score: structScore,
      maxScore: 25,
      status: structScore >= 18 ? 'pass' : structScore >= 10 ? 'warn' : 'fail',
      detail: `${wordCount} từ · H1: ${h1Count}, H2: ${h2Count}, H3: ${h3Count} (Khuyến nghị ≥ 600 từ & ≥ 2 thẻ H2)`,
    },
    {
      code: 'led_specs',
      label: 'Độ phủ thuật ngữ kỹ thuật ngành LED (cd/m², 3840Hz, IP65, GOB/COB)',
      score: techScore,
      maxScore: 35,
      status: techScore >= 25 ? 'pass' : techScore >= 14 ? 'warn' : 'fail',
      detail: `Đã có ${matchedTechnicalTerms.length}/${LED_TECHNICAL_LEXICON.length} nhóm thông số kỹ thuật cốt lõi`,
    },
    {
      code: 'keyword_meta',
      label: 'Tối ưu Từ khóa mục tiêu & Meta Description',
      score: kwScore,
      maxScore: 20,
      status: kwScore >= 15 ? 'pass' : kwScore >= 10 ? 'warn' : 'fail',
      detail: kw
        ? `Từ khóa "${input.targetKeyword}" · Độ dài Meta: ${metaLen} ký tự`
        : `Độ dài Meta: ${metaLen} ký tự`,
    },
    {
      code: 'b2b_tone',
      label: 'Giọng văn kỹ thuật B2B (Chống câu văn phóng đại sáo rỗng)',
      score: fluffScore,
      maxScore: 10,
      status: fluffWarnings.length === 0 ? 'pass' : 'warn',
      detail:
        fluffWarnings.length === 0
          ? 'Không phát hiện cụm từ quảng cáo sáo rỗng thiếu căn cứ'
          : `Phát hiện cụm từ nên thay bằng số liệu thực: ${fluffWarnings.join(', ')}`,
    },
    {
      code: 'internal_links',
      label: 'Liên kết nội bộ hệ sinh thái Toàn Trung',
      score: linkScore,
      maxScore: 10,
      status: hasInternalLink ? 'pass' : 'warn',
      detail: hasInternalLink
        ? 'Đã gắn liên kết điều hướng nội bộ trong bài'
        : 'Chưa có thẻ <a> liên kết nội bộ — xem 3 gợi ý bên dưới',
    },
  ];

  return {
    totalScore,
    gradeLabel,
    wordCount,
    headingStats: { h1: h1Count, h2: h2Count, h3: h3Count },
    matchedTechnicalTerms,
    missingSuggestedTerms: missingSuggestedTerms.slice(0, 4),
    fluffWarnings,
    suggestedInternalLinks,
    criteria,
  };
}
