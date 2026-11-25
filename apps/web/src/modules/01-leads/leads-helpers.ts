import type {
  LeadItemDto,
  PipelineStatus,
  PriceCheckAlertDto,
} from '@toantrung/contracts';

/**
 * Rút gọn hiển thị mã hồ sơ Lead dài (VD: TT-20261106-000720 -> TT2611-0720,
 * TT-T06-1795464928165 -> TT-T06-8165) cho gọn mắt; mã gốc vẫn giữ đầy đủ trong tooltip & DB.
 */
export function formatCompactLeadCode(rawCode: string | null | undefined): string {
  if (!rawCode) return '';
  const code = rawCode.trim();
  // Mã mới đã gọn sẵn: TT-2611-0721 (<= 13 ký tự)
  if (/^TT-\d{4}-\d{4}$/i.test(code)) return code;
  // Mã cũ kiểu TT-20261106-000720 hoặc TT-20261124-00072010189
  const legacyDateMatch = code.match(/^TT-20(\d{2})(\d{2})\d{2}-(\d+)$/i);
  if (legacyDateMatch) {
    const [, yy, mm, digits] = legacyDateMatch;
    const shortSeq = digits.length <= 4 ? digits.padStart(4, '0') : digits.slice(-4);
    return `TT${yy}${mm}-${shortSeq}`;
  }
  // Mã thử nghiệm hoặc mã có timestamp dài (VD: TT-T06-1795464928165 -> TT-T06-8165)
  const longSuffixMatch = code.match(/^([A-Z0-9]+-[A-Z0-9]+)-(\d{7,})$/i);
  if (longSuffixMatch) {
    return `${longSuffixMatch[1]}-${longSuffixMatch[2].slice(-4)}`;
  }
  if (code.length > 16) {
    return `${code.slice(0, 7)}…${code.slice(-4)}`;
  }
  return code;
}

export const STATUS_BADGE_STYLES: Record<PipelineStatus, string> = {
  new_lead: 'bg-violet-50 text-violet-700 border-violet-200 font-semibold',
  quoting: 'bg-blue-50 text-blue-700 border-blue-200 font-semibold',
  quote_sent: 'bg-amber-50 text-amber-800 border-amber-300 font-semibold',
  won: 'bg-emerald-50 text-emerald-700 border-emerald-200 font-semibold',
  lost: 'bg-slate-100 text-slate-600 border-slate-200 font-semibold',
};

export const STATUS_ROW_ACCENTS: Record<PipelineStatus, string> = {
  new_lead: 'border-l-2 border-l-violet-400',
  quoting: 'border-l-2 border-l-blue-400',
  quote_sent: 'border-l-2 border-l-amber-400',
  won: 'border-l-2 border-l-emerald-400',
  lost: 'border-l-2 border-l-slate-300',
};

export const KANBAN_COLUMN_THEMES: Record<
  PipelineStatus,
  { wrap: string; headerBg: string; badge: string }
> = {
  new_lead: {
    wrap: 'bg-slate-50/70 border-slate-200/90',
    headerBg: 'bg-white border border-slate-200/80 text-slate-900',
    badge: 'bg-violet-50 text-violet-700 border border-violet-200',
  },
  quoting: {
    wrap: 'bg-slate-50/70 border-slate-200/90',
    headerBg: 'bg-white border border-slate-200/80 text-slate-900',
    badge: 'bg-blue-50 text-blue-700 border border-blue-200',
  },
  quote_sent: {
    wrap: 'bg-slate-50/70 border-slate-200/90',
    headerBg: 'bg-white border border-slate-200/80 text-slate-900',
    badge: 'bg-amber-50 text-amber-800 border border-amber-300',
  },
  won: {
    wrap: 'bg-slate-50/70 border-slate-200/90',
    headerBg: 'bg-white border border-slate-200/80 text-slate-900',
    badge: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  },
  lost: {
    wrap: 'bg-slate-50/70 border-slate-200/90',
    headerBg: 'bg-white border border-slate-200/80 text-slate-900',
    badge: 'bg-slate-100 text-slate-600 border border-slate-200',
  },
};

export type B2bFollowUpHorizonKey =
  | 'none'
  | 'hot_under_7d'
  | 'remind_7_14d'
  | 'monthly_15_45d'
  | 'longterm_next_year';

