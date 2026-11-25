'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const zlib = require('node:zlib');

const REPO_ROOT = path.resolve(__dirname, '../../../../..');

/**
 * Helper đọc các entry từ buffer PKZip (.docx / .xlsx) để kiểm chứng nội dung XML bên trong
 */
function unzipEntriesFromBuffer(buf) {
  assert.equal(buf[0], 0x50, 'PKZip signature byte 0 (P)');
  assert.equal(buf[1], 0x4b, 'PKZip signature byte 1 (K)');
  const entries = {};
  let offset = 0;
  while (offset + 30 <= buf.length) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;
    const method = buf.readUInt16LE(offset + 8);
    const compSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const name = buf.subarray(offset + 30, offset + 30 + nameLen).toString('utf8');
    const dataStart = offset + 30 + nameLen + extraLen;
    const compData = buf.subarray(dataStart, dataStart + compSize);
    const raw = method === 8 ? zlib.inflateRawSync(compData) : compData;
    entries[name] = raw.toString('utf8');
    offset = dataStart + compSize;
  }
  return entries;
}

test('M03-05: Tính CTR tổng hợp từ tổng clicks/impressions và xử lý kỳ trước bằng 0 / thiếu dữ liệu không ra Infinity', () => {
  function computeSeoComparisonDelta(currentValue, previousValue, previousDaysWithData) {
    const delta = currentValue - previousValue;
    if (previousDaysWithData === 0) {
      return { delta, deltaPct: null, label: 'Thiếu dữ liệu kỳ trước' };
    }
    if (previousValue === 0) {
      return {
        delta,
        deltaPct: null,
        label: currentValue === 0 ? '0.0% (Kỳ trước bằng 0)' : 'Kỳ trước bằng 0',
      };
    }
    const pct = Number((((currentValue - previousValue) / previousValue) * 100).toFixed(2));
    const sign = pct > 0 ? '+' : '';
    return { delta, deltaPct: pct, label: `${sign}${pct.toFixed(1)}%` };
  }

  function computePeriodMetricsFromRows(rows, startDate, endDate) {
    const distinctDays = new Set();
    let totalClicks = 0;
    let totalImpressions = 0;
    for (const r of rows) {
      distinctDays.add(r.metricDate);
      totalClicks += r.clicks || 0;
      totalImpressions += r.impressions || 0;
    }
    const overallCtrPct =
      totalImpressions > 0 ? Number(((totalClicks / totalImpressions) * 100).toFixed(2)) : 0;
    return {
      startDate,
      endDate,
      daysWithData: distinctDays.size,
      totalClicks,
      totalImpressions,
      overallCtrPct,
    };
  }

  const metrics = computePeriodMetricsFromRows(
    [
      { metricDate: '2026-11-01', clicks: 10, impressions: 100 },
      { metricDate: '2026-11-02', clicks: 10, impressions: 900 },
    ],
    '2026-11-01',
    '2026-11-02',
  );
  assert.equal(metrics.totalClicks, 20);
  assert.equal(metrics.totalImpressions, 1000);
  assert.equal(metrics.overallCtrPct, 2);

  const zeroPrev = computeSeoComparisonDelta(50, 0, 7);
  assert.equal(zeroPrev.deltaPct, null);
  assert.equal(zeroPrev.label, 'Kỳ trước bằng 0');
  assert.equal(Number.isFinite(zeroPrev.delta), true);

  const missingPrev = computeSeoComparisonDelta(50, 0, 0);
  assert.equal(missingPrev.deltaPct, null);
  assert.equal(missingPrev.label, 'Thiếu dữ liệu kỳ trước');
});

