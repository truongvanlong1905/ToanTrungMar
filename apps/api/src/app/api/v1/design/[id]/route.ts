import { hasBaPermission } from '@toantrung/contracts';
import { ConcurrencyConflictError } from '@toantrung/database';
import {
  AddProjectPhotoSchema,
  ApproveDesignVersionSchema,
  AutoDetectLedPlacementRequestSchema,
  ChatDesignRequestSchema,
  GenerateLedScreenContentRequestSchema,
  LedQuickInstallRequestSchema,
  RegenerateDesignDraftSchema,
  UpdateDesignProjectSchema,
} from '@toantrung/contracts';
import { jsonError, jsonSuccess } from '../../../../../core/http';
import {
  requireAuthenticatedSession,
  requirePermissionSession,
} from '../../../../../core/permissions';
import {
  addProjectPhoto,
  approveDesignAssetVersion,
  autoDetectLedPlacement,
  deleteDesignAssetVersion,
  deleteDesignProject,
  deleteProjectPhoto,
  evaluateProjectTechnicalBom,
  executeQuickLedInstall,
  ForbiddenDesignProjectAccessError,
  generateLedScreenContent,
  getDesignProjectForUser,
  processChatDesignRequest,
  regenerateDesignDraftByAi,
  retryLastFailedDesignGeneration,
  saveCompositedDraftVersion,
  updateDesignProject,
  uploadDesignerFinalRender,
} from '../../../../../modules/05-ai-design/service';

export async function GET(
  req: Request,
  context: { params: { id: string } }
) {
  const auth = await requireAuthenticatedSession(req);
  if (!auth.ok) return auth.response;

  const canViewDesign =
    hasBaPermission(auth.user.roleCode, 'AI_DESIGN') ||
    hasBaPermission(auth.user.roleCode, 'ATTACHMENT_UPLOAD_VIEW');
  if (!canViewDesign) {
    return jsonError(
      'FORBIDDEN_PERMISSION',
      'Tài khoản không có quyền xem hồ sơ thiết kế và ảnh hiện trạng.',
      403
    );
  }

  const requestId = Number(context.params.id);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return jsonError('INVALID_ID', 'Mã yêu cầu thiết kế không hợp lệ.', 400);
  }

  try {
    const res = await getDesignProjectForUser(auth.user, requestId);
    return jsonSuccess(res);
  } catch (err) {
    if (err instanceof ForbiddenDesignProjectAccessError) {
      return jsonError('FORBIDDEN_PROJECT_ACCESS', err.message, 403);
    }
    return jsonError(
      'DESIGN_FETCH_FAILED',
      err instanceof Error ? err.message : 'Không thể tải dữ liệu dự án thiết kế.',
      404
    );
  }
}

