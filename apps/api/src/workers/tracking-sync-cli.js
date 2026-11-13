'use strict';

/**
 * CLI Runner cho tiến trình đồng bộ số liệu nền tảng Module 2 (Google Ads).
 * Sử dụng cho cron hệ thống, Docker entrypoint hoặc kiểm tra thủ công ngoài web.
 *
 * Cách dùng:
 *   node apps/api/src/workers/tracking-sync-cli.js --type light --mock
 *   node apps/api/src/workers/tracking-sync-cli.js --type full --mock
 *   node apps/api/src/workers/tracking-sync-cli.js --type replay --start 2026-11-01 --end 2026-11-10
 */

const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

function resolveDbUrl() {
  const repoRoot = path.resolve(__dirname, '../../../..');
  const independentDbFile = path.join(repoRoot, 'packages/database/prisma/independent_v2.db').replace(/\\/g, '/');
  const devDbFile = path.join(repoRoot, 'packages/database/prisma/dev.db').replace(/\\/g, '/');
  const chosenDbFile =
    fs.existsSync(independentDbFile) && fs.statSync(independentDbFile).size > 0
      ? independentDbFile
      : fs.existsSync(devDbFile) && fs.statSync(devDbFile).size > 0
        ? devDbFile
        : independentDbFile;
  const defaultDbUrl = chosenDbFile.startsWith('/') ? `file://${chosenDbFile}` : `file:${chosenDbFile}`;
  return process.env.DATABASE_URL &&
    process.env.DATABASE_URL !== 'file:./dev.db' &&
    process.env.DATABASE_URL !== 'file:./independent_v2.db'
    ? process.env.DATABASE_URL
    : defaultDbUrl;
}

process.env.DATABASE_URL = resolveDbUrl();
const prisma = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_URL },
  },
});

async function main() {
  const args = process.argv.slice(2);
  let runType = 'light';
  let forceMock = false;
  let startDate = undefined;
  let endDate = undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--input' && args[i + 1]) {
      const inputFilePath = path.resolve(process.cwd(), args[++i]);
      if (fs.existsSync(inputFilePath)) {
        const parsed = JSON.parse(fs.readFileSync(inputFilePath, 'utf8'));
        const config = parsed.syncConfiguration || parsed;
        if (config.runType) runType = config.runType;
        if (config.provider === 'mock' || config.forceMock) forceMock = true;
        if (config.startDate) startDate = config.startDate;
        if (config.endDate) endDate = config.endDate;
        console.log(`[TrackingSyncCLI] Đã nạp cấu hình từ file input: ${inputFilePath}`);
      } else {
        console.warn(`[TrackingSyncCLI] Không tìm thấy file input tại: ${inputFilePath}`);
      }
    } else if (arg === '--type' && args[i + 1]) {
      runType = args[++i];
    } else if (arg === '--mock') {
      forceMock = true;
    } else if (arg === '--start' && args[i + 1]) {
      startDate = args[++i];
    } else if (arg === '--end' && args[i + 1]) {
      endDate = args[++i];
    }
  }

  const { runTrackingSyncWorker } = require('../modules/02-tracking-sync');

  console.log(`[TrackingSyncCLI] Bắt đầu đồng bộ số liệu Google Ads...`);
  console.log(`  RunType: ${runType}`);
  console.log(`  ForceMock: ${forceMock}`);
  if (startDate && endDate) {
    console.log(`  CustomWindow: ${startDate} -> ${endDate}`);
  }

  try {
    const result = await runTrackingSyncWorker(prisma, runType, {
      startDate,
      endDate,
      forceMock,
    });

    console.log(`[TrackingSyncCLI] Hoàn tất phiên đồng bộ #${result.logId}:`);
    console.log(`  Status: ${result.status}`);
    console.log(`  RecordsSynced: ${result.recordsSynced}`);
    console.log(`  Window: ${result.windowStartDate} -> ${result.windowEndDate}`);
    console.log(`  Duration: ${result.durationMs}ms`);

    if (result.status === 'failed') {
      console.error(`  ErrorMessage: ${result.errorMessage}`);
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`[TrackingSyncCLI] Lỗi thực thi không mong muốn:`, err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
