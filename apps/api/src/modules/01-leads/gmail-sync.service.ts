import { prisma, ingestLeadWithTrackingIdempotent } from '@toantrung/database';
import {
  findProvinceEntry,
  hasPlaceholderMacro,
  inferAreaTypeFromProvince,
  sanitizeProjectOrSubjectText,
} from '@toantrung/contracts';
import { upsertActionableNotification } from '../../core/notifications/service';
import { bumpDomainRevisions } from '../../core/cache/server-data-cache';
import {
  acquireDurableJobLease,
  releaseDurableJobLease,
} from '../../core/jobs/durable-lease';
import {
  getGoogleConnection,
  getValidAccessToken,
} from '../02-tracking-sync/google-oauth.service';
import {
  generateNextLeadCode,
  inspectDuplicateAndPriceCheck,
  normalizeVietnamPhone,
  selectAutoAssignedSales,
} from './service';
import {
  parseStructuredFormEmailBody as parseStructuredFormEmailBodyCore,
  type ParsedStructuredFormEmail,
} from './gmail-form-parser';

const SETTING_KEY_GMAIL_SYNC = 'gmail_lead_sync_config';
const SETTING_KEY_GMAIL_CHECKPOINT = 'gmail_sync_checkpoint';
const SETTING_KEY_GMAIL_AUDIT_LOGS = 'gmail_intake_audit_logs_v1';
const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const MAX_GMAIL_MESSAGE_RETRIES = 3;
const MAX_GMAIL_PAGES_PER_RUN = 10;
const MAX_GMAIL_MESSAGES_PER_RUN = 250;
const MAX_GMAIL_AUDIT_LOG_ENTRIES = 200;

export type GmailIntakeClassification =
  | 'VALID_FORM'
  | 'DIRECT_INQUIRY'
  | 'NEEDS_REVIEW'
  | 'DUPLICATE'
  | 'IRRELEVANT'
  | 'PROCESSING_ERROR';

export type GmailSyncMode = 'GMAIL_PUSH_WITH_RECONCILIATION' | 'POLLING_WITH_RECONCILIATION';
export type GmailServerStatus = 'RUNNING' | 'PAUSED' | 'ERROR';

export interface GmailIntakeAuditEntry {
  messageId: string;
  internalDateMs: number | null;
  fromEmail: string | null;
  subject: string;
  classification: GmailIntakeClassification;
  reasonCode: string;
  reasonDetail: string;
  leadId: number | null;
  leadCode: string | null;
  sourceWebsite: string | null;
  submissionId: string | null;
  processedAt: string;
}

export interface GmailSyncCheckpoint {
  accountKey: string;
  lastProcessedInternalDateMs: number | null;
  lastMessageId: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  failedMessageRetries: Record<string, { attempts: number; lastError: string; updatedAt: string }>;
}

export async function getGmailSyncCheckpoint(accountKey = ''): Promise<GmailSyncCheckpoint> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: SETTING_KEY_GMAIL_CHECKPOINT },
  });
  const empty: GmailSyncCheckpoint = {
    accountKey,
    lastProcessedInternalDateMs: null,
    lastMessageId: null,
    lastSuccessAt: null,
    lastError: null,
    consecutiveFailures: 0,
    failedMessageRetries: {},
  };
  if (!row?.value) return empty;
  try {
    const parsed = JSON.parse(row.value) as Partial<GmailSyncCheckpoint>;
    if (accountKey && parsed.accountKey && parsed.accountKey !== accountKey) {
      return empty;
    }
    return {
      accountKey: parsed.accountKey || accountKey,
      lastProcessedInternalDateMs:
        typeof parsed.lastProcessedInternalDateMs === 'number'
          ? parsed.lastProcessedInternalDateMs
          : null,
      lastMessageId: parsed.lastMessageId || null,
      lastSuccessAt: parsed.lastSuccessAt || null,
      lastError: parsed.lastError || null,
      consecutiveFailures: Number(parsed.consecutiveFailures) || 0,
      failedMessageRetries: parsed.failedMessageRetries || {},
    };
  } catch {
    return empty;
  }
}

export async function saveGmailSyncCheckpoint(cp: GmailSyncCheckpoint): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEY_GMAIL_CHECKPOINT },
    update: { value: JSON.stringify(cp) },
    create: {
      key: SETTING_KEY_GMAIL_CHECKPOINT,
      value: JSON.stringify(cp),
    },
  });
}

export interface GmailSyncSummary {
  scanned: number;
  created: number;
  deduplicated: number;
  skippedNoise: number;
  failed: number;
  error: string | null;
  classificationCounts?: Record<GmailIntakeClassification, number>;
  pagesFetched?: number;
}

export interface GmailLeadSyncConfig {
  enabled: boolean;
  query: string;
  maxMessages: number;
  pollIntervalSec: number;
  onlyLeadKeywords: boolean;
  lastSyncAt: string | null;
  lastSyncSummary: GmailSyncSummary | null;
}

export interface GmailCreatedLeadPreview {
  id: number;
  leadCode: string;
  contactName: string | null;
  email: string | null;
  phone: string;
  projectName: string | null;
  classification?: GmailIntakeClassification;
  sourceWebsite?: string | null;
}

export interface GmailSyncRunResult {
  ok: boolean;
  needsAuth?: boolean;
  needsReauth?: boolean;
  isSandboxDemo?: boolean;
  connectedEmail: string | null;
  message: string;
  summary: GmailSyncSummary;
  createdLeads: GmailCreatedLeadPreview[];
  auditEntries?: GmailIntakeAuditEntry[];
}

const DEFAULT_CONFIG: GmailLeadSyncConfig = {
  enabled: true,
  query: 'newer_than:14d -category:promotions -category:social',
  maxMessages: 40,
  pollIntervalSec: 30,
  onlyLeadKeywords: true,
  lastSyncAt: null,
  lastSyncSummary: null,
};

const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.com.vn',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'icloud.com',
  'me.com',
  'ymail.com',
]);

/**
 * Các hộp thư nội bộ / hộp thư nhận-gửi thông báo của công ty Toàn Trung.
 * Tuyệt đối KHÔNG dùng các địa chỉ này làm email khách hàng, tên khách hàng, hay nguồn website/marketing.
 */
function isInternalCompanyMailbox(email: string | null | undefined, connectedAccountKey = ''): boolean {
  if (!email) return false;
  const lower = email.trim().toLowerCase();
  if (!lower) return false;
  if (connectedAccountKey && lower === connectedAccountKey.trim().toLowerCase()) return true;
  const local = lower.split('@')[0] || '';
  return (
    local === 'toantrungco' ||
    local.startsWith('toantrungco+') ||
    lower.endsWith('@toantrung.com.vn') ||
    lower.endsWith('@bangled.vn') ||
    lower.endsWith('@manhinhled.net.vn')
  );
}

const AUTOMATED_SENDER_PATTERNS = [
  'noreply',
  'no-reply',
  'no_reply',
  'donotreply',
  'do-not-reply',
  'mailer-daemon',
  'postmaster@',
  'notifications@',
  'notification@',
  'newsletter@',
  'marketing@',
  'promo@',
  'accounts.google.com',
  'googlealerts-noreply',
  'facebookmail.com',
  'linkedin.com',
  'github.com',
];

const LEAD_KEYWORDS = [
  'báo giá',
  'bao gia',
  'tư vấn',
  'tu van',
  'màn hình',
  'man hinh',
  'led',
  'p2',
  'p2.5',
  'p3',
  'p4',
  'p5',
  'kích thước',
  'kich thuoc',
  'lắp đặt',
  'lap dat',
  'dự án',
  'du an',
  'liên hệ',
  'lien he',
  'cần mua',
  'can mua',
  'khảo sát',
  'khao sat',
  'hợp đồng',
  'hop dong',
  'quote',
  'quotation',
  'display',
  'screen',
];

