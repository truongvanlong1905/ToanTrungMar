export interface FormParserDeps {
  normalizeVietnamPhone?: (raw: string) => { normalizedPhone: string; isUnstandardized: boolean };
  findProvinceEntry?: (query: string) => { name: string } | null | undefined;
  inferAreaTypeFromProvince?: (province: string) => 'hcm' | 'other_province';
}

export type WebsiteResolutionMethod =
  | 'metadata_url'
  | 'structured_field'
  | 'verified_form_template'
  | 'unresolved';

export interface WebsiteFormProfile {
  website: string;
  aliases: string[];
  subjectTemplates: RegExp[];
  formSourcePatterns: RegExp[];
  footerMarkers: RegExp[];
  requiredBodyLabels?: RegExp[];
}

export const WEBSITE_FORM_PROFILES: WebsiteFormProfile[] = [
  {
    website: 'bangled.vn',
    aliases: ['bangled.vn', 'www.bangled.vn', 'bangled'],
    subjectTemplates: [/\bform\s*b[aá]o\s*gi[aá]\b/i],
    formSourcePatterns: [/\bbangled\b/i, /\bform\s*b[aá]o\s*gi[aá]\s*bangled\b/i],
    footerMarkers: [
      /This is a notification that a contact form was submitted on your website/i,
    ],
    requiredBodyLabels: [
      /(?:Họ\s*tên|Khách\s*hàng)\s*:/i,
      /(?:Số\s*điện\s*thoại|SĐT|Điện\s*thoại)\s*:/i,
    ],
  },
  {
    website: 'toantrung.com.vn',
    aliases: ['toantrung.com.vn', 'www.toantrung.com.vn', 'toantrungco'],
    subjectTemplates: [/Th[oô]ng\s*tin\s*kh[aá]ch\s*h[aà]ng\s*g[uử]i\s*t[uừ]\s*form\s*b[aá]o\s*gi[aá]/i],
    formSourcePatterns: [
      /\bform\s*b[aá]o\s*gi[aá]\s*l[aắ]p\s*[đd][aặ]t\b/i,
      /\btoantrung\.com\.vn\b/i,
    ],
    footerMarkers: [/Th[oô]ng\s*b[aá]o\s*bi[eể]u\s*m[aẫ]u\s*li[eê]n\s*h[eệ]/i],
    requiredBodyLabels: [
      /(?:Gửi\s*đến\s*từ|Khách\s*hàng)\s*:/i,
      /(?:Số\s*điện\s*thoại|SĐT|Điện\s*thoại)\s*:/i,
    ],
  },
  {
    website: 'manhinhled.net.vn',
    aliases: ['manhinhled.net.vn', 'www.manhinhled.net.vn'],
    subjectTemplates: [],
    formSourcePatterns: [/\bmanhinhled\.net\.vn\b/i],
    footerMarkers: [],
  },
];

const NON_COMPANY_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'icloud.com',
  'facebook.com',
  'fb.com',
  'm.facebook.com',
  'youtube.com',
  'youtu.be',
  'zalo.me',
  'chat.zalo.me',
  'tiktok.com',
  'instagram.com',
  'linkedin.com',
  'twitter.com',
  'x.com',
  'google.com',
  'googleusercontent.com',
]);

