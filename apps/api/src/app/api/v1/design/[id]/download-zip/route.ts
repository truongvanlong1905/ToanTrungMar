import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '@toantrung/database';
import { hasBaPermission } from '@toantrung/contracts';
import { jsonError } from '../../../../../../core/http';
import { requireAuthenticatedSession } from '../../../../../../core/permissions';
import { ZipArchive } from '../../../../../../core/export/xlsx-builder';
import { readPrivateBusinessFile } from '../../../../../../core/storage/private-files.service';
import {
  assertCanAccessDesignProject,
  ForbiddenDesignProjectAccessError,
} from '../../../../../../modules/05-ai-design/service';

export async function GET(
  req: Request,
  context: { params: { id: string } }
) {
  const auth = await requireAuthenticatedSession(req);
  if (!auth.ok) return auth.response;

  const canDownload =
    hasBaPermission(auth.user.roleCode, 'AI_DESIGN') ||
    hasBaPermission(auth.user.roleCode, 'ATTACHMENT_UPLOAD_VIEW') ||
    hasBaPermission(auth.user.roleCode, 'EXPORT_DATA');

  if (!canDownload) {
    return jsonError(
      'FORBIDDEN_PERMISSION',
      'Tài khoản không có quyền tải xuống gói Kho ảnh dự án (ZIP).',
      403
    );
  }

  const requestId = Number(context.params.id);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return jsonError('INVALID_ID', 'Mã dự án thiết kế không hợp lệ.', 400);
  }

  const row = await prisma.designRequest.findUnique({
    where: { id: requestId },
    include: {
      lead: true,
      assetVersions: {
        orderBy: { versionNumber: 'asc' },
      },
    },
  });

  if (!row) {
    return jsonError('NOT_FOUND', 'Không tìm thấy dự án thiết kế yêu cầu.', 404);
  }

  try {
    await assertCanAccessDesignProject(auth.user, requestId);
  } catch (err) {
    if (err instanceof ForbiddenDesignProjectAccessError) {
      return jsonError('FORBIDDEN_PROJECT_ACCESS', err.message, 403);
    }
    return jsonError('FORBIDDEN', 'Không có quyền tải xuống dự án này.', 403);
  }

  const url = new URL(req.url);
  const folderFilter = url.searchParams.get('folder') || 'all';
  const idsParam = url.searchParams.get('ids') || '';
  const selectedIds = idsParam
    ? new Set(idsParam.split(',').map((s) => s.trim()).filter(Boolean))
    : null;

  const zip = new ZipArchive();
  let meta: {
    projectName?: string;
    photos?: Array<{ id: string; name: string; url: string; storageObjectKey?: string }>;
    productSpec?: unknown;
    taskCode?: string | null;
    websiteId?: string | null;
    websiteDomain?: string | null;
    campaignId?: string | null;
    campaignName?: string | null;
    contentId?: number | null;
    sourceModule?: string | null;
    designBrief?: Record<string, unknown> | null;
  } = {};
  try {
    if (row.installPositionJson) {
      meta = JSON.parse(row.installPositionJson);
    }
  } catch {
    meta = {};
  }

  const safeProjectSlug = (meta.projectName || `DuAn_${row.id}`)
    .replace(/[^\w.-]/g, '_')
    .slice(0, 40);

  let realFilesIncluded = 0;
  const skippedMissingEntries: string[] = [];

  // 1. Include real input photos only (never fabricate synthetic images)
  if (folderFilter === 'all' || folderFilter === 'technical') {
    const photos = Array.isArray(meta.photos) ? meta.photos : [];
    for (let i = 0; i < photos.length; i++) {
      const p = photos[i];
      if (selectedIds && !selectedIds.has(p.id)) continue;

      let fileBuf: Buffer | null = null;
      let ext = '.png';

      if (p.storageObjectKey) {
        const priv = readPrivateBusinessFile(p.storageObjectKey);
        if (priv && priv.buffer.length > 0) {
          fileBuf = priv.buffer;
          ext = path.extname(priv.fileName) || '.png';
        }
      }

      if (!fileBuf && p.url.startsWith('/brand/')) {
        const publicCandidates = [
          path.resolve(process.cwd(), '../web/public', p.url.replace(/^\//, '')),
          path.resolve(process.cwd(), 'apps/web/public', p.url.replace(/^\//, '')),
        ];
        for (const cand of publicCandidates) {
          if (fs.existsSync(cand)) {
            fileBuf = fs.readFileSync(cand);
            ext = path.extname(cand) || '.webp';
            break;
          }
        }
      }

      if (!fileBuf) {
        skippedMissingEntries.push(`Anh_Ky_Thuat: ${p.name} (tệp vật lý chưa tồn tại)`);
        continue;
      }

      const cleanName = p.name.replace(/[^\w.-]/g, '_').replace(/\.(png|jpe?g|webp)$/i, '');
      zip.addFile(`Anh_Ky_Thuat/${String(i + 1).padStart(2, '0')}_${cleanName}${ext}`, fileBuf);
      realFilesIncluded += 1;
    }
  }

  // 2. Include real design asset versions only
  if (folderFilter === 'all' || folderFilter === 'designs') {
    for (const ver of row.assetVersions) {
      if (selectedIds && !selectedIds.has(`ver-${ver.id}`) && !selectedIds.has(String(ver.id))) {
        continue;
      }

      const priv = readPrivateBusinessFile(ver.storageObjectKey);
      if (!priv || priv.buffer.length === 0) {
        skippedMissingEntries.push(`Ban_Thiet_Ke: v${ver.versionNumber} (tệp đầu ra chưa tồn tại)`);
        continue;
      }

      const tag = ver.isApprovedFinal
        ? 'BAN_CHOT_DUYET'
        : ver.versionType === 'final_render'
          ? 'DESIGNER_FINAL'
          : 'AI_DRAFT';
      const ext = path.extname(priv.fileName) || '.png';
      zip.addFile(`Ban_Thiet_Ke/v${ver.versionNumber}_${tag}_req${row.id}${ext}`, priv.buffer);
      realFilesIncluded += 1;
    }
  }

  if (realFilesIncluded === 0) {
    return jsonError(
      'NO_EXPORTABLE_FILES',
      'Dự án chưa có tệp ảnh đầu ra hoặc ảnh hiện trạng thực tế trên kho lưu trữ để tải gói ZIP.',
      404
    );
  }

  const versionLineage = row.assetVersions.map((ver) => {
    let vp: Record<string, unknown> = {};
    if (ver.parametersJson) {
      try {
        vp = JSON.parse(ver.parametersJson);
      } catch {
        vp = {};
      }
    }
    return {
      versionId: ver.id,
      versionNumber: ver.versionNumber,
      sourceType: ver.versionType,
      isApprovedFinal: ver.isApprovedFinal,
      taskCode: vp.taskCode || meta.taskCode || null,
      taskId: vp.taskId || null,
      generationOrigin: vp.generationOrigin || null,
      providerId: vp.providerId || null,
      requestedModel: vp.requestedModel || vp.modelUsed || null,
      reportedModel: vp.reportedModel ?? null,
      reportedModelNote: vp.reportedModelNote ?? null,
      costState: vp.costState || null,
      parentVersionId: vp.parentVersionId ?? vp.sourceVersionId ?? null,
      inputAssetIds: Array.isArray(vp.inputAssetIds) ? vp.inputAssetIds : [],
    };
  });

  const safeProjectSummary = {
    projectId: row.id,
    projectName: meta.projectName || `Dự án #${row.id}`,
    leadCode: row.lead?.leadCode || null,
    requestType: row.requestType,
    taskCode: meta.taskCode || (row.requestType === 'banner' ? 'banner_generate' : 'perspective_compose'),
    websiteDomain: meta.websiteDomain || null,
    campaignId: meta.campaignId || null,
    campaignName: meta.campaignName || null,
    contentId: meta.contentId ?? null,
    sourceModule: meta.sourceModule || null,
    ledCategory: row.ledCategory,
    screenDimensions: row.screenDimensions,
    aspectRatio: row.aspectRatio,
    status: row.designStatus,
    designBrief: meta.designBrief || null,
    productSpec: meta.productSpec || null,
    versionLineage,
    disclaimer:
      'LƯU Ý QUAN TRỌNG: Các bản phối cảnh trong gói này là ảnh minh họa raster 2D phục vụ đề xuất Marketing/Bán hàng, KHÔNG phải bản vẽ kỹ thuật CAD/3D kết cấu chịu lực thi công.',
    realFilesIncluded,
    skippedMissingEntries,
    exportedBy: auth.user.fullName,
    exportedAt: new Date().toISOString(),
  };

  zip.addFile('Thong_So_Du_An.json', JSON.stringify(safeProjectSummary, null, 2));
  zip.addFile('design-brief-and-lineage.json', JSON.stringify(safeProjectSummary, null, 2));

  await prisma.auditLog.create({
    data: {
      actorUserId: auth.user.id,
      action: 'DESIGN_PROJECT_ZIP_DOWNLOADED',
      targetType: 'DesignRequest',
      targetId: String(row.id),
      detailsJson: JSON.stringify({
        folderFilter,
        realFilesIncluded,
        skippedCount: skippedMissingEntries.length,
      }),
    },
  });

  const zipBuffer = zip.toBuffer();
  return new Response(new Uint8Array(zipBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="KhoAnhDuAn_${safeProjectSlug}_#${row.id}.zip"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
