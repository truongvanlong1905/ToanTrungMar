'use client';

import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface SectionErrorBoundaryProps {
  sectionTitle?: string;
  children: React.ReactNode;
}

interface SectionErrorBoundaryState {
  hasError: boolean;
  errorMessage: string | null;
}

export class SectionErrorBoundary extends React.Component<
  SectionErrorBoundaryProps,
  SectionErrorBoundaryState
> {
  constructor(props: SectionErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: null };
  }

  static getDerivedStateFromError(error: unknown): SectionErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error instanceof Error ? error.message : 'Sự cố hiển thị cục bộ.',
    };
  }

  private handleReset = () => {
    this.setState({ hasError: false, errorMessage: null });
  };

  override render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5 text-slate-800 shadow-2xs my-2"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-800 grid place-items-center shrink-0">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  {this.props.sectionTitle
                    ? `Khu vực "${this.props.sectionTitle}" tạm thời gián đoạn`
                    : 'Một thành phần hiển thị vừa gặp sự cố cục bộ'}
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Các phân hệ và vùng dữ liệu khác trên màn hình vẫn hoạt động bình thường.
                  {this.state.errorMessage ? ` (${this.state.errorMessage})` : ''}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={this.handleReset}
              className="h-8 px-3.5 rounded-xl bg-[#0F275C] hover:bg-[#1E3A8A] text-white text-xs font-bold inline-flex items-center gap-1.5 shrink-0 transition"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Thử lại vùng này</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export function WorkspaceSkeletonShimmer({
  rows = 6,
  kpiCount = 4,
}: {
  rows?: number;
  kpiCount?: number;
}) {
  return (
    <div className="space-y-3.5 animate-in fade-in duration-150" aria-busy="true">
      {kpiCount > 0 && (
        <div
          className={`grid grid-cols-2 lg:grid-cols-${Math.min(6, Math.max(2, kpiCount))} gap-3`}
        >
          {Array.from({ length: kpiCount }).map((_, idx) => (
            <div
              key={idx}
              className="h-24 rounded-2xl border border-slate-200/80 bg-white p-4 space-y-2.5 overflow-hidden relative"
            >
              <div className="h-3 w-24 rounded-md bg-slate-200/80 animate-pulse" />
              <div className="h-6 w-16 rounded-lg bg-slate-200 animate-pulse" />
              <div className="h-2.5 w-32 rounded-md bg-slate-100 animate-pulse" />
            </div>
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200/80 bg-white overflow-hidden">
        <div className="h-10 bg-slate-50 border-b border-slate-200/80 px-4 flex items-center gap-4">
          <div className="h-3 w-28 rounded bg-slate-200/80 animate-pulse" />
          <div className="h-3 w-24 rounded bg-slate-200/70 animate-pulse" />
          <div className="h-3 w-20 rounded bg-slate-200/70 animate-pulse hidden sm:block" />
          <div className="h-3 w-24 rounded bg-slate-200/70 animate-pulse ml-auto" />
        </div>
        <div className="divide-y divide-slate-100">
          {Array.from({ length: rows }).map((_, rIdx) => (
            <div key={rIdx} className="h-12 px-4 flex items-center gap-4">
              <div className="h-3.5 w-40 rounded bg-slate-200/75 animate-pulse" />
              <div className="h-3 w-28 rounded bg-slate-100 animate-pulse" />
              <div className="h-3 w-24 rounded bg-slate-100 animate-pulse hidden md:block" />
              <div className="h-5 w-20 rounded-full bg-slate-100 animate-pulse ml-auto" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
