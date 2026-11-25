import {
  CreateSeoKeywordSchema,
  GenerateSeoDraftByAiSchema,
} from '@toantrung/contracts';
import { jsonError, jsonSuccess } from '../../../../core/http';
import { requirePermissionSession } from '../../../../core/permissions';
import { bumpDomainRevisions } from '../../../../core/cache/server-data-cache';
import {
  createSeoKeyword,
  deleteSeoKeywordById,
  generateSeoArticleDraftByAi,
  listKeywordsAndArticlesForUser,
} from '../../../../modules/03-keywords-ads/service';
import { getM03AdsSeoDashboardSpec } from '../../../../modules/03-keywords-ads/m03-spec.service';

export async function GET(req: Request) {
  const auth = await requirePermissionSession(req, 'AI_MARKETING_SEO');
  if (!auth.ok) return auth.response;

  try {
    const url = new URL(req.url);
    if (url.searchParams.get('view') === 'spec') {
      const minImprRaw = url.searchParams.get('minImpr');
      const maxCtrRaw = url.searchParams.get('maxCtr');
      const compare = url.searchParams.get('compare') === '1';
      const m03 = await getM03AdsSeoDashboardSpec({
        websiteId: url.searchParams.get('websiteId'),
        preset: url.searchParams.get('preset'),
        from: url.searchParams.get('from'),
        to: url.searchParams.get('to'),
        page: Number(url.searchParams.get('page') || 1),
        pageSize: Number(url.searchParams.get('pageSize') || 20),
        contentPage: Number(url.searchParams.get('contentPage') || 1),
        minImpr: minImprRaw ? Number(minImprRaw) : undefined,
        maxCtr: maxCtrRaw ? Number(maxCtrRaw) : undefined,
        compare,
        roleCode: auth.user.roleCode,
      });
      return jsonSuccess(m03);
    }
    const payload = await listKeywordsAndArticlesForUser(auth.user);
    return jsonSuccess(payload);
  } catch (err) {
    return jsonError(
      'SEO_LIST_FAILED',
      err instanceof Error ? err.message : 'Không thể tải dữ liệu Từ khóa & Nội dung SEO.',
      500,
    );
  }
}

export async function POST(req: Request) {
  const auth = await requirePermissionSession(req, 'AI_MARKETING_SEO');
  if (!auth.ok) return auth.response;

  try {
    const raw = (await req.json()) as Record<string, unknown>;
    const action = String(raw.action || 'generate_ai_draft');

    if (action === 'delete_keyword') {
      const kwId = Number(raw.keywordId);
      if (!Number.isInteger(kwId) || kwId <= 0) {
        return jsonError('VALIDATION_ERROR', 'Mã từ khóa cần xoá không hợp lệ.', 400);
      }
      await deleteSeoKeywordById(auth.user, kwId);
      bumpDomainRevisions(['ads', 'seo_articles', 'reports'], 'delete_seo_keyword');
      return jsonSuccess({ deletedId: kwId });
    }

    if (action === 'create_keyword' || action === 'upsert_keyword') {
      const parsed = CreateSeoKeywordSchema.safeParse({
        action: 'create_keyword',
        keywordText: raw.keywordText,
        targetWebsite: raw.targetWebsite || 'toantrung.com.vn',
      });
      if (!parsed.success) {
        return jsonError(
          'VALIDATION_ERROR',
          parsed.error.issues[0]?.message || 'Từ khóa không hợp lệ.',
          400,
        );
      }
      const created = await createSeoKeyword(auth.user, {
        ...parsed.data,
        cachedSearchVolume:
          raw.cachedSearchVolume !== undefined && raw.cachedSearchVolume !== ''
            ? Number(raw.cachedSearchVolume)
            : undefined,
        cachedAdsClicks:
          raw.cachedAdsClicks !== undefined && raw.cachedAdsClicks !== ''
            ? Number(raw.cachedAdsClicks)
            : undefined,
        cachedOrganicClicks:
          raw.cachedOrganicClicks !== undefined && raw.cachedOrganicClicks !== ''
            ? Number(raw.cachedOrganicClicks)
            : undefined,
        cachedAvgPosition:
          raw.cachedAvgPosition !== undefined && raw.cachedAvgPosition !== ''
            ? Number(raw.cachedAvgPosition)
            : undefined,
        trendDirection:
          raw.trendDirection === 'UP' ||
          raw.trendDirection === 'STABLE' ||
          raw.trendDirection === 'DOWN'
            ? raw.trendDirection
            : undefined,
        recommendedPublishWindow:
          typeof raw.recommendedPublishWindow === 'string' && raw.recommendedPublishWindow.trim()
            ? raw.recommendedPublishWindow.trim()
            : undefined,
      });
      bumpDomainRevisions(['ads', 'seo_articles', 'reports'], 'upsert_seo_keyword');
      return jsonSuccess({ id: created.id, keyword: created.keyword }, 201);
    }

    const parsed = GenerateSeoDraftByAiSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message || 'Thông tin tạo bản nháp AI không hợp lệ.',
        400,
      );
    }

    const article = await generateSeoArticleDraftByAi(auth.user, parsed.data);
    bumpDomainRevisions(['ads', 'seo_articles', 'reports'], 'generate_seo_draft');
    return jsonSuccess({ id: article.id, title: article.title }, 201);
  } catch (err) {
    return jsonError(
      'SEO_ACTION_FAILED',
      err instanceof Error ? err.message : 'Thao tác SEO thất bại.',
      400,
    );
  }
}

