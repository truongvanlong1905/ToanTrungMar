import { jsonError, jsonSuccess } from '../../../../../core/http';
import { listDispatchedExecutiveReports } from '../../../../../core/notifications/service';
import { requirePermissionSession } from '../../../../../core/permissions';
import { getScopedReportsDashboard } from '../_lib/dashboard-overview.service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requirePermissionSession(request, 'DASHBOARD_VIEW', { requireCsrf: false });
  if (!auth.ok) return auth.response;

  try {
    const url = new URL(request.url);
    const preset = url.searchParams.get('preset') ?? '30d';
    const websiteId = url.searchParams.get('websiteId') ?? 'all';
    const fromDate = url.searchParams.get('from') ?? url.searchParams.get('fromDate') ?? undefined;
    const toDate = url.searchParams.get('to') ?? url.searchParams.get('toDate') ?? undefined;
    const compact = url.searchParams.get('compact') === '1';

    const [data, dispatchedReports] = await Promise.all([
      getScopedReportsDashboard(
        auth.user,
        { websiteId, preset, fromDate, toDate },
        { compact },
      ),
      compact
        ? Promise.resolve([])
        : listDispatchedExecutiveReports(25, auth.user.id, auth.user.roleCode),
    ]);
    return jsonSuccess({
      ...data,
      dispatchedReports,
    });
  } catch (err) {
    return jsonError(
      'DASHBOARD_OVERVIEW_FAILED',
      err instanceof Error ? err.message : 'Không thể tải dữ liệu tổng quan hệ thống.',
      500,
    );
  }
}
