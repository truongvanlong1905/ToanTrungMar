'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { WebsiteConfigItemDto } from '@toantrung/contracts';
import { hasBaPermission } from '@toantrung/contracts';
import { apiRequest } from '@/core/http/client';
import { subscribeDataSync } from '@/core/http/data-sync-bus';
import { useSession } from '@/core/session/SessionContext';
import {
  ArrowUpRight,
  Bold,
  CheckCircle2,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  Heading2,
  History,
  Italic,
  List,
  PenLine,
  Printer,
  RotateCcw,
  Save,
  Sparkles,
  Underline,
  X,
} from 'lucide-react';

interface SeoTopicRecommendationRow {
  keyword: string;
  targetWebsite: string;
  suggestedTopicTitle: string;
  priorityCategory:
    | 'HIGH_IMPRESSION_LOW_CTR'
    | 'STRIKE_DISTANCE_POS_4_15'
    | 'RISING_DEMAND_LEAD_FIT';
  impressions: number;
  clicks: number;
  ctrPct: number;
  avgPosition: number | null;
  leadsFromWebsiteCount: number;
  dataEvidenceReason: string;
}

interface SeoAiReportRecord {
  id: string;
  website: string;
  periodDays: number;
  snapshot: {
    website: string;
    sourcePlatform: string;
    generatedAt: string;
    current: {
      startDate: string;
      endDate: string;
      daysWithData: number;
      totalClicks: number;
      totalImpressions: number;
      overallCtrPct: number;
    };
    previous: {
      startDate: string;
      endDate: string;
      daysWithData: number;
      totalClicks: number;
      totalImpressions: number;
      overallCtrPct: number;
    };
    comparison: {
      clicksDeltaLabel: string;
      impressionsDeltaLabel: string;
      ctrDeltaPctPoints: number;
    };
    dataCompleteness: {
      expectedDays: number;
      currentDaysWithData: number;
      previousDaysWithData: number;
      warnings: string[];
    };
    leadsFromWebsiteCount: number;
    recommendedTopics?: SeoTopicRecommendationRow[];
  };
  aiOriginalContent: string;
  editedContent: string;
  modelUsed: string;
  generationMode?: 'LIVE_AI' | 'DETERMINISTIC_FALLBACK';
  fallbackReason?: string | null;
  validationResult?: {
    valid: boolean;
    violations: string[];
  };
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

function editorDomToMarkdownText(root: HTMLElement): string {
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || '';
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === 'table') return '\n';
    const inner = Array.from(el.childNodes).map(walk).join('');
    if (tag === 'b' || tag === 'strong') return `**${inner}**`;
    if (tag === 'h1') return `# ${inner.trim()}\n`;
    if (tag === 'h2') return `## ${inner.trim()}\n`;
    if (tag === 'li') return `• ${inner.trim()}\n`;
    if (tag === 'br') return '\n';
    if (tag === 'p' || tag === 'div' || tag === 'ul' || tag === 'ol') {
      const cleaned = inner.trimEnd();
      return cleaned ? `${cleaned}\n` : '\n';
    }
    return inner;
  };
  return Array.from(root.childNodes)
    .map(walk)
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function SeoAiReportPanel({
  csrfToken,
  initialWebsite,
  initialPeriodDays,
  availableWebsites = [],
  canEditContent = true,
  onSelectKeyword,
  onContentCreated,
  onClose,
}: {
  csrfToken?: string;
  initialWebsite?: string;
  initialPeriodDays?: number;
  availableWebsites?: WebsiteConfigItemDto[];
  canEditContent?: boolean;
  onSelectKeyword?: (keyword: string) => void;
  onContentCreated?: () => void;
  onClose?: () => void;
}) {
  const { user } = useSession();
  const canDirectDesign = Boolean(user && hasBaPermission(user.roleCode, 'AI_DESIGN'));
  const [website, setWebsite] = useState(initialWebsite || 'all');
  const [periodDays, setPeriodDays] = useState(initialPeriodDays || 30);
  const [activeViewTab, setActiveViewTab] = useState<'document' | 'topics'>('document');
  const [isEditingDoc, setIsEditingDoc] = useState(false);
  const [submittingBriefKw, setSubmittingBriefKw] = useState<string | null>(null);

  const handleCreateTopicBrief = async (topic: SeoTopicRecommendationRow) => {
    setSubmittingBriefKw(topic.keyword);
    setErrorMsg(null);
    try {
      const res = await apiRequest<{ ok: boolean; projectId: number; message: string }>('/api/v1/design', {
        method: 'POST',
        csrfToken: csrfToken || user?.csrfToken,
        body: {
          action: 'submit_marketing_brief',
          projectName: `Banner minh họa SEO: ${topic.suggestedTopicTitle}`,
          taskCode: 'banner_generate',
          designType: 'banner',
          sourceModule: 'seo_ai',
          designBrief: {
            objective: `${topic.dataEvidenceReason} (Từ khóa: "${topic.keyword}")`,
            websiteId: topic.targetWebsite || 'toantrung.com.vn',
            websiteDomain: topic.targetWebsite || 'toantrung.com.vn',
            campaignName: topic.suggestedTopicTitle,
            targetChannel: 'Ảnh Hero bài viết SEO & Social Share',
            outputFormat: 'Banner 16:9 (1536×1024 px)',
            outputWidthPx: 1536,
            outputHeightPx: 1024,
            headlineText: topic.suggestedTopicTitle,
            ctaText: 'Xem giải pháp & báo giá',
            baselineSnapshot: activeReport
              ? {
                  capturedAt: new Date().toISOString(),
                  sourceModule: 'seo_ai',
                  scopeLabel: `${topic.targetWebsite} (${activeReport.snapshot.current.startDate} → ${activeReport.snapshot.current.endDate})`,
                  dateFrom: activeReport.snapshot.current.startDate,
                  dateTo: activeReport.snapshot.current.endDate,
                  websiteId: topic.targetWebsite,
                  websiteDomain: topic.targetWebsite,
                  snapshotId: activeReport.id,
                }
              : null,
          },
        },
      });
      setStatusMsg(
        res.message || `Đã gửi Brief thiết kế minh họa #${res.projectId} cho chủ đề "${topic.suggestedTopicTitle}".`,
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể gửi Brief thiết kế minh họa.');
    } finally {
      setSubmittingBriefKw(null);
    }
  };

  useEffect(() => {
    if (initialWebsite) setWebsite(initialWebsite);
  }, [initialWebsite]);

  useEffect(() => {
    if (initialPeriodDays) setPeriodDays(initialPeriodDays);
  }, [initialPeriodDays]);

  const [reports, setReports] = useState<SeoAiReportRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftContent, setDraftContent] = useState('');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [planningKeyword, setPlanningKeyword] = useState<string | null>(null);
  const [plannedKeywords, setPlannedKeywords] = useState<Record<string, boolean>>({});
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [editorSyncKey, setEditorSyncKey] = useState(0);
  const editorRef = useRef<HTMLDivElement | null>(null);

  const textToCleanReportHtml = useCallback((text: string, snap?: SeoAiReportRecord['snapshot']) => {
    const lines = (text || '').split('\n');
    let injectedSummaryTable = false;

    const summaryTable = snap
      ? `<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px;border-radius:8px;overflow:hidden;">
          <thead>
            <tr style="background:#F8FAFC;color:#0F275C;">
              <th style="border:1px solid #E2E8F0;padding:8px 12px;text-align:left;">Chỉ số đo lường</th>
              <th style="border:1px solid #E2E8F0;padding:8px 12px;text-align:right;">Kỳ này</th>
              <th style="border:1px solid #E2E8F0;padding:8px 12px;text-align:right;">Kỳ trước</th>
              <th style="border:1px solid #E2E8F0;padding:8px 12px;text-align:right;">So sánh</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="border:1px solid #E2E8F0;padding:7px 12px;font-weight:600;">Lượt nhấp từ Google (Clicks)</td>
              <td style="border:1px solid #E2E8F0;padding:7px 12px;text-align:right;font-weight:700;">${snap.current.totalClicks.toLocaleString('vi-VN')}</td>
              <td style="border:1px solid #E2E8F0;padding:7px 12px;text-align:right;color:#64748B;">${snap.previous.totalClicks.toLocaleString('vi-VN')}</td>
              <td style="border:1px solid #E2E8F0;padding:7px 12px;text-align:right;font-weight:600;color:#0F275C;">${snap.comparison.clicksDeltaLabel}</td>
            </tr>
            <tr>
              <td style="border:1px solid #E2E8F0;padding:7px 12px;font-weight:600;">Lượt xuất hiện trên Google</td>
              <td style="border:1px solid #E2E8F0;padding:7px 12px;text-align:right;font-weight:700;">${snap.current.totalImpressions.toLocaleString('vi-VN')}</td>
              <td style="border:1px solid #E2E8F0;padding:7px 12px;text-align:right;color:#64748B;">${snap.previous.totalImpressions.toLocaleString('vi-VN')}</td>
              <td style="border:1px solid #E2E8F0;padding:7px 12px;text-align:right;font-weight:600;color:#0F275C;">${snap.comparison.impressionsDeltaLabel}</td>
            </tr>
            <tr>
              <td style="border:1px solid #E2E8F0;padding:7px 12px;font-weight:600;">Tỷ lệ nhấp trung bình (CTR)</td>
              <td style="border:1px solid #E2E8F0;padding:7px 12px;text-align:right;font-weight:700;">${snap.current.overallCtrPct}%</td>
              <td style="border:1px solid #E2E8F0;padding:7px 12px;text-align:right;color:#64748B;">${snap.previous.overallCtrPct}%</td>
              <td style="border:1px solid #E2E8F0;padding:7px 12px;text-align:right;font-weight:600;">${snap.comparison.ctrDeltaPctPoints >= 0 ? '+' : ''}${snap.comparison.ctrDeltaPctPoints} điểm %</td>
            </tr>
            <tr>
              <td style="border:1px solid #E2E8F0;padding:7px 12px;font-weight:600;">Lead hợp lệ từ Website</td>
              <td style="border:1px solid #E2E8F0;padding:7px 12px;text-align:right;font-weight:700;color:#059669;">${snap.leadsFromWebsiteCount} Lead</td>
              <td style="border:1px solid #E2E8F0;padding:7px 12px;text-align:right;color:#64748B;">—</td>
              <td style="border:1px solid #E2E8F0;padding:7px 12px;text-align:right;color:#475569;">Ghi nhận CRM</td>
            </tr>
          </tbody>
        </table>`
      : '';

    return lines
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return '<div style="height:6px;"></div>';
        const escapedRaw = trimmed
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        const escaped = escapedRaw
          .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
          .replace(
            /\[(Đối chiếu [^:\]]+|Tham chiếu):\s*([^\]]+)\]/gi,
            (_m, prefix: string, body: string) =>
              ` <span style="display:inline-block;padding:1px 8px;margin-left:4px;border-radius:999px;background:#EFF6FF;border:1px solid #BFDBFE;color:#1E40AF;font-size:11px;font-weight:600;vertical-align:middle;">${prefix}: ${body.trim()}</span>`,
          );
        if (trimmed.startsWith('BÁO CÁO ')) {
          return `<div style="border-bottom:2px solid #0F275C;padding-bottom:12px;margin-bottom:14px;">
            <div style="font-size:11px;font-weight:700;letter-spacing:0.06em;color:#64748B;text-transform:uppercase;margin-bottom:4px;">CÔNG TY CỔ PHẦN ĐIỆN TỬ VIỄN THÔNG TOÀN TRUNG</div>
            <h1 style="font-size:18px;font-weight:800;color:#0F275C;margin:0;line-height:1.35;">${escaped}</h1>
          </div>`;
        }
        if (trimmed.startsWith('Kỳ báo cáo:')) {
          return `<p style="font-size:12.5px;color:#475569;margin:0 0 14px 0;">${escaped}</p>`;
        }
        if (/^(I|II|III|IV|V)\.\s/.test(trimmed) || /^#+\s/.test(trimmed)) {
          const headingHtml = `<h2 style="font-size:14.5px;font-weight:700;color:#0F275C;background:#F8FAFC;border-left:3.5px solid #1E3A8A;padding:6px 10px;border-radius:0 6px 6px 0;margin:18px 0 8px 0;">${escaped.replace(/^#+\s*/, '')}</h2>`;
          if (!injectedSummaryTable && /^I\.\s/.test(trimmed)) {
            injectedSummaryTable = true;
            return `${headingHtml}${summaryTable}`;
          }
          return headingHtml;
        }
        if (/^[0-9]+\.\s/.test(trimmed)) {
          return `<p style="font-weight:600;color:#0F172A;margin:8px 0 4px 0;line-height:1.6;">${escaped}</p>`;
        }
        return `<p style="margin:4px 0;line-height:1.68;color:#334155;">${escaped}</p>`;
      })
      .join('');
  }, []);

  const cleanContent = (r: SeoAiReportRecord) => {
    const raw = (r.editedContent || '').trim();
    if (!raw || raw.startsWith('undefined')) {
      return r.aiOriginalContent || '';
    }
    return r.editedContent;
  };

  const selectedIdRef = useRef<string | null>(selectedId);
  selectedIdRef.current = selectedId;

  const loadReports = useCallback(async (forceFresh = false) => {
    try {
      const res = await apiRequest<{ reports: SeoAiReportRecord[] }>('/api/v1/ads/seo-reports', {
        skipCache: forceFresh,
      });
      const list = (res.reports || []).filter(
        (r) => !(r.editedContent || '').includes('Ghi chú nghiệm thu R02'),
      );
      setReports(list);
      if (!selectedIdRef.current && list.length > 0) {
        setSelectedId(list[0].id);
        setDraftContent(cleanContent(list[0]));
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void loadReports(false);
    return subscribeDataSync(['seo_reports'], () => {
      void loadReports(true);
    });
  }, [loadReports]);

  const activeReport = reports.find((r) => r.id === selectedId) || null;

  useEffect(() => {
    if (editorRef.current && activeReport && !isEditingDoc) {
      editorRef.current.innerHTML = textToCleanReportHtml(draftContent, activeReport.snapshot);
    }
  }, [selectedId, editorSyncKey, activeReport, isEditingDoc, textToCleanReportHtml, activeViewTab, draftContent]);

  const execFormat = (cmd: string, value?: string) => {
    if (!editorRef.current) return;
    editorRef.current.focus();
    document.execCommand(cmd, false, value);
  };

  const handleGenerate = async () => {
    if (generating) return;
    setGenerating(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await apiRequest<{ report: SeoAiReportRecord }>('/api/v1/ads/seo-reports', {
        method: 'POST',
        csrfToken,
        body: { website, periodDays },
      });
      setReports((prev) => [res.report, ...prev]);
      setSelectedId(res.report.id);
      setDraftContent(cleanContent(res.report));
      setActiveViewTab('document');
      setIsEditingDoc(false);
      setEditorSyncKey((k) => k + 1);
      setStatusMsg(
        `Đã lập báo cáo AI (${res.report.website === 'all' ? 'Tất cả website' : res.report.website} · ${res.report.periodDays} ngày).`,
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể tạo báo cáo AI lúc này.');
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!activeReport || saving) return;
    const latestDraft = editorRef.current ? editorDomToMarkdownText(editorRef.current) : draftContent;
    setDraftContent(latestDraft);
    setSaving(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await apiRequest<{ report: SeoAiReportRecord }>('/api/v1/ads/seo-reports', {
        method: 'PATCH',
        csrfToken,
        body: { reportId: activeReport.id, editedContent: latestDraft },
      });
      setReports((prev) => prev.map((r) => (r.id === res.report.id ? res.report : r)));
      setIsEditingDoc(false);
      setStatusMsg('Đã lưu nội dung biên tập.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể lưu chỉnh sửa.');
    } finally {
      setSaving(false);
    }
  };

  const handlePlanTopic = async (topic: SeoTopicRecommendationRow) => {
    if (!canEditContent || planningKeyword) return;
    setPlanningKeyword(topic.keyword);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const targetDomain =
        topic.targetWebsite === 'bangled.vn' || topic.targetWebsite === 'manhinhled.net.vn'
          ? topic.targetWebsite
          : 'toantrung.com.vn';
      const kwRes = await apiRequest<{ id: number; keyword: string }>('/api/v1/ads', {
        method: 'POST',
        csrfToken,
        body: {
          action: 'create_keyword',
          keywordText: topic.keyword,
          targetWebsite: targetDomain,
          cachedOrganicClicks: topic.clicks,
          cachedAvgPosition: topic.avgPosition ?? undefined,
        },
      });
      const articleRes = await apiRequest<{ id: number; title: string }>('/api/v1/ads', {
        method: 'POST',
        csrfToken,
        body: {
          action: 'generate_ai_draft',
          keywordId: kwRes.id,
          targetWebsite: targetDomain,
          topicFocus: topic.suggestedTopicTitle,
          customPromptInstruction: `Dữ liệu đối chiếu Search Console: ${topic.dataEvidenceReason}`,
        },
      });
      setPlannedKeywords((prev) => ({ ...prev, [topic.keyword]: true }));
      setStatusMsg(`Đã tạo bản nháp bài viết #${articleRes.id} "${topic.suggestedTopicTitle}" trong mục Nội dung.`);
      onContentCreated?.();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể tạo bài nháp.');
    } finally {
      setPlanningKeyword(null);
    }
  };

  const topicsList = activeReport?.snapshot.recommendedTopics || [];

  return (
    <section
      aria-label="Studio Báo cáo Phân tích SEO bằng AI"
      className="rounded-2xl bg-white border border-slate-200/90 shadow-lg overflow-hidden"
    >
      {/* 1. Thanh điều khiển gọn gàng trên 1 hàng duy nhất */}
      <div className="px-5 py-3 bg-gradient-to-r from-[#081533] via-[#0F275C] to-[#1E3A8A] text-white flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-8 h-8 rounded-xl bg-white/15 backdrop-blur-xs grid place-items-center shrink-0">
            <Sparkles className="w-4 h-4 text-sky-300" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-bold leading-tight truncate">
              Báo cáo Phân tích SEO bằng AI
            </h2>
            <p className="text-[11px] text-sky-200/90 truncate">
              Tổng hợp tự động từ số liệu thật của Search Console &amp; gợi ý bài viết kéo khách
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <select
            aria-label="Chọn website phân tích"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            className="h-8 px-2.5 rounded-lg bg-white/15 hover:bg-white/20 border border-white/25 text-white text-xs font-semibold outline-none [&>option]:text-slate-900"
          >
            <option value="all">Tất cả website</option>
            {(availableWebsites.length > 0
              ? availableWebsites.map((w) => ({ id: w.domain, label: w.domain }))
              : [
                  { id: 'toantrung.com.vn', label: 'toantrung.com.vn' },
                  { id: 'manhinhled.net.vn', label: 'manhinhled.net.vn' },
                  { id: 'bangled.vn', label: 'bangled.vn' },
                ]
            ).map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>

          <select
            aria-label="Chọn kỳ so sánh"
            value={periodDays}
            onChange={(e) => setPeriodDays(Number(e.target.value))}
            className="h-8 px-2.5 rounded-lg bg-white/15 hover:bg-white/20 border border-white/25 text-white text-xs font-semibold outline-none [&>option]:text-slate-900"
          >
            <option value={7}>7 ngày gần nhất</option>
            <option value={14}>14 ngày gần nhất</option>
            <option value={30}>30 ngày gần nhất</option>
            <option value={60}>60 ngày gần nhất</option>
          </select>

          <button
            type="button"
            disabled={generating}
            onClick={() => void handleGenerate()}
            className="h-8 px-3.5 rounded-lg bg-sky-400 hover:bg-sky-300 text-slate-950 text-xs font-bold inline-flex items-center gap-1.5 shadow-xs transition disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{generating ? 'Đang phân tích...' : 'Phân tích kỳ mới'}</span>
          </button>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng bảng báo cáo AI"
              className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white grid place-items-center transition"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* 2. Thanh phụ: Lịch sử bản lưu dạng Dropdown gọn + Tab chuyển đổi + Xuất Word/Excel */}
      <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          {reports.length > 0 && (
            <div className="inline-flex items-center gap-1.5">
              <History className="w-3.5 h-3.5 text-slate-500" />
              <select
                aria-label="Chọn bản báo cáo đã lưu"
                value={selectedId || ''}
                onChange={(e) => {
                  const next = reports.find((r) => r.id === e.target.value);
                  if (next) {
                    setSelectedId(next.id);
                    setDraftContent(cleanContent(next));
                    setIsEditingDoc(false);
                    setEditorSyncKey((k) => k + 1);
                  }
                }}
                className="h-8 max-w-[300px] px-2.5 rounded-lg border border-slate-200 bg-white text-slate-800 font-semibold truncate"
              >
                {reports.map((r, idx) => (
                  <option key={r.id} value={r.id}>
                    {idx === 0 ? '★ Mới nhất: ' : ''}
                    {r.website === 'all' ? 'Tất cả web' : r.website} ({r.periodDays} ngày) ·{' '}
                    {new Date(r.createdAt).toLocaleDateString('vi-VN')}
                  </option>
                ))}
              </select>
            </div>
          )}

          {activeReport && (
            <div className="inline-flex rounded-xl bg-slate-200/70 p-0.5">
              <button
                type="button"
                onClick={() => setActiveViewTab('document')}
                className={`px-3 py-1 rounded-lg font-semibold transition ${
                  activeViewTab === 'document'
                    ? 'bg-white text-[#0F275C] shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Bản phân tích ({activeReport.periodDays} ngày)
              </button>
              <button
                type="button"
                onClick={() => setActiveViewTab('topics')}
                className={`px-3 py-1 rounded-lg font-semibold transition ${
                  activeViewTab === 'topics'
                    ? 'bg-white text-[#0F275C] shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Chủ đề gợi ý viết bài ({topicsList.length})
              </button>
            </div>
          )}
        </div>

        {activeReport && (
          <div className="flex flex-wrap items-center gap-1.5">
            {activeViewTab === 'document' && (
              <button
                type="button"
                onClick={() => setIsEditingDoc((prev) => !prev)}
                className={`h-8 px-2.5 rounded-lg border font-semibold inline-flex items-center gap-1 transition ${
                  isEditingDoc
                    ? 'bg-amber-50 border-amber-300 text-amber-900'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <PenLine className="w-3.5 h-3.5" />
                <span>{isEditingDoc ? 'Đang sửa văn bản' : 'Sửa văn bản'}</span>
              </button>
            )}
            <a
              href={`/api/v1/ads/seo-reports/${encodeURIComponent(activeReport.id)}/export?format=docx`}
              className="h-8 px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-blue-50 text-slate-700 hover:text-[#1E3A8A] font-semibold inline-flex items-center gap-1 transition"
            >
              <FileText className="w-3.5 h-3.5 text-blue-600" />
              <span>Tải Word</span>
            </a>
            <a
              href={`/api/v1/ads/seo-reports/${encodeURIComponent(activeReport.id)}/export?format=xlsx`}
              className="h-8 px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-emerald-50 text-slate-700 hover:text-emerald-800 font-semibold inline-flex items-center gap-1 transition"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              <span>Tải Excel</span>
            </a>
          </div>
        )}
      </div>

      {statusMsg && (
        <div className="mx-5 mt-3 px-3.5 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-medium">
          {statusMsg}
        </div>
      )}
      {errorMsg && (
        <div className="mx-5 mt-3 px-3.5 py-2 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium">
          {errorMsg}
        </div>
      )}

      {/* 3. Nội dung chính: Gọn, thoáng, có trật tự rõ ràng */}
      {!activeReport ? (
        <div className="p-10 text-center space-y-3">
          <div className="w-11 h-11 rounded-2xl bg-blue-50 text-[#1E3A8A] grid place-items-center mx-auto">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="text-sm font-bold text-slate-900">
            Chưa có bản báo cáo phân tích SEO nào được tạo
          </div>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Chọn website và khoảng ngày ở góc trên bên phải rồi bấm <strong>Phân tích kỳ mới</strong> để AI tổng hợp kết quả và đề xuất bài viết.
          </p>
        </div>
      ) : activeViewTab === 'document' ? (
        <div className="p-5 space-y-4">
          {/* Dải 4 chỉ số tóm tắt gọn */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 px-3.5 py-2.5">
              <div className="text-[11px] text-slate-500">Click tìm kiếm Google</div>
              <div className="flex items-baseline justify-between gap-2 mt-0.5">
                <span className="text-lg font-extrabold text-slate-900 tabular-nums">
                  {activeReport.snapshot.current.totalClicks.toLocaleString('vi-VN')}
                </span>
                <span className="text-[11px] font-semibold text-[#1E3A8A]">
                  {activeReport.snapshot.comparison.clicksDeltaLabel}
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 px-3.5 py-2.5">
              <div className="text-[11px] text-slate-500">Lượt xuất hiện (Impressions)</div>
              <div className="flex items-baseline justify-between gap-2 mt-0.5">
                <span className="text-lg font-extrabold text-slate-900 tabular-nums">
                  {activeReport.snapshot.current.totalImpressions.toLocaleString('vi-VN')}
                </span>
                <span className="text-[11px] font-semibold text-slate-600">
                  {activeReport.snapshot.comparison.impressionsDeltaLabel}
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 px-3.5 py-2.5">
              <div className="text-[11px] text-slate-500">Tỷ lệ khách nhấp (CTR)</div>
              <div className="flex items-baseline justify-between gap-2 mt-0.5">
                <span className="text-lg font-extrabold text-slate-900 tabular-nums">
                  {activeReport.snapshot.current.overallCtrPct}%
                </span>
                <span className="text-[11px] text-slate-500">
                  Kỳ trước: {activeReport.snapshot.previous.overallCtrPct}%
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 px-3.5 py-2.5">
              <div className="text-[11px] text-slate-500">Lead hợp lệ từ Website</div>
              <div className="flex items-baseline justify-between gap-2 mt-0.5">
                <span className="text-lg font-extrabold text-emerald-700 tabular-nums">
                  {activeReport.snapshot.leadsFromWebsiteCount} Lead
                </span>
                <span
                  className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                    activeReport.generationMode === 'LIVE_AI'
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'bg-amber-50 text-amber-800 border border-amber-200'
                  }`}
                >
                  {activeReport.generationMode === 'LIVE_AI' ? 'LIVE AI' : 'Dự phòng chuẩn'}
                </span>
              </div>
            </div>
          </div>

          {/* Thanh xác nhận nguồn AI sống vs Dự phòng */}
          <div
            className={`px-3.5 py-2 rounded-xl border text-xs flex flex-wrap items-center justify-between gap-2 ${
              activeReport.generationMode === 'LIVE_AI'
                ? 'bg-emerald-50/60 border-emerald-200 text-emerald-950'
                : 'bg-amber-50/70 border-amber-200 text-amber-950'
            }`}
          >
            <div className="font-semibold">
              {activeReport.generationMode === 'LIVE_AI'
                ? `Phân tích trực tiếp bởi AI (${activeReport.modelUsed}) · Đã đối chiếu số liệu Search Console`
                : `Bản tổng hợp đối chiếu tự động (Dự phòng${activeReport.fallbackReason ? `: ${activeReport.fallbackReason}` : ''})`}
            </div>
            <div className="text-[11px] opacity-80">
              Cập nhật: {new Date(activeReport.updatedAt).toLocaleString('vi-VN')}
            </div>
          </div>

          {/* Thanh định dạng CHỈ hiện khi bấm "Sửa văn bản" (không bầy bừa mặc định) */}
          {isEditingDoc && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50/70 border border-amber-200 px-3 py-2 text-xs">
              <div className="flex flex-wrap items-center gap-1">
                <button type="button" onClick={() => execFormat('formatBlock', 'H2')} className="p-1.5 rounded hover:bg-white text-slate-700" title="Tiêu đề mục">
                  <Heading2 className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={() => execFormat('bold')} className="p-1.5 rounded hover:bg-white text-slate-700" title="In đậm">
                  <Bold className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={() => execFormat('italic')} className="p-1.5 rounded hover:bg-white text-slate-700" title="In nghiêng">
                  <Italic className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={() => execFormat('underline')} className="p-1.5 rounded hover:bg-white text-slate-700" title="Gạch chân">
                  <Underline className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={() => execFormat('insertUnorderedList')} className="p-1.5 rounded hover:bg-white text-slate-700" title="Danh sách">
                  <List className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={() => window.print()} className="p-1.5 rounded hover:bg-white text-slate-700 inline-flex items-center gap-1">
                  <Printer className="w-3.5 h-3.5" />
                  <span>In</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setDraftContent(activeReport.aiOriginalContent);
                    setEditorSyncKey((k) => k + 1);
                  }}
                  className="h-7 px-2.5 rounded-lg bg-white border border-slate-200 text-slate-700 font-semibold inline-flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Khôi phục gốc</span>
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleSaveEdit()}
                  className="h-7 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold inline-flex items-center gap-1"
                >
                  <Save className="w-3 h-3" />
                  <span>{saving ? 'Đang lưu...' : 'Lưu bản sửa'}</span>
                </button>
              </div>
            </div>
          )}

          {/* Trang văn bản báo cáo sạch đẹp */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 sm:p-6 max-h-[460px] overflow-y-auto [scrollbar-gutter:stable]">
            <div
              ref={editorRef}
              contentEditable={isEditingDoc}
              suppressContentEditableWarning
              onBlur={(e) => {
                if (isEditingDoc) setDraftContent(editorDomToMarkdownText(e.currentTarget));
              }}
              className={`mx-auto max-w-3xl bg-white rounded-xl border px-6 py-6 sm:px-8 sm:py-7 text-sm shadow-2xs transition ${
                isEditingDoc
                  ? 'border-amber-400 ring-2 ring-amber-400/20 focus:outline-none'
                  : 'border-slate-200/90'
              }`}
            />
          </div>
        </div>
      ) : (
        /* Tab 2: Danh sách chủ đề gợi ý viết bài gọn gàng */
        <div className="p-5">
          {topicsList.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500">
              Bản báo cáo này chưa có chủ đề từ khóa gợi ý riêng.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {topicsList.map((topic) => {
                const isPlanned = Boolean(plannedKeywords[topic.keyword]);
                const isBusy = planningKeyword === topic.keyword;
                return (
                  <div
                    key={`${topic.keyword}-${topic.targetWebsite}`}
                    className="rounded-xl border border-slate-200 p-3.5 flex flex-col justify-between gap-3 hover:border-[#1E3A8A]/40 transition"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-xs sm:text-sm font-bold text-slate-900">
                          {topic.suggestedTopicTitle}
                        </h3>
                        <span className="px-2 py-0.5 rounded-md bg-blue-50 text-[#1E3A8A] text-[11px] font-semibold shrink-0">
                          {topic.targetWebsite}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mt-1.5">
                        Từ khóa gốc: <strong className="text-slate-900">{topic.keyword}</strong> ·{' '}
                        {topic.impressions.toLocaleString('vi-VN')} lượt thấy · Tỷ lệ nhấp {topic.ctrPct}%
                        {topic.avgPosition ? ` · Hạng #${topic.avgPosition}` : ''}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-1">{topic.dataEvidenceReason}</p>
                    </div>

                    <div className="pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                      {onSelectKeyword ? (
                        <button
                          type="button"
                          onClick={() => onSelectKeyword(topic.keyword)}
                          className="text-xs font-semibold text-slate-600 hover:text-[#1E3A8A] inline-flex items-center gap-1"
                        >
                          <span>Xem số liệu từ khóa</span>
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <span />
                      )}

                      {canEditContent && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {canDirectDesign ? (
                            <Link
                              href={`/design?fromBrief=1&taskCode=banner_generate&sourceModule=seo_ai&websiteDomain=${encodeURIComponent(topic.targetWebsite)}&campaignName=${encodeURIComponent(topic.suggestedTopicTitle)}${activeReport ? `&snapshotId=${encodeURIComponent(activeReport.id)}` : ''}`}
                              className="h-8 px-2.5 rounded-lg border border-blue-200 bg-blue-50/70 hover:bg-blue-100 text-[#1E3A8A] text-xs font-semibold inline-flex items-center gap-1"
                              title="Mở Brief thiết kế minh họa gắn từ khóa & snapshot SEO này"
                            >
                              <span>Tạo brief minh họa</span>
                            </Link>
                          ) : (
                            <button
                              type="button"
                              disabled={submittingBriefKw === topic.keyword}
                              onClick={() => void handleCreateTopicBrief(topic)}
                              className="h-8 px-2.5 rounded-lg border border-blue-200 bg-blue-50/70 hover:bg-blue-100 text-[#1E3A8A] text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50"
                              title="Gửi Brief thiết kế minh họa sang Studio cho Designer xử lý"
                            >
                              <span>
                                {submittingBriefKw === topic.keyword ? 'Đang gửi...' : 'Tạo brief minh họa'}
                              </span>
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={isPlanned || isBusy}
                            onClick={() => void handlePlanTopic(topic)}
                            className={`h-8 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition ${
                              isPlanned
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-[#0F275C] hover:bg-[#1E3A8A] text-white disabled:opacity-50'
                            }`}
                          >
                            {isPlanned ? (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Đã đưa vào bài nháp</span>
                              </>
                            ) : (
                              <>
                                <FilePlus2 className="w-3.5 h-3.5" />
                                <span>{isBusy ? 'Đang tạo bài...' : 'Tạo bài nháp ngay'}</span>
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
