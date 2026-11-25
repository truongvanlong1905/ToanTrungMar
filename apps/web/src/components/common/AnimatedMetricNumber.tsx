'use client';

import React, { useEffect, useRef, useState } from 'react';

interface AnimatedMetricNumberProps {
  value: number | null | undefined;
  format?: (val: number) => string;
  emptyText?: string;
}

/**
 * C02 — Chỉ animate con số thực sự thay đổi trong khoảng 200–300 ms (240 ms),
 * tôn trọng `prefers-reduced-motion: reduce`, dùng `tabular-nums` để không giật bố cục.
 */
export function AnimatedMetricNumber({
  value,
  format = (v) => v.toLocaleString('vi-VN'),
  emptyText = 'Chưa đủ dữ liệu',
}: AnimatedMetricNumberProps) {
  const [displayValue, setDisplayValue] = useState<number | null>(
    typeof value === 'number' && Number.isFinite(value) ? value : null,
  );
  const prevValueRef = useRef<number | null>(displayValue);

  useEffect(() => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      prevValueRef.current = null;
      setDisplayValue(null);
      return;
    }

    const fromVal = prevValueRef.current;
    if (fromVal === null || fromVal === value) {
      prevValueRef.current = value;
      setDisplayValue(value);
      return;
    }

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      prevValueRef.current = value;
      setDisplayValue(value);
      return;
    }

    const durationMs = 240;
    const startMs = performance.now();
    let rafId = 0;

    const tick = (now: number) => {
      const elapsed = now - startMs;
      const progress = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = fromVal + (value - fromVal) * eased;
      setDisplayValue(Number.isInteger(value) ? Math.round(current) : Number(current.toFixed(2)));
      if (progress < 1) {
        rafId = requestAnimationFrame(tick);
      } else {
        prevValueRef.current = value;
        setDisplayValue(value);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [value]);

  if (displayValue === null) {
    return <span className="text-slate-500 font-semibold text-base">{emptyText}</span>;
  }

  return <span className="tabular-nums">{format(displayValue)}</span>;
}
