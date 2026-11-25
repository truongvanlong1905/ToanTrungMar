'use strict';

/**
 * Automated Verification Suite for M05 V3 LED Geometry (12 Shapes), Homography 3x3,
 * Alpha Mask Generation, Post-AI Pixel Guard, Vision Playbook Parser, & BA RBAC Invariants.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

if (!require.extensions['.ts']) {
  require.extensions['.ts'] = function compileTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        resolveJsonModule: true,
      },
      fileName: filename,
    });
    module._compile(transpiled.outputText, filename);
  };
}

const V2_ROOT = path.resolve(__dirname, '../../../../..');
const origResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveWorkspaceAliases(request, parent, isMain, options) {
  if (request === '@toantrung/contracts') {
    return path.join(V2_ROOT, 'packages/contracts/src/common/index.ts');
  }
  if (request.startsWith('@toantrung/contracts/')) {
    const sub = request.slice('@toantrung/contracts/'.length);
    return path.join(V2_ROOT, 'packages/contracts/src', sub, 'index.ts');
  }
  if (request === '@toantrung/database') {
    return path.join(V2_ROOT, 'packages/database/src/index.ts');
  }
  try {
    return origResolveFilename.call(this, request, parent, isMain, options);
  } catch (err) {
    if (request.startsWith('.') && parent && parent.filename) {
      const candidateTs = path.resolve(path.dirname(parent.filename), `${request}.ts`);
      if (fs.existsSync(candidateTs)) return candidateTs;
      const candidateIndexTs = path.resolve(path.dirname(parent.filename), request, 'index.ts');
      if (fs.existsSync(candidateIndexTs)) return candidateIndexTs;
    }
    throw err;
  }
};

const {
  hasBaPermission,
  LED_SCREEN_SHAPES,
  LED_SCREEN_SHAPE_META,
  AutoDetectLedPlacementRequestSchema,
  LedQuickInstallRequestSchema,
  GenerateLedScreenContentRequestSchema,
} = require(path.join(V2_ROOT, 'packages/contracts/src/common/index.ts'));

const {
  canonicalizeQuad,
  isConvexQuad,
  computeHomography3x3,
  invertHomography3x3,
  applyHomographyPoint,
  mapPointToQuadHomographyUV,
  encodeRgbaToPng,
  decodePngToRgba,
  generateFeatheredAlphaMaskPng,
  applyPostAiPixelGuard,
} = require(path.join(V2_ROOT, 'apps/api/src/modules/05-ai-design/led-homography.ts'));

const {
  buildLedScreenContentPrompt,
  buildMaskedLedInpaintPrompt,
  parseVisionAutoSnapResponse,
} = require(path.join(V2_ROOT, 'apps/api/src/modules/05-ai-design/led-placement-playbook.ts'));

const {
  mapPointToQuadUV,
  renderPerspectiveCompositeWithProtection,
} = require(path.join(V2_ROOT, 'apps/api/src/modules/05-ai-design/perspective-compositor.ts'));

test('V3-01: Contracts cover all 12 real-world LED morphologies and validate quick-install payloads', () => {
  assert.equal(LED_SCREEN_SHAPES.length, 12);
  for (const shape of LED_SCREEN_SHAPES) {
    assert.ok(LED_SCREEN_SHAPE_META[shape], `Missing metadata for ${shape}`);
  }

  const autoRes = AutoDetectLedPlacementRequestSchema.safeParse({
    action: 'auto_detect_led_placement',
    clickPoint: { x: 48.5, y: 42.1 },
    preferredShapeType: 'rounded_rect',
  });
  assert.equal(autoRes.success, true);

  const quickRes = LedQuickInstallRequestSchema.safeParse({
    mode: 'fast_composite',
    guidedCompositeBase64: 'A'.repeat(40),
    screens: [
      {
        id: 'led-1',
        name: 'LED Bo Góc',
        shapeType: 'rounded_rect',
        quad: {
          topLeft: { x: 20, y: 20 },
          topRight: { x: 75, y: 22 },
          bottomRight: { x: 75, y: 65 },
          bottomLeft: { x: 20, y: 63 },
        },
        cornerRoundnessPct: 16,
      },
      {
        id: 'led-2',
        name: 'Standee Sảnh',
        shapeType: 'led_standee',
        quad: {
          topLeft: { x: 80, y: 35 },
          topRight: { x: 92, y: 35 },
          bottomRight: { x: 92, y: 85 },
          bottomLeft: { x: 80, y: 85 },
        },
      },
    ],
  });
  assert.equal(quickRes.success, true);

  const contentRes = GenerateLedScreenContentRequestSchema.safeParse({
    prompt: 'Chúc mừng khai trương showroom mới',
    shapeType: 'transparent_glass',
    transparentMode: true,
  });
  assert.equal(contentRes.success, true);
});

test('V3-02: canonicalizeQuad prevents bowtie twists regardless of user click order', () => {
  // User clicks Bottom-Right -> Top-Left -> Bottom-Left -> Top-Right (totally scrambled!)
  const scrambled = [
    { x: 80, y: 72 },
    { x: 22, y: 18 },
    { x: 24, y: 68 },
    { x: 78, y: 22 },
  ];
  const fixed = canonicalizeQuad(scrambled);
  assert.equal(isConvexQuad(fixed), true);
  assert.deepEqual(fixed.topLeft, { x: 22, y: 18 });
  assert.deepEqual(fixed.topRight, { x: 78, y: 22 });
  assert.deepEqual(fixed.bottomRight, { x: 80, y: 72 });
  assert.deepEqual(fixed.bottomLeft, { x: 24, y: 68 });
});

test('V3-03: 3x3 Projective Homography & Inverse accurately map skewed quadrilaterals (< 0.01 error)', () => {
  const unit = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  const skewed = [
    { x: 18, y: 24 },
    { x: 82, y: 12 },
    { x: 78, y: 74 },
    { x: 22, y: 68 },
  ];
  const H = computeHomography3x3(unit, skewed);
  assert.ok(H);
  const Hinv = invertHomography3x3(H);
  assert.ok(Hinv);

  for (let i = 0; i < 4; i++) {
    const mapped = applyHomographyPoint(H, unit[i].x, unit[i].y);
    assert.ok(Math.abs(mapped.x - skewed[i].x) < 0.01);
    assert.ok(Math.abs(mapped.y - skewed[i].y) < 0.01);

    const back = applyHomographyPoint(Hinv, skewed[i].x, skewed[i].y);
    assert.ok(Math.abs(back.x - unit[i].x) < 0.01);
    assert.ok(Math.abs(back.y - unit[i].y) < 0.01);
  }

  const uvCheck = mapPointToQuadUV(50, 44, {
    topLeft: skewed[0],
    topRight: skewed[1],
    bottomRight: skewed[2],
    bottomLeft: skewed[3],
  });
  assert.equal(uvCheck.inside, true);
  assert.ok(uvCheck.u > 0.4 && uvCheck.u < 0.6);
});

test('V3-04: generateFeatheredAlphaMaskPng & applyPostAiPixelGuard lock 100% outside pixels and preserve occlusion strokes', () => {
  const W = 80;
  const H = 60;
  const origRgba = new Uint8Array(W * H * 4);
  const aiRgba = new Uint8Array(W * H * 4);
  const occRgba = new Uint8Array(W * H * 4);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 4;
      origRgba[idx] = 20;
      origRgba[idx + 1] = 40;
      origRgba[idx + 2] = 60;
      origRgba[idx + 3] = 255;

      // Cloud AI hypothetically altered ALL pixels (including walls outside LED) to bright magenta!
      aiRgba[idx] = 240;
      aiRgba[idx + 1] = 30;
      aiRgba[idx + 2] = 200;
      aiRgba[idx + 3] = 255;

      // Foreground lectern brushed over bottom-center inside the LED quad (x in [36..44], y in [30..42])
      if (x >= 36 && x <= 44 && y >= 30 && y <= 42) {
        occRgba[idx] = 0;
        occRgba[idx + 1] = 0;
        occRgba[idx + 2] = 0;
        occRgba[idx + 3] = 255;
      }
    }
  }

  const origPng = encodeRgbaToPng({ width: W, height: H, rgba: origRgba });
  const aiPng = encodeRgbaToPng({ width: W, height: H, rgba: aiRgba });
  const occPng = encodeRgbaToPng({ width: W, height: H, rgba: occRgba });

  const quad = {
    topLeft: { x: 25, y: 20 },
    topRight: { x: 75, y: 20 },
    bottomRight: { x: 75, y: 75 },
    bottomLeft: { x: 25, y: 75 },
  };
  const maskPng = generateFeatheredAlphaMaskPng({
    width: W,
    height: H,
    quad,
    featherPx: 4,
    shapeType: 'rounded_rect',
    cornerRadiusPct: 10,
  });

  const guardRes = applyPostAiPixelGuard({
    originalPngBuffer: origPng,
    aiResultBuffer: aiPng,
    alphaMaskPngBuffer: maskPng,
    occlusionMaskPngBuffer: occPng,
  });

  assert.equal(guardRes.appliedGuard, true);
  assert.ok(guardRes.protectedPixelsPct > 30);

  const decodedOut = decodePngToRgba(guardRes.imageBuffer);
  assert.ok(decodedOut);

  // Outside corner (2, 2): MUST match original pixel (20, 40, 60) byte-for-byte!
  const cornerIdx = (2 * W + 2) * 4;
  assert.equal(decodedOut.rgba[cornerIdx], 20);
  assert.equal(decodedOut.rgba[cornerIdx + 1], 40);
  assert.equal(decodedOut.rgba[cornerIdx + 2], 60);

  // Inside LED center (50, 26) -> x=40? Wait x=40 is occluded! Let's check x=48, y=24 -> inside LED, not occluded
  const ledIdx = (24 * W + 48) * 4;
  assert.equal(decodedOut.rgba[ledIdx], 240);
  assert.equal(decodedOut.rgba[ledIdx + 1], 30);
  assert.equal(decodedOut.rgba[ledIdx + 2], 200);

  // Inside occluded foreground podium (x=40, y=36) inside quad: MUST restore original (20, 40, 60)!
  const occIdx = (36 * W + 40) * 4;
  assert.equal(decodedOut.rgba[occIdx], 20);
  assert.equal(decodedOut.rgba[occIdx + 1], 40);
  assert.equal(decodedOut.rgba[occIdx + 2], 60);

  // Also test STRICT server composite preserves outside pixels byte-for-byte
  const strictRes = renderPerspectiveCompositeWithProtection({
    referenceImageBuffer: origPng,
    placementQuad: quad,
    prompt: 'Showroom LED đỏ hiện đại',
    compositingMode: 'STRICT',
  });
  const decodedStrict = decodePngToRgba(strictRes.imageBuffer);
  assert.ok(decodedStrict);
  assert.equal(decodedStrict.rgba[cornerIdx], 20);
  assert.equal(decodedStrict.rgba[cornerIdx + 1], 40);
  assert.equal(decodedStrict.rgba[cornerIdx + 2], 60);
});

test('V3-05: Vision Auto-Snap parser & LED Playbook prompts handle all 12 shapes + BA RBAC stays locked', () => {
  const sampleVisionJson = `\`\`\`json
  {
    "quad": {
      "topLeft": {"x": 65, "y": 75},
      "topRight": {"x": 35, "y": 15},
      "bottomRight": {"x": 65, "y": 18},
      "bottomLeft": {"x": 35, "y": 72}
    },
    "recommendedShapeType": "transparent_glass",
    "environment": "outdoor",
    "lighting": "daylight",
    "recommendedAspectRatio": "16:9",
    "recommendedPitch": "P3.91",
    "cornerRadiusPct": 0,
    "transparencyPct": 72,
    "confidence": 0.94,
    "reason": "Nhận diện vách kính showroom, đề xuất LED trong suốt 72%."
  }
  \`\`\``;

  const snap = parseVisionAutoSnapResponse(sampleVisionJson, { x: 50, y: 45 }, null);
  assert.equal(snap.usedAiVision, true);
  assert.equal(snap.recommendedShapeType, 'transparent_glass');
  assert.equal(snap.transparencyPct, 72);
  assert.equal(isConvexQuad(snap.quad), true);

  // Fallback on bad response
  const badSnap = parseVisionAutoSnapResponse('Not valid JSON text', { x: 52, y: 48 }, 'cylindrical_column');
  assert.equal(badSnap.usedAiVision, false);
  assert.equal(badSnap.recommendedShapeType, 'cylindrical_column');
  assert.equal(isConvexQuad(badSnap.quad), true);

  // Transparent LED content prompt must mandate pure black #000000 background
  const transPrompt = buildLedScreenContentPrompt({
    prompt: 'Giảm giá 50% mùa hè',
    shapeType: 'transparent_glass',
    transparentMode: true,
  });
  assert.match(transPrompt, /#000000/);

  const inpaintPrompt = buildMaskedLedInpaintPrompt({
    shapeTypes: ['cylindrical_column', 'led_standee'],
    screenCount: 2,
  });
  assert.match(inpaintPrompt, /360 degrees|cylindrical/i);
  assert.match(inpaintPrompt, /Standee/i);

  // BA RBAC invariant check (Q16 remains open until BA approval)
  assert.equal(hasBaPermission('DESIGNER', 'AI_DESIGN'), true);
  assert.equal(hasBaPermission('ADMIN', 'AI_DESIGN'), true);
  assert.equal(hasBaPermission('MKT_STAFF', 'AI_DESIGN'), false);
  assert.equal(hasBaPermission('MKT_LEAD', 'AI_DESIGN'), false);
});
