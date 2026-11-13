import {
  type PrismaClient,
  upsertPlatformMetricIdempotent,
} from '@toantrung/database';
import type { SyncExecutionResultDto, SyncRunType } from '@toantrung/contracts/02-tracking-sync';
import {
  createGoogleAdsClient,
  type IGoogleAdsClient,
  type GoogleAdsSyncOptions,
  normalizeGoogleAdsCampaignRow,
  normalizeGoogleAdsKeywordRow,
  getVietnamTodayDateString,
} from '../providers/google-ads';

export interface ExecuteSyncParams {
  runType?: SyncRunType;
  startDate?: string;
  endDate?: string;
  forceMock?: boolean;
  simulateError?: GoogleAdsSyncOptions['simulateError'];
  clientOverride?: IGoogleAdsClient;
}

function calculateSyncWindow(runType: SyncRunType, explicitStart?: string, explicitEnd?: string): {
  startDate: string;
  endDate: string;
} {
  const todayVn = getVietnamTodayDateString();
  if (explicitStart && explicitEnd) {
    return { startDate: explicitStart, endDate: explicitEnd };
  }

  const today = new Date(`${todayVn}T00:00:00+07:00`);
  if (runType === 'full') {
    // 30 days window: T-30 to T-0
    const past30 = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    return {
      startDate: past30.toISOString().slice(0, 10),
      endDate: todayVn,
    };
  }

  // Light sync: T-1 to T-0 (yesterday and today)
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  return {
    startDate: yesterday.toISOString().slice(0, 10),
    endDate: todayVn,
  };
}

export class SyncOrchestratorService {
  constructor(private readonly prisma: PrismaClient) {}

