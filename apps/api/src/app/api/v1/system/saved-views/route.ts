import crypto from 'node:crypto';
import { prisma } from '@toantrung/database';
import type { RoleCode } from '@toantrung/contracts';
import { jsonError, jsonSuccess } from '../../../../../core/http';
import { requireAuthenticatedSession } from '../../../../../core/permissions';

export const dynamic = 'force-dynamic';

export interface SavedSmartViewDto {
  id: string;
  name: string;
  scope: 'leads';
  isSystemPreset?: boolean;
  filters: {
    statusFilter?: string;
    sourceWebsiteFilter?: string;
    overdueOnly?: boolean;
    unreceivedOnly?: boolean;
    specialAlertFilter?: string;
  };
  createdAt: string;
}

function getDefaultPresetsForRole(roleCode: RoleCode): SavedSmartViewDto[] {
  const now = '2026-11-01T00:00:00.000Z';
  if (roleCode === 'MKT_STAFF' || roleCode === 'MKT_LEAD' || roleCode === 'ADS') {
    return [
      {
        id: 'preset-mkt-toantrung',
        name: 'Web toantrung.com.vn',
        scope: 'leads',
        isSystemPreset: true,
        filters: { statusFilter: 'all', sourceWebsiteFilter: 'toantrung.com.vn' },
        createdAt: now,
      },
      {
        id: 'preset-mkt-bangled',
        name: 'Chuyên trang bangled.vn',
        scope: 'leads',
        isSystemPreset: true,
        filters: { statusFilter: 'all', sourceWebsiteFilter: 'bangled.vn' },
        createdAt: now,
      },
      {
        id: 'preset-mkt-quoted',
        name: 'Đã gửi báo giá',
        scope: 'leads',
        isSystemPreset: true,
        filters: { statusFilter: 'quote_sent', sourceWebsiteFilter: 'all' },
        createdAt: now,
      },
    ];
  }

  return [
    {
      id: 'preset-sales-unreceived',
      name: 'Chờ xác nhận tiếp nhận',
      scope: 'leads',
      isSystemPreset: true,
      filters: { statusFilter: 'all', unreceivedOnly: true },
      createdAt: now,
    },
    {
      id: 'preset-sales-overdue',
      name: 'Quá hạn báo giá / Cần gọi gấp',
      scope: 'leads',
      isSystemPreset: true,
      filters: { statusFilter: 'all', overdueOnly: true },
      createdAt: now,
    },
    {
      id: 'preset-sales-quoting',
      name: 'Đang soạn & Đã gửi báo giá',
      scope: 'leads',
      isSystemPreset: true,
      filters: { statusFilter: 'quote_sent', overdueOnly: false },
      createdAt: now,
    },
  ];
}

function settingKeyForUser(userId: number): string {
  return `user_saved_views_${userId}`;
}

async function readUserCustomViews(userId: number): Promise<SavedSmartViewDto[]> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: settingKeyForUser(userId) },
  });
  if (!row?.value) return [];
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? (parsed as SavedSmartViewDto[]) : [];
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  const auth = await requireAuthenticatedSession(req, { requireCsrf: false });
  if (!auth.ok) return auth.response;

  const customViews = await readUserCustomViews(auth.user.id);
  const presets = getDefaultPresetsForRole(auth.user.roleCode);

  return jsonSuccess({
    views: [...presets, ...customViews],
  });
}

export async function POST(req: Request) {
  const auth = await requireAuthenticatedSession(req, { requireCsrf: true });
  if (!auth.ok) return auth.response;

  let body: { name?: string; filters?: SavedSmartViewDto['filters'] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonError('INVALID_JSON', 'Dữ liệu bộ lọc lưu không hợp lệ.', 400);
  }

  const cleanName = (body.name || '').trim().slice(0, 48);
  if (!cleanName) {
    return jsonError('MISSING_NAME', 'Vui lòng đặt tên cho góc nhìn bộ lọc.', 400);
  }

  const existing = await readUserCustomViews(auth.user.id);
  if (existing.length >= 15) {
    return jsonError('LIMIT_REACHED', 'Tối đa 15 góc nhìn cá nhân đã ghim. Hãy xóa bớt thẻ cũ.', 400);
  }

  const newView: SavedSmartViewDto = {
    id: `view-${crypto.randomUUID().slice(0, 8)}`,
    name: cleanName,
    scope: 'leads',
    isSystemPreset: false,
    filters: {
      statusFilter: body.filters?.statusFilter || 'all',
      sourceWebsiteFilter: body.filters?.sourceWebsiteFilter || 'all',
      overdueOnly: Boolean(body.filters?.overdueOnly),
      unreceivedOnly: Boolean(body.filters?.unreceivedOnly),
      specialAlertFilter: body.filters?.specialAlertFilter || 'none',
    },
    createdAt: new Date().toISOString(),
  };

  const nextList = [...existing, newView];
  await prisma.systemSetting.upsert({
    where: { key: settingKeyForUser(auth.user.id) },
    update: {
      value: JSON.stringify(nextList),
      updatedById: auth.user.id,
    },
    create: {
      key: settingKeyForUser(auth.user.id),
      value: JSON.stringify(nextList),
      updatedById: auth.user.id,
    },
  });

  return jsonSuccess({
    saved: newView,
    views: [...getDefaultPresetsForRole(auth.user.roleCode), ...nextList],
  });
}

export async function DELETE(req: Request) {
  const auth = await requireAuthenticatedSession(req, { requireCsrf: true });
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const targetId = (url.searchParams.get('id') || '').trim();
  if (!targetId) {
    return jsonError('MISSING_ID', 'Thiếu mã góc nhìn cần xóa.', 400);
  }

  const existing = await readUserCustomViews(auth.user.id);
  const nextList = existing.filter((v) => v.id !== targetId);

  await prisma.systemSetting.upsert({
    where: { key: settingKeyForUser(auth.user.id) },
    update: {
      value: JSON.stringify(nextList),
      updatedById: auth.user.id,
    },
    create: {
      key: settingKeyForUser(auth.user.id),
      value: JSON.stringify(nextList),
      updatedById: auth.user.id,
    },
  });

  return jsonSuccess({
    views: [...getDefaultPresetsForRole(auth.user.roleCode), ...nextList],
  });
}
