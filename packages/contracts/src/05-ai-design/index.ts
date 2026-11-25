import { z } from 'zod';
import type { MonetaryAmountDto } from '../common';

export const DESIGN_TYPES = [
  'perspective_3d',
  'banner',
] as const;

export type DesignType = (typeof DESIGN_TYPES)[number];

export const DESIGN_TYPE_LABELS: Record<DesignType, string> = {
  perspective_3d: 'Dựng nháp phối cảnh 3D màn hình LED',
  banner: 'Tạo hình ảnh & Banner theo tỷ lệ khung LED',
};

export const DESIGN_STATUSES = [
  'pending',
  'ai_drafted',
  'in_review',
  'completed',
] as const;

export type DesignStatus = (typeof DESIGN_STATUSES)[number];

export const DESIGN_STATUS_LABELS: Record<DesignStatus, string> = {
  pending: 'Chờ xử lý AI',
  ai_drafted: 'Đã có bản nháp AI',
  in_review: 'Designer đang hoàn thiện',
  completed: 'Đã phê duyệt & bàn giao',
};

export const DESIGN_TASK_CODES = [
  'banner_generate',
  'design_edit',
  'perspective_compose',
  'brief_analyze',
] as const;

export type DesignTaskCode = (typeof DESIGN_TASK_CODES)[number];

export const BANNER_MODES = ['prompt_only', 'with_product'] as const;
export type BannerMode = (typeof BANNER_MODES)[number];

export const DesignTaskCodeSchema = z.enum(DESIGN_TASK_CODES);

export const DESIGN_TASK_LABELS: Record<DesignTaskCode, { title: string; subtitle: string; requiresImageOutput: boolean }> = {
  banner_generate: {
    title: '1. Tạo banner / poster',
    subtitle: 'Sinh mẫu truyền thông mới từ brief chiến dịch, sản phẩm & kích thước kênh',
    requiresImageOutput: true,
  },
  design_edit: {
    title: '2. Chỉnh sửa thiết kế đang có',
    subtitle: 'Sửa trực tiếp trên phiên bản/ảnh tham chiếu, giữ bố cục & phần cần bảo toàn',
    requiresImageOutput: true,
  },
  perspective_compose: {
    title: '3. Dựng phối cảnh công trình',
    subtitle: 'Ghép màn hình LED / sản phẩm vào ảnh hiện trạng công trình theo vùng lắp đặt',
    requiresImageOutput: true,
  },
  brief_analyze: {
    title: '4. Phân tích brief & tư vấn thông số',
    subtitle: 'Đọc ảnh/brief để gợi ý bố cục, thông điệp, prompt chuẩn & kiểm tra thông số',
    requiresImageOutput: false,
  },
};

export const DesignBriefBaselineSnapshotSchema = z.object({
  capturedAt: z.string(),
  sourceModule: z.enum(['reports', 'tracking', 'seo_ai', 'leads', 'design']).default('design'),
  scopeLabel: z.string().max(240).optional().nullable(),
  dateFrom: z.string().max(40).optional().nullable(),
  dateTo: z.string().max(40).optional().nullable(),
  websiteId: z.string().max(120).optional().nullable(),
  websiteDomain: z.string().max(120).optional().nullable(),
  campaignId: z.string().max(120).optional().nullable(),
  campaignName: z.string().max(200).optional().nullable(),
  contentId: z.number().int().positive().optional().nullable(),
  snapshotId: z.string().max(120).optional().nullable(),
  metrics: z
    .object({
      adCost: z.number().nullable().optional(),
      receivedLeadCount: z.number().nullable().optional(),
      validLeadCount: z.number().nullable().optional(),
      costPerValidAdLead: z.number().nullable().optional(),
      wonLeadCount: z.number().nullable().optional(),
      winRatePct: z.number().nullable().optional(),
    })
    .optional()
    .nullable(),
});

export type DesignBriefBaselineSnapshotDto = z.infer<typeof DesignBriefBaselineSnapshotSchema>;

