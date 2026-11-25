import { prisma } from '@toantrung/database';
import { hasBaPermission, type RoleCode } from '@toantrung/contracts';
import { jsonError, jsonSuccess } from '../../../../../core/http';
import {
  bumpDomainRevisions,
  getOrComputeScopedCache,
} from '../../../../../core/cache/server-data-cache';
import { requireAuthenticatedSession } from '../../../../../core/permissions';
import {
  buildZeroPiiHandoverBrief,
  evaluateLedB2bSeoArticle,
} from '../../../../../core/ai/zero-pii-copilot.service';
import { listLeadsForUser } from '../../../../../modules/01-leads/service';

export const dynamic = 'force-dynamic';

const FINOPS_BUDGET_KEY = 'ai_finops_budget_v1';

interface AiFinOpsBudgetConfig {
  dailyLimitMicrosUsd: number;
  monthlyLimitMicrosUsd: number;
  updatedAt: string | null;
}

function canViewAiTokenAndFinOps(roleCode: RoleCode): boolean {
  return (
    roleCode === 'ADMIN' ||
    roleCode === 'BOD' ||
    hasBaPermission(roleCode, 'AI_DESIGN') ||
    hasBaPermission(roleCode, 'AI_MARKETING_SEO')
  );
}

async function readFinOpsBudget(): Promise<AiFinOpsBudgetConfig> {
  const row = await prisma.systemSetting.findUnique({ where: { key: FINOPS_BUDGET_KEY } });
  if (!row?.value) {
    return {
      dailyLimitMicrosUsd: 5_000_000, // $5.00/day default cap
      monthlyLimitMicrosUsd: 100_000_000, // $100.00/month default cap
      updatedAt: null,
    };
  }
  try {
    const parsed = JSON.parse(row.value) as Partial<AiFinOpsBudgetConfig>;
    return {
      dailyLimitMicrosUsd: Number(parsed.dailyLimitMicrosUsd) || 5_000_000,
      monthlyLimitMicrosUsd: Number(parsed.monthlyLimitMicrosUsd) || 100_000_000,
      updatedAt: parsed.updatedAt || row.updatedAt.toISOString(),
    };
  } catch {
    return {
      dailyLimitMicrosUsd: 5_000_000,
      monthlyLimitMicrosUsd: 100_000_000,
      updatedAt: null,
    };
  }
}

