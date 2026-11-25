/**
 * Module 05: Hỗ trợ Thiết kế & Phối cảnh AI (UC06) Service
 * Owner: Nhóm 5 (05-ai-design)
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  prisma,
  ConcurrencyConflictError,
  recordAiUsageAttempt,
} from '@toantrung/database';
import { APP_CONFIG } from '../../core/config';
import {
  DESIGN_TASK_LABELS,
  LED_SCREEN_SHAPE_META,
  containsCustomerPiiInPrompt,
  sanitizeProjectOrSubjectText,
  toMonetaryAmountDto,
  type AddProjectPhotoDto,
  type AiProviderId,
  type ApproveDesignVersionDto,
  type AutoDetectLedPlacementRequestDto,
  type ChatDesignRequestDto,
  type ConfigureAiProvidersDto,
  type CreateDesignRequestDto,
  type DesignActiveJobDto,
  type DesignAssetVersionItemDto,
  type DesignBriefDto,
  type DesignChatMessageDto,
  type DesignRequestItemDto,
  type DesignStatus,
  type DesignTaskCode,
  type DesignType,
  type GenerateLedScreenContentRequestDto,
  type LedProductSpecDto,
  type LedQuickInstallRequestDto,
  type LedScreenInstanceDto,
  type LedScreenShapeType,
  type MarketingBriefSubmitDto,
  type ProjectPhotoItemDto,
  type QuadCoordinatesDto,
  type RegenerateDesignDraftDto,
  type SessionUserDto,
  type UpdateDesignProjectDto,
} from '@toantrung/contracts';
import {
  deletePrivateBusinessFile,
  readPrivateBusinessFile,
  resolvePrivateBusinessFilePath,
  savePrivateBusinessFile,
} from '../../core/storage/private-files.service';
import {
  bumpDomainRevisions,
  getOrComputeScopedCache,
} from '../../core/cache/server-data-cache';
import { upsertActionableNotification } from '../../core/notifications/service';
import {
  acquireDurableJobLease,
  releaseDurableJobLease,
} from '../../core/jobs/durable-lease';
import { notifyLeadSalesOnDesignCompleted } from '../01-leads/service';
import {
  AiDesignProviderFactory,
  AiModelRegistryService,
  resolveEffectiveProviderCredential,
  type ProviderStatusInfo,
} from './providers';
import {
  routeDesignCommand,
  validateCommandReadiness,
} from './command-router';
import {
  formatVietnamNowLabel,
  gatherLiveWebGrounding,
} from './live-web-grounding';
import {
  createInitialDesignContext,
  extractAndMergeUserChatContext,
  summarizeDesignContextForAssistant,
  type CompositingProtectionMode,
  type ProjectDesignContext,
} from './design-context';
import {
  buildVerifiedLedProductSpecDto,
  evaluateLedTechnicalConfig,
} from './led-technical.engine';
import {
  processBannerToTargetResolution,
  renderBrandLayoutOverlayOnImage,
  renderPerspectiveCompositeWithProtection,
  validateGeneratedImageBuffer,
} from './perspective-compositor';
import {
  applyPostAiPixelGuard,
  canonicalizeQuad,
  generateFeatheredAlphaMaskPng,
} from './led-homography';
import {
  buildFallbackAutoSnapAroundPoint,
  buildLedScreenContentPrompt,
  buildMaskedLedInpaintPrompt,
  buildVisionAutoSnapPrompt,
  parseVisionAutoSnapResponse,
  recordApprovedLedPattern,
  type VisionAutoSnapResult,
} from './led-placement-playbook';

async function getNextDesignAssetVersionNumber(designRequestId: number): Promise<number> {
  const latest = await prisma.designAssetVersion.findFirst({
    where: { designRequestId },
    orderBy: { versionNumber: 'desc' },
    select: { versionNumber: true },
  });
  return (latest?.versionNumber ?? 0) + 1;
}

export async function createDesignAssetVersionSafe(
  designRequestId: number,
  buildData: (
    versionNumber: number
  ) => Parameters<typeof prisma.designAssetVersion.create>[0]['data']
) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const versionNumber = await getNextDesignAssetVersionNumber(designRequestId);
    try {
      return await prisma.designAssetVersion.create({
        data: buildData(versionNumber),
      });
    } catch (err: unknown) {
      const code = (err as { code?: string } | null)?.code;
      if (code === 'P2002' && attempt < 4) {
        continue;
      }
      throw err;
    }
  }
  throw new Error('Không thể cấp số phiên bản thiết kế mới do xung đột đồng thời.');
}

// Default fallback image only when required by internal provider execution
const DEFAULT_SHOWROOM_PHOTO = '/brand/toantrung-led-wall.png';

// Default 4-corner placement quadrilateral matching reference screenshot (right wall of showroom)
const DEFAULT_PLACEMENT_QUAD: QuadCoordinatesDto = {
  topLeft: { x: 64.2, y: 44.5 },
  topRight: { x: 93.8, y: 45.2 },
  bottomRight: { x: 94.5, y: 72.8 },
  bottomLeft: { x: 64.5, y: 70.1 },
};

function mapDbRequestTypeToDto(dbType: string): DesignType {
  return dbType === 'banner' ? 'banner' : 'perspective_3d';
}

function mapDbStatusToDto(dbStatus: string): DesignStatus {
  if (dbStatus === 'completed') return 'completed';
  if (dbStatus === 'in_review') return 'in_review';
  if (dbStatus === 'ai_drafting' || dbStatus === 'ai_drafted') return 'ai_drafted';
  return 'pending';
}

function parseDimensions(dimStr: string | null): {
  screenWidthM: number | null;
  screenHeightM: number | null;
  bannerWidthPx: number | null;
  bannerHeightPx: number | null;
} {
  if (!dimStr) {
    return {
      screenWidthM: null,
      screenHeightM: null,
      bannerWidthPx: null,
      bannerHeightPx: null,
    };
  }
  const pxMatch = dimStr.match(/(\d+)\s*x\s*(\d+)\s*px/i);
  if (pxMatch) {
    return {
      screenWidthM: null,
      screenHeightM: null,
      bannerWidthPx: Number(pxMatch[1]),
      bannerHeightPx: Number(pxMatch[2]),
    };
  }
  const mMatch = dimStr.match(/([\d.,]+)\s*m?\s*x\s*(?:Cao\s*)?([\d.,]+)\s*m/i);
  if (mMatch) {
    return {
      screenWidthM: Number(mMatch[1].replace(',', '.')),
      screenHeightM: Number(mMatch[2].replace(',', '.')),
      bannerWidthPx: null,
      bannerHeightPx: null,
    };
  }
  return {
    screenWidthM: null,
    screenHeightM: null,
    bannerWidthPx: null,
    bannerHeightPx: null,
  };
}

export function computeLedProductSpec(params: {
  productId?: number;
  productCode?: string;
  productName?: string;
  categoryGroup?: string;
  widthM?: number;
  heightM?: number;
  pitch?: string;
  screenStyle?: 'flat' | 'curved' | 'corner_90';
  cabinetModelCode?: string | null;
}): LedProductSpecDto {
  return buildVerifiedLedProductSpecDto(params);
}

export interface StoredMetadata {
  projectName?: string;
  contactName?: string | null;
  installationInfo?: string | null;
  productId?: number | null;
  taskCode?: DesignTaskCode | null;
  designBrief?: DesignBriefDto | null;
  websiteId?: string | null;
  websiteDomain?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  contentId?: number | null;
  sourceModule?: string | null;
  pixelPitch?: string;
  cabinetModelCode?: string | null;
  compositingMode?: CompositingProtectionMode;
  screenStyle?: 'flat' | 'curved' | 'corner_90';
  screenWidthM?: number;
  screenHeightM?: number;
  bannerWidthPx?: number;
  bannerHeightPx?: number;
  aspectLocked?: boolean;
  isArchived?: boolean;
  photos?: ProjectPhotoItemDto[];
  placementQuad?: QuadCoordinatesDto;
  ledScreens?: LedScreenInstanceDto[];
  chatMessages?: DesignChatMessageDto[];
  productSpec?: LedProductSpecDto;
  designContext?: ProjectDesignContext;
  activeJob?: DesignActiveJobDto | null;
  processedIdempotencyKeys?: Record<
    string,
    { versionId: number; versionNumber: number; timestamp: string }
  >;
}

export function parseProjectMetadata(jsonStr: string | null): StoredMetadata {
  if (!jsonStr) return {};
  try {
    return JSON.parse(jsonStr) as StoredMetadata;
  } catch {
    return {};
  }
}

import {
  ForbiddenDesignProjectAccessError,
  assertCanAccessDesignProject,
  assertCanAccessStorageObjectKey,
  canUserAccessDesignProject,
} from './access-control';

export {
  ForbiddenDesignProjectAccessError,
  assertCanAccessDesignProject,
  assertCanAccessStorageObjectKey,
  canUserAccessDesignProject,
};

async function cleanupUnusedDesignStorageKeys(keys: Array<string | null | undefined>): Promise<void> {
  const uniqueKeys = Array.from(
    new Set(
      keys
        .map((k) => (typeof k === 'string' ? k.trim() : ''))
        .filter((k) => k.length > 0 && !k.startsWith('http://') && !k.startsWith('https://'))
    )
  );
  for (const key of uniqueKeys) {
    const [versionRefCount, requestRefCount] = await Promise.all([
      prisma.designAssetVersion.count({ where: { storageObjectKey: key } }),
      prisma.designRequest.count({
        where: {
          OR: [
            { sitePhotoUrl: key },
            { aiDraftImageUrl: key },
            { finalRenderUrl: key },
            { installPositionJson: { contains: key } },
          ],
        },
      }),
    ]);
    if (versionRefCount === 0 && requestRefCount === 0) {
      deletePrivateBusinessFile(key);
    }
  }
}

const DESIGN_REQUEST_INCLUDE = {
  lead: true,
  requestedBySales: true,
  assignedDesigner: true,
  assetVersions: {
    include: {
      uploadedBy: true,
      aiUsageLog: true,
    },
    orderBy: { versionNumber: 'asc' as const },
  },
} as const;

async function findSingleDesignRequestRow(requestId: number) {
  return prisma.designRequest.findUnique({
    where: { id: requestId },
    include: DESIGN_REQUEST_INCLUDE,
  });
}

type DesignRequestFullRow = NonNullable<Awaited<ReturnType<typeof findSingleDesignRequestRow>>>;

interface CachedAssetFileMeta {
  fileAvailable: boolean;
  fileSizeBytes: number;
  mimeType: string | null;
  widthPx: number | null;
  heightPx: number | null;
}

const globalForDesignRuntime = globalThis as unknown as {
  __toantrungDesignJobLocks?: Map<number, { jobId: string; startedAt: number }>;
  __toantrungPrivateAssetMetaCache?: Map<string, CachedAssetFileMeta>;
};

const activeDesignJobLocks =
  globalForDesignRuntime.__toantrungDesignJobLocks ??
  (globalForDesignRuntime.__toantrungDesignJobLocks = new Map<
    number,
    { jobId: string; startedAt: number }
  >());

function getPrivateAssetMetaCached(storageObjectKey: string): CachedAssetFileMeta | null {
  if (!storageObjectKey) return null;
  const fullPath = resolvePrivateBusinessFilePath(storageObjectKey);
  if (!fullPath) return null;
  try {
    const stat = fs.statSync(fullPath);
    if (!stat.isFile() || stat.size <= 0) {
      return { fileAvailable: false, fileSizeBytes: 0, mimeType: null, widthPx: null, heightPx: null };
    }
    const cache =
      globalForDesignRuntime.__toantrungPrivateAssetMetaCache ??
      (globalForDesignRuntime.__toantrungPrivateAssetMetaCache = new Map<string, CachedAssetFileMeta>());
    const cacheKey = `${fullPath}:${stat.mtimeMs}:${stat.size}`;
    const hit = cache.get(cacheKey);
    if (hit) return hit;

    const fileData = readPrivateBusinessFile(storageObjectKey);
    const measured = fileData && fileData.buffer.length > 0 ? validateGeneratedImageBuffer(fileData.buffer) : null;
    const entry: CachedAssetFileMeta = {
      fileAvailable: Boolean(fileData && fileData.buffer.length > 0),
      fileSizeBytes: fileData ? fileData.buffer.length : stat.size,
      mimeType: measured?.detectedMimeType || fileData?.mimeType || null,
      widthPx: measured?.widthPx ?? null,
      heightPx: measured?.heightPx ?? null,
    };
    if (cache.size >= 500) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey) cache.delete(oldestKey);
    }
    cache.set(cacheKey, entry);
    return entry;
  } catch {
    return null;
  }
}

async function expireStaleActiveJobInDb(requestId: number): Promise<void> {
  try {
    const row = await prisma.designRequest.findUnique({
      where: { id: requestId },
      include: { assetVersions: { take: 1, select: { id: true } } },
    });
    if (!row) return;
    const meta = parseProjectMetadata(row.installPositionJson);
    if (meta.activeJob?.status !== 'running') return;
    if (Date.now() - Date.parse(meta.activeJob.startedAt) <= 5 * 60_000) return;
    meta.activeJob = {
      ...meta.activeJob,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      message: 'Tác vụ quá thời gian xử lý trên máy chủ (5 phút) hoặc tiến trình bị gián đoạn.',
    };
    await prisma.designRequest.update({
      where: { id: requestId },
      data: {
        designStatus: row.assetVersions.length > 0 ? 'ai_drafted' : 'pending',
        installPositionJson: JSON.stringify(meta),
      },
    });
    bumpDomainRevisions(['design'], 'design_stale_job_expired');
  } catch {
    // non-fatal cleanup
  }
}

function mapDesignRequestRowToDto(
  r: DesignRequestFullRow,
  opts: {
    fallbackDesignerId: number;
    isAnonymizedLead: boolean;
    providerStatus: ProviderStatusInfo;
  }
): DesignRequestItemDto {
  const { fallbackDesignerId, isAnonymizedLead, providerStatus } = opts;
  const dims = parseDimensions(r.screenDimensions);
  const meta = parseProjectMetadata(r.installPositionJson);

  let effectiveActiveJob = meta.activeJob ?? null;
  let effectiveDbStatus = r.designStatus;
  if (
    effectiveActiveJob?.status === 'running' &&
    !activeDesignJobLocks.has(r.id) &&
    Date.now() - Date.parse(effectiveActiveJob.startedAt) > 5 * 60_000
  ) {
    effectiveActiveJob = {
      ...effectiveActiveJob,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      message: 'Tác vụ quá thời gian xử lý trên máy chủ (5 phút) hoặc tiến trình bị gián đoạn.',
    };
    effectiveDbStatus = r.assetVersions.length > 0 ? 'ai_drafted' : 'pending';
    void expireStaleActiveJobInDb(r.id);
  }

  const assetVersions: DesignAssetVersionItemDto[] = r.assetVersions.map((v) => {
    let parsedVerParams: {
      providerId?: string;
      modelUsed?: string;
      requestedModel?: string | null;
      reportedModel?: string | null;
      reportedModelNote?: string | null;
      costState?: 'actual' | 'estimated' | 'unknown' | null;
      tokensActual?: boolean;
      taskCode?: DesignTaskCode | null;
      taskId?: string | null;
      inputAssetIds?: string[];
      parentVersionId?: number | null;
      generationOrigin?: 'CLOUD_AI' | 'AI_PLUS_LAYOUT' | 'LOCAL_COMPOSITE_FALLBACK' | 'DESIGNER_UPLOAD' | null;
      studioComposite?: boolean;
      referenceSitePhotoId?: string | null;
      sourcePhotoId?: string | null;
      referenceProductPhotoIds?: string[];
      sourceVersionId?: number | null;
      effectivePrompt?: string | null;
      actualWidthPx?: number | null;
      actualHeightPx?: number | null;
    } = {};
    if (v.parametersJson) {
      try {
        parsedVerParams = JSON.parse(v.parametersJson);
      } catch {
        parsedVerParams = {};
      }
    }
    const cachedFileMeta = getPrivateAssetMetaCached(v.storageObjectKey);
    const fileAvailable = Boolean(cachedFileMeta?.fileAvailable);
    const realWidthPx =
      parsedVerParams.actualWidthPx ??
      cachedFileMeta?.widthPx ??
      dims.bannerWidthPx ??
      null;
    const realHeightPx =
      parsedVerParams.actualHeightPx ??
      cachedFileMeta?.heightPx ??
      dims.bannerHeightPx ??
      null;
    const inferredOrigin: DesignAssetVersionItemDto['generationOrigin'] =
      parsedVerParams.generationOrigin ||
      (v.versionType === 'final_render'
        ? 'DESIGNER_UPLOAD'
        : parsedVerParams.providerId === 'local_sandbox' ||
            parsedVerParams.studioComposite ||
            (parsedVerParams.modelUsed || '').includes('toantrung-studio') ||
            (parsedVerParams.modelUsed || '').includes('Compositor')
          ? 'LOCAL_COMPOSITE_FALLBACK'
          : 'CLOUD_AI');
    return {
      id: v.id,
      designRequestId: v.designRequestId,
      versionNumber: v.versionNumber,
      sourceType: v.versionType === 'final_render' ? 'DESIGNER_FINAL_UPLOAD' : 'AI_DRAFT',
      generationOrigin: inferredOrigin,
      providerId: parsedVerParams.providerId ?? null,
      modelUsed: parsedVerParams.modelUsed ?? v.aiUsageLog?.modelName ?? null,
      requestedModel: parsedVerParams.requestedModel ?? parsedVerParams.modelUsed ?? null,
      reportedModel: parsedVerParams.reportedModel ?? null,
      reportedModelNote: parsedVerParams.reportedModelNote ?? null,
      costState: parsedVerParams.costState ?? (v.aiUsageLog?.costMicros ? 'estimated' : 'unknown'),
      taskCode: parsedVerParams.taskCode ?? meta.taskCode ?? null,
      taskId: parsedVerParams.taskId ?? null,
      inputAssetIds: Array.isArray(parsedVerParams.inputAssetIds) ? parsedVerParams.inputAssetIds : [],
      parentVersionId: parsedVerParams.parentVersionId ?? parsedVerParams.sourceVersionId ?? null,
      storageObjectKey: v.storageObjectKey,
      downloadUrl: `/api/v1/design/asset/${v.id}`,
      mimeType: cachedFileMeta?.mimeType || v.mimeType,
      fileSizeBytes: cachedFileMeta ? cachedFileMeta.fileSizeBytes : v.fileSizeBytes,
      widthPx: realWidthPx,
      heightPx: realHeightPx,
      aspectRatio:
        realWidthPx && realHeightPx
          ? `${realWidthPx}×${realHeightPx}px (${r.aspectRatio || '16:9'})`
          : r.aspectRatio,
      promptUsed: v.promptUsed,
      processingDurationMs: v.aiUsageLog?.durationMs ?? r.processingTimeMs,
      tokenUsed:
        parsedVerParams.tokensActual === false
          ? null
          : v.aiUsageLog?.totalTokens ?? r.tokenCost ?? null,
      cost:
        v.aiUsageLog?.costMicros != null && v.aiUsageLog.costMicros > 0n
          ? toMonetaryAmountDto(v.aiUsageLog.costMicros, 'USD', 'micros')
          : null,
      isApprovedFinal: v.isApprovedFinal,
      uploadedByName: v.uploadedBy?.fullName || r.assignedDesigner?.fullName || 'Hệ thống AI',
      createdAt: v.createdAt.toISOString(),
      fileAvailable,
      referenceSitePhotoId:
        parsedVerParams.referenceSitePhotoId ?? parsedVerParams.sourcePhotoId ?? null,
      referenceProductPhotoIds: Array.isArray(parsedVerParams.referenceProductPhotoIds)
        ? parsedVerParams.referenceProductPhotoIds
        : [],
      sourceVersionId: parsedVerParams.sourceVersionId ?? null,
      effectivePrompt: parsedVerParams.effectivePrompt ?? v.promptUsed ?? null,
    };
  });

  const latestAiDraft = [...assetVersions].reverse().find((v) => v.sourceType === 'AI_DRAFT');
  const latestFinal = [...assetVersions]
    .reverse()
    .find((v) => v.sourceType === 'DESIGNER_FINAL_UPLOAD' || v.isApprovedFinal);

  const currency: 'VND' | 'USD' = r.costCurrency === 'VND' ? 'VND' : 'USD';

  const photos: ProjectPhotoItemDto[] = Array.isArray(meta.photos)
    ? meta.photos
    : r.sitePhotoUrl
      ? [
          {
            id: `photo-site-${r.id}`,
            name: 'Ảnh hiện trạng công trình',
            url:
              r.sitePhotoUrl.startsWith('/') || r.sitePhotoUrl.startsWith('http')
                ? r.sitePhotoUrl
                : `/api/v1/design/asset-file?key=${encodeURIComponent(r.sitePhotoUrl)}`,
            storageObjectKey: r.sitePhotoUrl,
            selected: true,
            uploadedAt: r.createdAt.toISOString(),
          },
        ]
      : [];

  const cleanedStoredChat = (meta.chatMessages || []).filter(
    (m) =>
      !m.text?.includes('Phân tích Kỹ thuật Chuyên sâu (Chuẩn thi công LED Toàn Trung') &&
      !m.text?.includes('Mình đã nhận được chia sẻ của bạn:')
  );
  const chatMessages: DesignChatMessageDto[] =
    cleanedStoredChat.length > 0
      ? cleanedStoredChat
      : [
          {
            id: `msg-ai-welcome-${r.id}`,
            role: 'assistant',
            text: providerStatus.isConfigured
              ? 'Chào bạn! Mình là ToanTrung AI — trợ lý thông minh hỗ trợ trò chuyện, tra cứu thông tin, tạo ảnh và dựng phối cảnh 3D. Bạn cần mình giúp gì hôm nay?'
              : 'Chào bạn! Mình là ToanTrung AI. Bạn có thể trò chuyện, tải ảnh công trình dựng phối cảnh hoặc gắn khóa API để sử dụng đầy đủ AI đám mây.',
            timestamp: r.createdAt.toISOString(),
            chatMode: 'consultant_free',
            modelUsed: providerStatus.isConfigured
              ? providerStatus.activeModel
              : 'ToanTrung Studio',
            cost: '$0.00',
            status: 'success',
          },
        ];

  const hasMeasuredPhysicalDims =
    meta.screenWidthM != null || dims.screenWidthM != null;
  const isUnmeasuredBannerOrBrief =
    r.requestType === 'banner' && !hasMeasuredPhysicalDims;

  const effectiveWidthM = meta.screenWidthM ?? dims.screenWidthM ?? 4.8;
  const effectiveHeightM = meta.screenHeightM ?? dims.screenHeightM ?? 2.7;
  const effectiveBannerW = meta.bannerWidthPx ?? dims.bannerWidthPx ?? 1536;
  const effectiveBannerH = meta.bannerHeightPx ?? dims.bannerHeightPx ?? 1024;
  const effectivePitch = meta.pixelPitch || meta.productSpec?.pixelPitch || 'P2.5';
  const effectiveStyle = meta.screenStyle || meta.productSpec?.screenStyle || 'flat';

  const productSpec = isUnmeasuredBannerOrBrief
    ? null
    : computeLedProductSpec({
        productCode: meta.productSpec?.productCode,
        productName: r.ledCategory || 'Màn hình LED Indoor',
        categoryGroup: meta.productSpec?.categoryGroup,
        widthM: effectiveWidthM,
        heightM: effectiveHeightM,
        pitch: effectivePitch,
        screenStyle: effectiveStyle,
      });
  if (productSpec && meta.productId) {
    productSpec.productId = meta.productId;
  }

  const cleanLeadProject = r.lead ? sanitizeProjectOrSubjectText(r.lead.projectName) : null;
  const projectName =
    meta.projectName ||
    (r.lead
      ? cleanLeadProject || r.lead.companyName || 'Dự án LED'
      : r.requestType === 'banner'
        ? 'Banner Quảng cáo LED'
        : 'Showroom LED');
  const selectedPhoto = photos.find((p) => p.selected) || photos[0];

  return {
    id: r.id,
    version: r.version,
    projectName,
    contactName: isAnonymizedLead
      ? 'Khách hàng ẩn danh (UC01)'
      : meta.contactName ?? r.lead?.contactName ?? null,
    installationInfo: isUnmeasuredBannerOrBrief
      ? meta.installationInfo ?? null
      : meta.installationInfo || 'Tường bên phải showroom, cách sàn 1.2m',
    notes: r.notes,
    leadId: r.leadId,
    leadCode: r.lead?.leadCode ?? null,
    leadProjectLabel: r.lead
      ? `${r.lead.leadCode} — ${
          isAnonymizedLead
            ? cleanLeadProject || 'Dự án LED (Ẩn danh)'
            : r.lead.companyName || r.lead.contactName || 'Dự án LED'
        }`
      : null,
    productId: meta.productId ?? null,
    productName: r.ledCategory,
    websiteId: meta.websiteId ?? null,
    websiteDomain: meta.websiteDomain ?? null,
    campaignId: meta.campaignId ?? null,
    campaignName: meta.campaignName ?? null,
    contentId: meta.contentId ?? null,
    sourceModule: meta.sourceModule ?? null,
    taskCode: meta.taskCode ?? (r.requestType === 'banner' ? 'banner_generate' : 'perspective_compose'),
    designBrief: meta.designBrief ?? null,
    requestedBySalesId: r.requestedBySalesId,
    requestedBySalesName: r.requestedBySales?.fullName ?? null,
    assignedDesignerId: r.assignedDesignerId ?? fallbackDesignerId,
    assignedDesignerName: r.assignedDesigner?.fullName ?? 'Designer Toàn Trung',
    designType: mapDbRequestTypeToDto(r.requestType),
    ledModuleSpec: r.ledCategory,
    screenWidthM: meta.screenWidthM ?? dims.screenWidthM,
    screenHeightM: meta.screenHeightM ?? dims.screenHeightM,
    installZoneBboxJson: meta.placementQuad ? JSON.stringify(meta.placementQuad) : null,
    placementQuad: meta.placementQuad || DEFAULT_PLACEMENT_QUAD,
    ledScreens: Array.isArray(meta.ledScreens) ? meta.ledScreens : undefined,
    bannerWidthPx: meta.bannerWidthPx ?? dims.bannerWidthPx ?? effectiveBannerW,
    bannerHeightPx: meta.bannerHeightPx ?? dims.bannerHeightPx ?? effectiveBannerH,
    aspectRatio: r.aspectRatio || '16:9',
    aspectLocked: meta.aspectLocked ?? true,
    isArchived: meta.isArchived ?? false,
    sitePhotoDownloadUrl: selectedPhoto?.url || null,
    photos,
    chatMessages,
    productSpec,
    aiPrompt: r.prompt ?? '',
    aiDraftDownloadUrl: latestAiDraft?.downloadUrl ?? null,
    finalRenderDownloadUrl: latestFinal?.downloadUrl ?? null,
    approvedVersionId: r.approvedVersionId,
    processingDurationSec:
      r.processingTimeMs != null ? Number((r.processingTimeMs / 1000).toFixed(2)) : null,
    tokenCost: r.tokenCost,
    totalCost:
      r.totalCostMicros != null
        ? toMonetaryAmountDto(r.totalCostMicros, currency, 'micros')
        : null,
    status: mapDbStatusToDto(effectiveDbStatus),
    activeJob: effectiveActiveJob,
    createdAt: r.createdAt.toISOString(),
    updatedAt: (r.completedAt ?? r.createdAt).toISOString(),
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    assetVersions,
  };
}

export async function getDesignProjectForUser(
  user: SessionUserDto,
  requestId: number
): Promise<{
  project: DesignRequestItemDto;
  designContext: ProjectDesignContext;
}> {
  const rawRow = await findSingleDesignRequestRow(requestId);
  if (!rawRow) {
    throw new Error('Không tìm thấy yêu cầu thiết kế.');
  }
  if (!canUserAccessDesignProject(user, rawRow)) {
    throw new ForbiddenDesignProjectAccessError();
  }
  const providerStatus = AiDesignProviderFactory.getActiveProviderInfo();
  const project = mapDesignRequestRowToDto(rawRow, {
    fallbackDesignerId: user.id,
    isAnonymizedLead: user.roleCode === 'DESIGNER',
    providerStatus,
  });
  const meta = parseProjectMetadata(rawRow.installPositionJson);
  const designContext =
    meta.designContext ||
    createInitialDesignContext({
      projectId: project.id,
      leadId: project.leadId,
      widthMm: Math.round((project.screenWidthM ?? 4.8) * 1000),
      heightMm: Math.round((project.screenHeightM ?? 2.7) * 1000),
      pixelPitch: project.productSpec?.pixelPitch || 'P2.5',
      placementQuad: project.placementQuad || null,
      selectedPhotoId: project.photos.find((p) => p.selected)?.id || null,
      activeVersionId: project.assetVersions[project.assetVersions.length - 1]?.id || null,
      screenStyle: project.productSpec?.screenStyle || 'flat',
      compositingMode: meta.compositingMode || 'STRICT',
    });
  return { project, designContext };
}

export async function getAiDesignStatus(): Promise<ProviderStatusInfo> {
  const base = AiDesignProviderFactory.getActiveProviderInfo();
  const modelRegistry = await AiDesignProviderFactory.getModelRegistry(false).catch(() => undefined);
  return { ...base, modelRegistry };
}

export async function createMarketingDesignBrief(
  actor: SessionUserDto,
  input: MarketingBriefSubmitDto
): Promise<{
  ok: boolean;
  projectId: number;
  assignedDesignerName: string;
  taskCode: DesignTaskCode;
  message: string;
}> {
  const textToCheck = [
    input.projectName,
    input.notes || '',
    input.designBrief.objective || '',
    input.designBrief.headlineText || '',
    input.designBrief.subheadlineText || '',
  ].join('\n');
  const piiCheck = containsCustomerPiiInPrompt(textToCheck);
  if (piiCheck.hasPii) {
    throw new Error(piiCheck.reason);
  }

  let assignedDesigner = input.designBrief.assignedDesignerId
    ? await prisma.user.findUnique({ where: { id: input.designBrief.assignedDesignerId } })
    : null;
  if (!assignedDesigner || !assignedDesigner.isActive) {
    assignedDesigner = await prisma.user.findFirst({
      where: { isActive: true, role: { roleCode: 'DESIGNER' } },
      orderBy: { id: 'asc' },
    });
  }
  const assignedDesignerId = assignedDesigner?.id ?? actor.id;
  const assignedDesignerName = assignedDesigner?.fullName ?? 'Designer Toàn Trung';

  const product = input.productId
    ? await prisma.product.findUnique({ where: { id: input.productId } })
    : input.designBrief.productId
      ? await prisma.product.findUnique({ where: { id: input.designBrief.productId } })
      : null;

  const outW = input.designBrief.outputWidthPx ?? 1536;
  const outH = input.designBrief.outputHeightPx ?? 1024;
  const isBanner = input.designType === 'banner' || input.taskCode === 'banner_generate';
  const dbRequestType = isBanner ? 'banner' : '3d_perspective';

  const briefRecord: DesignBriefDto = {
    ...input.designBrief,
    requesterUserId: actor.id,
    requesterName: actor.fullName,
    assignedDesignerId,
  };

  const metadata: StoredMetadata = {
    projectName: input.projectName.trim(),
    contactName: null,
    installationInfo: null,
    productId: product?.id ?? null,
    taskCode: input.taskCode,
    designBrief: briefRecord,
    websiteId: briefRecord.websiteId ?? null,
    websiteDomain: briefRecord.websiteDomain ?? null,
    campaignId: briefRecord.campaignId ?? null,
    campaignName: briefRecord.campaignName ?? null,
    contentId: briefRecord.contentId ?? null,
    sourceModule: input.sourceModule,
    ...(isBanner ? { bannerWidthPx: outW, bannerHeightPx: outH } : {}),
    photos: [],
    chatMessages: [
      {
        id: `msg-brief-init-${Date.now()}`,
        role: 'assistant',
        text: [
          `📋 **Brief Thiết kế mới từ ${actor.fullName}** (${DESIGN_TASK_LABELS[input.taskCode].title})`,
          briefRecord.objective ? `• Mục tiêu: ${briefRecord.objective}` : null,
          briefRecord.websiteDomain ? `• Website: ${briefRecord.websiteDomain}` : null,
          briefRecord.campaignName ? `• Chiến dịch: ${briefRecord.campaignName}` : null,
          briefRecord.targetChannel || briefRecord.outputFormat
            ? `• Kênh / Định dạng: ${[briefRecord.targetChannel, briefRecord.outputFormat].filter(Boolean).join(' · ')} (${outW}×${outH}px)`
            : `• Kích thước mục tiêu: ${outW}×${outH}px`,
          briefRecord.headlineText ? `• Headline: "${briefRecord.headlineText}"` : null,
          briefRecord.ctaText ? `• CTA: "${briefRecord.ctaText}"` : null,
        ]
          .filter(Boolean)
          .join('\n'),
        timestamp: new Date().toISOString(),
        chatMode: 'consultant_free',
        modelUsed: 'Brief Marketing',
        cost: '$0.00',
        status: 'success',
      },
    ],
  };

  const created = await prisma.designRequest.create({
    data: {
      requestType: dbRequestType,
      ledCategory: product?.productName || (isBanner ? 'Ấn phẩm Marketing / Banner' : 'Thiết kế phối cảnh'),
      screenDimensions: `${outW}x${outH}px`,
      aspectRatio: `${outW}:${outH}`,
      prompt: briefRecord.objective || input.projectName,
      notes: input.notes || null,
      assignedDesignerId,
      designStatus: 'pending',
      installPositionJson: JSON.stringify(metadata),
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: actor.id,
      action: 'MARKETING_DESIGN_BRIEF_CREATED',
      targetType: 'DesignRequest',
      targetId: String(created.id),
      detailsJson: JSON.stringify({
        taskCode: input.taskCode,
        sourceModule: input.sourceModule,
        websiteDomain: briefRecord.websiteDomain || null,
        campaignId: briefRecord.campaignId || null,
        contentId: briefRecord.contentId ?? null,
        hasBaselineSnapshot: Boolean(briefRecord.baselineSnapshot),
      }),
    },
  });

  bumpDomainRevisions(['design', 'notifications', 'reports'], 'marketing_design_brief_created');

  return {
    ok: true,
    projectId: created.id,
    assignedDesignerName,
    taskCode: input.taskCode,
    message: `Đã gửi Brief "${input.projectName}" (#${created.id}) tới ${assignedDesignerName}.`,
  };
}

export async function configureAiProviders(
  actor: SessionUserDto,
  input: ConfigureAiProvidersDto
): Promise<ProviderStatusInfo> {
  const updatedStatus = AiDesignProviderFactory.updateConfiguration(input);
  await prisma.auditLog.create({
    data: {
      actorUserId: actor.id,
      action: 'AI_DESIGN_PROVIDER_CONFIGURED',
      targetType: 'SystemSetting',
      targetId: input.defaultProviderId,
      detailsJson: JSON.stringify({
        defaultProviderId: input.defaultProviderId,
        defaultModelId: input.defaultModelId,
        autoFallbackToLocal: input.autoFallbackToLocal,
        configuredProvider: input.providerConfig?.providerId,
      }),
    },
  });
  bumpDomainRevisions(['design'], 'ai_providers_configured');
  return updatedStatus;
}

export async function listDesignRequestsForUser(
  user: SessionUserDto,
  options?: { page?: number; pageSize?: number }
): Promise<{
  requests: DesignRequestItemDto[];
  leadOptions: Array<{ id: number; leadCode: string; label: string }>;
  productOptions: Array<{ id: number; code: string; name: string; categoryGroup: string }>;
  providerStatus: ProviderStatusInfo;
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
    hasMore: boolean;
  };
}> {
  const canAccessDesignScope =
    user.roleCode === 'ADMIN' ||
    user.roleCode === 'BOD' ||
    user.roleCode === 'SALES_LEAD' ||
    user.roleCode === 'DESIGNER' ||
    user.roleCode === 'SALES';
  if (!canAccessDesignScope) {
    throw new ForbiddenDesignProjectAccessError(
      'Vai trò hiện tại không được phân quyền xem hồ sơ ảnh hiện trạng và bản vẽ thiết kế.'
    );
  }

  const page = Math.max(1, Math.floor(options?.page || 1));
  const pageSize = Math.min(250, Math.max(1, Math.floor(options?.pageSize || 100)));

  const cached = await getOrComputeScopedCache({
    key: `design:list:${user.roleCode}:${user.roleCode === 'SALES' ? user.id : 'all'}:p${page}:s${pageSize}`,
    domains: ['design', 'leads'],
    ttlMs: 15_000,
    compute: async () => {
      const isAnonymizedLead = user.roleCode === 'DESIGNER';
      const requestScopeWhere =
        user.roleCode === 'SALES'
          ? {
              OR: [
                { requestedBySalesId: user.id },
                { lead: { assignedSalesId: user.id } },
                { lead: { createdByUserId: user.id } },
              ],
            }
          : undefined;

      const [rows, totalCount, leads, products, providerStatus, modelRegistry] = await Promise.all([
        prisma.designRequest.findMany({
          where: requestScopeWhere,
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: DESIGN_REQUEST_INCLUDE,
          orderBy: { createdAt: 'desc' },
        }),
        prisma.designRequest.count({ where: requestScopeWhere }),
        prisma.lead.findMany({
          where: {
            isSpam: false,
            ...(user.roleCode === 'SALES'
              ? { OR: [{ assignedSalesId: user.id }, { createdByUserId: user.id }] }
              : {}),
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: {
            id: true,
            leadCode: true,
            projectName: true,
            companyName: true,
            contactName: true,
          },
        }),
        prisma.product.findMany({
          where: { isActive: true },
          orderBy: { id: 'asc' },
          select: {
            id: true,
            productCode: true,
            productName: true,
            categoryGroup: true,
          },
        }),
        Promise.resolve(AiDesignProviderFactory.getActiveProviderInfo()),
        AiDesignProviderFactory.getModelRegistry(false).catch(() => undefined),
      ]);

      const requests: DesignRequestItemDto[] = rows.map((r) =>
        mapDesignRequestRowToDto(r, {
          fallbackDesignerId: user.id,
          isAnonymizedLead,
          providerStatus,
        })
      );

      const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
      return {
        requests,
        leadOptions: leads.map((l) => {
          const projLabel = sanitizeProjectOrSubjectText(l.projectName) || 'Dự án LED';
          return {
            id: l.id,
            leadCode: l.leadCode,
            label: isAnonymizedLead
              ? `${l.leadCode} · Khách hàng ẩn danh (${projLabel})`
              : `${l.leadCode} · ${l.companyName || l.contactName || 'Khách hàng'} (${projLabel})`,
          };
        }),
        productOptions: products.map((p) => ({
          id: p.id,
          code: p.productCode,
          name: p.productName,
          categoryGroup: p.categoryGroup,
        })),
        providerStatus: {
          ...providerStatus,
          modelRegistry,
        },
        pagination: {
          page,
          pageSize,
          totalCount,
          totalPages,
          hasMore: page * pageSize < totalCount,
        },
      };
    },
  });

  return cached.data;
}

export async function createDesignRequestWithAiDraft(
  actor: SessionUserDto,
  input: CreateDesignRequestDto
) {
  const piiCheck = containsCustomerPiiInPrompt(input.aiPrompt);
  if (piiCheck.hasPii) {
    throw new Error(piiCheck.reason);
  }

  const designerUser = await prisma.user.findFirst({
    where: {
      isActive: true,
      role: { roleCode: 'DESIGNER' },
    },
    orderBy: { id: 'asc' },
  });
  const assignedDesignerId = designerUser?.id ?? actor.id;

  let ledCategory = 'Banner Truyền thông LED';
  let screenDimensions = '1920x1080px';
  let aspectRatio = '16:9';
  let sitePhotoUrl: string | null = null;
  let dimensionsData: { widthM: number; heightM: number } = { widthM: 4.8, heightM: 2.7 };

  if (input.designType === 'perspective_3d') {
    const product = await prisma.product.findUnique({ where: { id: input.productId } });
    ledCategory = product ? `${product.productName} (${input.ledModuleSpec})` : input.ledModuleSpec;
    screenDimensions = `${input.screenWidthM.toFixed(2).replace('.', ',')} x ${input.screenHeightM.toFixed(2).replace('.', ',')} m`;
    aspectRatio = `${input.screenWidthM}:${input.screenHeightM}`;
    sitePhotoUrl = input.sitePhotoObjectKey || DEFAULT_SHOWROOM_PHOTO;
    dimensionsData = { widthM: input.screenWidthM, heightM: input.screenHeightM };
  } else {
    if (input.productId) {
      const product = await prisma.product.findUnique({ where: { id: input.productId } });
      if (product) {
        ledCategory = `Banner ${product.productName}`;
      }
    }
    screenDimensions = `${input.bannerWidthPx}x${input.bannerHeightPx}px`;
    aspectRatio = input.aspectRatio;
  }

  const dbRequestType: 'banner' | '3d_perspective' =
    input.designType === 'banner' ? 'banner' : '3d_perspective';

  // Clean project initialization (when user clicks "+ Tạo dự án" in Studio without calling @TaoAnh yet)
  if (input.aiPrompt.startsWith('[INIT_PROJECT]')) {
    const cleanNote = input.aiPrompt.replace(/^\[INIT_PROJECT\]\s*/i, '').trim();
    const productSpec = computeLedProductSpec({
      productName: ledCategory,
      widthM: dimensionsData.widthM,
      heightM: dimensionsData.heightM,
      pitch: 'P2.5',
    });

    const leadPhotos: ProjectPhotoItemDto[] = [];
    let leadContactFallback: string | null = null;
    if (input.leadId) {
      const linkedLead = await prisma.lead.findUnique({
        where: { id: input.leadId },
        include: {
          attachments: {
            where: { attachmentType: { not: 'quote_doc' } },
            orderBy: { uploadedAt: 'desc' },
            take: 10,
          },
        },
      });
      if (linkedLead) {
        leadContactFallback = linkedLead.contactName || linkedLead.companyName || null;
        for (const att of linkedLead.attachments) {
          const isImg =
            att.attachmentType === 'site_photo' ||
            /\.(png|jpe?g|webp)$/i.test(att.fileName || '') ||
            /\.(png|jpe?g|webp)$/i.test(att.fileUrl || '');
          if (isImg) {
            leadPhotos.push({
              id: `lead-att-${att.id}`,
              name: att.fileName || `Ảnh khảo sát Lead #${att.id}`,
              url: `/api/v1/leads/attachments/${att.id}`,
              storageObjectKey: att.fileUrl,
              selected: leadPhotos.length === 0,
              uploadedAt: att.uploadedAt.toISOString(),
              sourceLeadAttachmentId: att.id,
            });
          }
        }
      }
    }

    const initialMetadata: StoredMetadata = {
      projectName:
        input.projectName ||
        (input.designType === 'banner' ? 'Banner Quảng cáo LED' : 'Dự án Phối cảnh LED'),
      contactName: input.contactName || leadContactFallback,
      installationInfo: input.installationInfo || 'Vị trí lắp đặt thực tế tại công trình',
      productId: input.productId ?? 1,
      pixelPitch: 'P2.5',
      screenStyle: 'flat',
      screenWidthM: dimensionsData.widthM,
      screenHeightM: dimensionsData.heightM,
      bannerWidthPx:
        input.designType === 'banner' ? input.bannerWidthPx : productSpec.resolutionWidthPx,
      bannerHeightPx:
        input.designType === 'banner' ? input.bannerHeightPx : productSpec.resolutionHeightPx,
      aspectLocked: true,
      isArchived: false,
      photos: leadPhotos,
      placementQuad: input.placementQuad || DEFAULT_PLACEMENT_QUAD,
      chatMessages: [
        {
          id: `msg-ai-welcome-${Date.now()}`,
          role: 'assistant',
          text: [
            `👋 **Xin chào! Mình là ToanTrung AI:**`,
            `• Đã sẵn sàng phiên làm việc **${input.projectName || 'Trò chuyện mới'}**. Bạn có thể hỏi bất cứ điều gì, tra cứu thông tin trực tuyến hoặc yêu cầu tạo ảnh ngay trong khung chat.`,
            leadPhotos.length > 0
              ? `• Đã tự động đồng bộ **${leadPhotos.length} ảnh khảo sát** từ hồ sơ Lead liên kết.`
              : `• Nếu cần dựng phối cảnh LED trên ảnh thật, bạn chỉ cần tải ảnh ở cột trái rồi nhắn yêu cầu cho ToanTrung nhé.`,
          ].join('\n'),
          timestamp: new Date().toISOString(),
          chatMode: 'consultant_free',
          suggestedTaoAnhPrompt:
            input.designType === 'banner'
              ? `@TaoAnhPoster: Thiết kế Poster quảng cáo LED chuyên nghiệp (${input.bannerWidthPx || 1920}×${input.bannerHeightPx || 1080}px)`
              : `@TaoAnh: Ghép màn hình LED P2.5 kích thước ${Math.round(dimensionsData.widthM * 1000)}×${Math.round(dimensionsData.heightM * 1000)}mm vào các điểm chạm đã chấm trên ảnh hiện trạng, kèm đường gióng kích thước kỹ thuật (mm)`,
          modelUsed: 'AI Tư vấn Toàn Trung (Gemini Flash Free)',
          cost: '$0.00',
          status: 'success',
        },
      ],
      productSpec,
    };

    const createdRequest = await prisma.designRequest.create({
      data: {
        leadId: input.leadId ?? null,
        requestedBySalesId:
          actor.roleCode === 'SALES' || actor.roleCode === 'SALES_LEAD' ? actor.id : null,
        assignedDesignerId,
        requestType: dbRequestType,
        ledCategory,
        screenDimensions,
        aspectRatio,
        installPositionJson: JSON.stringify(initialMetadata),
        sitePhotoUrl: leadPhotos[0]?.storageObjectKey || null,
        prompt: cleanNote || 'Khởi tạo dự án thiết kế mới',
        designStatus: 'pending',
        notes: input.notes || cleanNote || 'Dự án mới khởi tạo — sẵn sàng tải ảnh khảo sát & chạy AI.',
      },
    });

    bumpDomainRevisions(['design', 'leads', 'reports'], 'design_request_init');

    return {
      id: createdRequest.id,
      status: 'pending',
      versionId: null,
    };
  }

  // Call provider adapter with Multi-AI selection & auto-fallback
  const providerResult =
    input.designType === 'perspective_3d'
      ? await AiDesignProviderFactory.executePerspectiveWithFallback(
          {
            workflow: 'perspective_3d',
            prompt: input.aiPrompt,
            referenceImageUrl: sitePhotoUrl || DEFAULT_SHOWROOM_PHOTO,
            placementQuad: input.placementQuad || DEFAULT_PLACEMENT_QUAD,
            dimensions: {
              widthM: input.screenWidthM,
              heightM: input.screenHeightM,
              aspectRatio,
            },
            quality: input.quality || 'draft',
            modelId: input.modelId,
            idempotencyKey: `design-create-${Date.now()}`,
            simulateTimeout: input.simulateAiTimeout,
          },
          input.providerId
        )
      : await AiDesignProviderFactory.executeBannerWithFallback(
          {
            workflow: 'banner',
            prompt: input.aiPrompt,
            dimensions: {
              widthPx: input.bannerWidthPx,
              heightPx: input.bannerHeightPx,
              aspectRatio,
            },
            quality: input.quality || 'draft',
            modelId: input.modelId,
            idempotencyKey: `design-create-banner-${Date.now()}`,
            simulateTimeout: input.simulateAiTimeout,
          },
          input.providerId
        );

  if (providerResult.status === 'timeout' || input.simulateAiTimeout) {
    const pendingReq = await prisma.designRequest.create({
      data: {
        leadId: input.leadId ?? null,
        requestedBySalesId:
          actor.roleCode === 'SALES' || actor.roleCode === 'SALES_LEAD' ? actor.id : null,
        assignedDesignerId,
        requestType: dbRequestType,
        ledCategory,
        screenDimensions,
        aspectRatio,
        installPositionJson: JSON.stringify({
          projectName: input.projectName || 'Dự án LED',
          contactName: input.contactName || null,
          installationInfo: input.installationInfo || null,
          placementQuad: input.placementQuad || DEFAULT_PLACEMENT_QUAD,
          chatMessages: [
            {
              id: `msg-user-${Date.now()}`,
              role: 'user',
              text: input.aiPrompt,
              timestamp: new Date().toISOString(),
            },
            {
              id: `msg-ai-${Date.now()}`,
              role: 'assistant',
              text: 'Hệ thống AI quá thời gian phản hồi (UC06 E1). Yêu cầu đã được lưu lại để Designer thử lại.',
              timestamp: new Date().toISOString(),
              status: 'timeout',
            },
          ],
        }),
        sitePhotoUrl,
        prompt: input.aiPrompt,
        designStatus: 'pending',
        notes:
          'AI quá thời gian phản hồi (UC06 E1). Đã lưu thông số để Designer thử lại hoặc tải file thủ công.',
      },
    });

    await recordAiUsageAttempt(prisma, {
      idempotencyKey: `design-ai-timeout-${pendingReq.id}-${Date.now()}`,
      attemptNumber: 1,
      moduleCode: '05-ai-design',
      taskType: dbRequestType,
      userId: actor.id,
      designRequestId: pendingReq.id,
      modelName: providerResult.modelUsed || 'imagen-3.0-generate-002',
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      costMicros: null,
      durationMs: providerResult.durationMs,
      status: 'timeout',
      errorMessage: 'Hệ thống AI dựng ảnh quá thời gian phản hồi 60s (Simulated UC06 E1).',
    });

    bumpDomainRevisions(['design', 'leads', 'reports', 'notifications'], 'design_request_timeout');

    return {
      id: pendingReq.id,
      status: 'pending',
      warning:
        'Kết nối AI quá thời gian phản hồi (UC06 E1). Hệ thống đã bảo toàn thông số yêu cầu để bạn thử lại.',
    };
  }

  // Save generated asset to private storage
  const savedFile = savePrivateBusinessFile({
    bucket: 'design',
    prefix: `ai-draft-${dbRequestType}-v1`,
    fileBuffer: providerResult.imageBuffer,
    declaredMimeType: providerResult.mimeType || 'image/png',
  });

  const productSpec = computeLedProductSpec({
    productName: ledCategory,
    widthM: dimensionsData.widthM,
    heightM: dimensionsData.heightM,
    pitch: 'P2.5',
  });

  // Gather any permitted site_photo attachments from the linked Lead
  const rawPhotoKey = 'sitePhotoObjectKey' in input ? input.sitePhotoObjectKey : undefined;
  const leadPhotos: ProjectPhotoItemDto[] = [];
  let leadContactFallback: string | null = null;
  if (input.leadId) {
    const linkedLead = await prisma.lead.findUnique({
      where: { id: input.leadId },
      include: {
        attachments: {
          where: { attachmentType: { not: 'quote_doc' } },
          orderBy: { uploadedAt: 'desc' },
          take: 10,
        },
      },
    });
    if (linkedLead) {
      leadContactFallback = linkedLead.contactName || linkedLead.companyName || null;
      for (const att of linkedLead.attachments) {
        const isImg =
          att.attachmentType === 'site_photo' ||
          /\.(png|jpe?g|webp)$/i.test(att.fileName || '') ||
          /\.(png|jpe?g|webp)$/i.test(att.fileUrl || '');
        if (isImg) {
          leadPhotos.push({
            id: `lead-att-${att.id}`,
            name: att.fileName || `Ảnh khảo sát Lead #${att.id}`,
            url: `/api/v1/leads/attachments/${att.id}`,
            storageObjectKey: att.fileUrl,
            selected: leadPhotos.length === 0 && !rawPhotoKey,
            uploadedAt: att.uploadedAt.toISOString(),
            sourceLeadAttachmentId: att.id,
          });
        }
      }
    }
  }

  const defaultPhotos: ProjectPhotoItemDto[] = [
    ...(rawPhotoKey
      ? [
          {
            id: `photo-input-${Date.now()}`,
            name: 'Ảnh hiện trạng tải lên',
            url: rawPhotoKey.startsWith('/') || rawPhotoKey.startsWith('http')
              ? rawPhotoKey
              : `/api/v1/design/asset-file?key=${encodeURIComponent(rawPhotoKey)}`,
            storageObjectKey: rawPhotoKey,
            selected: true,
            uploadedAt: new Date().toISOString(),
          },
        ]
      : []),
    ...leadPhotos,
  ];

  const initialMetadata: StoredMetadata = {
    projectName: input.projectName || (input.designType === 'banner' ? 'Banner Quảng cáo LED' : 'Showroom LED'),
    contactName: input.contactName || leadContactFallback,
    installationInfo: input.installationInfo || 'Tường bên phải showroom, cách sàn 1.2m',
    productId: input.productId ?? 1,
    pixelPitch: 'P2.5',
    screenStyle: 'flat',
    screenWidthM: dimensionsData.widthM,
    screenHeightM: dimensionsData.heightM,
    bannerWidthPx: input.designType === 'banner' ? input.bannerWidthPx : productSpec.resolutionWidthPx,
    bannerHeightPx: input.designType === 'banner' ? input.bannerHeightPx : productSpec.resolutionHeightPx,
    aspectLocked: true,
    isArchived: false,
    photos: defaultPhotos,
    placementQuad: input.placementQuad || DEFAULT_PLACEMENT_QUAD,
    chatMessages: [
      {
        id: `msg-user-1-${Date.now()}`,
        role: 'user',
        text: input.aiPrompt,
        timestamp: new Date().toISOString(),
      },
      {
        id: `msg-ai-1-${Date.now()}`,
        role: 'assistant',
        text: `Bản nháp mới (v1 · ${providerResult.modelUsed}) đã được thêm vào thư viện.`,
        timestamp: new Date().toISOString(),
        versionNumber: 1,
        providerId: providerResult.provider,
        modelUsed: providerResult.modelUsed,
        durationSec: Number((providerResult.durationMs / 1000).toFixed(2)),
        tokenUsed: providerResult.totalTokens,
        cost: `$${(Number(providerResult.costMicros) / 1_000_000).toFixed(3)}`,
        status: 'success',
      },
    ],
    productSpec,
  };

  const createdRequest = await prisma.designRequest.create({
    data: {
      leadId: input.leadId ?? null,
      requestedBySalesId:
        actor.roleCode === 'SALES' || actor.roleCode === 'SALES_LEAD' ? actor.id : null,
      assignedDesignerId,
      requestType: dbRequestType,
      ledCategory,
      screenDimensions,
      aspectRatio,
      installPositionJson: JSON.stringify(initialMetadata),
      sitePhotoUrl,
      prompt: input.aiPrompt,
      designStatus: 'ai_drafting',
      aiDraftImageUrl: savedFile.storageObjectKey,
      processingTimeMs: providerResult.durationMs,
      tokenCost: providerResult.totalTokens,
      totalCostMicros: providerResult.costMicros,
      costCurrency: providerResult.costCurrency,
      notes:
        input.leadId == null
          ? 'Ấn phẩm tạo độc lập không gắn Lead (UC06 Luồng phụ 2a).'
          : 'Đã khởi tạo bản nháp AI v1.',
    },
  });

  const aiLog = await recordAiUsageAttempt(prisma, {
    idempotencyKey: `design-ai-create-${createdRequest.id}-v1-${Date.now()}`,
    attemptNumber: 1,
    providerRequestId: `${providerResult.provider}-${createdRequest.id}-v1`,
    moduleCode: '05-ai-design',
    taskType: dbRequestType,
    userId: actor.id,
    designRequestId: createdRequest.id,
    modelName: providerResult.modelUsed,
    promptTokens: providerResult.promptTokens,
    completionTokens: providerResult.completionTokens,
    totalTokens: providerResult.totalTokens,
    costMicros: providerResult.costMicros,
    costCurrency: providerResult.costCurrency,
    durationMs: providerResult.durationMs,
    status: providerResult.status,
  });

  const v1 = await prisma.designAssetVersion.create({
    data: {
      designRequestId: createdRequest.id,
      versionNumber: 1,
      versionType: 'ai_draft',
      storageObjectKey: savedFile.storageObjectKey,
      mimeType: savedFile.mimeType,
      fileSizeBytes: savedFile.fileSizeBytes,
      promptUsed: input.aiPrompt,
      parametersJson: JSON.stringify({
        designType: input.designType,
        screenDimensions,
        aspectRatio,
        quality: input.quality || 'draft',
        providerId: providerResult.provider,
        modelUsed: providerResult.modelUsed,
      }),
      aiUsageLogId: aiLog.log.id,
      uploadedByUserId: actor.id,
      isApprovedFinal: false,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: actor.id,
      action: 'DESIGN_REQUEST_CREATED',
      targetType: 'DesignRequest',
      targetId: String(createdRequest.id),
      detailsJson: JSON.stringify({
        requestType: dbRequestType,
        leadId: createdRequest.leadId,
        versionId: v1.id,
        durationMs: providerResult.durationMs,
      }),
    },
  });

  bumpDomainRevisions(['design', 'leads', 'reports', 'notifications'], 'design_request_created');

  return {
    id: createdRequest.id,
    status: 'ai_drafted',
    versionId: v1.id,
  };
}

