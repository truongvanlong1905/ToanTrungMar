/**
 * Multi-AI Design Provider Factory & Dynamic Model Registry
 * Supports switching between multiple AI providers & models at runtime:
 * - Google Imagen 3 & Gemini Image (`google_imagen`)
 * - OpenAI GPT-Image-1 & DALL-E 3 (`openai_dalle`)
 * - Black Forest Labs FLUX.1 Pro / Dev (`flux_bfl`)
 * - Stability AI Stable Diffusion 3.5 / SDXL (`stability_ai`)
 * - Custom AI Gateway / OpenRouter / ComfyUI (`custom_endpoint`)
 * - Toàn Trung Studio Smart Engine v3 (`local_sandbox`)
 */

import fs from 'node:fs';
import path from 'node:path';
import type {
  AiModelOptionDto,
  AiModelRegistrySnapshotDto,
  AiProviderCatalogItemDto,
  AiProviderId,
  ConfigureAiProvidersDto,
  DesignTaskCode,
} from '@toantrung/contracts';
import { bumpDomainRevisions } from '../../../core/cache/server-data-cache';
import { APP_CONFIG } from '../../../core/config';
import { decryptSecret, encryptSecret } from '../../../core/security/vault';
import { GoogleImagenProvider } from './google-imagen.provider';
import { OpenAiImageProvider } from './openai-image.provider';
import { UniversalCloudAiProvider } from './universal-cloud.provider';
import { LocalSandboxAiProvider } from './local-sandbox.provider';
import {
  AiModelRegistryService,
  classifyUpstreamAiHttpError,
  maskSecretValue,
  resolveEffectiveProviderCredential,
  validateSafeHttpUrl,
} from './model-registry.service';
import {
  type AiDesignProvider,
  type BannerGenerationInput,
  type PerspectiveGenerationInput,
  type ProviderGenerationResult,
  type ProviderStatusInfo,
} from './types';
import { validateGeneratedImageBuffer } from '../perspective-compositor';

interface StoredProviderEntry {
  apiKey?: string | null;
  apiEndpoint?: string | null;
  activeModel?: string | null;
  discoveredModels?: AiModelOptionDto[];
}

function mergeProviderModels(
  discovered: AiModelOptionDto[] | undefined,
  defaults: AiModelOptionDto[]
): AiModelOptionDto[] {
  // When live-probed usable models have been discovered for this API key, return ONLY those verified working models!
  if (discovered && discovered.length > 0) {
    return discovered;
  }
  return defaults;
}

interface StoredMultiAiConfig {
  defaultProviderId: AiProviderId;
  defaultModelId?: string;
  autoFallbackToLocal: boolean;
  savedGateways?: string[];
  providers: Partial<Record<AiProviderId, StoredProviderEntry>>;
}

const DEFAULT_MULTI_AI_CONFIG: StoredMultiAiConfig = {
  defaultProviderId: 'google_imagen',
  defaultModelId: 'imagen-3.0-generate-002',
  autoFallbackToLocal: true,
  savedGateways: [],
  providers: {},
};

const globalForMultiAiConfig = globalThis as unknown as {
  __toantrungMultiAiConfigCache?: {
    filePath: string;
    mtimeMs: number;
    config: StoredMultiAiConfig;
  } | null;
};

function getConfigFilePath(): string {
  const dir = path.join(APP_CONFIG.getStorageRoot(), 'config');
  return path.join(dir, 'multi-ai-providers.json');
}

function decryptStoredProviders(
  providers: Partial<Record<AiProviderId, StoredProviderEntry>> | undefined,
): Partial<Record<AiProviderId, StoredProviderEntry>> {
  const out: Partial<Record<AiProviderId, StoredProviderEntry>> = {};
  if (!providers || typeof providers !== 'object') return out;
  for (const [k, entry] of Object.entries(providers)) {
    if (!entry) continue;
    const decryptedKey = entry.apiKey ? decryptSecret(entry.apiKey) || entry.apiKey : entry.apiKey;
    out[k as AiProviderId] = {
      ...entry,
      ...(decryptedKey ? { apiKey: decryptedKey } : {}),
    };
  }
  return out;
}

function encryptStoredProviders(
  providers: Partial<Record<AiProviderId, StoredProviderEntry>> | undefined,
): Partial<Record<AiProviderId, StoredProviderEntry>> {
  const out: Partial<Record<AiProviderId, StoredProviderEntry>> = {};
  if (!providers || typeof providers !== 'object') return out;
  for (const [k, entry] of Object.entries(providers)) {
    if (!entry) continue;
    const rawKey = (entry.apiKey || '').trim();
    out[k as AiProviderId] = {
      ...entry,
      ...(rawKey ? { apiKey: encryptSecret(rawKey) } : {}),
    };
  }
  return out;
}

function readStoredConfig(): StoredMultiAiConfig {
  try {
    const file = getConfigFilePath();
    if (!fs.existsSync(file)) {
      return { ...DEFAULT_MULTI_AI_CONFIG, providers: {} };
    }
    const stat = fs.statSync(file);
    const cached = globalForMultiAiConfig.__toantrungMultiAiConfigCache;
    if (cached && cached.filePath === file && cached.mtimeMs === stat.mtimeMs) {
      return cached.config;
    }
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<StoredMultiAiConfig>;
    const normalized: StoredMultiAiConfig = {
      defaultProviderId: parsed.defaultProviderId || 'google_imagen',
      defaultModelId: parsed.defaultModelId || 'imagen-3.0-generate-002',
      autoFallbackToLocal: parsed.autoFallbackToLocal ?? true,
      savedGateways: Array.isArray(parsed.savedGateways)
        ? parsed.savedGateways.filter((u): u is string => typeof u === 'string' && u.trim().length > 0).slice(0, 10)
        : [],
      providers: decryptStoredProviders(parsed.providers),
    };
    globalForMultiAiConfig.__toantrungMultiAiConfigCache = {
      filePath: file,
      mtimeMs: stat.mtimeMs,
      config: normalized,
    };
    return normalized;
  } catch {
    return { ...DEFAULT_MULTI_AI_CONFIG, providers: {} };
  }
}

