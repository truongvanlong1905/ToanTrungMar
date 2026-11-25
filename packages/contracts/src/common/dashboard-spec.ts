export interface WebsiteConfigItemDto {
  websiteId: string;
  shortName: string;
  domain: string;
  ga4PropertyId: string | null;
  gscSiteUrl: string | null;
  adsCustomerId: string | null;
}

export type DashboardDatePreset = 'TODAY' | 'YESTERDAY' | '7D' | '30D' | 'CUSTOM';

export type DataFreshnessState =
  | 'FINALIZED'
  | 'PRELIMINARY'
  | 'CACHED'
  | 'NO_DATA'
  | 'ERROR';

export interface DashboardScopeDto {
  websiteId: string;
  websiteLabel: string;
  domain: string | null;
  startDate: string;
  endDate: string;
  timezone: string;
  isTodayIncluded: boolean;
  cohortDefinition: string;
  previousStartDate?: string;
  previousEndDate?: string;
}

export interface DashboardFreshnessDto {
  lastCheckedAt: string;
  lastSuccessAt: string | null;
  dataThrough: string | null;
  state: DataFreshnessState;
  statusMessage: string;
  /** Thời điểm kiểm tra thực tế (khi API đọc / kiểm tra dữ liệu) */
  checkedAt?: string;
  /** Lần đồng bộ thành công gần nhất từ nguồn */
  lastSyncedAt?: string | null;
  /** Thời điểm dữ liệu mới nhất nguồn cung cấp (YYYY-MM-DD hoặc ISO) */
  latestSourceDataAt?: string | null;
  /** Đánh dấu kết quả đọc từ bộ nhớ đệm đúng phạm vi */
  fromCache?: boolean;
}

export interface DashboardCoverageDto {
  availableWebsites: WebsiteConfigItemDto[];
  includedWebsites: string[];
  missingWebsites: string[];
  note: string | null;
}

export interface PaginatedTableDto<T> {
  rows: T[];
  totalRows: number;
  page: number;
  pageSize: number;
}

// ============================================================================
// M02 — CHIẾN DỊCH (TRUY CẬP & QUẢNG CÁO)
// ============================================================================

export interface M02TrafficSeriesPointDto {
  date: string;
  sessions: number | null;
  pageViews: number | null;
  users: number | null;
  newUsers?: number | null;
  isMissingData: boolean;
}

export interface M02SourceMediumRowDto {
  sourceMedium: string;
  sessions: number;
  newUsers: number;
  engagedSessions: number;
  engagementRatePct: number | null;
}

export interface M02AdsSearchTermRowDto {
  searchTerm: string;
  campaignName: string;
  adGroupName: string;
  status: string;
  impressions: number;
  clicks: number;
  ctrPct: number | null;
  cost: number;
  conversions: number;
}

export interface M02AdsLandingPageRowDto {
  url: string;
  campaignName: string;
  clicks: number;
  impressions: number;
  ctrPct: number | null;
  avgCpc: number | null;
  cost: number;
  conversions: number;
}

export interface M02AdsTimeScheduleRowDto {
  dayOfWeek: string;
  hour: number;
  clicks: number;
  impressions: number;
  cost: number;
  conversions: number;
}

export interface M02ChannelRowDto {
  channelKey: string;
  channelLabel: string;
  source?: string;
  medium?: string;
  sessions: number;
  engagedSessions: number | null;
  engagementRatePct: number | null;
  formEvents?: number | null;
  validLeadCount: number;
}

export type M02LandingPageCategoryKey =
  | 'homepage'
  | 'product'
  | 'quote_contact'
  | 'project'
  | 'content_seo'
  | 'technical_noise'
  | 'other';

export interface M02LandingPageRowDto {
  landingPage: string;
  sessions: number;
  engagedSessions: number | null;
  engagementRatePct: number | null;
  successfulFormCount: number | null;
  validLeadCount: number;
  newUsers?: number | null;
  totalUsers?: number | null;
  newUserRatePct?: number | null;
  categoryKey?: M02LandingPageCategoryKey;
  categoryLabel?: string;
}