const DAO_TAO_ANH_POSTER_REGEX =
  /^\s*@(?:banner|baneer|taobanner|tạobanner|tao_banner|tao-banner|taoanhbanner|taoanhposter|taoposter|tao_anh_poster|poster)\s*:?\s*/i;
const DAO_TAO_ANH_REGEX =
  /^\s*@(?:banner|baneer|taobanner|tạobanner|tao_banner|tao-banner|taoanhbanner|taoanhposter|taoposter|tao_anh_poster|poster|taoanh|tạoảnh|tao_anh|tao-anh|taojanh|draw|render)\s*:?\s*/i;

function buildConsultantReplyAndSuggestedPrompt(params: {
  userText: string;
  designType: 'banner' | '3d_perspective';
  widthM: number;
  heightM: number;
  bannerWidthPx: number;
  bannerHeightPx: number;
  aspectRatio: string;
  pitch: string;
  screenStyle: 'flat' | 'curved' | 'corner_90';
  placementQuad?: QuadCoordinatesDto;
  history?: DesignChatMessageDto[];
}): { replyText: string; suggestedTaoAnhPrompt?: string } {
  const {
    userText,
    designType,
    widthM,
    heightM,
    bannerWidthPx,
    bannerHeightPx,
    aspectRatio,
    pitch,
    screenStyle,
    placementQuad,
  } = params;
  const cleanUser = userText.trim();
  const lower = cleanUser.toLowerCase();

  const rawWmm = Math.round(widthM * 1000);
  const rawHmm = Math.round(heightM * 1000);
  const modCols = Math.max(2, Math.round(rawWmm / 320));
  const modRows = Math.max(2, Math.round(rawHmm / 160));
  const snappedWmm = modCols * 320;
  const snappedHmm = modRows * 160;
  const areaM2 = Number(((snappedWmm / 1000) * (snappedHmm / 1000)).toFixed(2));
  const cabCols = Math.max(1, Math.round(snappedWmm / 640));
  const cabRows = Math.max(1, Math.round(snappedHmm / 480));
  const totalCabinets = cabCols * cabRows;
  const totalModules = modCols * modRows;
  const pitchNum = Number(pitch.replace(/[^0-9.]/g, '')) || 2.5;
  const isOutdoor = pitchNum >= 3.0 || /outdoor|ngoài trời|mặt dựng|sảnh/i.test(cleanUser);
  const minViewM = Number((pitchNum * 1.1).toFixed(1));
  const maxViewM = Math.round(pitchNum * 12);
  const avgKw = Number((areaM2 * (isOutdoor ? 0.32 : 0.22)).toFixed(1));
  const maxKw = Number((areaM2 * (isOutdoor ? 0.85 : 0.58)).toFixed(1));

  // 1. Check if user is explicitly asking to analyze the photo or generate an image/poster
  const isExplicitPhotoAnalysis =
    /phân tích\s*(?:ảnh|hình|công trình|điểm chạm)|xem\s*(?:ảnh|hình)|đánh giá\s*(?:ảnh|công trình)|tạo\s*sẵn\s*lệnh|ghép\s*màn\s*hình|dựng\s*phối\s*cảnh/i.test(
      cleanUser
    );
  const isExplicitPosterRequest =
    /\b(thiết kế\s*poster|tạo\s*poster|làm\s*banner|thiết kế\s*banner|tạo\s*banner)\b/i.test(
      cleanUser
    );

  // 2. Greetings & casual conversation (act like a normal friendly AI!)
  if (
    /^(xin\s*chào|chào|hi|hello|hey|alo|ê|ơi|bạn\s*ơi|chào\s*bạn|chào\s*em|good\s*morning|có\s*ai\s*không|test|ok|oke|ừ|dạ|vâng|cảm\s*ơn|thank)/i.test(
      lower
    ) &&
    cleanUser.length < 45
  ) {
    if (/cảm\s*ơn|thank/i.test(lower)) {
      return {
        replyText:
          'Không có gì ạ! 😊 Bạn cần mình giải đáp thêm câu hỏi nào, viết nội dung hay hỗ trợ thiết kế gì cứ nhắn tự nhiên nhé!',
      };
    }
    return {
      replyText:
        'Chào bạn! 👋 Mình là **ToanTrung** — trợ lý AI đa năng của bạn. Bạn có thể hỏi bất cứ chủ đề nào (tin tức, thời tiết, tỷ giá, kiến thức, viết nội dung, lập trình) hoặc yêu cầu tạo ảnh trực tiếp. Bạn đang cần mình hỗ trợ gì hôm nay?',
    };
  }

  // 3. Questions about who the AI is / capabilities / how are you
  if (
    /bạn\s*là\s*ai|tên\s*(?:là\s*)?gì|con\s*ai\s*nào|khỏe\s*không|ăn\s*cơm\s*chưa|làm\s*được\s*gì|giúp\s*được\s*gì|nói\s*chuyện\s*bình\s*thường/i.test(
      lower
    )
  ) {
    return {
      replyText:
        'Mình là **ToanTrung AI**! 😊 Bạn có thể hỏi đáp mọi kiến thức, tra cứu thông tin trực tuyến, nhờ viết bài quảng cáo, dịch thuật, tính toán hoặc yêu cầu tạo/sửa ảnh bất kỳ lúc nào.',
    };
  }

  // 4. Simple math / calculation expressions
  const mathMatch = cleanUser.match(/^(\d+(?:[.,]\d+)?)\s*([+\-*/x×:])\s*(\d+(?:[.,]\d+)?)\s*[=?]?$/i);
  if (mathMatch) {
    const a = Number(mathMatch[1].replace(',', '.'));
    const op = mathMatch[2];
    const b = Number(mathMatch[3].replace(',', '.'));
    let res = 0;
    if (op === '+') res = a + b;
    else if (op === '-') res = a - b;
    else if (op === '*' || op.toLowerCase() === 'x' || op === '×') res = a * b;
    else if ((op === '/' || op === ':') && b !== 0) res = Number((a / b).toFixed(4));
    return {
      replyText: `Kết quả của **${a} ${op} ${b}** là **${res}** nhé bạn!`,
    };
  }

  // 5. Copywriting / Content / Marketing / Slogan requests
  if (/\b(viết|soạn|lên\s*ý\s*tưởng|content|bài\s*đăng|quảng\s*cáo|slogan|kịch\s*bản|email|thư\s*ngỏ|báo\s*giá)\b/i.test(lower) && !isExplicitPosterRequest) {
    return {
      replyText: [
        `Dưới đây là gợi ý nội dung theo yêu cầu **"${cleanUser}"** của bạn:`,
        `---`,
        `✨ **Tiêu đề gợi ý:** Giải Pháp Trình Chiếu Màn Hình LED Chuyên Nghiệp — Nâng Tầm Không Gian Của Bạn`,
        `• **Điểm nhấn 1:** Hình ảnh sắc nét chuẩn 4K, góc nhìn siêu rộng, hoạt động bền bỉ 24/7.`,
        `• **Điểm nhấn 2:** Thiết kế liền mạch theo đúng kích thước thực tế, thẩm mỹ sang trọng.`,
        `• **Kêu gọi hành động (CTA):** Liên hệ ngay để được khảo sát miễn phí và dựng phối cảnh 3D trực tiếp trên không gian của bạn!`,
        `---`,
        `Bạn muốn mình chỉnh lại giọng văn (ngắn gọn hơn, sang trọng hơn hay hài hước hơn) cứ nhắn mình nhé!`,
      ].join('\n'),
    };
  }

  // 6. Specific LED comparison or technical Q&A (without dumping the rigid 3-bullet photo template)
  if (/\b(khác\s*gì|so\s*sánh|nên\s*chọn|nên\s*dùng|là\s*gì|p1\.|p2\.|p3|p4|p5|indoor|outdoor|nits|cabinet|module|công\s*suất|điện)\b/i.test(lower) && !isExplicitPhotoAnalysis) {
    return {
      replyText: [
        `Về câu hỏi **"${cleanUser}"** của bạn, mình giải thích ngắn gọn và dễ hiểu như sau nhé:`,
        `• **Về khoảng cách nhìn (Bước điểm ảnh P):** Số P càng nhỏ (như P1.53, P2.0, P2.5) thì điểm ảnh càng dày, nhìn gần từ **2m – 5m** cực kỳ mịn (phù hợp phòng họp, hội trường, showroom). Số P lớn hơn (P3, P4, P5) phù hợp sảnh lớn hoặc ngoài trời nhìn xa từ **4m – 30m+**.`,
        `• **Về môi trường lắp đặt:** Dòng **Indoor** có độ sáng vừa phải (~600–800 nits) để nhìn lâu không chói mắt; dòng **Outdoor** có chuẩn chống nước **IP65** và độ sáng rất cao (**4.500 – 6.000 nits**) để rõ nét dưới nắng gắt.`,
        `• Với dự án đang mở hiện tại (${widthM}m × ${heightM}m · ${areaM2}m²), nếu cần mình tính chi tiết số tấm Module hay xuất ảnh phối cảnh thì bạn cứ bảo mình nhé!`,
      ].join('\n'),
    };
  }

  // 7. Explicit Poster request
  if (isExplicitPosterRequest || (designType === 'banner' && isExplicitPhotoAnalysis)) {
    const suggestedTaoAnhPrompt = `@TaoAnhPoster: Thiết kế Poster quảng cáo LED tỷ lệ ${aspectRatio} (${bannerWidthPx}×${bannerHeightPx}px) theo nội dung: "${cleanUser}", nổi bật sản phẩm & thông điệp chính`;
    const replyText = [
      `Mình đã lên bố cục thiết kế Poster/Banner LED (${bannerWidthPx}×${bannerHeightPx}px · tỷ lệ ${aspectRatio}) theo yêu cầu của bạn.`,
      `👉 Bạn có thể bấm nút bên dưới để AI xuất mẫu Poster ngay nhé!`,
    ].join('\n');
    return { replyText, suggestedTaoAnhPrompt };
  }

  // 8. Explicit Photo Analysis & 3D LED Composite suggestion (only when user clicked "Phân tích ảnh" or asked for photo analysis)
  if (isExplicitPhotoAnalysis) {
    const styleLabel =
      screenStyle === 'curved'
        ? 'màn hình LED bo cong'
        : screenStyle === 'corner_90'
          ? 'màn hình LED vuông góc 90°'
          : 'màn hình LED phẳng viền mỏng';
    const quadSummary = placementQuad
      ? `tọa độ điểm chạm A(${Math.round(placementQuad.topLeft.x)}%, ${Math.round(placementQuad.topLeft.y)}%) → C(${Math.round(placementQuad.bottomRight.x)}%, ${Math.round(placementQuad.bottomRight.y)}%)`
      : 'vùng trung tâm công trình';
    const suggestedTaoAnhPrompt = `@TaoAnh: Ghép phối cảnh ${styleLabel} ${pitch} kích thước ${snappedWmm} × ${snappedHmm}mm vào đúng các điểm chạm đã chấm trên ảnh khảo sát, kèm đường gióng kích thước kỹ thuật (mm)`;
    const replyText = [
      `Mình đã xem bức ảnh công trình hiện tại (${quadSummary}) và tính toán nhanh thông số cho bạn:`,
      `• **Kích thước chuẩn theo Module (320×160mm):** **${snappedWmm} × ${snappedHmm} mm** (${areaM2} m² · gồm ${totalModules} tấm Module / ${totalCabinets} Cabinet).`,
      `• **Dòng LED & Nguồn:** **${pitch} ${isOutdoor ? 'Outdoor (IP65)' : 'Indoor'}** (tầm nhìn tối ưu ${minViewM}m – ${maxViewM}m), công suất tiêu thụ khoảng **${avgKw} – ${maxKw} kW**.`,
      `👉 Mình đã soạn sẵn lệnh **@TaoAnh** bên dưới nếu bạn muốn ghép thử màn hình LED lên ảnh ngay!`,
    ].join('\n');
    return { replyText, suggestedTaoAnhPrompt };
  }

  // 9. General open-ended conversation fallback (Natural, helpful response without forcing site photo or hardware specs!)
  return {
    replyText: [
      `Mình đã ghi nhận yêu cầu của bạn: **"${cleanUser}"**.`,
      `• Bạn có thể trò chuyện tự do với mình về bất kỳ chủ đề nào (lên ý tưởng sáng tạo, viết nội dung, giải đáp thắc mắc, lập kế hoạch) hoặc gõ trực tiếp **"Tạo ảnh <mô tả bức ảnh bạn muốn>"** để mình vẽ ảnh ngay theo yêu cầu của bạn mà không cần tải ảnh công trình hay nhập thông số kỹ thuật!`,
    ].join('\n'),
  };
}