function writeStoredConfig(config: StoredMultiAiConfig): void {
  try {
    const file = getConfigFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const encryptedDiskPayload: StoredMultiAiConfig = {
      ...config,
      providers: encryptStoredProviders(config.providers),
    };
    fs.writeFileSync(file, JSON.stringify(encryptedDiskPayload, null, 2), 'utf-8');
    const stat = fs.statSync(file);
    globalForMultiAiConfig.__toantrungMultiAiConfigCache = {
      filePath: file,
      mtimeMs: stat.mtimeMs,
      config,
    };
    bumpDomainRevisions(['design'], 'ai_provider_config_saved');
  } catch {
    // Ignore write failure in read-only test environments
  }
}

export function migrateStoredAiKeysToVault(): {
  migratedCount: number;
  alreadyEncryptedCount: number;
} {
  const file = getConfigFilePath();
  if (!fs.existsSync(file)) {
    return { migratedCount: 0, alreadyEncryptedCount: 0 };
  }
  const rawParsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<StoredMultiAiConfig>;
  let migratedCount = 0;
  let alreadyEncryptedCount = 0;
  for (const entry of Object.values(rawParsed.providers || {})) {
    const k = (entry?.apiKey || '').trim();
    if (!k) continue;
    if (k.startsWith('vault$v1$')) alreadyEncryptedCount += 1;
    else migratedCount += 1;
  }
  if (migratedCount > 0) {
    const normalized = readStoredConfig();
    writeStoredConfig(normalized);
  }
  return { migratedCount, alreadyEncryptedCount };
}

function maskKey(key: string | null | undefined): string | null {
  if (!key || key.trim().length < 4) return null;
  const trimmed = key.trim();
  if (trimmed.length <= 8) return `${trimmed.slice(0, 2)}••••${trimmed.slice(-2)}`;
  return `${trimmed.slice(0, 4)}••••••••${trimmed.slice(-4)}`;
}

