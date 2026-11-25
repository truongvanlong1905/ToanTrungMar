import { TrackingTouchpointSchema } from '@toantrung/contracts';
import { checkRateLimit, getClientIp, jsonError, jsonSuccess, safeSecretEquals } from '../../../../../core/http';
import { bumpDomainRevisions } from '../../../../../core/cache/server-data-cache';
import { recordTrackingTouchpoint } from '../../../../../modules/02-tracking-sync/service';

export async function POST(req: Request) {
  try {
    const clientIp = getClientIp(req);
    if (!checkRateLimit(`touchpoint:${clientIp}`, 120, 60_000)) {
      return jsonError('TOUCHPOINT_RATE_LIMITED', 'Vượt quá giới hạn tần suất ghi nhận điểm chạm.', 429);
    }

    const configuredSecret = process.env.WEBHOOK_SECRET?.trim();
    const providedSecret = req.headers.get('x-webhook-secret')?.trim();
    if (!configuredSecret && process.env.NODE_ENV === 'production') {
      return jsonError(
        'WEBHOOK_SECRET_NOT_CONFIGURED',
        'Máy chủ chưa cấu hình khóa bảo mật WEBHOOK_SECRET.',
        503,
      );
    }
    if (configuredSecret && !safeSecretEquals(providedSecret, configuredSecret)) {
      return jsonError(
        'TOUCHPOINT_UNAUTHORIZED',
        'Chữ ký hoặc mã bí mật Webhook (x-webhook-secret) không hợp lệ.',
        401,
      );
    }

    const raw = await req.json();
    const parsed = TrackingTouchpointSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(
        'TOUCHPOINT_SCHEMA_INVALID',
        parsed.error.issues[0]?.message || 'Dữ liệu điểm chạm không hợp lệ.',
        400,
      );
    }

    const res = await recordTrackingTouchpoint(parsed.data);
    if (!res.deduplicated) {
      bumpDomainRevisions(['tracking', 'reports'], 'touchpoint_recorded');
    }
    return jsonSuccess(res, res.deduplicated ? 200 : 201);
  } catch (err) {
    return jsonError(
      'TOUCHPOINT_RECORD_FAILED',
      err instanceof Error ? err.message : 'Không thể ghi nhận điểm chạm.',
      500,
    );
  }
}