export async function processChatDesignRequest(
  actor: SessionUserDto,
  requestId: number,
  input: ChatDesignRequestDto
) {
  await assertCanAccessDesignProject(actor, requestId);

  const piiCheck = containsCustomerPiiInPrompt(input.prompt);
  if (piiCheck.hasPii) {
    throw new Error(piiCheck.reason);
  }

  const existing = await prisma.designRequest.findUnique({
    where: { id: requestId },
    include: {
      assetVersions: {
        orderBy: { versionNumber: 'desc' },
      },
    },
  });

  if (!existing) {
    throw new Error('Không tìm thấy yêu cầu thiết kế.');
  }

  if (
    typeof input.expectedVersion === 'number' &&
    input.expectedVersion > 0 &&
    existing.version !== input.expectedVersion
  ) {
    throw new ConcurrencyConflictError('DesignRequest', requestId, input.expectedVersion);
  }

  const currentMeta = parseProjectMetadata(existing.installPositionJson);

  // 0. Idempotency check (memory + DB metadata + aiUsageLogs): prevent duplicate billable jobs or versions across restarts
  if (input.idempotencyKey && currentMeta.processedIdempotencyKeys?.[input.idempotencyKey]) {
    const prevRecord = currentMeta.processedIdempotencyKeys[input.idempotencyKey];
    return {
      requestId,
      idempotentReplay: true,
      versionNumber: prevRecord.versionNumber,
      versionId: prevRecord.versionId,
      downloadUrl: `/api/v1/design/asset/${prevRecord.versionId}`,
      chatMessages: currentMeta.chatMessages || [],
      designContext: currentMeta.designContext,
    };
  }
  if (input.idempotencyKey) {
    const existingUsage = await prisma.aiUsageLog.findFirst({
      where: {
        designRequestId: requestId,
        idempotencyKey: input.idempotencyKey,
        status: 'success',
      },
      include: {
        designAssetVersion: true,
      },
    });
    const versionRel = existingUsage?.designAssetVersion;
    const matchedVer =
      (Array.isArray(versionRel) ? versionRel[0] : versionRel) || existing.assetVersions[0];
    if (existingUsage && matchedVer) {
      return {
        requestId,
        idempotentReplay: true,
        versionNumber: matchedVer.versionNumber,
        versionId: matchedVer.id,
        downloadUrl: `/api/v1/design/asset/${matchedVer.id}`,
        chatMessages: currentMeta.chatMessages || [],
        designContext: currentMeta.designContext,
      };
    }
  }
  if (
    input.idempotencyKey &&
    currentMeta.activeJob?.status === 'running' &&
    currentMeta.activeJob.idempotencyKey === input.idempotencyKey &&
    activeDesignJobLocks.has(requestId)
  ) {
    return {
      accepted: true,
      asyncQueued: true,
      idempotentReplay: true,
      requestId,
      jobId: currentMeta.activeJob.jobId,
      activeJob: currentMeta.activeJob,
      status: 'running' as const,
      chatMessages: currentMeta.chatMessages || [],
      designContext: currentMeta.designContext,
    };
  }

  const nextVersionNumber = (existing.assetVersions[0]?.versionNumber ?? 0) + 1;

  // 1. Initialize or load per-project DesignContext
  let designContext: ProjectDesignContext =
    currentMeta.designContext ||
    createInitialDesignContext({
      projectId: requestId,
      leadId: existing.leadId,
      widthMm: Math.round((currentMeta.screenWidthM ?? 4.8) * 1000),
      heightMm: Math.round((currentMeta.screenHeightM ?? 2.7) * 1000),
      pixelPitch: currentMeta.pixelPitch || 'P2.5',
      cabinetModel: currentMeta.cabinetModelCode || 'CAB-640x480-DIE',
      placementQuad: input.placementQuad || currentMeta.placementQuad || null,
      selectedPhotoId:
        input.selectedPhotoId || (currentMeta.photos || []).find((p) => p.selected)?.id || null,
      activeVersionId: input.sourceVersionId ?? existing.assetVersions[0]?.id ?? null,
      screenStyle: currentMeta.screenStyle || 'flat',
      compositingMode: input.compositingMode || currentMeta.compositingMode || 'STRICT',
    });

  if (input.placementQuad) {
    designContext.fields.placementQuad = input.placementQuad;
    designContext.provenance.placementQuad = 'user_confirmed';
  }
  if (input.selectedPhotoId) {
    designContext.fields.selectedPhotoId = input.selectedPhotoId;
  }
  if (input.sourceVersionId !== undefined) {
    designContext.fields.activeVersionId = input.sourceVersionId;
  }
  if (input.compositingMode) {
    designContext.fields.compositingMode = input.compositingMode;
  }

  // Persist brief/task metadata when provided in chat request
  if (input.taskCode) {
    currentMeta.taskCode = input.taskCode;
  }
  if (input.designBrief) {
    currentMeta.designBrief = {
      ...(currentMeta.designBrief || {}),
      ...input.designBrief,
    };
    if (input.designBrief.websiteId !== undefined) currentMeta.websiteId = input.designBrief.websiteId;
    if (input.designBrief.websiteDomain !== undefined) currentMeta.websiteDomain = input.designBrief.websiteDomain;
    if (input.designBrief.campaignId !== undefined) currentMeta.campaignId = input.designBrief.campaignId;
    if (input.designBrief.campaignName !== undefined) currentMeta.campaignName = input.designBrief.campaignName;
    if (input.designBrief.contentId !== undefined) currentMeta.contentId = input.designBrief.contentId;
    if (input.designBrief.outputWidthPx) currentMeta.bannerWidthPx = input.designBrief.outputWidthPx;
    if (input.designBrief.outputHeightPx) currentMeta.bannerHeightPx = input.designBrief.outputHeightPx;
  }

  // 2. Deterministic Command Router (free chat mode stays CHAT unless explicit @banner/@taobanner/@TaoAnh command is typed)
  const isExplicitBannerCommand = DAO_TAO_ANH_POSTER_REGEX.test(input.prompt);
  const isExplicitSceneCommand = !isExplicitBannerCommand && DAO_TAO_ANH_REGEX.test(input.prompt);
  const isExplicitImageCommand = isExplicitBannerCommand || isExplicitSceneCommand;
  const triggerSource = input.triggerSource || 'user_input';
  const routeDecision =
    input.taskCode === 'brief_analyze' ||
    (input.chatMode === 'consultant_free' && !isExplicitImageCommand)
      ? {
          action: 'CHAT' as const,
          commandToken: null,
          cleanInstruction: input.prompt,
          isMetaQuestionAboutCommand: false,
          blockedNonUserTrigger: false,
          reason:
            input.taskCode === 'brief_analyze'
              ? 'taskCode:brief_analyze'
              : 'chatMode:consultant_free',
        }
      : isExplicitImageCommand
        ? routeDesignCommand({
            rawMessage: input.prompt,
            source: triggerSource,
            explicitButtonAction: null,
          })
        : input.taskCode === 'banner_generate'
          ? {
              action: 'GENERATE_BANNER' as const,
              commandToken: '@banner',
              cleanInstruction: input.prompt,
              isMetaQuestionAboutCommand: false,
              blockedNonUserTrigger: false,
              reason: 'taskCode:banner_generate',
            }
          : input.taskCode === 'perspective_compose'
            ? {
                action: 'GENERATE_SCENE' as const,
                commandToken: '@taoanh',
                cleanInstruction: input.prompt,
                isMetaQuestionAboutCommand: false,
                blockedNonUserTrigger: false,
                reason: 'taskCode:perspective_compose',
              }
            : input.taskCode === 'design_edit'
              ? {
                  action: (existing.requestType === 'banner' ? 'GENERATE_BANNER' : 'GENERATE_SCENE') as
                    | 'GENERATE_BANNER'
                    | 'GENERATE_SCENE',
                  commandToken: existing.requestType === 'banner' ? '@banner' : '@taoanh',
                  cleanInstruction: input.prompt,
                  isMetaQuestionAboutCommand: false,
                  blockedNonUserTrigger: false,
                  reason: 'taskCode:design_edit',
                }
              : routeDesignCommand({
                  rawMessage: input.prompt,
                  source: triggerSource,
                  explicitButtonAction:
                    input.chatMode === 'image_generator' &&
                    triggerSource === 'user_button'
                      ? existing.requestType === 'banner'
                        ? 'GENERATE_BANNER'
                        : 'GENERATE_SCENE'
                      : null,
                });

  // Extract multi-turn user-confirmed specifications from chat text
  const extraction = extractAndMergeUserChatContext(designContext, input.prompt);
  designContext = extraction.updatedContext;

  // Sync user-confirmed DesignContext parameters into StoredMetadata without overwriting confirmed fields with defaults
  if (designContext.provenance.widthMm === 'user_confirmed' && designContext.fields.widthMm) {
    currentMeta.screenWidthM = Number((designContext.fields.widthMm / 1000).toFixed(3));
  } else if (input.screenWidthM && designContext.provenance.widthMm !== 'user_confirmed') {
    currentMeta.screenWidthM = input.screenWidthM;
  }
  if (designContext.provenance.heightMm === 'user_confirmed' && designContext.fields.heightMm) {
    currentMeta.screenHeightM = Number((designContext.fields.heightMm / 1000).toFixed(3));
  } else if (input.screenHeightM && designContext.provenance.heightMm !== 'user_confirmed') {
    currentMeta.screenHeightM = input.screenHeightM;
  }
  if (designContext.provenance.pixelPitch === 'user_confirmed' && designContext.fields.pixelPitch) {
    currentMeta.pixelPitch = designContext.fields.pixelPitch;
  }
  if (
    designContext.provenance.installPosition === 'user_confirmed' &&
    designContext.fields.installPosition
  ) {
    currentMeta.installationInfo = designContext.fields.installPosition;
  }
  if (
    designContext.provenance.screenStyle === 'user_confirmed' &&
    designContext.fields.screenStyle
  ) {
    currentMeta.screenStyle = designContext.fields.screenStyle;
  }
  if (
    designContext.provenance.targetResolution === 'user_confirmed' &&
    designContext.fields.targetResolution
  ) {
    currentMeta.bannerWidthPx = designContext.fields.targetResolution.widthPx;
    currentMeta.bannerHeightPx = designContext.fields.targetResolution.heightPx;
  }
  currentMeta.compositingMode = designContext.fields.compositingMode;

  // 3. Resolve exact source image (either a selected survey photo OR a specific source version for iterative editing)
  const photosList = currentMeta.photos || [];
  if (input.selectedPhotoId && photosList.length > 0) {
    for (const p of photosList) {
      p.selected = p.id === input.selectedPhotoId;
    }
    currentMeta.photos = photosList;
  }
  const activePhotoObj =
    (input.selectedPhotoId
      ? photosList.find((p) => p.id === input.selectedPhotoId)
      : undefined) ||
    photosList.find((p) => p.selected) ||
    photosList[0];

  const requestedParentVerId =
    input.parentVersionId ??
    input.sourceVersionId ??
    (input.taskCode === 'design_edit' ? existing.assetVersions[0]?.id ?? null : null);

  const sourceVersionObj = requestedParentVerId
    ? existing.assetVersions.find((v) => v.id === requestedParentVerId) || null
    : null;

  let storageKeyToRead: string | null = null;
  let sourceImageOrigin: 'version' | 'survey_photo' | 'none' = 'none';
  if (sourceVersionObj?.storageObjectKey) {
    storageKeyToRead = sourceVersionObj.storageObjectKey;
    sourceImageOrigin = 'version';
  } else if (activePhotoObj?.storageObjectKey) {
    storageKeyToRead = activePhotoObj.storageObjectKey;
    sourceImageOrigin = 'survey_photo';
  } else if (input.selectedPhotoUrl?.includes('key=')) {
    try {
      const q = input.selectedPhotoUrl.split('?')[1] || '';
      storageKeyToRead = new URLSearchParams(q).get('key');
      if (storageKeyToRead) sourceImageOrigin = 'survey_photo';
    } catch {
      storageKeyToRead = null;
    }
  } else if (existing.sitePhotoUrl && !existing.sitePhotoUrl.startsWith('/')) {
    storageKeyToRead = existing.sitePhotoUrl;
    sourceImageOrigin = 'survey_photo';
  }

  const activePhotoFileData = storageKeyToRead ? readPrivateBusinessFile(storageKeyToRead) : null;
  const resolvedInputAssetIds: string[] = Array.from(
    new Set([
      ...(Array.isArray(input.inputAssetIds) ? input.inputAssetIds : []),
      ...(sourceVersionObj ? [`version:${sourceVersionObj.id}`] : []),
      ...(activePhotoObj?.id ? [`photo:${activePhotoObj.id}`] : []),
      ...(input.referenceProductPhotoIds || []).map((id) => `product:${id}`),
    ]),
  );

  // Gather any Product Reference Photos (only when NOT explicitly running pure-prompt banner mode)
  const isPromptOnlyBannerMode = input.bannerMode === 'prompt_only';
  const requestedProductIds = new Set(isPromptOnlyBannerMode ? [] : input.referenceProductPhotoIds || []);
  const productReferencePhotoObjs = isPromptOnlyBannerMode
    ? []
    : photosList.filter(
        (p) => requestedProductIds.has(p.id) || (requestedProductIds.size === 0 && p.photoRole === 'product_reference')
      );
  const productReferenceBuffers: Array<{ buffer: Buffer; mimeType: string; name: string }> = [];
  const attachedProductPhotosMeta: Array<{ id: string; name: string; url: string }> = [];
  const seenStorageKeys = new Set<string>();

  if (!isPromptOnlyBannerMode) {
    for (const prodPhoto of productReferencePhotoObjs) {
      attachedProductPhotosMeta.push({
        id: prodPhoto.id,
        name: prodPhoto.name,
        url: prodPhoto.url,
      });
      if (prodPhoto.storageObjectKey && !seenStorageKeys.has(prodPhoto.storageObjectKey)) {
        seenStorageKeys.add(prodPhoto.storageObjectKey);
        const f = readPrivateBusinessFile(prodPhoto.storageObjectKey);
        if (f && f.buffer.length > 0) {
          productReferenceBuffers.push({
            buffer: f.buffer,
            mimeType: f.mimeType || 'image/jpeg',
            name: prodPhoto.name,
          });
        }
      }
    }

    // Also support Company Product Vault photos selected across projects via referenceProductPhotoUrls
    for (const rawUrl of input.referenceProductPhotoUrls || []) {
      try {
        const q = rawUrl.includes('?') ? rawUrl.split('?')[1] || '' : '';
        const storageKey = new URLSearchParams(q).get('key');
        if (storageKey && !seenStorageKeys.has(storageKey)) {
          seenStorageKeys.add(storageKey);
          const f = readPrivateBusinessFile(storageKey);
          if (f && f.buffer.length > 0) {
            productReferenceBuffers.push({
              buffer: f.buffer,
              mimeType: f.mimeType || 'image/jpeg',
              name: input.referenceProductName || f.fileName || 'san-pham-cong-ty.png',
            });
          }
        }
      } catch {
        // ignore invalid url
      }
    }
  }

  const effectiveWidthM =
    (designContext.fields.widthMm ? designContext.fields.widthMm / 1000 : null) ||
    input.screenWidthM ||
    currentMeta.screenWidthM ||
    4.8;
  const effectiveHeightM =
    (designContext.fields.heightMm ? designContext.fields.heightMm / 1000 : null) ||
    input.screenHeightM ||
    currentMeta.screenHeightM ||
    2.7;
  const effectiveBannerW =
    designContext.fields.targetResolution?.widthPx ||
    input.bannerWidthPx ||
    currentMeta.bannerWidthPx ||
    1920;
  const effectiveBannerH =
    designContext.fields.targetResolution?.heightPx ||
    input.bannerHeightPx ||
    currentMeta.bannerHeightPx ||
    1080;
  const effectivePitch =
    designContext.fields.pixelPitch ||
    currentMeta.pixelPitch ||
    currentMeta.productSpec?.pixelPitch ||
    'P2.5';
  const effectiveStyle =
    designContext.fields.screenStyle ||
    currentMeta.screenStyle ||
    currentMeta.productSpec?.screenStyle ||
    'flat';

  // Recompute independent LED technical spec & BOM
  currentMeta.productSpec = computeLedProductSpec({
    productCode: currentMeta.productSpec?.productCode,
    productName: existing.ledCategory || 'Màn hình LED Indoor',
    categoryGroup: currentMeta.productSpec?.categoryGroup,
    widthM: effectiveWidthM,
    heightM: effectiveHeightM,
    pitch: effectivePitch,
    screenStyle: effectiveStyle,
    cabinetModelCode: currentMeta.cabinetModelCode,
  });

  const dbType: 'banner' | '3d_perspective' =
    routeDecision.action === 'GENERATE_BANNER'
      ? 'banner'
      : routeDecision.action === 'GENERATE_SCENE'
        ? '3d_perspective'
        : existing.requestType === 'banner'
          ? 'banner'
          : '3d_perspective';

  const isImageGenerationMode =
    routeDecision.action === 'GENERATE_SCENE' || routeDecision.action === 'GENERATE_BANNER';

  // MODE 1: CHAT MODEL ONLY ($0.00 - Never auto-creates an AI Image Job on normal chat messages)
  if (!isImageGenerationMode) {
    const wM = effectiveWidthM;
    const hM = effectiveHeightM;
    const bW = effectiveBannerW;
    const bH = effectiveBannerH;
    const ratio = input.aspectRatio || existing.aspectRatio || '16:9';
    const pitch = effectivePitch;
    const style = effectiveStyle;

    const fallbackConsult = buildConsultantReplyAndSuggestedPrompt({
      userText: input.prompt,
      designType: dbType,
      widthM: wM,
      heightM: hM,
      bannerWidthPx: bW,
      bannerHeightPx: bH,
      aspectRatio: ratio,
      pitch,
      screenStyle: style,
      placementQuad: input.placementQuad || currentMeta.placementQuad,
    });

    let replyText = fallbackConsult.replyText;
    if (routeDecision.isMetaQuestionAboutCommand) {
      replyText = [
        `Mình giải thích nhanh về 2 lệnh tạo ảnh trong Studio nhé:`,
        `• **\`@taoanh <mô tả>\`** (hoặc \`@TaoAnh\`): Dùng khi bạn muốn AI ghép phối cảnh màn hình LED vào đúng 4 góc đã chấm trên ảnh khảo sát.`,
        `• **\`@banner <nội dung>\`** (hoặc \`@baneer\`, \`@taobanner\`, \`@TaoAnhPoster\`): Dùng khi bạn muốn AI thiết kế hình ảnh Banner/Poster trình chiếu trên màn hình LED.`,
        `• Còn khi bạn nhắn tin bình thường như thế này thì mình sẽ trò chuyện, giải đáp và tư vấn hoàn toàn tự nhiên như một AI thông thường (không tự động tạo ảnh hay tốn phí)! 😊`,
      ].join('\n');
    } else if (extraction.newlyConfirmedLabels.length > 0) {
      const techEval = evaluateLedTechnicalConfig({
        widthMm: Math.round(wM * 1000),
        heightMm: Math.round(hM * 1000),
        pixelPitch: pitch,
        cabinetModelCode: currentMeta.cabinetModelCode,
        screenStyle: style,
      });
      replyText = [
        `Mình đã nắm được thông tin bạn vừa chia sẻ (**${extraction.newlyConfirmedLabels.join(', ')}**) nhé! 👍`,
        `• Cấu hình hiện tại của dự án: **${Math.round(wM * 1000)} × ${Math.round(hM * 1000)} mm** (${wM}m × ${hM}m), dòng **${pitch}** (${techEval.theoreticalResolutionWidthPx} × ${techEval.theoreticalResolutionHeightPx} px).`,
        ...(techEval.warnings.length > 0 ? [`• Lưu ý kỹ thuật nhẹ: ${techEval.warnings[0]}`] : []),
        `Bạn muốn trao đổi thêm về phương án thiết kế hay cần mình hỗ trợ nội dung gì tiếp cứ nhắn tự nhiên nhé!`,
      ].join('\n');
    }

    let suggestedTaoAnhPrompt: string | undefined = fallbackConsult.suggestedTaoAnhPrompt;
    let consultModelUsed = 'ToanTrung AI';

    // Call live LLM (supports both OpenAI-compatible Gateways like APIVN / CCPRO / OpenAI AND Google Gemini API) for natural multi-turn conversation!
    const { config: aiCfg } = AiDesignProviderFactory.getCatalog();
    const geminiApiKey =
      aiCfg.providers.google_imagen?.apiKey ||
      process.env.GEMINI_API_KEY ||
      process.env.IMAGEN_API_KEY;
    const customCred = resolveEffectiveProviderCredential('custom_endpoint', aiCfg);
    const openAiCred = resolveEffectiveProviderCredential('openai_dalle', aiCfg);
    const isOfflineUnitTest = Boolean(process.env.NODE_TEST_CONTEXT);

    const liveGrounding =
      !input.simulateAiTimeout && !isOfflineUnitTest
        ? await gatherLiveWebGrounding(input.prompt).catch(() => null)
        : null;

    const asksAboutLedSpecs =
      /\b(p1\.|p2\.|p3|p4|p5|cabinet|module|pixel\s*pitch|nits|kích\s*thước\s*màn|bao\s*nhiêu\s*mét|công\s*suất\s*điện|điểm\s*chạm)\b/i.test(
        input.prompt
      );
    const sysInstruction = [
      `Thời gian hiện tại (Việt Nam): ${formatVietnamNowLabel()}.`,
      'Bạn là ToanTrung — trợ lý AI thông minh, thân thiện, đa năng và chuyên nghiệp.',
      'NGUYÊN TẮC QUAN TRỌNG:',
      '1. Khi được hỏi tên hoặc giới thiệu bản thân, hãy xưng là ToanTrung AI. Trò chuyện tự nhiên, thông minh, trả lời thẳng vào đúng câu hỏi hoặc yêu cầu của người dùng về BẤT KỲ chủ đề nào (thời tiết, tin tức, tỷ giá, kiến thức chung, viết lách, marketing, ý tưởng thiết kế, lập trình, kinh doanh, đời sống...).',
      '2. TUYỆT ĐỐI KHÔNG tự ý nhắc đến hay ép người dùng phải tải ảnh công trình, chấm 4 góc hay nhập thông số màn hình LED (mm, P2.5, cabinet) nếu người dùng không hỏi về thông số LED.',
      ...(asksAboutLedSpecs
        ? [
            `3. Người dùng đang hỏi về kỹ thuật LED; thông số tham khảo hiện tại (nếu cần): LED ${pitch}, kích thước ${wM}m x ${hM}m, tỷ lệ ${ratio}.`,
          ]
        : []),
      '4. Nếu người dùng nhờ lên ý tưởng tạo ảnh hoặc muốn vẽ/tạo một bức ảnh theo mô tả tự do, hãy tư vấn nhiệt tình và có thể gợi ý ở dòng cuối một câu lệnh dạng: `@banner: <mô tả chi tiết bức ảnh cần tạo>` để người dùng bấm tạo ảnh ngay.',
      ...(liveGrounding?.contextText
        ? [
            '',
            '=== DỮ LIỆU THỜI GIAN THỰC ĐÃ TRA CỨU TỪ INTERNET ===',
            liveGrounding.contextText,
            '=== HƯỚNG DẪN DÙNG DỮ LIỆU ===',
            'Dùng ngay dữ liệu thời gian thực phía trên để trả lời chính xác, tự nhiên và đầy đủ cho người dùng. KHÔNG được nói rằng bạn không có internet hay kiến thức bị giới hạn đến năm 2025.',
          ]
        : []),
    ].join('\n');

    const rawHistory = (currentMeta.chatMessages || [])
      .filter((m) => m.text && !m.id.startsWith('msg-ai-welcome-'))
      .slice(-8);

    let liveChatSucceeded = false;

    // A. Try OpenAI-compatible Gateway (/v1/chat/completions) first if user selected custom_endpoint or openai_dalle (e.g. APIVN, CCPRO, OpenAI)
    const preferGatewayChat =
      input.providerId === 'custom_endpoint' ||
      input.providerId === 'openai_dalle' ||
      aiCfg.defaultProviderId === 'custom_endpoint' ||
      aiCfg.defaultProviderId === 'openai_dalle' ||
      !geminiApiKey;

    const gatewayKey =
      input.providerId === 'openai_dalle'
        ? openAiCred.apiKey || customCred.apiKey
        : customCred.apiKey || openAiCred.apiKey;
    const gatewayRawEndpoint =
      input.providerId === 'openai_dalle' && openAiCred.apiKey
        ? openAiCred.apiEndpoint || 'https://api.openai.com/v1'
        : customCred.apiEndpoint || openAiCred.apiEndpoint || 'https://api.openai.com/v1';

    if (preferGatewayChat && gatewayKey && !input.simulateAiTimeout && !isOfflineUnitTest) {
      try {
        const cleanBase = gatewayRawEndpoint
          .replace(/\/(images\/generations|images\/edits|chat\/completions|models).*$/i, '')
          .replace(/\/+$/, '');
        const chatUrl = cleanBase.endsWith('/v1')
          ? `${cleanBase}/chat/completions`
          : `${cleanBase}/v1/chat/completions`;

        const rankGatewayModel = (id: string): number => {
          const l = id.toLowerCase();
          if (l.includes('gemini-3') || l.includes('claude-sonnet') || l.includes('gpt-6')) return 0;
          if (l.includes('gpt-5') || l.includes('claude-opus') || l.includes('gpt-4o')) return 1;
          if (l.includes('haiku') || l.includes('mini') || l.includes('lite') || l.includes('nano')) {
            return 3;
          }
          return 2;
        };

        const rawRequestedChatCandidate =
          input.modelId &&
          input.modelId !== 'toantrung-rules-v3' &&
          input.modelId !== 'toantrung-studio-v3' &&
          !input.modelId.includes('image') &&
          !input.modelId.includes('imagen') &&
          !input.modelId.includes('dall-e')
            ? input.modelId.trim()
            : '';

        const discoveredGatewayChatModels = (
          aiCfg.providers.custom_endpoint?.discoveredModels ||
          aiCfg.providers.openai_dalle?.discoveredModels ||
          []
        )
          .map((m) => m.id.trim())
          .filter((id) => id && AiDesignProviderFactory.isChatOnlyModel(id));

        const sortedGatewayModels = [...discoveredGatewayChatModels].sort(
          (a, b) => rankGatewayModel(a) - rankGatewayModel(b)
        );

        const isExplicitHaiku = /haiku/i.test(rawRequestedChatCandidate);
        const gatewayCandidates = Array.from(
          new Set(
            [
              ...(isExplicitHaiku ? [rawRequestedChatCandidate] : []),
              ...(!isExplicitHaiku && rawRequestedChatCandidate ? [rawRequestedChatCandidate] : []),
              ...sortedGatewayModels,
              'gpt-4o-mini',
              'gpt-4o',
              'gemini-2.5-flash',
            ].filter(Boolean)
          )
        ).slice(0, 3);

        const oaBaseHistory = rawHistory.map((m) => ({
          role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
          content: m.text.trim(),
        }));

        const asksAboutGatewayVisual =
          input.taskCode === 'brief_analyze' ||
          attachedProductPhotosMeta.length > 0 ||
          /nhìn\s*ảnh|xem\s*ảnh|phân\s*tích\s*ảnh|trong\s*bức\s*ảnh|ảnh\s*này|hình\s*này/i.test(
            input.prompt
          );
        const wantsGatewayVision =
          asksAboutGatewayVisual &&
          Boolean(
            activePhotoFileData &&
              activePhotoFileData.buffer.length > 0 &&
              activePhotoFileData.buffer.length < 4 * 1024 * 1024
          );

        type GatewayMessage = {
          role: 'system' | 'user' | 'assistant';
          content:
            | string
            | Array<
                | { type: 'text'; text: string }
                | { type: 'image_url'; image_url: { url: string } }
              >;
        };

        const oaTextMessages: GatewayMessage[] = [
          { role: 'system', content: sysInstruction },
          ...oaBaseHistory,
          { role: 'user', content: input.prompt },
        ];

        const oaVisionMessages: GatewayMessage[] =
          wantsGatewayVision && activePhotoFileData
            ? [
                { role: 'system', content: sysInstruction },
                ...oaBaseHistory,
                {
                  role: 'user',
                  content: [
                    { type: 'text', text: input.prompt },
                    {
                      type: 'image_url',
                      image_url: {
                        url: `data:${
                          activePhotoFileData.mimeType?.startsWith('image/')
                            ? activePhotoFileData.mimeType
                            : 'image/jpeg'
                        };base64,${activePhotoFileData.buffer.toString('base64')}`,
                      },
                    },
                  ],
                },
              ]
            : oaTextMessages;

        for (const gwModel of gatewayCandidates) {
          try {
            let gwRes = await fetch(chatUrl, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${gatewayKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: gwModel,
                messages: oaVisionMessages,
                max_tokens: 1400,
                temperature: 0.7,
              }),
              signal: AbortSignal.timeout(15000),
            });
            // If gateway/model rejects multimodal image_url with 400/422, retry once with plain text
            if (!gwRes.ok && (gwRes.status === 400 || gwRes.status === 422) && wantsGatewayVision) {
              gwRes = await fetch(chatUrl, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${gatewayKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  model: gwModel,
                  messages: oaTextMessages,
                  max_tokens: 1400,
                  temperature: 0.7,
                }),
                signal: AbortSignal.timeout(15000),
              });
            }
            if (gwRes.ok) {
              const gwJson = (await gwRes.json()) as {
                model?: string;
                choices?: Array<{ message?: { content?: string } }>;
              };
              const extracted = gwJson.choices?.[0]?.message?.content?.trim();
              if (extracted) {
                const cmdMatch = extracted.match(/(@(?:TaoAnhPoster|TaoAnh|taobanner|taoanh)\s*:?[^\n]+)/i);
                if (cmdMatch) {
                  suggestedTaoAnhPrompt = cmdMatch[1].trim();
                  replyText = extracted.replace(cmdMatch[0], '').trim() || extracted;
                } else {
                  suggestedTaoAnhPrompt = undefined;
                  replyText = extracted;
                }
                consultModelUsed = gwJson.model || gwModel || 'ToanTrung AI';
                liveChatSucceeded = true;
                break;
              }
            }
          } catch {
            // Try next gateway model
          }
        }
      } catch {
        // Fall through to Gemini or fallback
      }
    }

    if (!liveChatSucceeded && geminiApiKey && !input.simulateAiTimeout && !isOfflineUnitTest) {
      try {
        // Only attach the survey photo when the user explicitly asks to inspect the photo
        const asksAboutVisualImage =
          input.taskCode === 'brief_analyze' ||
          /nhìn\s*ảnh|xem\s*ảnh|phân\s*tích\s*ảnh|trong\s*bức\s*ảnh\s*này/i.test(
            input.prompt
          );
        const wantsImageAttachment =
          asksAboutVisualImage &&
          Boolean(
            activePhotoFileData &&
              activePhotoFileData.buffer.length > 0 &&
              activePhotoFileData.buffer.length < 5 * 1024 * 1024
          );

        // Normalize alternating user/model turns for Google generateContent API
        const historyTurns: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];
        for (const msg of rawHistory) {
          const role: 'user' | 'model' = msg.role === 'assistant' ? 'model' : 'user';
          const cleanText = msg.text.trim();
          if (!cleanText) continue;
          if (historyTurns.length === 0 && role === 'model') {
            // Google API requires the first turn in `contents` to have role 'user'
            continue;
          }
          const prev = historyTurns[historyTurns.length - 1];
          if (prev && prev.role === role) {
            prev.parts[0].text += `\n${cleanText}`;
          } else {
            historyTurns.push({ role, parts: [{ text: cleanText }] });
          }
        }
        // If last history turn was 'user', pop it so it doesn't collide with the current 'user' turn
        if (historyTurns.length > 0 && historyTurns[historyTurns.length - 1].role === 'user') {
          historyTurns.pop();
        }

        // Prioritize verified discoveredModels from the user's API key (putting full Gemini models before Gemma models)
        const discoveredIds = (aiCfg.providers.google_imagen?.discoveredModels || [])
          .map((m) => m.id.replace(/^models\//, '').trim())
          .filter(Boolean);
        const discoveredGeminiFirst = [
          ...discoveredIds.filter((id) => id.startsWith('gemini-') && !id.includes('image')),
          ...discoveredIds.filter((id) => !id.startsWith('gemini-') && !id.includes('image') && !id.includes('imagen')),
        ];

        const rawRequestedModel =
          input.modelId &&
          input.modelId !== 'toantrung-rules-v3' &&
          input.modelId !== 'toantrung-studio-v3' &&
          !input.modelId.includes('image') &&
          !input.modelId.includes('imagen')
            ? input.modelId.replace(/^models\//, '').trim()
            : '';

        const candidateModels = Array.from(
          new Set(
            [
              rawRequestedModel.startsWith('gemini-') ? rawRequestedModel : '',
              'gemini-2.5-flash',
              'gemini-3-flash-preview',
              ...discoveredGeminiFirst,
              'gemini-2.0-flash',
              'gemini-flash-lite-latest',
            ].filter(Boolean)
          )
        ).slice(0, 4);

        let rawAiText = '';
        let usedModelName = candidateModels[0] || 'gemini-3-flash-preview';

        for (const modelCandidate of candidateModels) {
          const isGemmaModel = modelCandidate.toLowerCase().startsWith('gemma-');
          const userPartsForModel: Array<
            | { text: string }
            | { inlineData: { mimeType: string; data: string } }
          > = [
            {
              text: isGemmaModel
                ? `[Hướng dẫn hệ thống: ${sysInstruction}]\n\nNgười dùng: ${input.prompt}`
                : input.prompt,
            },
          ];

          if (!isGemmaModel && wantsImageAttachment && activePhotoFileData) {
            userPartsForModel.push({
              inlineData: {
                mimeType: activePhotoFileData.mimeType.startsWith('image/')
                  ? activePhotoFileData.mimeType
                  : 'image/jpeg',
                data: activePhotoFileData.buffer.toString('base64'),
              },
            });
          }

          const payloadObj: Record<string, unknown> = {
            contents: [
              ...historyTurns,
              {
                role: 'user',
                parts: userPartsForModel,
              },
            ],
            generationConfig: {
              maxOutputTokens: 1400,
              temperature: 0.7,
            },
          };

          // Gemma models reject `systemInstruction` with HTTP 400; only attach `systemInstruction` on Gemini models
          if (!isGemmaModel) {
            payloadObj.systemInstruction = {
              parts: [{ text: sysInstruction }],
            };
          }

          const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
            modelCandidate
          )}:generateContent?key=${encodeURIComponent(geminiApiKey)}`;
          try {
            const gemRes = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payloadObj),
              signal: AbortSignal.timeout(12000),
            });
            if (gemRes.ok) {
              const gemJson = (await gemRes.json()) as {
                modelVersion?: string;
                candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
              };
              const extracted = gemJson.candidates?.[0]?.content?.parts
                ?.map((p) => p.text || '')
                .join('')
                .trim();
              if (extracted) {
                rawAiText = extracted;
                usedModelName = gemJson.modelVersion || modelCandidate;
                AiModelRegistryService.recordModelRuntimeObservation({
                  providerId: 'google_imagen',
                  modelId: modelCandidate,
                  taskCode: 'brief_analyze',
                  taskStatus: 'verified',
                  statusDetail: `Phân tích brief/ảnh thành công (modelVersion=${usedModelName}).`,
                });
                break;
              }
            } else if (gemRes.status === 429 || gemRes.status === 404) {
              continue;
            }
          } catch {
            // Try next candidate
          }
        }

        if (rawAiText) {
          const cmdMatch = rawAiText.match(/(@(?:TaoAnhPoster|TaoAnh|taobanner|taoanh)\s*:?[^\n]+)/i);
          if (cmdMatch) {
            suggestedTaoAnhPrompt = cmdMatch[1].trim();
            replyText = rawAiText.replace(cmdMatch[0], '').trim() || rawAiText;
          } else {
            suggestedTaoAnhPrompt = undefined;
            replyText = rawAiText;
          }
          consultModelUsed = usedModelName;
          liveChatSucceeded = true;
        }
      } catch {
        // Fallback to natural conversational reply if network fails
      }
    }

    if (!liveChatSucceeded && liveGrounding?.contextText) {
      suggestedTaoAnhPrompt = undefined;
      replyText = [
        `Dữ liệu thời gian thực vừa tra cứu từ Internet (${liveGrounding.sources.join(', ')}):`,
        '',
        liveGrounding.contextText,
      ].join('\n');
      consultModelUsed = `Live Web Search (${liveGrounding.sources.join(', ')})`;
    }

    const existingChat = currentMeta.chatMessages || [];
    const updatedChat: DesignChatMessageDto[] = [
      ...existingChat,
      {
        id: `msg-user-${Date.now()}`,
        role: 'user',
        text: input.prompt,
        timestamp: new Date().toISOString(),
        chatMode: 'consultant_free',
        attachedProductPhotos:
          attachedProductPhotosMeta.length > 0 ? attachedProductPhotosMeta : undefined,
      },
      {
        id: `msg-ai-consult-${Date.now() + 1}`,
        role: 'assistant',
        text: replyText,
        timestamp: new Date().toISOString(),
        chatMode: 'consultant_free',
        suggestedTaoAnhPrompt,
        modelUsed: consultModelUsed,
        durationSec: 0.3,
        cost: '$0.00',
        status: 'success',
      },
    ];

    const updatedMetadata: StoredMetadata = {
      ...currentMeta,
      placementQuad: input.placementQuad || currentMeta.placementQuad,
      chatMessages: updatedChat,
      designContext,
    };

    const nextScreenDims =
      existing.requestType === 'banner'
        ? `${effectiveBannerW}x${effectiveBannerH}px`
        : `${effectiveWidthM.toFixed(2).replace('.', ',')} x ${effectiveHeightM.toFixed(2).replace('.', ',')} m`;

    await prisma.designRequest.update({
      where: { id: requestId },
      data: {
        screenDimensions: nextScreenDims,
        installPositionJson: JSON.stringify(updatedMetadata),
        version: { increment: 1 },
      },
    });

    bumpDomainRevisions(['design'], 'design_chat_consultant_reply');

    return {
      requestId,
      mode: 'consultant_free' as const,
      commandAction: 'CHAT' as const,
      versionNumber: existing.assetVersions[0]?.versionNumber ?? 1,
      versionId: existing.assetVersions[0]?.id,
      suggestedTaoAnhPrompt,
      chatMessages: updatedChat,
      designContext,
    };
  }

  // 4. Validate Readiness before calling Image API:
  // If user is generating an image freely from the UI (input.chatMode === 'image_generator') without a site survey photo,
  // automatically switch to free-form image generation (GENERATE_BANNER) instead of blocking them for missing site photo or LED specs!
  const hasSurveyPhoto = Boolean(
    photosList.length > 0 ||
      existing.sitePhotoUrl ||
      input.selectedPhotoUrl ||
      sourceVersionObj
  );
  const effectiveQuad =
    input.placementQuad ||
    currentMeta.placementQuad ||
    designContext.fields.placementQuad ||
    DEFAULT_PLACEMENT_QUAD;
  const hasPlacementQuad = Boolean(effectiveQuad?.topLeft && effectiveQuad?.bottomRight);

  if (routeDecision.action === 'GENERATE_SCENE' && !hasSurveyPhoto && input.chatMode === 'image_generator') {
    routeDecision.action = 'GENERATE_BANNER';
    routeDecision.commandToken = '@taobanner';
  }
  const effectiveDbType: 'banner' | '3d_perspective' =
    routeDecision.action === 'GENERATE_BANNER' ? 'banner' : dbType;

  const readiness = validateCommandReadiness({
    routed: routeDecision,
    hasSurveyPhoto,
    hasPlacementQuad,
    placementQuad: effectiveQuad,
    widthMm: Math.round(effectiveWidthM * 1000),
    heightMm: Math.round(effectiveHeightM * 1000),
    pixelPitch: effectivePitch,
    bannerWidthPx: effectiveBannerW,
    bannerHeightPx: effectiveBannerH,
    bannerBriefFromContext: designContext.fields.bannerContent || input.prompt,
  });

  if (!readiness.canExecuteImmediately && readiness.clarificationReply) {
    const existingChat = currentMeta.chatMessages || [];
    const updatedChat: DesignChatMessageDto[] = [
      ...existingChat,
      {
        id: `msg-user-${Date.now()}`,
        role: 'user',
        text: input.prompt,
        timestamp: new Date().toISOString(),
        chatMode: 'consultant_free',
        attachedProductPhotos:
          attachedProductPhotosMeta.length > 0 ? attachedProductPhotosMeta : undefined,
      },
      {
        id: `msg-ai-missing-${Date.now() + 1}`,
        role: 'assistant',
        text: readiness.clarificationReply,
        timestamp: new Date().toISOString(),
        chatMode: 'consultant_free',
        modelUsed: 'Command Router Validator',
        durationSec: 0.05,
        cost: '$0.00',
        status: 'success',
      },
    ];

    const updatedMetadata: StoredMetadata = {
      ...currentMeta,
      chatMessages: updatedChat,
      designContext,
    };

    await prisma.designRequest.update({
      where: { id: requestId },
      data: {
        installPositionJson: JSON.stringify(updatedMetadata),
        version: { increment: 1 },
      },
    });

    bumpDomainRevisions(['design'], 'design_chat_clarification');

    return {
      requestId,
      mode: 'consultant_free' as const,
      commandAction: routeDecision.action,
      missingFields: readiness.missingFields,
      versionNumber: existing.assetVersions[0]?.versionNumber ?? 1,
      versionId: existing.assetVersions[0]?.id,
      chatMessages: updatedChat,
      designContext,
    };
  }

  // 5. Resolve Image-Capable Model:
  // If user is in interactive UI chat (input.chatMode === 'image_generator') and currently has a Chat Model selected,
  // auto-resolve the best Image Model for their active provider instead of throwing an error!
  let effectiveImageModelId = input.modelId;
  if (effectiveImageModelId && AiDesignProviderFactory.isChatOnlyModel(effectiveImageModelId)) {
    if (input.chatMode === 'image_generator') {
      const { config: imgCfg } = AiDesignProviderFactory.getCatalog();
      const targetPid = (input.providerId || imgCfg.defaultProviderId || 'google_imagen') as AiProviderId;
      const imgModels = (imgCfg.providers[targetPid]?.discoveredModels || [])
        .map((m) => m.id)
        .filter((id) => id && !AiDesignProviderFactory.isChatOnlyModel(id));
      const rankImageModel = (id: string): number => {
        const l = id.toLowerCase();
        if (l.includes('gpt-image-2.5')) return 0;
        if (l.includes('gpt-image-2')) return 1;
        if (l.includes('gpt-image-1')) return 2;
        if (l.includes('gemini-2.5-flash-image') || l.includes('imagen')) return 3;
        return 4;
      };
      const bestDiscoveredImg = [...imgModels].sort((a, b) => rankImageModel(a) - rankImageModel(b))[0];
      effectiveImageModelId =
        bestDiscoveredImg ||
        (targetPid === 'google_imagen'
          ? 'gemini-2.5-flash-image'
          : targetPid === 'openai_dalle'
            ? 'gpt-image-1'
            : targetPid === 'custom_endpoint'
              ? 'gpt-image-2.5'
              : 'toantrung-studio-v3');
    } else {
      throw new Error(
        `MODEL_NOT_IMAGE_CAPABLE: Model "${effectiveImageModelId}" chỉ hỗ trợ Chat/Phân tích brief & ảnh, không hỗ trợ xuất file ảnh. Vui lòng chọn IMAGE MODEL phù hợp.`
      );
    }
  }

  const effectiveTaskCode: DesignTaskCode =
    input.taskCode === 'design_edit'
      ? 'design_edit'
      : effectiveDbType === 'banner'
        ? 'banner_generate'
        : input.taskCode || 'perspective_compose';

  if (
    input.bannerMode === 'with_product' &&
    effectiveTaskCode === 'banner_generate' &&
    productReferenceBuffers.length === 0
  ) {
    throw new Error(
      'MISSING_PRODUCT_REFERENCE_IMAGE: Luồng "Tạo Banner ghép SP" yêu cầu chọn ít nhất 1 ảnh sản phẩm từ Kho SP Cty. Nếu muốn tạo banner thuần chữ không dùng ảnh SP, hãy chuyển sang luồng "Banner thuần Prompt".'
    );
  }

  if (
    effectiveTaskCode === 'design_edit' &&
    (!activePhotoFileData || activePhotoFileData.buffer.length === 0) &&
    productReferenceBuffers.length === 0
  ) {
    throw new Error(
      'MISSING_REFERENCE_IMAGE_BUFFER: Tác vụ Chỉnh sửa thiết kế đang có yêu cầu chọn 1 phiên bản ảnh cũ hoặc đính kèm ảnh tham chiếu gốc để gửi vào /images/edits.'
    );
  }

  // MODE 2: IMAGE GENERATION (@taoanh -> GENERATE_SCENE | @taobanner -> GENERATE_BANNER)
  const existingLock = activeDesignJobLocks.get(requestId);
  if (existingLock) {
    throw new Error(
      `Dự án #${requestId} đang có tiến trình sinh ảnh AI chạy nền (${existingLock.jobId}). Vui lòng chờ hoàn tất trước khi gửi yêu cầu tiếp.`
    );
  }

  const durableLease = await acquireDurableJobLease({
    jobKey: `m05_design_${requestId}`,
    leaseTtlMs: 90_000,
    checkpointNote: input.idempotencyKey || 'image_gen',
  });
  if (!durableLease.acquired) {
    throw new Error(
      `Dự án #${requestId} đang có tiến trình sinh ảnh AI chạy trên worker khác (${durableLease.existingLease?.ownerId || 'worker'}). Vui lòng chờ hoàn tất.`
    );
  }

  const cleanImagePrompt =
    routeDecision.cleanInstruction ||
    input.prompt.replace(DAO_TAO_ANH_REGEX, '').trim() ||
    designContext.fields.bannerContent ||
    input.prompt;

  const normalizedProviderId = (
    input.providerId === 'flux_pro'
      ? 'flux_bfl'
      : input.providerId === 'custom_http'
        ? 'custom_endpoint'
        : input.providerId
  ) as
    | 'google_imagen'
    | 'openai_dalle'
    | 'flux_bfl'
    | 'stability_ai'
    | 'custom_endpoint'
    | 'local_sandbox'
    | undefined;

  const effectiveCompositingMode: CompositingProtectionMode =
    input.compositingMode ||
    designContext.fields.compositingMode ||
    currentMeta.compositingMode ||
    'STRICT';

  const runningJob: DesignActiveJobDto = {
    jobId: `job-${requestId}-v${nextVersionNumber}-${Date.now()}`,
    status: 'running',
    action: effectiveDbType === 'banner' ? 'GENERATE_BANNER' : 'GENERATE_SCENE',
    providerId: normalizedProviderId || 'google_imagen',
    modelId: effectiveImageModelId || 'auto',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    resultVersionNo: null,
    fallbackUsed: false,
    idempotencyKey: input.idempotencyKey ?? null,
    message: 'Đang chuẩn bị dữ liệu và gửi yêu cầu tới AI...',
  };

  activeDesignJobLocks.set(requestId, { jobId: runningJob.jobId, startedAt: Date.now() });

  await prisma.designRequest.update({
    where: { id: requestId },
    data: {
      designStatus: 'ai_drafting',
      installPositionJson: JSON.stringify({
        ...currentMeta,
        placementQuad: effectiveQuad,
        designContext,
        activeJob: runningJob,
      }),
    },
  });
  bumpDomainRevisions(['design'], 'design_job_started');

  const updateRunningJobStage = async (stageMessage: string) => {
    try {
      const latestRow = await prisma.designRequest.findUnique({
        where: { id: requestId },
        select: { installPositionJson: true },
      });
      const latestMeta = parseProjectMetadata(latestRow?.installPositionJson ?? null);
      if (latestMeta.activeJob?.jobId !== runningJob.jobId) return;
      latestMeta.activeJob = {
        ...latestMeta.activeJob,
        message: stageMessage,
      };
      await prisma.designRequest.update({
        where: { id: requestId },
        data: { installPositionJson: JSON.stringify(latestMeta) },
      });
    } catch {
      // non-fatal stage progress update
    }
  };

  const markActiveJobFailed = async (errMessage: string, fallbackUsed = false) => {
    const failedJob: DesignActiveJobDto = {
      ...runningJob,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      fallbackUsed,
      message: errMessage,
    };
    const latestRow = await prisma.designRequest.findUnique({
      where: { id: requestId },
      include: { assetVersions: { take: 1, select: { id: true } } },
    });
    const latestMeta = parseProjectMetadata(latestRow?.installPositionJson ?? null);
    await prisma.designRequest
      .update({
        where: { id: requestId },
        data: {
          designStatus: latestRow?.assetVersions?.length ? 'ai_drafted' : latestRow?.designStatus || 'pending',
          installPositionJson: JSON.stringify({
            ...latestMeta,
            activeJob: failedJob,
          }),
        },
      })
      .catch(() => null);
    await upsertActionableNotification({
      userId: actor.id,
      title: `Sinh ảnh thiết kế #${requestId} chưa thành công`,
      summary: errMessage,
      category: 'Thiết kế AI',
      actionLabel: 'Kiểm tra dự án',
      actionUrl: `/design?projectId=${requestId}`,
      requiredPermission: 'AI_DESIGN',
    }).catch(() => null);
    bumpDomainRevisions(['design', 'notifications'], 'design_job_failed');
  };

  const executeImageGenerationCore = async () => {
    await updateRunningJobStage(`Đang gọi nhà cung cấp AI (${runningJob.modelId})...`);

    let providerResult: Awaited<ReturnType<typeof AiDesignProviderFactory.executePerspectiveWithFallback>>;
    try {
      providerResult =
        effectiveDbType === '3d_perspective'
          ? await AiDesignProviderFactory.executePerspectiveWithFallback(
              {
                workflow: 'perspective_3d',
                prompt: cleanImagePrompt,
                referenceImageUrl:
                  input.selectedPhotoUrl ||
                  activePhotoObj?.url ||
                  existing.sitePhotoUrl ||
                  DEFAULT_SHOWROOM_PHOTO,
                referenceImageBuffer: activePhotoFileData?.buffer,
                referenceImageMimeType: activePhotoFileData?.mimeType,
                productReferenceBuffers:
                  productReferenceBuffers.length > 0 ? productReferenceBuffers : undefined,
                placementQuad: effectiveQuad,
                compositingMode: effectiveCompositingMode,
                productSpec: {
                  productCode: currentMeta.productSpec?.productCode || 'LED_INDOOR',
                  productName:
                    input.referenceProductName ||
                    productReferencePhotoObjs[0]?.name ||
                    existing.ledCategory ||
                    'Màn hình LED Indoor',
                  pitch: effectivePitch,
                  screenStyle: effectiveStyle,
                },
                dimensions: {
                  widthM: effectiveWidthM,
                  heightM: effectiveHeightM,
                  aspectRatio: input.aspectRatio || existing.aspectRatio || '16:9',
                },
                quality: input.quality || 'draft',
                modelId: effectiveImageModelId,
                idempotencyKey:
                  input.idempotencyKey ||
                  `chat-design-${requestId}-v${nextVersionNumber}-${Date.now()}`,
                simulateTimeout: input.simulateAiTimeout,
                disableLocalFallback:
                  input.disableLocalFallback || effectiveTaskCode === 'design_edit',
                requireReferenceEdit: effectiveTaskCode === 'design_edit',
              },
              normalizedProviderId
            )
          : await AiDesignProviderFactory.executeBannerWithFallback(
              {
                workflow: 'banner',
                prompt: cleanImagePrompt,
                referenceImageBuffer:
                  effectiveTaskCode === 'design_edit' ? activePhotoFileData?.buffer : undefined,
                referenceImageMimeType:
                  effectiveTaskCode === 'design_edit' ? activePhotoFileData?.mimeType : undefined,
                productReferenceBuffers:
                  productReferenceBuffers.length > 0 ? productReferenceBuffers : undefined,
                sourceVersionId: requestedParentVerId,
                dimensions: {
                  widthPx: effectiveBannerW,
                  heightPx: effectiveBannerH,
                  aspectRatio: input.aspectRatio || existing.aspectRatio || '16:9',
                },
                quality: input.quality || 'draft',
                modelId: effectiveImageModelId,
                idempotencyKey:
                  input.idempotencyKey ||
                  `chat-banner-${requestId}-v${nextVersionNumber}-${Date.now()}`,
                simulateTimeout: input.simulateAiTimeout,
                disableLocalFallback:
                  input.disableLocalFallback || effectiveTaskCode === 'design_edit',
                requireReferenceEdit: effectiveTaskCode === 'design_edit',
              },
              normalizedProviderId
            );
    } catch (execErr) {
      const msg = execErr instanceof Error ? execErr.message : 'Lỗi kết xuất hình ảnh AI.';
      await markActiveJobFailed(msg);
      throw execErr;
    }

    if (Array.isArray(providerResult.failedCloudAttempts)) {
      for (let idx = 0; idx < providerResult.failedCloudAttempts.length; idx++) {
        const attempt = providerResult.failedCloudAttempts[idx];
        await recordAiUsageAttempt(prisma, {
          idempotencyKey: `${runningJob.jobId}-cloud-fail-${idx}-${attempt.provider}`,
          attemptNumber: idx + 1,
          providerRequestId: `${attempt.provider}-${requestId}-v${nextVersionNumber}-fail`,
          moduleCode: '05-ai-design',
          taskType: dbType,
          userId: actor.id,
          designRequestId: requestId,
          modelName: attempt.modelUsed,
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
          costMicros: null,
          durationMs: attempt.durationMs ?? null,
          status: 'failed',
          errorMessage: attempt.errorMessage || attempt.errorCode || 'Cloud AI image generation failed',
        }).catch(() => null);
      }
    }

    if (providerResult.status === 'timeout' || input.simulateAiTimeout) {
      await recordAiUsageAttempt(prisma, {
        idempotencyKey: `chat-design-timeout-${requestId}-v${nextVersionNumber}-${Date.now()}`,
        attemptNumber: nextVersionNumber,
        moduleCode: '05-ai-design',
        taskType: dbType,
        userId: actor.id,
        designRequestId: requestId,
        modelName: providerResult.modelUsed || 'imagen-3.0-generate-002',
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        costMicros: null,
        durationMs: providerResult.durationMs,
        status: 'timeout',
        errorMessage: 'Hệ thống AI dựng ảnh quá thời gian phản hồi (UC06 E1).',
      });
      await markActiveJobFailed('Kết nối AI quá thời gian phản hồi (UC06 E1).');
      throw new Error(
        'Kết nối hệ thống AI quá thời gian phản hồi (UC06 E1). Phiên bản hiện tại vẫn được bảo toàn an toàn.'
      );
    }

    // Validate binary output strictly: NEVER mark success if provider returned text-only, empty buffer, or invalid image bytes!
    let imageValidation = validateGeneratedImageBuffer(providerResult.imageBuffer);

    // If the browser passed a high-res clientRenderedBase64 composite (e.g. from AiDesignWorkspace)
    // and the selected provider/model is a chat/free-tier model or failed to return an image buffer,
    // use the verified clientRenderedBase64 composite so the Studio workflow saves the version smoothly.
    if (
      (providerResult.status === 'failed' || !imageValidation.isValid) &&
      input.clientRenderedBase64
    ) {
      try {
        const clientBuf = Buffer.from(input.clientRenderedBase64, 'base64');
        const clientCheck = validateGeneratedImageBuffer(clientBuf);
        if (clientCheck.isValid) {
          providerResult.imageBuffer = clientBuf;
          providerResult.mimeType = clientCheck.detectedMimeType || 'image/jpeg';
          providerResult.status = 'success';
          providerResult.fallbackNotice =
            providerResult.fallbackNotice ||
            'Đã kết xuất qua Studio Engine với bố cục & ảnh tham chiếu chất lượng cao.';
          imageValidation = clientCheck;
        }
      } catch {
        // keep original validation state
      }
    }

    if (providerResult.status === 'failed' || !imageValidation.isValid) {
      const latestRow = await prisma.designRequest.findUnique({
        where: { id: requestId },
        include: { assetVersions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
      });
      const latestMeta = parseProjectMetadata(latestRow?.installPositionJson ?? null);
      const existingChat = latestMeta.chatMessages || currentMeta.chatMessages || [];
      const explainText = providerResult.errorMessage?.startsWith('FREE_TIER_IMAGE_LIMIT_0')
        ? [
            `⚠️ **Giữ nguyên ảnh gốc của bạn (Không tự ý nhảy sang ảnh giả lập):**`,
            `• Mã **API Key Gmail Miễn phí ($0)** của Google AI Studio hiện được Google mở miễn phí cho **Chat & Nhìn ảnh (Vision)**, nhưng khóa hạn mức **\`limit: 0\`** đối với tính năng **Tạo/Sửa xuất ra file ảnh mới** (\`gemini-3.1-flash-image\` / \`imagen-3\`).`,
            `• Để AI tự động vẽ/chỉnh sửa trực tiếp ra file ảnh mới (thêm/bớt vật thể trong ảnh), bạn cần bật **Billing Tier 1** trên Google AI Studio hoặc gắn Key **OpenAI (\`gpt-image-1\`) / FLUX.1 Pro** trong mục **Setting**.`,
            `• Nếu bạn chỉ muốn **ghép khung màn hình LED 3D Toàn Trung** vào điểm chạm trên bức ảnh này, hãy gõ: \`@TaoAnh: Ghép màn hình LED vào điểm chạm\`.`,
          ].join('\n')
        : `Không thể xuất ảnh mới từ AI (${providerResult.errorMessage || imageValidation.errorMessage || 'AI chỉ trả về văn bản hoặc thiếu dữ liệu ảnh hợp lệ'}). Hệ thống không tạo phiên bản lỗi và giữ nguyên bức ảnh hiện tại của bạn trên màn hình.`;

      const updatedChat: DesignChatMessageDto[] = [
        ...existingChat,
        {
          id: `msg-user-${Date.now()}`,
          role: 'user',
          text: input.prompt,
          timestamp: new Date().toISOString(),
          chatMode: 'consultant_free',
          attachedProductPhotos:
            attachedProductPhotosMeta.length > 0 ? attachedProductPhotosMeta : undefined,
        },
        {
          id: `msg-ai-limit-${Date.now() + 1}`,
          role: 'assistant',
          text: explainText,
          timestamp: new Date().toISOString(),
          chatMode: 'consultant_free',
          modelUsed: providerResult.modelUsed || 'Google Gemini API',
          durationSec: Number((providerResult.durationMs / 1000).toFixed(2)),
          cost: '$0.00',
          status: 'failed',
        },
      ];

      const errSummary =
        providerResult.errorMessage ||
        imageValidation.errorMessage ||
        'Không sinh được ảnh từ Cloud AI.';

      const updatedMetadata: StoredMetadata = {
        ...latestMeta,
        placementQuad: effectiveQuad,
        chatMessages: updatedChat,
        designContext,
        activeJob: {
          ...runningJob,
          status: 'failed',
          finishedAt: new Date().toISOString(),
          message: errSummary,
        },
      };

      await prisma.designRequest.update({
        where: { id: requestId },
        data: {
          designStatus: latestRow?.assetVersions?.length ? 'ai_drafted' : latestRow?.designStatus || 'pending',
          installPositionJson: JSON.stringify(updatedMetadata),
          version: { increment: 1 },
        },
      });
      await upsertActionableNotification({
        userId: actor.id,
        title: `Sinh ảnh thiết kế #${requestId} chưa thành công`,
        summary: errSummary,
        category: 'Thiết kế AI',
        actionLabel: 'Kiểm tra dự án',
        actionUrl: `/design?projectId=${requestId}`,
        requiredPermission: 'AI_DESIGN',
      }).catch(() => null);
      bumpDomainRevisions(['design', 'notifications'], 'design_job_failed_validation');

      return {
        requestId,
        mode: 'consultant_free' as const,
        freeTierImageBlocked: true,
        errorReason: providerResult.errorMessage || imageValidation.errorMessage,
        versionNumber: existing.assetVersions[0]?.versionNumber ?? 1,
        versionId: existing.assetVersions[0]?.id,
        chatMessages: updatedChat,
        designContext,
      };
    }

    await updateRunningJobStage('Đang kiểm định chất lượng ảnh & lưu phiên bản...');

    // Post-process banner resolution & typography warning when action is GENERATE_BANNER
    let finalBufferToSave = providerResult.imageBuffer;
    let finalMimeToSave = providerResult.mimeType || 'image/png';

    if (
      input.clientRenderedBase64 &&
      (normalizedProviderId === 'local_sandbox' || Boolean(providerResult.fallbackNotice))
    ) {
      try {
        const clientBuf = Buffer.from(input.clientRenderedBase64, 'base64');
        const clientCheck = validateGeneratedImageBuffer(clientBuf);
        if (clientCheck.isValid) {
          finalBufferToSave = clientBuf;
          finalMimeToSave = clientCheck.detectedMimeType || 'image/jpeg';
        }
      } catch {
        // keep providerResult.imageBuffer
      }
    }

    let bannerTypographyWarning: string | null = null;
    let bannerResizeExplanation: string | null = null;
    let curvedDistortionWarning: string | null = null;

    let layoutOverlayApplied = false;
    let layoutOverlayNote: string | null = null;
    if (effectiveDbType === 'banner') {
      if (providerResult.provider !== 'local_sandbox' && !input.applyLayoutOverlay) {
        // Keep the full native Cloud AI high-resolution image without nearest/raster cropping
        bannerTypographyWarning =
          '⚠️ Lưu ý kiểm tra nội dung chữ trên Banner: Vui lòng kiểm tra kỹ chính tả tiếng Việt, font chữ và thông điệp trước khi bấm Phê duyệt.';
        bannerResizeExplanation = `Giữ nguyên ảnh độ phân giải gốc từ Cloud AI (${providerResult.modelUsed || 'Cloud AI'}) cho tỷ lệ ${input.aspectRatio || existing.aspectRatio || '16:9'}.`;
      } else {
        const bannerProcessed = processBannerToTargetResolution({
          sourceBuffer: finalBufferToSave,
          sourceMimeType: finalMimeToSave,
          targetWidthPx: effectiveBannerW,
          targetHeightPx: effectiveBannerH,
          prompt: cleanImagePrompt,
        });
        finalBufferToSave = bannerProcessed.imageBuffer;
        bannerTypographyWarning = bannerProcessed.typographyWarning;
        bannerResizeExplanation = bannerProcessed.resizeExplanation;
        if (input.applyLayoutOverlay) {
          const overlaid = renderBrandLayoutOverlayOnImage({
            sourceBuffer: finalBufferToSave,
            brandPrimaryColor: currentMeta.designBrief?.brandPrimaryColor || input.designBrief?.brandPrimaryColor,
            headlineText: currentMeta.designBrief?.headlineText || input.designBrief?.headlineText,
            ctaText: currentMeta.designBrief?.ctaText || input.designBrief?.ctaText,
            websiteDomain: currentMeta.websiteDomain || input.designBrief?.websiteDomain,
          });
          finalBufferToSave = overlaid.imageBuffer;
          layoutOverlayApplied = overlaid.applied;
          layoutOverlayNote = overlaid.overlayNote;
        }
      }
    } else if (effectiveStyle === 'curved') {
      curvedDistortionWarning =
        'Cấu hình màn hình LED cong (Curved): Phép biến đổi mặt phẳng 4 góc chỉ là xấp xỉ; cần kiểm tra biến dạng phi phẳng theo bán kính cong thực tế.';
    }

    const savedFile = savePrivateBusinessFile({
      bucket: 'design',
      prefix: `ai-draft-req-${requestId}-v${nextVersionNumber}`,
      fileBuffer: finalBufferToSave,
      declaredMimeType: finalMimeToSave,
    });

    const hasActualTokens = providerResult.tokensActual !== false && providerResult.totalTokens > 0;
    const aiLog = await recordAiUsageAttempt(prisma, {
      idempotencyKey:
        input.idempotencyKey || `chat-design-run-${requestId}-v${nextVersionNumber}-${Date.now()}`,
      attemptNumber: nextVersionNumber,
      providerRequestId: `${providerResult.provider}-${requestId}-v${nextVersionNumber}`,
      moduleCode: '05-ai-design',
      taskType: dbType,
      userId: actor.id,
      designRequestId: requestId,
      modelName: providerResult.modelUsed,
      promptTokens: hasActualTokens ? providerResult.promptTokens : null,
      completionTokens: hasActualTokens ? providerResult.completionTokens : null,
      totalTokens: hasActualTokens ? providerResult.totalTokens : null,
      costMicros: providerResult.costMicros > 0n ? providerResult.costMicros : null,
      costCurrency: providerResult.costCurrency,
      durationMs: providerResult.durationMs,
      status: 'success',
    });

    const savedFileMeta = validateGeneratedImageBuffer(finalBufferToSave);

    const isLocalStudioOutput =
      Boolean(providerResult.isLocalFallback) || providerResult.provider === 'local_sandbox';
    const generationOrigin: 'CLOUD_AI' | 'AI_PLUS_LAYOUT' | 'LOCAL_COMPOSITE_FALLBACK' =
      isLocalStudioOutput
        ? 'LOCAL_COMPOSITE_FALLBACK'
        : layoutOverlayApplied
          ? 'AI_PLUS_LAYOUT'
          : 'CLOUD_AI';

    const createdVersion = await createDesignAssetVersionSafe(requestId, (versionNumber) => ({
      designRequestId: requestId,
      versionNumber,
      versionType: 'ai_draft',
      storageObjectKey: savedFile.storageObjectKey,
      mimeType: savedFile.mimeType,
      fileSizeBytes: savedFile.fileSizeBytes,
      promptUsed: input.prompt,
      parametersJson: JSON.stringify({
        regeneratedFromVersion: existing.version,
        sourceOrigin: sourceImageOrigin,
        generationOrigin,
        taskCode: effectiveTaskCode,
        taskId: runningJob.jobId,
        inputAssetIds: resolvedInputAssetIds,
        parentVersionId: requestedParentVerId,
        requestedModel: providerResult.requestedModel || input.modelId || providerResult.modelUsed,
        reportedModel: providerResult.reportedModel ?? null,
        reportedModelNote: providerResult.reportedModelNote ?? null,
        costState: providerResult.costState || 'unknown',
        tokensActual: Boolean(providerResult.tokensActual),
        isLocalFallback: Boolean(providerResult.isLocalFallback),
        sourcePhotoId: activePhotoObj?.id ?? null,
        referenceSitePhotoId: activePhotoObj?.id ?? null,
        referenceProductPhotoIds: productReferencePhotoObjs.map((p) => p.id),
        sourceVersionId: sourceVersionObj?.id ?? null,
        effectivePrompt: cleanImagePrompt,
        actualWidthPx: savedFileMeta.widthPx,
        actualHeightPx: savedFileMeta.heightPx,
        sha256: savedFile.sha256,
        compositingMode: effectiveCompositingMode,
        placementQuad: effectiveQuad,
        screenDimensionsMm:
          currentMeta.screenWidthM || dbType === '3d_perspective'
            ? {
                widthMm: Math.round(effectiveWidthM * 1000),
                heightMm: Math.round(effectiveHeightM * 1000),
              }
            : undefined,
        bannerResolutionPx:
          dbType === 'banner'
            ? { widthPx: effectiveBannerW, heightPx: effectiveBannerH }
            : undefined,
        curvedDistortionWarning,
        bannerResizeExplanation,
        bannerTypographyWarning,
        layoutOverlayNote,
        quality: input.quality,
        providerId: providerResult.provider,
        modelUsed: providerResult.modelUsed,
      }),
      aiUsageLogId: aiLog.log.id,
      uploadedByUserId: actor.id,
      isApprovedFinal: false,
    }));

    designContext.fields.activeVersionId = createdVersion.id;

    const extraNotices: string[] = [];
    if (providerResult.fallbackNotice) {
      extraNotices.push(`• ⚠️ ${providerResult.fallbackNotice}`);
    }
    if (dbType === 'banner') {
      if (bannerResizeExplanation) extraNotices.push(`• 📐 ${bannerResizeExplanation}`);
      if (bannerTypographyWarning) extraNotices.push(`• ${bannerTypographyWarning}`);
    } else {
      extraNotices.push(
        `• 🛡️ Chế độ bảo vệ nền: **${effectiveCompositingMode}** (giữ nguyên toạ độ 4 góc & kích thước ${Math.round(effectiveWidthM * 1000)}×${Math.round(effectiveHeightM * 1000)}mm).`
      );
      if (curvedDistortionWarning) extraNotices.push(`• ⚠️ ${curvedDistortionWarning}`);
    }

    const latestRowAfter = await prisma.designRequest.findUnique({ where: { id: requestId } });
    const latestMetaAfter = parseProjectMetadata(latestRowAfter?.installPositionJson ?? null);
    const existingChat = latestMetaAfter.chatMessages || currentMeta.chatMessages || [];
    const updatedChat: DesignChatMessageDto[] = [
      ...existingChat,
      {
        id: `msg-user-${Date.now()}`,
        role: 'user',
        text: input.prompt,
        timestamp: new Date().toISOString(),
        chatMode: 'image_generator',
        attachedProductPhotos:
          attachedProductPhotosMeta.length > 0 ? attachedProductPhotosMeta : undefined,
      },
      {
        id: `msg-ai-${Date.now() + 1}`,
        role: 'assistant',
        text: [
          isLocalStudioOutput
            ? `Đã dựng bản phối cảnh kỹ thuật nội bộ (v${createdVersion.versionNumber} · Studio Engine ${providerResult.modelUsed}) và cập nhật lên màn hình chính.`
            : `Đã kết xuất phiên bản thiết kế Cloud AI (v${createdVersion.versionNumber} · ${providerResult.modelUsed}) và cập nhật lên màn hình chính.`,
          ...extraNotices,
        ].join('\n'),
        timestamp: new Date().toISOString(),
        chatMode: 'image_generator',
        versionNumber: createdVersion.versionNumber,
        versionId: createdVersion.id,
        providerId: providerResult.provider,
        modelUsed: providerResult.modelUsed,
        durationSec: Number((providerResult.durationMs / 1000).toFixed(2)),
        tokenUsed: providerResult.totalTokens,
        cost: `$${(Number(providerResult.costMicros) / 1_000_000).toFixed(3)}`,
        status: 'success',
      },
    ];

    const processedKeys = { ...(latestMetaAfter.processedIdempotencyKeys || currentMeta.processedIdempotencyKeys || {}) };
    if (input.idempotencyKey) {
      processedKeys[input.idempotencyKey] = {
        versionId: createdVersion.id,
        versionNumber: createdVersion.versionNumber,
        timestamp: new Date().toISOString(),
      };
    }

    const completedJob: DesignActiveJobDto = {
      ...runningJob,
      status: 'succeeded',
      providerId: providerResult.provider,
      modelId: providerResult.modelUsed,
      finishedAt: new Date().toISOString(),
      resultVersionNo: createdVersion.versionNumber,
      fallbackUsed: Boolean(providerResult.isLocalFallback),
      message: providerResult.fallbackNotice || 'Hoàn tất kết xuất bản thiết kế.',
    };

    const updatedMetadata: StoredMetadata = {
      ...currentMeta,
      ...latestMetaAfter,
      placementQuad: effectiveQuad,
      chatMessages: updatedChat,
      designContext,
      activeJob: completedJob,
      processedIdempotencyKeys: processedKeys,
    };

    const baseRowForTotals = latestRowAfter || existing;
    const newTotalTokens =
      (baseRowForTotals.tokenCost ?? 0) + (hasActualTokens ? providerResult.totalTokens : 0);
    const newTotalCostMicros = (baseRowForTotals.totalCostMicros ?? 0n) + providerResult.costMicros;

    await prisma.designRequest.update({
      where: { id: requestId },
      data: {
        prompt: input.prompt,
        aiDraftImageUrl: savedFile.storageObjectKey,
        installPositionJson: JSON.stringify(updatedMetadata),
        designStatus: 'ai_drafted',
        processingTimeMs: (baseRowForTotals.processingTimeMs ?? 0) + providerResult.durationMs,
        tokenCost: newTotalTokens,
        totalCostMicros: newTotalCostMicros,
        version: { increment: 1 },
      },
    });

    if (input.asyncMode) {
      await upsertActionableNotification({
        userId: actor.id,
        title: `Hoàn tất kết xuất bản thiết kế v${createdVersion.versionNumber} (#${requestId})`,
        summary: `Phiên bản v${createdVersion.versionNumber} (${providerResult.modelUsed}) đã sẵn sàng trong Studio AI.`,
        category: 'Thiết kế AI',
        actionLabel: 'Mở bản vẽ',
        actionUrl: `/design?projectId=${requestId}`,
        requiredPermission: 'AI_DESIGN',
      }).catch(() => null);
    }

    bumpDomainRevisions(['design', 'reports', 'notifications'], 'design_image_generated');

    return {
      requestId,
      commandAction: routeDecision.action,
      taskCode: effectiveTaskCode,
      taskId: runningJob.jobId,
      generationOrigin,
      requestedModel: providerResult.requestedModel || input.modelId || providerResult.modelUsed,
      reportedModel: providerResult.reportedModel ?? null,
      reportedModelNote: providerResult.reportedModelNote ?? null,
      parentVersionId: requestedParentVerId,
      versionNumber: createdVersion.versionNumber,
      versionId: createdVersion.id,
      downloadUrl: `/api/v1/design/asset/${createdVersion.id}`,
      compositingMode: effectiveCompositingMode,
      sourcePhotoId: activePhotoObj?.id ?? null,
      sourceVersionId: sourceVersionObj?.id ?? null,
      typographyWarning: bannerTypographyWarning,
      resizeExplanation: bannerResizeExplanation,
      curvedDistortionWarning,
      layoutOverlayNote,
      chatMessages: updatedChat,
      designContext,
    };
  };

  if (input.asyncMode) {
    void (async () => {
      try {
        await executeImageGenerationCore();
        await releaseDurableJobLease({
          jobKey: `m05_design_${requestId}`,
          ownerId: durableLease.ownerId,
          status: 'completed',
          checkpointNote: runningJob.jobId,
        }).catch(() => undefined);
      } catch {
        await releaseDurableJobLease({
          jobKey: `m05_design_${requestId}`,
          ownerId: durableLease.ownerId,
          status: 'failed',
          checkpointNote: runningJob.jobId,
        }).catch(() => undefined);
      } finally {
        activeDesignJobLocks.delete(requestId);
      }
    })();

    return {
      accepted: true,
      asyncQueued: true,
      requestId,
      jobId: runningJob.jobId,
      activeJob: runningJob,
      status: 'running' as const,
      commandAction: routeDecision.action,
      taskCode: effectiveTaskCode,
    };
  }

  try {
    const out = await executeImageGenerationCore();
    await releaseDurableJobLease({
      jobKey: `m05_design_${requestId}`,
      ownerId: durableLease.ownerId,
      status: 'completed',
      checkpointNote: runningJob.jobId,
    }).catch(() => undefined);
    return out;
  } catch (err) {
    await releaseDurableJobLease({
      jobKey: `m05_design_${requestId}`,
      ownerId: durableLease.ownerId,
      status: 'failed',
      checkpointNote: runningJob.jobId,
    }).catch(() => undefined);
    throw err;
  } finally {
    activeDesignJobLocks.delete(requestId);
  }
}

export async function updateDesignProject(
  actor: SessionUserDto,
  requestId: number,
  input: UpdateDesignProjectDto
) {
  await assertCanAccessDesignProject(actor, requestId);

  const existing = await prisma.designRequest.findUnique({ where: { id: requestId } });
  if (!existing) throw new Error('Không tìm thấy dự án thiết kế.');
  if (input.expectedVersion !== undefined && existing.version !== input.expectedVersion) {
    throw new ConcurrencyConflictError('DesignRequest', requestId, input.expectedVersion);
  }

  const dims = parseDimensions(existing.screenDimensions);
  const meta = parseProjectMetadata(existing.installPositionJson);

  if (input.projectName) meta.projectName = input.projectName;
  if (input.contactName !== undefined) meta.contactName = input.contactName;
  if (input.installationInfo !== undefined) meta.installationInfo = input.installationInfo;
  if (input.productId !== undefined) meta.productId = input.productId;
  if (input.pixelPitch !== undefined && input.pixelPitch !== null) meta.pixelPitch = input.pixelPitch;
  if (input.screenStyle !== undefined) meta.screenStyle = input.screenStyle;
  if (input.screenWidthM !== undefined && input.screenWidthM !== null) meta.screenWidthM = input.screenWidthM;
  if (input.screenHeightM !== undefined && input.screenHeightM !== null) meta.screenHeightM = input.screenHeightM;
  if (input.bannerWidthPx !== undefined && input.bannerWidthPx !== null) meta.bannerWidthPx = input.bannerWidthPx;
  if (input.bannerHeightPx !== undefined && input.bannerHeightPx !== null) meta.bannerHeightPx = input.bannerHeightPx;
  if (input.aspectLocked !== undefined) meta.aspectLocked = input.aspectLocked;
  if (input.isArchived !== undefined) meta.isArchived = input.isArchived;
  if (input.placementQuad) meta.placementQuad = input.placementQuad;
  if (input.taskCode !== undefined) meta.taskCode = input.taskCode;
  if (input.websiteId !== undefined) meta.websiteId = input.websiteId;
  if (input.campaignId !== undefined) meta.campaignId = input.campaignId;
  if (input.contentId !== undefined) meta.contentId = input.contentId;
  if (input.designBrief !== undefined) {
    meta.designBrief = input.designBrief ? { ...(meta.designBrief || {}), ...input.designBrief } : null;
    if (input.designBrief?.websiteDomain !== undefined) {
      meta.websiteDomain = input.designBrief.websiteDomain;
    }
    if (input.designBrief?.campaignName !== undefined) {
      meta.campaignName = input.designBrief.campaignName;
    }
    if (input.designBrief?.outputWidthPx) {
      meta.bannerWidthPx = input.designBrief.outputWidthPx;
    }
    if (input.designBrief?.outputHeightPx) {
      meta.bannerHeightPx = input.designBrief.outputHeightPx;
    }
  }

  // Keep per-project DesignContext synchronized when user manually updates fields
  if (meta.designContext) {
    if (input.screenWidthM != null) {
      meta.designContext.fields.widthMm = Math.round(input.screenWidthM * 1000);
      meta.designContext.provenance.widthMm = 'user_confirmed';
    }
    if (input.screenHeightM != null) {
      meta.designContext.fields.heightMm = Math.round(input.screenHeightM * 1000);
      meta.designContext.provenance.heightMm = 'user_confirmed';
    }
    if (input.pixelPitch) {
      meta.designContext.fields.pixelPitch = input.pixelPitch;
      meta.designContext.provenance.pixelPitch = 'user_confirmed';
    }
    if (input.installationInfo) {
      meta.designContext.fields.installPosition = input.installationInfo;
      meta.designContext.provenance.installPosition = 'user_confirmed';
    }
    if (input.screenStyle) {
      meta.designContext.fields.screenStyle = input.screenStyle;
      meta.designContext.provenance.screenStyle = 'user_confirmed';
    }
    if (input.placementQuad) {
      meta.designContext.fields.placementQuad = input.placementQuad;
      meta.designContext.provenance.placementQuad = 'user_confirmed';
    }
    if (input.selectedPhotoId) {
      meta.designContext.fields.selectedPhotoId = input.selectedPhotoId;
    }
    meta.designContext.updatedAt = new Date().toISOString();
  }

  let nextSitePhotoUrl = existing.sitePhotoUrl;
  const photos = meta.photos && meta.photos.length > 0 ? [...meta.photos] : [];

  if (input.selectedPhotoId && photos.length > 0) {
    for (const p of photos) {
      p.selected = p.id === input.selectedPhotoId;
      if (p.selected) {
        nextSitePhotoUrl = p.storageObjectKey || p.url;
      }
    }
    meta.photos = photos;
  }

  if (input.renamePhotoId && input.renamePhotoName && photos.length > 0) {
    for (const p of photos) {
      if (p.id === input.renamePhotoId) {
        p.name = input.renamePhotoName;
      }
    }
    meta.photos = photos;
  }

  if (input.toggleProductPhotoId && photos.length > 0) {
    for (const p of photos) {
      if (p.id === input.toggleProductPhotoId) {
        p.photoRole =
          input.productPhotoRole ||
          (p.photoRole === 'product_reference' ? 'site_photo' : 'product_reference');
      }
    }
    meta.photos = photos;
  }

  // Import Lead attachments into Ảnh kỹ thuật when requested
  const targetLeadId = input.leadId !== undefined ? input.leadId : existing.leadId;
  if (input.importLeadAttachments && targetLeadId) {
    const linkedLead = await prisma.lead.findUnique({
      where: { id: targetLeadId },
      include: {
        attachments: {
          where: { attachmentType: { not: 'quote_doc' } },
          orderBy: { uploadedAt: 'desc' },
          take: 15,
        },
      },
    });
    if (linkedLead) {
      for (const att of linkedLead.attachments) {
        const alreadyExists = photos.some((p) => p.sourceLeadAttachmentId === att.id || p.id === `lead-att-${att.id}`);
        if (!alreadyExists) {
          photos.push({
            id: `lead-att-${att.id}`,
            name: att.fileName || `Ảnh khảo sát Lead #${att.id}`,
            url: `/api/v1/leads/attachments/${att.id}`,
            storageObjectKey: att.fileUrl,
            selected: photos.length === 0,
            uploadedAt: att.uploadedAt.toISOString(),
            sourceLeadAttachmentId: att.id,
          });
        }
      }
      meta.photos = photos;
    }
  }

  if (input.renameVersionId && input.renameVersionLabel) {
    await prisma.designAssetVersion.updateMany({
      where: { id: input.renameVersionId, designRequestId: requestId },
      data: { promptUsed: input.renameVersionLabel },
    });
  }

  let nextLedCategory = input.ledModuleSpec || existing.ledCategory;
  let productObj: { id: number; productCode: string; productName: string; categoryGroup: string } | null = null;
  if (meta.productId) {
    productObj = await prisma.product.findUnique({ where: { id: meta.productId } });
    if (productObj && !input.ledModuleSpec) {
      const pitchTag = meta.pixelPitch || meta.productSpec?.pixelPitch || 'P2.5';
      nextLedCategory = `${productObj.productName} (${pitchTag})`;
    }
  }

  const nextDesignType = input.designType
    ? input.designType === 'banner'
      ? 'banner'
      : '3d_perspective'
    : existing.requestType;

  const hasMeasuredDims = meta.screenWidthM != null || dims.screenWidthM != null;
  const wM = meta.screenWidthM ?? dims.screenWidthM ?? 4.8;
  const hM = meta.screenHeightM ?? dims.screenHeightM ?? 2.7;
  const bW = meta.bannerWidthPx ?? dims.bannerWidthPx ?? 1536;
  const bH = meta.bannerHeightPx ?? dims.bannerHeightPx ?? 1024;

  if (nextDesignType === 'banner' && !hasMeasuredDims) {
    meta.productSpec = undefined;
  } else {
    meta.productSpec = computeLedProductSpec({
      productCode: productObj?.productCode || meta.productSpec?.productCode,
      productName: productObj?.productName || nextLedCategory || 'Màn hình LED Indoor',
      categoryGroup: productObj?.categoryGroup || meta.productSpec?.categoryGroup,
      widthM: wM,
      heightM: hM,
      pitch: meta.pixelPitch || meta.productSpec?.pixelPitch || 'P2.5',
      screenStyle: meta.screenStyle || meta.productSpec?.screenStyle || 'flat',
      cabinetModelCode: meta.cabinetModelCode,
    });
    if (meta.productId && meta.productSpec) {
      meta.productSpec.productId = meta.productId;
    }
  }

  const nextScreenDimensions =
    nextDesignType === 'banner'
      ? `${bW}x${bH}px`
      : `${wM.toFixed(2).replace('.', ',')} x ${hM.toFixed(2).replace('.', ',')} m`;

  const nextAspectRatio = input.aspectRatio || existing.aspectRatio || '16:9';

  await prisma.designRequest.update({
    where: { id: requestId },
    data: {
      requestType: nextDesignType,
      ledCategory: nextLedCategory,
      screenDimensions: nextScreenDimensions,
      aspectRatio: nextAspectRatio,
      sitePhotoUrl: nextSitePhotoUrl,
      notes: input.notes !== undefined ? input.notes : existing.notes,
      leadId: targetLeadId,
      installPositionJson: JSON.stringify(meta),
      version: { increment: 1 },
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: actor.id,
      action: 'DESIGN_PROJECT_PARAMETERS_UPDATED',
      targetType: 'DesignRequest',
      targetId: String(requestId),
      detailsJson: JSON.stringify({
        projectName: meta.projectName,
        designType: nextDesignType,
        screenDimensions: nextScreenDimensions,
        aspectRatio: nextAspectRatio,
        leadId: targetLeadId,
      }),
    },
  });

  bumpDomainRevisions(['design', 'leads'], 'design_project_updated');

  return { id: requestId, ok: true };
}

export async function addProjectPhoto(
  actor: SessionUserDto,
  requestId: number,
  input: AddProjectPhotoDto
) {
  await assertCanAccessDesignProject(actor, requestId);

  const existing = await prisma.designRequest.findUnique({ where: { id: requestId } });
  if (!existing) throw new Error('Không tìm thấy dự án thiết kế.');

  const buffer = Buffer.from(input.base64Data, 'base64');
  const saved = savePrivateBusinessFile({
    bucket: 'design',
    prefix: `site-photo-req-${requestId}`,
    fileBuffer: buffer,
    declaredMimeType: input.mimeType || 'image/jpeg',
    originalFileName: input.fileName,
  });

  const meta = parseProjectMetadata(existing.installPositionJson);
  const photos = meta.photos || [];

  const isProductRef = input.photoRole === 'product_reference';
  const newPhoto: ProjectPhotoItemDto = {
    id: `photo-${Date.now()}-${photos.length + 1}`,
    name: input.photoName || input.fileName,
    url: `/api/v1/design/asset-file?key=${encodeURIComponent(saved.storageObjectKey)}`,
    storageObjectKey: saved.storageObjectKey,
    selected: !isProductRef || photos.length === 0,
    photoRole: isProductRef ? 'product_reference' : 'site_photo',
    uploadedAt: new Date().toISOString(),
  };

  // If this is a site photo (or first photo), select it and deselect other site photos
  if (!isProductRef || photos.length === 0) {
    photos.forEach((p) => {
      p.selected = false;
    });
  }
  photos.push(newPhoto);
  meta.photos = photos;
  if (meta.designContext && (!isProductRef || photos.length === 1)) {
    meta.designContext.fields.selectedPhotoId = newPhoto.id;
  }

  await prisma.designRequest.update({
    where: { id: requestId },
    data: {
      sitePhotoUrl: !isProductRef || !existing.sitePhotoUrl ? saved.storageObjectKey : existing.sitePhotoUrl,
      installPositionJson: JSON.stringify(meta),
      version: { increment: 1 },
    },
  });

  bumpDomainRevisions(['design'], 'design_photo_added');

  return newPhoto;
}

export async function deleteProjectPhoto(
  actor: SessionUserDto,
  requestId: number,
  photoId: string
) {
  await assertCanAccessDesignProject(actor, requestId);

  const existing = await prisma.designRequest.findUnique({ where: { id: requestId } });
  if (!existing) throw new Error('Không tìm thấy dự án thiết kế.');

  const meta = parseProjectMetadata(existing.installPositionJson);
  const photos = meta.photos || [];

  const target = photos.find((p) => p.id === photoId);

  // Check if this photo's storage key is referenced by an approved final version
  if (target?.storageObjectKey && existing.finalRenderUrl === target.storageObjectKey) {
    throw new Error('Không thể xóa ảnh đang được phiên bản hoàn thiện chính thức tham chiếu.');
  }

  const updatedPhotos = target ? photos.filter((p) => p.id !== photoId) : [...photos];
  if (updatedPhotos.length > 0 && !updatedPhotos.some((p) => p.selected)) {
    updatedPhotos[0].selected = true;
  }
  const activeAfterDelete = updatedPhotos.find((p) => p.selected) || updatedPhotos[0] || null;
  meta.photos = updatedPhotos;

  await prisma.designRequest.update({
    where: { id: requestId },
    data: {
      sitePhotoUrl: activeAfterDelete?.storageObjectKey || activeAfterDelete?.url || null,
      installPositionJson: JSON.stringify(meta),
      version: { increment: 1 },
    },
  });

  bumpDomainRevisions(['design'], 'design_photo_deleted');

  if (target?.storageObjectKey) {
    await cleanupUnusedDesignStorageKeys([target.storageObjectKey]);
  }

  return { ok: true, remainingCount: updatedPhotos.length };
}

export async function deleteDesignAssetVersion(
  actor: SessionUserDto,
  requestId: number,
  versionId: number
) {
  await assertCanAccessDesignProject(actor, requestId);

  const existing = await prisma.designRequest.findUnique({
    where: { id: requestId },
    include: {
      assetVersions: {
        orderBy: { versionNumber: 'asc' },
      },
    },
  });
  if (!existing) throw new Error('Không tìm thấy dự án thiết kế.');

  const targetVer = existing.assetVersions.find((v) => v.id === versionId);
  if (!targetVer) {
    throw new Error('Không tìm thấy phiên bản ảnh AI cần xóa.');
  }

  await prisma.designAssetVersion.delete({
    where: { id: versionId },
  });

  const remaining = existing.assetVersions.filter((v) => v.id !== versionId);
  const latestRemaining = remaining[remaining.length - 1] || null;
  const nextApprovedId =
    existing.approvedVersionId === versionId ? null : existing.approvedVersionId;

  await prisma.designRequest.update({
    where: { id: requestId },
    data: {
      approvedVersionId: nextApprovedId,
      finalRenderUrl: nextApprovedId ? existing.finalRenderUrl : null,
      aiDraftImageUrl: latestRemaining?.storageObjectKey || null,
      designStatus: nextApprovedId
        ? 'completed'
        : latestRemaining
          ? 'ai_drafting'
          : 'pending',
      version: { increment: 1 },
    },
  });

  bumpDomainRevisions(['design', 'reports'], 'design_version_deleted');

  await cleanupUnusedDesignStorageKeys([targetVer.storageObjectKey]);

  return {
    ok: true,
    deletedVersionId: versionId,
    remainingCount: remaining.length,
  };
}

export async function deleteDesignProject(
  actor: SessionUserDto,
  requestId: number,
) {
  await assertCanAccessDesignProject(actor, requestId);

  const existing = await prisma.designRequest.findUnique({
    where: { id: requestId },
    include: { assetVersions: { select: { storageObjectKey: true } } },
  });
  if (!existing) throw new Error('Không tìm thấy dự án thiết kế cần xóa.');

  const meta = parseProjectMetadata(existing.installPositionJson);
  const candidateKeys = [
    existing.sitePhotoUrl,
    existing.aiDraftImageUrl,
    existing.finalRenderUrl,
    ...existing.assetVersions.map((v) => v.storageObjectKey),
    ...(meta.photos || []).map((p) => p.storageObjectKey),
  ];

  await prisma.$transaction([
    prisma.designAssetVersion.deleteMany({ where: { designRequestId: requestId } }),
    prisma.designRequest.delete({ where: { id: requestId } }),
    prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        action: 'DESIGN_PROJECT_DELETED',
        targetType: 'DesignRequest',
        targetId: String(requestId),
        detailsJson: JSON.stringify({ deletedRequestId: requestId }),
      },
    }),
  ]);

  bumpDomainRevisions(['design', 'leads', 'reports', 'notifications'], 'design_project_deleted');

  await cleanupUnusedDesignStorageKeys(candidateKeys);

  return { ok: true, deletedId: requestId };
}


