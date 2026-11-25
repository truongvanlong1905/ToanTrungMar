import { prisma } from '@toantrung/database';
import {
  BA_PERMISSIONS,
  hasBaPermission,
  type BaPermissionKey,
  type NotificationDto,
  type RoleCode,
} from '@toantrung/contracts';
import { bumpDomainRevisions, getOrComputeScopedCache } from '../cache/server-data-cache';
import { sanitizeUntrustedReportHtml } from '../security/html-sanitizer';

export type DepartmentScopeCode =
  | 'ALL'
  | 'KINH_DOANH'
  | 'MARKETING_SEO'
  | 'ADS'
  | 'KY_THUAT_THIET_KE';

export const DEPARTMENT_SCOPE_LABELS: Record<DepartmentScopeCode, string> = {
  ALL: 'Toàn công ty (Tất cả phòng ban)',
  KINH_DOANH: 'Phòng Kinh doanh',
  MARKETING_SEO: 'Phòng Marketing & SEO',
  ADS: 'Bộ phận Quảng cáo Ads',
  KY_THUAT_THIET_KE: 'Bộ phận Thiết kế Kỹ thuật',
};

export function getDepartmentScopeForRole(roleCode: RoleCode): DepartmentScopeCode {
  switch (roleCode) {
    case 'BOD':
    case 'ADMIN':
      return 'ALL';
    case 'SALES':
    case 'SALES_LEAD':
      return 'KINH_DOANH';
    case 'MKT_STAFF':
    case 'MKT_LEAD':
      return 'MARKETING_SEO';
    case 'ADS':
      return 'ADS';
    case 'DESIGNER':
      return 'KY_THUAT_THIET_KE';
    default:
      return 'KINH_DOANH';
  }
}

function inferNotificationDepartment(
  category: string,
  title: string,
  summary: string,
): DepartmentScopeCode {
  const text = `${category} ${title} ${summary}`.toLowerCase();
  if (
    text.includes('phòng kinh doanh') ||
    text.includes('pipeline') ||
    text.includes('báo giá') ||
    text.includes('lead') ||
    text.includes('nhà máy đông á')
  ) {
    return 'KINH_DOANH';
  }
  if (
    text.includes('marketing') ||
    text.includes('seo') ||
    text.includes('từ khóa') ||
    text.includes('bài viết')
  ) {
    return 'MARKETING_SEO';
  }
  if (
    text.includes('bộ phận quảng cáo') ||
    text.includes('chiến dịch ads') ||
    text.includes('google ads') ||
    text.includes('cpl')
  ) {
    return 'ADS';
  }
  if (
    text.includes('thiết kế') ||
    text.includes('phối cảnh') ||
    text.includes('3d') ||
    text.includes('banner')
  ) {
    return 'KY_THUAT_THIET_KE';
  }
  return 'ALL';
}

function sanitizeNotificationCopy(title: string, summary: string, category: string) {
  let cleanTitle = title.replace(/\s*\(Độc lập\)/gi, '');
  let cleanSummary = summary
    .replace(
      /Toàn bộ 5 phân hệ\s*\(M01[^)]*\)\s*đã được kích hoạt trên môi trường độc lập\.?/gi,
      'Hệ thống Quản lý Kinh doanh, Marketing & Thiết kế Toàn Trung đã đồng bộ dữ liệu hoạt động trong ngày.',
    )
    .replace(/\bM0[1-5]\b\s*/g, '');
  let cleanCategory = category;
  if (cleanCategory === 'Pipeline') cleanCategory = 'Phòng Kinh doanh';
  if (cleanCategory === 'Hệ thống') cleanCategory = 'Thông báo chung';
  return { cleanTitle, cleanSummary, cleanCategory };
}

function canAccessNotificationAction(
  roleCode: RoleCode,
  actionUrl: string | null,
  requiredPermission: string | null,
): boolean {
  if (!actionUrl) return false;
  if (actionUrl.startsWith('/admin') && roleCode !== 'ADMIN') {
    return false;
  }
  if (requiredPermission && requiredPermission in BA_PERMISSIONS) {
    return hasBaPermission(roleCode, requiredPermission as BaPermissionKey);
  }
  return true;
}

