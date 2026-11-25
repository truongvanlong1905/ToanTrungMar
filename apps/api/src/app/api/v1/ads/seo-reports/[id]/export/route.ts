import { jsonError } from '../../../../../../../core/http';
import { requirePermissionSession } from '../../../../../../../core/permissions';
import {
  exportSeoReportDocxBuffer,
  exportSeoReportXlsxBuffer,
  listSeoAiReports,
  type SeoAiReportRecord,
} from '../../../../../../../modules/03-keywords-ads/seo-report.service';

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const auth = await requirePermissionSession(req, 'AI_MARKETING_SEO');
  if (!auth.ok) return auth.response;

  try {
    const resolvedParams = await Promise.resolve(context.params);
    const reportId = resolvedParams.id;
    const reports = await listSeoAiReports();
    const report = reports.find((r: SeoAiReportRecord) => r.id === reportId);
    if (!report) {
      return jsonError('NOT_FOUND', 'Không tìm thấy báo cáo SEO AI.', 404);
    }

    const url = new URL(req.url);
    const format = (url.searchParams.get('format') || 'docx').toLowerCase();
    const safeSite = report.website.replace(/[^a-z0-9._-]/gi, '_');

    if (format === 'xlsx') {
      const buf = exportSeoReportXlsxBuffer(report);
      return new Response(new Uint8Array(buf), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="BaoCao_SEO_${safeSite}_${report.id}.xlsx"`,
        },
      });
    }

    const buf = exportSeoReportDocxBuffer(report);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="BaoCao_SEO_${safeSite}_${report.id}.docx"`,
      },
    });
  } catch (err) {
    return jsonError(
      'SEO_REPORT_EXPORT_FAILED',
      err instanceof Error ? err.message : 'Không thể xuất báo cáo SEO.',
      500,
    );
  }
}