export async function PATCH(
  req: Request,
  context: { params: { id: string } }
) {
  const auth = await requireAuthenticatedSession(req);
  if (!auth.ok) return auth.response;

  const requestId = Number(context.params.id);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return jsonError('INVALID_ID', 'Mã yêu cầu thiết kế không hợp lệ.', 400);
  }

  try {
    const raw = (await req.json()) as Record<string, unknown>;
    const action = String(raw.action || 'regenerate_ai');
    const canViewOrUploadSurvey =
      hasBaPermission(auth.user.roleCode, 'AI_DESIGN') ||
      hasBaPermission(auth.user.roleCode, 'ATTACHMENT_UPLOAD_VIEW');

    if (!canViewOrUploadSurvey) {
      return jsonError(
        'FORBIDDEN_PERMISSION',
        'Tài khoản không có quyền thao tác trên hồ sơ thiết kế này.',
        403
      );
    }

    const aiDesignOnlyActions = new Set([
      'retry_last_failed',
      'chat_edit',
      'approve_version',
      'save_finished',
      'regenerate_ai',
    ]);
    if (aiDesignOnlyActions.has(action) && !hasBaPermission(auth.user.roleCode, 'AI_DESIGN')) {
      return jsonError(
        'FORBIDDEN_PERMISSION',
        'Chỉ Designer hoặc Quản trị viên (quyền AI_DESIGN) mới được sinh ảnh AI hoặc phê duyệt phiên bản thiết kế.',
        403
      );
    }

    if (action === 'evaluate_technical_bom') {
      const res = await evaluateProjectTechnicalBom(auth.user, requestId, {
        widthMm: raw.widthMm !== undefined ? Number(raw.widthMm) : undefined,
        heightMm: raw.heightMm !== undefined ? Number(raw.heightMm) : undefined,
        pixelPitch: typeof raw.pixelPitch === 'string' ? raw.pixelPitch : undefined,
        cabinetModelCode:
          typeof raw.cabinetModelCode === 'string' ? raw.cabinetModelCode : undefined,
        screenStyle:
          raw.screenStyle === 'flat' ||
          raw.screenStyle === 'curved' ||
          raw.screenStyle === 'corner_90'
            ? raw.screenStyle
            : undefined,
      });
      return jsonSuccess(res);
    }

    if (action === 'retry_last_failed') {
      const res = await retryLastFailedDesignGeneration(auth.user, requestId, Boolean(raw.asyncMode));
      const statusCode =
        res && typeof res === 'object' && 'accepted' in res && res.accepted ? 202 : 200;
      return jsonSuccess(res, statusCode);
    }

    if (action === 'chat_edit') {
      const parsed = ChatDesignRequestSchema.safeParse(raw);
      if (!parsed.success) {
        return jsonError(
          'VALIDATION_ERROR',
          parsed.error.issues[0]?.message || 'Yêu cầu chỉnh sửa AI không hợp lệ.',
          400
        );
      }
      const res = await processChatDesignRequest(auth.user, requestId, parsed.data);
      const statusCode =
        res && typeof res === 'object' && 'accepted' in res && res.accepted ? 202 : 200;
      return jsonSuccess(res, statusCode);
    }

    if (action === 'approve_version' || action === 'save_finished') {
      const parsed = ApproveDesignVersionSchema.safeParse(raw);
      if (!parsed.success) {
        return jsonError(
          'VALIDATION_ERROR',
          parsed.error.issues[0]?.message || 'Thông tin phê duyệt phiên bản không hợp lệ.',
          400
        );
      }
      const res = await approveDesignAssetVersion(auth.user, requestId, parsed.data);
      return jsonSuccess(res);
    }

    if (action === 'update_project') {
      const parsed = UpdateDesignProjectSchema.safeParse(raw);
      if (!parsed.success) {
        return jsonError(
          'VALIDATION_ERROR',
          parsed.error.issues[0]?.message || 'Thông tin dự án không hợp lệ.',
          400
        );
      }
      const res = await updateDesignProject(auth.user, requestId, parsed.data);
      return jsonSuccess(res);
    }

    const parsed = RegenerateDesignDraftSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message || 'Thông số tạo lại bản nháp AI không hợp lệ.',
        400
      );
    }

    const res = await regenerateDesignDraftByAi(auth.user, requestId, parsed.data);
    const statusCode =
      res && typeof res === 'object' && 'accepted' in res && res.accepted ? 202 : 200;
    return jsonSuccess(res, statusCode);
  } catch (err) {
    if (err instanceof ForbiddenDesignProjectAccessError) {
      return jsonError('FORBIDDEN_PROJECT_ACCESS', err.message, 403);
    }
    if (err instanceof ConcurrencyConflictError) {
      return jsonError('CONCURRENCY_CONFLICT', err.message, 409);
    }
    return jsonError(
      'DESIGN_UPDATE_FAILED',
      err instanceof Error ? err.message : 'Cập nhật yêu cầu thiết kế thất bại.',
      400
    );
  }
}