export interface M02LandingPageCategorySummaryDto {
  categoryKey: M02LandingPageCategoryKey | string;
  categoryLabel: string;
  pageCount: number;
  newUsers: number | null;
  totalUsers: number | null;
  sessions: number;
  engagedSessions: number | null;
  engagementRatePct: number | null;
  validLeadCount: number;
}

export interface M02Ga4EventItemDto {
  eventName: string;
  eventCount: number;
  totalUsers?: number | null;
}

export interface M02InteractionRowDto {
  actionKey: string;
  actionLabel: string;
  count: number | null;
  users: number | null;
  meaning: string;
  mappedEventName: string | null;
  trackingConfigured?: boolean;
}

export interface M02ProductInterestRowDto {
  productId: number;
  productName: string;
  productUrl: string | null;
  pageViews: number | null;
  users: number | null;
  phoneClicks: number | null;
  zaloClicks: number | null;
  validLeadCount: number;
}

export interface M02JourneyStepDto {
  stepKey: string;
  label: string;
  sessionCount: number | null;
}

export interface M02CampaignDailyRowDto {
  date: string;
  cost: number;
  impressions: number;
  clicks: number;
  ctrPct: number | null;
  avgCpc: number | null;
  conversions: number;
}

export interface M02CampaignRowDto {
  campaignId: string;
  campaignName: string;
  status: string;
  channelType: string | null;
  currency: string;
  cost: number;
  impressions: number;
  clicks: number;
  ctrPct: number | null;
  avgCpc: number | null;
  conversions: number;
  costPerConversion: number | null;
  attributedLeadCount: number;
  validAttributedLeadCount: number;
  wonAttributedLeadCount: number;
  costPerValidLead: number | null;
  attributionStatus: 'RECONCILED' | 'UNATTRIBUTED_WEBSITE' | 'NO_CRM_MATCH';
  attributionNote: string;
  targetWebsiteDomain?: string | null;
  finalUrls?: string[];
  primaryDestinationUrl?: string | null;
  dailyRows?: M02CampaignDailyRowDto[];
}

export interface M02AdsSectionDto {
  status: 'CONNECTED' | 'UNCONFIGURED' | 'ERROR';
  statusMessage: string;
  currencyCode: string;
  adsScopeMode?: 'ALL_WEBSITES' | 'SELECTED_WEBSITE';
  activeCampaignsCount?: number;
  totalCampaignsCount?: number;
  metrics: {
    cost: number | null;
    impressions: number | null;
    clicks: number | null;
    ctrPct: number | null;
    avgCpc: number | null;
    conversions: number | null;
    costPerConversion: number | null;
    attributedLeadCount: number;
    validAttributedLeadCount: number;
    wonAttributedLeadCount: number;
    costPerValidLead: number | null;
    reconciliationNote: string;
  };
  series: Array<{
    date: string;
    cost: number | null;
    conversions: number | null;
    clicks: number | null;
    impressions?: number | null;
    ctrPct?: number | null;
    avgCpc?: number | null;
  }>;
  previousSeries?: Array<{
    date: string;
    cost: number | null;
    conversions: number | null;
    clicks: number | null;
    impressions?: number | null;
    ctrPct?: number | null;
    avgCpc?: number | null;
  }>;
  campaigns: PaginatedTableDto<M02CampaignRowDto>;
  breakdowns: {
    adGroups: Array<{
      adGroupId: string;
      adGroupName: string;
      campaignName: string;
      cost: number;
      impressions: number;
      clicks: number;
      conversions: number;
      cpa: number | null;
    }>;
    keywords: Array<{
      keywordText: string;
      matchType: string;
      adGroupName: string;
      campaignName: string;
      impressions: number;
      clicks: number;
      ctrPct: number | null;
      cost: number;
      conversions: number;
    }>;
    searchTerms?: M02AdsSearchTermRowDto[];
    landingPages?: M02AdsLandingPageRowDto[];
    timeSchedule?: M02AdsTimeScheduleRowDto[];
    keywordAvailabilityNote: string | null;
    devices: Array<{ device: string; cost: number; clicks: number; impressions: number }>;
    regions: Array<{ region: string; cost: number; clicks: number; impressions: number }>;
  };
}

