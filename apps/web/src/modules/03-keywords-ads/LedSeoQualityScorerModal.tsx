'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Link2, ShieldCheck, Sparkles, X } from 'lucide-react';
import type { SessionUserDto } from '@toantrung/contracts';
import { apiRequest } from '@/core/http/client';

interface SeoScorePayload {
  totalScore: number;
  gradeLabel: string;
  wordCount: number;
  headingStats: { h1: number; h2: number; h3: number };
  matchedTechnicalTerms: string[];
  missingSuggestedTerms: string[];
  fluffWarnings: string[];
  suggestedInternalLinks: Array<{ domain: string; anchorSuggestion: string; url: string }>;
  criteria: Array<{
    code: string;
    label: string;
    score: number;
    maxScore: number;
    status: 'pass' | 'warn' | 'fail';
    detail: string;
  }>;
}

export function LedSeoQualityScorerModal({
  articleId,
  onClose,
  user,
}: {
  articleId: number | null;
  onClose: () => void;
  user: SessionUserDto | null;
}) {
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [score, setScore] = useState<SeoScorePayload | null>(null);

  useEffect(() => {
    if (!articleId || !user) return;
    let cancelled = false;
    setLoading(true);
    void apiRequest<{ score: SeoScorePayload; title: string }>('/api/v1/ai/copilot', {
      method: 'POST',
      csrfToken: user.csrfToken,
      body: {
        action: 'seo_score',
        articleId,
      },
    })
      .then((res) => {
        if (cancelled) return;
        setScore(res.score);
        setTitle(res.title);
      })
      .catch(() => {
        if (!cancelled) setScore(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [articleId, user]);

  if (!articleId) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[75] bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[88vh] rounded-2xl bg-white border border-slate-200 shadow-2xl flex flex-col overflow-hidden text-xs"
      >
        <div className="px-5 py-4 bg-gradient-to-r from-[#0F275C] to-[#1E3A8A] text-white flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Sparkles className="w-5 h-5 text-sky-300 shrink-0" />
            <div className="min-w-0">
              <h3 className="font-display font-bold text-sm sm:text-base truncate">
                Kiểm định Kỹ thuật Bài viết SEO Ngành LED (B2B Scorer)
              </h3>
              <p className="text-[11px] text-sky-100 truncate">{title || `Bài viết #${articleId}`}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/15"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading ? (
            <div className="py-10 text-center text-slate-400">
              Đang kiểm tra cấu trúc H1–H3 và độ phủ thông số kỹ thuật LED...
            </div>
          ) : score ? (
            <>
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-4">
                <div>
                  <span className="text-[11px] font-bold uppercase text-slate-500">
                    Xếp hạng chuyên môn B2B
                  </span>
                  <div className="text-base font-extrabold text-[#0F275C] mt-0.5">
                    {score.gradeLabel}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {score.wordCount} từ · H1: {score.headingStats.h1} · H2: {score.headingStats.h2} · H3:{' '}
                    {score.headingStats.h3}
                  </div>
                </div>
                <div
                  className={`w-16 h-16 rounded-2xl grid place-items-center font-extrabold text-xl tabular-nums ${
                    score.totalScore >= 80
                      ? 'bg-emerald-600 text-white'
                      : score.totalScore >= 60
                        ? 'bg-blue-600 text-white'
                        : 'bg-amber-500 text-white'
                  }`}
                >
                  {score.totalScore}
                </div>
              </div>

              <div className="space-y-2">
                {score.criteria.map((c) => (
                  <div
                    key={c.code}
                    className="p-3 rounded-xl border border-slate-200 bg-white flex items-start justify-between gap-3"
                  >
                    <div className="flex items-start gap-2">
                      {c.status === 'pass' ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      )}
                      <div>
                        <div className="font-bold text-slate-900">{c.label}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">{c.detail}</div>
                      </div>
                    </div>
                    <span className="font-mono font-bold text-[#0F275C] shrink-0">
                      {c.score}/{c.maxScore}
                    </span>
                  </div>
                ))}
              </div>

              {score.missingSuggestedTerms.length > 0 && (
                <div className="p-3.5 rounded-xl bg-amber-50/80 border border-amber-200 space-y-1">
                  <strong className="text-amber-950 block">
                    Gợi ý bổ sung thông số kỹ thuật chuẩn Toàn Trung:
                  </strong>
                  <p className="text-amber-900">
                    Nên đề cập thêm: <strong>{score.missingSuggestedTerms.join(', ')}</strong> để tăng độ tin cậy với kỹ sư / chủ đầu tư B2B.
                  </p>
                </div>
              )}

              <div className="p-3.5 rounded-xl bg-blue-50/60 border border-blue-200 space-y-1.5">
                <strong className="text-[#0F275C] inline-flex items-center gap-1">
                  <Link2 className="w-3.5 h-3.5" />
                  Gợi ý Liên kết Nội bộ Chuẩn SEO:
                </strong>
                {score.suggestedInternalLinks.map((lnk) => (
                  <div key={lnk.url} className="text-[11px] text-slate-700">
                    • <strong>{lnk.anchorSuggestion}</strong> →{' '}
                    <code className="font-mono text-[#1E3A8A]">{lnk.url}</code>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="py-8 text-center text-slate-400">Không thể chấm điểm bài viết này.</div>
          )}
        </div>

        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
            <ShieldCheck className="w-3.5 h-3.5" />
            Chấm điểm cục bộ 100% trên Local ($0, không gửi nội dung ra ngoài)
          </span>
          <button
            type="button"
            onClick={onClose}
            className="h-8 px-4 rounded-xl bg-[#0F275C] text-white font-bold"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
export default LedSeoQualityScorerModal;
