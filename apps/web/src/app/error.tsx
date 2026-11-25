'use client';

import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

export default function GlobalAppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 shadow-sm p-6 text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-red-50 border border-red-200 text-red-600 grid place-items-center mx-auto">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h1 className="text-base font-bold text-slate-900">
            Đã xảy ra sự cố hiển thị giao diện
          </h1>
          <p className="text-xs text-slate-500 leading-relaxed">
            {error?.message || 'Hệ thống gặp lỗi tạm thời khi tải trang này. Dữ liệu của bạn vẫn an toàn.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => reset()}
          className="h-9 px-4 rounded-xl bg-[#1E3A8A] hover:bg-[#2563EB] text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 shadow-xs transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Thử tải lại trang</span>
        </button>
      </div>
    </div>
  );
}
