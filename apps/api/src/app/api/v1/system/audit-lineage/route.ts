import { prisma } from '@toantrung/database';
import {
  CONTACT_CHANNEL_LABELS,
  hasBaPermission,
  PIPELINE_STATUS_LABELS,
} from '@toantrung/contracts';
import { jsonError, jsonSuccess } from '../../../../../core/http';
import { getOrComputeScopedCache } from '../../../../../core/cache/server-data-cache';
import { requireAuthenticatedSession } from '../../../../../core/permissions';
import { listLeadsForUser } from '../../../../../modules/01-leads/service';

export const dynamic = 'force-dynamic';

export type LineageMetricType =
  | 'received_leads'
  | 'valid_leads'
  | 'ad_attributed_leads'
  | 'quoted_leads'
  | 'won_leads'
  | 'spam_leads';

export interface AuditLineageRecordDto {
  leadId: number;
  leadCode: string;
  customerDisplay: string;
  contactDisplay: string;
  isAnonymized: boolean;
  sourceWebsite: string;
  marketingSource: string;
  campaignName: string | null;
  attributionProof: string;
  pipelineStatusLabel: string;
  assignedSalesName: string;
  contactedAt: string;
}

export interface FunnelAnomalyAlertDto {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  category: 'website_zero_form' | 'campaign_high_spam' | 'seo_rank_drop' | 'webhook_error';
  title: string;
  evidenceText: string;
  recommendedAction: string;
  actionHref: string;
}

const METRIC_TITLES: Record<LineageMetricType, string> = {
  received_leads: 'Tổng Lead tiếp nhận (L1)',
  valid_leads: 'Lead hợp lệ sau lọc Spam (L2)',
  ad_attributed_leads: 'Lead quy cho Quảng cáo (L3 · Khớp GCLID/UTM/Ads Form)',
  quoted_leads: 'Hồ sơ đã gửi báo giá',
  won_leads: 'Hồ sơ chốt thành công',
  spam_leads: 'Hồ sơ Spam / Loại trừ khỏi báo cáo',
};

