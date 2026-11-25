import type {
  AiModelRegistrySnapshotDto,
  AiProviderCatalogItemDto,
  AiProviderId,
  DesignType,
} from '@toantrung/contracts';

export interface LeadOpt {
  id: number;
  leadCode: string;
  label: string;
}

export interface ProductOpt {
  id: number;
  code: string;
  name: string;
  categoryGroup: string;
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

export type UniversalUseCaseCategory =
  | 'general_photo'
  | 'marketing_poster'
  | 'space_architecture'
  | 'led_screen'
  | 'custom_other';

export interface ProjectParameterFormState {
  projectName: string;
  designType: DesignType;
  useCaseCategory: UniversalUseCaseCategory;
  customSubjectName: string;
  editActionMode: 'inpaint_keep_bg' | 'enhance_retouch' | 'region_composite' | 'creative_redesign';
  visualStylePreset: 'photorealistic' | 'modern_clean' | 'vivid_marketing' | 'luxury_arch' | 'custom';
  dimensionUnit: 'auto_photo' | 'm' | 'cm' | 'mm' | 'px';
  targetScopeMode: 'full_image' | 'touch_points';
  leadId: string;
  contactName: string;
  installationInfo: string;
  notes: string;
  productId: number;
  pixelPitch: string;
  screenStyle: 'flat' | 'curved' | 'corner_90';
  screenWidthM: number;
  screenHeightM: number;
  aspectRatio: string;
  aspectLocked: boolean;
  bannerWidthPx: number;
  bannerHeightPx: number;
}

export interface CustomAiModelRegistryEntry {
  id: string;
  name: string;
  role: 'consultant' | 'image_gen' | 'both';
  providerId: AiProviderId;
  modelId: string;
  apiEndpoint?: string;
  badge: string;
  createdAt: string;
}

export interface DiscoveredModelOption {
  id: string;
  name: string;
  badge: string;
  providerId: AiProviderId;
  providerLabel: string;
  category: 'image' | 'chat';
}

export const STORAGE_SELECTED_PROJECT_KEY = 'tt_studio_selected_project_id';
export const STORAGE_UNIVERSAL_PARAMS_KEY = 'tt_studio_universal_params_v1';

export function parseAspectRatioValue(ratioStr: string): number | null {
  const m = ratioStr.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!w || !h || h <= 0) return null;
  return w / h;
}

export function resolveAssetUrl(urlOrKey: string | null | undefined): string {
  if (!urlOrKey) return '/brand/showroom-toan-trung.webp';
  if (urlOrKey.startsWith('/') || urlOrKey.startsWith('http://') || urlOrKey.startsWith('https://')) {
    return urlOrKey;
  }
  return `/api/v1/design/asset-file?key=${encodeURIComponent(urlOrKey)}`;
}

export function buildAutoDiscoveredModels(params: {
  availableProviders?: AiProviderCatalogItemDto[];
  testResultModels?: Array<{ id: string; name: string; badge: string }>;
  testResultProviderId?: AiProviderId;
  customAiModels?: CustomAiModelRegistryEntry[];
}): DiscoveredModelOption[] {
  const map = new Map<string, DiscoveredModelOption>();

  const cleanShortName = (rawName: string) =>
    rawName
      .replace(/\s*\([^)]*\)\s*/g, ' ')
      .replace(/\s*—\s*\[[^\]]*\]\s*/g, '')
      .trim();

  const getProviderLabel = (pid: AiProviderId): string => {
    if (pid === 'google_imagen') return 'Google API';
    if (pid === 'openai_dalle') return 'OpenAI API';
    if (pid === 'flux_bfl') return 'FLUX API';
    if (pid === 'stability_ai') return 'Stability API';
    if (pid === 'custom_endpoint') return 'Custom API';
    return 'Nội bộ';
  };

  const classifyModel = (id: string, badge: string): 'image' | 'chat' => {
    const lowerId = id.toLowerCase();
    const lowerBadge = badge.toLowerCase();
    if (
      lowerId.includes('image') ||
      lowerId.includes('imagen') ||
      lowerId.includes('dall-e') ||
      lowerId.includes('flux') ||
      lowerId.includes('sd3') ||
      lowerId.includes('sdxl') ||
      lowerId.includes('studio-v3') ||
      lowerBadge.includes('tạo & ghép ảnh') ||
      lowerBadge.includes('@taoanh')
    ) {
      return 'image';
    }
    return 'chat';
  };

  const addModel = (id: string, name: string, badge: string, providerId: AiProviderId) => {
    if (!id || map.has(id)) return;
    const category = classifyModel(id, badge);
    map.set(id, {
      id,
      name: cleanShortName(name) || id,
      badge: category === 'image' ? '🎨 Tạo & Ghép ảnh' : '💬 Chat & Phân tích ảnh',
      providerId,
      providerLabel: getProviderLabel(providerId),
      category,
    });
  };

  if (params.testResultModels && params.testResultModels.length > 0) {
    for (const m of params.testResultModels) {
      addModel(m.id, m.name, m.badge, params.testResultProviderId || 'google_imagen');
    }
  }

  const connectedProviders = (params.availableProviders || []).filter(
    (p) => p.providerId !== 'local_sandbox' && p.hasApiKey && p.isConfigured
  );
  for (const prov of connectedProviders) {
    for (const m of prov.models || []) {
      addModel(m.id, m.name, m.badge, prov.providerId);
    }
  }

  for (const cm of params.customAiModels || []) {
    addModel(cm.modelId, cm.name, cm.badge || 'Custom', cm.providerId);
  }

  if (map.size === 0) {
    addModel(
      'gemini-3.5-flash-lite',
      'Gemini 3.5 Flash (Chờ gắn API Key)',
      '💬 Chat & Phân tích ảnh',
      'google_imagen'
    );
  }

  return Array.from(map.values());
}