export class AiDesignProviderFactory {
  static getCatalog(): {
    config: StoredMultiAiConfig;
    catalog: AiProviderCatalogItemDto[];
  } {
    const config = readStoredConfig();

    const googleKey =
      config.providers.google_imagen?.apiKey ||
      process.env.IMAGEN_API_KEY ||
      process.env.GEMINI_API_KEY ||
      null;
    const openAiKey =
      config.providers.openai_dalle?.apiKey || process.env.OPENAI_API_KEY || null;
    const fluxKey =
      config.providers.flux_bfl?.apiKey ||
      process.env.FLUX_API_KEY ||
      process.env.BFL_API_KEY ||
      null;
    const stabilityKey =
      config.providers.stability_ai?.apiKey || process.env.STABILITY_API_KEY || null;
    const customKey =
      config.providers.custom_endpoint?.apiKey || process.env.CUSTOM_AI_API_KEY || null;

    const catalog: AiProviderCatalogItemDto[] = [
      {
        providerId: 'google_imagen',
        providerName: 'Google Imagen 3 & Gemini Image',
        shortName: 'Google Imagen 3',
        isConfigured: Boolean(googleKey || process.env.GOOGLE_CLOUD_PROJECT),
        isDefault: config.defaultProviderId === 'google_imagen',
        activeModel:
          config.providers.google_imagen?.activeModel || 'imagen-3.0-generate-002',
        apiEndpoint:
          config.providers.google_imagen?.apiEndpoint ||
          process.env.VERTEX_AI_ENDPOINT ||
          'https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict',
        hasApiKey: Boolean(googleKey),
        maskedApiKey: maskKey(googleKey),
        statusLabel: googleKey
          ? 'Đã kết nối API Key'
          : config.autoFallbackToLocal
            ? 'Sẵn sàng (Tự động kết xuất qua Studio Engine khi chưa nhập Key)'
            : 'Chưa cấu hình IMAGEN_API_KEY',
        notes:
          'Chuyên dụng dựng phối cảnh 3D màn hình LED giữ nguyên kiến trúc phòng họp, hội trường & mặt tiền tòa nhà.',
        models: mergeProviderModels(config.providers.google_imagen?.discoveredModels, [
          {
            id: 'gemini-2.5-flash-image',
            name: 'Gemini 2.5 Flash Image',
            badge: 'New',
            costPerImageUsd: 0.02,
            supportsInpainting: true,
            description: 'Nhận diện đồng thời ảnh công trình + ảnh sản phẩm mẫu để ghép phối cảnh và tạo Banner.',
          },
          {
            id: 'imagen-3.0-generate-002',
            name: 'Google Imagen 3',
            badge: 'Pro',
            costPerImageUsd: 0.03,
            supportsInpainting: true,
            description: 'Độ nét cao, giữ nguyên 100% nội thất phòng và ánh sáng phản chiếu sàn.',
          },
          {
            id: 'gemini-3.5-flash-lite',
            name: 'Gemini 3.5 Flash',
            badge: 'Fast',
            costPerImageUsd: 0.0,
            supportsInpainting: true,
            description: 'Tốc độ cao, phân tích ảnh công trình và trò chuyện tự nhiên ($0).',
          },
        ]),
      },
      {
        providerId: 'openai_dalle',
        providerName: 'OpenAI GPT 2.5 Image',
        shortName: 'OpenAI GPT 2.5 Image',
        isConfigured: Boolean(openAiKey),
        isDefault: config.defaultProviderId === 'openai_dalle',
        activeModel: config.providers.openai_dalle?.activeModel || 'gpt-2.5-image',
        apiEndpoint:
          config.providers.openai_dalle?.apiEndpoint ||
          'https://api.openai.com/v1/images/generations',
        hasApiKey: Boolean(openAiKey),
        maskedApiKey: maskKey(openAiKey),
        statusLabel: openAiKey
          ? 'Đã kết nối API Key'
          : config.autoFallbackToLocal
            ? 'Sẵn sàng (Tự động kết xuất qua Studio Engine khi chưa nhập Key)'
            : 'Chưa cấu hình OPENAI_API_KEY',
        notes:
          'Hỗ trợ ghép ảnh sản phẩm công ty vào ảnh hiện trường (Multi-Image Edit), thiết kế Banner có sản phẩm và hiển thị chữ sắc nét.',
        models: mergeProviderModels(config.providers.openai_dalle?.discoveredModels, [
          {
            id: 'gpt-2.5-image',
            name: 'GPT 2.5 Image',
            badge: 'New',
            costPerImageUsd: 0.04,
            supportsInpainting: true,
            description: 'Hỗ trợ nhận nhiều ảnh đầu vào (ảnh công trình + ảnh sản phẩm mẫu) để ghép phối cảnh & thiết kế Banner.',
          },
          {
            id: 'gpt-image-1',
            name: 'GPT-Image 1',
            badge: 'Standard',
            costPerImageUsd: 0.04,
            supportsInpainting: true,
            description: 'Hiển thị chữ tiếng Việt/Anh trên Banner và ghép vùng chọn chính xác.',
          },
        ]),
      },
      {
        providerId: 'flux_bfl',
        providerName: 'Black Forest Labs FLUX.1 Pro',
        shortName: 'FLUX.1 Pro',
        isConfigured: Boolean(fluxKey),
        isDefault: config.defaultProviderId === 'flux_bfl',
        activeModel: config.providers.flux_bfl?.activeModel || 'flux-1.1-pro-ultra',
        apiEndpoint:
          config.providers.flux_bfl?.apiEndpoint ||
          'https://api.bfl.ml/v1/flux-pro-1.1-ultra',
        hasApiKey: Boolean(fluxKey),
        maskedApiKey: maskKey(fluxKey),
        statusLabel: fluxKey
          ? 'Đã kết nối API Key'
          : config.autoFallbackToLocal
            ? 'Sẵn sàng (Tự động kết xuất qua Studio Engine khi chưa nhập Key)'
            : 'Chưa cấu hình FLUX_API_KEY',
        notes:
          'Chuyên gia kết xuất ánh sáng kiến trúc nội thất & mặt tiền tòa nhà siêu thực (Photorealistic 4K).',
        models: mergeProviderModels(config.providers.flux_bfl?.discoveredModels, [
          {
            id: 'flux-1.1-pro-ultra',
            name: 'FLUX 1.1 Pro Ultra 4K',
            badge: 'Siêu thực 4K',
            costPerImageUsd: 0.035,
            supportsInpainting: true,
            description: 'Chất lượng ánh sáng LED và vật liệu kiến trúc chân thực bậc nhất.',
          },
          {
            id: 'flux-1-fill-pro',
            name: 'FLUX.1 Fill Pro (Inpainting)',
            badge: 'Ghép vách tường',
            costPerImageUsd: 0.03,
            supportsInpainting: true,
            description: 'Chuyên ghép màn hình LED vào đúng khung vách tường hiện trạng.',
          },
        ]),
      },
      {
        providerId: 'stability_ai',
        providerName: 'Stability AI (SD 3.5 & SDXL)',
        shortName: 'Stability SD 3.5',
        isConfigured: Boolean(stabilityKey),
        isDefault: config.defaultProviderId === 'stability_ai',
        activeModel: config.providers.stability_ai?.activeModel || 'sd3.5-large',
        apiEndpoint:
          config.providers.stability_ai?.apiEndpoint ||
          'https://api.stability.ai/v2beta/stable-image/generate/sd3',
        hasApiKey: Boolean(stabilityKey),
        maskedApiKey: maskKey(stabilityKey),
        statusLabel: stabilityKey
          ? 'Đã kết nối API Key'
          : config.autoFallbackToLocal
            ? 'Sẵn sàng (Tự động kết xuất qua Studio Engine khi chưa nhập Key)'
            : 'Chưa cấu hình STABILITY_API_KEY',
        notes:
          'Phù hợp dựng phối cảnh công trình ngoài trời, bảng điện tử nhà máy và điều khiển ControlNet.',
        models: mergeProviderModels(config.providers.stability_ai?.discoveredModels, [
          {
            id: 'sd3.5-large',
            name: 'Stable Diffusion 3.5 Large',
            badge: 'Chuẩn kiến trúc',
            costPerImageUsd: 0.03,
            supportsInpainting: true,
            description: 'Kiểm soát tốt tỷ lệ khung hình rộng 21:9, 32:9 cho màn hình LED dài.',
          },
          {
            id: 'sdxl-inpaint-v1',
            name: 'SDXL Inpainting 1.0',
            badge: 'Nhanh & nhẹ',
            costPerImageUsd: 0.015,
            supportsInpainting: true,
            description: 'Ghép nhanh màn hình LED vào ảnh chụp khảo sát công trình.',
          },
        ]),
      },
      {
        providerId: 'custom_endpoint',
        providerName: 'Custom AI Gateway / OpenRouter / ComfyUI',
        shortName: 'Custom AI API',
        isConfigured: Boolean(customKey || config.providers.custom_endpoint?.apiEndpoint),
        isDefault: config.defaultProviderId === 'custom_endpoint',
        activeModel:
          config.providers.custom_endpoint?.activeModel || 'custom-led-diffusion-v1',
        apiEndpoint:
          config.providers.custom_endpoint?.apiEndpoint ||
          'https://openrouter.ai/api/v1/images/generations',
        hasApiKey: Boolean(customKey),
        maskedApiKey: maskKey(customKey),
        statusLabel: customKey
          ? 'Đã kết nối Custom Endpoint'
          : 'Mở rộng linh hoạt (Hỗ trợ mọi API chuẩn OpenAI / ComfyUI)',
        notes:
          'Cho phép đấu nối bất kỳ con AI mới nào trong tương lai (OpenRouter, Replicate, fal.ai, máy chủ GPU nội bộ ComfyUI) chỉ bằng URL & Key.',
        models: mergeProviderModels(config.providers.custom_endpoint?.discoveredModels, [
          {
            id: config.providers.custom_endpoint?.activeModel || 'custom-led-diffusion-v1',
            name: `Model tùy chỉnh (${config.providers.custom_endpoint?.activeModel || 'custom-led-diffusion-v1'})`,
            badge: 'Tùy biến 100%',
            costPerImageUsd: 0.02,
            supportsInpainting: true,
            description: 'Gọi trực tiếp tới Endpoint tùy chỉnh do doanh nghiệp cấu hình.',
          },
        ]),
      },
      {
        providerId: 'local_sandbox',
        providerName: 'Toàn Trung Studio Engine v3 (Nội bộ)',
        shortName: 'Toàn Trung Studio v3',
        isConfigured: true,
        isDefault: config.defaultProviderId === 'local_sandbox',
        activeModel: config.providers.local_sandbox?.activeModel || 'toantrung-studio-v3',
        hasApiKey: true,
        maskedApiKey: 'BUILT-IN-READY',
        statusLabel: 'Sẵn sàng 100% · Không cần API Key',
        notes:
          'Engine dựng phối cảnh 3D & ghép khung LED trực tiếp của Toàn Trung: hoạt động tức thì 24/7, không tốn phí API và bảo mật tuyệt đối.',
        models: [
          {
            id: 'toantrung-studio-v3',
            name: 'Toàn Trung Studio Compositor v3',
            badge: 'Miễn phí & Tức thì',
            costPerImageUsd: 0.0,
            supportsInpainting: true,
            description: 'Kết xuất ngay bản nháp phối cảnh LED & Banner chuẩn kỹ thuật Toàn Trung.',
          },
        ],
      },
    ];

    return { config, catalog };
  }

