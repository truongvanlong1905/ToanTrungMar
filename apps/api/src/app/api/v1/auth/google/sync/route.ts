import { hasBaPermission } from '@toantrung/contracts';
import { jsonError, jsonSuccess } from '../../../../../../core/http';
import { requireAuthenticatedSession } from '../../../../../../core/permissions';
import {
  syncAllGoogleDataAcrossModules,
  getGoogleOAuthStatusDto,
  redactGoogleSecretsFromText,
} from '../../../../../../modules/02-tracking-sync/google-oauth.service';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const auth = await requireAuthenticatedSession(req, { requireCsrf: true });
    if (!auth.ok) return auth.response;

    const canSync =
      hasBaPermission(auth.user.roleCode, 'TRACKING_ADS_OPTIMIZE') ||
      hasBaPermission(auth.user.roleCode, 'AI_MARKETING_SEO') ||
      hasBaPermission(auth.user.roleCode, 'SYSTEM_USER_ADMIN');
    if (!canSync) {
      return jsonError(
        'FORBIDDEN',
        'Tài khoản không có quyền kích hoạt đồng bộ dữ liệu Google.',
        403,
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      slot?: 'FULL_0200' | 'LIGHT_1100' | 'LIGHT_1700' | 'MANUAL_RETRY';
    };

    const slot = body.slot || 'MANUAL_RETRY';
    const result = await syncAllGoogleDataAcrossModules(slot);
    const status = await getGoogleOAuthStatusDto();

    return jsonSuccess({
      message: `Đồng bộ toàn diện Google hoàn tất (${result.syncedRecords} bản ghi, giải quyết ${result.gclidResolved} gclid).`,
      result,
      status,
    });
  } catch (err) {
    return jsonError(
      'GOOGLE_SYNC_ERROR',
      redactGoogleSecretsFromText(
        err instanceof Error ? err.message : 'Không thể thực hiện đồng bộ dữ liệu Google.',
      ),
      500,
    );
  }
}
