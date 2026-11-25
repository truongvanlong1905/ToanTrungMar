'use strict';

const crypto = require('node:crypto');
const { seedCatalogOnly } = require('./seed');

const FORBIDDEN_DEFAULT_PASSWORDS = new Set([
  'toantrung@2026',
  'admin123',
  '123456',
  'password',
]);

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function getPrismaClient() {
  const explicitPg =
    process.env.DATABASE_URL && /^postgres(ql)?:\/\//i.test(process.env.DATABASE_URL)
      ? process.env.DATABASE_URL
      : process.env.USE_POSTGRES_TRIAL === '1' && process.env.PG_DATABASE_URL
        ? process.env.PG_DATABASE_URL
        : null;

  if (explicitPg) {
    const { PrismaClient } = require('../generated/postgres-client');
    return new PrismaClient({ datasources: { db: { url: explicitPg } } });
  }

  const { PrismaClient } = require('@prisma/client');
  return new PrismaClient();
}

async function provisionAdminFromEnv(options = {}) {
  const email = (options.email ?? process.env.ADMIN_BOOTSTRAP_EMAIL ?? '').trim().toLowerCase();
  const password = (options.password ?? process.env.ADMIN_BOOTSTRAP_PASSWORD ?? '').trim();
  const fullName = (options.fullName ?? process.env.ADMIN_BOOTSTRAP_NAME ?? 'Quản trị viên Hệ thống').trim();

  if (!email || !email.includes('@')) {
    throw new Error('ADMIN_BOOTSTRAP_EMAIL is required and must be a valid email address.');
  }
  if (!password || password.length < 10) {
    throw new Error('ADMIN_BOOTSTRAP_PASSWORD is required and must be at least 10 characters.');
  }
  if (FORBIDDEN_DEFAULT_PASSWORDS.has(password.toLowerCase())) {
    throw new Error('ADMIN_BOOTSTRAP_PASSWORD must not use a known default/demo password.');
  }

  const prisma = options.client || getPrismaClient();
  const shouldDisconnect = !options.client;

  try {
    await seedCatalogOnly(prisma);

    const adminRole = await prisma.role.findUnique({ where: { roleCode: 'ADMIN' } });
    if (!adminRole) {
      throw new Error('ADMIN role missing after catalog seed.');
    }

    const passwordHash = hashPassword(password);
    const user = await prisma.user.upsert({
      where: { email },
      update: {
        fullName,
        roleId: adminRole.id,
        department: 'admin',
        passwordHash,
        isActive: true,
        deletedAt: null,
      },
      create: {
        email,
        fullName,
        roleId: adminRole.id,
        department: 'admin',
        passwordHash,
        isReceivingLeads: false,
        isOnline: true,
        isActive: true,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        action: 'ADMIN_PROVISIONED_CLI',
        targetType: 'User',
        targetId: String(user.id),
        detailsJson: JSON.stringify({ email: user.email, roleCode: 'ADMIN' }),
      },
    });

    return { ok: true, id: user.id, email: user.email, fullName: user.fullName };
  } finally {
    if (shouldDisconnect) {
      await prisma.$disconnect();
    }
  }
}

if (require.main === module) {
  provisionAdminFromEnv()
    .then((res) => {
      console.log(`[provision:admin] Provisioned Admin user #${res.id} (${res.email}).`);
    })
    .catch((err) => {
      console.error(`[provision:admin] ERROR: ${err.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  provisionAdminFromEnv,
};
