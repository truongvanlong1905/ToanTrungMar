'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Calculator,
  CheckCircle2,
  ExternalLink,
  Layers,
  MessageSquarePlus,
  Phone,
  Sparkles,
  UserCheck,
} from 'lucide-react';
import {
  CONTACT_CHANNEL_LABELS,
  LOST_REASONS,
  PIPELINE_STATUSES,
  PIPELINE_STATUS_LABELS,
  type LeadItemDto,
  type PipelineStatus,
  type SessionUserDto,
} from '@toantrung/contracts';
import { apiRequest } from '@/core/http/client';
import { formatCompactLeadCode, STATUS_BADGE_STYLES } from './leads-helpers';
import { SmartHandoverBriefCard } from './SmartHandoverBriefCard';

export function LeadSplitTriageView({
  leads,
  allScopedLeads,
  user,
  canEditLead,
  onOpenFullModal,
  onOpenLedSpec,
  onRefreshLeads,
  onFeedback,
  onError,
}: {
  leads: LeadItemDto[];
  allScopedLeads: LeadItemDto[];
  user: SessionUserDto | null;
  canEditLead: (lead: LeadItemDto) => boolean;
  onOpenFullModal: (leadId: number) => void;
  onOpenLedSpec: (lead: LeadItemDto) => void;
  onRefreshLeads: () => Promise<void>;
  onFeedback: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [activeId, setActiveId] = useState<number | null>(leads[0]?.id ?? null);
  const [quickNote, setQuickNote] = useState('');
  const [targetStatus, setTargetStatus] = useState<PipelineStatus>('quoting');
  const [lostReason, setLostReason] = useState<string>(LOST_REASONS[0]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (leads.length === 0) {
      setActiveId(null);
      return;
    }
    if (!activeId || !leads.some((l) => l.id === activeId)) {
      setActiveId(leads[0].id);
    }
  }, [leads, activeId]);

  const currentIdx = useMemo(
    () => Math.max(0, leads.findIndex((l) => l.id === activeId)),
    [leads, activeId],
  );
  const activeLead = leads[currentIdx] || null;

  useEffect(() => {
    if (activeLead) {
      setTargetStatus(activeLead.pipelineStatus);
    }
  }, [activeLead]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (leads.length === 0) return;
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        const next = Math.min(leads.length - 1, currentIdx + 1);
        setActiveId(leads[next].id);
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        const prev = Math.max(0, currentIdx - 1);
        setActiveId(leads[prev].id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [leads, currentIdx]);

  // Customer 360° Timeline: group all historical leads sharing phone or companyName
  const customer360Stages = useMemo(() => {
    if (!activeLead || activeLead.isAnonymized) return [];
    const cleanPhone = (activeLead.phone || '').replace(/\D/g, '');
    const normComp = (activeLead.companyName || '').trim().toLowerCase();
    return allScopedLeads
      .filter((other) => {
        if (other.spamStatus !== 'NONE') return false;
        const oPhone = (other.phone || '').replace(/\D/g, '');
        const phoneMatch = cleanPhone.length >= 8 && !cleanPhone.includes('*') && oPhone === cleanPhone;
        const compMatch =
          normComp.length >= 5 && (other.companyName || '').trim().toLowerCase() === normComp;
        return phoneMatch || compMatch;
      })
      .sort((a, b) => Date.parse(a.contactedAt) - Date.parse(b.contactedAt));
  }, [activeLead, allScopedLeads]);

  if (leads.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
        Không có hồ sơ Lead nào trong bộ lọc hiện tại để duyệt nhanh 2 cột.
      </div>
    );
  }

  const editable = activeLead ? canEditLead(activeLead) : false;

  const handleQuickReceive = async () => {
    if (!user || !activeLead || busy) return;
    setBusy(true);
    try {
      await apiRequest(`/api/v1/leads/${activeLead.id}`, {
        method: 'PATCH',
        csrfToken: user.csrfToken,
        body: {
          action: 'confirm_receive',
          expectedVersion: activeLead.version,
        },
      });
      onFeedback(`Đã xác nhận tiếp nhận ${activeLead.leadCode}.`);
      await onRefreshLeads();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Không thể xác nhận tiếp nhận.');
    } finally {
      setBusy(false);
    }
  };

  const handleQuickAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !activeLead || !quickNote.trim() || busy) return;
    setBusy(true);
    try {
      await apiRequest(`/api/v1/leads/${activeLead.id}`, {
        method: 'PATCH',
        csrfToken: user.csrfToken,
        body: {
          action: 'add_note',
          expectedVersion: activeLead.version,
          noteContent: quickNote.trim(),
        },
      });
      setQuickNote('');
      onFeedback(`Đã thêm ghi chú nhanh cho ${activeLead.leadCode}.`);
      await onRefreshLeads();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Không thể lưu ghi chú.');
    } finally {
      setBusy(false);
    }
  };

  const handleQuickPipelineUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !activeLead || busy || targetStatus === activeLead.pipelineStatus) return;
    setBusy(true);
    try {
      await apiRequest(`/api/v1/leads/${activeLead.id}`, {
        method: 'PATCH',
        csrfToken: user.csrfToken,
        body: {
          action: 'transition_pipeline',
          expectedVersion: activeLead.version,
          toStatus: targetStatus,
          reason: targetStatus === 'lost' ? lostReason : undefined,
          noteContent:
            quickNote.trim() ||
            `Cập nhật nhanh từ chế độ Duyệt 2 Cột sang "${PIPELINE_STATUS_LABELS[targetStatus]}"`,
        },
      });
      setQuickNote('');
      onFeedback(
        `Đã chuyển ${activeLead.leadCode} sang "${PIPELINE_STATUS_LABELS[targetStatus]}".`,
      );
      await onRefreshLeads();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Không thể chuyển trạng thái Pipeline.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-start">
      {/* Left Queue (4/12) */}
      <div className="lg:col-span-4 rounded-2xl border border-slate-200/90 bg-white shadow-2xs overflow-hidden flex flex-col max-h-[75vh]">
        <div className="px-3.5 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
          <span className="font-bold text-slate-800">
            Hàng đợi duyệt nhanh ({currentIdx + 1}/{leads.length})
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
            <kbd className="px-1.5 py-0.5 rounded bg-white border border-slate-200 font-mono text-[10px]">
              <ArrowUp className="w-2.5 h-2.5 inline" />
              <ArrowDown className="w-2.5 h-2.5 inline" />
            </kbd>
            Lướt nhanh
          </span>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {leads.map((item) => {
            const selected = item.id === activeLead?.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveId(item.id)}
                className={`w-full p-3 text-left transition flex flex-col gap-1 ${
                  selected
                    ? 'bg-blue-50/90 border-l-4 border-l-[#1E3A8A]'
                    : 'hover:bg-slate-50 border-l-4 border-l-transparent'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] font-bold text-[#1E3A8A]">
                    {formatCompactLeadCode(item.leadCode)}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${
                      STATUS_BADGE_STYLES[item.pipelineStatus]
                    }`}
                  >
                    {PIPELINE_STATUS_LABELS[item.pipelineStatus]}
                  </span>
                </div>
                <div className="text-xs font-bold text-slate-900 truncate">
                  {item.companyName || item.contactName || item.phone}
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span className="font-mono">{item.phone}</span>
                  <span className="truncate max-w-[130px]">
                    {item.assignedSalesName || 'Chưa gán'}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right Pinned Detail + Customer 360° (8/12) */}
      {activeLead && (
        <div className="lg:col-span-8 rounded-2xl border border-slate-200/90 bg-white shadow-2xs overflow-hidden flex flex-col max-h-[75vh]">
          {/* Header */}
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/60 flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-blue-50 border border-blue-200 font-mono text-xs font-bold text-[#1E3A8A]">
                  {activeLead.leadCode}
                </span>
                <h3 className="font-display font-bold text-base text-slate-900 truncate">
                  {activeLead.companyName || activeLead.contactName || activeLead.phone}
                </h3>
                {!activeLead.receivedConfirmedAt && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[11px] font-bold">
                    Chờ tiếp nhận
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
                <span className="inline-flex items-center gap-1 font-mono font-bold text-slate-800">
                  <Phone className="w-3.5 h-3.5 text-slate-400" />
                  {activeLead.phone}
                </span>
                <span>
                  Nguồn:{' '}
                  <strong>
                    {activeLead.tracking?.marketingSource ||
                      CONTACT_CHANNEL_LABELS[activeLead.contactChannel] ||
                      activeLead.contactChannel}
                  </strong>
                </span>
                <span>
                  Sales: <strong>{activeLead.assignedSalesName || 'Chưa phân bổ'}</strong>
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {editable && !activeLead.receivedConfirmedAt && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleQuickReceive()}
                  className="h-8 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <UserCheck className="w-3.5 h-3.5" />
                  <span>Tiếp nhận ngay</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onOpenLedSpec(activeLead)}
                className="h-8 px-3 rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100 text-[#0F275C] text-xs font-bold inline-flex items-center gap-1.5"
              >
                <Calculator className="w-3.5 h-3.5" />
                <span>Phiếu Kỹ thuật LED</span>
              </button>
              <button
                type="button"
                onClick={() => onOpenFullModal(activeLead.id)}
                className="h-8 px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1"
              >
                <span>Mở đầy đủ &amp; Tệp</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
            {/* Zero-PII 3-Second Smart Handover Brief */}
            <SmartHandoverBriefCard key={activeLead.id} leadId={activeLead.id} user={user} />

            {/* Customer 360° Multi-Stage Timeline */}
            {customer360Stages.length > 1 && (
              <div className="p-3.5 rounded-xl bg-gradient-to-r from-indigo-50/80 via-blue-50/60 to-emerald-50/60 border border-indigo-200/80 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#0F275C] inline-flex items-center gap-1.5 text-xs">
                    <Layers className="w-4 h-4 text-indigo-600" />
                    <span>Hồ sơ Khách hàng 360° ({customer360Stages.length} đợt dự án liên kết)</span>
                  </span>
                  <span className="text-[11px] text-slate-500">Tự động gom theo SĐT &amp; Pháp nhân</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {customer360Stages.map((st, idx) => (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => setActiveId(st.id)}
                      className={`p-2.5 rounded-xl border text-left transition ${
                        st.id === activeLead.id
                          ? 'bg-white border-[#1E3A8A] ring-2 ring-blue-500/15'
                          : 'bg-white/80 border-slate-200 hover:bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-[#0F275C]">
                          Giai đoạn {idx + 1}: {formatCompactLeadCode(st.leadCode)}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            STATUS_BADGE_STYLES[st.pipelineStatus]
                          }`}
                        >
                          {PIPELINE_STATUS_LABELS[st.pipelineStatus]}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-700 font-medium truncate mt-0.5">
                        {st.projectName || st.products.map((p) => p.productName).join(', ') || 'Dự án màn hình LED'}
                      </div>
                      <div className="text-[10.5px] text-slate-400 mt-0.5">
                        {new Date(st.contactedAt).toLocaleDateString('vi-VN')} · Sales: {st.assignedSalesName || '—'}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Summary Specs */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                <div className="text-[11px] text-slate-500">Dự án / Hạng mục</div>
                <div className="font-bold text-slate-900 mt-0.5">
                  {activeLead.projectName || 'Chưa đặt tên công trình'}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                <div className="text-[11px] text-slate-500">Sản phẩm quan tâm</div>
                <div className="font-bold text-[#0F275C] mt-0.5">
                  {activeLead.products.map((p) => p.productName).join(', ') || 'Chưa phân loại'}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                <div className="text-[11px] text-slate-500">Địa điểm lắp đặt</div>
                <div className="font-bold text-slate-900 mt-0.5 truncate">
                  {activeLead.installationAddress || activeLead.province || 'Chưa cập nhật'}
                </div>
              </div>
            </div>

            {/* Quick Pipeline & Note Action */}
            {editable && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <form
                  onSubmit={(e) => void handleQuickPipelineUpdate(e)}
                  className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2.5"
                >
                  <div className="font-bold text-slate-800 inline-flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#1E3A8A]" />
                    <span>Cập nhật nhanh Tiến độ Pipeline</span>
                  </div>
                  <select
                    value={targetStatus}
                    onChange={(e) => setTargetStatus(e.target.value as PipelineStatus)}
                    className="w-full h-9 px-3 rounded-xl border border-slate-200 bg-white font-semibold text-slate-800"
                  >
                    {PIPELINE_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {PIPELINE_STATUS_LABELS[st]}
                      </option>
                    ))}
                  </select>
                  {targetStatus === 'lost' && (
                    <select
                      value={lostReason}
                      onChange={(e) => setLostReason(e.target.value)}
                      className="w-full h-9 px-3 rounded-xl border border-rose-200 bg-rose-50/50 font-semibold text-rose-900"
                    >
                      {LOST_REASONS.map((r) => (
                        <option key={r} value={r}>
                          Lý do thất bại: {r}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="submit"
                    disabled={busy || targetStatus === activeLead.pipelineStatus}
                    className="w-full h-8 rounded-xl bg-[#0F275C] hover:bg-[#1E3A8A] text-white font-bold disabled:opacity-40 transition"
                  >
                    Lưu trạng thái mới
                  </button>
                </form>

                <form
                  onSubmit={(e) => void handleQuickAddNote(e)}
                  className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2.5"
                >
                  <div className="font-bold text-slate-800 inline-flex items-center gap-1.5">
                    <MessageSquarePlus className="w-3.5 h-3.5 text-emerald-700" />
                    <span>Ghi chú trao đổi tức thì</span>
                  </div>
                  <textarea
                    rows={2}
                    value={quickNote}
                    onChange={(e) => setQuickNote(e.target.value)}
                    placeholder="Ghi nhanh kết quả cuộc gọi, kích thước khảo sát, lịch hẹn..."
                    className="w-full p-2.5 rounded-xl border border-slate-200 bg-white focus:outline-none focus:border-[#1E3A8A]"
                  />
                  <button
                    type="submit"
                    disabled={busy || !quickNote.trim()}
                    className="w-full h-8 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold disabled:opacity-40 transition"
                  >
                    Lưu ghi chú
                  </button>
                </form>
              </div>
            )}

            {/* Recent Activities */}
            <div className="space-y-2">
              <div className="font-bold text-slate-800 flex items-center justify-between">
                <span>Nhật ký trao đổi &amp; Bàn giao gần đây ({activeLead.activities?.length || 0})</span>
                <span className="text-[11px] text-slate-400 font-normal inline-flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> Đồng bộ tức thì
                </span>
              </div>
              <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                {(activeLead.activities || []).slice(0, 8).map((act) => (
                  <div
                    key={act.id}
                    className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/75 flex items-start justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <span className="font-semibold text-slate-800">{act.actorName}: </span>
                      <span className="text-slate-600">
                        {act.noteContent || act.reason || act.actionType}
                      </span>
                    </div>
                    <span className="text-[10.5px] text-slate-400 shrink-0 tabular-nums">
                      {new Date(act.createdAt).toLocaleString('vi-VN')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
export default LeadSplitTriageView;
