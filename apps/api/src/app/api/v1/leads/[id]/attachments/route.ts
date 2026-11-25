import { NextResponse } from 'next/server';
import { prisma } from '@toantrung/database';
import { hasBaPermission } from '@toantrung/contracts';
import { jsonError, jsonSuccess } from '../../../../../../core/http';
import { bumpDomainRevisions } from '../../../../../../core/cache/server-data-cache';
import { requirePermissionSession } from '../../../../../../core/permissions';
import { readPrivateBusinessFile } from '../../../../../../core/storage/private-files.service';
import {
  shouldAnonymizeLeadForRole,
  uploadLeadAttachment,
} from '../../../../../../modules/01-leads/service';

export async function GET(
  req: Request,
  context: { params: { id: string } },
) {
  const auth = await requirePermissionSession(req, 'ATTACHMENT_UPLOAD_VIEW', {
    requireCsrf: false,
  });
  if (!auth.ok) return auth.response;

  if (shouldAnonymizeLeadForRole(auth.user.roleCode)) {
    return jsonError(
      'FORBIDDEN_ANONYMIZED_ROLE',
      'Vai trò xem ẩn danh không được tải tệp đính kèm định danh khách hàng.',
      403,
    );
  }

  const leadId = Number(context.params.id);
  const url = new URL(req.url);
  const archivedActivityId = Number(url.searchParams.get('archivedActivityId'));
  if (!Number.isInteger(leadId) || leadId <= 0 || !Number.isInteger(archivedActivityId) || archivedActivityId <= 0) {
    return jsonError('INVALID_ARCHIVED_ATTACHMENT', 'Thiếu mã hồ sơ hoặc mã lịch sử tệp đã lưu trữ.', 400);
  }

  const activity = await prisma.leadActivity.findFirst({
    where: {
      id: archivedActivityId,
      leadId,
      actionType: 'upload_attachment',
    },
    include: { lead: true },
  });

  if (!activity || !activity.oldValueJson) {
    return jsonError('NOT_FOUND', 'Không tìm thấy tệp lưu trữ trong lịch sử hồ sơ.', 404);
  }

  let archived: {
    fileName?: string;
    fileUrl?: string;
    attachmentType?: string;
  } | null = null;
  try {
    const parsed = JSON.parse(activity.oldValueJson) as {
      archivedAttachment?: {
        fileName?: string;
        fileUrl?: string;
        attachmentType?: string;
      };
    };
    archived = parsed?.archivedAttachment || null;
  } catch {
    archived = null;
  }

  if (!archived?.fileUrl || !archived?.fileName) {
    return jsonError('NOT_FOUND', 'Bản ghi lịch sử này không chứa tệp lưu trữ.', 404);
  }

  if (archived.attachmentType === 'quote_doc') {
    return jsonError(
      'PRICE_DOCUMENT_RESTRICTED',
      'Tệp hồ sơ báo giá không được phép hiển thị hoặc tải qua hệ thống.',
      403,
    );
  }

  const canViewAll = hasBaPermission(auth.user.roleCode, 'LEAD_VIEW_ALL');
  if (auth.user.roleCode === 'DESIGNER') {
    const linkedDesignCount = await prisma.designRequest.count({
      where: { leadId },
    });
    if (linkedDesignCount === 0) {
      return jsonError(
        'FORBIDDEN_LEAD_SCOPE',
        'Designer chỉ được xem tệp của hồ sơ Lead có yêu cầu thiết kế 3D/2D.',
        403,
      );
    }
  } else if (
    !canViewAll &&
    activity.lead.assignedSalesId !== auth.user.id &&
    activity.lead.createdByUserId !== auth.user.id
  ) {
    return jsonError(
      'FORBIDDEN_LEAD_SCOPE',
      'Bạn chỉ được tải tệp lịch sử của hồ sơ Lead do mình phụ trách.',
      403,
    );
  }

  const fileData = readPrivateBusinessFile(archived.fileUrl);
  if (!fileData) {
    return jsonError('FILE_MISSING', 'Tệp vật lý không còn tồn tại trong kho lưu trữ riêng tư.', 404);
  }

  const forceDownload = url.searchParams.get('download') === '1';
  const isUnsafeActiveType = /^image\/svg\+xml|^text\/html|^application\/javascript/i.test(
    fileData.mimeType,
  );
  const isInlinePreviewable =
    !forceDownload &&
    !isUnsafeActiveType &&
    (/^image\/(?:png|jpeg|webp|gif|bmp)$/i.test(fileData.mimeType) ||
      fileData.mimeType === 'application/pdf' ||
      fileData.mimeType.startsWith('text/plain') ||
      fileData.mimeType.startsWith('video/'));
  const dispositionType = isInlinePreviewable ? 'inline' : 'attachment';
  const asciiFallback =
    archived.fileName.replace(/["\r\n\\]/g, '_').replace(/[^\x20-\x7E]/g, '_') || 'archived-attachment';

  return new NextResponse(new Uint8Array(fileData.buffer), {
    status: 200,
    headers: {
      'Content-Type': isUnsafeActiveType ? 'application/octet-stream' : fileData.mimeType,
      'Content-Disposition': `${dispositionType}; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(archived.fileName)}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-store',
    },
  });
}

export async function POST(
  req: Request,
  context: { params: { id: string } },
) {
  const auth = await requirePermissionSession(req, 'ATTACHMENT_UPLOAD_VIEW');
  if (!auth.ok) return auth.response;

  if (shouldAnonymizeLeadForRole(auth.user.roleCode)) {
    return jsonError(
      'FORBIDDEN_ANONYMIZED_ROLE',
      'Vai trò xem ẩn danh không có quyền tải tệp vào hồ sơ khách hàng.',
      403,
    );
  }

  const leadId = Number(context.params.id);
  if (!Number.isInteger(leadId) || leadId <= 0) {
    return jsonError('INVALID_LEAD_ID', 'Mã hồ sơ Lead không hợp lệ.', 400);
  }

  try {
    const contentType = (req.headers.get('content-type') || '').toLowerCase();

    if (contentType.includes('application/json')) {
      const body = (await req.json()) as {
        attachmentType?: string;
        folderPath?: string;
        fileName?: string;
        mimeType?: string;
        base64Data?: string;
        files?: Array<{
          fileName: string;
          mimeType?: string;
          base64Data: string;
        }>;
      };

      const attachmentTypeRaw = String(body.attachmentType || 'site_photo');
      if (attachmentTypeRaw === 'quote_doc') {
        return jsonError(
          'PRICE_DOCUMENT_RESTRICTED',
          'Hệ thống không lưu hồ sơ báo giá có giá. Chỉ tải ảnh khảo sát, bản vẽ kỹ thuật và tài liệu dự án.',
          400,
        );
      }
      const attachmentType: 'site_photo' | 'customer_drawing_doc' | 'other' =
        attachmentTypeRaw === 'customer_drawing_doc'
          ? 'customer_drawing_doc'
          : attachmentTypeRaw === 'other'
            ? 'other'
            : 'site_photo';
      const folderPath = String(body.folderPath || '/ho-so-cong-trinh');

      const incomingFiles =
        Array.isArray(body.files) && body.files.length > 0
          ? body.files
          : body.base64Data && body.fileName
            ? [{ fileName: body.fileName, mimeType: body.mimeType, base64Data: body.base64Data }]
            : [];

      if (incomingFiles.length === 0) {
        return jsonError('FILE_REQUIRED', 'Vui lòng chọn ít nhất 1 tệp đính kèm.', 400);
      }

      const uploadedList = [];
      for (const item of incomingFiles) {
        const cleanB64 = item.base64Data.includes(',')
          ? item.base64Data.split(',')[1] || ''
          : item.base64Data;
        const fileBuffer = Buffer.from(cleanB64, 'base64');
        const created = await uploadLeadAttachment({
          actor: auth.user,
          leadId,
          attachmentType,
          folderPath,
          fileName: item.fileName || 'tai-lieu-du-an.bin',
          fileBuffer,
          declaredMimeType: item.mimeType || 'application/octet-stream',
        });
        uploadedList.push({ id: created.id, fileName: created.fileName });
      }

      bumpDomainRevisions(['leads', 'reports'], 'upload_lead_attachment');
      return jsonSuccess(
        {
          id: uploadedList[0]?.id,
          fileName: uploadedList[0]?.fileName,
          uploadedCount: uploadedList.length,
          items: uploadedList,
        },
        201,
      );
    }

    const formData = await req.formData();
    const rawFiles = formData.getAll('files');
    const singleFile = formData.get('file');
    const candidateBlobs = rawFiles.length > 0 ? rawFiles : singleFile ? [singleFile] : [];

    const validBlobs = candidateBlobs.filter(
      (f): f is File =>
        Boolean(f) && typeof f === 'object' && typeof (f as Blob).arrayBuffer === 'function',
    );

    if (validBlobs.length === 0) {
      return jsonError('FILE_REQUIRED', 'Vui lòng chọn tệp đính kèm để tải lên.', 400);
    }

    const attachmentTypeRaw = String(formData.get('attachmentType') || 'site_photo');
    if (attachmentTypeRaw === 'quote_doc') {
      return jsonError(
        'PRICE_DOCUMENT_RESTRICTED',
        'Hệ thống không lưu hồ sơ báo giá có giá. Chỉ tải ảnh khảo sát, bản vẽ kỹ thuật và tài liệu dự án.',
        400,
      );
    }
    const attachmentType: 'site_photo' | 'customer_drawing_doc' | 'other' =
      attachmentTypeRaw === 'customer_drawing_doc'
        ? 'customer_drawing_doc'
        : attachmentTypeRaw === 'other'
          ? 'other'
          : 'site_photo';
    const folderPath = String(formData.get('folderPath') || '/ho-so-cong-trinh');

    const uploadedList = [];
    for (const file of validBlobs) {
      const arrayBuffer = await file.arrayBuffer();
      const created = await uploadLeadAttachment({
        actor: auth.user,
        leadId,
        attachmentType,
        folderPath,
        fileName: file.name || 'site-photo.png',
        fileBuffer: Buffer.from(arrayBuffer),
        declaredMimeType: file.type || 'application/octet-stream',
      });
      uploadedList.push({ id: created.id, fileName: created.fileName });
    }

    bumpDomainRevisions(['leads', 'reports'], 'upload_lead_attachment');
    return jsonSuccess(
      {
        id: uploadedList[0]?.id,
        fileName: uploadedList[0]?.fileName,
        uploadedCount: uploadedList.length,
        items: uploadedList,
      },
      201,
    );
  } catch (err) {
    return jsonError(
      'ATTACHMENT_UPLOAD_FAILED',
      err instanceof Error ? err.message : 'Không thể tải lên tệp đính kèm.',
      400,
    );
  }
}