export function normalizeWebsiteDomain(rawUrlOrDomain: string | null | undefined): string | null {
  if (!rawUrlOrDomain) return null;
  let candidate = rawUrlOrDomain.trim().toLowerCase();
  if (!candidate) return null;

  if (candidate.includes('@') && !candidate.includes('://')) {
    return null;
  }

  try {
    const withProtocol = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
    const url = new URL(withProtocol);
    candidate = url.hostname.toLowerCase();
  } catch {
    candidate = candidate
      .replace(/^https?:\/\//i, '')
      .split('/')[0]
      .split('?')[0]
      .split('#')[0]
      .split(':')[0]
      .trim();
  }

  candidate = candidate.replace(/^www\./i, '').replace(/\.$/, '');
  if (!candidate || !candidate.includes('.') || /\s/.test(candidate)) {
    return null;
  }
  if (NON_COMPANY_DOMAINS.has(candidate)) {
    return null;
  }
  return candidate;
}

export function extractValidLandingUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = raw.match(/https?:\/\/[^\s<>"')]+/i);
  if (!match) return null;
  try {
    const url = new URL(match[0]);
    const host = normalizeWebsiteDomain(url.hostname);
    if (!host) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function stripEmailSignature(body: string): string {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed === '--' ||
      /^_{4,}$/.test(trimmed) ||
      /^-{4,}$/.test(trimmed) ||
      /^(?:Trân trọng|Best regards|Kind regards|Regards|Sent from my|Thân ái|Cảm ơn và trân trọng)[,!.]?$/i.test(
        trimmed,
      )
    ) {
      break;
    }
    kept.push(line);
  }
  return kept.join('\n').trim();
}

export interface ParsedStructuredFormEmail {
  isStructuredForm: boolean;
  contactChannel: 'form_web' | 'email';
  sourceWebsite: string | null;
  websiteResolutionMethod: WebsiteResolutionMethod;
  websiteResolutionEvidence: string | null;
  landingPageUrl: string | null;
  formId: string | null;
  formSubmissionId: string | null;
  submittedAt: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  gclid: string | null;
  referrerUrl: string | null;
  formSource: string | null;
  contactName: string | null;
  phone: string | null;
  isPhoneUnstandardized: boolean;
  email: string | null;
  address: string | null;
  areaType: 'tphcm' | 'other_province' | null;
  province: string | null;
  productNote: string | null;
  note: string | null;
}

const FORM_FIELD_NEXT_LABELS =
  '(?:Website|Domain|Site|Nguồn website|Trang gửi|URL trang|URL|Page URL|Source URL|Landing Page|Mã form|Form ID|Mã gửi|Submission ID|Thời điểm gửi|Submitted at|UTM Source|UTM Medium|UTM Campaign|GCLID|Referrer|Gửi đến từ|Nguồn form|Form|Khách hàng|Họ và tên|Họ tên|Tên khách hàng|Tên|Số điện thoại|SĐT|Điện thoại|Phone|Email|E-mail|Địa chỉ|Khu vực|Tỉnh\\/Thành|Sản phẩm|Nhu cầu|Màn hình|Ghi chú)';

function defaultNormalizeVietnamPhone(raw: string): {
  normalizedPhone: string;
  isUnstandardized: boolean;
} {
  const digits = (raw || '').replace(/\D/g, '');
  if (!digits) {
    return { normalizedPhone: '', isUnstandardized: true };
  }
  if (digits.startsWith('84') && digits.length >= 10) {
    const local = `0${digits.slice(2)}`;
    return { normalizedPhone: local, isUnstandardized: local.length !== 10 && local.length !== 11 };
  }
  return { normalizedPhone: digits, isUnstandardized: digits.length !== 10 && digits.length !== 11 };
}

function resolveWebsiteByProfiles(params: {
  metadataWebsiteRaw: string | null;
  metadataUrlRaw: string | null;
  formSource: string | null;
  subject: string;
  bodyWithoutSignature: string;
  rawBody: string;
}): {
  sourceWebsite: string | null;
  landingPageUrl: string | null;
  method: WebsiteResolutionMethod;
  evidence: string | null;
} {
  // 1. Metadata website hoặc URL trang gửi form (ưu tiên cao nhất)
  const landingPageUrl = extractValidLandingUrl(params.metadataUrlRaw);
  const urlDomain = landingPageUrl ? normalizeWebsiteDomain(landingPageUrl) : null;
  if (urlDomain) {
    return {
      sourceWebsite: urlDomain,
      landingPageUrl,
      method: 'metadata_url',
      evidence: `URL metadata: ${landingPageUrl}`,
    };
  }

  const metadataDomain = normalizeWebsiteDomain(params.metadataWebsiteRaw);
  if (metadataDomain) {
    return {
      sourceWebsite: metadataDomain,
      landingPageUrl: extractValidLandingUrl(params.metadataWebsiteRaw),
      method: 'metadata_url',
      evidence: `Metadata website: ${metadataDomain}`,
    };
  }

  // 2. Trường thông tin nguồn có cấu trúc trong nội dung thư
  if (params.formSource) {
    const directDomain = normalizeWebsiteDomain(params.formSource);
    if (directDomain) {
      return {
        sourceWebsite: directDomain,
        landingPageUrl: extractValidLandingUrl(params.formSource),
        method: 'structured_field',
        evidence: `Trường nguồn form: ${params.formSource}`,
      };
    }

    for (const profile of WEBSITE_FORM_PROFILES) {
      if (profile.formSourcePatterns.some((re) => re.test(params.formSource!))) {
        return {
          sourceWebsite: profile.website,
          landingPageUrl: null,
          method: 'structured_field',
          evidence: `Trường nguồn khớp cấu hình ${profile.website}: "${params.formSource}"`,
        };
      }
    }
  }

  // 3. Mẫu form đặc trưng đã cấu hình & kiểm chứng cho từng website (kể cả thư chuyển tiếp)
  // Lưu ý: chỉ kiểm tra trên subject + nội dung form (không dùng From/To hay chữ ký cá nhân)
  const normalizedSubject = params.subject.replace(/^(?:(?:fwd?|re)\s*:\s*)+/i, '').trim();
  const bodyForTemplate = params.rawBody
    .replace(/\r\n/g, '\n')
    .replace(/^>+\s?/gm, ''); // Hỗ trợ giữ căn cứ khi thư được forward

  // 3a. Nếu footer thông báo form chứa trực tiếp URL website (ví dụ: "submitted on your website (Toàn Trung https://bangled.vn)")
  const formFooterUrlMatch = bodyForTemplate.match(
    /submitted on your website\s*\([^)]*?(https?:\/\/[^\s)]+)/i,
  );
  if (formFooterUrlMatch?.[1]) {
    const footerUrl = extractValidLandingUrl(formFooterUrlMatch[1]);
    const footerDomain = footerUrl ? normalizeWebsiteDomain(footerUrl) : null;
    if (footerDomain) {
      return {
        sourceWebsite: footerDomain,
        landingPageUrl: footerUrl,
        method: 'metadata_url',
        evidence: `URL trong thông báo form: ${footerUrl}`,
      };
    }
  }

  for (const profile of WEBSITE_FORM_PROFILES) {
    const footerHit = profile.footerMarkers.some((re) => re.test(bodyForTemplate));
    if (footerHit) {
      return {
        sourceWebsite: profile.website,
        landingPageUrl: null,
        method: 'verified_form_template',
        evidence: `Khớp footer mẫu form đã kiểm chứng của ${profile.website}`,
      };
    }

    const subjectHit = profile.subjectTemplates.some((re) => re.test(normalizedSubject));
    const labelsHit =
      !profile.requiredBodyLabels ||
      profile.requiredBodyLabels.every((re) => re.test(params.bodyWithoutSignature));
    if (subjectHit && labelsHit) {
      return {
        sourceWebsite: profile.website,
        landingPageUrl: null,
        method: 'verified_form_template',
        evidence: `Khớp tiêu đề & cấu trúc form đã kiểm chứng của ${profile.website}`,
      };
    }
  }

  return {
    sourceWebsite: null,
    landingPageUrl: null,
    method: 'unresolved',
    evidence: null,
  };
}

export function parseStructuredFormEmailBody(
  subject: string,
  bodyText: string,
  _fromHeader = '',
  deps: FormParserDeps = {},
): ParsedStructuredFormEmail {
  const normalizePhone = deps.normalizeVietnamPhone ?? defaultNormalizeVietnamPhone;
  const findProvince = deps.findProvinceEntry;
  const inferAreaType = deps.inferAreaTypeFromProvince;

  const rawBody = (bodyText || '').replace(/\r\n/g, '\n');
  const bodyWithoutFooter = rawBody
    .replace(/--+\s*Thông báo biểu mẫu[\s\S]*$/i, '')
    .replace(/--+\s*This is a notification that a contact form[\s\S]*$/i, '')
    .replace(/^>+\s?/gm, '')
    .trim();
  const normalizedBody = stripEmailSignature(bodyWithoutFooter);

  const extractField = (labels: string[]): string | null => {
    const labelGroup = labels.join('|');
    const regex = new RegExp(
      `(?:^|\\n|\\s+-\\s*|\\s+)(?:${labelGroup})\\s*:\\s*([^\\n]+?)(?=(?:\\s+-\\s*|\\s+)${FORM_FIELD_NEXT_LABELS}\\s*:|\\n|$)`,
      'i',
    );
    const match = normalizedBody.match(regex);
    const val = match?.[1]?.trim().replace(/^[-–—\s]+|[-–—\s]+$/g, '');
    return val || null;
  };

  const metadataWebsiteRaw = extractField(['Website', 'Domain', 'Site', 'Nguồn website']);
  const metadataUrlRaw = extractField(['Trang gửi', 'URL trang', 'URL', 'Page URL', 'Source URL', 'Landing Page']);
  const formId = extractField(['Mã form', 'Form ID']);
  const formSubmissionId = extractField(['Mã gửi', 'Submission ID']);
  const submittedAt = extractField(['Thời điểm gửi', 'Submitted at']);
  let utmSource = extractField(['UTM Source']);
  let utmMedium = extractField(['UTM Medium']);
  let utmCampaign = extractField(['UTM Campaign']);
  let gclid = extractField(['GCLID']);
  const referrerUrl = extractField(['Referrer']);

  // Fallback: extract UTM / GCLID from landing page URL query string if present in body
  const parsedLandingForUtm = extractValidLandingUrl(metadataUrlRaw);
  if (parsedLandingForUtm) {
    try {
      const u = new URL(parsedLandingForUtm);
      if (!utmSource) utmSource = u.searchParams.get('utm_source');
      if (!utmMedium) utmMedium = u.searchParams.get('utm_medium');
      if (!utmCampaign) utmCampaign = u.searchParams.get('utm_campaign');
      if (!gclid) gclid = u.searchParams.get('gclid');
    } catch {
      // ignore
    }
  }

  const formSource = extractField(['Gửi đến từ', 'Nguồn form', 'Form']);
  const contactName = extractField(['Khách hàng', 'Họ và tên', 'Họ tên', 'Tên khách hàng', 'Tên']);
  const rawPhone = extractField(['Số điện thoại', 'SĐT', 'Điện thoại', 'Phone']);
  const rawEmail = extractField(['Email', 'E-mail']);
  const address = extractField(['Địa chỉ', 'Khu vực', 'Tỉnh/Thành']);
  const productNote = extractField(['Sản phẩm', 'Nhu cầu', 'Màn hình']);
  const note = extractField(['Ghi chú']);

  const phoneExtract = rawPhone
    ? normalizePhone(rawPhone)
    : { normalizedPhone: '', isUnstandardized: true };
  const validPhone =
    phoneExtract.normalizedPhone && phoneExtract.normalizedPhone.replace(/\D/g, '').length >= 8
      ? phoneExtract.normalizedPhone
      : null;

  const emailMatch = rawEmail?.match(/([^\s<>,"']+@[^\s<>,"']+)/);
  const email = emailMatch ? emailMatch[1].toLowerCase() : null;

  let areaType: 'tphcm' | 'other_province' | null = null;
  let province: string | null = null;
  if (address) {
    const matchedProvince = findProvince ? findProvince(address) : undefined;
    if (matchedProvince) {
      province = matchedProvince.name;
      if (inferAreaType) {
        areaType = inferAreaType(matchedProvince.name) === 'hcm' ? 'tphcm' : 'other_province';
      } else {
        areaType = matchedProvince.name.toLowerCase().includes('hồ chí minh') ? 'tphcm' : 'other_province';
      }
    } else {
      const addrLower = address.toLowerCase();
      if (
        addrLower === 'hcm' ||
        addrLower.includes('tp.hcm') ||
        addrLower.includes('tp hcm') ||
        addrLower.includes('hồ chí minh') ||
        addrLower.includes('ho chi minh') ||
        addrLower.includes('sài gòn')
      ) {
        areaType = 'tphcm';
        province = 'TP. Hồ Chí Minh';
      } else {
        areaType = 'other_province';
        province = address.slice(0, 80);
      }
    }
  }

  const websiteResolution = resolveWebsiteByProfiles({
    metadataWebsiteRaw,
    metadataUrlRaw,
    formSource,
    subject: subject || '',
    bodyWithoutSignature: normalizedBody,
    rawBody,
  });

  const isStructuredForm = Boolean(
    formSource ||
      metadataWebsiteRaw ||
      metadataUrlRaw ||
      formId ||
      (contactName && productNote) ||
      websiteResolution.method === 'verified_form_template' ||
      (subject || '').toLowerCase().includes('form báo giá'),
  );

  return {
    isStructuredForm,
    contactChannel: isStructuredForm ? 'form_web' : 'email',
    sourceWebsite: websiteResolution.sourceWebsite,
    websiteResolutionMethod: websiteResolution.method,
    websiteResolutionEvidence: websiteResolution.evidence,
    landingPageUrl: websiteResolution.landingPageUrl,
    formId,
    formSubmissionId,
    submittedAt,
    utmSource,
    utmMedium,
    utmCampaign,
    gclid,
    referrerUrl,
    formSource,
    contactName,
    phone: validPhone,
    isPhoneUnstandardized: validPhone ? phoneExtract.isUnstandardized : true,
    email,
    address,
    areaType,
    province,
    productNote,
    note,
  };
}
