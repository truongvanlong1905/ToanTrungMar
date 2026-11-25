'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  Ban,
  Bell,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Calculator,
  Clock,
  Columns2,
  Crown,
  Download,
  FileText,
  Filter,
  FolderPlus,
  FolderUp,
  History,
  Info,
  Kanban,
  Layers,
  Mail,
  MapPin,
  MessageSquarePlus,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  Star,
  Table2,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import {
  CONTACT_CHANNEL_LABELS,
  LOST_REASONS,
  PIPELINE_STATUSES,
  PIPELINE_STATUS_LABELS,
  REASSIGN_REASONS,
  SPAM_REASONS,
  UI_VOCABULARY,
  composeLeadDistrictField,
  formatContactChannelClean,
  formatLeadLocationLabel,
  hasBaPermission,
  inferAreaTypeFromProvince,
  splitLeadDistrictField,
  type ContactChannel,
  type LeadItemDto,
  type PipelineStatus,
  type PriceCheckAlertDto,
  type ProductCatalogDto,
  type SalesAssigneeOptionDto,
} from '@toantrung/contracts';
import { apiRequest, peekApiCache, peekApiCacheEntry } from '@/core/http/client';
import { subscribeDataSync } from '@/core/http/data-sync-bus';
import { loadRouteState, saveRouteState } from '@/core/http/route-state';
import { useSession } from '@/core/session/SessionContext';
import { formatWaitingDuration } from '@/core/layout/WorkspaceShell';
import { VietnamAddressFields } from './VietnamAddressFields';
import {
  StandardDateRangeDropdown,
  resolvePresetDatesClient,
  type StandardDatePreset,
} from '@/components/common/StandardDateRangeDropdown';

const ManualLeadModal = dynamic(
  () => import('./ManualLeadModal').then((m) => m.ManualLeadModal),
  { ssr: false },
);
const GmailSyncModal = dynamic(
  () => import('./GmailSyncModal').then((m) => m.GmailSyncModal),
  { ssr: false },
);
const ProductCatalogModal = dynamic(
  () => import('./ProductCatalogModal').then((m) => m.ProductCatalogModal),
  { ssr: false },
);
const LeadExcelImportModal = dynamic(
  () => import('./LeadExcelImportModal'),
  { ssr: false },
);
const LeadRiskAndFraudModals = dynamic(
  () => import('./LeadRiskAndFraudModals'),
  { ssr: false },
);
const LeadSavedSmartViewsBar = dynamic(
  () => import('./LeadSavedSmartViewsBar'),
  { ssr: false },
);
const LedTechnicalSpecSheetModal = dynamic(
  () => import('./LedTechnicalSpecSheetModal'),
  { ssr: false },
);
const LeadSplitTriageView = dynamic(
  () => import('./LeadSplitTriageView'),
  { ssr: false },
);
const LeadActivityTimeline = dynamic(
  () => import('./LeadActivityTimeline').then((m) => m.LeadActivityTimeline),
  {
    ssr: false,
    loading: () => <div className="h-32 rounded-xl bg-slate-50 border border-slate-100 animate-pulse" />,
  },
);

import {
  B2B_HORIZON_OPTIONS,
  buildLeadsFraudIndex,
  evaluateLeadFraudCriteria,
  extractScheduledFollowUpDate,
  formatCompactLeadCode,
  getB2bFollowUpHorizon,
  KANBAN_COLUMN_THEMES,
  STATUS_BADGE_STYLES,
  STATUS_ROW_ACCENTS,
  normalizeWebsiteFilterParam,
  type B2bFollowUpHorizonKey,
  type FraudEvaluationResult,
  type LeadsFraudIndex,
} from './leads-helpers';

export { B2B_HORIZON_OPTIONS, type B2bFollowUpHorizonKey } from './leads-helpers';