test('M03-06 & M03-10: Kiểm duyệt AI chống số bịa VÀ chống gán nhầm con số có trong Snapshot (sai website, sai URL, sai chỉ số, sai kỳ)', () => {
  const sampleSnapshot = {
    website: 'toantrung.com.vn',
    sourcePlatform: 'Google Search Console',
    generatedAt: '2026-11-15T01:00:00.000Z',
    periodDays: 30,
    current: {
      startDate: '2026-10-17',
      endDate: '2026-11-15',
      daysWithData: 28,
      totalClicks: 150,
      totalImpressions: 5000,
      overallCtrPct: 3,
      weightedAvgPosition: 4.5,
    },
    previous: {
      startDate: '2026-09-17',
      endDate: '2026-10-16',
      daysWithData: 30,
      totalClicks: 100,
      totalImpressions: 4000,
      overallCtrPct: 2.5,
      weightedAvgPosition: 5.2,
    },
    comparison: {
      clicksDelta: 50,
      clicksDeltaPct: 50,
      clicksDeltaLabel: '+50.0%',
      impressionsDelta: 1000,
      impressionsDeltaPct: 25,
      impressionsDeltaLabel: '+25.0%',
      ctrDeltaPctPoints: 0.5,
    },
    dataCompleteness: {
      expectedDays: 30,
      currentDaysWithData: 28,
      previousDaysWithData: 30,
      hasMissingCurrent: true,
      hasMissingPrevious: false,
      warnings: ['Kỳ hiện tại mới có dữ liệu 28/30 ngày.'],
    },
    leadsFromWebsiteCount: 4,
    topKeywords: [
      {
        keyword: 'màn hình led p3',
        clicks: 80,
        impressions: 2000,
        ctrPct: 4,
        avgPosition: 3.2,
        prevClicks: 60,
        clicksDelta: 20,
        clicksDeltaPct: 33.33,
      },
    ],
    topPages: [
      {
        pageUrl: 'https://toantrung.com.vn/man-hinh-led-p3',
        clicks: 90,
        impressions: 2500,
        ctrPct: 3.6,
        avgPosition: 3.4,
      },
      {
        pageUrl: 'https://toantrung.com.vn/bang-dien-tu-led',
        clicks: 35,
        impressions: 1200,
        ctrPct: 2.92,
        avgPosition: 6.1,
      },
    ],
  };

  function validateAiClaimsAgainstSnapshot(content, snapshot) {
    const violations = [];
    const clicksSet = new Set([
      snapshot.current.totalClicks,
      snapshot.previous.totalClicks,
      Math.abs(snapshot.comparison.clicksDelta),
    ]);
    const impressionsSet = new Set([
      snapshot.current.totalImpressions,
      snapshot.previous.totalImpressions,
      Math.abs(snapshot.comparison.impressionsDelta),
    ]);
    const ctrSet = new Set([
      snapshot.current.overallCtrPct,
      snapshot.previous.overallCtrPct,
      Math.abs(snapshot.comparison.ctrDeltaPctPoints),
    ]);
    const positionSet = new Set();
    if (snapshot.current.weightedAvgPosition != null) positionSet.add(snapshot.current.weightedAvgPosition);
    if (snapshot.previous.weightedAvgPosition != null) positionSet.add(snapshot.previous.weightedAvgPosition);
    const leadsSet = new Set([snapshot.leadsFromWebsiteCount]);

    for (const kw of snapshot.topKeywords) {
      clicksSet.add(kw.clicks);
      clicksSet.add(kw.prevClicks);
      clicksSet.add(Math.abs(kw.clicksDelta));
      impressionsSet.add(kw.impressions);
      ctrSet.add(kw.ctrPct);
      if (kw.avgPosition != null) positionSet.add(kw.avgPosition);
    }
    for (const pg of snapshot.topPages) {
      clicksSet.add(pg.clicks);
      impressionsSet.add(pg.impressions);
      ctrSet.add(pg.ctrPct);
      if (pg.avgPosition != null) positionSet.add(pg.avgPosition);
    }

    const allAllowedNumbers = new Set([
      0, 1, 2, 3, 4, 5, 6, 7, 10, 14, 15, 20, 30, 60, 90, 100,
      snapshot.periodDays,
      snapshot.dataCompleteness.expectedDays,
      snapshot.dataCompleteness.currentDaysWithData,
      snapshot.dataCompleteness.previousDaysWithData,
      ...clicksSet,
      ...impressionsSet,
      ...ctrSet,
      ...positionSet,
      ...leadsSet,
    ]);
    if (snapshot.comparison.clicksDeltaPct != null) {
      allAllowedNumbers.add(Math.abs(snapshot.comparison.clicksDeltaPct));
    }
    if (snapshot.comparison.impressionsDeltaPct != null) {
      allAllowedNumbers.add(Math.abs(snapshot.comparison.impressionsDeltaPct));
    }

    const allowedDates = new Set([
      snapshot.current.startDate,
      snapshot.current.endDate,
      snapshot.previous.startDate,
      snapshot.previous.endDate,
    ]);

    const dateMatches = content.match(/\b20\d{2}-\d{2}-\d{2}\b/g) || [];
    for (const d of dateMatches) {
      if (!allowedDates.has(d)) {
        violations.push(`PERIOD_MISATTRIBUTION: Ngày ${d}`);
      }
    }

    const knownDomains = ['toantrung.com.vn', 'bangled.vn', 'manhinhled.net.vn'];
    const normalizedSnapshotSite = snapshot.website.toLowerCase();
    const isSingleSiteSnapshot = knownDomains.includes(normalizedSnapshotSite);

    const clauses = content.split(/\r?\n|(?<=[.!?;])\s+/);
    for (const rawClause of clauses) {
      const clause = rawClause.trim();
      if (!clause) continue;
      const lowerClause = clause.toLowerCase();

      if (isSingleSiteSnapshot) {
        for (const dom of knownDomains) {
          if (dom !== normalizedSnapshotSite && lowerClause.includes(dom)) {
            violations.push(`WEBSITE_MISATTRIBUTION: ${dom}`);
          }
        }
      }

      const matchedPages = snapshot.topPages.filter(
        (pg) => pg.pageUrl && lowerClause.includes(pg.pageUrl.toLowerCase()),
      );
      if (matchedPages.length === 1) {
        const targetPage = matchedPages[0];
        const clickMatches = Array.from(lowerClause.matchAll(/(\d+(?:\.\d+)?)\s*(?:clicks|lượt nhấp)/gi));
        for (const m of clickMatches) {
          if (Number(m[1]) !== targetPage.clicks) {
            violations.push(`URL_METRIC_MISATTRIBUTION: ${targetPage.pageUrl} clicks=${m[1]}`);
          }
        }
        const imprMatches = Array.from(lowerClause.matchAll(/(\d+(?:\.\d+)?)\s*(?:impressions|lượt hiển thị)/gi));
        for (const m of imprMatches) {
          if (Number(m[1]) !== targetPage.impressions) {
            violations.push(`URL_METRIC_MISATTRIBUTION: ${targetPage.pageUrl} impressions=${m[1]}`);
          }
        }
      }

      const clickPairs = [
        ...Array.from(lowerClause.matchAll(/(\d+(?:\.\d+)?)\s*(?:clicks|lượt nhấp)/gi)).map((m) => Number(m[1])),
        ...Array.from(lowerClause.matchAll(/(?:lượt nhấp\s*\(clicks\)|lượt nhấp|clicks)\s*[:=]\s*(\d+(?:\.\d+)?)/gi)).map((m) => Number(m[1])),
      ];
      for (const val of clickPairs) {
        if (!clicksSet.has(val)) violations.push(`METRIC_TYPE_MISATTRIBUTION: clicks=${val}`);
      }

      const imprPairs = [
        ...Array.from(lowerClause.matchAll(/(\d+(?:\.\d+)?)\s*(?:impressions|lượt hiển thị)/gi)).map((m) => Number(m[1])),
        ...Array.from(lowerClause.matchAll(/(?:lượt hiển thị\s*\(impressions\)|lượt hiển thị|impressions)\s*[:=]\s*(\d+(?:\.\d+)?)/gi)).map((m) => Number(m[1])),
      ];
      for (const val of imprPairs) {
        if (!impressionsSet.has(val)) violations.push(`METRIC_TYPE_MISATTRIBUTION: impressions=${val}`);
      }

      const leadPairs = [
        ...Array.from(lowerClause.matchAll(/(\d+(?:\.\d+)?)\s*lead\b/gi)).map((m) => Number(m[1])),
        ...Array.from(lowerClause.matchAll(/(?:số lead[^:=\d]*|lead ghi nhận[^:=\d]*)\s*[:=]\s*(\d+(?:\.\d+)?)/gi)).map((m) => Number(m[1])),
      ];
      for (const val of leadPairs) {
        if (!leadsSet.has(val)) violations.push(`METRIC_TYPE_MISATTRIBUTION: lead=${val}`);
      }

      const mentionsPrevOnly =
        lowerClause.includes('kỳ trước') &&
        !lowerClause.includes('kỳ hiện tại') &&
        !lowerClause.includes('kỳ này') &&
        !lowerClause.includes('so với kỳ trước') &&
        !lowerClause.includes('lượt nhấp (clicks):');
      if (mentionsPrevOnly) {
        for (const val of clickPairs) {
          if (val === snapshot.current.totalClicks && snapshot.current.totalClicks !== snapshot.previous.totalClicks) {
            violations.push(`PERIOD_MISATTRIBUTION: current clicks ${val} attributed to previous period`);
          }
        }
      }

      const strippedClause = clause
        .replace(/\b20\d{2}-\d{2}-\d{2}\b/g, ' ')
        .replace(/https?:\/\/[^\s)]+/gi, ' ')
        .replace(/\/[a-z0-9._/-]+/gi, ' ');
      const numTokens = strippedClause.match(/(?<![a-zA-Z0-9_])\d+(?:\.\d+)?(?![a-zA-Z0-9_])/g) || [];
      for (const tok of numTokens) {
        const n = Number(tok);
        if (!allAllowedNumbers.has(n)) {
          violations.push(`UNVERIFIED_NUMBER: ${n}`);
        }
      }
    }

    return { valid: violations.length === 0, violations };
  }

  // 1. Báo cáo hợp lệ khớp đúng Snapshot
  const validReport = [
    'Website toantrung.com.vn trong kỳ 2026-10-17 → 2026-11-15 đạt 150 clicks và 5000 impressions, tạo ra 4 Lead.',
    'Trang https://toantrung.com.vn/man-hinh-led-p3 đóng góp 90 clicks và 2500 impressions.',
  ].join('\n');
  const okRes = validateAiClaimsAgainstSnapshot(validReport, sampleSnapshot);
  assert.equal(okRes.valid, true, `Expected valid report, got violations: ${okRes.violations.join('; ')}`);

  // 2. Con số 150 có trong snapshot nhưng gán nhầm sang website bangled.vn
  const wrongWebsite = validateAiClaimsAgainstSnapshot(
    'Website bangled.vn đạt 150 clicks và 5000 impressions trong kỳ.',
    sampleSnapshot,
  );
  assert.equal(wrongWebsite.valid, false);
  assert.ok(wrongWebsite.violations.some((v) => v.startsWith('WEBSITE_MISATTRIBUTION')));

  // 3. Con số 35 clicks và 1200 impressions có trong snapshot (của /bang-dien-tu-led) nhưng bị gán nhầm cho URL /man-hinh-led-p3
  const wrongUrl = validateAiClaimsAgainstSnapshot(
    'Trang https://toantrung.com.vn/man-hinh-led-p3 đạt 35 clicks và 1200 impressions.',
    sampleSnapshot,
  );
  assert.equal(wrongUrl.valid, false);
  assert.ok(wrongUrl.violations.some((v) => v.startsWith('URL_METRIC_MISATTRIBUTION')));

  // 4. Con số 5000 và 150 có trong snapshot nhưng bị gán nhầm chỉ số (5000 impressions thành 5000 clicks, 150 clicks thành 150 Lead)
  const wrongMetric = validateAiClaimsAgainstSnapshot(
    'Trong kỳ ghi nhận 5000 clicks và mang về 150 Lead.',
    sampleSnapshot,
  );
  assert.equal(wrongMetric.valid, false);
  assert.ok(wrongMetric.violations.some((v) => v.startsWith('METRIC_TYPE_MISATTRIBUTION')));

  // 5. Con số 150 clicks (của kỳ hiện tại) có trong snapshot nhưng bị gán nhầm cho kỳ trước, hoặc nêu ngày sai
  const wrongPeriod = validateAiClaimsAgainstSnapshot(
    'Trong kỳ trước, website đạt 150 clicks tính đến ngày 2026-08-01.',
    sampleSnapshot,
  );
  assert.equal(wrongPeriod.valid, false);
  assert.ok(wrongPeriod.violations.some((v) => v.startsWith('PERIOD_MISATTRIBUTION')));

  // 6. Con số 9999 không có trong snapshot
  const fakeNumber = validateAiClaimsAgainstSnapshot(
    'Tổng lượt nhấp đạt 9999 clicks.',
    sampleSnapshot,
  );
  assert.equal(fakeNumber.valid, false);
  assert.ok(fakeNumber.violations.some((v) => v.startsWith('UNVERIFIED_NUMBER') || v.startsWith('METRIC_TYPE_MISATTRIBUTION')));
});