  static getProvider(
    requestedProviderId?: AiProviderId,
    requestedModelId?: string
  ): AiDesignProvider {
    const { config, catalog } = this.getCatalog();
    const targetProviderId: AiProviderId =
      requestedProviderId || config.defaultProviderId || 'google_imagen';
    const catEntry = catalog.find((c) => c.providerId === targetProviderId);
    const activeModel =
      requestedModelId ||
      catEntry?.activeModel ||
      config.defaultModelId ||
      'imagen-3.0-generate-002';

    if (targetProviderId === 'google_imagen') {
      return new GoogleImagenProvider({
        apiKey: config.providers.google_imagen?.apiKey,
        apiEndpoint: config.providers.google_imagen?.apiEndpoint,
        activeModel,
      });
    }

    if (targetProviderId === 'openai_dalle') {
      return new OpenAiImageProvider({
        apiKey: config.providers.openai_dalle?.apiKey,
        apiEndpoint: config.providers.openai_dalle?.apiEndpoint,
        activeModel,
      });
    }

    if (
      targetProviderId === 'flux_bfl' ||
      targetProviderId === 'stability_ai' ||
      targetProviderId === 'custom_endpoint'
    ) {
      const stored = config.providers[targetProviderId];
      const envKey =
        targetProviderId === 'flux_bfl'
          ? process.env.FLUX_API_KEY || process.env.BFL_API_KEY
          : targetProviderId === 'stability_ai'
            ? process.env.STABILITY_API_KEY
            : process.env.CUSTOM_AI_API_KEY;

      return new UniversalCloudAiProvider({
        providerId: targetProviderId,
        providerName: catEntry?.providerName || targetProviderId,
        apiKey: stored?.apiKey || envKey || null,
        apiEndpoint: stored?.apiEndpoint || catEntry?.apiEndpoint,
        activeModel,
        costPerImageUsd: catEntry?.models[0]?.costPerImageUsd ?? 0.03,
        notes: catEntry?.notes || '',
      });
    }

    return new LocalSandboxAiProvider(activeModel);
  }

  /**
   * Checks whether a model ID belongs to the CHAT MODEL group (text/vision consultation only)
   * rather than an IMAGE MODEL capable of binary image generation.
   */
  static isChatOnlyModel(modelId?: string | null): boolean {
    if (!modelId) return false;
    const clean = modelId.trim().toLowerCase();
    if (
      clean.includes('image') ||
      clean.includes('imagen') ||
      clean.includes('banana') ||
      clean.includes('dall-e') ||
      clean.includes('flux') ||
      clean.includes('sd3') ||
      clean.includes('sdxl') ||
      clean.includes('diffusion') ||
      clean === 'toantrung-studio-v3'
    ) {
      return false;
    }
    if (
      clean === 'toantrung-rules-v3' ||
      /^gemini-(?:1\.5|2\.0|2\.5|3(?:\.\d+)?)/.test(clean) ||
      clean.startsWith('gemini-flash') ||
      clean.startsWith('gemma-') ||
      clean.startsWith('gpt-4') ||
      clean.startsWith('gpt-5') ||
      clean.startsWith('gpt-6') ||
      clean.startsWith('gpt-3.5') ||
      /^o[134](?:-|$)/.test(clean) ||
      clean.startsWith('codex') ||
      clean.startsWith('deepseek') ||
      clean.startsWith('llama-') ||
      clean.startsWith('claude-')
    ) {
      return true;
    }
    return false;
  }

