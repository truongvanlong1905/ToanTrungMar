import {
  CreateProductCatalogItemSchema,
  UpdateProductCatalogItemSchema,
  hasBaPermission,
} from '@toantrung/contracts';
import { jsonError, jsonSuccess } from '../../../../../core/http';
import { requirePermissionSession } from '../../../../../core/permissions';
import {
  createProductCatalogItem,
  listProductCatalogWithGroups,
  updateProductCatalogItem,
} from '../../../../../modules/01-leads/service';

export async function GET(req: Request) {
  const auth = await requirePermissionSession(req, 'LEAD_VIEW_OWN');
  if (!auth.ok) return auth.response;

  try {
    const url = new URL(req.url);
    const wantsInactive = url.searchParams.get('includeInactive') === '1';
    const includeInactive = wantsInactive && hasBaPermission(auth.user.roleCode, 'SYSTEM_USER_ADMIN');
    const result = await listProductCatalogWithGroups(includeInactive);
    return jsonSuccess(result);
  } catch (err) {
    return jsonError(
      'PRODUCT_CATALOG_LIST_FAILED',
      err instanceof Error ? err.message : 'Không thể tải danh mục sản phẩm.',
      500,
    );
  }
}

export async function POST(req: Request) {
  const auth = await requirePermissionSession(req, 'SYSTEM_USER_ADMIN');
  if (!auth.ok) return auth.response;

  try {
    const raw = await req.json();
    const parsed = CreateProductCatalogItemSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message || 'Thông tin sản phẩm mới không hợp lệ.',
        400,
      );
    }
    const created = await createProductCatalogItem(auth.user, parsed.data);
    return jsonSuccess(created, 201);
  } catch (err) {
    return jsonError(
      'PRODUCT_CATALOG_CREATE_FAILED',
      err instanceof Error ? err.message : 'Không thể thêm sản phẩm vào danh mục.',
      400,
    );
  }
}

export async function PATCH(req: Request) {
  const auth = await requirePermissionSession(req, 'SYSTEM_USER_ADMIN');
  if (!auth.ok) return auth.response;

  try {
    const raw = await req.json();
    const parsed = UpdateProductCatalogItemSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message || 'Thông tin cập nhật sản phẩm không hợp lệ.',
        400,
      );
    }
    const updated = await updateProductCatalogItem(auth.user, parsed.data);
    return jsonSuccess(updated);
  } catch (err) {
    return jsonError(
      'PRODUCT_CATALOG_UPDATE_FAILED',
      err instanceof Error ? err.message : 'Không thể cập nhật sản phẩm.',
      400,
    );
  }
}
