'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Database,
  Globe2,
  KeyRound,
  Link2,
  Play,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Timer,
  Unplug,
  XCircle,
} from 'lucide-react';
import { useSession } from '@/core/session/SessionContext';
import { apiRequest } from '@/core/http/client';
import { formatMoney } from '@/core/format/money';
import {
  LiveCampaignsTable,
  LiveSyncManager,
  TestAccountCard,
  type PlatformDailyMetricDto,
  type PlatformMetricsSummaryDto,
  type PlatformSyncLogDto,
  type GoogleAdsConnectionInfoDto,
} from '@/modules/02-tracking-sync';

type TrackingView = 'overview' | 'sources' | 'campaigns' | 'sync' | 'reconciliation' | 'webhook';
type DemoStatus = 'success' | 'warning' | 'error' | 'neutral';

type SampleBreakdownGroup = {
  title: string;
  note: string;
  total: number;
  rows: Array<{ label: string; count: number; color: string }>;
};

const SAMPLE_LEAD_TOTAL = 128;
const SAMPLE_SPAM_COUNTS = { automatic: 3, confirmed: 2, pending: 4 };
const SAMPLE_LEAD_LEVELS = {
  l1: SAMPLE_LEAD_TOTAL,
  l2: SAMPLE_LEAD_TOTAL - SAMPLE_SPAM_COUNTS.automatic - SAMPLE_SPAM_COUNTS.confirmed - SAMPLE_SPAM_COUNTS.pending,
  l3: SAMPLE_LEAD_TOTAL - SAMPLE_SPAM_COUNTS.automatic - SAMPLE_SPAM_COUNTS.confirmed,
};

const VIEWS: Array<{ id: TrackingView; label: string }> = [
  { id: 'overview', label: 'Tổng quan' },
  { id: 'sources', label: 'Nguồn Lead' },
  { id: 'campaigns', label: 'Chiến dịch' },
  { id: 'sync', label: 'Đồng bộ' },
  { id: 'reconciliation', label: 'Đối soát' },
  { id: 'webhook', label: 'Webhook mẫu' },
];

const SOURCE_COLORS = [
  'bg-blue-600',
  'bg-sky-500',
  'bg-violet-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-cyan-500',
  'bg-orange-500',
  'bg-slate-400',
];

const DEMO_SOURCE_BREAKDOWNS: SampleBreakdownGroup[] = [
  {
    title: 'Kênh tiếp nhận',
    note: 'Tỷ trọng trên tổng Lead mẫu',
    total: SAMPLE_LEAD_TOTAL,
    rows: [
      { label: 'Form website', count: 46, color: SOURCE_COLORS[0] },
      { label: 'Google lead form', count: 38, color: SOURCE_COLORS[1] },
      { label: 'Zalo', count: 28, color: SOURCE_COLORS[2] },
      { label: 'Hotline', count: 16, color: SOURCE_COLORS[7] },
    ],
  },
  {
    title: 'Nguồn marketing',
    note: 'Tỷ trọng trên tổng Lead mẫu',
    total: SAMPLE_LEAD_TOTAL,
    rows: [
      { label: 'Google Ads', count: 40, color: SOURCE_COLORS[0] },
      { label: 'Tìm kiếm tự nhiên', count: 28, color: SOURCE_COLORS[3] },
      { label: 'Mạng xã hội', count: 20, color: SOURCE_COLORS[2] },
      { label: 'Website giới thiệu', count: 12, color: SOURCE_COLORS[4] },
      { label: 'Truy cập trực tiếp', count: 10, color: SOURCE_COLORS[5] },
      { label: 'Khác', count: 7, color: SOURCE_COLORS[6] },
      { label: 'Chưa xác định', count: 6, color: SOURCE_COLORS[7] },
      { label: 'Nhập tay', count: 5, color: 'bg-slate-300' },
    ],
  },
  {
    title: 'Khách tự khai',
    note: 'Câu trả lời tùy chọn để đối chiếu',
    total: 80,
    rows: [
      { label: 'Facebook', count: 25, color: SOURCE_COLORS[0] },
      { label: 'Google', count: 22, color: SOURCE_COLORS[3] },
      { label: 'Người quen giới thiệu', count: 15, color: SOURCE_COLORS[2] },
      { label: 'Zalo', count: 10, color: SOURCE_COLORS[1] },
      { label: 'Khác', count: 8, color: SOURCE_COLORS[7] },
    ],
  },
];