  static async executePerspectiveWithFallback(
    input: PerspectiveGenerationInput,
    requestedProviderId?: AiProviderId
  ): Promise<ProviderGenerationResult> {
    const { config } = this.getCatalog();
    const targetProviderId = requestedProviderId || config.defaultProviderId || 'google_imagen';
    const allowFallback = !input.disableLocalFallback && config.autoFallbackToLocal;

    if (this.isChatOnlyModel(input.modelId)) {
      return {
        imageBuffer: Buffer.alloc(0),
        mimeType: 'image/png',
        durationMs: 0,
        modelUsed: input.modelId || 'chat-model',
        requestedModel: input.modelId || 'chat-model',
        provider: targetProviderId,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        tokensActual: false,
        costState: 'unknown',
        costMicros: 0n,
        costCurrency: 'USD',
        status: 'failed',
        errorCode: 'CHAT_MODEL_NO_IMAGE_OUTPUT',
        errorMessage: `Model "${input.modelId}" thuộc nhóm CHAT/VISION (chỉ phân tích văn bản/ảnh, không xuất file ảnh). Vui lòng chọn IMAGE MODEL cho tác vụ Dựng phối cảnh.`,
      };
    }

    const provider = this.getProvider(targetProviderId, input.modelId);
    const activeModelUsed = input.modelId || provider.getStatusInfo().activeModel;

    if (input.simulateTimeout) {
      return provider.generatePerspectiveDraft(input);
    }

    const res = await provider.generatePerspectiveDraft(input);
    if (res.status === 'success') {
      const check = validateGeneratedImageBuffer(res.imageBuffer);
      if (check.isValid) {
        if (targetProviderId !== 'local_sandbox') {
          AiModelRegistryService.recordModelRuntimeObservation({
            providerId: targetProviderId,
            modelId: res.modelUsed || activeModelUsed,
            taskCode: 'perspective_compose',
            taskStatus: 'verified',
            statusDetail: `Xác nhận thực thi perspective_compose thành công (${res.durationMs}ms).`,
            reportedAliasWarning: res.reportedModelNote || null,
          });
        }
        return res;
      }
      res.status = 'failed';
      res.errorCode = check.errorCode || 'INVALID_IMAGE_BINARY';
      res.errorMessage =
        check.errorMessage || 'Provider chỉ trả về văn bản hoặc thiếu dữ liệu ảnh hợp lệ.';
    }

    if (targetProviderId !== 'local_sandbox' && res.errorMessage) {
      const httpMatch = res.errorMessage.match(/\[(\d{3})\]/);
      const statusNum = httpMatch ? Number(httpMatch[1]) : 500;
      const c = classifyUpstreamAiHttpError(statusNum, res.errorMessage);
      AiModelRegistryService.recordModelRuntimeObservation({
        providerId: targetProviderId,
        modelId: res.modelUsed || activeModelUsed,
        taskCode: 'perspective_compose',
        taskStatus: c.statusKind,
        statusDetail: c.shortReason,
      });
    }

    if (allowFallback && targetProviderId !== 'local_sandbox' && !input.requireReferenceEdit) {
      const failedCloudAttempts: NonNullable<ProviderGenerationResult['failedCloudAttempts']> = [
        {
          provider: targetProviderId,
          modelUsed: res.modelUsed || input.modelId || provider.getStatusInfo().activeModel,
          errorCode: res.errorCode,
          errorMessage: res.errorMessage,
          durationMs: res.durationMs,
        },
      ];

      // Step 1: If caller allowed fallback & primary cloud failed, do NOT guess arbitrary unconfigured custom gateway; drop cleanly to transparent Local Studio Engine
      const fallback = new LocalSandboxAiProvider('toantrung-studio-v3');
      const fallbackRes = await fallback.generatePerspectiveDraft(input);
      const reasonBrief = res.errorCode || res.errorMessage || 'Cloud AI tạm thời không phản hồi';
      return {
        ...fallbackRes,
        provider: 'local_sandbox',
        modelUsed: 'toantrung-studio-v3',
        requestedModel: input.modelId || activeModelUsed,
        reportedModel: 'toantrung-studio-v3',
        costState: 'actual',
        isLocalFallback: true,
        failedCloudAttempts,
        fallbackNotice: `Cloud AI (${targetProviderId}: ${reasonBrief}) không thể sinh ảnh; đã dựng bản phối cảnh kỹ thuật nội bộ (Studio Engine toantrung-studio-v3), không phải ảnh từ Cloud AI.`,
      };
    }

    return res;
  }

  static async executeBannerWithFallback(
    input: BannerGenerationInput,
    requestedProviderId?: AiProviderId
  ): Promise<ProviderGenerationResult> {
    const { config } = this.getCatalog();
    const targetProviderId = requestedProviderId || config.defaultProviderId || 'google_imagen';
    // Strict anti-gradient rule: never silently replace a failed Cloud Banner/Product-Banner with LocalSandbox synthetic gradient.
    // Users must explicitly choose `local_sandbox` if they want local template rendering.
    const allowFallback = false;
    const taskCode: DesignTaskCode = input.requireReferenceEdit ? 'design_edit' : 'banner_generate';

    if (this.isChatOnlyModel(input.modelId)) {
      return {
        imageBuffer: Buffer.alloc(0),
        mimeType: 'image/png',
        durationMs: 0,
        modelUsed: input.modelId || 'chat-model',
        requestedModel: input.modelId || 'chat-model',
        provider: targetProviderId,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        tokensActual: false,
        costState: 'unknown',
        costMicros: 0n,
        costCurrency: 'USD',
        status: 'failed',
        errorCode: 'CHAT_MODEL_NO_IMAGE_OUTPUT',
        errorMessage: `Model "${input.modelId}" thuộc nhóm CHAT/VISION (chỉ tư vấn văn bản/phân tích ảnh, không hỗ trợ xuất file ảnh). Vui lòng chọn IMAGE MODEL cho tác vụ "${taskCode}".`,
      };
    }

    const provider = this.getProvider(targetProviderId, input.modelId);
    const activeModelUsed = input.modelId || provider.getStatusInfo().activeModel;

    if (input.simulateTimeout) {
      return provider.generateBannerDraft(input);
    }

    const res = await provider.generateBannerDraft(input);
    if (res.status === 'success') {
      const check = validateGeneratedImageBuffer(res.imageBuffer);
      if (check.isValid) {
        if (targetProviderId !== 'local_sandbox') {
          AiModelRegistryService.recordModelRuntimeObservation({
            providerId: targetProviderId,
            modelId: res.modelUsed || activeModelUsed,
            taskCode,
            taskStatus: 'verified',
            statusDetail: `Xác nhận thực thi ${taskCode} thành công (${res.durationMs}ms).`,
            reportedAliasWarning: res.reportedModelNote || null,
          });
        }
        return res;
      }
      res.status = 'failed';
      res.errorCode = check.errorCode || 'INVALID_IMAGE_BINARY';
      res.errorMessage =
        check.errorMessage || 'Provider chỉ trả về văn bản hoặc thiếu dữ liệu ảnh Banner hợp lệ.';
    }

    if (targetProviderId !== 'local_sandbox' && res.errorMessage) {
      const httpMatch = res.errorMessage.match(/\[(\d{3})\]/);
      const statusNum = httpMatch ? Number(httpMatch[1]) : 500;
      const c = classifyUpstreamAiHttpError(statusNum, res.errorMessage);
      AiModelRegistryService.recordModelRuntimeObservation({
        providerId: targetProviderId,
        modelId: res.modelUsed || activeModelUsed,
        taskCode,
        taskStatus: c.statusKind,
        statusDetail: c.shortReason,
      });
    }

    if (allowFallback && targetProviderId !== 'local_sandbox') {
      const failedCloudAttempts: NonNullable<ProviderGenerationResult['failedCloudAttempts']> = [
        {
          provider: targetProviderId,
          modelUsed: res.modelUsed || input.modelId || provider.getStatusInfo().activeModel,
          errorCode: res.errorCode,
          errorMessage: res.errorMessage,
          durationMs: res.durationMs,
        },
      ];

      const fallback = new LocalSandboxAiProvider('toantrung-studio-v3');
      const fallbackRes = await fallback.generateBannerDraft(input);
      const reasonBrief = res.errorCode || res.errorMessage || 'Cloud AI tạm thời không phản hồi';
      return {
        ...fallbackRes,
        provider: 'local_sandbox',
        modelUsed: 'toantrung-studio-v3',
        requestedModel: input.modelId || activeModelUsed,
        reportedModel: 'toantrung-studio-v3',
        costState: 'actual',
        isLocalFallback: true,
        failedCloudAttempts,
        fallbackNotice: `Cloud AI (${targetProviderId}: ${reasonBrief}) không thể sinh banner; đã dựng bản bố cục nội bộ (Studio Engine toantrung-studio-v3), không phải ảnh từ Cloud AI.`,
      };
    }

    return res;
  }