export const DesignBriefSchema = z.object({
  objective: z.string().trim().max(600).optional().nullable(),
  websiteId: z.string().trim().max(120).optional().nullable(),
  websiteDomain: z.string().trim().max(120).optional().nullable(),
  campaignId: z.string().trim().max(120).optional().nullable(),
  campaignName: z.string().trim().max(200).optional().nullable(),
  contentId: z.number().int().positive().optional().nullable(),
  productId: z.number().int().positive().optional().nullable(),
  targetChannel: z.string().trim().max(120).optional().nullable(),
  outputFormat: z.string().trim().max(80).optional().nullable(),
  outputWidthPx: z.number().int().min(128).max(15360).optional().nullable(),
  outputHeightPx: z.number().int().min(64).max(8640).optional().nullable(),
  headlineText: z.string().trim().max(240).optional().nullable(),
  subheadlineText: z.string().trim().max(320).optional().nullable(),
  ctaText: z.string().trim().max(120).optional().nullable(),
  brandLogoMode: z.enum(['auto', 'light', 'dark', 'none']).optional().nullable(),
  brandPrimaryColor: z.string().trim().max(40).optional().nullable(),
  keepElementsNote: z.string().trim().max(600).optional().nullable(),
  changeElementsNote: z.string().trim().max(600).optional().nullable(),
  dueDate: z.string().trim().max(40).optional().nullable(),
  requesterUserId: z.number().int().positive().optional().nullable(),
  requesterName: z.string().trim().max(120).optional().nullable(),
  assignedDesignerId: z.number().int().positive().optional().nullable(),
  baselineSnapshot: DesignBriefBaselineSnapshotSchema.optional().nullable(),
});

export type DesignBriefDto = z.infer<typeof DesignBriefSchema>;

export type AiConnectionKind = 'direct_official' | 'openai_compatible_gateway' | 'local_compositor';

export type AiSupportedOperation =
  | 'text_analysis'
  | 'vision_understanding'
  | 'image_generation'
  | 'image_editing_ref'
  | 'inpainting_mask'
  | 'multi_image_ref'
  | 'transparent_bg';

export type AiTaskValidationStatus =
  | 'verified'
  | 'listed_unverified'
  | 'blocked_permission'
  | 'blocked_quota_billing'
  | 'deprecated'
  | 'unsupported'
  | 'failed_error';

export type AiCapabilityEvidence = 'metadata' | 'documentation' | 'live_probe';

export interface AiDiscoveredModelRegistryItemDto {
  modelId: string;
  displayName: string;
  providerId: AiProviderId;
  connectionKind: AiConnectionKind;
  listedInCatalog: boolean;
  supportedOperations: AiSupportedOperation[];
  taskStatuses: Record<DesignTaskCode, AiTaskValidationStatus>;
  capabilityEvidence: AiCapabilityEvidence;
  recommendedDefaultForTasks: DesignTaskCode[];
  lastCheckedAt: string | null;
  statusDetail: string;
  reportedAliasWarning?: string | null;
}

export interface AiProviderRegistryConnectionDto {
  providerId: AiProviderId;
  providerName: string;
  connectionKind: AiConnectionKind;
  configuredEndpoint: string | null;
  hasCredential: boolean;
  maskedCredential: string | null;
  listApiSupported: boolean;
  listApiStatus: 'ok' | 'unsupported' | 'error' | 'not_configured';
  listApiDetail: string;
  discoveredModelCount: number;
  lastDiscoveryAt: string | null;
  cacheExpiresAt: string | null;
}

export interface AiModelRegistrySnapshotDto {
  generatedAt: string;
  cacheTtlMinutes: number;
  connections: AiProviderRegistryConnectionDto[];
  models: AiDiscoveredModelRegistryItemDto[];
  defaultModelByTask: Partial<Record<DesignTaskCode, { providerId: AiProviderId; modelId: string }>>;
  probeBudgetMaxUsd: number;
  probeBudgetSpentUsd: number;
}

export const AI_PROVIDER_IDS = [
  'google_imagen',
  'openai_dalle',
  'flux_bfl',
  'stability_ai',
  'custom_endpoint',
  'local_sandbox',
] as const;

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export interface AiModelOptionDto {
  id: string;
  name: string;
  badge: string;
  costPerImageUsd: number;
  supportsInpainting: boolean;
  description: string;
}

export interface AiProviderCatalogItemDto {
  providerId: AiProviderId;
  providerName: string;
  shortName: string;
  isConfigured: boolean;
  isDefault: boolean;
  activeModel: string;
  apiEndpoint?: string;
  hasApiKey: boolean;
  maskedApiKey?: string | null;
  statusLabel: string;
  notes: string;
  models: AiModelOptionDto[];
}

export interface QuadCoordinatesDto {
  topLeft: { x: number; y: number };
  topRight: { x: number; y: number };
  bottomRight: { x: number; y: number };
  bottomLeft: { x: number; y: number };
}

export interface ProjectPhotoItemDto {
  id: string;
  name: string;
  url: string;
  storageObjectKey?: string;
  selected: boolean;
  photoRole?: 'site_photo' | 'product_reference';
  uploadedAt: string;
  sourceLeadAttachmentId?: number;
}

export interface DesignChatMessageDto {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  chatMode?: 'consultant_free' | 'image_generator';
  suggestedTaoAnhPrompt?: string;
  attachedProductPhotos?: Array<{ id: string; name: string; url: string }>;
  versionId?: number;
  versionNumber?: number;
  providerId?: string;
  modelUsed?: string;
  durationSec?: number;
  tokenUsed?: number;
  cost?: string;
  status?: 'success' | 'failed' | 'timeout' | 'pending';
}

