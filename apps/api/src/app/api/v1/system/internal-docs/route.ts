import fs from 'node:fs';
import path from 'node:path';
import { jsonError, jsonSuccess } from '../../../../../core/http';
import { APP_CONFIG } from '../../../../../core/config';
import { requirePermissionSession } from '../../../../../core/permissions';

const ALLOWED_INTERNAL_REPORT_ROLES = new Set([
  'ADMIN',
  'BOD',
  'MKT_LEAD',
  'SALES_LEAD',
]);

function getReportsDir(): string {
  return path.join(APP_CONFIG.getStorageRoot(), 'reports');
}

function sanitizeDocName(rawName: string): string | null {
  const clean = rawName.trim();
  if (!clean || clean.includes('/') || clean.includes('\\') || clean.includes('..') || clean.includes('\0')) {
    return null;
  }
  if (!/^[a-zA-Z0-9._-]+\.(docx|xlsx|pdf)$/i.test(clean)) {
    return null;
  }
  return clean;
}

export async function GET(request: Request) {
  const auth = await requirePermissionSession(request, 'EXPORT_DATA', {
    requireCsrf: false,
  });
  if (!auth.ok) return auth.response;

  if (!ALLOWED_INTERNAL_REPORT_ROLES.has(auth.user.roleCode)) {
    return jsonError(
      'FORBIDDEN_INTERNAL_REPORT',
      'Chỉ Quản trị viên, Ban Giám đốc hoặc Trưởng phòng mới được truy cập tài liệu báo cáo nội bộ.',
      403,
    );
  }

  const reportsDir = getReportsDir();
  const url = new URL(request.url);
  const fileParam = url.searchParams.get('file');

  if (!fileParam) {
    const files = fs.existsSync(reportsDir)
      ? fs
          .readdirSync(reportsDir, { withFileTypes: true })
          .filter((d) => d.isFile() && /\.(docx|xlsx|pdf)$/i.test(d.name))
          .map((d) => {
            const st = fs.statSync(path.join(reportsDir, d.name));
            return {
              fileName: d.name,
              sizeBytes: st.size,
              updatedAt: st.mtime.toISOString(),
            };
          })
      : [];
    return jsonSuccess({ files });
  }

  const safeName = sanitizeDocName(fileParam);
  if (!safeName) {
    return jsonError('INVALID_FILE_NAME', 'Tên tài liệu không hợp lệ.', 400);
  }

  const fullPath = path.resolve(reportsDir, safeName);
  const resolvedRoot = path.resolve(reportsDir);
  if (!fullPath.startsWith(resolvedRoot + path.sep) || !fs.existsSync(fullPath)) {
    return jsonError('NOT_FOUND', 'Không tìm thấy tài liệu nội bộ.', 404);
  }

  const buf = fs.readFileSync(fullPath);
  const ext = path.extname(safeName).toLowerCase();
  const contentType =
    ext === '.docx'
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : ext === '.xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/pdf';

  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${safeName}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