export async function approveDesignAssetVersion(
  actor: SessionUserDto,
  requestId: number,
  input: ApproveDesignVersionDto
) {
  await assertCanAccessDesignProject(actor, requestId);

  const existing = await prisma.designRequest.findUnique({
    where: { id: requestId },
    include: { assetVersions: true },
  });

  if (!existing) throw new Error('Không tìm thấy yêu cầu thiết kế.');
  if (
    typeof input.expectedVersion === 'number' &&
    input.expectedVersion > 0 &&
    existing.version !== input.expectedVersion
  ) {
    throw new ConcurrencyConflictError('DesignRequest', requestId, input.expectedVersion);
  }

  const targetVer = existing.assetVersions.find((v) => v.id === input.versionId);
  if (!targetVer) {
    throw new Error('Phiên bản thiết kế cần phê duyệt không thuộc yêu cầu này.');
  }

  await prisma.$transaction([
    prisma.designAssetVersion.updateMany({
      where: { designRequestId: requestId },
      data: { isApprovedFinal: false },
    }),
    prisma.designAssetVersion.update({
      where: { id: targetVer.id },
      data: { isApprovedFinal: true },
    }),
    prisma.designRequest.update({
      where: { id: requestId },
      data: {
        approvedVersionId: targetVer.id,
        finalRenderUrl: targetVer.storageObjectKey,
        designStatus: 'completed',
        completedAt: new Date(),
        version: { increment: 1 },
      },
    }),
    prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        action: 'DESIGN_VERSION_APPROVED',
        targetType: 'DesignRequest',
        targetId: String(requestId),
        detailsJson: JSON.stringify({
          approvedVersionId: targetVer.id,
          versionNumber: targetVer.versionNumber,
          note: input.note,
        }),
      },
    }),
  ]);

  if (existing.leadId) {
    await notifyLeadSalesOnDesignCompleted({
      leadId: existing.leadId,
      designRequestId: requestId,
      versionNumber: targetVer.versionNumber,
      actor,
      note: input.note || undefined,
      storageObjectKey: targetVer.storageObjectKey,
      fileSizeBytes: targetVer.fileSizeBytes,
    });
  }

  // Record anonymized successful LED pattern when approving an AI quick-install version (Zero PII)
  try {
    if (targetVer.parametersJson) {
      const vp = JSON.parse(targetVer.parametersJson) as {
        ledScreens?: LedScreenInstanceDto[];
        contextHint?: string;
      };
      if (Array.isArray(vp.ledScreens) && vp.ledScreens.length > 0) {
        const s0 = vp.ledScreens[0];
        const projMeta = parseProjectMetadata(existing.installPositionJson);
        recordApprovedLedPattern({
          contextType: vp.contextHint || projMeta.installationInfo || existing.ledCategory || 'led_scene',
          shapeType: s0.shapeType,
          brightnessPct: s0.material?.brightnessPct ?? 102,
          bezelThicknessPx: s0.material?.bezelThicknessPx ?? 6,
          transparencyPct: s0.material?.transparencyPct ?? 0,
          cornerRoundnessPct: s0.cornerRoundnessPct ?? 0,
          savedAt: new Date().toISOString(),
        });
      }
    }
  } catch {
    // Non-fatal pattern learning
  }

  bumpDomainRevisions(['design', 'leads', 'reports', 'notifications'], 'design_version_approved');

  return {
    requestId,
    approvedVersionId: targetVer.id,
    status: 'completed',
  };
}

