import crypto from 'node:crypto';
import { prisma } from '@toantrung/database';

export interface DurableJobLeaseState {
  jobKey: string;
  ownerId: string;
  acquiredAt: string;
  expiresAt: string;
  status: 'running' | 'completed' | 'failed';
  checkpointNote?: string | null;
}

const LEASE_PREFIX = 'durable_job_lease:';

const globalForJobLeases = globalThis as unknown as {
  __toantrungDurableJobLeaseQueue?: Promise<unknown>;
};

function withLocalLeaseQueue<T>(fn: () => Promise<T>): Promise<T> {
  const prev = globalForJobLeases.__toantrungDurableJobLeaseQueue ?? Promise.resolve();
  const next = prev.then(fn, fn);
  globalForJobLeases.__toantrungDurableJobLeaseQueue = next.catch(() => undefined);
  return next;
}

export async function acquireDurableJobLease(params: {
  jobKey: string;
  ownerId?: string;
  leaseTtlMs?: number;
  checkpointNote?: string | null;
}): Promise<{
  acquired: boolean;
  ownerId: string;
  existingLease: DurableJobLeaseState | null;
}> {
  const ownerId =
    params.ownerId || `worker-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
  const leaseTtlMs = Math.max(5_000, params.leaseTtlMs ?? 60_000);
  const settingKey = `${LEASE_PREFIX}${params.jobKey}`;

  return withLocalLeaseQueue(async () => {
    const nowMs = Date.now();
    const row = await prisma.systemSetting.findUnique({ where: { key: settingKey } });

    if (row?.value) {
      try {
        const parsed = JSON.parse(row.value) as DurableJobLeaseState;
        const expMs = Date.parse(parsed.expiresAt || '');
        if (
          parsed.status === 'running' &&
          Number.isFinite(expMs) &&
          expMs > nowMs &&
          parsed.ownerId !== ownerId
        ) {
          return {
            acquired: false,
            ownerId,
            existingLease: parsed,
          };
        }
      } catch {
        // Recover from corrupt lease JSON
      }
    }

    const nextLease: DurableJobLeaseState = {
      jobKey: params.jobKey,
      ownerId,
      acquiredAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + leaseTtlMs).toISOString(),
      status: 'running',
      checkpointNote: params.checkpointNote ?? null,
    };

    await prisma.systemSetting.upsert({
      where: { key: settingKey },
      update: { value: JSON.stringify(nextLease) },
      create: { key: settingKey, value: JSON.stringify(nextLease) },
    });

    return {
      acquired: true,
      ownerId,
      existingLease: nextLease,
    };
  });
}

export async function releaseDurableJobLease(params: {
  jobKey: string;
  ownerId: string;
  status: 'completed' | 'failed';
  checkpointNote?: string | null;
}): Promise<void> {
  const settingKey = `${LEASE_PREFIX}${params.jobKey}`;
  await withLocalLeaseQueue(async () => {
    const row = await prisma.systemSetting.findUnique({ where: { key: settingKey } });
    let prev: Partial<DurableJobLeaseState> = {};
    if (row?.value) {
      try {
        prev = JSON.parse(row.value) as Partial<DurableJobLeaseState>;
        if (prev.ownerId && prev.ownerId !== params.ownerId && prev.status === 'running') {
          return;
        }
      } catch {
        // overwrite malformed lease
      }
    }
    const nextState: DurableJobLeaseState = {
      jobKey: params.jobKey,
      ownerId: params.ownerId,
      acquiredAt: prev.acquiredAt || new Date().toISOString(),
      expiresAt: new Date().toISOString(),
      status: params.status,
      checkpointNote: params.checkpointNote ?? null,
    };
    await prisma.systemSetting.upsert({
      where: { key: settingKey },
      update: { value: JSON.stringify(nextState) },
      create: { key: settingKey, value: JSON.stringify(nextState) },
    });
  });
}

export async function getDurableJobLeaseStatus(
  jobKey: string,
): Promise<DurableJobLeaseState | null> {
  const settingKey = `${LEASE_PREFIX}${jobKey}`;
  const row = await prisma.systemSetting.findUnique({ where: { key: settingKey } });
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value) as DurableJobLeaseState;
  } catch {
    return null;
  }
}
