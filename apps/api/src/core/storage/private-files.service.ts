import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { APP_CONFIG } from '../config';

export interface SavePrivateFileInput {
  bucket: string;
  prefix: string;
  fileBuffer: Buffer;
  declaredMimeType: string;
  originalFileName?: string;
  allowPdfOrDoc?: boolean;
}

export interface SavedPrivateFile {
  storageObjectKey: string;
  fileSizeBytes: number;
  sha256: string;
  mimeType: string;
  storagePath: string;
  sanitizedFileName: string;
}

export interface ReadPrivateFileResult {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}

function sanitizeFileName(name: string): string {
  return name
    .replace(/[^\w.-]/g, '_')
    .replace(/\.{2,}/g, '.')
    .toLowerCase();
}

function detectMimeType(buffer: Buffer, declared: string, ext: string): string {
  if (buffer.length >= 4 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return 'application/pdf';
  }
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }

  const normalizedExt = ext.toLowerCase();
  if (normalizedExt === '.pdf') return 'application/pdf';
  if (normalizedExt === '.png') return 'image/png';
  if (normalizedExt === '.jpg' || normalizedExt === '.jpeg') return 'image/jpeg';
  if (normalizedExt === '.webp') return 'image/webp';
  if (normalizedExt === '.gif') return 'image/gif';
  if (normalizedExt === '.svg') return 'image/svg+xml';
  if (normalizedExt === '.bmp') return 'image/bmp';
  if (normalizedExt === '.heic' || normalizedExt === '.heif') return 'image/heic';
  if (normalizedExt === '.doc') return 'application/msword';
  if (normalizedExt === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (normalizedExt === '.xls') return 'application/vnd.ms-excel';
  if (normalizedExt === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (normalizedExt === '.csv') return 'text/csv; charset=utf-8';
  if (normalizedExt === '.ppt') return 'application/vnd.ms-powerpoint';
  if (normalizedExt === '.pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (normalizedExt === '.txt') return 'text/plain; charset=utf-8';
  if (normalizedExt === '.zip') return 'application/zip';
  if (normalizedExt === '.rar') return 'application/vnd.rar';
  if (normalizedExt === '.7z') return 'application/x-7z-compressed';
  if (normalizedExt === '.dwg') return 'image/vnd.dwg';
  if (normalizedExt === '.dxf') return 'image/vnd.dxf';
  if (normalizedExt === '.mp4') return 'video/mp4';
  if (normalizedExt === '.mov') return 'video/quicktime';
  if (normalizedExt === '.webm') return 'video/webm';

  return declared || 'application/octet-stream';
}

const BLOCKED_UPLOAD_EXTENSIONS = new Set([
  '.html',
  '.htm',
  '.xhtml',
  '.svg',
  '.svgz',
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.tsx',
  '.php',
  '.sh',
  '.bat',
  '.cmd',
  '.ps1',
  '.exe',
  '.dll',
  '.msi',
  '.vbs',
  '.jar',
]);

function hasDisguisedExecutableMarkup(buffer: Buffer): boolean {
  const head = buffer
    .subarray(0, Math.min(buffer.length, 512))
    .toString('utf8')
    .replace(/\0/g, '')
    .toLowerCase();
  return (
    head.includes('<svg') ||
    head.includes('<script') ||
    head.includes('<!doctype html') ||
    head.includes('<html') ||
    head.includes('javascript:')
  );
}

export function savePrivateBusinessFile(input: SavePrivateFileInput): SavedPrivateFile {
  if (!input.fileBuffer || input.fileBuffer.length === 0) {
    throw new Error('Tệp tải lên không được rỗng.');
  }

  if (input.fileBuffer.length > APP_CONFIG.maxAttachmentSizeBytes) {
    throw new Error(`Kích thước tệp vượt quá giới hạn tối đa (${APP_CONFIG.maxAttachmentSizeBytes / (1024 * 1024)} MB).`);
  }

  const rawExt = input.originalFileName ? path.extname(input.originalFileName) : '.png';
  const baseName = input.originalFileName ? path.basename(input.originalFileName, rawExt) : 'file';
  const cleanExt = rawExt.toLowerCase() || '.bin';

  if (
    BLOCKED_UPLOAD_EXTENSIONS.has(cleanExt) ||
    /image\/svg\+xml|text\/html|application\/javascript|text\/javascript/i.test(
      input.declaredMimeType || '',
    ) ||
    hasDisguisedExecutableMarkup(input.fileBuffer)
  ) {
    throw new Error(
      'Định dạng tệp không được phép tải lên vì lý do bảo mật (chặn SVG/HTML/Script thực thi).',
    );
  }

  const cleanBase = sanitizeFileName(baseName);
  const sanitizedFileName = `${cleanBase}${cleanExt}`;

  const mimeType = detectMimeType(input.fileBuffer, input.declaredMimeType, cleanExt);
  const sha256 = crypto.createHash('sha256').update(input.fileBuffer).digest('hex');

  const safeBucket = sanitizeFileName(input.bucket || 'general');
  const safePrefix = sanitizeFileName(input.prefix || 'upload');
  const randomSuffix = crypto.randomUUID().slice(0, 8);
  const objectFileName = `${safePrefix}-${randomSuffix}-${sha256.slice(0, 8)}${cleanExt}`;
  const storageObjectKey = `${safeBucket}/${objectFileName}`;

  const bucketDir = path.join(APP_CONFIG.getStorageRoot(), safeBucket);
  fs.mkdirSync(bucketDir, { recursive: true });

  const storagePath = path.join(bucketDir, objectFileName);
  fs.writeFileSync(storagePath, input.fileBuffer);

  return {
    storageObjectKey,
    fileSizeBytes: input.fileBuffer.length,
    sha256,
    mimeType,
    storagePath,
    sanitizedFileName,
  };
}

export function resolvePrivateBusinessFilePath(storageObjectKeyOrPath: string): string | null {
  if (!storageObjectKeyOrPath || typeof storageObjectKeyOrPath !== 'string') return null;

  const normalizedKey = storageObjectKeyOrPath.replace(/\\/g, '/').trim();
  if (
    !normalizedKey ||
    normalizedKey.includes('\0') ||
    normalizedKey.startsWith('/') ||
    /^[a-zA-Z]:/.test(normalizedKey) ||
    normalizedKey.split('/').includes('..') ||
    normalizedKey.split('/').includes('.')
  ) {
    return null;
  }

  const rootResolved = path.resolve(APP_CONFIG.getStorageRoot());
  const fullPath = path.resolve(rootResolved, normalizedKey);
  if (!fullPath.startsWith(rootResolved + path.sep)) {
    return null;
  }

  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
    return fullPath;
  }

  const base = path.basename(normalizedKey);
  if (!base || base === '.' || base === '..' || !/^[a-zA-Z0-9._-]+$/.test(base)) {
    return null;
  }
  const candidateBuckets = ['leads', 'design', 'avatars', 'branding'];
  for (const b of candidateBuckets) {
    const p = path.resolve(rootResolved, b, base);
    if (p.startsWith(rootResolved + path.sep) && fs.existsSync(p) && fs.statSync(p).isFile()) {
      return p;
    }
  }

  // Fallback read-only check against legacy ./storage folder so historical uploads do not 404
  const legacyRoot = path.resolve(rootResolved, '..', 'storage');
  if (legacyRoot !== rootResolved && fs.existsSync(legacyRoot)) {
    const legacyFullPath = path.resolve(legacyRoot, normalizedKey);
    if (
      legacyFullPath.startsWith(legacyRoot + path.sep) &&
      fs.existsSync(legacyFullPath) &&
      fs.statSync(legacyFullPath).isFile()
    ) {
      return legacyFullPath;
    }
    for (const b of candidateBuckets) {
      const p = path.resolve(legacyRoot, b, base);
      if (p.startsWith(legacyRoot + path.sep) && fs.existsSync(p) && fs.statSync(p).isFile()) {
        return p;
      }
    }
  }
  return null;
}

export function readPrivateBusinessFile(storageObjectKeyOrPath: string): ReadPrivateFileResult | null {
  const fullPath = resolvePrivateBusinessFilePath(storageObjectKeyOrPath);
  if (!fullPath) return null;

  try {
    const buffer = fs.readFileSync(fullPath);
    const ext = path.extname(fullPath);
    const mimeType = detectMimeType(buffer, '', ext);
    const fileName = path.basename(fullPath);
    return {
      buffer,
      mimeType,
      fileName,
    };
  } catch {
    return null;
  }
}

export function deletePrivateBusinessFile(storageObjectKeyOrPath: string): void {
  if (!storageObjectKeyOrPath || typeof storageObjectKeyOrPath !== 'string') return;
  const normalizedKey = storageObjectKeyOrPath.replace(/\\/g, '/').trim();
  if (
    !normalizedKey ||
    normalizedKey.includes('\0') ||
    normalizedKey.startsWith('/') ||
    /^[a-zA-Z]:/.test(normalizedKey) ||
    normalizedKey.split('/').includes('..')
  ) {
    return;
  }
  try {
    const rootResolved = path.resolve(APP_CONFIG.getStorageRoot());
    const fullPath = path.resolve(rootResolved, normalizedKey);
    if (!fullPath.startsWith(rootResolved + path.sep)) return;
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      fs.unlinkSync(fullPath);
    }
  } catch {
    // Ignore file deletion errors
  }
}

