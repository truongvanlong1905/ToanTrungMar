import path from 'node:path';

const FORBIDDEN_DEFAULT_SECRETS = new Set([
  'toantrung-v2-production-default-secret-key-2026',
  'toantrung-v2-fallback-dev-secret',
  'toantrung-v2-fallback-dev-secret-2026',
  'tt-v2-google-oauth-state-hmac-2026',
  'independent-toantrung-v2-local-session-secret-key-2026-hmac-sha256',
]);

export const MIN_PRODUCTION_SECRET_LENGTH = 32;

export function getSessionSecret(env: NodeJS.ProcessEnv = process.env): string {
  const configured = (env.SESSION_SECRET || '').trim();
  const isProd = env.NODE_ENV === 'production';

  if (isProd) {
    if (!configured || configured.length < MIN_PRODUCTION_SECRET_LENGTH || FORBIDDEN_DEFAULT_SECRETS.has(configured)) {
      throw new Error(
        `MISSING_OR_WEAK_SESSION_SECRET: SESSION_SECRET must be set to a strong non-default secret (>= ${MIN_PRODUCTION_SECRET_LENGTH} chars) when NODE_ENV=production.`,
      );
    }
    return configured;
  }

  return configured || 'toantrung-v2-local-dev-ephemeral-secret';
}

export function validateRuntimeSecrets(env: NodeJS.ProcessEnv = process.env): {
  ok: true;
  environment: string;
  hasExplicitVaultKey: boolean;
  storageRoot: string;
} {
  const secret = getSessionSecret(env);
  void secret;
  return {
    ok: true,
    environment: env.NODE_ENV || 'development',
    hasExplicitVaultKey: Boolean((env.VAULT_MASTER_KEY || '').trim()),
    storageRoot: APP_CONFIG.getStorageRoot(),
  };
}

export const APP_CONFIG = {
  sessionCookieName: 'tt_v2_indep_session',
  csrfHeaderName: 'x-csrf-token',
  sessionTtlMs: 1000 * 60 * 60 * 12, // 12 hours
  maxLogoSizeBytes: 2 * 1024 * 1024, // 2 MB
  maxHeroSizeBytes: 5 * 1024 * 1024, // 5 MB
  maxAttachmentSizeBytes: 100 * 1024 * 1024, // 100 MB technical guard for CAD/PDF/Photos/Video/Archives
  defaultLogoUrl: '/brand/logo-toan-trung.png',
  defaultHeroUrl: '/brand/login-hero-led-building.jpg',
  getStorageRoot(): string {
    const rawEnv = (process.env.STORAGE_ROOT || '').trim();
    const raw =
      !rawEnv || rawEnv === './storage' || rawEnv === 'storage' || rawEnv === '.\\storage'
        ? './storage_independent_v2'
        : rawEnv;
    if (path.isAbsolute(raw)) return raw;
    const cwd = process.cwd();
    const repoRoot =
      cwd.endsWith(path.join('apps', 'web')) || cwd.endsWith(path.join('apps', 'api'))
        ? path.resolve(cwd, '../..')
        : cwd;
    return path.resolve(repoRoot, raw);
  },
  getBackupRoot(): string {
    const rawBackup = (process.env.BACKUP_ROOT || '').trim();
    if (rawBackup) {
      if (path.isAbsolute(rawBackup)) return rawBackup;
      const cwd = process.cwd();
      const repoRoot =
        cwd.endsWith(path.join('apps', 'web')) || cwd.endsWith(path.join('apps', 'api'))
          ? path.resolve(cwd, '../..')
          : cwd;
      return path.resolve(repoRoot, rawBackup);
    }
    return path.join(this.getStorageRoot(), 'backups');
  },
};
