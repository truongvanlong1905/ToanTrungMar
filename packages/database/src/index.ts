import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

function toSqliteFileUrl(filePath: string): string {
  const norm = filePath.replace(/\\/g, '/');
  return norm.startsWith('/') ? `file://${norm}` : `file:${norm}`;
}

function resolveIndependentSqliteUrl(): string {
  const cwd = process.cwd();
  const candidates = [
    path.resolve(cwd, 'packages', 'database', 'prisma', 'independent_v2.db'),
    path.resolve(cwd, '..', '..', 'packages', 'database', 'prisma', 'independent_v2.db'),
    path.resolve(cwd, 'prisma', 'independent_v2.db'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return toSqliteFileUrl(candidate);
    }
  }
  for (const candidate of candidates) {
    const parent = path.dirname(candidate);
    if (fs.existsSync(parent)) {
      return toSqliteFileUrl(candidate);
    }
  }
  return toSqliteFileUrl(candidates[0]);
}

const explicitPostgresUrl =
  process.env.USE_POSTGRES_TRIAL === '1' && process.env.PG_DATABASE_URL
    ? process.env.PG_DATABASE_URL
    : process.env.DATABASE_URL && /^postgres(ql)?:\/\//i.test(process.env.DATABASE_URL)
      ? process.env.DATABASE_URL
      : null;

const resolvedDbUrl =
  explicitPostgresUrl ??
  (process.env.DATABASE_URL &&
  process.env.DATABASE_URL !== 'file:./independent_v2.db' &&
  process.env.DATABASE_URL !== 'file:./dev.db'
    ? process.env.DATABASE_URL
    : resolveIndependentSqliteUrl());

if (explicitPostgresUrl) {
  process.env.PG_DATABASE_URL = explicitPostgresUrl;
  process.env.DATABASE_PROVIDER = 'postgresql';
} else {
  process.env.DATABASE_URL = resolvedDbUrl;
  process.env.DATABASE_PROVIDER = 'sqlite';
}

