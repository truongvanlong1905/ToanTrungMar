'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface UseVirtualRowsOptions {
  totalCount: number;
  rowHeight?: number;
  overscan?: number;
  enabledThreshold?: number;
}

export interface VirtualRowsWindow {
  containerRef: React.RefObject<HTMLDivElement>;
  isVirtualized: boolean;
  startIndex: number;
  endIndex: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  handleScroll: (e: React.UIEvent<HTMLDivElement>) => void;
}

/**
 * Windowed table virtualization hook preserving semantic HTML <table> layout,
 * sticky headers, Excel A/B/C columns, and Quick Calc selection at 60 FPS even with 10,000+ rows.
 */
export function useVirtualRows({
  totalCount,
  rowHeight = 44,
  overscan = 12,
  enabledThreshold = 60,
}: UseVirtualRowsOptions): VirtualRowsWindow {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(560);

  const isVirtualized = totalCount > enabledThreshold;

  useEffect(() => {
    if (!isVirtualized) return;
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const h = el.clientHeight;
      if (h > 0) setViewportHeight(h);
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
    return undefined;
  }, [isVirtualized, totalCount]);

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      if (!isVirtualized) return;
      setScrollTop(e.currentTarget.scrollTop);
    },
    [isVirtualized],
  );

  return useMemo(() => {
    if (!isVirtualized || totalCount <= 0) {
      return {
        containerRef,
        isVirtualized: false,
        startIndex: 0,
        endIndex: totalCount,
        topSpacerHeight: 0,
        bottomSpacerHeight: 0,
        handleScroll,
      };
    }

    const rawStart = Math.floor(scrollTop / rowHeight) - overscan;
    const startIndex = Math.max(0, Math.min(totalCount - 1, rawStart));
    const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
    const endIndex = Math.max(startIndex, Math.min(totalCount, startIndex + visibleCount));

    const topSpacerHeight = startIndex * rowHeight;
    const bottomSpacerHeight = Math.max(0, (totalCount - endIndex) * rowHeight);

    return {
      containerRef,
      isVirtualized: true,
      startIndex,
      endIndex,
      topSpacerHeight,
      bottomSpacerHeight,
      handleScroll,
    };
  }, [isVirtualized, totalCount, scrollTop, rowHeight, overscan, viewportHeight, handleScroll]);
}