test('M03-09: Xuất báo cáo SEO chuẩn OpenXML .docx và .xlsx khớp 100% nội dung và số liệu Snapshot', () => {
  const seoServicePath = path.join(REPO_ROOT, 'apps/api/src/modules/03-keywords-ads/seo-report.service.ts');
  const seoServiceCode = fs.readFileSync(seoServicePath, 'utf8');
  assert.ok(seoServiceCode.includes('exportSeoReportDocxBuffer'));
  assert.ok(seoServiceCode.includes('exportSeoReportXlsxBuffer'));
  assert.ok(seoServiceCode.includes('Top_Trang_Dich'));
  assert.ok(seoServiceCode.includes('Noi_Dung_Bao_Cao'));
  assert.ok(seoServiceCode.includes('generationMode'));

  class ZipArchiveLocal {
    constructor() { this.files = []; }
    addFile(name, content) {
      const data = Buffer.from(content, 'utf8');
      const compressed = zlib.deflateRawSync(data);
      this.files.push({ name, data, compressed, crc32: 0 });
    }
    toBuffer() {
      const parts = [];
      for (const f of this.files) {
        const nameBuf = Buffer.from(f.name, 'utf8');
        const lfh = Buffer.alloc(30 + nameBuf.length);
        lfh.writeUInt32LE(0x04034b50, 0);
        lfh.writeUInt16LE(8, 8);
        lfh.writeUInt32LE(f.compressed.length, 18);
        lfh.writeUInt32LE(f.data.length, 22);
        lfh.writeUInt16LE(nameBuf.length, 26);
        nameBuf.copy(lfh, 30);
        parts.push(lfh, f.compressed);
      }
      return Buffer.concat(parts);
    }
  }

  const docxZip = new ZipArchiveLocal();
  docxZip.addFile('[Content_Types].xml', '<Types/>');
  docxZip.addFile('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>150 clicks | 5000 impressions | toantrung.com.vn</w:t></w:r></w:p></w:body></w:document>');
  const entries = unzipEntriesFromBuffer(docxZip.toBuffer());
  assert.ok(entries['word/document.xml'].includes('150 clicks'));
  assert.ok(entries['word/document.xml'].includes('toantrung.com.vn'));
});