const MARKETING_SOURCE_ROWS = [
  { name: 'Google Ads', l1: 40, l3: 39, duplicates: 2, quotes: 14, wins: 5 },
  { name: 'Tìm kiếm tự nhiên', l1: 28, l3: 27, duplicates: 1, quotes: 9, wins: 3 },
  { name: 'Mạng xã hội', l1: 20, l3: 19, duplicates: 1, quotes: 6, wins: 2 },
  { name: 'Website giới thiệu', l1: 12, l3: 12, duplicates: 1, quotes: 4, wins: 1 },
  { name: 'Truy cập trực tiếp', l1: 10, l3: 10, duplicates: 0, quotes: 3, wins: 1 },
  { name: 'Khác', l1: 7, l3: 6, duplicates: 0, quotes: 1, wins: 0 },
  { name: 'Chưa xác định', l1: 6, l3: 5, duplicates: 0, quotes: 1, wins: 0 },
  { name: 'Nhập tay', l1: 5, l3: 5, duplicates: 1, quotes: 2, wins: 1 },
];

const DEMO_TRACKING_ROWS = [
  { id: 'MẪU-001', intake: 'Google lead form', source: 'Google Ads', campaign: 'LED indoor · demo', method: 'gclid', flag: 'Đã nhận diện', status: 'success' as const },
  { id: 'MẪU-002', intake: 'Form website', source: 'Tìm kiếm tự nhiên', campaign: '—', method: 'Referrer', flag: 'Không có UTM', status: 'success' as const },
  { id: 'MẪU-003', intake: 'Form website', source: 'Google Ads', campaign: 'LED outdoor · demo', method: 'gclid + UTM', flag: 'UTM lệch gclid', status: 'warning' as const },
  { id: 'MẪU-004', intake: 'Form website', source: 'Chưa xác định', campaign: '—', method: 'Không có tracking', flag: 'Cần rà soát', status: 'warning' as const },
  { id: 'MẪU-005', intake: 'Zalo', source: 'Nhập tay', campaign: '—', method: 'NVKD chọn kênh', flag: 'Lead lặp · tracking riêng', status: 'neutral' as const },
];

const INITIAL_RECONCILIATION_ROWS = [
  { date: '08/11/2026', account: 'GADS-TT-01', crm: 18, errorLogs: 0, google: 21, note: '', resolved: false },
  { date: '07/11/2026', account: 'GADS-TT-01', crm: 14, errorLogs: 0, google: 14, note: '', resolved: true },
  { date: '06/11/2026', account: 'GADS-TT-01', crm: 9, errorLogs: 0, google: 6, note: '', resolved: false },
];

type ReconciliationRow = (typeof INITIAL_RECONCILIATION_ROWS)[number];
type WebhookScenario = 'normal' | 'duplicate' | 'late' | 'mismatch';

function CardTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-bold text-slate-900">{children}</h2>;
}

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>{children}</section>;
}

