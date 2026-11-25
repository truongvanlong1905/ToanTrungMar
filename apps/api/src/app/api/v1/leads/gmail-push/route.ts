import { checkRateLimit, getClientIp, jsonError, jsonSuccess, safeSecretEquals } from '../../../../../core/http';
import {
  getGmailPushCapabilities,
  getGmailLeadSyncConfig,
  syncLeadsFromGmail,
} from '../../../../../modules/01-leads/gmail-sync.service';

/**
 * Webhook endpoint cho Google Cloud Pub/Sub Gmail Push (`users.watch`).
 * Khi chưa có HTTPS công khai / GMAIL_PUBSUB_TOPIC, hệ thống dùng Poller backend kèm đối soát.
 */
export async function POST(req: Request) {
  const clientIp = getClientIp(req);
  if (!checkRateLimit(`gmail-push:${clientIp}`, 30, 60_000)) {
    return jsonError('RATE_LIMITED', 'Too many Gmail Push requests.', 429);
  }
  const configuredToken = process.env.GMAIL_PUSH_VERIFICATION_TOKEN?.trim();
  const url = new URL(req.url);
  const tokenParam = (url.searchParams.get('token') || req.headers.get('x-gmail-push-token') || '').trim();
  if (!configuredToken && process.env.NODE_ENV === 'production') {
    return jsonError('GMAIL_PUSH_TOKEN_NOT_CONFIGURED', 'Gmail Push verification token is not configured.', 503);
  }
  if (configuredToken && !safeSecretEquals(tokenParam, configuredToken)) {
    return jsonError('UNAUTHORIZED_GMAIL_PUSH', 'Invalid Gmail Push verification token.', 401);
  }

  const config = await getGmailLeadSyncConfig();
  const pushCap = getGmailPushCapabilities(config.pollIntervalSec);

  if (!config.enabled) {
    return jsonSuccess({
      accepted: false,
      reason: 'GMAIL_AUTO_SYNC_PAUSED',
      syncMode: pushCap.syncMode,
    });
  }

  const result = await syncLeadsFromGmail();
  return jsonSuccess({
    accepted: true,
    syncMode: pushCap.syncMode,
    summary: result.summary,
  });
}