export interface LedProductSpecDto {
  productId: number;
  productCode: string;
  productName: string;
  categoryGroup: string;
  screenStyle: 'flat' | 'curved' | 'corner_90';
  pixelPitch: string; // e.g. "P2.5", "P2.0", "P3", "P4"
  physicalWidthM: number;
  physicalHeightM: number;
  areaM2: number;
  resolutionWidthPx: number;
  resolutionHeightPx: number;
  moduleDimensionsMm: string; // e.g. "320 x 160 mm"
  cabinetDimensionsMm: string; // e.g. "640 x 480 mm"
  cabinetCount: number;
  moduleCount: number;
  controller: string; // e.g. "Novastar TB60 / VX600"
  receivingCard: string; // e.g. "Novastar MRV328"
  powerSupply: string; // e.g. "Meanwell / G-Energy 5V-40A"
  avgPowerWatts: number;
  maxPowerWatts: number;
  technicalNotes: string;
}

export interface DesignActiveJobDto {
  jobId: string;
  status: 'running' | 'succeeded' | 'failed';
  action: 'GENERATE_SCENE' | 'GENERATE_BANNER' | 'RETRY';
  providerId: string;
  modelId: string;
  startedAt: string;
  finishedAt?: string | null;
  resultVersionNo?: number | null;
  fallbackUsed?: boolean;
  idempotencyKey?: string | null;
  message?: string | null;
}

export interface DesignAssetVersionItemDto {
  id: number;
  designRequestId: number;
  versionNumber: number;
  sourceType: 'AI_DRAFT' | 'DESIGNER_FINAL_UPLOAD';
  generationOrigin?: 'CLOUD_AI' | 'AI_PLUS_LAYOUT' | 'LOCAL_COMPOSITE_FALLBACK' | 'DESIGNER_UPLOAD' | null;
  providerId?: string | null;
  modelUsed?: string | null;
  requestedModel?: string | null;
  reportedModel?: string | null;
  reportedModelNote?: string | null;
  costState?: 'actual' | 'estimated' | 'unknown' | null;
  taskCode?: DesignTaskCode | null;
  taskId?: string | null;
  inputAssetIds?: string[];
  parentVersionId?: number | null;
  storageObjectKey: string;
  downloadUrl: string;
  mimeType: string;
  fileSizeBytes: number | null;
  widthPx: number | null;
  heightPx: number | null;
  aspectRatio: string | null;
  promptUsed: string | null;
  processingDurationMs: number | null;
  tokenUsed: number | null;
  cost: MonetaryAmountDto | null;
  isApprovedFinal: boolean;
  uploadedByName: string;
  createdAt: string;
  fileAvailable?: boolean;
  referenceSitePhotoId?: string | null;
  referenceProductPhotoIds?: string[];
  sourceVersionId?: number | null;
  effectivePrompt?: string | null;
}

export interface DesignRequestItemDto {
  id: number;
  version: number;
  projectName: string;
  contactName: string | null;
  installationInfo: string | null;
  notes: string | null;
  leadId: number | null;
  leadCode: string | null;
  leadProjectLabel: string | null;
  productId: number | null;
  productName: string | null;
  websiteId?: string | null;
  websiteDomain?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  contentId?: number | null;
  sourceModule?: string | null;
  taskCode?: DesignTaskCode | null;
  designBrief?: DesignBriefDto | null;
  requestedBySalesId: number | null;
  requestedBySalesName: string | null;
  assignedDesignerId: number;
  assignedDesignerName: string;
  designType: DesignType;
  ledModuleSpec: string | null;
  screenWidthM: number | null;
  screenHeightM: number | null;
  installZoneBboxJson: string | null;
  placementQuad: QuadCoordinatesDto | null;
  ledScreens?: LedScreenInstanceDto[];
  bannerWidthPx: number | null;
  bannerHeightPx: number | null;
  aspectRatio: string | null;
  aspectLocked?: boolean;
  isArchived?: boolean;
  sitePhotoDownloadUrl: string | null;
  photos: ProjectPhotoItemDto[];
  chatMessages: DesignChatMessageDto[];
  productSpec: LedProductSpecDto | null;
  aiPrompt: string;
  aiDraftDownloadUrl: string | null;
  finalRenderDownloadUrl: string | null;
  approvedVersionId: number | null;
  processingDurationSec: number | null;
  tokenCost: number | null;
  totalCost: MonetaryAmountDto | null;
  status: DesignStatus;
  activeJob?: DesignActiveJobDto | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  assetVersions: DesignAssetVersionItemDto[];
}

