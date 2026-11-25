import fs from 'node:fs';
import { NextResponse } from 'next/server';
import { prisma } from '@toantrung/database';
import { APP_CONFIG } from '../../../../core/config';
import { logServerEvent, summarizeError } from '../../../../core/logging/logger';

export const dynamic = 'force-dynamic';

export async function GET() {
  const startedAt = Date.now();
  let dbStatus: 'ok' | 'error' = 'ok';
  let dbLatencyMs: number | null = null;
  let storageStatus: 'ok' | 'error' = 'ok';

  try {
    const t0 = Date.now();
    await prisma.$queryRawUnsafe('SELECT 1');
    dbLatencyMs = Math.max(1, Date.now() - t0);
  } catch (err) {
    dbStatus = 'error';
    logServerEvent('error', 'health', 'Database health check failed', summarizeError(err));
  }

  try {
    const storageRoot = APP_CONFIG.getStorageRoot();
    fs.mkdirSync(storageRoot, { recursive: true });
    fs.accessSync(storageRoot, fs.constants.R_OK | fs.constants.W_OK);
  } catch (err) {
    storageStatus = 'error';
    logServerEvent('error', 'health', 'Storage root health check failed', summarizeError(err));
  }

  const healthy = dbStatus === 'ok' && storageStatus === 'ok';

  return NextResponse.json(
    {
      ok: healthy,
      status: healthy ? 'healthy' : 'degraded',
      checks: {
        database: dbStatus,
        storage: storageStatus,
      },
      dbLatencyMs,
      checkDurationMs: Math.max(1, Date.now() - startedAt),
      uptimeSec: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    },
    {
      status: healthy ? 200 : 503,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}
