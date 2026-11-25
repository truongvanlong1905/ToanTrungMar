import { prisma } from '@toantrung/database';
import { ChangePasswordSchema, UpdateProfileSchema } from '@toantrung/contracts';
import { getClientIp, jsonError, jsonSuccess } from '../../../../core/http';
import { requireAuthenticatedSession } from '../../../../core/permissions';
import { ImageValidationError } from '../../../../core/storage/image-validator';
import {
  AuthServiceError,
  changeOwnPassword,
  getUserCoverMap,
  updateOwnProfile,
  uploadOwnAvatar,
  uploadOwnCover,
} from '../../../../core/auth/service';

const FORBIDDEN_PROFILE_FIELDS = ['id', 'userId', 'roleCode', 'roleId', 'department', 'email', 'isActive'] as const;

export async function GET(req: Request) {
  const auth = await requireAuthenticatedSession(req, { requireCsrf: false });
  if (!auth.ok) return auth.response;
  const sessions = await prisma.userSession.findMany({
    where: {
      userId: auth.user.id,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      id: true,
      ipAddress: true,
      userAgent: true,
      createdAt: true,
      expiresAt: true,
    },
  });
  return jsonSuccess({
    user: auth.user,
    activeSessions: sessions.map((s) => ({
      id: s.id,
      isCurrent: s.id === auth.sessionId,
      ipAddress: s.ipAddress || 'IP Nội bộ Toàn Trung',
      userAgent: s.userAgent || 'Trình duyệt Web',
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
    })),
  });
}

export async function PATCH(req: Request) {
  const auth = await requireAuthenticatedSession(req);
  if (!auth.ok) return auth.response;

  const contentType = req.headers.get('content-type') || '';

  if (contentType.includes('multipart/form-data')) {
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return jsonError('INVALID_FORM_DATA', 'Không đọc được dữ liệu biểu mẫu hồ sơ.', 400);
    }

    for (const forbidden of FORBIDDEN_PROFILE_FIELDS) {
      if (formData.has(forbidden)) {
        return jsonError(
          'FORBIDDEN_PROFILE_FIELD',
          'Không được phép thay đổi vai trò, phòng ban hoặc tài khoản khác từ hồ sơ cá nhân.',
          403,
        );
      }
    }

    const fullName = String(formData.get('fullName') ?? auth.user.fullName);
    const phone = String(formData.get('phone') ?? (auth.user.phone || ''));
    const removeAvatar = String(formData.get('removeAvatar') || '') === 'true';
    const removeCover = String(formData.get('removeCover') || '') === 'true';
    const coverPresetRaw = formData.get('coverPreset');
    const coverPreset = typeof coverPresetRaw === 'string' && coverPresetRaw.trim() ? coverPresetRaw.trim() : undefined;

    const parsed = UpdateProfileSchema.safeParse({
      fullName,
      phone,
      removeAvatar,
      removeCover,
      coverPreset,
    });
    if (!parsed.success) {
      return jsonError(
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message || 'Thông tin hồ sơ không hợp lệ.',
        400,
      );
    }

    const avatarFile = formData.get('avatar');
    const coverFile = formData.get('cover');
    let latestUser = await updateOwnProfile(auth.user.id, parsed.data, getClientIp(req));

    if (avatarFile && typeof (avatarFile as Blob).arrayBuffer === 'function' && (avatarFile as Blob).size > 0) {
      try {
        const arrayBuffer = await (avatarFile as Blob).arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const declaredMime = (avatarFile as File).type || 'application/octet-stream';
        latestUser = await uploadOwnAvatar({
          userId: auth.user.id,
          fileBuffer: buffer,
          declaredMimeType: declaredMime,
          ipAddress: getClientIp(req),
        });
      } catch (err) {
        if (err instanceof ImageValidationError) {
          return jsonError(err.code, err.message, 400);
        }
        return jsonError('AVATAR_UPLOAD_FAILED', 'Không thể tải lên ảnh đại diện.', 500);
      }
    }

    if (coverFile && typeof (coverFile as Blob).arrayBuffer === 'function' && (coverFile as Blob).size > 0) {
      try {
        const arrayBuffer = await (coverFile as Blob).arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const declaredMime = (coverFile as File).type || 'application/octet-stream';
        await uploadOwnCover({
          userId: auth.user.id,
          fileBuffer: buffer,
          declaredMimeType: declaredMime,
          ipAddress: getClientIp(req),
        });
      } catch (err) {
        if (err instanceof ImageValidationError) {
          return jsonError(err.code, err.message, 400);
        }
        return jsonError('COVER_UPLOAD_FAILED', 'Không thể tải lên hình nền hồ sơ.', 500);
      }
    }

    const coverMap = await getUserCoverMap();
    return jsonSuccess({
      user: {
        ...auth.user,
        fullName: latestUser.fullName,
        phone: latestUser.phone,
        avatarUrl: latestUser.avatarUrl,
        coverUrl: coverMap[String(auth.user.id)] || null,
      },
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError('INVALID_JSON', 'Dữ liệu gửi lên không hợp lệ.', 400);
  }

  if (body && typeof body === 'object') {
    for (const forbidden of FORBIDDEN_PROFILE_FIELDS) {
      if (forbidden in (body as Record<string, unknown>)) {
        return jsonError(
          'FORBIDDEN_PROFILE_FIELD',
          'Không được phép thay đổi vai trò, phòng ban hoặc tài khoản khác từ hồ sơ cá nhân.',
          403,
        );
      }
    }
  }

  const parsed = UpdateProfileSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      'VALIDATION_ERROR',
      parsed.error.issues[0]?.message || 'Thông tin hồ sơ không hợp lệ.',
      400,
    );
  }

  const updated = await updateOwnProfile(auth.user.id, parsed.data, getClientIp(req));
  const coverMap = await getUserCoverMap();
  return jsonSuccess({
    user: {
      ...auth.user,
      fullName: updated.fullName,
      phone: updated.phone,
      avatarUrl: updated.avatarUrl,
      coverUrl: coverMap[String(auth.user.id)] || null,
    },
  });
}

export async function POST(req: Request) {
  const auth = await requireAuthenticatedSession(req);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError('INVALID_JSON', 'Dữ liệu gửi lên không hợp lệ.', 400);
  }

  const parsed = ChangePasswordSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      'VALIDATION_ERROR',
      parsed.error.issues[0]?.message || 'Thông tin mật khẩu không hợp lệ.',
      400,
    );
  }

  try {
    await changeOwnPassword(
      auth.user.id,
      auth.sessionId,
      parsed.data.currentPassword,
      parsed.data.newPassword,
      getClientIp(req),
    );
    return jsonSuccess({ changed: true });
  } catch (err) {
    if (err instanceof AuthServiceError) {
      return jsonError(err.code, err.message, err.status);
    }
    return jsonError('PASSWORD_CHANGE_FAILED', 'Không thể cập nhật mật khẩu lúc này.', 500);
  }
}