/**
 * Kiểm tra không cho phép gửi SĐT hoặc Email khách hàng vào Prompt AI (AGENTS.md & UC06 mục 4)
 */
export function containsCustomerPiiInPrompt(text: string): { hasPii: boolean; reason?: string } {
  if (!text) return { hasPii: false };
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  if (emailRegex.test(text)) {
    return {
      hasPii: true,
      reason: 'Prompt chứa địa chỉ email. Theo quy định bảo mật BA (UC06), tuyệt đối không gửi email/SĐT khách hàng sang AI bên thứ ba.',
    };
  }
  const vnPhoneRegex = /(?:\+84|0)(?:3|5|7|8|9)(?:[\s.-]*\d){8}\b/;
  if (vnPhoneRegex.test(text)) {
    return {
      hasPii: true,
      reason: 'Prompt chứa số điện thoại. Theo quy định bảo mật BA (UC06), tuyệt đối không gửi SĐT/thông tin liên hệ khách hàng sang AI bên thứ ba.',
    };
  }
  return { hasPii: false };
}

export const QuadCoordinatesSchema = z.object({
  topLeft: z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) }),
  topRight: z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) }),
  bottomRight: z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) }),
  bottomLeft: z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) }),
});

export const CreatePerspective3dRequestSchema = z.object({
  designType: z.literal('perspective_3d'),
  projectName: z.string().trim().min(2, 'Tên dự án tối thiểu 2 ký tự.').max(150).default('Showroom LED'),
  contactName: z.string().trim().max(120).optional().nullable(),
  installationInfo: z.string().trim().max(500).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  leadId: z.number().int().positive().optional().nullable(),
  productId: z.number().int().positive().default(1),
  ledModuleSpec: z.string().trim().min(2, 'Vui lòng chọn cấu hình module LED (P2, P2.5, P3, P4...).').max(120).default('P2.5 Indoor'),
  screenWidthM: z.number().positive('Chiều ngang màn hình (m) phải lớn hơn 0.').max(200).default(4.8),
  screenHeightM: z.number().positive('Chiều cao màn hình (m) phải lớn hơn 0.').max(100).default(2.7),
  installZoneBboxJson: z.string().trim().min(2).max(500).optional().nullable(),
  placementQuad: QuadCoordinatesSchema.optional().nullable(),
  sitePhotoObjectKey: z.string().trim().max(260).optional().nullable(),
  aiPrompt: z
    .string()
    .trim()
    .min(5, 'Prompt mô tả phối cảnh cần tối thiểu 5 ký tự.')
    .max(1500),
  quality: z.enum(['draft', 'high_quality']).default('draft'),
  providerId: z.enum(AI_PROVIDER_IDS).optional(),
  modelId: z.string().trim().max(120).optional(),
  simulateAiTimeout: z.boolean().optional(),
});

export const CreateBannerRequestSchema = z.object({
  designType: z.literal('banner'),
  projectName: z.string().trim().min(2).max(150).default('Banner LED'),
  contactName: z.string().trim().max(120).optional().nullable(),
  installationInfo: z.string().trim().max(500).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  /** Banner có thể tạo độc lập không cần gắn Lead theo UC06 Luồng phụ 2a */
  leadId: z.number().int().positive().optional().nullable(),
  productId: z.number().int().positive().optional().nullable(),
  bannerWidthPx: z.number().int().min(128, 'Chiều rộng pixel tối thiểu 128px.').max(15360).default(1920),
  bannerHeightPx: z.number().int().min(64, 'Chiều cao pixel tối thiểu 64px.').max(8640).default(1080),
  aspectRatio: z.string().trim().min(2).max(30).default('16:9'),
  placementQuad: QuadCoordinatesSchema.optional().nullable(),
  aiPrompt: z
    .string()
    .trim()
    .min(5, 'Prompt mô tả nội dung Banner cần tối thiểu 5 ký tự.')
    .max(1500),
  quality: z.enum(['draft', 'high_quality']).default('draft'),
  providerId: z.enum(AI_PROVIDER_IDS).optional(),
  modelId: z.string().trim().max(120).optional(),
  simulateAiTimeout: z.boolean().optional(),
});

export const CreateDesignRequestSchema = z.discriminatedUnion('designType', [
  CreatePerspective3dRequestSchema,
  CreateBannerRequestSchema,
]);

export type CreateDesignRequestDto = z.infer<typeof CreateDesignRequestSchema>;

