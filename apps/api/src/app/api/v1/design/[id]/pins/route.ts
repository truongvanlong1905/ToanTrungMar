import crypto from 'node:crypto';
import { prisma } from '@toantrung/database';
import { containsCustomerPiiInPrompt } from '@toantrung/contracts';
import { jsonError, jsonSuccess } from '../../../../../../core/http';
import { requireAuthenticatedSession } from '../../../../../../core/permissions';
import { bumpDomainRevisions } from '../../../../../../core/cache/server-data-cache';
import {
  ForbiddenDesignProjectAccessError,
  assertCanAccessDesignProject,
} from '../../../../../../modules/05-ai-design/access-control';

export const dynamic = 'force-dynamic';

export interface DesignVisualPinDto {
  id: string;
  xPct: number;
  yPct: number;
  versionId: number | null;
  comment: string;
  resolved: boolean;
  authorId: number;
  authorName: string;
  authorRole: string;
  createdAt: string;
  resolvedAt?: string | null;
}

function pinSettingKey(requestId: number): string {
  return `design_visual_pins_${requestId}`;
}

async function readPinsForProject(requestId: number): Promise<DesignVisualPinDto[]> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: pinSettingKey(requestId) },
  });
  if (!row?.value) return [];
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? (parsed as DesignVisualPinDto[]) : [];
  } catch {
    return [];
  }
}

async function writePinsForProject(
  requestId: number,
  pins: DesignVisualPinDto[],
  actorUserId: number,
): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: pinSettingKey(requestId) },
    update: {
      value: JSON.stringify(pins),
      updatedById: actorUserId,
    },
    create: {
      key: pinSettingKey(requestId),
      value: JSON.stringify(pins),
      updatedById: actorUserId,
    },
  });
}

export async function GET(
  req: Request,
  context: { params: { id: string } },
) {
  const auth = await requireAuthenticatedSession(req, { requireCsrf: false });
  if (!auth.ok) return auth.response;

  const requestId = Number(context.params.id);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return jsonError('INVALID_ID', 'Mã dự án thiết kế không hợp lệ.', 400);
  }

  try {
    await assertCanAccessDesignProject(auth.user, requestId);
  } catch (err) {
    if (err instanceof ForbiddenDesignProjectAccessError) {
      return jsonError('FORBIDDEN', err.message, 403);
    }
    return jsonError('NOT_FOUND', 'Không tìm thấy dự án thiết kế.', 404);
  }

  const pins = await readPinsForProject(requestId);
  return jsonSuccess({ pins });
}

export async function POST(
  req: Request,
  context: { params: { id: string } },
) {
  const auth = await requireAuthenticatedSession(req, { requireCsrf: true });
  if (!auth.ok) return auth.response;

  const requestId = Number(context.params.id);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return jsonError('INVALID_ID', 'Mã dự án thiết kế không hợp lệ.', 400);
  }

  try {
    await assertCanAccessDesignProject(auth.user, requestId);
  } catch (err) {
    if (err instanceof ForbiddenDesignProjectAccessError) {
      return jsonError('FORBIDDEN', err.message, 403);
    }
    return jsonError('NOT_FOUND', 'Không tìm thấy dự án thiết kế.', 404);
  }

  let body: {
    action?: 'add' | 'toggle_resolve' | 'delete';
    pinId?: string;
    xPct?: number;
    yPct?: number;
    versionId?: number | null;
    comment?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonError('INVALID_JSON', 'Dữ liệu ghim nhận xét không hợp lệ.', 400);
  }

  const currentPins = await readPinsForProject(requestId);
  const action = body.action || 'add';

  if (action === 'add') {
    const comment = (body.comment || '').trim().slice(0, 300);
    if (!comment) {
      return jsonError('MISSING_COMMENT', 'Vui lòng nhập nội dung ghi chú chỉnh sửa trên ảnh.', 400);
    }
    const pii = containsCustomerPiiInPrompt(comment);
    if (pii.hasPii) {
      return jsonError(
        'PII_BLOCKED',
        pii.reason || 'Không ghi SĐT/Email khách hàng lên ghim thiết kế.',
        400,
      );
    }

    const xPct = Math.min(98, Math.max(2, Number(body.xPct) || 50));
    const yPct = Math.min(98, Math.max(2, Number(body.yPct) || 50));

    const newPin: DesignVisualPinDto = {
      id: `pin-${crypto.randomUUID().slice(0, 8)}`,
      xPct: Number(xPct.toFixed(2)),
      yPct: Number(yPct.toFixed(2)),
      versionId: body.versionId ?? null,
      comment,
      resolved: false,
      authorId: auth.user.id,
      authorName: auth.user.fullName,
      authorRole: auth.user.roleName,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    };

    const nextPins = [...currentPins, newPin].slice(-50);
    await writePinsForProject(requestId, nextPins, auth.user.id);
    bumpDomainRevisions(['design'], 'visual_pin_added');
    return jsonSuccess({ pins: nextPins, created: newPin });
  }

  if (action === 'toggle_resolve' && body.pinId) {
    const nextPins = currentPins.map((p) =>
      p.id === body.pinId
        ? {
            ...p,
            resolved: !p.resolved,
            resolvedAt: !p.resolved ? new Date().toISOString() : null,
          }
        : p,
    );
    await writePinsForProject(requestId, nextPins, auth.user.id);
    bumpDomainRevisions(['design'], 'visual_pin_toggled');
    return jsonSuccess({ pins: nextPins });
  }

  if (action === 'delete' && body.pinId) {
    const nextPins = currentPins.filter((p) => p.id !== body.pinId);
    await writePinsForProject(requestId, nextPins, auth.user.id);
    bumpDomainRevisions(['design'], 'visual_pin_deleted');
    return jsonSuccess({ pins: nextPins });
  }

  return jsonError('UNKNOWN_ACTION', 'Thao tác ghim không hợp lệ.', 400);
}