export const B2B_HORIZON_OPTIONS: {
  key: B2bFollowUpHorizonKey;
  tag: string;
  legacyTags: string[];
  label: string;
  shortLabel: string;
  badgeClass: string;
}[] = [
  {
    key: 'hot_under_7d',
    tag: '[NHU CẦU KHÁCH: ĐANG CẦN GẤP]',
    legacyTags: [
      '[NHU CẦU KHÁCH: CẦN TRIỂN KHAI SỚM]',
      '[THEO DÕI DỰ ÁN: ĐANG TƯ VẤN < 7 NGÀY]',
      '[CHU KỲ B2B: TƯƠNG TÁC NÓNG 3-7 NGÀY]',
    ],
    label: 'Khách có nhu cầu thực tế, cần tư vấn & triển khai sớm',
    shortLabel: 'Đang cần gấp',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  {
    key: 'remind_7_14d',
    tag: '[NHU CẦU KHÁCH: ĐANG CÂN NHẮC PHƯƠNG ÁN]',
    legacyTags: [
      '[NHU CẦU KHÁCH: ĐANG THAM KHẢO BÁO GIÁ]',
      '[THEO DÕI DỰ ÁN: LIÊN HỆ LẠI 7-30 NGÀY]',
      '[CHU KỲ B2B: HỎI GIÁ ĐỂ ĐÓ 7-14 NGÀY]',
    ],
    label: 'Khách đã nhận tư vấn, đang xem xét & so sánh phương án',
    shortLabel: 'Đang cân nhắc',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  {
    key: 'monthly_15_45d',
    tag: '[NHU CẦU KHÁCH: ĐANG THAM KHẢO THÔNG TIN]',
    legacyTags: [
      '[NHU CẦU KHÁCH: CHỜ TRÌNH DUYỆT NGÂN SÁCH]',
      '[THEO DÕI DỰ ÁN: ĐỊNH KỲ 1-2 THÁNG]',
      '[CHU KỲ B2B: NGÂM HÀNG THÁNG 15-45 NGÀY]',
    ],
    label: 'Khách mới tìm hiểu sản phẩm, hỏi thông số để tham khảo',
    shortLabel: 'Đang tham khảo',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  {
    key: 'longterm_next_year',
    tag: '[NHU CẦU KHÁCH: CHỜ MẶT BẰNG / DỰ ÁN TƯƠNG LAI]',
    legacyTags: [
      '[NHU CẦU KHÁCH: DỰ ÁN CHUẨN BỊ / TƯƠNG LAI]',
      '[THEO DÕI DỰ ÁN: DÀI HẠN > 2 THÁNG]',
      '[CHU KỲ B2B: DỰ ÁN DÀI HẠN / NĂM SAU CHỐT]',
    ],
    label: 'Công trình đang xây dựng hoặc kế hoạch lắp đặt sau',
    shortLabel: 'Chờ mặt bằng / Dự án sau',
    badgeClass: 'bg-violet-50 text-violet-700 border-violet-200',
  },
];

export function extractScheduledFollowUpDate(noteText: string): string {
  const match = noteText.match(/\[HẸN (?:LIÊN HỆ|GỌI LẠI):\s*([0-9]{4}-[0-9]{2}-[0-9]{2})\]/);
  return match ? match[1] : '';
}

export function normalizeWebsiteFilterParam(raw: string): string {
  const low = raw.trim().toLowerCase();
  if (low === 'ga4-508951192' || low === 'ga4_508951192' || low === '508951192') return 'bangdientu.com.vn';
  if (low === 'ga4-512879968' || low === 'ga4_512879968' || low === '512879968') return 'toantrung.com.vn';
  if (low === 'ga4-538179128' || low === 'ga4_538179128' || low === '538179128') return 'bangled.vn';
  if (low === 'ga4-509190194' || low === 'ga4_509190194' || low === '509190194') return 'manhinhled.net.vn';
  if (low === '__unresolved__' || low === 'missing') return '__unresolved__';
  return low;
}

export function getB2bFollowUpHorizon(lead: LeadItemDto): {
  key: B2bFollowUpHorizonKey;
  shortLabel: string;
  badgeClass: string;
  waitingDays: number;
  scheduledDate: string;
} {
  const combinedNote = `${lead.customProductNote || ''} ${lead.initialNote || ''}`;
  const scheduledDate = extractScheduledFollowUpDate(combinedNote);
  const refDateStr = lead.quoteSentAt || lead.contactedAt;
  const waitingDays = Math.max(
    0,
    Math.floor((Date.now() - new Date(refDateStr).getTime()) / (24 * 60 * 60 * 1000)),
  );

  for (const opt of B2B_HORIZON_OPTIONS) {
    if (
      combinedNote.includes(opt.tag) ||
      opt.legacyTags.some((t) => combinedNote.includes(t))
    ) {
      return {
        key: opt.key,
        shortLabel: opt.shortLabel,
        badgeClass: opt.badgeClass,
        waitingDays,
        scheduledDate,
      };
    }
  }

  if (
    combinedNote.toLowerCase().includes('năm sau') ||
    combinedNote.toLowerCase().includes('quý tới') ||
    combinedNote.toLowerCase().includes('tương lai')
  ) {
    return {
      key: 'longterm_next_year',
      shortLabel: 'Chờ mặt bằng / Dự án sau',
      badgeClass: 'bg-violet-50 text-violet-700 border-violet-200',
      waitingDays,
      scheduledDate,
    };
  }

  if (lead.pipelineStatus !== 'quote_sent' && lead.pipelineStatus !== 'quoting') {
    return {
      key: 'none',
      shortLabel: '',
      badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
      waitingDays,
      scheduledDate,
    };
  }

  if (waitingDays > 45) {
    return {
      key: 'longterm_next_year',
      shortLabel: 'Chờ mặt bằng / Dự án sau',
      badgeClass: 'bg-violet-50 text-violet-700 border-violet-200',
      waitingDays,
      scheduledDate,
    };
  }
  if (waitingDays >= 15) {
    return {
      key: 'monthly_15_45d',
      shortLabel: 'Đang tham khảo',
      badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
      waitingDays,
      scheduledDate,
    };
  }
  if (waitingDays >= 7 || lead.isQuoteOverdue7Days) {
    return {
      key: 'remind_7_14d',
      shortLabel: 'Đang cân nhắc',
      badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
      waitingDays: Math.max(waitingDays, 7),
      scheduledDate,
    };
  }
  return {
    key: 'hot_under_7d',
    shortLabel: 'Đang cần gấp',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    waitingDays,
    scheduledDate,
  };
}

export interface FraudEvaluationResult {
  phoneSubmitCount30d: number;
  hasDuplicatePhone: boolean;
  duplicateProjectName: string | null;
  duplicateProjectPartnerCode: string | null;
  hasPriceProbeBehavior: boolean;
  priceProbeReason: string | null;
  hasBlacklistedOrSpam: boolean;
  spamOrBurnerReason: string | null;
  duplicateScenario:
    | 'NONE'
    | 'SCENARIO_1_ACTIVE_DUP'
    | 'SCENARIO_2_WON_RETURNING'
    | 'SCENARIO_2_LOST_RETURNING'
    | 'SCENARIO_3_MULTI_CONTRACTOR';
  matchedCustomerLead: LeadItemDto | null;
  isCustomerWonVIP: boolean;
  projectContractors: Array<{
    leadId: number;
    leadCode: string;
    companyName: string;
    assignedSalesName: string;
    pipelineStatus: PipelineStatus;
  }>;
  transferredFromSalesName: string | null;
  transferCount: number;
}

export function isInvalidClosedLead(l: LeadItemDto): boolean {
  if (l.spamStatus !== 'NONE') return true;
  if (l.pipelineStatus !== 'lost') return false;
  const r = (l.lostReason || '').toLowerCase();
  return (
    r.includes('sai số') ||
    r.includes('nhầm máy') ||
    r.includes('không tồn tại') ||
    r.includes('trùng lead') ||
    r.includes('spam')
  );
}

export interface LeadsFraudIndex {
  byId: Map<number, LeadItemDto>;
  byPhone: Map<string, LeadItemDto[]>;
  byEmail: Map<string, LeadItemDto[]>;
  byCompany: Map<string, LeadItemDto[]>;
  byProj: Map<string, LeadItemDto[]>;
  byAddr: Map<string, LeadItemDto[]>;
  activeAlertsByLeadId: Map<number, PriceCheckAlertDto>;
  activeAlertsByPhone: Map<string, PriceCheckAlertDto>;
  activeAlertsByCompany: Map<string, PriceCheckAlertDto>;
}

export function buildLeadsFraudIndex(
  allLeads: LeadItemDto[],
  priceAlerts: PriceCheckAlertDto[],
): LeadsFraudIndex {
  const byId = new Map<number, LeadItemDto>();
  const byPhone = new Map<string, LeadItemDto[]>();
  const byEmail = new Map<string, LeadItemDto[]>();
  const byCompany = new Map<string, LeadItemDto[]>();
  const byProj = new Map<string, LeadItemDto[]>();
  const byAddr = new Map<string, LeadItemDto[]>();
  const activeAlertsByLeadId = new Map<number, PriceCheckAlertDto>();
  const activeAlertsByPhone = new Map<string, PriceCheckAlertDto>();
  const activeAlertsByCompany = new Map<string, PriceCheckAlertDto>();

  const pushToMap = (m: Map<string, LeadItemDto[]>, key: string, item: LeadItemDto) => {
    const arr = m.get(key);
    if (arr) arr.push(item);
    else m.set(key, [item]);
  };

  for (const item of allLeads) {
    byId.set(item.id, item);
    if (isInvalidClosedLead(item)) continue;
    const cleanP = item.phone.replace(/\D/g, '');
    if (cleanP && !cleanP.includes('*')) pushToMap(byPhone, cleanP, item);
    const normE = (item.email || '').trim().toLowerCase();
    if (normE && !normE.includes('*')) pushToMap(byEmail, normE, item);
    const normC = (item.companyName || '').trim().toLowerCase();
    if (normC.length >= 5) pushToMap(byCompany, normC, item);
    const normP = (item.projectName || '').trim().toLowerCase();
    if (normP.length >= 5) pushToMap(byProj, normP, item);
    const normA = (item.installationAddress || '').trim().toLowerCase();
    if (normA.length >= 10 && !normA.includes('ẩn địa chỉ')) pushToMap(byAddr, normA, item);
  }

  for (const a of priceAlerts) {
    if (a.status !== 'ACTIVE') continue;
    if (a.leadId) activeAlertsByLeadId.set(a.leadId, a);
    if (a.phone) activeAlertsByPhone.set(a.phone, a);
    if (a.companyName) activeAlertsByCompany.set(a.companyName, a);
  }

  return {
    byId,
    byPhone,
    byEmail,
    byCompany,
    byProj,
    byAddr,
    activeAlertsByLeadId,
    activeAlertsByPhone,
    activeAlertsByCompany,
  };
}

export function evaluateLeadFraudCriteria(
  lead: LeadItemDto,
  allLeads: LeadItemDto[],
  priceAlerts: PriceCheckAlertDto[],
  precomputedIndex?: LeadsFraudIndex,
): FraudEvaluationResult {
  const index = precomputedIndex || buildLeadsFraudIndex(allLeads, priceAlerts);
  const nowMs = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const cleanPhone = lead.phone.replace(/\D/g, '');
  const normCompany = (lead.companyName || '').trim().toLowerCase();
  const normEmail = (lead.email || '').trim().toLowerCase();

  const transferActivities = (lead.activities || []).filter(
    (act) => act.actionType === 'reassign_sales',
  );
  const latestTransfer = transferActivities[0] || null;
  const transferredFromSalesName = latestTransfer?.fromSalesName || null;
  const transferCount = transferActivities.length;

  const explicitLinkedLead = lead.duplicateOfLeadId
    ? index.byId.get(lead.duplicateOfLeadId) || null
    : null;

  const phoneCandidates = cleanPhone && !cleanPhone.includes('*') ? index.byPhone.get(cleanPhone) || [] : [];
  const samePhoneWithin30d = phoneCandidates.filter((other) => {
    if (other.id > lead.id) return false;
    const diff = Math.abs(nowMs - new Date(other.contactedAt).getTime());
    return diff <= thirtyDaysMs;
  });
  const isCurrentLeadClosed =
    lead.pipelineStatus === 'won' || lead.pipelineStatus === 'lost';

  const relatedMap = new Map<number, LeadItemDto>();
  for (const o of phoneCandidates) {
    if (o.id !== lead.id) relatedMap.set(o.id, o);
  }
  if (normEmail && !normEmail.includes('*')) {
    for (const o of index.byEmail.get(normEmail) || []) {
      if (o.id !== lead.id) relatedMap.set(o.id, o);
    }
  }
  if (normCompany.length >= 5) {
    for (const o of index.byCompany.get(normCompany) || []) {
      if (o.id !== lead.id) relatedMap.set(o.id, o);
    }
  }
  const allRelatedCustomerLeads = Array.from(relatedMap.values());

  const wonCustomerLead =
    (explicitLinkedLead?.pipelineStatus === 'won' ? explicitLinkedLead : null) ||
    allRelatedCustomerLeads.find((o) => o.pipelineStatus === 'won') ||
    null;

  const isCustomerWonVIP =
    lead.pipelineStatus === 'won' ||
    Boolean(wonCustomerLead) ||
    lead.duplicateOfLeadStatus === 'won' ||
    Boolean(lead.reopenReason && lead.reopenReason.includes('đã từng chốt hợp đồng'));

  const sameCustomerLeads = allRelatedCustomerLeads.filter((other) => other.id < lead.id);

  const phoneSubmitCount30d = isCurrentLeadClosed
    ? 1
    : Math.max(samePhoneWithin30d.length, lead.duplicateType !== 'NONE' ? 2 : 1);
  const hasDuplicatePhone = !isCurrentLeadClosed && (phoneSubmitCount30d >= 2 || lead.duplicateType !== 'NONE');

  const normalizedProj = (lead.projectName || '').trim().toLowerCase();
  const normalizedAddr = (lead.installationAddress || '').trim().toLowerCase();
  const contractorMap = new Map<number, LeadItemDto>();
  if (!isCurrentLeadClosed) {
    const considerContractor = (other: LeadItemDto) => {
      if (other.id === lead.id) return;
      const otherClean = other.phone.replace(/\D/g, '');
      const otherComp = (other.companyName || '').trim().toLowerCase();
      if (cleanPhone && otherClean === cleanPhone) return;
      if (normCompany && otherComp && normCompany === otherComp) return;
      contractorMap.set(other.id, other);
    };
    if (normalizedProj.length >= 5) {
      for (const o of index.byProj.get(normalizedProj) || []) considerContractor(o);
    }
    if (normalizedAddr.length >= 10 && !normalizedAddr.includes('ẩn địa chỉ')) {
      for (const o of index.byAddr.get(normalizedAddr) || []) considerContractor(o);
    }
  }
  const multiContractorLeads = Array.from(contractorMap.values());

  const projectContractors = multiContractorLeads.map((c) => ({
    leadId: c.id,
    leadCode: c.leadCode,
    companyName: c.companyName || c.contactName || `Nhà thầu (${c.leadCode})`,
    assignedSalesName: c.assignedSalesName || 'Chưa phân bổ',
    pipelineStatus: c.pipelineStatus,
  }));

  const matchingProjectLead = multiContractorLeads[0];
  const duplicateProjectName = matchingProjectLead
    ? lead.projectName || lead.installationAddress || null
    : null;

  let duplicateScenario: FraudEvaluationResult['duplicateScenario'] = 'NONE';
  let matchedCustomerLead: LeadItemDto | null = null;

  if (!isCurrentLeadClosed) {
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
    const currentCreatedMs = new Date(lead.contactedAt).getTime();

    const openSameCustomerLead = allRelatedCustomerLeads.find((other) => {
      const isOpen =
        other.pipelineStatus === 'new_lead' ||
        other.pipelineStatus === 'quoting' ||
        other.pipelineStatus === 'quote_sent';
      if (!isOpen) return false;
      const diffMs = Math.abs(currentCreatedMs - new Date(other.contactedAt).getTime());
      return diffMs <= fourteenDaysMs;
    });

    const wonSameCustomerLead = wonCustomerLead || allRelatedCustomerLeads.find(
      (other) => other.pipelineStatus === 'won',
    );

    const lostOrPriorUnclosedLead = allRelatedCustomerLeads.find((other) => {
      if (other.pipelineStatus === 'lost') return true;
      const isOpen =
        other.pipelineStatus === 'new_lead' ||
        other.pipelineStatus === 'quoting' ||
        other.pipelineStatus === 'quote_sent';
      if (!isOpen) return false;
      const diffMs = Math.abs(currentCreatedMs - new Date(other.contactedAt).getTime());
      return diffMs > fourteenDaysMs;
    });

    if (openSameCustomerLead) {
      duplicateScenario = 'SCENARIO_1_ACTIVE_DUP';
      matchedCustomerLead = explicitLinkedLead || openSameCustomerLead;
    } else if (wonSameCustomerLead || lead.duplicateOfLeadStatus === 'won' || isCustomerWonVIP) {
      duplicateScenario = 'SCENARIO_2_WON_RETURNING';
      matchedCustomerLead = wonSameCustomerLead || explicitLinkedLead || null;
    } else if (
      lostOrPriorUnclosedLead ||
      lead.duplicateOfLeadStatus === 'lost' ||
      lead.duplicateType === 'PRIOR_LEAD' ||
      lead.isRepeatLead ||
      explicitLinkedLead
    ) {
      duplicateScenario = 'SCENARIO_2_LOST_RETURNING';
      matchedCustomerLead = explicitLinkedLead || lostOrPriorUnclosedLead || sameCustomerLeads[0] || allRelatedCustomerLeads[0] || null;
    } else if (lead.duplicateType === 'ACTIVE_RED') {
      duplicateScenario = 'SCENARIO_1_ACTIVE_DUP';
      matchedCustomerLead = explicitLinkedLead || sameCustomerLeads[0] || allRelatedCustomerLeads[0] || null;
    } else if (projectContractors.length > 0) {
      duplicateScenario = 'SCENARIO_3_MULTI_CONTRACTOR';
    }
  }

  const noteText = `${lead.customProductNote || ''} ${lead.initialNote || ''}`.toLowerCase();
  const asksRawModuleOnly =
    !lead.installationAddress &&
    (noteText.includes('giá module') ||
      noteText.includes('báo giá gấp') ||
      noteText.includes('dò giá') ||
      noteText.includes('đơn giá') ||
      noteText.includes('kabinet'));
  const matchedAlert =
    index.activeAlertsByLeadId.get(lead.id) ||
    index.activeAlertsByPhone.get(lead.phone) ||
    (lead.companyName ? index.activeAlertsByCompany.get(lead.companyName) : undefined);
  const hasPriceProbeBehavior = Boolean(
    lead.isPriceCheckSuspect || matchedAlert || asksRawModuleOnly,
  );
  const priceProbeReason =
    matchedAlert?.reasonEvidence ||
    (asksRawModuleOnly
      ? 'Hỏi giá vật tư / module rời nhưng từ chối cung cấp địa chỉ khảo sát lắp đặt thực tế.'
      : lead.isPriceCheckSuspect
        ? 'Trùng SĐT hoặc Tên đơn vị trong danh sách cảnh báo đối thủ dò giá (E5).'
        : null);

  const isPriceShoppingOnly =
    hasPriceProbeBehavior &&
    lead.spamStatus === 'PENDING_REVIEW' &&
    (!lead.spamReason ||
      lead.spamReason.toLowerCase().includes('khảo giá') ||
      lead.spamReason.toLowerCase().includes('dò giá'));
  const isBurnerPrefix =
    cleanPhone.startsWith('099') ||
    cleanPhone.startsWith('059') ||
    /(\d)\1{5,}/.test(cleanPhone) ||
    !lead.isPhoneNormalized;
  const hasBlacklistedOrSpam =
    (lead.spamStatus !== 'NONE' && !isPriceShoppingOnly) || isBurnerPrefix;
  const spamOrBurnerReason =
    !isPriceShoppingOnly && lead.spamReason
      ? lead.spamReason
      : isBurnerPrefix
        ? 'Đầu số ảo / dãy số lặp bất thường hoặc SĐT chưa chuẩn hóa (Burner/Blacklist Pattern).'
        : null;

  return {
    phoneSubmitCount30d,
    hasDuplicatePhone,
    duplicateProjectName,
    duplicateProjectPartnerCode: matchingProjectLead?.leadCode || lead.duplicateOfLeadCode || null,
    hasPriceProbeBehavior,
    priceProbeReason,
    hasBlacklistedOrSpam,
    spamOrBurnerReason,
    duplicateScenario,
    matchedCustomerLead,
    isCustomerWonVIP,
    projectContractors,
    transferredFromSalesName,
    transferCount,
  };
}
