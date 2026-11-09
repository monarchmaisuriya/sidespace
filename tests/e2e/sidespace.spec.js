import { test, expect } from '@playwright/test';
import { activeFrame, activeTitle, go, launch, requestLog, setSettings } from './harness.js';

let env;
let panel;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  env = await launch();
  panel = await env.openPanel();
});

test.afterAll(async () => {
  await env?.close();
});

const address = () => panel.locator('#address');

test.describe('loading pages', () => {
  test('a page opens in the real side panel and reports its title and URL', async () => {
    await go(panel, `${env.base}/plain`);
    await expect(activeFrame(panel).locator('h1')).toHaveText('plain page');
    await expect.poll(() => activeTitle(panel)).toBe('Plain');
    await expect(address()).toHaveValue(`${env.base}/plain`);
  });

  test('a page that loads fine in a new tab shows no "not showing" hint', async () => {
    await panel.click('#new-tab');
    await go(panel, `${env.base}/second`);
    await expect(activeFrame(panel).locator('h1')).toHaveText('second page');
    await panel.waitForTimeout(1500);
    await expect(panel.locator('#load-hint')).toBeHidden();
  });

  test('an extra load event from a page that is still there shows no hint', async () => {
    await go(panel, `${env.base}/plain`);
    await expect(activeFrame(panel).locator('h1')).toHaveText('plain page');
    await panel.locator('iframe.frame:not([hidden])').dispatchEvent('load');
    await panel.waitForTimeout(1500);
    await expect(panel.locator('#load-hint')).toBeHidden();
  });

  test('a site you are signed in to in a normal tab is signed in inside the panel', async () => {
    const tab = await env.context.newPage();
    await tab.goto(`${env.base}/set-login`);
    await tab.close();
    await go(panel, `${env.base}/whoami`);
    await expect(activeFrame(panel).locator('#cookies')).toHaveText('lax_session=1; strict_session=1; none_session=1');
    await expect(activeFrame(panel).locator('#storage')).toHaveText('yes');
  });

  test('a page sending X-Frame-Options: DENY still renders', async () => {
    await go(panel, `${env.base}/xfo`);
    await expect(activeFrame(panel).locator('h1')).toHaveText('xfo page');
    await expect.poll(() => activeTitle(panel)).toBe('XFO');
  });

  test("a page sending frame-ancestors 'none' still renders", async () => {
    await go(panel, `${env.base}/csp`);
    await expect(activeFrame(panel).locator('h1')).toHaveText('csp page');
  });

  test('a cross-site link to a DENY page, clicked inside the panel, renders', async () => {
    await go(panel, `${env.base}/cross`);
    await activeFrame(panel).locator('#cross').click();
    await expect(activeFrame(panel).locator('h1')).toHaveText('xfo page');
    await expect(address()).toHaveValue(`${env.altBase}/xfo`);
  });

  test('a same-site form POST to a DENY page renders', async () => {
    await go(panel, `${env.base}/form`);
    await activeFrame(panel).locator('#submit').click();
    await expect(activeFrame(panel).locator('h1')).toHaveText('xfo page');
    await expect(address()).toHaveValue(`${env.base}/xfo`);
  });

  test('text that is not an address goes to the configured search engine', async () => {
    await setSettings(panel, { searchEngine: 'custom', customSearchUrl: `${env.base}/search?q=%s` });
    await go(panel, 'side panel');
    await expect(activeFrame(panel).locator('h1')).toHaveText('search side panel');
  });
});