function createActivePrismaClient(): PrismaClient {
  if (explicitPostgresUrl) {
    const cwd = process.cwd();
    const pgCandidates = [
      path.resolve(cwd, 'packages', 'database', 'generated', 'postgres-client'),
      path.resolve(cwd, '..', '..', 'packages', 'database', 'generated', 'postgres-client'),
      path.resolve(__dirname, '..', 'generated', 'postgres-client'),
    ];
    for (const candidate of pgCandidates) {
      if (fs.existsSync(candidate)) {
        const dynamicRequire = eval('require') as NodeRequire;
        const { PrismaClient: PgPrismaClient } = dynamicRequire(candidate);
        return new PgPrismaClient({
          datasources: {
            db: {
              url: explicitPostgresUrl,
            },
          },
          log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
        }) as PrismaClient;
      }
    }
    throw new Error('Không tìm thấy generated/postgres-client cho cấu hình PostgreSQL.');
  }

  return new PrismaClient({
    datasources: {
      db: {
        url: resolvedDbUrl,
      },
    },
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  sqliteOptimizedInitPromise?: Promise<void>;
};

const SQLITE_HOT_INDEX_SQL: string[] = [
  'CREATE INDEX IF NOT EXISTS "leads_is_spam_spam_ads_exclusion_status_idx" ON "leads"("is_spam", "spam_ads_exclusion_status")',
  'CREATE INDEX IF NOT EXISTS "leads_is_spam_created_at_id_idx" ON "leads"("is_spam", "created_at", "id")',
  'CREATE INDEX IF NOT EXISTS "leads_assigned_sales_id_created_at_idx" ON "leads"("assigned_sales_id", "created_at")',
  'CREATE INDEX IF NOT EXISTS "leads_created_by_user_id_idx" ON "leads"("created_by_user_id")',
  'CREATE INDEX IF NOT EXISTS "leads_source_website_created_at_idx" ON "leads"("source_website", "created_at")',
  'CREATE INDEX IF NOT EXISTS "leads_received_at_is_spam_idx" ON "leads"("received_at", "is_spam")',
  'CREATE INDEX IF NOT EXISTS "leads_first_quote_sent_at_is_spam_idx" ON "leads"("first_quote_sent_at", "is_spam")',
  'CREATE INDEX IF NOT EXISTS "leads_pipeline_status_is_spam_closed_at_idx" ON "leads"("pipeline_status", "is_spam", "closed_at")',
  'CREATE INDEX IF NOT EXISTS "leads_pipeline_status_is_spam_quote_responded_first_quote_idx" ON "leads"("pipeline_status", "is_spam", "quote_responded_at", "first_quote_sent_at")',
  'CREATE INDEX IF NOT EXISTS "leads_contact_channel_created_at_idx" ON "leads"("contact_channel", "created_at")',
  'CREATE INDEX IF NOT EXISTS "lead_activities_action_type_created_at_idx" ON "lead_activities"("action_type", "created_at")',
  'CREATE INDEX IF NOT EXISTS "lead_activities_lead_id_action_type_idx" ON "lead_activities"("lead_id", "action_type")',
  'CREATE INDEX IF NOT EXISTS "marketing_tracking_is_unknown_campaign_tracked_at_idx" ON "marketing_tracking"("is_unknown_campaign", "tracked_at")',
  'CREATE INDEX IF NOT EXISTS "marketing_tracking_external_submission_id_idx" ON "marketing_tracking"("external_submission_id")',
  'CREATE INDEX IF NOT EXISTS "marketing_tracking_intake_source_provider_idx" ON "marketing_tracking"("intake_source_provider")',
  'CREATE INDEX IF NOT EXISTS "platform_daily_metrics_platform_grain_metric_date_idx" ON "platform_daily_metrics"("platform", "grain", "metric_date")',
  'CREATE INDEX IF NOT EXISTS "platform_daily_metrics_platform_grain_acct_date_idx" ON "platform_daily_metrics"("platform", "grain", "account_property_id", "metric_date")',
  'CREATE INDEX IF NOT EXISTS "platform_daily_metrics_campaign_id_grain_idx" ON "platform_daily_metrics"("campaign_id", "grain")',
  'CREATE INDEX IF NOT EXISTS "platform_daily_metrics_platform_acct_grain_clicks_idx" ON "platform_daily_metrics"("platform", "account_property_id", "grain", "clicks")',
  'CREATE INDEX IF NOT EXISTS "platform_sync_logs_started_at_idx" ON "platform_sync_logs"("started_at")',
  'CREATE INDEX IF NOT EXISTS "platform_sync_logs_status_completed_at_idx" ON "platform_sync_logs"("status", "completed_at")',
  'CREATE INDEX IF NOT EXISTS "platform_sync_logs_platform_started_at_idx" ON "platform_sync_logs"("platform", "started_at")',
  'CREATE INDEX IF NOT EXISTS "platform_sync_logs_run_type_completed_at_idx" ON "platform_sync_logs"("run_type", "completed_at")',
  'CREATE INDEX IF NOT EXISTS "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at")',
  'CREATE INDEX IF NOT EXISTS "notifications_user_id_is_read_category_title_idx" ON "notifications"("user_id", "is_read", "category", "title")',
  'CREATE INDEX IF NOT EXISTS "audit_logs_target_type_created_at_idx" ON "audit_logs"("target_type", "created_at")',
  'CREATE INDEX IF NOT EXISTS "audit_logs_target_type_actor_created_at_idx" ON "audit_logs"("target_type", "actor_user_id", "created_at")',
  'CREATE INDEX IF NOT EXISTS "seo_articles_created_at_idx" ON "seo_articles"("created_at")',
  'CREATE INDEX IF NOT EXISTS "seo_articles_updated_at_idx" ON "seo_articles"("updated_at")',
  'CREATE INDEX IF NOT EXISTS "design_requests_created_at_idx" ON "design_requests"("created_at")',
  'CREATE INDEX IF NOT EXISTS "design_requests_assigned_designer_id_idx" ON "design_requests"("assigned_designer_id")',
  'CREATE INDEX IF NOT EXISTS "design_requests_requested_by_sales_id_idx" ON "design_requests"("requested_by_sales_id")',
  'CREATE TABLE IF NOT EXISTS "tracking_touchpoints" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "event_id" TEXT NOT NULL, "event_type" TEXT NOT NULL, "source_website" TEXT NOT NULL, "page_url" TEXT, "lead_code" TEXT, "submission_id" TEXT, "visitor_id" TEXT, "occurred_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)',
  'CREATE UNIQUE INDEX IF NOT EXISTS "tracking_touchpoints_event_id_key" ON "tracking_touchpoints"("event_id")',
  'CREATE INDEX IF NOT EXISTS "tracking_touchpoints_source_website_occurred_at_idx" ON "tracking_touchpoints"("source_website", "occurred_at")',
  'CREATE INDEX IF NOT EXISTS "tracking_touchpoints_occurred_at_idx" ON "tracking_touchpoints"("occurred_at")',
  'CREATE INDEX IF NOT EXISTS "tracking_touchpoints_submission_id_idx" ON "tracking_touchpoints"("submission_id")',
];

export async function ensureSqlitePerformanceReady(client: PrismaClient): Promise<void> {
  if (explicitPostgresUrl || process.env.DATABASE_PROVIDER !== 'sqlite') return;
  if (globalForPrisma.sqliteOptimizedInitPromise) {
    return globalForPrisma.sqliteOptimizedInitPromise;
  }
  globalForPrisma.sqliteOptimizedInitPromise = (async () => {
    try {
      await client.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
      await client.$queryRawUnsafe('PRAGMA synchronous = NORMAL;');
      await client.$queryRawUnsafe('PRAGMA busy_timeout = 5000;');
      await client.$queryRawUnsafe('PRAGMA cache_size = -16000;');
      await client.$queryRawUnsafe('PRAGMA temp_store = MEMORY;');
      await client.$queryRawUnsafe('PRAGMA foreign_keys = ON;');
      for (const ddl of SQLITE_HOT_INDEX_SQL) {
        await client.$executeRawUnsafe(ddl);
      }
    } catch {
      // Non-fatal fallback on read-only or busy initialization
    }
  })();
  return globalForPrisma.sqliteOptimizedInitPromise;
}

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? createActivePrismaClient();

// Always reuse singleton across Next.js route chunks in both dev and production
globalForPrisma.prisma = prisma;

if (typeof window === 'undefined' && !explicitPostgresUrl) {
  void ensureSqlitePerformanceReady(prisma);
}

export * from '@prisma/client';
export * from './operations';
