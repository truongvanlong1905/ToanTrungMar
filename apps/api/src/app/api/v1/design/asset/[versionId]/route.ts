import { prisma } from '@toantrung/database';
import { hasBaPermission } from '@toantrung/contracts';
import { jsonError } from '../../../../../../core/http';
import { requireAuthenticatedSession } from '../../../../../../core/permissions';
import { readPrivateBusinessFile } from '../../../../../../core/storage/private-files.service';
import {
  assertCanAccessDesignProject,
  ForbiddenDesignProjectAccessError,
} from '../../../../../../modules/05-ai-design/service';

export async function GET(
  req: Request,
  context: { params: { versionId: string } }
) {
  const auth = await requireAuthenticatedSession(req);
  if (!auth.ok) return auth.response;

  const canDownload =
    hasBaPermission(auth.user.roleCode, 'AI_DESIGN') ||
    hasBaPermission(auth.user.roleCode, 'ATTACHMENT_UPLOAD_VIEW');

  if (!canDownload) {
    return jsonError(
      'FORBIDDEN_PERMISSION',
      'Tài khoản không có quyền tải xuống tài sản thiết kế độ phân giải cao.',
      403
    );
  }

  const versionId = Number(context.params.versionId);
  if (!Number.isInteger(versionId) || versionId <= 0) {
    return jsonError('INVALID_VERSION_ID', 'Mã phiên bản thiết kế không hợp lệ.', 400);
  }

  const versionRow = await prisma.designAssetVersion.findUnique({
    where: { id: versionId },
    include: { designRequest: true },
  });

  if (!versionRow) {
    return jsonError('NOT_FOUND', 'Không tìm thấy phiên bản thiết kế yêu cầu.', 404);
  }

  try {
    await assertCanAccessDesignProject(auth.user, versionRow.designRequestId);
  } catch (err) {
    if (err instanceof ForbiddenDesignProjectAccessError) {
      return jsonError('FORBIDDEN_PROJECT_ACCESS', err.message, 403);
    }
    return jsonError('FORBIDDEN', 'Không có quyền truy cập tài sản dự án này.', 403);
  }

  const fileData = readPrivateBusinessFile(versionRow.storageObjectKey);
  if (!fileData || fileData.buffer.length === 0) {
    return jsonError(
      'ASSET_FILE_MISSING',
      'Tệp đầu ra của phiên bản này chưa tồn tại trên kho lưu trữ bảo mật.',
      404
    );
  }

  const safeName = fileData.fileName.replace(/["\r\n\\]/g, '_');
  const isSafeInlineRaster = /^image\/(png|jpeg|webp|gif)$/i.test(fileData.mimeType);
  return new Response(new Uint8Array(fileData.buffer), {
    status: 200,
    headers: {
      'Content-Type': fileData.mimeType,
      'Content-Disposition': `${isSafeInlineRaster ? 'inline' : 'attachment'}; filename="${safeName}"`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, max-age=86400, immutable',
    },
  });
}