export const UpdateDesignProjectSchema = z.object({
  projectName: z.string().trim().min(2).max(150).optional(),
  designType: z.enum(DESIGN_TYPES).optional(),
  contactName: z.string().trim().max(120).optional().nullable(),
  installationInfo: z.string().trim().max(500).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  leadId: z.number().int().positive().optional().nullable(),
  productId: z.number().int().positive().optional().nullable(),
  ledModuleSpec: z.string().trim().max(120).optional().nullable(),
  pixelPitch: z.string().trim().max(30).optional().nullable(),
  screenStyle: z.enum(['flat', 'curved', 'corner_90']).optional(),
  screenWidthM: z.number().positive().max(200).optional().nullable(),
  screenHeightM: z.number().positive().max(100).optional().nullable(),
  bannerWidthPx: z.number().int().min(128).max(15360).optional().nullable(),
  bannerHeightPx: z.number().int().min(64).max(8640).optional().nullable(),
  aspectRatio: z.string().trim().max(30).optional().nullable(),
  aspectLocked: z.boolean().optional(),
  placementQuad: QuadCoordinatesSchema.optional().nullable(),
  selectedPhotoId: z.string().trim().optional(),
  cabinetModelCode: z.string().trim().max(60).optional().nullable(),
  compositingMode: z.enum(['STRICT', 'REALISTIC']).optional(),
  renamePhotoId: z.string().trim().optional(),
  renamePhotoName: z.string().trim().min(1).max(120).optional(),
  toggleProductPhotoId: z.string().trim().optional(),
  productPhotoRole: z.enum(['site_photo', 'product_reference']).optional(),
  renameVersionId: z.number().int().positive().optional(),
  renameVersionLabel: z.string().trim().min(1).max(200).optional(),
  taskCode: DesignTaskCodeSchema.optional().nullable(),
  designBrief: DesignBriefSchema.optional().nullable(),
  websiteId: z.string().trim().max(120).optional().nullable(),
  campaignId: z.string().trim().max(120).optional().nullable(),
  contentId: z.number().int().positive().optional().nullable(),
  isArchived: z.boolean().optional(),
  importLeadAttachments: z.boolean().optional(),
  expectedVersion: z.number().int().positive().optional(),
});

export type UpdateDesignProjectDto = z.infer<typeof UpdateDesignProjectSchema>;

export const ChatDesignRequestSchema = z.object({
  expectedVersion: z.coerce.number().int().optional(),
  prompt: z.string().trim().min(1, 'Vui lòng nhập nội dung yêu cầu chat.').max(2000),
  chatMode: z.enum(['auto', 'consultant_free', 'image_generator']).optional(),
  taskCode: DesignTaskCodeSchema.optional(),
  triggerSource: z
    .enum(['user_input', 'user_button', 'ai_generated_text', 'uploaded_file_content'])
    .optional(),
  compositingMode: z.enum(['STRICT', 'REALISTIC']).optional(),
  sourceVersionId: z.coerce.number().int().positive().optional().nullable(),
  parentVersionId: z.coerce.number().int().positive().optional().nullable(),
  inputAssetIds: z.array(z.string().trim().max(120)).optional(),
  selectedPhotoId: z.string().trim().max(120).optional().nullable(),
  cabinetModelCode: z.string().trim().max(60).optional().nullable(),
  quality: z.enum(['draft', 'high_quality']).default('draft'),
  providerId: z.string().trim().optional(),
  modelId: z.string().trim().max(120).optional(),
  placementQuad: QuadCoordinatesSchema.optional().nullable(),
  selectedPhotoUrl: z.string().trim().optional().nullable(),
  clientRenderedBase64: z.string().optional().nullable(),
  referenceProductPhotoIds: z.array(z.string()).optional(),
  referenceProductPhotoUrls: z.array(z.string()).optional(),
  referenceProductName: z.string().trim().max(200).optional().nullable(),
  productId: z.coerce.number().int().optional().nullable(),
  screenWidthM: z.coerce.number().optional().nullable(),
  screenHeightM: z.coerce.number().optional().nullable(),
  bannerWidthPx: z.coerce.number().optional().nullable(),
  bannerHeightPx: z.coerce.number().optional().nullable(),
  aspectRatio: z.string().trim().max(30).optional().nullable(),
  applyLayoutOverlay: z.boolean().optional(),
  bannerMode: z.enum(BANNER_MODES).optional(),
  designBrief: DesignBriefSchema.optional().nullable(),
  simulateAiTimeout: z.boolean().optional(),
  disableLocalFallback: z.boolean().optional(),
  idempotencyKey: z.string().trim().max(120).optional(),
  asyncMode: z.boolean().optional(),
});

export type ChatDesignRequestDto = z.infer<typeof ChatDesignRequestSchema>;

