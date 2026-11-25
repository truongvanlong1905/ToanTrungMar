'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  Download,
  FileText,
  Printer,
  Save,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { hasBaPermission, type LeadItemDto, type SessionUserDto } from '@toantrung/contracts';
import { apiRequest } from '@/core/http/client';

interface SpecEvaluationResponse {
  specCode: string;
  recommendedPitch: string;
  pitchReason: string;
  suggestedCabinetCode: string;
  environmentLabel: string;
  hdComparisonLabel: string;
  avgKw: string;
  maxKw: string;
  breakerNote: string;
  docHtml: string | null;
  availableCabinets: Array<{ modelCode: string; modelName: string; environment: string }>;
  evaluation: {
    feasibilityStatus: string;
    statusLabel: string;
    widthMm: number | null;
    heightMm: number | null;
    areaM2: number | null;
    pixelPitch: string | null;
    theoreticalResolutionWidthPx: number | null;
    theoreticalResolutionHeightPx: number | null;
    moduleDimensionsMm: string;
    cabinetDimensionsMm: string;
    cabinetModelCode: string;
    cabinetCols: number | null;
    cabinetRows: number | null;
    cabinetCount: number | null;
    moduleCols: number | null;
    moduleRows: number | null;
    moduleCount: number | null;
    estimatedWeightKg: number | null;
    warnings: string[];
    bomItems: Array<{
      itemCode: string;
      itemName: string;
      quantity: number | null;
      unit: string;
      notes: string;
    }>;
  };
}