  static async getModelRegistry(
    forceRefresh = false,
    onlyProviderId?: AiProviderId
  ): Promise<AiModelRegistrySnapshotDto> {
    const config = readStoredConfig();
    return AiModelRegistryService.getModelRegistrySnapshot(config, {
      forceRefresh,
      onlyProviderId,
    });
  }

  static async probeModelCapability(
    providerId: AiProviderId,
    modelId: string,
    taskCode: DesignTaskCode
  ) {
    const config = readStoredConfig();
    return AiModelRegistryService.probeSelectedModelTask({
      stored: config,
      providerId,
      modelId,
      taskCode,
    });
  }

  static getActiveProviderInfo(): ProviderStatusInfo {
    const { config, catalog } = this.getCatalog();
    const activeCat =
      catalog.find((c) => c.providerId === config.defaultProviderId) || catalog[0];
    const isReady = activeCat.isConfigured || config.autoFallbackToLocal;

    return {
      provider: activeCat.providerId,
      providerName: activeCat.providerName,
      isConfigured: isReady,
      statusLabel: activeCat.isConfigured
        ? `${activeCat.shortName} · Đã kết nối Key`
        : config.autoFallbackToLocal
          ? `${activeCat.shortName} (Chế độ Studio Sẵn sàng)`
          : activeCat.statusLabel,
      activeModel: config.defaultModelId || activeCat.activeModel,
      costPerImageUsd: activeCat.models[0]?.costPerImageUsd ?? 0.03,
      supportsInpainting: true,
      notes: activeCat.notes,
      defaultProviderId: config.defaultProviderId,
      defaultModelId: config.defaultModelId || activeCat.activeModel,
      autoFallbackToLocal: config.autoFallbackToLocal,
      availableProviders: catalog,
    };
  }

  static updateConfiguration(input: ConfigureAiProvidersDto): ProviderStatusInfo {
    const current = readStoredConfig();
    current.defaultProviderId = input.defaultProviderId;
    if (input.defaultModelId) {
      current.defaultModelId = input.defaultModelId;
    }
    current.autoFallbackToLocal = input.autoFallbackToLocal ?? true;

    if (input.providerConfig) {
      const pid = input.providerConfig.providerId;
      const existingEntry = current.providers[pid] || {};
      const nextEntry: StoredProviderEntry = { ...existingEntry };

      if (input.providerConfig.apiKey !== undefined) {
        const trimmed = input.providerConfig.apiKey?.trim() || '';
        // Only overwrite if user typed a real key (not a masked placeholder)
        if (!trimmed.includes('••••')) {
          nextEntry.apiKey = trimmed || null;
        }
      }
      if (input.providerConfig.apiEndpoint !== undefined) {
        nextEntry.apiEndpoint = input.providerConfig.apiEndpoint?.trim() || null;
      }
      if (input.providerConfig.activeModel !== undefined) {
        nextEntry.activeModel = input.providerConfig.activeModel?.trim() || null;
        if (pid === current.defaultProviderId && nextEntry.activeModel) {
          current.defaultModelId = nextEntry.activeModel;
        }
      }
      current.providers[pid] = nextEntry;
    }

    writeStoredConfig(current);
    return this.getActiveProviderInfo();
  }

