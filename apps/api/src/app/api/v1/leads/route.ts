import { CreateManualLeadSchema } from '@toantrung/contracts';
import { prisma } from '@toantrung/database';
import { jsonError, jsonSuccess } from '../../../../core/http';
import { bumpDomainRevisions } from '../../../../core/cache/server-data-cache';
import {
  requireAuthenticatedSession,
  requirePermissionSession,
} from '../../../../core/permissions';
import {
  createManualLead,
  listLeadsForUser,
  setSalesReceivingStatus,
} from '../../../../modules/01-leads/service';
import { ensureGmailAutoSyncPollerStarted } from '../../../../modules/01-leads/gmail-sync.service';

export async function GET(req: Request) {
  const auth = await requirePermissionSession(req, 'LEAD_VIEW_OWN');
  if (!auth.ok) return auth.response;

  // Ensure server-side background Gmail poller is running independently of client page views
  ensureGmailAutoSyncPollerStarted();

  try {
    const url = new URL(req.url);
    const status = url.searchParams.get('status') || undefined;
    const sourceWebsite =
      url.searchParams.get('sourceWebsite') ||
      url.searchParams.get('websiteId') ||
      (url.searchParams.get('missingWebsite') === '1' ? '__unresolved__' : undefined) ||
      undefined;
    const search = url.searchParams.get('search') || undefined;
    const validOnly =
      url.searchParams.get('validOnly') === '1' ||
      url.searchParams.get('validOnly') === 'true';
    const includeSpam = !validOnly && url.searchParams.get('includeSpam') === 'true';
    const overdueOnly =
      url.searchParams.get('overdueOnly') === 'true' ||
      url.searchParams.get('overdue') === '1';
    const unreceivedOnly =
      url.searchParams.get('unreceived') === '1' ||
      url.searchParams.get('unreceivedOnly') === 'true';
    const missingProductOnly = url.searchParams.get('missingProduct') === '1';
    const salesId = url.searchParams.get('salesId') || undefined;
    const productId = url.searchParams.get('productId') || undefined;
    const fromDateStr = url.searchParams.get('from') || undefined;
    const toDateStr = url.searchParams.get('to') || undefined;
    const pageParam = url.searchParams.get('page');
    const pageSizeParam = url.searchParams.get('pageSize');
    const page = pageParam ? Math.max(1, Number(pageParam) || 1) : undefined;
    const pageSize = pageSizeParam ? Math.max(1, Number(pageSizeParam) || 50) : undefined;

    const [payload, currentUserRecord] = await Promise.all([
      listLeadsForUser(auth.user, {
        status,
        sourceWebsite,
        search,
        includeSpam,
        validOnly,
        overdueOnly,
        unreceivedOnly,
        missingProductOnly,
        salesId,
        productId,
        fromDateStr,
        toDateStr,
        page,
        pageSize,
      }),
      prisma.user.findUnique({
        where: { id: auth.user.id },
        select: { isReceivingLeads: true },
      }),
    ]);

    return jsonSuccess({
      ...payload,
      isReceivingLeads: currentUserRecord?.isReceivingLeads ?? true,
    });
  } catch (err) {
    return jsonError(
      'LEAD_LIST_FAILED',
      err instanceof Error ? err.message : 'Không thể tải danh sách hồ sơ Lead.',
      500,
    );
  }
}

export async function PATCH(req: Request) {
  const auth = await requireAuthenticatedSession(req);
  if (!auth.ok) return auth.response;

  try {
    const raw = (await req.json()) as Record<string, unknown>;
    if (raw.action === 'set_receiving_status') {
      const updated = await setSalesReceivingStatus(auth.user, Boolean(raw.isReceivingLeads));
      bumpDomainRevisions(['leads', 'reports', 'auth'], 'sales_receiving_status');
      return jsonSuccess(updated);
    }
    return jsonError('INVALID_ACTION', 'Thao tác không hợp lệ.', 400);
  } catch (err) {
    return jsonError(
      'UPDATE_RECEIVING_STATUS_FAILED',
      err instanceof Error ? err.message : 'Không thể cập nhật trạng thái nhận Lead.',
      400,
    );
  }
}

export async function POST(req: Request) {
  const auth = await requirePermissionSession(req, 'LEAD_CREATE');
  if (!auth.ok) return auth.response;

  try {
    const raw = await req.json();
    const parsed = CreateManualLeadSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message || 'Dữ liệu tạo Lead không hợp lệ.',
        400,
        parsed.error.flatten(),
      );
    }

    const created = await createManualLead(auth.user, parsed.data);
    bumpDomainRevisions(['leads', 'reports', 'tracking', 'notifications'], 'create_manual_lead');
    return jsonSuccess({ id: created.id, leadCode: created.leadCode }, 201);
  } catch (err) {
    return jsonError(
      'LEAD_CREATE_FAILED',
      err instanceof Error ? err.message : 'Không thể tạo hồ sơ Lead mới.',
      400,
    );
  }
}