test.describe('security', () => {
  test('a page in the panel cannot embed another site with its framing protection removed', async () => {
    await go(panel, `${env.base}/nest`);
    await expect(activeFrame(panel).locator('h1')).toHaveText('nest page');
    await panel.waitForTimeout(500);
    await expect(activeFrame(panel).frameLocator('#inner').locator('h1', { hasText: 'xfo page' })).toHaveCount(0);
  });

  test('...not even through a same-site redirect', async () => {
    await go(panel, `${env.base}/nest-redirect`);
    await expect(activeFrame(panel).locator('h1')).toHaveText('nest redirect page');
    await panel.waitForTimeout(500);
    await expect(activeFrame(panel).frameLocator('#inner').locator('h1', { hasText: 'xfo page' })).toHaveCount(0);
  });

  test('a page cannot navigate the panel itself away', async () => {
    await go(panel, `${env.base}/bust`);
    await expect.poll(() => activeTitle(panel)).toBe('Bust blocked');
    expect(panel.url()).toMatch(/\/sidepanel\.html$/);
  });

  test('synthetic key presses and clicks from a page neither close nor open tabs', async () => {
    const before = await panel.locator('.tab').count();
    await go(panel, `${env.base}/synthetic`);
    await expect.poll(() => activeTitle(panel)).toBe('Synthetic done');
    await panel.waitForTimeout(300);
    await expect(panel.locator('.tab')).toHaveCount(before);
  });

  test('an icon on another origin is never requested', async () => {
    requestLog.length = 0;
    await go(panel, `${env.base}/icon-elsewhere`);
    await expect.poll(() => activeTitle(panel)).toBe('Icon');
    await panel.waitForTimeout(1500);
    expect(requestLog).not.toContain('/track-icon');
  });

  test('a page sending forged "still here" messages cannot take over its tab link', async () => {
    await go(panel, `${env.base}/forged-alive`);
    await expect.poll(() => activeTitle(panel)).toBe('Title after forgery');
    await expect(address()).toHaveValue(`${env.base}/forged-alive`);
  });

  test('with framing unlock off, a DENY page is blocked and the hint appears', async () => {
    await setSettings(panel, { unlockFraming: false });
    await go(panel, `${env.base}/xfo`);
    await expect(panel.locator('#load-hint')).toBeVisible();
    // Chrome's own error page has an <h1> too, so look for the page's text.
    await expect(activeFrame(panel).locator('h1', { hasText: 'xfo page' })).toHaveCount(0);
    await setSettings(panel, { unlockFraming: true });
    await panel.click('#reload');
    await expect(activeFrame(panel).locator('h1')).toHaveText('xfo page');
    await expect(panel.locator('#load-hint')).toBeHidden();
  });
});

