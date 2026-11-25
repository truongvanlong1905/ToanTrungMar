import { NextResponse } from 'next/server';
import { jsonError, jsonSuccess } from '../../../../../../core/http';
import { requireAuthenticatedSession } from '../../../../../../core/permissions';
import {
  buildGoogleAuthorizeUrl,
  sanitizeOAuthReturnPath,
} from '../../../../../../modules/02-tracking-sync/google-oauth.service';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const auth = await requireAuthenticatedSession(req, { requireCsrf: false });
    if (!auth.ok) return auth.response;
    if (auth.user.roleCode !== 'ADMIN' && auth.user.roleCode !== 'MKT_LEAD') {
      return jsonError(
        'FORBIDDEN',
        'Chỉ Quản trị viên hoặc Trưởng phòng Marketing mới được cấp quyền kết nối Google OAuth.',
        403,
      );
    }

    const url = new URL(req.url);
    const returnPath = sanitizeOAuthReturnPath(url.searchParams.get('returnPath'));
    const redirectMode = url.searchParams.get('redirect') === 'true';
    const origin = url.origin;

    const result = await buildGoogleAuthorizeUrl(origin, returnPath);

    if (result.needsConfig || !result.authUrl) {
      if (redirectMode) {
        return NextResponse.redirect(
          new URL(`${returnPath}?google_auth=needs_config&msg=${encodeURIComponent(result.message || '')}`, origin),
        );
      }
      return jsonSuccess({
        needsConfig: true,
        authUrl: null,
        message: result.message,
      });
    }

    if (redirectMode) {
      return NextResponse.redirect(result.authUrl);
    }

    return jsonSuccess({
      needsConfig: false,
      authUrl: result.authUrl,
      message: null,
    });
  } catch (err) {
    return jsonError(
      'GOOGLE_AUTHORIZE_ERROR',
      err instanceof Error ? err.message : 'Không thể tạo đường dẫn xác thực Google.',
      500,
    );
  }
}