export async function GET(req: Request) {
  const auth = await requireAuthenticatedSession(req, { requireCsrf: false });
  if (!auth.ok) return auth.response;

  const role = auth.user.roleCode;
  if (!hasBaPermission(role, 'DASHBOARD_VIEW') && !hasBaPermission(role, 'LEAD_VIEW_OWN')) {
    return jsonError('FORBIDDEN', 'Vai trò hiện tại không có quyền xem đối chứng số liệu.', 403);
  }

  const url = new URL(req.url);
  const mode = (url.searchParams.get('mode') || 'lineage').trim();

  if (mode === 'anomalies') {
    const cachedAnomalies = await getOrComputeScopedCache({
      key: `funnel_anomalies_v1:role:${role}`,
      domains: ['leads', 'tracking', 'ads'],
      ttlMs: 30_000,
      compute: async () => {
        const anomalies: FunnelAnomalyAlertDto[] = [];
        const now = new Date();
        const ago24h = new Date(now.getTime() - 24 * 3600_000);
        const ago7dStr = new Date(now.getTime() - 7 * 86400_000).toISOString().slice(0, 10);

        const [recentSpendBySite, recentLeads24h, unresolvedWebhooks, campLeads, decliningKeywords] =
          await Promise.all([
            prisma.platformDailyMetric.findMany({
              where: {
                metricDate: { gte: ago7dStr },
                OR: [{ spendMicros: { gt: 0 } }, { clicks: { gt: 15 } }],
              },
              select: {
                platform: true,
                accountPropertyId: true,
                spendMicros: true,
                clicks: true,
                pageUrlRaw: true,
              },
              take: 300,
            }),
            prisma.lead.findMany({
              where: { contactedAt: { gte: ago24h } },
              select: { sourceWebsite: true },
            }),
            prisma.webhookIntakeErrorLog.count({
              where: { isResolved: false },
            }),
            prisma.lead.findMany({
              where: {
                contactedAt: { gte: new Date(now.getTime() - 30 * 86400_000) },
              },
              select: {
                isSpam: true,
                matchedOldLeadId: true,
                tracking: { select: { campaignName: true, utmCampaign: true } },
              },
              take: 1000,
            }),
            prisma.seoKeyword.findMany({
              where: {
                OR: [
                  { trendDirection: 'declining' },
                  { cachedAvgPosition: { gt: 10 } },
                ],
              },
              orderBy: { updatedAt: 'desc' },
              take: 5,
            }),
          ]);

        if (unresolvedWebhooks > 0) {
          anomalies.push({
            id: 'anom-webhook-err',
            severity: 'critical',
            category: 'webhook_error',
            title: `Phát hiện ${unresolvedWebhooks} lỗi tiếp nhận Webhook chưa xử lý`,
            evidenceText:
              'Có biểu mẫu từ website/quảng cáo gửi về gặp lỗi định dạng hoặc kết nối trong nhật ký đối soát.',
            recommendedAction: 'Kiểm tra nhật ký Webhook & đối soát bù Lead ngay',
            actionHref: '/tracking',
          });
        }

        const coreSites = ['toantrung.com.vn', 'bangled.vn', 'manhinhled.net.vn'];
        const sitesWith24hLeads = new Set(
          recentLeads24h.map((l) => (l.sourceWebsite || '').toLowerCase()),
        );
        for (const domain of coreSites) {
          const siteTraffic = recentSpendBySite.filter(
            (m) =>
              m.accountPropertyId.toLowerCase().includes(domain) ||
              (m.pageUrlRaw || '').toLowerCase().includes(domain),
          );
          const totalClicks = siteTraffic.reduce((s, m) => s + (m.clicks || 0), 0);
          const totalSpendVnd = siteTraffic.reduce(
            (s, m) => s + Number(m.spendMicros || 0n) / 1_000_000,
            0,
          );
          if ((totalSpendVnd > 0 || totalClicks >= 25) && !sitesWith24hLeads.has(domain)) {
            anomalies.push({
              id: `anom-zero-form-${domain}`,
              severity: totalSpendVnd > 0 ? 'critical' : 'warning',
              category: 'website_zero_form',
              title: `Cảnh báo phễu ${domain}: Có traffic/chi phí nhưng 0 biểu mẫu > 24h`,
              evidenceText: `7 ngày qua ghi nhận ${totalClicks.toLocaleString('vi-VN')} click${
                totalSpendVnd > 0 ? ` (${Math.round(totalSpendVnd).toLocaleString('vi-VN')} ₫)` : ''
              } nhưng 24 giờ gần nhất không có biểu mẫu mới.`,
              recommendedAction: 'Kiểm tra biểu mẫu liên hệ WordPress hoặc chạy thử Webhook Sandbox',
              actionHref: role === 'ADMIN' ? '/settings?tab=governance' : '/tracking',
            });
          }
        }

        const campStats = new Map<string, { total: number; spamOrDup: number }>();
        for (const row of campLeads) {
          const cName = row.tracking?.campaignName || row.tracking?.utmCampaign;
          if (!cName) continue;
          const cur = campStats.get(cName) || { total: 0, spamOrDup: 0 };
          cur.total += 1;
          if (row.isSpam || row.matchedOldLeadId) cur.spamOrDup += 1;
          campStats.set(cName, cur);
        }
        for (const [cName, st] of campStats.entries()) {
          if (st.total >= 3 && st.spamOrDup / st.total >= 0.35) {
            const pct = Math.round((st.spamOrDup / st.total) * 100);
            anomalies.push({
              id: `anom-spam-${cName}`,
              severity: 'warning',
              category: 'campaign_high_spam',
              title: `Chiến dịch "${cName}" có tỷ lệ Spam/Trùng cao (${pct}%)`,
              evidenceText: `${st.spamOrDup}/${st.total} hồ sơ trong 30 ngày rơi vào diện Spam hoặc Trùng lặp.`,
              recommendedAction: 'Bổ sung từ khóa phủ định (Negative Keywords) trên Google Ads',
              actionHref: `/tracking?search=${encodeURIComponent(cName)}`,
            });
          }
        }

        if (decliningKeywords.length > 0 && hasBaPermission(role, 'AI_MARKETING_SEO')) {
          const topKw = decliningKeywords[0];
          anomalies.push({
            id: `anom-seo-${topKw.id}`,
            severity: 'info',
            category: 'seo_rank_drop',
            title: `${decliningKeywords.length} từ khóa SEO chiến lược nằm ngoài Top 10 hoặc giảm hạng`,
            evidenceText: `Từ khóa tiêu biểu: "${topKw.keyword}"${
              topKw.cachedAvgPosition ? ` (Vị trí TB: #${topKw.cachedAvgPosition.toFixed(1)})` : ''
            }.`,
            recommendedAction: 'Kiểm định lại bài viết bằng Bộ chấm điểm kỹ thuật SEO ngành LED',
            actionHref: '/ads',
          });
        }

        return {
          checkedAt: now.toISOString(),
          hasConfiguredData: recentSpendBySite.length > 0 || campLeads.length > 0,
          anomalies: anomalies.slice(0, 6),
        };
      },
    });

    return jsonSuccess(cachedAnomalies.data);
  }

  // Lineage mode: strictly delegate lead reading through BA-scoped listLeadsForUser!
  if (!hasBaPermission(role, 'LEAD_VIEW_OWN')) {
    return jsonError('FORBIDDEN', 'Vai trò hiện tại không có quyền xem danh sách hồ sơ đối chứng.', 403);
  }

  const metric = ((url.searchParams.get('metric') || 'valid_leads').trim() as LineageMetricType);
  const websiteId = (url.searchParams.get('websiteId') || 'all').trim();
  const campaignNameFilter = (url.searchParams.get('campaignName') || '').trim().toLowerCase();
  const fromDateStr = (url.searchParams.get('from') || '').trim() || undefined;
  const toDateStr = (url.searchParams.get('to') || '').trim() || undefined;

  const res = await listLeadsForUser(auth.user, {
    sourceWebsite: websiteId !== 'all' ? websiteId : undefined,
    includeSpam: true,
    fromDateStr,
    toDateStr,
    page: 1,
    pageSize: 250,
  });

  const filtered = res.leads.filter((l) => {
    if (campaignNameFilter) {
      const c = (l.tracking?.campaignName || l.tracking?.utmCampaign || '').toLowerCase();
      if (!c.includes(campaignNameFilter)) return false;
    }
    if (metric === 'spam_leads') return l.spamStatus === 'CONFIRMED';
    if (metric === 'received_leads') return true;
    // Valid leads exclude confirmed spam
    if (l.spamStatus === 'CONFIRMED') return false;
    if (metric === 'valid_leads') return true;
    if (metric === 'quoted_leads') {
      return (
        l.pipelineStatus === 'quote_sent' ||
        l.pipelineStatus === 'won' ||
        Boolean(l.quoteSentAt)
      );
    }
    if (metric === 'won_leads') return l.pipelineStatus === 'won';
    if (metric === 'ad_attributed_leads') {
      const mSrc = (l.tracking?.marketingSource || '').toLowerCase();
      return (
        Boolean(l.tracking?.gclid) ||
        l.contactChannel === 'google_lead_form' ||
        mSrc.includes('ads') ||
        mSrc.includes('quảng cáo')
      );
    }
    return true;
  });

  const records: AuditLineageRecordDto[] = filtered.slice(0, 100).map((l) => {
    const proofParts: string[] = [];
    if (l.tracking?.gclid) proofParts.push('Có mã GCLID');
    if (l.tracking?.utmCampaign) proofParts.push(`UTM: ${l.tracking.utmCampaign}`);
    if (l.contactChannel === 'google_lead_form') proofParts.push('Google Lead Form');
    if (proofParts.length === 0) {
      proofParts.push(
        l.tracking?.marketingSource ||
          CONTACT_CHANNEL_LABELS[l.contactChannel] ||
          l.contactChannel,
      );
    }

    return {
      leadId: l.id,
      leadCode: l.leadCode,
      customerDisplay: l.isAnonymized
        ? l.companyName || 'Khách hàng ẩn danh (UC01)'
        : l.companyName || l.contactName || l.phone,
      contactDisplay: l.isAnonymized ? 'Đã che SĐT/Email theo quyền BA' : l.phone,
      isAnonymized: Boolean(l.isAnonymized),
      sourceWebsite: l.sourceWebsite || 'Chưa xác định',
      marketingSource:
        l.tracking?.marketingSource ||
        CONTACT_CHANNEL_LABELS[l.contactChannel] ||
        l.contactChannel,
      campaignName: l.tracking?.campaignName || l.tracking?.utmCampaign || null,
      attributionProof: proofParts.join(' · '),
      pipelineStatusLabel: PIPELINE_STATUS_LABELS[l.pipelineStatus] || l.pipelineStatus,
      assignedSalesName: l.assignedSalesName || 'Chưa phân bổ',
      contactedAt: l.contactedAt,
    };
  });

  return jsonSuccess({
    metric,
    metricTitle: METRIC_TITLES[metric] || 'Danh sách hồ sơ đối chứng gốc',
    totalMatched: filtered.length,
    isRoleAnonymized: records.some((r) => r.isAnonymized),
    roleName: auth.user.roleName,
    records,
  });
}