test.describe('navigation', () => {
  test('the address bar follows link clicks and pushState', async () => {
    await go(panel, `${env.base}/plain`);
    await activeFrame(panel).locator('#next').click();
    await expect(address()).toHaveValue(`${env.base}/second`);
    await go(panel, `${env.base}/spa`);
    await activeFrame(panel).locator('#push').click();
    await expect(address()).toHaveValue(`${env.base}/spa/next`);
    await expect.poll(() => activeTitle(panel)).toBe('SPA next');
  });

  test('back and forward move through the tab history, including pushState entries', async () => {
    await panel.click('#back');
    await expect(address()).toHaveValue(`${env.base}/spa`);
    await panel.click('#back');
    await expect(address()).toHaveValue(`${env.base}/second`);
    await expect(activeFrame(panel).locator('h1')).toHaveText('second page');
    await panel.click('#forward');
    await expect(address()).toHaveValue(`${env.base}/spa`);
    await expect(activeFrame(panel).locator('h1')).toHaveText('spa page');
  });

  test('going back to a cross-site DENY page renders it', async () => {
    await go(panel, `${env.base}/cross`);
    await activeFrame(panel).locator('#cross').click();
    await expect(address()).toHaveValue(`${env.altBase}/xfo`);
    await activeFrame(panel).locator('#next').click();
    await expect(address()).toHaveValue(`${env.altBase}/second`);
    await panel.click('#back');
    await expect(activeFrame(panel).locator('h1')).toHaveText('xfo page');
  });

  test('back in one tab does not move another tab', async () => {
    await go(panel, `${env.base}/plain`);
    await activeFrame(panel).locator('#next').click();
    await expect(address()).toHaveValue(`${env.base}/second`);
    const firstTab = await panel.locator('.tab[aria-selected="true"]').getAttribute('data-id');
    await panel.click('#new-tab');
    await go(panel, `${env.base}/csp`);
    await activeFrame(panel).locator('#next').click();
    await expect(address()).toHaveValue(`${env.base}/second`);
    await panel.click(`.tab[data-id="${firstTab}"]`);
    await panel.click('#back');
    await expect(address()).toHaveValue(`${env.base}/plain`);
    await panel.locator('.tab').last().click();
    await expect(address()).toHaveValue(`${env.base}/second`);
  });

  test('a target=_blank link opens a new panel tab', async () => {
    await go(panel, `${env.base}/plain`);
    const before = await panel.locator('.tab').count();
    await activeFrame(panel).locator('#blank').click();
    await expect(panel.locator('.tab')).toHaveCount(before + 1);
    await expect(address()).toHaveValue(`${env.base}/second`);
  });

  test('window.open with noopener during a click opens a panel tab, not a window', async () => {
    await go(panel, `${env.base}/opener`);
    await expect.poll(() => activeTitle(panel)).toBe('Opener');
    const before = await panel.locator('.tab').count();
    const pagesBefore = env.context.pages().length;
    await activeFrame(panel).locator('#open-noopener').click();
    await expect(panel.locator('.tab')).toHaveCount(before + 1);
    await expect(address()).toHaveValue(`${env.base}/second?via=noopener`);
    expect(env.context.pages().length).toBe(pagesBefore);
  });

  test("window.open resolves a relative URL against the page's base URL", async () => {
    await go(panel, `${env.base}/opener-base`);
    await expect.poll(() => activeTitle(panel)).toBe('Opener base');
    await activeFrame(panel).locator('#open-relative').click();
    await expect(address()).toHaveValue(`${env.base}/base/second?via=base`);
  });

  test('window.open with noopener but no user interaction goes to the real window.open', async () => {
    // Playwright turns Chrome's popup blocker off, so the real call opens a
    // browser tab; that tab is the proof the panel did not take the call.
    const tabsBefore = await panel.locator('.tab').count();
    const popup = env.context.waitForEvent('page');
    await go(panel, `${env.base}/opener-timer`);
    const opened = await popup;
    expect(opened.url()).toBe(`${env.base}/second?via=timer`);
    await opened.close();
    await expect.poll(() => activeTitle(panel)).toBe('Timer fired');
    await expect(panel.locator('.tab')).toHaveCount(tabsBefore);
  });

  test('window.open without noopener keeps the real popup, so sign-in popups still work', async () => {
    await go(panel, `${env.base}/opener`);
    await expect.poll(() => activeTitle(panel)).toBe('Opener');
    const before = await panel.locator('.tab').count();
    const popup = env.context.waitForEvent('page');
    await activeFrame(panel).locator('#open-plain').click();
    const opened = await popup;
    expect(opened.url()).toBe(`${env.base}/second?via=plain`);
    await opened.close();
    await expect(panel.locator('.tab')).toHaveCount(before);
  });

  test('a URL sent from the service worker inbox opens as a tab', async () => {
    const windowId = await panel.evaluate(async () => (await chrome.windows.getCurrent()).id);
    await env.worker.evaluate(async ({ id, url }) => {
      await chrome.storage.session.set({ 'inbox:test': { windowId: id, url, at: Date.now() } });
    }, { id: windowId, url: `${env.base}/second?from=inbox` });
    await expect(address()).toHaveValue(`${env.base}/second?from=inbox`);
    const leftover = await env.worker.evaluate(() => chrome.storage.session.get('inbox:test'));
    expect(leftover).toEqual({});
  });

  test('mobile view applies only to the chosen site', async () => {
    await go(panel, `${env.altBase}/ua`);
    await expect(activeFrame(panel).locator('#ua')).not.toContainText('Android');
    await panel.click('#menu-button');
    await panel.check('#mobile-toggle');
    await expect(activeFrame(panel).locator('#ua')).toContainText('Android');
    await go(panel, `${env.base}/ua`);
    await expect(activeFrame(panel).locator('#ua')).not.toContainText('Android');
  });
});