export async function regenerateDesignDraftByAi(
  actor: SessionUserDto,
  requestId: number,
  input: RegenerateDesignDraftDto
) {
  return processChatDesignRequest(actor, requestId, {
    expectedVersion: input.expectedVersion,
    prompt: input.aiPrompt,
    quality: input.quality || 'draft',
    providerId: input.providerId,
    modelId: input.modelId,
    screenWidthM: input.screenWidthM,
    screenHeightM: input.screenHeightM,
    bannerWidthPx: input.bannerWidthPx,
    bannerHeightPx: input.bannerHeightPx,
    aspectRatio: input.aspectRatio,
    simulateAiTimeout: input.simulateAiTimeout,
    asyncMode: input.asyncMode,
    idempotencyKey: input.idempotencyKey,
  });
}

export async function saveCompositedDraftVersion(
  actor: SessionUserDto,
  requestId: number,
  params: {
    fileName: string;
    mimeType: string;
    buffer: Buffer;
    note?: string;
    placementQuad?: QuadCoordinatesDto;
  }
) {
  await assertCanAccessDesignProject(actor, requestId);

  const existing = await prisma.designRequest.findUnique({
    where: { id: requestId },
    include: {
      assetVersions: {
        orderBy: { versionNumber: 'desc' },
        take: 1,
      },
    },
  });

  if (!existing) {
    throw new Error('Không tìm thấy yêu cầu thiết kế.');
  }

  const savedFile = savePrivateBusinessFile({
    bucket: 'design',
    prefix: `studio-composite-req-${requestId}`,
    fileBuffer: params.buffer,
    declaredMimeType: params.mimeType || 'image/png',
    originalFileName: params.fileName,
  });

  const currentMeta = parseProjectMetadata(existing.installPositionJson);

  const createdVersion = await createDesignAssetVersionSafe(requestId, (versionNumber) => ({
    designRequestId: requestId,
    versionNumber,
    versionType: 'ai_draft',
    storageObjectKey: savedFile.storageObjectKey,
    mimeType: savedFile.mimeType,
    fileSizeBytes: savedFile.fileSizeBytes,
    promptUsed: params.note || `Bản ghép phối cảnh 3D trực tiếp trên ảnh hiện trạng (v${versionNumber})`,
    parametersJson: JSON.stringify({
      studioComposite: true,
      providerId: 'local_sandbox',
      modelUsed: 'Toàn Trung Live 3D Compositor',
      placementQuad: params.placementQuad || currentMeta.placementQuad,
    }),
    uploadedByUserId: actor.id,
    isApprovedFinal: false,
  }));
  const nextVersionNumber = createdVersion.versionNumber;

  const existingChat = currentMeta.chatMessages || [];
  const isTaoAnhCommand = params.note ? /^@/i.test(params.note.trim()) : false;
  const updatedChat: DesignChatMessageDto[] = [
    ...existingChat,
    ...(isTaoAnhCommand && params.note
      ? [
          {
            id: `msg-user-${Date.now()}`,
            role: 'user' as const,
            text: params.note,
            timestamp: new Date().toISOString(),
            chatMode: 'image_generator' as const,
          },
        ]
      : []),
    {
      id: `msg-composite-${Date.now() + 1}`,
      role: 'assistant',
      text: isTaoAnhCommand
        ? `Đã thực thi lệnh **${DAO_TAO_ANH_POSTER_REGEX.test(params.note || '') ? '@TaoAnhPoster' : '@TaoAnh'}** và xuất bản thiết kế mới **v${nextVersionNumber}** trực tiếp trên ảnh công trình.`
        : `Đã kết xuất & lưu bản ghép phối cảnh 3D thực tế (v${nextVersionNumber}) vào thư viện Phiên bản AI.`,
      timestamp: new Date().toISOString(),
      chatMode: 'image_generator',
      versionNumber: nextVersionNumber,
      versionId: createdVersion.id,
      providerId: 'local_sandbox',
      modelUsed: DAO_TAO_ANH_POSTER_REGEX.test(params.note || '')
        ? 'AI Tạo Poster LED (@TaoAnhPoster)'
        : 'AI Phối Cảnh 3D LED (@TaoAnh)',
      durationSec: 0.8,
      cost: isTaoAnhCommand ? '$0.020' : '$0.000',
      status: 'success',
    },
  ];

  const updatedMetadata: StoredMetadata = {
    ...currentMeta,
    placementQuad: params.placementQuad || currentMeta.placementQuad,
    chatMessages: updatedChat,
  };

  await prisma.designRequest.update({
    where: { id: requestId },
    data: {
      aiDraftImageUrl: savedFile.storageObjectKey,
      installPositionJson: JSON.stringify(updatedMetadata),
      designStatus: 'ai_drafting',
      version: { increment: 1 },
    },
  });

  bumpDomainRevisions(['design', 'reports'], 'design_composited_saved');

  return {
    requestId,
    versionId: createdVersion.id,
    versionNumber: createdVersion.versionNumber,
  };
}

