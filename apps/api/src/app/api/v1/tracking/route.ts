import {
  DeclareExternalCampaignSchema,
  ResolveReconciliationSchema,
  TriggerPlatformSyncSchema,
  WebhookLeadIntakeSchema,
  hasBaPermission,
} from '@toantrung/contracts';
import { jsonError, jsonSuccess } from '../../../../core/http';
import {
  requireAuthenticatedSession,
  requirePermissionSession,
} from '../../../../core/permissions';
import { bumpDomainRevisions } from '../../../../core/cache/server-data-cache';
import {
  declareExternalCampaignAndRemapUtm,
  getTrackingDashboardData,
  ingestWebhookLeadWithErrorProtection,
  resolveLeadReconciliationAlert,
  triggerPlatformSyncExecution,
} from '../../../../modules/02-tracking-sync/service';
import { getM02TrafficInteractionSpec } from '../../../../modules/02-tracking-sync/m02-spec.service';
import {
  executeWorkerJobByCode,
  getAdapterReadinessMatrix,
  getWorkerJobsHistory,
  type WorkerJobCode,
} from '../../../../workers';

export async function GET(req: Request) {
  const auth = await requireAuthenticatedSession(req, { requireCsrf: false });
  if (!auth.ok) return auth.response;
  if (
    !hasBaPermission(auth.user.roleCode, 'TRACKING_ADS_OPTIMIZE') &&
    auth.user.roleCode !== 'BOD'
  ) {
    return jsonError(
      'FORBIDDEN_PERMISSION',
      `Vai trò ${auth.user.roleName} không có quyền xem dữ liệu Tracking & Đồng bộ.`,
      403,
    );
  }

  try {
    const url = new URL(req.url);
    const view = url.searchParams.get('view');
    const websiteId = url.searchParams.get('websiteId');
    const preset = url.searchParams.get('preset') || undefined;
    const from = url.searchParams.get('from') || undefined;
    const to = url.searchParams.get('to') || undefined;
    const page = Number(url.searchParams.get('page') || 1);
    const pageSize = Number(url.searchParams.get('pageSize') || 20);

    if (view === 'spec') {
      const adsPage = Number(url.searchParams.get('adsPage') || 1);
      const adsPageSize = Number(url.searchParams.get('adsPageSize') || 20);
      const rawAdsScope = url.searchParams.get('adsScope');
      const adsScope =
        rawAdsScope === 'all' ? 'all' : rawAdsScope === 'website' ? 'website' : undefined;
      const compare = url.searchParams.get('compare') === '1';
      const m02 = await getM02TrafficInteractionSpec({
        websiteId,
        preset,
        from,
        to,
        page,
        pageSize,
        adsPage,
        adsPageSize,
        adsScope,
        compare,
      });
      return jsonSuccess(m02);
    }

    const periodDays = Number(url.searchParams.get('periodDays') || 30);
    const [data, workerHistory] = await Promise.all([
      getTrackingDashboardData(
        Number.isFinite(periodDays) && periodDays > 0 ? periodDays : 30,
        preset || from || to ? { preset, from, to } : undefined,
      ),
      getWorkerJobsHistory(12),
    ]);
    return jsonSuccess({
      ...data,
      adapterMatrix: getAdapterReadinessMatrix(),
      workerHistory,
    });
  } catch (err) {
    return jsonError(
      'TRACKING_DASHBOARD_FAILED',
      err instanceof Error ? err.message : 'Không thể tải dữ liệu Tracking & Đồng bộ.',
      500,
    );
  }
}

export async function POST(req: Request) {
  const auth = await requirePermissionSession(req, 'TRACKING_ADS_OPTIMIZE');
  if (!auth.ok) return auth.response;

  try {
    const raw = (await req.json()) as Record<string, unknown>;
    const action = String(raw.action || 'trigger_sync');

    if (action === 'declare_campaign') {
      const parsed = DeclareExternalCampaignSchema.safeParse(raw);
      if (!parsed.success) {
        return jsonError(
          'VALIDATION_ERROR',
          parsed.error.issues[0]?.message || 'Thông tin khai báo chiến dịch không hợp lệ.',
          400,
        );
      }
      const res = await declareExternalCampaignAndRemapUtm(parsed.data);
      bumpDomainRevisions(['tracking', 'ads', 'reports', 'leads'], 'declare_campaign');
      return jsonSuccess(
        {
          campaignId: res.campaign.id,
          remappedCount: res.remappedCount,
        },
        201,
      );
    }

    if (action === 'resolve_reconciliation') {
      const parsed = ResolveReconciliationSchema.safeParse(raw);
      if (!parsed.success) {
        return jsonError(
          'VALIDATION_ERROR',
          parsed.error.issues[0]?.message || 'Vui lòng nhập ghi chú xử lý đối soát.',
          400,
        );
      }
      const res = await resolveLeadReconciliationAlert(auth.user, parsed.data);
      bumpDomainRevisions(['tracking', 'reports'], 'resolve_reconciliation');
      return jsonSuccess({ id: res.id, status: res.status });
    }

    if (action === 'run_worker_job') {
      const validCodes: WorkerJobCode[] = [
        'D3_SYNC_FULL',
        'GCLID_HOURLY_RETRY',
        'GOOGLE_LEAD_RECONCILE',
        'SEO_SCHEDULED_PUBLISH',
        'OVERDUE_QUOTE_REMINDER',
        'ALL_JOBS',
      ];
      const requestedCode = String(raw.jobCode || 'ALL_JOBS') as WorkerJobCode;
      const safeCode: WorkerJobCode = validCodes.includes(requestedCode)
        ? requestedCode
        : 'ALL_JOBS';
      const jobRes = await executeWorkerJobByCode(safeCode, auth.user.id);
      bumpDomainRevisions(['tracking', 'ads', 'reports', 'leads', 'notifications'], `worker_${safeCode}`);
      return jsonSuccess(jobRes);
    }

    if (action === 'simulate_webhook') {
      const parsed = WebhookLeadIntakeSchema.safeParse(raw);
      if (!parsed.success) {
        return jsonError(
          'VALIDATION_ERROR',
          parsed.error.issues[0]?.message || 'Payload Webhook không hợp lệ.',
          400,
        );
      }
      const res = await ingestWebhookLeadWithErrorProtection(parsed.data);
      if (!res.deduplicated) {
        bumpDomainRevisions(['leads', 'tracking', 'reports', 'notifications'], 'simulate_webhook');
      }
      return jsonSuccess(res, res.deduplicated ? 200 : 201);
    }

    const parsed = TriggerPlatformSyncSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError('VALIDATION_ERROR', 'Tham số đồng bộ không hợp lệ.', 400);
    }
    const res = await triggerPlatformSyncExecution(parsed.data);
    bumpDomainRevisions(['tracking', 'ads', 'reports', 'leads', 'websites'], 'manual_platform_sync');
    return jsonSuccess(res);
  } catch (err) {
    return jsonError(
      'TRACKING_ACTION_FAILED',
      err instanceof Error ? err.message : 'Thao tác Tracking/Đồng bộ thất bại.',
      400,
    );
  }
}