export interface DispatchedReportItemDto {
  id: number;
  reportCode: string;
  status: 'DRAFT' | 'ISSUED';
  title: string;
  summary: string;
  contentHtml: string;
  targetDepartments: string[];
  reportingPeriod: string;
  authorName: string;
  authorRole: string;
  createdAt: string;
}

export async function countUnreadNotificationsFast(
  userId: number,
  roleCode?: RoleCode,
): Promise<number> {
  if (roleCode) {
    const summary = await listUserNotifications(userId, roleCode, { summaryOnly: true });
    return summary.unreadCount;
  }
  const res = await getOrComputeScopedCache<number>({
    key: `notif-unread-count:${userId}`,
    domains: ['notifications'],
    ttlMs: 15_000,
    compute: () =>
      prisma.notification.count({
        where: { userId, isRead: false },
      }),
  });
  return res.data;
}

export async function listUserNotifications(
  userId: number,
  roleCode: RoleCode,
  options?: { summaryOnly?: boolean; bypassCache?: boolean },
): Promise<{
  items: Array<NotificationDto & { departmentScope?: DepartmentScopeCode; departmentLabel?: string }>;
  unreadCount: number;
  userDepartmentCode: DepartmentScopeCode;
  userDepartmentLabel: string;
  canSendFullReport: boolean;
  reports: DispatchedReportItemDto[];
}> {
  const summaryOnly = Boolean(options?.summaryOnly);
  const cached = await getOrComputeScopedCache({
    key: `notif-list:${userId}:${roleCode}:${summaryOnly ? 'summary' : 'full'}`,
    domains: ['notifications'],
    ttlMs: 15_000,
    bypassCache: options?.bypassCache,
    compute: async () => {
      const userDept = getDepartmentScopeForRole(roleCode);
      const canSendFullReport = roleCode === 'BOD' || roleCode === 'ADMIN';

      const [rows, allReports] = await Promise.all([
        prisma.notification.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: summaryOnly ? 20 : 60,
        }),
        summaryOnly
          ? Promise.resolve([] as DispatchedReportItemDto[])
          : listDispatchedExecutiveReports(25, userId, roleCode),
      ]);

      // C10: Gộp các thông báo chưa đọc bị trùng khóa (category + title) khi hiển thị, nhưng không tự xóa bản ghi chưa đọc trong CSDL
      const seenUnreadKeys = new Set<string>();
      const dedupedRows = rows.filter((r) => {
        if (r.isRead) return true;
        const key = `${r.category.trim().toLowerCase()}::${r.title.trim().toLowerCase()}`;
        if (seenUnreadKeys.has(key)) return false;
        seenUnreadKeys.add(key);
        return true;
      });

      const filteredItems = dedupedRows
        .map((r) => {
          const { cleanTitle, cleanSummary, cleanCategory } = sanitizeNotificationCopy(
            r.title,
            r.summary,
            r.category,
          );
          const deptScope = inferNotificationDepartment(cleanCategory, cleanTitle, cleanSummary);
          const allowed = canAccessNotificationAction(
            roleCode,
            r.actionUrl,
            r.requiredPermission,
          );
          return {
            id: r.id,
            title: cleanTitle,
            summary: cleanSummary,
            category: cleanCategory,
            departmentScope: deptScope,
            departmentLabel: DEPARTMENT_SCOPE_LABELS[deptScope],
            isRead: r.isRead,
            actionLabel: allowed ? r.actionLabel : null,
            actionUrl: allowed ? r.actionUrl : null,
            createdAt: r.createdAt.toISOString(),
            readAt: r.readAt ? r.readAt.toISOString() : null,
          };
        })
        .filter((item) => {
          if (canSendFullReport) return true;
          // Nhân sự phòng nào chỉ xem thông báo thuộc phòng đó hoặc thông báo chung từ Ban Giám đốc
          return item.departmentScope === userDept || item.departmentScope === 'ALL';
        });

      const unreadCount = filteredItems.filter((r) => !r.isRead).length;
      const visibleReports = allReports.filter((rpt) => {
        if (canSendFullReport) return true;
        if (rpt.status === 'DRAFT') return true;
        const targets = rpt.targetDepartments || [];
        return (
          targets.length === 0 ||
          targets.includes('ALL') ||
          targets.includes(userDept)
        );
      });

      return {
        items: filteredItems,
        unreadCount,
        userDepartmentCode: userDept,
        userDepartmentLabel: DEPARTMENT_SCOPE_LABELS[userDept],
        canSendFullReport,
        reports: visibleReports,
      };
    },
  });
  return cached.data;
}

