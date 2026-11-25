import { jsonError, jsonSuccess } from '../../../../../core/http';
import { requirePermissionSession } from '../../../../../core/permissions';
import { bumpDomainRevisions } from '../../../../../core/cache/server-data-cache';
import {
  generateSeoAiReportFromSnapshot,
  listSeoAiReports,
  updateSeoAiReportEditedContent,
} from '../../../../../modules/03-keywords-ads/seo-report.service';

export async function GET(req: Request) {
  const auth = await requirePermissionSession(req, 'AI_MARKETING_SEO');
  if (!auth.ok) return auth.response;

  try {
    const reports = await listSeoAiReports();
    return jsonSuccess({ reports });
  } catch (err) {
    return jsonError(
      'SEO_REPORTS_LIST_FAILED',
      err instanceof Error ? err.message : 'Không thể tải lịch sử báo cáo SEO AI.',
      500,
    );
  }
}

export async function POST(req: Request) {
  const auth = await requirePermissionSession(req, 'AI_MARKETING_SEO');
  if (!auth.ok) return auth.response;
  if (auth.user.roleCode === 'ADS') {
    return jsonError(
      'FORBIDDEN_ADS_READONLY_SEO',
      'Theo quy định UC05 A4, nhân sự Ads chỉ có quyền xem báo cáo từ khóa/SEO, không được tạo mới báo cáo SEO AI.',
      403,
    );
  }

  try {
    const body = (await req.json()) as {
      website?: string;
      periodDays?: number;
      endDate?: string;
    };
    const report = await generateSeoAiReportFromSnapshot({
      user: auth.user,
      website: body.website || 'all',
      periodDays: Number(body.periodDays) || 30,
      endDate: body.endDate,
    });
    return jsonSuccess({ report }, 201);
  } catch (err) {
    return jsonError(
      'SEO_REPORT_CREATE_FAILED',
      err instanceof Error ? err.message : 'Không thể tạo báo cáo SEO AI.',
      500,
    );
  }
}

export async function PATCH(req: Request) {
  const auth = await requirePermissionSession(req, 'AI_MARKETING_SEO');
  if (!auth.ok) return auth.response;
  if (auth.user.roleCode === 'ADS') {
    return jsonError(
      'FORBIDDEN_ADS_READONLY_SEO',
      'Theo quy định UC05 A4, nhân sự Ads chỉ có quyền xem báo cáo SEO AI, không được chỉnh sửa nội dung SEO.',
      403,
    );
  }

  try {
    const body = (await req.json()) as {
      reportId?: string;
      editedContent?: string;
    };
    if (!body.reportId || typeof body.editedContent !== 'string') {
      return jsonError('INVALID_INPUT', 'Thiếu reportId hoặc nội dung chỉnh sửa.', 400);
    }
    const updated = await updateSeoAiReportEditedContent({
      reportId: body.reportId,
      editedContent: body.editedContent,
    });
    if (!updated) {
      return jsonError('NOT_FOUND', 'Không tìm thấy báo cáo SEO AI.', 404);
    }
    bumpDomainRevisions(['seo_reports', 'ads', 'reports'], 'update_seo_ai_report');
    return jsonSuccess({ report: updated });
  } catch (err) {
    return jsonError(
      'SEO_REPORT_UPDATE_FAILED',
      err instanceof Error ? err.message : 'Không thể lưu chỉnh sửa báo cáo SEO AI.',
      500,
    );
  }
}