export const RegenerateDesignDraftSchema = z.object({
  expectedVersion: z.number().int().positive(),
  aiPrompt: z.string().trim().min(5).max(1500),
  providerId: z.enum(AI_PROVIDER_IDS).optional(),
  modelId: z.string().trim().max(120).optional(),
  ledModuleSpec: z.string().trim().max(120).optional().nullable(),
  screenWidthM: z.number().positive().max(200).optional().nullable(),
  screenHeightM: z.number().positive().max(100).optional().nullable(),
  bannerWidthPx: z.number().int().min(128).max(15360).optional().nullable(),
  bannerHeightPx: z.number().int().min(64).max(8640).optional().nullable(),
  aspectRatio: z.string().trim().max(30).optional().nullable(),
  quality: z.enum(['draft', 'high_quality']).optional(),
  simulateAiTimeout: z.boolean().optional(),
  asyncMode: z.boolean().optional(),
  idempotencyKey: z.string().trim().max(120).optional(),
});

export type RegenerateDesignDraftDto = z.infer<typeof RegenerateDesignDraftSchema>;

export const ConfigureAiProvidersSchema = z.object({
  defaultProviderId: z.enum(AI_PROVIDER_IDS),
  defaultModelId: z.string().trim().min(1).max(120).optional(),
  autoFallbackToLocal: z.boolean().default(true),
  providerConfig: z
    .object({
      providerId: z.enum(AI_PROVIDER_IDS),
      apiKey: z.string().trim().max(300).optional().nullable(),
      apiEndpoint: z.string().trim().max(400).optional().nullable(),
      activeModel: z.string().trim().max(120).optional().nullable(),
    })
    .optional(),
});

export type ConfigureAiProvidersDto = z.infer<typeof ConfigureAiProvidersSchema>;

export const ApproveDesignVersionSchema = z.object({
  expectedVersion: z.number().int().positive(),
  versionId: z.number().int().positive(),
  note: z.string().trim().max(500).optional(),
});

export type ApproveDesignVersionDto = z.infer<typeof ApproveDesignVersionSchema>;

export const AddProjectPhotoSchema = z.object({
  photoName: z.string().trim().min(1).max(120).default('Ảnh hiện trạng'),
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().default('image/jpeg'),
  base64Data: z.string().min(1),
  photoRole: z.enum(['site_photo', 'product_reference']).optional(),
});

export type AddProjectPhotoDto = z.infer<typeof AddProjectPhotoSchema>;

export const MarketingBriefSubmitSchema = z.object({
  action: z.literal('submit_marketing_brief'),
  projectName: z.string().trim().min(2).max(150),
  taskCode: DesignTaskCodeSchema.default('banner_generate'),
  designType: z.enum(DESIGN_TYPES).default('banner'),
  productId: z.number().int().positive().optional().nullable(),
  sourceModule: z.enum(['reports', 'tracking', 'seo_ai', 'leads', 'design']).default('reports'),
  designBrief: DesignBriefSchema,
  notes: z.string().trim().max(1500).optional().nullable(),
});

export type MarketingBriefSubmitDto = z.infer<typeof MarketingBriefSubmitSchema>;

export const ProbeModelCapabilitySchema = z.object({
  action: z.literal('probe_model_capability'),
  providerId: z.enum(AI_PROVIDER_IDS),
  modelId: z.string().trim().min(1).max(120),
  taskCode: DesignTaskCodeSchema,
});

export type ProbeModelCapabilityDto = z.infer<typeof ProbeModelCapabilitySchema>;

export const RefreshModelRegistrySchema = z.object({
  action: z.literal('refresh_model_registry'),
  providerId: z.enum(AI_PROVIDER_IDS).optional(),
});

export type RefreshModelRegistryDto = z.infer<typeof RefreshModelRegistrySchema>;

// ================= V3: Universal 12 LED Shapes, 1-Click Auto-Snap & Marketing Turbo Kit =================

export const LED_SCREEN_SHAPES = [
  'flat_rect',
  'rounded_rect',
  'circle_oval',
  'free_polygon',
  'curved_arc',
  'corner_90_smooth',
  'cylindrical_column',
  'multi_segment_wave',
  'transparent_glass',
  'led_floor',
  'led_ceiling',
  'led_standee',
] as const;

export type LedScreenShapeType = (typeof LED_SCREEN_SHAPES)[number];

export const LedScreenShapeSchema = z.enum(LED_SCREEN_SHAPES);

export const LED_SCREEN_SHAPE_META: Record<
  LedScreenShapeType,
  {
    label: string;
    shortLabel: string;
    group: 'planar' | 'curved_3d' | 'material_spatial' | 'multi_standee';
    description: string;
    defaultTransparencyPct: number;
  }
