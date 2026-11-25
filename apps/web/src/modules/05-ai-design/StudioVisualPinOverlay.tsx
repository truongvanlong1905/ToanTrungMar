'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Check, MessageSquarePlus, Trash2, X } from 'lucide-react';
import type { SessionUserDto } from '@toantrung/contracts';
import { apiRequest } from '@/core/http/client';
import { subscribeDataSync } from '@/core/http/data-sync-bus';

export interface DesignVisualPinItem {
  id: string;
  xPct: number;
  yPct: number;
  versionId: number | null;
  comment: string;
  resolved: boolean;
  authorId: number;
  authorName: string;
  authorRole: string;
  createdAt: string;
}

export function StudioVisualPinOverlay({
  projectId,
  versionId,
  pinModeActive,
  user,
  onError,
}: {
  projectId: number | null;
  versionId: number | null;
  pinModeActive: boolean;
  user: SessionUserDto | null;
  onError?: (msg: string) => void;
}) {
  const [pins, setPins] = useState<DesignVisualPinItem[]>([]);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [draftCoords, setDraftCoords] = useState<{ xPct: number; yPct: number } | null>(null);
  const [draftComment, setDraftComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadPins = useCallback(async () => {
    if (!projectId || !user) {
      setPins([]);
      return;
    }
    try {
      const res = await apiRequest<{ pins: DesignVisualPinItem[] }>(
        `/api/v1/design/${projectId}/pins`,
        { skipCache: true },
      );
      setPins(res.pins || []);
    } catch {
      // ignore
    }
  }, [projectId, user]);

  useEffect(() => {
    void loadPins();
    const unsub = subscribeDataSync(['design'], () => {
      void loadPins();
    });
    return () => unsub();
  }, [loadPins]);

  if (!projectId) return null;

  const visiblePins = pins.filter((p) => !versionId || !p.versionId || p.versionId === versionId);

  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!pinModeActive) return;
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const xPct = Math.min(96, Math.max(4, ((e.clientX - rect.left) / rect.width) * 100));
    const yPct = Math.min(96, Math.max(4, ((e.clientY - rect.top) / rect.height) * 100));
    setDraftCoords({ xPct, yPct });
    setDraftComment('');
    setSelectedPinId(null);
  };

  const handleSavePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !draftCoords || !draftComment.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await apiRequest<{
        pins: DesignVisualPinItem[];
        created: DesignVisualPinItem;
      }>(`/api/v1/design/${projectId}/pins`, {
        method: 'POST',
        csrfToken: user.csrfToken,
        body: {
          action: 'add',
          xPct: draftCoords.xPct,
          yPct: draftCoords.yPct,
          versionId,
          comment: draftComment.trim(),
        },
      });
      setPins(res.pins || []);
      setDraftCoords(null);
      setDraftComment('');
      if (res.created) setSelectedPinId(res.created.id);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Không thể lưu ghim nhận xét.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleResolve = async (pinId: string) => {
    if (!user) return;
    try {
      const res = await apiRequest<{ pins: DesignVisualPinItem[] }>(
        `/api/v1/design/${projectId}/pins`,
        {
          method: 'POST',
          csrfToken: user.csrfToken,
          body: { action: 'toggle_resolve', pinId },
        },
      );
      setPins(res.pins || []);
    } catch {
      // ignore
    }
  };

  const handleDeletePin = async (pinId: string) => {
    if (!user) return;
    try {
      const res = await apiRequest<{ pins: DesignVisualPinItem[] }>(
        `/api/v1/design/${projectId}/pins`,
        {
          method: 'POST',
          csrfToken: user.csrfToken,
          body: { action: 'delete', pinId },
        },
      );
      setPins(res.pins || []);
      if (selectedPinId === pinId) setSelectedPinId(null);
    } catch {
      // ignore
    }
  };

  if (!pinModeActive && visiblePins.length === 0) return null;

  return (
    <div
      onClick={handleCanvasClick}
      className={`absolute inset-0 z-20 ${
        pinModeActive ? 'cursor-crosshair pointer-events-auto' : 'pointer-events-none'
      }`}
    >
      {pinModeActive && (
        <div className="pointer-events-none absolute left-3 bottom-3 rounded-lg bg-amber-950/90 border border-amber-400/50 px-3 py-1.5 text-[11px] font-bold text-amber-200 shadow-lg">
          📌 Đang bật Ghim Nhận Xét: Bấm vào bất kỳ vị trí nào trên ảnh phối cảnh để ghi chú chỉnh sửa cho Designer ({visiblePins.length} ghim)
        </div>
      )}

      {visiblePins.map((pin, idx) => {
        const isOpen = selectedPinId === pin.id;
        return (
          <div
            key={pin.id}
            style={{
              left: `${pin.xPct}%`,
              top: `${pin.yPct}%`,
              transform: 'translate(-50%, -50%)',
            }}
            onClick={(e) => e.stopPropagation()}
            className="pointer-events-auto absolute"
          >
            <button
              type="button"
              onClick={() => setSelectedPinId(isOpen ? null : pin.id)}
              title={`${pin.authorName}: ${pin.comment}`}
              className={`w-7 h-7 rounded-full border-2 border-white font-extrabold text-[11px] text-white shadow-lg grid place-items-center transition-transform hover:scale-110 ${
                pin.resolved ? 'bg-emerald-600' : 'bg-amber-500 ring-2 ring-amber-300/60'
              }`}
            >
              {pin.resolved ? '✓' : idx + 1}
            </button>

            {isOpen && (
              <div className="absolute left-4 top-4 z-30 w-64 rounded-xl bg-white border border-slate-200 shadow-2xl p-3 text-xs text-slate-800 space-y-2">
                <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-1.5">
                  <div className="truncate">
                    <strong className="text-slate-900">{pin.authorName}</strong>
                    <span className="text-[10px] text-slate-400 block">{pin.authorRole}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedPinId(null)}
                    className="text-slate-400 hover:text-slate-700"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-xs text-slate-700 leading-relaxed">{pin.comment}</p>
                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => void handleToggleResolve(pin.id)}
                    className={`h-7 px-2.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 ${
                      pin.resolved
                        ? 'bg-slate-100 text-slate-600'
                        : 'bg-emerald-600 text-white hover:bg-emerald-700'
                    }`}
                  >
                    <Check className="w-3 h-3" />
                    <span>{pin.resolved ? 'Mở lại' : 'Đã xử lý'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeletePin(pin.id)}
                    className="h-7 px-2 rounded-lg text-rose-600 hover:bg-rose-50 inline-flex items-center gap-1 text-[11px] font-semibold"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Xóa</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {draftCoords && (
        <div
          style={{
            left: `${Math.min(72, Math.max(8, draftCoords.xPct))}%`,
            top: `${Math.min(72, Math.max(8, draftCoords.yPct))}%`,
          }}
          onClick={(e) => e.stopPropagation()}
          className="pointer-events-auto absolute z-30 w-72 rounded-xl bg-white border border-amber-300 shadow-2xl p-3 text-xs space-y-2"
        >
          <div className="font-bold text-slate-900 flex items-center justify-between">
            <span className="inline-flex items-center gap-1">
              <MessageSquarePlus className="w-3.5 h-3.5 text-amber-600" />
              Ghim ghi chú chỉnh sửa mới
            </span>
            <button
              type="button"
              onClick={() => setDraftCoords(null)}
              className="text-slate-400 hover:text-slate-700"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <form onSubmit={(e) => void handleSavePin(e)} className="space-y-2">
            <textarea
              rows={2}
              autoFocus
              required
              value={draftComment}
              onChange={(e) => setDraftComment(e.target.value)}
              placeholder="VD: Nâng đáy màn hình cao hơn bục sân khấu 40cm..."
              className="w-full p-2 rounded-lg border border-slate-200 text-slate-800 focus:outline-none focus:border-[#1E3A8A]"
            />
            <div className="flex justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setDraftCoords(null)}
                className="h-7 px-2.5 rounded-lg border border-slate-200 text-slate-600 font-semibold"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={submitting || !draftComment.trim()}
                className="h-7 px-3 rounded-lg bg-[#0F275C] text-white font-bold disabled:opacity-40"
              >
                Gắn ghim
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
export default StudioVisualPinOverlay;