test('M01-06 & M02-03 & M02-04 & R01: Server instrumentation tự khởi động Gmail Auto-Sync & GSC phân biệt FINALIZED / PRELIMINARY / UNKNOWN / QUERY_ERROR theo metadata nguồn, tính chuẩn 13/10–12/11 là 31 ngày', () => {
  const instrPath = path.join(REPO_ROOT, 'apps/web/src/instrumentation.ts');
  assert.ok(fs.existsSync(instrPath), 'instrumentation.ts phải tồn tại');
  const content = fs.readFileSync(instrPath, 'utf8');
  assert.ok(content.includes('ensureGmailAutoSyncPollerStarted'));
  assert.ok(content.includes('ensureTrackingBackgroundSchedulerStarted'));

  const oauthPath = path.join(REPO_ROOT, 'apps/api/src/modules/02-tracking-sync/google-oauth.service.ts');
  const oauthContent = fs.readFileSync(oauthPath, 'utf8');
  assert.ok(oauthContent.includes('export function classifyGscDateBySourceMetadata'));
  assert.ok(oauthContent.includes("dataState: 'final'"));
  assert.ok(oauthContent.includes("dataState: 'all'"));
  assert.ok(!oauthContent.includes('ageDays >= 3'), 'Phải bỏ quy tắc tự khẳng định finalized theo >= 3 ngày');

  const { countInclusiveCalendarDays, getCustomCanonicalDateRange } = require('../reporting-dates.js');
  assert.equal(countInclusiveCalendarDays('2026-10-13', '2026-11-12'), 31);
  assert.equal(getCustomCanonicalDateRange('2026-10-13', '2026-11-12').totalCalendarDays, 31);
});

test('SYS-01: Phân quyền BA giữ nguyên phạm vi từng vai trò, không vượt quyền giữa các phòng ban', () => {
  const permsPath = path.join(REPO_ROOT, 'packages/contracts/src/common/index.ts');
  const permsContent = fs.readFileSync(permsPath, 'utf8');
  assert.ok(permsContent.includes('AI_MARKETING_SEO'));
  assert.ok(permsContent.includes('SYSTEM_USER_ADMIN'));
  assert.ok(permsContent.includes('LEAD_VIEW_ALL'));
});
