'use client';

import React from 'react';
import { Settings2, Sparkles } from 'lucide-react';
import type { AiProviderId } from '@toantrung/contracts';
import type { DiscoveredModelOption, ProviderStatusInfo } from './ai-workspace-helpers';

export interface StudioPromptLibraryEntry {
  id: string;
  title: string;
  prompt: string;
  category: 'tao_anh' | 'tao_poster' | 'tu_van';
  createdAt: string;
}

export function StudioAiConfigAndPromptModals({
  showAiConfigModal,
  setShowAiConfigModal,
  aiModalTab,
  setAiModalTab,
  autoDiscoveredModels,
  consultantModelId,
  setConsultantModelId,
  setConsultantModelName,
  setSelectedModelId,
  setSelectedProviderId,
  setConfigModalProviderId,
  setConfigCustomModelInput,
  setSuccessToast,
  providerStatus,
  gmailGeminiKeyInput,
  setGmailGeminiKeyInput,
  quickCustomEndpoint,
  setQuickCustomEndpoint,
  parseSmartPastedAiInput,
  testingAiConnection,
  savingAiConfig,
  handleQuickConnectGmailGemini,
  testAiResult,
  showPromptLibraryModal,
  setShowPromptLibraryModal,
  editingPromptId,
  setEditingPromptId,
  newSavedPromptTitle,
  setNewSavedPromptTitle,
  newSavedPromptCat,
  setNewSavedPromptCat,
  newSavedPromptText,
  setNewSavedPromptText,
  promptLibrary,
  savePromptLibraryToStorage,
  promptLibCategoryFilter,
  setPromptLibCategoryFilter,
  handlePromptChange,
  executeChatSubmit,
}: {
  showAiConfigModal: boolean;
  setShowAiConfigModal: (v: boolean) => void;
  aiModalTab: 'select_ai' | 'setting_ai';
  setAiModalTab: (v: 'select_ai' | 'setting_ai') => void;
  autoDiscoveredModels: DiscoveredModelOption[];
  consultantModelId: string;
  setConsultantModelId: (v: string) => void;
  setConsultantModelName: (v: string) => void;
  setSelectedModelId: (v: string) => void;
  setSelectedProviderId: (v: AiProviderId) => void;
  setConfigModalProviderId: (v: AiProviderId) => void;
  setConfigCustomModelInput: (v: string) => void;
  setSuccessToast: (v: string | null) => void;
  providerStatus: ProviderStatusInfo | null;
  gmailGeminiKeyInput: string;
  setGmailGeminiKeyInput: (v: string) => void;
  quickCustomEndpoint: string;
  setQuickCustomEndpoint: (v: string) => void;
  parseSmartPastedAiInput: (raw: string) => { key: string; url?: string };
  testingAiConnection: boolean;
  savingAiConfig: boolean;
  handleQuickConnectGmailGemini: () => Promise<void> | void;
  testAiResult: { ok: boolean; replyText: string; latencyMs: number } | null;
  showPromptLibraryModal: boolean;
  setShowPromptLibraryModal: (v: boolean) => void;
  editingPromptId: string | null;
  setEditingPromptId: (v: string | null) => void;
  newSavedPromptTitle: string;
  setNewSavedPromptTitle: (v: string) => void;
  newSavedPromptCat: 'tao_anh' | 'tao_poster' | 'tu_van';
  setNewSavedPromptCat: (v: 'tao_anh' | 'tao_poster' | 'tu_van') => void;
  newSavedPromptText: string;
  setNewSavedPromptText: (v: string) => void;
  promptLibrary: StudioPromptLibraryEntry[];
  savePromptLibraryToStorage: (nextList: StudioPromptLibraryEntry[]) => void;
  promptLibCategoryFilter: 'all' | 'tao_anh' | 'tao_poster' | 'tu_van';
  setPromptLibCategoryFilter: (v: 'all' | 'tao_anh' | 'tao_poster' | 'tu_van') => void;
  handlePromptChange: (val: string) => void;
  executeChatSubmit: (val: string) => void;
}) {
  return (
    <>
      {showAiConfigModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
          onClick={() => setShowAiConfigModal(false)}
        >
          <div
            className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex items-center gap-1.5 rounded-xl bg-slate-200/80 p-1">
                <button
                  type="button"
                  data-testid="ai-config-tab-select"
                  onClick={() => setAiModalTab('select_ai')}
                  className={`rounded-lg px-3.5 py-1.5 text-xs font-extrabold transition ${
                    aiModalTab === 'select_ai'
                      ? 'bg-white text-[#1553A2] shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  1. Chọn AI
                </button>
                <button
                  type="button"
                  data-testid="ai-config-tab-setting"
                  onClick={() => setAiModalTab('setting_ai')}
                  className={`rounded-lg px-3.5 py-1.5 text-xs font-extrabold transition ${
                    aiModalTab === 'setting_ai'
                      ? 'bg-white text-[#6D28D9] shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  2. Setting &amp; Thêm AI
                </button>
              </div>

              <button
                type="button"
                onClick={() => setShowAiConfigModal(false)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-600 hover:bg-slate-100"
              >
                Đóng ✕
              </button>
            </div>

            {aiModalTab === 'select_ai' ? (
              <div className="flex-1 overflow-y-auto bg-white p-4 text-xs text-[#17253F] space-y-3">
                <div className="flex items-center justify-between px-1">
                  <div>
                    <span className="text-xs font-extrabold uppercase tracking-wide text-[#17253F]">
                      Model khả dụng từ API đã gắn ({autoDiscoveredModels.length})
                    </span>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Gắn API của hãng nào hệ thống tự động đọc &amp; phân biệt đúng loại Model của API đó.
                    </p>
                  </div>
                </div>

                {autoDiscoveredModels.some((m) => m.category === 'image') && (
                  <div className="space-y-1">
                    <div className="px-2 py-1 text-[11px] font-extrabold uppercase tracking-wider text-[#6D28D9]">
                      🎨 Model Tạo Phối Cảnh, Ghép SP &amp; Banner
                    </div>
                    {autoDiscoveredModels
                      .filter((m) => m.category === 'image')
                      .map((m) => {
                        const isSelected = consultantModelId === m.id;
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => {
                              setConsultantModelId(m.id);
                              setConsultantModelName(m.name);
                              setSelectedModelId(m.id);
                              setSelectedProviderId(m.providerId);
                              setConfigModalProviderId(m.providerId);
                              setConfigCustomModelInput(m.id);
                              setSuccessToast(`Đã chọn Model: ${m.name} (${m.providerLabel})`);
                              setShowAiConfigModal(false);
                            }}
                            className={`flex w-full items-center justify-between rounded-xl border px-3.5 py-2.5 text-left transition ${
                              isSelected
                                ? 'border-[#1553A2] bg-blue-50/90 text-[#1553A2] font-extrabold shadow-2xs'
                                : 'border-slate-200 bg-white text-slate-800 hover:border-blue-300 hover:bg-slate-50'
                            }`}
                          >
                            <div className="flex flex-wrap items-center gap-2 min-w-0">
                              <span className="truncate text-[13px]">{m.name}</span>
                              <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 border border-slate-200">
                                {m.providerLabel}
                              </span>
                              <span className="shrink-0 rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-bold text-[#6D28D9] border border-purple-200">
                                {m.badge}
                              </span>
                            </div>
                            <span
                              className={`shrink-0 text-sm font-extrabold ${
                                isSelected ? 'text-[#1553A2]' : 'text-slate-400'
                              }`}
                            >
                              {isSelected ? '✓' : '›'}
                            </span>
                          </button>
                        );
                      })}
                  </div>
                )}

                {autoDiscoveredModels.some((m) => m.category === 'chat') && (
                  <div className="space-y-1">
                    <div className="px-2 py-1 text-[11px] font-extrabold uppercase tracking-wider text-[#1553A2]">
                      💬 Model Trò Chuyện &amp; Phân Tích Ảnh
                    </div>
                    {autoDiscoveredModels
                      .filter((m) => m.category === 'chat')
                      .map((m) => {
                        const isSelected = consultantModelId === m.id;
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => {
                              setConsultantModelId(m.id);
                              setConsultantModelName(m.name);
                              setSelectedModelId(m.id);
                              setSelectedProviderId(m.providerId);
                              setConfigModalProviderId(m.providerId);
                              setConfigCustomModelInput(m.id);
                              setSuccessToast(`Đã chọn Model: ${m.name} (${m.providerLabel})`);
                              setShowAiConfigModal(false);
                            }}
                            className={`flex w-full items-center justify-between rounded-xl border px-3.5 py-2.5 text-left transition ${
                              isSelected
                                ? 'border-[#1553A2] bg-blue-50/90 text-[#1553A2] font-extrabold shadow-2xs'
                                : 'border-slate-200 bg-white text-slate-800 hover:border-blue-300 hover:bg-slate-50'
                            }`}
                          >
                            <div className="flex flex-wrap items-center gap-2 min-w-0">
                              <span className="truncate text-[13px]">{m.name}</span>
                              <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 border border-slate-200">
                                {m.providerLabel}
                              </span>
                              <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                                {m.badge}
                              </span>
                            </div>
                            <span
                              className={`shrink-0 text-sm font-extrabold ${
                                isSelected ? 'text-[#1553A2]' : 'text-slate-400'
                              }`}
                            >
                              {isSelected ? '✓' : '›'}
                            </span>
                          </button>
                        );
                      })}
                  </div>
                )}

                <div className="sr-only">
                  {(providerStatus?.availableProviders || []).map((prov) => (
                    <button
                      key={prov.providerId}
                      type="button"
                      data-testid={`multi-ai-card-${prov.providerId}`}
                      onClick={() => setConfigModalProviderId(prov.providerId)}
                    >
                      {prov.shortName}
                    </button>
                  ))}
                </div>

                <div className="border-t border-slate-200 pt-2.5">
                  <button
                    type="button"
                    onClick={() => setAiModalTab('setting_ai')}
                    className="flex w-full items-center justify-between rounded-xl border border-blue-200 bg-blue-50/60 px-3.5 py-2.5 text-left text-[13px] font-bold text-[#1553A2] transition hover:bg-blue-100/70"
                  >
                    <span className="inline-flex items-center gap-2">
                      <Settings2 className="h-4 w-4 text-[#1553A2]" />
                      <span>🔑 Gắn API Key mới (Tự nhận diện hãng &amp; đọc đúng Model của Key)</span>
                    </span>
                    <span className="text-[#1553A2] font-bold">›</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto bg-white p-5 space-y-4 text-xs">
                <div className="rounded-2xl border border-blue-200 bg-blue-50/40 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="text-sm font-extrabold text-[#17253F] block">
                        🔑 Gắn mã API Key — Tự động nhận diện hãng &amp; đọc đúng loại Model
                      </span>
                      <span className="text-[11px] text-slate-600">
                        Hỗ trợ tự phân biệt Key <strong>Google Gemini/Imagen (`AIza...`)</strong>,{' '}
                        <strong>OpenAI (`sk-proj-...`)</strong>, <strong>Custom AI Gateway (`sk-...`)</strong>,{' '}
                        <strong>OpenRouter (`sk-or-...`)</strong>.
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        data-testid="gmail-gemini-key-input"
                        type="password"
                        autoComplete="off"
                        value={gmailGeminiKeyInput}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const parsed = parseSmartPastedAiInput(raw);
                          setGmailGeminiKeyInput(parsed.key);
                          if (parsed.url && !quickCustomEndpoint.trim()) {
                            setQuickCustomEndpoint(parsed.url);
                          }
                        }}
                        placeholder="Dán mã API Key (hoặc dán cả cặp URL + Key — hệ thống tự tách & nhận diện)"
                        className="flex-1 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 font-mono text-xs text-slate-900 focus:border-[#1553A2] focus:outline-none"
                      />
                      <button
                        type="button"
                        data-testid="gmail-gemini-connect-btn"
                        disabled={testingAiConnection || savingAiConfig}
                        onClick={handleQuickConnectGmailGemini}
                        className="shrink-0 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#1553A2] px-4 py-2.5 font-extrabold text-white hover:bg-[#1E3A8A] disabled:opacity-50 shadow-2xs"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>
                          {testingAiConnection
                            ? 'Đang tự dò cổng & đọc Model...'
                            : 'Kết nối & Tự đọc Model'}
                        </span>
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                        Chọn nhanh cổng API:
                      </span>
                      {(
                        [
                          { label: 'Tự động dò', url: '' },
                          { label: 'OpenAI', url: 'https://api.openai.com/v1' },
                          {
                            label: 'Google Gemini',
                            url: 'https://generativelanguage.googleapis.com/v1beta',
                          },
                          { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
                          { label: 'DeepSeek', url: 'https://api.deepseek.com/v1' },
                          { label: 'Groq', url: 'https://api.groq.com/openai/v1' },
                        ] as const
                      ).map((preset) => {
                        const isPicked = quickCustomEndpoint.trim() === preset.url;
                        return (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() => setQuickCustomEndpoint(preset.url)}
                            className={`px-2 py-0.5 rounded-md border text-[11px] font-semibold transition ${
                              isPicked
                                ? 'bg-[#1553A2] border-[#1553A2] text-white'
                                : 'bg-white border-slate-200 text-slate-600 hover:border-blue-300 hover:text-[#1553A2]'
                            }`}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex items-center gap-2 pt-0.5">
                      <span className="text-[11px] text-slate-500 font-medium shrink-0">
                        Gateway / Proxy URL (tùy chọn):
                      </span>
                      <input
                        type="text"
                        value={quickCustomEndpoint}
                        onChange={(e) => setQuickCustomEndpoint(e.target.value)}
                        placeholder="Để trống để tự dò (hoặc dán URL cổng Relay riêng VD: https://api.nhacungcap.com/v1)"
                        className="flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-[11px] text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                    <p className="text-[10.5px] text-slate-500 leading-relaxed">
                      💡 <strong>Đổi Key không cần sửa code:</strong> Key hãng chính thức (Google, OpenAI, OpenRouter, DeepSeek, Groq) chỉ cần dán Key và bấm Kết nối. Nếu dùng Key từ cổng Proxy/Relay bên thứ 3, dán thêm <strong>Gateway URL</strong> 1 lần duy nhất — hệ thống sẽ tự mã hóa &amp; ghi nhớ cổng cho mọi lần đổi Key sau.
                    </p>
                  </div>

                  {testAiResult && (
                    <div
                      className={`rounded-xl px-3.5 py-2.5 text-[11px] font-bold border ${
                        testAiResult.ok
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                          : 'bg-red-50 border-red-200 text-red-800'
                      }`}
                    >
                      {testAiResult.ok ? '✅ ' : '❌ '}
                      {testAiResult.replyText} ({testAiResult.latencyMs}ms)
                    </div>
                  )}

                  {autoDiscoveredModels.length > 0 && (
                    <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-extrabold text-[#17253F]">
                          📋 Các Model thực tế đọc được từ API đã gắn ({autoDiscoveredModels.length} Model):
                        </span>
                        <button
                          type="button"
                          onClick={() => setAiModalTab('select_ai')}
                          className="text-[11px] font-bold text-[#1553A2] hover:underline"
                        >
                          Mở bảng chọn ›
                        </button>
                      </div>
                      <select
                        value={consultantModelId}
                        onChange={(e) => {
                          const nextId = e.target.value;
                          setConsultantModelId(nextId);
                          setSelectedModelId(nextId);
                          const found = autoDiscoveredModels.find((m) => m.id === nextId);
                          if (found) {
                            setConsultantModelName(found.name);
                            setSelectedProviderId(found.providerId);
                          } else {
                            setConsultantModelName(nextId);
                          }
                          setSuccessToast(`Đã chuyển sang Model: ${found ? found.name : nextId}`);
                        }}
                        className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-extrabold text-[#1553A2] focus:border-[#1553A2] focus:outline-none"
                      >
                        {autoDiscoveredModels.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} — [{m.providerLabel} · {m.badge}]
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showPromptLibraryModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs"
          onClick={() => setShowPromptLibraryModal(false)}
        >
          <div
            className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-r from-[#17253F] to-[#1E3A8A] px-5 py-3.5 text-white">
              <div>
                <h3 className="text-base font-extrabold flex items-center gap-2">
                  <span>📚 Thư viện Lưu trữ Lệnh Prompt (Toàn Trung AI Studio)</span>
                </h3>
                <p className="text-xs text-blue-100 mt-0.5">
                  Lưu trữ, phân loại và tái sử dụng nhanh các câu lệnh @TaoAnh, @TaoAnhPoster và Phân tích kỹ thuật ($0)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPromptLibraryModal(false)}
                className="rounded-lg bg-white/10 px-2.5 py-1 text-xs font-bold text-white hover:bg-white/20"
              >
                ✕ Đóng
              </button>
            </div>

            <div className="border-b border-slate-200 bg-slate-50 p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-extrabold uppercase tracking-wide text-slate-700">
                  {editingPromptId
                    ? '✏️ Chỉnh sửa lệnh Prompt đã lưu'
                    : '➕ Thêm / Lưu lệnh Prompt mới vào thư viện'}
                </span>
                {editingPromptId && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingPromptId(null);
                      setNewSavedPromptTitle('');
                      setNewSavedPromptText('');
                    }}
                    className="text-xs font-bold text-slate-500 hover:text-slate-800"
                  >
                    Huỷ sửa
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                <input
                  type="text"
                  value={newSavedPromptTitle}
                  onChange={(e) => setNewSavedPromptTitle(e.target.value)}
                  placeholder="Tên gợi nhớ (VD: Phối cảnh LED P2.5 Hội trường)..."
                  className="sm:col-span-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 focus:border-[#1553A2] focus:outline-none"
                />
                <select
                  value={newSavedPromptCat}
                  onChange={(e) =>
                    setNewSavedPromptCat(e.target.value as 'tao_anh' | 'tao_poster' | 'tu_van')
                  }
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 focus:border-[#1553A2] focus:outline-none"
                >
                  <option value="tao_anh">🏢 @TaoAnh (Phối cảnh 3D)</option>
                  <option value="tao_poster">🖼️ @TaoAnhPoster (Banner/Poster)</option>
                  <option value="tu_van">🔍 Phân tích &amp; Tư vấn ($0)</option>
                </select>
              </div>
              <div className="mt-2 flex gap-2">
                <textarea
                  rows={2}
                  value={newSavedPromptText}
                  onChange={(e) => setNewSavedPromptText(e.target.value)}
                  placeholder="Nhập nội dung câu lệnh Prompt (VD: @TaoAnh: Ghép màn hình LED P2.5 4800x2700mm vào 4 điểm chạm...)"
                  className="flex-1 resize-none rounded-xl border border-slate-300 bg-white p-2.5 text-xs text-slate-800 focus:border-[#1553A2] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    const text = newSavedPromptText.trim();
                    if (!text) return;
                    const title =
                      newSavedPromptTitle.trim() ||
                      text
                        .replace(/^\s*@(?:taoanhposter|taoposter|tao[j]?anh)\s*:?\s*/i, '')
                        .slice(0, 48) ||
                      'Lệnh Prompt mới';
                    if (editingPromptId) {
                      const updated = promptLibrary.map((item) =>
                        item.id === editingPromptId
                          ? { ...item, title, prompt: text, category: newSavedPromptCat }
                          : item,
                      );
                      savePromptLibraryToStorage(updated);
                      setEditingPromptId(null);
                      setSuccessToast('Đã cập nhật câu lệnh trong Thư viện Prompt!');
                    } else {
                      const newItem: StudioPromptLibraryEntry = {
                        id: `custom-${Date.now()}`,
                        title,
                        prompt: text,
                        category: newSavedPromptCat,
                        createdAt: new Date().toLocaleDateString('vi-VN'),
                      };
                      savePromptLibraryToStorage([newItem, ...promptLibrary]);
                      setSuccessToast('Đã thêm lệnh mới vào Thư viện Prompt!');
                    }
                    setNewSavedPromptTitle('');
                    setNewSavedPromptText('');
                  }}
                  disabled={!newSavedPromptText.trim()}
                  className="shrink-0 rounded-xl bg-[#1553A2] px-4 py-2 text-xs font-extrabold text-white shadow-xs hover:bg-[#1E3A8A] disabled:opacity-40"
                >
                  {editingPromptId ? '💾 Cập nhật' : '+ Lưu vào thư viện'}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-1.5 border-b border-slate-200 bg-white px-4 py-2.5">
              {[
                { id: 'all', label: `Tất cả (${promptLibrary.length})` },
                {
                  id: 'tao_anh',
                  label: `🏢 Phối cảnh @TaoAnh (${promptLibrary.filter((p) => p.category === 'tao_anh').length})`,
                },
                {
                  id: 'tao_poster',
                  label: `🖼️ Banner @TaoAnhPoster (${promptLibrary.filter((p) => p.category === 'tao_poster').length})`,
                },
                {
                  id: 'tu_van',
                  label: `🔍 Tư vấn $0 (${promptLibrary.filter((p) => p.category === 'tu_van').length})`,
                },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() =>
                    setPromptLibCategoryFilter(
                      tab.id as 'all' | 'tao_anh' | 'tao_poster' | 'tu_van',
                    )
                  }
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                    promptLibCategoryFilter === tab.id
                      ? 'bg-[#1553A2] text-white shadow-2xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
              {promptLibrary
                .filter(
                  (item) =>
                    promptLibCategoryFilter === 'all' || item.category === promptLibCategoryFilter,
                )
                .map((item) => (
                  <div
                    key={item.id}
                    className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs hover:border-blue-300 transition"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-md px-2 py-0.5 text-[10px] font-extrabold ${
                              item.category === 'tao_poster'
                                ? 'bg-pink-100 text-pink-700'
                                : item.category === 'tao_anh'
                                  ? 'bg-purple-100 text-purple-700'
                                  : 'bg-emerald-100 text-emerald-700'
                            }`}
                          >
                            {item.category === 'tao_poster'
                              ? '@TaoAnhPoster'
                              : item.category === 'tao_anh'
                                ? '@TaoAnh 3D'
                                : 'Tư vấn $0'}
                          </span>
                          <h4 className="truncate text-xs font-extrabold text-slate-900">
                            {item.title}
                          </h4>
                          <span className="text-[10px] font-medium text-slate-400">
                            · {item.createdAt}
                          </span>
                        </div>
                        <p className="mt-1.5 text-xs text-slate-600 bg-slate-50 rounded-lg p-2 border border-slate-100 font-medium">
                          {item.prompt}
                        </p>
                      </div>
                    </div>

                    <div className="mt-2.5 flex flex-wrap items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingPromptId(item.id);
                          setNewSavedPromptTitle(item.title);
                          setNewSavedPromptText(item.prompt);
                          setNewSavedPromptCat(item.category);
                        }}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
                      >
                        ✏️ Sửa
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const filtered = promptLibrary.filter((p) => p.id !== item.id);
                          savePromptLibraryToStorage(filtered);
                          setSuccessToast(`Đã xoá lệnh "${item.title}" khỏi thư viện.`);
                        }}
                        className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-600 hover:bg-red-100"
                      >
                        🗑 Xoá
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          handlePromptChange(item.prompt);
                          setShowPromptLibraryModal(false);
                          setSuccessToast(`Đã chèn lệnh "${item.title}" vào ô chat.`);
                        }}
                        className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-extrabold text-[#1553A2] hover:bg-blue-100"
                      >
                        📥 Chèn vào ô chat
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          handlePromptChange(item.prompt);
                          setShowPromptLibraryModal(false);
                          executeChatSubmit(item.prompt);
                        }}
                        className="rounded-lg bg-[#7846FF] px-3 py-1 text-[11px] font-extrabold text-white shadow-2xs hover:bg-[#6D28D9]"
                      >
                        ⚡ Chạy lệnh ngay
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
export default StudioAiConfigAndPromptModals;