export interface M02TrafficInteractionDto {
  scope: DashboardScopeDto;
  freshness: DashboardFreshnessDto;
  coverage: DashboardCoverageDto;
  version: string;
  metrics: {
    users: number | null;
    newUsers: number | null;
    sessions: number | null;
    pageViews: number | null;
    engagementRatePct: number | null;
    engagedSessions: number | null;
    averageEngagementSeconds: number | null;
    validFormLeadCount: number;
    formEventCount?: number | null;
    activeUsers30m: number | null;
    activeWindowCheckedAt?: string | null;
    previousSessions?: number | null;
    previousUsers?: number | null;
    previousPageViews?: number | null;
    previousFormLeadCount?: number | null;
  };
  realtimeMinutesSeries: Array<{ minutesAgo: number; activeUsers: number }>;
  realtimeEvents?: M02Ga4EventItemDto[];
  realtimeActivePages?: Array<{ pageTitle: string; activeUsers: number }>;
  allGa4Events?: M02Ga4EventItemDto[];
  charts: {
    trafficSeries: M02TrafficSeriesPointDto[];
    previousTrafficSeries?: M02TrafficSeriesPointDto[];
    channelRows: M02ChannelRowDto[];
    sourceMediumRows?: M02SourceMediumRowDto[];
    deviceRows: Array<{ deviceCategory: string; sessions: number }>;
    geoRows: Array<{ locationLabel: string; sessions: number }>;
  };
  tables: {
    landingPageRows: PaginatedTableDto<M02LandingPageRowDto>;
    landingPageCategories?: M02LandingPageCategorySummaryDto[];
    interactionRows: M02InteractionRowDto[];
    formSessionRatePct: number | null;
    productInterestRows: M02ProductInterestRowDto[];
    journeySteps: M02JourneyStepDto[];
    journeyAvailable: boolean;
    journeyNote: string | null;
  };
  ads?: M02AdsSectionDto;
}

// ============================================================================
// M03 — TỪ KHÓA & SEO, NỘI DUNG, XU HƯỚNG
// ============================================================================

export interface M03AdDailyPointDto {
  date: string;
  cost: number | null;
  clicks: number | null;
  conversions: number | null;
}

export interface M03AdCampaignRowDto {
  campaignId: string;
  campaignName: string;
  status: string;
  channelType: string | null;
  cost: number;
  impressions: number;
  clicks: number;
  ctrPct: number | null;
  cpc: number | null;
  conversions: number;
  validLeadCount: number;
  cpl: number | null;
}

export interface M03SeoDailyPointDto {
  date: string;
  clicks: number | null;
  impressions: number | null;
  ctrPct: number | null;
  averagePosition: number | null;
  completenessState: 'FINALIZED' | 'PRELIMINARY' | 'UNKNOWN' | 'QUERY_ERROR' | 'NO_DATA';
}

export interface M03SeoComparisonRowDto {
  key: string;
  clicks: number;
  impressions: number;
  ctrPct: number | null;
  averagePosition: number | null;
  previousClicks: number | null;
  clickChange: number | null;
  clickChangePct: number | null;
  previousImpressions?: number | null;
  impressionChange?: number | null;
  previousCtrPct?: number | null;
  ctrChangePctPt?: number | null;
  previousPosition: number | null;
  positionImprovement: number | null;
}

