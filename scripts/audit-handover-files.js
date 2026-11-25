'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PrismaClient } = require('@prisma/client');

const REPO_ROOT = path.resolve(__dirname, '..');
const SQLITE_PATH = path.join(REPO_ROOT, 'packages', 'database', 'prisma', 'independent_v2.db');
const STORAGE_DIR = path.join(REPO_ROOT, 'storage_independent_v2');
const PUBLIC_DIR = path.join(REPO_ROOT, 'apps', 'web', 'public');
const OUT_DIR = path.join(REPO_ROOT, 'storage', 'pg-migration-artifacts');
const MANIFEST_PATH = path.join(OUT_DIR, 'file-handover-manifest.json');

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function walkFiles(dir, baseDir = REPO_ROOT) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip temporary restore check dir if present
      if (entry.name === 'restore-file-check') continue;
      results.push(...walkFiles(full, baseDir));
    } else if (entry.isFile()) {
      const stat = fs.statSync(full);
      results.push({
        absPath: full,
        relPath: path.relative(baseDir, full).replace(/\\/g, '/'),
        sizeBytes: stat.size,
        sha256: sha256File(full),
      });
    }
  }
  return results;
}

function collectCodeReferencedPublicPaths() {
  const srcDirs = [
    path.join(REPO_ROOT, 'apps', 'web', 'src'),
    path.join(REPO_ROOT, 'apps', 'api', 'src'),
    path.join(REPO_ROOT, 'packages', 'database'),
  ];
  const allCode = [];
  function readCode(d) {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && e.name !== 'node_modules' && e.name !== '.next' && e.name !== 'generated') {
        readCode(p);
      } else if (e.isFile() && /\.(ts|tsx|js|json)$/.test(e.name)) {
        allCode.push(fs.readFileSync(p, 'utf8'));
      }
    }
  }
  for (const d of srcDirs) readCode(d);
  return allCode.join('\n');
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  const dbUrl = `file:${SQLITE_PATH.replace(/\\/g, '/')}`;
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

  try {
    const storageFiles = walkFiles(STORAGE_DIR);
    const publicFiles = walkFiles(PUBLIC_DIR);
    const allPhysicalFiles = [...storageFiles, ...publicFiles];

    const [
      leadAttachments,
      designVersions,
      designRequests,
      brandingAssets,
      priceCheckAlerts,
      users,
      systemSettings,
    ] = await Promise.all([
      prisma.leadAttachment.findMany({
        select: { id: true, leadId: true, fileName: true, fileUrl: true, fileSizeKb: true, attachmentType: true },
      }),
      prisma.designAssetVersion.findMany({
        select: { id: true, designRequestId: true, versionNumber: true, storageObjectKey: true, mimeType: true, fileSizeBytes: true, parametersJson: true },
      }),
      prisma.designRequest.findMany({
        select: { id: true, leadId: true, sitePhotoUrl: true, aiDraftImageUrl: true, finalRenderUrl: true },
      }),
      prisma.brandingAsset.findMany({
        select: { id: true, slot: true, objectKey: true, mimeType: true, fileSizeBytes: true, sha256: true, isActive: true },
      }),
      prisma.priceCheckAlert.findMany({
        select: { id: true, leadId: true, chatScreenshotUrl: true },
      }),
      prisma.user.findMany({
        select: { id: true, email: true, avatarUrl: true },
      }),
      prisma.systemSetting.findMany(),
    ]);

    // Map from normalized relPath -> array of DB references
    const dbRefMap = new Map();
    function addDbRef(relPath, refInfo) {
      const norm = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
      const arr = dbRefMap.get(norm) || [];
      arr.push(refInfo);
      dbRefMap.set(norm, arr);
    }

    function resolveKeyToRelPaths(rawKey) {
      if (!rawKey || typeof rawKey !== 'string') return [];
      const k = rawKey.trim();
      if (!k) return [];
      const candidates = [];
      if (k.startsWith('/api/v1/settings/branding/asset/')) {
        const objKey = decodeURIComponent(k.replace('/api/v1/settings/branding/asset/', '').split('?')[0]);
        candidates.push(`storage_independent_v2/branding/${objKey}`);
        candidates.push(`storage_independent_v2/avatars/${objKey}`);
        candidates.push(`storage_independent_v2/${objKey}`);
      } else if (k.startsWith('/api/v1/profile/avatar')) {
        const u = new URL(k, 'http://localhost:3000');
        const keyParam = u.searchParams.get('key') || k.replace(/^\/api\/v1\/profile\/avatar\/?/, '').split('?')[0];
        if (keyParam) {
          const decoded = decodeURIComponent(keyParam).replace(/^\/+/, '');
          candidates.push(`storage_independent_v2/avatars/${decoded}`);
          candidates.push(`storage_independent_v2/${decoded}`);
        }
      } else if (k.startsWith('/api/v1/design/asset-file')) {
        const u = new URL(k, 'http://localhost:3000');
        const keyParam = u.searchParams.get('key');
        if (keyParam) {
          candidates.push(`storage_independent_v2/${keyParam.replace(/^\/+/, '')}`);
        }
      } else if (k.startsWith('/brand/') || k.startsWith('/demo-designs/') || k.startsWith('/uploads/')) {
        candidates.push(`apps/web/public${k}`);
        candidates.push(`storage_independent_v2${k}`);
      } else if (k.startsWith('design/') || k.startsWith('branding/') || k.startsWith('leads/') || k.startsWith('avatars/') || k.startsWith('config/')) {
        candidates.push(`storage_independent_v2/${k}`);
        candidates.push(`apps/web/public/${k}`);
      } else {
        const clean = k.replace(/^\/+/, '');
        candidates.push(`storage_independent_v2/${clean}`);
        candidates.push(`storage_independent_v2/design/${clean}`);
        candidates.push(`storage_independent_v2/leads/${clean}`);
        candidates.push(`storage_independent_v2/branding/${clean}`);
        candidates.push(`storage_independent_v2/avatars/${clean}`);
        candidates.push(`apps/web/public/${clean}`);
      }
      return candidates;
    }

    // 1. LeadAttachment
    for (const att of leadAttachments) {
      for (const cand of resolveKeyToRelPaths(att.fileUrl)) {
        addDbRef(cand, {
          table: 'lead_attachments',
          recordId: att.id,
          parentId: att.leadId,
          column: 'file_url',
          rawValue: att.fileUrl,
          appEndpoint: `/api/v1/leads/attachments/${att.id}`,
        });
      }
    }

    // 2. DesignAssetVersion
    for (const dv of designVersions) {
      for (const cand of resolveKeyToRelPaths(dv.storageObjectKey)) {
        addDbRef(cand, {
          table: 'design_asset_versions',
          recordId: dv.id,
          parentId: dv.designRequestId,
          column: 'storage_object_key',
          rawValue: dv.storageObjectKey,
          appEndpoint: `/api/v1/design/asset-file?key=${encodeURIComponent(dv.storageObjectKey.replace(/^\/+/, ''))}`,
        });
      }
      if (dv.parametersJson) {
        try {
          const parsed = JSON.parse(dv.parametersJson);
          const refKeys = Array.isArray(parsed.referenceAssetKeys) ? parsed.referenceAssetKeys : [];
          for (const rk of refKeys) {
            for (const cand of resolveKeyToRelPaths(rk)) {
              addDbRef(cand, {
                table: 'design_asset_versions',
                recordId: dv.id,
                parentId: dv.designRequestId,
                column: 'parameters_json.referenceAssetKeys',
                rawValue: rk,
                appEndpoint: `/api/v1/design/asset-file?key=${encodeURIComponent(String(rk).replace(/^\/+/, ''))}`,
              });
            }
          }
        } catch {
          // ignore
        }
      }
    }

    // 2b. BrandingAsset
    for (const ba of brandingAssets) {
      for (const cand of resolveKeyToRelPaths(ba.objectKey)) {
        addDbRef(cand, {
          table: 'branding_assets',
          recordId: ba.id,
          slot: ba.slot,
          column: 'object_key',
          rawValue: ba.objectKey,
          appEndpoint: `/api/v1/settings/branding/asset/${encodeURIComponent(ba.objectKey)}`,
        });
      }
    }

    // 2c. PriceCheckAlert
    for (const pca of priceCheckAlerts) {
      if (!pca.chatScreenshotUrl) continue;
      for (const cand of resolveKeyToRelPaths(pca.chatScreenshotUrl)) {
        addDbRef(cand, {
          table: 'price_check_alerts',
          recordId: pca.id,
          parentId: pca.leadId,
          column: 'chat_screenshot_url',
          rawValue: pca.chatScreenshotUrl,
          appEndpoint: pca.chatScreenshotUrl,
        });
      }
    }

    // 3. DesignRequest (sitePhotoUrl, aiDraftImageUrl, finalRenderUrl)
    for (const dr of designRequests) {
      for (const col of ['sitePhotoUrl', 'aiDraftImageUrl', 'finalRenderUrl']) {
        const keyStr = dr[col];
        if (!keyStr) continue;
        for (const cand of resolveKeyToRelPaths(keyStr)) {
          addDbRef(cand, {
            table: 'design_requests',
            recordId: dr.id,
            leadId: dr.leadId,
            column: col,
            rawValue: keyStr,
            appEndpoint: keyStr.startsWith('/')
              ? keyStr
              : `/api/v1/design/asset-file?key=${encodeURIComponent(keyStr.replace(/^\/+/, ''))}`,
          });
        }
      }
    }

    // 4. User.avatarUrl
    for (const u of users) {
      if (!u.avatarUrl) continue;
      for (const cand of resolveKeyToRelPaths(u.avatarUrl)) {
        addDbRef(cand, {
          table: 'users',
          recordId: u.id,
          email: u.email,
          column: 'avatar_url',
          rawValue: u.avatarUrl,
          appEndpoint: u.avatarUrl,
        });
      }
    }

    // 5. SystemSetting (branding_assets_v1)
    for (const st of systemSettings) {
      if (st.key === 'branding_assets_v1' && st.value) {
        try {
          const parsed = JSON.parse(st.value);
          for (const slotKey of ['logo', 'loginHero', 'dashboardBanner']) {
            const slotObj = parsed[slotKey];
            const urlVal = slotObj?.url || slotObj?.imageUrl || slotObj?.objectKey;
            if (urlVal) {
              for (const cand of resolveKeyToRelPaths(urlVal)) {
                addDbRef(cand, {
                  table: 'system_settings',
                  recordId: st.key,
                  column: `value.${slotKey}`,
                  rawValue: urlVal,
                  appEndpoint: urlVal.startsWith('/') ? urlVal : `/api/v1/settings/branding/asset/${encodeURIComponent(urlVal)}`,
                });
              }
            }
          }
        } catch {
          // ignore
        }
      }
    }

    const codeCorpus = collectCodeReferencedPublicPaths();

    const classifiedFiles = [];
    const summaryCounts = {
      totalPhysicalFiles: allPhysicalFiles.length,
      REFERENCED_IN_DB: 0,
      SYSTEM_STATIC_ASSET: 0,
      BACKUP_ARCHIVE: 0,
      ORPHAN_UNREFERENCED: 0,
      handoverRequiredCount: 0,
    };

    for (const file of allPhysicalFiles) {
      const dbRefs = dbRefMap.get(file.relPath) || [];
      const baseName = path.basename(file.relPath);
      let category = 'ORPHAN_UNREFERENCED';
      let handoverAction = 'EXCLUDE_OR_ARCHIVE_CLEANUP';
      let reason = 'Tệp sinh ra từ các lần chạy thử nghiệm cũ, không còn bản ghi DB nào tham chiếu';

      if (dbRefs.length > 0) {
        category = 'REFERENCED_IN_DB';
        handoverAction = 'MANDATORY_HANDOVER';
        reason = `Đang được tham chiếu trực tiếp bởi ${dbRefs.length} bản ghi trong DB (${Array.from(new Set(dbRefs.map((r) => `${r.table}.${r.column}`))).join(', ')})`;
      } else if (
        file.relPath.startsWith('storage_independent_v2/backups/') ||
        file.relPath.startsWith('storage/backups/') ||
        file.relPath.startsWith('storage/pg-migration-artifacts/')
      ) {
        category = 'BACKUP_ARCHIVE';
        handoverAction = 'ARCHIVE_RETENTION';
        reason = 'Bản sao lưu cơ sở dữ liệu (SQLite / PostgreSQL dump) và manifest kiểm toán chuyển đổi';
      } else if (
        file.relPath.startsWith('storage_independent_v2/config/') ||
        (file.relPath.startsWith('apps/web/public/') &&
          (codeCorpus.includes(baseName) || file.relPath.includes('/brand/') || file.relPath.includes('/demo-designs/')))
      ) {
        category = 'SYSTEM_STATIC_ASSET';
        handoverAction = 'MANDATORY_HANDOVER';
        reason = 'Tài sản thương hiệu / cấu hình hệ thống / giao diện nằm trong apps/web/public hoặc storage_independent_v2/config được mã nguồn sử dụng';
      }

      summaryCounts[category] = (summaryCounts[category] || 0) + 1;
      if (handoverAction === 'MANDATORY_HANDOVER') {
        summaryCounts.handoverRequiredCount += 1;
      }

      classifiedFiles.push({
        relPath: file.relPath,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
        category,
        handoverAction,
        reason,
        dbReferences: dbRefs,
      });
    }

    // Verify if any DB reference points to a missing file on disk!
    const physicalPathSet = new Set(allPhysicalFiles.map((f) => f.relPath));
    const brokenDbLinks = [];
    // Check DesignAssetVersion
    for (const dv of designVersions) {
      const cands = resolveKeyToRelPaths(dv.storageObjectKey);
      const hit = cands.find((c) => physicalPathSet.has(c));
      if (!hit) {
        brokenDbLinks.push({ table: 'design_asset_versions', id: dv.id, key: dv.storageObjectKey });
      }
    }
    // Check LeadAttachment
    for (const att of leadAttachments) {
      const cands = resolveKeyToRelPaths(att.fileUrl);
      const hit = cands.find((c) => physicalPathSet.has(c));
      if (!hit) {
        brokenDbLinks.push({ table: 'lead_attachments', id: att.id, key: att.fileUrl });
      }
    }
    // Check BrandingAsset
    for (const ba of brandingAssets) {
      const cands = resolveKeyToRelPaths(ba.objectKey);
      const hit = cands.find((c) => physicalPathSet.has(c));
      if (!hit) {
        brokenDbLinks.push({ table: 'branding_assets', id: ba.id, key: ba.objectKey });
      }
    }
    // Check User.avatarUrl
    for (const u of users) {
      if (!u.avatarUrl) continue;
      const cands = resolveKeyToRelPaths(u.avatarUrl);
      const hit = cands.find((c) => physicalPathSet.has(c));
      if (!hit) {
        brokenDbLinks.push({ table: 'users', id: u.id, key: u.avatarUrl });
      }
    }

    // Trial restore check: copy all REFERENCED_IN_DB files to a temporary restore folder and verify SHA-256
    const restoreDir = path.join(OUT_DIR, 'restore-file-check');
    if (fs.existsSync(restoreDir)) {
      fs.rmSync(restoreDir, { recursive: true, force: true });
    }
    fs.mkdirSync(restoreDir, { recursive: true });

    const referencedFiles = classifiedFiles.filter((f) => f.category === 'REFERENCED_IN_DB');
    let restoredVerifiedCount = 0;
    for (const rf of referencedFiles) {
      const srcAbs = path.join(REPO_ROOT, rf.relPath);
      const dstAbs = path.join(restoreDir, rf.relPath);
      fs.mkdirSync(path.dirname(dstAbs), { recursive: true });
      fs.copyFileSync(srcAbs, dstAbs);
      const restoredHash = sha256File(dstAbs);
      if (restoredHash === rf.sha256) {
        restoredVerifiedCount += 1;
      }
    }
    // Clean up temporary restore copies after verification
    fs.rmSync(restoreDir, { recursive: true, force: true });

    const report = {
      generatedAt: new Date().toISOString(),
      sqliteSourcePath: 'packages/database/prisma/independent_v2.db',
      dbFileBearingRecordCounts: {
        lead_attachments: leadAttachments.length,
        design_asset_versions: designVersions.length,
        design_requests: designRequests.length,
        branding_assets: brandingAssets.length,
        price_check_alerts_with_screenshot: priceCheckAlerts.filter((x) => !!x.chatScreenshotUrl).length,
        users_with_avatar: users.filter((x) => !!x.avatarUrl).length,
      },
      summaryCounts,
      brokenDbLinksCount: brokenDbLinks.length,
      brokenDbLinks,
      restoreTrialVerification: {
        testedFilesCount: referencedFiles.length,
        verifiedMatchCount: restoredVerifiedCount,
        allChecksumMatched: restoredVerifiedCount === referencedFiles.length,
      },
      referencedInDbDetails: referencedFiles,
      systemStaticAssets: classifiedFiles.filter((f) => f.category === 'SYSTEM_STATIC_ASSET'),
      backupArchives: classifiedFiles.filter((f) => f.category === 'BACKUP_ARCHIVE'),
      orphanUnreferencedSummary: {
        count: summaryCounts.ORPHAN_UNREFERENCED,
        totalSizeBytes: classifiedFiles
          .filter((f) => f.category === 'ORPHAN_UNREFERENCED')
          .reduce((acc, f) => acc + f.sizeBytes, 0),
        files: classifiedFiles.filter((f) => f.category === 'ORPHAN_UNREFERENCED'),
      },
    };

    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify({
      dbFileBearingRecordCounts: report.dbFileBearingRecordCounts,
      summaryCounts: report.summaryCounts,
      brokenDbLinksCount: report.brokenDbLinksCount,
      brokenDbLinks: report.brokenDbLinks,
      restoreTrialVerification: report.restoreTrialVerification,
      referencedByTable: referencedFiles.map((f) => ({
        relPath: f.relPath,
        sizeBytes: f.sizeBytes,
        sha256: f.sha256.slice(0, 16) + '...',
        refs: f.dbReferences.map((r) => `${r.table}#${r.recordId}(${r.column}) -> ${r.appEndpoint}`),
      })),
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
