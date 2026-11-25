/**
 * Module 05 Submodule: Quick LED Install, Vision Auto-Snap & LED Screen Content Engine
 * Extracted from service.ts for modular Enterprise architecture (< 600-750 lines/module).
 */

import { prisma, recordAiUsageAttempt } from '@toantrung/database';
import {
  LED_SCREEN_SHAPE_META,
  containsCustomerPiiInPrompt,
  type AiProviderId,
  type AutoDetectLedPlacementRequestDto,
  type GenerateLedScreenContentRequestDto,
  type LedQuickInstallRequestDto,
  type LedScreenShapeType,
  type SessionUserDto,
} from '@toantrung/contracts';
import {
  readPrivateBusinessFile,
  savePrivateBusinessFile,
} from '../../core/storage/private-files.service';
import { bumpDomainRevisions } from '../../core/cache/server-data-cache';
import {
  AiDesignProviderFactory,
  resolveEffectiveProviderCredential,
} from './providers';
import { assertCanAccessDesignProject } from './access-control';
import { validateGeneratedImageBuffer } from './perspective-compositor';
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
  type VisionAutoSnapResult,
} from './led-placement-playbook';
import {
  createDesignAssetVersionSafe,
  parseProjectMetadata,
  type StoredMetadata,
} from './service';

function decodeBase64Payload(raw: string): Buffer {
  const stripped = (raw || '').replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '').trim();
  return Buffer.from(stripped, 'base64');
}

function resolveBestCloudImageTarget(
  requestedProviderId?: AiProviderId,
  requestedModelId?: string | null
): { providerId: AiProviderId; modelId: string } | null {
  const { config, catalog } = AiDesignProviderFactory.getCatalog();

  const isUsableImageModel = (id: string) =>
    Boolean(id) &&
    id !== 'toantrung-studio-v3' &&
    id !== 'toantrung-rules-v3' &&
    !AiDesignProviderFactory.isChatOnlyModel(id);

  if (
    requestedProviderId &&
    requestedProviderId !== 'local_sandbox' &&
    requestedModelId &&
    isUsableImageModel(requestedModelId)
  ) {
    const entry = catalog.find((c) => c.providerId === requestedProviderId);
    if (entry?.hasApiKey) {
      return { providerId: requestedProviderId, modelId: requestedModelId };
    }
  }

  const orderedProviderIds: AiProviderId[] = Array.from(
    new Set([
      config.defaultProviderId,
      'custom_endpoint',
      'openai_dalle',
      'google_imagen',
      'flux_bfl',
      'stability_ai',
    ])
  ).filter((p): p is AiProviderId => p !== 'local_sandbox');

  const rankImageModel = (id: string): number => {
    const l = id.toLowerCase();
    if (/^gpt-image-2|^gpt-2\.5-image|^gpt-image-1/i.test(l)) return 0;
    if (/gemini-.*image|imagen-3|imagen-4/i.test(l)) return 1;
    if (/flux/i.test(l)) return 2;
    if (/dall-e-3/i.test(l)) return 3;
    return 4;
  };

  for (const pid of orderedProviderIds) {
    const catEntry = catalog.find((c) => c.providerId === pid);
    if (!catEntry || !catEntry.hasApiKey) continue;
    const candidates = [
      ...(isUsableImageModel(catEntry.activeModel) ? [catEntry.activeModel] : []),
      ...catEntry.models.map((m) => m.id).filter(isUsableImageModel),
    ];
    const sorted = Array.from(new Set(candidates)).sort(
      (a, b) => rankImageModel(a) - rankImageModel(b)
    );
    if (sorted.length > 0) {
      return { providerId: pid, modelId: sorted[0] };
    }
  }

  return null;
}

