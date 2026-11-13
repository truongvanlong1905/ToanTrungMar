import type { PrismaClient } from '@toantrung/database';
import type { SyncExecutionResultDto } from '@toantrung/contracts/02-tracking-sync';
import { SyncOrchestratorService } from '../services/sync-orchestrator.service';

let isJobRunning = false;

export async function runTrackingSyncWorker(
  prisma: PrismaClient,
  type: 'full' | 'light' | 'replay',
  options: {
    startDate?: string;
    endDate?: string;
    forceMock?: boolean;
  } = {},
): Promise<SyncExecutionResultDto> {
  if (isJobRunning) {
    throw new Error('Một tiến trình đồng bộ số liệu đang chạy trong nền. Vui lòng đợi phiên hiện tại hoàn tất.');
  }

  isJobRunning = true;
  try {
    const orchestrator = new SyncOrchestratorService(prisma);
    return await orchestrator.executeGoogleAdsSync({
      runType: type,
      startDate: options.startDate,
      endDate: options.endDate,
      forceMock: options.forceMock,
    });
  } finally {
    isJobRunning = false;
  }
}

/**
 * Lần chạy đầy đủ lúc 02:00 (giờ VN) — Cửa sổ 30 ngày gần nhất
 */
export async function runFullSyncJob(
  prisma: PrismaClient,
  forceMock = false,
): Promise<SyncExecutionResultDto> {
  return runTrackingSyncWorker(prisma, 'full', { forceMock });
}

/**
 * Lần chạy nhẹ lúc 11:00 & 17:00 (giờ VN) — Cửa sổ hôm nay & hôm qua
 */
export async function runLightSyncJob(
  prisma: PrismaClient,
  forceMock = false,
): Promise<SyncExecutionResultDto> {
  return runTrackingSyncWorker(prisma, 'light', { forceMock });
}