export function LeadsWorkspace() {
  const { user } = useSession();
  const [leads, setLeads] = useState<LeadItemDto[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [missingProductOnly, setMissingProductOnly] = useState<boolean>(false);
  const savedScrollTopRef = useRef<number>(0);
  const [products, setProducts] = useState<ProductCatalogDto[]>([]);
  const [salesOptions, setSalesOptions] = useState<SalesAssigneeOptionDto[]>([]);
  const [openRowMenuId, setOpenRowMenuId] = useState<number | null>(null);
  const [investigativeLead, setInvestigativeLead] = useState<LeadItemDto | null>(null);
  const [priceCheckAlerts, setPriceCheckAlerts] = useState<PriceCheckAlertDto[]>([]);
  const [showPriceAlertDirectory, setShowPriceAlertDirectory] = useState(false);
  const [alertStatusFilter, setAlertStatusFilter] = useState<'ACTIVE' | 'DISMISSED' | 'ALL'>('ACTIVE');
  const [alertSearchQuery, setAlertSearchQuery] = useState('');
  const [dismissingAlert, setDismissingAlert] = useState<PriceCheckAlertDto | null>(null);
  const [dismissAlertReason, setDismissAlertReason] = useState('');
  const [competitorPromptLead, setCompetitorPromptLead] = useState<LeadItemDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<'table' | 'kanban' | 'split' | 'reminders'>('table');
  const [showLedSpecModal, setShowLedSpecModal] = useState(false);
  const [ledSpecTargetLead, setLedSpecTargetLead] = useState<LeadItemDto | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [specialAlertFilter, setSpecialAlertFilter] = useState<
    'none' | 'all_alerts' | 'active_dup' | 'won_returning' | 'lost_returning' | 'spam_probe'
  >('none');
  const [reminderFilter, setReminderFilter] = useState<
    'none' | 'all_reminders' | 'unreceived' | 'stagnant_3d' | 'quote_unresponded' | 'scheduled_due'
  >('none');
  const [highlightTableReminders, setHighlightTableReminders] = useState<boolean>(true);
  const [slaUnreceivedHours, setSlaUnreceivedHours] = useState<number>(2);
  const [slaStagnantDays, setSlaStagnantDays] = useState<number>(3);
  const [showSlaRuleSettings, setShowSlaRuleSettings] = useState<boolean>(false);
  const [reminderSalesFilterId, setReminderSalesFilterId] = useState<number | 'all'>('all');
  const [reminderQuoteCycleFilter, setReminderQuoteCycleFilter] = useState<
    'all' | '1d' | '7d' | '30d'
  >('all');
  const [quickReminderNotes, setQuickReminderNotes] = useState<Record<number, string>>({});
  const [collabNoteDraft, setCollabNoteDraft] = useState('');
  const [dateRangePreset, setDateRangePreset] = useState<StandardDatePreset>('ALL');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [showDateDropdown, setShowDateDropdown] = useState(false);
  const [editActiveProductGroup, setEditActiveProductGroup] = useState<string>('led_screen');
  const [editProductSearch, setEditProductSearch] = useState('');
  const [b2bHorizonFilter, setB2bHorizonFilter] = useState<string>('all');
  const [sourceWebsiteFilter, setSourceWebsiteFilter] = useState<string>('all');
  const [salesIdFilter, setSalesIdFilter] = useState<string>('all');
  const [productIdFilter, setProductIdFilter] = useState<string>('all');
  const [validOnly, setValidOnly] = useState<boolean>(false);
  const [urlFiltersHydrated, setUrlFiltersHydrated] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [includeSpam, setIncludeSpam] = useState(true);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [unreceivedOnly, setUnreceivedOnly] = useState(false);
  const [showOptionalColumns, setShowOptionalColumns] = useState(false);
  const [isReceivingLeads, setIsReceivingLeads] = useState(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fetchSeqRef = useRef<number>(0);
  const loadedScopeUrlRef = useRef<string>('');
  const prevSearchQueryRef = useRef<string>('');
  const consumedDeepLinkRef = useRef<string | null>(null);
  const populatedLeadIdRef = useRef<number | null>(null);
  const isDetailDirtyRef = useRef<boolean>(false);
  const scrollRestoredRef = useRef<boolean>(false);

  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [leadDetailTab, setLeadDetailTab] = useState<
    'info' | 'pipeline' | 'attachments' | 'activity'
  >('info');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showProductCatalogModal, setShowProductCatalogModal] = useState(false);
  const [showGmailSyncModal, setShowGmailSyncModal] = useState(false);
  const [lastTransferShare, setLastTransferShare] = useState<{
    leadId: number;
    leadCode: string;
    targetSalesName: string;
    reason: string;
    label: string;
    copied?: boolean;
  } | null>(null);
  const [gmailAutoSyncLive, setGmailAutoSyncLive] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importPreviewRows, setImportPreviewRows] = useState<
    Array<{
      rowNumber: number;
      phone: string;
      contactName: string;
      companyName: string;
      projectName: string;
      email: string;
      source: string;
      region: string;
      address: string;
      productsText: string;
      note: string;
    }>
  >([]);
  const [importParsing, setImportParsing] = useState(false);
  const [importCommitting, setImportCommitting] = useState(false);
  const [importSkipOpenDup, setImportSkipOpenDup] = useState(true);
  const [importPastedText, setImportPastedText] = useState('');
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  // Sync initial filters from URL query params (?status=..., ?websiteId=..., ?preset=..., ?salesId=..., ?productId=..., ?validOnly=1, ?overdueOnly=true)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const rawSt = params.get('status')?.trim().toLowerCase();
    const mappedSt = rawSt === 'new_info' ? 'new_lead' : rawSt;
    if (mappedSt && (mappedSt === 'all' || PIPELINE_STATUSES.includes(mappedSt as PipelineStatus))) {
      setStatusFilter(mappedSt);
    }
    const webParam = params.get('websiteId') || params.get('sourceWebsite');
    if (webParam && webParam.trim()) {
      setSourceWebsiteFilter(normalizeWebsiteFilterParam(webParam));
    }
    if (params.get('missingWebsite') === '1') {
      setSourceWebsiteFilter('__unresolved__');
    }
    const salesParam = params.get('salesId')?.trim();
    if (salesParam && salesParam !== 'all') {
      setSalesIdFilter(salesParam === '0' ? 'unassigned' : salesParam);
    }
    const productParam = params.get('productId')?.trim();
    if (productParam && productParam !== 'all') {
      if (productParam === 'unclassified' || productParam === '0') {
        setMissingProductOnly(true);
      } else {
        setProductIdFilter(productParam);
      }
    }
    if (params.get('missingProduct') === '1') {
      setMissingProductOnly(true);
    }
    if (params.get('needsReview') === '1') {
      setSpecialAlertFilter('all_alerts');
    }
    if (params.get('quality')?.toUpperCase() === 'L2') {
      setValidOnly(true);
      setIncludeSpam(false);
    }
    const presetParam = params.get('preset')?.toUpperCase();
    const fromParam = params.get('from');
    const toParam = params.get('to');
    if (presetParam === 'CUSTOM' && fromParam && toParam) {
      setDateRangePreset('CUSTOM');
      setCustomStartDate(fromParam);
      setCustomEndDate(toParam);
    } else if (
      presetParam &&
      ['TODAY', 'YESTERDAY', '7D', '30D', '90D', 'THIS_MONTH', 'ALL'].includes(presetParam)
    ) {
      setDateRangePreset(presetParam as StandardDatePreset);
    }
    const pageParam = Number(params.get('page'));
    if (Number.isInteger(pageParam) && pageParam > 1) {
      setCurrentPage(pageParam);
    }
    if (params.get('view') === 'split') setViewMode('split');
    if (params.get('quickFilter') === 'overdue') setOverdueOnly(true);
    if (params.get('quickAction') === 'create-lead') setShowCreateModal(true);
    if (params.get('quickAction') === 'led-spec') {
      setLedSpecTargetLead(null);
      setShowLedSpecModal(true);
    }
    const viewParam = params.get('view');
    if (viewParam === 'kanban' || viewParam === 'table') {
      setViewMode(viewParam);
    }
    const q = params.get('search');
    if (q && q.trim()) {
      const trimmed = q.trim();
      setSearchQuery(trimmed);
      setDebouncedSearchQuery(trimmed);
      prevSearchQueryRef.current = trimmed;
    }
    if (params.get('validOnly') === '1' || params.get('validOnly') === 'true') {
      setValidOnly(true);
      setIncludeSpam(false);
    }
    if (params.get('overdueOnly') === 'true' || params.get('overdue') === '1') {
      setOverdueOnly(true);
      setValidOnly(true);
      setIncludeSpam(false);
    }
    if (params.get('unreceived') === '1' || params.get('unreceivedOnly') === 'true') {
      setUnreceivedOnly(true);
      setStatusFilter('new_lead');
      setIncludeSpam(false);
    }

    // Restore persisted filters/page when navigating back without explicit query overrides
    if (!params.toString()) {
      const saved = loadRouteState<{
        statusFilter?: string;
        sourceWebsiteFilter?: string;
        dateRangePreset?: StandardDatePreset;
        customStartDate?: string;
        customEndDate?: string;
        salesIdFilter?: string;
        productIdFilter?: string;
        validOnly?: boolean;
        includeSpam?: boolean;
        viewMode?: 'table' | 'kanban' | 'reminders';
        currentPage?: number;
      }>('leads');
      if (saved) {
        if (saved.statusFilter) setStatusFilter(saved.statusFilter);
        if (saved.sourceWebsiteFilter) setSourceWebsiteFilter(saved.sourceWebsiteFilter);
        if (saved.dateRangePreset) setDateRangePreset(saved.dateRangePreset);
        if (saved.customStartDate) setCustomStartDate(saved.customStartDate);
        if (saved.customEndDate) setCustomEndDate(saved.customEndDate);
        if (saved.salesIdFilter) setSalesIdFilter(saved.salesIdFilter);
        if (saved.productIdFilter) setProductIdFilter(saved.productIdFilter);
        if (typeof saved.validOnly === 'boolean') setValidOnly(saved.validOnly);
        if (typeof saved.includeSpam === 'boolean') setIncludeSpam(saved.includeSpam);
        if (saved.viewMode) setViewMode(saved.viewMode);
        if (saved.currentPage && saved.currentPage > 1) setCurrentPage(saved.currentPage);
      }
    }
    setUrlFiltersHydrated(true);
  }, []);

  // Listen to canonical global search bar from WorkspaceShell topbar
  useEffect(() => {
    const handleGlobalSearch = (e: Event) => {
      const custom = e as CustomEvent<string>;
      const val = typeof custom.detail === 'string' ? custom.detail : '';
      if (
        user?.email &&
        val.trim().toLowerCase() === user.email.trim().toLowerCase()
      ) {
        return;
      }
      setSearchQuery(val);
    };
    window.addEventListener('tt-global-search', handleGlobalSearch as EventListener);
    return () => {
      window.removeEventListener('tt-global-search', handleGlobalSearch as EventListener);
    };
  }, [user?.email]);

  // Broadcast active sub-section scope to WorkspaceShell top search bar
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let scopeLabel = 'Leads › Tổng Lead hợp lệ';
    if (reminderFilter !== 'none') {
      scopeLabel = 'Leads › Nhắc việc tự động';
    } else if (specialAlertFilter !== 'none') {
      scopeLabel = 'Leads › 6. Lưu ý (Trùng / Spam)';
    } else if (statusFilter === 'new_lead') {
      scopeLabel = 'Leads › 1. Vừa nhận thông tin';
    } else if (statusFilter === 'quoting') {
      scopeLabel = 'Leads › 2. Đang soạn báo giá';
    } else if (statusFilter === 'quote_sent') {
      scopeLabel = 'Leads › 3. Đã gửi báo giá';
    } else if (statusFilter === 'won') {
      scopeLabel = 'Leads › 4. Chốt thành công';
    } else if (statusFilter === 'lost') {
      scopeLabel = 'Leads › 5. Thất bại';
    }
    window.dispatchEvent(
      new CustomEvent('tt-search-scope-change', { detail: { label: scopeLabel } }),
    );
  }, [statusFilter, specialAlertFilter, reminderFilter]);

  // Debounce search query by 200ms without resetting restored URL page on initial mount
  useEffect(() => {
    if (searchQuery === prevSearchQueryRef.current) return;
    const timer = setTimeout(() => {
      prevSearchQueryRef.current = searchQuery;
      setDebouncedSearchQuery(searchQuery);
      setCurrentPage(1);
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Keyboard shortcuts: '/' search, 'N' create lead, 'Esc' close popup (Mục 2.6)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInputFocused =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (e.key === 'Escape') {
        if (showCreateModal) setShowCreateModal(false);
        else if (selectedLeadId !== null) closeLeadDetail();
        return;
      }

      if (isInputFocused) return;

      if (e.key === '/') {
        e.preventDefault();
        (document.getElementById('tt-global-search-input') as HTMLInputElement | null)?.focus();
      } else if (e.key === 'n' || e.key === 'N') {
        if (user && hasBaPermission(user.roleCode, 'LEAD_CREATE')) {
          e.preventDefault();
          setShowCreateModal(true);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showCreateModal, selectedLeadId, user]);

  // Create Lead form state
  const [createChannel, setCreateChannel] = useState<'hotline' | 'zalo' | 'email' | 'form_web'>('hotline');
  const [createPhone, setCreatePhone] = useState('');
  const [createContactName, setCreateContactName] = useState('');
  const [createCompanyName, setCreateCompanyName] = useState('');
  const [createProjectName, setCreateProjectName] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createSelfSource, setCreateSelfSource] = useState('');
  const [createDistrict, setCreateDistrict] = useState<string>('');
  const [createProvince, setCreateProvince] = useState<string>('TP. Hồ Chí Minh');
  const [createAddress, setCreateAddress] = useState('');
  const [createProductIds, setCreateProductIds] = useState<number[]>([1]);
  const [createCustomProductNote, setCreateCustomProductNote] = useState('');
  const [createInitialNote, setCreateInitialNote] = useState('');
  const [tickReassignOnCreate, setTickReassignOnCreate] = useState(false);
  const [createReassignSalesId, setCreateReassignSalesId] = useState<number | ''>('');
  const [createReassignReason, setCreateReassignReason] = useState<string>(REASSIGN_REASONS[0]);
  const [submitting, setSubmitting] = useState(false);

  // Direct Inline Edit Lead form state (Tab 1: Mở chi tiết sửa trực tiếp theo phân quyền)
  const [editPhone, setEditPhone] = useState('');
  const [editContactName, setEditContactName] = useState('');
  const [editCompanyName, setEditCompanyName] = useState('');
  const [editProjectName, setEditProjectName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editSelfSource, setEditSelfSource] = useState('');
  const [editDistrict, setEditDistrict] = useState<string>('');
  const [editWard, setEditWard] = useState<string>('');
  const [editProvince, setEditProvince] = useState<string>('TP. Hồ Chí Minh');
  const [editAddress, setEditAddress] = useState('');
  const [editProductIds, setEditProductIds] = useState<number[]>([]);
  const [editCustomServiceItems, setEditCustomServiceItems] = useState<string[]>([]);
  const [editCustomServiceDraft, setEditCustomServiceDraft] = useState('');
  const [editTickReassign, setEditTickReassign] = useState(false);
  const [editTickSuspect, setEditTickSuspect] = useState(false);
  const [editCustomProductNote, setEditCustomProductNote] = useState('');
  const [editB2bHorizon, setEditB2bHorizon] = useState<B2bFollowUpHorizonKey>('none');
  const [editFollowUpDate, setEditFollowUpDate] = useState('');
  const [editUpdateNote, setEditUpdateNote] = useState('');

  // Detail modal action states
  const [targetStatus, setTargetStatus] = useState<PipelineStatus>('quoting');
  const [statusReason, setStatusReason] = useState<string>('');
  const [statusNote, setStatusNote] = useState<string>('');
  const [markQuoteResponded, setMarkQuoteResponded] = useState(false);

  const [reassignTargetId, setReassignTargetId] = useState<number | ''>('');
  const [reassignCategory, setReassignCategory] = useState<(typeof REASSIGN_REASONS)[number]>('Bận');
  const [reassignDetail, setReassignDetail] = useState('');

  const [spamReason, setSpamReason] = useState<(typeof SPAM_REASONS)[number]>(SPAM_REASONS[0]);
  const [priceCheckReason, setPriceCheckReason] = useState('');
  const [priceCheckFile, setPriceCheckFile] = useState<File | null>(null);
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [attachmentType, setAttachmentType] = useState<'site_photo' | 'customer_drawing_doc' | 'other'>(
    'site_photo',
  );
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const [editingAttachmentId, setEditingAttachmentId] = useState<number | null>(null);
  const [editingAttachmentName, setEditingAttachmentName] = useState<string>('');
  const [editingAttachmentType, setEditingAttachmentType] = useState<
    'site_photo' | 'customer_drawing_doc' | 'other'
  >('site_photo');
  const [editingAttachmentReplaceFile, setEditingAttachmentReplaceFile] = useState<File | null>(null);
  const [bypassPriceCheckConfirmed, setBypassPriceCheckConfirmed] = useState<boolean>(false);
  const [isLeadsPolling, setIsLeadsPolling] = useState<boolean>(false);
  const [lastLeadsPolledAt, setLastLeadsPolledAt] = useState<Date>(new Date());

  const fetchLeads = useCallback(async (forceFresh = false) => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const seq = ++fetchSeqRef.current;

    const qs = new URLSearchParams();
    if (includeSpam && !validOnly) qs.set('includeSpam', 'true');
    const url = `/api/v1/leads?${qs.toString()}`;

    type LeadsListPayload = {
      leads: LeadItemDto[];
      totalCount?: number;
      products: ProductCatalogDto[];
      salesOptions: SalesAssigneeOptionDto[];
      priceCheckAlerts: PriceCheckAlertDto[];
      isReceivingLeads?: boolean;
    };

    const cachedEntry = !forceFresh ? peekApiCacheEntry<LeadsListPayload>(url) : null;
    if (cachedEntry) {
      loadedScopeUrlRef.current = url;
      setLeads(cachedEntry.data.leads);
      setTotalCount(cachedEntry.data.totalCount ?? cachedEntry.data.leads.length);
      setProducts(cachedEntry.data.products);
      setSalesOptions(cachedEntry.data.salesOptions);
      setPriceCheckAlerts(cachedEntry.data.priceCheckAlerts);
      if (typeof cachedEntry.data.isReceivingLeads === 'boolean') {
        setIsReceivingLeads(cachedEntry.data.isReceivingLeads);
      }
      setLoading(false);
      if (cachedEntry.isFresh) {
        return;
      }
    } else if (!forceFresh && loadedScopeUrlRef.current !== url) {
      setLeads([]);
      setLoading(true);
    }

    if (forceFresh || cachedEntry) {
      setIsLeadsPolling(true);
    }

    setErrorMsg(null);
    try {
      const data = await apiRequest<LeadsListPayload>(url, {
        signal: controller.signal,
        skipCache: forceFresh,
        onRevalidated: (fresh) => {
          if (controller.signal.aborted) return;
          loadedScopeUrlRef.current = url;
          setLeads(fresh.leads);
          setTotalCount(fresh.totalCount ?? fresh.leads.length);
          setProducts(fresh.products);
          setSalesOptions(fresh.salesOptions);
          setPriceCheckAlerts(fresh.priceCheckAlerts);
          if (typeof fresh.isReceivingLeads === 'boolean') {
            setIsReceivingLeads(fresh.isReceivingLeads);
          }
          setLastLeadsPolledAt(new Date());
        },
      });

      if (seq !== fetchSeqRef.current || controller.signal.aborted) return;

      loadedScopeUrlRef.current = url;
      setLeads(data.leads);
      setTotalCount(data.totalCount ?? data.leads.length);
      setProducts(data.products);
      setSalesOptions(data.salesOptions);
      setPriceCheckAlerts(data.priceCheckAlerts);
      if (typeof data.isReceivingLeads === 'boolean') {
        setIsReceivingLeads(data.isReceivingLeads);
      }
      setLastLeadsPolledAt(new Date());
    } catch (err) {
      if (seq !== fetchSeqRef.current || controller.signal.aborted) return;
      if (err instanceof Error && err.name === 'AbortError') return;
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi tải danh sách Lead.');
    } finally {
      if (seq === fetchSeqRef.current && !controller.signal.aborted) {
        setIsLeadsPolling(false);
        setLoading(false);
      }
    }
  }, [includeSpam, validOnly]);

  const gmailSyncProbeRequestedRef = useRef(false);
  useEffect(() => {
    if (!urlFiltersHydrated) return;
    // Fetch Gmail sync status lazily once after mount (cached 20s) or when modal closes
    if (gmailSyncProbeRequestedRef.current && showGmailSyncModal) return;
    gmailSyncProbeRequestedRef.current = true;
    let active = true;
    apiRequest<{
      connected: boolean;
      hasGmailScope: boolean;
      isSandboxDemo: boolean;
      serverStatus?: 'RUNNING' | 'PAUSED' | 'ERROR';
      config?: { enabled?: boolean };
    }>('/api/v1/leads/gmail-sync', { skipCache: !showGmailSyncModal && gmailAutoSyncLive })
      .then((res) => {
        if (!active) return;
        setGmailAutoSyncLive(
          Boolean(
            res.connected &&
              res.hasGmailScope &&
              !res.isSandboxDemo &&
              res.config?.enabled &&
              res.serverStatus === 'RUNNING',
          ),
        );
      })
      .catch(() => {
        // ignore status probe errors
      });
    return () => {
      active = false;
    };
  }, [urlFiltersHydrated, showGmailSyncModal, gmailAutoSyncLive]);

  useEffect(() => {
    if (!urlFiltersHydrated) return;
    let lastFetchMs = Date.now();
    void fetchLeads(false);

    const unsubscribe = subscribeDataSync(['leads', 'design', 'tracking'], () => {
      lastFetchMs = Date.now();
      void fetchLeads(true);
    });

    const handleVisibleRefresh = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        const now = Date.now();
        if (now - lastFetchMs >= 15_000) {
          lastFetchMs = now;
          void fetchLeads(true);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibleRefresh);

    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibleRefresh);
      abortControllerRef.current?.abort();
    };
  }, [urlFiltersHydrated, fetchLeads]);

  const openLeadDetail = useCallback(
    (leadId: number, tab: 'info' | 'pipeline' | 'attachments' | 'activity' = 'info') => {
      if (typeof document !== 'undefined') {
        const scroller = document.getElementById('main-workspace-content');
        if (scroller) savedScrollTopRef.current = scroller.scrollTop;
      }
      setSelectedLeadId(leadId);
      setLeadDetailTab(tab);
    },
    [],
  );

  const closeLeadDetail = useCallback(() => {
    isDetailDirtyRef.current = false;
    populatedLeadIdRef.current = null;
    setSelectedLeadId(null);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (
        url.searchParams.has('leadId') ||
        url.searchParams.has('highlight') ||
        url.searchParams.has('highlightLeadId')
      ) {
        url.searchParams.delete('leadId');
        url.searchParams.delete('highlight');
        url.searchParams.delete('highlightLeadId');
        window.history.replaceState({}, '', url.toString());
      }
      requestAnimationFrame(() => {
        const scroller = document.getElementById('main-workspace-content');
        if (scroller) scroller.scrollTop = savedScrollTopRef.current;
      });
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('create') === '1' && user && hasBaPermission(user.roleCode, 'LEAD_CREATE')) {
      setShowCreateModal(true);
      params.delete('create');
      const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
      window.history.replaceState({}, '', nextUrl);
    }
  }, [user]);

  useEffect(() => {
    if (typeof window === 'undefined' || leads.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const highlightRaw =
      params.get('leadId') || params.get('highlightLeadId') || params.get('highlight');
    const highlightId = Number(highlightRaw);
    if (Number.isInteger(highlightId) && highlightId > 0) {
      const deepKey = `id:${highlightId}`;
      if (consumedDeepLinkRef.current === deepKey) return;
      const target = leads.find((l) => l.id === highlightId);
      if (target && selectedLeadId === null) {
        consumedDeepLinkRef.current = deepKey;
        openLeadDetail(target.id, 'info');
        return;
      }
    }
    const q = params.get('search');
    if (q && q.trim()) {
      const deepKey = `search:${q.trim().toLowerCase()}`;
      if (consumedDeepLinkRef.current === deepKey) return;
      const matched = leads.find(
        (l) => l.leadCode.toLowerCase() === q.trim().toLowerCase(),
      );
      if (matched && selectedLeadId === null) {
        consumedDeepLinkRef.current = deepKey;
        openLeadDetail(matched.id, 'info');
      }
    }
  }, [leads, selectedLeadId, openLeadDetail]);

  const fraudByLeadId = useMemo(() => {
    const index = buildLeadsFraudIndex(leads, priceCheckAlerts);
    const map = new Map<number, FraudEvaluationResult>();
    for (const l of leads) {
      map.set(l.id, evaluateLeadFraudCriteria(l, leads, priceCheckAlerts, index));
    }
    return map;
  }, [leads, priceCheckAlerts]);

  const classifyLeadAlertBucket = useCallback(
    (
      l: LeadItemDto,
    ): 'none' | 'active_dup' | 'won_returning' | 'lost_returning' | 'spam_probe' => {
      const fraud = fraudByLeadId.get(l.id);
      if (!fraud) return 'none';
      if (
        l.spamStatus !== 'NONE' ||
        fraud.hasBlacklistedOrSpam ||
        fraud.hasPriceProbeBehavior ||
        l.hasMissingSubjectContent ||
        l.needsManagerAttention
      ) {
        return 'spam_probe';
      }
      if (
        fraud.duplicateScenario === 'SCENARIO_1_ACTIVE_DUP' ||
        fraud.duplicateScenario === 'SCENARIO_3_MULTI_CONTRACTOR'
      ) {
        return 'active_dup';
      }
      if (fraud.duplicateScenario === 'SCENARIO_2_WON_RETURNING') {
        return 'won_returning';
      }
      if (fraud.duplicateScenario === 'SCENARIO_2_LOST_RETURNING') {
        return 'lost_returning';
      }
      return 'none';
    },
    [fraudByLeadId],
  );

  const classifyReminderCategories = useCallback(
    (l: LeadItemDto) => {
      if (l.spamStatus !== 'NONE' || l.pipelineStatus === 'won' || l.pipelineStatus === 'lost') {
        return {
          isUnreceived: false,
          unreceivedHours: 0,
          isStagnant3d: false,
          daysSinceLastActivity: 0,
          isQuoteUnresponded: false,
          quoteDays: 0,
          quoteAgeBucket: 'none' as 'none' | '1d' | '7d' | '30d',
          isScheduledDue: false,
          hasAnyReminder: false,
          urgencyLevel: 'none' as 'critical' | 'high' | 'medium' | 'none',
          primaryBadgeText: '',
          primaryActionHint: '',
          suggestedZaloScript: '',
        };
      }

      const now = Date.now();
      const contactedMs = new Date(l.contactedAt).getTime();
      const unreceivedHours = Math.max(0, (now - contactedMs) / (1000 * 60 * 60));

      // 1. Chưa tiếp nhận: Lead mới quá hạn / chưa xác nhận tiếp nhận
      const isUnreceived =
        l.pipelineStatus === 'new_lead' &&
        !l.receivedConfirmedAt &&
        unreceivedHours >= Math.max(0, slaUnreceivedHours - 1.9);

      // 2. Lead đứng yên: Đang mở (new_lead / quoting) và > slaStagnantDays ngày không có hoạt động mới
      const latestActivityMs =
        l.activities && l.activities.length > 0
          ? Math.max(...l.activities.map((a) => new Date(a.createdAt).getTime()))
          : contactedMs;
      const daysSinceLastActivity = Math.max(0, (now - latestActivityMs) / (1000 * 60 * 60 * 24));
      const isStagnant3d =
        (l.pipelineStatus === 'new_lead' || l.pipelineStatus === 'quoting') &&
        daysSinceLastActivity >= slaStagnantDays;

      // 3. Báo giá chưa phản hồi: Đã gửi báo giá nhưng chưa phản hồi (1 ngày, 1 tuần, > 1 tháng)
      const isQuoteUnresponded = l.pipelineStatus === 'quote_sent' && !l.quoteRespondedAt;
      let quoteAgeBucket: 'none' | '1d' | '7d' | '30d' = 'none';
      let quoteDays = 0;
      if (isQuoteUnresponded) {
        const sentMs = l.quoteSentAt ? new Date(l.quoteSentAt).getTime() : contactedMs;
        quoteDays = Math.max(1, (now - sentMs) / (1000 * 60 * 60 * 24));
        if (quoteDays >= 30) quoteAgeBucket = '30d';
        else if (quoteDays >= 7 || l.isQuoteOverdue7Days) quoteAgeBucket = '7d';
        else quoteAgeBucket = '1d';
      }

      // 4. Đến lịch hẹn: Có lịch chăm sóc B2B / ngày hẹn nhắc lại
      const schedDate = extractScheduledFollowUpDate(l.customProductNote || '');
      const horizon = getB2bFollowUpHorizon(l);
      const isScheduledDue = Boolean(schedDate) || horizon.key !== 'none';

      const hasAnyReminder = isUnreceived || isStagnant3d || isQuoteUnresponded || isScheduledDue;

      let urgencyLevel: 'critical' | 'high' | 'medium' | 'none' = 'none';
      if (isUnreceived || quoteAgeBucket === '30d' || daysSinceLastActivity >= 7) {
        urgencyLevel = 'critical';
      } else if (quoteAgeBucket === '7d' || isStagnant3d) {
        urgencyLevel = 'high';
      } else if (quoteAgeBucket === '1d' || isScheduledDue) {
        urgencyLevel = 'medium';
      }

      const custName = l.contactName || l.companyName || 'Anh/Chị';
      const prodName = l.products[0]?.productName || 'hệ thống màn hình LED';
      const projName = l.projectName ? `dự án "${l.projectName}"` : `hạng mục ${prodName}`;

      let primaryBadgeText = '';
      let primaryActionHint = '';
      let suggestedZaloScript = '';

      if (isUnreceived) {
        const hrsText =
          unreceivedHours >= 24
            ? `${Math.floor(unreceivedHours / 24)} ngày`
            : `${Math.max(1, Math.round(unreceivedHours))} giờ`;
        primaryBadgeText = `🔔 Chưa tiếp nhận (${hrsText})`;
        primaryActionHint = 'Xác nhận tiếp nhận & gọi tư vấn khách ngay';
        suggestedZaloScript = `Dạ chào ${custName}, em bên Toàn Trung LED đã nhận được thông tin cần tư vấn ${projName}. Em xin phép kết nối hỗ trợ báo giá & phương án kỹ thuật cho mình ngay ạ!`;
      } else if (isQuoteUnresponded) {
        const dInt = Math.max(1, Math.floor(quoteDays));
        if (quoteAgeBucket === '30d') {
          primaryBadgeText = `📨 Báo giá > 30 ngày (${dInt} ngày)`;
          primaryActionHint = 'Đánh thức dự án dài hạn · Hỏi lịch triển khai mới';
          suggestedZaloScript = `Chào ${custName}, bên Toàn Trung LED xin phép hỏi thăm tiến độ ${projName} bên mình đã có kế hoạch khởi công trong giai đoạn tới chưa ạ? Nếu cần cập nhật lại cấu hình hoặc ưu đãi giá mới nhất em gửi lại mình nhé!`;
        } else if (quoteAgeBucket === '7d') {
          primaryBadgeText = `📨 Báo giá 7 ngày chưa PH (${dInt} ngày)`;
          primaryActionHint = 'Hỏi kết quả duyệt ngân sách & phương án kỹ thuật';
          suggestedZaloScript = `Dạ chào ${custName}, tuần trước em có gửi bảng báo giá ${projName}. Không biết bên mình đã xem qua phương án kỹ thuật và trình duyệt ngân sách thuận lợi chưa, có cần em điều chỉnh cấu hình nào không ạ?`;
        } else {
          primaryBadgeText = `📨 Báo giá 24h chưa PH`;
          primaryActionHint = 'Xác nhận khách đã mở được file báo giá & CAD';
          suggestedZaloScript = `Dạ chào ${custName}, em đã gửi bảng báo giá chi tiết cho ${projName}. Anh/Chị kiểm tra giúp em xem đã mở được file chưa và có điểm nào cần em giải thích thêm về thông số kỹ thuật không ạ?`;
        }
      } else if (isStagnant3d) {
        const dInt = Math.max(slaStagnantDays, Math.floor(daysSinceLastActivity));
        primaryBadgeText = `⏳ Đứng yên ${dInt} ngày`;
        primaryActionHint =
          l.pipelineStatus === 'quoting'
            ? 'Hoàn tất khảo sát / gửi báo giá ngay'
            : 'Cập nhật kết quả liên hệ & đẩy sang soạn báo giá';
        suggestedZaloScript = `Dạ chào ${custName}, em bên Toàn Trung LED xin phép cập nhật thêm thông tin kích thước mặt bằng cho ${projName} để bộ phận kỹ thuật lên phương án và báo giá chuẩn nhất gửi mình hôm nay ạ!`;
      } else if (isScheduledDue) {
        primaryBadgeText = `📅 Hẹn chăm sóc: ${horizon.shortLabel}`;
        primaryActionHint = 'Theo dõi đúng lịch hẹn dự án B2B';
        suggestedZaloScript = `Dạ chào ${custName}, theo lịch hẹn trao đổi về ${projName}, em xin phép nhắn hỏi thăm tiến độ hiện tại của bên mình để Toàn Trung chuẩn bị phương án hỗ trợ kịp thời ạ!`;
      }

      return {
        isUnreceived,
        unreceivedHours,
        isStagnant3d,
        daysSinceLastActivity,
        isQuoteUnresponded,
        quoteDays,
        quoteAgeBucket,
        isScheduledDue,
        hasAnyReminder,
        urgencyLevel,
        primaryBadgeText,
        primaryActionHint,
        suggestedZaloScript,
      };
    },
    [slaUnreceivedHours, slaStagnantDays],
  );

  // C04: Đồng bộ múi giờ Asia/Ho_Chi_Minh và mốc thời gian leads.createdAt để khớp 100% số liệu với Tổng quan và Báo cáo
  const timeFilteredLeads = useMemo(() => {
    if (dateRangePreset === 'ALL' && !customStartDate && !customEndDate) {
      return leads;
    }
    const fmtVn = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const todayStr = fmtVn.format(new Date());
    const todayNoon = new Date(`${todayStr}T12:00:00+07:00`);
    const shiftStr = (daysBack: number) =>
      fmtVn.format(new Date(todayNoon.getTime() - daysBack * 24 * 60 * 60 * 1000));

    return leads.filter((l) => {
      const leadDateStr = fmtVn.format(new Date(l.createdAt || l.contactedAt));
      if (dateRangePreset === 'TODAY') {
        return leadDateStr === todayStr;
      }
      if (dateRangePreset === 'YESTERDAY') {
        return leadDateStr === shiftStr(1);
      }
      if (dateRangePreset === '7D') {
        return leadDateStr >= shiftStr(6) && leadDateStr <= todayStr;
      }
      if (dateRangePreset === '30D') {
        return leadDateStr >= shiftStr(29) && leadDateStr <= todayStr;
      }
      if (dateRangePreset === '90D') {
        return leadDateStr >= shiftStr(89) && leadDateStr <= todayStr;
      }
      if (dateRangePreset === 'THIS_MONTH') {
        return leadDateStr.slice(0, 7) === todayStr.slice(0, 7);
      }
      if (customStartDate && leadDateStr < customStartDate) return false;
      if (customEndDate && leadDateStr > customEndDate) return false;
      return true;
    });
  }, [leads, dateRangePreset, customStartDate, customEndDate]);

  const reminderStats = useMemo(() => {
    let unreceived = 0;
    let stagnant3d = 0;
    let quoteUnresponded = 0;
    let quote1d = 0;
    let quote7d = 0;
    let quote30d = 0;
    let scheduledDue = 0;
    let totalLeadsWithReminder = 0;

    for (const l of timeFilteredLeads) {
      const r = classifyReminderCategories(l);
      if (r.isUnreceived) unreceived += 1;
      if (r.isStagnant3d) stagnant3d += 1;
      if (r.isQuoteUnresponded) {
        quoteUnresponded += 1;
        if (r.quoteAgeBucket === '1d') quote1d += 1;
        else if (r.quoteAgeBucket === '7d') quote7d += 1;
        else if (r.quoteAgeBucket === '30d') quote30d += 1;
      }
      if (r.isScheduledDue) scheduledDue += 1;
      if (r.hasAnyReminder) totalLeadsWithReminder += 1;
    }

    return {
      unreceived,
      stagnant3d,
      quoteUnresponded,
      quote1d,
      quote7d,
      quote30d,
      scheduledDue,
      totalLeadsWithReminder,
    };
  }, [timeFilteredLeads, classifyReminderCategories]);

  const salesSlaStats = useMemo(() => {
    const map = new Map<
      number,
      {
        salesId: number;
        salesName: string;
        totalActive: number;
        unreceivedCount: number;
        stagnantCount: number;
        quotePendingCount: number;
        reminderTotal: number;
        slaCompliancePct: number;
      }
    >();

    for (const l of timeFilteredLeads) {
      if (l.spamStatus !== 'NONE' || l.pipelineStatus === 'won' || l.pipelineStatus === 'lost') {
        continue;
      }
      const sid = l.assignedSalesId || 0;
      const sname = l.assignedSalesName || 'Chưa giao Sales';
      const entry = map.get(sid) || {
        salesId: sid,
        salesName: sname,
        totalActive: 0,
        unreceivedCount: 0,
        stagnantCount: 0,
        quotePendingCount: 0,
        reminderTotal: 0,
        slaCompliancePct: 100,
      };
      entry.totalActive += 1;
      const r = classifyReminderCategories(l);
      if (r.isUnreceived) entry.unreceivedCount += 1;
      if (r.isStagnant3d) entry.stagnantCount += 1;
      if (r.isQuoteUnresponded) entry.quotePendingCount += 1;
      if (r.hasAnyReminder) entry.reminderTotal += 1;
      entry.slaCompliancePct =
        entry.totalActive > 0
          ? Math.max(
              0,
              Math.round(((entry.totalActive - entry.reminderTotal) / entry.totalActive) * 100),
            )
          : 100;
      map.set(sid, entry);
    }

    return Array.from(map.values()).sort((a, b) => b.reminderTotal - a.reminderTotal);
  }, [timeFilteredLeads, classifyReminderCategories]);

  const displayedLeads = useMemo(() => {
    let list = timeFilteredLeads;
    if (reminderFilter !== 'none') {
      list = list.filter((l) => {
        const r = classifyReminderCategories(l);
        if (reminderFilter === 'all_reminders') return r.hasAnyReminder;
        if (reminderFilter === 'unreceived') return r.isUnreceived;
        if (reminderFilter === 'stagnant_3d') return r.isStagnant3d;
        if (reminderFilter === 'quote_unresponded') return r.isQuoteUnresponded;
        if (reminderFilter === 'scheduled_due') return r.isScheduledDue;
        return r.hasAnyReminder;
      });
    } else if (specialAlertFilter !== 'none') {
      list = list.filter((l) => {
        const bucket = classifyLeadAlertBucket(l);
        if (bucket === 'none') return false;
        if (specialAlertFilter === 'all_alerts') return true;
        return bucket === specialAlertFilter;
      });
    } else {
      // Ở chế độ Tổng Lead Hợp Lệ và các cột 1..5: Chỉ hiển thị Lead hợp lệ (loại trừ Spam để khớp 100% với số trên thẻ KPI)
      list = list.filter((l) => l.spamStatus === 'NONE');
      if (statusFilter !== 'all') {
        list = list.filter((l) => l.pipelineStatus === statusFilter);
      }
    }
    if (validOnly) {
      list = list.filter((l) => l.spamStatus === 'NONE');
    }
    if (salesIdFilter !== 'all') {
      if (salesIdFilter === 'unassigned') {
        list = list.filter((l) => !l.assignedSalesId);
      } else {
        list = list.filter((l) => String(l.assignedSalesId ?? '') === salesIdFilter);
      }
    }
    if (productIdFilter !== 'all') {
      list = list.filter((l) => l.products.some((p) => String(p.id) === productIdFilter));
    }
    if (overdueOnly) {
      list = list.filter((l) => l.isQuoteOverdue7Days && l.spamStatus === 'NONE');
    }
    if (unreceivedOnly) {
      list = list.filter(
        (l) => l.pipelineStatus === 'new_lead' && !l.receivedConfirmedAt && l.spamStatus === 'NONE',
      );
    }
    if (missingProductOnly) {
      list = list.filter((l) => l.products.length === 0);
    }
    if (sourceWebsiteFilter !== 'all') {
      if (sourceWebsiteFilter === '__unresolved__') {
        list = list.filter((l) => !l.sourceWebsite || !l.sourceWebsite.trim());
      } else {
        list = list.filter(
          (l) => (l.sourceWebsite || '').trim().toLowerCase() === sourceWebsiteFilter.toLowerCase(),
        );
      }
    }
    if (b2bHorizonFilter !== 'all') {
      list = list.filter((l) => {
        if (l.spamStatus !== 'NONE') return false;
        const horizon = getB2bFollowUpHorizon(l);
        if (b2bHorizonFilter === 'any_long_cycle') {
          return (
            horizon.key === 'remind_7_14d' ||
            horizon.key === 'monthly_15_45d' ||
            horizon.key === 'longterm_next_year'
          );
        }
        return horizon.key === b2bHorizonFilter;
      });
    }
    // Scoped search strictly inside the currently selected Lead sub-section / tab
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      const qDigits = q.replace(/\D/g, '');
      list = list.filter((l) => {
        const haystack = [
          l.leadCode,
          l.phone,
          l.contactName,
          l.companyName,
          l.projectName,
          l.email,
          l.hcmDistrict,
          l.province,
          l.installationAddress,
          l.assignedSalesName,
          l.selfReportedSource,
          l.tracking?.marketingSource,
          l.customProductNote,
          l.initialNote,
          l.lostReason,
          l.reopenReason,
          ...l.products.map((p) => p.productName),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (haystack.includes(q)) return true;
        if (qDigits.length >= 3 && l.phone.replace(/\D/g, '').includes(qDigits)) return true;
        return false;
      });
    }
    return list;
  }, [
    timeFilteredLeads,
    classifyReminderCategories,
    reminderFilter,
    classifyLeadAlertBucket,
    specialAlertFilter,
    statusFilter,
    overdueOnly,
    unreceivedOnly,
    validOnly,
    salesIdFilter,
    productIdFilter,
    sourceWebsiteFilter,
    missingProductOnly,
    b2bHorizonFilter,
    searchQuery,
  ]);

  const totalFilteredCount = displayedLeads.length;
  const totalPages = Math.max(1, Math.ceil(displayedLeads.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);

  // C06: Khi dữ liệu hoặc bộ lọc thay đổi làm trang hiện tại không còn hợp lệ -> chuyển rõ ràng về trang hợp lệ gần nhất
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const hasAnyActiveFilter = useMemo(
    () =>
      statusFilter !== 'all' ||
      sourceWebsiteFilter !== 'all' ||
      dateRangePreset !== 'ALL' ||
      specialAlertFilter !== 'none' ||
      reminderFilter !== 'none' ||
      missingProductOnly ||
      overdueOnly ||
      unreceivedOnly ||
      validOnly ||
      salesIdFilter !== 'all' ||
      productIdFilter !== 'all' ||
      b2bHorizonFilter !== 'all' ||
      Boolean(searchQuery.trim()),
    [
      statusFilter,
      sourceWebsiteFilter,
      dateRangePreset,
      specialAlertFilter,
      reminderFilter,
      missingProductOnly,
      overdueOnly,
      unreceivedOnly,
      validOnly,
      salesIdFilter,
      productIdFilter,
      b2bHorizonFilter,
      searchQuery,
    ],
  );

  const handleResetAllFilters = useCallback(() => {
    setStatusFilter('all');
    setSourceWebsiteFilter('all');
    setDateRangePreset('ALL');
    setCustomStartDate('');
    setCustomEndDate('');
    setSpecialAlertFilter('none');
    setReminderFilter('none');
    setMissingProductOnly(false);
    setOverdueOnly(false);
    setUnreceivedOnly(false);
    setValidOnly(false);
    setIncludeSpam(true);
    setSalesIdFilter('all');
    setProductIdFilter('all');
    setB2bHorizonFilter('all');
    setSearchQuery('');
    setCurrentPage(1);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('tt-global-search', { detail: '' }));
    }
  }, []);

  // C06: Đồng bộ trạng thái bộ lọc, chế độ xem và trang hiện tại lên URL để giữ nguyên ngữ cảnh khi quay lại
  useEffect(() => {
    if (typeof window === 'undefined' || !urlFiltersHydrated) return;
    const url = new URL(window.location.href);
    if (statusFilter !== 'all') url.searchParams.set('status', statusFilter);
    else url.searchParams.delete('status');

    if (sourceWebsiteFilter !== 'all' && sourceWebsiteFilter !== '__unresolved__') {
      url.searchParams.set('websiteId', sourceWebsiteFilter);
      url.searchParams.delete('missingWebsite');
    } else if (sourceWebsiteFilter === '__unresolved__') {
      url.searchParams.delete('websiteId');
      url.searchParams.set('missingWebsite', '1');
    } else {
      url.searchParams.delete('websiteId');
      url.searchParams.delete('missingWebsite');
    }

    if (dateRangePreset !== 'ALL') {
      url.searchParams.set('preset', dateRangePreset);
      if (dateRangePreset === 'CUSTOM' && customStartDate && customEndDate) {
        url.searchParams.set('from', customStartDate);
        url.searchParams.set('to', customEndDate);
      } else {
        url.searchParams.delete('from');
        url.searchParams.delete('to');
      }
    } else {
      url.searchParams.delete('preset');
      url.searchParams.delete('from');
      url.searchParams.delete('to');
    }

    if (salesIdFilter !== 'all') url.searchParams.set('salesId', salesIdFilter);
    else url.searchParams.delete('salesId');

    if (productIdFilter !== 'all') url.searchParams.set('productId', productIdFilter);
    else url.searchParams.delete('productId');

    if (validOnly) url.searchParams.set('validOnly', '1');
    else url.searchParams.delete('validOnly');

    if (overdueOnly) url.searchParams.set('overdueOnly', 'true');
    else {
      url.searchParams.delete('overdueOnly');
      url.searchParams.delete('overdue');
    }

    if (unreceivedOnly) url.searchParams.set('unreceived', '1');
    else url.searchParams.delete('unreceived');

    if (specialAlertFilter !== 'none') url.searchParams.set('needsReview', '1');
    else url.searchParams.delete('needsReview');

    if (missingProductOnly) url.searchParams.set('missingProduct', '1');
    else url.searchParams.delete('missingProduct');

    if (viewMode === 'kanban') url.searchParams.set('view', 'kanban');
    else url.searchParams.delete('view');

    if (safePage > 1) url.searchParams.set('page', String(safePage));
    else url.searchParams.delete('page');

    window.history.replaceState({}, '', url.toString());
    saveRouteState('leads', {
      statusFilter,
      sourceWebsiteFilter,
      dateRangePreset,
      customStartDate,
      customEndDate,
      salesIdFilter,
      productIdFilter,
      validOnly,
      includeSpam,
      viewMode,
      currentPage: safePage,
    });
  }, [
    urlFiltersHydrated,
    statusFilter,
    sourceWebsiteFilter,
    dateRangePreset,
    customStartDate,
    customEndDate,
    salesIdFilter,
    productIdFilter,
    validOnly,
    includeSpam,
    overdueOnly,
    unreceivedOnly,
    specialAlertFilter,
    missingProductOnly,
    viewMode,
    safePage,
  ]);

  // Restore & persist scroll position on /leads
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const scroller = document.getElementById('main-workspace-content');
    if (!scroller) return;
    if (!scrollRestoredRef.current && leads.length > 0) {
      scrollRestoredRef.current = true;
      const saved = loadRouteState<{ scrollTop?: number }>('leads_scroll');
      if (saved?.scrollTop && saved.scrollTop > 0) {
        requestAnimationFrame(() => {
          scroller.scrollTop = saved.scrollTop ?? 0;
        });
      }
    }
    return () => {
      saveRouteState('leads_scroll', { scrollTop: scroller.scrollTop });
    };
  }, [leads.length]);

  const paginatedLeads = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return displayedLeads.slice(start, start + pageSize);
  }, [displayedLeads, safePage, pageSize]);

  const overdueCount = useMemo(
    () => timeFilteredLeads.filter((l) => l.isQuoteOverdue7Days && l.spamStatus === 'NONE').length,
    [timeFilteredLeads],
  );

  const unreceivedCount = useMemo(
    () =>
      timeFilteredLeads.filter(
        (l) => l.pipelineStatus === 'new_lead' && !l.receivedConfirmedAt && l.spamStatus === 'NONE',
      ).length,
    [timeFilteredLeads],
  );

  const b2bSummaryCounts = useMemo(() => {
    const valid = timeFilteredLeads.filter((l) => l.spamStatus === 'NONE');
    const spamExcludedCount = timeFilteredLeads.length - valid.length;
    let newLeadCount = 0;
    let quotingCount = 0;
    let quoteSentCount = 0;
    let wonCount = 0;
    let lostCount = 0;

    let activeDupCount = 0;
    let wonReturningCount = 0;
    let lostReturningCount = 0;
    let spamProbeCount = 0;
    let alertAllCount = 0;

    for (const l of valid) {
      if (l.pipelineStatus === 'new_lead') newLeadCount += 1;
      if (l.pipelineStatus === 'quoting') quotingCount += 1;
      if (l.pipelineStatus === 'quote_sent') quoteSentCount += 1;
      if (l.pipelineStatus === 'won') wonCount += 1;
      if (l.pipelineStatus === 'lost') lostCount += 1;
    }

    for (const l of timeFilteredLeads) {
      const bucket = classifyLeadAlertBucket(l);
      if (bucket === 'active_dup') activeDupCount += 1;
      else if (bucket === 'won_returning') wonReturningCount += 1;
      else if (bucket === 'lost_returning') lostReturningCount += 1;
      else if (bucket === 'spam_probe') spamProbeCount += 1;

      if (bucket !== 'none') {
        alertAllCount += 1;
      }
    }

    return {
      validTotal: valid.length,
      spamExcludedCount,
      newLeadCount,
      quotingCount,
      quoteSentCount,
      wonCount,
      lostCount,
      activeDupCount,
      wonReturningCount,
      lostReturningCount,
      returningTotalCount: wonReturningCount + lostReturningCount,
      spamProbeCount,
      alertAllCount,
    };
  }, [timeFilteredLeads, classifyLeadAlertBucket]);

  const exportHref = useMemo(() => {
    const qs = new URLSearchParams();
    if (statusFilter !== 'all') qs.set('status', statusFilter);
    if (sourceWebsiteFilter !== 'all') qs.set('sourceWebsite', sourceWebsiteFilter);
    if (searchQuery.trim()) qs.set('search', searchQuery.trim());
    if (validOnly) qs.set('validOnly', '1');
    else if (specialAlertFilter !== 'none') qs.set('includeSpam', 'true');
    if (overdueOnly) qs.set('overdueOnly', 'true');
    if (unreceivedOnly) qs.set('unreceived', '1');
    if (missingProductOnly) qs.set('missingProduct', '1');
    if (salesIdFilter !== 'all') qs.set('salesId', salesIdFilter);
    if (productIdFilter !== 'all') qs.set('productId', productIdFilter);
    const bounds = resolvePresetDatesClient(dateRangePreset, customStartDate, customEndDate);
    if (bounds) {
      qs.set('fromDate', bounds.startDate);
      qs.set('toDate', bounds.endDate);
    }
    const queryStr = qs.toString();
    return queryStr ? `/api/v1/leads/export?${queryStr}` : '/api/v1/leads/export';
  }, [
    statusFilter,
    sourceWebsiteFilter,
    searchQuery,
    validOnly,
    specialAlertFilter,
    overdueOnly,
    unreceivedOnly,
    missingProductOnly,
    salesIdFilter,
    productIdFilter,
    dateRangePreset,
    customStartDate,
    customEndDate,
  ]);

  const selectedLead = useMemo(
    () => leads.find((l) => l.id === selectedLeadId) || null,
    [leads, selectedLeadId],
  );

  const canEditLead = useCallback(
    (lead: LeadItemDto | null): boolean => {
      if (!lead || !user || lead.isAnonymized) return false;
      if (!hasBaPermission(user.roleCode, 'LEAD_UPDATE_PIPELINE')) return false;
      if (hasBaPermission(user.roleCode, 'LEAD_VIEW_ALL')) return true;
      return lead.assignedSalesId === user.id || lead.createdByName === user.fullName;
    },
    [user],
  );

  const canEditSelectedLead = useMemo(
    () => canEditLead(selectedLead),
    [canEditLead, selectedLead],
  );

  useEffect(() => {
    if (!selectedLead) {
      populatedLeadIdRef.current = null;
      isDetailDirtyRef.current = false;
      return;
    }
    // Protect unsaved inline form edits/notes from background refresh clobber
    if (populatedLeadIdRef.current === selectedLead.id && isDetailDirtyRef.current) {
      return;
    }
    populatedLeadIdRef.current = selectedLead.id;
    isDetailDirtyRef.current = false;

    setTargetStatus(selectedLead.pipelineStatus);
      setStatusReason(selectedLead.lostReason || '');
      setStatusNote('');
      setMarkQuoteResponded(Boolean(selectedLead.quoteRespondedAt));
      setBypassPriceCheckConfirmed(false);

      // Populate Direct Inline Edit form
      setEditPhone(selectedLead.phone || '');
      setEditContactName(selectedLead.contactName || '');
      setEditCompanyName(selectedLead.companyName || '');
      setEditProjectName(selectedLead.projectName || '');
      setEditEmail(selectedLead.email || '');
      setEditSelfSource(selectedLead.selfReportedSource || '');
      const splitDist = splitLeadDistrictField(selectedLead.hcmDistrict);
      setEditDistrict(splitDist.district);
      setEditWard(splitDist.ward);
      setEditProvince(
        selectedLead.province ||
          (selectedLead.areaType === 'hcm' ? 'TP. Hồ Chí Minh' : ''),
      );
      setEditAddress(selectedLead.installationAddress || '');
      setEditProductIds(selectedLead.products.map((p) => p.id));
      setEditTickReassign(false);
      setEditTickSuspect(Boolean(selectedLead.isPriceCheckSuspect));

      const rawCustomNote = selectedLead.customProductNote || '';
      const existingScheduledDate = extractScheduledFollowUpDate(rawCustomNote);
      setEditFollowUpDate(existingScheduledDate);
      const extractedCustomItems = Array.from(
        rawCustomNote.matchAll(/\[Dịch vụ khác:\s*([^\]]+)\]/g),
      ).map((m) => m[1].trim());
      setEditCustomServiceItems(extractedCustomItems);
      setEditCustomServiceDraft('');

      let cleanCustomNote = rawCustomNote
        .replace(/\[HẸN LIÊN HỆ:\s*[^\]]+\]/g, '')
        .replace(/\[Dịch vụ khác:\s*[^\]]+\]\s*·?\s*/g, '')
        .trim();
      for (const opt of B2B_HORIZON_OPTIONS) {
        cleanCustomNote = cleanCustomNote.replace(opt.tag, '').trim();
        for (const legacyTag of opt.legacyTags) {
          cleanCustomNote = cleanCustomNote.replace(legacyTag, '').trim();
        }
      }
      setEditCustomProductNote(cleanCustomNote);
      const detectedHorizon = getB2bFollowUpHorizon(selectedLead);
      setEditB2bHorizon(detectedHorizon.key);
      setEditUpdateNote('');
  }, [selectedLead]);

  const canSeePrivateQuote = useMemo(() => {
    if (!user) return false;
    return ['BOD', 'ADMIN', 'SALES_LEAD', 'SALES'].includes(user.roleCode);
  }, [user]);

  const canCreate = user ? hasBaPermission(user.roleCode, 'LEAD_CREATE') : false;
  const canUpdatePipeline = user ? hasBaPermission(user.roleCode, 'LEAD_UPDATE_PIPELINE') : false;
  const canReassign = user ? hasBaPermission(user.roleCode, 'LEAD_REASSIGN') : false;
  const canUploadAttachment = user ? hasBaPermission(user.roleCode, 'ATTACHMENT_UPLOAD_VIEW') : false;

  const groupedProducts = useMemo(() => {
    return {
      led: products.filter((p) => p.category === 'MAN_HINH_LED'),
      board: products.filter((p) => p.category === 'BANG_DIEN_TU'),
      other: products.filter((p) => p.category === 'KHAC'),
    };
  }, [products]);

  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await apiRequest('/api/v1/leads', {
        method: 'POST',
        csrfToken: user.csrfToken,
        body: {
          contactChannel: createChannel,
          phone: createPhone,
          contactName: createContactName || null,
          companyName: createCompanyName || null,
          projectName: createProjectName || null,
          email: createEmail || null,
          selfReportedSource: createSelfSource || null,
          areaType: inferAreaTypeFromProvince(createProvince),
          hcmDistrict: createDistrict || null,
          province: createProvince || null,
          installationAddress: createAddress || null,
          productIds: createProductIds,
          customProductNote: createCustomProductNote || null,
          initialNote: createInitialNote || null,
          reassignToSalesId:
            tickReassignOnCreate && createReassignSalesId ? Number(createReassignSalesId) : null,
          reassignReason: tickReassignOnCreate ? createReassignReason : null,
        },
      });
      setShowCreateModal(false);
      setCreatePhone('');
      setCreateContactName('');
      setCreateCompanyName('');
      setCreateProjectName('');
      setCreateEmail('');
      setCreateAddress('');
      setCreateInitialNote('');
      setFeedbackMsg('Đã tiếp nhận hồ sơ Lead mới và kiểm tra trùng lặp / dò giá thành công.');
      await fetchLeads();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể tạo Lead mới.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmReceive = async (lead: LeadItemDto) => {
    if (!user) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await apiRequest(`/api/v1/leads/${lead.id}`, {
        method: 'PATCH',
        csrfToken: user.csrfToken,
        body: {
          action: 'confirm_receive',
          expectedVersion: lead.version,
        },
      });
      setFeedbackMsg(`Đã xác nhận tiếp nhận Lead ${lead.leadCode} (giữ trạng thái Vừa nhận thông tin theo UC01).`);
      await fetchLeads();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi xác nhận tiếp nhận.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateLeadInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedLead || !canEditSelectedLead) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const horizonOpt = B2B_HORIZON_OPTIONS.find((o) => o.key === editB2bHorizon);
      const composedCustomNote = [
        horizonOpt ? horizonOpt.tag : '',
        ...editCustomServiceItems.map((i) => `[Dịch vụ khác: ${i}]`),
        editCustomProductNote.trim(),
      ]
        .filter(Boolean)
        .join(' · ')
        .trim();

      const suspectTag = editTickSuspect
        ? '[NGHI VẤN: Đánh dấu kiểm tra dò giá / trùng]'
        : '';

      await apiRequest(`/api/v1/leads/${selectedLead.id}`, {
        method: 'PATCH',
        csrfToken: user.csrfToken,
        body: {
          action: 'update_info',
          expectedVersion: selectedLead.version,
          phone: editPhone.trim(),
          contactName: editContactName.trim() || null,
          companyName: editCompanyName.trim() || null,
          projectName: editProjectName.trim() || null,
          email: editEmail.trim() || null,
          selfReportedSource: editSelfSource.trim() || null,
          areaType: inferAreaTypeFromProvince(editProvince),
          hcmDistrict: composeLeadDistrictField(editWard, editDistrict),
          province: editProvince.trim() || null,
          installationAddress: editAddress.trim() || null,
          productIds: editProductIds.length > 0 ? editProductIds : selectedLead.products.map((p) => p.id),
          customProductNote: composedCustomNote || null,
          note:
            [
              suspectTag,
              editUpdateNote.trim() ||
                (horizonOpt
                  ? `Cập nhật hồ sơ Lead · Tình trạng nhu cầu: ${horizonOpt.shortLabel}`
                  : 'Cập nhật thông tin hồ sơ Lead.'),
            ]
              .filter(Boolean)
              .join(' '),
        },
      });
      isDetailDirtyRef.current = false;
      setFeedbackMsg(
        `Đã lưu cập nhật trực tiếp thông tin hồ sơ ${selectedLead.leadCode} thành công.`,
      );
      await fetchLeads();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi cập nhật thông tin Lead.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTransitionPipeline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedLead) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await apiRequest(`/api/v1/leads/${selectedLead.id}`, {
        method: 'PATCH',
        csrfToken: user.csrfToken,
        body: {
          action: 'transition_pipeline',
          expectedVersion: selectedLead.version,
          toStatus: targetStatus,
          reason: statusReason || null,
          noteContent: statusNote || null,
          markQuoteResponded,
          bypassPriceCheckConfirmed,
        },
      });
      isDetailDirtyRef.current = false;
      setFeedbackMsg(`Đã cập nhật trạng thái Pipeline của ${selectedLead.leadCode} sang "${PIPELINE_STATUS_LABELS[targetStatus]}".`);
      // UC01 4.6f: Nếu lý do Thất bại là "Đối thủ khảo giá", hỏi NVKD có muốn đăng cảnh báo dò giá không (5.1)
      if (
        targetStatus === 'lost' &&
        statusReason.trim().toLowerCase().includes('đối thủ khảo giá')
      ) {
        setCompetitorPromptLead(selectedLead);
      }
      await fetchLeads();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi cập nhật trạng thái Pipeline.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReassignSales = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedLead || !reassignTargetId) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await apiRequest(`/api/v1/leads/${selectedLead.id}`, {
        method: 'PATCH',
        csrfToken: user.csrfToken,
        body: {
          action: 'reassign_sales',
          expectedVersion: selectedLead.version,
          toSalesId: Number(reassignTargetId),
          reasonCategory: reassignCategory,
          reasonDetail: reassignDetail || null,
        },
      });
      const targetSalesObj = salesOptions.find((s) => s.id === Number(reassignTargetId));
      const fullTransferReason = reassignDetail ? `${reassignCategory}: ${reassignDetail}` : reassignCategory;
      isDetailDirtyRef.current = false;
      setFeedbackMsg(`Đã chuyển giao Lead ${selectedLead.leadCode} cho ${targetSalesObj?.fullName || 'NVKD mới'} và gửi thông báo CRM.`);
      setLastTransferShare({
        leadId: selectedLead.id,
        leadCode: selectedLead.leadCode,
        targetSalesName: targetSalesObj?.fullName || `NVKD #${reassignTargetId}`,
        reason: fullTransferReason,
        label: selectedLead.projectName || selectedLead.companyName || selectedLead.leadCode,
        copied: false,
      });
      await fetchLeads();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi chuyển giao Lead.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleMarkSpam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedLead) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await apiRequest(`/api/v1/leads/${selectedLead.id}`, {
        method: 'PATCH',
        csrfToken: user.csrfToken,
        body: {
          action: 'mark_spam',
          expectedVersion: selectedLead.version,
          spamReason,
        },
      });
      setFeedbackMsg(`Đã đánh dấu Spam cho ${selectedLead.leadCode} (${spamReason}).`);
      await fetchLeads();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi đánh dấu Spam.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreatePriceAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedLead) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const formData = new FormData();
      formData.append('leadId', String(selectedLead.id));
      formData.append('reasonEvidence', priceCheckReason);
      if (priceCheckFile) {
        formData.append('screenshot', priceCheckFile);
      }
      await apiRequest('/api/v1/leads/price-check-alerts', {
        method: 'POST',
        csrfToken: user.csrfToken,
        isFormData: true,
        body: formData,
      });
      setPriceCheckReason('');
      setPriceCheckFile(null);
      setCompetitorPromptLead(null);
      setFeedbackMsg(`Đã đăng cảnh báo nghi đối thủ dò giá cho ${selectedLead.leadCode} và thông báo tới Sales/Marketing/Ads.`);
      await fetchLeads();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi đăng cảnh báo dò giá.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDismissPriceAlertById = async (alertId: number, reason: string) => {
    if (!user || !reason.trim()) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await apiRequest('/api/v1/leads/price-check-alerts', {
        method: 'PATCH',
        csrfToken: user.csrfToken,
        body: { alertId, dismissReason: reason.trim() },
      });
      setFeedbackMsg('Đã gỡ cảnh báo dò giá và tự động bỏ cờ "Nghi dò giá" trên các Lead liên quan (UC01 5.3).');
      await fetchLeads();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể gỡ cảnh báo dò giá.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDismissPriceAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !dismissingAlert || !dismissAlertReason.trim()) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await apiRequest('/api/v1/leads/price-check-alerts', {
        method: 'PATCH',
        csrfToken: user.csrfToken,
        body: {
          alertId: dismissingAlert.id,
          dismissReason: dismissAlertReason.trim(),
        },
      });
      setFeedbackMsg(
        `Đã gỡ cảnh báo dò giá cho ${dismissingAlert.companyName || dismissingAlert.phone} và tự động bỏ cờ "Nghi dò giá" trên các Lead liên quan (UC01 5.3).`,
      );
      setDismissingAlert(null);
      setDismissAlertReason('');
      await fetchLeads();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể gỡ cảnh báo dò giá.');
    } finally {
      setSubmitting(false);
    }
  };

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const res = typeof reader.result === 'string' ? reader.result : '';
        resolve(res);
      };
      reader.onerror = () => reject(new Error(`Không thể đọc tệp "${file.name}".`));
      reader.readAsDataURL(file);
    });

  const handleUploadAttachment = async (e: React.FormEvent) => {
    e.preventDefault();
    const filesToUpload =
      attachmentFiles.length > 0 ? attachmentFiles : attachmentFile ? [attachmentFile] : [];
    if (!user || !selectedLead || filesToUpload.length === 0) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const encodedFiles = await Promise.all(
        filesToUpload.map(async (f) => ({
          fileName: f.name,
          mimeType: f.type || 'application/octet-stream',
          base64Data: await fileToBase64(f),
        })),
      );

      await apiRequest(`/api/v1/leads/${selectedLead.id}/attachments`, {
        method: 'POST',
        csrfToken: user.csrfToken,
        body: {
          attachmentType,
          folderPath: '/ho-so-cong-trinh',
          files: encodedFiles,
        },
      });
      setAttachmentFile(null);
      setAttachmentFiles([]);
      if (attachmentInputRef.current) {
        attachmentInputRef.current.value = '';
      }
      setFeedbackMsg(
        filesToUpload.length === 1
          ? `Đã tải lên tệp "${filesToUpload[0].name}" thành công.`
          : `Đã tải lên ${filesToUpload.length} tệp đính kèm thành công.`,
      );
      await fetchLeads();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi tải tệp đính kèm.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveEditAttachment = async (attId: number) => {
    if (!user || !selectedLead) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      let base64Data: string | undefined;
      let mimeType: string | undefined;
      let nextName = editingAttachmentName.trim();
      if (editingAttachmentReplaceFile) {
        base64Data = await fileToBase64(editingAttachmentReplaceFile);
        mimeType = editingAttachmentReplaceFile.type || 'application/octet-stream';
        if (!nextName) {
          nextName = editingAttachmentReplaceFile.name;
        }
      }
      await apiRequest(`/api/v1/leads/attachments/${attId}`, {
        method: 'PATCH',
        csrfToken: user.csrfToken,
        body: {
          fileName: nextName || undefined,
          attachmentType: editingAttachmentType,
          base64Data,
          mimeType,
        },
      });
      setEditingAttachmentId(null);
      setEditingAttachmentReplaceFile(null);
      setFeedbackMsg('Đã cập nhật tệp đính kèm thành công.');
      await fetchLeads();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi cập nhật tệp đính kèm.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteAttachment = async (attId: number, fileName: string) => {
    if (!user || !selectedLead) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await apiRequest(`/api/v1/leads/attachments/${attId}`, {
        method: 'DELETE',
        csrfToken: user.csrfToken,
      });
      if (editingAttachmentId === attId) {
        setEditingAttachmentId(null);
      }
      setFeedbackMsg(`Đã xóa tệp "${fileName}" khỏi hồ sơ.`);
      await fetchLeads();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi xóa tệp đính kèm.');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredSalesForReassign = useMemo(() => {
    if (reassignCategory === 'Bận') {
      return salesOptions.filter((s) => s.eligibleForBusyTransfer);
    }
    return salesOptions.filter((s) => s.id !== user?.id);
  }, [salesOptions, reassignCategory, user?.id]);

  const handleToggleReceivingStatus = async () => {
    if (!user) return;
    const nextVal = !isReceivingLeads;
    setIsReceivingLeads(nextVal);
    try {
      await apiRequest('/api/v1/leads', {
        method: 'PATCH',
        csrfToken: user.csrfToken,
        body: {
          action: 'set_receiving_status',
          isReceivingLeads: nextVal,
        },
      });
      setFeedbackMsg(
        nextVal
          ? 'Đã bật trạng thái: Sẵn sàng nhận Lead tự động (Round-Robin).'
          : 'Đã tạm ngưng nhận Lead tự động.',
      );
      await fetchLeads();
    } catch (err) {
      setIsReceivingLeads(!nextVal);
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi cập nhật trạng thái nhận Lead.');
    }
  };

  const handleReviewSpam = async (decision: 'confirm_spam' | 'restore_lead') => {
    if (!user || !selectedLead) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await apiRequest(`/api/v1/leads/${selectedLead.id}`, {
        method: 'PATCH',
        csrfToken: user.csrfToken,
        body: {
          action: 'review_spam',
          decision,
          expectedVersion: selectedLead.version,
        },
      });
      setFeedbackMsg(
        decision === 'confirm_spam'
          ? `Đã duyệt loại trừ Spam khỏi báo cáo Ads cho ${selectedLead.leadCode}.`
          : `Đã khôi phục hồ sơ ${selectedLead.leadCode} về danh sách Lead hợp lệ.`,
      );
      await fetchLeads();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi duyệt trạng thái Spam.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendReminderNudge = async (
    lead: LeadItemDto,
    reminderLabel: string,
    customMessage?: string,
  ) => {
    if (!user) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await apiRequest(`/api/v1/leads/${lead.id}`, {
        method: 'PATCH',
        csrfToken: user.csrfToken,
        body: {
          action: 'send_reminder_nudge',
          reminderLabel,
          message: customMessage || '',
        },
      });
      setFeedbackMsg(
        `🔔 Đã gửi thông báo nhắc việc "${reminderLabel}" tới chuông thông báo của ${lead.assignedSalesName || 'NVKD phụ trách'} (${lead.leadCode}).`,
      );
      await fetchLeads();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể gửi thông báo nhắc việc.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleBatchNudgeSales = async (targetSalesId: number | 'all', salesName: string) => {
    if (!user) return;
    const targets = timeFilteredLeads.filter((l) => {
      const r = classifyReminderCategories(l);
      if (!r.hasAnyReminder) return false;
      if (targetSalesId === 'all') return true;
      return (l.assignedSalesId || 0) === targetSalesId;
    });
    if (targets.length === 0) {
      setFeedbackMsg('Không có hồ sơ nào cần gửi thông báo nhắc việc.');
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const batch = targets.slice(0, 8);
      await Promise.all(
        batch.map((l) => {
          const r = classifyReminderCategories(l);
          return apiRequest(`/api/v1/leads/${l.id}`, {
            method: 'PATCH',
            csrfToken: user.csrfToken,
            body: {
              action: 'send_reminder_nudge',
              reminderLabel: r.primaryBadgeText || 'Nhắc việc tự động',
              message: r.primaryActionHint,
            },
          });
        }),
      );
      setFeedbackMsg(
        `🔔 Đã bắn ${batch.length} thông báo nhắc việc tự động tới ${targetSalesId === 'all' ? 'toàn bộ đội ngũ Sales' : salesName}!`,
      );
      await fetchLeads();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi gửi thông báo nhắc việc hàng loạt.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickAckReminder = async (
    lead: LeadItemDto,
    ackType: 'quote_responded' | 'followed_up',
    noteContent: string,
  ) => {
    if (!user) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await apiRequest(`/api/v1/leads/${lead.id}`, {
        method: 'PATCH',
        csrfToken: user.csrfToken,
        body: {
          action: 'quick_ack_reminder',
          ackType,
          noteContent,
        },
      });
      setQuickReminderNotes((prev) => ({ ...prev, [lead.id]: '' }));
      setFeedbackMsg(
        ackType === 'quote_responded'
          ? `✓ Đã xác nhận khách phản hồi báo giá cho hồ sơ ${lead.leadCode} và hoàn tất nhắc việc.`
          : `✓ Đã ghi nhận kết quả chăm sóc nhắc việc cho hồ sơ ${lead.leadCode}.`,
      );
      await fetchLeads();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể ghi nhận xử lý nhắc việc.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickTransitionLead = async (
    lead: LeadItemDto,
    toStatus: PipelineStatus,
    noteText: string,
  ) => {
    if (!user) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await apiRequest(`/api/v1/leads/${lead.id}`, {
        method: 'PATCH',
        csrfToken: user.csrfToken,
        body: {
          action: 'transition_pipeline',
          expectedVersion: lead.version,
          toStatus,
          reason: null,
          noteContent: noteText,
          markQuoteResponded: toStatus === 'won',
          bypassPriceCheckConfirmed: false,
        },
      });
      setFeedbackMsg(
        `✓ Đã chuyển nhanh ${lead.leadCode} sang "${PIPELINE_STATUS_LABELS[toStatus]}".`,
      );
      await fetchLeads();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể chuyển nhanh tiến độ.');
    } finally {
      setSubmitting(false);
    }
  };

  const pendingTransferredToMeLeads = useMemo(() => {
    if (!user) return [];
    return leads.filter((l) => {
      if (l.spamStatus !== 'NONE' || l.assignedSalesId !== user.id) return false;
      if (l.pipelineStatus === 'won' || l.pipelineStatus === 'lost') return false;
      if (!l.receivedConfirmedAt) return true;
      const acts = l.activities || [];
      const transferAct = acts.find(
        (a) => a.actionType === 'reassign_sales' || a.actionType === 'auto_reassign',
      );
      if (!transferAct) return false;
      const transferMs = new Date(transferAct.createdAt).getTime();
      const confirmedMs = new Date(l.receivedConfirmedAt).getTime();
      const hasConfirmActAfter = acts.some(
        (a) => a.actionType === 'confirm_receive' && new Date(a.createdAt).getTime() >= transferMs,
      );
      return !hasConfirmActAfter && transferMs > confirmedMs;
    });
  }, [leads, user]);

  // Chiều đi (Người chuyển): Lead mình đã bàn giao cho NVKD khác nhưng họ CHƯA bấm xác nhận tiếp nhận
  const pendingTransferredByMeLeads = useMemo(() => {
    if (!user) return [];
    return leads.filter((l) => {
      if (l.spamStatus !== 'NONE' || l.assignedSalesId === user.id) return false;
      if (l.pipelineStatus === 'won' || l.pipelineStatus === 'lost') return false;
      if (l.receivedConfirmedAt) return false;
      const acts = l.activities || [];
      const transferAct = acts.find(
        (a) =>
          a.actionType === 'reassign_sales' &&
          (a.actorName === user.fullName || a.fromSalesName === user.fullName),
      );
      return Boolean(transferAct);
    });
  }, [leads, user]);

  const handleCopyTransferZaloText = async () => {
    if (!lastTransferShare || typeof window === 'undefined') return;
    const directUrl = `${window.location.origin}/leads?leadId=${lastTransferShare.leadId}`;
    const text = `[Toàn Trung CRM] Mình vừa chuyển giao Lead ${lastTransferShare.leadCode} (${lastTransferShare.label}) cho ${lastTransferShare.targetSalesName} · Lý do: ${lastTransferShare.reason}. Bấm link để mở & xác nhận tiếp nhận ngay: ${directUrl}`;
    try {
      await navigator.clipboard.writeText(text);
      setLastTransferShare((prev) => (prev ? { ...prev, copied: true } : null));
    } catch {
      setFeedbackMsg(`Tin nhắn gửi Zalo: ${text}`);
    }
  };

  return (
    <div className="space-y-3.5">
      {(pendingTransferredToMeLeads.length > 0 || pendingTransferredByMeLeads.length > 0) && (
        <div
          role="region"
          aria-label="Theo dõi chuyển giao Lead 2 chiều"
          className={`grid grid-cols-1 ${
            pendingTransferredToMeLeads.length > 0 && pendingTransferredByMeLeads.length > 0
              ? 'xl:grid-cols-2'
              : ''
          } gap-3`}
        >
          {pendingTransferredToMeLeads.length > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50/85 px-4 py-3 shadow-2xs space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-extrabold text-amber-950">
                  <Bell className="w-4 h-4 text-amber-700 shrink-0" />
                  <span>
                    Chờ bạn tiếp nhận ({pendingTransferredToMeLeads.length} Lead):
                  </span>
                </div>
                <span className="text-[11px] text-amber-800 font-medium">
                  Bấm xác nhận để bắt đầu chăm sóc
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                {pendingTransferredToMeLeads.slice(0, 3).map((tLead) => {
                  const transferAct = (tLead.activities || []).find(
                    (a) => a.actionType === 'reassign_sales' || a.actionType === 'auto_reassign',
                  );
                  const waitMins = Math.max(
                    0,
                    Math.floor(
                      (Date.now() -
                        new Date(transferAct?.createdAt || tLead.createdAt || tLead.contactedAt).getTime()) /
                        60_000,
                    ),
                  );
                  const slaBadge =
                    waitMins >= 240
                      ? 'bg-rose-100 text-rose-800 border-rose-200'
                      : waitMins >= 120
                        ? 'bg-amber-100 text-amber-900 border-amber-300'
                        : 'bg-blue-50 text-[#1E3A8A] border-blue-200';
                  return (
                    <div
                      key={tLead.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <span
                          className="font-mono font-extrabold text-[#1E3A8A]"
                          title={tLead.leadCode}
                        >
                          {formatCompactLeadCode(tLead.leadCode)}
                        </span>
                        <span className="mx-1.5 text-slate-300">·</span>
                        <span className="font-semibold text-slate-900">
                          {tLead.projectName || tLead.companyName || tLead.phone}
                        </span>
                        <span className={`ml-2 px-1.5 py-0.5 rounded border text-[10px] font-bold ${slaBadge}`}>
                          {formatWaitingDuration(waitMins)}
                        </span>
                        {transferAct && (
                          <span className="ml-2 text-slate-600">
                            (Từ <strong>{transferAct.actorName}</strong>
                            {transferAct.reason ? ` · ${transferAct.reason}` : ''})
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => openLeadDetail(tLead.id, 'info')}
                          className="px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 font-semibold"
                        >
                          Mở hồ sơ
                        </button>
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => void handleConfirmReceive(tLead)}
                          className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold inline-flex items-center gap-1 disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Xác nhận nhận</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {pendingTransferredByMeLeads.length > 0 && (
            <div className="rounded-xl border border-blue-200 bg-blue-50/60 px-4 py-3 shadow-2xs space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-extrabold text-[#0F275C]">
                  <ArrowRightLeft className="w-4 h-4 text-[#1E3A8A] shrink-0" />
                  <span>
                    Bạn đã chuyển — Đang chờ nhận ({pendingTransferredByMeLeads.length} Lead):
                  </span>
                </div>
                <span className="text-[11px] text-slate-500">Theo dõi 2 chiều</span>
              </div>
              <div className="flex flex-col gap-1.5">
                {pendingTransferredByMeLeads.slice(0, 3).map((oLead) => {
                  const transferAct = (oLead.activities || []).find(
                    (a) => a.actionType === 'reassign_sales',
                  );
                  const waitMins = Math.max(
                    0,
                    Math.floor(
                      (Date.now() -
                        new Date(transferAct?.createdAt || oLead.createdAt || oLead.contactedAt).getTime()) /
                        60_000,
                    ),
                  );
                  const slaBadge =
                    waitMins >= 240
                      ? 'bg-rose-100 text-rose-800 border-rose-200'
                      : waitMins >= 120
                        ? 'bg-amber-100 text-amber-900 border-amber-300'
                        : 'bg-slate-100 text-slate-700 border-slate-200';
                  return (
                    <div
                      key={oLead.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200/80 bg-white px-3 py-2 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <span
                          className="font-mono font-bold text-[#1E3A8A]"
                          title={oLead.leadCode}
                        >
                          {formatCompactLeadCode(oLead.leadCode)}
                        </span>
                        <span className="mx-1.5 text-slate-300">·</span>
                        <span className="font-semibold text-slate-900">
                          {oLead.companyName || oLead.contactName || oLead.phone}
                        </span>
                        <span className="ml-2 text-slate-600">
                          → Chờ <strong>{oLead.assignedSalesName || 'NVKD'}</strong>
                        </span>
                        <span className={`ml-2 px-1.5 py-0.5 rounded border text-[10px] font-bold ${slaBadge}`}>
                          {formatWaitingDuration(waitMins)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => openLeadDetail(oLead.id, 'info')}
                          className="px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-semibold"
                        >
                          Mở
                        </button>
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() =>
                            void handleSendReminderNudge(
                              oLead,
                              'Nhắc tiếp nhận Lead chuyển giao',
                            )
                          }
                          className="px-2.5 py-1 rounded-lg border border-blue-300 bg-blue-50 hover:bg-blue-100 text-[#1E3A8A] font-bold inline-flex items-center gap-1 disabled:opacity-50"
                        >
                          <Send className="w-3 h-3" />
                          <span>Nhắc nhẹ</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {lastTransferShare && (
        <div
          role="status"
          className="rounded-xl border border-emerald-300 bg-emerald-50/90 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
        >
          <div className="flex items-center gap-2 text-emerald-950 min-w-0">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="truncate">
              Đã chuyển giao <strong>{lastTransferShare.leadCode}</strong> cho{' '}
              <strong>{lastTransferShare.targetSalesName}</strong> (đã gửi thông báo trên CRM).
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void handleCopyTransferZaloText()}
              className={`px-3 py-1.5 rounded-lg font-bold inline-flex items-center gap-1.5 transition ${
                lastTransferShare.copied
                  ? 'bg-emerald-700 text-white'
                  : 'bg-[#1E3A8A] hover:bg-[#1553A2] text-white'
              }`}
            >
              <span>
                {lastTransferShare.copied
                  ? '✓ Đã copy! Dán gửi Zalo/Chat ngay'
                  : '📋 Copy tin nhắn & link gửi Zalo'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setLastTransferShare(null)}
              className="p-1 text-emerald-700 hover:text-emerald-950 font-bold"
              title="Đóng"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* C06: Sáu ô tổng hợp chuẩn BA (Tổng Lead hợp lệ + 5 trạng thái bán hàng; ghi rõ bao gồm/loại trừ; không đánh số 1..6) */}
      <section aria-label="Tổng hợp trạng thái Lead" className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <button
          type="button"
          onClick={() => {
            if (viewMode === 'reminders') setViewMode('table');
            setStatusFilter('all');
            setSpecialAlertFilter('none');
            setReminderFilter('none');
            setB2bHorizonFilter('all');
            setMissingProductOnly(false);
            setOverdueOnly(false);
            setUnreceivedOnly(false);
            setCurrentPage(1);
          }}
          className={`min-h-[104px] text-left rounded-[12px] p-3.5 border flex flex-col justify-between transition-colors shadow-2xs focus-visible:outline-2 focus-visible:outline-[#1E3A8A] ${
            viewMode !== 'reminders' &&
            statusFilter === 'all' &&
            specialAlertFilter === 'none' &&
            reminderFilter === 'none' &&
            b2bHorizonFilter === 'all' &&
            !missingProductOnly &&
            !overdueOnly &&
            !unreceivedOnly
              ? 'bg-blue-50/60 border-[#1E3A8A] ring-1 ring-[#1E3A8A]/20'
              : 'bg-white border-slate-200/90 hover:border-slate-300'
          }`}
        >
          <span className="text-xs font-medium text-slate-600 block">
            Tổng Lead trong bộ lọc
          </span>
          <span className="text-2xl font-bold text-slate-900 tabular-nums mt-1">
            {b2bSummaryCounts.validTotal}
          </span>
          <span className="text-[11px] text-slate-500 mt-1 leading-snug">
            Đã trừ {b2bSummaryCounts.spamExcludedCount} spam
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            if (viewMode === 'reminders') setViewMode('table');
            setStatusFilter('new_lead');
            setSpecialAlertFilter('none');
            setReminderFilter('none');
            setB2bHorizonFilter('all');
            setOverdueOnly(false);
            setUnreceivedOnly(false);
            setCurrentPage(1);
          }}
          className={`min-h-[104px] text-left rounded-[12px] p-3.5 border flex flex-col justify-between transition-colors shadow-2xs focus-visible:outline-2 focus-visible:outline-[#1E3A8A] ${
            viewMode !== 'reminders' &&
            statusFilter === 'new_lead' &&
            specialAlertFilter === 'none' &&
            reminderFilter === 'none'
              ? 'bg-violet-50/60 border-violet-400 ring-1 ring-violet-500/20'
              : 'bg-white border-slate-200/90 hover:border-slate-300'
          }`}
        >
          <span className="text-xs font-medium text-slate-600 block">
            {PIPELINE_STATUS_LABELS.new_lead}
          </span>
          <span className="text-2xl font-bold text-slate-900 tabular-nums mt-1">
            {b2bSummaryCounts.newLeadCount}
          </span>
          <span className="text-[11px] text-violet-700 font-medium mt-1">
            {unreceivedCount} chờ tiếp nhận
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            if (viewMode === 'reminders') setViewMode('table');
            setStatusFilter('quoting');
            setSpecialAlertFilter('none');
            setReminderFilter('none');
            setB2bHorizonFilter('all');
            setOverdueOnly(false);
            setUnreceivedOnly(false);
            setCurrentPage(1);
          }}
          className={`min-h-[104px] text-left rounded-[12px] p-3.5 border flex flex-col justify-between transition-colors shadow-2xs focus-visible:outline-2 focus-visible:outline-[#1E3A8A] ${
            viewMode !== 'reminders' &&
            statusFilter === 'quoting' &&
            specialAlertFilter === 'none' &&
            reminderFilter === 'none'
              ? 'bg-blue-50/60 border-blue-400 ring-1 ring-blue-500/20'
              : 'bg-white border-slate-200/90 hover:border-slate-300'
          }`}
        >
          <span className="text-xs font-medium text-slate-600 block">
            {PIPELINE_STATUS_LABELS.quoting}
          </span>
          <span className="text-2xl font-bold text-slate-900 tabular-nums mt-1">
            {b2bSummaryCounts.quotingCount}
          </span>
          <span className="text-[11px] text-slate-500 mt-1">
            Đang lập báo giá
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            if (viewMode === 'reminders') setViewMode('table');
            setStatusFilter('quote_sent');
            setSpecialAlertFilter('none');
            setReminderFilter('none');
            setB2bHorizonFilter('all');
            setOverdueOnly(false);
            setUnreceivedOnly(false);
            setCurrentPage(1);
          }}
          className={`min-h-[104px] text-left rounded-[12px] p-3.5 border flex flex-col justify-between transition-colors shadow-2xs focus-visible:outline-2 focus-visible:outline-[#1E3A8A] ${
            viewMode !== 'reminders' &&
            statusFilter === 'quote_sent' &&
            specialAlertFilter === 'none' &&
            reminderFilter === 'none'
              ? 'bg-amber-50/60 border-amber-400 ring-1 ring-amber-500/20'
              : 'bg-white border-slate-200/90 hover:border-slate-300'
          }`}
        >
          <span className="text-xs font-medium text-slate-600 block">
            {PIPELINE_STATUS_LABELS.quote_sent}
          </span>
          <span className="text-2xl font-bold text-slate-900 tabular-nums mt-1">
            {b2bSummaryCounts.quoteSentCount}
          </span>
          <span className="text-[11px] text-amber-800 font-medium mt-1">
            {overdueCount > 0 ? `${overdueCount} quá hạn >7 ngày` : 'Chờ phản hồi'}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            if (viewMode === 'reminders') setViewMode('table');
            setStatusFilter('won');
            setSpecialAlertFilter('none');
            setReminderFilter('none');
            setB2bHorizonFilter('all');
            setOverdueOnly(false);
            setUnreceivedOnly(false);
            setCurrentPage(1);
          }}
          className={`min-h-[104px] text-left rounded-[12px] p-3.5 border flex flex-col justify-between transition-colors shadow-2xs focus-visible:outline-2 focus-visible:outline-[#1E3A8A] ${
            viewMode !== 'reminders' &&
            statusFilter === 'won' &&
            specialAlertFilter === 'none' &&
            reminderFilter === 'none'
              ? 'bg-emerald-50/60 border-emerald-400 ring-1 ring-emerald-500/20'
              : 'bg-white border-slate-200/90 hover:border-slate-300'
          }`}
        >
          <span className="text-xs font-medium text-slate-600 block">
            {PIPELINE_STATUS_LABELS.won}
          </span>
          <span className="text-2xl font-bold text-emerald-700 tabular-nums mt-1">
            {b2bSummaryCounts.wonCount}
          </span>
          <span className="text-[11px] text-slate-500 mt-1">
            Đã chốt
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            if (viewMode === 'reminders') setViewMode('table');
            setStatusFilter('lost');
            setSpecialAlertFilter('none');
            setReminderFilter('none');
            setB2bHorizonFilter('all');
            setOverdueOnly(false);
            setUnreceivedOnly(false);
            setCurrentPage(1);
          }}
          className={`min-h-[104px] text-left rounded-[12px] p-3.5 border flex flex-col justify-between transition-colors shadow-2xs focus-visible:outline-2 focus-visible:outline-[#1E3A8A] ${
            viewMode !== 'reminders' &&
            statusFilter === 'lost' &&
            specialAlertFilter === 'none' &&
            reminderFilter === 'none'
              ? 'bg-slate-100 border-slate-400'
              : 'bg-white border-slate-200/90 hover:border-slate-300'
          }`}
        >
          <span className="text-xs font-medium text-slate-600 block">
            {PIPELINE_STATUS_LABELS.lost}
          </span>
          <span className="text-2xl font-bold text-slate-700 tabular-nums mt-1">
            {b2bSummaryCounts.lostCount}
          </span>
          <span className="text-[11px] text-slate-500 mt-1">
            Đã đóng
          </span>
        </button>
      </section>

      {/* Toolbar 1 hàng trải sát 2 bên: Trái (Website · Thời gian · Chế độ xem) | Giữa (Xuất/Nhập Excel · Tạo Lead) | Phải (Tìm kiếm · Cần kiểm tra · Nhắc việc) */}
      <div className="rounded-[12px] bg-white text-slate-900 px-2.5 py-2 shadow-2xs border border-slate-200/90 flex flex-wrap 2xl:flex-nowrap items-center justify-between gap-1.5">
        {/* Cụm Trái: Bộ lọc phạm vi */}
        <div className="flex flex-wrap 2xl:flex-nowrap items-center gap-1.5 shrink-0">
          <select
            aria-label="Lọc theo website nguồn"
            value={sourceWebsiteFilter}
            onChange={(e) => {
              setSourceWebsiteFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="min-h-8 max-w-[146px] 2xl:max-w-[185px] px-2 rounded-[10px] border border-slate-200 bg-white text-xs font-semibold text-slate-700 truncate focus-visible:outline-2 focus-visible:outline-[#1E3A8A]"
          >
            <option value="all">Tất cả website</option>
            <option value="toantrung.com.vn">Website Toàn Trung (toantrung.com.vn)</option>
            <option value="bangled.vn">Chuyên trang Bảng LED (bangled.vn)</option>
            <option value="manhinhled.net.vn">Chuyên trang Màn hình LED (manhinhled.net.vn)</option>
            <option value="bangdientu.com.vn">Chuyên trang Bảng điện tử (bangdientu.com.vn)</option>
            <option value="__unresolved__">Chưa xác định website</option>
          </select>

          <StandardDateRangeDropdown
            preset={dateRangePreset as StandardDatePreset}
            customStartDate={customStartDate}
            customEndDate={customEndDate}
            onChangePreset={(p) => {
              setDateRangePreset(p);
              setCustomStartDate('');
              setCustomEndDate('');
              setCurrentPage(1);
            }}
            onChangeCustomRange={(start, end) => {
              setCustomStartDate(start);
              setCustomEndDate(end);
              if (start || end) {
                setDateRangePreset('CUSTOM');
              }
              setCurrentPage(1);
            }}
            include90Days={true}
            size="sm"
          />

          {/* Danh sách / Kanban */}
          <div className="inline-flex rounded-[10px] border border-slate-200 bg-slate-100 p-0.5 shrink-0">
            <button
              type="button"
              aria-pressed={viewMode === 'table' && reminderFilter === 'none'}
              onClick={() => {
                setViewMode('table');
                setReminderFilter('none');
              }}
              className={`min-h-7 px-2 rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition ${
                viewMode === 'table' && reminderFilter === 'none'
                  ? 'bg-white text-[#0F275C] shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Table2 aria-hidden="true" className="w-3.5 h-3.5" />
              <span>Danh sách</span>
            </button>
            <button
              type="button"
              aria-pressed={viewMode === 'kanban'}
              onClick={() => {
                setViewMode('kanban');
                setReminderFilter('none');
              }}
              className={`min-h-7 px-2 rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition ${
                viewMode === 'kanban'
                  ? 'bg-white text-[#0F275C] shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Kanban aria-hidden="true" className="w-3.5 h-3.5" />
              <span>Kanban</span>
            </button>
            <button
              type="button"
              aria-pressed={viewMode === 'split'}
              onClick={() => {
                setViewMode('split');
                setReminderFilter('none');
              }}
              title="Chế độ Duyệt Liên Hoàn 2 Cột (Lướt nhanh bằng phím ↑/↓)"
              className={`min-h-7 px-2 rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition ${
                viewMode === 'split'
                  ? 'bg-white text-[#0F275C] shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Columns2 aria-hidden="true" className="w-3.5 h-3.5" />
              <span>Duyệt 2 cột</span>
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              setLedSpecTargetLead(selectedLead || null);
              setShowLedSpecModal(true);
            }}
            title="Lập Phiếu Đề Xuất Cấu Hình Kỹ Thuật Màn Hình LED B2B (Xuất Word/PDF)"
            className="min-h-8 px-2.5 rounded-[10px] border border-blue-200 bg-blue-50/75 hover:bg-blue-100 text-[#0F275C] text-xs font-semibold inline-flex items-center gap-1 transition whitespace-nowrap"
          >
            <Calculator aria-hidden="true" className="w-3.5 h-3.5" />
            <span>Phiếu Kỹ thuật LED</span>
          </button>
        </div>

        {/* Cụm Giữa: Xuất/Nhập Excel + Tạo Lead */}
        <div className="flex items-center justify-center gap-1.5 shrink-0">
          {user?.roleCode === 'SALES' && (
            <button
              type="button"
              onClick={() => void handleToggleReceivingStatus()}
              className={`min-h-8 px-2 rounded-[10px] border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
                isReceivingLeads
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-slate-100 border-slate-200 text-slate-600'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  isReceivingLeads ? 'bg-emerald-500' : 'bg-slate-400'
                }`}
              />
              <span>{isReceivingLeads ? 'Đang nhận' : 'Tạm ngưng'}</span>
            </button>
          )}

          {((user && hasBaPermission(user.roleCode, 'EXPORT_DATA')) || canCreate) && (
            <div className="inline-flex min-h-8 items-center rounded-[10px] border border-slate-200 bg-white overflow-hidden">
              {user && hasBaPermission(user.roleCode, 'EXPORT_DATA') && (
                <a
                  href={exportHref}
                  className="min-h-8 px-2.5 hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1 transition-colors whitespace-nowrap"
                >
                  <Download aria-hidden="true" className="w-3.5 h-3.5 text-slate-500" />
                  <span>{UI_VOCABULARY.actions.exportExcel}</span>
                </a>
              )}
              {user && hasBaPermission(user.roleCode, 'EXPORT_DATA') && canCreate && (
                <span className="h-4 w-px bg-slate-200" aria-hidden="true" />
              )}
              {canCreate && (
                <button
                  type="button"
                  onClick={() => {
                    setImportPreviewRows([]);
                    setImportFileName(null);
                    setImportPastedText('');
                    setShowImportModal(true);
                  }}
                  className="min-h-8 px-2.5 hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1 transition-colors whitespace-nowrap"
                >
                  <FolderUp aria-hidden="true" className="w-3.5 h-3.5 text-slate-500" />
                  <span>{UI_VOCABULARY.actions.importExcel}</span>
                </button>
              )}
            </div>
          )}

          {canCreate && (
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="min-h-8 px-2.5 rounded-[10px] bg-[#0F275C] hover:bg-[#1E3A8A] text-white text-xs font-semibold inline-flex items-center gap-1 shadow-2xs transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1E3A8A]"
            >
              <Plus aria-hidden="true" className="w-3.5 h-3.5" />
              <span>{UI_VOCABULARY.actions.createLead}</span>
            </button>
          )}
          {user && hasBaPermission(user.roleCode, 'SYSTEM_USER_ADMIN') && (
            <button
              type="button"
              onClick={() => setShowProductCatalogModal(true)}
              className="min-h-8 px-2.5 rounded-[10px] border border-blue-200 bg-blue-50/70 hover:bg-blue-100 text-[#1E3A8A] text-xs font-semibold inline-flex items-center gap-1 transition-colors whitespace-nowrap"
              title="Quản lý danh mục sản phẩm & thêm nhóm sản phẩm mới (Dành cho Admin)"
            >
              <Layers aria-hidden="true" className="w-3.5 h-3.5" />
              <span>Danh mục SP</span>
            </button>
          )}
        </div>

        {/* Cụm Phải: Cần kiểm tra + Nhắc việc (ô Tìm kiếm đã đặt duy nhất trên Topbar để tránh lặp 2 ô tìm kiếm) */}
        <div className="flex items-center gap-1.5 min-w-0">
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('tt-lead-search', { detail: '' }));
                }
              }}
              className="min-h-8 px-2.5 rounded-[10px] bg-blue-50 border border-blue-200 text-[#0F275C] text-xs font-semibold inline-flex items-center gap-1.5 max-w-[200px]"
            >
              <span className="truncate">Tìm: &ldquo;{searchQuery}&rdquo;</span>
              <span className="font-bold">×</span>
            </button>
          )}

          <button
            type="button"
            aria-pressed={specialAlertFilter !== 'none'}
            onClick={() => {
              setViewMode('table');
              setStatusFilter('all');
              setReminderFilter('none');
              setSpecialAlertFilter(specialAlertFilter === 'none' ? 'all_alerts' : 'none');
              setCurrentPage(1);
            }}
            className={`min-h-8 px-2 rounded-[10px] border text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors ${
              specialAlertFilter !== 'none'
                ? 'bg-amber-100 border-amber-400 text-amber-900'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-amber-50/50'
            }`}
          >
            <AlertTriangle aria-hidden="true" className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <span>{UI_VOCABULARY.qualityFlags.needsReview}</span>
            <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[11px] font-bold tabular-nums">
              {b2bSummaryCounts.alertAllCount}
            </span>
          </button>

          <button
            type="button"
            aria-pressed={reminderFilter !== 'none'}
            onClick={() => {
              setViewMode('table');
              setSpecialAlertFilter('none');
              setStatusFilter('all');
              setReminderFilter((prev) => (prev === 'none' ? 'all_reminders' : 'none'));
              setCurrentPage(1);
            }}
            className={`min-h-8 px-2 rounded-[10px] border text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors ${
              reminderFilter !== 'none'
                ? 'bg-rose-50 border-rose-300 text-rose-800'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Bell aria-hidden="true" className="w-3.5 h-3.5 text-rose-600 shrink-0" />
            <span>Nhắc việc</span>
            <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[11px] font-bold tabular-nums">
              {reminderStats.totalLeadsWithReminder}
            </span>
          </button>

          {missingProductOnly && (
            <button
              type="button"
              onClick={() => setMissingProductOnly(false)}
              className="min-h-8 px-2 rounded-[10px] bg-blue-50 border border-blue-200 text-[#1E3A8A] text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap"
            >
              <span>Chưa gắn SP</span>
              <span>×</span>
            </button>
          )}
          {salesIdFilter !== 'all' && (
            <button
              type="button"
              onClick={() => setSalesIdFilter('all')}
              className="min-h-8 px-2 rounded-[10px] bg-blue-50 border border-blue-200 text-[#1E3A8A] text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap"
            >
              <span>
                Sales:{' '}
                {salesIdFilter === 'unassigned'
                  ? 'Chưa phân bổ'
                  : salesOptions.find((s) => String(s.id) === salesIdFilter)?.fullName ||
                    `#${salesIdFilter}`}
              </span>
              <span>×</span>
            </button>
          )}
          {productIdFilter !== 'all' && (
            <button
              type="button"
              onClick={() => setProductIdFilter('all')}
              className="min-h-8 px-2 rounded-[10px] bg-blue-50 border border-blue-200 text-[#1E3A8A] text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap"
            >
              <span>
                SP:{' '}
                {products.find((p) => String(p.id) === productIdFilter)?.productName ||
                  `#${productIdFilter}`}
              </span>
              <span>×</span>
            </button>
          )}
          {overdueOnly && (
            <button
              type="button"
              onClick={() => setOverdueOnly(false)}
              className="min-h-8 px-2 rounded-[10px] bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap"
            >
              <span>Quá hạn &gt;7 ngày</span>
              <span>×</span>
            </button>
          )}
          {unreceivedOnly && (
            <button
              type="button"
              onClick={() => setUnreceivedOnly(false)}
              className="min-h-8 px-2 rounded-[10px] bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap"
            >
              <span>Chờ tiếp nhận</span>
              <span>×</span>
            </button>
          )}
          {validOnly && (
            <button
              type="button"
              onClick={() => {
                setValidOnly(false);
                setIncludeSpam(true);
              }}
              className="min-h-8 px-2 rounded-[10px] bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap"
            >
              <span>Chỉ Lead hợp lệ (L2)</span>
              <span>×</span>
            </button>
          )}
          {hasAnyActiveFilter && (
            <button
              type="button"
              onClick={handleResetAllFilters}
              className="min-h-8 px-2.5 rounded-[10px] border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap transition-colors"
            >
              <span>Đặt lại bộ lọc</span>
            </button>
          )}
        </div>
      </div>

      {/* Khối Nhắc Việc Tự Động (4 quy tắc tự động như Ảnh 1: Chưa tiếp nhận, Lead đứng yên > 3 ngày, Báo giá chưa phản hồi 1d/1w/>1m, Đến lịch hẹn) */}
      {reminderFilter !== 'none' && (
        <div className="rounded-2xl bg-white border border-rose-200 p-4 space-y-3 shadow-xs animate-in fade-in duration-150">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 grid place-items-center">
                <Bell className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-display font-bold text-slate-900 text-sm">
                    Nhắc việc tự động
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-rose-600 text-white text-[11px] font-bold">
                    {reminderStats.totalLeadsWithReminder}
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  Các hồ sơ Lead cần xử lý theo quy tắc tự động (bấm từng thẻ để lọc danh sách bên dưới)
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setReminderFilter('all_reminders');
                  setCurrentPage(1);
                }}
                className={`h-8 px-3 rounded-lg text-xs font-semibold transition ${
                  reminderFilter === 'all_reminders'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Tất cả nhắc việc ({reminderStats.totalLeadsWithReminder})
              </button>
              <button
                type="button"
                onClick={() => setReminderFilter('none')}
                className="h-8 px-2.5 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-900"
              >
                Đóng ×
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* 1. Chưa tiếp nhận */}
            <button
              type="button"
              onClick={() => {
                setReminderFilter(reminderFilter === 'unreceived' ? 'all_reminders' : 'unreceived');
                setCurrentPage(1);
              }}
              className={`text-left p-3.5 rounded-xl border transition flex items-start justify-between gap-2 ${
                reminderFilter === 'unreceived'
                  ? 'bg-rose-50 border-rose-400 ring-2 ring-rose-500/20'
                  : 'bg-rose-50/40 border-rose-200/80 hover:border-rose-300'
              }`}
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <span className="w-8 h-8 rounded-lg bg-rose-100 text-rose-600 grid place-items-center shrink-0 mt-0.5">
                  <UserCheck className="w-4 h-4" />
                </span>
                <div className="min-w-0">
                  <span className="font-bold text-slate-900 text-xs sm:text-sm block">
                    Chưa tiếp nhận
                  </span>
                  <span className="text-[11px] text-slate-600 block mt-0.5">
                    Lead mới quá 2 giờ chưa xác nhận tiếp nhận
                  </span>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-rose-600 text-white text-xs font-bold shrink-0">
                {reminderStats.unreceived}
              </span>
            </button>

            {/* 2. Lead đứng yên */}
            <button
              type="button"
              onClick={() => {
                setReminderFilter(
                  reminderFilter === 'stagnant_3d' ? 'all_reminders' : 'stagnant_3d',
                );
                setCurrentPage(1);
              }}
              className={`text-left p-3.5 rounded-xl border transition flex items-start justify-between gap-2 ${
                reminderFilter === 'stagnant_3d'
                  ? 'bg-amber-50 border-amber-400 ring-2 ring-amber-500/20'
                  : 'bg-amber-50/40 border-amber-200/80 hover:border-amber-300'
              }`}
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <span className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 grid place-items-center shrink-0 mt-0.5">
                  <Clock className="w-4 h-4" />
                </span>
                <div className="min-w-0">
                  <span className="font-bold text-slate-900 text-xs sm:text-sm block">
                    Lead đứng yên
                  </span>
                  <span className="text-[11px] text-slate-600 block mt-0.5">
                    Không có tiến triển &gt; 3 ngày
                  </span>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-amber-500 text-white text-xs font-bold shrink-0">
                {reminderStats.stagnant3d}
              </span>
            </button>

            {/* 3. Báo giá chưa phản hồi */}
            <button
              type="button"
              onClick={() => {
                setReminderFilter(
                  reminderFilter === 'quote_unresponded' ? 'all_reminders' : 'quote_unresponded',
                );
                setCurrentPage(1);
              }}
              className={`text-left p-3.5 rounded-xl border transition flex items-start justify-between gap-2 ${
                reminderFilter === 'quote_unresponded'
                  ? 'bg-blue-50 border-blue-400 ring-2 ring-blue-500/20'
                  : 'bg-blue-50/40 border-blue-200/80 hover:border-blue-300'
              }`}
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <span className="w-8 h-8 rounded-lg bg-blue-100 text-[#1E3A8A] grid place-items-center shrink-0 mt-0.5">
                  <Send className="w-4 h-4" />
                </span>
                <div className="min-w-0">
                  <span className="font-bold text-slate-900 text-xs sm:text-sm block">
                    Báo giá chưa phản hồi
                  </span>
                  <span className="text-[11px] text-slate-600 block mt-0.5">
                    Đã gửi báo giá: 1 ngày ({reminderStats.quote1d}) · 1 tuần ({reminderStats.quote7d}) · &gt; 1 tháng ({reminderStats.quote30d})
                  </span>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-blue-600 text-white text-xs font-bold shrink-0">
                {reminderStats.quoteUnresponded}
              </span>
            </button>

            {/* 4. Đến lịch hẹn */}
            <button
              type="button"
              onClick={() => {
                setReminderFilter(
                  reminderFilter === 'scheduled_due' ? 'all_reminders' : 'scheduled_due',
                );
                setCurrentPage(1);
              }}
              className={`text-left p-3.5 rounded-xl border transition flex items-start justify-between gap-2 ${
                reminderFilter === 'scheduled_due'
                  ? 'bg-violet-50 border-violet-400 ring-2 ring-violet-500/20'
                  : 'bg-violet-50/40 border-violet-200/80 hover:border-violet-300'
              }`}
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <span className="w-8 h-8 rounded-lg bg-violet-100 text-violet-700 grid place-items-center shrink-0 mt-0.5">
                  <Calendar className="w-4 h-4" />
                </span>
                <div className="min-w-0">
                  <span className="font-bold text-slate-900 text-xs sm:text-sm block">
                    Đến lịch hẹn
                  </span>
                  <span className="text-[11px] text-slate-600 block mt-0.5">
                    Có lịch chăm sóc &amp; theo dõi dự án B2B
                  </span>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-violet-600 text-white text-xs font-bold shrink-0">
                {reminderStats.scheduledDue}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Sub-Filter Bar khi chọn ô Trùng / Spam / Quay lại */}
      {specialAlertFilter !== 'none' && (
        <div className="rounded-xl bg-amber-50/70 border border-amber-200/90 p-3 flex flex-wrap items-center justify-between gap-2.5 shadow-2xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-bold text-amber-900 mr-1 inline-flex items-center gap-1">
              <ShieldAlert className="w-4 h-4 text-amber-700" />
              Bộ lọc Trùng &amp; Cảnh báo:
            </span>
            <button
              type="button"
              onClick={() => {
                setSpecialAlertFilter('all_alerts');
                setCurrentPage(1);
              }}
              className={`h-8 px-3 rounded-lg text-xs font-semibold transition inline-flex items-center gap-1.5 ${
                specialAlertFilter === 'all_alerts'
                  ? 'bg-slate-900 text-white shadow-2xs'
                  : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span>Tất cả ({b2bSummaryCounts.alertAllCount})</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setSpecialAlertFilter('active_dup');
                setCurrentPage(1);
              }}
              className={`h-8 px-3 rounded-lg text-xs font-semibold transition inline-flex items-center gap-1.5 ${
                specialAlertFilter === 'active_dup'
                  ? 'bg-amber-600 text-white shadow-2xs'
                  : 'bg-white border border-amber-300 text-amber-900 hover:bg-amber-50'
              }`}
            >
              <span>⚠️ Cảnh báo trùng Lead ({b2bSummaryCounts.activeDupCount})</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setSpecialAlertFilter('won_returning');
                setCurrentPage(1);
              }}
              className={`h-8 px-3 rounded-lg text-xs font-semibold transition inline-flex items-center gap-1.5 ${
                specialAlertFilter === 'won_returning'
                  ? 'bg-emerald-600 text-white shadow-2xs'
                  : 'bg-white border border-emerald-300 text-emerald-800 hover:bg-emerald-50'
              }`}
            >
              <span>💎 Khách cũ quay lại · Đã mua ({b2bSummaryCounts.wonReturningCount})</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setSpecialAlertFilter('lost_returning');
                setCurrentPage(1);
              }}
              className={`h-8 px-3 rounded-lg text-xs font-semibold transition inline-flex items-center gap-1.5 ${
                specialAlertFilter === 'lost_returning'
                  ? 'bg-sky-600 text-white shadow-2xs'
                  : 'bg-white border border-sky-300 text-sky-800 hover:bg-sky-50'
              }`}
            >
              <span>🔄 Khách quay lại hỏi mua · Chưa chốt ({b2bSummaryCounts.lostReturningCount})</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setSpecialAlertFilter('spam_probe');
                setCurrentPage(1);
              }}
              className={`h-8 px-3 rounded-lg text-xs font-semibold transition inline-flex items-center gap-1.5 ${
                specialAlertFilter === 'spam_probe'
                  ? 'bg-rose-600 text-white shadow-2xs'
                  : 'bg-white border border-rose-300 text-rose-800 hover:bg-rose-50'
              }`}
            >
              <span>🚫 Spam / Số ảo / Nghi dò giá ({b2bSummaryCounts.spamProbeCount})</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowPriceAlertDirectory(true)}
              className="h-8 px-3 rounded-lg bg-white hover:bg-orange-50 border border-orange-300 text-orange-800 text-xs font-semibold inline-flex items-center gap-1.5 shadow-2xs"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-orange-600" />
              <span>
                Sổ đen Nghi dò giá ({priceCheckAlerts.filter((a) => a.status === 'ACTIVE').length})
              </span>
            </button>
            <button
              type="button"
              onClick={() => setSpecialAlertFilter('none')}
              className="h-8 px-2.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900"
            >
              Đóng lọc ×
            </button>
          </div>
        </div>
      )}

      {/* Role Anonymization Notice (Clean business wording) */}
      {leads.some((l) => l.isAnonymized) && (
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs sm:text-sm text-amber-900 flex items-start gap-2.5">
          <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <strong>Chế độ bảo mật thông tin khách hàng:</strong> Tài khoản{' '}
            <strong>{user?.roleName}</strong> được phép theo dõi nguồn chiến dịch, dòng sản phẩm và tiến độ Pipeline, nhưng thông tin định danh khách hàng (SĐT, Email, Địa chỉ chi tiết, Tệp đính kèm) được ẩn theo quy định phân quyền.
          </div>
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-800 flex items-center justify-between"
        >
          <span>{errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-rose-700 font-semibold"
          >
            Đóng
          </button>
        </div>
      )}

      {feedbackMsg && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 flex items-center justify-between">
          <span>{feedbackMsg}</span>
          <button
            type="button"
            onClick={() => setFeedbackMsg(null)}
            className="text-emerald-700 font-semibold"
          >
            Đóng
          </button>
        </div>
      )}

      <LeadSavedSmartViewsBar
        user={user}
        currentFilters={{
          statusFilter,
          sourceWebsiteFilter,
          overdueOnly,
          unreceivedOnly,
          specialAlertFilter,
        }}
        onApplyView={(f) => {
          setStatusFilter(f.statusFilter || 'all');
          setSourceWebsiteFilter(f.sourceWebsiteFilter || 'all');
          setOverdueOnly(Boolean(f.overdueOnly));
          setUnreceivedOnly(Boolean(f.unreceivedOnly));
          setSpecialAlertFilter((f.specialAlertFilter as typeof specialAlertFilter) || 'none');
          setReminderFilter('none');
          setCurrentPage(1);
        }}
      />

      {/* Main Content: Table View vs Split-View vs Kanban View */}
      {loading ? (
        <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xs space-y-3 animate-pulse">
          <div className="h-10 bg-slate-100 rounded-xl w-full" />
          {[1, 2, 3, 4, 5, 6].map((idx) => (
            <div key={idx} className="h-14 bg-slate-50 rounded-xl w-full border border-slate-100" />
          ))}
        </div>
      ) : viewMode === 'split' ? (
        <LeadSplitTriageView
          leads={displayedLeads}
          allScopedLeads={leads}
          user={user}
          canEditLead={canEditLead}
          onOpenFullModal={(leadId) => {
            setSelectedLeadId(leadId);
            setLeadDetailTab('info');
          }}
          onOpenLedSpec={(targetLead) => {
            setLedSpecTargetLead(targetLead);
            setShowLedSpecModal(true);
          }}
          onRefreshLeads={fetchLeads}
          onFeedback={(msg) => setFeedbackMsg(msg)}
          onError={(msg) => setErrorMsg(msg)}
        />
      ) : viewMode === 'table' ? (
        <>
          {/* Mobile Card-View Alternative (< 768px) */}
          <div className="md:hidden space-y-2.5">
            {paginatedLeads.map((lead) => {
              const cleanDigits = lead.phone.replace(/\D/g, '');
              const fraud = fraudByLeadId.get(lead.id) || evaluateLeadFraudCriteria(lead, leads, priceCheckAlerts);
              const primaryProduct = lead.products[0];
              const extraProductsCount = Math.max(0, lead.products.length - 1);
              const horizon = getB2bFollowUpHorizon(lead);
              const editable = canEditLead(lead);

              return (
                <div
                  key={lead.id}
                  onClick={() => {
                    setSelectedLeadId(lead.id);
                    setLeadDetailTab('info');
                  }}
                  className={`rounded-2xl border p-3.5 shadow-xs transition active:scale-[0.99] space-y-2.5 ${
                    lead.spamStatus !== 'NONE'
                      ? 'bg-red-50/70 border-red-300 border-l-4 border-l-red-600'
                      : `bg-white border-slate-200/90 ${STATUS_ROW_ACCENTS[lead.pipelineStatus]}`
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-slate-900 text-sm truncate">
                        {(lead.companyName || lead.contactName || 'Khách hàng mới').replace(
                          /\s*\(nghi (dò|khảo) giá\)/i,
                          '',
                        )}
                      </h3>
                      <p className="text-[13px] text-slate-600 truncate mt-0.5">
                        {lead.projectName ? `Dự án: ${lead.projectName}` : 'Chưa cập nhật tên dự án'}
                      </p>
                      <span className="font-mono text-xs text-slate-500 mt-0.5 block">
                        Mã hồ sơ: {lead.leadCode}
                      </span>
                    </div>
                    <span
                      className={`px-2.5 py-1 rounded-lg border text-xs shrink-0 ${
                        STATUS_BADGE_STYLES[lead.pipelineStatus]
                      }`}
                    >
                      {PIPELINE_STATUS_LABELS[lead.pipelineStatus]}
                    </span>
                  </div>

                  {/* Separated Warning Badges */}
                  <div className="flex flex-wrap gap-1.5">
                    {lead.spamStatus !== 'NONE' &&
                      !(
                        fraud.hasPriceProbeBehavior &&
                        lead.spamStatus === 'PENDING_REVIEW' &&
                        (!lead.spamReason ||
                          lead.spamReason.toLowerCase().includes('khảo giá') ||
                          lead.spamReason.toLowerCase().includes('dò giá'))
                      ) && (
                        <span className="px-2 py-0.5 rounded-md bg-red-600 text-white text-xs font-semibold inline-flex items-center gap-1">
                          <Ban className="w-3 h-3" />
                          Spam · {lead.spamStatus === 'CONFIRMED' ? 'Đã xác nhận' : 'Chờ duyệt'}
                        </span>
                      )}
                    {fraud.hasPriceProbeBehavior && (
                      <span className="px-2 py-0.5 rounded-md bg-orange-50 border border-orange-200 text-orange-800 text-xs font-semibold">
                        Nghi dò giá
                      </span>
                    )}
                    {(lead.isDuplicateAlert || fraud.hasDuplicatePhone || fraud.duplicateProjectName) && (
                      <span className="px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold">
                        Trùng lặp ({fraud.duplicateProjectName ? 'Dự án' : 'SĐT'})
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-700">
                    <div className="flex items-center gap-1.5 font-mono font-semibold text-slate-900">
                      <Phone className="w-4 h-4 text-[#1E3A8A]" />
                      <span>{lead.phone}</span>
                    </div>
                    <span className="text-xs text-slate-500">
                      Sales: <strong className="text-slate-800">{lead.assignedSalesName || 'Chưa giao'}</strong>
                    </span>
                  </div>

                  {/* Main Product + +N Indicator */}
                  {primaryProduct && (
                    <div className="flex items-center gap-1.5">
                      <span className="px-2.5 py-1 rounded-md bg-blue-50 text-[#1E3A8A] border border-blue-200 text-xs font-medium truncate">
                        {primaryProduct.productName}
                      </span>
                      {extraProductsCount > 0 && (
                        <span className="px-2 py-1 rounded-md bg-slate-100 text-slate-700 border border-slate-200 text-xs font-semibold shrink-0">
                          +{extraProductsCount}
                        </span>
                      )}
                    </div>
                  )}

                  {!lead.isAnonymized && cleanDigits.length >= 9 && (
                    <div
                      className="pt-2.5 border-t border-slate-100 flex items-center justify-end gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <a
                        href={`tel:${cleanDigits}`}
                        className="h-8 px-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold inline-flex items-center gap-1.5"
                      >
                        <Phone className="w-3.5 h-3.5" />
                        <span>Gọi</span>
                      </a>
                      <a
                        href={`https://zalo.me/${cleanDigits}`}
                        target="_blank"
                        rel="noreferrer"
                        className="h-8 px-2.5 rounded-xl bg-blue-50 border border-blue-200 text-[#1E3A8A] text-xs font-semibold inline-flex items-center gap-1.5"
                      >
                        <span>Zalo</span>
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Bảng 7 cột gọn (Khách hàng / dự án · Liên hệ & nguồn · Sản phẩm · Trạng thái / lịch theo dõi · Sales phụ trách · Ngày nhận · Thao tác) */}
          <div className="hidden md:block bg-white border border-slate-200/90 rounded-[12px] overflow-hidden shadow-2xs">
            <div
              tabIndex={0}
              role="region"
              aria-label="Bảng danh sách Lead"
              className="overflow-x-auto"
            >
              <table className="w-full min-w-[980px] xl:min-w-0 xl:table-fixed text-left border-collapse text-sm">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 text-xs font-semibold sticky top-0 z-10">
                  <tr>
                    <th scope="col" className="py-2.5 px-3 w-[25%]">Khách hàng / dự án</th>
                    <th scope="col" className="py-2.5 px-2.5 w-[15%]">Liên hệ &amp; nguồn</th>
                    <th scope="col" className="py-2.5 px-2.5 w-[15%]">Sản phẩm</th>
                    <th scope="col" className="py-2.5 px-2.5 w-[16%]">Trạng thái / lịch theo dõi</th>
                    <th scope="col" className="py-2.5 px-2.5 w-[13%]">Sales phụ trách</th>
                    <th scope="col" className="py-2.5 px-2 w-[92px]">Ngày nhận</th>
                    <th scope="col" className="py-2.5 px-3 text-right w-[128px]">Liên hệ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginatedLeads.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 px-4 text-center text-slate-500 text-sm">
                        Không có hồ sơ Lead nào khớp bộ lọc đang chọn.
                      </td>
                    </tr>
                  ) : (
                    paginatedLeads.map((lead) => {
                      const cleanDigits = lead.phone.replace(/\D/g, '');
                      const fraud = fraudByLeadId.get(lead.id) || evaluateLeadFraudCriteria(lead, leads, priceCheckAlerts);
                      const primaryProduct = lead.products[0];
                      const extraProducts = lead.products.slice(1);
                      const horizon = getB2bFollowUpHorizon(lead);

                      const isPriceShoppingReasonOnly =
                        fraud.hasPriceProbeBehavior &&
                        lead.spamStatus === 'PENDING_REVIEW' &&
                        (!lead.spamReason ||
                          lead.spamReason.toLowerCase().includes('khảo giá') ||
                          lead.spamReason.toLowerCase().includes('dò giá'));
                      const showSpamBadge = lead.spamStatus !== 'NONE' && !isPriceShoppingReasonOnly;

                      // C06: Không lặp tên khách hàng ở nhiều cột
                      const hasCompany = Boolean(lead.companyName && lead.companyName.trim());
                      const primaryCustomerLabel = (
                        lead.companyName ||
                        lead.contactName ||
                        'Khách hàng chưa cập nhật tên'
                      ).replace(/\s*\(nghi (dò|khảo) giá\)/i, '');

                      const secondaryProjectLine = lead.projectName
                        ? lead.projectName
                        : lead.province || lead.hcmDistrict
                          ? formatLeadLocationLabel(lead)
                          : null;

                      // Nhãn cảnh báo chất lượng gọn, đúng mức đã xác minh (C03 & C06)
                      let qualityBadge: { label: string; className: string } | null = null;
                      if (showSpamBadge) {
                        qualityBadge = {
                          label: UI_VOCABULARY.qualityFlags.suspectedSpam,
                          className: 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100',
                        };
                      } else if (
                        fraud.duplicateScenario === 'SCENARIO_1_ACTIVE_DUP' ||
                        fraud.duplicateScenario === 'SCENARIO_3_MULTI_CONTRACTOR' ||
                        (fraud.duplicateScenario === 'NONE' && (lead.isDuplicateAlert || fraud.hasDuplicatePhone))
                      ) {
                        qualityBadge = {
                          label: UI_VOCABULARY.qualityFlags.suspectedDuplicate,
                          className: 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100',
                        };
                      } else if (
                        fraud.duplicateScenario === 'SCENARIO_2_WON_RETURNING' ||
                        fraud.duplicateScenario === 'SCENARIO_2_LOST_RETURNING'
                      ) {
                        qualityBadge = {
                          label: UI_VOCABULARY.qualityFlags.returningCustomer,
                          className: 'bg-sky-50 border-sky-200 text-sky-800 hover:bg-sky-100',
                        };
                      } else if (
                        fraud.hasPriceProbeBehavior ||
                        lead.hasMissingSubjectContent ||
                        !lead.isPhoneNormalized
                      ) {
                        qualityBadge = {
                          label: UI_VOCABULARY.qualityFlags.needsReview,
                          className: 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100',
                        };
                      }

                      const mktChannel =
                        lead.tracking?.marketingSource &&
                        lead.tracking.marketingSource !== 'Chưa xác định'
                          ? lead.tracking.marketingSource
                          : null;
                      const webShort = lead.sourceWebsite
                        ? lead.sourceWebsite.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '')
                        : null;
                      const compactSourceLabel = webShort
                        ? mktChannel
                          ? `Web ${webShort} · ${mktChannel}`
                          : `Web ${webShort}`
                        : lead.contactChannel === 'zalo'
                          ? 'Zalo'
                          : lead.contactChannel === 'hotline'
                            ? 'SĐT / Hotline'
                            : lead.contactChannel === 'email'
                              ? 'Email'
                              : lead.contactChannel === 'fanpage'
                                ? 'Fanpage'
                                : lead.contactChannel === 'google_lead_form'
                                  ? 'Form Google Ads'
                                  : lead.contactChannel === 'form_web'
                                    ? 'Biểu mẫu web'
                                    : mktChannel || formatContactChannelClean(lead.contactChannel);
                      const receivedDateObj = new Date(lead.createdAt || lead.contactedAt);

                      return (
                        <tr
                          key={lead.id}
                          onClick={() => openLeadDetail(lead.id, 'info')}
                          className={`group cursor-pointer transition-colors min-h-[68px] hover:bg-blue-50/45 ${STATUS_ROW_ACCENTS[lead.pipelineStatus]}`}
                        >
                          {/* Cột 1: Khách hàng / dự án + dấu hiệu Nghi trùng / Quay lại ngay tại tên khách & mã gọn */}
                          <th scope="row" className={`sticky start-0 z-[1] bg-white group-hover:bg-blue-50/45 py-3 px-3 align-middle font-normal ${STATUS_ROW_ACCENTS[lead.pipelineStatus]}`}>
                            <div className="flex items-center gap-1.5 min-w-0">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openLeadDetail(lead.id, 'info');
                                }}
                                className="font-semibold text-slate-900 group-hover:text-[#1E3A8A] hover:underline truncate text-left block focus-visible:outline-2 focus-visible:outline-[#1E3A8A]"
                              >
                                {primaryCustomerLabel}
                              </button>
                              {qualityBadge && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setInvestigativeLead(lead);
                                  }}
                                  className={`inline-flex items-center whitespace-nowrap gap-1 shrink-0 min-h-5 px-2 py-0.5 rounded-full border text-[11px] font-semibold transition-colors ${qualityBadge.className}`}
                                >
                                  <AlertTriangle aria-hidden="true" className="w-3 h-3 shrink-0" />
                                  <span>{qualityBadge.label}</span>
                                </button>
                              )}
                            </div>
                            {secondaryProjectLine ? (
                              <div className="text-xs text-slate-600 truncate max-w-full mt-0.5">
                                {secondaryProjectLine}
                              </div>
                            ) : lead.hasMissingSubjectContent ? (
                              <div className="text-[11px] text-amber-700 truncate max-w-full mt-0.5">
                                Thiếu tiêu đề nội dung biểu mẫu
                              </div>
                            ) : null}
                            <div
                              className="text-[11px] font-mono text-slate-500 truncate max-w-full mt-0.5"
                              title={`Mã hồ sơ đầy đủ: ${lead.leadCode}`}
                            >
                              {formatCompactLeadCode(lead.leadCode)}
                            </div>
                          </th>

                          {/* Cột 2: Liên hệ & Nguồn gộp gọn (SĐT + Web toantrung.com.vn / bangled.vn / Zalo / SĐT...) */}
                          <td className="py-3 px-2.5 align-middle">
                            <div className="font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                              {lead.phone}
                            </div>
                            {hasCompany && lead.contactName && (
                              <div className="text-xs text-slate-600 truncate max-w-full mt-0.5">
                                {lead.contactName}
                              </div>
                            )}
                            <div
                              className="inline-flex items-center mt-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-xs font-medium max-w-full truncate"
                              title={compactSourceLabel}
                            >
                              {compactSourceLabel}
                            </div>
                          </td>

                          {/* Cột 3: Sản phẩm ("Chưa phân loại" thay câu dài lặp) */}
                          <td className="py-3 px-2.5 align-middle">
                            {primaryProduct ? (
                              <div className="flex items-center gap-1 flex-wrap">
                                <span className="px-2 py-0.5 rounded-md bg-blue-50 text-[#1E3A8A] border border-blue-200/80 text-xs font-medium truncate max-w-full">
                                  {primaryProduct.productName}
                                </span>
                                {extraProducts.length > 0 && (
                                  <span className="px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[11px] font-semibold">
                                    +{extraProducts.length}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400">
                                {UI_VOCABULARY.fallbacks.unclassified}
                              </span>
                            )}
                          </td>

                          {/* Cột 4: Trạng thái / lịch theo dõi (nhãn Nghi trùng/Quay lại đã chuyển sang Cột 1 để dễ quét ngay tại tên khách) */}
                          <td className="py-3 px-2.5 align-middle">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className={`inline-flex items-center whitespace-nowrap min-h-6 px-2.5 py-0.5 rounded-full border text-xs ${STATUS_BADGE_STYLES[lead.pipelineStatus]}`}
                              >
                                {PIPELINE_STATUS_LABELS[lead.pipelineStatus]}
                              </span>
                            </div>
                            {horizon.scheduledDate ? (
                              <div className="text-[11px] text-slate-500 mt-1">
                                Hẹn liên hệ: {horizon.scheduledDate}
                              </div>
                            ) : lead.isQuoteOverdue7Days ? (
                              <div className="text-[11px] text-amber-700 font-medium mt-1">
                                Báo giá quá 7 ngày chưa phản hồi
                              </div>
                            ) : null}
                          </td>

                          {/* Cột 5: Sales phụ trách (tách riêng trạng thái Chờ tiếp nhận / Đã tiếp nhận) */}
                          <td className="py-3 px-2.5 align-middle">
                            <div className="text-xs font-semibold text-slate-900 truncate max-w-full">
                              {lead.assignedSalesName || 'Chưa phân bổ'}
                            </div>
                            <div className="mt-0.5">
                              {lead.receivedConfirmedAt ? (
                                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 font-medium">
                                  <CheckCircle2 aria-hidden="true" className="w-3 h-3 shrink-0" />
                                  <span>{UI_VOCABULARY.acceptanceStatus.accepted}</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 font-medium">
                                  <Clock aria-hidden="true" className="w-3 h-3 shrink-0" />
                                  <span>{UI_VOCABULARY.acceptanceStatus.pending}</span>
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Cột 6: Ngày nhận */}
                          <td className="py-3 px-2 align-middle whitespace-nowrap tabular-nums">
                            <div className="text-xs font-medium text-slate-800">
                              {receivedDateObj.toLocaleDateString('vi-VN')}
                            </div>
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              {receivedDateObj.toLocaleTimeString('vi-VN', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </div>
                          </td>

                          {/* Cột 7: Liên hệ nhanh (Gọi/Zalo tách sự kiện khỏi bấm dòng để không mở nhầm bảng chi tiết) */}
                          <td
                            className="py-3 px-2.5 align-middle text-right whitespace-nowrap"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {!lead.isAnonymized && cleanDigits.length >= 9 ? (
                              <div className="inline-flex items-center justify-end gap-1">
                                <a
                                  href={`tel:${cleanDigits}`}
                                  aria-label={`Gọi ${lead.phone}`}
                                  className="min-h-8 px-1.5 rounded-lg bg-slate-100 hover:bg-emerald-50 text-slate-700 hover:text-emerald-800 border border-slate-200 text-xs font-medium inline-flex items-center gap-1 transition-colors"
                                >
                                  <Phone aria-hidden="true" className="w-3 h-3" />
                                  <span>Gọi</span>
                                </a>
                                <a
                                  href={`https://zalo.me/${cleanDigits}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  aria-label={`Mở Zalo ${lead.phone}`}
                                  className="min-h-8 px-1.5 rounded-lg bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-[#1E3A8A] border border-slate-200 text-xs font-medium inline-flex items-center transition-colors"
                                >
                                  <span>Zalo</span>
                                </a>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Phân trang mặc định 20 dòng/trang */}
            <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs text-slate-600">
              <div className="flex flex-wrap items-center gap-3">
                <span>
                  Hiển thị{' '}
                  <strong className="text-slate-900 tabular-nums">
                    {displayedLeads.length === 0 ? 0 : (safePage - 1) * pageSize + 1}
                  </strong>
                  –
                  <strong className="text-slate-900 tabular-nums">
                    {Math.min(safePage * pageSize, displayedLeads.length)}
                  </strong>{' '}
                  trong tổng số{' '}
                  <strong className="text-[#1E3A8A] tabular-nums">{totalFilteredCount}</strong> Lead
                </span>

                <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                  <span>Mỗi trang:</span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                    className="min-h-7 px-2 rounded-lg border border-slate-200 bg-white text-slate-800 font-semibold"
                  >
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </label>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="min-h-8 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 font-semibold text-slate-700 disabled:opacity-40"
                >
                  Trang trước
                </button>
                <span className="px-2.5 py-1 font-semibold text-slate-700 tabular-nums">
                  Trang {safePage} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="min-h-8 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 font-semibold text-slate-700 disabled:opacity-40"
                >
                  Trang sau
                </button>
              </div>
            </div>
          </div>
        </>
      ) : (
        /* UI-04: Standardized Kanban 5-Column View with Distinct Color Themes */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 pb-3">
          {PIPELINE_STATUSES.map((statusKey) => {
            const colLeads = displayedLeads.filter((l) => l.pipelineStatus === statusKey);
            const theme = KANBAN_COLUMN_THEMES[statusKey];
            return (
              <div
                key={statusKey}
                className={`min-w-0 border rounded-2xl p-3 flex flex-col gap-2.5 min-h-[520px] ${theme.wrap}`}
              >
                <div
                  className={`flex items-center justify-between px-3 py-2 rounded-xl ${theme.headerBg}`}
                >
                  <span className="text-sm font-extrabold">
                    {PIPELINE_STATUS_LABELS[statusKey]}
                  </span>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-extrabold shadow-2xs ${theme.badge}`}
                  >
                    {colLeads.length}
                  </span>
                </div>

                <div className="space-y-2.5 flex-1 flex flex-col">
                  {colLeads.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-slate-400 border border-dashed border-slate-300/80 rounded-xl bg-white/60">
                      <FolderPlus className="w-8 h-8 text-slate-300 mb-1.5" />
                      <p className="text-sm font-semibold text-slate-500">Chưa có hồ sơ</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Không có Lead ở giai đoạn này
                      </p>
                    </div>
                  ) : (
                    colLeads.map((lead) => {
                      const primaryProduct = lead.products[0];
                      const extraCount = Math.max(0, lead.products.length - 1);
                      const fraud = fraudByLeadId.get(lead.id) || evaluateLeadFraudCriteria(lead, leads, priceCheckAlerts);
                      const isPriceShoppingReasonOnly =
                        fraud.hasPriceProbeBehavior &&
                        lead.spamStatus === 'PENDING_REVIEW' &&
                        (!lead.spamReason ||
                          lead.spamReason.toLowerCase().includes('khảo giá') ||
                          lead.spamReason.toLowerCase().includes('dò giá'));
                      const showSpamBadge = lead.spamStatus !== 'NONE' && !isPriceShoppingReasonOnly;

                      return (
                        <div
                          key={lead.id}
                          onClick={() => {
                            setSelectedLeadId(lead.id);
                            setLeadDetailTab('info');
                          }}
                          className={`cursor-pointer rounded-xl p-3.5 border shadow-2xs hover:shadow-md transition-all flex flex-col justify-between min-h-[172px] ${
                            showSpamBadge
                              ? 'bg-red-50/70 border-red-300 border-l-4 border-l-red-600 hover:border-red-500'
                              : `bg-white border-slate-200/90 ${STATUS_ROW_ACCENTS[lead.pipelineStatus]} hover:border-[#1E3A8A]`
                          }`}
                        >
                          {/* Card Region 1: Header (Code & Contact Channel) */}
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-xs font-bold text-[#1E3A8A]">
                                {lead.leadCode}
                              </span>
                              <span className="text-xs px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-semibold">
                                {CONTACT_CHANNEL_LABELS[lead.contactChannel]}
                              </span>
                            </div>

                            {/* Card Region 2: Primary Customer & Secondary Project */}
                            <div>
                              <h3 className="text-sm font-bold text-slate-900 line-clamp-1">
                                {(lead.companyName || lead.contactName || lead.phone).replace(
                                  /\s*\(nghi (dò|khảo) giá\)/i,
                                  '',
                                )}
                              </h3>
                              <p className="text-xs text-slate-600 line-clamp-1 mt-0.5 min-h-[16px]">
                                {lead.projectName
                                  ? `Dự án: ${lead.projectName}`
                                  : formatLeadLocationLabel(lead)}
                              </p>
                            </div>

                            {/* Card Region 3: Product + Warnings */}
                            <div className="flex flex-wrap items-center gap-1 pt-0.5">
                              {fraud.isCustomerWonVIP && (
                                <span className="text-xs px-2 py-0.5 rounded-md bg-amber-500 text-slate-950 font-extrabold inline-flex items-center gap-1 shadow-2xs">
                                  <Crown className="w-3 h-3 fill-slate-950 text-slate-950" />
                                  <span>VIP ĐÃ MUA</span>
                                </span>
                              )}
                              {primaryProduct && (
                                <span className="text-xs px-2 py-0.5 rounded-md bg-blue-50 text-[#1E3A8A] border border-blue-200/80 font-semibold truncate max-w-[190px]">
                                  {primaryProduct.productName}
                                </span>
                              )}
                              {extraCount > 0 && (
                                <span className="text-xs px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-700 font-bold">
                                  +{extraCount}
                                </span>
                              )}
                              {showSpamBadge && (
                                <span className="text-xs px-2 py-0.5 rounded-md bg-red-600 text-white font-semibold inline-flex items-center gap-1">
                                  <Ban className="w-3 h-3" />
                                  Spam
                                </span>
                              )}
                              {fraud.hasPriceProbeBehavior && (
                                <span className="text-xs px-2 py-0.5 rounded-md bg-orange-50 text-orange-800 border border-orange-200 font-semibold">
                                  Nghi dò giá
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Card Region 4: Aligned Footer */}
                          <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-xs text-slate-500">
                            <span className="truncate font-semibold text-slate-700">
                              {lead.assignedSalesName || 'Chưa phân bổ'}
                            </span>
                            <span className="inline-flex items-center gap-1 font-semibold text-[#1E3A8A]">
                              <span>Chi tiết</span>
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Tạo Lead Thủ Công */}
      {showCreateModal && (
        <ManualLeadModal
          open={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          products={products}
          salesOptions={salesOptions}
          currentUserId={user?.id}
          csrfToken={user?.csrfToken}
          existingLeads={leads}
          onOpenExistingLead={(leadId) => {
            setShowCreateModal(false);
            setSelectedLeadId(leadId);
            setLeadDetailTab('info');
          }}
          onCreatedSuccess={async (leadCode, assignedMsg, transferMeta) => {
            setFeedbackMsg(`Đã tạo thành công hồ sơ ${leadCode}. ${assignedMsg}`);
            if (transferMeta) {
              setLastTransferShare({ ...transferMeta, copied: false });
            }
            await fetchLeads();
          }}
        />
      )}

      {/* Modal Tạo Lead Tự Động Từ Gmail */}
      {showGmailSyncModal && (
        <GmailSyncModal
          open={showGmailSyncModal}
          onClose={() => setShowGmailSyncModal(false)}
          csrfToken={user?.csrfToken}
          onSynced={() => {
            void fetchLeads();
          }}
        />
      )}

      {/* Modal Quản lý Danh mục Sản phẩm & Nhóm SP (Admin) */}
      {showProductCatalogModal && (
        <ProductCatalogModal
          open={showProductCatalogModal}
          onClose={() => setShowProductCatalogModal(false)}
          csrfToken={user?.csrfToken}
          onCatalogUpdated={() => fetchLeads(true)}
        />
      )}

      {showLedSpecModal && (
        <LedTechnicalSpecSheetModal
          open={showLedSpecModal}
          onClose={() => setShowLedSpecModal(false)}
          user={user}
          lead={ledSpecTargetLead || selectedLead || null}
          onSavedToLead={(msg) => {
            setFeedbackMsg(msg);
            void fetchLeads();
          }}
        />
      )}

      {showImportModal && (
        <LeadExcelImportModal
          open={showImportModal}
          onClose={() => setShowImportModal(false)}
          user={user}
          leads={leads}
          onImported={async (msg) => {
            setFeedbackMsg(msg);
            await fetchLeads();
          }}
          onOpenLeadDetail={(leadId) => {
            setSelectedLeadId(leadId);
            setLeadDetailTab('info');
          }}
          onError={(msg) => setErrorMsg(msg)}
        />
      )}

      {/* Modal / Dialog Chi tiết Lead & Chỉnh sửa Trực tiếp theo Phân quyền (Giao diện Gọn, Hiện đại) */}
      {selectedLead && (() => {
        const selectedHorizon = getB2bFollowUpHorizon(selectedLead);
        const selectedFraud = fraudByLeadId.get(selectedLead.id) || evaluateLeadFraudCriteria(selectedLead, leads, priceCheckAlerts);
        return (
          <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-2.5 sm:p-4 overflow-hidden">
            <div className="bg-white w-full max-w-4xl max-h-[90vh] rounded-2xl shadow-xl border border-slate-200 flex flex-col overflow-hidden text-sm animate-in fade-in zoom-in-95 duration-150">
              {/* Header Gọn Sạch */}
              <div className="px-5 py-3.5 border-b border-slate-200 bg-white shrink-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 font-mono text-xs font-bold text-[#1E3A8A]"
                        title={`Mã hồ sơ đầy đủ: ${selectedLead.leadCode}`}
                      >
                        {formatCompactLeadCode(selectedLead.leadCode)}
                      </span>
                      <h2 className="font-display text-base sm:text-lg font-bold text-slate-900 truncate max-w-[440px]">
                        {selectedLead.companyName || selectedLead.contactName || selectedLead.phone}
                      </h2>
                      <span
                        className={`px-2.5 py-0.5 rounded-full border text-xs shrink-0 ${
                          STATUS_BADGE_STYLES[selectedLead.pipelineStatus]
                        }`}
                      >
                        {PIPELINE_STATUS_LABELS[selectedLead.pipelineStatus]}
                      </span>
                      {selectedFraud.isCustomerWonVIP && (
                        <span className="px-2.5 py-0.5 rounded-full bg-gradient-to-r from-amber-500 to-yellow-500 text-slate-950 text-xs font-extrabold inline-flex items-center gap-1 shadow-2xs shrink-0">
                          <Crown className="w-3.5 h-3.5 fill-slate-950 text-slate-950" />
                          <span>👑 VIP · ĐÃ TỪNG MUA THÀNH CÔNG</span>
                        </span>
                      )}
                      {selectedLead.spamStatus !== 'NONE' && (
                        <span
                          title={selectedLead.spamReason ? `Lý do: ${selectedLead.spamReason}` : undefined}
                          className="px-2 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold inline-flex items-center gap-1 shrink-0"
                        >
                          <Ban className="w-3 h-3" />
                          <span>
                            {selectedLead.spamStatus === 'CONFIRMED' ? 'Đã loại trừ Spam' : 'Spam chờ duyệt'}
                            {selectedLead.spamReason ? ` (${selectedLead.spamReason})` : ''}
                          </span>
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      {selectedLead.projectName && (
                        <span className="font-medium text-slate-700 truncate max-w-[300px]">
                          Dự án: {selectedLead.projectName}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 font-mono font-semibold text-slate-700">
                        <Phone className="w-3 h-3 text-slate-400" />
                        {selectedLead.phone}
                      </span>
                      <span>
                        Nguồn:{' '}
                        <strong className="text-slate-700 font-medium">
                          {selectedLead.tracking?.marketingSource ||
                            CONTACT_CHANNEL_LABELS[selectedLead.contactChannel] ||
                            selectedLead.contactChannel}
                        </strong>
                      </span>
                      <span>
                        Phụ trách:{' '}
                        <strong className="text-slate-700 font-medium">
                          {selectedLead.assignedSalesName || 'Chưa phân bổ'}
                        </strong>
                      </span>
                      {selectedFraud.transferredFromSalesName && (
                        <span className="px-2 py-0.5 rounded bg-indigo-50 border border-indigo-200 text-indigo-800 font-semibold">
                          Chuyển từ {selectedFraud.transferredFromSalesName}
                          {selectedFraud.transferCount > 1 ? ` (${selectedFraud.transferCount} lần)` : ''}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {canEditSelectedLead && !selectedLead.receivedConfirmedAt && (
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => void handleConfirmReceive(selectedLead)}
                        className="h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 shadow-2xs transition"
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                        <span>Xác nhận tiếp nhận</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => closeLeadDetail()}
                      aria-label="Đóng chi tiết Lead"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Thanh Tab gọn nhẹ */}
              <div
                role="tablist"
                aria-label="Chi tiết hồ sơ Lead"
                className="flex items-center justify-between px-5 border-b border-slate-200 bg-slate-50/60 shrink-0 gap-2 overflow-x-auto"
              >
                <div className="flex items-center gap-1">
                  {[
                    {
                      id: 'info' as const,
                      label: 'Thông tin chung',
                      icon: canEditSelectedLead ? Pencil : Info,
                      count: null,
                    },
                    ...(canEditSelectedLead ||
                    canReassign ||
                    (selectedLead.spamStatus !== 'NONE' &&
                      ['SALES_LEAD', 'MKT_LEAD', 'BOD', 'ADMIN'].includes(
                        user?.roleCode || ''
                      ))
                      ? [
                          {
                            id: 'pipeline' as const,
                            label: 'Tiến độ & Phối hợp',
                            icon: Activity,
                            count: null,
                          },
                        ]
                      : []),
                    ...(canUploadAttachment && !selectedLead.isAnonymized
                      ? [
                          {
                            id: 'attachments' as const,
                            label: 'Tệp đính kèm',
                            icon: Paperclip,
                            count: selectedLead.attachments?.length || 0,
                          },
                        ]
                      : []),
                    {
                      id: 'activity' as const,
                      label: 'Lịch sử',
                      icon: History,
                      count: selectedLead.activities?.length || 0,
                    },
                  ].map((tab) => {
                    const isActive = leadDetailTab === tab.id;
                    const TabIcon = tab.icon;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        onClick={() => setLeadDetailTab(tab.id)}
                        className={`relative inline-flex items-center gap-1.5 px-3 py-2.5 text-xs sm:text-sm font-semibold whitespace-nowrap transition ${
                          isActive ? 'text-[#1E3A8A]' : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <TabIcon className="w-3.5 h-3.5" />
                        <span>{tab.label}</span>
                        {tab.count !== null && tab.count > 0 && (
                          <span
                            className={`px-1.5 py-0.2 rounded-full text-[11px] font-semibold ${
                              isActive ? 'bg-blue-100 text-[#1E3A8A]' : 'bg-slate-200/70 text-slate-600'
                            }`}
                          >
                            {tab.count}
                          </span>
                        )}
                        {isActive && (
                          <span className="absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-[#1E3A8A]" />
                        )}
                      </button>
                    );
                  })}
                </div>

                <span className="hidden sm:inline-flex items-center gap-1 text-xs text-slate-500">
                  {canEditSelectedLead ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      <span>Cho phép sửa trực tiếp</span>
                    </>
                  ) : (
                    <span>Chế độ chỉ xem ({user?.roleName})</span>
                  )}
                </span>
              </div>

              {/* Nội dung cuộn */}
              <div
                onInputCapture={() => {
                  isDetailDirtyRef.current = true;
                }}
                onChangeCapture={() => {
                  isDetailDirtyRef.current = true;
                }}
                className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3.5 bg-slate-50/40"
              >
                {/* Hiển thị thông báo lỗi / thành công ngay trong Modal để người dùng thấy tức thì */}
                {errorMsg && (
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center justify-between gap-2">
                    <span>{errorMsg}</span>
                    <button
                      type="button"
                      onClick={() => setErrorMsg(null)}
                      className="text-rose-500 hover:text-rose-800 font-bold"
                    >
                      ×
                    </button>
                  </div>
                )}
                {feedbackMsg && (
                  <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center justify-between gap-2">
                    <span>{feedbackMsg}</span>
                    <button
                      type="button"
                      onClick={() => setFeedbackMsg(null)}
                      className="text-emerald-600 hover:text-emerald-900 font-bold"
                    >
                      ×
                    </button>
                  </div>
                )}

                {/* TAB 1: THÔNG TIN CHUNG (GỌN, RÕ RÀNG, KHÔNG RỐI) */}
                {leadDetailTab === 'info' && (
                  <div className="space-y-3.5 text-sm">
                    {/* 0. Khung Lịch Sử Khách Liên Hệ Lại — Tách biệt 2 kiểu: (1) Khách đã mua quay lại mua tiếp vs (2) Khách từng thất bại / bỏ trống thời gian nay Inbox hỏi lại */}
                    {(() => {
                      const cleanSelPhone = (selectedLead.phone || '').replace(/\D/g, '');
                      const normSelEmail = (selectedLead.email || '').trim().toLowerCase();
                      const normSelComp = (selectedLead.companyName || '').trim().toLowerCase();

                      const relatedHistoryLeads = leads.filter((other) => {
                        if (other.id === selectedLead.id || other.spamStatus !== 'NONE') return false;
                        const otherPhone = (other.phone || '').replace(/\D/g, '');
                        const phoneHit =
                          cleanSelPhone.length >= 8 &&
                          !cleanSelPhone.includes('*') &&
                          otherPhone === cleanSelPhone;
                        const emailHit =
                          normSelEmail.length >= 5 &&
                          !normSelEmail.includes('*') &&
                          (other.email || '').trim().toLowerCase() === normSelEmail;
                        const compHit =
                          normSelComp.length >= 5 &&
                          (other.companyName || '').trim().toLowerCase() === normSelComp;
                        return phoneHit || emailHit || compHit;
                      });

                      const mergeOrReopenActivities = (selectedLead.activities || []).filter(
                        (a) =>
                          a.actionType === 'reopen_lead' ||
                          Boolean(
                            a.noteContent &&
                              (a.noteContent.includes('[KHÁCH CŨ QUAY LẠI]') ||
                                a.noteContent.includes('[KHÁCH QUAY LẠI HỎI MUA]') ||
                                a.noteContent.includes('[TRÙNG SĐT')),
                          ),
                      );

                      if (
                        relatedHistoryLeads.length === 0 &&
                        selectedFraud.duplicateScenario === 'NONE' &&
                        mergeOrReopenActivities.length === 0
                      ) {
                        return null;
                      }

                      const formatStatusTextVi = (raw: string | null | undefined): string => {
                        if (!raw) return '';
                        return raw
                          .replace(/\bnew_lead\b/g, 'Vừa nhận thông tin')
                          .replace(/\bquoting\b/g, 'Đang soạn báo giá')
                          .replace(/\bquote_sent\b/g, 'Đã gửi báo giá')
                          .replace(/\bwon\b/g, 'Chốt thành công')
                          .replace(/\blost\b/g, 'Thất bại');
                      };

                      const hasWonBefore =
                        selectedFraud.duplicateScenario === 'SCENARIO_2_WON_RETURNING' ||
                        relatedHistoryLeads.some((h) => h.pipelineStatus === 'won') ||
                        mergeOrReopenActivities.some(
                          (a) =>
                            a.fromStatus === 'won' ||
                            Boolean(a.noteContent && a.noteContent.includes('[KHÁCH CŨ QUAY LẠI]')),
                        );

                      // KIỂU 1: KHÁCH ĐÃ MUA (CHỐT THÀNH CÔNG) — NAY QUAY LẠI MUA TIẾP
                      if (hasWonBefore) {
                        const wonHistoryLeads = relatedHistoryLeads.filter(
                          (h) => h.pipelineStatus === 'won',
                        );
                        return (
                          <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-50 via-teal-50/70 to-emerald-50/90 border border-emerald-300 text-emerald-950 space-y-3 shadow-2xs">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="px-3 py-1 rounded-lg bg-emerald-600 text-white text-xs font-extrabold tracking-wide shadow-2xs inline-flex items-center gap-1.5">
                                  <span>💎 KHÁCH ĐÃ MUA — QUAY LẠI MUA TIẾP</span>
                                </span>
                                <span className="px-2.5 py-0.5 rounded-full bg-white/90 border border-emerald-300 text-emerald-800 text-[11px] font-bold">
                                  Khách hàng thân thiết · SĐT {selectedLead.phone}
                                </span>
                              </div>
                              <span className="text-[11px] font-semibold text-emerald-800">
                                Đã từng chốt hợp đồng thành công trước đây
                              </span>
                            </div>

                            {/* Khối so sánh: Đơn hàng đã mua trước đây -> Lần liên hệ mua tiếp hiện tại */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                              <div className="p-3 rounded-xl bg-white border border-emerald-200 space-y-1">
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold">
                                    ✅ Lần trước: Đã chốt thành công
                                  </span>
                                  <span className="text-slate-500 font-medium">
                                    {wonHistoryLeads[0]
                                      ? new Date(wonHistoryLeads[0].contactedAt).toLocaleDateString('vi-VN')
                                      : 'Hồ sơ đã mua'}
                                  </span>
                                </div>
                                <p className="text-xs font-bold text-slate-900">
                                  {wonHistoryLeads[0]
                                    ? `${wonHistoryLeads[0].leadCode} · ${wonHistoryLeads[0].projectName || wonHistoryLeads[0].companyName || selectedLead.companyName || selectedLead.phone}`
                                    : `${selectedLead.companyName || selectedLead.contactName || selectedLead.phone}`}
                                </p>
                                <p className="text-[11px] text-slate-600">
                                  Sản phẩm đã mua:{' '}
                                  <strong className="text-emerald-800">
                                    {(wonHistoryLeads[0]?.products?.length
                                      ? wonHistoryLeads[0].products
                                      : selectedLead.products
                                    )
                                      .map((p) => p.productName)
                                      .join(', ') || 'Màn hình LED / Bảng điện tử'}
                                  </strong>
                                </p>
                              </div>

                              <div className="p-3 rounded-xl bg-white border border-teal-200 space-y-1">
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="px-2 py-0.5 rounded bg-teal-600 text-white font-bold">
                                    🚀 Lần này: Liên hệ mua tiếp dự án mới
                                  </span>
                                  <span className="text-slate-500 font-medium">
                                    {mergeOrReopenActivities[0]
                                      ? new Date(mergeOrReopenActivities[0].createdAt).toLocaleString('vi-VN')
                                      : new Date(selectedLead.contactedAt).toLocaleString('vi-VN')}
                                  </span>
                                </div>
                                <p className="text-xs font-semibold text-slate-800">
                                  {mergeOrReopenActivities[0]?.noteContent
                                    ? formatStatusTextVi(mergeOrReopenActivities[0].noteContent)
                                    : `Khách cũ liên hệ đặt mua thêm dự án: ${selectedLead.projectName || 'Dự án mới'}`}
                                </p>
                                <p className="text-[11px] text-teal-800 font-semibold">
                                  Trạng thái hiện tại: {PIPELINE_STATUS_LABELS[selectedLead.pipelineStatus]}
                                </p>
                              </div>
                            </div>

                            {relatedHistoryLeads.length > 0 && (
                              <div className="space-y-1.5 pt-1">
                                {relatedHistoryLeads.map((hist) => (
                                  <div
                                    key={hist.id}
                                    className="p-2.5 rounded-xl bg-white/95 border border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                                  >
                                    <div className="text-xs text-slate-700 min-w-0">
                                      <span className="font-mono font-bold text-emerald-800 mr-2" title={hist.leadCode}>
                                        {formatCompactLeadCode(hist.leadCode)}
                                      </span>
                                      <strong>{hist.companyName || hist.contactName || hist.phone}</strong>
                                      {hist.projectName ? ` · Dự án cũ: ${hist.projectName}` : ''}
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                      {canEditSelectedLead && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            if (hist.companyName) setEditCompanyName(hist.companyName);
                                            if (hist.contactName) setEditContactName(hist.contactName);
                                            if (hist.email) setEditEmail(hist.email);
                                            if (hist.installationAddress)
                                              setEditAddress(hist.installationAddress);
                                            setFeedbackMsg(
                                              `Đã kế thừa thông tin công ty & địa chỉ từ hồ sơ khách cũ ${hist.leadCode}.`,
                                            );
                                          }}
                                          className="h-7 px-2.5 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-900 text-xs font-bold transition"
                                        >
                                          ⚡ Kế thừa thông tin khách cũ
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setSelectedLeadId(hist.id);
                                          setLeadDetailTab('info');
                                        }}
                                        className="h-7 px-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold transition"
                                      >
                                        Xem đơn cũ {formatCompactLeadCode(hist.leadCode)} →
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      }

                      // KIỂU 2: KHÁCH TỪNG THẤT BẠI (CHƯA CHỐT) HOẶC BỎ TRỐNG THỜI GIAN — SAU ĐÓ INBOX / LIÊN HỆ HỎI LẠI
                      const latestReopenAct = mergeOrReopenActivities[0] || null;
                      const priorHistLead = relatedHistoryLeads[0] || null;
                      const priorLostReason =
                        selectedLead.lostReason ||
                        latestReopenAct?.reason ||
                        priorHistLead?.lostReason ||
                        null;

                      return (
                        <div className="p-4 rounded-2xl bg-amber-50/75 border border-amber-300 text-slate-900 space-y-3 shadow-2xs">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="px-3 py-1 rounded-lg bg-amber-600 text-white text-xs font-extrabold tracking-wide shadow-2xs">
                                🔄 KHÁCH TỪNG CHƯA CHỐT / GIÁN ĐOẠN — NAY INBOX HỎI LẠI
                              </span>
                              <span className="px-2.5 py-0.5 rounded-full bg-white border border-amber-300 text-amber-900 text-[11px] font-bold">
                                Gộp 1 SĐT duy nhất: {selectedLead.phone}
                              </span>
                            </div>
                          </div>

                          {/* Tiến trình 2 bước rõ ràng: [1. Lần trước: Thất bại / Bỏ trống thời gian] ---> [2. Sau đó: Inbox hỏi lại] */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                            {/* Bước 1: Trạng thái Thất bại trước đó hoặc Bỏ trống thông tin thời gian */}
                            <div className="p-3 rounded-xl bg-white border border-rose-200/90 space-y-1.5">
                              <div className="flex items-center justify-between gap-2 text-[11px]">
                                <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-200 font-bold">
                                  1. Lần trước: {priorLostReason ? 'Thất bại / Chưa chốt' : 'Tạm ngưng / Bỏ trống'}
                                </span>
                                <span className="text-slate-400 italic">
                                  {priorHistLead
                                    ? `Ngày hỏi cũ: ${new Date(priorHistLead.contactedAt).toLocaleDateString('vi-VN')}`
                                    : 'Thời gian trước: Bỏ trống / Gián đoạn'}
                                </span>
                              </div>
                              <p className="text-xs font-bold text-rose-800">
                                {priorLostReason
                                  ? `Lý do chưa chốt lần trước: ${priorLostReason}`
                                  : 'Khách từng hỏi thông tin nhưng bỏ trống một thời gian chưa chốt'}
                              </p>
                              {priorHistLead && (
                                <p className="text-[11px] text-slate-600 truncate">
                                  Hồ sơ cũ: <strong className="font-mono" title={priorHistLead.leadCode}>{formatCompactLeadCode(priorHistLead.leadCode)}</strong>
                                  {priorHistLead.projectName ? ` · ${priorHistLead.projectName}` : ''}
                                </p>
                              )}
                            </div>

                            {/* Bước 2: Sau đó khách Inbox / Liên hệ hỏi lại */}
                            <div className="p-3 rounded-xl bg-white border border-blue-200/90 space-y-1.5">
                              <div className="flex items-center justify-between gap-2 text-[11px]">
                                <span className="px-2 py-0.5 rounded bg-[#1E3A8A] text-white font-bold">
                                  2. Sau đó: Khách Inbox / Liên hệ hỏi lại
                                </span>
                                <span className="text-slate-600 font-semibold">
                                  {latestReopenAct
                                    ? new Date(latestReopenAct.createdAt).toLocaleString('vi-VN')
                                    : new Date(selectedLead.contactedAt).toLocaleString('vi-VN')}
                                </span>
                              </div>
                              <p className="text-xs font-semibold text-slate-800">
                                {latestReopenAct?.noteContent
                                  ? formatStatusTextVi(latestReopenAct.noteContent)
                                  : 'Khách hàng liên hệ lại tiếp tục hỏi mua dự án trên cùng số điện thoại.'}
                              </p>
                              <p className="text-[11px] text-[#1E3A8A] font-bold">
                                Tiến độ hiện tại: {PIPELINE_STATUS_LABELS[selectedLead.pipelineStatus]}
                              </p>
                            </div>
                          </div>

                          {relatedHistoryLeads.length > 0 && (
                            <div className="space-y-1.5">
                              {relatedHistoryLeads.map((hist) => (
                                <div
                                  key={hist.id}
                                  className="p-2.5 rounded-xl bg-white border border-slate-200/90 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                                >
                                  <div className="text-xs text-slate-700 min-w-0">
                                    <span className="font-mono font-bold text-[#1E3A8A] mr-2" title={hist.leadCode}>
                                      {formatCompactLeadCode(hist.leadCode)}
                                    </span>
                                    <span
                                      className={`px-2 py-0.5 rounded border text-[10px] font-bold mr-2 ${
                                        STATUS_BADGE_STYLES[hist.pipelineStatus]
                                      }`}
                                    >
                                      {PIPELINE_STATUS_LABELS[hist.pipelineStatus]}
                                    </span>
                                    <strong>{hist.companyName || hist.contactName || hist.phone}</strong>
                                    {hist.projectName ? ` · Dự án: ${hist.projectName}` : ''}
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {canEditSelectedLead && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (hist.companyName) setEditCompanyName(hist.companyName);
                                          if (hist.contactName) setEditContactName(hist.contactName);
                                          if (hist.projectName) setEditProjectName(hist.projectName);
                                          if (hist.email) setEditEmail(hist.email);
                                          if (hist.installationAddress)
                                            setEditAddress(hist.installationAddress);
                                          if (hist.products.length > 0) {
                                            setEditProductIds(hist.products.map((p) => p.id));
                                          }
                                          setFeedbackMsg(
                                            `Đã kế thừa thông tin khách hàng từ hồ sơ cũ ${hist.leadCode}.`,
                                          );
                                        }}
                                        className="h-7 px-2.5 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 text-xs font-bold transition"
                                      >
                                        ⚡ Kế thừa thông tin cũ
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSelectedLeadId(hist.id);
                                        setLeadDetailTab('info');
                                      }}
                                      className="h-7 px-2.5 rounded-lg bg-[#1E3A8A] hover:bg-blue-900 text-white text-xs font-bold transition"
                                    >
                                      Xem hồ sơ {formatCompactLeadCode(hist.leadCode)} →
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {canEditSelectedLead ? (
                      <form onSubmit={(e) => void handleUpdateLeadInfo(e)} className="space-y-3.5">
                        {/* 1. Khối Thông tin Khách hàng & Công trình (Lưới 3 cột gọn gàng) */}
                        <div className="p-4 rounded-xl border border-slate-200/90 bg-white space-y-3">
                          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                            <span className="font-bold text-slate-900 text-sm">
                              1. Thông tin Khách hàng &amp; Địa điểm Công trình
                            </span>
                            <span className="text-[11px] text-slate-400">
                              Phiên bản v{selectedLead.version}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">
                                Số điện thoại (10 số) *
                              </label>
                              <input
                                type="tel"
                                required
                                maxLength={10}
                                inputMode="numeric"
                                pattern="0[0-9]{9}"
                                value={editPhone}
                                onChange={(e) => setEditPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                                className="w-full h-9 px-3 rounded-lg border border-slate-200 font-mono font-semibold text-[#1E3A8A] focus:outline-none focus:border-[#1E3A8A]"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">
                                Người liên hệ
                              </label>
                              <input
                                type="text"
                                value={editContactName}
                                onChange={(e) => setEditContactName(e.target.value)}
                                placeholder="Họ tên khách hàng..."
                                className="w-full h-9 px-3 rounded-lg border border-slate-200 font-medium text-slate-900 focus:outline-none focus:border-[#1E3A8A]"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">
                                Email
                              </label>
                              <input
                                type="email"
                                value={editEmail}
                                onChange={(e) => setEditEmail(e.target.value)}
                                placeholder="email@congty.vn"
                                className="w-full h-9 px-3 rounded-lg border border-slate-200 text-slate-800 focus:outline-none focus:border-[#1E3A8A]"
                              />
                            </div>

                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">
                                Đơn vị / Công ty
                              </label>
                              <input
                                type="text"
                                value={editCompanyName}
                                onChange={(e) => setEditCompanyName(e.target.value)}
                                placeholder="Tên doanh nghiệp / đơn vị..."
                                className="w-full h-9 px-3 rounded-lg border border-slate-200 font-medium text-slate-900 focus:outline-none focus:border-[#1E3A8A]"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">
                                Tên công trình / Dự án cụ thể
                              </label>
                              <input
                                type="text"
                                value={editProjectName}
                                onChange={(e) => setEditProjectName(e.target.value)}
                                placeholder="VD: Hội trường UBND Q.1, Showroom Toyota Thủ Đức..."
                                className="w-full h-9 px-3 rounded-lg border border-slate-200 font-medium text-slate-900 focus:outline-none focus:border-[#1E3A8A]"
                              />
                              <span className="block text-[10.5px] text-slate-400 mt-0.5">
                                Tên công trình dùng kiểm tra trùng dự án; chủng loại SP tick chọn ở khối bên dưới.
                              </span>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">
                                Nguồn dự án *
                              </label>
                              <select
                                value={
                                  !editSelfSource ||
                                  editSelfSource === 'Nhập tay' ||
                                  editSelfSource === 'Chưa xác định'
                                    ? selectedLead.contactChannel === 'zalo'
                                      ? 'Zalo'
                                      : selectedLead.contactChannel === 'form_web'
                                        ? 'Website Toàn Trung'
                                        : selectedLead.contactChannel === 'google_lead_form'
                                          ? 'Google Ads'
                                          : 'SĐT / Hotline'
                                    : editSelfSource
                                }
                                onChange={(e) => setEditSelfSource(e.target.value)}
                                className="w-full h-9 px-2.5 rounded-lg border border-slate-200 bg-white font-semibold text-slate-800 focus:outline-none focus:border-[#1E3A8A]"
                              >
                                <option value="SĐT / Hotline">SĐT / Hotline</option>
                                <option value="Zalo">Zalo</option>
                                <option value="Website Toàn Trung">Website Toàn Trung</option>
                                <option value="Google Ads">Google Ads</option>
                                <option value="Fanpage Facebook">Fanpage Facebook</option>
                                <option value="Email Dự án">Email Dự án</option>
                                <option value="Khách cũ / Giới thiệu">Khách cũ / Giới thiệu</option>
                                <option value="Hồ sơ Đấu thầu">Hồ sơ Đấu thầu</option>
                              </select>
                            </div>

                            <VietnamAddressFields
                              province={editProvince}
                              onProvinceChange={setEditProvince}
                              district={editDistrict}
                              onDistrictChange={setEditDistrict}
                              ward={editWard}
                              onWardChange={setEditWard}
                              installationAddress={editAddress}
                              onInstallationAddressChange={setEditAddress}
                            />
                          </div>
                        </div>

                        {/* 2. Khối Sản phẩm quan tâm (Bấm mục nào sổ mục đó ra bên phải theo đúng chuẩn Ảnh 5) */}
                        <div className="p-4 rounded-xl border border-slate-200/90 bg-white space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Layers className="w-4 h-4 text-[#1E3A8A]" />
                              <span className="font-bold text-slate-900 text-sm">
                                2. Sản phẩm quan tâm *
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              {user && hasBaPermission(user.roleCode, 'SYSTEM_USER_ADMIN') && (
                                <button
                                  type="button"
                                  onClick={() => setShowProductCatalogModal(true)}
                                  className="px-2 py-0.5 rounded-md border border-blue-200 bg-white hover:bg-blue-50 text-[#1E3A8A] text-[11px] font-bold transition"
                                >
                                  + Quản lý danh mục
                                </button>
                              )}
                              <span className="px-2.5 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-[#1E3A8A] text-xs font-bold">
                                Đã chọn {editProductIds.length + editCustomServiceItems.length} sản phẩm
                              </span>
                            </div>
                          </div>

                          {/* Thanh tìm kiếm sản phẩm + Các thẻ sản phẩm đã chọn */}
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                            <div className="relative w-full sm:w-80 shrink-0">
                              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                              <input
                                type="text"
                                value={editProductSearch}
                                onChange={(e) => setEditProductSearch(e.target.value)}
                                placeholder="Tìm sản phẩm (ví dụ: Màn hình LED, Bảng điện tử...)"
                                className="w-full h-8 pl-8 pr-7 rounded-lg border border-slate-200 bg-slate-50/70 focus:bg-white text-xs text-slate-800 focus:outline-none focus:border-[#1E3A8A]"
                              />
                              {editProductSearch && (
                                <button
                                  type="button"
                                  onClick={() => setEditProductSearch('')}
                                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 text-xs font-bold"
                                >
                                  ×
                                </button>
                              )}
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5">
                              {products
                                .filter((p) => editProductIds.includes(p.id))
                                .map((sel) => (
                                  <span
                                    key={sel.id}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-50 border border-blue-200 text-[#1E3A8A] text-xs font-semibold"
                                  >
                                    <span>
                                      {sel.productName
                                        .replace(/^Khác\s*\(([^)]+)\)$/i, '$1 khác')
                                        .replace(/\s*\([^)]*\)/g, '')
                                        .trim()}
                                    </span>
                                    {editProductIds.length > 1 && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setEditProductIds((prev) =>
                                            prev.filter((id) => id !== sel.id),
                                          )
                                        }
                                        className="hover:text-rose-600 ml-0.5 font-bold"
                                        title="Bỏ chọn sản phẩm này"
                                      >
                                        ×
                                      </button>
                                    )}
                                  </span>
                                ))}
                              {editCustomServiceItems.map((item) => (
                                <span
                                  key={item}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-300 text-amber-900 text-xs font-semibold"
                                >
                                  <span>{item}</span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setEditCustomServiceItems((prev) =>
                                        prev.filter((x) => x !== item),
                                      )
                                    }
                                    className="hover:text-rose-600 ml-0.5 font-bold"
                                    title="Xóa mục này"
                                  >
                                    ×
                                  </button>
                                </span>
                              ))}
                            </div>
                          </div>

                          {/* Bố cục 2 cột: Cột trái chọn nhóm -> Cột phải sổ sản phẩm của nhóm (Hỗ trợ chọn nhiều SP cùng nhóm) */}
                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-start pt-1">
                            {(() => {
                              const getGroupKey = (p: ProductCatalogDto): string => {
                                if (p.categoryGroup && p.categoryGroup.trim()) return p.categoryGroup.trim();
                                if (p.category === 'MAN_HINH_LED') return 'led_screen';
                                if (p.category === 'BANG_DIEN_TU') return 'electronic_board';
                                return 'other';
                              };
                              const defaultLabels: Record<string, string> = {
                                led_screen: 'Màn hình LED',
                                electronic_board: 'Bảng điện tử & Hiển thị số',
                                other: 'Dịch vụ / Nhu cầu khác',
                              };
                              const groupMap = new Map<
                                string,
                                { groupKey: string; title: string; count: number; selectedCount: number }
                              >();
                              const coreOrder = ['led_screen', 'electronic_board', 'other'];
                              for (const k of coreOrder) {
                                groupMap.set(k, {
                                  groupKey: k,
                                  title: defaultLabels[k] || k,
                                  count: 0,
                                  selectedCount: 0,
                                });
                              }
                              for (const p of products) {
                                const k = getGroupKey(p);
                                const entry = groupMap.get(k) || {
                                  groupKey: k,
                                  title: p.categoryGroupLabel || defaultLabels[k] || k,
                                  count: 0,
                                  selectedCount: 0,
                                };
                                if (p.categoryGroupLabel && p.categoryGroupLabel.trim()) {
                                  entry.title = p.categoryGroupLabel.trim();
                                }
                                entry.count += 1;
                                if (editProductIds.includes(p.id)) entry.selectedCount += 1;
                                groupMap.set(k, entry);
                              }
                              const groupList = Array.from(groupMap.values()).filter(
                                (g) => g.count > 0 || coreOrder.includes(g.groupKey),
                              );

                              const filteredProducts = products.filter((p) => {
                                const q = editProductSearch.trim().toLowerCase();
                                if (q) {
                                  return p.productName.toLowerCase().includes(q);
                                }
                                return getGroupKey(p) === editActiveProductGroup;
                              });

                              return (
                                <>
                                  <div className="sm:col-span-4 flex flex-col gap-1">
                                    {groupList.map((cat) => {
                                      const isActive =
                                        !editProductSearch.trim() &&
                                        editActiveProductGroup === cat.groupKey;
                                      return (
                                        <button
                                          key={cat.groupKey}
                                          type="button"
                                          onClick={() => {
                                            setEditProductSearch('');
                                            setEditActiveProductGroup(cat.groupKey);
                                          }}
                                          className={`w-full text-left px-3 py-2 rounded-lg text-xs transition flex items-center justify-between gap-1.5 ${
                                            isActive
                                              ? 'bg-blue-50/90 text-[#1E3A8A] font-bold border-l-4 border-l-[#2563EB]'
                                              : 'text-slate-700 hover:bg-slate-50 font-medium'
                                          }`}
                                        >
                                          <span className="truncate">{cat.title}</span>
                                          <span className="inline-flex items-center gap-1 shrink-0">
                                            {cat.selectedCount > 0 && (
                                              <span className="px-1.5 py-0.5 rounded-full bg-[#2563EB] text-white text-[10px] font-bold leading-none">
                                                {cat.selectedCount}
                                              </span>
                                            )}
                                            <span className="text-[11px] text-slate-400">
                                              ({cat.count})
                                            </span>
                                          </span>
                                        </button>
                                      );
                                    })}
                                  </div>

                                  <div className="sm:col-span-8 p-3 rounded-xl border border-slate-200/90 bg-slate-50/40 space-y-2.5">
                                    <div className="text-[11px] text-slate-500">
                                      Tick chọn nhiều sản phẩm cùng lúc (trong cùng nhóm hoặc khác nhóm).
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                      {filteredProducts.map((p) => {
                                        const checked = editProductIds.includes(p.id);
                                        const cleanName = p.productName
                                          .replace(/^Khác\s*\(([^)]+)\)$/i, '$1 khác')
                                          .replace(/\s*\([^)]*\)/g, '')
                                          .trim();
                                        return (
                                          <label
                                            key={p.id}
                                            className={`flex items-center gap-2.5 p-2 rounded-lg border text-xs cursor-pointer select-none transition ${
                                              checked
                                                ? 'bg-blue-50/80 border-blue-300 text-[#1E3A8A] font-semibold'
                                                : 'bg-white border-slate-200/80 text-slate-700 hover:border-slate-300'
                                            }`}
                                          >
                                            <input
                                              type="checkbox"
                                              checked={checked}
                                              onChange={() => {
                                                setEditProductIds((prev) =>
                                                  prev.includes(p.id)
                                                    ? prev.length > 1 || editCustomServiceItems.length > 0
                                                      ? prev.filter((id) => id !== p.id)
                                                      : prev
                                                    : [...prev, p.id],
                                                );
                                              }}
                                              className="w-4 h-4 accent-[#2563EB] rounded cursor-pointer"
                                            />
                                            <span className="truncate">{cleanName}</span>
                                          </label>
                                        );
                                      })}
                                    </div>

                                    {(editActiveProductGroup === 'other' ||
                                      editProductSearch.trim() !== '') && (
                                <div className="pt-2 border-t border-slate-200/80 flex gap-1.5">
                                  <input
                                    type="text"
                                    value={editCustomServiceDraft}
                                    onChange={(e) => setEditCustomServiceDraft(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                                        const trimmed = editCustomServiceDraft.trim();
                                        if (!trimmed) return;
                                        setEditCustomServiceItems((prev) =>
                                          prev.includes(trimmed) ? prev : [...prev, trimmed],
                                        );
                                        const khacProd = products.find(
                                          (p) => p.category === 'KHAC',
                                        );
                                        if (khacProd) {
                                          setEditProductIds((prev) =>
                                            prev.includes(khacProd.id)
                                              ? prev
                                              : [...prev, khacProd.id],
                                          );
                                        }
                                        setEditCustomServiceDraft('');
                                      }
                                    }}
                                    placeholder="Nhập thêm dịch vụ / nhu cầu khác..."
                                    className="flex-1 min-w-0 h-8 px-2.5 rounded-lg border border-amber-300 bg-white text-xs text-slate-800 focus:border-[#1E3A8A] outline-none"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const trimmed = editCustomServiceDraft.trim();
                                      if (!trimmed) return;
                                      setEditCustomServiceItems((prev) =>
                                        prev.includes(trimmed) ? prev : [...prev, trimmed],
                                      );
                                      const khacProd = products.find(
                                        (p) => p.category === 'KHAC',
                                      );
                                      if (khacProd) {
                                        setEditProductIds((prev) =>
                                          prev.includes(khacProd.id)
                                            ? prev
                                            : [...prev, khacProd.id],
                                        );
                                      }
                                      setEditCustomServiceDraft('');
                                    }}
                                    className="h-8 px-3 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold inline-flex items-center gap-1 shrink-0 transition"
                                  >
                                    <span>+ Thêm</span>
                                  </button>
                                </div>
                              )}
                            </div>
                                </>
                              );
                            })()}
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">
                                Ghi chú kích thước / cấu hình kỹ thuật
                              </label>
                              <input
                                type="text"
                                value={editCustomProductNote}
                                onChange={(e) => setEditCustomProductNote(e.target.value)}
                                placeholder="VD: Kích thước 4m x 2.5m, lắp hội trường..."
                                className="w-full h-9 px-3 rounded-lg border border-slate-200 text-slate-800 text-xs focus:outline-none focus:border-[#1E3A8A]"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">
                                Ghi chú tư vấn
                              </label>
                              <input
                                type="text"
                                value={editUpdateNote}
                                onChange={(e) => setEditUpdateNote(e.target.value)}
                                placeholder="VD: Đã gửi phương án sơ bộ qua Zalo..."
                                className="w-full h-9 px-3 rounded-lg border border-slate-200 text-slate-800 text-xs focus:outline-none focus:border-[#1E3A8A]"
                              />
                            </div>
                          </div>
                        </div>

                        {/* Thanh Lưu cố định gọn gàng */}
                        <div className="flex items-center justify-end gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setSelectedLeadId(null)}
                            className="h-9 px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-semibold transition"
                          >
                            Đóng
                          </button>
                          <button
                            type="submit"
                            disabled={submitting}
                            className="h-9 px-5 rounded-xl bg-[#1E3A8A] hover:bg-blue-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 shadow-2xs transition"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            <span>
                              {submitting ? 'Đang lưu...' : 'Lưu cập nhật'}
                            </span>
                          </button>
                        </div>
                      </form>
                    ) : (
                      /* Chế độ Chỉ xem gọn gàng (UC01 3.2: Đặt nhóm Nguồn, Chiến dịch, Thời gian, Link đổ về, Thiết bị, Địa chỉ ở đầu cho Marketing & Ads) */
                      <div className="space-y-3.5">
                        <div className="p-4 rounded-xl border border-indigo-200 bg-indigo-50/40 space-y-2.5">
                          <div className="flex items-center justify-between border-b border-indigo-100 pb-2">
                            <span className="font-bold text-[#1E3A8A] text-sm">
                              1. Thông tin Nguồn, Chiến dịch, Thiết bị &amp; Địa chỉ (UC01 3.2)
                            </span>
                            <span className="px-2 py-0.5 rounded bg-white border border-emerald-200 text-[11px] font-semibold text-emerald-800">
                              Website: {selectedLead.sourceWebsite || 'Chưa xác định website'}
                            </span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs text-slate-700">
                            <div className="p-2.5 rounded-lg bg-white border border-slate-200/80">
                              <span className="text-slate-500 block">Website tạo Lead:</span>
                              <strong className="text-emerald-800">
                                {selectedLead.sourceWebsite || 'Chưa xác định website'}
                              </strong>
                            </div>
                            <div className="p-2.5 rounded-lg bg-white border border-slate-200/80">
                              <span className="text-slate-500 block">Kênh liên hệ &amp; Cách tiếp nhận:</span>
                              <strong className="text-slate-900">
                                {CONTACT_CHANNEL_LABELS[selectedLead.contactChannel]} ·{' '}
                                {selectedLead.tracking?.intakeProvider === 'gmail_sync'
                                  ? `Gmail Auto-Sync${selectedLead.tracking.intakeAccountKey ? ` (${selectedLead.tracking.intakeAccountKey})` : ''}`
                                  : selectedLead.tracking?.intakeProvider === 'website_webhook'
                                    ? 'Website Webhook'
                                    : selectedLead.tracking?.intakeProvider === 'google_lead_form'
                                      ? 'Google Lead Form'
                                      : 'Nhập tay'}
                              </strong>
                            </div>
                            <div className="p-2.5 rounded-lg bg-white border border-slate-200/80">
                              <span className="text-slate-500 block">Nguồn Marketing / Chiến dịch:</span>
                              <strong className="text-[#1E3A8A]">
                                {selectedLead.tracking?.marketingSource || 'Chưa xác định'}
                                {selectedLead.tracking?.campaignName || selectedLead.tracking?.utmCampaign
                                  ? ` · ${selectedLead.tracking?.campaignName || selectedLead.tracking?.utmCampaign}`
                                  : ''}
                              </strong>
                            </div>
                            <div className="p-2.5 rounded-lg bg-white border border-slate-200/80 sm:col-span-2">
                              <span className="text-slate-500 block">Trang gửi yêu cầu (URL) &amp; GCLID:</span>
                              <strong className="font-mono text-slate-800 break-all">
                                {selectedLead.tracking?.landingPageUrl || 'Chưa ghi nhận URL trang gửi'}
                                {selectedLead.tracking?.gclid ? ` · GCLID: ${selectedLead.tracking.gclid}` : ''}
                              </strong>
                            </div>
                            <div className="p-2.5 rounded-lg bg-white border border-slate-200/80">
                              <span className="text-slate-500 block">Thời gian khách liên hệ:</span>
                              <strong className="font-mono text-slate-900">
                                {new Date(selectedLead.contactedAt).toLocaleString('vi-VN')}
                              </strong>
                            </div>
                            <div className="p-2.5 rounded-lg bg-white border border-slate-200/80 sm:col-span-3">
                              <span className="text-slate-500 block">Thiết bị &amp; Khu vực địa lý:</span>
                              <strong className="text-slate-900">
                                {selectedLead.tracking?.deviceType || 'Mọi thiết bị'} ·{' '}
                                {formatLeadLocationLabel(selectedLead)}
                              </strong>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                        <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-2.5">
                          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                            <span className="font-bold text-slate-900 text-sm">
                              Hồ sơ khách hàng
                            </span>
                            <span className="font-mono text-slate-400 text-xs">
                              {new Date(selectedLead.contactedAt).toLocaleDateString('vi-VN')}
                            </span>
                          </div>
                          <div className="space-y-1.5 text-xs text-slate-700">
                            <div className="flex items-center justify-between">
                              <span className="text-slate-500">Số điện thoại:</span>
                              <span className="font-mono font-bold text-[#1E3A8A]">
                                {selectedLead.phone}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-slate-500">Người liên hệ:</span>
                              <span className="font-semibold text-slate-900">
                                {selectedLead.contactName || 'Chưa cập nhật'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-slate-500">Đơn vị / Công ty:</span>
                              <span className="font-semibold text-slate-900">
                                {selectedLead.companyName || 'Chưa cập nhật'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-slate-500">Tên dự án:</span>
                              <span className="font-semibold text-[#1E3A8A]">
                                {selectedLead.projectName || 'Chưa có'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-slate-500 shrink-0">Địa chỉ lắp đặt:</span>
                              <span className="font-semibold text-right">
                                {formatLeadLocationLabel(selectedLead)}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-2.5">
                          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                            <span className="font-bold text-slate-900 text-sm">
                              Sản phẩm &amp; Theo dõi
                            </span>
                            {selectedHorizon.key !== 'none' && (
                              <span
                                className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${selectedHorizon.badgeClass}`}
                              >
                                {selectedHorizon.shortLabel}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {selectedLead.products.map((p) => (
                              <span
                                key={p.id}
                                className="px-2.5 py-1 rounded-md bg-blue-50 border border-blue-200/80 text-[#1E3A8A] font-medium text-xs"
                              >
                                {p.productName}
                              </span>
                            ))}
                          </div>
                          {selectedLead.customProductNote && (
                            <p className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-200/80">
                              {selectedLead.customProductNote}
                            </p>
                          )}
                        </div>
                      </div>
                      </div>
                    )}
                  </div>
                )}

              {/* TAB 2: TIẾN ĐỘ PIPELINE & PHỐI HỢP (Theo đúng chuẩn Ảnh 2) */}
              {leadDetailTab === 'pipeline' && (
                <div className="space-y-4 text-xs sm:text-sm">
                  {/* Thanh thông tin tóm tắt 4 cột trên cùng */}
                  <div className="p-3.5 rounded-2xl border border-slate-200 bg-white grid grid-cols-2 lg:grid-cols-4 gap-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-100 shadow-2xs">
                    <div className="flex items-center gap-2.5 pr-2">
                      <span className="w-9 h-9 rounded-full bg-blue-50 border border-blue-100 text-[#1E3A8A] grid place-items-center shrink-0">
                        <UserCheck className="w-4 h-4" />
                      </span>
                      <div className="min-w-0">
                        <span className="text-[11px] text-slate-500 block">
                          Nhân viên kinh doanh phụ trách
                        </span>
                        <strong className="text-slate-900 font-bold text-xs sm:text-sm truncate block">
                          {selectedLead.assignedSalesName || 'Chưa phân công'}
                        </strong>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 sm:pl-3 pt-2 sm:pt-0">
                      <span className="w-9 h-9 rounded-full bg-violet-50 border border-violet-100 text-violet-700 grid place-items-center shrink-0">
                        <Layers className="w-4 h-4" />
                      </span>
                      <div className="min-w-0">
                        <span className="text-[11px] text-slate-500 block mb-0.5">
                          Trạng thái Lead
                        </span>
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-full border text-xs ${
                            STATUS_BADGE_STYLES[selectedLead.pipelineStatus]
                          }`}
                        >
                          {PIPELINE_STATUS_LABELS[selectedLead.pipelineStatus]}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 lg:pl-3 pt-2 lg:pt-0">
                      <span className="w-9 h-9 rounded-full bg-slate-100 border border-slate-200 text-slate-700 grid place-items-center shrink-0">
                        <Calendar className="w-4 h-4" />
                      </span>
                      <div className="min-w-0">
                        <span className="text-[11px] text-slate-500 block">Ngày nhận</span>
                        <strong className="text-slate-900 font-bold text-xs sm:text-sm block">
                          {new Date(selectedLead.contactedAt).toLocaleDateString('vi-VN', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                          })}{' '}
                          {new Date(selectedLead.contactedAt).toLocaleTimeString('vi-VN', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </strong>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 sm:pl-3 pt-2 lg:pt-0">
                      <span className="w-9 h-9 rounded-full bg-amber-50 border border-amber-200 text-amber-600 grid place-items-center shrink-0">
                        <Star className="w-4 h-4" />
                      </span>
                      <div className="min-w-0">
                        <span className="text-[11px] text-slate-500 block mb-0.5">
                          Mức độ ưu tiên
                        </span>
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold ${
                            selectedLead.projectName ||
                            selectedLead.companyName ||
                            selectedFraud.duplicateScenario === 'SCENARIO_2_WON_RETURNING'
                              ? 'bg-rose-50 border border-rose-200 text-rose-700'
                              : 'bg-blue-50 border border-blue-200 text-[#1E3A8A]'
                          }`}
                        >
                          {selectedLead.projectName ||
                          selectedLead.companyName ||
                          selectedFraud.duplicateScenario === 'SCENARIO_2_WON_RETURNING'
                            ? 'Cao'
                            : 'Tiêu chuẩn'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Lưới 2x2: Tiến độ Pipeline | Chuyển giao NVKD | Kiểm soát rủi ro | Ghi chú phối hợp */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                    {/* CỘT TRÁI (7/12): Tiến độ Pipeline + Kiểm soát rủi ro */}
                    <div className="lg:col-span-7 space-y-4">
                      {/* 1. Tiến độ Pipeline với thanh 5 bước trực quan (Bỏ ô lý do khi chưa chọn Thất bại) */}
                      <form
                        onSubmit={(e) => void handleTransitionPipeline(e)}
                        className="p-4 sm:p-5 rounded-2xl bg-white border border-slate-200/90 space-y-4 shadow-2xs"
                      >
                        <div className="flex items-center justify-between">
                          <p className="font-bold text-slate-900 flex items-center gap-2 text-sm sm:text-base">
                            <RefreshCw className="w-4 h-4 text-[#1E3A8A]" />
                            <span>Tiến độ Pipeline</span>
                          </p>
                          <span className="text-[11px] text-slate-400">
                            Phiên bản v{selectedLead.version}
                          </span>
                        </div>

                        {/* Sơ đồ 5 bước ngang có thể bấm chọn trực tiếp */}
                        <div className="relative pt-2 pb-1 px-2">
                          <div className="absolute left-8 right-8 top-6 h-0.5 bg-slate-200" />
                          <div className="relative grid grid-cols-5 gap-1">
                            {PIPELINE_STATUSES.map((st, idx) => {
                              const isSelected = targetStatus === st;
                              const isCurrent = selectedLead.pipelineStatus === st;
                              const isWon = st === 'won';
                              const isLost = st === 'lost';
                              return (
                                <button
                                  key={st}
                                  type="button"
                                  disabled={!canEditSelectedLead || submitting}
                                  onClick={() => setTargetStatus(st)}
                                  className="group flex flex-col items-center text-center focus:outline-none disabled:cursor-not-allowed"
                                >
                                  <span
                                    className={`w-8 h-8 rounded-full grid place-items-center text-xs font-bold border-2 transition shadow-2xs ${
                                      isSelected
                                        ? isLost
                                          ? 'bg-rose-600 border-rose-600 text-white ring-4 ring-rose-100'
                                          : isWon
                                            ? 'bg-emerald-600 border-emerald-600 text-white ring-4 ring-emerald-100'
                                            : 'bg-[#2563EB] border-[#2563EB] text-white ring-4 ring-blue-100'
                                        : isCurrent
                                          ? 'bg-blue-50 border-[#2563EB] text-[#1E3A8A]'
                                          : isWon
                                            ? 'bg-white border-emerald-400 text-emerald-600 group-hover:bg-emerald-50'
                                            : isLost
                                              ? 'bg-white border-rose-400 text-rose-600 group-hover:bg-rose-50'
                                              : 'bg-white border-slate-300 text-slate-500 group-hover:border-blue-400'
                                    }`}
                                  >
                                    {isWon ? '✓' : isLost ? '✕' : isSelected ? '●' : idx + 1}
                                  </span>
                                  <span
                                    className={`mt-2 text-[11px] leading-tight px-1 ${
                                      isSelected
                                        ? 'font-bold text-[#1E3A8A]'
                                        : isCurrent
                                          ? 'font-semibold text-slate-800'
                                          : 'font-medium text-slate-500'
                                    }`}
                                  >
                                    {PIPELINE_STATUS_LABELS[st]}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {targetStatus === 'quote_sent' && canEditSelectedLead && (
                          <div className="space-y-2">
                            <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={markQuoteResponded}
                                onChange={(e) => setMarkQuoteResponded(e.target.checked)}
                              />
                              <span>
                                Đánh dấu khách hàng đã phản hồi báo giá (Tắt nhắc việc quá hạn)
                              </span>
                            </label>

                            {selectedLead.isPriceCheckSuspect && (
                              <div className="p-3 rounded-xl bg-orange-50 border border-orange-300 text-orange-950 space-y-1">
                                <p className="font-bold text-xs flex items-center gap-1.5">
                                  <ShieldAlert className="w-4 h-4 text-orange-600 shrink-0" />
                                  <span>
                                    Chốt chặn Bảo mật Giá: Hồ sơ đang có cảnh báo Nghi khảo giá / dò giá
                                  </span>
                                </p>
                                <label className="inline-flex items-start gap-2 cursor-pointer text-[11px] font-semibold">
                                  <input
                                    type="checkbox"
                                    checked={bypassPriceCheckConfirmed}
                                    onChange={(e) =>
                                      setBypassPriceCheckConfirmed(e.target.checked)
                                    }
                                    className="mt-0.5"
                                  />
                                  <span>
                                    Tôi xác nhận đã thẩm tra địa chỉ công trình thực tế hoặc đã được Quản lý duyệt gửi báo giá.
                                  </span>
                                </label>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Khi chọn Thất bại (hoặc mở lại từ Thất bại): Chỉ hiện duy nhất 1 ô nhập lý do + nút Cập nhật Pipeline */}
                        {targetStatus === 'lost' || selectedLead.pipelineStatus === 'lost' ? (
                          <div className="p-3 rounded-xl bg-rose-50/60 border border-rose-200/80 space-y-2 animate-in fade-in duration-150">
                            <label className="block text-xs font-bold text-rose-900">
                              {targetStatus === 'lost'
                                ? 'Lý do thất bại *'
                                : 'Lý do mở lại hồ sơ Lead *'}
                            </label>
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                              <input
                                type="text"
                                required
                                disabled={!canEditSelectedLead}
                                value={statusReason}
                                onChange={(e) => setStatusReason(e.target.value)}
                                placeholder={
                                  targetStatus === 'lost'
                                    ? 'Nhập lý do thất bại...'
                                    : 'Nhập lý do mở lại hồ sơ Lead...'
                                }
                                className="flex-1 h-9 px-3 rounded-xl border border-rose-300 bg-white text-xs text-slate-800 focus:outline-none focus:border-rose-600"
                              />
                              {canEditSelectedLead && (
                                <button
                                  type="submit"
                                  disabled={submitting}
                                  className="h-9 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 shrink-0 shadow-2xs transition"
                                >
                                  <RefreshCw className="w-3.5 h-3.5" />
                                  <span>Cập nhật Pipeline</span>
                                </button>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-1">
                            <div className="relative flex-1">
                              <Pencil className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                              <input
                                type="text"
                                disabled={!canEditSelectedLead}
                                value={statusNote}
                                onChange={(e) => setStatusNote(e.target.value)}
                                placeholder="Ghi chú tiến độ, nội dung trao đổi..."
                                className="w-full h-9 pl-8 pr-3 rounded-xl border border-slate-200 bg-slate-50/70 focus:bg-white text-xs text-slate-800 focus:outline-none focus:border-[#1E3A8A]"
                              />
                            </div>
                            {canEditSelectedLead && (
                              <button
                                type="submit"
                                disabled={submitting}
                                className="h-9 px-4 rounded-xl bg-[#2563EB] hover:bg-[#1E3A8A] text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 shrink-0 shadow-2xs transition"
                              >
                                <RefreshCw className="w-3.5 h-3.5" />
                                <span>Cập nhật Pipeline</span>
                              </button>
                            )}
                          </div>
                        )}
                      </form>

                      {/* 3. Kiểm soát rủi ro (Cảnh báo nghi dò giá + Đánh dấu Spam) */}
                      {canEditSelectedLead && (
                        <div className="p-4 sm:p-5 rounded-2xl bg-orange-50/60 border border-orange-200/90 space-y-3.5 shadow-2xs">
                          <p className="font-bold text-orange-950 flex items-center gap-2 text-sm sm:text-base">
                            <ShieldAlert className="w-4 h-4 text-orange-600" />
                            <span>Kiểm soát rủi ro</span>
                          </p>

                          {/* Cảnh báo nghi dò giá */}
                          <form
                            onSubmit={(e) => void handleCreatePriceAlert(e)}
                            className="space-y-1.5"
                          >
                            <label className="text-xs font-bold text-orange-900 flex items-center gap-1.5">
                              <AlertTriangle className="w-3.5 h-3.5 text-orange-600" />
                              <span>Cảnh báo nghi dò giá</span>
                            </label>
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                              <input
                                type="text"
                                required
                                value={priceCheckReason}
                                onChange={(e) => setPriceCheckReason(e.target.value)}
                                placeholder="Căn cứ xác định đối thủ khảo giá..."
                                className="flex-1 h-9 px-3 rounded-xl border border-orange-200 bg-white text-xs text-slate-800 focus:outline-none focus:border-orange-500"
                              />
                              <button
                                type="submit"
                                disabled={submitting}
                                className="h-9 px-4 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold shrink-0 shadow-2xs transition"
                              >
                                Phát cảnh báo
                              </button>
                            </div>
                          </form>

                          {/* Đánh dấu Spam */}
                          <form
                            onSubmit={(e) => void handleMarkSpam(e)}
                            className="space-y-1.5 pt-2 border-t border-orange-200/60"
                          >
                            <label className="text-xs font-bold text-orange-900 flex items-center gap-1.5">
                              <Ban className="w-3.5 h-3.5 text-orange-600" />
                              <span>Đánh dấu Spam</span>
                            </label>
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                              <select
                                value={spamReason}
                                onChange={(e) =>
                                  setSpamReason(e.target.value as (typeof SPAM_REASONS)[number])
                                }
                                className="flex-1 h-9 px-3 rounded-xl border border-orange-200 bg-white text-xs font-medium text-slate-800 focus:outline-none focus:border-orange-500"
                              >
                                {SPAM_REASONS.map((r) => (
                                  <option key={r} value={r}>
                                    {r}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="submit"
                                disabled={submitting}
                                className="h-9 px-4 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold shrink-0 shadow-2xs transition"
                              >
                                Gắn cờ Spam
                              </button>
                            </div>
                            <p className="text-[11px] text-slate-500 leading-relaxed">
                              SĐT sai / Nhầm máy tự loại khỏi báo cáo Ads; Đối thủ khảo giá vào diện chờ xác nhận.
                            </p>
                          </form>

                          {/* Duyệt Spam dành cho Quản lý / Admin nếu Lead đang có cờ Spam */}
                          {selectedLead.spamStatus !== 'NONE' && canReassign && (
                            <div className="p-3 rounded-xl bg-white border border-orange-300 flex flex-wrap items-center justify-between gap-2">
                              <div className="text-xs text-amber-950">
                                <span className="font-bold block">
                                  Đang gắn cờ Spam: {selectedLead.spamReason || 'Chưa rõ lý do'}
                                </span>
                                <span className="text-[11px] text-slate-500">
                                  Quản lý duyệt loại khỏi báo cáo Ads hoặc khôi phục Lead
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  disabled={submitting}
                                  onClick={() => void handleReviewSpam('confirm_spam')}
                                  className="h-8 px-3 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold"
                                >
                                  Duyệt loại khỏi Ads
                                </button>
                                <button
                                  type="button"
                                  disabled={submitting}
                                  onClick={() => void handleReviewSpam('restore_lead')}
                                  className="h-8 px-3 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold"
                                >
                                  Khôi phục Lead
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* CỘT PHẢI (5/12): Chuyển giao Nhân viên kinh doanh */}
                    <div className="lg:col-span-5 space-y-4">
                      {/* 2. Chuyển giao Nhân viên kinh doanh */}
                      {canReassign && (
                        <form
                          onSubmit={(e) => void handleReassignSales(e)}
                          className="p-4 sm:p-5 rounded-2xl bg-white border border-slate-200/90 space-y-3.5 shadow-2xs"
                        >
                          <p className="font-bold text-slate-900 flex items-center gap-2 text-sm sm:text-base">
                            <ArrowRightLeft className="w-4 h-4 text-[#1E3A8A]" />
                            <span>Chuyển giao Nhân viên kinh doanh</span>
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-semibold text-slate-700 mb-1">
                                Lý do chuyển <span className="text-rose-600">*</span>
                              </label>
                              <select
                                value={reassignCategory}
                                onChange={(e) =>
                                  setReassignCategory(
                                    e.target.value as (typeof REASSIGN_REASONS)[number],
                                  )
                                }
                                className="w-full h-9 px-2.5 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-800"
                              >
                                {REASSIGN_REASONS.map((r) => (
                                  <option key={r} value={r}>
                                    {r}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-slate-700 mb-1">
                                NVKD nhận <span className="text-rose-600">*</span>
                              </label>
                              <select
                                required
                                value={reassignTargetId}
                                onChange={(e) =>
                                  setReassignTargetId(
                                    e.target.value ? Number(e.target.value) : '',
                                  )
                                }
                                className="w-full h-9 px-2.5 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-800"
                              >
                                <option value="">-- Chọn nhân viên --</option>
                                {filteredSalesForReassign.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.fullName} ({s.activeLeadCount} Lead)
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <div>
                            <textarea
                              rows={2}
                              value={reassignDetail}
                              onChange={(e) => setReassignDetail(e.target.value)}
                              placeholder="Ghi chú bàn giao..."
                              className="w-full p-2.5 rounded-xl border border-slate-200 bg-slate-50/70 focus:bg-white text-xs text-slate-800 focus:outline-none focus:border-[#1E3A8A]"
                            />
                          </div>
                          <button
                            type="submit"
                            disabled={submitting || !reassignTargetId}
                            className="w-full h-9 px-4 rounded-xl bg-[#1E3A8A] hover:bg-blue-900 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-50 shadow-2xs transition"
                          >
                            <ArrowRightLeft className="w-3.5 h-3.5" />
                            <span>Chuyển giao</span>
                          </button>
                        </form>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: TỆP ĐÍNH KÈM (Hỗ trợ đa định dạng + Sửa tên / Thay tệp + Xóa tệp) */}
              {leadDetailTab === 'attachments' && (
                <div className="space-y-4 text-xs">
                  <div className="p-4 sm:p-5 rounded-2xl bg-white border border-slate-200/90 space-y-4 shadow-2xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Paperclip className="w-4 h-4 text-[#1E3A8A]" />
                        <div>
                          <h3 className="font-display font-bold text-slate-900 text-sm sm:text-base">
                            Tệp đính kèm hiện trạng công trình, bản vẽ &amp; hồ sơ dự án
                          </h3>
                          <p className="text-slate-500 text-[11px]">
                            Hỗ trợ đa định dạng: Ảnh/Video (PNG, JPG, WEBP, HEIC, MP4), Bản vẽ (CAD DWG/DXF, PDF, AI, CDR), Văn phòng (Word, Excel, PowerPoint, TXT) &amp; File nén (ZIP, RAR)
                          </p>
                        </div>
                      </div>
                      <span className="px-2.5 py-1 rounded-full bg-blue-50 border border-blue-200 text-[#1E3A8A] font-bold text-xs">
                        {selectedLead.attachments?.length || 0} tệp đã tải lên
                      </span>
                    </div>

                    {canUploadAttachment && !selectedLead.isAnonymized && (
                      <form
                        onSubmit={(e) => void handleUploadAttachment(e)}
                        className="p-4 rounded-2xl bg-slate-50/80 border border-dashed border-blue-300 space-y-3"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2.5 flex-1">
                            <select
                              value={attachmentType}
                              onChange={(e) =>
                                setAttachmentType(
                                  e.target.value as 'site_photo' | 'customer_drawing_doc' | 'other',
                                )
                              }
                              className="h-9 px-3 rounded-xl border border-slate-200 bg-white font-semibold text-slate-800 text-xs"
                            >
                              <option value="site_photo">📷 Ảnh / Video hiện trạng công trình</option>
                              <option value="customer_drawing_doc">📐 Bản vẽ kỹ thuật (CAD / PDF / 3D)</option>
                              <option value="other">📄 Hồ sơ dự án (Word / Excel / ZIP / Khác)</option>
                            </select>
                            <input
                              ref={attachmentInputRef}
                              type="file"
                              multiple
                              accept=".png,.jpg,.jpeg,.webp,.gif,.bmp,.svg,.heic,.pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.dwg,.dxf,.cdr,.ai,.psd,.zip,.rar,.7z,.mp4,.mov,.webm,image/*,video/*,application/pdf"
                              onChange={(e) => {
                                const list = e.target.files ? Array.from(e.target.files) : [];
                                setAttachmentFiles(list);
                                setAttachmentFile(list[0] || null);
                              }}
                              className="text-xs text-slate-700 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-[#1E3A8A] hover:file:bg-blue-100"
                            />
                          </div>
                          <button
                            type="submit"
                            disabled={submitting || (attachmentFiles.length === 0 && !attachmentFile)}
                            className="h-9 px-4 rounded-xl bg-[#1E3A8A] hover:bg-blue-800 text-white font-bold text-xs inline-flex items-center justify-center gap-1.5 disabled:opacity-50 shadow-2xs shrink-0 transition"
                          >
                            <FolderUp className="w-3.5 h-3.5" />
                            <span>
                              {submitting
                                ? 'Đang tải lên...'
                                : attachmentFiles.length > 1
                                  ? `Tải ${attachmentFiles.length} tệp lên`
                                  : 'Tải tệp lên'}
                            </span>
                          </button>
                        </div>

                        {attachmentFiles.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5 pt-1">
                            <span className="text-[11px] font-semibold text-slate-500">
                              Đã chọn ({attachmentFiles.length}):
                            </span>
                            {attachmentFiles.map((f, idx) => (
                              <span
                                key={`${f.name}-${idx}`}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-blue-200 text-[11px] font-medium text-slate-700"
                              >
                                <span className="truncate max-w-[180px]">{f.name}</span>
                                <span className="text-slate-400">
                                  ({Math.max(1, Math.round(f.size / 1024))} KB)
                                </span>
                              </span>
                            ))}
                          </div>
                        )}
                      </form>
                    )}

                    {selectedLead.attachments && selectedLead.attachments.length > 0 ? (
                      <div className="grid grid-cols-1 gap-2.5">
                        {selectedLead.attachments.map((att) => {
                          const lower = att.fileName.toLowerCase();
                          const extBadge = lower.endsWith('.pdf')
                            ? { label: 'PDF', style: 'bg-rose-50 border-rose-200 text-rose-700' }
                            : lower.endsWith('.doc') || lower.endsWith('.docx')
                              ? { label: 'DOC', style: 'bg-blue-50 border-blue-200 text-blue-700' }
                              : lower.endsWith('.xls') || lower.endsWith('.xlsx') || lower.endsWith('.csv')
                                ? { label: 'XLS', style: 'bg-emerald-50 border-emerald-200 text-emerald-700' }
                                : lower.endsWith('.dwg') || lower.endsWith('.dxf')
                                  ? { label: 'CAD', style: 'bg-amber-50 border-amber-200 text-amber-800' }
                                  : lower.endsWith('.zip') || lower.endsWith('.rar') || lower.endsWith('.7z')
                                    ? { label: 'ZIP', style: 'bg-purple-50 border-purple-200 text-purple-700' }
                                    : lower.endsWith('.mp4') || lower.endsWith('.mov') || lower.endsWith('.webm')
                                      ? { label: 'VID', style: 'bg-indigo-50 border-indigo-200 text-indigo-700' }
                                      : { label: 'IMG', style: 'bg-sky-50 border-sky-200 text-[#1E3A8A]' };

                          const isEditingThis = editingAttachmentId === att.id;

                          return (
                            <div
                              key={att.id}
                              className="p-3.5 rounded-xl bg-white border border-slate-200/90 hover:border-blue-300 shadow-2xs transition space-y-2.5"
                            >
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div className="flex items-center gap-3 min-w-0">
                                  <span
                                    className={`w-10 h-10 rounded-xl border grid place-items-center shrink-0 font-extrabold text-xs ${extBadge.style}`}
                                  >
                                    {extBadge.label}
                                  </span>
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <span className="font-bold text-slate-900 truncate text-xs sm:text-sm">
                                        {att.fileName}
                                      </span>
                                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-semibold">
                                        {att.fileType === 'site_photo'
                                          ? 'Ảnh/Video hiện trạng'
                                          : att.fileType === 'cad_drawing'
                                            ? 'Bản vẽ kỹ thuật'
                                            : 'Tài liệu dự án'}
                                      </span>
                                    </div>
                                    <span className="text-[11px] text-slate-500 mt-0.5 block">
                                      Người tải: <strong className="text-slate-700">{att.uploadedByName}</strong>
                                      {att.createdAt
                                        ? ` · ${new Date(att.createdAt).toLocaleString('vi-VN')}`
                                        : ''}
                                    </span>
                                  </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                                  <a
                                    href={att.downloadUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="h-8 px-2.5 rounded-lg bg-blue-50 hover:bg-[#1E3A8A] text-[#1E3A8A] hover:text-white border border-blue-200 font-bold text-xs inline-flex items-center gap-1 transition"
                                    title="Mở xem hoặc tải tệp về máy"
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                    <span>Xem / Tải</span>
                                  </a>

                                  {canUploadAttachment && !selectedLead.isAnonymized && (
                                    <>
                                      <button
                                        type="button"
                                        disabled={submitting}
                                        onClick={() => {
                                          if (isEditingThis) {
                                            setEditingAttachmentId(null);
                                            setEditingAttachmentReplaceFile(null);
                                          } else {
                                            setEditingAttachmentId(att.id);
                                            setEditingAttachmentName(att.fileName);
                                            setEditingAttachmentType(
                                              att.fileType === 'site_photo'
                                                ? 'site_photo'
                                                : att.fileType === 'cad_drawing'
                                                  ? 'customer_drawing_doc'
                                                  : 'other',
                                            );
                                            setEditingAttachmentReplaceFile(null);
                                          }
                                        }}
                                        className={`h-8 px-2.5 rounded-lg border font-bold text-xs inline-flex items-center gap-1 transition ${
                                          isEditingThis
                                            ? 'bg-amber-600 text-white border-amber-600'
                                            : 'bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-200'
                                        }`}
                                        title="Sửa tên tệp, đổi phân loại hoặc thay bằng tệp mới"
                                      >
                                        <Pencil className="w-3.5 h-3.5" />
                                        <span>Sửa</span>
                                      </button>

                                      <button
                                        type="button"
                                        disabled={submitting}
                                        onClick={() => void handleDeleteAttachment(att.id, att.fileName)}
                                        className="h-8 px-2.5 rounded-lg bg-rose-50 hover:bg-rose-600 text-rose-700 hover:text-white border border-rose-200 font-bold text-xs inline-flex items-center gap-1 transition"
                                        title="Xóa tệp đính kèm này"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                        <span>Xóa</span>
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>

                              {/* Khung sửa trực tiếp tệp đính kèm (Đổi tên, Đổi loại, hoặc Thay tệp mới) */}
                              {isEditingThis && (
                                <div className="p-3 rounded-xl bg-amber-50/60 border border-amber-200 space-y-2.5 animate-in fade-in duration-150">
                                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                                    <div className="sm:col-span-2">
                                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                                        Tên tệp đính kèm
                                      </label>
                                      <input
                                        type="text"
                                        value={editingAttachmentName}
                                        onChange={(e) => setEditingAttachmentName(e.target.value)}
                                        className="w-full h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-800 focus:outline-none focus:border-[#1E3A8A]"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                                        Phân loại tệp
                                      </label>
                                      <select
                                        value={editingAttachmentType}
                                        onChange={(e) =>
                                          setEditingAttachmentType(
                                            e.target.value as 'site_photo' | 'customer_drawing_doc' | 'other',
                                          )
                                        }
                                        className="w-full h-8 px-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-800"
                                      >
                                        <option value="site_photo">📷 Ảnh / Video hiện trạng</option>
                                        <option value="customer_drawing_doc">📐 Bản vẽ kỹ thuật</option>
                                        <option value="other">📄 Hồ sơ dự án khác</option>
                                      </select>
                                    </div>
                                  </div>

                                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
                                    <div className="flex items-center gap-2">
                                      <span className="text-[11px] font-semibold text-slate-600">
                                        Thay bằng file khác (tùy chọn):
                                      </span>
                                      <input
                                        type="file"
                                        accept=".png,.jpg,.jpeg,.webp,.gif,.bmp,.svg,.heic,.pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.dwg,.dxf,.cdr,.ai,.psd,.zip,.rar,.7z,.mp4,.mov,.webm,image/*,video/*,application/pdf"
                                        onChange={(e) => {
                                          const f = e.target.files?.[0] || null;
                                          setEditingAttachmentReplaceFile(f);
                                          if (f) setEditingAttachmentName(f.name);
                                        }}
                                        className="text-[11px] text-slate-700 file:mr-2 file:py-1 file:px-2.5 file:rounded-md file:border-0 file:text-[11px] file:font-semibold file:bg-white file:text-amber-900"
                                      />
                                    </div>

                                    <div className="flex items-center gap-1.5 self-end sm:self-auto">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingAttachmentId(null);
                                          setEditingAttachmentReplaceFile(null);
                                        }}
                                        className="h-8 px-3 rounded-lg border border-slate-300 bg-white text-slate-600 font-semibold text-xs"
                                      >
                                        Hủy
                                      </button>
                                      <button
                                        type="button"
                                        disabled={submitting}
                                        onClick={() => void handleSaveEditAttachment(att.id)}
                                        className="h-8 px-3.5 rounded-lg bg-[#1E3A8A] hover:bg-blue-800 text-white font-bold text-xs transition"
                                      >
                                        Lưu thay đổi
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="py-10 text-center border border-dashed border-slate-200 rounded-2xl text-slate-400">
                        <FileText className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                        <p className="font-semibold text-slate-600 text-xs sm:text-sm">
                          Chưa có tệp đính kèm nào trong hồ sơ này
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Hỗ trợ tải lên Ảnh, Video, PDF, Word, Excel, Bản vẽ AutoCAD (DWG/DXF), File nén ZIP/RAR...
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 4: LỊCH SỬ — dòng thời gian theo ngày */}
              {leadDetailTab === 'activity' && (
                <LeadActivityTimeline activities={selectedLead.activities || []} />
              )}
            </div>
          </div>
        </div>
        );
      })()}

      {(investigativeLead || competitorPromptLead || showPriceAlertDirectory) && (
        <LeadRiskAndFraudModals
          user={user}
          leads={leads}
          priceCheckAlerts={priceCheckAlerts}
          fraudByLeadId={fraudByLeadId}
          investigativeLead={investigativeLead}
          onCloseInvestigative={() => setInvestigativeLead(null)}
          canEditInvestigativeLead={investigativeLead ? canEditLead(investigativeLead) : false}
          onOpenLeadDetail={(leadId) => {
            setSelectedLeadId(leadId);
            setLeadDetailTab('info');
          }}
          competitorPromptLead={competitorPromptLead}
          onCloseCompetitorPrompt={() => setCompetitorPromptLead(null)}
          priceCheckReason={priceCheckReason}
          onChangePriceCheckReason={setPriceCheckReason}
          onChangePriceCheckFile={setPriceCheckFile}
          onSubmitPriceAlert={handleCreatePriceAlert}
          showPriceAlertDirectory={showPriceAlertDirectory}
          onClosePriceAlertDirectory={() => setShowPriceAlertDirectory(false)}
          onDismissPriceAlertSubmit={handleDismissPriceAlertById}
          submitting={submitting}
          setSubmitting={setSubmitting}
          onRefreshLeads={fetchLeads}
          onFeedback={(msg) => setFeedbackMsg(msg)}
          onError={(msg) => setErrorMsg(msg)}
        />
      )}
    </div>
  );
}