export async function POST(
  req: Request,
  context: { params: { id: string } }
) {
  const auth = await requireAuthenticatedSession(req);
  if (!auth.ok) return auth.response;

  const requestId = Number(context.params.id);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return jsonError('INVALID_ID', 'Mã yêu cầu thiết kế không hợp lệ.', 400);
  }

  try {
    const contentType = req.headers.get('content-type') || '';

    // Handle JSON payloads
    if (contentType.includes('application/json')) {
      const raw = (await req.json()) as Record<string, unknown>;
      const action = String(raw.action || 'upload_final');

      if (action === 'add_photo') {
        if (!hasBaPermission(auth.user.roleCode, 'ATTACHMENT_UPLOAD_VIEW')) {
          return jsonError(
            'FORBIDDEN_PERMISSION',
            'Tài khoản không có quyền tải ảnh hiện trạng công trình.',
            403
          );
        }
        const parsed = AddProjectPhotoSchema.safeParse(raw);
        if (!parsed.success) {
          return jsonError('VALIDATION_ERROR', parsed.error.issues[0]?.message || 'Dữ liệu ảnh không hợp lệ.', 400);
        }
        const res = await addProjectPhoto(auth.user, requestId, parsed.data);
        return jsonSuccess(res, 201);
      }

      if (!hasBaPermission(auth.user.roleCode, 'AI_DESIGN')) {
        return jsonError(
          'FORBIDDEN_PERMISSION',
          'Chỉ Designer hoặc Quản trị viên (quyền AI_DESIGN) mới được lưu bản phối cảnh hoặc bản vẽ hoàn thiện.',
          403
        );
      }

      if (action === 'save_composited_version') {
        const b64 = String(raw.base64Data || '');
        if (!b64) {
          return jsonError('VALIDATION_ERROR', 'Dữ liệu ảnh bản ghép 3D không được để trống.', 400);
        }
        const res = await saveCompositedDraftVersion(auth.user, requestId, {
          fileName: String(raw.fileName || `studio-composite-req-${requestId}.png`),
          mimeType: String(raw.mimeType || 'image/png'),
          buffer: Buffer.from(b64, 'base64'),
          note: raw.note ? String(raw.note) : undefined,
          placementQuad: raw.placementQuad as any,
        });
        return jsonSuccess(res, 201);
      }

      if (action === 'auto_detect_led_placement') {
        const parsedAuto = AutoDetectLedPlacementRequestSchema.safeParse(raw);
        if (!parsedAuto.success) {
          return jsonError(
            'VALIDATION_ERROR',
            parsedAuto.error.issues[0]?.message || 'Tham số nhận diện vị trí LED không hợp lệ.',
            400
          );
        }
        const res = await autoDetectLedPlacement(auth.user, requestId, parsedAuto.data);
        return jsonSuccess(res, 200);
      }

      if (action === 'quick_install_led') {
        const parsedQuick = LedQuickInstallRequestSchema.safeParse(raw);
        if (!parsedQuick.success) {
          return jsonError(
            'VALIDATION_ERROR',
            parsedQuick.error.issues[0]?.message || 'Thông số gắn màn LED nhanh không hợp lệ.',
            400
          );
        }
        const res = await executeQuickLedInstall(auth.user, requestId, parsedQuick.data);
        return jsonSuccess(res, 201);
      }

      if (action === 'generate_led_screen_content') {
        const parsedContent = GenerateLedScreenContentRequestSchema.safeParse(raw);
        if (!parsedContent.success) {
          return jsonError(
            'VALIDATION_ERROR',
            parsedContent.error.issues[0]?.message || 'Mô tả nội dung hiển thị màn LED không hợp lệ.',
            400
          );
        }
        const res = await generateLedScreenContent(auth.user, requestId, parsedContent.data);
        return jsonSuccess(res, 200);
      }

      // Final render upload via JSON base64
      const buffer = raw.base64Data
        ? Buffer.from(String(raw.base64Data), 'base64')
        : Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkWPjfDwAEgQH532y8kAAAAABJRU5ErkJggg==',
          'base64'
        );

      const res = await uploadDesignerFinalRender(auth.user, requestId, {
        fileName: String(raw.fileName || `final-render-req-${requestId}.png`),
        mimeType: String(raw.mimeType || 'image/png'),
        buffer,
        note: raw.note ? String(raw.note) : undefined,
      });
      return jsonSuccess(res, 201);
    }

    // Handle Multipart Form Data
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file');
      const action = String(form.get('action') || 'upload_final');
      const note = String(form.get('note') || '');

      if (!file || !(file instanceof File)) {
        return jsonError('VALIDATION_ERROR', 'Vui lòng chọn tệp để tải lên.', 400);
      }

      const arrayBuf = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);

      if (action === 'add_photo') {
        if (!hasBaPermission(auth.user.roleCode, 'ATTACHMENT_UPLOAD_VIEW')) {
          return jsonError(
            'FORBIDDEN_PERMISSION',
            'Tài khoản không có quyền tải ảnh hiện trạng công trình.',
            403
          );
        }
        const photo = await addProjectPhoto(auth.user, requestId, {
          photoName: file.name,
          fileName: file.name,
          mimeType: file.type || 'image/jpeg',
          base64Data: buffer.toString('base64'),
        });
        return jsonSuccess(photo, 201);
      }

      if (!hasBaPermission(auth.user.roleCode, 'AI_DESIGN')) {
        return jsonError(
          'FORBIDDEN_PERMISSION',
          'Chỉ Designer hoặc Quản trị viên (quyền AI_DESIGN) mới được tải bản vẽ hoàn thiện.',
          403
        );
      }

      const res = await uploadDesignerFinalRender(auth.user, requestId, {
        fileName: file.name,
        mimeType: file.type || 'image/png',
        buffer,
        note,
      });
      return jsonSuccess(res, 201);
    }

    return jsonError('BAD_REQUEST', 'Content-Type không được hỗ trợ.', 400);
  } catch (err) {
    if (err instanceof ForbiddenDesignProjectAccessError) {
      return jsonError('FORBIDDEN_PROJECT_ACCESS', err.message, 403);
    }
    return jsonError(
      'OPERATION_FAILED',
      err instanceof Error ? err.message : 'Thao tác tệp thất bại.',
      400
    );
  }
}