export async function markNotificationsRead(
  userId: number,
  roleCode: RoleCode,
  options: { notificationId?: number; markAll?: boolean },
) {
  const now = new Date();
  if (options.markAll) {
    await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: now },
    });
  } else if (options.notificationId) {
    await prisma.notification.updateMany({
      where: { id: options.notificationId, userId },
      data: { isRead: true, readAt: now },
    });
  }

  bumpDomainRevisions(['notifications'], 'mark_notifications_read');
  return listUserNotifications(userId, roleCode, { bypassCache: true });
}

export async function createDispatchNotification(
  userId: number,
  roleCode: RoleCode,
  input: {
    title: string;
    summary: string;
    category?: string;
    actionLabel?: string;
    actionUrl?: string;
    contentHtml?: string;
    targetDepartments?: string[];
    authorName?: string;
    authorRole?: string;
  },
) {
  const senderDept = getDepartmentScopeForRole(roleCode);
  const isExecutive = roleCode === 'BOD' || roleCode === 'ADMIN';

  // Giám đốc / Admin được phép gửi báo cáo full đến mọi phòng ban hoặc chọn phòng cụ thể.
  // Nhân sự phòng ban gửi báo cáo trong phạm vi phòng mình & trình Ban Giám đốc.
  const effectiveTargetDepts = isExecutive
    ? input.targetDepartments && input.targetDepartments.length > 0
      ? input.targetDepartments
      : ['ALL']
    : [senderDept];

  const categoryLabel = isExecutive
    ? effectiveTargetDepts.includes('ALL')
      ? 'Báo cáo Ban Giám đốc (Toàn công ty)'
      : `Báo cáo Điều hành (${effectiveTargetDepts
          .map((d) => DEPARTMENT_SCOPE_LABELS[d as DepartmentScopeCode] || d)
          .join(', ')})`
    : DEPARTMENT_SCOPE_LABELS[senderDept];

  let savedReportId: number | null = null;
  const sanitizedHtml = sanitizeUntrustedReportHtml(input.contentHtml);
  if (sanitizedHtml && sanitizedHtml.trim()) {
    const auditEntry = await prisma.auditLog.create({
      data: {
        actorUserId: userId,
        action: 'REPORT_DISPATCHED',
        targetType: 'EXECUTIVE_REPORT',
        targetId: `RPT-${Date.now()}`,
        detailsJson: JSON.stringify({
          title: input.title.trim(),
          summary: input.summary.trim(),
          contentHtml: sanitizedHtml,
          targetDepartments: effectiveTargetDepts,
          authorName: input.authorName || 'Điều hành Toàn Trung',
          authorRole: input.authorRole || roleCode,
        }),
      },
    });
    savedReportId = auditEntry.id;
  }

  const safeCustomActionUrl =
    input.actionUrl && /^\/(?!\/)[a-zA-Z0-9/_?=&%-]*$/.test(input.actionUrl.trim())
      ? input.actionUrl.trim()
      : '/notifications';
  const finalActionUrl = savedReportId
    ? `/notifications?reportId=${savedReportId}`
    : safeCustomActionUrl;

  const allActiveUsers = await prisma.user.findMany({
    where: { isActive: true, deletedAt: null },
    include: { role: true },
  });

  const isBroadcast =
    isExecutive &&
    (effectiveTargetDepts.length === 0 || effectiveTargetDepts.includes('ALL'));

  const recipientIds = new Set<number>([userId]);
  for (const u of allActiveUsers) {
    const rc = u.role.roleCode;
    if (rc === 'BOD' || rc === 'ADMIN' || isBroadcast) {
      recipientIds.add(u.id);
      continue;
    }
    if (
      effectiveTargetDepts.includes('KINH_DOANH') &&
      (rc === 'SALES' || rc === 'SALES_LEAD')
    ) {
      recipientIds.add(u.id);
    }
    if (
      effectiveTargetDepts.includes('MARKETING_SEO') &&
      (rc === 'MKT_STAFF' || rc === 'MKT_LEAD')
    ) {
      recipientIds.add(u.id);
    }
    if (effectiveTargetDepts.includes('ADS') && rc === 'ADS') {
      recipientIds.add(u.id);
    }
    if (effectiveTargetDepts.includes('KY_THUAT_THIET_KE') && rc === 'DESIGNER') {
      recipientIds.add(u.id);
    }
  }

  await prisma.notification.createMany({
    data: Array.from(recipientIds).map((uid) => ({
      userId: uid,
      title: input.title.trim().slice(0, 200),
      summary: input.summary.trim().slice(0, 500),
      category: (input.category || categoryLabel).trim().slice(0, 80),
      isRead: false,
      actionLabel: input.actionLabel || 'Xem báo cáo chi tiết',
      actionUrl: finalActionUrl,
      requiredPermission: 'DASHBOARD_VIEW',
    })),
  });

  bumpDomainRevisions(['notifications', 'reports'], 'dispatch_notification');
  const list = await listUserNotifications(userId, roleCode, { bypassCache: true });
  return {
    ...list,
    savedReportId,
  };
}