  static async testProviderConnection(input: {
    providerId?: AiProviderId;
    apiKey?: string | null;
    apiEndpoint?: string | null;
    modelId?: string | null;
  }): Promise<{
    ok: boolean;
    connected: boolean;
    providerId: AiProviderId;
    modelTested: string;
    latencyMs: number;
    replyText: string;
    maskedKey: string | null;
    discoveredModels?: AiModelOptionDto[];
    providerStatus?: ProviderStatusInfo;
  }> {
    const started = Date.now();
    const { config } = this.getCatalog();
    const pid: AiProviderId = input.providerId || config.defaultProviderId || 'google_imagen';

    if (pid === 'local_sandbox') {
      const localModels: AiModelOptionDto[] = [
        {
          id: 'toantrung-studio-v3',
          name: 'Toàn Trung Studio Compositor v3 (Nội bộ $0)',
          badge: 'Miễn phí & Tức thì',
          costPerImageUsd: 0,
          supportsInpainting: true,
          description: 'Kết xuất ngay bản nháp phối cảnh LED & Banner chuẩn kỹ thuật Toàn Trung.',
        },
        {
          id: 'toantrung-rules-v3',
          name: 'Toàn Trung AI Nội bộ (Chat & Bóc tách BOM $0)',
          badge: 'Chat & Vision ($0)',
          costPerImageUsd: 0,
          supportsInpainting: true,
          description: 'Trợ lý kỹ thuật nội bộ không cần mạng hay API Key.',
        },
      ];
      return {
        ok: true,
        connected: true,
        providerId: 'local_sandbox',
        modelTested: input.modelId || 'toantrung-studio-v3',
        latencyMs: 12,
        replyText:
          'Toàn Trung Studio Engine v3 (Nội bộ) đang hoạt động 100% — sẵn sàng dựng phối cảnh 3D LED & xuất bản vẽ Cabin BOM tức thì!',
        maskedKey: 'BUILT-IN-READY',
        discoveredModels: localModels,
        providerStatus: this.getActiveProviderInfo(),
      };
    }

    const rawInputKey = input.apiKey?.trim() || '';
    const explicitPid: AiProviderId = pid;
    const storedEntry = config.providers[explicitPid];
    const effectiveKey =
      rawInputKey && !rawInputKey.includes('••••')
        ? rawInputKey
        : storedEntry?.apiKey || resolveEffectiveProviderCredential(explicitPid, config).apiKey || '';

    if (!effectiveKey) {
      return {
        ok: false,
        connected: false,
        providerId: explicitPid,
        modelTested: input.modelId || 'none',
        latencyMs: Date.now() - started,
        replyText:
          'Chưa có API Key để tự động đọc danh sách Model. Hãy dán mã API Key vào ô bên trên rồi bấm Kết nối & Tự đọc Model.',
        maskedKey: null,
      };
    }

    const rawInputEndpoint = input.apiEndpoint?.trim() || '';
    const normalizeCandidateUrl = (u: string): string =>
      u
        .trim()
        .replace(/\.+$/, '')
        .replace(/\/(images\/generations|images\/edits|chat\/completions|models(?:\/.*)?|predict|generateContent)\/?$/i, '')
        .replace(/\/+$/, '');

    interface DiscoveryCandidate {
      providerId: AiProviderId;
      endpoint: string;
      label: string;
    }

    const candidates: DiscoveryCandidate[] = [];
    const seenEndpoints = new Set<string>();
    const pushCandidate = (providerId: AiProviderId, endpoint: string, label: string) => {
      const clean = normalizeCandidateUrl(endpoint);
      if (!clean) return;
      const dedupeKey = `${providerId}::${clean.toLowerCase()}`;
      if (seenEndpoints.has(dedupeKey)) return;
      seenEndpoints.add(dedupeKey);
      candidates.push({ providerId, endpoint: clean, label });
    };

    if (rawInputEndpoint) {
      const safeCheck = validateSafeHttpUrl(rawInputEndpoint);
      if (!safeCheck.valid || !safeCheck.normalizedBaseUrl) {
        return {
          ok: false,
          connected: false,
          providerId: explicitPid,
          modelTested: input.modelId || 'none',
          latencyMs: Date.now() - started,
          replyText: safeCheck.error || 'Endpoint AI không hợp lệ.',
          maskedKey: maskSecretValue(effectiveKey),
        };
      }
      const normUrl = safeCheck.normalizedBaseUrl;
      const isGoogleHost = /generativelanguage\.googleapis\.com/i.test(normUrl);
      const isOpenAiOfficial = /^https:\/\/api\.openai\.com(\/|$)/i.test(normUrl);
      const targetPidForUrl: AiProviderId = isGoogleHost
        ? 'google_imagen'
        : isOpenAiOfficial
          ? 'openai_dalle'
          : 'custom_endpoint';
      pushCandidate(targetPidForUrl, normUrl, normUrl);
      // If user pasted bare proxy host without /v1 (e.g. https://proxy.example.com), auto-add /v1 fallback
      if (!isGoogleHost && !/\/v\d+(beta)?$/i.test(normUrl)) {
        pushCandidate(targetPidForUrl, `${normUrl}/v1`, `${normUrl}/v1`);
      }
    } else {
      // Zero-code-fix universal multi-provider auto-discovery based on key format + configured & saved gateways
      const configuredCustomEndpoint =
        config.providers.custom_endpoint?.apiEndpoint ||
        resolveEffectiveProviderCredential('custom_endpoint', config).apiEndpoint ||
        '';
      const savedGateways = config.savedGateways || [];

      if (effectiveKey.startsWith('AIza') || effectiveKey.startsWith('AQ.')) {
        pushCandidate('google_imagen', 'https://generativelanguage.googleapis.com/v1beta', 'Google Gemini/Imagen');
        if (configuredCustomEndpoint) {
          pushCandidate('custom_endpoint', configuredCustomEndpoint, 'Gateway đã cấu hình');
        }
      } else if (effectiveKey.startsWith('sk-or-')) {
        pushCandidate('custom_endpoint', 'https://openrouter.ai/api/v1', 'OpenRouter');
        if (configuredCustomEndpoint) {
          pushCandidate('custom_endpoint', configuredCustomEndpoint, 'Gateway đã cấu hình');
        }
      } else if (effectiveKey.startsWith('gsk_')) {
        pushCandidate('custom_endpoint', 'https://api.groq.com/openai/v1', 'Groq Cloud');
      } else if (effectiveKey.startsWith('xai-')) {
        pushCandidate('custom_endpoint', 'https://api.x.ai/v1', 'xAI Grok');
      } else if (effectiveKey.startsWith('sk-proj-') || effectiveKey.startsWith('sk-svcacct-')) {
        pushCandidate('openai_dalle', 'https://api.openai.com/v1', 'OpenAI Official');
        if (configuredCustomEndpoint) {
          pushCandidate('custom_endpoint', configuredCustomEndpoint, 'Gateway đã cấu hình');
        }
        for (const gw of savedGateways) {
          pushCandidate('custom_endpoint', gw, gw);
        }
      } else {
        // Generic key (sk-... / relay / custom): probe OpenAI + configured gateway + saved gateways + popular OpenAI-compatible clouds
        if (explicitPid === 'google_imagen') {
          pushCandidate('google_imagen', 'https://generativelanguage.googleapis.com/v1beta', 'Google Gemini/Imagen');
        }
        if (configuredCustomEndpoint) {
          pushCandidate('custom_endpoint', configuredCustomEndpoint, 'Gateway đã cấu hình');
        }
        pushCandidate('openai_dalle', 'https://api.openai.com/v1', 'OpenAI Official');
        for (const gw of savedGateways) {
          pushCandidate('custom_endpoint', gw, gw);
        }
        pushCandidate('custom_endpoint', 'https://openrouter.ai/api/v1', 'OpenRouter');
        pushCandidate('custom_endpoint', 'https://api.deepseek.com/v1', 'DeepSeek');
        pushCandidate('google_imagen', 'https://generativelanguage.googleapis.com/v1beta', 'Google Gemini/Imagen');
      }
    }

    let activePid: AiProviderId = candidates[0]?.providerId || explicitPid;
    let activeEndpoint = candidates[0]?.endpoint || '';
    let snapshot: AiModelRegistrySnapshotDto | null = null;
    let conn: AiModelRegistrySnapshotDto['connections'][number] | undefined;
    const probeFailures: string[] = [];

    // Probe candidates in parallel batches (max 6) so discovery finishes in ~400-800ms instead of sequential timeouts
    const probeResults = await Promise.all(
      candidates.slice(0, 6).map(async (cand) => {
        const candConfig: StoredMultiAiConfig = {
          ...config,
          providers: {
            ...config.providers,
            [cand.providerId]: {
              ...config.providers[cand.providerId],
              apiKey: effectiveKey,
              apiEndpoint: cand.endpoint,
            },
          },
        };
        const candSnap = await AiModelRegistryService.getModelRegistrySnapshot(candConfig, {
          forceRefresh: true,
          onlyProviderId: cand.providerId,
        });
        const candConn = candSnap.connections.find((c) => c.providerId === cand.providerId);
        return { cand, candSnap, candConn };
      }),
    );

    const winner = probeResults.find((r) => r.candConn && r.candConn.listApiStatus === 'ok');
    if (winner) {
      activePid = winner.cand.providerId;
      activeEndpoint = winner.cand.endpoint;
      snapshot = winner.candSnap;
      conn = winner.candConn;
    } else {
      const firstResult = probeResults[0];
      snapshot = firstResult?.candSnap || null;
      conn = firstResult?.candConn;
      for (const r of probeResults) {
        const shortErr = (r.candConn?.listApiDetail || 'Lỗi kết nối').replace(/\s+/g, ' ').slice(0, 85);
        probeFailures.push(`${r.cand.label}: ${shortErr}`);
      }
    }

    if (!snapshot || (conn && conn.listApiStatus === 'error')) {
      const triedSummary =
        !rawInputEndpoint && probeFailures.length > 1
          ? ` Đã tự động dò ${probeFailures.length} cổng (${probeFailures.slice(0, 3).join(' | ')}). Nếu Key thuộc Proxy/Relay riêng (OneAPI/NewAPI/...), hãy dán thêm Gateway URL (VD: https://.../v1) vào ô bên dưới — hệ thống sẽ tự ghi nhớ cổng này cho mọi lần đổi Key sau.`
          : '';
      return {
        ok: false,
        connected: false,
        providerId: activePid,
        modelTested: input.modelId || 'none',
        latencyMs: Date.now() - started,
        replyText: `${conn?.listApiDetail || 'Không thể kết nối API Key.'}${triedSummary}`,
        maskedKey: maskSecretValue(effectiveKey),
      };
    }

    const providerModels = snapshot.models.filter((m) => m.providerId === activePid);
    const discoveredModels: AiModelOptionDto[] = providerModels.slice(0, 30).map((m) => {
      const supportsImage =
        m.supportedOperations.includes('image_generation') ||
        m.supportedOperations.includes('image_editing_ref');
      return {
        id: m.modelId,
        name: m.displayName || m.modelId,
        badge: supportsImage ? '🎨 Tạo/Sửa ảnh' : '💬 Chat & Vision',
        costPerImageUsd: supportsImage ? 0.03 : 0.0,
        supportsInpainting: m.supportedOperations.includes('image_editing_ref'),
        description: m.statusDetail,
      };
    });

    const requestedClean = input.modelId?.replace(/^models\//, '').trim() || '';
    const chosenEntry =
      discoveredModels.find((v) => v.id === requestedClean) ||
      discoveredModels.find((v) => v.badge.includes('Tạo')) ||
      discoveredModels[0];
    const chosenModel = chosenEntry?.id || requestedClean || storedEntry?.activeModel || activePid;

    const currentCfg = readStoredConfig();
    const prevEntry = currentCfg.providers[activePid] || {};
    currentCfg.providers[activePid] = {
      ...prevEntry,
      apiKey: effectiveKey,
      ...(activeEndpoint ? { apiEndpoint: activeEndpoint } : {}),
      activeModel: chosenModel,
      ...(discoveredModels.length > 0 ? { discoveredModels } : {}),
    };
    if (
      activePid === 'custom_endpoint' &&
      activeEndpoint &&
      !/^https:\/\/(api\.openai\.com|generativelanguage\.googleapis\.com)/i.test(activeEndpoint)
    ) {
      const prevGateways = currentCfg.savedGateways || [];
      currentCfg.savedGateways = [
        activeEndpoint,
        ...prevGateways.filter((g) => g.toLowerCase() !== activeEndpoint.toLowerCase()),
      ].slice(0, 10);
    }
    currentCfg.defaultProviderId = activePid;
    currentCfg.defaultModelId = chosenModel;
    writeStoredConfig(currentCfg);

    const imgCount = providerModels.filter(
      (m) =>
        m.supportedOperations.includes('image_generation') ||
        m.supportedOperations.includes('image_editing_ref')
    ).length;
    const chatCount = providerModels.filter(
      (m) =>
        m.supportedOperations.includes('text_analysis') ||
        m.supportedOperations.includes('vision_understanding')
    ).length;

    return {
      ok: true,
      connected: true,
      providerId: activePid,
      modelTested: chosenModel,
      latencyMs: Date.now() - started,
      replyText:
        conn?.listApiStatus === 'ok'
          ? `Kết nối thành công ${conn.providerName} → Đọc được ${providerModels.length} model (${imgCount} tạo/sửa ảnh, ${chatCount} phân tích brief). Đã chọn: ${chosenModel}.`
          : `Đã lưu cấu hình ${activePid} (${maskSecretValue(effectiveKey)}). ${conn?.listApiDetail || ''}`,
      maskedKey: maskSecretValue(effectiveKey),
      discoveredModels: discoveredModels.length > 0 ? discoveredModels : undefined,
      providerStatus: this.getActiveProviderInfo(),
    };
  }
}

export * from './types';
export * from './google-imagen.provider';
export * from './openai-image.provider';
export * from './universal-cloud.provider';
export * from './local-sandbox.provider';
export * from './model-registry.service';