export async function uploadDesignerFinalRender(
  actor: SessionUserDto,
  requestId: number,
  params: {
    fileName: string;
    mimeType: string;
    buffer: Buffer;
    note?: string;
  }
) {
  await assertCanAccessDesignProject(actor, requestId);

  const existing = await prisma.designRequest.findUnique({
    where: { id: requestId },
    include: {
      assetVersions: {
        orderBy: { versionNumber: 'desc' },
        take: 1,
      },
    },
  });

  if (!existing) {
    throw new Error('Không tìm thấy yêu cầu thiết kế.');
  }

  const savedFile = savePrivateBusinessFile({
    bucket: 'design',
    prefix: `final-render-req-${requestId}`,
    fileBuffer: params.buffer,
    declaredMimeType: params.mimeType,
    originalFileName: params.fileName,
    allowPdfOrDoc: true,
  });

  const finalVer = await createDesignAssetVersionSafe(requestId, (versionNumber) => ({
    designRequestId: requestId,
    versionNumber,
    versionType: 'final_render',
    storageObjectKey: savedFile.storageObjectKey,
    mimeType: savedFile.mimeType,
    fileSizeBytes: savedFile.fileSizeBytes,
    promptUsed: params.note || 'Bản thiết kế hoàn thiện tải lên bởi Designer (Photoshop/3DsMax)',
    parametersJson: JSON.stringify({ manualDesignerUpload: true }),
    uploadedByUserId: actor.id,
    isApprovedFinal: true,
  }));

  await prisma.designRequest.update({
    where: { id: requestId },
    data: {
      finalRenderUrl: savedFile.storageObjectKey,
      approvedVersionId: finalVer.id,
      designStatus: 'completed',
      completedAt: new Date(),
      notes: params.note || existing.notes,
      version: { increment: 1 },
    },
  });

  if (existing.leadId) {
    await notifyLeadSalesOnDesignCompleted({
      leadId: existing.leadId,
      designRequestId: requestId,
      versionNumber: finalVer.versionNumber,
      actor,
      note: params.note,
      storageObjectKey: savedFile.storageObjectKey,
      fileSizeBytes: savedFile.fileSizeBytes,
    });
  }

  bumpDomainRevisions(['design', 'leads', 'reports', 'notifications'], 'design_final_uploaded');

  return {
    requestId,
    versionId: finalVer.id,
    versionNumber: finalVer.versionNumber,
  };
}

