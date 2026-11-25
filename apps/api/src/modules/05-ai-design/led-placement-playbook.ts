/**
 * Module 05 — Toàn Trung LED Placement Playbook, Vision Auto-Snap & Approved Pattern Bank
 * Encapsulates domain engineering knowledge for 12 real-world LED morphologies without GPU training.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  LED_SCREEN_SHAPES,
  containsCustomerPiiInPrompt,
  type LedScreenShapeType,
  type QuadCoordinatesDto,
} from '@toantrung/contracts';
import { APP_CONFIG } from '../../core/config';
import { canonicalizeQuad } from './led-homography';

export interface LedContextPlaybookEntry {
  contextKey: string;
  label: string;
  defaultShapeType: LedScreenShapeType;
  recommendedPitch: string;
  brightnessNitsLabel: string;
  lightingGuidance: string;
}

export const LED_CONTEXT_PLAYBOOK: LedContextPlaybookEntry[] = [
  {
    contextKey: 'meeting_room',
    label: 'Phòng họp / Phòng điều hành',
    defaultShapeType: 'flat_rect',
    recommendedPitch: 'P1.53',
    brightnessNitsLabel: '800–1200 nits (dịu mắt, chống chói)',
    lightingGuidance: 'Soft anti-glare indoor LED luminance matching downlights with subtle reflection on conference table.',
  },
  {
    contextKey: 'auditorium_hall',
    label: 'Hội trường / Trung tâm hội nghị',
    defaultShapeType: 'flat_rect',
    recommendedPitch: 'P2.0',
    brightnessNitsLabel: '1200–1600 nits',
    lightingGuidance: 'Balanced stage-center LED brightness with crisp bezel framing and preserved foreground podium/lectern.',
  },
  {
    contextKey: 'showroom_glass',
    label: 'Showroom / Vách kính mặt tiền',
    defaultShapeType: 'transparent_glass',
    recommendedPitch: 'P3.91',
    brightnessNitsLabel: '3500–4500 nits (xuyên sáng kính)',
    lightingGuidance: 'Transparent glass LED display allowing interior shelves and lights to remain clearly visible behind dark pixels.',
  },
  {
    contextKey: 'mall_column',
    label: 'Cột trụ TTTM / Sân bay',
    defaultShapeType: 'cylindrical_column',
    recommendedPitch: 'P2.5',
    brightnessNitsLabel: '1500–2500 nits',
    lightingGuidance: 'Seamless 360-degree flexible LED cylinder wrapping the structural pillar with smooth cylindrical shading.',
  },
  {
    contextKey: 'corner_building_3d',
    label: 'Góc tòa nhà ngã tư 3D Naked-Eye',
    defaultShapeType: 'corner_90_smooth',
    recommendedPitch: 'P4.0',
    brightnessNitsLabel: '5000+ nits Outdoor',
    lightingGuidance: 'L-shaped/curved 3D corner outdoor billboard with high daylight contrast and clean weatherproof steel frame.',
  },
  {
    contextKey: 'curved_lobby',
    label: 'Sảnh lễ tân bo cong / Mái vòm',
    defaultShapeType: 'curved_arc',
    recommendedPitch: 'P1.86',
    brightnessNitsLabel: '1200 nits',
    lightingGuidance: 'Curved architectural flexible LED following curved wall geometry with soft glow on polished marble floor.',
  },
  {
    contextKey: 'standee_corridor',
    label: 'Sảnh chờ / Hành lang Standee GOB',
    defaultShapeType: 'led_standee',
    recommendedPitch: 'P1.86',
    brightnessNitsLabel: '1200 nits',
    lightingGuidance: 'Freestanding vertical GOB LED Standee resting naturally on floor with black steel base and soft contact shadow.',
  },
  {
    contextKey: 'stage_concert_multi',
    label: 'Sân khấu sự kiện đa màn hình / Sàn / Trần',
    defaultShapeType: 'curved_arc',
    recommendedPitch: 'P2.97',
    brightnessNitsLabel: '1800–3000 nits',
    lightingGuidance: 'Synchronized stage LED lighting harmonizing with beam spotlights and truss rigging.',
  },
];

export interface ApprovedLedPatternEntry {
  contextType: string;
  shapeType: LedScreenShapeType;
  brightnessPct: number;
  bezelThicknessPx: number;
  transparencyPct: number;
  cornerRoundnessPct: number;
  savedAt: string;
}

function getApprovedPatternsFilePath(): string {
  return path.join(APP_CONFIG.getStorageRoot(), 'config', 'led-approved-patterns.json');
}

export function getApprovedLedPatterns(limit = 8): ApprovedLedPatternEntry[] {
  try {
    const file = getApprovedPatternsFilePath();
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as ApprovedLedPatternEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(-limit).reverse();
  } catch {
    return [];
  }
}

export function recordApprovedLedPattern(entry: ApprovedLedPatternEntry): void {
  try {
    if (containsCustomerPiiInPrompt(entry.contextType).hasPii) return;
    const file = getApprovedPatternsFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let existing: ApprovedLedPatternEntry[] = [];
    if (fs.existsSync(file)) {
      try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
        if (Array.isArray(raw)) existing = raw;
      } catch {
        existing = [];
      }
    }
    existing.push({
      ...entry,
      contextType: entry.contextType.slice(0, 80),
      savedAt: new Date().toISOString(),
    });
    if (existing.length > 40) {
      existing = existing.slice(-40);
    }
    fs.writeFileSync(file, JSON.stringify(existing, null, 2), 'utf-8');
  } catch {
    // Non-fatal persistence
  }
}

export interface VisionAutoSnapResult {
  quad: QuadCoordinatesDto;
  recommendedShapeType: LedScreenShapeType;
  environment: 'indoor' | 'outdoor';
  lighting: 'daylight' | 'indoor_bright' | 'night_dim' | 'stage';
  recommendedAspectRatio: '16:9' | '4:3' | '21:9' | '32:9' | '9:16' | '1:1';
  recommendedPitch: string;
  cornerRadiusPct: number;
  transparencyPct: number;
  confidence: number;
  reason: string;
  usedAiVision: boolean;
}

export function buildVisionAutoSnapPrompt(params: {
  clickPoint?: { x: number; y: number } | null;
  preferredShapeType?: LedScreenShapeType | null;
}): string {
  const recentPatterns = getApprovedLedPatterns(4);
  const patternHint =
    recentPatterns.length > 0
      ? `Tham khảo các cấu hình Toàn Trung hay duyệt gần đây: ${recentPatterns
          .map((p) => `${p.shapeType} (sáng ${p.brightnessPct}%, bo ${p.cornerRoundnessPct}%)`)
          .join('; ')}.`
      : '';

  return [
    'Bạn là Kỹ sư trưởng khảo sát thi công màn hình LED của công ty Toàn Trung.',
    'Ảnh đính kèm có lưới tọa độ chuẩn hóa 0..100 theo phần trăm ảnh (X: trái 0 -> phải 100, Y: trên 0 -> dưới 100).',
    params.clickPoint
      ? `Người dùng vừa chạm 1 điểm ĐỎ tại tọa độ X=${params.clickPoint.x.toFixed(1)}%, Y=${params.clickPoint.y.toFixed(1)}%. Hãy bám đúng bề mặt (bức tường, cột trụ, vách kính, sân khấu, mặt sàn hoặc mặt tiền) chứa chấm đỏ này.`
      : 'Hãy tìm vị trí trung tâm đẹp và khả thi nhất trên công trình để lắp màn hình LED.',
    params.preferredShapeType
      ? `Người dùng đang ưu tiên kiểu màn hình "${params.preferredShapeType}". Hãy căn khung phù hợp nhất với kiểu này (nếu thật sự là bề mặt khác hẳn hãy giải thích nhẹ trong reason).`
      : `Chọn loại màn hình phù hợp nhất trong 12 mã sau: ${LED_SCREEN_SHAPES.join(', ')}.`,
    'Quy tắc gợi ý loại màn:',
    '- Vách kính showroom/mặt tiền kính -> transparent_glass (transparencyPct ~65)',
    '- Thân cột bê tông tròn/vuông sảnh -> cylindrical_column',
    '- Góc tường/mặt tiền 2 mặt giao nhau -> corner_90_smooth',
    '- Tường uốn cong bán nguyệt -> curved_arc',
    '- Sàn hành lang/sảnh đứng đặt cây -> led_standee',
    '- Tường phòng họp/hội trường -> flat_rect hoặc rounded_rect',
    patternHint,
    'CHỈ TRẢ VỀ ĐÚNG 1 OBJECT JSON HỢP LỆ (không markdown fence, không thêm text thừa) theo mẫu:',
    '{',
    '  "quad": { "topLeft": {"x": 20, "y": 18}, "topRight": {"x": 78, "y": 20}, "bottomRight": {"x": 78, "y": 65}, "bottomLeft": {"x": 20, "y": 63} },',
    '  "recommendedShapeType": "flat_rect",',
    '  "environment": "indoor",',
    '  "lighting": "indoor_bright",',
    '  "recommendedAspectRatio": "16:9",',
    '  "recommendedPitch": "P2.0",',
    '  "cornerRadiusPct": 0,',
    '  "transparencyPct": 0,',
    '  "confidence": 0.92,',
    '  "reason": "1 câu tiếng Việt ngắn gọn giải thích vị trí đã bám"',
    '}',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildFallbackAutoSnapAroundPoint(
  clickPoint?: { x: number; y: number } | null,
  preferredShapeType?: LedScreenShapeType | null,
  reasonNote?: string
): VisionAutoSnapResult {
  const shapeType: LedScreenShapeType = preferredShapeType || 'flat_rect';
  const cx = clickPoint ? Math.max(18, Math.min(82, clickPoint.x)) : 50;
  const cy = clickPoint ? Math.max(18, Math.min(80, clickPoint.y)) : 44;

  let halfW = 22;
  let halfH = 14;
  if (shapeType === 'led_standee') {
    halfW = 6.5;
    halfH = 22;
  } else if (shapeType === 'cylindrical_column') {
    halfW = 9;
    halfH = 25;
  } else if (shapeType === 'circle_oval') {
    halfW = 14;
    halfH = 18;
  } else if (shapeType === 'multi_segment_wave') {
    halfW = 28;
    halfH = 11;
  } else if (shapeType === 'led_floor') {
    halfW = 24;
    halfH = 11;
  }

  const quad = canonicalizeQuad([
    { x: Math.max(4, cx - halfW), y: Math.max(5, cy - halfH) },
    { x: Math.min(96, cx + halfW), y: Math.max(5, cy - halfH) },
    { x: Math.min(96, cx + halfW), y: Math.min(94, cy + halfH) },
    { x: Math.max(4, cx - halfW), y: Math.min(94, cy + halfH) },
  ]);

  return {
    quad,
    recommendedShapeType: shapeType,
    environment: shapeType === 'corner_90_smooth' ? 'outdoor' : 'indoor',
    lighting: 'indoor_bright',
    recommendedAspectRatio: shapeType === 'led_standee' ? '9:16' : '16:9',
    recommendedPitch: shapeType === 'transparent_glass' ? 'P3.91' : 'P2.0',
    cornerRadiusPct: shapeType === 'rounded_rect' ? 12 : 0,
    transparencyPct: shapeType === 'transparent_glass' ? 68 : 0,
    confidence: 0.65,
    reason:
      reasonNote ||
      'Đã đặt sẵn khung bám quanh vị trí bạn vừa chạm — bạn có thể kéo nhẹ 4 đỉnh để khít sát mép mong muốn.',
    usedAiVision: false,
  };
}

export function parseVisionAutoSnapResponse(
  rawText: string,
  clickPoint?: { x: number; y: number } | null,
  preferredShapeType?: LedScreenShapeType | null
): VisionAutoSnapResult {
  try {
    const cleaned = (rawText || '')
      .replace(/```json\s*/gi, '')
      .replace(/```/g, '')
      .trim();
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace <= firstBrace) {
      return buildFallbackAutoSnapAroundPoint(clickPoint, preferredShapeType);
    }

    const parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as {
      quad?: {
        topLeft?: { x: number; y: number };
        topRight?: { x: number; y: number };
        bottomRight?: { x: number; y: number };
        bottomLeft?: { x: number; y: number };
      };
      recommendedShapeType?: string;
      environment?: string;
      lighting?: string;
      recommendedAspectRatio?: string;
      recommendedPitch?: string;
      cornerRadiusPct?: number;
      transparencyPct?: number;
      confidence?: number;
      reason?: string;
    };

    const q = parsed.quad;
    if (!q?.topLeft || !q?.topRight || !q?.bottomRight || !q?.bottomLeft) {
      return buildFallbackAutoSnapAroundPoint(clickPoint, preferredShapeType);
    }

    const quad = canonicalizeQuad([q.topLeft, q.topRight, q.bottomRight, q.bottomLeft]);
    const validShape = LED_SCREEN_SHAPES.includes(parsed.recommendedShapeType as LedScreenShapeType)
      ? (parsed.recommendedShapeType as LedScreenShapeType)
      : preferredShapeType || 'flat_rect';

    const validEnv = parsed.environment === 'outdoor' ? 'outdoor' : 'indoor';
    const validLighting = (['daylight', 'indoor_bright', 'night_dim', 'stage'] as const).includes(
      parsed.lighting as 'daylight'
    )
      ? (parsed.lighting as VisionAutoSnapResult['lighting'])
      : 'indoor_bright';

    const validRatio = (['16:9', '4:3', '21:9', '32:9', '9:16', '1:1'] as const).includes(
      parsed.recommendedAspectRatio as '16:9'
    )
      ? (parsed.recommendedAspectRatio as VisionAutoSnapResult['recommendedAspectRatio'])
      : '16:9';

    return {
      quad,
      recommendedShapeType: validShape,
      environment: validEnv,
      lighting: validLighting,
      recommendedAspectRatio: validRatio,
      recommendedPitch:
        typeof parsed.recommendedPitch === 'string' && parsed.recommendedPitch.trim()
          ? parsed.recommendedPitch.trim().slice(0, 12)
          : validShape === 'transparent_glass'
            ? 'P3.91'
            : 'P2.0',
      cornerRadiusPct:
        typeof parsed.cornerRadiusPct === 'number' && Number.isFinite(parsed.cornerRadiusPct)
          ? Math.max(0, Math.min(45, Math.round(parsed.cornerRadiusPct)))
          : validShape === 'rounded_rect'
            ? 10
            : 0,
      transparencyPct:
        typeof parsed.transparencyPct === 'number' && Number.isFinite(parsed.transparencyPct)
          ? Math.max(0, Math.min(90, Math.round(parsed.transparencyPct)))
          : validShape === 'transparent_glass'
            ? 68
            : 0,
      confidence:
        typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
          ? Math.max(0.1, Math.min(1, Number(parsed.confidence.toFixed(2))))
          : 0.88,
      reason:
        typeof parsed.reason === 'string' && parsed.reason.trim()
          ? parsed.reason.trim().slice(0, 240)
          : `AI đã định vị khung ${validShape} khớp bề mặt tại điểm chạm.`,
      usedAiVision: true,
    };
  } catch {
    return buildFallbackAutoSnapAroundPoint(clickPoint, preferredShapeType);
  }
}

export function buildMaskedLedInpaintPrompt(params: {
  shapeTypes: LedScreenShapeType[];
  contextHint?: string | null;
  contentSummary?: string | null;
  screenCount: number;
}): string {
  const uniqueShapes = Array.from(new Set(params.shapeTypes));
  const shapeSpecificNotes: string[] = [];

  if (uniqueShapes.includes('transparent_glass')) {
    shapeSpecificNotes.push(
      'The transparent glass LED display sits cleanly behind storefront glass with subtle natural glass specular highlights while keeping architectural shelving/interior visible through dark display areas.'
    );
  }
  if (uniqueShapes.includes('cylindrical_column')) {
    shapeSpecificNotes.push(
      'The flexible LED display wraps seamlessly 360 degrees around the curved cylindrical column with smooth wraparound shading and crisp top/bottom metal trim rings.'
    );
  }
  if (uniqueShapes.includes('corner_90_smooth')) {
    shapeSpecificNotes.push(
      'The 3D corner LED display adheres seamlessly across the angled corner join with realistic steel cabinet framing and natural outdoor daylight contrast.'
    );
  }
  if (uniqueShapes.includes('led_standee')) {
    shapeSpecificNotes.push(
      'The freestanding vertical GOB LED Standee rests solidly on its metal floor base with realistic floor contact shadow.'
    );
  }
  if (uniqueShapes.includes('led_floor')) {
    shapeSpecificNotes.push(
      'The recessed tempered-glass LED stage floor exhibits subtle glossy floor specular reflections without altering surrounding people or furniture.'
    );
  }
  if (uniqueShapes.includes('rounded_rect') || uniqueShapes.includes('circle_oval') || uniqueShapes.includes('free_polygon')) {
    shapeSpecificNotes.push(
      'Preserve the exact custom contour (rounded corners, arch, oval, or polygonal edge) and slim brushed-aluminum trim neatly fitted to the wall.'
    );
  }

  return [
    `Photorealistically blend and harmonize ONLY the already-positioned ${params.screenCount > 1 ? `${params.screenCount} LED screens` : 'LED screen'} inside the masked area of the provided guided photo.`,
    'STRICT RULE: Keep 100% of the LED screen content, text, graphics, exact position, perspective angle, and size intact. Do NOT move, resize, crop, or replace objects, walls, ceiling, people, logos, or furniture outside the LED region.',
    'Only improve realistic physical integration along the LED bezel and light spill: crisp architectural cabinet bezel, subtle ambient wall/floor light reflection matching room lighting, realistic contact shadow.',
    ...shapeSpecificNotes,
    params.contentSummary ? `Displayed screen subject: ${params.contentSummary}.` : '',
    params.contextHint ? `Site environment: ${params.contextHint}.` : '',
    'Shot on DSLR architectural photography, ultra-clean realism, zero distortion.',
  ]
    .filter(Boolean)
    .join(' ');
}

export function buildLedScreenContentPrompt(params: {
  prompt: string;
  shapeType?: LedScreenShapeType | null;
  transparentMode?: boolean;
}): string {
  const isTransparent = Boolean(params.transparentMode || params.shapeType === 'transparent_glass');
  const isCircle = params.shapeType === 'circle_oval';

  return [
    params.prompt.trim(),
    isTransparent
      ? 'CRITICAL FOR TRANSPARENT GLASS LED: Use a 100% pure pitch-black (#000000) background so black pixels become transparent on glass; make ONLY the foreground glowing 3D graphics, vibrant light trails, product visuals, and crisp typography bright and high-contrast.'
      : 'Design a vibrant, ultra-sharp commercial LED display graphic filling 100% of the frame edge-to-edge with crisp Vietnamese/international typography, no room walls, no monitor bezel, no borders.',
    isCircle
      ? 'Keep main headline, emblem, and focal subject centered within a clean circular safe area inside the frame.'
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}