export async function saveReportDraftForUser(
  userId: number,
  roleCode: RoleCode,
  input: {
    draftId?: number | null;
    title: string;
    summary: string;
    contentHtml: string;
    targetDepartments?: string[];
    authorName?: string;
    authorRole?: string;
    reportingPeriod?: string;
  },
) {
  const sanitizedDraftHtml = sanitizeUntrustedReportHtml(input.contentHtml);
  const payloadJson = JSON.stringify({
    status: 'DRAFT',
    title: input.title.trim(),
    summary: input.summary.trim(),
    contentHtml: sanitizedDraftHtml,
    targetDepartments: input.targetDepartments || [],
    authorName: input.authorName || 'Điều hành Toàn Trung',
    authorRole: input.authorRole || roleCode,
    reportingPeriod: input.reportingPeriod || '30 ngày gần nhất',
    updatedAt: new Date().toISOString(),
  });

  if (input.draftId && input.draftId > 0) {
    const existing = await prisma.auditLog.findFirst({
      where: {
        id: input.draftId,
        actorUserId: userId,
        targetType: 'EXECUTIVE_REPORT_DRAFT',
      },
    });
    if (existing) {
      const updated = await prisma.auditLog.update({
        where: { id: existing.id },
        data: { detailsJson: payloadJson },
      });
      bumpDomainRevisions(['notifications', 'reports'], 'save_report_draft');
      return {
        id: updated.id,
        reportCode: updated.targetId || `DRAFT-${updated.id}`,
        status: 'DRAFT' as const,
        updatedAt: new Date().toISOString(),
      };
    }
  }

  const created = await prisma.auditLog.create({
    data: {
      actorUserId: userId,
      action: 'REPORT_DRAFT_SAVED',
      targetType: 'EXECUTIVE_REPORT_DRAFT',
      targetId: `DRAFT-${Date.now()}`,
      detailsJson: payloadJson,
    },
  });

  bumpDomainRevisions(['notifications', 'reports'], 'save_report_draft');
  return {
    id: created.id,
    reportCode: created.targetId || `DRAFT-${created.id}`,
    status: 'DRAFT' as const,
    updatedAt: created.createdAt.toISOString(),
  };
}