export function LedTechnicalSpecSheetModal({
  open,
  onClose,
  user,
  lead,
  onSavedToLead,
}: {
  open: boolean;
  onClose: () => void;
  user: SessionUserDto | null;
  lead: LeadItemDto | null;
  onSavedToLead?: (msg: string) => void;
}) {
  const router = useRouter();
  const [widthM, setWidthM] = useState<number>(4.8);
  const [heightM, setHeightM] = useState<number>(2.7);
  const [viewingDistanceM, setViewingDistanceM] = useState<number>(4);
  const [environment, setEnvironment] = useState<'indoor' | 'outdoor' | 'semi_outdoor'>('indoor');
  const [pixelPitch, setPixelPitch] = useState<string>('AUTO');
  const [cabinetModelCode, setCabinetModelCode] = useState<string>('AUTO');
  const [screenStyle, setScreenStyle] = useState<'flat' | 'curved' | 'corner_90'>('flat');
  const [projectTitle, setProjectTitle] = useState<string>('');
  const [customerOrg, setCustomerOrg] = useState<string>('');

  const [specData, setSpecData] = useState<SpecEvaluationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingLead, setSavingLead] = useState(false);
  const [exportingDoc, setExportingDoc] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setProjectTitle(lead?.projectName || 'Hệ thống Màn hình LED Trình chiếu Trung tâm');
    setCustomerOrg(
      lead && !lead.isAnonymized
        ? lead.companyName || lead.contactName || 'Quý Khách hàng Doanh nghiệp'
        : 'Khách hàng Doanh nghiệp Toàn Trung',
    );
    setToastMsg(null);
  }, [open, lead]);

  const computeSpec = useCallback(async () => {
    if (!open || !user) return;
    setLoading(true);
    try {
      const res = await apiRequest<SpecEvaluationResponse>('/api/v1/leads/led-spec-sheet', {
        method: 'POST',
        csrfToken: user.csrfToken,
        body: {
          action: 'calculate',
          leadId: lead?.id ?? null,
          projectTitle,
          customerOrg,
          widthM,
          heightM,
          viewingDistanceM,
          environment,
          pixelPitch,
          cabinetModelCode,
          screenStyle,
        },
      });
      setSpecData(res);
    } catch {
      // ignore transient error
    } finally {
      setLoading(false);
    }
  }, [
    open,
    user,
    lead?.id,
    projectTitle,
    customerOrg,
    widthM,
    heightM,
    viewingDistanceM,
    environment,
    pixelPitch,
    cabinetModelCode,
    screenStyle,
  ]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      void computeSpec();
    }, 120);
    return () => window.clearTimeout(t);
  }, [open, computeSpec]);

  if (!open || !user) return null;

  const handleDownloadWordDoc = async (printAsPdf = false) => {
    setExportingDoc(true);
    try {
      const res = await apiRequest<SpecEvaluationResponse>('/api/v1/leads/led-spec-sheet', {
        method: 'POST',
        csrfToken: user.csrfToken,
        body: {
          action: 'export_doc',
          leadId: lead?.id ?? null,
          projectTitle,
          customerOrg,
          widthM,
          heightM,
          viewingDistanceM,
          environment,
          pixelPitch,
          cabinetModelCode,
          screenStyle,
        },
      });
      if (!res.docHtml) return;

      if (printAsPdf) {
        const win = window.open('', '_blank', 'width=960,height=800');
        if (win) {
          win.document.open();
          win.document.write(res.docHtml);
          win.document.close();
          win.focus();
          window.setTimeout(() => win.print(), 250);
        }
      } else {
        const blob = new Blob(['\ufeff', res.docHtml], {
          type: 'application/msword;charset=utf-8',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${res.specCode}_${(lead?.leadCode || 'ToanTrung').replace(/[^a-zA-Z0-9_-]/g, '')}.doc`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setToastMsg(`Đã tải xuống Phiếu Đề xuất Kỹ thuật Word (${res.specCode}).`);
      }
    } finally {
      setExportingDoc(false);
    }
  };

  const handleSaveSpecToLead = async () => {
    if (!lead) return;
    setSavingLead(true);
    try {
      const res = await apiRequest<SpecEvaluationResponse>('/api/v1/leads/led-spec-sheet', {
        method: 'POST',
        csrfToken: user.csrfToken,
        body: {
          action: 'save_to_lead',
          leadId: lead.id,
          projectTitle,
          customerOrg,
          widthM,
          heightM,
          viewingDistanceM,
          environment,
          pixelPitch,
          cabinetModelCode,
          screenStyle,
        },
      });
      const msg = `Đã lưu cấu hình kỹ thuật ${res.specCode} vào lịch sử hồ sơ ${lead.leadCode}.`;
      setToastMsg(msg);
      onSavedToLead?.(msg);
    } finally {
      setSavingLead(false);
    }
  };

  const ev = specData?.evaluation;

  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-5xl max-h-[92vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden text-xs sm:text-sm">
        {/* Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-[#0B1D48] to-[#1E3A8A] text-white flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/15 grid place-items-center shrink-0">
              <Calculator className="w-5 h-5 text-sky-200" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display font-bold text-base sm:text-lg">
                  Phiếu Đề Xuất Cấu Hình Kỹ Thuật Màn Hình LED B2B
                </h2>
                {specData?.specCode && (
                  <span className="px-2 py-0.5 rounded-md bg-white/15 font-mono text-[11px] font-bold">
                    {specData.specCode}
                  </span>
                )}
              </div>
              <p className="text-xs text-sky-100/90 mt-0.5">
                Chuẩn hóa thông số Cabinet, Pixel Pitch, Độ phân giải &amp; Nguồn điện (Không chứa đơn giá thương mại theo chuẩn BA)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/15"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-slate-50/50">
          {toastMsg && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-semibold flex items-center justify-between">
              <span>{toastMsg}</span>
              <button type="button" onClick={() => setToastMsg(null)} className="font-bold">
                ×
              </button>
            </div>
          )}

          {/* Input Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-5 rounded-2xl bg-white border border-slate-200 p-4 space-y-3 shadow-2xs">
              <div className="font-bold text-slate-900 text-sm border-b border-slate-100 pb-2">
                1. Thông số Khảo sát Mặt bằng
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Chiều ngang (m)
                  </label>
                  <input
                    type="number"
                    step="0.08"
                    min="0.5"
                    value={widthM}
                    onChange={(e) => setWidthM(Number(e.target.value) || 1)}
                    className="w-full h-9 px-3 rounded-xl border border-slate-200 font-bold text-[#0F275C]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Chiều cao (m)
                  </label>
                  <input
                    type="number"
                    step="0.08"
                    min="0.5"
                    value={heightM}
                    onChange={(e) => setHeightM(Number(e.target.value) || 1)}
                    className="w-full h-9 px-3 rounded-xl border border-slate-200 font-bold text-[#0F275C]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Môi trường lắp đặt
                  </label>
                  <select
                    value={environment}
                    onChange={(e) => {
                      setEnvironment(e.target.value as typeof environment);
                      setPixelPitch('AUTO');
                      setCabinetModelCode('AUTO');
                    }}
                    className="w-full h-9 px-2.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold"
                  >
                    <option value="indoor">Trong nhà (Indoor)</option>
                    <option value="outdoor">Ngoài trời (Outdoor IP65)</option>
                    <option value="semi_outdoor">Bán ngoài trời</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Tầm nhìn gần nhất (m)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="1"
                    value={viewingDistanceM}
                    onChange={(e) => setViewingDistanceM(Number(e.target.value) || 3)}
                    className="w-full h-9 px-3 rounded-xl border border-slate-200 font-semibold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Dòng Pixel Pitch
                  </label>
                  <select
                    value={pixelPitch}
                    onChange={(e) => setPixelPitch(e.target.value)}
                    className="w-full h-9 px-2.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold"
                  >
                    <option value="AUTO">
                      ✨ Tự động tối ưu ({specData?.recommendedPitch || 'P2.5'})
                    </option>
                    {['P1.25', 'P1.53', 'P1.86', 'P2.0', 'P2.5', 'P3.076', 'P4.0', 'P5.0', 'P8.0', 'P10.0'].map(
                      (p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ),
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Chuẩn Cabinet / Khung
                  </label>
                  <select
                    value={cabinetModelCode}
                    onChange={(e) => setCabinetModelCode(e.target.value)}
                    className="w-full h-9 px-2.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold"
                  >
                    <option value="AUTO">✨ Tự động chuẩn hãng</option>
                    <option value="CAB_640_480">Cabinet 640×480mm (Indoor 4:3)</option>
                    <option value="CAB_600_3375">Cabinet 600×337.5mm (UHD 16:9)</option>
                    <option value="CAB_960_960">Cabinet 960×960mm (Outdoor IP65)</option>
                    <option value="CAB_500_500">Cabinet 500×500mm (Sự kiện)</option>
                    <option value="MODULE_320_160_FRAME">Khung sắt ghép Module 320×160mm</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Kiểu mặt phẳng
                  </label>
                  <select
                    value={screenStyle}
                    onChange={(e) => setScreenStyle(e.target.value as typeof screenStyle)}
                    className="w-full h-9 px-2.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold"
                  >
                    <option value="flat">Phẳng tiêu chuẩn</option>
                    <option value="curved">Vách cong (Curved)</option>
                    <option value="corner_90">Vuông góc 90° (3D)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Hạng mục dự án
                  </label>
                  <input
                    type="text"
                    value={projectTitle}
                    onChange={(e) => setProjectTitle(e.target.value)}
                    className="w-full h-9 px-2.5 rounded-xl border border-slate-200 text-xs font-medium"
                  />
                </div>
              </div>
            </div>

            {/* Output Summary */}
            <div className="lg:col-span-7 rounded-2xl bg-white border border-slate-200 p-4 space-y-3 shadow-2xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="font-bold text-slate-900 text-sm">
                  2. Kết quả Tính toán Kỹ thuật Chính xác
                </span>
                {loading ? (
                  <span className="text-xs text-slate-400">Đang tính toán...</span>
                ) : ev?.feasibilityStatus === 'exact_match' ? (
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-bold inline-flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Khớp chẵn 100% Cabinet
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-bold inline-flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Có gợi ý chỉnh chẵn Cabinet
                  </span>
                )}
              </div>

              {specData && ev && (
                <>
                  <div className="p-3 rounded-xl bg-blue-50/70 border border-blue-200 text-xs text-slate-800">
                    <strong className="text-[#0F275C]">Tư vấn dòng {ev.pixelPitch}:</strong>{' '}
                    {specData.pitchReason}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                      <div className="text-[11px] text-slate-500">Phương án ghép</div>
                      <div className="text-sm font-extrabold text-[#0F275C] mt-0.5 tabular-nums">
                        {ev.cabinetCols} × {ev.cabinetRows} = {ev.cabinetCount} bộ
                      </div>
                      <div className="text-[10.5px] text-slate-500">{ev.moduleCount} tấm module</div>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                      <div className="text-[11px] text-slate-500">Độ phân giải thực</div>
                      <div className="text-sm font-extrabold text-slate-900 mt-0.5 tabular-nums">
                        {ev.theoreticalResolutionWidthPx} × {ev.theoreticalResolutionHeightPx}
                      </div>
                      <div className="text-[10.5px] text-emerald-700 font-semibold truncate">
                        {specData.hdComparisonLabel}
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                      <div className="text-[11px] text-slate-500">Công suất nguồn</div>
                      <div className="text-sm font-extrabold text-slate-900 mt-0.5 tabular-nums inline-flex items-center gap-1">
                        <Zap className="w-3.5 h-3.5 text-amber-500" />
                        {specData.avgKw} / {specData.maxKw} kW
                      </div>
                      <div className="text-[10.5px] text-slate-500">TB / Cực đại</div>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                      <div className="text-[11px] text-slate-500">Diện tích &amp; Tải trọng</div>
                      <div className="text-sm font-extrabold text-slate-900 mt-0.5 tabular-nums">
                        {ev.areaM2} m² · ~{ev.estimatedWeightKg} kg
                      </div>
                      <div className="text-[10.5px] text-slate-500 truncate">{specData.breakerNote}</div>
                    </div>
                  </div>

                  {ev.warnings.length > 0 && (
                    <div className="p-3 rounded-xl bg-amber-50/80 border border-amber-200 space-y-1 text-xs text-amber-950">
                      {ev.warnings.map((w, idx) => (
                        <div key={idx}>• {w}</div>
                      ))}
                    </div>
                  )}

                  {/* BOM Table */}
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <table className="w-full text-xs border-collapse">
                      <thead className="bg-slate-100 text-slate-700">
                        <tr>
                          <th className="py-2 px-3 text-left font-bold">Vật tư kỹ thuật đồng bộ</th>
                          <th className="py-2 px-2.5 text-right font-bold">SL</th>
                          <th className="py-2 px-2.5 text-left font-bold">ĐVT</th>
                          <th className="py-2 px-3 text-left font-bold">Ghi chú tiêu chuẩn</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {ev.bomItems.map((item) => (
                          <tr key={item.itemCode}>
                            <td className="py-2 px-3 font-semibold text-slate-900">
                              {item.itemName}
                            </td>
                            <td className="py-2 px-2.5 text-right font-extrabold text-[#0F275C] tabular-nums">
                              {item.quantity ?? '—'}
                            </td>
                            <td className="py-2 px-2.5 text-slate-500">{item.unit}</td>
                            <td className="py-2 px-3 text-slate-600 text-[11px]">{item.notes}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 bg-white border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            {lead && hasBaPermission(user.roleCode, 'LEAD_UPDATE_PIPELINE') && (
              <button
                type="button"
                disabled={savingLead}
                onClick={() => void handleSaveSpecToLead()}
                className="h-9 px-3.5 rounded-xl border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 text-xs font-bold inline-flex items-center gap-1.5 transition"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{savingLead ? 'Đang lưu...' : `Gắn vào hồ sơ ${lead.leadCode}`}</span>
              </button>
            )}

            {hasBaPermission(user.roleCode, 'AI_DESIGN') && (
              <button
                type="button"
                onClick={() => {
                  const pitchVal = ev?.pixelPitch || 'P2.5';
                  onClose();
                  router.push(
                    `/design?fromSpec=1${lead ? `&leadId=${lead.id}` : ''}&widthM=${widthM}&heightM=${heightM}&pitch=${encodeURIComponent(pitchVal)}`,
                  );
                }}
                className="h-9 px-3.5 rounded-xl border border-purple-200 bg-purple-50 hover:bg-purple-100 text-purple-900 text-xs font-bold inline-flex items-center gap-1.5 transition"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Đẩy thông số sang Thiết kế Phối cảnh M05</span>
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={exportingDoc}
              onClick={() => void handleDownloadWordDoc(true)}
              className="h-9 px-3.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-bold inline-flex items-center gap-1.5 transition"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>In / Xuất PDF chuẩn A4</span>
            </button>
            <button
              type="button"
              disabled={exportingDoc}
              onClick={() => void handleDownloadWordDoc(false)}
              className="h-9 px-4 rounded-xl bg-[#0F275C] hover:bg-[#1E3A8A] text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm transition"
            >
              <FileText className="w-3.5 h-3.5" />
              <Download className="w-3.5 h-3.5" />
              <span>Xuất Phiếu Kỹ Thuật Word (.doc)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
export default LedTechnicalSpecSheetModal;
