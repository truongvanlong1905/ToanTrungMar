import { jsonError, jsonSuccess } from '../../../../../core/http';
import { requirePermissionSession } from '../../../../../core/permissions';
import { getPersonalDashboardData } from '../_lib/personal-dashboard.service';

export async function GET(req: Request) {
  const auth = await requirePermissionSession(req, 'DASHBOARD_VIEW', {
    requireCsrf: false,
  });
  if (!auth.ok) return auth.response;

  try {
    const data = await getPersonalDashboardData(auth.user);
    return jsonSuccess(data);
  } catch (err) {
    return jsonError(
      'PERSONAL_DASHBOARD_FAILED',
      err instanceof Error ? err.message : 'Không thể tải dữ liệu cá nhân cho trang Tổng quan.',
      500,
    );
  }
}
