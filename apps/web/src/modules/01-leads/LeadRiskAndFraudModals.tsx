'use client';

import React, { useState } from 'react';
import { Search, ShieldAlert, X } from 'lucide-react';
import {
  PIPELINE_STATUS_LABELS,
  type LeadItemDto,
  type PriceCheckAlertDto,
  type SessionUserDto,
} from '@toantrung/contracts';
import { apiRequest } from '@/core/http/client';
import { evaluateLeadFraudCriteria, type FraudEvaluationResult } from './leads-helpers';

export function LeadRiskAndFraudModals({
  user,
  leads,
  priceCheckAlerts,
  fraudByLeadId,
  investigativeLead,
  onCloseInvestigative,
  canEditInvestigativeLead,
  onOpenLeadDetail,
  competitorPromptLead,
  onCloseCompetitorPrompt,
  priceCheckReason,
  onChangePriceCheckReason,
  onChangePriceCheckFile,
  onSubmitPriceAlert,
  showPriceAlertDirectory,
  onClosePriceAlertDirectory,
  onDismissPriceAlertSubmit,
  submitting,
  setSubmitting,
  onRefreshLeads,
  onFeedback,
  onError,
}: {
  user: SessionUserDto | null;
  leads: LeadItemDto[];
  priceCheckAlerts: PriceCheckAlertDto[];
  fraudByLeadId: Map<number, FraudEvaluationResult>;
  investigativeLead: LeadItemDto | null;
  onCloseInvestigative: () => void;
  canEditInvestigativeLead: boolean;
  onOpenLeadDetail: (leadId: number) => void;
  competitorPromptLead: LeadItemDto | null;
  onCloseCompetitorPrompt: () => void;
  priceCheckReason: string;
  onChangePriceCheckReason: (val: string) => void;
  onChangePriceCheckFile: (file: File | null) => void;
  onSubmitPriceAlert: (e: React.FormEvent) => Promise<void> | void;
  showPriceAlertDirectory: boolean;
  onClosePriceAlertDirectory: () => void;
  onDismissPriceAlertSubmit: (alertId: number, reason: string) => Promise<void>;
  submitting: boolean;
  setSubmitting: (v: boolean) => void;
  onRefreshLeads: () => Promise<void>;
  onFeedback: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [alertStatusFilter, setAlertStatusFilter] = useState<'ACTIVE' | 'DISMISSED' | 'ALL'>('ACTIVE');
  const [alertSearchQuery, setAlertSearchQuery] = useState('');
  const [dismissingAlert, setDismissingAlert] = useState<PriceCheckAlertDto | null>(null);
  const [dismissAlertReason, setDismissAlertReason] = useState('');

  return (
    <>
      {investigativeLead && (() => {
        const evalResult =
          fraudByLeadId.get(investigativeLead.id) ||
          evaluateLeadFraudCriteria(investigativeLead, leads, priceCheckAlerts);
        return (
          <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-sm animate-in fade-in zoom-in-95 duration-150">
              <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
                <div>
                  <span className="font-mono text-xs font-bold text-[#1E3A8A]">
                    {investigativeLead.leadCode}
                  </span>
                  <h3 className="font-display font-bold text-slate-900 text-base mt-0.5">
                    Chi tiết Cảnh báo &amp; Bằng chứng Đối chiếu
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={onCloseInvestigative}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
                {evalResult.duplicateScenario === 'SCENARIO_1_ACTIVE_DUP' && (
                  <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-950 space-y-2">
                    <strong className="font-bold block text-sm">
                      Kịch bản 1 (UC01 1.5): [CẢNH BÁO TRÙNG LEAD] — Trùng khách khi Lead cũ đang mở
                    </strong>
                    <p className="text-xs leading-relaxed">
                      Khách hàng gửi thông tin qua nhiều kênh cùng lúc. Hồ sơ gốc đang mở:{' '}
                      <strong className="font-mono text-[#1E3A8A]">
                        {evalResult.matchedCustomerLead?.leadCode ||
                          investigativeLead.duplicateOfLeadCode ||
                          'Lead cũ'}
                      </strong>{' '}
                      (Phụ trách:{' '}
                      <strong>
                        {evalResult.matchedCustomerLead?.assignedSalesName ||
                          investigativeLead.assignedSalesName ||
                          'NVKD'}
                      </strong>
                      , Trạng thái:{' '}
                      <strong>
                        {evalResult.matchedCustomerLead
                          ? PIPELINE_STATUS_LABELS[evalResult.matchedCustomerLead.pipelineStatus]
                          : 'Đang mở'}
                      </strong>
                      ).
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {evalResult.matchedCustomerLead && (
                        <button
                          type="button"
                          onClick={() => {
                            const targetId = evalResult.matchedCustomerLead!.id;
                            onCloseInvestigative();
                            onOpenLeadDetail(targetId);
                          }}
                          className="h-8 px-3 rounded-lg bg-[#1E3A8A] hover:bg-blue-900 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-2xs transition"
                        >
                          <span>
                            Mở xem hồ sơ đang mở ({evalResult.matchedCustomerLead.leadCode}) →
                          </span>
                        </button>
                      )}
                      {canEditInvestigativeLead && investigativeLead.pipelineStatus !== 'lost' && (
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => {
                            void (async () => {
                              if (!user) return;
                              setSubmitting(true);
                              try {
                                await apiRequest(`/api/v1/leads/${investigativeLead.id}`, {
                                  method: 'PATCH',
                                  csrfToken: user.csrfToken,
                                  body: {
                                    action: 'transition_pipeline',
                                    expectedVersion: investigativeLead.version,
                                    toStatus: 'lost',
                                    reason: 'Trùng Lead',
                                    noteContent: `Đóng nhanh theo Kịch bản 1 (UC01 1.5) do trùng với ${
                                      evalResult.matchedCustomerLead?.leadCode ||
                                      investigativeLead.duplicateOfLeadCode ||
                                      'Lead đang mở'
                                    }`,
                                    markQuoteResponded: false,
                                    bypassPriceCheckConfirmed: false,
                                  },
                                });
                                onFeedback(
                                  `Đã đóng hồ sơ ${investigativeLead.leadCode} với lý do "Trùng Lead" (Kịch bản 1 UC01 1.5).`,
                                );
                                onCloseInvestigative();
                                await onRefreshLeads();
                              } catch (err) {
                                onError(err instanceof Error ? err.message : 'Lỗi đóng Lead trùng.');
                              } finally {
                                setSubmitting(false);
                              }
                            })();
                          }}
                          className="h-8 px-3 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-2xs transition"
                        >
                          <span>Đóng nhanh Lead này (Thất bại · Lý do: Trùng Lead)</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {evalResult.duplicateScenario === 'SCENARIO_2_WON_RETURNING' && (
                  <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-slate-900 space-y-2">
                    <strong className="font-bold block text-sm text-emerald-900">
                      [KHÁCH CŨ QUAY LẠI] — Khách đã mua hàng thành công trước đây
                    </strong>
                    <p className="text-xs leading-relaxed text-slate-700">
                      Khách hàng đã từng chốt hợp đồng thành công và nay quay lại mua dự án mới. Hồ sơ đã mua trước đây:{' '}
                      <strong className="font-mono text-emerald-900">
                        {evalResult.matchedCustomerLead?.leadCode ||
                          investigativeLead.duplicateOfLeadCode ||
                          'Hồ sơ cũ'}
                      </strong>{' '}
                      · NVKD từng phụ trách:{' '}
                      <strong>{evalResult.matchedCustomerLead?.assignedSalesName || 'NVKD cũ'}</strong> · Trạng thái cũ:{' '}
                      <strong className="text-emerald-700">Chốt thành công</strong>.
                    </p>
                    {evalResult.matchedCustomerLead && (
                      <button
                        type="button"
                        onClick={() => {
                          const targetId = evalResult.matchedCustomerLead!.id;
                          onCloseInvestigative();
                          onOpenLeadDetail(targetId);
                        }}
                        className="h-8 px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-2xs transition"
                      >
                        <span>
                          Mở xem hồ sơ đã mua ({evalResult.matchedCustomerLead.leadCode}) →
                        </span>
                      </button>
                    )}
                  </div>
                )}

                {evalResult.duplicateScenario === 'SCENARIO_2_LOST_RETURNING' && (
                  <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 text-slate-900 space-y-2">
                    <strong className="font-bold block text-sm text-[#1E3A8A]">
                      [KHÁCH QUAY LẠI] — Khách từng hỏi trước đây nhưng chưa chốt (Thất bại)
                    </strong>
                    <p className="text-xs leading-relaxed text-slate-700">
                      Khách hàng từng liên hệ trước đây nhưng chưa chốt được hợp đồng, nay quay lại hỏi lại. Hồ sơ cũ:{' '}
                      <strong className="font-mono text-[#1E3A8A]">
                        {evalResult.matchedCustomerLead?.leadCode ||
                          investigativeLead.duplicateOfLeadCode ||
                          'Hồ sơ cũ'}
                      </strong>{' '}
                      · NVKD từng phụ trách:{' '}
                      <strong>{evalResult.matchedCustomerLead?.assignedSalesName || 'NVKD cũ'}</strong> · Kết quả lần trước:{' '}
                      <strong className="text-rose-700">
                        {evalResult.matchedCustomerLead
                          ? `Thất bại${
                              evalResult.matchedCustomerLead.lostReason
                                ? ` (${evalResult.matchedCustomerLead.lostReason})`
                                : ''
                            }`
                          : 'Thất bại'}
                      </strong>
                      .
                    </p>
                    {evalResult.matchedCustomerLead && (
                      <button
                        type="button"
                        onClick={() => {
                          const targetId = evalResult.matchedCustomerLead!.id;
                          onCloseInvestigative();
                          onOpenLeadDetail(targetId);
                        }}
                        className="h-8 px-3 rounded-lg bg-[#1E3A8A] hover:bg-blue-900 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-2xs transition"
                      >
                        <span>Mở xem hồ sơ cũ ({evalResult.matchedCustomerLead.leadCode}) →</span>
                      </button>
                    )}
                  </div>
                )}

                {evalResult.duplicateScenario === 'SCENARIO_3_MULTI_CONTRACTOR' && (
                  <div className="p-4 rounded-xl bg-purple-50 border border-purple-200 text-purple-950 space-y-2">
                    <strong className="font-bold block text-sm">
                      Kịch bản 3 (UC01 1.5): [DỰ ÁN NHIỀU BÊN HỎI GIÁ] — Cùng dự án, khác nhà thầu
                    </strong>
                    <p className="text-xs leading-relaxed">
                      Có <strong>{evalResult.projectContractors.length + 1} nhà thầu</strong> đang cùng hỏi báo giá cho dự án/địa chỉ lắp đặt này.{' '}
                      <strong>Quy tắc xử lý:</strong> Không gộp Lead, không chuyển về 1 người; giữ nguyên các NVKD độc lập và báo Quản lý để đồng bộ giá sàn.
                    </p>
                    <div className="space-y-1 pt-1">
                      {evalResult.projectContractors.map((c) => (
                        <div
                          key={c.leadId}
                          className="px-2.5 py-1.5 rounded-lg bg-white border border-purple-200 flex items-center justify-between text-xs"
                        >
                          <span className="font-semibold text-slate-800 truncate">
                            {c.leadCode} · {c.companyName}
                          </span>
                          <span className="text-purple-800 font-bold shrink-0">
                            Sales: {c.assignedSalesName} ({PIPELINE_STATUS_LABELS[c.pipelineStatus]})
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {evalResult.hasPriceProbeBehavior && (
                  <div className="p-4 rounded-xl bg-orange-50 border border-orange-200 text-orange-950 space-y-1.5">
                    <strong className="font-bold block text-sm">
                      Nghi vấn khảo giá / dò giá (Không tự động quy kết là Spam)
                    </strong>
                    <p className="text-xs leading-relaxed">
                      {evalResult.priceProbeReason ||
                        'Hồ sơ có dấu hiệu hỏi đơn giá vật tư rời hoặc trùng thông tin trong danh sách cảnh báo dò giá nội bộ.'}
                    </p>
                  </div>
                )}

                {evalResult.hasDuplicatePhone && (
                  <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 space-y-1">
                    <strong className="font-bold block text-sm">
                      Phát hiện trùng số điện thoại ({evalResult.phoneSubmitCount30d} lần trong 30 ngày)
                    </strong>
                    <p className="text-xs leading-relaxed">
                      Số điện thoại <strong>{investigativeLead.phone}</strong> đã gửi yêu cầu{' '}
                      <strong>{evalResult.phoneSubmitCount30d} lần</strong>
                      {investigativeLead.duplicateOfLeadCode
                        ? ` (Trùng với hồ sơ ${investigativeLead.duplicateOfLeadCode})`
                        : ''}
                      .
                    </p>
                  </div>
                )}

                {evalResult.duplicateProjectName && (
                  <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 space-y-1">
                    <strong className="font-bold block text-sm">
                      Phát hiện trùng tên dự án: {evalResult.duplicateProjectName}
                    </strong>
                    <p className="text-xs leading-relaxed">
                      Tên công trình / dự án trùng khớp với hồ sơ{' '}
                      <strong className="font-mono text-[#1E3A8A]">
                        {evalResult.duplicateProjectPartnerCode || 'khác'}
                      </strong>{' '}
                      nhưng sử dụng thông tin liên hệ khác nhau.
                    </p>
                  </div>
                )}

                {investigativeLead.hasMissingSubjectContent && (
                  <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 space-y-1">
                    <strong className="font-bold block text-xs">
                      Biểu mẫu thiếu nội dung tiêu đề (chứa biến mẫu chưa điền)
                    </strong>
                    <p className="text-xs leading-relaxed">
                      Hệ thống đã ẩn biến mẫu khỏi bảng danh sách chính và giữ nguyên giá trị gốc trong nhật ký để kiểm tra:{' '}
                      <code className="px-1.5 py-0.5 rounded bg-white border border-amber-200 font-mono text-[11px]">
                        {investigativeLead.rawProjectName || '—'}
                      </code>
                    </p>
                  </div>
                )}

                {user && ['ADMIN', 'BOD', 'SALES_LEAD', 'MKT_LEAD'].includes(user.roleCode) && (
                  <details className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs text-slate-700">
                    <summary className="font-semibold cursor-pointer select-none">
                      Chi tiết nguồn kỹ thuật (dành cho quản lý &amp; kiểm tra)
                    </summary>
                    <div className="mt-2 space-y-1 text-[11px] text-slate-600">
                      <div>
                        Website nguồn:{' '}
                        <strong>{investigativeLead.sourceWebsite || 'Chưa xác định'}</strong>
                      </div>
                      <div>
                        Phương thức trích xuất kỹ thuật:{' '}
                        <code className="font-mono">
                          {investigativeLead.technicalSourceMethod || 'unknown'}
                        </code>
                      </div>
                      <div>
                        Kênh marketing chuẩn hóa:{' '}
                        <strong>
                          {investigativeLead.tracking?.marketingSource || 'Chưa xác định'}
                        </strong>
                      </div>
                      {investigativeLead.tracking?.landingPageUrl && (
                        <div className="break-all">
                          Landing URL: {investigativeLead.tracking.landingPageUrl}
                        </div>
                      )}
                    </div>
                  </details>
                )}

                {evalResult.hasBlacklistedOrSpam && investigativeLead.spamStatus !== 'NONE' && (
                  <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-950 space-y-1">
                    <strong className="font-bold block text-sm">
                      Cờ Spam (
                      {investigativeLead.spamStatus === 'CONFIRMED'
                        ? 'Đã xác nhận loại trừ'
                        : 'Đang chờ duyệt'}
                      )
                    </strong>
                    <p className="text-xs leading-relaxed">
                      Lý do ghi nhận:{' '}
                      <strong>
                        {investigativeLead.spamReason ||
                          evalResult.spamOrBurnerReason ||
                          'Chưa cập nhật'}
                      </strong>
                    </p>
                  </div>
                )}
              </div>

              <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onCloseInvestigative}
                  className="h-9 px-4 rounded-xl border border-slate-200 bg-white font-semibold text-slate-600"
                >
                  Đóng
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const targetId = investigativeLead.id;
                    onCloseInvestigative();
                    onOpenLeadDetail(targetId);
                  }}
                  className="h-9 px-4 rounded-xl bg-[#1E3A8A] hover:bg-[#2563EB] text-white font-bold"
                >
                  Sửa thông tin Lead
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {competitorPromptLead && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-orange-200 overflow-hidden text-sm animate-in fade-in zoom-in-95 duration-150">
            <div className="px-5 py-4 bg-orange-50 border-b border-orange-200 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-orange-600 shrink-0" />
                <h3 className="font-display font-bold text-orange-950 text-base">
                  Đăng Cảnh báo Dò giá Nội bộ? (UC01 4.6f)
                </h3>
              </div>
              <button
                type="button"
                onClick={onCloseCompetitorPrompt}
                className="p-1 rounded-lg text-orange-700 hover:bg-orange-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={(e) => void onSubmitPriceAlert(e)} className="p-5 space-y-3.5">
              <p className="text-xs text-slate-600 leading-relaxed">
                Bạn vừa đóng hồ sơ{' '}
                <strong className="font-mono text-[#1E3A8A]">{competitorPromptLead.leadCode}</strong>{' '}
                ({competitorPromptLead.companyName || competitorPromptLead.phone}) với lý do{' '}
                <strong>&quot;Đối thủ khảo giá&quot;</strong>. Bạn có muốn đăng cảnh báo lên danh sách nội bộ để toàn công ty cảnh giác không?
              </p>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Căn cứ nghi ngờ dò giá *
                </label>
                <input
                  type="text"
                  required
                  value={priceCheckReason}
                  onChange={(e) => onChangePriceCheckReason(e.target.value)}
                  placeholder="VD: Hỏi giá rời nhiều kích thước P2/P3 nhưng từ chối cho địa chỉ khảo sát..."
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-orange-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Ảnh chụp cuộc trò chuyện (Không bắt buộc)
                </label>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => onChangePriceCheckFile(e.target.files?.[0] || null)}
                  className="text-xs w-full"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onCloseCompetitorPrompt}
                  className="h-9 px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-semibold"
                >
                  Bỏ qua
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="h-9 px-4 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold shadow-2xs"
                >
                  {submitting ? 'Đang đăng...' : 'Đăng cảnh báo dò giá'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showPriceAlertDirectory && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white w-full max-w-4xl max-h-[88vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden text-sm animate-in fade-in zoom-in-95 duration-150">
            <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-orange-600 text-white grid place-items-center shrink-0">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="font-display font-bold text-slate-900 text-base sm:text-lg">
                    Danh sách Cảnh báo Dò giá Nội bộ (UC01 5.2 &amp; 5.3)
                  </h2>
                  <p className="text-xs text-slate-500">
                    Tra cứu SĐT, công ty nghi đối thủ khảo giá để tránh bị khai thác thông tin giá B2B Toàn Trung
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClosePriceAlertDirectory();
                  setDismissingAlert(null);
                }}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 border-b border-slate-200 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-1.5">
                {(
                  [
                    {
                      id: 'ACTIVE',
                      label: `Đang hiển thị (${priceCheckAlerts.filter((a) => a.status === 'ACTIVE').length})`,
                    },
                    {
                      id: 'DISMISSED',
                      label: `Đã gỡ (${priceCheckAlerts.filter((a) => a.status === 'DISMISSED').length})`,
                    },
                    { id: 'ALL', label: `Tất cả (${priceCheckAlerts.length})` },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setAlertStatusFilter(tab.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                      alertStatusFilter === tab.id
                        ? 'bg-orange-600 text-white shadow-2xs'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200/70'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="relative w-full sm:w-72">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={alertSearchQuery}
                  onChange={(e) => setAlertSearchQuery(e.target.value)}
                  placeholder="Tìm theo SĐT, Tên công ty, Mã Lead..."
                  className="w-full h-9 pl-9 pr-3 rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-orange-600"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50">
              {priceCheckAlerts
                .filter((a) => {
                  if (alertStatusFilter !== 'ALL' && a.status !== alertStatusFilter) return false;
                  if (!alertSearchQuery.trim()) return true;
                  const q = alertSearchQuery.trim().toLowerCase();
                  return (
                    a.phone.toLowerCase().includes(q) ||
                    (a.companyName || '').toLowerCase().includes(q) ||
                    a.leadCode.toLowerCase().includes(q) ||
                    a.reasonEvidence.toLowerCase().includes(q)
                  );
                })
                .map((alert) => {
                  const canDismissThisAlert =
                    alert.status === 'ACTIVE' &&
                    user &&
                    (alert.reportedById === user.id || user.roleCode === 'ADMIN');
                  return (
                    <div
                      key={alert.id}
                      className={`p-4 rounded-xl border bg-white shadow-2xs space-y-2.5 ${
                        alert.status === 'ACTIVE' ? 'border-orange-200' : 'border-slate-200 opacity-75'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="space-y-0.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${
                                alert.status === 'ACTIVE'
                                  ? 'bg-orange-100 text-orange-900 border border-orange-300'
                                  : 'bg-slate-100 text-slate-600 border border-slate-200'
                              }`}
                            >
                              {alert.status === 'ACTIVE' ? 'Đang hiển thị' : 'Đã gỡ'}
                            </span>
                            <span className="font-mono font-bold text-[#1E3A8A] text-sm">
                              SĐT: {alert.phone}
                            </span>
                            {alert.companyName && (
                              <span className="font-bold text-slate-900 text-sm">
                                · {alert.companyName}
                              </span>
                            )}
                            <span className="text-xs font-mono text-slate-500">
                              ({alert.leadCode})
                            </span>
                          </div>
                          <p className="text-xs text-slate-500">
                            Người đăng: <strong className="text-slate-700">{alert.reportedByName}</strong> · Thời điểm:{' '}
                            {new Date(alert.createdAt).toLocaleString('vi-VN')}
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          {alert.chatScreenshotDownloadUrl && (
                            <a
                              href={alert.chatScreenshotDownloadUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="h-8 px-3 rounded-lg bg-blue-50 hover:bg-blue-100 border border-blue-200 text-[#1E3A8A] text-xs font-bold inline-flex items-center gap-1"
                            >
                              <span>Xem ảnh chụp đoạn chat</span>
                            </a>
                          )}
                          {canDismissThisAlert && (
                            <button
                              type="button"
                              onClick={() => {
                                setDismissingAlert(alert);
                                setDismissAlertReason('');
                              }}
                              className="h-8 px-3 rounded-lg bg-slate-100 hover:bg-rose-50 hover:text-rose-700 border border-slate-200 text-slate-700 text-xs font-bold transition"
                            >
                              Gỡ cảnh báo (5.3)
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="p-3 rounded-lg bg-orange-50/60 border border-orange-100 text-xs text-slate-800 whitespace-pre-line">
                        <strong>Căn cứ &amp; Nhật ký cảnh báo:</strong> {alert.reasonEvidence}
                      </div>

                      {dismissingAlert?.id === alert.id && (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (!dismissAlertReason.trim()) return;
                            void onDismissPriceAlertSubmit(alert.id, dismissAlertReason.trim()).then(
                              () => {
                                setDismissingAlert(null);
                                setDismissAlertReason('');
                              },
                            );
                          }}
                          className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
                        >
                          <input
                            type="text"
                            required
                            value={dismissAlertReason}
                            onChange={(e) => setDismissAlertReason(e.target.value)}
                            placeholder="Nhập lý do gỡ bắt buộc (VD: Nhầm khách thật, đã xác minh địa chỉ công trình)..."
                            className="flex-1 h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs"
                          />
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => setDismissingAlert(null)}
                              className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600"
                            >
                              Hủy
                            </button>
                            <button
                              type="submit"
                              disabled={submitting}
                              className="h-9 px-3.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold"
                            >
                              Xác nhận gỡ cảnh báo
                            </button>
                          </div>
                        </form>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
export default LeadRiskAndFraudModals;