export interface M03SiteStatusRowDto {
  url: string;
  verdict: string;
  coverageState: string;
  issuesToReview: string | null;
  lastCrawlTime: string | null;
  lastCheckedAt: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
}

export interface M03TrendRowDto {
  term: string;
  geoCode: string;
  geoName: string;
  date: string;
  interestValue: number | null;
  scaleType: string;
  comparisonGroupId: string;
  relatedRisingQueries?: string[];
  sourceType?: 'GOOGLE_TRENDS_INDEX' | 'GOOGLE_TRENDS_RSS' | 'GOOGLE_SUGGEST_VN';
  approxTrafficLabel?: string | null;
  newsHeadline?: string | null;
  newsSource?: string | null;
}

export interface M03SeoContentRowDto {
  contentId: number;
  title: string;
  targetWebsite: string | null;
  targetUrl: string | null;
  targetQuery: string;
  owner: string;
  workflowStatus: string;
  updatedAt: string;
  publishedAt: string | null;
  publishError: string | null;
}

export interface M03SeoDeviceCountryRowDto {
  dimensionType: 'DEVICE' | 'COUNTRY';
  dimensionKey: string;
  clicks: number;
  impressions: number;
  ctrPct: number | null;
  averagePosition: number | null;
}

export interface M03AdsSeoDashboardDto {
  scope: DashboardScopeDto;
  freshness: DashboardFreshnessDto;
  coverage: DashboardCoverageDto;
  version: string;
  ads: {
    status: 'CONNECTED' | 'UNCONFIGURED' | 'ERROR';
    statusMessage: string;
    currencyCode: string;
    metrics: {
      adCost: number | null;
      adImpressions: number | null;
      adClicks: number | null;
      adCtrPct: number | null;
      averageCpc: number | null;
      averageCpm: number | null;
      adConversions: number | null;
      costPerConversion: number | null;
      validAdLeadCount: number;
      costPerValidAdLead: number | null;
    };
    charts: {
      adDailySeries: M03AdDailyPointDto[];
      topCampaigns: Array<{ campaignName: string; cost: number }>;
    };
    tables: {
      campaigns: PaginatedTableDto<M03AdCampaignRowDto>;
      adGroups: Array<{ adGroupName: string; campaignName: string; cost: number; impressions: number; clicks: number; conversions: number; cpa: number | null }>;
      keywords: Array<{ keyword: string; matchType: string; adGroupName: string; campaignName: string; impressions: number; clicks: number; ctrPct: number | null; cost: number; conversions: number; cpa: number | null }>;
      keywordAvailabilityNote: string | null;
      deviceBreakdown: Array<{ device: string; cost: number; clicks: number; impressions: number }>;
      geoBreakdown: Array<{ location: string; cost: number; clicks: number; impressions: number }>;
    };
  };
  seo: {
    metrics: {
      organicSearchClicks: number | null;
      organicSearchImpressions: number | null;
      organicSearchCtrPct: number | null;
      averageSearchPosition: number | null;
      organicSessions: number | null;
      organicEngagementRatePct?: number | null;
      organicFormEvents?: number | null;
      organicValidLeadCount: number;
      organicLeadVerificationState?: 'VERIFIED' | 'INSUFFICIENT_EVIDENCE';
    };
    comparison: {
      previousStartDate: string;
      previousEndDate: string;
      previousClicks: number | null;
      previousImpressions: number | null;
      clickChangePct: number | null;
    };
    charts: {
      seoDailySeries: M03SeoDailyPointDto[];
      previousSeoDailySeries?: M03SeoDailyPointDto[];
      opportunityQueries: Array<{ query: string; impressions: number; ctrPct: number | null; averagePosition: number | null }>;
      opportunityThresholdNote: string;
      pagesDeltaSummary?: {
        risingPages: M03SeoComparisonRowDto[];
        decliningPages: M03SeoComparisonRowDto[];
        comparisonNote: string;
      };
    };
    tables: {
      queries: PaginatedTableDto<M03SeoComparisonRowDto>;
      pages: PaginatedTableDto<M03SeoComparisonRowDto>;
      content?: PaginatedTableDto<M03SeoContentRowDto>;
      deviceCountry?: M03SeoDeviceCountryRowDto[];
      queryPageLinks?: Array<{
        query: string;
        page: string;
        clicks: number;
        impressions: number;
        ctrPct: number | null;
        averagePosition: number | null;
      }>;
    };
    opportunityConfig?: {
      minImpressionsForLowCtr: number;
      maxCtrPctForOpportunity: number;
      staleContentDays: number;
    };
  };
  siteStatus: {
    status: 'CONNECTED' | 'UNCONFIGURED' | 'ERROR';
    statusMessage: string;
    rows: M03SiteStatusRowDto[];
  };
  trends: {
    status: 'CONNECTED' | 'UNCONFIGURED' | 'ERROR';
    statusMessage: string;
    rows: M03TrendRowDto[];
    dailyRssTrends?: M03TrendRowDto[];
    industrySuggestions?: Array<{
      seedTerm: string;
      suggestions: string[];
      checkedAt: string;
    }>;
    regionRows?: Array<{ regionName: string; term: string; interestValue: number }>;
    relatedQueries?: Array<{ term: string; query: string; valueLabel: string; kind: 'rising' | 'top' }>;
    serpApiConfigured?: boolean;
    lastSyncedAt?: string | null;
  };
}

