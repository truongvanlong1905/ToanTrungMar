'use client';

import React, { useRef, useState } from 'react';
import { Download, FolderUp, X } from 'lucide-react';
import type { LeadItemDto, SessionUserDto } from '@toantrung/contracts';
import { apiRequest } from '@/core/http/client';

export interface LeadImportPreviewRow {
  rowNumber: number;
  phone: string;
  contactName: string;
  companyName: string;
  projectName: string;
  email: string;
  source: string;
  region: string;
  address: string;
  productsText: string;
  note: string;
}

export function LeadExcelImportModal({
  open,
  onClose,
  user,
  leads,
  onImported,
  onOpenLeadDetail,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  user: SessionUserDto | null;
  leads: LeadItemDto[];
  onImported: (message: string) => Promise<void> | void;
  onOpenLeadDetail: (leadId: number) => void;
  onError: (msg: string | null) => void;
}) {
  const [importPreviewRows, setImportPreviewRows] = useState<LeadImportPreviewRow[]>([]);
  const [importParsing, setImportParsing] = useState(false);
  const [importCommitting, setImportCommitting] = useState(false);
  const [importSkipOpenDup, setImportSkipOpenDup] = useState(true);
  const [importPastedText, setImportPastedText] = useState('');
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  if (!open) return null;

  const seenPhonesInBatch = new Set<string>();
  const evaluatedRows = importPreviewRows.map((row) => {
    const rawDigits = (row.phone || '').replace(/\D/g, '');
    const normPhone =
      rawDigits.startsWith('84') && rawDigits.length >= 10
        ? `0${rawDigits.slice(2)}`
        : rawDigits.length === 9 && !rawDigits.startsWith('0')
          ? `0${rawDigits}`
          : rawDigits;
    const normComp = (row.companyName || '').trim().toLowerCase();

    const isDupInBatch = normPhone.length >= 8 && seenPhonesInBatch.has(normPhone);
    if (normPhone.length >= 8) {
      seenPhonesInBatch.add(normPhone);
    }

    const matchedLeads = leads.filter((l) => {
      if (l.spamStatus !== 'NONE') return false;
      const lPhone = (l.phone || '').replace(/\D/g, '');
      const phoneHit = normPhone.length >= 8 && !lPhone.includes('*') && lPhone === normPhone;
      const compHit =
        normComp.length >= 5 && (l.companyName || '').trim().toLowerCase() === normComp;
      return phoneHit || compHit;
    });

    const openMatch = matchedLeads.find(
      (l) =>
        l.pipelineStatus === 'new_lead' ||
        l.pipelineStatus === 'quoting' ||
        l.pipelineStatus === 'quote_sent',
    );
    const wonMatch = matchedLeads.find((l) => l.pipelineStatus === 'won');
    const lostMatch = matchedLeads.find((l) => l.pipelineStatus === 'lost');

    let rowStatus: 'OPEN_DUP' | 'IN_FILE_DUP' | 'WON_RETURNING' | 'LOST_RETURNING' | 'NEW_VALID' =
      'NEW_VALID';
    let matchedLead: LeadItemDto | null = null;

    if (openMatch) {
      rowStatus = 'OPEN_DUP';
      matchedLead = openMatch;
    } else if (isDupInBatch) {
      rowStatus = 'IN_FILE_DUP';
    } else if (wonMatch) {
      rowStatus = 'WON_RETURNING';
      matchedLead = wonMatch;
    } else if (lostMatch) {
      rowStatus = 'LOST_RETURNING';
      matchedLead = lostMatch;
    }

    return {
      ...row,
      rowStatus,
      matchedLead,
    };
  });

  const openDupCount = evaluatedRows.filter(
    (r) => r.rowStatus === 'OPEN_DUP' || r.rowStatus === 'IN_FILE_DUP',
  ).length;
  const wonReturningCount = evaluatedRows.filter((r) => r.rowStatus === 'WON_RETURNING').length;
  const lostReturningCount = evaluatedRows.filter((r) => r.rowStatus === 'LOST_RETURNING').length;
  const newValidCount = evaluatedRows.filter((r) => r.rowStatus === 'NEW_VALID').length;

  const rowsToCommit = importSkipOpenDup
    ? evaluatedRows.filter(
        (r) => r.rowStatus !== 'OPEN_DUP' && r.rowStatus !== 'IN_FILE_DUP',
      )
    : evaluatedRows;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-5xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-auto flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-700 text-white flex items-center justify-center shadow-xs">
              <FolderUp className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display font-bold text-slate-900 text-lg">
                Nhập danh sách Lead từ Excel (.xlsx / .csv)
              </h2>
              <p className="text-xs text-slate-500">
                Tự động chuẩn hóa SĐT và phát cảnh báo trùng lặp / khách cũ quay lại trên từng dòng trước khi lưu
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setImportFileName('5_Truong_Hop_Test_Mau.xlsx');
                setImportPreviewRows([
                  {
                    rowNumber: 6,
                    phone: '0908100201',
                    contactName: 'Anh Minh Hoàng (TH1: Khách cũ đã mua)',
                    companyName: 'Công ty CP Trung tâm Hội nghị Ánh Dương',
                    projectName: 'Màn hình LED Hội trường Tầng 6',
                    email: 'minh.hoang@anhduong.vn',
                    source: 'Website Toàn Trung',
                    region: 'TP.HCM - TP. Thủ Đức',
                    address: 'Khu Công Nghệ Cao, TP. Thủ Đức',
                    productsText: 'Màn hình LED Indoor',
                    note: 'Trùng với TT-20261101-0001 đã Chốt thành công',
                  },
                  {
                    rowNumber: 7,
                    phone: '0364759204',
                    contactName: 'Anh Long (TH2: Khách thất bại quay lại)',
                    companyName: 'Công ty TNHH Xây dựng Long Phát',
                    projectName: 'Màn hình LED Phòng họp Tầng 2',
                    email: 'long@longphat.vn',
                    source: 'Zalo',
                    region: 'TP.HCM - TP. Thủ Đức',
                    address: 'Đường Võ Văn Ngân, TP. Thủ Đức',
                    productsText: 'Màn hình LED Indoor',
                    note: 'Trùng với TT-20261106-000720 từng Thất bại',
                  },
                  {
                    rowNumber: 8,
                    phone: '0908100204',
                    contactName: 'Bác sĩ Khanh (TH3: Trùng Lead đang mở)',
                    companyName: 'Bệnh viện Đa khoa Quốc tế Minh Tâm',
                    projectName: 'Màn hình LED Sảnh khám & Đồng hồ LED',
                    email: 'khanh@minhtamhospital.vn',
                    source: 'Google Ads',
                    region: 'TP.HCM - Quận 7',
                    address: 'Nguyễn Lương Bằng, Quận 7',
                    productsText: 'Màn hình LED Indoor',
                    note: 'Trùng với TT-20261105-0004 đang mở',
                  },
                  {
                    rowNumber: 9,
                    phone: '0918888999',
                    contactName: 'Chị Lan (TH4: Khách mới hợp lệ)',
                    companyName: 'Nhà máy Sản xuất Hòa Bình',
                    projectName: 'Bảng điện tử Năng suất & An toàn',
                    email: 'lan.bql@hoabinhfactory.vn',
                    source: 'Zalo',
                    region: 'Bình Dương',
                    address: 'KCN VSIP 1, Thuận An, Bình Dương',
                    productsText: 'Bảng Năng suất',
                    note: 'Khách hàng mới hoàn toàn',
                  },
                  {
                    rowNumber: 10,
                    phone: '0918888999',
                    contactName: 'Chị Lan (TH5: Lặp SĐT trong cùng file Excel)',
                    companyName: 'Nhà máy Sản xuất Hòa Bình',
                    projectName: 'Bảng điện tử Năng suất (Dòng lặp)',
                    email: 'lan.bql@hoabinhfactory.vn',
                    source: 'Website Toàn Trung',
                    region: 'Bình Dương',
                    address: 'KCN VSIP 1, Thuận An, Bình Dương',
                    productsText: 'Bảng Năng suất',
                    note: 'Trùng SĐT với dòng #9 ngay trong file Excel',
                  },
                ]);
              }}
              className="h-9 px-3 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-bold inline-flex items-center gap-1.5 transition"
            >
              <span>⚡ Nạp 5 trường hợp mẫu để test ngay</span>
            </button>
            <a
              href="/api/v1/leads/export?template=1"
              className="h-9 px-3 rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100 text-[#1E3A8A] text-xs font-bold inline-flex items-center gap-1.5 transition"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Tải file Excel mẫu (.xlsx)</span>
            </a>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div
              onClick={() => importFileInputRef.current?.click()}
              className="cursor-pointer rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50/40 hover:bg-emerald-50/80 p-4 flex flex-col items-center justify-center text-center transition"
            >
              <input
                ref={importFileInputRef}
                type="file"
                accept=".xlsx,.csv,.tsv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file || !user) return;
                  setImportFileName(file.name);
                  setImportParsing(true);
                  onError(null);
                  void (async () => {
                    try {
                      const fd = new FormData();
                      fd.append('file', file);
                      const res = await apiRequest<{ rows: LeadImportPreviewRow[] }>(
                        '/api/v1/leads/export',
                        {
                          method: 'POST',
                          csrfToken: user.csrfToken,
                          isFormData: true,
                          body: fd,
                        },
                      );
                      setImportPreviewRows(res.rows || []);
                    } catch (err) {
                      onError(err instanceof Error ? err.message : 'Không thể đọc file Excel.');
                    } finally {
                      setImportParsing(false);
                      if (importFileInputRef.current) {
                        importFileInputRef.current.value = '';
                      }
                    }
                  })();
                }}
              />
              <FolderUp className="w-7 h-7 text-emerald-700 mb-1.5" />
              <p className="text-sm font-bold text-slate-800">
                {importFileName
                  ? `Đã chọn: ${importFileName}`
                  : 'Bấm để chọn file Excel (.xlsx, .csv)'}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                Hỗ trợ cả file Mẫu Nhập Lead và file Xuất Excel từ hệ thống Toàn Trung
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700">
                  Hoặc dán trực tiếp các dòng copy từ bảng Excel:
                </span>
                <button
                  type="button"
                  disabled={!importPastedText.trim() || importParsing}
                  onClick={() => {
                    if (!user || !importPastedText.trim()) return;
                    setImportParsing(true);
                    onError(null);
                    void (async () => {
                      try {
                        const fd = new FormData();
                        fd.append('pastedText', importPastedText);
                        const res = await apiRequest<{ rows: LeadImportPreviewRow[] }>(
                          '/api/v1/leads/export',
                          {
                            method: 'POST',
                            csrfToken: user.csrfToken,
                            isFormData: true,
                            body: fd,
                          },
                        );
                        setImportPreviewRows(res.rows || []);
                      } catch (err) {
                        onError(
                          err instanceof Error ? err.message : 'Không thể phân tích dữ liệu dán.',
                        );
                      } finally {
                        setImportParsing(false);
                      }
                    })();
                  }}
                  className="h-7 px-2.5 rounded-lg bg-[#1E3A8A] hover:bg-blue-900 text-white text-xs font-bold disabled:opacity-40 transition"
                >
                  Kiểm tra dữ liệu dán
                </button>
              </div>
              <textarea
                rows={2}
                value={importPastedText}
                onChange={(e) => setImportPastedText(e.target.value)}
                placeholder="Copy các dòng từ Excel (Số điện thoại | Người liên hệ | Công ty | Dự án...) và dán vào đây..."
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs focus:outline-none focus:border-[#1E3A8A]"
              />
            </div>
          </div>

          {importParsing ? (
            <div className="p-8 text-center text-sm font-semibold text-slate-600 bg-slate-50 rounded-xl border border-slate-200">
              Đang đọc file Excel và đối chiếu trùng lặp với cơ sở dữ liệu...
            </div>
          ) : evaluatedRows.length > 0 ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                  <span className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-800">
                    Tổng cộng: {evaluatedRows.length} dòng
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700">
                    Mới hợp lệ: {newValidCount}
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-900 border border-emerald-300">
                    Khách cũ quay lại (Đã mua): {wonReturningCount}
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-blue-100 text-[#1E3A8A] border border-blue-300">
                    Khách quay lại (Thất bại): {lostReturningCount}
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-rose-100 text-rose-900 border border-rose-300">
                    Cảnh báo trùng Lead đang mở: {openDupCount}
                  </span>
                </div>

                <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={importSkipOpenDup}
                    onChange={(e) => setImportSkipOpenDup(e.target.checked)}
                    className="rounded border-slate-300 text-[#1E3A8A]"
                  />
                  <span>Tự động bỏ qua dòng đang Trùng Lead đang mở ({openDupCount})</span>
                </label>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden max-h-[340px] overflow-y-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-100 text-slate-700 sticky top-0 z-10 border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3 font-bold">Dòng</th>
                      <th className="py-2.5 px-3 font-bold">Số điện thoại</th>
                      <th className="py-2.5 px-3 font-bold">Khách hàng / Công ty</th>
                      <th className="py-2.5 px-3 font-bold">Dự án &amp; Nguồn</th>
                      <th className="py-2.5 px-3 font-bold">Sản phẩm</th>
                      <th className="py-2.5 px-3 font-bold">Trạng thái Kiểm tra Trùng</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {evaluatedRows.map((r, idx) => (
                      <tr
                        key={`${r.rowNumber}-${idx}`}
                        className={
                          r.rowStatus === 'OPEN_DUP' || r.rowStatus === 'IN_FILE_DUP'
                            ? 'bg-rose-50/70'
                            : r.rowStatus === 'WON_RETURNING'
                              ? 'bg-emerald-50/50'
                              : r.rowStatus === 'LOST_RETURNING'
                                ? 'bg-blue-50/40'
                                : 'bg-white'
                        }
                      >
                        <td className="py-2 px-3 font-mono text-slate-500">#{r.rowNumber}</td>
                        <td className="py-2 px-3 font-mono font-bold text-slate-900">{r.phone}</td>
                        <td className="py-2 px-3">
                          <div className="font-semibold text-slate-900">
                            {r.companyName || r.contactName || 'Khách liên hệ'}
                          </div>
                          {r.contactName && r.companyName && (
                            <div className="text-[11px] text-slate-500">{r.contactName}</div>
                          )}
                        </td>
                        <td className="py-2 px-3">
                          <div className="text-slate-800 truncate max-w-[180px]">
                            {r.projectName || r.region}
                          </div>
                          <span className="text-[11px] text-slate-500">{r.source}</span>
                        </td>
                        <td className="py-2 px-3 text-slate-700 max-w-[160px] truncate">
                          {r.productsText}
                        </td>
                        <td className="py-2 px-3">
                          {r.rowStatus === 'OPEN_DUP' && r.matchedLead && (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="px-2 py-0.5 rounded bg-rose-600 text-white font-bold text-[11px]">
                                CẢNH BÁO TRÙNG LEAD ({r.matchedLead.leadCode})
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  onClose();
                                  onOpenLeadDetail(r.matchedLead!.id);
                                }}
                                className="text-[11px] font-bold text-[#1E3A8A] underline"
                              >
                                Xem hồ sơ →
                              </button>
                            </div>
                          )}
                          {r.rowStatus === 'IN_FILE_DUP' && (
                            <span className="px-2 py-0.5 rounded bg-amber-600 text-white font-bold text-[11px]">
                              TRÙNG SĐT TRONG FILE EXCEL
                            </span>
                          )}
                          {r.rowStatus === 'WON_RETURNING' && r.matchedLead && (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="px-2 py-0.5 rounded bg-emerald-100 border border-emerald-300 text-emerald-900 font-bold text-[11px]">
                                KHÁCH CŨ QUAY LẠI ({r.matchedLead.leadCode})
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  onClose();
                                  onOpenLeadDetail(r.matchedLead!.id);
                                }}
                                className="text-[11px] font-bold text-emerald-800 underline"
                              >
                                Xem hồ sơ đã mua →
                              </button>
                            </div>
                          )}
                          {r.rowStatus === 'LOST_RETURNING' && r.matchedLead && (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="px-2 py-0.5 rounded bg-blue-100 border border-blue-300 text-[#1E3A8A] font-bold text-[11px]">
                                KHÁCH QUAY LẠI ({r.matchedLead.leadCode})
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  onClose();
                                  onOpenLeadDetail(r.matchedLead!.id);
                                }}
                                className="text-[11px] font-bold text-[#1E3A8A] underline"
                              >
                                Xem hồ sơ cũ →
                              </button>
                            </div>
                          )}
                          {r.rowStatus === 'NEW_VALID' && (
                            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold text-[11px]">
                              Mới hợp lệ
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="p-6 text-center text-xs text-slate-500 bg-slate-50 rounded-xl border border-slate-200">
              Chọn file Excel (`.xlsx`, `.csv`) hoặc dán danh sách từ Excel để xem trước kết quả kiểm tra trùng lặp.
            </div>
          )}
        </div>

        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500">
            {evaluatedRows.length > 0
              ? `Sẵn sàng nhập ${rowsToCommit.length} / ${evaluatedRows.length} dòng vào hệ thống`
              : 'Chưa có dữ liệu xem trước'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold"
            >
              Đóng
            </button>
            <button
              type="button"
              disabled={rowsToCommit.length === 0 || importCommitting}
              onClick={() => {
                if (!user || rowsToCommit.length === 0) return;
                setImportCommitting(true);
                onError(null);
                void (async () => {
                  try {
                    const res = await apiRequest<{
                      createdCount: number;
                      failedCount: number;
                    }>('/api/v1/leads/export', {
                      method: 'POST',
                      csrfToken: user.csrfToken,
                      body: { rows: rowsToCommit },
                    });
                    onClose();
                    await onImported(
                      `Đã nhập thành công ${res.createdCount} hồ sơ Lead từ Excel${
                        res.failedCount > 0 ? ` (${res.failedCount} dòng lỗi bị bỏ qua)` : ''
                      }.`,
                    );
                  } catch (err) {
                    onError(err instanceof Error ? err.message : 'Lỗi khi nhập danh sách Excel.');
                  } finally {
                    setImportCommitting(false);
                  }
                })();
              }}
              className="h-9 px-5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm disabled:opacity-40 transition"
            >
              <FolderUp className="w-4 h-4" />
              <span>
                {importCommitting
                  ? 'Đang nhập dữ liệu...'
                  : `Nhập ${rowsToCommit.length} hồ sơ vào hệ thống`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
export default LeadExcelImportModal;
