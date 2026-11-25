import { z } from 'zod';
import type { MonetaryAmountDto, WebsiteConfigItemDto } from './index';

export const REPORT_PRESETS = ['7d', '30d', 'all', 'custom'] as const;
export type ReportPreset = (typeof REPORT_PRESETS)[number];

export interface SalesPerformanceRowDto {
  salesUserId: number;
  salesFullName: string;
  avatarUrl?: string | null;
  coverUrl?: string | null;
  isOnline: boolean;
  isReceivingLeads: boolean;
  totalLeads: number;
  newLeads: number;
  quotingLeads: number;
  quoteSentLeads: number;
  wonLeads: number;
  lostLeads: number;
  unansweredOverdue7d: number;
  winRateText: string;
}

export interface ProductInsightRowDto {
  productId: number;
  productCode: string;
  productName: string;
  category: 'MAN_HINH_LED' | 'BANG_DIEN_TU' | 'KHAC';
  inquiryCount: number;
  wonCount: number;
}

export interface UnansweredQuoteItemDto {
  leadId: number;
  leadCode: string;
  companyOrContact: string;
  phone: string;
  assignedSalesName: string;
  quoteSentAt: string;
  daysWaiting: number;
  isOverdue7Days: boolean;
  productSummary: string;
}

export interface DetailedReportLeadRowDto {
  stt: number;
  leadCode: string;
  receivedAt: string;
  assignedSalesName: string;
  companyOrCustomer: string;
  phone: string;
  sourceWebsite: string;
  contactChannel: string;
  marketingSource: string;
  productsText: string;
  pipelineStatusLabel: string;
  noteOrReason: string;
  isAnonymized: boolean;
}

export interface ActionableTaskItemDto {
  id:
    | 'unaccepted_leads'
    | 'overdue_quotes'
    | 'leads_need_review'
    | 'pending_designs'
    | 'seo_approvals'
    | 'publication_failures'
    | 'sync_failures';
  title: string;
  description: string;
  count: number;
  severity: 'critical' | 'warning' | 'info';
  moduleLabel: string;
  href: string;
}

export interface MarketingSourcePerformanceRowDto {
  key: string;
  sourceName: string;
  campaignName: string;
  spend: MonetaryAmountDto | null;
  platformConversions: number;
  crmLeadsL1: number;
  crmValidL2: number;
  crmEffectiveL3: number;
  wonCount: number;
}

export interface LeadTrendPointDto {
  date: string;
  label: string;
  totalL1: number;
  validL2: number;
  wonCount: number;
}

export interface WebsiteOverviewItemDto {
  websiteId: string;
  shortName: string;
  domain: string;
  isDirectOrUnmapped?: boolean;
  pageViews: number | null;
  gscClicks: number | null;
  gscImpressions: number | null;
  totalLeadsL1: number;
  validLeadsL2: number;
  unreceivedCount: number;
  quotingAndSentCount: number;
  wonCount: number;
  sharePct: number;
}

export interface ReportsDashboardDto {
  scopeRole: string;
  scopeDescription: string;
  preset: ReportPreset;
  fromDate: string;
  toDate: string;
  websiteId?: string;
  websiteLabel?: string;
  availableWebsites?: WebsiteConfigItemDto[];
  websiteSummaries?: WebsiteOverviewItemDto[];
  trendGranularity?: 'day' | 'week';
  previousOverview?: {
    totalLeadsL1: number;
    validLeadsL2: number;
    unreceivedLeadsCount: number;
    quoteSentCount: number;
    wonCount: number;
  } | null;
  dataQualitySummary?: {
    missingWebsiteCount: number;
    missingProductCount: number;
    needsAttentionCount: number;
    failingConnectionsCount: number;
  };
  generatedAt: string;
  isSmallSample: boolean;
  smallSampleNotice: string | null;
  todayPreliminaryNotice: string;
  lastSyncedAt: string | null;
  overview: {
    totalLeadsL1: number;
    validLeadsL2: number;
    effectiveLeadsL3: number;
    activeLeadsCount: number;
    unreceivedLeadsCount: number;
    newLeadCount: number;
    quotingCount: number;
    quoteSentCount: number;
    wonCount: number;
    lostCount: number;
    unansweredQuoteCount: number;
    overdue7DaysQuoteCount: number;
    winRateText: string;
  };
  leadTrend: LeadTrendPointDto[];
  actionableTasks: ActionableTaskItemDto[];
  byChannel: Array<{
    channel: string;
    label: string;
    count: number;
  }>;
  salesPerformance: SalesPerformanceRowDto[];
  productInsights: ProductInsightRowDto[];
  unansweredQuotes: UnansweredQuoteItemDto[];
  marketingSummary: {
    totalAdsSpend: MonetaryAmountDto | null;
    platformReportedConversions: number;
    effectiveLeadsFromAds: number;
    cplEffective: MonetaryAmountDto | null;
    publishedSeoArticles: number;
    draftSeoArticles: number;
    scheduledSeoArticles: number;
    failedPublishArticles: number;
    optimizationNeededArticles: number;
    bySourceCampaign: MarketingSourcePerformanceRowDto[];
  };
  trackingOperationalSummary: {
    liveIntegrationMode: boolean;
    configuredConnectionsCount: number;
    totalConnectionsCount: number;
    openAlertsCount: number;
    failingConnectionsCount: number;
    gclidPendingRetryCount: number;
    wordpressConfigured: boolean;
    geminiConfigured: boolean;
  };
  designSummary: {
    totalRequests: number;
    pendingCount: number;
    inReviewCount: number;
    completed3dCount: number;
    completedBannerCount: number;
    avgProcessingSecText: string;
    totalAiTokens: number;
    totalAiCost: MonetaryAmountDto | null;
  };
  detailedLeads: DetailedReportLeadRowDto[];
}

export const ReportQuerySchema = z.object({
  preset: z.enum(REPORT_PRESETS).default('30d'),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});

