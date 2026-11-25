import { prisma } from '@toantrung/database';
import { hasBaPermission, PIPELINE_STATUS_LABELS } from '@toantrung/contracts';
import { jsonSuccess } from '../../../../../core/http';
import { requireAuthenticatedSession } from '../../../../../core/permissions';
import { listLeadsForUser } from '../../../../../modules/01-leads/service';
import { listDesignRequestsForUser } from '../../../../../modules/05-ai-design/service';

export const dynamic = 'force-dynamic';

export interface CommandPaletteResultItem {
  id: string;
  group: 'leads' | 'campaigns' | 'seo' | 'design';
  title: string;
  subtitle: string;
  badge?: string;
  href: string;
}

export async function GET(req: Request) {
  const auth = await requireAuthenticatedSession(req, { requireCsrf: false });
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const rawQuery = (url.searchParams.get('q') || '').trim();
  if (!rawQuery) {
    return jsonSuccess({ items: [] as CommandPaletteResultItem[], query: '' });
  }

  const q = rawQuery.slice(0, 80);
  const qLower = q.toLowerCase();
  const role = auth.user.roleCode;
  const items: CommandPaletteResultItem[] = [];

  const canViewLeads = hasBaPermission(role, 'LEAD_VIEW_OWN');
  const canViewTracking = hasBaPermission(role, 'TRACKING_ADS_OPTIMIZE');
  const canViewSeo = hasBaPermission(role, 'AI_MARKETING_SEO');
  const canViewDesign =
    hasBaPermission(role, 'AI_DESIGN') ||
    role === 'SALES' ||
    role === 'SALES_LEAD' ||
    role === 'BOD' ||
    role === 'ADMIN';

  const [leadsRes, campaignsRes, seoRes, designRes] = await Promise.all([
    canViewLeads
      ? listLeadsForUser(auth.user, { search: q, pageSize: 6 }).catch(() => null)
      : Promise.resolve(null),
    canViewTracking
      ? prisma.campaign
          .findMany({
            where: {
              OR: [
                { campaignName: { contains: q } },
                { campaignCode: { contains: q } },
                { utmCampaignSlug: { contains: q } },
              ],
            },
            orderBy: { updatedAt: 'desc' },
            take: 5,
          })
          .catch(() => [])
      : Promise.resolve([]),
    canViewSeo
      ? prisma.seoArticle
          .findMany({
            where: {
              OR: [
                { title: { contains: q } },
                { topic: { contains: q } },
                { targetWebsite: { contains: q } },
              ],
            },
            orderBy: { updatedAt: 'desc' },
            take: 5,
            select: {
              id: true,
              title: true,
              topic: true,
              targetWebsite: true,
              status: true,
            },
          })
          .catch(() => [])
      : Promise.resolve([]),
    canViewDesign
      ? listDesignRequestsForUser(auth.user, { page: 1, pageSize: 50 }).catch(() => null)
      : Promise.resolve(null),
  ]);

  if (leadsRes?.leads) {
    for (const lead of leadsRes.leads.slice(0, 6)) {
      const displayName = lead.isAnonymized
        ? lead.companyName || 'Khách hàng (Ẩn danh BA)'
        : lead.companyName || lead.contactName || lead.phone;
      const contactHint = lead.isAnonymized ? 'Ẩn danh PII' : lead.phone;
      items.push({
        id: `lead-${lead.id}`,
        group: 'leads',
        title: `${lead.leadCode} · ${displayName}`,
        subtitle: `${contactHint}${lead.projectName ? ` · ${lead.projectName}` : ''} · Sales: ${lead.assignedSalesName || 'Chưa gán'}`,
        badge: PIPELINE_STATUS_LABELS[lead.pipelineStatus] || lead.pipelineStatus,
        href: `/leads?leadId=${lead.id}`,
      });
    }
  }

  for (const camp of campaignsRes) {
    items.push({
      id: `campaign-${camp.id}`,
      group: 'campaigns',
      title: camp.campaignName,
      subtitle: `Mã: ${camp.campaignCode} · Nền tảng: ${camp.platform}`,
      badge: camp.isActive ? 'Đang chạy' : 'Tạm dừng',
      href: `/tracking?search=${encodeURIComponent(camp.campaignName)}`,
    });
  }

  for (const art of seoRes) {
    items.push({
      id: `seo-${art.id}`,
      group: 'seo',
      title: art.title,
      subtitle: `${art.targetWebsite} · Chủ đề: ${art.topic}`,
      badge:
        art.status === 'published'
          ? 'Đã đăng'
          : art.status === 'approved_scheduled'
            ? 'Chờ đăng'
            : 'Bản nháp',
      href: `/ads?articleId=${art.id}`,
    });
  }

  if (designRes?.requests) {
    const matchedDesigns = designRes.requests
      .filter((d) => {
        const code = `da-${String(d.id).padStart(4, '0')}`;
        return (
          code.includes(qLower) ||
          (d.projectName || '').toLowerCase().includes(qLower) ||
          (d.leadCode || '').toLowerCase().includes(qLower) ||
          (d.productName || '').toLowerCase().includes(qLower)
        );
      })
      .slice(0, 5);

    for (const d of matchedDesigns) {
      const daCode = `DA-${String(d.id).padStart(4, '0')}`;
      const dimText =
        d.screenWidthM && d.screenHeightM
          ? `${d.screenWidthM}m × ${d.screenHeightM}m`
          : d.ledModuleSpec || 'Chưa nhập kích thước';
      items.push({
        id: `design-${d.id}`,
        group: 'design',
        title: `${daCode} · ${d.projectName || 'Dự án Thiết kế LED'}`,
        subtitle: `${d.leadCode ? `Lead: ${d.leadCode} · ` : ''}${dimText}`,
        badge: hasBaPermission(role, 'AI_DESIGN') ? 'Mở Studio' : 'Xem hồ sơ',
        href: hasBaPermission(role, 'AI_DESIGN')
          ? `/design?projectId=${d.id}`
          : `/leads?search=${encodeURIComponent(d.leadCode || d.projectName || '')}`,
      });
    }
  }

  return jsonSuccess({
    query: q,
    items,
  });
}
