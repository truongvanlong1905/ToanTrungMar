import { z } from 'zod';
import { METRIC_PLATFORMS } from './metrics.dto';

export const SYNC_RUN_TYPES = ['full', 'light', 'replay'] as const;
export type SyncRunType = (typeof SYNC_RUN_TYPES)[number];

export const SYNC_STATUSES = ['running', 'success', 'failed'] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

export const TriggerSyncRequestSchema = z.object({
  platform: z.enum(METRIC_PLATFORMS).default('google_ads'),
  accountPropertyId: z.string().trim().optional(),
  runType: z.enum(SYNC_RUN_TYPES).default('light'),
  startDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Định dạng ngày bắt đầu phải là YYYY-MM-DD.')
    .optional(),
  endDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Định dạng ngày kết thúc phải là YYYY-MM-DD.')
    .optional(),
  forceMock: z.boolean().optional(),
});

export type TriggerSyncRequestDto = z.infer<typeof TriggerSyncRequestSchema>;

export interface PlatformSyncLogDto {
  id: number;
  platform: string;
  accountPropertyId: string;
  runType: SyncRunType;
  windowStartDate: string | null;
  windowEndDate: string | null;
  recordsSynced: number;
  status: SyncStatus;
  errorMessage: string | null;
  consecutiveFailures: number;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
}

export const GetSyncLogsQuerySchema = z.object({
  platform: z.enum(METRIC_PLATFORMS).optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type GetSyncLogsQueryDto = z.infer<typeof GetSyncLogsQuerySchema>;

export interface SyncExecutionResultDto {
  logId: number;
  platform: string;
  accountPropertyId: string;
  runType: SyncRunType;
  windowStartDate: string;
  windowEndDate: string;
  recordsSynced: number;
  status: SyncStatus;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

export interface LiveCampaignItemDto {
  id: string;
  name: string;
  status: string;
  dailyBudgetMicros: string;
  dailyBudgetVnd: number;
  costMicros: string;
  costVnd: number;
  clicks: number;
  impressions: number;
  conversions: number;
  currencyCode: string;
}

export interface GoogleAdsConnectionInfoDto {
  provider: 'live' | 'mock';
  targetCustomerId: string;
  loginCustomerId?: string;
  accountPropertyId: string;
  apiVersion: string;
  isConnected: boolean;
  status: 'CONNECTED' | 'CUSTOMER_NOT_ENABLED' | 'TEST_ACCOUNT_REQUIRED' | 'AUTH_ERROR' | 'CONFIG_MISSING' | 'API_ERROR' | 'MOCK_ONLY';
  statusLabel: string;
  message: string;
  accessibleCustomers?: string[];
  liveCampaigns?: LiveCampaignItemDto[];
  checkedAt: string;
}

export interface GetSyncLogsResponseDto {
  logs: PlatformSyncLogDto[];
  count: number;
  connection?: GoogleAdsConnectionInfoDto;
}

