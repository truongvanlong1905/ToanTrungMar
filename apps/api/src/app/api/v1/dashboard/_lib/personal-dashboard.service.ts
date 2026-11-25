import { prisma } from '@toantrung/database';
import {
  hasBaPermission,
  type SessionUserDto,
} from '@toantrung/contracts';
import { shouldAnonymizeLeadForRole } from '../../../../../modules/01-leads/service';

export type HandoverSlaLevel = 'normal' | 'warning' | 'overdue';

export interface PersonalHandoverItemDto {
  leadId: number;
  leadCode: string;
  version: number;
  customerLabel: string;
  projectName: string | null;
  phone: string;
  pipelineStatus: string;
  fromSalesName: string | null;
  toSalesName: string | null;
  transferReason: string | null;
  transferredAt: string;
  waitingMinutes: number;
  slaLevel: HandoverSlaLevel;
  nudgedRecently: boolean;
}

export interface PersonalPriorityLeadDto {
  leadId: number;
  leadCode: string;
  customerLabel: string;
  projectName: string | null;
  scheduledDate: string | null;
  waitingDays: number;
  pipelineStatus: string;
}

export interface PersonalDesignItemDto {
  id: number;
  projectName: string;
  designStatus: string;
  requestType: string;
  leadCode: string | null;
  updatedAt: string;
}

export interface RecentTeamActivityDto {
  id: number;
  leadId: number;
  leadCode: string;
  customerLabel: string;
  actionType: string;
  actorName: string;
  summary: string;
  createdAt: string;
}

export interface PersonalDashboardDto {
  generatedAt: string;
  vnDateToday: string;
  roleCode: string;
  isAnonymized: boolean;
  canManageLeads: boolean;
  canViewAllLeads: boolean;
  incomingHandovers: PersonalHandoverItemDto[];
  outgoingHandovers: PersonalHandoverItemDto[];
  overdueTeamHandovers: PersonalHandoverItemDto[];
  todayCallbacks: PersonalPriorityLeadDto[];
  overdueQuotes7d: PersonalPriorityLeadDto[];
  overdueQuotesTotal: number;
  myDesignItems: PersonalDesignItemDto[];
  designCompletedRecentCount: number;
  designPendingCount: number;
  todayStats: {
    newLeadsToday: number;
    pendingIncomingCount: number;
    pendingOutgoingCount: number;
    overdueQuotesCount: number;
    designPendingCount: number;
  };
  recentActivities: RecentTeamActivityDto[];
}

function getVnDateYmd(date = new Date()): string {
  const vnMs = date.getTime() + 7 * 60 * 60 * 1000;
  return new Date(vnMs).toISOString().slice(0, 10);
}

function getVnStartOfDayUtc(date = new Date()): Date {
  const ymd = getVnDateYmd(date);
  return new Date(`${ymd}T00:00:00+07:00`);
}

function computeSla(transferredAt: Date, nowMs: number): {
  waitingMinutes: number;
  slaLevel: HandoverSlaLevel;
} {
  const waitingMinutes = Math.max(0, Math.floor((nowMs - transferredAt.getTime()) / 60_000));
  const slaLevel: HandoverSlaLevel =
    waitingMinutes >= 240 ? 'overdue' : waitingMinutes >= 120 ? 'warning' : 'normal';
  return { waitingMinutes, slaLevel };
}

function extractScheduledDate(note: string | null | undefined): string | null {
  if (!note) return null;
  const match = note.match(/\[HẸN (?:LIÊN HỆ|GỌI LẠI):\s*([0-9]{4}-[0-9]{2}-[0-9]{2})\]/);
  return match ? match[1] : null;
}

