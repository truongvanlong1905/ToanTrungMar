import { hasBaPermission } from '@toantrung/contracts';
import { jsonError } from '../../../../../core/http';
import { requireAuthenticatedSession } from '../../../../../core/permissions';
import { readPrivateBusinessFile } from '../../../../../core/storage/private-files.service';
import {
  assertCanAccessStorageObjectKey,
  ForbiddenDesignProjectAccessError,
} from '../../../../../modules/05-ai-design/service';

export async function GET(req: Request) {
  const auth = await requireAuthenticatedSession(req);
  if (!auth.ok) return auth.response;

  const canView =
    hasBaPermission(auth.user.roleCode, 'AI_DESIGN') ||
    hasBaPermission(auth.user.roleCode, 'ATTACHMENT_UPLOAD_VIEW');

  if (!canView) {
    return jsonError('FORBIDDEN', 'Tài khoản không có quyền xem tệp tài sản thiết kế.', 403);
  }

  const { searchParams } = new URL(req.url);
  const key = searchParams.get('key');
  if (!key) {
    return jsonError('INVALID_KEY', 'Thiếu tham số khóa tệp.', 400);
  }

  try {
    await assertCanAccessStorageObjectKey(auth.user, key);
  } catch (err) {
    if (err instanceof ForbiddenDesignProjectAccessError) {
      return jsonError('FORBIDDEN_PROJECT_ACCESS', err.message, 403);
    }
    return jsonError('FORBIDDEN', 'Tài khoản không có quyền xem ảnh của dự án này.', 403);
  }

  const file = readPrivateBusinessFile(key);
  if (!file) {
    return jsonError('NOT_FOUND', 'Không tìm thấy tệp trong kho bảo mật.', 404);
  }

  const safeFileName = (file.fileName || 'design-asset.png').replace(/["\r\n\\]/g, '_');
  const isSafeInlineRaster = /^image\/(?:png|jpeg|webp|gif)$/i.test(file.mimeType);
  const disposition = isSafeInlineRaster ? 'inline' : 'attachment';

  return new Response(new Uint8Array(file.buffer), {
    status: 200,
    headers: {
      'Content-Type': isSafeInlineRaster ? file.mimeType : 'application/octet-stream',
      'Content-Disposition': `${disposition}; filename="${safeFileName}"`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, max-age=3600',
    },
  });
}