export async function GET(req: Request) {
  const auth = await requireAuthenticatedSession(req, { requireCsrf: false });
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const mode = (url.searchParams.get('mode') || 'finops').trim();

  if (mode === 'finops') {
    if (!canViewAiTokenAndFinOps(auth.user.roleCode)) {
      return jsonError(
        'FORBIDDEN',
        'Chỉ nhân sự sử dụng AI (Thiết kế / Marketing / Ads), Ban Giám đốc (BOD) và Quản trị viên (ADMIN) có quyền xem thống kê Token & chi phí AI.',
        403,
      );
    }

    const moduleFilterRaw = (url.searchParams.get('module') || 'all').trim();
    const moduleFilter =
      moduleFilterRaw === '05-ai-design' || moduleFilterRaw === '03-keywords-ads'
        ? moduleFilterRaw
        : 'all';

    const cached = await getOrComputeScopedCache({
      key: `ai_finops_tokens_v2:u:${auth.user.id}:r:${auth.user.roleCode}:m:${moduleFilter}`,
      domains: ['design', 'ads', 'seo_articles', 'reports'],
      ttlMs: 8_000,
      compute: async () => {
        const now = new Date();
        const startOfToday = new Date(now);
        startOfToday.setHours(0, 0, 0, 0);
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        const baseWhere =
          moduleFilter === 'all'
            ? { createdAt: { gte: startOfMonth } }
            : { createdAt: { gte: startOfMonth }, moduleCode: moduleFilter };

        const todayWhere =
          moduleFilter === 'all'
            ? { createdAt: { gte: startOfToday } }
            : { createdAt: { gte: startOfToday }, moduleCode: moduleFilter };

        const [
          budget,
          monthAgg,
          todayAgg,
          successCount,
          myMonthAgg,
          myTodayAgg,
          groupedModels,
          groupedModelSuccess,
          recentRows,
        ] = await Promise.all([
          readFinOpsBudget(),
          prisma.aiUsageLog.aggregate({
            where: baseWhere,
            _count: { _all: true, durationMs: true, totalTokens: true },
            _sum: {
              promptTokens: true,
              completionTokens: true,
              totalTokens: true,
              costMicros: true,
              durationMs: true,
            },
          }),
          prisma.aiUsageLog.aggregate({
            where: todayWhere,
            _count: { _all: true },
            _sum: {
              promptTokens: true,
              completionTokens: true,
              totalTokens: true,
              costMicros: true,
            },
          }),
          prisma.aiUsageLog.count({
            where: { ...baseWhere, status: 'success' },
          }),
          prisma.aiUsageLog.aggregate({
            where: { ...baseWhere, userId: auth.user.id },
            _count: { _all: true },
            _sum: {
              promptTokens: true,
              completionTokens: true,
              totalTokens: true,
              costMicros: true,
            },
          }),
          prisma.aiUsageLog.aggregate({
            where: { ...todayWhere, userId: auth.user.id },
            _count: { _all: true },
            _sum: {
              totalTokens: true,
              costMicros: true,
            },
          }),
          prisma.aiUsageLog.groupBy({
            by: ['modelName', 'moduleCode'],
            where: baseWhere,
            _count: { _all: true, totalTokens: true, durationMs: true },
            _sum: {
              promptTokens: true,
              completionTokens: true,
              totalTokens: true,
              costMicros: true,
              durationMs: true,
            },
          }),
          prisma.aiUsageLog.groupBy({
            by: ['modelName', 'moduleCode'],
            where: { ...baseWhere, status: 'success' },
            _count: { _all: true },
          }),
          prisma.aiUsageLog.findMany({
            where: baseWhere,
            orderBy: { createdAt: 'desc' },
            take: 15,
            include: {
              user: { select: { id: true, fullName: true } },
            },
          }),
        ]);

        const successMap = new Map<string, number>();
        for (const s of groupedModelSuccess) {
          successMap.set(`${s.modelName}::${s.moduleCode}`, s._count._all);
        }

        const byModel = groupedModels
          .map((g) => {
            const key = `${g.modelName}::${g.moduleCode}`;
            const calls = g._count._all;
            const succ = successMap.get(key) || 0;
            const durCount = g._count.durationMs || 0;
            const durSum = g._sum.durationMs || 0;
            const costMicros = g._sum.costMicros ? Number(g._sum.costMicros) : 0;
            const tokenReportingCalls = g._count.totalTokens || 0;
            const isLocalZeroCost =
              g.modelName.toLowerCase().includes('toantrung-studio') ||
              g.modelName.toLowerCase().includes('local');

            return {
              modelName: g.modelName,
              moduleCode: g.moduleCode,
              calls,
              successRatePct: calls > 0 ? Math.round((succ / calls) * 100) : 0,
              avgDurationMs: durCount > 0 ? Math.round(durSum / durCount) : 0,
              tokenReportingCalls,
              isLocalZeroCost,
              promptTokens: tokenReportingCalls > 0 ? (g._sum.promptTokens ?? 0) : null,
              completionTokens: tokenReportingCalls > 0 ? (g._sum.completionTokens ?? 0) : null,
              totalTokens: tokenReportingCalls > 0 ? (g._sum.totalTokens ?? 0) : null,
              costMicrosUsd: costMicros,
              costUsdFormatted: `$${(costMicros / 1_000_000).toFixed(4)}`,
            };
          })
          .sort((a, b) => b.calls - a.calls);

        const totalCallsMonth = monthAgg._count._all;
        const durationCount = monthAgg._count.durationMs || 0;
        const durationSum = monthAgg._sum.durationMs || 0;
        const todayMicros = todayAgg._sum.costMicros ? Number(todayAgg._sum.costMicros) : 0;
        const monthMicros = monthAgg._sum.costMicros ? Number(monthAgg._sum.costMicros) : 0;
        const myMonthMicros = myMonthAgg._sum.costMicros ? Number(myMonthAgg._sum.costMicros) : 0;
        const myTodayMicros = myTodayAgg._sum.costMicros ? Number(myTodayAgg._sum.costMicros) : 0;

        const isExecOrAdmin = auth.user.roleCode === 'ADMIN' || auth.user.roleCode === 'BOD';

        const recentLogs = recentRows.map((r) => {
          const micros = r.costMicros ? Number(r.costMicros) : 0;
          const isMine = r.userId === auth.user.id;
          return {
            id: r.id,
            createdAt: r.createdAt.toISOString(),
            moduleCode: r.moduleCode,
            taskType: r.taskType,
            modelName: r.modelName,
            actorLabel: isMine
              ? 'Bạn'
              : isExecOrAdmin
                ? r.user?.fullName || `NV #${r.userId}`
                : 'Đồng nghiệp cùng bộ phận',
            isCurrentUser: isMine,
            promptTokens: r.promptTokens,
            completionTokens: r.completionTokens,
            totalTokens: r.totalTokens,
            durationMs: r.durationMs,
            status: r.status,
            costUsdFormatted: `$${(micros / 1_000_000).toFixed(4)}`,
          };
        });

        return {
          moduleFilter,
          budget,
          myStats: {
            todayCalls: myTodayAgg._count._all,
            todayTokens: myTodayAgg._sum.totalTokens ?? 0,
            todayCostUsdFormatted: `$${(myTodayMicros / 1_000_000).toFixed(4)}`,
            monthCalls: myMonthAgg._count._all,
            monthPromptTokens: myMonthAgg._sum.promptTokens ?? 0,
            monthCompletionTokens: myMonthAgg._sum.completionTokens ?? 0,
            monthTokens: myMonthAgg._sum.totalTokens ?? 0,
            monthCostMicrosUsd: myMonthMicros,
            monthCostUsdFormatted: `$${(myMonthMicros / 1_000_000).toFixed(4)}`,
          },
          summary: {
            totalCallsMonth,
            todayCalls: todayAgg._count._all,
            todayPromptTokens: todayAgg._sum.promptTokens ?? 0,
            todayCompletionTokens: todayAgg._sum.completionTokens ?? 0,
            todayTokens: todayAgg._sum.totalTokens ?? 0,
            monthPromptTokens: monthAgg._sum.promptTokens ?? 0,
            monthCompletionTokens: monthAgg._sum.completionTokens ?? 0,
            monthTokens: monthAgg._sum.totalTokens ?? 0,
            tokenTrackedCallsMonth: monthAgg._count.totalTokens || 0,
            successRatePct:
              totalCallsMonth > 0 ? Math.round((successCount / totalCallsMonth) * 100) : null,
            avgDurationMs: durationCount > 0 ? Math.round(durationSum / durationCount) : null,
            todayCostMicrosUsd: todayMicros,
            todayCostUsdFormatted: `$${(todayMicros / 1_000_000).toFixed(4)}`,
            monthCostMicrosUsd: monthMicros,
            monthCostUsdFormatted: `$${(monthMicros / 1_000_000).toFixed(4)}`,
          },
          byModel,
          recentLogs,
        };
      },
    });

    return jsonSuccess(cached.data);
  }

  return jsonError('UNKNOWN_MODE', 'Tham số truy vấn không hợp lệ.', 400);
}

