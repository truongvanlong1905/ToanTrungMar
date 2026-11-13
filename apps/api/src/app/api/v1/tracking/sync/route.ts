import { prisma } from '@toantrung/database';
import {
  GetSyncLogsQuerySchema,
  TriggerSyncRequestSchema,
} from '@toantrung/contracts/02-tracking-sync';
import { jsonError, jsonSuccess } from '@api/core/http';
import { requirePermissionSession } from '@api/core/permissions';
import { runTrackingSyncWorker } from '@api/modules/02-tracking-sync/workers/tracking-sync.worker';
import { checkGoogleAdsConnectionStatus } from '@api/modules/02-tracking-sync/providers/google-ads';

export async function GET(req: Request) {
  const auth = await requirePermissionSession(req, 'TRACKING_ADS_OPTIMIZE', { requireCsrf: false });
  if (!auth.ok) return auth.response;

  try {
    const url = new URL(req.url);
    const params = Object.fromEntries(url.searchParams.entries());
    const parsedQuery = GetSyncLogsQuerySchema.safeParse(params);

    if (!parsedQuery.success) {
      return jsonError('INVALID_QUERY', 'Tham số truy vấn logs không hợp lệ.', 400, parsedQuery.error.format());
    }

    const where: Record<string, unknown> = {};
    if (parsedQuery.data.platform) {
      where.platform = parsedQuery.data.platform;
    }

    const [logs, connectionInfo] = await Promise.all([
      prisma.platformSyncLog.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        take: parsedQuery.data.limit,
        skip: parsedQuery.data.offset,
      }),
      checkGoogleAdsConnectionStatus().catch(() => undefined),
    ]);

    // Tự động đồng bộ các chiến dịch mới phát hiện từ Google Ads API vào database
    if (connectionInfo?.isConnected && connectionInfo.liveCampaigns && connectionInfo.liveCampaigns.length > 0) {
      const today = new Date().toISOString().slice(0, 10);
      for (const camp of connectionInfo.liveCampaigns) {
        try {
          const budgetMicros = BigInt(camp.dailyBudgetMicros || '0');
          const costMicros = BigInt(camp.costMicros || '0');
          const dbCamp = await prisma.campaign.upsert({
            where: {
              uq_campaign_platform_account_code: {
                platform: 'google_ads',
                accountExternalId: connectionInfo.accountPropertyId,
                campaignCode: camp.id,
              },
            },
            update: {
              campaignName: camp.name,
              dailyBudgetMicros: budgetMicros,
              isActive: camp.status === 'ENABLED',
            },
            create: {
              platform: 'google_ads',
              accountExternalId: connectionInfo.accountPropertyId,
              campaignCode: camp.id,
              campaignName: camp.name,
              currencyCode: camp.currencyCode || 'VND',
              dailyBudgetMicros: budgetMicros,
              isActive: camp.status === 'ENABLED',
            },
          });

          const fingerprint = `google_ads|${connectionInfo.accountPropertyId}|campaign|${camp.id}|${today}`;
          await prisma.platformDailyMetric.upsert({
            where: {
              uq_platform_metric_scope: {
                platform: 'google_ads',
                accountPropertyId: connectionInfo.accountPropertyId,
                metricDate: today,
                grain: 'campaign',
                campaignExternalId: camp.id,
                keywordMatchType: '',
                keywordTextNorm: '',
                pagePathNorm: '',
              },
            },
            update: {
              spendMicros: costMicros,
              dailyBudgetMicros: budgetMicros,
              impressions: camp.impressions,
              clicks: camp.clicks,
              conversionsMicros: BigInt(Math.round(camp.conversions * 1_000_000)),
              isFinalized: true,
              syncedAt: new Date(),
              campaign: { connect: { id: dbCamp.id } },
            },
            create: {
              platform: 'google_ads',
              accountPropertyId: connectionInfo.accountPropertyId,
              metricDate: today,
              grain: 'campaign',
              campaignExternalId: camp.id,
              campaignName: camp.name,
              keywordMatchType: '',
              keywordTextNorm: '',
              pagePathNorm: '',
              currencyCode: camp.currencyCode || 'VND',
              spendMicros: costMicros,
              dailyBudgetMicros: budgetMicros,
              impressions: camp.impressions,
              clicks: camp.clicks,
              conversionsMicros: BigInt(Math.round(camp.conversions * 1_000_000)),
              dimensionFingerprint: fingerprint,
              isFinalized: true,
              syncedAt: new Date(),
              campaign: { connect: { id: dbCamp.id } },
            },
          });
        } catch {
          // Bỏ qua lỗi lẻ khi upsert để không làm gián đoạn API
        }
      }
    }

    const formatted = logs.map((l) => ({
      id: l.id,
      platform: l.platform,
      accountPropertyId: l.accountPropertyId,
      runType: l.runType,
      windowStartDate: l.windowStartDate,
      windowEndDate: l.windowEndDate,
      recordsSynced: l.recordsSynced,
      status: l.status,
      errorMessage: l.errorMessage,
      consecutiveFailures: l.consecutiveFailures,
      startedAt: l.startedAt.toISOString(),
      completedAt: l.completedAt ? l.completedAt.toISOString() : null,
      durationMs: l.completedAt ? l.completedAt.getTime() - l.startedAt.getTime() : null,
    }));

    return jsonSuccess({
      logs: formatted,
      count: formatted.length,
      connection: connectionInfo,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonError('SYNC_LOGS_QUERY_FAILED', `Lỗi truy vấn lịch sử đồng bộ: ${msg}`, 500);
  }
}

export async function POST(req: Request) {
  const auth = await requirePermissionSession(req, 'TRACKING_ADS_OPTIMIZE');
  if (!auth.ok) return auth.response;

  try {
    const rawBody = await req.json().catch(() => ({}));
    const parsedBody = TriggerSyncRequestSchema.safeParse(rawBody);

    if (!parsedBody.success) {
      return jsonError('INVALID_SYNC_REQUEST', 'Yêu cầu đồng bộ không hợp lệ.', 400, parsedBody.error.format());
    }

    const { runType, startDate, endDate, forceMock } = parsedBody.data;
    // Mặc định chạy LIVE kết nối trực tiếp tài khoản Google Ads thật, không ép mock
    const result = await runTrackingSyncWorker(prisma, runType, {
      startDate,
      endDate,
      forceMock: forceMock ?? false,
    });

    if (result.status === 'failed') {
      return jsonError(
        'GOOGLE_ADS_SYNC_FAILED',
        result.errorMessage || 'Tiến trình đồng bộ Google Ads thất bại.',
        502,
        result,
      );
    }

    return jsonSuccess(result, 200);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonError('SYNC_EXECUTION_FAILED', `Lỗi thực thi đồng bộ: ${msg}`, 500);
  }
}