> = {
  flat_rect: {
    label: 'Màn LED phẳng 4 góc',
    shortLabel: 'Phẳng 4 góc',
    group: 'planar',
    description: 'Màn hình chữ nhật chuẩn lắp tường phòng họp, hội trường, showroom, biển hiệu.',
    defaultTransparencyPct: 0,
  },
  rounded_rect: {
    label: 'Bo góc tròn / Mái vòm',
    shortLabel: 'Bo góc / Vòm',
    group: 'planar',
    description: 'Màn hình bo tròn 4 góc đều hoặc bo 2 góc trên tạo dáng vòm kiến trúc sang trọng.',
    defaultTransparencyPct: 0,
  },
  circle_oval: {
    label: 'Hình Tròn / Elip / Oval',
    shortLabel: 'Tròn / Oval',
    group: 'planar',
    description: 'Màn LED tròn/oval nội tiếp tự nghiêng theo đúng phối cảnh vách tường.',
    defaultTransparencyPct: 0,
  },
  free_polygon: {
    label: 'Đa giác N điểm bo góc',
    shortLabel: 'Đa giác N điểm',
    group: 'planar',
    description: 'Chấm 3–24 đỉnh né khung cửa, cột dầm, hình chữ T/L/lục giác và bo tròn từng đỉnh.',
    defaultTransparencyPct: 0,
  },
  curved_arc: {
    label: 'Cong lồi / Cong lõm (Dẻo)',
    shortLabel: 'Màn Cong',
    group: 'curved_3d',
    description: 'Module LED dẻo uốn cong theo sảnh bán nguyệt hoặc vách cong showroom.',
    defaultTransparencyPct: 0,
  },
  corner_90_smooth: {
    label: 'Góc 90° & Bo 3D Naked-Eye',
    shortLabel: 'Góc L / 3D',
    group: 'curved_3d',
    description: 'Ghép 2 mặt phẳng vuông góc tòa nhà hoặc bo mượt góc 3D không kính.',
    defaultTransparencyPct: 0,
  },
  cylindrical_column: {
    label: 'Bọc cột trụ tròn 360°',
    shortLabel: 'Bọc cột 360°',
    group: 'curved_3d',
    description: 'Ôm tròn thân cột kết cấu sảnh TTTM / sân bay với đổ bóng khối trụ 3D.',
    defaultTransparencyPct: 0,
  },
  multi_segment_wave: {
    label: 'Dải uốn sóng S / U',
    shortLabel: 'Uốn sóng S/U',
    group: 'curved_3d',
    description: 'Màn hình dải dài uốn lượn liên tục nhiều nhịp quanh sảnh hoặc quầy bar.',
    defaultTransparencyPct: 0,
  },
  transparent_glass: {
    label: 'LED Trong suốt (Vách kính)',
    shortLabel: 'Trong suốt',
    group: 'material_spatial',
    description: 'Xuyên sáng 40%–85% lắp sau vách kính showroom, thấy rõ không gian bên trong.',
    defaultTransparencyPct: 68,
  },
  led_floor: {
    label: 'Màn LED Sàn chịu lực',
    shortLabel: 'LED Sàn',
    group: 'material_spatial',
    description: 'Lắp âm hoặc nổi mặt sàn catwalk/sân khấu kèm lớp kính phản chiếu cường lực.',
    defaultTransparencyPct: 0,
  },
  led_ceiling: {
    label: 'Màn LED Trần vòm kỹ thuật số',
    shortLabel: 'LED Trần',
    group: 'material_spatial',
    description: 'Ốp trần sảnh tiệc, showroom, hành lang tạo hiệu ứng bầu trời hoặc ánh sáng động.',
    defaultTransparencyPct: 0,
  },
  led_standee: {
    label: 'Standee / Poster LED đứng',
    shortLabel: 'Standee đứng',
    group: 'multi_standee',
    description: 'Màn GOB chân đứng đặt sảnh chờ, hành lang kèm đế kim loại & bóng tiếp xúc sàn.',
    defaultTransparencyPct: 0,
  },
};

export const LedCornerRadiiSchema = z.object({
  tl: z.number().min(0).max(50).default(0),
  tr: z.number().min(0).max(50).default(0),
  br: z.number().min(0).max(50).default(0),
  bl: z.number().min(0).max(50).default(0),
});

export type LedCornerRadiiDto = z.infer<typeof LedCornerRadiiSchema>;

export const LedPolygonVertexSchema = z.object({
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  cornerRadiusPct: z.number().min(0).max(45).optional(),
});

export type LedPolygonVertexDto = z.infer<typeof LedPolygonVertexSchema>;

export const LedMaterialOptionsSchema = z.object({
  transparencyPct: z.number().min(0).max(95).default(0),
  lumaKeyThreshold: z.number().min(0).max(100).default(18),
  hasGlassReflection: z.boolean().default(false),
  floorGlassSpecular: z.number().min(0).max(100).default(0),
  cabinetGridStrength: z.number().min(0).max(100).default(18),
  bezelThicknessPx: z.number().min(0).max(30).default(6),
  brightnessPct: z.number().min(40).max(160).default(102),
  ambientSpillPct: z.number().min(0).max(100).default(35),
  floorReflectionPct: z.number().min(0).max(100).default(0),
  hasStandeeBase: z.boolean().default(false),
});