export async function listDispatchedExecutiveReports(
  limit = 20,
  actorUserId?: number,
  roleCode?: RoleCode,
): Promise<DispatchedReportItemDto[]> {
  const logs = await prisma.auditLog.findMany({
    where: {
      OR: [
        { targetType: 'EXECUTIVE_REPORT' },
        ...(actorUserId
          ? [{ targetType: 'EXECUTIVE_REPORT_DRAFT', actorUserId }]
          : [{ targetType: 'EXECUTIVE_REPORT_DRAFT' }]),
      ],
    },
    include: { actor: { select: { fullName: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  const mapped = logs.map((l) => {
    let parsed: {
      status?: 'DRAFT' | 'ISSUED';
      title?: string;
      summary?: string;
      contentHtml?: string;
      targetDepartments?: string[];
      authorName?: string;
      authorRole?: string;
      reportingPeriod?: string;
    } = {};
    if (l.detailsJson) {
      try {
        parsed = JSON.parse(l.detailsJson) as typeof parsed;
      } catch {
        // ignore
      }
    }
    const isDraft = l.targetType === 'EXECUTIVE_REPORT_DRAFT' || parsed.status === 'DRAFT';
    return {
      id: l.id,
      reportCode: l.targetId || (isDraft ? `TT-DRAFT-${l.id}` : `TT-RPT-${l.id}`),
      status: isDraft ? ('DRAFT' as const) : ('ISSUED' as const),
      title: parsed.title || 'Báo cáo điều hành nội bộ',
      summary: parsed.summary || '',
      contentHtml: sanitizeUntrustedReportHtml(parsed.contentHtml || ''),
      targetDepartments: parsed.targetDepartments || [],
      reportingPeriod: parsed.reportingPeriod || '30 ngày gần nhất',
      authorName: parsed.authorName || l.actor?.fullName || 'Điều hành',
      authorRole: parsed.authorRole || '',
      createdAt: l.createdAt.toISOString(),
      actorUserId: l.actorUserId,
    };
  });

  if (!roleCode || roleCode === 'BOD' || roleCode === 'ADMIN') {
    return mapped.map(({ actorUserId: _a, ...item }) => item);
  }

  const userDept = getDepartmentScopeForRole(roleCode);
  return mapped
    .filter((rpt) => {
      if (rpt.status === 'DRAFT') {
        return actorUserId ? rpt.actorUserId === actorUserId : false;
      }
      const targets = rpt.targetDepartments || [];
      return (
        targets.length === 0 ||
        targets.includes('ALL') ||
        targets.includes(userDept) ||
        (actorUserId !== undefined && rpt.actorUserId === actorUserId)
      );
    })
    .map(({ actorUserId: _a, ...item }) => item);
}

/**
 * C10 — Gộp thông báo cùng sự kiện/thực thể theo khóa (userId + category + title);
 * cập nhật thông báo chưa đọc hiện có thay vì tạo mới mỗi vòng poll / nhắc việc.
 */
export async function upsertActionableNotification(input: {
  userId: number;
  title: string;
  summary: string;
  category: string;
  actionLabel?: string | null;
  actionUrl?: string | null;
  requiredPermission?: string | null;
}): Promise<void> {
  const cleanTitle = input.title.trim().slice(0, 200);
  const cleanCategory = input.category.trim().slice(0, 80);
  const cleanSummary = input.summary.trim().slice(0, 500);

  const existingUnread = await prisma.notification.findFirst({
    where: {
      userId: input.userId,
      isRead: false,
      category: cleanCategory,
      title: cleanTitle,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (existingUnread) {
    await prisma.notification.update({
      where: { id: existingUnread.id },
      data: {
        summary: cleanSummary,
        actionLabel: input.actionLabel ?? existingUnread.actionLabel,
        actionUrl: input.actionUrl ?? existingUnread.actionUrl,
        requiredPermission: input.requiredPermission ?? existingUnread.requiredPermission,
      },
    });
    bumpDomainRevisions(['notifications'], 'upsert_notification');
    return;
  }

  await prisma.notification.create({
    data: {
      userId: input.userId,
      title: cleanTitle,
      summary: cleanSummary,
      category: cleanCategory,
      isRead: false,
      actionLabel: input.actionLabel ?? null,
      actionUrl: input.actionUrl ?? null,
      requiredPermission: input.requiredPermission ?? null,
    },
  });
  bumpDomainRevisions(['notifications'], 'create_notification');
}

