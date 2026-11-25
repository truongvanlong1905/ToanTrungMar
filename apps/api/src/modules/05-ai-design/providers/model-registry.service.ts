/**
 * Server-Side AI Model Discovery & Capability Registry (MK03)
 * - Strictly separates connection discovery, model listing (paginated), capability classification,
 *   and single-model budget-guarded live probing.
 * - Never infers provider or capabilities from API key prefixes alone.
 * - Never exposes raw API keys/tokens to clients or disk cache.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AiCapabilityEvidence,
  AiConnectionKind,
  AiDiscoveredModelRegistryItemDto,
  AiModelOptionDto,
  AiModelRegistrySnapshotDto,
  AiProviderId,
  AiProviderRegistryConnectionDto,
  AiSupportedOperation,
  AiTaskValidationStatus,
  DesignTaskCode,
} from '@toantrung/contracts';
import { bumpDomainRevisions } from '../../../core/cache/server-data-cache';
import { APP_CONFIG } from '../../../core/config';

export interface StoredProviderCredentialEntry {
  apiKey?: string | null;
  apiEndpoint?: string | null;
  activeModel?: string | null;
  discoveredModels?: AiModelOptionDto[];
}

export interface StoredMultiAiConfigShape {
  defaultProviderId: AiProviderId;
  defaultModelId?: string;
  autoFallbackToLocal: boolean;
  providers: Partial<Record<AiProviderId, StoredProviderCredentialEntry>>;
}

interface PersistedRegistryCache {
  generatedAt: string;
  cacheTtlMinutes: number;
  credentialFingerprint: string;
  probeBudgetMaxUsd: number;
  probeBudgetSpentUsd: number;
  connections: AiProviderRegistryConnectionDto[];
  models: AiDiscoveredModelRegistryItemDto[];
}

const REGISTRY_CACHE_TTL_MINUTES = 30;
const DEFAULT_PROBE_BUDGET_MAX_USD = 0.08;
const MAX_PAGINATION_PAGES = 15;

export function maskSecretValue(key: string | null | undefined): string | null {
  if (!key || key.trim().length < 4) return null;
  const trimmed = key.trim();
  if (trimmed.length <= 8) return `${trimmed.slice(0, 2)}••••${trimmed.slice(-2)}`;
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

export function validateSafeHttpUrl(rawUrl: string): { valid: boolean; normalizedBaseUrl?: string; error?: string } {
  try {
    const u = new URL(rawUrl.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      return { valid: false, error: 'Endpoint chỉ hỗ trợ giao thức http/https.' };
    }
    const host = u.hostname.toLowerCase();
    const isPrivateOrLocal =
      host === 'localhost' ||
      host === '::1' ||
      host === '0.0.0.0' ||
      host.startsWith('127.') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.startsWith('169.254.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host.endsWith('.local') ||
      host.endsWith('.internal');

    if (isPrivateOrLocal) {
      return {
        valid: false,
        error: `Endpoint "${host}" trỏ tới địa chỉ nội bộ/metadata nên bị chặn theo chính sách SSRF.`,
      };
    }

    if (u.protocol === 'http:') {
      return { valid: false, error: 'Endpoint bên ngoài bắt buộc dùng HTTPS.' };
    }

    const cleanPath = u.pathname
      .replace(/\/+$/, '')
      .replace(/\/(images\/generations|images\/edits|chat\/completions|models(?:\/.*)?|predict|generateContent)$/i, '');
    return {
      valid: true,
      normalizedBaseUrl: `${u.origin}${cleanPath}`,
    };
  } catch {
    return { valid: false, error: 'URL endpoint không hợp lệ.' };
  }
}

export function normalizeOpenAiBaseUrl(rawEndpoint: string | null | undefined, defaultBaseUrl: string): string {
  const candidate = (rawEndpoint || '').trim() || defaultBaseUrl;
  const checked = validateSafeHttpUrl(candidate);
  if (!checked.valid || !checked.normalizedBaseUrl) {
    throw new Error(checked.error || 'Endpoint AI không hợp lệ.');
  }
  return checked.normalizedBaseUrl;
}

export function classifyUpstreamAiHttpError(
  status: number,
  responseBody: string
): {
  statusKind: AiTaskValidationStatus;
  shortReason: string;
} {
  const lower = (responseBody || '').toLowerCase();
  if (status === 401 || status === 403 || /invalid api key|unauthorized|permission denied|forbidden/.test(lower)) {
    return {
      statusKind: 'blocked_permission',
      shortReason: `Bị từ chối quyền / Key không hợp lệ (HTTP ${status}).`,
    };
  }
  if (
    status === 429 ||
    status === 402 ||
    /resource_exhausted|quota|insufficient_quota|billing|limit:\s*0|rate limit/.test(lower)
  ) {
    return {
      statusKind: 'blocked_quota_billing',
      shortReason: `Hết hạn mức / chưa bật Billing hoặc Free Tier limit 0 (HTTP ${status}).`,
    };
  }
  if (
    status === 404 ||
    /no longer available|deprecated|not found for api version|does not exist|model_not_found/.test(lower)
  ) {
    return {
      statusKind: 'deprecated',
      shortReason: `Model không tồn tại hoặc đã ngừng hỗ trợ (HTTP ${status}).`,
    };
  }
  if (
    status === 400 &&
    /unsupported|does not support|not supported|not a chat model|does not allow image/.test(lower)
  ) {
    return {
      statusKind: 'unsupported',
      shortReason: `Model không hỗ trợ tác vụ này (HTTP ${status}).`,
    };
  }
  return {
    statusKind: 'failed_error',
    shortReason: `Lỗi từ upstream (HTTP ${status}): ${responseBody.replace(/<[^>]+>/g, ' ').trim().slice(0, 140)}`,
  };
}

function getCacheFilePath(): string {
  const dir = path.join(APP_CONFIG.getStorageRoot(), 'config');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'ai-model-registry-cache.json');
}

export function resolveEffectiveProviderCredential(
  providerId: AiProviderId,
  stored: StoredMultiAiConfigShape
): {
  apiKey: string | null;
  apiEndpoint: string | null;
  activeModel: string | null;
} {
  const entry = stored.providers?.[providerId];
  switch (providerId) {
    case 'google_imagen':
      return {
        apiKey: entry?.apiKey || process.env.IMAGEN_API_KEY || process.env.GEMINI_API_KEY || null,
        apiEndpoint:
          entry?.apiEndpoint ||
          process.env.VERTEX_AI_ENDPOINT ||
          'https://generativelanguage.googleapis.com/v1beta',
        activeModel: entry?.activeModel || null,
      };
    case 'openai_dalle':
      return {
        apiKey: entry?.apiKey || process.env.OPENAI_API_KEY || null,
        apiEndpoint: entry?.apiEndpoint || 'https://api.openai.com/v1',
        activeModel: entry?.activeModel || null,
      };
    case 'flux_bfl':
      return {
        apiKey: entry?.apiKey || process.env.FLUX_API_KEY || process.env.BFL_API_KEY || null,
        apiEndpoint: entry?.apiEndpoint || 'https://api.bfl.ml/v1/flux-pro-1.1-ultra',
        activeModel: entry?.activeModel || 'flux-1.1-pro-ultra',
      };
    case 'stability_ai':
      return {
        apiKey: entry?.apiKey || process.env.STABILITY_API_KEY || null,
        apiEndpoint: entry?.apiEndpoint || 'https://api.stability.ai/v2beta/stable-image/generate/sd3',
        activeModel: entry?.activeModel || 'sd3.5-large',
      };
    case 'custom_endpoint':
      return {
        apiKey: entry?.apiKey || process.env.CUSTOM_AI_API_KEY || null,
        apiEndpoint: entry?.apiEndpoint || process.env.CUSTOM_AI_ENDPOINT || null,
        activeModel: entry?.activeModel || null,
      };
    case 'local_sandbox':
    default:
      return {
        apiKey: null,
        apiEndpoint: 'internal://toantrung-studio-v3',
        activeModel: 'toantrung-studio-v3',
      };
  }
}

function buildCredentialFingerprint(stored: StoredMultiAiConfigShape): string {
  const hash = crypto.createHash('sha256');
  const ids: AiProviderId[] = [
    'google_imagen',
    'openai_dalle',
    'flux_bfl',
    'stability_ai',
    'custom_endpoint',
    'local_sandbox',
  ];
  for (const id of ids) {
    const cred = resolveEffectiveProviderCredential(id, stored);
    hash.update(id);
    hash.update('|');
    hash.update(cred.apiEndpoint || '');
    hash.update('|');
    hash.update(cred.apiKey ? crypto.createHash('sha256').update(cred.apiKey).digest('hex').slice(0, 12) : 'none');
    hash.update('\n');
  }
  return hash.digest('hex').slice(0, 24);
}

function inferOperationsFromCatalogMetadata(
  providerId: AiProviderId,
  modelId: string,
  supportedMethods?: string[]
): {
  ops: AiSupportedOperation[];
  evidence: AiCapabilityEvidence;
  note: string;
} {
  const lower = modelId.toLowerCase();

  // Audio/embedding/video/moderation models do not belong in design generation tasks
  if (/embedding|whisper|tts|moderation|transcribe|realtime|veo|lyria|aqa|robotics|computer-use/.test(lower)) {
    return {
      ops: [],
      evidence: 'metadata',
      note: 'Model chuyên dụng audio/embedding/video, không hỗ trợ tác vụ thiết kế ảnh.',
    };
  }

  if (providerId === 'local_sandbox') {
    return {
      ops: ['image_generation', 'image_editing_ref', 'inpainting_mask'],
      evidence: 'documentation',
      note: 'Studio Engine nội bộ (Canvas/Sharp) dựng bố cục & phối cảnh khi cần chế độ cục bộ.',
    };
  }

  if (providerId === 'google_imagen') {
    if (lower.startsWith('imagen-')) {
      const supportsPredict = !supportedMethods || supportedMethods.includes('predict');
      return {
        ops: supportsPredict ? ['image_generation'] : [],
        evidence: supportedMethods ? 'metadata' : 'documentation',
        note: 'Google Imagen: chuyên sinh ảnh mới; không chạy text chat thông thường.',
      };
    }
    if (/gemini-.*-image|image-generation|banana/.test(lower)) {
      return {
        ops: ['text_analysis', 'vision_understanding', 'image_generation', 'image_editing_ref', 'multi_image_ref'],
        evidence: supportedMethods ? 'metadata' : 'documentation',
        note: 'Gemini Multimodal Image: sinh ảnh mới và chỉnh sửa kèm ảnh tham chiếu.',
      };
    }
    if (lower.includes('gemini') && (!supportedMethods || supportedMethods.includes('generateContent'))) {
      return {
        ops: ['text_analysis', 'vision_understanding'],
        evidence: supportedMethods ? 'metadata' : 'documentation',
        note: 'Model Gemini Text/Vision: chỉ phân tích ảnh & tư vấn brief, không xuất trực tiếp file ảnh.',
      };
    }
  }

  // OpenAI & OpenAI-compatible gateways (including APIVN, OpenRouter, OneAPI/NewAPI)
  if (/gpt-image|gpt-2\.5-image|gpt-4o-image/.test(lower)) {
    return {
      ops: ['image_generation', 'image_editing_ref', 'inpainting_mask', 'multi_image_ref', 'transparent_bg'],
      evidence: 'documentation',
      note: 'Hỗ trợ /images/generations và /images/edits kèm ảnh tham chiếu.',
    };
  }
  if (/gemini-.*-image|image-generation|banana/.test(lower)) {
    return {
      ops: ['text_analysis', 'vision_understanding', 'image_generation', 'image_editing_ref', 'multi_image_ref'],
      evidence: 'documentation',
      note: 'Gemini Multimodal Image qua Gateway: sinh ảnh mới và chỉnh sửa kèm ảnh tham chiếu.',
    };
  }
  if (lower.startsWith('imagen-') || /midjourney|ideogram|recraft/.test(lower)) {
    return {
      ops: ['image_generation', 'image_editing_ref'],
      evidence: 'documentation',
      note: 'Model chuyên sinh & thiết kế ảnh qua Gateway.',
    };
  }
  if (/dall-e-3/.test(lower)) {
    return {
      ops: ['image_generation'],
      evidence: 'documentation',
      note: 'Chỉ hỗ trợ sinh ảnh mới (/images/generations), không chỉnh sửa trực tiếp từ ảnh gốc.',
    };
  }
  if (/dall-e-2/.test(lower)) {
    return {
      ops: ['image_generation', 'image_editing_ref', 'inpainting_mask'],
      evidence: 'documentation',
      note: 'Hỗ trợ sinh ảnh & inpaint cơ bản.',
    };
  }
  if (/flux.*fill|inpaint|sdxl-inpaint/.test(lower)) {
    return {
      ops: ['image_editing_ref', 'inpainting_mask'],
      evidence: 'documentation',
      note: 'Chuyên dụng inpaint / ghép vùng lắp đặt.',
    };
  }
  if (/flux|sd3\.5|stable-diffusion|sdxl/.test(lower)) {
    return {
      ops: ['image_generation', 'image_editing_ref'],
      evidence: 'documentation',
      note: 'Model sinh ảnh kiến trúc / banner.',
    };
  }
  if (/^(gpt-4|gpt-5|gpt-6|o1|o3|o4|claude|gemini|deepseek|qwen|llama)/.test(lower)) {
    return {
      ops: ['text_analysis', 'vision_understanding'],
      evidence: 'documentation',
      note: 'Model chat/vision: dùng cho phân tích brief & ảnh, không tạo file ảnh trực tiếp.',
    };
  }

  return {
    ops: [],
    evidence: 'metadata',
    note: 'Chưa xác minh năng lực tạo ảnh/chat từ metadata catalog.',
  };
}

function buildInitialTaskStatuses(
  ops: AiSupportedOperation[],
  providerId: AiProviderId
): Record<DesignTaskCode, AiTaskValidationStatus> {
  if (providerId === 'local_sandbox') {
    return {
      banner_generate: 'verified',
      design_edit: 'unsupported',
      perspective_compose: 'verified',
      brief_analyze: 'unsupported',
    };
  }
  const hasImgGen = ops.includes('image_generation');
  const hasImgEdit = ops.includes('image_editing_ref');
  const hasBriefVision = ops.includes('text_analysis') || ops.includes('vision_understanding');

  return {
    banner_generate: hasImgGen ? 'listed_unverified' : 'unsupported',
    design_edit: hasImgEdit ? 'listed_unverified' : 'unsupported',
    perspective_compose: hasImgEdit || hasImgGen ? 'listed_unverified' : 'unsupported',
    brief_analyze: hasBriefVision ? 'listed_unverified' : 'unsupported',
  };
}

function recommendTasksForOperations(ops: AiSupportedOperation[]): DesignTaskCode[] {
  const list: DesignTaskCode[] = [];
  if (ops.includes('image_generation')) list.push('banner_generate');
  if (ops.includes('image_editing_ref')) {
    list.push('design_edit');
    list.push('perspective_compose');
  }
  if (ops.includes('text_analysis') || ops.includes('vision_understanding')) {
    list.push('brief_analyze');
  }
  return list;
}

const globalForModelRegistry = globalThis as unknown as {
  __toantrungModelRegistryMemCache?: {
    mtimeMs: number;
    size: number;
    data: PersistedRegistryCache;
  } | null;
  __toantrungModelRegistryRefreshInFlight?: Promise<AiModelRegistrySnapshotDto> | null;
};

export class AiModelRegistryService {
  private static readCache(): PersistedRegistryCache | null {
    try {
      const file = getCacheFilePath();
      if (!fs.existsSync(file)) {
        globalForModelRegistry.__toantrungModelRegistryMemCache = null;
        return null;
      }
      const stat = fs.statSync(file);
      const mem = globalForModelRegistry.__toantrungModelRegistryMemCache;
      if (mem && mem.mtimeMs === stat.mtimeMs && mem.size === stat.size) {
        return mem.data;
      }
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as PersistedRegistryCache;
      globalForModelRegistry.__toantrungModelRegistryMemCache = {
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        data: parsed,
      };
      return parsed;
    } catch {
      return null;
    }
  }

  private static writeCache(cache: PersistedRegistryCache): void {
    try {
      const file = getCacheFilePath();
      const raw = JSON.stringify(cache, null, 2);
      fs.writeFileSync(file, raw, 'utf-8');
      const stat = fs.statSync(file);
      globalForModelRegistry.__toantrungModelRegistryMemCache = {
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        data: cache,
      };
    } catch {
      // Ignore write failures in read-only sandboxes
    }
  }

  private static async discoverGoogleModels(
    apiKey: string,
    baseUrl: string,
    existingMap: Map<string, AiDiscoveredModelRegistryItemDto>
  ): Promise<{
    connection: AiProviderRegistryConnectionDto;
    models: AiDiscoveredModelRegistryItemDto[];
  }> {
    const cleanBase = baseUrl.replace(/\/models.*$/i, '').replace(/\/+$/, '');
    const checked = validateSafeHttpUrl(cleanBase);
    if (!checked.valid || !checked.normalizedBaseUrl) {
      return {
        connection: {
          providerId: 'google_imagen',
          providerName: 'Google Gemini & Imagen',
          connectionKind: 'direct_official',
          configuredEndpoint: cleanBase,
          hasCredential: true,
          maskedCredential: maskSecretValue(apiKey),
          listApiSupported: true,
          listApiStatus: 'error',
          listApiDetail: checked.error || 'Endpoint Google không hợp lệ.',
          discoveredModelCount: 0,
          lastDiscoveryAt: new Date().toISOString(),
          cacheExpiresAt: null,
        },
        models: [],
      };
    }

    const collected: Array<{
      name?: string;
      displayName?: string;
      description?: string;
      supportedGenerationMethods?: string[];
    }> = [];
    let pageToken: string | undefined;
    let pageCount = 0;

    try {
      do {
        pageCount += 1;
        const url = new URL(`${checked.normalizedBaseUrl}/models`);
        url.searchParams.set('pageSize', '100');
        url.searchParams.set('key', apiKey);
        if (pageToken) url.searchParams.set('pageToken', pageToken);

        const res = await fetch(url.toString(), {
          method: 'GET',
          signal: AbortSignal.timeout(12000),
        });
        if (!res.ok) {
          const errText = await res.text();
          const classified = classifyUpstreamAiHttpError(res.status, errText);
          return {
            connection: {
              providerId: 'google_imagen',
              providerName: 'Google Gemini & Imagen',
              connectionKind: 'direct_official',
              configuredEndpoint: `${checked.normalizedBaseUrl}/models`,
              hasCredential: true,
              maskedCredential: maskSecretValue(apiKey),
              listApiSupported: true,
              listApiStatus: 'error',
              listApiDetail: classified.shortReason,
              discoveredModelCount: 0,
              lastDiscoveryAt: new Date().toISOString(),
              cacheExpiresAt: null,
            },
            models: [],
          };
        }

        const json = (await res.json()) as {
          models?: Array<{
            name?: string;
            displayName?: string;
            description?: string;
            supportedGenerationMethods?: string[];
          }>;
          nextPageToken?: string;
        };
        if (Array.isArray(json.models)) {
          collected.push(...json.models);
        }
        pageToken = json.nextPageToken;
      } while (pageToken && pageCount < MAX_PAGINATION_PAGES);
    } catch (err) {
      return {
        connection: {
          providerId: 'google_imagen',
          providerName: 'Google Gemini & Imagen',
          connectionKind: 'direct_official',
          configuredEndpoint: `${checked.normalizedBaseUrl}/models`,
          hasCredential: true,
          maskedCredential: maskSecretValue(apiKey),
          listApiSupported: true,
          listApiStatus: 'error',
          listApiDetail: err instanceof Error ? err.message : 'Không kết nối được Google ListModels API.',
          discoveredModelCount: 0,
          lastDiscoveryAt: new Date().toISOString(),
          cacheExpiresAt: null,
        },
        models: [],
      };
    }

    const nowIso = new Date().toISOString();
    const models: AiDiscoveredModelRegistryItemDto[] = [];
    for (const raw of collected) {
      const modelId = (raw.name || '').replace(/^models\//, '').trim();
      if (!modelId) continue;
      const inferred = inferOperationsFromCatalogMetadata(
        'google_imagen',
        modelId,
        raw.supportedGenerationMethods
      );
      if (inferred.ops.length === 0) continue;

      const prev = existingMap.get(`google_imagen::${modelId}`);
      const initialStatuses = buildInitialTaskStatuses(inferred.ops, 'google_imagen');
      // Preserve live_probe statuses if already probed against upstream
      const mergedStatuses =
        prev?.capabilityEvidence === 'live_probe' ? { ...initialStatuses, ...prev.taskStatuses } : initialStatuses;

      models.push({
        modelId,
        displayName: (raw.displayName || modelId).trim(),
        providerId: 'google_imagen',
        connectionKind: 'direct_official',
        listedInCatalog: true,
        supportedOperations: inferred.ops,
        taskStatuses: mergedStatuses,
        capabilityEvidence: prev?.capabilityEvidence === 'live_probe' ? 'live_probe' : inferred.evidence,
        recommendedDefaultForTasks: recommendTasksForOperations(inferred.ops),
        lastCheckedAt: prev?.lastCheckedAt || nowIso,
        statusDetail:
          prev?.capabilityEvidence === 'live_probe' && prev.statusDetail
            ? prev.statusDetail
            : inferred.note,
      });
    }

    return {
      connection: {
        providerId: 'google_imagen',
        providerName: 'Google Gemini & Imagen',
        connectionKind: 'direct_official',
        configuredEndpoint: `${checked.normalizedBaseUrl}/models`,
        hasCredential: true,
        maskedCredential: maskSecretValue(apiKey),
        listApiSupported: true,
        listApiStatus: 'ok',
        listApiDetail: `Đã đọc ${collected.length} model (${pageCount} trang); lọc được ${models.length} model thiết kế/phân tích.`,
        discoveredModelCount: models.length,
        lastDiscoveryAt: nowIso,
        cacheExpiresAt: new Date(Date.now() + REGISTRY_CACHE_TTL_MINUTES * 60_000).toISOString(),
      },
      models,
    };
  }

  private static async discoverOpenAiCompatibleModels(
    providerId: 'openai_dalle' | 'custom_endpoint',
    providerName: string,
    connectionKind: AiConnectionKind,
    apiKey: string,
    configuredEndpoint: string,
    existingMap: Map<string, AiDiscoveredModelRegistryItemDto>
  ): Promise<{
    connection: AiProviderRegistryConnectionDto;
    models: AiDiscoveredModelRegistryItemDto[];
  }> {
    const checked = validateSafeHttpUrl(configuredEndpoint);
    if (!checked.valid || !checked.normalizedBaseUrl) {
      return {
        connection: {
          providerId,
          providerName,
          connectionKind,
          configuredEndpoint,
          hasCredential: true,
          maskedCredential: maskSecretValue(apiKey),
          listApiSupported: true,
          listApiStatus: 'error',
          listApiDetail: checked.error || 'Endpoint không hợp lệ.',
          discoveredModelCount: 0,
          lastDiscoveryAt: new Date().toISOString(),
          cacheExpiresAt: null,
        },
        models: [],
      };
    }

    const baseUrl = checked.normalizedBaseUrl;
    const rawItems: Array<{ id?: string; owned_by?: string }> = [];
    const seenIds = new Set<string>();
    let afterCursor: string | undefined;
    let pageCount = 0;

    try {
      do {
        pageCount += 1;
        const url = new URL(`${baseUrl}/models`);
        if (afterCursor) url.searchParams.set('after', afterCursor);

        const res = await fetch(url.toString(), {
          method: 'GET',
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(12000),
        });
        if (!res.ok) {
          const errText = await res.text();
          const classified = classifyUpstreamAiHttpError(res.status, errText);
          let upstreamHint = '';
          try {
            const parsedErr = JSON.parse(errText) as { error?: { message?: string } };
            if (parsedErr?.error?.message) {
              const sanitizedMsg = parsedErr.error.message
                .replace(/\b(?:sk|AIza|AQ\.|gsk_)[A-Za-z0-9*_\-.]{6,}\b/g, (m) => maskSecretValue(m.replace(/\*+/g, '')) || '***')
                .slice(0, 180);
              upstreamHint = ` [${sanitizedMsg}]`;
            }
          } catch {
            // ignore non-json error body
          }
          return {
            connection: {
              providerId,
              providerName,
              connectionKind,
              configuredEndpoint: `${baseUrl}/models`,
              hasCredential: true,
              maskedCredential: maskSecretValue(apiKey),
              listApiSupported: true,
              listApiStatus: 'error',
              listApiDetail: `${classified.shortReason} (Key đã gửi: ${maskSecretValue(apiKey) || 'trống'})${upstreamHint}`,
              discoveredModelCount: 0,
              lastDiscoveryAt: new Date().toISOString(),
              cacheExpiresAt: null,
            },
            models: [],
          };
        }

        const json = (await res.json()) as {
          data?: Array<{ id?: string; owned_by?: string }>;
          has_more?: boolean;
          last_id?: string;
        };
        const pageList = Array.isArray(json.data) ? json.data : [];
        let addedInPage = 0;
        for (const item of pageList) {
          if (item.id && !seenIds.has(item.id)) {
            seenIds.add(item.id);
            rawItems.push(item);
            addedInPage += 1;
          }
        }
        const nextCursor = json.last_id || pageList.at(-1)?.id;
        afterCursor = json.has_more && nextCursor && addedInPage > 0 ? nextCursor : undefined;
      } while (afterCursor && pageCount < MAX_PAGINATION_PAGES);
    } catch (err) {
      return {
        connection: {
          providerId,
          providerName,
          connectionKind,
          configuredEndpoint: `${baseUrl}/models`,
          hasCredential: true,
          maskedCredential: maskSecretValue(apiKey),
          listApiSupported: true,
          listApiStatus: 'error',
          listApiDetail: err instanceof Error ? err.message : 'Lỗi kết nối /v1/models.',
          discoveredModelCount: 0,
          lastDiscoveryAt: new Date().toISOString(),
          cacheExpiresAt: null,
        },
        models: [],
      };
    }

    const nowIso = new Date().toISOString();
    const models: AiDiscoveredModelRegistryItemDto[] = [];
    for (const raw of rawItems) {
      const modelId = (raw.id || '').trim();
      if (!modelId) continue;
      const inferred = inferOperationsFromCatalogMetadata(providerId, modelId);
      if (inferred.ops.length === 0) continue;

      const prev = existingMap.get(`${providerId}::${modelId}`);
      const initialStatuses = buildInitialTaskStatuses(inferred.ops, providerId);
      const mergedStatuses =
        prev?.capabilityEvidence === 'live_probe' ? { ...initialStatuses, ...prev.taskStatuses } : initialStatuses;

      models.push({
        modelId,
        displayName: modelId,
        providerId,
        connectionKind,
        listedInCatalog: true,
        supportedOperations: inferred.ops,
        taskStatuses: mergedStatuses,
        capabilityEvidence: prev?.capabilityEvidence === 'live_probe' ? 'live_probe' : inferred.evidence,
        recommendedDefaultForTasks: recommendTasksForOperations(inferred.ops),
        lastCheckedAt: prev?.lastCheckedAt || nowIso,
        statusDetail:
          prev?.capabilityEvidence === 'live_probe' && prev.statusDetail
            ? prev.statusDetail
            : inferred.note,
        reportedAliasWarning:
          prev?.reportedAliasWarning ??
          (connectionKind === 'openai_compatible_gateway'
            ? 'Gateway trung gian có thể không trả field `model` trong JSON ảnh; hệ thống sẽ ghi rõ Alias yêu cầu.'
            : null),
      });
    }

    return {
      connection: {
        providerId,
        providerName,
        connectionKind,
        configuredEndpoint: `${baseUrl}/models`,
        hasCredential: true,
        maskedCredential: maskSecretValue(apiKey),
        listApiSupported: true,
        listApiStatus: 'ok',
        listApiDetail: `Đã đọc ${rawItems.length} model từ gateway (${pageCount} trang); lọc được ${models.length} model thiết kế/chat.`,
        discoveredModelCount: models.length,
        lastDiscoveryAt: nowIso,
        cacheExpiresAt: new Date(Date.now() + REGISTRY_CACHE_TTL_MINUTES * 60_000).toISOString(),
      },
      models,
    };
  }

  private static buildFastFallbackSnapshot(
    stored: StoredMultiAiConfigShape
  ): AiModelRegistrySnapshotDto {
    const nowIso = new Date().toISOString();
    const connections: AiProviderRegistryConnectionDto[] = [];
    const models: AiDiscoveredModelRegistryItemDto[] = [];

    const googleCred = resolveEffectiveProviderCredential('google_imagen', stored);
    connections.push({
      providerId: 'google_imagen',
      providerName: 'Google Gemini & Imagen',
      connectionKind: 'direct_official',
      configuredEndpoint: googleCred.apiEndpoint,
      hasCredential: Boolean(googleCred.apiKey),
      maskedCredential: maskSecretValue(googleCred.apiKey),
      listApiSupported: true,
      listApiStatus: googleCred.apiKey ? 'ok' : 'not_configured',
      listApiDetail: googleCred.apiKey
        ? 'Đang dùng cấu hình tĩnh trong lúc đồng bộ catalog nền...'
        : 'Chưa cấu hình Google API Key.',
      discoveredModelCount: 0,
      lastDiscoveryAt: null,
      cacheExpiresAt: null,
    });
    if (googleCred.apiKey) {
      for (const mId of ['gemini-2.5-flash-image', 'imagen-3.0-generate-002', 'gemini-3.5-flash-lite']) {
        const inferred = inferOperationsFromCatalogMetadata('google_imagen', mId);
        models.push({
          modelId: mId,
          displayName: mId,
          providerId: 'google_imagen',
          connectionKind: 'direct_official',
          listedInCatalog: false,
          supportedOperations: inferred.ops,
          taskStatuses: buildInitialTaskStatuses(inferred.ops, 'google_imagen'),
          capabilityEvidence: 'documentation',
          recommendedDefaultForTasks: recommendTasksForOperations(inferred.ops),
          lastCheckedAt: null,
          statusDetail: inferred.note,
        });
      }
    }

    const openAiCred = resolveEffectiveProviderCredential('openai_dalle', stored);
    connections.push({
      providerId: 'openai_dalle',
      providerName: 'OpenAI Official API',
      connectionKind: 'direct_official',
      configuredEndpoint: openAiCred.apiEndpoint,
      hasCredential: Boolean(openAiCred.apiKey),
      maskedCredential: maskSecretValue(openAiCred.apiKey),
      listApiSupported: true,
      listApiStatus: openAiCred.apiKey ? 'ok' : 'not_configured',
      listApiDetail: openAiCred.apiKey
        ? 'Đang dùng cấu hình tĩnh trong lúc đồng bộ catalog nền...'
        : 'Chưa cấu hình OPENAI_API_KEY.',
      discoveredModelCount: 0,
      lastDiscoveryAt: null,
      cacheExpiresAt: null,
    });

    const customCred = resolveEffectiveProviderCredential('custom_endpoint', stored);
    connections.push({
      providerId: 'custom_endpoint',
      providerName: 'OpenAI-Compatible Gateway',
      connectionKind: 'openai_compatible_gateway',
      configuredEndpoint: customCred.apiEndpoint,
      hasCredential: Boolean(customCred.apiKey),
      maskedCredential: maskSecretValue(customCred.apiKey),
      listApiSupported: true,
      listApiStatus: customCred.apiKey && customCred.apiEndpoint ? 'ok' : 'not_configured',
      listApiDetail:
        customCred.apiKey && customCred.apiEndpoint
          ? 'Đang dùng cấu hình tĩnh trong lúc đồng bộ catalog nền...'
          : 'Cần cả Endpoint URL và API Key cho Gateway.',
      discoveredModelCount: 0,
      lastDiscoveryAt: null,
      cacheExpiresAt: null,
    });

    models.push({
      modelId: 'toantrung-studio-v3',
      displayName: 'Toàn Trung Studio Engine v3 (Local)',
      providerId: 'local_sandbox',
      connectionKind: 'local_compositor',
      listedInCatalog: false,
      supportedOperations: ['image_generation', 'image_editing_ref', 'inpainting_mask'],
      taskStatuses: buildInitialTaskStatuses(['image_generation', 'image_editing_ref'], 'local_sandbox'),
      capabilityEvidence: 'documentation',
      recommendedDefaultForTasks: ['perspective_compose'],
      lastCheckedAt: nowIso,
      statusDetail: 'Compositor nội bộ dựng nháp bố cục/phối cảnh.',
    });
    connections.push({
      providerId: 'local_sandbox',
      providerName: 'Toàn Trung Studio Engine (Local)',
      connectionKind: 'local_compositor',
      configuredEndpoint: 'internal://toantrung-studio-v3',
      hasCredential: true,
      maskedCredential: 'internal',
      listApiSupported: false,
      listApiStatus: 'unsupported',
      listApiDetail: 'Compositor nội bộ luôn sẵn sàng.',
      discoveredModelCount: 1,
      lastDiscoveryAt: nowIso,
      cacheExpiresAt: null,
    });

    return {
      generatedAt: nowIso,
      cacheTtlMinutes: REGISTRY_CACHE_TTL_MINUTES,
      connections,
      models,
      defaultModelByTask: this.computeDefaultModelsByTask(models, stored),
      probeBudgetMaxUsd: DEFAULT_PROBE_BUDGET_MAX_USD,
      probeBudgetSpentUsd: 0,
    };
  }

  private static triggerBackgroundRefresh(stored: StoredMultiAiConfigShape): void {
    if (process.env.NODE_TEST_CONTEXT) return;
    if (globalForModelRegistry.__toantrungModelRegistryRefreshInFlight) return;
    void this.getModelRegistrySnapshot(stored, { forceRefresh: true }).catch(() => {
      // background catalog sync must not reject unhandled
    });
  }

  static async getModelRegistrySnapshot(
    stored: StoredMultiAiConfigShape,
    options?: { forceRefresh?: boolean; onlyProviderId?: AiProviderId }
  ): Promise<AiModelRegistrySnapshotDto> {
    const fingerprint = buildCredentialFingerprint(stored);
    const cached = this.readCache();
    const isFresh =
      !options?.forceRefresh &&
      cached &&
      cached.credentialFingerprint === fingerprint &&
      Date.now() - new Date(cached.generatedAt).getTime() < REGISTRY_CACHE_TTL_MINUTES * 60_000;

    if (!options?.forceRefresh && cached) {
      if (!isFresh) {
        this.triggerBackgroundRefresh(stored);
      }
      return {
        generatedAt: cached.generatedAt,
        cacheTtlMinutes: cached.cacheTtlMinutes,
        connections: cached.connections,
        models: cached.models,
        defaultModelByTask: this.computeDefaultModelsByTask(cached.models, stored),
        probeBudgetMaxUsd: cached.probeBudgetMaxUsd,
        probeBudgetSpentUsd: Number(cached.probeBudgetSpentUsd.toFixed(4)),
      };
    }

    if (!options?.forceRefresh && !cached && !process.env.NODE_TEST_CONTEXT) {
      this.triggerBackgroundRefresh(stored);
      return this.buildFastFallbackSnapshot(stored);
    }

    if (!options?.onlyProviderId && globalForModelRegistry.__toantrungModelRegistryRefreshInFlight) {
      return globalForModelRegistry.__toantrungModelRegistryRefreshInFlight;
    }

    const runDiscovery = async (): Promise<AiModelRegistrySnapshotDto> => {
      const existingMap = new Map<string, AiDiscoveredModelRegistryItemDto>();
      for (const m of cached?.models || []) {
        existingMap.set(`${m.providerId}::${m.modelId}`, m);
      }

      const connections: AiProviderRegistryConnectionDto[] = [];
      const models: AiDiscoveredModelRegistryItemDto[] = [];
      const nowIso = new Date().toISOString();

      const discoverGoogle = async () => {
        const googleCred = resolveEffectiveProviderCredential('google_imagen', stored);
        if (!googleCred.apiKey) {
          return {
            connection: {
              providerId: 'google_imagen' as const,
              providerName: 'Google Gemini & Imagen',
              connectionKind: 'direct_official' as const,
              configuredEndpoint: googleCred.apiEndpoint,
              hasCredential: false,
              maskedCredential: null,
              listApiSupported: true,
              listApiStatus: 'not_configured' as const,
              listApiDetail: 'Chưa cấu hình Google API Key.',
              discoveredModelCount: 0,
              lastDiscoveryAt: null,
              cacheExpiresAt: null,
            },
            models: [] as AiDiscoveredModelRegistryItemDto[],
          };
        }
        if (options?.onlyProviderId && options.onlyProviderId !== 'google_imagen' && cached) {
          const prevConn = cached.connections.find((c) => c.providerId === 'google_imagen');
          return {
            connection: prevConn || null,
            models: cached.models.filter((m) => m.providerId === 'google_imagen'),
          };
        }
        return this.discoverGoogleModels(
          googleCred.apiKey,
          googleCred.apiEndpoint || 'https://generativelanguage.googleapis.com/v1beta',
          existingMap
        );
      };

      const discoverOpenAi = async () => {
        const openAiCred = resolveEffectiveProviderCredential('openai_dalle', stored);
        if (!openAiCred.apiKey) {
          return {
            connection: {
              providerId: 'openai_dalle' as const,
              providerName: 'OpenAI Official API',
              connectionKind: 'direct_official' as const,
              configuredEndpoint: openAiCred.apiEndpoint,
              hasCredential: false,
              maskedCredential: null,
              listApiSupported: true,
              listApiStatus: 'not_configured' as const,
              listApiDetail: 'Chưa cấu hình OPENAI_API_KEY.',
              discoveredModelCount: 0,
              lastDiscoveryAt: null,
              cacheExpiresAt: null,
            },
            models: [] as AiDiscoveredModelRegistryItemDto[],
          };
        }
        if (options?.onlyProviderId && options.onlyProviderId !== 'openai_dalle' && cached) {
          const prevConn = cached.connections.find((c) => c.providerId === 'openai_dalle');
          return {
            connection: prevConn || null,
            models: cached.models.filter((m) => m.providerId === 'openai_dalle'),
          };
        }
        return this.discoverOpenAiCompatibleModels(
          'openai_dalle',
          'OpenAI Official API',
          'direct_official',
          openAiCred.apiKey,
          openAiCred.apiEndpoint || 'https://api.openai.com/v1',
          existingMap
        );
      };

      const discoverCustom = async () => {
        const customCred = resolveEffectiveProviderCredential('custom_endpoint', stored);
        if (!customCred.apiKey || !customCred.apiEndpoint) {
          return {
            connection: {
              providerId: 'custom_endpoint' as const,
              providerName: 'OpenAI-Compatible Gateway',
              connectionKind: 'openai_compatible_gateway' as const,
              configuredEndpoint: customCred.apiEndpoint,
              hasCredential: Boolean(customCred.apiKey),
              maskedCredential: maskSecretValue(customCred.apiKey),
              listApiSupported: true,
              listApiStatus: 'not_configured' as const,
              listApiDetail: 'Cần cả Endpoint URL và API Key cho Gateway.',
              discoveredModelCount: 0,
              lastDiscoveryAt: null,
              cacheExpiresAt: null,
            },
            models: [] as AiDiscoveredModelRegistryItemDto[],
          };
        }
        if (options?.onlyProviderId && options.onlyProviderId !== 'custom_endpoint' && cached) {
          const prevConn = cached.connections.find((c) => c.providerId === 'custom_endpoint');
          return {
            connection: prevConn || null,
            models: cached.models.filter((m) => m.providerId === 'custom_endpoint'),
          };
        }
        return this.discoverOpenAiCompatibleModels(
          'custom_endpoint',
          'OpenAI-Compatible Gateway',
          'openai_compatible_gateway',
          customCred.apiKey,
          customCred.apiEndpoint,
          existingMap
        );
      };

      const [googleRes, openAiRes, customRes] = await Promise.all([
        discoverGoogle(),
        discoverOpenAi(),
        discoverCustom(),
      ]);

      for (const r of [googleRes, openAiRes, customRes]) {
        if (r.connection) connections.push(r.connection);
        models.push(...r.models);
      }

      // BFL & Stability: official APIs do not expose a standard dynamic /models catalog list
      for (const staticPid of ['flux_bfl', 'stability_ai'] as const) {
        const cred = resolveEffectiveProviderCredential(staticPid, stored);
        const staticModels =
          staticPid === 'flux_bfl'
            ? ['flux-1.1-pro-ultra', 'flux-1-fill-pro']
            : ['sd3.5-large', 'sdxl-inpaint-v1'];
        connections.push({
          providerId: staticPid,
          providerName: staticPid === 'flux_bfl' ? 'Black Forest Labs (FLUX)' : 'Stability AI (SD 3.5)',
          connectionKind: 'direct_official',
          configuredEndpoint: cred.apiEndpoint,
          hasCredential: Boolean(cred.apiKey),
          maskedCredential: maskSecretValue(cred.apiKey),
          listApiSupported: false,
          listApiStatus: cred.apiKey ? 'unsupported' : 'not_configured',
          listApiDetail: cred.apiKey
            ? 'Provider không hỗ trợ List Models API chuẩn; dùng danh sách model cấu hình thủ công.'
            : 'Chưa cấu hình API Key.',
          discoveredModelCount: staticModels.length,
          lastDiscoveryAt: nowIso,
          cacheExpiresAt: null,
        });
        for (const mId of staticModels) {
          const inferred = inferOperationsFromCatalogMetadata(staticPid, mId);
          const prev = existingMap.get(`${staticPid}::${mId}`);
          models.push({
            modelId: mId,
            displayName: mId,
            providerId: staticPid,
            connectionKind: 'direct_official',
            listedInCatalog: false,
            supportedOperations: inferred.ops,
            taskStatuses:
              prev?.capabilityEvidence === 'live_probe'
                ? prev.taskStatuses
                : buildInitialTaskStatuses(inferred.ops, staticPid),
            capabilityEvidence: prev?.capabilityEvidence === 'live_probe' ? 'live_probe' : 'documentation',
            recommendedDefaultForTasks: recommendTasksForOperations(inferred.ops),
            lastCheckedAt: prev?.lastCheckedAt || null,
            statusDetail: prev?.statusDetail || `${inferred.note} (Cấu hình thủ công)`,
          });
        }
      }

      // Always include local_sandbox compositor so offline fallback/perspective remains transparent
      connections.push({
        providerId: 'local_sandbox',
        providerName: 'Toàn Trung Studio Engine (Local)',
        connectionKind: 'local_compositor',
        configuredEndpoint: 'internal://toantrung-studio-v3',
        hasCredential: true,
        maskedCredential: 'internal',
        listApiSupported: false,
        listApiStatus: 'unsupported',
        listApiDetail: 'Compositor nội bộ luôn sẵn sàng (chỉ dựng bố cục/phối cảnh, không sinh ảnh AI cloud).',
        discoveredModelCount: 1,
        lastDiscoveryAt: nowIso,
        cacheExpiresAt: null,
      });
      models.push({
        modelId: 'toantrung-studio-v3',
        displayName: 'Toàn Trung Studio Engine v3 (Local)',
        providerId: 'local_sandbox',
        connectionKind: 'local_compositor',
        listedInCatalog: false,
        supportedOperations: ['image_generation', 'image_editing_ref', 'inpainting_mask'],
        taskStatuses: buildInitialTaskStatuses(['image_generation', 'image_editing_ref'], 'local_sandbox'),
        capabilityEvidence: 'documentation',
        recommendedDefaultForTasks: ['perspective_compose'],
        lastCheckedAt: nowIso,
        statusDetail: 'Compositor nội bộ dựng nháp bố cục/phối cảnh.',
      });

      const nextCache: PersistedRegistryCache = {
        generatedAt: nowIso,
        cacheTtlMinutes: REGISTRY_CACHE_TTL_MINUTES,
        credentialFingerprint: fingerprint,
        probeBudgetMaxUsd: cached?.probeBudgetMaxUsd ?? DEFAULT_PROBE_BUDGET_MAX_USD,
        probeBudgetSpentUsd: cached?.probeBudgetSpentUsd ?? 0,
        connections,
        models,
      };
      this.writeCache(nextCache);
      bumpDomainRevisions(['design'], 'model_registry_updated');

      return {
        generatedAt: nextCache.generatedAt,
        cacheTtlMinutes: nextCache.cacheTtlMinutes,
        connections: nextCache.connections,
        models: nextCache.models,
        defaultModelByTask: this.computeDefaultModelsByTask(nextCache.models, stored),
        probeBudgetMaxUsd: nextCache.probeBudgetMaxUsd,
        probeBudgetSpentUsd: Number(nextCache.probeBudgetSpentUsd.toFixed(4)),
      };
    };

    if (!options?.onlyProviderId) {
      const p = runDiscovery().finally(() => {
        globalForModelRegistry.__toantrungModelRegistryRefreshInFlight = null;
      });
      globalForModelRegistry.__toantrungModelRegistryRefreshInFlight = p;
      return p;
    }
    return runDiscovery();
  }

  private static computeDefaultModelsByTask(
    models: AiDiscoveredModelRegistryItemDto[],
    stored: StoredMultiAiConfigShape
  ): Partial<Record<DesignTaskCode, { providerId: AiProviderId; modelId: string }>> {
    const pickBest = (task: DesignTaskCode): { providerId: AiProviderId; modelId: string } | undefined => {
      const rankStatus = (s: AiTaskValidationStatus): number => {
        if (s === 'verified') return 4;
        if (s === 'listed_unverified') return 2;
        return 0;
      };
      const eligible = models
        .filter((m) => rankStatus(m.taskStatuses[task]) > 0)
        .sort((a, b) => {
          const diff = rankStatus(b.taskStatuses[task]) - rankStatus(a.taskStatuses[task]);
          if (diff !== 0) return diff;
          // Prefer default configured provider/model or cloud over local
          const aIsDefault = a.providerId === stored.defaultProviderId ? 1 : 0;
          const bIsDefault = b.providerId === stored.defaultProviderId ? 1 : 0;
          if (bIsDefault !== aIsDefault) return bIsDefault - aIsDefault;
          const aCloud = a.providerId === 'local_sandbox' ? 0 : 1;
          const bCloud = b.providerId === 'local_sandbox' ? 0 : 1;
          if (bCloud !== aCloud) return bCloud - aCloud;
          if (task === 'brief_analyze' && /gemini-3\.8-flash|gemini-3-flash|gpt-4o|gpt-5/i.test(a.modelId)) return -1;
          return 0;
        });
      const chosen = eligible[0];
      return chosen ? { providerId: chosen.providerId, modelId: chosen.modelId } : undefined;
    };

    return {
      banner_generate: pickBest('banner_generate'),
      design_edit: pickBest('design_edit'),
      perspective_compose: pickBest('perspective_compose'),
      brief_analyze: pickBest('brief_analyze'),
    };
  }

  static recordModelRuntimeObservation(params: {
    providerId: AiProviderId;
    modelId: string;
    taskCode: DesignTaskCode;
    taskStatus: AiTaskValidationStatus;
    statusDetail: string;
    reportedAliasWarning?: string | null;
    estimatedProbeCostUsd?: number;
  }): void {
    const cached = this.readCache();
    if (!cached) return;
    const nowIso = new Date().toISOString();
    const target = cached.models.find(
      (m) => m.providerId === params.providerId && m.modelId === params.modelId
    );
    if (target) {
      target.taskStatuses = {
        ...target.taskStatuses,
        [params.taskCode]: params.taskStatus,
      };
      target.capabilityEvidence = 'live_probe';
      target.lastCheckedAt = nowIso;
      target.statusDetail = params.statusDetail;
      if (params.reportedAliasWarning !== undefined) {
        target.reportedAliasWarning = params.reportedAliasWarning;
      }
    }
    if (params.estimatedProbeCostUsd && params.estimatedProbeCostUsd > 0) {
      cached.probeBudgetSpentUsd = Number(
        (cached.probeBudgetSpentUsd + params.estimatedProbeCostUsd).toFixed(4)
      );
    }
    this.writeCache(cached);
  }

  static async probeSelectedModelTask(params: {
    stored: StoredMultiAiConfigShape;
    providerId: AiProviderId;
    modelId: string;
    taskCode: DesignTaskCode;
  }): Promise<{
    ok: boolean;
    taskStatus: AiTaskValidationStatus;
    detail: string;
    latencyMs: number;
    reportedModel: string | null;
    snapshot: AiModelRegistrySnapshotDto;
  }> {
    const started = Date.now();
    const snapshotBefore = await this.getModelRegistrySnapshot(params.stored);
    const cred = resolveEffectiveProviderCredential(params.providerId, params.stored);
    const targetEntry = snapshotBefore.models.find(
      (m) => m.providerId === params.providerId && m.modelId === params.modelId
    );

    if (params.providerId === 'local_sandbox') {
      const taskStatus: AiTaskValidationStatus =
        params.taskCode === 'banner_generate' || params.taskCode === 'perspective_compose'
          ? 'verified'
          : 'unsupported';
      return {
        ok: taskStatus === 'verified',
        taskStatus,
        detail:
          taskStatus === 'verified'
            ? 'Studio Engine cục bộ luôn sẵn sàng dựng bố cục/phối cảnh.'
            : 'Studio Engine cục bộ không hỗ trợ tác vụ này.',
        latencyMs: Date.now() - started,
        reportedModel: 'toantrung-studio-v3',
        snapshot: snapshotBefore,
      };
    }

    if (!cred.apiKey) {
      return {
        ok: false,
        taskStatus: 'blocked_permission',
        detail: `Chưa có API Key cho provider ${params.providerId}.`,
        latencyMs: Date.now() - started,
        reportedModel: null,
        snapshot: snapshotBefore,
      };
    }

    const isImageTask = params.taskCode !== 'brief_analyze';
    const supportsImage = targetEntry
      ? params.taskCode === 'design_edit'
        ? targetEntry.supportedOperations.includes('image_editing_ref')
        : targetEntry.supportedOperations.includes('image_generation') ||
        targetEntry.supportedOperations.includes('image_editing_ref')
      : true;
    const supportsChat = targetEntry
      ? targetEntry.supportedOperations.includes('text_analysis') ||
      targetEntry.supportedOperations.includes('vision_understanding')
      : false;

    if (isImageTask && !supportsImage) {
      const detail = `Model "${params.modelId}" chỉ hỗ trợ ${targetEntry?.supportedOperations.join(', ') || 'chat/vision'}, không xuất file ảnh.`;
      this.recordModelRuntimeObservation({
        providerId: params.providerId,
        modelId: params.modelId,
        taskCode: params.taskCode,
        taskStatus: 'unsupported',
        statusDetail: detail,
      });
      const updated = await this.getModelRegistrySnapshot(params.stored);
      return {
        ok: false,
        taskStatus: 'unsupported',
        detail,
        latencyMs: Date.now() - started,
        reportedModel: null,
        snapshot: updated,
      };
    }

    if (!isImageTask && !supportsChat) {
      const detail = `Model "${params.modelId}" là model sinh ảnh chuyên biệt, không hỗ trợ chat/phân tích brief.`;
      this.recordModelRuntimeObservation({
        providerId: params.providerId,
        modelId: params.modelId,
        taskCode: params.taskCode,
        taskStatus: 'unsupported',
        statusDetail: detail,
      });
      const updated = await this.getModelRegistrySnapshot(params.stored);
      return {
        ok: false,
        taskStatus: 'unsupported',
        detail,
        latencyMs: Date.now() - started,
        reportedModel: null,
        snapshot: updated,
      };
    }

    const estProbeCost = isImageTask ? 0.04 : 0;
    if (estProbeCost > 0 && snapshotBefore.probeBudgetSpentUsd + estProbeCost > snapshotBefore.probeBudgetMaxUsd) {
      return {
        ok: false,
        taskStatus: 'blocked_quota_billing',
        detail: `Đã chạm ngưỡng ngân sách probe thử ($${snapshotBefore.probeBudgetSpentUsd.toFixed(3)} / $${snapshotBefore.probeBudgetMaxUsd.toFixed(2)}). Hãy chạy sinh ảnh thực tế ở canvas hoặc nâng ngân sách cấu hình.`,
        latencyMs: Date.now() - started,
        reportedModel: null,
        snapshot: snapshotBefore,
      };
    }

    // Minimal valid 8x8 PNG for tiny edit/vision single probe
    const tinyPngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAADklEQVQI12NgQAX//v0DAA9kA/0X1+6bAAAAAElFTkSuQmCC';

    try {
      if (params.providerId === 'google_imagen') {
        const base = normalizeOpenAiBaseUrl(
          cred.apiEndpoint || 'https://generativelanguage.googleapis.com/v1beta',
          'https://generativelanguage.googleapis.com/v1beta'
        );
        if (params.modelId.startsWith('imagen-')) {
          const url = `${base}/models/${encodeURIComponent(params.modelId)}:predict?key=${encodeURIComponent(cred.apiKey)}`;
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              instances: [{ prompt: 'Minimal blue geometric LED screen panel' }],
              parameters: { sampleCount: 1, aspectRatio: '1:1' },
            }),
            signal: AbortSignal.timeout(45000),
          });
          const bodyText = await res.text();
          if (!res.ok) {
            const c = classifyUpstreamAiHttpError(res.status, bodyText);
            this.recordModelRuntimeObservation({
              providerId: params.providerId,
              modelId: params.modelId,
              taskCode: params.taskCode,
              taskStatus: c.statusKind,
              statusDetail: c.shortReason,
            });
            return {
              ok: false,
              taskStatus: c.statusKind,
              detail: c.shortReason,
              latencyMs: Date.now() - started,
              reportedModel: null,
              snapshot: await this.getModelRegistrySnapshot(params.stored),
            };
          }
          const detail = `Probe sống Google Imagen thành công (${Date.now() - started}ms).`;
          this.recordModelRuntimeObservation({
            providerId: params.providerId,
            modelId: params.modelId,
            taskCode: params.taskCode,
            taskStatus: 'verified',
            statusDetail: detail,
            estimatedProbeCostUsd: 0.03,
          });
          return {
            ok: true,
            taskStatus: 'verified',
            detail,
            latencyMs: Date.now() - started,
            reportedModel: params.modelId,
            snapshot: await this.getModelRegistrySnapshot(params.stored),
          };
        }

        const url = `${base}/models/${encodeURIComponent(params.modelId)}:generateContent?key=${encodeURIComponent(cred.apiKey)}`;
        const parts: Array<Record<string, unknown>> = [{ text: isImageTask ? 'Minimal clean blue rectangle banner.' : 'Tra loi: OK' }];
        if (params.taskCode === 'design_edit' || params.taskCode === 'perspective_compose') {
          parts.push({ inlineData: { mimeType: 'image/png', data: tinyPngBase64 } });
        }
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts }],
            generationConfig: isImageTask
              ? { responseModalities: ['TEXT', 'IMAGE'] }
              : { maxOutputTokens: 8 },
          }),
          signal: AbortSignal.timeout(45000),
        });
        const bodyText = await res.text();
        if (!res.ok) {
          const c = classifyUpstreamAiHttpError(res.status, bodyText);
          this.recordModelRuntimeObservation({
            providerId: params.providerId,
            modelId: params.modelId,
            taskCode: params.taskCode,
            taskStatus: c.statusKind,
            statusDetail: c.shortReason,
          });
          return {
            ok: false,
            taskStatus: c.statusKind,
            detail: c.shortReason,
            latencyMs: Date.now() - started,
            reportedModel: null,
            snapshot: await this.getModelRegistrySnapshot(params.stored),
          };
        }
        const parsed = JSON.parse(bodyText) as { modelVersion?: string };
        const reported = parsed.modelVersion || params.modelId;
        const detail = `Probe sống Google thành công (${Date.now() - started}ms), upstream modelVersion=${reported}.`;
        this.recordModelRuntimeObservation({
          providerId: params.providerId,
          modelId: params.modelId,
          taskCode: params.taskCode,
          taskStatus: 'verified',
          statusDetail: detail,
          estimatedProbeCostUsd: isImageTask ? 0.02 : 0,
        });
        return {
          ok: true,
          taskStatus: 'verified',
          detail,
          latencyMs: Date.now() - started,
          reportedModel: reported,
          snapshot: await this.getModelRegistrySnapshot(params.stored),
        };
      }

      if (params.providerId === 'openai_dalle' || params.providerId === 'custom_endpoint') {
        const base = normalizeOpenAiBaseUrl(cred.apiEndpoint, 'https://api.openai.com/v1');
        if (!isImageTask) {
          const res = await fetch(`${base}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${cred.apiKey}`,
            },
            body: JSON.stringify({
              model: params.modelId,
              messages: [{ role: 'user', content: 'OK' }],
              max_tokens: 5,
            }),
            signal: AbortSignal.timeout(30000),
          });
          const bodyText = await res.text();
          if (!res.ok) {
            const c = classifyUpstreamAiHttpError(res.status, bodyText);
            this.recordModelRuntimeObservation({
              providerId: params.providerId,
              modelId: params.modelId,
              taskCode: params.taskCode,
              taskStatus: c.statusKind,
              statusDetail: c.shortReason,
            });
            return {
              ok: false,
              taskStatus: c.statusKind,
              detail: c.shortReason,
              latencyMs: Date.now() - started,
              reportedModel: null,
              snapshot: await this.getModelRegistrySnapshot(params.stored),
            };
          }
          const parsed = JSON.parse(bodyText) as { model?: string };
          const detail = `Probe chat/brief thành công (${Date.now() - started}ms).`;
          this.recordModelRuntimeObservation({
            providerId: params.providerId,
            modelId: params.modelId,
            taskCode: params.taskCode,
            taskStatus: 'verified',
            statusDetail: detail,
          });
          return {
            ok: true,
            taskStatus: 'verified',
            detail,
            latencyMs: Date.now() - started,
            reportedModel: parsed.model || null,
            snapshot: await this.getModelRegistrySnapshot(params.stored),
          };
        }

        let res: Response;
        if (params.taskCode === 'design_edit' || params.taskCode === 'perspective_compose') {
          const form = new FormData();
          form.append('model', params.modelId);
          form.append('prompt', 'Minimal clean blue rectangle banner edit');
          form.append('size', '1024x1024');
          const imgBuf = Buffer.from(tinyPngBase64, 'base64');
          form.append('image', new Blob([new Uint8Array(imgBuf)], { type: 'image/png' }), 'probe.png');
          res = await fetch(`${base}/images/edits`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${cred.apiKey}` },
            body: form,
            signal: AbortSignal.timeout(75000),
          });
        } else {
          res = await fetch(`${base}/images/generations`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${cred.apiKey}`,
            },
            body: JSON.stringify({
              model: params.modelId,
              prompt: 'Minimal clean navy geometric LED display backdrop',
              n: 1,
              size: '1024x1024',
            }),
            signal: AbortSignal.timeout(75000),
          });
        }

        const bodyText = await res.text();
        if (!res.ok) {
          const c = classifyUpstreamAiHttpError(res.status, bodyText);
          this.recordModelRuntimeObservation({
            providerId: params.providerId,
            modelId: params.modelId,
            taskCode: params.taskCode,
            taskStatus: c.statusKind,
            statusDetail: c.shortReason,
          });
          return {
            ok: false,
            taskStatus: c.statusKind,
            detail: c.shortReason,
            latencyMs: Date.now() - started,
            reportedModel: null,
            snapshot: await this.getModelRegistrySnapshot(params.stored),
          };
        }

        const parsed = JSON.parse(bodyText) as { model?: string; usage?: Record<string, unknown> };
        const reported = parsed.model || null;
        const aliasWarning = reported
          ? null
          : 'Gateway không trả field `model` trong response ảnh; không xác nhận độc lập model nền ngoài alias yêu cầu.';
        const detail = `Probe sống ${params.taskCode} thành công (${Date.now() - started}ms)${reported ? `, model="${reported}"` : ' (gateway ẩn tên model thực tế)'}.`;
        this.recordModelRuntimeObservation({
          providerId: params.providerId,
          modelId: params.modelId,
          taskCode: params.taskCode,
          taskStatus: 'verified',
          statusDetail: detail,
          reportedAliasWarning: aliasWarning,
          estimatedProbeCostUsd: 0.04,
        });
        return {
          ok: true,
          taskStatus: 'verified',
          detail,
          latencyMs: Date.now() - started,
          reportedModel: reported,
          snapshot: await this.getModelRegistrySnapshot(params.stored),
        };
      }

      return {
        ok: false,
        taskStatus: 'listed_unverified',
        detail: `Provider "${params.providerId}" chưa hỗ trợ single-shot probe qua registry này.`,
        latencyMs: Date.now() - started,
        reportedModel: null,
        snapshot: snapshotBefore,
      };
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Timeout/lỗi mạng khi probe upstream.';
      this.recordModelRuntimeObservation({
        providerId: params.providerId,
        modelId: params.modelId,
        taskCode: params.taskCode,
        taskStatus: 'failed_error',
        statusDetail: detail,
      });
      return {
        ok: false,
        taskStatus: 'failed_error',
        detail,
        latencyMs: Date.now() - started,
        reportedModel: null,
        snapshot: await this.getModelRegistrySnapshot(params.stored),
      };
    }
  }
}