export type LedMaterialOptionsDto = z.infer<typeof LedMaterialOptionsSchema>;

export const LedScreenInstanceSchema = z.object({
  id: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(120).default('Màn hình LED #1'),
  shapeType: LedScreenShapeSchema.default('flat_rect'),
  quad: QuadCoordinatesSchema,
  polygonPoints: z.array(LedPolygonVertexSchema).max(24).optional(),
  secondaryQuad: QuadCoordinatesSchema.optional().nullable(),
  cornerRoundnessPct: z.number().min(0).max(50).optional(),
  curveSagTopPct: z.number().min(-40).max(40).optional(),
  curveSagBottomPct: z.number().min(-40).max(40).optional(),
  cylinderPerspectivePct: z.number().min(-40).max(40).optional(),
  cornerRadiiPct: LedCornerRadiiSchema.optional(),
  material: LedMaterialOptionsSchema.optional(),
  contentPresetId: z.string().trim().max(120).optional().nullable(),
  contentImageUrl: z.string().trim().max(1000).optional().nullable(),
  contentCustomPrompt: z.string().trim().max(800).optional().nullable(),
  syncSharedContent: z.boolean().optional(),
});

export type LedScreenInstanceDto = z.infer<typeof LedScreenInstanceSchema>;

export const MARKETING_EXPORT_FORMATS = ['original', '1:1', '4:5', '16:9', '9:16'] as const;

export type MarketingExportFormatType = (typeof MARKETING_EXPORT_FORMATS)[number];

export const AutoDetectLedPlacementRequestSchema = z.object({
  action: z.literal('auto_detect_led_placement').optional(),
  photoId: z.string().trim().max(120).optional().nullable(),
  clickPoint: z
    .object({
      x: z.number().min(0).max(100),
      y: z.number().min(0).max(100),
    })
    .optional()
    .nullable(),
  annotatedImageBase64: z.string().max(12_000_000).optional().nullable(),
  preferredShapeType: LedScreenShapeSchema.optional().nullable(),
});

export type AutoDetectLedPlacementRequestDto = z.infer<
  typeof AutoDetectLedPlacementRequestSchema
>;

export const LedQuickInstallRequestSchema = z.object({
  action: z.literal('quick_install_led').optional(),
  mode: z.enum(['fast_composite', 'realistic_ai_blend']).default('fast_composite'),
  photoId: z.string().trim().max(120).optional().nullable(),
  screens: z.array(LedScreenInstanceSchema).min(1).max(12),
  guidedCompositeBase64: z.string().min(32).max(20_000_000),
  originalPhotoBase64: z.string().max(20_000_000).optional().nullable(),
  alphaMaskBase64: z.string().max(15_000_000).optional().nullable(),
  occlusionMaskBase64: z.string().max(15_000_000).optional().nullable(),
  note: z.string().trim().max(600).optional().nullable(),
  variantLabel: z.string().trim().max(120).optional().nullable(),
  contentSummary: z.string().trim().max(400).optional().nullable(),
  contextHint: z.string().trim().max(240).optional().nullable(),
  providerId: z.enum(AI_PROVIDER_IDS).optional(),
  modelId: z.string().trim().max(120).optional().nullable(),
  marketingFormat: z.enum(MARKETING_EXPORT_FORMATS).optional(),
});

export type LedQuickInstallRequestDto = z.infer<typeof LedQuickInstallRequestSchema>;

export const GenerateLedScreenContentRequestSchema = z.object({
  action: z.literal('generate_led_screen_content').optional(),
  prompt: z.string().trim().min(2, 'Vui lòng nhập mô tả ngắn nội dung cần hiển thị trên màn LED.').max(800),
  aspectRatio: z.string().trim().max(24).optional().nullable(),
  shapeType: LedScreenShapeSchema.optional().nullable(),
  transparentMode: z.boolean().optional(),
  providerId: z.enum(AI_PROVIDER_IDS).optional(),
  modelId: z.string().trim().max(120).optional().nullable(),
});

export type GenerateLedScreenContentRequestDto = z.infer<
  typeof GenerateLedScreenContentRequestSchema
>;

export interface LedPlacementRecipeDto {
  id: string;
  name: string;
  shapeType: LedScreenShapeType;
  presetId: string;
  marketingFormat: MarketingExportFormatType;
  includeBrandKit: boolean;
  includeBeforeAfter: boolean;
  brightnessPct: number;
  bezelThicknessPx: number;
  transparencyPct: number;
  createdAt: string;
}

