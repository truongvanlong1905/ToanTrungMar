'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const PRISMA_DIR = path.join(REPO_ROOT, 'packages/database/prisma');

function resolveDbUrl() {
  const independentDbFile = path.join(PRISMA_DIR, 'independent_v2.db').replace(/\\/g, '/');
  const devDbFile = path.join(PRISMA_DIR, 'dev.db').replace(/\\/g, '/');
  const chosenDbFile =
    fs.existsSync(independentDbFile) && fs.statSync(independentDbFile).size > 0
      ? independentDbFile
      : fs.existsSync(devDbFile) && fs.statSync(devDbFile).size > 0
        ? devDbFile
        : independentDbFile;
  const defaultDbUrl = chosenDbFile.startsWith('/') ? `file://${chosenDbFile}` : `file:${chosenDbFile}`;
  return process.env.DATABASE_URL &&
    process.env.DATABASE_URL !== 'file:./dev.db' &&
    process.env.DATABASE_URL !== 'file:./independent_v2.db'
    ? process.env.DATABASE_URL
    : defaultDbUrl;
}

const dbUrl = resolveDbUrl();
const prisma = new PrismaClient({
  datasources: { db: { url: dbUrl } },
});

const {
  upsertPlatformMetricIdempotent,
} = require(path.join(REPO_ROOT, 'packages/database/src/operations-runtime'));

