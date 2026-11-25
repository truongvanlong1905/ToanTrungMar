'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const defaultDbFile = path.resolve(__dirname, '../prisma/independent_v2.db').replace(/\\/g, '/');
const defaultDbUrl = defaultDbFile.startsWith('/') ? `file://${defaultDbFile}` : `file:${defaultDbFile}`;

function resolveTargetDatabase() {
  const explicitPostgresUrl =
    process.env.DATABASE_URL && /^postgres(ql)?:\/\//i.test(process.env.DATABASE_URL)
      ? process.env.DATABASE_URL
      : process.env.USE_POSTGRES_TRIAL === '1' && process.env.PG_DATABASE_URL
        ? process.env.PG_DATABASE_URL
        : null;

  const targetDbUrl =
    explicitPostgresUrl ||
    (process.env.DATABASE_URL &&
    process.env.DATABASE_URL !== 'file:./independent_v2.db' &&
    process.env.DATABASE_URL !== 'file:./dev.db'
      ? process.env.DATABASE_URL
      : defaultDbUrl);

  return { explicitPostgresUrl, targetDbUrl };
}

function createMigratePrismaClient() {
  const { explicitPostgresUrl, targetDbUrl } = resolveTargetDatabase();
  process.env.DATABASE_URL = targetDbUrl;
  if (explicitPostgresUrl) {
    process.env.PG_DATABASE_URL = explicitPostgresUrl;
    const pgClientPath = path.resolve(__dirname, '../generated/postgres-client');
    const { PrismaClient: PgPrismaClient } = require(pgClientPath);
    return {
      isPostgres: true,
      prisma: new PgPrismaClient({
        datasources: { db: { url: explicitPostgresUrl } },
      }),
    };
  }
  const { PrismaClient } = require('@prisma/client');
  return {
    isPostgres: false,
    prisma: new PrismaClient({
      datasources: { db: { url: targetDbUrl } },
    }),
  };
}

function splitSqlStatements(sql) {
  const withoutComments = sql.replace(/^\s*--.*$/gm, '');
  return withoutComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function translateSqliteDdlToPostgres(sqlStatement) {
  let stmt = sqlStatement.trim();
  if (/^PRAGMA\b/i.test(stmt)) {
    return null;
  }
  stmt = stmt
    .replace(/\bINTEGER\s+NOT\s+NULL\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi, 'SERIAL PRIMARY KEY')
    .replace(/\bDATETIME\b/gi, 'TIMESTAMPTZ')
    .replace(/\bREAL\b/gi, 'DOUBLE PRECISION')
    .replace(/\bBLOB\b/gi, 'BYTEA');
  return stmt;
}

async function deployCoordinatedMigrations() {
  const { isPostgres, prisma } = createMigratePrismaClient();
  const migrationsRoot = isPostgres
    ? path.resolve(__dirname, '../prisma-postgres/migrations')
    : path.resolve(__dirname, '../prisma/migrations');

  try {
    if (isPostgres) {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
          "id"                  TEXT PRIMARY KEY NOT NULL,
          "checksum"            TEXT NOT NULL,
          "finished_at"         TIMESTAMPTZ,
          "migration_name"      TEXT NOT NULL,
          "logs"                TEXT,
          "rolled_back_at"      TIMESTAMPTZ,
          "started_at"          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "applied_steps_count" INTEGER NOT NULL DEFAULT 0
        );
      `);
    } else {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
          "id"                     TEXT PRIMARY KEY NOT NULL,
          "checksum"              TEXT NOT NULL,
          "finished_at"           DATETIME,
          "migration_name"        TEXT NOT NULL,
          "logs"                  TEXT,
          "rolled_back_at"        DATETIME,
          "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
          "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
        );
      `);
    }

    const appliedRows = await prisma.$queryRawUnsafe(
      `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
    );
    const appliedSet = new Set(appliedRows.map((r) => r.migration_name));

    const dirs = fs
      .readdirSync(migrationsRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();

    let appliedCount = 0;
    for (const dirName of dirs) {
      if (appliedSet.has(dirName)) {
        console.log(`[migrate:deploy] Đã áp dụng trước đó: ${dirName}`);
        continue;
      }

      const sqlPath = path.join(migrationsRoot, dirName, 'migration.sql');
      if (!fs.existsSync(sqlPath)) continue;

      const sqlContent = fs.readFileSync(sqlPath, 'utf8');
      const checksum = crypto.createHash('sha256').update(sqlContent).digest('hex');
      const statements = splitSqlStatements(sqlContent);

      console.log(
        `[migrate:deploy:${isPostgres ? 'postgresql' : 'sqlite'}] Đang áp dụng ${dirName} (${statements.length} câu lệnh DDL)...`,
      );
      for (const stmt of statements) {
        await prisma.$executeRawUnsafe(stmt);
      }

      if (isPostgres) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "applied_steps_count") VALUES ($1, $2, CURRENT_TIMESTAMP, $3, $4)`,
          crypto.randomUUID(),
          checksum,
          dirName,
          statements.length,
        );
      } else {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "applied_steps_count") VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?)`,
          crypto.randomUUID(),
          checksum,
          dirName,
          statements.length,
        );
      }
      appliedCount += 1;
    }

    console.log(
      `[migrate:deploy:${isPostgres ? 'postgresql' : 'sqlite'}] Hoàn tất lịch sử migration dùng chung (${appliedCount} migration mới được áp dụng).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  deployCoordinatedMigrations().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = { deployCoordinatedMigrations, translateSqliteDdlToPostgres };

