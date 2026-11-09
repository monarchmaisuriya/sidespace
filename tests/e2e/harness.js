// Starts a local site, launches Chromium with Sidespace loaded, and opens the
// real side panel. Set SIDESPACE_CHROME to a Chromium / Chrome for Testing
// binary to use one other than Playwright's own.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
  '/set-login': () => ({
    headers: {
      'Set-Cookie': [
        'lax_session=1; Path=/; SameSite=Lax',
        'strict_session=1; Path=/; SameSite=Strict',
        'none_session=1; Path=/; SameSite=None; Secure',
      ],
    },
    body: page('Set login', 'logged in', "localStorage.setItem('login', 'yes');"),
  }),
  '/whoami': (req) => ({
    body: `<!doctype html><title>Whoami</title><h1>whoami</h1><pre id="cookies">${req.headers.cookie ?? ''}</pre><pre id="storage"></pre>
<script>document.getElementById('storage').textContent = localStorage.getItem('login') ?? 'none';</script>`,
  }),
  '/opener-timer': () => ({
    body: page('Opener timer', 'opener timer page', `setTimeout(() => {
      window.open('/second?via=timer', '_blank', 'noopener');
      document.title = 'Timer fired';
    }, 300);`),
  }),
  '/forged-alive': () => ({
    body: page('Forged', 'forged page', `setTimeout(() => {
      parent.postMessage({ type: 'sidespace:frame-alive', token: 'forged-token' }, '*');
      parent.postMessage({ type: 'sidespace:frame-alive', token: '' }, '*');
    }, 200);
    setTimeout(() => { document.title = 'Title after forgery'; }, 700);`),
  }),
  '/opener-base': () => ({
    body: `<!doctype html><title>Opener base</title><base href="/base/"><h1>opener base page</h1>
      <button id="open-relative" onclick="window.open('second?via=base', '_blank', 'noopener')">relative</button>`,
  }),
  '/opener': () => ({
    body: page('Opener', 'opener page').replace('</h1>', `</h1>
      <button id="open-noopener" onclick="window.open('/second?via=noopener', '_blank', 'noopener')">noopener</button>
      <button id="open-plain" onclick="window.open('/second?via=plain')">plain</button>`),
  }),
  '/with-icon': () => ({ body: '<!doctype html><title>With icon</title><link rel="icon" href="/icon.png"><h1>with icon</h1>' }),
  '/icon.png': () => ({ headers: { 'Content-Type': 'image/png' }, body: readFileSync(join(EXTENSION_ROOT, 'icons/icon-32.png')) }),
  // Like Gemini's and Claude's icons: loads fine for the site itself, but is
  // refused to other origins (the extension page included).
  '/corp-icon-page': () => ({ body: '<!doctype html><title>CORP icon</title><link rel="icon" href="/corp-icon.png"><h1>corp icon</h1>' }),
  '/corp-icon.png': () => ({
    headers: { 'Content-Type': 'image/png', 'Cross-Origin-Resource-Policy': 'same-origin' },
    body: readFileSync(join(EXTENSION_ROOT, 'icons/icon-48.png')),
  }),
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

// A copy of the extension with "bookmarks" as a required permission: Chrome's
// permission prompt cannot be clicked from automation, and a required
// permission needs no prompt. Everything else is the shipped code.
function extensionWithBookmarks() {
  const root = mkdtempSync(join(tmpdir(), 'sidespace-ext-'));
  for (const item of ['manifest.json', 'src', 'icons']) cpSync(join(EXTENSION_ROOT, item), join(root, item), { recursive: true });
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  manifest.permissions.push('bookmarks');
  manifest.optional_permissions = manifest.optional_permissions.filter((name) => name !== 'bookmarks');
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
  return root;
}

export async function launch({ grantBookmarks = false } = {}) {
  const extensionRoot = grantBookmarks ? extensionWithBookmarks() : EXTENSION_ROOT;
  const site = await startSite();
  const { port } = site.address();
  const debugPort = await freePort();
  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'sidespace-')), {
    // The 'chromium' channel is the full browser in headless mode; Playwright's
    // default headless shell cannot load extensions.
    ...(process.env.SIDESPACE_CHROME ? { executablePath: process.env.SIDESPACE_CHROME } : { channel: 'chromium' }),
    headless: true,
    args: [
      `--disable-extensions-except=${extensionRoot}`,
      `--load-extension=${extensionRoot}`,
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
    context,
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

// Links and buttons inside panel pages are activated with the keyboard
// (locator.press('Enter')), not the mouse. A mouse event is routed into the
// page's cross-process frame by screen position, and Chromium occasionally
// drops one sent right after the page renders (seen as 3 of 20 clicks never
// reaching the page, 2026-11-09). Keyboard input goes to the focused frame,
// and Enter still produces the real, trusted click the extension checks for.

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

// Switches tab through the tab list (the toolbar's tab count button).
export async function pickTab(panel, tab) {
  await panel.click('#tabs-button');
  await tab.click();
}
