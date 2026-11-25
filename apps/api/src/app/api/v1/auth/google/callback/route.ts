import { NextResponse } from 'next/server';
import { requireAuthenticatedSession } from '../../../../../../core/permissions';
import {
  handleGoogleOAuthCallback,
  redactGoogleSecretsFromText,
  verifySignedOAuthState,
} from '../../../../../../modules/02-tracking-sync/google-oauth.service';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const stateStr = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const origin = url.origin;

  const stateVerification = verifySignedOAuthState(stateStr);
  const returnPath = stateVerification.returnPath;

  const auth = await requireAuthenticatedSession(req, { requireCsrf: false });
  if (!auth.ok || (auth.user.roleCode !== 'ADMIN' && auth.user.roleCode !== 'MKT_LEAD')) {
    return NextResponse.redirect(
      new URL(
        `${returnPath}?google_auth=error&msg=${encodeURIComponent('Chỉ Quản trị viên hoặc Trưởng phòng Marketing đang đăng nhập mới được phép hoàn tất kết nối Google OAuth.')}`,
        origin,
      ),
    );
  }

  if (!stateVerification.valid) {
    return NextResponse.redirect(
      new URL(
        `${returnPath}?google_auth=error&msg=${encodeURIComponent('Trạng thái bảo mật OAuth (state) không hợp lệ hoặc đã quá hạn 15 phút.')}`,
        origin,
      ),
    );
  }

  if (error || !code) {
    const errorMsg = redactGoogleSecretsFromText(error || 'Không nhận được mã ủy quyền từ Google.');
    return NextResponse.redirect(
      new URL(`${returnPath}?google_auth=error&msg=${encodeURIComponent(errorMsg)}`, origin),
    );
  }

  try {
    const res = await handleGoogleOAuthCallback(code, origin, stateStr);
    return NextResponse.redirect(
      new URL(
        `${res.returnPath}?google_auth=success&email=${encodeURIComponent(res.email)}&name=${encodeURIComponent(res.name)}`,
        origin,
      ),
    );
  } catch (err) {
    const errorMsg = redactGoogleSecretsFromText(
      err instanceof Error ? err.message : 'Lỗi xử lý phản hồi từ Google.',
    );
    return NextResponse.redirect(
      new URL(`${returnPath}?google_auth=error&msg=${encodeURIComponent(errorMsg)}`, origin),
    );
  }
}
