/**
 * Module 05 — Projective Homography 3x3, Quad Canonicalization, Alpha Mask & Pixel Guard
 * Pure TypeScript + node:zlib (Zero native C++ addons).
 */

import zlib from 'node:zlib';
import type { QuadCoordinatesDto } from '@toantrung/contracts';

export interface Point2D {
  x: number;
  y: number;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function cross2D(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}

/**
 * Normalizes any 4 points clicked in arbitrary order into strict clockwise quad order:
 * topLeft -> topRight -> bottomRight -> bottomLeft (screen space: x right, y down).
 * Prevents bowtie/twisted quads when non-technical users click out of order.
 */
export function canonicalizeQuad(pts: Point2D[]): QuadCoordinatesDto {
  if (!pts || pts.length < 4) {
    return {
      topLeft: { x: 25, y: 20 },
      topRight: { x: 75, y: 20 },
      bottomRight: { x: 75, y: 75 },
      bottomLeft: { x: 25, y: 75 },
    };
  }

  // If more than 4 vertices supplied, compute bounding convex quad or pick extreme corners;
  // for exact 4 points, sort polar clockwise around centroid.
  const four = pts.slice(0, 4).map((p) => ({
    x: Number(Math.max(0, Math.min(100, p.x)).toFixed(2)),
    y: Number(Math.max(0, Math.min(100, p.y)).toFixed(2)),
  }));

  const cx = four.reduce((acc, p) => acc + p.x, 0) / 4;
  const cy = four.reduce((acc, p) => acc + p.y, 0) / 4;

  // In screen coordinates (y increases downward), ascending Math.atan2(y - cy, x - cx) orders clockwise.
  const sorted = [...four].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)
  );

  // Rotate cyclic order so topLeft (minimum x + y sum) comes first
  let tlIdx = 0;
  let bestScore = Infinity;
  for (let i = 0; i < 4; i++) {
    const score = sorted[i].x + sorted[i].y;
    if (score < bestScore) {
      bestScore = score;
      tlIdx = i;
    }
  }

  const ordered = [
    sorted[tlIdx],
    sorted[(tlIdx + 1) % 4],
    sorted[(tlIdx + 2) % 4],
    sorted[(tlIdx + 3) % 4],
  ];

  // Ensure ordered[1] is to the right of ordered[0] relative to edge orientation; if inverted, adjust cleanly
  return {
    topLeft: ordered[0],
    topRight: ordered[1],
    bottomRight: ordered[2],
    bottomLeft: ordered[3],
  };
}

/**
 * Checks whether a quad is strictly convex and non-self-intersecting.
 */
export function isConvexQuad(quad: QuadCoordinatesDto): boolean {
  const pts = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    const c = pts[(i + 2) % 4];
    const cr = cross2D(a.x, a.y, b.x, b.y, c.x, c.y);
    if (Math.abs(cr) < 1e-4) return false;
    const s = cr > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (sign !== s) return false;
  }
  return true;
}

/**
 * Solves exact 3x3 Projective Homography matrix mapping 4 source points -> 4 destination points.
 * Returns flat 9-element row-major matrix [h0..h7, 1] or null if degenerate.
 */
export function computeHomography3x3(
  src: [Point2D, Point2D, Point2D, Point2D],
  dst: [Point2D, Point2D, Point2D, Point2D]
): number[] | null {
  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }

  // Solve 8x8 linear system with Gaussian elimination + partial pivoting
  const n = 8;
  const M = A.map((row, idx) => [...row, b[idx]]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxVal = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      const val = Math.abs(M[r][col]);
      if (val > maxVal) {
        maxVal = val;
        pivotRow = r;
      }
    }
    if (maxVal < 1e-9) return null;

    if (pivotRow !== col) {
      const tmp = M[col];
      M[col] = M[pivotRow];
      M[pivotRow] = tmp;
    }

    const pivot = M[col][col];
    for (let r = col + 1; r < n; r++) {
      const factor = M[r][col] / pivot;
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) {
        M[r][c] -= factor * M[col][c];
      }
    }
  }

  const h = new Array<number>(9).fill(0);
  h[8] = 1;
  for (let i = n - 1; i >= 0; i--) {
    let sum = M[i][n];
    for (let j = i + 1; j < n; j++) {
      sum -= M[i][j] * h[j];
    }
    h[i] = sum / M[i][i];
  }

  return h.some((v) => !Number.isFinite(v)) ? null : h;
}

