'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Bookmark, Pin, Plus, X } from 'lucide-react';
import type { SessionUserDto } from '@toantrung/contracts';
import { apiRequest } from '@/core/http/client';

export interface SavedSmartViewItem {
  id: string;
  name: string;
  scope: 'leads';
  isSystemPreset?: boolean;
  filters: {
    statusFilter?: string;
    sourceWebsiteFilter?: string;
    overdueOnly?: boolean;
    unreceivedOnly?: boolean;
    specialAlertFilter?: string;
  };
}

export function LeadSavedSmartViewsBar({
  user,
  currentFilters,
  onApplyView,
}: {
  user: SessionUserDto | null;
  currentFilters: SavedSmartViewItem['filters'];
  onApplyView: (filters: SavedSmartViewItem['filters']) => void;
}) {
  const [views, setViews] = useState<SavedSmartViewItem[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);

  const loadViews = useCallback(async () => {
    if (!user) return;
    try {
      const res = await apiRequest<{ views: SavedSmartViewItem[] }>('/api/v1/system/saved-views', {
        skipCache: true,
      });
      setViews(res.views || []);
    } catch {
      // silent
    }
  }, [user]);

  useEffect(() => {
    void loadViews();
  }, [loadViews]);

  const handleSaveCurrent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newName.trim() || saving) return;
    setSaving(true);
    try {
      const res = await apiRequest<{
        saved: SavedSmartViewItem;
        views: SavedSmartViewItem[];
      }>('/api/v1/system/saved-views', {
        method: 'POST',
        csrfToken: user.csrfToken,
        body: {
          name: newName.trim(),
          filters: currentFilters,
        },
      });
      setViews(res.views || []);
      setActiveViewId(res.saved?.id || null);
      setNewName('');
      setAdding(false);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteView = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) return;
    try {
      const res = await apiRequest<{ views: SavedSmartViewItem[] }>(
        `/api/v1/system/saved-views?id=${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
          csrfToken: user.csrfToken,
        },
      );
      setViews(res.views || []);
      if (activeViewId === id) setActiveViewId(null);
    } catch {
      // ignore
    }
  };

  if (!user || views.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-1 text-xs">
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 mr-1">
        <Bookmark className="w-3.5 h-3.5 text-[#1E3A8A]" />
        <span>Góc nhìn thông minh:</span>
      </span>

      {views.map((v) => {
        const isActive = activeViewId === v.id;
        return (
          <button
            key={v.id}
            type="button"
            onClick={() => {
              setActiveViewId(v.id);
              onApplyView(v.filters);
            }}
            className={`group inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-[11px] font-semibold transition ${
              isActive
                ? 'bg-[#0F275C] border-[#0F275C] text-white shadow-2xs'
                : 'bg-white border-slate-200 text-slate-700 hover:border-blue-300 hover:text-[#0F275C]'
            }`}
          >
            {!v.isSystemPreset && <Pin className="w-3 h-3 opacity-80" />}
            <span>{v.name}</span>
            {!v.isSystemPreset && (
              <span
                role="button"
                tabIndex={0}
                title="Xóa góc nhìn đã ghim"
                onClick={(e) => void handleDeleteView(v.id, e)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleDeleteView(v.id, e as unknown as React.MouseEvent);
                }}
                className={`ml-0.5 w-3.5 h-3.5 rounded-full inline-flex items-center justify-center ${
                  isActive ? 'hover:bg-white/20 text-white' : 'hover:bg-rose-100 text-slate-400 hover:text-rose-600'
                }`}
              >
                <X className="w-2.5 h-2.5" />
              </span>
            )}
          </button>
        );
      })}

      {adding ? (
        <form onSubmit={(e) => void handleSaveCurrent(e)} className="inline-flex items-center gap-1">
          <input
            type="text"
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Tên bộ lọc (VD: Hội trường HCM)..."
            className="h-7 w-44 px-2.5 rounded-full border border-blue-300 bg-white text-[11px] font-medium text-slate-800 focus:outline-none focus:border-[#1E3A8A]"
          />
          <button
            type="submit"
            disabled={saving || !newName.trim()}
            className="h-7 px-2.5 rounded-full bg-[#1E3A8A] text-white text-[11px] font-bold disabled:opacity-40"
          >
            Lưu
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setNewName('');
            }}
            className="h-7 px-2 rounded-full bg-slate-100 text-slate-600 text-[11px]"
          >
            Hủy
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full border border-dashed border-slate-300 hover:border-[#1E3A8A] text-[11px] font-semibold text-slate-600 hover:text-[#1E3A8A] bg-white/70 transition"
        >
          <Plus className="w-3 h-3" />
          <span>Ghim bộ lọc hiện tại</span>
        </button>
      )}
    </div>
  );
}
export default LeadSavedSmartViewsBar;
