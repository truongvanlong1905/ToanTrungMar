import { jsonError, jsonSuccess } from '../../../../../../core/http';
import { requireAuthenticatedSession } from '../../../../../../core/permissions';
import {
  getGoogleOAuthStatusDto,
  getGoogleClientConfigDto,
  getGoogleAdsApiConfigDto,
  saveGoogleClientConfig,
  saveGoogleAdsApiConfig,
  syncAllGoogleDataAcrossModules,
  connectSandboxDemo,
  disconnectGoogleOAuth,
} from '../../../../../../modules/02-tracking-sync/google-oauth.service';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const auth = await requireAuthenticatedSession(req, { requireCsrf: false });
    if (!auth.ok) return auth.response;

    const canManageGoogleConfig =
      auth.user.roleCode === 'ADMIN' || auth.user.roleCode === 'MKT_LEAD';

    const [status, clientConfig, adsConfig] = await Promise.all([
      getGoogleOAuthStatusDto(),
      canManageGoogleConfig
        ? getGoogleClientConfigDto()
        : Promise.resolve({ hasClientId: false, clientIdMasked: null, hasClientSecret: false }),
      canManageGoogleConfig
        ? getGoogleAdsApiConfigDto()
        : Promise.resolve({
            hasDeveloperToken: false,
            developerTokenMasked: null,
            customerId: null,
            loginCustomerId: null,
            oauthDirectSupported: true,
          }),
    ]);

    const safeStatus = canManageGoogleConfig
      ? status
      : {
          ...status,
          connectedEmail: null,
          connectedName: null,
          connectedPicture: null,
          scopes: [],
          accessibleResources: [],
        };

    return jsonSuccess({ status: safeStatus, clientConfig, adsConfig });
  } catch (err) {
    return jsonError(
      'GET_GOOGLE_STATUS_ERROR',
      err instanceof Error ? err.message : 'Không thể lấy trạng thái kết nối Google.',
      500,
    );
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireAuthenticatedSession(req, { requireCsrf: true });
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const body = (await req.json().catch(() => ({}))) as {
      action?: 'save_client_config' | 'save_ads_config' | 'demo_connect' | 'disconnect';
      clientId?: string;
      clientSecret?: string;
      developerToken?: string;
      customerId?: string;
      loginCustomerId?: string;
    };

    if (body.action === 'save_ads_config') {
      if (user.roleCode !== 'ADMIN' && user.roleCode !== 'MKT_LEAD') {
        return jsonError(
          'FORBIDDEN',
          'Chỉ Quản trị viên hoặc Trưởng phòng Marketing mới được cấu hình Google Ads API.',
          403,
        );
      }
      await saveGoogleAdsApiConfig({
        developerToken: body.developerToken?.trim() || null,
        customerId: body.customerId?.trim() || null,
        loginCustomerId: body.loginCustomerId?.trim() || null,
      });
      await syncAllGoogleDataAcrossModules('MANUAL_RETRY').catch(() => null);
      const [status, clientConfig, adsConfig] = await Promise.all([
        getGoogleOAuthStatusDto(),
        getGoogleClientConfigDto(),
        getGoogleAdsApiConfigDto(),
      ]);
      return jsonSuccess({
        message: 'Đã lưu cấu hình Google Ads & đồng bộ dữ liệu thành công.',
        status,
        clientConfig,
        adsConfig,
      });
    }

    if (body.action === 'save_client_config') {
      if (user.roleCode !== 'ADMIN' && user.roleCode !== 'MKT_LEAD') {
        return jsonError('FORBIDDEN', 'Chỉ Quản trị viên hoặc Trưởng phòng Marketing mới được cấu hình Client ID.', 403);
      }
      if (!body.clientId?.trim() || !body.clientSecret?.trim()) {
        return jsonError('INVALID_INPUT', 'Vui lòng điền cả Client ID và Client Secret.', 400);
      }
      await saveGoogleClientConfig({
        clientId: body.clientId.trim(),
        clientSecret: body.clientSecret.trim(),
      });
      const [status, clientConfig] = await Promise.all([
        getGoogleOAuthStatusDto(),
        getGoogleClientConfigDto(),
      ]);
      return jsonSuccess({ message: 'Đã lưu cấu hình Google OAuth Client thành công.', status, clientConfig });
    }

    if (body.action === 'demo_connect') {
      if (user.roleCode !== 'ADMIN') {
        return jsonError('FORBIDDEN', 'Chỉ Quản trị viên (ADMIN) mới được bật chế độ Kiểm thử Mẫu.', 403);
      }
      await connectSandboxDemo(user.email || 'toantrung.marketing@gmail.com');
      const status = await getGoogleOAuthStatusDto();
      return jsonSuccess({
        message: 'Đã kết nối Chế độ Kiểm thử Mẫu (Demo Sandbox) thành công với tài khoản marketing.',
        status,
      });
    }

    if (body.action === 'disconnect') {
      if (user.roleCode !== 'ADMIN' && user.roleCode !== 'MKT_LEAD') {
        return jsonError('FORBIDDEN', 'Chỉ Quản trị viên hoặc Trưởng phòng Marketing mới được ngắt kết nối Google.', 403);
      }
      await disconnectGoogleOAuth();
      const status = await getGoogleOAuthStatusDto();
      return jsonSuccess({ message: 'Đã ngắt kết nối tài khoản Google thành công.', status });
    }

    return jsonError('INVALID_ACTION', 'Thao tác không hợp lệ.', 400);
  } catch (err) {
    return jsonError(
      'GOOGLE_AUTH_ACTION_ERROR',
      err instanceof Error ? err.message : 'Lỗi thao tác xác thực Google.',
      500,
    );
  }
}
