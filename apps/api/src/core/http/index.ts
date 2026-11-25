import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import type { ApiErrorPayload, ApiSuccess } from '@toantrung/contracts';
import { logServerEvent } from '../logging/logger';

const globalRateStore = globalThis as unknown as {
  __toantrungRateBuckets?: Map<string, { count: number; resetAt: number }>;
  __toantrungRatePruneCounter?: number;
};

function getRateBuckets(): Map<string, { count: number; resetAt: number }> {
  if (!globalRateStore.__toantrungRateBuckets) {
    globalRateStore.__toantrungRateBuckets = new Map();
  }
  return globalRateStore.__toantrungRateBuckets;
}

const MAX_RATE_BUCKET_ENTRIES = 5_000;

export function safeSecretEquals(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function checkRateLimit(key: string, maxRequests = 20, windowMs = 60_000): boolean {
  const now = Date.now();
  const rateBuckets = getRateBuckets();
  const counter = (globalRateStore.__toantrungRatePruneCounter =
    (globalRateStore.__toantrungRatePruneCounter || 0) + 1);
  if ((counter % 100 === 0 && rateBuckets.size > 100) || rateBuckets.size >= MAX_RATE_BUCKET_ENTRIES) {
    for (const [k, v] of rateBuckets.entries()) {
      if (v.resetAt <= now) rateBuckets.delete(k);
    }
    while (rateBuckets.size >= MAX_RATE_BUCKET_ENTRIES) {
      const oldestKey = rateBuckets.keys().next().value;
      if (!oldestKey) break;
      rateBuckets.delete(oldestKey);
    }
  }
  const existing = rateBuckets.get(key);
  if (!existing || existing.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (existing.count >= maxRequests) {
    return false;
  }
  existing.count += 1;
  return true;
}

export function getClientIp(req: Request): string {
  const raw =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip')?.trim() ||
    '127.0.0.1';
  const cleaned = raw.replace(/[^\da-fA-F.:]/g, '').slice(0, 64);
  return cleaned || '127.0.0.1';
}

export function jsonSuccess<T, M = Record<string, unknown>>(
  data: T,
  status = 200,
  meta?: M,
  headers?: HeadersInit,
): NextResponse<ApiSuccess<T, M>> {
  return NextResponse.json(
    {
      ok: true as const,
      data,
      ...(meta !== undefined ? { meta } : {}),
    },
    {
      status,
      headers: {
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
        ...headers,
      },
    },
  );
}

export function jsonError(
  code: string,
  message: string,
  status = 400,
  details?: unknown,
): NextResponse<ApiErrorPayload> {
  const requestId = crypto.randomUUID();
  if (status >= 500) {
    logServerEvent('error', 'http', message, { requestId, code, status });
  }
  return NextResponse.json(
    {
      error: {
        code,
        message,
        requestId,
        ...(details !== undefined ? { details } : {}),
      },
    },
    {
      status,
      headers: {
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      },
    },
  );
}

