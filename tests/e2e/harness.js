// Starts a local site, launches Chromium with Sidespace loaded, and opens the
// real side panel. Set SIDESPACE_CHROME to a Chromium / Chrome for Testing
// binary to use one other than Playwright's own.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXTENSION_ROOT = fileURLToPath(new URL('../..', import.meta.url));

const page = (title, body, script = '') => `<!doctype html><title>${title}</title><h1>${body}</h1>
<a id="next" href="/second">next</a> <a id="blank" href="/second" target="_blank">blank</a>
<script>${script}</script>`;

// 127.0.0.1 and localhost are different sites, which lets one server play two.
function otherOrigin(req) {
  const [host, port] = req.headers.host.split(':');
  return `http://${host === 'localhost' ? '127.0.0.1' : 'localhost'}:${port}`;
}

export const requestLog = [];

const ROUTES = {
  '/plain': () => ({ body: page('Plain', 'plain page') }),
  '/second': () => ({ body: page('Second', 'second page') }),
  '/xfo': () => ({ headers: { 'X-Frame-Options': 'DENY' }, body: page('XFO', 'xfo page') }),
  '/csp': () => ({ headers: { 'Content-Security-Policy': "frame-ancestors 'none'" }, body: page('CSP', 'csp page') }),
  '/spa': () => ({
    body: page('SPA', 'spa page', `document.addEventListener('click', (e) => {
      if (e.target.id !== 'push') return;
      history.pushState({}, '', '/spa/next'); document.title = 'SPA next';
    });`).replace('</h1>', '</h1><button id="push">push</button>'),
  }),
  '/bust': () => ({ body: page('Bust', 'bust page', "try { top.location.href = '/plain'; } catch (e) { document.title = 'Bust blocked'; }") }),
  '/cross': (req) => ({ body: page('Cross', 'cross page').replace('</h1>', `</h1><a id="cross" href="${otherOrigin(req)}/xfo">cross</a>`) }),
  '/nest': (req) => ({ body: page('Nest', 'nest page').replace('</h1>', `</h1><iframe id="inner" src="${otherOrigin(req)}/xfo"></iframe>`) }),
  '/nest-redirect': (req) => ({
    body: page('Nest redirect', 'nest redirect page')
      .replace('</h1>', `</h1><iframe id="inner" src="/redirect?to=${encodeURIComponent(`${otherOrigin(req)}/xfo`)}"></iframe>`),
  }),
  '/redirect': (req) => ({ status: 302, headers: { Location: new URL(req.url, 'http://x').searchParams.get('to') }, body: '' }),
  '/form': () => ({ body: page('Form', 'form page').replace('</h1>', '</h1><form method="post" action="/xfo"><button id="submit">go</button></form>') }),
  '/synthetic': () => ({
    body: page('Synthetic', 'synthetic page', `setTimeout(() => {
      for (let i = 0; i < 5; i += 1) {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { altKey: true, code: 'KeyW', key: 'w', bubbles: true }));
      }
      document.getElementById('blank').click();
      document.title = 'Synthetic done';
    }, 300);`),
  }),
  '/icon-elsewhere': (req) => ({ body: `<!doctype html><title>Icon</title><link rel="icon" href="${otherOrigin(req)}/track-icon"><h1>icon page</h1>` }),
  '/ua': (req) => ({ body: `<!doctype html><title>UA</title><h1>ua</h1><pre id="ua">${req.headers['user-agent']}</pre>` }),
  '/search': (req) => ({ body: page('Search', `search ${new URL(req.url, 'http://x').searchParams.get('q')}`) }),
};

function startSite() {
  const server = createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://x');
    requestLog.push(pathname);
    const route = ROUTES[pathname] ?? ROUTES['/plain'];
    const { status = 200, headers = {}, body } = route(req);
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
    res.end(body);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function freePort() {
  return new Promise((resolve) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

export async function launch() {
  const site = await startSite();
  const { port } = site.address();
  const debugPort = await freePort();
  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'sidespace-')), {
    executablePath: process.env.SIDESPACE_CHROME || undefined,
    headless: true,
    args: [
      `--disable-extensions-except=${EXTENSION_ROOT}`,
      `--load-extension=${EXTENSION_ROOT}`,
      `--remote-debugging-port=${debugPort}`,
    ],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const control = await context.newPage();
  await control.goto(`chrome-extension://${extensionId}/src/options/options.html`);
  // sidePanel.open() needs a real user gesture, so the test clicks a button.
  await control.evaluate(() => {
    for (const action of ['open', 'close']) {
      const button = document.createElement('button');
      button.id = `test-${action}-panel`;
      button.addEventListener('click', async () => {
        const { id } = await chrome.windows.getCurrent();
        await chrome.sidePanel[action]({ windowId: id });
      });
      document.body.prepend(button);
    }
  });

  // The side panel is not exposed through the launching connection. A CDP
  // connection made after the panel exists lists it as a page.
  let cdp = null;
  async function findPanel() {
    const endpoint = `http://127.0.0.1:${debugPort}`;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const targets = await (await fetch(`${endpoint}/json/list`)).json();
      if (targets.some((t) => t.url.endsWith('/sidepanel.html'))) {
        await cdp?.close();
        cdp = await chromium.connectOverCDP(endpoint);
        const panel = cdp.contexts().flatMap((c) => c.pages()).find((p) => p.url().endsWith('/sidepanel.html'));
        if (panel) return panel;
      }
      await new Promise((resolve) => { setTimeout(resolve, 100); });
    }
    throw new Error('Side panel page did not appear');
  }

  return {
    worker,
    extensionId,
    base: `http://127.0.0.1:${port}`,
    altBase: `http://localhost:${port}`,
    async openPanel() {
      await control.click('#test-open-panel');
      const panel = await findPanel();
      await panel.waitForSelector('#address');
      return panel;
    },
    async closePanel() {
      await control.click('#test-close-panel');
    },
    async close() {
      await cdp?.close();
      await context.close();
      site.close();
    },
  };
}

// Helpers that read the panel UI.
export const activeTitle = (panel) => panel.locator('.tab[aria-selected="true"] .title').textContent();
export const activeFrame = (panel) => panel.frameLocator('iframe.frame:not([hidden])');
export async function go(panel, text) {
  await panel.fill('#address', text);
  await panel.press('#address', 'Enter');
}
export async function setSettings(panel, patch) {
  await panel.evaluate(async (changes) => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, ...changes } });
    const result = await chrome.runtime.sendMessage({ type: 'sidespace:sync-rules' });
    if (!result.ok) throw new Error(result.error);
  }, patch);
}
