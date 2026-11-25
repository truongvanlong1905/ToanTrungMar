'use client';

import React, { useState } from 'react';
import { ShieldCheck, Sparkles } from 'lucide-react';
import type { SessionUserDto } from '@toantrung/contracts';
import { apiRequest } from '@/core/http/client';

interface SmartBriefData {
  leadCode: string;
  productsSummary: string;
  dimensionsAndSite: string;
  currentBottleneck: string;
  nextActionRecommendation: string;
  activityCountAnalyzed: number;
  zeroPiiProof: {
    verified: boolean;
    redactedCount: number;
    redactedTypes: string[];
  };
}

export function SmartHandoverBriefCard({
  leadId,
  user,
}: {
  leadId: number;
  user: SessionUserDto | null;
}) {
  const [brief, setBrief] = useState<SmartBriefData | null>(null);
  const [loading, setLoading] = useState(false);

  const generateBrief = async () => {
    if (!user || loading) return;
    setLoading(true);
    try {
      const res = await apiRequest<{ brief: SmartBriefData }>('/api/v1/ai/copilot', {
        method: 'POST',
        csrfToken: user.csrfToken,
        body: {
          action: 'handover_brief',
          leadId,
        },
      });
      setBrief(res.brief);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  if (!user) return null;

  return (
    <div className="rounded-xl border border-indigo-200/90 bg-gradient-to-r from-indigo-50/60 via-white to-sky-50/50 p-3.5 text-xs space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-[#0F275C] text-white grid place-items-center shrink-0">
            <Sparkles className="w-3.5 h-3.5" />
          </span>
          <div>
            <strong className="text-slate-900">Tóm tắt Bàn giao Hồ sơ 3 Giây (Zero-PII Copilot)</strong>
            <span className="block text-[11px] text-slate-500">
              Tự động bóc tách SĐT/Email trước khi rút trích nút thắt dự án
            </span>
          </div>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => void generateBrief()}
          className="h-8 px-3 rounded-xl bg-[#0F275C] hover:bg-[#1E3A8A] text-white font-bold inline-flex items-center gap-1.5 transition"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>{loading ? 'Đang rút trích...' : brief ? 'Làm mới tóm tắt' : 'Tóm tắt 3 giây'}</span>
        </button>
      </div>

      {brief && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1">
          <div className="p-2.5 rounded-lg bg-white border border-slate-200/90">
            <span className="text-[10.5px] font-bold uppercase text-slate-400 block">
              1. Sản phẩm quan tâm
            </span>
            <p className="font-semibold text-slate-900 mt-0.5">{brief.productsSummary}</p>
          </div>
          <div className="p-2.5 rounded-lg bg-white border border-slate-200/90">
            <span className="text-[10.5px] font-bold uppercase text-slate-400 block">
              2. Kích thước &amp; Mặt bằng
            </span>
            <p className="font-semibold text-slate-900 mt-0.5">{brief.dimensionsAndSite}</p>
          </div>
          <div className="p-2.5 rounded-lg bg-amber-50/70 border border-amber-200/80">
            <span className="text-[10.5px] font-bold uppercase text-amber-800 block">
              3. Nút thắt chưa chốt
            </span>
            <p className="font-semibold text-amber-950 mt-0.5">{brief.currentBottleneck}</p>
          </div>
          <div className="p-2.5 rounded-lg bg-emerald-50/70 border border-emerald-200/80">
            <span className="text-[10.5px] font-bold uppercase text-emerald-800 block">
              4. Hành động tiếp theo
            </span>
            <p className="font-semibold text-emerald-950 mt-0.5">
              {brief.nextActionRecommendation}
            </p>
          </div>
          <div className="md:col-span-2 flex items-center justify-between text-[11px] text-slate-500 px-1">
            <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
              <ShieldCheck className="w-3.5 h-3.5" />
              Zero-PII Verified · Đã ẩn tự động {brief.zeroPiiProof.redactedCount} thông tin định danh khách
            </span>
            <span>Đã quét {brief.activityCountAnalyzed} ghi chú lịch sử</span>
          </div>
        </div>
      )}
    </div>
  );
}
export default SmartHandoverBriefCard;