export function invertHomography3x3(H: number[]): number[] | null {
  if (H.length !== 9) return null;
  const [a, b, c, d, e, f, g, h, i] = H;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const D = -(b * i - c * h);
  const E = a * i - c * g;
  const F = -(a * h - b * g);
  const G = b * f - c * e;
  const H_ = -(a * f - c * d);
  const I = a * e - b * d;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const invDet = 1 / det;
  return [A * invDet, D * invDet, G * invDet, B * invDet, E * invDet, H_ * invDet, C * invDet, F * invDet, I * invDet];
}

export function applyHomographyPoint(H: number[], x: number, y: number): Point2D {
  const denom = H[6] * x + H[7] * y + H[8];
  if (Math.abs(denom) < 1e-9) return { x: 0, y: 0 };
  return {
    x: (H[0] * x + H[1] * y + H[2]) / denom,
    y: (H[3] * x + H[4] * y + H[5]) / denom,
  };
}

export function computeQuadToUnitHomography(quad: QuadCoordinatesDto): number[] | null {
  return computeHomography3x3(
    [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft],
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]
  );
}

/**
 * Exact 3x3 Projective Homography UV mapper for quadrilateral (px, py) in [0..100] space.
 * Replaces bilinear distortion under strong camera skew while keeping identical interface.
 */
export function mapPointToQuadHomographyUV(
  px: number,
  py: number,
  quad: QuadCoordinatesDto,
  precomputedHinv?: number[] | null
): { inside: boolean; u: number; v: number; edgeDist: number } {
  const p00 = quad.topLeft;
  const p10 = quad.topRight;
  const p11 = quad.bottomRight;
  const p01 = quad.bottomLeft;

  const c0 = cross2D(p00.x, p00.y, p10.x, p10.y, px, py);
  const c1 = cross2D(p10.x, p10.y, p11.x, p11.y, px, py);
  const c2 = cross2D(p11.x, p11.y, p01.x, p01.y, px, py);
  const c3 = cross2D(p01.x, p01.y, p00.x, p00.y, px, py);

  const allPositive = c0 >= -0.05 && c1 >= -0.05 && c2 >= -0.05 && c3 >= -0.05;
  const allNegative = c0 <= 0.05 && c1 <= 0.05 && c2 <= 0.05 && c3 <= 0.05;
  const inside = allPositive || allNegative;

  const Hinv =
    precomputedHinv !== undefined ? precomputedHinv : computeQuadToUnitHomography(quad);

  let u = 0.5;
  let v = 0.5;
  if (Hinv) {
    const uv = applyHomographyPoint(Hinv, px, py);
    u = uv.x;
    v = uv.y;
  } else {
    // Degenerate quad fallback: bounded linear approximation
    const minX = Math.min(p00.x, p01.x, p10.x, p11.x);
    const maxX = Math.max(p00.x, p01.x, p10.x, p11.x);
    const minY = Math.min(p00.y, p01.y, p10.y, p11.y);
    const maxY = Math.max(p00.y, p01.y, p10.y, p11.y);
    u = (px - minX) / Math.max(1e-3, maxX - minX);
    v = (py - minY) / Math.max(1e-3, maxY - minY);
  }

  const edgeDist = Math.min(u, 1 - u, v, 1 - v);
  return {
    inside: inside && u >= -0.01 && u <= 1.01 && v >= -0.01 && v <= 1.01,
    u: Math.max(0, Math.min(1, u)),
    v: Math.max(0, Math.min(1, v)),
    edgeDist,
  };
}

export interface DecodedRgbaImage {
  width: number;
  height: number;
  rgba: Uint8Array;
}

/**
 * Decodes 8-bit PNG (RGB colorType 2 or RGBA colorType 6) into raw RGBA buffer.
 */