async function addModule2Data() {
  console.log('[Module2Seed] Đang nạp thêm dữ liệu mới vào Module 2 (02-tracking-sync)...');

  // 1. Thêm các chiến dịch mới vào bảng campaigns
  const campConference = await prisma.campaign.upsert({
    where: {
      uq_campaign_platform_account_code: {
        platform: 'google_ads',
        accountExternalId: 'GADS-TT-01',
        campaignCode: 'CMP-LED-CONFERENCE-P3',
      },
    },
    update: {
      campaignName: 'Chiến dịch Màn hình LED Phòng họp & Khách sạn P3 Q4',
      dailyBudgetMicros: 4000000000000n, // 4,000,000 VND
      isActive: true,
    },
    create: {
      platform: 'google_ads',
      accountExternalId: 'GADS-TT-01',
      campaignCode: 'CMP-LED-CONFERENCE-P3',
      campaignName: 'Chiến dịch Màn hình LED Phòng họp & Khách sạn P3 Q4',
      utmCampaignSlug: 'led_conference_p3_q4',
      currencyCode: 'VND',
      dailyBudgetMicros: 4000000000000n,
      isActive: true,
    },
  });

  const campFbRental = await prisma.campaign.upsert({
    where: {
      uq_campaign_platform_account_code: {
        platform: 'facebook',
        accountExternalId: 'FB-TT-FANPAGE',
        campaignCode: 'CMP-FB-LED-RENTAL-2026',
      },
    },
    update: {
      campaignName: 'Cho thuê Màn hình LED Sự kiện & Tiệc cưới 2026',
      dailyBudgetMicros: 2000000000000n, // 2,000,000 VND
      isActive: true,
    },
    create: {
      platform: 'facebook',
      accountExternalId: 'FB-TT-FANPAGE',
      campaignCode: 'CMP-FB-LED-RENTAL-2026',
      campaignName: 'Cho thuê Màn hình LED Sự kiện & Tiệc cưới 2026',
      utmCampaignSlug: 'led_rental_event_2026',
      currencyCode: 'VND',
      dailyBudgetMicros: 2000000000000n,
      isActive: true,
    },
  });

  const campZaloRetail = await prisma.campaign.upsert({
    where: {
      uq_campaign_platform_account_code: {
        platform: 'zalo',
        accountExternalId: 'ZALO-OA-TOANTRUNG',
        campaignCode: 'CMP-ZALO-LED-RETAIL',
      },
    },
    update: {
      campaignName: 'Bảng LED Chạy chữ & Hiệu ứng Cửa hàng Bán lẻ',
      dailyBudgetMicros: 1000000000000n, // 1,000,000 VND
      isActive: true,
    },
    create: {
      platform: 'zalo',
      accountExternalId: 'ZALO-OA-TOANTRUNG',
      campaignCode: 'CMP-ZALO-LED-RETAIL',
      campaignName: 'Bảng LED Chạy chữ & Hiệu ứng Cửa hàng Bán lẻ',
      utmCampaignSlug: 'zalo_led_retail',
      currencyCode: 'VND',
      dailyBudgetMicros: 1000000000000n,
      isActive: true,
    },
  });

  console.log(`  + Đã cập nhật 3 chiến dịch: ${campConference.campaignCode}, ${campFbRental.campaignCode}, ${campZaloRetail.campaignCode}`);

  // 2. Thêm số liệu đa kênh mới (Google Ads, Facebook, GA4, Search Console) cho ngày 2026-11-10 và 2026-11-11
  const dates = ['2026-11-10', '2026-11-11'];
  let metricsCount = 0;

  for (const date of dates) {
    const isFinalized = date < '2026-11-11';

    // Google Ads: Chiến dịch LED Phòng họp P3 (Grain: campaign)
    await upsertPlatformMetricIdempotent(prisma, {
      platform: 'google_ads',
      accountPropertyId: 'GADS-TT-01',
      metricDate: date,
      grain: 'campaign',
      campaignExternalId: campConference.campaignCode,
      campaignId: campConference.id,
      campaignName: campConference.campaignName,
      currencyCode: 'VND',
      spendMicros: 16800000000000n, // 16,800,000 VND
      dailyBudgetMicros: 4000000000000n,
      cpcMicros: 31000000000n, // 31,000 VND
      impressions: 9600,
      clicks: 540,
      conversionsMicros: 11000000n, // 11 conversions
      googleLeadFormCount: 5,
      isFinalized,
    });
    metricsCount++;

    // Google Ads: Từ khóa 'báo giá màn hình led phòng họp p3' (Grain: keyword)
    await upsertPlatformMetricIdempotent(prisma, {
      platform: 'google_ads',
      accountPropertyId: 'GADS-TT-01',
      metricDate: date,
      grain: 'keyword',
      campaignExternalId: campConference.campaignCode,
      campaignId: campConference.id,
      campaignName: campConference.campaignName,
      keywordRaw: 'báo giá màn hình led phòng họp P3',
      keywordMatchType: 'PHRASE',
      currencyCode: 'VND',
      spendMicros: 7200000000000n,
      cpcMicros: 30000000000n,
      impressions: 3400,
      clicks: 240,
      conversionsMicros: 6000000n,
      isFinalized,
    });
    metricsCount++;

    // Google Ads: Từ khóa 'màn hình led p3 khách sạn' (Grain: keyword)
    await upsertPlatformMetricIdempotent(prisma, {
      platform: 'google_ads',
      accountPropertyId: 'GADS-TT-01',
      metricDate: date,
      grain: 'keyword',
      campaignExternalId: campConference.campaignCode,
      campaignId: campConference.id,
      campaignName: campConference.campaignName,
      keywordRaw: 'màn hình led P3 khách sạn',
      keywordMatchType: 'EXACT',
      currencyCode: 'VND',
      spendMicros: 5400000000000n,
      cpcMicros: 30000000000n,
      impressions: 2800,
      clicks: 180,
      conversionsMicros: 4000000n,
      isFinalized,
    });
    metricsCount++;

    // Facebook Ads: Chiến dịch Cho thuê LED (Grain: campaign)
    await upsertPlatformMetricIdempotent(prisma, {
      platform: 'fanpage',
      accountPropertyId: 'FB-TT-FANPAGE',
      metricDate: date,
      grain: 'campaign',
      campaignExternalId: campFbRental.campaignCode,
      campaignId: campFbRental.id,
      campaignName: campFbRental.campaignName,
      currencyCode: 'VND',
      spendMicros: 8500000000000n, // 8,500,000 VND
      dailyBudgetMicros: 2000000000000n,
      cpcMicros: 12000000000n, // 12,000 VND
      impressions: 48500,
      clicks: 710,
      conversionsMicros: 8000000n,
      fanpageEngagements: 1420,
      isFinalized,
    });
    metricsCount++;

    // GA4: Trang '/man-hinh-led-phong-hop' (Grain: page)
    await upsertPlatformMetricIdempotent(prisma, {
      platform: 'ga4',
      accountPropertyId: 'GA4-TOANTRUNG-MAIN',
      metricDate: date,
      grain: 'page',
      pageUrlRaw: 'https://toantrung.com.vn/man-hinh-led-phong-hop',
      pageViews: 1450,
      avgTimeOnPageSec: 182.5,
      isFinalized,
    });
    metricsCount++;

    // Search Console: Từ khóa SEO 'màn hình led phòng họp p3' (Grain: keyword)
    await upsertPlatformMetricIdempotent(prisma, {
      platform: 'search_console',
      accountPropertyId: 'https://toantrung.com.vn',
      metricDate: date,
      grain: 'keyword',
      keywordRaw: 'màn hình led phòng họp p3',
      pageUrlRaw: 'https://toantrung.com.vn/man-hinh-led-phong-hop',
      impressions: 3800,
      clicks: 295,
      avgPosition: 2.7,
      isFinalized,
    });
    metricsCount++;
  }

  console.log(`  + Đã nạp ${metricsCount} bản ghi số liệu đa kênh mới (Google Ads, Facebook, GA4, GSC).`);

  // 3. Thêm bản ghi đối soát LeadReconciliation mới (UC03 Luồng D)
  await prisma.leadReconciliation.upsert({
    where: {
      uq_reconcile_date_platform_account: {
        reconcileDate: '2026-11-10',
        platform: 'google_ads',
        accountPropertyId: 'GADS-TT-01',
      },
    },
    update: {
      crmLeadCount: 5,
      platformReportedCount: 5,
      discrepancy: 0,
      status: 'ok',
    },
    create: {
      reconcileDate: '2026-11-10',
      platform: 'google_ads',
      accountPropertyId: 'GADS-TT-01',
      crmLeadCount: 5,
      crmErrorLogCount: 0,
      platformReportedCount: 5,
      discrepancy: 0,
      status: 'ok',
    },
  });

  const reconAlert = await prisma.leadReconciliation.upsert({
    where: {
      uq_reconcile_date_platform_account: {
        reconcileDate: '2026-11-09',
        platform: 'google_ads',
        accountPropertyId: 'GADS-TT-01',
      },
    },
    update: {
      crmLeadCount: 3,
      platformReportedCount: 5,
      discrepancy: -2,
      status: 'alert_open',
    },
    create: {
      reconcileDate: '2026-11-09',
      platform: 'google_ads',
      accountPropertyId: 'GADS-TT-01',
      crmLeadCount: 3,
      crmErrorLogCount: 0,
      platformReportedCount: 5,
      discrepancy: -2,
      status: 'alert_open',
    },
  });

  console.log(`  + Đã ghi nhận bản ghi đối soát ngày 09/11 (Cảnh báo lệch 2 Lead Google Form) và 10/11 (Khớp 100%).`);

  // 4. Thêm bản ghi lỗi webhook (UC03 E1)
  await prisma.webhookIntakeErrorLog.upsert({
    where: {
      uq_webhook_error_source_submission: {
        sourcePlatform: 'website_webhook',
        intakeSourceAccountKey: 'toantrung.com.vn',
        externalSubmissionId: 'SUB-ERR-20261111-001',
      },
    },
    update: {
      errorMessage: 'Thiếu số điện thoại liên hệ từ form yêu cầu báo giá nhanh.',
    },
    create: {
      sourcePlatform: 'website_webhook',
      intakeSourceAccountKey: 'toantrung.com.vn',
      externalSubmissionId: 'SUB-ERR-20261111-001',
      rawPayloadJson: JSON.stringify({
        fullName: 'Khách hàng Ẩn danh (Dữ liệu mẫu E1)',
        email: 'khachhang.test@toantrung.vn',
        phone: '',
        requestedProduct: 'Màn hình LED P3',
      }),
      errorCode: 'MISSING_PHONE',
      errorMessage: 'Thiếu số điện thoại liên hệ từ form yêu cầu báo giá nhanh.',
      retryCount: 1,
      isResolved: false,
    },
  });

  console.log(`  + Đã ghi nhận 1 bản ghi lỗi webhook mẫu (SUB-ERR-20261111-001) phục vụ kiểm thử Luồng E1.`);

  // 5. Thêm Lead mới kèm Marketing Tracking (UC03 Luồng A)
  const salesStaff = await prisma.user.findFirst({
    where: { role: { roleCode: 'SALES' } },
  });

  let newLead = await prisma.lead.findUnique({
    where: { leadCode: 'TT-20261111-0006' },
  });

  if (!newLead) {
    newLead = await prisma.lead.create({
      data: {
        leadCode: 'TT-20261111-0006',
        companyName: 'Khách sạn & Trung tâm Hội nghị Rex Saigon',
        projectName: 'Màn hình LED Phòng họp VIP & Hội trường 400 chỗ',
        normalizedLookupKey: 'khach san rex saigon|man hinh led phong hop vip',
        contactName: 'Anh Minh Trí',
        phone: '0908100206',
        email: 'minhtri.rex@synthetic.vn',
        contactChannel: 'google_lead_form',
        areaType: 'tphcm',
        province: 'TP. Hồ Chí Minh',
        district: 'Quận 1',
        installationAddress: 'Đường Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh',
        pipelineStatus: 'new_lead',
        assignedSalesId: salesStaff?.id ?? 2,
        createdByActorType: 'webhook',
        createdByActorRef: 'google_lead_form:gads-tt-01',
      },
    });

    await prisma.marketingTracking.create({
      data: {
        leadId: newLead.id,
        campaignId: campConference.id,
        intakeChannel: 'google_lead_form',
        intakeSourceProvider: 'google_lead_form',
        intakeSourceAccountKey: 'gads-tt-01',
        externalSubmissionId: 'GFORM-SYNTH-20261111-0006',
        marketingSource: 'Google Ads',
        sourceResolutionMethod: 'google_lead_form',
        campaignName: campConference.campaignName,
        gclid: 'EAIaIQobChMI_conference_lead_0006',
        deviceType: 'desktop',
        syncGa4Status: 'synced',
      },
    });
    console.log(`  + Đã tạo Lead mới ${newLead.leadCode} gắn tracking Chiến dịch P3 (${campConference.campaignCode}).`);
  }

  // 6. Phát thông báo hệ thống (Notification) tới các nhân sự có quyền theo dõi Tracking
  const targetRoles = ['ADMIN', 'MKT_LEAD', 'ADS', 'MKT_STAFF', 'BOD'];
  const targetUsers = await prisma.user.findMany({
    where: {
      role: { roleCode: { in: targetRoles } },
      isActive: true,
    },
    select: { id: true, fullName: true, role: { select: { roleCode: true } } },
  });

  const notificationData = targetUsers.map((u) => ({
    userId: u.id,
    title: 'Cập nhật dữ liệu mới: Chiến dịch, số liệu đa kênh & đối soát Module 2',
    summary: 'Đã nạp 3 chiến dịch mới (Google Ads, Facebook, Zalo), số liệu ngày 10-11/11 và ghi nhận cảnh báo đối soát 2 Lead Google Form.',
    category: 'Đồng bộ số liệu',
    actionLabel: 'Xem Tracking & Đối soát',
    actionUrl: '/tracking',
  }));

  if (notificationData.length > 0) {
    await prisma.notification.createMany({
      data: notificationData,
    });
    console.log(`  + Đã gửi thông báo hệ thống tới ${notificationData.length} người dùng (${targetUsers.map(u => u.fullName).join(', ')}).`);
  }

  console.log('[Module2Seed] Hoàn tất nạp dữ liệu thành công!');
}

addModule2Data()
  .catch((err) => {
    console.error('[Module2Seed] Lỗi khi nạp dữ liệu:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