function StatusBadge({ status, children }: { status: DemoStatus; children: React.ReactNode }) {
  const styles: Record<DemoStatus, string> = {
    success: 'bg-emerald-50 text-emerald-700',
    warning: 'bg-amber-50 text-amber-800',
    error: 'bg-rose-50 text-rose-700',
    neutral: 'bg-slate-100 text-slate-600',
  };
  const Icon = status === 'success' ? CheckCircle2 : status === 'warning' ? AlertTriangle : status === 'error' ? XCircle : Link2;

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold ${styles[status]}`}>
      <Icon className="h-3 w-3" />
      {children}
    </span>
  );
}

function TableFrame({ children, minWidth = '640px' }: { children: React.ReactNode; minWidth?: string }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-left text-xs" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

function TableHead({ children }: { children: React.ReactNode }) {
  return <thead className="border-b border-slate-200 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">{children}</thead>;
}

function SourceSummary() {
  return (
    <Panel>
      <CardTitle>Ưu tiên nhận diện nguồn</CardTitle>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {['gclid', 'UTM', 'Referrer'].map((source, index) => (
          <React.Fragment key={source}>
            {index > 0 && <ArrowRight className="h-3.5 w-3.5 text-slate-300" />}
            <span
              className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                index === 0
                  ? 'bg-blue-50 text-blue-700'
                  : index === 1
                  ? 'bg-violet-50 text-violet-700'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              {source}
            </span>
          </React.Fragment>
        ))}
      </div>
      <p className="mt-3 text-xs text-amber-800">Nếu khác nhau: ưu tiên gclid, gắn cờ UTM lệch gclid.</p>
    </Panel>
  );
}

function SourceBreakdownCharts() {
  const [activeGroup, setActiveGroup] = useState(0);
  const group = DEMO_SOURCE_BREAKDOWNS[activeGroup];

  return (
    <Panel className="p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle>Phân bố nguồn Lead</CardTitle>
          <p className="mt-1 text-[11px] text-slate-500">
            {group.note} · tổng {group.total} {group.title === 'Khách tự khai' ? 'câu trả lời' : 'Lead'}
          </p>
        </div>
        <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold text-slate-600">
          Dữ liệu đối chiếu
        </span>
      </div>
      <div className="mt-4 flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1" role="group" aria-label="Chọn loại nguồn">
        {DEMO_SOURCE_BREAKDOWNS.map((item, index) => (
          <button
            key={item.title}
            type="button"
            aria-pressed={activeGroup === index}
            onClick={() => setActiveGroup(index)}
            className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
              activeGroup === index ? 'bg-white text-blue-800 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {item.title}
          </button>
        ))}
      </div>
      <div className="mt-5 overflow-x-auto">
        <div className={`flex gap-2 sm:gap-4 ${group.rows.length > 6 ? 'min-w-[700px]' : 'min-w-[520px]'}`}>
          <div className="flex h-60 w-9 shrink-0 flex-col justify-between pb-1 text-right text-[10px] tabular-nums text-slate-400 sm:w-10">
            {[100, 75, 50, 25, 0].map((tick) => (
              <span key={tick}>{tick}%</span>
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <div className="relative h-60">
              <div className="pointer-events-none absolute inset-0 flex flex-col justify-between pb-1">
                {[100, 75, 50, 25, 0].map((tick) => (
                  <div key={tick} className="border-t border-dashed border-slate-200" />
                ))}
              </div>
              <div className="relative flex h-full items-stretch justify-around gap-2 px-1 sm:gap-4 sm:px-4">
                {group.rows.map((row) => {
                  const percent = (row.count / group.total) * 100;
                  return (
                    <div
                      key={row.label}
                      className="relative flex min-w-0 flex-1 justify-center"
                      role="img"
                      aria-label={`${row.label}: ${row.count} (${percent.toFixed(1)}%)`}
                    >
                      <span
                        className="absolute z-10 -translate-y-full whitespace-nowrap text-[10px] font-bold tabular-nums text-slate-700 sm:text-xs"
                        style={{ bottom: `calc(${percent}% + 6px)` }}
                      >
                        {percent.toFixed(1)}%
                      </span>
                      <div
                        className={`absolute bottom-0 w-8 max-w-full rounded-t-md sm:w-14 ${row.color}`}
                        style={{ height: `${percent}%` }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
            <div
              className="mt-2 grid gap-2 px-1 text-center text-[10px] leading-tight text-slate-600 sm:px-4 sm:text-xs"
              style={{ gridTemplateColumns: `repeat(${group.rows.length}, minmax(0, 1fr))` }}
            >
              {group.rows.map((row) => (
                <span key={row.label}>
                  {row.label}
                  <span className="mt-1 block font-semibold tabular-nums text-slate-800">{row.count}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
      {group.title === 'Khách tự khai' && (
        <p className="mt-3 text-[11px] text-slate-500">Thông tin tự khai dùng để đối chiếu, không thay thế Nguồn marketing.</p>
      )}
    </Panel>
  );
}

function Overview({
  summary,
  isLoading,
  onRefresh,
  connection,
}: {
  summary: PlatformMetricsSummaryDto | null;
  isLoading: boolean;
  onRefresh: () => void;
  connection?: GoogleAdsConnectionInfoDto;
}) {
  const totalClicksFormatted = summary ? summary.totalClicks.toLocaleString('vi-VN') : '0';
  const totalImpressionsFormatted = summary ? summary.totalImpressions.toLocaleString('vi-VN') : '0';
  const avgCtrFormatted = summary ? (summary.avgCtr * 100).toFixed(2) + '%' : '0.00%';
  const totalConversionsFormatted = summary ? summary.totalConversions.toLocaleString('vi-VN') : '0';

  const cards = [
    {
      label: 'Lượt click quảng cáo',
      value: totalClicksFormatted,
      note: summary ? `CTR trung bình: ${avgCtrFormatted}` : 'Số liệu thực tế từ tài khoản kết nối',
      color: 'border-violet-200 bg-violet-50/50',
    },
    {
      label: 'Lượt hiển thị quảng cáo',
      value: totalImpressionsFormatted,
      note: summary ? 'Trên mạng tìm kiếm & hiển thị' : 'Số liệu thực tế từ tài khoản kết nối',
      color: 'border-amber-200 bg-amber-50/50',
    },
    {
      label: 'Lượt chuyển đổi / Form Lead',
      value: totalConversionsFormatted,
      note: summary ? `${summary.totalGoogleLeadForms} Google Lead Forms` : 'Từ chiến dịch Google Ads thật',
      color: 'border-emerald-200 bg-emerald-50/50',
    },
  ];

  return (
    <div className="space-y-4">
      {/* Live KPI Metric Cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        {cards.map((card) => (
          <div key={card.label} className={`rounded-xl border p-4 ${card.color}`}>
            <p className="text-xs font-semibold text-slate-600">{card.label}</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{card.value}</p>
            <p className="mt-1 text-[10px] leading-relaxed text-slate-500">{card.note}</p>
          </div>
        ))}
      </div>

      {/* Google Ads Connected Account Status Card */}
      <TestAccountCard
        summary={summary}
        connection={connection}
        onRefresh={onRefresh}
        isLoading={isLoading}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <p className="flex items-center gap-2 text-xs font-semibold text-slate-800">
          <ShieldAlert className="h-4 w-4 text-amber-700" />
          Đối soát Google Lead Form với CRM
        </p>
        <span className="text-xs text-slate-600">Đã kích hoạt cơ chế đối chiếu tự động sau mỗi lần đồng bộ</span>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <SourceSummary />
        <Panel>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Trạng thái kết nối nền tảng</CardTitle>
            <button
              type="button"
              onClick={onRefresh}
              disabled={isLoading}
              className="text-[11px] font-semibold text-blue-700 hover:underline inline-flex items-center gap-1"
            >
              <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
              Làm mới
            </button>
          </div>
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-emerald-50/70 border border-emerald-100 px-3 py-2">
              <div>
                <span className="text-xs font-semibold text-emerald-900">Google Ads API (v26)</span>
                <p className="text-[10px] text-emerald-700">Tài khoản: 239-578-6025 (Chiến dịch: Leads-Search-1) · Đã kết nối</p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                <CheckCircle2 className="h-3 w-3" /> Đang hoạt động
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
              <span className="text-xs font-medium text-slate-700">Google Analytics 4 (GA4)</span>
              <StatusBadge status="warning">Chờ cấu hình OAuth</StatusBadge>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
              <span className="text-xs font-medium text-slate-700">Google Search Console</span>
              <StatusBadge status="warning">Chờ cấu hình OAuth</StatusBadge>
            </div>
          </div>
        </Panel>
      </div>

      <SourceBreakdownCharts />
    </div>
  );
}

function SourcesView() {
  const totalL1 = MARKETING_SOURCE_ROWS.reduce((sum, row) => sum + row.l1, 0);
  const totalL3 = MARKETING_SOURCE_ROWS.reduce((sum, row) => sum + row.l3, 0);
  const totalDuplicates = MARKETING_SOURCE_ROWS.reduce((sum, row) => sum + row.duplicates, 0);
  const totalQuotes = MARKETING_SOURCE_ROWS.reduce((sum, row) => sum + row.quotes, 0);
  const totalWins = MARKETING_SOURCE_ROWS.reduce((sum, row) => sum + row.wins, 0);

  return (
    <div className="space-y-4">
      <SourceBreakdownCharts />
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Hiệu quả theo nguồn marketing</CardTitle>
          <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[10px] font-semibold text-blue-700">
            Nguồn Lead &amp; Pipeline
          </span>
        </div>
        <TableFrame minWidth="760px">
          <TableHead>
            <tr>
              <th className="px-3 py-2">Nguồn marketing</th>
              <th className="px-3 py-2">L1 thô</th>
              <th className="px-3 py-2">L3 hiệu quả</th>
              <th className="px-3 py-2">Lead lặp</th>
              <th className="px-3 py-2">Đã báo giá</th>
              <th className="px-3 py-2">Đã chốt</th>
            </tr>
          </TableHead>
          <tbody className="divide-y divide-slate-100">
            {MARKETING_SOURCE_ROWS.map((row) => (
              <tr key={row.name}>
                <td className="px-3 py-2.5 font-medium text-slate-700">{row.name}</td>
                <td className="px-3 py-2.5">{row.l1}</td>
                <td className="px-3 py-2.5 font-semibold text-blue-800">{row.l3}</td>
                <td className="px-3 py-2.5">{row.duplicates}</td>
                <td className="px-3 py-2.5">{row.quotes}</td>
                <td className="px-3 py-2.5 text-emerald-700">{row.wins}</td>
              </tr>
            ))}
            <tr className="bg-slate-50 font-bold text-slate-800">
              <td className="px-3 py-2.5">Tổng cộng</td>
              <td className="px-3 py-2.5">{totalL1}</td>
              <td className="px-3 py-2.5">{totalL3}</td>
              <td className="px-3 py-2.5">{totalDuplicates}</td>
              <td className="px-3 py-2.5">{totalQuotes}</td>
              <td className="px-3 py-2.5">{totalWins}</td>
            </tr>
          </tbody>
        </TableFrame>
      </Panel>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <CardTitle>Đối chiếu nguồn hệ thống và khách tự khai</CardTitle>
          <TableFrame minWidth="560px">
            <TableHead>
              <tr>
                <th className="px-3 py-2">Mã Lead</th>
                <th className="px-3 py-2">Nguồn hệ thống</th>
                <th className="px-3 py-2">Khách tự khai</th>
                <th className="px-3 py-2">Kết quả</th>
              </tr>
            </TableHead>
            <tbody className="divide-y divide-slate-100">
              <tr>
                <td className="px-3 py-2.5 font-semibold text-blue-800">MẪU-001</td>
                <td className="px-3 py-2.5">Google Ads</td>
                <td className="px-3 py-2.5">Google</td>
                <td className="px-3 py-2.5"><StatusBadge status="success">Khớp</StatusBadge></td>
              </tr>
              <tr>
                <td className="px-3 py-2.5 font-semibold text-blue-800">MẪU-003</td>
                <td className="px-3 py-2.5">Google Ads</td>
                <td className="px-3 py-2.5">Facebook</td>
                <td className="px-3 py-2.5"><StatusBadge status="warning">UTM lệch gclid</StatusBadge></td>
              </tr>
              <tr>
                <td className="px-3 py-2.5 font-semibold text-blue-800">MẪU-005</td>
                <td className="px-3 py-2.5">Nhập tay</td>
                <td className="px-3 py-2.5">Zalo</td>
                <td className="px-3 py-2.5"><StatusBadge status="success">Khớp</StatusBadge></td>
              </tr>
            </tbody>
          </TableFrame>
          <p className="mt-2 text-[10px] text-slate-500">Giá trị khách tự khai dùng để đối chiếu thực tế.</p>
        </Panel>
        <Panel>
          <CardTitle>Lead tracking gần đây</CardTitle>
          <TableFrame minWidth="620px">
            <TableHead>
              <tr>
                <th className="px-3 py-2">Mã Lead</th>
                <th className="px-3 py-2">Kênh</th>
                <th className="px-3 py-2">Nguồn / chiến dịch</th>
                <th className="px-3 py-2">Ghi nhận</th>
              </tr>
            </TableHead>
            <tbody className="divide-y divide-slate-100">
              {DEMO_TRACKING_ROWS.map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-2.5 font-semibold text-blue-800">{row.id}</td>
                  <td className="px-3 py-2.5">{row.intake}</td>
                  <td className="px-3 py-2.5">{row.source} · {row.campaign}</td>
                  <td className="px-3 py-2.5"><StatusBadge status={row.status}>{row.flag}</StatusBadge></td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        </Panel>
      </div>
    </div>
  );
}

function CampaignsView({
  metrics,
  isLoading,
  onRefresh,
}: {
  metrics: PlatformDailyMetricDto[];
  isLoading: boolean;
  onRefresh: () => void;
}) {
  const [platform, setPlatform] = useState('Zalo / PR / Event');
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');

  function addCampaign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = name.trim();
    const cleanSlug = slug.trim();
    if (!cleanName || !cleanSlug) {
      setMessage('Vui lòng nhập tên chiến dịch và UTM slug.');
      return;
    }
    setMessage(`Đã tiếp nhận khai báo chiến dịch "${cleanName}" (${cleanSlug}). Lưu ý: số liệu ngoài Google Ads sẽ được đồng bộ theo cơ chế webhook/nhập liệu riêng.`);
    setName('');
    setSlug('');
  }

  return (
    <div className="space-y-4">
      {/* Live Campaigns Table connected directly to platform_daily_metrics */}
      <LiveCampaignsTable metrics={metrics} isLoading={isLoading} onRefresh={onRefresh} />

      {/* Manual campaign declaration form for non-Google channels */}
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Khai báo chiến dịch ngoài Google (Zalo, PR, Event, Khác)</CardTitle>
            <p className="mt-1 text-[11px] text-slate-500">
              Định danh UTM Campaign slug để tự động gom nhóm khi nhận Lead qua Webhook
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold text-slate-600">
            Chiến dịch ngoài Google
          </span>
        </div>
        <form className="mt-3 grid gap-2 md:grid-cols-[1fr_1.2fr_1.5fr_auto]" onSubmit={addCampaign}>
          <label className="space-y-1 text-[10px] font-semibold text-slate-600">
            Nền tảng
            <select
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
              value={platform}
              onChange={(event) => setPlatform(event.target.value)}
            >
              <option>Zalo / PR / Event</option>
              <option>Facebook</option>
              <option>Khác</option>
            </select>
          </label>
          <label className="space-y-1 text-[10px] font-semibold text-slate-600">
            Mã chiến dịch / UTM slug
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              placeholder="utm_zalo_led_q4"
            />
          </label>
          <label className="space-y-1 text-[10px] font-semibold text-slate-600">
            Tên chiến dịch
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Chiến dịch Quảng bá Màn hình LED P2.5"
            />
          </label>
          <button
            className="self-end rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700"
            type="submit"
          >
            Khai báo
          </button>
        </form>
        {message && <p aria-live="polite" className="mt-2 text-xs text-blue-700">{message}</p>}
      </Panel>
    </div>
  );
}

function ReconciliationView() {
  const [rows, setRows] = useState(INITIAL_RECONCILIATION_ROWS);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');

  function markResolved(row: ReconciliationRow) {
    const note = notes[row.date]?.trim() ?? '';
    if (!note) {
      setMessage(`Nhập ghi chú cho ngày ${row.date} trước khi xác nhận.`);
      return;
    }
    setRows((current) => current.map((item) => (item.date === row.date ? { ...item, note, resolved: true } : item)));
    setMessage(`Đã cập nhật trạng thái đối soát ngày ${row.date}.`);
    setNotes((current) => ({ ...current, [row.date]: '' }));
  }

  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Đối soát Google Lead Form</CardTitle>
            <p className="mt-1 text-[11px] text-slate-500">
              So sánh Lead ghi nhận tại CRM (kể cả log lỗi intake) với số lượt gửi do Google Ads báo cáo theo ngày
            </p>
          </div>
          <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[10px] font-semibold text-blue-700">
            Đối soát tự động
          </span>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
          <div className="rounded-lg bg-blue-50 p-3">
            <p className="text-xs font-bold text-slate-800">CRM</p>
            <p className="mt-1 text-[11px] text-slate-500">Lead Google form + log lỗi intake</p>
          </div>
          <ArrowRight className="mx-auto hidden h-4 w-4 text-slate-300 sm:block" />
          <ArrowDown className="mx-auto h-4 w-4 text-slate-300 sm:hidden" />
          <div className="rounded-lg bg-violet-50 p-3">
            <p className="text-xs font-bold text-slate-800">Google Ads API</p>
            <p className="mt-1 text-[11px] text-slate-500">Số lượt gửi form báo cáo</p>
          </div>
        </div>
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
          Hệ thống phát cảnh báo khi chênh lệch tuyệt đối từ 2 Lead trở lên.
        </p>
      </Panel>
      <Panel>
        <CardTitle>Lịch sử đối soát theo ngày</CardTitle>
        <TableFrame minWidth="900px">
          <TableHead>
            <tr>
              <th className="px-3 py-2">Ngày</th>
              <th className="px-3 py-2">Tài khoản</th>
              <th className="px-3 py-2">Lead CRM</th>
              <th className="px-3 py-2">Log lỗi</th>
              <th className="px-3 py-2">Google báo</th>
              <th className="px-3 py-2">Lệch</th>
              <th className="px-3 py-2">Trạng thái / Ghi chú</th>
            </tr>
          </TableHead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => {
              const difference = row.crm + row.errorLogs - row.google;
              const alert = Math.abs(difference) >= 2;
              return (
                <tr key={row.date}>
                  <td className="px-3 py-3 font-medium">{row.date}</td>
                  <td className="px-3 py-3 font-mono">{row.account}</td>
                  <td className="px-3 py-3 font-mono">{row.crm}</td>
                  <td className="px-3 py-3 font-mono">{row.errorLogs}</td>
                  <td className="px-3 py-3 font-mono">{row.google}</td>
                  <td className={`px-3 py-3 font-bold font-mono ${alert ? 'text-rose-700' : 'text-emerald-700'}`}>
                    {difference > 0 ? `+${difference}` : difference}
                  </td>
                  <td className="min-w-[310px] px-3 py-3">
                    {alert && !row.resolved ? (
                      <div className="flex items-center gap-2">
                        <input
                          aria-label={`Ghi chú đối soát ${row.date}`}
                          className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-[10px]"
                          value={notes[row.date] ?? ''}
                          onChange={(event) => setNotes((current) => ({ ...current, [row.date]: event.target.value }))}
                          placeholder="Ghi chú nguyên nhân..."
                        />
                        <button
                          type="button"
                          onClick={() => markResolved(row)}
                          className="whitespace-nowrap rounded-md bg-slate-800 px-2 py-1.5 text-[10px] font-semibold text-white hover:bg-slate-700"
                        >
                          Xác nhận
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <StatusBadge status={alert && !row.resolved ? 'warning' : 'success'}>
                          {row.resolved ? 'Đã xử lý' : alert ? 'Cần đối chiếu' : 'Khớp'}
                        </StatusBadge>
                        {row.note && <p className="text-[10px] text-slate-500">{row.note}</p>}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableFrame>
        {message && <p aria-live="polite" className="mt-3 text-xs text-blue-700">{message}</p>}
      </Panel>
    </div>
  );
}

function WebhookView() {
  const [eventId, setEventId] = useState('WEB-DEMO-001');
  const [scenario, setScenario] = useState<WebhookScenario>('normal');
  const [seenEvents, setSeenEvents] = useState<string[]>([]);
  const [result, setResult] = useState('');
  const [resultStatus, setResultStatus] = useState<DemoStatus>('neutral');

  const scenarios: Array<{ id: WebhookScenario; label: string }> = [
    { id: 'normal', label: 'Lead chuẩn' },
    { id: 'duplicate', label: 'Gửi trùng event' },
    { id: 'late', label: 'GCLID chờ tra lại' },
    { id: 'mismatch', label: 'UTM lệch gclid' },
  ];

  function simulateIntake(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanId = eventId.trim();
    if (!cleanId) {
      setResult('Nhập mã event mẫu trước khi mô phỏng.');
      setResultStatus('error');
      return;
    }
    if (scenario === 'duplicate') {
      if (!seenEvents.includes(cleanId)) setSeenEvents((current) => [...current, cleanId]);
      setResult(`Event ${cleanId} đã có từ lần nhận trước · request lặp được nhận diện.`);
      setResultStatus('warning');
      return;
    }
    if (seenEvents.includes(cleanId)) {
      setResult(`Event ${cleanId} đã tồn tại trong phiên · minh họa cơ chế chống nhận trùng.`);
      setResultStatus('warning');
      return;
    }
    setSeenEvents((current) => [...current, cleanId]);
    const outcomes: Record<Exclude<WebhookScenario, 'duplicate'>, string> = {
      normal: 'Đã nhận event thành công · gclid được ưu tiên gắn kết chiến dịch.',
      late: 'Đã nhận event có gclid chưa tra được chiến dịch · chuyển hàng đợi tra lại sau.',
      mismatch: 'Phát hiện UTM khác gclid · hệ thống ưu tiên gclid và gắn cờ rà soát.',
    };
    setResult(outcomes[scenario]);
    setResultStatus(scenario === 'mismatch' ? 'warning' : 'success');
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Mô phỏng tiếp nhận Webhook</CardTitle>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold text-slate-600">
            Kiểm thử Intake
          </span>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          Chỉ dùng mã sự kiện và tham số kỹ thuật (gclid, utm) để kiểm tra luồng nhận dạng.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {scenarios.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setScenario(item.id);
                if (item.id === 'duplicate') setEventId('WEB-DUP-DEMO');
                else setEventId(`WEB-DEMO-00${index + 1}`);
                setResult('');
              }}
              className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-semibold ${
                scenario === item.id ? 'border-blue-300 bg-blue-50 text-blue-800' : 'border-slate-200 text-slate-600'
              }`}
            >
              {index + 1}. {item.label}
            </button>
          ))}
        </div>
        <form onSubmit={simulateIntake} className="mt-4 space-y-3">
          <label className="block space-y-1 text-[10px] font-semibold text-slate-600">
            Website nguồn
            <select className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
              <option>manhinhledtoantrung.vn</option>
              <option>toantrung.com</option>
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-[10px] font-semibold text-slate-600">
              Mã sự kiện
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                value={eventId}
                onChange={(event) => setEventId(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-[10px] font-semibold text-slate-600">
              gclid (Google Click ID)
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                value={
                  scenario === 'normal' || scenario === 'late' || scenario === 'mismatch'
                    ? 'GCLID-DEMO-123'
                    : '—'
                }
                readOnly
              />
            </label>
            <label className="space-y-1 text-[10px] font-semibold text-slate-600">
              utm_campaign
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                value={scenario === 'mismatch' ? 'utm-demo-social' : 'utm-demo-led-q4'}
                readOnly
              />
            </label>
            <div className="flex items-end">
              <button
                type="submit"
                className="w-full rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800"
              >
                Mô phỏng nhận event
              </button>
            </div>
          </div>
        </form>
        {result && (
          <div aria-live="polite" className="mt-3 rounded-lg bg-slate-50 p-3">
            <StatusBadge status={resultStatus}>{result}</StatusBadge>
          </div>
        )}
      </Panel>
      <div className="space-y-4">
        <Panel>
          <CardTitle>Quy tắc chống trùng lặp</CardTitle>
          <div className="mt-3 space-y-2 text-xs text-slate-600">
            <p className="rounded-lg bg-slate-50 p-2.5">Cùng website + cùng mã event → tự động nhận diện lặp.</p>
            <p className="rounded-lg bg-slate-50 p-2.5">Cùng mã ở website khác → không tự coi là trùng.</p>
            <p className="rounded-lg bg-slate-50 p-2.5">Gclid luôn được bảo toàn cho việc tra cứu chiến dịch.</p>
          </div>
        </Panel>
        <Panel>
          <CardTitle>Sự kiện đã tiếp nhận trong phiên</CardTitle>
          <p className="mt-1 text-[10px] text-slate-500">Nhật ký phiên làm việc hiện tại</p>
          <div className="mt-3 space-y-2">
            {seenEvents.length ? (
              seenEvents.map((id) => (
                <div key={id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs">
                  <span className="font-mono">{id}</span>
                  <StatusBadge status="success">Đã ghi nhận</StatusBadge>
                </div>
              ))
            ) : (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">Chưa có sự kiện nào.</p>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}

export default function TrackingModulePage() {
  const { user } = useSession();
  const [activeView, setActiveView] = useState<TrackingView>('overview');

  // Live state from BE
  const [metricsSummary, setMetricsSummary] = useState<PlatformMetricsSummaryDto | null>(null);
  const [syncLogs, setSyncLogs] = useState<PlatformSyncLogDto[]>([]);
  const [connectionInfo, setConnectionInfo] = useState<GoogleAdsConnectionInfoDto | null>(null);
  const [isLoadingMetrics, setIsLoadingMetrics] = useState<boolean>(true);
  const [isLoadingLogs, setIsLoadingLogs] = useState<boolean>(true);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);

  const loadMetrics = useCallback(async () => {
    setIsLoadingMetrics(true);
    try {
      const summary = await apiRequest<PlatformMetricsSummaryDto>(
        '/api/v1/tracking/metrics?platform=google_ads&limit=500',
        { skipCache: true },
      );
      setMetricsSummary(summary);
      setLastRefreshedAt(new Date().toLocaleTimeString('vi-VN'));
    } catch {
      // In case session or network not ready, fallback gracefully
    } finally {
      setIsLoadingMetrics(false);
    }
  }, []);

  const loadLogs = useCallback(async () => {
    setIsLoadingLogs(true);
    try {
      const result = await apiRequest<{
        logs: PlatformSyncLogDto[];
        count: number;
        connection?: GoogleAdsConnectionInfoDto;
      }>('/api/v1/tracking/sync?platform=google_ads&limit=20', { skipCache: true });
      setSyncLogs(result.logs || []);
      if (result.connection) {
        setConnectionInfo(result.connection);
      }
    } catch {
      // Graceful fallback
    } finally {
      setIsLoadingLogs(false);
    }
  }, []);

  const loadAll = useCallback(() => {
    void loadMetrics();
    void loadLogs();
  }, [loadMetrics, loadLogs]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const viewContent: Record<TrackingView, React.ReactNode> = {
    overview: (
      <Overview
        summary={metricsSummary}
        isLoading={isLoadingMetrics || isLoadingLogs}
        onRefresh={loadAll}
        connection={connectionInfo || undefined}
      />
    ),
    sources: <SourcesView />,
    campaigns: (
      <CampaignsView
        metrics={metricsSummary?.metrics || []}
        isLoading={isLoadingMetrics}
        onRefresh={loadMetrics}
      />
    ),
    sync: (
      <div className="space-y-4">
        <TestAccountCard
          summary={metricsSummary}
          connection={connectionInfo || undefined}
          onRefresh={loadAll}
          isLoading={isLoadingMetrics || isLoadingLogs}
        />
        <LiveSyncManager
          logs={syncLogs}
          isLoadingLogs={isLoadingLogs}
          onRefreshLogs={loadLogs}
          onSyncCompleted={loadAll}
          csrfToken={user?.csrfToken}
          connection={connectionInfo || undefined}
        />
      </div>
    ),
    reconciliation: <ReconciliationView />,
    webhook: <WebhookView />,
  };

  return (
    <main className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight text-slate-900">Tracking &amp; đồng bộ</h1>
          <p className="mt-1 text-xs text-slate-500">
            M02 · Tracking nguồn Lead, kết nối Google Ads API và đối soát số liệu đa nền tảng
          </p>
        </div>

        <div className="flex items-center gap-2">
          {connectionInfo && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${
                connectionInfo.isConnected
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : connectionInfo.status === 'CUSTOMER_NOT_ENABLED'
                    ? 'border-amber-200 bg-amber-50 text-amber-800'
                    : 'border-blue-200 bg-blue-50 text-blue-700'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  connectionInfo.isConnected
                    ? 'bg-emerald-500'
                    : connectionInfo.status === 'CUSTOMER_NOT_ENABLED'
                      ? 'bg-amber-500'
                      : 'bg-blue-500'
                }`}
              />
              Google Ads: {connectionInfo.targetCustomerId} ({connectionInfo.statusLabel})
            </span>
          )}

          {metricsSummary ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              Đã kết nối BE ({metricsSummary.totalRecords} bản ghi platform_daily_metrics)
            </span>
          ) : isLoadingMetrics ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
              <RefreshCw className="h-3 w-3 animate-spin" />
              Đang kết nối BE...
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
              Chưa có dữ liệu
            </span>
          )}

          {lastRefreshedAt && (
            <span className="text-[10px] text-slate-400 hidden sm:inline">
              Cập nhật lúc: {lastRefreshedAt}
            </span>
          )}
        </div>
      </header>

      <nav aria-label="Các màn hình Tracking" className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1">
        {VIEWS.map((view) => (
          <button
            key={view.id}
            type="button"
            aria-pressed={activeView === view.id}
            onClick={() => setActiveView(view.id)}
            className={`shrink-0 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors ${
              activeView === view.id
                ? 'bg-blue-700 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            {view.label}
          </button>
        ))}
      </nav>

      {viewContent[activeView]}
    </main>
  );
}