export interface BackupBusinessFileEntry {
  relativeKey: string;
  sizeBytes: number;
  sha256: string;
}

const BUSINESS_FILE_BUCKETS = ['leads', 'design', 'avatars', 'branding', 'reports'] as const;

export function copyAndHashBusinessFilesForBackup(backupFilesDir: string): BackupBusinessFileEntry[] {
  const rootResolved = path.resolve(APP_CONFIG.getStorageRoot());
  const manifestEntries: BackupBusinessFileEntry[] = [];
  fs.mkdirSync(backupFilesDir, { recursive: true });

  for (const bucket of BUSINESS_FILE_BUCKETS) {
    const srcBucketDir = path.join(rootResolved, bucket);
    if (!fs.existsSync(srcBucketDir) || !fs.statSync(srcBucketDir).isDirectory()) continue;

    const stack: string[] = [srcBucketDir];
    while (stack.length > 0) {
      const currentDir = stack.pop()!;
      for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
        const fullSrcPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullSrcPath);
        } else if (entry.isFile()) {
          const relKey = path.relative(rootResolved, fullSrcPath).replace(/\\/g, '/');
          const destPath = path.join(backupFilesDir, relKey);
          fs.mkdirSync(path.dirname(destPath), { recursive: true });
          const buf = fs.readFileSync(fullSrcPath);
          fs.writeFileSync(destPath, buf);
          manifestEntries.push({
            relativeKey: relKey,
            sizeBytes: buf.length,
            sha256: crypto.createHash('sha256').update(buf).digest('hex'),
          });
        }
      }
    }
  }

  return manifestEntries.sort((a, b) => a.relativeKey.localeCompare(b.relativeKey));
}