/**
 * Đánh giá thông số kỹ thuật LED, cấu hình ghép cabinet chuẩn mm và danh mục vật tư BOM hoàn toàn độc lập ở phía Server.
 */
export async function evaluateProjectTechnicalBom(
  actor: SessionUserDto,
  requestId: number,
  overrides?: {
    widthMm?: number | null;
    heightMm?: number | null;
    pixelPitch?: string | null;
    cabinetModelCode?: string | null;
    screenStyle?: 'flat' | 'curved' | 'corner_90';
  }
) {
  await assertCanAccessDesignProject(actor, requestId);
  const existing = await prisma.designRequest.findUnique({ where: { id: requestId } });
  if (!existing) {
    throw new Error('Không tìm thấy dự án thiết kế.');
  }
  const meta = parseProjectMetadata(existing.installPositionJson);
  const dims = parseDimensions(existing.screenDimensions);
  const widthMm =
    overrides?.widthMm !== undefined
      ? overrides.widthMm
      : meta.screenWidthM
        ? Math.round(meta.screenWidthM * 1000)
        : dims.screenWidthM
          ? Math.round(dims.screenWidthM * 1000)
          : null;
  const heightMm =
    overrides?.heightMm !== undefined
      ? overrides.heightMm
      : meta.screenHeightM
        ? Math.round(meta.screenHeightM * 1000)
        : dims.screenHeightM
          ? Math.round(dims.screenHeightM * 1000)
          : null;
  const pixelPitch =
    overrides?.pixelPitch ?? meta.pixelPitch ?? meta.productSpec?.pixelPitch ?? 'P2.5';
  const cabinetModelCode = overrides?.cabinetModelCode ?? meta.cabinetModelCode ?? 'CAB_640_480';
  const screenStyle = overrides?.screenStyle ?? meta.screenStyle ?? 'flat';

  const evaluation = evaluateLedTechnicalConfig({
    widthMm,
    heightMm,
    pixelPitch,
    cabinetModelCode,
    screenStyle,
  });

  return {
    requestId,
    evaluation,
  };
}

