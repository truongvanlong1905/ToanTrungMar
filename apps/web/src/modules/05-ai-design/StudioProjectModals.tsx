'use client';

import React from 'react';
import { Check, Edit2, Trash2 } from 'lucide-react';
import type { AiProviderId, DesignRequestItemDto, DesignType } from '@toantrung/contracts';
import type { LeadOpt, ProviderStatusInfo } from './ai-workspace-helpers';

export interface StudioConfirmModalState {
  title: string;
  subtitle?: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => Promise<void> | void;
}

export interface StudioPromptModalState {
  title: string;
  label: string;
  value: string;
  placeholder?: string;
  onConfirm: (val: string) => Promise<void> | void;
}

export function StudioProjectModals({
  showCreateModal,
  setShowCreateModal,
  handleCreateProject,
  newProjectType,
  setNewProjectType,
  newProjectName,
  setNewProjectName,
  newLeadId,
  setNewLeadId,
  leadOptions,
  newContactName,
  setNewContactName,
  selectedProviderId,
  setSelectedProviderId,
  selectedModelId,
  setSelectedModelId,
  providerStatus,
  newProjectFiles,
  setNewProjectFiles,
  newPrompt,
  setNewPrompt,
  submitting,
  editingName,
  setEditingName,
  renameTargetId,
  setRenameTargetId,
  currentProject,
  requests,
  handleRenameProject,
  renameValue,
  setRenameValue,
  quickEditDesignType,
  setQuickEditDesignType,
  quickEditLeadId,
  setQuickEditLeadId,
  quickEditContactName,
  setQuickEditContactName,
  quickEditPitch,
  setQuickEditPitch,
  quickEditWidthM,
  setQuickEditWidthM,
  quickEditHeightM,
  setQuickEditHeightM,
  quickEditInstallInfo,
  setQuickEditInstallInfo,
  savingQuickEdit,
  requestDeleteProject,
  confirmModal,
  setConfirmModal,
  confirmBusy,
  setConfirmBusy,
  promptModal,
  setPromptModal,
  promptBusy,
  setPromptBusy,
  setError,
}: {
  showCreateModal: boolean;
  setShowCreateModal: (v: boolean) => void;
  handleCreateProject: (e: React.FormEvent) => Promise<void> | void;
  newProjectType: DesignType;
  setNewProjectType: (v: DesignType) => void;
  newProjectName: string;
  setNewProjectName: (v: string) => void;
  newLeadId: string;
  setNewLeadId: (v: string) => void;
  leadOptions: LeadOpt[];
  newContactName: string;
  setNewContactName: (v: string) => void;
  selectedProviderId: AiProviderId;
  setSelectedProviderId: (v: AiProviderId) => void;
  selectedModelId: string;
  setSelectedModelId: (v: string) => void;
  providerStatus: ProviderStatusInfo | null;
  newProjectFiles: File[];
  setNewProjectFiles: (files: File[]) => void;
  newPrompt: string;
  setNewPrompt: (v: string) => void;
  submitting: boolean;
  editingName: boolean;
  setEditingName: (v: boolean) => void;
  renameTargetId: number | null;
  setRenameTargetId: (v: number | null) => void;
  currentProject: DesignRequestItemDto | null;
  requests: DesignRequestItemDto[];
  handleRenameProject: (e: React.FormEvent) => Promise<void> | void;
  renameValue: string;
  setRenameValue: (v: string) => void;
  quickEditDesignType: DesignType;
  setQuickEditDesignType: (v: DesignType) => void;
  quickEditLeadId: string;
  setQuickEditLeadId: (v: string) => void;
  quickEditContactName: string;
  setQuickEditContactName: (v: string) => void;
  quickEditPitch: string;
  setQuickEditPitch: (v: string) => void;
  quickEditWidthM: number;
  setQuickEditWidthM: (v: number) => void;
  quickEditHeightM: number;
  setQuickEditHeightM: (v: number) => void;
  quickEditInstallInfo: string;
  setQuickEditInstallInfo: (v: string) => void;
  savingQuickEdit: boolean;
  requestDeleteProject: (proj: DesignRequestItemDto) => void;
  confirmModal: StudioConfirmModalState | null;
  setConfirmModal: (v: StudioConfirmModalState | null) => void;
  confirmBusy: boolean;
  setConfirmBusy: (v: boolean) => void;
  promptModal: StudioPromptModalState | null;
  setPromptModal: React.Dispatch<React.SetStateAction<StudioPromptModalState | null>>;
  promptBusy: boolean;
  setPromptBusy: (v: boolean) => void;
  setError: (v: string | null) => void;
}) {
  return (
    <>
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900 mb-3">Tạo dự án thiết kế mới</h3>
            <form onSubmit={handleCreateProject} className="space-y-3.5 text-sm">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Loại dự án:</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewProjectType('perspective_3d')}
                    className={`rounded-xl p-2.5 font-bold border text-center transition ${
                      newProjectType === 'perspective_3d'
                        ? 'border-[#1E3A8A] bg-blue-50 text-[#1E3A8A]'
                        : 'border-slate-200 text-slate-600'
                    }`}
                  >
                    Phối cảnh 3D LED
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewProjectType('banner')}
                    className={`rounded-xl p-2.5 font-bold border text-center transition ${
                      newProjectType === 'banner'
                        ? 'border-[#1E3A8A] bg-blue-50 text-[#1E3A8A]'
                        : 'border-slate-200 text-slate-600'
                    }`}
                  >
                    Banner khung LED
                  </button>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Tên dự án *:</label>
                <input
                  type="text"
                  required
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Hồ sơ Lead liên kết (Tùy chọn):
                </label>
                <select
                  value={newLeadId}
                  onChange={(e) => setNewLeadId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                >
                  <option value="">-- Không gắn Lead (Thiết kế độc lập) --</option>
                  {leadOptions.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Người liên hệ:</label>
                <input
                  type="text"
                  value={newContactName}
                  onChange={(e) => setNewContactName(e.target.value)}
                  placeholder="Tên khách hàng / đại diện dự án"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Con AI thực thi ban đầu:
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={selectedProviderId}
                    onChange={(e) => {
                      const nextPid = e.target.value as AiProviderId;
                      setSelectedProviderId(nextPid);
                      const cat = providerStatus?.availableProviders?.find(
                        (p) => p.providerId === nextPid,
                      );
                      if (cat && cat.models.length > 0) {
                        setSelectedModelId(cat.activeModel || cat.models[0].id);
                      }
                    }}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium"
                  >
                    {(providerStatus?.availableProviders || []).map((prov) => (
                      <option key={prov.providerId} value={prov.providerId}>
                        {prov.shortName}
                      </option>
                    ))}
                  </select>
                  <select
                    value={selectedModelId}
                    onChange={(e) => setSelectedModelId(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium"
                  >
                    {(
                      providerStatus?.availableProviders?.find(
                        (p) => p.providerId === selectedProviderId,
                      )?.models || [{ id: 'imagen-3.0-generate-002', name: 'Google Imagen 3 Pro' }]
                    ).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Ảnh công trình khảo sát (Tùy chọn — có thể tải thêm sau):
                </label>
                <label className="flex cursor-pointer items-center justify-between rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3.5 py-2.5 text-xs font-semibold text-slate-700 hover:border-[#1E3A8A] hover:bg-blue-50/40">
                  <span className="truncate">
                    {newProjectFiles.length > 0
                      ? `Đã chọn ${newProjectFiles.length} ảnh (${newProjectFiles.map((f) => f.name).join(', ')})`
                      : '📤 Bấm để chọn ảnh công trình của dự án này...'}
                  </span>
                  <input
                    type="file"
                    multiple
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      setNewProjectFiles(files);
                    }}
                  />
                </label>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Ghi chú vị trí lắp đặt (Tùy chọn):
                </label>
                <textarea
                  rows={2}
                  value={newPrompt}
                  onChange={(e) => setNewPrompt(e.target.value)}
                  placeholder="VD: Mặt tiền sảnh chính, vách hội trường tầng 2..."
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-xl bg-[#1E3A8A] px-5 py-2 text-sm font-bold text-white hover:bg-[#2563EB] shadow-xs"
                >
                  {submitting ? 'Đang khởi tạo...' : 'Tạo dự án'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingName && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <div>
                <h4 className="text-base font-bold text-slate-900">Sửa nhanh thông tin dự án</h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Cập nhật nhanh tên dự án, loại thiết kế, hồ sơ Lead liên kết và kích thước màn hình LED
                </p>
              </div>
              <span className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-bold text-[#1E3A8A] border border-blue-200">
                DA-{String(renameTargetId || currentProject?.id || 1).padStart(4, '0')}
              </span>
            </div>

            <form onSubmit={handleRenameProject} className="space-y-3.5 text-sm">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">
                  Tên dự án thiết kế <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  data-testid="quick-edit-project-name-input"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-medium text-slate-900 focus:border-[#2563EB] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">
                  Loại dự án
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setQuickEditDesignType('perspective_3d')}
                    className={`rounded-xl border px-3 py-2 text-xs font-bold transition ${
                      quickEditDesignType === 'perspective_3d'
                        ? 'border-[#1E3A8A] bg-blue-50 text-[#1E3A8A]'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Phối cảnh 3D LED
                  </button>
                  <button
                    type="button"
                    onClick={() => setQuickEditDesignType('banner')}
                    className={`rounded-xl border px-3 py-2 text-xs font-bold transition ${
                      quickEditDesignType === 'banner'
                        ? 'border-[#1E3A8A] bg-blue-50 text-[#1E3A8A]'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Banner khung LED
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Hồ sơ Lead liên kết:
                  </label>
                  <select
                    value={quickEditLeadId}
                    onChange={(e) => setQuickEditLeadId(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-[#2563EB] focus:outline-none"
                  >
                    <option value="">-- Không gắn Lead --</option>
                    {leadOptions.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Người liên hệ:
                  </label>
                  <input
                    type="text"
                    value={quickEditContactName}
                    onChange={(e) => setQuickEditContactName(e.target.value)}
                    placeholder="Tên khách hàng / đại diện"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-800 focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Dòng Pitch LED:
                  </label>
                  <select
                    value={quickEditPitch}
                    onChange={(e) => setQuickEditPitch(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-800"
                  >
                    {[
                      'P1.25',
                      'P1.53',
                      'P1.86',
                      'P2.0',
                      'P2.5',
                      'P3.0',
                      'P4.0',
                      'P5.0',
                      'P8.0',
                      'P10',
                    ].map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Ngang (m):
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.5"
                    value={quickEditWidthM}
                    onChange={(e) => setQuickEditWidthM(Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Cao (m):
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.5"
                    value={quickEditHeightM}
                    onChange={(e) => setQuickEditHeightM(Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-800"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Vị trí lắp đặt / Ghi chú công trình:
                </label>
                <input
                  type="text"
                  value={quickEditInstallInfo}
                  onChange={(e) => setQuickEditInstallInfo(e.target.value)}
                  placeholder="VD: Sảnh chính tầng 1, cách sàn 1.2m..."
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-800 focus:border-[#2563EB] focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    const targetProj = requests.find(
                      (r) => r.id === (renameTargetId || currentProject?.id),
                    );
                    setEditingName(false);
                    setRenameTargetId(null);
                    if (targetProj) {
                      requestDeleteProject(targetProj);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50/70 px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-100 transition"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Xóa dự án này</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingName(false);
                      setRenameTargetId(null);
                    }}
                    className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    data-testid="quick-edit-save-btn"
                    disabled={savingQuickEdit || !renameValue.trim()}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#1E3A8A] px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-[#2563EB] disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" />
                    <span>{savingQuickEdit ? 'Đang lưu...' : 'Lưu cập nhật'}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirmModal && (
        <div
          role="dialog"
          aria-modal="true"
          data-testid="custom-confirm-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-start gap-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600 border border-red-200/80">
                <Trash2 className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="text-base font-bold text-slate-900">{confirmModal.title}</h4>
                {confirmModal.subtitle && (
                  <p className="mt-0.5 text-xs font-semibold text-slate-500">
                    {confirmModal.subtitle}
                  </p>
                )}
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                  {confirmModal.message}
                </p>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
              <button
                type="button"
                disabled={confirmBusy}
                onClick={() => setConfirmModal(null)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                data-testid="custom-confirm-accept-btn"
                disabled={confirmBusy}
                onClick={async () => {
                  setConfirmBusy(true);
                  try {
                    await confirmModal.onConfirm();
                    setConfirmModal(null);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Thao tác thất bại.');
                    setConfirmModal(null);
                  } finally {
                    setConfirmBusy(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-red-700 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>{confirmBusy ? 'Đang xử lý...' : confirmModal.confirmLabel}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {promptModal && (
        <div
          role="dialog"
          aria-modal="true"
          data-testid="custom-prompt-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-xs"
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!promptModal.value.trim()) return;
              setPromptBusy(true);
              try {
                await promptModal.onConfirm(promptModal.value);
                setPromptModal(null);
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Không thể lưu thay đổi.');
                setPromptModal(null);
              } finally {
                setPromptBusy(false);
              }
            }}
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
          >
            <div className="flex items-center gap-2.5 mb-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#1E3A8A] border border-blue-200">
                <Edit2 className="h-4 w-4" />
              </div>
              <div>
                <h4 className="text-base font-bold text-slate-900">{promptModal.title}</h4>
                <p className="text-xs text-slate-500">{promptModal.label}</p>
              </div>
            </div>

            <input
              type="text"
              autoFocus
              required
              value={promptModal.value}
              placeholder={promptModal.placeholder}
              onChange={(e) =>
                setPromptModal((prev) => (prev ? { ...prev, value: e.target.value } : null))
              }
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:border-[#2563EB] focus:outline-none"
            />

            <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                disabled={promptBusy}
                onClick={() => setPromptModal(null)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={promptBusy || !promptModal.value.trim()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#1E3A8A] px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-[#2563EB] disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" />
                <span>{promptBusy ? 'Đang lưu...' : 'Lưu thay đổi'}</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
export default StudioProjectModals;