export async function autoDetectLedPlacement(
  actor: SessionUserDto,
  requestId: number,
  input: AutoDetectLedPlacementRequestDto
): Promise<VisionAutoSnapResult> {
  await assertCanAccessDesignProject(actor, requestId);

  const existing = await prisma.designRequest.findUnique({ where: { id: requestId } });
  if (!existing) {
    throw new Error('Không tìm thấy dự án thiết kế.');
  }

  const meta = parseProjectMetadata(existing.installPositionJson);
  const photos = meta.photos || [];
  const targetPhoto =
    (input.photoId ? photos.find((p) => p.id === input.photoId) : null) ||
    photos.find((p) => p.selected) ||
    photos[0];

  let imgBase64 = input.annotatedImageBase64
    ? input.annotatedImageBase64.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '').trim()
    : '';
  let imgMime = 'image/jpeg';

  if (!imgBase64 && targetPhoto?.storageObjectKey) {
    const fileData = readPrivateBusinessFile(targetPhoto.storageObjectKey);
    if (fileData && fileData.buffer.length > 0 && fileData.buffer.length < 6 * 1024 * 1024) {
      imgBase64 = fileData.buffer.toString('base64');
      imgMime = fileData.mimeType || 'image/jpeg';
    }
  }

  const clickPoint = input.clickPoint || null;
  const preferredShape = (input.preferredShapeType || null) as LedScreenShapeType | null;
  const isOfflineUnitTest = Boolean(process.env.NODE_TEST_CONTEXT);

  if (!imgBase64 || isOfflineUnitTest) {
    return buildFallbackAutoSnapAroundPoint(
      clickPoint,
      preferredShape,
      isOfflineUnitTest
        ? 'Chế độ kiểm thử cục bộ: đã đặt khung chuẩn quanh điểm chạm.'
        : 'Chưa nhận được dữ liệu ảnh để quét Vision; đã đặt khung chuẩn quanh vị trí vừa chọn.'
    );
  }

  const promptText = buildVisionAutoSnapPrompt({
    clickPoint,
    preferredShapeType: preferredShape,
  });

  const { config: aiCfg } = AiDesignProviderFactory.getCatalog();
  const customCred = resolveEffectiveProviderCredential('custom_endpoint', aiCfg);
  const openAiCred = resolveEffectiveProviderCredential('openai_dalle', aiCfg);
  const geminiKey =
    aiCfg.providers.google_imagen?.apiKey ||
    process.env.GEMINI_API_KEY ||
    process.env.IMAGEN_API_KEY ||
    null;

  const gatewayKey = customCred.apiKey || openAiCred.apiKey;
  const gatewayEndpoint = customCred.apiKey
    ? customCred.apiKey && (customCred.apiEndpoint || 'https://api.openai.com/v1')
    : openAiCred.apiEndpoint || 'https://api.openai.com/v1';

  if (gatewayKey) {
    try {
      const cleanBase = gatewayEndpoint
        .replace(/\/(images\/generations|images\/edits|chat\/completions|models).*$/i, '')
        .replace(/\/+$/, '');
      const chatUrl = cleanBase.endsWith('/v1')
        ? `${cleanBase}/chat/completions`
        : `${cleanBase}/v1/chat/completions`;

      const discoveredChat = (
        aiCfg.providers.custom_endpoint?.discoveredModels ||
        aiCfg.providers.openai_dalle?.discoveredModels ||
        []
      )
        .map((m) => m.id.trim())
        .filter((id) => id && AiDesignProviderFactory.isChatOnlyModel(id));

      const visionCandidates = Array.from(
        new Set([
          ...discoveredChat.filter((id) => /gemini-2\.5|gemini-3|gpt-4o|gpt-5|gpt-6|claude-sonnet/i.test(id)),
          ...discoveredChat,
          'gpt-4o-mini',
          'gemini-2.5-flash',
        ])
      ).slice(0, 3);

      for (const modelName of visionCandidates) {
        try {
          const res = await fetch(chatUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${gatewayKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: modelName,
              temperature: 0.2,
              max_tokens: 700,
              messages: [
                {
                  role: 'user',
                  content: [
                    { type: 'text', text: promptText },
                    {
                      type: 'image_url',
                      image_url: { url: `data:${imgMime};base64,${imgBase64}` },
                    },
                  ],
                },
              ],
            }),
            signal: AbortSignal.timeout(15000),
          });
          if (res.ok) {
            const json = (await res.json()) as {
              choices?: Array<{ message?: { content?: string } }>;
            };
            const text = json.choices?.[0]?.message?.content;
            if (text) {
              const parsed = parseVisionAutoSnapResponse(text, clickPoint, preferredShape);
              if (parsed.usedAiVision) return parsed;
            }
          }
        } catch {
          // try next vision candidate
        }
      }
    } catch {
      // fall through to Gemini or safe fallback
    }
  }

  if (geminiKey) {
    const geminiVisionModels = ['gemini-2.5-flash', 'gemini-3-flash-preview', 'gemini-2.0-flash'];
    for (const gemModel of geminiVisionModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          gemModel
        )}:generateContent?key=${encodeURIComponent(geminiKey)}`;
        const gemRes = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  { text: promptText },
                  { inlineData: { mimeType: imgMime, data: imgBase64 } },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 700,
            },
          }),
          signal: AbortSignal.timeout(15000),
        });
        if (gemRes.ok) {
          const gemJson = (await gemRes.json()) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          };
          const extracted = gemJson.candidates?.[0]?.content?.parts
            ?.map((p) => p.text || '')
            .join('')
            .trim();
          if (extracted) {
            const parsed = parseVisionAutoSnapResponse(extracted, clickPoint, preferredShape);
            if (parsed.usedAiVision) return parsed;
          }
        }
      } catch {
        // try next gemini model
      }
    }
  }

  return buildFallbackAutoSnapAroundPoint(
    clickPoint,
    preferredShape,
    'Chưa kết nối Vision Key hoặc API bận — đã đặt khung chuẩn quanh điểm chạm để bạn kéo nhẹ khít góc.'
  );
}

export async function executeQuickLedInstall(
  actor: SessionUserDto,
  requestId: number,
  input: LedQuickInstallRequestDto
) {
  await assertCanAccessDesignProject(actor, requestId);

  const piiText = [
    input.note || '',
    input.variantLabel || '',
    input.contentSummary || '',
    input.contextHint || '',
    ...input.screens.map((s) => s.contentCustomPrompt || ''),
  ]
    .filter(Boolean)
    .join('\n');
  const piiCheck = containsCustomerPiiInPrompt(piiText);
  if (piiCheck.hasPii) {
    throw new Error(piiCheck.reason);
  }

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

  const guidedBuffer = decodeBase64Payload(input.guidedCompositeBase64);
  const guidedValidation = validateGeneratedImageBuffer(guidedBuffer);
  if (!guidedValidation.isValid) {
    throw new Error(guidedValidation.errorMessage || 'Dữ liệu ảnh bản ghép LED không hợp lệ.');
  }

  const primaryScreen = input.screens[0];
  const canonicalPrimaryQuad = canonicalizeQuad([
    primaryScreen.quad.topLeft,
    primaryScreen.quad.topRight,
    primaryScreen.quad.bottomRight,
    primaryScreen.quad.bottomLeft,
  ]);
  const shapeLabels = Array.from(
    new Set(input.screens.map((s) => LED_SCREEN_SHAPE_META[s.shapeType]?.shortLabel || s.shapeType))
  ).join(' + ');

  const currentMeta = parseProjectMetadata(existing.installPositionJson);

  if (input.mode === 'fast_composite') {
    const savedFile = savePrivateBusinessFile({
      bucket: 'design',
      prefix: `quick-led-req-${requestId}`,
      fileBuffer: guidedBuffer,
      declaredMimeType: guidedValidation.detectedMimeType || 'image/png',
      originalFileName: `quick-led-${requestId}.png`,
    });

    const promptSummary =
      input.note ||
      `Gắn nhanh LED (${shapeLabels}${input.screens.length > 1 ? ` · ${input.screens.length} màn` : ''})${
        input.variantLabel ? ` · ${input.variantLabel}` : ''
      }`;

    const createdVersion = await createDesignAssetVersionSafe(requestId, (versionNumber) => ({
      designRequestId: requestId,
      versionNumber,
      versionType: 'ai_draft',
      storageObjectKey: savedFile.storageObjectKey,
      mimeType: savedFile.mimeType,
      fileSizeBytes: savedFile.fileSizeBytes,
      promptUsed: promptSummary,
      parametersJson: JSON.stringify({
        studioComposite: true,
        generationOrigin: 'LOCAL_COMPOSITE_FALLBACK',
        providerId: 'local_sandbox',
        modelUsed: 'Toàn Trung Homography Engine V3',
        costState: 'actual',
        tokensActual: false,
        taskCode: 'perspective_compose',
        referenceSitePhotoId: input.photoId || null,
        placementQuad: canonicalPrimaryQuad,
        ledScreens: input.screens,
        variantLabel: input.variantLabel || null,
        contextHint: input.contextHint || null,
        marketingFormat: input.marketingFormat || 'original',
        actualWidthPx: guidedValidation.widthPx,
        actualHeightPx: guidedValidation.heightPx,
      }),
      uploadedByUserId: actor.id,
      isApprovedFinal: false,
    }));

    const nextMeta: StoredMetadata = {
      ...currentMeta,
      placementQuad: canonicalPrimaryQuad,
      ledScreens: input.screens,
    };

    await prisma.designRequest.update({
      where: { id: requestId },
      data: {
        aiDraftImageUrl: savedFile.storageObjectKey,
        installPositionJson: JSON.stringify(nextMeta),
        designStatus: 'ai_drafting',
        version: { increment: 1 },
      },
    });

    bumpDomainRevisions(['design', 'reports'], 'design_quick_led_fast');

    return {
      requestId,
      versionId: createdVersion.id,
      versionNumber: createdVersion.versionNumber,
      downloadUrl: `/api/v1/design/asset/${createdVersion.id}`,
      generationOrigin: 'LOCAL_COMPOSITE_FALLBACK' as const,
      pixelGuardApplied: false,
      protectedPixelsPct: 100,
      modelUsed: 'Toàn Trung Homography Engine V3',
      costFormatted: '$0.00',
    };
  }

  const cloudTarget = resolveBestCloudImageTarget(input.providerId, input.modelId);
  if (!cloudTarget) {
    throw new Error(
      'Chưa cấu hình API Key Cloud Image Model (OpenAI GPT-Image / Google Imagen / APIVN). Bạn có thể dùng ngay nút "Xuất Nhanh ($0)" hoặc gắn Key trong mục Model & Key.'
    );
  }

  const origBuf = input.originalPhotoBase64 ? decodeBase64Payload(input.originalPhotoBase64) : null;
  const occBuf = input.occlusionMaskBase64 ? decodeBase64Payload(input.occlusionMaskBase64) : null;
  let alphaMaskBuf = input.alphaMaskBase64 ? decodeBase64Payload(input.alphaMaskBase64) : null;

  if (!alphaMaskBuf && guidedValidation.widthPx && guidedValidation.heightPx) {
    alphaMaskBuf = generateFeatheredAlphaMaskPng({
      width: guidedValidation.widthPx,
      height: guidedValidation.heightPx,
      quad: canonicalPrimaryQuad,
      shapeType: primaryScreen.shapeType,
      polygonPoints: primaryScreen.polygonPoints,
      cornerRadiusPct: primaryScreen.cornerRoundnessPct ?? primaryScreen.cornerRadiiPct?.tl ?? 0,
    });
  }

  const inpaintPrompt = buildMaskedLedInpaintPrompt({
    shapeTypes: input.screens.map((s) => s.shapeType),
    contextHint: input.contextHint,
    contentSummary: input.contentSummary,
    screenCount: input.screens.length,
  });

  const nextVerEst = (existing.assetVersions[0]?.versionNumber ?? 0) + 1;
  const providerResult = await AiDesignProviderFactory.executePerspectiveWithFallback(
    {
      workflow: 'perspective_3d',
      prompt: inpaintPrompt,
      referenceImageUrl: `quick-led-req-${requestId}`,
      referenceImageBuffer: guidedBuffer,
      referenceImageMimeType: guidedValidation.detectedMimeType || 'image/png',
      maskImageBuffer: alphaMaskBuf || undefined,
      placementQuad: canonicalPrimaryQuad,
      compositingMode: 'REALISTIC',
      dimensions: {
        widthM: currentMeta.screenWidthM ?? 4.8,
        heightM: currentMeta.screenHeightM ?? 2.7,
        aspectRatio: existing.aspectRatio || '16:9',
      },
      quality: 'high_quality',
      modelId: cloudTarget.modelId,
      idempotencyKey: `quick-ai-${requestId}-v${nextVerEst}-${Date.now()}`,
      disableLocalFallback: true,
      requireReferenceEdit: true,
    },
    cloudTarget.providerId
  );

  const outCheck = validateGeneratedImageBuffer(providerResult.imageBuffer);
  if (providerResult.status !== 'success' || !outCheck.isValid) {
    await recordAiUsageAttempt(prisma, {
      idempotencyKey: `quick-ai-fail-${requestId}-${Date.now()}`,
      attemptNumber: nextVerEst,
      moduleCode: '05-ai-design',
      taskType: '3d_perspective',
      userId: actor.id,
      designRequestId: requestId,
      modelName: cloudTarget.modelId,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      costMicros: null,
      durationMs: providerResult.durationMs,
      status: providerResult.status === 'timeout' ? 'timeout' : 'failed',
      errorMessage: providerResult.errorMessage || outCheck.errorMessage || 'Cloud AI failed',
    }).catch(() => null);

    throw new Error(
      providerResult.errorMessage ||
        outCheck.errorMessage ||
        'Cloud AI tạm thời không trả về ảnh hợp lệ. Bản lắp nhanh của bạn vẫn an toàn.'
    );
  }

  let finalBuf = providerResult.imageBuffer;
  let finalMime = outCheck.detectedMimeType || providerResult.mimeType || 'image/png';
  let pixelGuardApplied = false;
  let protectedPixelsPct = 0;
  let guardNote = '';

  if (origBuf && origBuf.length > 32 && alphaMaskBuf && alphaMaskBuf.length > 32) {
    const guarded = applyPostAiPixelGuard({
      originalPngBuffer: origBuf,
      aiResultBuffer: providerResult.imageBuffer,
      alphaMaskPngBuffer: alphaMaskBuf,
      occlusionMaskPngBuffer: occBuf,
    });
    finalBuf = guarded.imageBuffer;
    finalMime = guarded.mimeType;
    pixelGuardApplied = guarded.appliedGuard;
    protectedPixelsPct = guarded.protectedPixelsPct;
    guardNote = guarded.note;
  }

  const finalCheck = validateGeneratedImageBuffer(finalBuf);
  const savedFile = savePrivateBusinessFile({
    bucket: 'design',
    prefix: `quick-led-ai-req-${requestId}`,
    fileBuffer: finalBuf,
    declaredMimeType: finalCheck.detectedMimeType || finalMime,
  });

  const hasActualTokens = providerResult.tokensActual !== false && providerResult.totalTokens > 0;
  const aiLog = await recordAiUsageAttempt(prisma, {
    idempotencyKey: `quick-ai-ok-${requestId}-v${nextVerEst}-${Date.now()}`,
    attemptNumber: nextVerEst,
    providerRequestId: `${providerResult.provider}-${requestId}-quick-v${nextVerEst}`,
    moduleCode: '05-ai-design',
    taskType: '3d_perspective',
    userId: actor.id,
    designRequestId: requestId,
    modelName: providerResult.modelUsed || cloudTarget.modelId,
    promptTokens: hasActualTokens ? providerResult.promptTokens : null,
    completionTokens: hasActualTokens ? providerResult.completionTokens : null,
    totalTokens: hasActualTokens ? providerResult.totalTokens : null,
    costMicros: providerResult.costMicros > 0n ? providerResult.costMicros : null,
    costCurrency: providerResult.costCurrency,
    durationMs: providerResult.durationMs,
    status: 'success',
  });

  const promptSummary =
    input.note ||
    `Hòa sáng AI Siêu thực (${shapeLabels}${input.screens.length > 1 ? ` · ${input.screens.length} màn` : ''})${
      input.variantLabel ? ` · ${input.variantLabel}` : ''
    }`;

  const createdVersion = await createDesignAssetVersionSafe(requestId, (versionNumber) => ({
    designRequestId: requestId,
    versionNumber,
    versionType: 'ai_draft',
    storageObjectKey: savedFile.storageObjectKey,
    mimeType: savedFile.mimeType,
    fileSizeBytes: savedFile.fileSizeBytes,
    promptUsed: promptSummary,
    parametersJson: JSON.stringify({
      generationOrigin: 'CLOUD_AI',
      taskCode: 'perspective_compose',
      providerId: providerResult.provider,
      modelUsed: providerResult.modelUsed || cloudTarget.modelId,
      requestedModel: cloudTarget.modelId,
      reportedModel: providerResult.reportedModel ?? null,
      reportedModelNote: providerResult.reportedModelNote ?? null,
      costState: providerResult.costState || 'unknown',
      tokensActual: Boolean(providerResult.tokensActual),
      referenceSitePhotoId: input.photoId || null,
      placementQuad: canonicalPrimaryQuad,
      ledScreens: input.screens,
      pixelGuardApplied,
      protectedPixelsPct,
      guardNote,
      variantLabel: input.variantLabel || null,
      contextHint: input.contextHint || null,
      marketingFormat: input.marketingFormat || 'original',
      actualWidthPx: finalCheck.widthPx,
      actualHeightPx: finalCheck.heightPx,
    }),
    aiUsageLogId: aiLog.log.id,
    uploadedByUserId: actor.id,
    isApprovedFinal: false,
  }));

  const nextMeta: StoredMetadata = {
    ...currentMeta,
    placementQuad: canonicalPrimaryQuad,
    ledScreens: input.screens,
  };

  await prisma.designRequest.update({
    where: { id: requestId },
    data: {
      aiDraftImageUrl: savedFile.storageObjectKey,
      installPositionJson: JSON.stringify(nextMeta),
      designStatus: 'ai_drafting',
      processingTimeMs: (existing.processingTimeMs ?? 0) + providerResult.durationMs,
      tokenCost: (existing.tokenCost ?? 0) + (hasActualTokens ? providerResult.totalTokens : 0),
      totalCostMicros: (existing.totalCostMicros ?? 0n) + providerResult.costMicros,
      version: { increment: 1 },
    },
  });

  bumpDomainRevisions(['design', 'reports'], 'design_quick_led_ai');

  return {
    requestId,
    versionId: createdVersion.id,
    versionNumber: createdVersion.versionNumber,
    downloadUrl: `/api/v1/design/asset/${createdVersion.id}`,
    generationOrigin: 'CLOUD_AI' as const,
    pixelGuardApplied,
    protectedPixelsPct,
    guardNote,
    modelUsed: providerResult.modelUsed || cloudTarget.modelId,
    costFormatted:
      providerResult.costMicros > 0n
        ? `$${(Number(providerResult.costMicros) / 1_000_000).toFixed(3)}`
        : 'Theo gateway',
  };
}

export async function generateLedScreenContent(
  actor: SessionUserDto,
  requestId: number,
  input: GenerateLedScreenContentRequestDto
): Promise<{
  ok: boolean;
  dataUrl: string;
  mimeType: string;
  providerId: AiProviderId;
  modelUsed: string;
  durationMs: number;
}> {
  await assertCanAccessDesignProject(actor, requestId);

  const piiCheck = containsCustomerPiiInPrompt(input.prompt);
  if (piiCheck.hasPii) {
    throw new Error(piiCheck.reason);
  }

  const cloudTarget = resolveBestCloudImageTarget(input.providerId, input.modelId);
  if (!cloudTarget) {
    throw new Error(
      'Chưa cấu hình API Key Image Model để AI tự vẽ nội dung mới. Bạn hãy chọn 1 trong 16 mẫu sẵn có bên dưới hoặc gắn Key trong mục Model & Key.'
    );
  }

  const ratio = input.aspectRatio || '16:9';
  const [rw, rh] = ratio.split(':').map(Number);
  const wPx = rw && rh && rw < rh ? 1024 : rw === rh ? 1024 : 1536;
  const hPx = rw && rh && rw < rh ? 1536 : 1024;

  const builtPrompt = buildLedScreenContentPrompt({
    prompt: input.prompt,
    shapeType: (input.shapeType || null) as LedScreenShapeType | null,
    transparentMode: input.transparentMode,
  });

  const result = await AiDesignProviderFactory.executeBannerWithFallback(
    {
      workflow: 'banner',
      prompt: builtPrompt,
      dimensions: { widthPx: wPx, heightPx: hPx, aspectRatio: ratio },
      quality: 'high_quality',
      modelId: cloudTarget.modelId,
      idempotencyKey: `led-content-${requestId}-${Date.now()}`,
      disableLocalFallback: true,
    },
    cloudTarget.providerId
  );

  const imgCheck = validateGeneratedImageBuffer(result.imageBuffer);
  if (result.status !== 'success' || !imgCheck.isValid) {
    await recordAiUsageAttempt(prisma, {
      idempotencyKey: `led-content-fail-${requestId}-${Date.now()}`,
      attemptNumber: 1,
      moduleCode: '05-ai-design',
      taskType: 'banner',
      userId: actor.id,
      designRequestId: requestId,
      modelName: cloudTarget.modelId,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      costMicros: null,
      durationMs: result.durationMs,
      status: result.status === 'timeout' ? 'timeout' : 'failed',
      errorMessage: result.errorMessage || imgCheck.errorMessage || 'Generate LED content failed',
    }).catch(() => null);

    throw new Error(
      result.errorMessage || imgCheck.errorMessage || 'Không thể tạo nội dung màn hình từ Cloud AI.'
    );
  }

  const hasTokens = result.tokensActual !== false && result.totalTokens > 0;
  await recordAiUsageAttempt(prisma, {
    idempotencyKey: `led-content-ok-${requestId}-${Date.now()}`,
    attemptNumber: 1,
    moduleCode: '05-ai-design',
    taskType: 'banner',
    userId: actor.id,
    designRequestId: requestId,
    modelName: result.modelUsed || cloudTarget.modelId,
    promptTokens: hasTokens ? result.promptTokens : null,
    completionTokens: hasTokens ? result.completionTokens : null,
    totalTokens: hasTokens ? result.totalTokens : null,
    costMicros: result.costMicros > 0n ? result.costMicros : null,
    costCurrency: result.costCurrency,
    durationMs: result.durationMs,
    status: 'success',
  }).catch(() => null);

  const mime = imgCheck.detectedMimeType || result.mimeType || 'image/png';
  return {
    ok: true,
    dataUrl: `data:${mime};base64,${result.imageBuffer.toString('base64')}`,
    mimeType: mime,
    providerId: result.provider,
    modelUsed: result.modelUsed || cloudTarget.modelId,
    durationMs: result.durationMs,
  };
}
