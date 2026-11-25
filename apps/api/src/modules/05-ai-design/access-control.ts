import path from 'node:path';
import { prisma } from '@toantrung/database';
import type { SessionUserDto } from '@toantrung/contracts';
import { APP_CONFIG } from '../../core/config';

export class ForbiddenDesignProjectAccessError extends Error {
  public readonly code = 'FORBIDDEN_PROJECT_ACCESS';
  constructor(message = 'Tài khoản của bạn không có quyền truy cập dự án thiết kế này.') {
    super(message);
    this.name = 'ForbiddenDesignProjectAccessError';
  }
}

export function canUserAccessDesignProject(
  user: SessionUserDto,
  project: {
    id: number;
    requestedBySalesId: number | null;
    assignedDesignerId: number;
    lead?: { assignedSalesId?: number | null; createdByUserId?: number | null } | null;
  }
): boolean {
  if (['ADMIN', 'BOD', 'SALES_LEAD', 'DESIGNER'].includes(user.roleCode)) {
    return true;
  }
  if (user.roleCode === 'SALES') {
    return (
      project.requestedBySalesId === user.id ||
      project.lead?.assignedSalesId === user.id ||
      project.lead?.createdByUserId === user.id
    );
  }
  return false;
}

export async function assertCanAccessDesignProject(
  user: SessionUserDto,
  requestId: number
): Promise<void> {
  const row = await prisma.designRequest.findUnique({
    where: { id: requestId },
    include: {
      lead: {
        select: { assignedSalesId: true, createdByUserId: true },
      },
    },
  });
  if (!row) {
    throw new Error('Không tìm thấy yêu cầu thiết kế.');
  }
  if (!canUserAccessDesignProject(user, row)) {
    throw new ForbiddenDesignProjectAccessError();
  }
}

export async function assertCanAccessStorageObjectKey(
  user: SessionUserDto,
  storageObjectKey: string
): Promise<void> {
  const normalized = storageObjectKey.replace(/\\/g, '/').trim();
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.includes('\0') ||
    normalized.split('/').includes('..') ||
    !/^[a-zA-Z0-9._/-]+$/.test(normalized)
  ) {
    throw new ForbiddenDesignProjectAccessError('Khóa tệp thiết kế không hợp lệ.');
  }

  const rootResolved = path.resolve(APP_CONFIG.getStorageRoot());
  const targetResolved = path.resolve(rootResolved, normalized);
  if (!targetResolved.startsWith(rootResolved + path.sep)) {
    throw new ForbiddenDesignProjectAccessError('Đường dẫn tệp thiết kế vượt ngoài phạm vi cho phép.');
  }

  if (
    normalized.includes('/') &&
    !normalized.startsWith('design/') &&
    !normalized.startsWith('leads/')
  ) {
    throw new ForbiddenDesignProjectAccessError(
      'Không được phép truy cập tệp ngoài kho thiết kế.'
    );
  }

  if (['ADMIN', 'BOD', 'SALES_LEAD', 'DESIGNER'].includes(user.roleCode)) {
    return;
  }
  if (user.roleCode !== 'SALES') {
    throw new ForbiddenDesignProjectAccessError();
  }

  const versionMatch = await prisma.designAssetVersion.findFirst({
    where: { storageObjectKey },
    include: {
      designRequest: {
        include: {
          lead: { select: { assignedSalesId: true, createdByUserId: true } },
        },
      },
    },
  });
  if (versionMatch?.designRequest) {
    if (!canUserAccessDesignProject(user, versionMatch.designRequest)) {
      throw new ForbiddenDesignProjectAccessError();
    }
    return;
  }

  const reqIdMatch = storageObjectKey.match(/req-(\d+)/i);
  if (reqIdMatch) {
    await assertCanAccessDesignProject(user, Number(reqIdMatch[1]));
    return;
  }

  const candidateRequests = await prisma.designRequest.findMany({
    where: {
      OR: [
        { sitePhotoUrl: storageObjectKey },
        { aiDraftImageUrl: storageObjectKey },
        { finalRenderUrl: storageObjectKey },
        { installPositionJson: { contains: storageObjectKey } },
      ],
    },
    include: {
      lead: { select: { assignedSalesId: true, createdByUserId: true } },
    },
    take: 5,
  });

  if (candidateRequests.length === 0) {
    throw new ForbiddenDesignProjectAccessError();
  }

  const allowed = candidateRequests.some((r) => canUserAccessDesignProject(user, r));
  if (!allowed) {
    throw new ForbiddenDesignProjectAccessError();
  }
}