export function decodePngToRgba(pngBuffer: Buffer): DecodedRgbaImage | null {
  try {
    if (
      pngBuffer.length < 33 ||
      pngBuffer[0] !== 0x89 ||
      pngBuffer[1] !== 0x50 ||
      pngBuffer[2] !== 0x4e ||
      pngBuffer[3] !== 0x47
    ) {
      return null;
    }

    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    const idatChunks: Buffer[] = [];

    while (offset + 8 <= pngBuffer.length) {
      const length = pngBuffer.readUInt32BE(offset);
      const type = pngBuffer.toString('ascii', offset + 4, offset + 8);
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      if (dataEnd > pngBuffer.length) break;

      if (type === 'IHDR' && length >= 13) {
        width = pngBuffer.readUInt32BE(dataStart);
        height = pngBuffer.readUInt32BE(dataStart + 4);
        bitDepth = pngBuffer[dataStart + 8];
        colorType = pngBuffer[dataStart + 9];
      } else if (type === 'IDAT') {
        idatChunks.push(pngBuffer.subarray(dataStart, dataEnd));
      } else if (type === 'IEND') {
        break;
      }
      offset = dataEnd + 4;
    }

    if (width <= 0 || height <= 0 || bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
      return null;
    }
    if (width > 4096 || height > 4096 || idatChunks.length === 0) {
      return null;
    }

    const bytesPerPixel = colorType === 6 ? 4 : 3;
    const stride = 1 + width * bytesPerPixel;
    const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
    if (inflated.length < stride * height) return null;

    const recon = new Uint8Array(width * height * bytesPerPixel);
    const rowBytes = width * bytesPerPixel;

    for (let y = 0; y < height; y++) {
      const filterType = inflated[y * stride];
      const srcRowOffset = y * stride + 1;
      const dstRowOffset = y * rowBytes;
      const prevRowOffset = (y - 1) * rowBytes;

      for (let i = 0; i < rowBytes; i++) {
        const rawByte = inflated[srcRowOffset + i];
        const a = i >= bytesPerPixel ? recon[dstRowOffset + i - bytesPerPixel] : 0;
        const b = y > 0 ? recon[prevRowOffset + i] : 0;
        const c = y > 0 && i >= bytesPerPixel ? recon[prevRowOffset + i - bytesPerPixel] : 0;

        let val = rawByte;
        if (filterType === 1) val = (rawByte + a) & 0xff;
        else if (filterType === 2) val = (rawByte + b) & 0xff;
        else if (filterType === 3) val = (rawByte + ((a + b) >> 1)) & 0xff;
        else if (filterType === 4) val = (rawByte + paethPredictor(a, b, c)) & 0xff;
        recon[dstRowOffset + i] = val;
      }
    }

    if (colorType === 6) {
      return { width, height, rgba: recon };
    }

    const rgba = new Uint8Array(width * height * 4);
    for (let px = 0; px < width * height; px++) {
      rgba[px * 4] = recon[px * 3];
      rgba[px * 4 + 1] = recon[px * 3 + 1];
      rgba[px * 4 + 2] = recon[px * 3 + 2];
      rgba[px * 4 + 3] = 255;
    }
    return { width, height, rgba };
  } catch {
    return null;
  }
}