export async function getGmailLeadSyncConfig(): Promise<GmailLeadSyncConfig> {
  try {
    const row = await prisma.systemSetting.findUnique({
      where: { key: SETTING_KEY_GMAIL_SYNC },
    });
    if (!row?.value) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(row.value) as Partial<GmailLeadSyncConfig>;
    const rawQuery =
      typeof parsed.query === 'string' && parsed.query.trim()
        ? parsed.query.trim()
        : DEFAULT_CONFIG.query;
    const isLegacySeedConfig =
      rawQuery === 'in:inbox newer_than:7d -category:promotions -category:social';
    const upgradedQuery = isLegacySeedConfig ? DEFAULT_CONFIG.query : rawQuery;
    return {
      enabled: isLegacySeedConfig ? true : parsed.enabled !== false,
      query: upgradedQuery,
      maxMessages:
        typeof parsed.maxMessages === 'number' && parsed.maxMessages > 0
          ? Math.min(50, Math.max(5, Math.round(parsed.maxMessages)))
          : DEFAULT_CONFIG.maxMessages,
      pollIntervalSec:
        typeof parsed.pollIntervalSec === 'number' && parsed.pollIntervalSec > 0
          ? Math.min(300, Math.max(15, Math.round(parsed.pollIntervalSec)))
          : DEFAULT_CONFIG.pollIntervalSec,
      onlyLeadKeywords:
        typeof parsed.onlyLeadKeywords === 'boolean'
          ? parsed.onlyLeadKeywords
          : DEFAULT_CONFIG.onlyLeadKeywords,
      lastSyncAt: typeof parsed.lastSyncAt === 'string' ? parsed.lastSyncAt : null,
      lastSyncSummary: parsed.lastSyncSummary ?? null,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveGmailLeadSyncConfig(
  patch: Partial<GmailLeadSyncConfig>,
): Promise<GmailLeadSyncConfig> {
  const current = await getGmailLeadSyncConfig();
  const next: GmailLeadSyncConfig = {
    ...current,
    ...patch,
    query:
      typeof patch.query === 'string' && patch.query.trim()
        ? patch.query.trim()
        : current.query,
    maxMessages:
      typeof patch.maxMessages === 'number' && patch.maxMessages > 0
        ? Math.min(50, Math.max(5, Math.round(patch.maxMessages)))
        : current.maxMessages,
    pollIntervalSec:
      typeof patch.pollIntervalSec === 'number' && patch.pollIntervalSec > 0
        ? Math.min(300, Math.max(15, Math.round(patch.pollIntervalSec)))
        : current.pollIntervalSec,
  };

  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEY_GMAIL_SYNC },
    update: { value: JSON.stringify(next) },
    create: { key: SETTING_KEY_GMAIL_SYNC, value: JSON.stringify(next) },
  });

  return next;
}

export async function getGmailIntakeAuditLogs(limit = 50): Promise<GmailIntakeAuditEntry[]> {
  try {
    const row = await prisma.systemSetting.findUnique({
      where: { key: SETTING_KEY_GMAIL_AUDIT_LOGS },
    });
    if (!row?.value) return [];
    const parsed = JSON.parse(row.value) as GmailIntakeAuditEntry[];
    return Array.isArray(parsed) ? parsed.slice(0, limit) : [];
  } catch {
    return [];
  }
}

async function appendGmailIntakeAuditLogs(entries: GmailIntakeAuditEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const existing = await getGmailIntakeAuditLogs(MAX_GMAIL_AUDIT_LOG_ENTRIES);
  const combined = [...entries.slice().reverse(), ...existing];
  const seenMsgIds = new Set<string>();
  const merged: GmailIntakeAuditEntry[] = [];
  for (const item of combined) {
    if (item.messageId && seenMsgIds.has(item.messageId)) continue;
    if (item.messageId) seenMsgIds.add(item.messageId);
    merged.push(item);
    if (merged.length >= MAX_GMAIL_AUDIT_LOG_ENTRIES) break;
  }
  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEY_GMAIL_AUDIT_LOGS },
    update: { value: JSON.stringify(merged) },
    create: { key: SETTING_KEY_GMAIL_AUDIT_LOGS, value: JSON.stringify(merged) },
  });
}

export function getGmailPushCapabilities(pollIntervalSec: number): {
  syncMode: GmailSyncMode;
  pushConfigured: boolean;
  pushLimitationReason: string | null;
} {
  const pubsubTopic = process.env.GMAIL_PUBSUB_TOPIC?.trim();
  const publicBaseUrl = process.env.PUBLIC_WEBHOOK_BASE_URL?.trim();
  const isHttpsPublic = Boolean(
    publicBaseUrl && /^https:\/\//i.test(publicBaseUrl) && !/localhost|127\.0\.0\.1/i.test(publicBaseUrl),
  );
  if (pubsubTopic && isHttpsPublic) {
    return {
      syncMode: 'GMAIL_PUSH_WITH_RECONCILIATION',
      pushConfigured: true,
      pushLimitationReason: null,
    };
  }
  return {
    syncMode: 'POLLING_WITH_RECONCILIATION',
    pushConfigured: false,
    pushLimitationReason: !pubsubTopic
      ? `Chưa cấu hình GMAIL_PUBSUB_TOPIC để nhận Gmail Push; hệ thống đang dùng Poller backend mỗi ${pollIntervalSec}s kèm đối soát checkpoint (push vẫn cần quét đối soát dự phòng).`
      : `Endpoint hiện tại (${publicBaseUrl || 'local'}) chưa là HTTPS công khai cho Google Pub/Sub Push; hệ thống đang dùng Poller backend mỗi ${pollIntervalSec}s.`,
  };
}

export async function getGmailLeadSyncStatus() {
  const [conn, config, recentAuditLogs] = await Promise.all([
    getGoogleConnection(),
    getGmailLeadSyncConfig(),
    getGmailIntakeAuditLogs(30),
  ]);
  const checkpoint = await getGmailSyncCheckpoint(conn?.connectedEmail?.trim().toLowerCase() || '');
  const scopes = conn?.scopes || [];
  const hasGmailScope = scopes.some(
    (s) => s === GMAIL_READONLY_SCOPE || s.includes('gmail.readonly') || s.includes('mail.google.com'),
  );
  const pushCap = getGmailPushCapabilities(config.pollIntervalSec);

  let serverStatus: GmailServerStatus = 'RUNNING';
  let serverStatusReason = `Đang chạy tự động ở máy chủ (${pushCap.syncMode === 'GMAIL_PUSH_WITH_RECONCILIATION' ? 'Push + đối soát' : `Poller mỗi ${config.pollIntervalSec}s`})`;

  const isTokenExpired = Boolean(
    conn?.connected &&
      !conn.isSandboxDemo &&
      (conn.connectionStatus === 'EXPIRED' ||
        checkpoint.lastError === 'TOKEN_EXPIRED' ||
        checkpoint.lastError === 'HTTP_401' ||
        checkpoint.lastError === 'OAUTH_TOKEN_EXPIRED'),
  );

  if (!config.enabled) {
    serverStatus = 'PAUSED';
    serverStatusReason = 'Tự động tiếp nhận đang tạm dừng theo cấu hình máy chủ.';
  } else if (!conn?.connected || conn.isSandboxDemo || !hasGmailScope) {
    serverStatus = 'ERROR';
    serverStatusReason = !conn?.connected
      ? 'Chưa kết nối tài khoản Google / Gmail.'
      : conn.isSandboxDemo
        ? 'Đang ở chế độ Sandbox Demo, chưa có kết nối Gmail thật.'
        : 'Thiếu quyền đọc Gmail (gmail.readonly).';
  } else if (isTokenExpired) {
    serverStatus = 'ERROR';
    serverStatusReason =
      'Phiên đăng nhập Google đã hết hạn hoặc bị Google thu hồi (chế độ Testing hết hạn sau 7 ngày). Vui lòng bấm "Kết nối lại Google" để tiếp tục tự động nhận Lead từ Gmail.';
  } else if (checkpoint.consecutiveFailures > 0 && checkpoint.lastError) {
    serverStatus = 'ERROR';
    serverStatusReason = `Lỗi đồng bộ gần nhất: ${checkpoint.lastError}`;
  }

  return {
    connected: Boolean(conn?.connected),
    connectedEmail: conn?.connectedEmail ?? null,
    isSandboxDemo: Boolean(conn?.isSandboxDemo),
    hasGmailScope,
    needsAuth: !conn?.connected || isTokenExpired,
    tokenExpired: isTokenExpired,
    serverStatus,
    serverStatusReason,
    pollerStarted: Boolean(globalForGmailSync.__gmailAutoSyncPollerStarted),
    lastAttemptAt: globalForGmailSync.__gmailLastAutoAttemptMs
      ? new Date(globalForGmailSync.__gmailLastAutoAttemptMs).toISOString()
      : null,
    syncMode: pushCap.syncMode,
    pushConfigured: pushCap.pushConfigured,
    pushLimitationReason: pushCap.pushLimitationReason,
    config,
    checkpoint,
    recentAuditLogs,
  };
}