  public async executeGoogleAdsSync(params: ExecuteSyncParams = {}): Promise<SyncExecutionResultDto> {
    const runType = params.runType || 'light';
    const { startDate, endDate } = calculateSyncWindow(runType, params.startDate, params.endDate);
    const client =
      params.clientOverride ||
      createGoogleAdsClient({ forceMock: params.forceMock });

    const accountPropertyId = client.accountPropertyId;
    const startTime = Date.now();
    const startedAt = new Date();

    // 1. Tìm lần chạy trước để lấy số lần lỗi liên tiếp (consecutiveFailures)
    const lastLog = await this.prisma.platformSyncLog.findFirst({
      where: {
        platform: 'google_ads',
        accountPropertyId,
      },
      orderBy: { startedAt: 'desc' },
    });
    const prevConsecutiveFailures = lastLog?.status === 'failed' ? lastLog.consecutiveFailures : 0;

    // 2. Tạo bản ghi SyncLog bắt đầu
    const syncLog = await this.prisma.platformSyncLog.create({
      data: {
        platform: 'google_ads',
        accountPropertyId,
        runType,
        windowStartDate: startDate,
        windowEndDate: endDate,
        status: 'running',
        consecutiveFailures: prevConsecutiveFailures,
        startedAt,
      },
    });

    try {
      // 3. Lấy dữ liệu qua Client (Mock hoặc Live)
      const syncOptions: GoogleAdsSyncOptions = {
        simulateError: params.simulateError,
        forceMock: params.forceMock,
      };

      const [campaignRows, keywordRows] = await Promise.all([
        client.fetchCampaignMetrics({ startDate, endDate }, syncOptions),
        client.fetchKeywordMetrics({ startDate, endDate }, syncOptions),
      ]);

      const todayVn = getVietnamTodayDateString();
      let recordsUpserted = 0;

      // 4. Đồng bộ danh mục Campaign nếu chưa có trong DB (để phục vụ liên kết khóa ngoại và đối soát)
      const distinctCampaigns = new Map<string, { id: string; name: string }>();
      for (const r of campaignRows) {
        if (!distinctCampaigns.has(r.campaignId)) {
          distinctCampaigns.set(r.campaignId, { id: r.campaignId, name: r.campaignName });
        }
      }

      for (const camp of distinctCampaigns.values()) {
        await this.prisma.campaign.upsert({
          where: {
            uq_campaign_platform_account_code: {
              platform: 'google_ads',
              accountExternalId: accountPropertyId,
              campaignCode: camp.id,
            },
          },
          update: {
            campaignName: camp.name,
            isActive: true,
          },
          create: {
            platform: 'google_ads',
            accountExternalId: accountPropertyId,
            campaignCode: camp.id,
            campaignName: camp.name,
            currencyCode: 'VND',
            isActive: true,
          },
        });
      }

      // Lấy map campaignId nội bộ để gắn vào metric
      const dbCampaigns = await this.prisma.campaign.findMany({
        where: {
          platform: 'google_ads',
          accountExternalId: accountPropertyId,
        },
      });
      const campaignCodeToIdMap = new Map(dbCampaigns.map((c) => [c.campaignCode, c.id]));

      // 5. Chuẩn hóa và Upsert Campaign metrics
      for (const row of campaignRows) {
        const normalized = normalizeGoogleAdsCampaignRow(row, accountPropertyId, todayVn);
        normalized.campaignId = campaignCodeToIdMap.get(row.campaignId) ?? null;
        await upsertPlatformMetricIdempotent(this.prisma, normalized);
        recordsUpserted++;
      }

      // 6. Chuẩn hóa và Upsert Keyword metrics
      for (const row of keywordRows) {
        const normalized = normalizeGoogleAdsKeywordRow(row, accountPropertyId, todayVn);
        normalized.campaignId = campaignCodeToIdMap.get(row.campaignId) ?? null;
        await upsertPlatformMetricIdempotent(this.prisma, normalized);
        recordsUpserted++;
      }

      // 7. Cập nhật SyncLog thành công
      const completedAt = new Date();
      const durationMs = Date.now() - startTime;

      await this.prisma.platformSyncLog.update({
        where: { id: syncLog.id },
        data: {
          status: 'success',
          recordsSynced: recordsUpserted,
          errorMessage: null,
          consecutiveFailures: 0,
          completedAt,
        },
      });

      return {
        logId: syncLog.id,
        platform: 'google_ads',
        accountPropertyId,
        runType,
        windowStartDate: startDate,
        windowEndDate: endDate,
        recordsSynced: recordsUpserted,
        status: 'success',
        errorMessage: null,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs,
      };
    } catch (err: unknown) {
      // 8. Xử lý lỗi và cập nhật SyncLog thất bại
      const completedAt = new Date();
      const durationMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);
      const newConsecutiveFailures = prevConsecutiveFailures + 1;

      await this.prisma.platformSyncLog.update({
        where: { id: syncLog.id },
        data: {
          status: 'failed',
          errorMessage,
          consecutiveFailures: newConsecutiveFailures,
          completedAt,
        },
      });

      // UC03 E2: Lỗi 3 lần liên tiếp -> gửi cảnh báo tới Quản trị viên
      if (newConsecutiveFailures >= 3) {
        try {
          const adminUser = await this.prisma.user.findFirst({
            where: { role: { roleCode: 'ADMIN' }, isActive: true },
            select: { id: true },
          });
          if (adminUser) {
            await this.prisma.notification.create({
              data: {
                userId: adminUser.id,
                title: 'Cảnh báo đồng bộ Google Ads (3 lần thất bại liên tiếp)',
                summary: `Đồng bộ Google Ads cho tài khoản ${accountPropertyId} đã thất bại ${newConsecutiveFailures} lần liên tiếp. Lỗi: ${errorMessage}`,
                category: 'Hệ thống',
                actionLabel: 'Kiểm tra đồng bộ',
                actionUrl: '/tracking',
              },
            });
          }
        } catch {
          // Bỏ qua nếu bảng thông báo không khả dụng
        }
      }

      return {
        logId: syncLog.id,
        platform: 'google_ads',
        accountPropertyId,
        runType,
        windowStartDate: startDate,
        windowEndDate: endDate,
        recordsSynced: 0,
        status: 'failed',
        errorMessage,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs,
      };
    }
  }
}