function formatCleanActorName(fullName?: string | null, actorRef?: string | null): string {
  if (fullName && fullName.trim()) return fullName.trim();
  const ref = (actorRef || '').trim();
  if (!ref) return 'Hệ thống';
  if (ref.toLowerCase().startsWith('website_webhook:') || ref.toLowerCase().startsWith('webhook:')) {
    const domain = ref.split(':').slice(1).join(':').replace(/^https?:\/\//i, '').replace(/^www\./i, '').trim();
    return domain ? `Web ${domain}` : 'Biểu mẫu Website';
  }
  if (ref.toLowerCase().startsWith('gmail_sync:')) {
    return 'Đồng bộ Gmail';
  }
  if (ref.toLowerCase().startsWith('google_lead_form')) {
    return 'Form Google Ads';
  }
  if (ref.includes('@')) {
    return 'Đồng bộ tự động';
  }
  return ref;
}

export async function getPersonalDashboardData(
  user: SessionUserDto,
): Promise<PersonalDashboardDto> {
  const now = new Date();
  const nowMs = now.getTime();
  const vnToday = getVnDateYmd(now);
  const startOfVnToday = getVnStartOfDayUtc(now);
  const sevenDaysAgo = new Date(nowMs - 7 * 24 * 60 * 60 * 1000);
  const thirtyMinAgo = new Date(nowMs - 30 * 60 * 1000);
  const fourHoursAgo = new Date(nowMs - 4 * 60 * 60 * 1000);

  const isAnonymized = shouldAnonymizeLeadForRole(user.roleCode);
  const canViewLeads = hasBaPermission(user.roleCode, 'LEAD_VIEW_OWN');
  const canViewAllLeads = hasBaPermission(user.roleCode, 'LEAD_VIEW_ALL');
  const canManageLeads = canViewLeads && !isAnonymized;
  const isManagerRole =
    user.roleCode === 'ADMIN' ||
    user.roleCode === 'BOD' ||
    user.roleCode === 'SALES_LEAD';

  const openStatuses = ['new_lead', 'quoting', 'quote_sent'];

  const [
    incomingLeadsRaw,
    outgoingTransferActs,
    overdueTeamLeadsRaw,
    myOpenLeadsRaw,
    newLeadsTodayCount,
    myDesignRaw,
    recentActivitiesRaw,
  ] = await Promise.all([
    canManageLeads
      ? prisma.lead.findMany({
        where: {
          assignedSalesId: user.id,
          receivedAt: null,
          isSpam: false,
          pipelineStatus: { in: openStatuses },
        },
        orderBy: { updatedAt: 'desc' },
        take: 15,
        include: {
          assignedSales: { select: { fullName: true } },
          activities: {
            where: { actionType: { in: ['reassign_sales', 'auto_reassign', 'create_lead'] } },
            orderBy: { createdAt: 'desc' },
            take: 3,
            include: {
              actionBy: { select: { fullName: true } },
              fromSales: { select: { fullName: true } },
            },
          },
        },
      })
      : Promise.resolve([]),

    canManageLeads
      ? prisma.leadActivity.findMany({
        where: {
          actionType: 'reassign_sales',
          OR: [{ actionById: user.id }, { fromSalesId: user.id }],
          lead: {
            receivedAt: null,
            isSpam: false,
            pipelineStatus: { in: openStatuses },
            NOT: { assignedSalesId: user.id },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          toSales: { select: { fullName: true } },
          lead: {
            include: {
              assignedSales: { select: { fullName: true } },
              activities: {
                where: {
                  actionType: 'add_note',
                  createdAt: { gte: thirtyMinAgo },
                  note: { contains: 'Nhắc việc' },
                },
                take: 1,
              },
            },
          },
        },
      })
      : Promise.resolve([]),

    isManagerRole
      ? prisma.lead.findMany({
        where: {
          receivedAt: null,
          isSpam: false,
          pipelineStatus: { in: openStatuses },
          assignedSalesId: { not: null },
          updatedAt: { lte: fourHoursAgo },
        },
        orderBy: { updatedAt: 'asc' },
        take: 6,
        include: {
          assignedSales: { select: { fullName: true } },
          activities: {
            where: { actionType: 'reassign_sales' },
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: {
              actionBy: { select: { fullName: true } },
              fromSales: { select: { fullName: true } },
            },
          },
        },
      })
      : Promise.resolve([]),

    canManageLeads
      ? prisma.lead.findMany({
        where: {
          assignedSalesId: user.id,
          isSpam: false,
          pipelineStatus: { in: openStatuses },
        },
        orderBy: { updatedAt: 'desc' },
        take: 80,
        select: {
          id: true,
          leadCode: true,
          companyName: true,
          contactName: true,
          phone: true,
          projectName: true,
          pipelineStatus: true,
          firstQuoteSentAt: true,
          quoteRespondedAt: true,
          contactedAt: true,
          leadProducts: {
            select: { noteSpecification: true },
            take: 3,
          },
          activities: {
            where: { note: { contains: '[HẸN' } },
            orderBy: { createdAt: 'desc' },
            take: 2,
            select: { note: true },
          },
        },
      })
      : Promise.resolve([]),

    canViewLeads
      ? prisma.lead.count({
        where: {
          isSpam: false,
          createdAt: { gte: startOfVnToday },
          ...(canViewAllLeads ? {} : { assignedSalesId: user.id }),
        },
      })
      : Promise.resolve(0),

    hasBaPermission(user.roleCode, 'AI_DESIGN')
      ? prisma.designRequest.findMany({
        where:
          user.roleCode === 'DESIGNER'
            ? { assignedDesignerId: user.id }
            : user.roleCode === 'ADMIN' || user.roleCode === 'BOD'
              ? {}
              : { requestedBySalesId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 12,
        include: {
          lead: { select: { leadCode: true } },
        },
      })
      : Promise.resolve([]),

    canViewLeads
      ? prisma.leadActivity.findMany({
        where: canViewAllLeads
          ? {}
          : {
            lead: {
              OR: [{ assignedSalesId: user.id }, { createdByUserId: user.id }],
            },
          },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          actionBy: { select: { fullName: true } },
          fromSales: { select: { fullName: true } },
          toSales: { select: { fullName: true } },
          lead: {
            select: {
              id: true,
              leadCode: true,
              companyName: true,
              contactName: true,
              projectName: true,
            },
          },
        },
      })
      : Promise.resolve([]),
  ]);

  const incomingHandovers: PersonalHandoverItemDto[] = incomingLeadsRaw
    .map((l) => {
      const reassignAct = l.activities.find(
        (a) => a.actionType === 'reassign_sales' || a.actionType === 'auto_reassign',
      );
      const refDate = reassignAct?.createdAt || l.createdAt;
      const { waitingMinutes, slaLevel } = computeSla(refDate, nowMs);
      return {
        leadId: l.id,
        leadCode: l.leadCode,
        version: l.version,
        customerLabel: l.companyName || l.contactName || l.phone,
        projectName: l.projectName || null,
        phone: l.phone,
        pipelineStatus: l.pipelineStatus,
        fromSalesName:
          reassignAct?.actionBy?.fullName ||
          reassignAct?.fromSales?.fullName ||
          (l.createdByUserId && l.createdByUserId !== user.id ? 'Điều phối CRM' : null),
        toSalesName: l.assignedSales?.fullName || user.fullName,
        transferReason: reassignAct?.transferReason || null,
        transferredAt: refDate.toISOString(),
        waitingMinutes,
        slaLevel,
        nudgedRecently: false,
      };
    })
    .sort((a, b) => b.waitingMinutes - a.waitingMinutes);

  const seenOutgoingIds = new Set<number>();
  const outgoingHandovers: PersonalHandoverItemDto[] = [];
  for (const act of outgoingTransferActs) {
    if (seenOutgoingIds.has(act.leadId)) continue;
    seenOutgoingIds.add(act.leadId);
    const l = act.lead;
    const { waitingMinutes, slaLevel } = computeSla(act.createdAt, nowMs);
    outgoingHandovers.push({
      leadId: l.id,
      leadCode: l.leadCode,
      version: l.version,
      customerLabel: l.companyName || l.contactName || l.phone,
      projectName: l.projectName || null,
      phone: l.phone,
      pipelineStatus: l.pipelineStatus,
      fromSalesName: user.fullName,
      toSalesName: l.assignedSales?.fullName || act.toSales?.fullName || 'NVKD nhận',
      transferReason: act.transferReason || null,
      transferredAt: act.createdAt.toISOString(),
      waitingMinutes,
      slaLevel,
      nudgedRecently: l.activities.length > 0,
    });
  }

  const overdueTeamHandovers: PersonalHandoverItemDto[] = overdueTeamLeadsRaw.map((l) => {
    const act = l.activities[0];
    const refDate = act?.createdAt || l.createdAt;
    const { waitingMinutes, slaLevel } = computeSla(refDate, nowMs);
    return {
      leadId: l.id,
      leadCode: l.leadCode,
      version: l.version,
      customerLabel: l.companyName || l.contactName || l.phone,
      projectName: l.projectName || null,
      phone: l.phone,
      pipelineStatus: l.pipelineStatus,
      fromSalesName: act?.actionBy?.fullName || act?.fromSales?.fullName || 'Hệ thống',
      toSalesName: l.assignedSales?.fullName || 'Chưa phân bổ',
      transferReason: act?.transferReason || null,
      transferredAt: refDate.toISOString(),
      waitingMinutes,
      slaLevel,
      nudgedRecently: false,
    };
  });

  const todayCallbacks: PersonalPriorityLeadDto[] = [];
  const overdueQuotes7d: PersonalPriorityLeadDto[] = [];

  for (const l of myOpenLeadsRaw) {
    const combinedNotes = [
      ...l.leadProducts.map((p) => p.noteSpecification || ''),
      ...l.activities.map((a) => a.note || ''),
    ].join(' ');
    const sched = extractScheduledDate(combinedNotes);
    if (sched && sched <= vnToday) {
      todayCallbacks.push({
        leadId: l.id,
        leadCode: l.leadCode,
        customerLabel: l.companyName || l.contactName || l.phone,
        projectName: l.projectName || null,
        scheduledDate: sched,
        waitingDays: Math.max(
          0,
          Math.floor((nowMs - new Date(`${sched}T00:00:00+07:00`).getTime()) / (24 * 60 * 60 * 1000)),
        ),
        pipelineStatus: l.pipelineStatus,
      });
    }
    if (
      l.pipelineStatus === 'quote_sent' &&
      !l.quoteRespondedAt &&
      l.firstQuoteSentAt &&
      l.firstQuoteSentAt <= sevenDaysAgo
    ) {
      overdueQuotes7d.push({
        leadId: l.id,
        leadCode: l.leadCode,
        customerLabel: l.companyName || l.contactName || l.phone,
        projectName: l.projectName || null,
        scheduledDate: sched,
        waitingDays: Math.max(
          7,
          Math.floor((nowMs - l.firstQuoteSentAt.getTime()) / (24 * 60 * 60 * 1000)),
        ),
        pipelineStatus: l.pipelineStatus,
      });
    }
  }

  const myDesignItems: PersonalDesignItemDto[] = myDesignRaw.slice(0, 5).map((d) => ({
    id: d.id,
    projectName: d.ledCategory || `Yêu cầu thiết kế #${d.id}`,
    designStatus: d.designStatus,
    requestType: d.requestType,
    leadCode: d.lead?.leadCode || null,
    updatedAt: (d.completedAt || d.createdAt).toISOString(),
  }));

  const designCompletedRecentCount = myDesignRaw.filter(
    (d) =>
      d.designStatus === 'completed' &&
      (d.completedAt || d.createdAt) >= sevenDaysAgo,
  ).length;
  const designPendingCount = myDesignRaw.filter(
    (d) => d.designStatus !== 'completed' && d.designStatus !== 'cancelled',
  ).length;

  const ACTION_LABELS: Record<string, string> = {
    create_lead: 'Tiếp nhận Lead mới',
    confirm_receive: 'Đã xác nhận tiếp nhận Lead',
    reassign_sales: 'Chuyển giao Lead',
    status_change: 'Cập nhật trạng thái Lead',
    quote_version: 'Gửi phiên bản báo giá',
    upload_attachment: 'Cập nhật tệp đính kèm',
    design_completed: 'Hoàn tất thiết kế AI',
    add_note: 'Ghi chú phối hợp',
    reopen_lead: 'Mở lại hồ sơ khách cũ',
  };

  const recentActivities: RecentTeamActivityDto[] = recentActivitiesRaw.slice(0, 8).map((act) => {
    const labelBase = ACTION_LABELS[act.actionType] || 'Cập nhật hồ sơ';
    let summary = labelBase;
    if (act.actionType === 'reassign_sales' && act.toSales?.fullName) {
      summary = `Chuyển giao cho ${act.toSales.fullName}`;
    } else if (act.actionType === 'status_change' && act.newStatus) {
      const stMap: Record<string, string> = {
        new_lead: 'Vừa nhận thông tin',
        quoting: 'Đang soạn báo giá',
        quote_sent: 'Đã gửi báo giá',
        won: 'Chốt thành công',
        lost: 'Thất bại',
      };
      summary = `Chuyển trạng thái → ${stMap[act.newStatus] || act.newStatus}`;
    }

    return {
      id: act.id,
      leadId: act.leadId,
      leadCode: act.lead.leadCode,
      customerLabel: isAnonymized
        ? ''
        : act.lead.companyName || act.lead.contactName || act.lead.projectName || '',
      actionType: act.actionType,
      actorName: formatCleanActorName(act.actionBy?.fullName, act.actorRef),
      summary,
      createdAt: act.createdAt.toISOString(),
    };
  });

  return {
    generatedAt: now.toISOString(),
    vnDateToday: vnToday,
    roleCode: user.roleCode,
    isAnonymized,
    canManageLeads,
    canViewAllLeads,
    incomingHandovers,
    outgoingHandovers,
    overdueTeamHandovers,
    todayCallbacks: todayCallbacks.slice(0, 6),
    overdueQuotes7d: overdueQuotes7d.slice(0, 6),
    overdueQuotesTotal: overdueQuotes7d.length,
    myDesignItems,
    designCompletedRecentCount,
    designPendingCount,
    todayStats: {
      newLeadsToday: newLeadsTodayCount,
      pendingIncomingCount: incomingHandovers.length,
      pendingOutgoingCount: outgoingHandovers.length,
      overdueQuotesCount: overdueQuotes7d.length,
      designPendingCount,
    },
    recentActivities,
  };
}
