import { hasBaPermission } from '@toantrung/contracts';
import { jsonError, jsonSuccess } from '../../../../../../core/http';
import { requireAuthenticatedSession } from '../../../../../../core/permissions';
import {
  redactGoogleSecretsFromText,
  testGoogleConnection,
} from '../../../../../../modules/02-tracking-sync/google-oauth.service';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const auth = await requireAuthenticatedSession(req, { requireCsrf: true });
    if (!auth.ok) return auth.response;

    const canTest =
      hasBaPermission(auth.user.roleCode, 'TRACKING_ADS_OPTIMIZE') ||
      hasBaPermission(auth.user.roleCode, 'AI_MARKETING_SEO') ||
      hasBaPermission(auth.user.roleCode, 'SYSTEM_USER_ADMIN');
    if (!canTest) {
      return jsonError(
        'FORBIDDEN',
        'Tài khoản không có quyền kiểm tra kết nối Google API.',
        403,
      );
    }

    const result = await testGoogleConnection();
    return jsonSuccess({ result });
  } catch (err) {
    return jsonError(
      'GOOGLE_TEST_CONNECTION_ERROR',
      redactGoogleSecretsFromText(
        err instanceof Error ? err.message : 'Lỗi khi kiểm tra kết nối Google API.',
      ),
      500,
    );
  }
}

