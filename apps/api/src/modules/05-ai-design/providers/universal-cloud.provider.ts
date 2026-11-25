/**
 * Universal Cloud & Custom AI Image Provider Adapter
 * Supports:
 * - Black Forest Labs FLUX.1 (`flux_bfl`)
 * - Stability AI SD 3.5 / SDXL (`stability_ai`)
 * - Any OpenAI-Compatible / OpenRouter / Self-Hosted ComfyUI / Custom Gateway (`custom_endpoint`)
 */

import type { AiProviderId } from '@toantrung/contracts';
import {
  type AiDesignProvider,
  type BannerGenerationInput,
  type PerspectiveGenerationInput,
  type ProviderGenerationResult,
  type ProviderStatusInfo,
} from './types';

export interface UniversalCloudProviderOptions {
  providerId: AiProviderId;
  providerName: string;
  apiKey?: string | null;
  apiEndpoint?: string | null;
  activeModel: string;
  costPerImageUsd: number;
  notes: string;
}

export class UniversalCloudAiProvider implements AiDesignProvider {
  readonly providerId: AiProviderId;
  private readonly providerName: string;
  private readonly apiKey: string | null;
  private readonly apiEndpoint: string;
  private readonly activeModel: string;
  private readonly costPerImageUsd: number;
  private readonly notes: string;

  constructor(opts: UniversalCloudProviderOptions) {
    this.providerId = opts.providerId;
    this.providerName = opts.providerName;
    this.apiKey = opts.apiKey || null;
    let ep = (opts.apiEndpoint || 'https://api.openai.com/v1/images/generations').trim();
    ep = ep.replace(/\.+$/, '').replace(/\/$/, '');
    if (!ep.endsWith('/images/generations')) {
      if (ep.endsWith('/v1')) {
        ep = `${ep}/images/generations`;
      }
    }
    this.apiEndpoint = ep;
    this.activeModel = opts.activeModel;
    this.costPerImageUsd = opts.costPerImageUsd;
    this.notes = opts.notes;
  }

  getStatusInfo(): ProviderStatusInfo {
    const isConfigured = Boolean(this.apiKey);
    return {
      provider: this.providerId,
      providerName: this.providerName,
      isConfigured,
      statusLabel: isConfigured
        ? `Đã kết nối (${this.activeModel})`
        : 'Chưa cấu hình API Key · Sẵn sàng tự động dùng Engine Studio',
      activeModel: this.activeModel,
      costPerImageUsd: this.costPerImageUsd,
      supportsInpainting: true,
      notes: this.notes,
    };
  }

