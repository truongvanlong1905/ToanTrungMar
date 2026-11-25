'use strict';

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
  parseGadsSearchTermRows,
  parseGadsLandingPageRows,
  parseGadsDeviceRows,
  parseGadsTimeScheduleRows,
} = require('../../modules/02-tracking-sync/gads-live-cache.service.ts');

const {
  aggregateGscQueryPageLinks,
} = require('../../modules/03-keywords-ads/gsc-live-cache.service.ts');

const {
  parseGoogleTrendsCsvAuto,
} = require('../../modules/03-keywords-ads/google-trends.service.ts');

test('Google Ads GAQL parsers chuẩn hóa search_term_view, landing_page_view, device và khung giờ', () => {
  const terms = parseGadsSearchTermRows([
    {
      searchTermView: { searchTerm: 'báo giá màn hình led p2.5', status: 'ADDED' },
      campaign: { name: 'LED_Indoor_TT' },
      adGroup: { name: 'P2.5 Indoor' },
      metrics: { impressions: '120', clicks: '15', costMicros: '45000000000', conversions: 2 },
    },
    {
      searchTermView: { searchTerm: 'Báo Giá Màn Hình LED P2.5', status: 'ADDED' },
      campaign: { name: 'LED_Indoor_TT' },
      adGroup: { name: 'P2.5 Indoor' },
      metrics: { impressions: '80', clicks: '5', costMicros: '15000000000', conversions: 1 },
    },
  ]);
  assert.equal(terms.length, 1);
  assert.equal(terms[0].clicks, 20);
  assert.equal(terms[0].impressions, 200);
  assert.equal(terms[0].ctrPct, 10);
  assert.equal(terms[0].cost, 60000);
  assert.equal(terms[0].conversions, 3);

  const lps = parseGadsLandingPageRows([
    {
      landingPageView: { unexpandedFinalUrl: 'https://toantrung.com.vn/man-hinh-led-indoor/' },
      campaign: { name: 'LED_Indoor_TT' },
      metrics: { impressions: '500', clicks: '50', costMicros: '250000000000', conversions: 4 },
    },
  ]);
  assert.equal(lps.length, 1);
  assert.equal(lps[0].ctrPct, 10);
  assert.equal(lps[0].avgCpc, 5000);
  assert.equal(lps[0].cost, 250000);

  const devs = parseGadsDeviceRows([
    { segments: { device: 'MOBILE' }, metrics: { impressions: '300', clicks: '30', costMicros: '90000000000' } },
    { segments: { device: 'DESKTOP' }, metrics: { impressions: '200', clicks: '10', costMicros: '50000000000' } },
  ]);
  assert.equal(devs[0].device, 'Điện thoại di động');
  assert.equal(devs[0].cost, 90000);

  const sched = parseGadsTimeScheduleRows([
    { segments: { dayOfWeek: 'MONDAY', hour: 9 }, metrics: { impressions: '100', clicks: '10', costMicros: '20000000000', conversions: 1 } },
  ]);
  assert.equal(sched[0].dayOfWeek, 'Thứ 2');
  assert.equal(sched[0].hour, 9);
});

test('GSC aggregateGscQueryPageLinks gom chính xác cặp query-page và tính CTR/vị trí bình quân gia quyền', () => {
  const links = aggregateGscQueryPageLinks([
    { keys: ['màn hình led hội trường', 'https://toantrung.com.vn/hoi-truong?token=secret'], clicks: 10, impressions: 100, position: 4 },
    { keys: ['màn hình led hội trường', 'https://toantrung.com.vn/hoi-truong'], clicks: 10, impressions: 100, position: 2 },
  ]);
  assert.equal(links.length, 1);
  assert.equal(links[0].clicks, 20);
  assert.equal(links[0].impressions, 200);
  assert.equal(links[0].ctrPct, 10);
  assert.equal(links[0].averagePosition, 3);
});

test('Google Trends parseGoogleTrendsCsvAuto đọc đúng multiTimeline.csv đa từ khóa và geoMap.csv Tỉnh/Thành', () => {
  const timelineCsv = [
    'Danh mục: Tất cả các danh mục',
    '',
    'Tuần,"màn hình led: (Việt Nam)","bảng điện tử led: (Việt Nam)","led ngoài trời: (Việt Nam)"',
    '2026-10-04,78,24,<1',
    '2026-10-11,85,30,12',
  ].join('\n');

  const parsedTl = parseGoogleTrendsCsvAuto(timelineCsv);
  assert.equal(parsedTl.detectedType, 'timeline');
  assert.deepEqual(parsedTl.terms, ['màn hình led', 'bảng điện tử led', 'led ngoài trời']);
  assert.equal(parsedTl.timelinePoints.length, 6);
  const underOne = parsedTl.timelinePoints.find((p) => p.term === 'led ngoài trời' && p.date === '2026-10-04');
  assert.equal(underOne.value, 1);

  const geoCsv = [
    'Khu vực: Việt Nam',
    '',
    'Tỉnh/Thành phố,"màn hình led: (Việt Nam)"',
    'TP. Hồ Chí Minh,100',
    'Hà Nội,82',
    'Bình Dương,67',
  ].join('\n');

  const parsedGeo = parseGoogleTrendsCsvAuto(geoCsv);
  assert.equal(parsedGeo.detectedType, 'geomap');
  assert.deepEqual(parsedGeo.terms, ['màn hình led']);
  assert.equal(parsedGeo.regionRows.length, 3);
  assert.equal(parsedGeo.regionRows[0].regionName, 'TP. Hồ Chí Minh');
  assert.equal(parsedGeo.regionRows[0].interestValue, 100);
});
