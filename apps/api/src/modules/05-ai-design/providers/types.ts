/**
 * AI Design Provider Types & Contracts
 * Module 05: Hỗ trợ Thiết kế & Phối cảnh AI (UC06)
 */

import type {
  AiModelRegistrySnapshotDto,
  AiProviderCatalogItemDto,
  AiProviderId,
} from '@toantrung/contracts';

export interface QuadCoordinates {
  topLeft: { x: number; y: number };
  topRight: { x: number; y: number };
  bottomRight: { x: number; y: number };
  bottomLeft: { x: number; y: number };
}

export interface PerspectiveGenerationInput {
  workflow: 'perspective_3d';
  prompt: string;
  referenceImageUrl: string;
  referenceImageBuffer?: Buffer;
  referenceImageMimeType?: string;
  maskImageBuffer?: Buffer;
  productReferenceBuffers?: Array<{ buffer: Buffer; mimeType: string; name: string }>;
  sourcePhotoId?: string | null;
  sourceVersionId?: number | null;
  placementQuad?: QuadCoordinates;
  compositingMode?: 'STRICT' | 'REALISTIC';
  dimensions: {
    widthM: number;
    heightM: number;
    aspectRatio?: string;
  };
  productSpec?: {
    productCode: string;
    productName: string;
    pitch?: string;
    screenStyle?: string;
  };
  quality: 'draft' | 'high_quality';
  modelId?: string;
  idempotencyKey: string;
  simulateTimeout?: boolean;
  disableLocalFallback?: boolean;
  requireReferenceEdit?: boolean;
}

export interface BannerGenerationInput {
  workflow: 'banner';
  prompt: string;
  referenceImageBuffer?: Buffer;
  referenceImageMimeType?: string;
  maskImageBuffer?: Buffer;
  productReferenceBuffers?: Array<{ buffer: Buffer; mimeType: string; name: string }>;
  sourceVersionId?: number | null;
  dimensions: {
    widthPx: number;
    heightPx: number;
    aspectRatio: string;
  };
  productSpec?: {
    productCode?: string;
    productName?: string;
  };
  quality: 'draft' | 'high_quality';
  modelId?: string;
  idempotencyKey: string;
  simulateTimeout?: boolean;
  disableLocalFallback?: boolean;
  requireReferenceEdit?: boolean;
}

export type DesignGenerationInput = PerspectiveGenerationInput | BannerGenerationInput;

export interface ProviderGenerationResult {
  imageBuffer: Buffer;
  mimeType: string;
  durationMs: number;
  modelUsed: string;
  requestedModel?: string;
  reportedModel?: string | null;
  reportedModelNote?: string | null;
  provider: AiProviderId;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  tokensActual?: boolean;
  costMicros: bigint; // 1 USD = 1,000,000 micros
  costCurrency: 'USD' | 'VND';
  costState?: 'actual' | 'estimated' | 'unknown';
  isCostEstimated?: boolean;
  status: 'success' | 'failed' | 'timeout';
  errorCode?: string;
  errorMessage?: string;
  fallbackNotice?: string;
  isLocalFallback?: boolean;
  failedCloudAttempts?: Array<{
    provider: AiProviderId;
    modelUsed: string;
    errorCode?: string;
    errorMessage?: string;
    durationMs?: number;
  }>;
}

export interface ProviderStatusInfo {
  provider: AiProviderId;
  providerName: string;
  isConfigured: boolean;
  statusLabel: string;
  activeModel: string;
  costPerImageUsd: number;
  supportsInpainting: boolean;
  notes: string;
  defaultProviderId?: AiProviderId;
  defaultModelId?: string;
  autoFallbackToLocal?: boolean;
  availableProviders?: AiProviderCatalogItemDto[];
  modelRegistry?: AiModelRegistrySnapshotDto;
}

export interface AiDesignProvider {
  readonly providerId: AiProviderId;
  getStatusInfo(): ProviderStatusInfo;
  generatePerspectiveDraft(input: PerspectiveGenerationInput): Promise<ProviderGenerationResult>;
  generateBannerDraft(input: BannerGenerationInput): Promise<ProviderGenerationResult>;
}