test.describe('rail, views and dashboard', () => {
  test('a rail app opens its own tab, and clicking it again returns to that tab', async () => {
    await setSettings(panel, { apps: [{ title: 'Local app', url: `${env.base}/plain` }] });
    const app = panel.locator('.rail-button[data-app]');
    await expect(app).toHaveCount(1);
    const before = await panel.locator('.tab').count();
    await app.click();
    await expect(panel.locator('.tab')).toHaveCount(before + 1);
    await expect(app).toHaveAttribute('aria-pressed', 'true');
    await activeFrame(panel).locator('#next').click();
    await expect(address()).toHaveValue(`${env.base}/second`);
    await panel.locator('.tab').first().click();
    await expect(app).toHaveAttribute('aria-pressed', 'false');
    await app.click();
    await expect(panel.locator('.tab')).toHaveCount(before + 1);
    await expect(address()).toHaveValue(`${env.base}/second`);
  });

  test('pin and unpin the current page from the menu', async () => {
    await go(panel, `${env.base}/csp`);
    await panel.click('#menu-button');
    await panel.click('#menu-pin');
    await expect(panel.locator('.rail-button[data-app]')).toHaveCount(2);
    await panel.click('#menu-button');
    await expect(panel.locator('#menu-pin')).toHaveText('Unpin from rail');
    await panel.click('#menu-pin');
    await expect(panel.locator('.rail-button[data-app]')).toHaveCount(1);
  });

  test('notes save and come back after reopening the panel', async () => {
    await panel.click('.rail-button[data-view="notes"]');
    await expect(panel.locator('#notes-view')).toBeVisible();
    await panel.fill('#notes', 'remember the milk');
    await expect(panel.locator('#notes-status')).toHaveText('Saved');
    await panel.click('.rail-button[data-view="notes"]');
    await expect(panel.locator('#notes-view')).toBeHidden();
  });

  test('the bookmarks view asks for access before showing anything (without the permission)', async () => {
    await panel.click('.rail-button[data-view="bookmarks"]');
    await expect(panel.locator('#bookmark-permission')).toBeVisible();
    await expect(panel.locator('#bookmark-list li')).toHaveCount(0);
    await panel.click('.rail-button[data-view="bookmarks"]');
  });

  test('the new tab page shows the clock and its search box loads results', async () => {
    await panel.click('#new-tab');
    await expect(panel.locator('#clock-time')).toHaveText(/\d/);
    await panel.fill('#dashboard-query', 'from dashboard');
    await panel.press('#dashboard-query', 'Enter');
    await expect(activeFrame(panel).locator('h1')).toHaveText('search from dashboard');
  });
});

test.describe('persistence', () => {
  test('tabs, history and notes survive closing and reopening the panel', async () => {
    await go(panel, `${env.base}/plain`);
    await expect.poll(() => activeTitle(panel)).toBe('Plain');
    const titles = await panel.locator('.tab .title').allTextContents();
    await env.closePanel();
    panel = await env.openPanel();
    await expect(panel.locator('.tab .title')).toHaveText(titles);
    await expect(address()).toHaveValue(`${env.base}/plain`);
    await expect(panel.locator('#back')).toBeEnabled();
    await panel.click('.rail-button[data-view="notes"]');
    await expect(panel.locator('#notes')).toHaveValue('remember the milk');
    await panel.click('.rail-button[data-view="notes"]');
  });

  test('with restore off, no panel history is kept on disk', async () => {
    await setSettings(panel, { restoreSession: false });
    await go(panel, `${env.base}/second?private`);
    await panel.waitForTimeout(600);
    const stored = await env.worker.evaluate(() => chrome.storage.local.get('lastSession'));
    expect(stored).toEqual({});
    await setSettings(panel, { restoreSession: true });
  });

  test('closing the last tab leaves one fresh tab', async () => {
    const count = await panel.locator('.tab').count();
    for (let i = 0; i < count; i += 1) await panel.keyboard.press('Alt+KeyW');
    await expect(panel.locator('.tab')).toHaveCount(1);
    await expect(panel.locator('#speed-dial')).toBeVisible();
  });
});
