import { APP_CONFIG } from '../../../../../core/config';
import { getClientIp, jsonError, jsonSuccess, safeSecretEquals } from '../../../../../core/http';
import { logoutByToken, resolveSessionFromToken } from '../../../../../core/auth/service';
import { extractSessionTokenFromRequest } from '../../../../../core/permissions';

export async function POST(req: Request) {
  const token = extractSessionTokenFromRequest(req);
  const resolved = await resolveSessionFromToken(token);
  if (resolved) {
    const csrfHeader = req.headers.get(APP_CONFIG.csrfHeaderName);
    if (!safeSecretEquals(csrfHeader, resolved.user.csrfToken)) {
      return jsonError(
        'CSRF_INVALID',
        'Yêu cầu đăng xuất bị từ chối do thiếu hoặc sai mã bảo vệ phiên (CSRF).',
        403,
      );
    }
    await logoutByToken(token, getClientIp(req));
  }

  const isHttps =
    req.headers.get('x-forwarded-proto') === 'https' || req.url.startsWith('https://');
  const response = jsonSuccess({ loggedOut: true }, 200);
  response.cookies.set(APP_CONFIG.sessionCookieName, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps,
    path: '/',
    maxAge: 0,
  });

  return response;
}

