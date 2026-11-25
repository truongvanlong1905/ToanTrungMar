'use client';

import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 shadow-sm p-6 text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-red-50 border border-red-200 text-red-600 grid place-items-center mx-auto">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h2 className="text-base font-bold text-slate-900">
            Phân hệ gặp sự cố tải dữ liệu
          </h2>
          <p className="text-xs text-slate-500 leading-relaxed">
            {error?.message || 'Không thể hiển thị phân hệ lúc này. Vui lòng thử tải lại.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => reset()}
          className="h-9 px-4 rounded-xl bg-[#1E3A8A] hover:bg-[#2563EB] text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 shadow-xs transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Thử lại</span>
        </button>
      </div>
    </div>
  );
}