/**
 * Tách Tên liên hệ, Email và gợi ý tên Công ty (từ domain doanh nghiệp) trong header `From`.
 */
export function parseEmailAddressHeader(fromHeader: string): {
  contactName: string | null;
  email: string | null;
  companyHint: string | null;
} {
  const raw = (fromHeader || '').trim();
  if (!raw) return { contactName: null, email: null, companyHint: null };

  const angleMatch = raw.match(/^(.*?)\s*<([^<>@\s]+@[^<>@\s]+)>$/);
  let contactName: string | null = null;
  let email: string | null = null;

  if (angleMatch) {
    const rawName = angleMatch[1].trim().replace(/^["']+|["']+$/g, '');
    contactName = rawName || null;
    email = angleMatch[2].trim().toLowerCase();
  } else {
    const emailOnly = raw.match(/([^\s<>,"']+@[^\s<>,"']+)/);
    if (emailOnly) {
      email = emailOnly[1].trim().toLowerCase();
    }
  }

  let companyHint: string | null = null;
  if (email) {
    const domain = email.split('@')[1] || '';
    if (domain && !FREE_EMAIL_DOMAINS.has(domain)) {
      const label = domain.split('.')[0] || '';
      if (label.length >= 2) {
        companyHint = label.charAt(0).toUpperCase() + label.slice(1);
      }
    }
  }

  return { contactName, email, companyHint };
}

/**
 * Tìm số điện thoại Việt Nam hợp lệ đầu tiên trong tiêu đề hoặc nội dung email.
 */
export function extractVietnamPhoneFromText(text: string): {
  normalizedPhone: string | null;
  isUnstandardized: boolean;
} {
  if (!text) return { normalizedPhone: null, isUnstandardized: true };
  const candidates = text.match(/(?:\+?84|0)(?:[\s.\-]*\d){8,10}/g) || [];
  for (const raw of candidates) {
    const { normalizedPhone, isUnstandardized } = normalizeVietnamPhone(raw);
    if (!isUnstandardized && /^0[35789]\d{8}$/.test(normalizedPhone)) {
      return { normalizedPhone, isUnstandardized: false };
    }
  }
  for (const raw of candidates) {
    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 9 && digits.length <= 12) {
      const { normalizedPhone, isUnstandardized } = normalizeVietnamPhone(raw);
      return { normalizedPhone, isUnstandardized };
    }
  }
  return { normalizedPhone: null, isUnstandardized: true };
}

function decodeBase64Url(data: string): string {
  try {
    const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(normalized, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface GmailMimePart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailMimePart[];
}

export function decodeGmailBody(payload?: GmailMimePart | null): string {
  if (!payload) return '';
  let plainText = '';
  let htmlText = '';

  const walk = (part: GmailMimePart) => {
    const mime = (part.mimeType || '').toLowerCase();
    if (part.body?.data) {
      const decoded = decodeBase64Url(part.body.data);
      if (mime === 'text/plain' && !plainText) {
        plainText = decoded;
      } else if (mime === 'text/html' && !htmlText) {
        htmlText = stripHtmlTags(decoded);
      } else if (!mime.startsWith('multipart/') && !plainText && !htmlText) {
        plainText = decoded;
      }
    }
    if (Array.isArray(part.parts)) {
      for (const child of part.parts) {
        walk(child);
      }
    }
  };

  walk(payload);
  return (plainText || htmlText).replace(/\r\n/g, '\n').trim();
}

export function parseStructuredFormEmailBody(
  subject: string,
  bodyText: string,
  fromHeader = '',
): ParsedStructuredFormEmail {
  return parseStructuredFormEmailBodyCore(subject, bodyText, fromHeader, {
    normalizeVietnamPhone,
    findProvinceEntry,
    inferAreaTypeFromProvince,
  });
}

const PROMO_OR_SYSTEM_SUBJECT_PATTERNS = [
  'khuyến mãi',
  'khuyen mai',
  'giảm giá',
  'giam gia',
  'ưu đãi',
  'uu dai',
  'voucher',
  'newsletter',
  'bản tin',
  'ban tin',
  'unsubscribe',
  'hủy đăng ký',
  'huy dang ky',
  'mã otp',
  'ma otp',
  'verification code',
  'xác nhận tài khoản',
  'xac nhan tai khoan',
  'hóa đơn điện tử',
  'hoa don dien tu',
  'thông báo tuyển dụng',
  'ứng tuyển',
  'ung tuyen',
  'delivery status notification',
];

export function stripSignatureAndPromoFooter(bodyText: string): string {
  if (!bodyText) return '';
  const lines = bodyText.replace(/\r\n/g, '\n').split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      /^--\s*$/.test(trimmed) ||
      /^_{3,}$/.test(trimmed) ||
      /^-{4,}$/.test(trimmed) ||
      /^(?:trân trọng|best regards|kind regards|regards|thân mến|chân thành cảm ơn)[,!\s]*$/i.test(trimmed) ||
      /^(?:hotline|tổng đài|cskh|văn phòng|trụ sở|unsubscribe|hủy đăng ký|bản tin quảng cáo)\s*:/i.test(trimmed) ||
      /^this is a notification that a contact form was submitted/i.test(trimmed) ||
      /^thông báo biểu mẫu liên hệ/i.test(trimmed)
    ) {
      break;
    }
    kept.push(line);
  }
  return kept.join('\n').trim();
}

export function isLikelyLeadEmail(params: {
  fromEmail: string;
  subject: string;
  bodyText: string;
  hasPhoneInMainBody: boolean;
  onlyLeadKeywords: boolean;
}): {
  isLead: boolean;
  hasDemandKeyword: boolean;
  reasonCode: string;
  reasonDetail: string;
} {
  const fromLower = params.fromEmail.toLowerCase();
  if (AUTOMATED_SENDER_PATTERNS.some((pat) => fromLower.includes(pat))) {
    return {
      isLead: false,
      hasDemandKeyword: false,
      reasonCode: 'AUTOMATED_SENDER',
      reasonDetail: `Bỏ qua thư tự động/hệ thống từ ${params.fromEmail}.`,
    };
  }

  const mainBody = stripSignatureAndPromoFooter(params.bodyText);
  const haystack = `${params.subject}\n${mainBody}`.toLowerCase();

  if (PROMO_OR_SYSTEM_SUBJECT_PATTERNS.some((pat) => haystack.includes(pat))) {
    return {
      isLead: false,
      hasDemandKeyword: false,
      reasonCode: 'PROMO_OR_SYSTEM_MAIL',
      reasonDetail: 'Bỏ qua thư quảng cáo, bản tin, OTP hoặc thông báo hệ thống.',
    };
  }

  const hasDemandKeyword = LEAD_KEYWORDS.some((kw) => haystack.includes(kw));

  if (!params.onlyLeadKeywords) {
    return {
      isLead: true,
      hasDemandKeyword,
      reasonCode: 'KEYWORD_FILTER_DISABLED',
      reasonDetail: 'Tiếp nhận trực tiếp vì đang tắt bộ lọc từ khóa.',
    };
  }

  // U01: Không coi mọi thư có SĐT là Lead; phải có nội dung nhu cầu rõ ràng ngoài chữ ký quảng cáo.
  if (hasDemandKeyword && params.hasPhoneInMainBody) {
    return {
      isLead: true,
      hasDemandKeyword: true,
      reasonCode: 'DIRECT_INQUIRY_WITH_PHONE_AND_DEMAND',
      reasonDetail: 'Khách hỏi trực tiếp có SĐT trong nội dung chính và từ khóa nhu cầu sản phẩm/báo giá.',
    };
  }

  if (hasDemandKeyword) {
    return {
      isLead: true,
      hasDemandKeyword: true,
      reasonCode: 'DIRECT_INQUIRY_DEMAND_ONLY',
      reasonDetail: 'Khách hỏi trực tiếp có từ khóa nhu cầu nhưng chưa có SĐT trong nội dung (cần kiểm tra).',
    };
  }

  return {
    isLead: false,
    hasDemandKeyword: false,
    reasonCode: params.hasPhoneInMainBody ? 'PHONE_WITHOUT_DEMAND' : 'NO_DEMAND_OR_FORM',
    reasonDetail: params.hasPhoneInMainBody
      ? 'Thư chỉ có SĐT nhưng không có cấu trúc form hoặc nội dung nhu cầu LED/báo giá.'
      : 'Thư không chứa cấu trúc form và không có từ khóa nhu cầu sản phẩm/báo giá.',
  };
}

function getHeaderValue(
  headers: Array<{ name?: string; value?: string }> | undefined,
  name: string,
): string {
  if (!headers) return '';
  const target = name.toLowerCase();
  return headers.find((h) => (h.name || '').toLowerCase() === target)?.value || '';
}

const globalForGmailSync = globalThis as typeof globalThis & {
  __gmailSyncInFlight?: Promise<GmailSyncRunResult> | null;
  __gmailAutoSyncPollerStarted?: boolean;
  __gmailLastAutoAttemptMs?: number;
  __gmailPollRunning?: boolean;
};

async function runQuietBackgroundGmailPoll(forceIntervalCheck = false): Promise<void> {
  if (globalForGmailSync.__gmailPollRunning) return;
  globalForGmailSync.__gmailPollRunning = true;
  try {
    const [conn, cfg] = await Promise.all([
      getGoogleConnection(),
      getGmailLeadSyncConfig(),
    ]);
    if (forceIntervalCheck) {
      const lastAttempt = globalForGmailSync.__gmailLastAutoAttemptMs || 0;
      if (Date.now() - lastAttempt < cfg.pollIntervalSec * 1000) {
        return;
      }
    }
    globalForGmailSync.__gmailLastAutoAttemptMs = Date.now();
    if (!cfg.enabled || !conn?.connected || conn.isSandboxDemo || conn.connectionStatus === 'EXPIRED') return;
    const hasGmailScope = (conn.scopes || []).some(
      (s) =>
        s === GMAIL_READONLY_SCOPE ||
        s.includes('gmail.readonly') ||
        s.includes('mail.google.com'),
    );
    if (!hasGmailScope) return;
    await syncLeadsFromGmail();
  } catch {
    // Background poll errors should never crash the server process
  } finally {
    globalForGmailSync.__gmailPollRunning = false;
  }
}

export function ensureGmailAutoSyncPollerStarted(): void {
  if (globalForGmailSync.__gmailAutoSyncPollerStarted) return;
  globalForGmailSync.__gmailAutoSyncPollerStarted = true;
  globalForGmailSync.__gmailLastAutoAttemptMs = Date.now();

  void runQuietBackgroundGmailPoll(false);

  const timer = setInterval(() => {
    void runQuietBackgroundGmailPoll(true);
  }, 15_000);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }
}

/**
 * Tự động kích hoạt quét Gmail ở hậu trường khi danh sách Lead được đọc (nếu đã qua chu kỳ pollIntervalSec).
 * Khi `maxWaitMs <= 0`, tác vụ chạy ngầm hoàn toàn không chặn phản hồi HTTP.
 */
export async function triggerGmailAutoSyncOnRead(maxWaitMs = 0): Promise<void> {
  ensureGmailAutoSyncPollerStarted();
  if (globalForGmailSync.__gmailPollRunning) return;
  const nowPre = Date.now();
  const lastPre = globalForGmailSync.__gmailLastAutoAttemptMs || 0;
  if (nowPre - lastPre < 5_000) {
    return;
  }
  const cfg = await getGmailLeadSyncConfig();
  const now = Date.now();
  const lastAttempt = globalForGmailSync.__gmailLastAutoAttemptMs || 0;
  if (now - lastAttempt < cfg.pollIntervalSec * 1000 || globalForGmailSync.__gmailPollRunning) {
    return;
  }
  globalForGmailSync.__gmailLastAutoAttemptMs = now;
  if (maxWaitMs <= 0) {
    void runQuietBackgroundGmailPoll(false);
    return;
  }
  await Promise.race([
    runQuietBackgroundGmailPoll(false),
    new Promise<void>((resolve) => setTimeout(resolve, maxWaitMs)),
  ]);
}

export interface MockGmailMessageInput {
  id: string;
  internalDate: string;
  from: string;
  subject: string;
  bodyText: string;
}

export async function syncLeadsFromGmail(options?: {
  query?: string;
  maxMessages?: number;
  onlyLeadKeywords?: boolean;
  mockMessages?: MockGmailMessageInput[];
  mockConnectedEmail?: string;
}): Promise<GmailSyncRunResult> {
  if (globalForGmailSync.__gmailSyncInFlight && !options?.mockMessages) {
    return globalForGmailSync.__gmailSyncInFlight;
  }

  const runWithDurableLease = async (): Promise<GmailSyncRunResult> => {
    const lease = await acquireDurableJobLease({
      jobKey: 'gmail_lead_sync',
      leaseTtlMs: 90_000,
      checkpointNote: options?.mockMessages ? 'mock_gmail_sync' : 'live_gmail_sync',
    });
    if (!lease.acquired) {
      return {
        ok: true,
        connectedEmail: options?.mockConnectedEmail ?? null,
        message: 'Phiên đồng bộ Gmail khác đang chạy trên worker khác; bỏ qua để tránh trùng lặp.',
        summary: { scanned: 0, created: 0, deduplicated: 0, skippedNoise: 0, failed: 0, error: null },
        createdLeads: [],
      };
    }

    try {
      const res = await runSyncLeadsFromGmailInternal(options);
      await releaseDurableJobLease({
        jobKey: 'gmail_lead_sync',
        ownerId: lease.ownerId,
        status: res.ok ? 'completed' : 'failed',
        checkpointNote: `scanned=${res.summary.scanned},created=${res.summary.created}`,
      });
      return res;
    } catch (err) {
      await releaseDurableJobLease({
        jobKey: 'gmail_lead_sync',
        ownerId: lease.ownerId,
        status: 'failed',
        checkpointNote: err instanceof Error ? err.message : 'gmail_sync_failed',
      }).catch(() => undefined);
      throw err;
    }
  };

  const runPromise = runWithDurableLease().finally(() => {
    if (!options?.mockMessages) {
      globalForGmailSync.__gmailSyncInFlight = null;
    }
  });
  if (!options?.mockMessages) {
    globalForGmailSync.__gmailSyncInFlight = runPromise;
  }
  return runPromise;
}

async function runSyncLeadsFromGmailInternal(options?: {
  query?: string;
  maxMessages?: number;
  onlyLeadKeywords?: boolean;
  mockMessages?: MockGmailMessageInput[];
  mockConnectedEmail?: string;
}): Promise<GmailSyncRunResult> {
  const isMockFeed = Array.isArray(options?.mockMessages);
  const conn = isMockFeed
    ? {
        connected: true,
        connectedEmail: options?.mockConnectedEmail || 'toantrungco@gmail.com',
        isSandboxDemo: false,
        scopes: [GMAIL_READONLY_SCOPE],
      }
    : await getGoogleConnection();
  const config = await getGmailLeadSyncConfig();

  const query = (options?.query || config.query).trim();
  const maxMessages = options?.maxMessages
    ? Math.min(50, Math.max(5, Math.round(options.maxMessages)))
    : config.maxMessages;
  const onlyLeadKeywords =
    typeof options?.onlyLeadKeywords === 'boolean'
      ? options.onlyLeadKeywords
      : config.onlyLeadKeywords;

  if (!conn || !conn.connected || !conn.connectedEmail) {
    return {
      ok: false,
      needsAuth: true,
      connectedEmail: null,
      message: 'Chưa kết nối tài khoản Google / Gmail. Vui lòng kết nối Google OAuth trước.',
      summary: { scanned: 0, created: 0, deduplicated: 0, skippedNoise: 0, failed: 0, error: 'NOT_CONNECTED' },
      createdLeads: [],
    };
  }

  const accountKey = conn.connectedEmail.trim().toLowerCase();
  const checkpoint = await getGmailSyncCheckpoint(accountKey);

  if (conn.isSandboxDemo) {
    return {
      ok: false,
      isSandboxDemo: true,
      connectedEmail: conn.connectedEmail,
      message:
        'Đang ở chế độ Kiểm thử Mẫu (Sandbox Demo) nên không có hộp thư Gmail thực tế. Vui lòng kết nối tài khoản Google thật để quét Gmail.',
      summary: { scanned: 0, created: 0, deduplicated: 0, skippedNoise: 0, failed: 0, error: 'SANDBOX_DEMO' },
      createdLeads: [],
    };
  }

  const hasGmailScope = (conn.scopes || []).some(
    (s) => s === GMAIL_READONLY_SCOPE || s.includes('gmail.readonly') || s.includes('mail.google.com'),
  );
  if (!hasGmailScope) {
    await saveGmailSyncCheckpoint({
      ...checkpoint,
      accountKey,
      lastError: 'MISSING_GMAIL_SCOPE',
      consecutiveFailures: checkpoint.consecutiveFailures + 1,
    });
    return {
      ok: false,
      needsReauth: true,
      connectedEmail: conn.connectedEmail,
      message:
        'Tài khoản Google hiện tại chưa được cấp quyền đọc Gmail (gmail.readonly). Vui lòng bấm "Cấp quyền đọc Gmail" để xác nhận lại.',
      summary: { scanned: 0, created: 0, deduplicated: 0, skippedNoise: 0, failed: 0, error: 'MISSING_GMAIL_SCOPE' },
      createdLeads: [],
    };
  }

  const accessToken = isMockFeed ? 'MOCK_GMAIL_TOKEN' : await getValidAccessToken();
  if (!accessToken) {
    await saveGmailSyncCheckpoint({
      ...checkpoint,
      accountKey,
      lastError: 'TOKEN_EXPIRED',
      consecutiveFailures: checkpoint.consecutiveFailures + 1,
    });
    return {
      ok: false,
      needsAuth: true,
      connectedEmail: conn.connectedEmail,
      message: 'Token Google đã hết hạn và không thể làm mới. Vui lòng kết nối lại Google.',
      summary: { scanned: 0, created: 0, deduplicated: 0, skippedNoise: 0, failed: 0, error: 'TOKEN_EXPIRED' },
      createdLeads: [],
    };
  }

  const effectiveQuery =
    !options?.query &&
    checkpoint.lastProcessedInternalDateMs &&
    !/\bafter:/i.test(query)
      ? `${query} after:${Math.max(0, Math.floor((checkpoint.lastProcessedInternalDateMs - 300_000) / 1000))}`
      : query;

  let messageRefs: Array<{ id: string; threadId?: string }> = [];
  let pagesFetched = 0;
  const mockById = new Map<string, MockGmailMessageInput>();

  if (isMockFeed) {
    const cutoffMs = checkpoint.lastProcessedInternalDateMs
      ? checkpoint.lastProcessedInternalDateMs - 300_000
      : 0;
    const filteredMocks = (options?.mockMessages || [])
      .filter((m) => Number(m.internalDate || 0) >= cutoffMs)
      .sort((a, b) => Number(b.internalDate || 0) - Number(a.internalDate || 0));
    const cappedMocks = filteredMocks.slice(0, MAX_GMAIL_MESSAGES_PER_RUN);
    pagesFetched = Math.max(1, Math.ceil(cappedMocks.length / Math.max(1, maxMessages)));
    for (const m of cappedMocks) {
      mockById.set(m.id, m);
    }
    // Process oldest-to-newest so checkpoint advances chronologically without skipping burst emails
    messageRefs = cappedMocks
      .slice()
      .reverse()
      .map((m) => ({ id: m.id }));
  } else {
    let pageToken: string | undefined;
    const collectedRefs: Array<{ id: string; threadId?: string }> = [];

    for (let page = 0; page < MAX_GMAIL_PAGES_PER_RUN; page += 1) {
      const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
      listUrl.searchParams.set('q', effectiveQuery);
      listUrl.searchParams.set('maxResults', String(maxMessages));
      if (pageToken) {
        listUrl.searchParams.set('pageToken', pageToken);
      }

      const listResp = await fetch(listUrl.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (listResp.status === 401 || listResp.status === 403) {
        const errText = await listResp.text();
        const isScopeErr = errText.includes('insufficientPermissions') || errText.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT');
        await saveGmailSyncCheckpoint({
          ...checkpoint,
          accountKey,
          lastError: `HTTP_${listResp.status}`,
          consecutiveFailures: checkpoint.consecutiveFailures + 1,
        });
        return {
          ok: false,
          needsReauth: isScopeErr || listResp.status === 403,
          needsAuth: listResp.status === 401,
          connectedEmail: conn.connectedEmail,
          message: isScopeErr
            ? 'Google từ chối quyền đọc Gmail. Vui lòng bấm "Cấp quyền đọc Gmail" để cấp lại quyền gmail.readonly.'
            : `Lỗi xác thực Gmail API (${listResp.status}): ${errText.slice(0, 180)}`,
          summary: { scanned: 0, created: 0, deduplicated: 0, skippedNoise: 0, failed: 0, error: `HTTP_${listResp.status}` },
          createdLeads: [],
        };
      }

      if (!listResp.ok) {
        const errText = await listResp.text();
        await saveGmailSyncCheckpoint({
          ...checkpoint,
          accountKey,
          lastError: `HTTP_${listResp.status}`,
          consecutiveFailures: checkpoint.consecutiveFailures + 1,
        });
        throw new Error(`Gmail API trả lỗi ${listResp.status}: ${errText.slice(0, 200)}`);
      }

      pagesFetched += 1;
      const listJson = (await listResp.json()) as {
        messages?: Array<{ id: string; threadId?: string }>;
        nextPageToken?: string;
      };
      if (Array.isArray(listJson.messages) && listJson.messages.length > 0) {
        collectedRefs.push(...listJson.messages);
      }
      if (!listJson.nextPageToken || collectedRefs.length >= MAX_GMAIL_MESSAGES_PER_RUN) {
        break;
      }
      pageToken = listJson.nextPageToken;
    }

    // Gmail lists newest first; process oldest-to-newest so checkpoint advances safely
    messageRefs = collectedRefs.slice(0, MAX_GMAIL_MESSAGES_PER_RUN).reverse();
  }

  const classificationCounts: Record<GmailIntakeClassification, number> = {
    VALID_FORM: 0,
    DIRECT_INQUIRY: 0,
    NEEDS_REVIEW: 0,
    DUPLICATE: 0,
    IRRELEVANT: 0,
    PROCESSING_ERROR: 0,
  };

  const summary: GmailSyncSummary = {
    scanned: messageRefs.length,
    created: 0,
    deduplicated: 0,
    skippedNoise: 0,
    failed: 0,
    error: null,
    classificationCounts,
    pagesFetched,
  };
  const createdLeads: GmailCreatedLeadPreview[] = [];
  const auditEntries: GmailIntakeAuditEntry[] = [];

  let maxInternalDateSeen = checkpoint.lastProcessedInternalDateMs || 0;
  let lastMessageIdSeen = checkpoint.lastMessageId || messageRefs[0]?.id || null;

  // Batch pre-check idempotency keys in a single query to avoid N+1 database round-trips
  const candidateIds = messageRefs.map((r) => r.id).filter(Boolean);
  const existingRows =
    candidateIds.length > 0
      ? await prisma.marketingTracking.findMany({
          where: {
            intakeSourceProvider: 'gmail_sync',
            intakeSourceAccountKey: accountKey,
            externalSubmissionId: { in: candidateIds },
          },
          select: {
            externalSubmissionId: true,
            lead: { select: { contactedAt: true, createdAt: true } },
          },
        })
      : [];
  const existingMessageIdSet = new Set(
    existingRows.map((r) => r.externalSubmissionId).filter((v): v is string => Boolean(v)),
  );
  const priorIrrelevantMessageIdSet = new Set<string>();
  if (!isMockFeed) {
    const recentAudits = await getGmailIntakeAuditLogs(MAX_GMAIL_AUDIT_LOG_ENTRIES);
    for (const a of recentAudits) {
      if (a.messageId && a.classification === 'IRRELEVANT') {
        priorIrrelevantMessageIdSet.add(a.messageId);
      }
    }
  }
  for (const row of existingRows) {
    const dt = row.lead?.contactedAt || row.lead?.createdAt;
    if (dt) {
      const ms = new Date(dt).getTime();
      if (ms > maxInternalDateSeen) {
        maxInternalDateSeen = ms;
        if (row.externalSubmissionId) {
          lastMessageIdSeen = row.externalSubmissionId;
        }
      }
    }
  }

  for (const ref of messageRefs) {
    const retryInfo = checkpoint.failedMessageRetries[ref.id];
    if (retryInfo && retryInfo.attempts >= MAX_GMAIL_MESSAGE_RETRIES) {
      summary.failed += 1;
      continue;
    }
    try {
      if (existingMessageIdSet.has(ref.id)) {
        summary.deduplicated += 1;
        continue;
      }
      if (!isMockFeed && priorIrrelevantMessageIdSet.has(ref.id)) {
        summary.skippedNoise += 1;
        classificationCounts.IRRELEVANT += 1;
        continue;
      }

      let msgData: {
        id: string;
        snippet?: string;
        internalDate?: string;
        payload?: GmailMimePart & {
          headers?: Array<{ name?: string; value?: string }>;
        };
      };

      if (isMockFeed) {
        const mockItem = mockById.get(ref.id);
        if (!mockItem) continue;
        msgData = {
          id: mockItem.id,
          snippet: mockItem.bodyText.slice(0, 180),
          internalDate: mockItem.internalDate,
          payload: {
            mimeType: 'text/plain',
            headers: [
              { name: 'From', value: mockItem.from },
              { name: 'Subject', value: mockItem.subject },
            ],
            body: {
              data: Buffer.from(mockItem.bodyText, 'utf8').toString('base64url'),
            },
          },
        };
      } else {
        const msgResp = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(ref.id)}?format=full`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );

        if (!msgResp.ok) {
          summary.failed += 1;
          checkpoint.failedMessageRetries[ref.id] = {
            attempts: (retryInfo?.attempts || 0) + 1,
            lastError: `HTTP_${msgResp.status}`,
            updatedAt: new Date().toISOString(),
          };
          continue;
        }

        msgData = (await msgResp.json()) as {
          id: string;
          snippet?: string;
          internalDate?: string;
          payload?: GmailMimePart & {
            headers?: Array<{ name?: string; value?: string }>;
          };
        };
      }

      const msgInternalMs = msgData.internalDate ? Number(msgData.internalDate) : 0;
      if (msgInternalMs > maxInternalDateSeen) {
        maxInternalDateSeen = msgInternalMs;
        lastMessageIdSeen = ref.id;
      }

      const headers = msgData.payload?.headers;
      const fromHeader = getHeaderValue(headers, 'From');
      const subject = getHeaderValue(headers, 'Subject').trim() || '(Không có tiêu đề)';
      const parsedFrom = parseEmailAddressHeader(fromHeader);

      const bodyText = decodeGmailBody(msgData.payload) || msgData.snippet || '';
      const structured = parseStructuredFormEmailBody(subject, bodyText, fromHeader);

      const mainBodyForScreening = structured.isStructuredForm
        ? bodyText
        : stripSignatureAndPromoFooter(bodyText);

      if (structured.formSubmissionId) {
        const existingBySubmissionId = await prisma.marketingTracking.findFirst({
          where: {
            OR: [
              { externalSubmissionId: structured.formSubmissionId },
              {
                lead: {
                  is: {
                    selfReportedSource: {
                      contains: structured.formSubmissionId,
                    },
                  },
                },
              },
            ],
          },
          select: { id: true, leadId: true },
        });
        if (existingBySubmissionId) {
          summary.deduplicated += 1;
          classificationCounts.DUPLICATE += 1;
          auditEntries.push({
            messageId: ref.id,
            internalDateMs: msgInternalMs || null,
            fromEmail: parsedFrom.email,
            subject,
            classification: 'DUPLICATE',
            reasonCode: 'DUPLICATE_SUBMISSION_ID',
            reasonDetail: `Trùng mã lần gửi ${structured.formSubmissionId} với Lead #${existingBySubmissionId.leadId}.`,
            leadId: existingBySubmissionId.leadId,
            leadCode: null,
            sourceWebsite: structured.sourceWebsite,
            submissionId: structured.formSubmissionId,
            processedAt: new Date().toISOString(),
          });
          delete checkpoint.failedMessageRetries[ref.id];
          continue;
        }
      }

      const fallbackPhone = extractVietnamPhoneFromText(`${subject}\n${mainBodyForScreening}`);
      const resolvedPhone = structured.phone || fallbackPhone.normalizedPhone;
      const isPhoneUnstandardized = structured.phone
        ? structured.isPhoneUnstandardized
        : fallbackPhone.isUnstandardized;

      if (!parsedFrom.email) {
        summary.skippedNoise += 1;
        classificationCounts.IRRELEVANT += 1;
        auditEntries.push({
          messageId: ref.id,
          internalDateMs: msgInternalMs || null,
          fromEmail: null,
          subject,
          classification: 'IRRELEVANT',
          reasonCode: 'MISSING_SENDER_EMAIL',
          reasonDetail: 'Thư không có địa chỉ email người gửi hợp lệ.',
          leadId: null,
          leadCode: null,
          sourceWebsite: null,
          submissionId: structured.formSubmissionId,
          processedAt: new Date().toISOString(),
        });
        continue;
      }

      // Skip self-sent emails ONLY if they are NOT structured form-quote notifications
      if (parsedFrom.email === accountKey && !structured.isStructuredForm && !resolvedPhone) {
        summary.skippedNoise += 1;
        classificationCounts.IRRELEVANT += 1;
        auditEntries.push({
          messageId: ref.id,
          internalDateMs: msgInternalMs || null,
          fromEmail: parsedFrom.email,
          subject,
          classification: 'IRRELEVANT',
          reasonCode: 'SELF_SENT_NON_FORM',
          reasonDetail: 'Thư tự gửi từ chính hộp thư quản lý và không phải thông báo form.',
          leadId: null,
          leadCode: null,
          sourceWebsite: null,
          submissionId: structured.formSubmissionId,
          processedAt: new Date().toISOString(),
        });
        continue;
      }

      const screening = structured.isStructuredForm
        ? {
            isLead: true,
            hasDemandKeyword: true,
            reasonCode: 'STRUCTURED_WEBSITE_FORM',
            reasonDetail: `Biểu mẫu có cấu trúc từ ${structured.sourceWebsite || 'website chưa xác định'}.`,
          }
        : isLikelyLeadEmail({
            fromEmail: parsedFrom.email,
            subject,
            bodyText,
            hasPhoneInMainBody: Boolean(resolvedPhone),
            onlyLeadKeywords,
          });

      if (!screening.isLead) {
        summary.skippedNoise += 1;
        classificationCounts.IRRELEVANT += 1;
        auditEntries.push({
          messageId: ref.id,
          internalDateMs: msgInternalMs || null,
          fromEmail: parsedFrom.email,
          subject,
          classification: 'IRRELEVANT',
          reasonCode: screening.reasonCode,
          reasonDetail: screening.reasonDetail,
          leadId: null,
          leadCode: null,
          sourceWebsite: structured.sourceWebsite,
          submissionId: structured.formSubmissionId,
          processedAt: new Date().toISOString(),
        });
        continue;
      }

      // Chỉ đọc thông tin khách hàng trong nội dung thư/đoạn chat;
      // KHÔNG lấy email/tên của hộp thư nội bộ (toantrungco, connected account) làm thông tin khách hàng hay nguồn.
      const senderIsInternal = isInternalCompanyMailbox(parsedFrom.email, accountKey);
      const leadEmail = structured.email || (structured.isStructuredForm || senderIsInternal ? null : parsedFrom.email);
      const leadCompanyName =
        structured.isStructuredForm || senderIsInternal ? null : parsedFrom.companyHint;
      const leadContactName =
        structured.contactName || (structured.isStructuredForm || senderIsInternal ? null : parsedFrom.contactName);
      const subjectHasMacro = hasPlaceholderMacro(subject);
      const sanitizedSubjectProject = sanitizeProjectOrSubjectText(subject);
      const leadProjectName = structured.productNote
        ? `${sanitizeProjectOrSubjectText(structured.productNote) || structured.productNote}${structured.formSource ? ` (${structured.formSource})` : ''}`.slice(0, 160)
        : sanitizedSubjectProject
          ? sanitizedSubjectProject.slice(0, 160)
          : null;
      const phoneForLead = resolvedPhone || 'Chưa có SĐT';

      const dupCheck = await inspectDuplicateAndPriceCheck({
        phone: resolvedPhone || '',
        email: leadEmail,
        companyName: leadCompanyName,
        projectName: leadProjectName,
      });

      const needsIntakeReview =
        !resolvedPhone ||
        isPhoneUnstandardized ||
        (!structured.isStructuredForm && !resolvedPhone) ||
        (subjectHasMacro && !structured.productNote) ||
        dupCheck.isDuplicateAlert;

      const intakeClassification: GmailIntakeClassification = needsIntakeReview
        ? 'NEEDS_REVIEW'
        : structured.isStructuredForm
          ? 'VALID_FORM'
          : 'DIRECT_INQUIRY';

      const assignment = await selectAutoAssignedSales(dupCheck.matchedOldLead?.assignedSalesId);
      const leadCode = await generateNextLeadCode();

      const marketingSourceFromForm = structured.gclid
        ? 'Google Ads'
        : structured.utmSource
          ? structured.utmMedium?.toLowerCase() === 'cpc'
            ? 'Google Ads'
            : structured.utmSource
          : structured.referrerUrl
            ? 'Website giới thiệu'
            : 'Chưa xác định';
      const sourceResolutionMethodFromForm = structured.gclid
        ? 'gclid'
        : structured.utmSource
          ? 'utm'
          : structured.referrerUrl
            ? 'referrer'
            : 'unknown';

      const ingested = await ingestLeadWithTrackingIdempotent(prisma, {
        intakeSourceProvider: 'gmail_sync',
        intakeSourceAccountKey: accountKey,
        externalSubmissionId: ref.id,
        leadCode,
        contactChannel: structured.contactChannel,
        phone: phoneForLead,
        email: leadEmail,
        contactName: leadContactName,
        companyName: leadCompanyName,
        projectName: leadProjectName,
        areaType: structured.areaType,
        province: structured.province,
        installationAddress: structured.address,
        sourceWebsite: structured.sourceWebsite,
        landingPageUrl: structured.landingPageUrl,
        utmSource: structured.utmSource,
        utmMedium: structured.utmMedium,
        utmCampaign: structured.utmCampaign,
        gclid: structured.gclid,
        referrerUrl: structured.referrerUrl,
        selfReportedSource: structured.sourceWebsite || structured.formSource || 'Chưa xác định',
        assignedSalesId: assignment.assignedSalesId,
        marketingSource: marketingSourceFromForm,
        sourceResolutionMethod: sourceResolutionMethodFromForm,
      });

      if (ingested.deduplicated) {
        summary.deduplicated += 1;
        classificationCounts.DUPLICATE += 1;
        auditEntries.push({
          messageId: ref.id,
          internalDateMs: msgInternalMs || null,
          fromEmail: parsedFrom.email,
          subject,
          classification: 'DUPLICATE',
          reasonCode: 'DUPLICATE_MESSAGE_ID',
          reasonDetail: `Đã tồn tại Lead #${ingested.lead.id} (${ingested.lead.leadCode}) cho Gmail messageId ${ref.id}.`,
          leadId: ingested.lead.id,
          leadCode: ingested.lead.leadCode,
          sourceWebsite: structured.sourceWebsite,
          submissionId: structured.formSubmissionId,
          processedAt: new Date().toISOString(),
        });
        continue;
      }

      const emailDate = msgData.internalDate
        ? new Date(Number(msgData.internalDate))
        : new Date();
      const excerpt = (bodyText || msgData.snippet || '').slice(0, 700).trim();

      await prisma.$transaction(async (tx) => {
        await tx.lead.update({
          where: { id: ingested.lead.id },
          data: {
            isPhoneUnstandardized,
            normalizedLookupKey: dupCheck.lookupKey,
            isDuplicateAlert: dupCheck.isDuplicateAlert,
            duplicateStatus: dupCheck.duplicateStatus,
            matchedOldLeadId: dupCheck.matchedOldLead?.id ?? null,
            isSuspectedPriceCheck: dupCheck.isSuspectedPriceCheck,
            needsManagerAttention: assignment.needsManagerAttention || needsIntakeReview,
            contactedAt: emailDate,
          },
        });

        await tx.marketingTracking.update({
          where: { leadId: ingested.lead.id },
          data: {
            isRepeatLead: Boolean(dupCheck.matchedOldLead),
          },
        });

        await tx.leadActivity.create({
          data: {
            leadId: ingested.lead.id,
            actionType: 'add_note',
            actorType: 'webhook',
            note: [
              `[Đồng bộ tự động từ Gmail: ${conn.connectedEmail}]`,
              `Phân loại tiếp nhận: ${intakeClassification} (${screening.reasonCode})`,
              `Lý do: ${screening.reasonDetail}`,
              dupCheck.isDuplicateAlert
                ? `Kiểm tra trùng khách: Khớp SĐT với Lead cũ #${dupCheck.matchedOldLead?.id ?? 'N/A'} (giữ nguyên trạng thái Sales, không tự loại yêu cầu mới).`
                : '',
              `Người gửi: ${fromHeader}`,
              `Tiêu đề: ${subject}`,
              structured.sourceWebsite
                ? `Website nguồn: ${structured.sourceWebsite} (phương thức kỹ thuật: ${structured.websiteResolutionMethod})`
                : '',
              excerpt ? `Nội dung tóm tắt:\n${excerpt}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
          },
        });
      });

      if (assignment.assignedSalesId) {
        await upsertActionableNotification({
          userId: assignment.assignedSalesId,
          title: `Lead cần tiếp nhận: ${ingested.lead.leadCode}`,
          summary: `Yêu cầu mới từ ${structured.sourceWebsite || 'email'} (${leadContactName || phoneForLead}). Vui lòng kiểm tra và bấm xác nhận tiếp nhận.`,
          category: 'Lead',
          actionLabel: 'Xem chi tiết',
          actionUrl: `/leads?leadId=${ingested.lead.id}`,
          requiredPermission: 'LEAD_VIEW_OWN',
        });
      }

      summary.created += 1;
      classificationCounts[intakeClassification] += 1;
      auditEntries.push({
        messageId: ref.id,
        internalDateMs: msgInternalMs || null,
        fromEmail: parsedFrom.email,
        subject,
        classification: intakeClassification,
        reasonCode: screening.reasonCode,
        reasonDetail: screening.reasonDetail,
        leadId: ingested.lead.id,
        leadCode: ingested.lead.leadCode,
        sourceWebsite: structured.sourceWebsite,
        submissionId: structured.formSubmissionId,
        processedAt: new Date().toISOString(),
      });
      delete checkpoint.failedMessageRetries[ref.id];
      createdLeads.push({
        id: ingested.lead.id,
        leadCode: ingested.lead.leadCode,
        contactName: ingested.lead.contactName,
        email: ingested.lead.email,
        phone: ingested.lead.phone,
        projectName: ingested.lead.projectName,
        classification: intakeClassification,
        sourceWebsite: structured.sourceWebsite,
      });
    } catch (err) {
      summary.failed += 1;
      classificationCounts.PROCESSING_ERROR += 1;
      const errMsg = err instanceof Error ? err.message.slice(0, 180) : 'UNKNOWN_ERROR';
      const prevAttempts = checkpoint.failedMessageRetries[ref.id]?.attempts || 0;
      checkpoint.failedMessageRetries[ref.id] = {
        attempts: prevAttempts + 1,
        lastError: errMsg,
        updatedAt: new Date().toISOString(),
      };
      auditEntries.push({
        messageId: ref.id,
        internalDateMs: null,
        fromEmail: null,
        subject: `(Lỗi xử lý thư ${ref.id})`,
        classification: 'PROCESSING_ERROR',
        reasonCode: 'PROCESSING_EXCEPTION',
        reasonDetail: errMsg,
        leadId: null,
        leadCode: null,
        sourceWebsite: null,
        submissionId: null,
        processedAt: new Date().toISOString(),
      });
    }
  }

  const nowIso = new Date().toISOString();
  await Promise.all([
    saveGmailSyncCheckpoint({
      accountKey,
      lastProcessedInternalDateMs: maxInternalDateSeen > 0 ? maxInternalDateSeen : checkpoint.lastProcessedInternalDateMs,
      lastMessageId: lastMessageIdSeen,
      lastSuccessAt: summary.failed === 0 ? nowIso : checkpoint.lastSuccessAt,
      lastError: summary.failed > 0 ? `${summary.failed} thư lỗi xử lý` : null,
      consecutiveFailures: summary.failed > 0 ? checkpoint.consecutiveFailures + 1 : 0,
      failedMessageRetries: checkpoint.failedMessageRetries,
    }),
    saveGmailLeadSyncConfig({
      enabled: config.enabled,
      query,
      maxMessages,
      pollIntervalSec: config.pollIntervalSec,
      onlyLeadKeywords,
      lastSyncAt: nowIso,
      lastSyncSummary: summary,
    }),
    appendGmailIntakeAuditLogs(auditEntries),
  ]);

  if (summary.created > 0) {
    bumpDomainRevisions(['leads', 'reports', 'tracking', 'notifications'], 'gmail_leads_synced');
  }

  return {
    ok: true,
    connectedEmail: conn.connectedEmail,
    message:
      summary.created > 0
        ? `Đã tạo ${summary.created} Lead mới từ Gmail (${summary.scanned} thư quét qua ${pagesFetched} trang, ${summary.deduplicated} thư trùng, ${summary.skippedNoise} thư lọc bỏ).`
        : `Đã quét ${summary.scanned} thư từ Gmail (${pagesFetched} trang) — chưa có Lead mới (${summary.deduplicated} thư trùng, ${summary.skippedNoise} thư lọc bỏ).`,
    summary,
    createdLeads,
    auditEntries,
  };
}


export interface LegacyGmailWebsiteReconcileItem {
  leadId: number;
  leadCode: string;
  previousSourceWebsite: string | null;
  resolvedSourceWebsite: string | null;
  method: string;
  action: 'updated_to_website' | 'cleared_gmail_domain' | 'kept_unresolved';
}

/**
 * U02: Rà lại các Lead cũ đang mang nguồn Gmail; chỉ cập nhật website khi có căn cứ rõ ràng
 * trong nội dung/tiêu đề email lưu tại LeadActivity, hoặc xóa nếu đang gán nhầm domain Gmail.
 * Ghi lịch sử thay đổi vào LeadActivity khi `dryRun = false`.
 */
export async function reconcileLegacyGmailSourceWebsites(dryRun = true): Promise<{
  dryRun: boolean;
  inspectedCount: number;
  updatedCount: number;
  items: LegacyGmailWebsiteReconcileItem[];
}> {
  const leads = await prisma.lead.findMany({
    where: {
      OR: [
        { sourceWebsite: { contains: 'gmail' } },
        { tracking: { is: { intakeSourceProvider: 'gmail_sync' } } },
      ],
    },
    include: {
      tracking: true,
      activities: {
        orderBy: { id: 'asc' },
        take: 5,
      },
    },
  });

  const items: LegacyGmailWebsiteReconcileItem[] = [];
  let updatedCount = 0;

  for (const lead of leads) {
    const currentWebsite = lead.sourceWebsite || null;
    const isInvalidGmailWebsite = Boolean(currentWebsite && /gmail\.com|googlemail\.com/i.test(currentWebsite));

    const gmailActivity = lead.activities.find((a) =>
      (a.note || '').includes('[Đồng bộ tự động từ Gmail'),
    );
    const noteText = gmailActivity?.note || '';
    const senderMatch = noteText.match(/^Người gửi:\s*(.+)$/m);
    const subjectMatch = noteText.match(/^Tiêu đề:\s*(.+)$/m);
    const bodyMatch = noteText.match(/Nội dung tóm tắt:\n([\s\S]+)$/);

    const fromHeader = senderMatch?.[1]?.trim() || '';
    const subject = subjectMatch?.[1]?.trim() || lead.projectName || '';
    const bodyText = bodyMatch?.[1]?.trim() || noteText;

    const parsed = parseStructuredFormEmailBody(subject, bodyText, fromHeader);
    let nextWebsite = currentWebsite;
    let action: LegacyGmailWebsiteReconcileItem['action'] = 'kept_unresolved';

    if (parsed.sourceWebsite && parsed.websiteResolutionMethod !== 'unresolved') {
      if (currentWebsite !== parsed.sourceWebsite) {
        nextWebsite = parsed.sourceWebsite;
        action = 'updated_to_website';
      }
    } else if (isInvalidGmailWebsite) {
      nextWebsite = null;
      action = 'cleared_gmail_domain';
    }

    if (action !== 'kept_unresolved') {
      updatedCount += 1;
      if (!dryRun) {
        await prisma.$transaction(async (tx) => {
          await tx.lead.update({
            where: { id: lead.id },
            data: {
              sourceWebsite: nextWebsite,
              contactChannel: parsed.isStructuredForm ? 'form_web' : lead.contactChannel,
            },
          });
          await tx.leadActivity.create({
            data: {
              leadId: lead.id,
              actionType: 'add_note',
              actorType: 'system',
              note: `[U02 Rà soát website nguồn] ${currentWebsite || 'Chưa xác định'} → ${nextWebsite || 'Chưa xác định website'} (Phương pháp: ${parsed.websiteResolutionMethod}).`,
            },
          });
        });
      }
    }

    items.push({
      leadId: lead.id,
      leadCode: lead.leadCode,
      previousSourceWebsite: currentWebsite,
      resolvedSourceWebsite: nextWebsite,
      method: parsed.websiteResolutionMethod,
      action,
    });
  }

  return {
    dryRun,
    inspectedCount: leads.length,
    updatedCount,
    items,
  };
}
