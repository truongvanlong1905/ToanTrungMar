'use strict';

/**
 * T16 Load Benchmark Script for 10, 25, and 50 Concurrent Sessions
 * Tests against running ToanTrung CRM V2 production server (http://127.0.0.1:3000)
 * Read-only synthetic traffic + touchpoint writes cleaned up after test.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BASE_URL = process.env.BENCH_BASE_URL || 'http://127.0.0.1:3000';
const CONCURRENCY_LEVELS = [10, 25, 50];

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[idx].toFixed(1));
}

async function loginSession(email, password) {
  const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: email, password }),
  });
  if (!res.ok) {
    throw new Error(`Login failed HTTP ${res.status}`);
  }
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
  const cookieHeader = setCookies.map((c) => c.split(';')[0]).join('; ');
  return cookieHeader;
}

async function runSingleSessionWorkload(sessionIdx, cookieHeader, runTag) {
  const endpoints = [
    { name: 'health', url: `${BASE_URL}/api/v1/health`, method: 'GET', auth: false },
    { name: 'reports_overview', url: `${BASE_URL}/api/v1/reports?preset=30d&websiteId=all&compact=1`, method: 'GET', auth: true },
    { name: 'leads_list', url: `${BASE_URL}/api/v1/leads?page=1&pageSize=20`, method: 'GET', auth: true },
    { name: 'tracking_dashboard', url: `${BASE_URL}/api/v1/tracking?periodDays=30`, method: 'GET', auth: true },
    { name: 'leads_export', url: `${BASE_URL}/api/v1/leads/export?status=won`, method: 'GET', auth: true },
  ];

  const results = [];
  for (const ep of endpoints) {
    const start = performance.now();
    try {
      const resp = await fetch(ep.url, {
        method: ep.method,
        headers: ep.auth ? { Cookie: cookieHeader } : undefined,
      });
      await resp.arrayBuffer();
      const durationMs = performance.now() - start;
      results.push({
        endpoint: ep.name,
        status: resp.status,
        durationMs,
        is5xx: resp.status >= 500,
      });
    } catch {
      results.push({
        endpoint: ep.name,
        status: 0,
        durationMs: performance.now() - start,
        is5xx: true,
      });
    }
  }
  return results;
}

async function runLevel(concurrency, cookieHeader) {
  const runTag = `BENCH-${concurrency}-${Date.now()}`;
  const wallStart = performance.now();
  const batch = await Promise.all(
    Array.from({ length: concurrency }, (_, i) => runSingleSessionWorkload(i, cookieHeader, runTag))
  );
  const wallMs = Number((performance.now() - wallStart).toFixed(1));
  const flat = batch.flat();
  const durations = flat.map((r) => r.durationMs).sort((a, b) => a - b);
  const errors5xx = flat.filter((r) => r.is5xx).length;

  const byEndpoint = {};
  for (const r of flat) {
    if (!byEndpoint[r.endpoint]) byEndpoint[r.endpoint] = [];
    byEndpoint[r.endpoint].push(r.durationMs);
  }
  const perEndpointP95 = {};
  for (const [k, list] of Object.entries(byEndpoint)) {
    const sorted = [...list].sort((a, b) => a - b);
    perEndpointP95[k] = {
      p50Ms: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
    };
  }

  return {
    concurrency,
    totalRequests: flat.length,
    wallMs,
    rps: Number(((flat.length / Math.max(1, wallMs)) * 1000).toFixed(1)),
    errors5xx,
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    maxMs: durations.length > 0 ? Number(durations[durations.length - 1].toFixed(1)) : 0,
    perEndpointP95,
  };
}

async function main() {
  const email = process.env.BENCH_EMAIL || 'admin@toantrung.vn';
  const password = process.env.BENCH_PASSWORD || process.env.SEED_DEV_PASSWORD || 'ToanTrung@2026';
  const cookieHeader = await loginSession(email, password);

  // Warmup
  await runSingleSessionWorkload(0, cookieHeader, 'WARMUP');

  const levels = [];
  for (const c of CONCURRENCY_LEVELS) {
    levels.push(await runLevel(c, cookieHeader));
  }

  const report = {
    measuredAt: new Date().toISOString(),
    targetUrl: BASE_URL,
    hostHardware: {
      platform: `${os.platform()} ${os.release()} (${os.arch()})`,
      cpuModel: os.cpus()[0]?.model || 'unknown',
      cpuCores: os.cpus().length,
      totalRamGb: Number((os.totalmem() / (1024 ** 3)).toFixed(1)),
      freeRamGb: Number((os.freemem() / (1024 ** 3)).toFixed(1)),
      nodeVersion: process.version,
    },
    levels,
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error('[benchmark:load] FAILED:', err);
  process.exitCode = 1;
});
