import { prisma } from '@toantrung/database';
import { GetPlatformDailyMetricsQuerySchema } from '@toantrung/contracts/02-tracking-sync';
import { jsonError, jsonSuccess } from '@api/core/http';
import { requirePermissionSession } from '@api/core/permissions';
import { MetricsQueryService } from '@api/modules/02-tracking-sync/services/metrics-query.service';

export async function GET(req: Request) {
  const auth = await requirePermissionSession(req, 'DASHBOARD_VIEW', { requireCsrf: false });
  if (!auth.ok) return auth.response;

  try {
    const url = new URL(req.url);
    const params = Object.fromEntries(url.searchParams.entries());
    const parsedQuery = GetPlatformDailyMetricsQuerySchema.safeParse(params);

    if (!parsedQuery.success) {
      return jsonError(
        'INVALID_QUERY_PARAMS',
        'Tham số truy vấn số liệu không hợp lệ.',
        400,
        parsedQuery.error.format(),
      );
    }

    const queryService = new MetricsQueryService(prisma);
    const summary = await queryService.getMetricsSummary(parsedQuery.data);

    return jsonSuccess(summary);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonError('METRICS_QUERY_FAILED', `Lỗi truy vấn số liệu: ${msg}`, 500);
  }
}
