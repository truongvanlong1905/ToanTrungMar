'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Layers, Pencil, Plus, RefreshCw, X } from 'lucide-react';
import type { ProductCatalogDto, ProductGroupOptionDto } from '@toantrung/contracts';
import { apiRequest } from '@/core/http/client';

interface ProductCatalogModalProps {
  open: boolean;
  onClose: () => void;
  csrfToken?: string;
  onCatalogUpdated: () => Promise<void> | void;
}

const QUICK_LED_TEMPLATES: Array<{ name: string; unit: string }> = [
  { name: 'LED P2 Indoor', unit: 'm2' },
  { name: 'LED P2.5 Indoor', unit: 'm2' },
  { name: 'LED P3 Indoor', unit: 'm2' },
  { name: 'LED P4 Outdoor', unit: 'm2' },
  { name: 'LED P5 Outdoor', unit: 'm2' },
  { name: 'Màn hình LED Trong suốt', unit: 'm2' },
];

export function ProductCatalogModal({
  open,
  onClose,
  csrfToken,
  onCatalogUpdated,
}: ProductCatalogModalProps) {
  const [products, setProducts] = useState<ProductCatalogDto[]>([]);
  const [groups, setGroups] = useState<ProductGroupOptionDto[]>([]);
  const [activeGroupKey, setActiveGroupKey] = useState<string>('led_screen');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  // Add product form
  const [newProductName, setNewProductName] = useState('');
  const [newProductUnit, setNewProductUnit] = useState('m2');
  const [creatingNewGroup, setCreatingNewGroup] = useState(false);
  const [newGroupLabel, setNewGroupLabel] = useState('');

  // Inline edit name
  const [editingProductId, setEditingProductId] = useState<number | null>(null);
  const [editingNameDraft, setEditingNameDraft] = useState('');

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await apiRequest<{
        products: ProductCatalogDto[];
        groups: ProductGroupOptionDto[];
      }>('/api/v1/leads/products?includeInactive=1');
      setProducts(data.products || []);
      setGroups(data.groups || []);
      if (
        data.groups &&
        data.groups.length > 0 &&
        !data.groups.some((g) => g.groupKey === activeGroupKey)
      ) {
        setActiveGroupKey(data.groups[0].groupKey);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể tải danh mục sản phẩm.');
    } finally {
      setLoading(false);
    }
  }, [activeGroupKey]);

  useEffect(() => {
    if (open) {
      void loadCatalog();
    }
  }, [open, loadCatalog]);

  const visibleProducts = useMemo(
    () => products.filter((p) => (p.categoryGroup || 'other') === activeGroupKey),
    [products, activeGroupKey],
  );

  const handleAddProduct = async (presetName?: string, presetUnit?: string) => {
    const cleanName = (presetName ?? newProductName).trim();
    if (!cleanName) {
      setErrorMsg('Vui lòng nhập tên sản phẩm cần thêm.');
      return;
    }
    if (creatingNewGroup && !newGroupLabel.trim()) {
      setErrorMsg('Vui lòng nhập tên nhóm sản phẩm mới.');
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    setFeedbackMsg(null);
    try {
      const targetGroup = creatingNewGroup ? newGroupLabel.trim() : activeGroupKey;
      const res = await apiRequest<{
        product: ProductCatalogDto;
        groups: ProductGroupOptionDto[];
      }>('/api/v1/leads/products', {
        method: 'POST',
        csrfToken,
        body: {
          productName: cleanName,
          categoryGroup: targetGroup,
          ...(creatingNewGroup ? { categoryGroupLabel: newGroupLabel.trim() } : {}),
          unit: (presetUnit ?? newProductUnit).trim() || 'm2',
        },
      });
      if (!presetName) setNewProductName('');
      if (creatingNewGroup) {
        setCreatingNewGroup(false);
        setNewGroupLabel('');
        if (res.product.categoryGroup) {
          setActiveGroupKey(res.product.categoryGroup);
        }
      }
      setFeedbackMsg(`Đã thêm "${res.product.productName}" vào danh mục.`);
      await loadCatalog();
      await onCatalogUpdated();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể thêm sản phẩm.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (prod: ProductCatalogDto) => {
    setSaving(true);
    setErrorMsg(null);
    try {
      await apiRequest('/api/v1/leads/products', {
        method: 'PATCH',
        csrfToken,
        body: {
          productId: prod.id,
          isActive: !prod.isActive,
        },
      });
      await loadCatalog();
      await onCatalogUpdated();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể đổi trạng thái sản phẩm.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveRename = async (productId: number) => {
    const clean = editingNameDraft.trim();
    if (!clean) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      await apiRequest('/api/v1/leads/products', {
        method: 'PATCH',
        csrfToken,
        body: {
          productId,
          productName: clean,
        },
      });
      setEditingProductId(null);
      setEditingNameDraft('');
      setFeedbackMsg(`Đã cập nhật tên sản phẩm thành "${clean}".`);
      await loadCatalog();
      await onCatalogUpdated();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể đổi tên sản phẩm.');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-[1px]">
      <div className="w-full max-w-4xl max-h-[88vh] flex flex-col rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
        <div className="shrink-0 px-5 py-3.5 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#1E3A8A]/10 text-[#1E3A8A] flex items-center justify-center">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Quản lý Danh mục Sản phẩm &amp; Nhóm SP Lead
              </h3>
              <p className="text-[11px] text-slate-500">
                Admin cập nhật chi tiết dòng LED (P2, P2.5, P3...) hoặc thêm nhóm sản phẩm mới. Không xóa mất dữ liệu Lead cũ.
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Đóng quản lý danh mục sản phẩm"
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-slate-200/70 flex items-center justify-center text-slate-500"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
          {errorMsg && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-medium text-rose-800">
              {errorMsg}
            </div>
          )}
          {feedbackMsg && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-medium text-emerald-800">
              {feedbackMsg}
            </div>
          )}

          {/* Quick templates when viewing led_screen */}
          {activeGroupKey === 'led_screen' && !creatingNewGroup && (
            <div className="rounded-xl border border-blue-200/80 bg-blue-50/50 p-3 space-y-2">
              <div className="text-[11px] font-bold text-[#1E3A8A]">
                Thêm nhanh dòng Màn hình LED phổ biến:
              </div>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_LED_TEMPLATES.map((tpl) => {
                  const exists = products.some(
                    (p) =>
                      p.categoryGroup === 'led_screen' &&
                      p.productName.trim().toLowerCase() === tpl.name.toLowerCase(),
                  );
                  return (
                    <button
                      key={tpl.name}
                      type="button"
                      disabled={saving || exists}
                      onClick={() => void handleAddProduct(tpl.name, tpl.unit)}
                      className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition ${
                        exists
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-700 cursor-default'
                          : 'bg-white border-blue-200 text-[#1E3A8A] hover:bg-blue-100'
                      }`}
                    >
                      {exists ? `✓ ${tpl.name}` : `+ ${tpl.name}`}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Create product or group bar */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-800">
                {creatingNewGroup
                  ? 'Tạo nhóm sản phẩm mới kèm sản phẩm đầu tiên'
                  : `Thêm sản phẩm mới vào nhóm: ${groups.find((g) => g.groupKey === activeGroupKey)?.label || activeGroupKey}`}
              </span>
              <button
                type="button"
                onClick={() => setCreatingNewGroup((prev) => !prev)}
                className="text-xs font-bold text-[#1E3A8A] hover:underline"
              >
                {creatingNewGroup ? '← Quay lại chọn nhóm có sẵn' : '+ Tạo nhóm SP mới'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
              {creatingNewGroup && (
                <div className="sm:col-span-4">
                  <input
                    type="text"
                    value={newGroupLabel}
                    onChange={(e) => setNewGroupLabel(e.target.value)}
                    placeholder="Tên nhóm mới (VD: Khung & Bộ xử lý)"
                    className="w-full h-9 px-3 rounded-lg border border-blue-300 bg-white text-xs text-slate-900 focus:outline-none focus:border-[#1E3A8A]"
                  />
                </div>
              )}
              <div className={creatingNewGroup ? 'sm:col-span-5' : 'sm:col-span-7'}>
                <input
                  type="text"
                  value={newProductName}
                  onChange={(e) => setNewProductName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleAddProduct();
                    }
                  }}
                  placeholder="Tên sản phẩm chi tiết (VD: LED P2.5 Indoor, Bộ xử lý Novastar...)"
                  className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:border-[#1E3A8A]"
                />
              </div>
              <div className="sm:col-span-2">
                <input
                  type="text"
                  value={newProductUnit}
                  onChange={(e) => setNewProductUnit(e.target.value)}
                  placeholder="ĐVT (m2 / bộ)"
                  className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:border-[#1E3A8A]"
                />
              </div>
              <div className={creatingNewGroup ? 'sm:col-span-1' : 'sm:col-span-3'}>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleAddProduct()}
                  className="w-full h-9 px-3 rounded-lg bg-[#0F275C] hover:bg-[#1E3A8A] text-white text-xs font-bold inline-flex items-center justify-center gap-1 disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{creatingNewGroup ? 'Tạo' : 'Thêm SP'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* 2-col browser: groups left, products right */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-start">
            <div className="sm:col-span-4 flex flex-col gap-1">
              {groups.map((grp) => {
                const active = grp.groupKey === activeGroupKey;
                return (
                  <button
                    key={grp.groupKey}
                    type="button"
                    onClick={() => {
                      setActiveGroupKey(grp.groupKey);
                      setCreatingNewGroup(false);
                    }}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between transition ${
                      active
                        ? 'bg-blue-50 text-[#1E3A8A] font-bold border-l-4 border-l-[#2563EB]'
                        : 'text-slate-700 hover:bg-slate-50 font-medium'
                    }`}
                  >
                    <span className="truncate">{grp.label}</span>
                    <span className="text-[11px] text-slate-400">({grp.productCount})</span>
                  </button>
                );
              })}
            </div>

            <div className="sm:col-span-8 rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
              {loading ? (
                <div className="p-6 flex items-center justify-center gap-2 text-xs text-slate-500">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Đang tải danh mục...</span>
                </div>
              ) : visibleProducts.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  Nhóm này chưa có sản phẩm nào. Hãy nhập tên sản phẩm bên trên để thêm.
                </div>
              ) : (
                visibleProducts.map((prod) => (
                  <div
                    key={prod.id}
                    className={`px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs ${
                      !prod.isActive ? 'bg-slate-50/80 opacity-65' : ''
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      {editingProductId === prod.id ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={editingNameDraft}
                            onChange={(e) => setEditingNameDraft(e.target.value)}
                            className="h-7 px-2 rounded border border-blue-400 text-xs text-slate-900 flex-1"
                          />
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void handleSaveRename(prod.id)}
                            className="h-7 px-2 rounded bg-emerald-600 text-white font-bold inline-flex items-center gap-1"
                          >
                            <Check className="w-3 h-3" />
                            <span>Lưu</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingProductId(null)}
                            className="h-7 px-2 rounded border border-slate-300 text-slate-600"
                          >
                            Hủy
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900 truncate">
                            {prod.productName}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-mono">
                            {prod.unit || 'm2'}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {editingProductId !== prod.id && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingProductId(prod.id);
                            setEditingNameDraft(prod.productName);
                          }}
                          className="h-7 px-2 rounded border border-slate-200 hover:bg-slate-50 text-slate-600 inline-flex items-center gap-1"
                          title="Đổi tên sản phẩm"
                        >
                          <Pencil className="w-3 h-3" />
                          <span>Sửa</span>
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void handleToggleActive(prod)}
                        className={`h-7 px-2.5 rounded font-semibold border transition ${
                          prod.isActive
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100'
                            : 'bg-slate-100 border-slate-300 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {prod.isActive ? 'Đang dùng' : 'Đang ẩn'}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
