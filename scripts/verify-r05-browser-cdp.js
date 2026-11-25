'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, 'storage', 'pg-migration-artifacts');
const BASE_URL = 'http://127.0.0.1:3000';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9345;
const PROFILE_DIR = path.join(
  'C:\\Users\\vtv55\\.gemini\\antigravity\\brain\\a04b1bb4-54f0-43d1-a010-b12c6cf33c00\\scratch',
  `chrome-r05-${Date.now()}`,
);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForCdpTarget(port, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (resp.ok) {
        const list = await resp.json();
        const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (page) return page;
      }
    } catch {
      // retry
    }
    await sleep(300);
  }
  throw new Error('Timed out waiting for Chrome CDP target');
}

class CdpSession {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', (e) => reject(e));
      ws.addEventListener('message', (ev) => {
        const msg = JSON.parse(String(ev.data));
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve: res, reject: rej } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) rej(new Error(msg.error.message));
          else res(msg.result);
        }
      });
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) {
      throw new Error(
        `JS Eval Error: ${res.exceptionDetails.text} ${res.exceptionDetails.exception?.description || ''}`,
      );
    }
    return res.result?.value;
  }

  async screenshot(outFile) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(res.data, 'base64');
    fs.writeFileSync(outFile, buf);
    return { path: outFile, sizeBytes: buf.length };
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const chromeProc = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${PROFILE_DIR}`,
      '--window-size=1440,960',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      `${BASE_URL}/login`,
    ],
    { stdio: 'ignore' },
  );

  let cdp = null;
  try {
    const target = await waitForCdpTarget(CDP_PORT);
    cdp = new CdpSession(target.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    // 1. Login via browser fetch so cookie is set in Chrome context, then navigate to /leads
    await sleep(1500);
    const loginStatus = await cdp.eval(`
      (async () => {
        const resp = await fetch('/api/v1/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            identifier: 'admin@toantrung.vn',
            password: '${process.env.SEED_DEV_PASSWORD || 'ToanTrung@2026'}'
          })
        });
        return resp.status;
      })()
    `);
    if (loginStatus !== 200) {
      throw new Error(`Browser login failed with status ${loginStatus}`);
    }

    await cdp.send('Page.navigate', { url: `${BASE_URL}/leads` });

    // Wait for /leads table to finish initial load
    let initialLoaded = false;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      const state = await cdp.eval(`
        (() => {
          const text = document.body?.innerText || '';
          const hasTable = text.includes('QUẢN LÝ LEAD') || text.includes('Danh sách') || document.querySelectorAll('table tbody tr').length > 0;
          return { hasTable, rows: document.querySelectorAll('table tbody tr').length };
        })()
      `);
      if (state && state.rows > 0) {
        initialLoaded = true;
        break;
      }
    }
    if (!initialLoaded) {
      throw new Error('Leads table did not load in Chrome');
    }

    // Plant a non-reload marker on window, set a search filter, and open the Create Lead modal ('n' shortcut)
    const setupState = await cdp.eval(`
      (() => {
        window.__r05NoReloadMarker = 'STAYED_ON_PAGE_' + Date.now();

        // Set React controlled input helper
        function setReactInputValue(el, val) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          const textareaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
          if (el.tagName === 'TEXTAREA' && textareaSetter) {
            textareaSetter.call(el, val);
          } else if (setter) {
            setter.call(el, val);
          } else {
            el.value = val;
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        window.__setReactInputValue = setReactInputValue;

        // 1. Focus search input via '/' shortcut and set filter to 'M01-09', plus click '1. Vừa Nhận Thông Tin' status filter
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
        const searchInput =
          (document.activeElement && document.activeElement.tagName === 'INPUT' ? document.activeElement : null) ||
          Array.from(document.querySelectorAll('input')).find((el) =>
            (el.placeholder || '').toLowerCase().includes('tìm') ||
            (el.placeholder || '').toLowerCase().includes('mã') ||
            (el.placeholder || '').toLowerCase().includes('sđt'),
          );
        if (searchInput) {
          window.__r05SearchInputEl = searchInput;
          setReactInputValue(searchInput, 'M01-09');
          searchInput.blur();
        }

        const newLeadFilterBtn = Array.from(document.querySelectorAll('button')).find((b) =>
          (b.innerText || '').includes('1. Vừa Nhận Thông Tin'),
        );
        if (newLeadFilterBtn) {
          newLeadFilterBtn.click();
        }

        // 2. Open Create Lead Modal via 'Tạo Lead mới' button
        const createBtn = Array.from(document.querySelectorAll('button')).find((b) =>
          (b.innerText || '').includes('Tạo Lead mới'),
        );
        if (createBtn) {
          createBtn.click();
        } else {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
        }

        return {
          marker: window.__r05NoReloadMarker,
          searchFilterSet: searchInput ? searchInput.value : null,
          statusFilterClicked: Boolean(newLeadFilterBtn),
        };
      })()
    `);

    await sleep(600);

    // 3. Inside the open Create Lead Modal, test R06 10-digit phone limit AND type in-progress customer name & note without submitting
    const formFilledState = await cdp.eval(`
      (() => {
        const setReactInputValue = window.__setReactInputValue;
        const telInputs = Array.from(document.querySelectorAll('input[type="tel"]'));
        const telInput = telInputs[telInputs.length - 1];
        if (!telInput) return { error: 'No tel input found in modal' };

        // Try typing 13 digits into the 10-digit phone field
        setReactInputValue(telInput, '0912345678999');

        // Type in-progress text into customer name & initial note inside modal
        const modalInputs = Array.from(document.querySelectorAll('input[type="text"]'));
        const nameInput =
          modalInputs.find(
            (el) =>
              (el.placeholder || '').includes('Nguyễn Văn') ||
              (el.placeholder || '').includes('Họ tên') ||
              (el.placeholder || '').includes('Anh/Chị'),
          ) || modalInputs[modalInputs.length - 1];
        const textareas = Array.from(document.querySelectorAll('textarea'));
        const noteArea = textareas[textareas.length - 1];

        if (nameInput) {
          setReactInputValue(nameInput, 'Khách Đang Nhập Dở Dang M01-09');
        }
        if (noteArea) {
          setReactInputValue(noteArea, 'Đang nhập ghi chú dở dang trên form — không được reset khi có Lead mới!');
        }

        return {
          phoneMaxLengthAttr: telInput.getAttribute('maxlength') || telInput.maxLength,
          phonePatternAttr: telInput.getAttribute('pattern'),
          phoneValueAfterTyping13Digits: telInput.value,
          inProgressNameValue: nameInput ? nameInput.value : null,
          inProgressNoteValue: noteArea ? noteArea.value : null,
        };
      })()
    `);

    const beforeShot = await cdp.screenshot(
      path.join(OUT_DIR, 'r05-m01-09-before-auto-update.png'),
    );

    // 4. Create a new Lead on the server while the user's filter ('M01-09') and open modal form are active!
    const uniqueLivePhone = `093${String(Date.now()).slice(-7)}`;
    const serverCreatedLead = await cdp.eval(`
      (async () => {
        const meResp = await fetch('/api/v1/auth/me');
        const meJson = await meResp.json();
        const csrf = meJson?.data?.user?.csrfToken || meJson?.user?.csrfToken;
        const createResp = await fetch('/api/v1/leads', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': csrf,
          },
          body: JSON.stringify({
            contactChannel: 'form_web',
            phone: '${uniqueLivePhone}',
            contactName: 'Khách Tự Động Cập Nhật M01-09 Live',
            companyName: 'Công ty Kiểm Chứng Giao Diện M01-09',
            projectName: 'Dự án LED M01-09 Auto Sync',
            province: 'TP. Hồ Chí Minh',
            hcmDistrict: 'Phường 7, Quận Gò Vấp',
            initialNote: 'Lead mới tạo từ máy chủ khi người dùng đang mở form nhập dở dang'
          }),
        });
        return { status: createResp.status, body: await createResp.json() };
      })()
    `);

    // 5. Wait 9 seconds (past the 8s throttle window) and trigger window focus/visibility auto-poll (or wait for interval) WITHOUT reloading page
    await sleep(9000);
    await cdp.eval(`
      (() => {
        window.dispatchEvent(new Event('focus'));
        return true;
      })()
    `);
    await sleep(2000);

    // 6. Inspect DOM state after automatic background update
    const afterState = await cdp.eval(`
      (() => {
        const searchInput = window.__r05SearchInputEl;
        const telInputs = Array.from(document.querySelectorAll('input[type="tel"]'));
        const telInput = telInputs[telInputs.length - 1];
        const modalInputs = Array.from(document.querySelectorAll('input[type="text"]'));
        const nameInput =
          modalInputs.find(
            (el) =>
              (el.placeholder || '').includes('Nguyễn Văn') ||
              (el.placeholder || '').includes('Họ tên') ||
              (el.placeholder || '').includes('Anh/Chị'),
          ) || modalInputs[modalInputs.length - 1];
        const bodyText = document.body?.innerText || '';

        return {
          noReloadMarkerPreserved: window.__r05NoReloadMarker === '${setupState.marker}',
          searchFilterPreserved: searchInput ? searchInput.value : null,
          phoneValuePreserved: telInput ? telInput.value : null,
          inProgressNamePreserved: nameInput ? nameInput.value : null,
          newLeadAppearedInDomWithoutReload:
            bodyText.includes('Khách Tự Động Cập Nhật M01-09 Live') &&
            bodyText.includes('${uniqueLivePhone}'),
          autoSyncFeedbackBannerShown:
            bodyText.includes('Hệ thống vừa tự động quét và tiếp nhận') ||
            bodyText.includes('Khách Tự Động Cập Nhật M01-09 Live'),
          visibleMatchedRowsCount: document.querySelectorAll('table tbody tr').length,
        };
      })()
    `);

    const afterShot = await cdp.screenshot(
      path.join(OUT_DIR, 'r05-m01-09-after-auto-update.png'),
    );

    const browserReport = {
      verifiedAt: new Date().toISOString(),
      browserEngine: 'Google Chrome Headless CDP (127.0.0.1:9345)',
      targetUrl: `${BASE_URL}/leads`,
      setupState,
      r06Phone10DigitUiCheck: {
        inputTyped: '0912345678999 (13 digits)',
        maxLengthAttr: formFilledState.phoneMaxLengthAttr,
        patternAttr: formFilledState.phonePatternAttr,
        actualValueInInput: formFilledState.phoneValueAfterTyping13Digits,
        enforced10DigitsStrictly:
          String(formFilledState.phoneValueAfterTyping13Digits).length === 10 &&
          formFilledState.phoneValueAfterTyping13Digits === '0912345678',
      },
      m01_09AutoRefreshCheck: {
        serverCreatedLead,
        afterAutoPollState: afterState,
        screenshots: {
          beforeAutoUpdate: beforeShot,
          afterAutoUpdate: afterShot,
        },
        passedAllCriteria:
          afterState.noReloadMarkerPreserved === true &&
          afterState.searchFilterPreserved === 'M01-09' &&
          afterState.phoneValuePreserved === '0912345678' &&
          afterState.inProgressNamePreserved === 'Khách Đang Nhập Dở Dang M01-09' &&
          afterState.newLeadAppearedInDomWithoutReload === true,
      },
    };

    const outPath = path.join(OUT_DIR, 'r05-browser-m01-09-report.json');
    fs.writeFileSync(outPath, JSON.stringify(browserReport, null, 2), 'utf8');
    console.log(JSON.stringify(browserReport, null, 2));
  } finally {
    if (cdp) cdp.close();
    chromeProc.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