  private async invokeEndpoint(
    prompt: string,
    modelId: string,
    widthPx: number,
    heightPx: number,
    simulateTimeout?: boolean,
    referenceImageBuffer?: Buffer,
    referenceImageMimeType?: string,
    productReferenceBuffers?: Array<{ buffer: Buffer; mimeType: string; name: string }>,
    requireReferenceEdit?: boolean,
    maskImageBuffer?: Buffer
  ): Promise<ProviderGenerationResult> {
    const started = Date.now();
    if (simulateTimeout) {
      await new Promise((r) => setTimeout(r, 120));
      return {
        imageBuffer: Buffer.alloc(0),
        mimeType: 'image/png',
        durationMs: Date.now() - started,
        modelUsed: modelId,
        requestedModel: modelId,
        reportedModel: null,
        tokensActual: false,
        costState: 'unknown',
        provider: this.providerId,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costMicros: 0n,
        costCurrency: 'USD',
        status: 'timeout',
        errorMessage: `${this.providerName} quá thời gian phản hồi 75s (Simulated UC06 E1).`,
      };
    }

    if (!this.apiKey) {
      return {
        imageBuffer: Buffer.alloc(0),
        mimeType: 'image/png',
        durationMs: Date.now() - started,
        modelUsed: modelId,
        requestedModel: modelId,
        reportedModel: null,
        tokensActual: false,
        costState: 'unknown',
        provider: this.providerId,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costMicros: 0n,
        costCurrency: 'USD',
        status: 'failed',
        errorMessage: `Chưa cấu hình API Key cho ${this.providerName}.`,
      };
    }

    try {
      const effectiveModel = modelId.trim() || this.activeModel;
      const hasSitePhoto = Boolean(referenceImageBuffer && referenceImageBuffer.length > 0);
      const hasProductPhotos = Boolean(productReferenceBuffers && productReferenceBuffers.length > 0);
      const mustUseReferenceEdit = Boolean(requireReferenceEdit || hasSitePhoto || hasProductPhotos);

      if (requireReferenceEdit && !hasSitePhoto && !hasProductPhotos) {
        return {
          imageBuffer: Buffer.alloc(0),
          mimeType: 'image/png',
          durationMs: Date.now() - started,
          modelUsed: effectiveModel,
          requestedModel: effectiveModel,
          reportedModel: null,
          tokensActual: false,
          costState: 'unknown',
          provider: this.providerId,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          costMicros: 0n,
          costCurrency: 'USD',
          status: 'failed',
          errorCode: 'MISSING_REFERENCE_IMAGE_BUFFER',
          errorMessage: 'Tác vụ chỉnh sửa yêu cầu ảnh gốc hoặc ảnh tham chiếu hợp lệ trên máy chủ.',
        };
      }

      const isGptImageFamily = /^gpt-image|^gpt-2\.5-image/i.test(effectiveModel);
      const chosenSize =
        widthPx === heightPx
          ? '1024x1024'
          : isGptImageFamily
            ? widthPx > heightPx
              ? '1536x1024'
              : '1024x1536'
            : widthPx > heightPx
              ? '1792x1024'
              : '1024x1792';

      let response: Response;
      if (mustUseReferenceEdit) {
        // Strict image editing path (/v1/images/edits): NEVER silently fall back to text-only /images/generations
        const editsEndpoint = this.apiEndpoint.replace(/\/images\/generations\/?$/i, '/images/edits');
        const hasMask = Boolean(maskImageBuffer && maskImageBuffer.length > 0);

        const buildEditForm = (includeMask: boolean, includeQuality: boolean): FormData => {
          const form = new FormData();
          form.append('model', effectiveModel);
          const editInstruction = hasSitePhoto
            ? `STRICTLY preserve the exact original provided photo background, structure, objects, lighting, and camera angle. Only apply the user's exact requested edit cleanly onto the provided image: ${prompt}`
            : `Design a crisp, high-contrast commercial banner strictly following every instruction in this user prompt (background, colors, theme, headline, layout, lighting). Place the attached company product reference image faithfully as a hero visual inside the banner without altering its real product shape, proportions, or logo: ${prompt}`;
          form.append('prompt', editInstruction);
          form.append('size', chosenSize);
          if (includeQuality && isGptImageFamily) {
            form.append('quality', 'high');
          }

          const totalImageInputs =
            (hasSitePhoto && referenceImageBuffer ? 1 : 0) +
            (hasProductPhotos && productReferenceBuffers ? productReferenceBuffers.length : 0);
          const imageFieldName = totalImageInputs > 1 ? 'image[]' : 'image';

          if (hasSitePhoto && referenceImageBuffer) {
            const blob = new Blob([new Uint8Array(referenceImageBuffer)], {
              type: referenceImageMimeType || 'image/png',
            });
            form.append(imageFieldName, blob, 'site-photo.png');
          }
          if (includeMask && maskImageBuffer && maskImageBuffer.length > 0) {
            const maskBlob = new Blob([new Uint8Array(maskImageBuffer)], {
              type: 'image/png',
            });
            form.append('mask', maskBlob, 'mask.png');
          }
          if (hasProductPhotos && productReferenceBuffers) {
            productReferenceBuffers.forEach((prod, idx) => {
              const blob = new Blob([new Uint8Array(prod.buffer)], {
                type: prod.mimeType || 'image/png',
              });
              form.append(
                imageFieldName,
                blob,
                prod.name || `product-${idx + 1}.png`
              );
            });
          }
          return form;
        };

        response = await fetch(editsEndpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: buildEditForm(hasMask, true),
          signal: AbortSignal.timeout(75000),
        });

        // Graceful fallback if third-party proxy rejects optional `mask` or `quality` parameter on /images/edits
        if (!response.ok && (response.status === 400 || response.status === 422)) {
          response = await fetch(editsEndpoint, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
            },
            body: buildEditForm(false, false),
            signal: AbortSignal.timeout(75000),
          });
        }
      } else {
        const fullBleedPrompt = `${prompt.trim()}. Full-bleed edge-to-edge composition filling 100% of the frame with no margins, no letterboxing, no borders, no rounded frame corners, ultra-sharp crisp high-resolution details.`;
        const payloadBody: Record<string, unknown> = {
          model: effectiveModel,
          prompt: fullBleedPrompt,
          n: 1,
          size: chosenSize,
        };
        if (isGptImageFamily) {
          payloadBody.quality = 'high';
        } else if (/^dall-e-3/i.test(effectiveModel)) {
          payloadBody.quality = 'hd';
          payloadBody.response_format = 'b64_json';
        } else {
          payloadBody.response_format = 'b64_json';
        }

        response = await fetch(this.apiEndpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payloadBody),
          signal: AbortSignal.timeout(75000),
        });

        // Graceful fallback if third-party gateway rejects `quality` or non-square `size`
        if (!response.ok && (response.status === 400 || response.status === 422)) {
          const fallbackBody: Record<string, unknown> = {
            model: effectiveModel,
            prompt: fullBleedPrompt,
            n: 1,
            size: '1024x1024',
          };
          if (!isGptImageFamily) {
            fallbackBody.response_format = 'b64_json';
          }
          response = await fetch(this.apiEndpoint, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(fallbackBody),
            signal: AbortSignal.timeout(75000),
          });
        }
      }

      const durationMs = Date.now() - started;
      if (!response.ok) {
        const text = await response.text();
        return {
          imageBuffer: Buffer.alloc(0),
          mimeType: 'image/png',
          durationMs,
          modelUsed: effectiveModel,
          requestedModel: effectiveModel,
          reportedModel: null,
          tokensActual: false,
          costState: 'unknown',
          provider: this.providerId,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          costMicros: 0n,
          costCurrency: 'USD',
          status: 'failed',
          errorCode: `UPSTREAM_HTTP_${response.status}`,
          errorMessage: `${this.providerName} Error [${response.status}]: ${text.slice(0, 240)}`,
        };
      }

      const json = (await response.json()) as {
        model?: string;
        data?: Array<{ b64_json?: string; url?: string }>;
        predictions?: Array<{ bytesBase64Encoded?: string }>;
        images?: string[];
        image_base64?: string;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
          input_tokens?: number;
          output_tokens?: number;
        };
      };
      const b64 =
        json.data?.[0]?.b64_json ||
        json.predictions?.[0]?.bytesBase64Encoded ||
        json.images?.[0] ||
        json.image_base64;

      let imageBuffer: Buffer | null = null;
      if (b64) {
        imageBuffer = Buffer.from(b64, 'base64');
      } else if (json.data?.[0]?.url) {
        try {
          const imgFetch = await fetch(json.data[0].url, { signal: AbortSignal.timeout(25000) });
          if (imgFetch.ok) {
            const arr = await imgFetch.arrayBuffer();
            imageBuffer = Buffer.from(arr);
          }
        } catch {
          // ignore fetch error
        }
      }

      if (!imageBuffer || imageBuffer.length === 0) {
        return {
          imageBuffer: Buffer.alloc(0),
          mimeType: 'image/png',
          durationMs,
          modelUsed: effectiveModel,
          requestedModel: effectiveModel,
          reportedModel: typeof json.model === 'string' && json.model.trim() ? json.model.trim() : null,
          tokensActual: false,
          costState: 'unknown',
          provider: this.providerId,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          costMicros: 0n,
          costCurrency: 'USD',
          status: 'failed',
          errorMessage: `${this.providerName} không trả về dữ liệu ảnh base64 hoặc URL hợp lệ.`,
        };
      }

      const usage = json.usage;
      const hasUsage =
        usage &&
        (typeof usage.total_tokens === 'number' ||
          typeof usage.prompt_tokens === 'number' ||
          typeof usage.input_tokens === 'number');
      const promptTokens = Number(usage?.prompt_tokens ?? usage?.input_tokens ?? 0);
      const completionTokens = Number(usage?.completion_tokens ?? usage?.output_tokens ?? 0);
      const totalTokens = Number(usage?.total_tokens ?? promptTokens + completionTokens);
      const reportedModel =
        typeof json.model === 'string' && json.model.trim() ? json.model.trim() : null;
      const reportedModelNote = reportedModel
        ? null
        : 'Gateway không trả field `model` trong phản hồi ảnh; chỉ ghi nhận alias đã yêu cầu.';

      return {
        imageBuffer,
        mimeType: 'image/png',
        durationMs,
        modelUsed: effectiveModel,
        requestedModel: effectiveModel,
        reportedModel,
        reportedModelNote,
        provider: this.providerId,
        promptTokens,
        completionTokens,
        totalTokens,
        tokensActual: Boolean(hasUsage),
        costMicros: 0n,
        costCurrency: 'USD',
        costState: 'unknown',
        isCostEstimated: false,
        status: 'success',
      };
    } catch (err) {
      const isTimeout = err instanceof Error && /abort|timeout/i.test(err.name + ' ' + err.message);
      return {
        imageBuffer: Buffer.alloc(0),
        mimeType: 'image/png',
        durationMs: Date.now() - started,
        modelUsed: modelId,
        requestedModel: modelId,
        reportedModel: null,
        tokensActual: false,
        costState: 'unknown',
        provider: this.providerId,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costMicros: 0n,
        costCurrency: 'USD',
        status: isTimeout ? 'timeout' : 'failed',
        errorMessage: err instanceof Error ? err.message : `Lỗi kết nối ${this.providerName}.`,
      };
    }
  }

  async generatePerspectiveDraft(
    input: PerspectiveGenerationInput
  ): Promise<ProviderGenerationResult> {
    const modelId = input.modelId || this.activeModel;
    return this.invokeEndpoint(
      input.prompt,
      modelId,
      1792,
      1024,
      input.simulateTimeout,
      input.referenceImageBuffer,
      input.referenceImageMimeType,
      input.productReferenceBuffers,
      input.requireReferenceEdit,
      input.maskImageBuffer
    );
  }

  async generateBannerDraft(input: BannerGenerationInput): Promise<ProviderGenerationResult> {
    const modelId = input.modelId || this.activeModel;
    return this.invokeEndpoint(
      input.prompt,
      modelId,
      input.dimensions.widthPx,
      input.dimensions.heightPx,
      input.simulateTimeout,
      input.referenceImageBuffer,
      input.referenceImageMimeType,
      input.productReferenceBuffers,
      input.requireReferenceEdit,
      input.maskImageBuffer
    );
  }
}

