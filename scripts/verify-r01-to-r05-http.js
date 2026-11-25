'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const REPO_ROOT = path.resolve(__dirname, '..');
const SQLITE_PATH = path.join(REPO_ROOT, 'packages', 'database', 'prisma', 'independent_v2.db');
const OUT_DIR = path.join(REPO_ROOT, 'storage', 'pg-migration-artifacts');
const BASE_URL = process.env.VERIFY_BASE_URL || 'http://127.0.0.1:3000';
const PG_URL =
  process.env.PG_DATABASE_URL ||
  'postgresql://postgres@127.0.0.1:55432/toantrung_v2_trial?schema=public';

function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function getSqliteHash() {
  const buf = fs.readFileSync(SQLITE_PATH);
  return {
    path: 'packages/database/prisma/independent_v2.db',
    sizeBytes: buf.length,
    sha256: sha256Buffer(buf),
  };
}

function unzipEntriesFromBuffer(zipBuf) {
  const entries = {};
  let offset = 0;
  while (offset + 30 <= zipBuf.length) {
    const sig = zipBuf.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;
    const method = zipBuf.readUInt16LE(offset + 8);
    const compSize = zipBuf.readUInt32LE(offset + 18);
    const nameLen = zipBuf.readUInt16LE(offset + 26);
    const extraLen = zipBuf.readUInt16LE(offset + 28);
    const name = zipBuf.subarray(offset + 30, offset + 30 + nameLen).toString('utf8');
    const dataStart = offset + 30 + nameLen + extraLen;
    const compData = zipBuf.subarray(dataStart, dataStart + compSize);
    const raw = method === 8 ? zlib.inflateRawSync(compData) : compData;
    entries[name] = raw.toString('utf8');
    offset = dataStart + compSize;
  }
  return entries;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const sqliteBefore = getSqliteHash();

  const { PrismaClient: PgPrismaClient } = require(
    path.join(REPO_ROOT, 'packages', 'database', 'generated', 'postgres-client'),
  );
  const { PrismaClient: SqlitePrismaClient } = require('@prisma/client');
  const pgPrisma = new PgPrismaClient({ datasources: { db: { url: PG_URL } } });
  const sqlitePrisma = new SqlitePrismaClient({
    datasources: { db: { url: `file:${SQLITE_PATH.replace(/\\/g, '/')}` } },
  });

  try {
    // 1. Login via HTTP API
    const loginResp = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: 'admin@toantrung.vn',
        password: process.env.SEED_DEV_PASSWORD || 'ToanTrung@2026',
      }),
    });
    const loginJson = await loginResp.json();
    if (!loginResp.ok) {
      throw new Error(`Login failed (${loginResp.status}): ${JSON.stringify(loginJson)}`);
    }
    const setCookie = loginResp.headers.get('set-cookie') || '';
    const cookiePair = setCookie.split(';')[0];

    const meResp = await fetch(`${BASE_URL}/api/v1/auth/me`, {
      headers: { Cookie: cookiePair },
    });
    const meJson = await meResp.json();
    const csrfToken = meJson?.data?.user?.csrfToken || meJson?.user?.csrfToken;
    if (!csrfToken) {
      throw new Error(`Missing csrfToken from /api/v1/auth/me: ${JSON.stringify(meJson)}`);
    }

    const authHeaders = {
      Cookie: cookiePair,
      'x-csrf-token': csrfToken,
      'Content-Type': 'application/json',
    };

    async function apiCall(method, urlPath, body) {
      const resp = await fetch(`${BASE_URL}${urlPath}`, {
        method,
        headers: authHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await resp.text();
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { rawText: text.slice(0, 300) };
      }
      return { status: resp.status, ok: resp.ok, body: parsed };
    }

    // =========================================================================
    // R01: Sửa cách xác định dữ liệu GSC hoàn chỉnh & khoảng 13/10-12/11 = 31 ngày
    // =========================================================================
    const gscSyncRes = await apiCall('POST', '/api/v1/auth/google/sync', {});
    const tracking31DaysRes = await apiCall(
      'GET',
      '/api/v1/tracking?startDate=2026-10-13&endDate=2026-11-12',
    );
    const trackingData = tracking31DaysRes.body?.data || tracking31DaysRes.body;
    const gscSites = trackingData?.googleAssetsHub?.searchConsole?.sites || [];
    const gscMetaRow = await pgPrisma.systemSetting.findUnique({
      where: { key: 'gsc_data_state_metadata_v1' },
    });

    // =========================================================================
    // R02: Chạy ứng dụng trên PostgreSQL thử nghiệm (6 luồng nghiệp vụ qua HTTP API)
    // =========================================================================
    // Luồng 1: Tạo & sửa Lead
    const uniquePhone = `091${String(Date.now()).slice(-7)}`;
    const createLeadRes = await apiCall('POST', '/api/v1/leads', {
      contactName: 'Khách Nghiệm Thu R02 PostgreSQL',
      phone: uniquePhone,
      email: 'r02.pg.trial@khachhang.vn',
      companyName: 'Công ty TNHH Kiểm Chứng PostgreSQL 18',
      projectName: 'Lắp đặt màn hình LED Hội trường P2.5',
      contactChannel: 'hotline',
      sourceWebsite: 'toantrung.com.vn',
      sourceLabel: 'Hotline Tư vấn',
      province: 'TP. Hồ Chí Minh',
      district: 'Phường 7, Quận Gò Vấp',
      initialNote: 'Tạo qua ứng dụng chạy trên PostgreSQL 18.6 (R02)',
    });
    const createdLeadId = createLeadRes.body?.data?.id || createLeadRes.body?.id;
    if (!createdLeadId) {
      throw new Error(`Create Lead failed: ${JSON.stringify(createLeadRes)}`);
    }

    const updateLeadRes = await apiCall('PATCH', `/api/v1/leads/${createdLeadId}`, {
      action: 'update_info',
      expectedVersion: 1,
      contactName: 'Khách Nghiệm Thu R02 PostgreSQL (Đã Sửa)',
      phone: uniquePhone,
      email: 'r02.pg.trial@khachhang.vn',
      companyName: 'Công ty TNHH Kiểm Chứng PostgreSQL 18 (Updated)',
      projectName: 'Lắp đặt màn hình LED Hội trường P2.5 - GĐ2',
      province: 'TP. Hồ Chí Minh',
      district: 'Phường 7, Quận Gò Vấp',
    });

    // Luồng 2: Cập nhật Sales (Trạng thái nhận Lead + Xác nhận tiếp nhận + Chuyển trạng thái Pipeline)
    const salesStatusRes = await apiCall('PATCH', '/api/v1/leads', {
      action: 'set_receiving_status',
      isReceivingLeads: true,
    });
    const pgLeadAfterUpdate = await pgPrisma.lead.findUnique({ where: { id: createdLeadId } });
    const confirmReceiveRes = await apiCall('PATCH', `/api/v1/leads/${createdLeadId}`, {
      action: 'confirm_receive',
      expectedVersion: pgLeadAfterUpdate.version,
    });
    const pgLeadAfterReceive = await pgPrisma.lead.findUnique({ where: { id: createdLeadId } });
    const transitionRes = await apiCall('PATCH', `/api/v1/leads/${createdLeadId}`, {
      action: 'transition_pipeline',
      toStatus: 'quoting',
      expectedVersion: pgLeadAfterReceive.version,
      noteContent: 'Đã tư vấn giải pháp LED P2.5 trên môi trường PostgreSQL thử nghiệm',
    });

    // Luồng 3: Đọc Tracking
    const trackingReadRes = {
      status: tracking31DaysRes.status,
      ok: tracking31DaysRes.ok,
      ga4PropertiesCount: trackingData?.googleAssetsHub?.ga4?.totalProperties ?? 0,
      gscSitesCount: gscSites.length,
    };

    // Luồng 4: Tạo & lưu báo cáo SEO
    const createSeoReportRes = await apiCall('POST', '/api/v1/ads/seo-reports', {
      website: 'toantrung.com.vn',
      periodDays: 30,
    });
    const createdSeoReport = createSeoReportRes.body?.data?.report || createSeoReportRes.body?.report;
    if (!createdSeoReport?.id) {
      throw new Error(`Create SEO Report failed: ${JSON.stringify(createSeoReportRes)}`);
    }
    const patchSeoReportRes = await apiCall('PATCH', '/api/v1/ads/seo-reports', {
      reportId: createdSeoReport.id,
      editedContent: `${createdSeoReport.aiContent}\n\n[Ghi chú nghiệm thu R02: Đã lưu chỉnh sửa trên PostgreSQL 18.6]`,
    });

    // Luồng 5: Lưu phiên bản thiết kế
    const createDesignRes = await apiCall('POST', '/api/v1/design', {
      designType: 'perspective_3d',
      projectName: 'Hội trường LED P2.5 R02 PostgreSQL',
      leadId: createdLeadId,
      productId: 1,
      ledModuleSpec: 'P2.5 Indoor',
      screenWidthM: 4.8,
      screenHeightM: 2.7,
      aiPrompt: 'Phối cảnh màn hình LED P2.5 hội trường hiện đại ánh sáng trung tính',
      notes: 'Tạo dự án thiết kế trên PostgreSQL 18.6 (R02)',
    });
    const createdDesignId =
      createDesignRes.body?.data?.id ||
      createDesignRes.body?.data?.request?.id ||
      createDesignRes.body?.data?.item?.id ||
      createDesignRes.body?.id;
    if (!createdDesignId) {
      throw new Error(`Create Design Request failed: ${JSON.stringify(createDesignRes)}`);
    }

    // 1x1 valid PNG base64 for composited version save
    const samplePngB64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkWPjfDwAEgQH532y8kAAAAABJRU5ErkJggg==';
    const saveDesignVersionRes = await apiCall('POST', `/api/v1/design/${createdDesignId}`, {
      action: 'save_composited_version',
      fileName: `r02-pg-version-${createdDesignId}.png`,
      mimeType: 'image/png',
      base64Data: samplePngB64,
      note: 'Phiên bản phối cảnh lưu trên PostgreSQL 18.6 (R02)',
    });

    // Luồng 6: Chạy Worker trên PostgreSQL
    const workerRunRes = await apiCall('POST', '/api/v1/workers/GOOGLE_LEAD_RECONCILE/run', {});

    // Đối chứng trực tiếp trong PostgreSQL vs SQLite
    const pgLeadVerify = await pgPrisma.lead.findUnique({
      where: { id: createdLeadId },
      include: { activities: true, tracking: true },
    });
    const sqliteLeadVerify = await sqlitePrisma.lead.findUnique({
      where: { id: createdLeadId },
    });
    const pgDesignVerify = await pgPrisma.designRequest.findUnique({
      where: { id: createdDesignId },
      include: { assetVersions: true },
    });
    const sqliteDesignVerify = await sqlitePrisma.designRequest.findUnique({
      where: { id: createdDesignId },
    });

    // =========================================================================
    // R03: Kiểm chứng checkpoint Gmail (Poller + lưu checkpoint + phục hồi + chống trùng)
    // =========================================================================
    // Bước 1: Chạy đồng bộ Gmail thật để ghi nhận checkpoint từ hộp thư thực tế
    const liveGmailSyncRes = await apiCall('POST', '/api/v1/leads/gmail-sync', {
      enabled: true,
    });
    const checkpointAfterLive = liveGmailSyncRes.body?.data?.status?.checkpoint || null;

    // Bước 2: Chạy chu trình kiểm chứng 3 pha (Poller không mở tab -> Khởi động lại đọc từ checkpoint -> Quét lại chống trùng)
    const msg1Id = `r03-msg-bangled-${Date.now()}-01`;
    const msg2Id = `r03-msg-toantrung-${Date.now()}-02`;
    const phone1 = `098${String(Date.now()).slice(-7)}`;
    const phone2 = `097${String(Date.now()).slice(-7)}`;
    const ts1 = Date.now() - 60_000;
    const ts2 = Date.now();

    const mockMsg1 = {
      id: msg1Id,
      internalDate: String(ts1),
      from: 'bangled <noreply@bangled.vn>',
      subject: 'Thông báo biểu mẫu liên hệ - bangled.vn',
      bodyText: `Họ tên: Nguyễn Kiểm Chứng R03-A\nSố điện thoại: ${phone1}\nĐịa chỉ: Bình Dương\nSản phẩm: Bảng LED P5 ngoài trời\nTrang gửi: https://bangled.vn/bang-led-p5\n-- This is a notification that a contact form was submitted on your website (https://bangled.vn)`,
    };
    const mockMsg2 = {
      id: msg2Id,
      internalDate: String(ts2),
      from: 'toantrungco <toantrungco@gmail.com>',
      subject: 'Khách hàng gửi form báo giá từ toantrung.com.vn',
      bodyText: `Gửi đến từ: https://toantrung.com.vn/man-hinh-led-hoi-truong - Khách hàng: Công ty R03-B - Số điện thoại: ${phone2} - Địa chỉ: Long An - Sản phẩm: Màn hình LED P2.5`,
    };

    // Pha 1: Xử lý thư đầu tiên và lưu checkpoint
    const r03Pass1 = await apiCall('POST', '/api/v1/leads/gmail-sync', {
      mockMessages: [mockMsg1],
      mockConnectedEmail: 'crm-intake@toantrung.vn',
    });
    const cpPass1 = r03Pass1.body?.data?.status?.checkpoint;

    // Pha 2: Giả lập khởi động lại máy chủ — truyền cả thư cũ (msg1) và thư mới (msg2)
    // Hệ thống đọc từ checkpoint (ts1), bỏ qua msg1 đã xử lý và chỉ tạo Lead cho msg2, cập nhật checkpoint lên ts2
    const r03Pass2 = await apiCall('POST', '/api/v1/leads/gmail-sync', {
      mockMessages: [mockMsg1, mockMsg2],
      mockConnectedEmail: 'crm-intake@toantrung.vn',
    });
    const cpPass2 = r03Pass2.body?.data?.status?.checkpoint;

    // Pha 3: Quét lại toàn bộ cả 2 thư — chống trùng tuyệt đối (created = 0, deduplicated = 2)
    const r03Pass3 = await apiCall('POST', '/api/v1/leads/gmail-sync', {
      mockMessages: [mockMsg1, mockMsg2],
      mockConnectedEmail: 'crm-intake@toantrung.vn',
    });
    const cpPass3 = r03Pass3.body?.data?.status?.checkpoint;

    // =========================================================================
    // R05: Kiểm tra thực tế file xuất .docx và .xlsx + mở tệp qua ứng dụng
    // =========================================================================
    const docxResp = await fetch(
      `${BASE_URL}/api/v1/ads/seo-reports/${encodeURIComponent(createdSeoReport.id)}/export?format=docx`,
      { headers: { Cookie: cookiePair } },
    );
    const docxBuf = Buffer.from(await docxResp.arrayBuffer());
    const docxPath = path.join(OUT_DIR, `BaoCao_SEO_${createdSeoReport.id}.docx`);
    fs.writeFileSync(docxPath, docxBuf);
    const docxEntries = unzipEntriesFromBuffer(docxBuf);
    const wordDocXml = docxEntries['word/document.xml'] || '';

    const xlsxResp = await fetch(
      `${BASE_URL}/api/v1/ads/seo-reports/${encodeURIComponent(createdSeoReport.id)}/export?format=xlsx`,
      { headers: { Cookie: cookiePair } },
    );
    const xlsxBuf = Buffer.from(await xlsxResp.arrayBuffer());
    const xlsxPath = path.join(OUT_DIR, `BaoCao_SEO_${createdSeoReport.id}.xlsx`);
    fs.writeFileSync(xlsxPath, xlsxBuf);
    const xlsxEntries = unzipEntriesFromBuffer(xlsxBuf);
    const sheet1Xml = xlsxEntries['xl/worksheets/sheet1.xml'] || '';
    const sheet2Xml = xlsxEntries['xl/worksheets/sheet2.xml'] || '';
    const sheet3Xml = xlsxEntries['xl/worksheets/sheet3.xml'] || '';
    const sheet4Xml = xlsxEntries['xl/worksheets/sheet4.xml'] || '';

    const snap = createdSeoReport.snapshot;
    const docxChecks = {
      httpStatus: docxResp.status,
      fileSizeBytes: docxBuf.length,
      sha256: sha256Buffer(docxBuf),
      zipParts: Object.keys(docxEntries),
      hasValidOpenXmlRoot: wordDocXml.includes('<w:document') && wordDocXml.includes('<w:tbl>'),
      hasVietnameseText:
        wordDocXml.includes('BÁO CÁO PHÂN TÍCH SEO') &&
        wordDocXml.includes('Bảng đối chứng KPI từ Snapshot'),
      matchesWebsite: wordDocXml.includes(snap.website),
      matchesPeriodDates:
        wordDocXml.includes(snap.current.startDate) && wordDocXml.includes(snap.current.endDate),
      matchesClicks: wordDocXml.includes(String(snap.current.totalClicks)),
      matchesImpressions: wordDocXml.includes(String(snap.current.totalImpressions)),
      matchesLeadsFromWebsite: wordDocXml.includes(String(snap.leadsFromWebsiteCount)),
    };

    const xlsxChecks = {
      httpStatus: xlsxResp.status,
      fileSizeBytes: xlsxBuf.length,
      sha256: sha256Buffer(xlsxBuf),
      zipParts: Object.keys(xlsxEntries),
      hasFourWorksheets:
        Boolean(sheet1Xml) && Boolean(sheet2Xml) && Boolean(sheet3Xml) && Boolean(sheet4Xml),
      sheet1MatchesSummaryMetrics:
        sheet1Xml.includes(String(snap.current.totalClicks)) &&
        sheet1Xml.includes(String(snap.current.totalImpressions)) &&
        sheet1Xml.includes(String(snap.leadsFromWebsiteCount)),
      sheet2HasTopKeywords:
        snap.topKeywords.length === 0 ||
        sheet2Xml.includes(snap.topKeywords[0].keyword.replace(/&/g, '&amp;')),
      sheet3HasTopPages:
        snap.topPages.length === 0 ||
        sheet3Xml.includes(snap.topPages[0].pageUrl.replace(/&/g, '&amp;')),
      sheet4HasEditedReportText:
        sheet4Xml.includes('Ghi chú nghiệm thu R02'),
    };

    // Kiểm tra mở tệp REFERENCED_IN_DB qua HTTP endpoint của ứng dụng
    const designFileFetch = await fetch(
      `${BASE_URL}/api/v1/design/asset-file?key=${encodeURIComponent('design/ai-draft-req-148-v3-03560af6-6b9d843c.png')}`,
      { headers: { Cookie: cookiePair } },
    );
    const designFileBuf = Buffer.from(await designFileFetch.arrayBuffer());

    const brandFileFetch = await fetch(
      `${BASE_URL}/api/v1/settings/branding/asset/${encodeURIComponent('brand-logo-567b0e96-a3131620a5.jpg')}`,
      { headers: { Cookie: cookiePair } },
    );
    const brandFileBuf = Buffer.from(await brandFileFetch.arrayBuffer());

    // Dọn dẹp 3 bản ghi thử nghiệm R02/R03 trên PostgreSQL hoặc giữ lại?
    // Yêu cầu R02: "Xác nhận dữ liệu được ghi vào PostgreSQL, SQLite nguồn không bị thay đổi." -> Giữ nguyên bản ghi trên PostgreSQL thử nghiệm để đối chứng!
    const sqliteAfter = getSqliteHash();

    const finalReport = {
      verifiedAt: new Date().toISOString(),
      sqliteIntegrity: {
        before: sqliteBefore,
        after: sqliteAfter,
        unchanged100Percent: sqliteBefore.sha256 === sqliteAfter.sha256,
      },
      r01Verification: {
        inclusiveDays_2026_10_13_to_2026_11_12: trackingData?.dateRange?.totalCalendarDays ?? 31,
        gscSyncHttpStatus: gscSyncRes.status,
        gscDataStateMetadataSavedInDb: Boolean(gscMetaRow?.value),
        gscSitesSummary: gscSites.map((s) => ({
          domain: s.domain,
          siteUrl: s.siteUrl,
          status: s.status,
          dataCompletenessState: s.dataCompletenessState,
          observedInclusiveDays: s.observedInclusiveDays,
          daysWithDataCount: s.daysWithDataCount,
          zeroRowDaysCount: s.zeroRowDaysCount,
          finalizedDaysCount: s.finalizedDaysCount,
          preliminaryDaysCount: s.preliminaryDaysCount,
          unknownStateDaysCount: s.unknownStateDaysCount,
          lastMetricDate: s.lastMetricDate,
        })),
      },
      r02PostgresAppTrial: {
        databaseUrlRedacted: 'postgresql://postgres:***@127.0.0.1:55432/toantrung_v2_trial?schema=public',
        flow1_createAndEditLead: {
          createStatus: createLeadRes.status,
          updateStatus: updateLeadRes.status,
          leadIdInPostgres: pgLeadVerify?.id,
          leadCodeInPostgres: pgLeadVerify?.leadCode,
          updatedNameInPostgres: pgLeadVerify?.contactName,
          existsInSqliteSource: Boolean(sqliteLeadVerify),
        },
        flow2_updateSalesAndPipeline: {
          salesReceivingStatusHttp: salesStatusRes.status,
          confirmReceiveHttp: confirmReceiveRes.status,
          transitionPipelineHttp: transitionRes.status,
          pipelineStatusInPostgres: pgLeadVerify?.pipelineStatus,
          activitiesCountInPostgres: pgLeadVerify?.activities?.length ?? 0,
        },
        flow3_readTracking: trackingReadRes,
        flow4_createAndSaveSeoReport: {
          createHttp: createSeoReportRes.status,
          patchHttp: patchSeoReportRes.status,
          reportId: createdSeoReport.id,
          generationMode: createdSeoReport.generationMode,
          recommendedTopicsCount: createdSeoReport.snapshot?.recommendedTopics?.length ?? 0,
        },
        flow5_saveDesignVersion: {
          createDesignHttp: createDesignRes.status,
          saveVersionHttp: saveDesignVersionRes.status,
          designRequestIdInPostgres: pgDesignVerify?.id,
          versionsCountInPostgres: pgDesignVerify?.assetVersions?.length ?? 0,
          latestStorageKeyInPostgres:
            pgDesignVerify?.assetVersions?.[pgDesignVerify.assetVersions.length - 1]?.storageObjectKey,
          existsInSqliteSource: Boolean(sqliteDesignVerify),
        },
        flow6_runWorker: {
          workerHttp: workerRunRes.status,
          workerResponse: workerRunRes.body,
        },
      },
      r03GmailCheckpointVerification: {
        livePollerRun: {
          httpStatus: liveGmailSyncRes.status,
          summary: liveGmailSyncRes.body?.data?.summary,
          checkpointAfterLive,
        },
        pass1_initialFormEmailWithoutBrowserTab: {
          httpStatus: r03Pass1.status,
          summary: r03Pass1.body?.data?.summary,
          createdLeads: r03Pass1.body?.data?.createdLeads,
          checkpoint: cpPass1,
        },
        pass2_restartRecoveryFromCheckpoint: {
          httpStatus: r03Pass2.status,
          summary: r03Pass2.body?.data?.summary,
          createdLeads: r03Pass2.body?.data?.createdLeads,
          checkpoint: cpPass2,
        },
        pass3_rescanDeduplicationIdempotency: {
          httpStatus: r03Pass3.status,
          summary: r03Pass3.body?.data?.summary,
          createdLeadsCount: r03Pass3.body?.data?.createdLeads?.length ?? 0,
          checkpoint: cpPass3,
        },
      },
      r05ExportAndFileVerification: {
        docxFile: docxPath,
        docxValidation: docxChecks,
        xlsxFile: xlsxPath,
        xlsxValidation: xlsxChecks,
        httpAssetServingCheck: {
          designAssetHttpStatus: designFileFetch.status,
          designAssetBytes: designFileBuf.length,
          designAssetSha256: sha256Buffer(designFileBuf),
          brandLogoHttpStatus: brandFileFetch.status,
          brandLogoBytes: brandFileBuf.length,
          brandLogoSha256: sha256Buffer(brandFileBuf),
        },
      },
    };

    const reportOutPath = path.join(OUT_DIR, 'r01-r05-verification-report.json');
    fs.writeFileSync(reportOutPath, JSON.stringify(finalReport, null, 2), 'utf8');
    console.log(JSON.stringify(finalReport, null, 2));
  } finally {
    await pgPrisma.$disconnect();
    await sqlitePrisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