export async function DELETE(
  req: Request,
  context: { params: { id: string } }
) {
  const auth = await requirePermissionSession(req, 'AI_DESIGN');
  if (!auth.ok) return auth.response;

  const requestId = Number(context.params.id);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return jsonError('INVALID_ID', 'Mã yêu cầu không hợp lệ.', 400);
  }

  const { searchParams } = new URL(req.url);
  const photoId = searchParams.get('photoId');
  const versionIdParam = searchParams.get('versionId');

  try {
    if (versionIdParam) {
      const versionId = Number(versionIdParam);
      if (!Number.isInteger(versionId) || versionId <= 0) {
        return jsonError('INVALID_VERSION_ID', 'Mã phiên bản cần xóa không hợp lệ.', 400);
      }
      const res = await deleteDesignAssetVersion(auth.user, requestId, versionId);
      return jsonSuccess(res);
    }
    if (!photoId) {
      const res = await deleteDesignProject(auth.user, requestId);
      return jsonSuccess(res);
    }
    const res = await deleteProjectPhoto(auth.user, requestId, photoId);
    return jsonSuccess(res);
  } catch (err) {
    if (err instanceof ForbiddenDesignProjectAccessError) {
      return jsonError('FORBIDDEN_PROJECT_ACCESS', err.message, 403);
    }
    return jsonError('DELETE_FAILED', err instanceof Error ? err.message : 'Xóa thất bại.', 400);
  }
}