export async function POST(req: Request) {
  const auth = await requireAuthenticatedSession(req, { requireCsrf: true });
  if (!auth.ok) return auth.response;

  let body: {
    action?: 'handover_brief' | 'seo_score' | 'update_finops_budget';
    leadId?: number;
    articleId?: number;
    title?: string;
    metaDescription?: string;
    targetKeyword?: string;
    targetWebsite?: string;
    contentHtml?: string;
    dailyLimitUsd?: number;
    monthlyLimitUsd?: number;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonError('INVALID_JSON', 'Dữ liệu yêu cầu không hợp lệ.', 400);
  }

  if (body.action === 'handover_brief') {
    if (!hasBaPermission(auth.user.roleCode, 'LEAD_VIEW_OWN')) {
      return jsonError('FORBIDDEN', 'Vai trò hiện tại không có quyền xem tóm tắt bàn giao Lead.', 403);
    }
    const leadId = Number(body.leadId);
    if (!Number.isInteger(leadId) || leadId <= 0) {
      return jsonError('INVALID_LEAD_ID', 'Mã hồ sơ Lead không hợp lệ.', 400);
    }

    const scoped = await listLeadsForUser(auth.user, { includeSpam: true, pageSize: 250 });
    const targetLead = scoped.leads.find((l) => l.id === leadId);
    if (!targetLead) {
      return jsonError('NOT_FOUND_OR_OUT_OF_SCOPE', 'Không tìm thấy Lead trong phạm vi quyền của bạn.', 404);
    }

    const rawNotes = [
      ...(targetLead.activities || [])
        .map((a) => a.noteContent || a.reason || '')
        .filter(Boolean),
    ];

    const brief = buildZeroPiiHandoverBrief({
      leadCode: targetLead.leadCode,
      pipelineStatus: targetLead.pipelineStatus,
      productNames: targetLead.products.map((p) => p.productName),
      projectName: targetLead.projectName,
      province: targetLead.province,
      lostReason: targetLead.lostReason,
      firstQuoteSentAt: targetLead.quoteSentAt,
      quoteRespondedAt: targetLead.quoteRespondedAt,
      receivedConfirmedAt: targetLead.receivedConfirmedAt,
      rawNotes,
    });

    return jsonSuccess({ brief });
  }

  if (body.action === 'seo_score') {
    if (!hasBaPermission(auth.user.roleCode, 'AI_MARKETING_SEO')) {
      return jsonError('FORBIDDEN', 'Vai trò hiện tại không có quyền kiểm định bài viết SEO.', 403);
    }

    let title = body.title || '';
    let metaDescription = body.metaDescription || '';
    let targetKeyword = body.targetKeyword || '';
    let targetWebsite = body.targetWebsite || 'toantrung.com.vn';
    let contentHtml = body.contentHtml || '';

    if (body.articleId && Number.isInteger(Number(body.articleId))) {
      const art = await prisma.seoArticle.findUnique({
        where: { id: Number(body.articleId) },
        include: { keyword: true },
      });
      if (!art) {
        return jsonError('ARTICLE_NOT_FOUND', 'Không tìm thấy bài viết SEO.', 404);
      }
      title = art.title;
      metaDescription = art.metaDescription || '';
      targetKeyword = art.keyword?.keyword || art.topic;
      targetWebsite = art.targetWebsite;
      contentHtml = art.contentHtml;
    }

    const score = evaluateLedB2bSeoArticle({
      title,
      metaDescription,
      targetKeyword,
      targetWebsite,
      contentHtml,
    });

    return jsonSuccess({ score, title, targetKeyword, targetWebsite });
  }

  if (body.action === 'update_finops_budget') {
    if (auth.user.roleCode !== 'ADMIN') {
      return jsonError('FORBIDDEN', 'Chỉ Quản trị viên (ADMIN) có quyền cập nhật hạn mức chi phí AI.', 403);
    }
    const dailyUsd = Math.max(0.5, Math.min(5000, Number(body.dailyLimitUsd) || 5));
    const monthlyUsd = Math.max(dailyUsd, Math.min(50000, Number(body.monthlyLimitUsd) || 100));

    const nextBudget: AiFinOpsBudgetConfig = {
      dailyLimitMicrosUsd: Math.round(dailyUsd * 1_000_000),
      monthlyLimitMicrosUsd: Math.round(monthlyUsd * 1_000_000),
      updatedAt: new Date().toISOString(),
    };

    await prisma.systemSetting.upsert({
      where: { key: FINOPS_BUDGET_KEY },
      update: {
        value: JSON.stringify(nextBudget),
        updatedById: auth.user.id,
      },
      create: {
        key: FINOPS_BUDGET_KEY,
        value: JSON.stringify(nextBudget),
        updatedById: auth.user.id,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: auth.user.id,
        action: 'AI_FINOPS_BUDGET_UPDATED',
        targetType: 'SystemSetting',
        targetId: FINOPS_BUDGET_KEY,
        detailsJson: JSON.stringify(nextBudget),
      },
    });
    bumpDomainRevisions(['design', 'reports'], 'ai_finops_budget_updated');

    return jsonSuccess({ budget: nextBudget });
  }

  return jsonError('UNKNOWN_ACTION', 'Thao tác Trợ lý AI không hợp lệ.', 400);
}