// ============================================================================
// M04 — BÁO CÁO KẾT QUẢ KINH DOANH & MARKETING
// ============================================================================

export interface M04ResultsReportDto {
  scope: DashboardScopeDto;
  freshness: DashboardFreshnessDto;
  coverage: DashboardCoverageDto;
  version: string;
  scopeRole: string;
  scopeDescription: string;
  metrics: {
    totalLeadCount: number;
    receivedLeadCount?: number;
    validLeadCount: number;
    effectiveLeadCount?: number;
    l2Count: number;
    l3Count: number;
    pendingAcceptanceCount?: number;
    draftingQuoteCount?: number;
    waitingQuoteCount: number;
    wonLeadCount: number;
    lostLeadCount?: number;
    winRatePct: number | null;
    winRateNumerator: number;
    winRateDenominator: number;
    winRateDefinition: string;
    attributedAdCost?: number | null;
    adCost?: number | null;
    validAdLeadCount?: number;
    validAttributedAdLeadCount?: number;
    adReconciliationNote?: string;
    costPerValidAdLead: number | null;
    currencyCode: string;
    overdueQuoteCount: number;
    unclassifiedProductLeadCount?: number;
    multiWebsiteExcludedAdCost?: number | null;
    multiWebsiteCampaignCount?: number;
    previousReceivedLeadCount?: number | null;
    previousValidLeadCount?: number | null;
    previousWonLeadCount?: number | null;
    previousAdCost?: number | null;
    previousCostPerValidAdLead?: number | null;
    previousWinRatePct?: number | null;
  };
  previousPeriod?: {
    startDate: string;
    endDate: string;
    adCost: number | null;
    receivedLeadCount: number | null;
    validLeadCount: number | null;
    validAttributedAdLeadCount: number | null;
    costPerValidAdLead: number | null;
    wonLeadCount: number | null;
    winRatePct: number | null;
  };
  timeSeries?: Array<{
    bucketStart: string;
    bucketEnd: string;
    label: string;
    receivedLeadCount: number | null;
    validLeadCount: number | null;
    wonLeadCount?: number | null;
    adCost?: number | null;
    isMissingDay?: boolean;
  }>;
  previousTimeSeries?: Array<{
    bucketStart: string;
    label: string;
    receivedLeadCount: number | null;
    validLeadCount: number | null;
    wonLeadCount?: number | null;
  }>;
  dataQuality?: {
    missingWebsiteCount: number;
    missingProductCount: number;
    unknownChannelCount: number;
    attributionCoveragePct: number | null;
  };
  marketingInsights?: {
    summaryFindings: Array<{
      id: string;
      severity: 'info' | 'warning' | 'action';
      title: string;
      evidenceText: string;
      actionHref?: string;
      actionLabel?: string;
    }>;
    recommendedActions: Array<{
      id: string;
      title: string;
      reason: string;
      targetType: 'seo_content' | 'design_brief' | 'leads_filter';
      href: string;
      prefillParams?: Record<string, string>;
    }>;
    latestSeoAiReport?: {
      id: string;
      website: string;
      generatedAt: string;
      generationMode: string;
      modelUsed: string | null;
      excerpt: string;
    } | null;
  };
  periodActivity?: {
    receivedInPeriodCount: number;
    quotedInPeriodCount: number;
    wonInPeriodCount: number;
    lostInPeriodCount: number;
    fromPriorCohortCount: number;
    definitionNote: string;
  };
  charts: {
    leadFunnel: Array<{ stageKey: string; label: string; distinctLeadCount: number }>;
    progressChartMode?: 'CURRENT_STATUS_DISTRIBUTION' | 'CUMULATIVE_COHORT';
    progressChartTitle?: string;
    progressChartSubtitle?: string;
    statusDistribution?: Array<{ statusKey: string; label: string; count: number; pctOfTotal: number }>;
    productLeadRows: Array<{ productId: number; productName: string; distinctLeadCount: number }>;
    multiProductNote?: string | null;
  };
  tables: {
    bySales: Array<{
      salesId: number;
      salesName: string;
      roleLabel?: string;
      isReconciliationBucket?: boolean;
      leadCount: number;
      validCount: number;
      quotedCount: number;
      waitingCount: number;
      wonCount: number;
      overdueCount: number;
    }>;
    byWebsite: Array<{
      website: string;
      isUnclassifiedWebsite?: boolean;
      leadCount: number;
      validCount: number;
      quotedCount: number;
      wonCount: number;
      adLeadCount: number;
      adCost?: number | null;
      cpl: number | null;
      winRatePct?: number | null;
    }>;
    byChannel: Array<{
      channel: string;
      leadCount: number;
      validCount: number;
      quotedCount: number;
      wonCount: number;
      winRatePct?: number | null;
      shareOfValidPct?: number | null;
    }>;
    byCampaign?: Array<{
      campaignId: string;
      campaignName: string;
      platform: string;
      websiteDomain: string | null;
      attributionStatus: 'SINGLE_WEBSITE' | 'MULTI_WEBSITE_UNSPLIT' | 'UNATTRIBUTED';
      adCost: number | null;
      clicks: number;
      impressions: number;
      platformConversions: number;
      receivedLeadCount: number;
      validLeadCount: number;
      validAttributedAdLeadCount: number;
      costPerValidAdLead: number | null;
      wonLeadCount: number;
      winRatePct: number | null;
    }>;
    byProduct: Array<{
      productId: number;
      productName: string;
      isUnclassifiedProduct?: boolean;
      leadCount: number;
      validCount: number;
      quotedCount: number;
      wonCount: number;
    }>;
    pendingActionLeads: PaginatedTableDto<{
      leadId: number;
      leadCode: string;
      customerLabel: string;
      assignedSalesName: string;
      website: string;
      quoteSentAt: string | null;
      waitingDays: number;
    }>;
    detailedLeads?: PaginatedTableDto<{
      stt: number;
      leadId: number;
      leadCode: string;
      receivedAt: string;
      assignedSalesName: string;
      companyOrCustomer: string;
      phone: string;
      sourceWebsite: string;
      contactChannel: string;
      marketingSource: string;
      productsText: string;
      pipelineStatus: string;
      pipelineStatusLabel: string;
      noteOrReason: string;
      isAnonymized: boolean;
    }>;
  };
}