/**
 * Thử lại an toàn (Singleflight + Idempotent) lệnh tạo ảnh bị lỗi / quá thời gian gần nhất của dự án.
 */
export async function retryLastFailedDesignGeneration(
  actor: SessionUserDto,
  requestId: number,
  asyncMode = false
) {
  await assertCanAccessDesignProject(actor, requestId);
  if (activeDesignJobLocks.has(requestId)) {
    throw new Error('Dự án đang có tiến trình kết xuất chạy nền, vui lòng chờ hoàn tất.');
  }

  const existing = await prisma.designRequest.findUnique({ where: { id: requestId } });
  if (!existing) {
    throw new Error('Không tìm thấy dự án thiết kế.');
  }
  const meta = parseProjectMetadata(existing.installPositionJson);
  const messages = meta.chatMessages || [];
  let promptToRetry: string | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'assistant' && (m.status === 'failed' || m.status === 'timeout')) {
      const prevUser = messages
        .slice(0, i)
        .reverse()
        .find((u) => u.role === 'user');
      if (prevUser?.text) {
        promptToRetry = prevUser.text;
        break;
      }
    }
  }
  if (!promptToRetry) {
    promptToRetry = existing.prompt?.startsWith('@')
      ? existing.prompt
      : `@TaoAnh: ${existing.prompt || 'Ghép phối cảnh màn hình LED theo thông số hiện tại'}`;
  }

  return await processChatDesignRequest(actor, requestId, {
    expectedVersion: existing.version,
    prompt: promptToRetry,
    quality: 'draft',
    asyncMode,
    idempotencyKey: `retry-design-${requestId}-${existing.version}-${Date.now()}`,
  });
}

export {
  autoDetectLedPlacement,
  executeQuickLedInstall,
  generateLedScreenContent,
} from './quick-led-studio.service';