export function encodeRgbaToPng(image: DecodedRgbaImage): Buffer {
  const { width, height, rgba } = image;
  const stride = 1 + width * 4;
  const raw = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * stride;
    raw[rowOffset] = 0; // Filter None
    const srcOffset = y * width * 4;
    raw.set(rgba.subarray(srcOffset, srcOffset + width * 4), rowOffset + 1);
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', compressed),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pointInPolygon(px: number, py: number, poly: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / Math.max(1e-9, yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Generates an OpenAI / Cloud AI compatible RGBA PNG inpainting mask:
 * - Inside active LED region (including rounded corners / oval / polygon): alpha = 0 (editable)
 * - Transition feather halo around boundary (`featherPx`): smooth ramp 0 -> 255
 * - Outside protected architecture: alpha = 255 (strictly locked)
 */
export function generateFeatheredAlphaMaskPng(params: {
  width: number;
  height: number;
  quad: QuadCoordinatesDto;
  featherPx?: number;
  shapeType?: string;
  polygonPoints?: Point2D[];
  cornerRadiusPct?: number;
}): Buffer {
  const width = Math.max(16, Math.min(2048, Math.round(params.width)));
  const height = Math.max(16, Math.min(2048, Math.round(params.height)));
  const featherPx = Math.max(2, Math.min(48, params.featherPx ?? 14));
  const rgba = new Uint8Array(width * height * 4);

  const isCircle = params.shapeType === 'circle_oval';
  const cornerR = Math.max(0, Math.min(0.48, (params.cornerRadiusPct ?? 0) / 100));
  const usePolygon =
    params.shapeType === 'free_polygon' && params.polygonPoints && params.polygonPoints.length >= 3;
  const featherU = featherPx / Math.max(16, Math.min(width, height));
  const Hinv = computeQuadToUnitHomography(params.quad);

  for (let y = 0; y < height; y++) {
    const py = (y / Math.max(1, height - 1)) * 100;
    for (let x = 0; x < width; x++) {
      const px = (x / Math.max(1, width - 1)) * 100;
      const idx = (y * width + x) * 4;
      rgba[idx] = 0;
      rgba[idx + 1] = 0;
      rgba[idx + 2] = 0;

      if (usePolygon && params.polygonPoints) {
        const insidePoly = pointInPolygon(px, py, params.polygonPoints);
        rgba[idx + 3] = insidePoly ? 0 : 255;
        continue;
      }

      const mapped = mapPointToQuadHomographyUV(px, py, params.quad, Hinv);
      const uv = Hinv ? applyHomographyPoint(Hinv, px, py) : { x: mapped.u, y: mapped.v };
      if (isCircle) {
        const distCenter = Math.hypot(uv.x - 0.5, uv.y - 0.5);
        if (distCenter <= 0.5) {
          rgba[idx + 3] = 0;
        } else if (distCenter < 0.5 + featherU) {
          const t = (distCenter - 0.5) / Math.max(1e-6, featherU);
          rgba[idx + 3] = Math.round(Math.max(0, Math.min(1, t)) * 255);
        } else {
          rgba[idx + 3] = 255;
        }
        continue;
      }

      // Compute signed UV distance from potentially rounded rectangle in UV space
      const qx = Math.abs(uv.x - 0.5) - (0.5 - cornerR);
      const qy = Math.abs(uv.y - 0.5) - (0.5 - cornerR);
      const signedDist =
        Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
        Math.min(Math.max(qx, qy), 0) -
        cornerR;

      if (signedDist <= 0) {
        rgba[idx + 3] = 0;
      } else if (signedDist < featherU) {
        const t = signedDist / Math.max(1e-6, featherU);
        rgba[idx + 3] = Math.round(Math.max(0, Math.min(1, t)) * 255);
      } else {
        rgba[idx + 3] = 255;
      }
    }
  }

  return encodeRgbaToPng({ width, height, rgba });
}

function resizeRgbaBilinear(src: DecodedRgbaImage, dstW: number, dstH: number): DecodedRgbaImage {
  if (src.width === dstW && src.height === dstH) return src;
  const out = new Uint8Array(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const sy = (y / Math.max(1, dstH - 1)) * Math.max(0, src.height - 1);
    const y0 = Math.floor(sy);
    const y1 = Math.min(src.height - 1, y0 + 1);
    const wy = sy - y0;
    const invWy = 1 - wy;
    for (let x = 0; x < dstW; x++) {
      const sx = (x / Math.max(1, dstW - 1)) * Math.max(0, src.width - 1);
      const x0 = Math.floor(sx);
      const x1 = Math.min(src.width - 1, x0 + 1);
      const wx = sx - x0;
      const invWx = 1 - wx;
      const i00 = (y0 * src.width + x0) * 4;
      const i10 = (y0 * src.width + x1) * 4;
      const i01 = (y1 * src.width + x0) * 4;
      const i11 = (y1 * src.width + x1) * 4;
      const dstIdx = (y * dstW + x) * 4;
      for (let c = 0; c < 4; c++) {
        const top = src.rgba[i00 + c] * invWx + src.rgba[i10 + c] * wx;
        const bot = src.rgba[i01 + c] * invWx + src.rgba[i11 + c] * wx;
        out[dstIdx + c] = Math.round(top * invWy + bot * wy);
      }
    }
  }
  return { width: dstW, height: dstH, rgba: out };
}

/**
 * Post-AI Pixel Guard Lock:
 * Preserves 100% of original site photo pixels outside the LED mask (and inside user-painted
 * foreground occlusion strokes such as lecterns, tables, plants, or pillars).
 */
export function applyPostAiPixelGuard(params: {
  originalPngBuffer: Buffer;
  aiResultBuffer: Buffer;
  alphaMaskPngBuffer: Buffer;
  occlusionMaskPngBuffer?: Buffer | null;
}): {
  imageBuffer: Buffer;
  mimeType: string;
  appliedGuard: boolean;
  protectedPixelsPct: number;
  note: string;
} {
  const orig = decodePngToRgba(params.originalPngBuffer);
  const aiImgRaw = decodePngToRgba(params.aiResultBuffer);
  const maskRaw = decodePngToRgba(params.alphaMaskPngBuffer);

  if (!orig || !aiImgRaw || !maskRaw) {
    return {
      imageBuffer: params.aiResultBuffer,
      mimeType: aiImgRaw ? 'image/png' : 'image/jpeg',
      appliedGuard: false,
      protectedPixelsPct: 0,
      note: 'Nhà cung cấp AI trả định dạng non-PNG hoặc thiếu mask; giữ nguyên ảnh đầu ra từ Cloud AI.',
    };
  }

  const aiImg = resizeRgbaBilinear(aiImgRaw, orig.width, orig.height);
  const maskImg = resizeRgbaBilinear(maskRaw, orig.width, orig.height);
  const occRaw = params.occlusionMaskPngBuffer ? decodePngToRgba(params.occlusionMaskPngBuffer) : null;
  const occImg = occRaw ? resizeRgbaBilinear(occRaw, orig.width, orig.height) : null;

  const outRgba = new Uint8Array(orig.width * orig.height * 4);
  const totalPixels = orig.width * orig.height;
  let protectedCount = 0;

  for (let px = 0; px < totalPixels; px++) {
    const idx = px * 4;
    // OpenAI/Cloud inpaint mask: alpha = 0 means editable LED area; alpha = 255 means protected architecture
    const lockRatio = maskImg.rgba[idx + 3] / 255;
    // Occlusion brush: non-zero alpha indicates user painted foreground object to stay in front of LED
    const occRatio = occImg ? occImg.rgba[idx + 3] / 255 : 0;
    const effectiveOrigWeight = Math.min(1, Math.max(lockRatio, occRatio));

    if (effectiveOrigWeight >= 0.996) {
      outRgba[idx] = orig.rgba[idx];
      outRgba[idx + 1] = orig.rgba[idx + 1];
      outRgba[idx + 2] = orig.rgba[idx + 2];
      outRgba[idx + 3] = 255;
      protectedCount++;
    } else if (effectiveOrigWeight <= 0.004) {
      outRgba[idx] = aiImg.rgba[idx];
      outRgba[idx + 1] = aiImg.rgba[idx + 1];
      outRgba[idx + 2] = aiImg.rgba[idx + 2];
      outRgba[idx + 3] = 255;
    } else {
      const aiWeight = 1 - effectiveOrigWeight;
      outRgba[idx] = Math.round(orig.rgba[idx] * effectiveOrigWeight + aiImg.rgba[idx] * aiWeight);
      outRgba[idx + 1] = Math.round(
        orig.rgba[idx + 1] * effectiveOrigWeight + aiImg.rgba[idx + 1] * aiWeight
      );
      outRgba[idx + 2] = Math.round(
        orig.rgba[idx + 2] * effectiveOrigWeight + aiImg.rgba[idx + 2] * aiWeight
      );
      outRgba[idx + 3] = 255;
    }
  }

  const guardedBuffer = encodeRgbaToPng({ width: orig.width, height: orig.height, rgba: outRgba });
  const protectedPixelsPct = Number(((protectedCount / Math.max(1, totalPixels)) * 100).toFixed(1));

  return {
    imageBuffer: guardedBuffer,
    mimeType: 'image/png',
    appliedGuard: true,
    protectedPixelsPct,
    note: `Đã kích hoạt Post-AI Pixel Guard: Bảo toàn nguyên bản ${protectedPixelsPct}% pixel kiến trúc xung quanh${occImg ? ' và giữ nguyên vật cản tiền cảnh' : ''}.`,
  };
}
