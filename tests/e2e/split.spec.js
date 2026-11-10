import { test, expect } from '@playwright/test';
import { go, launch, setSettings } from './harness.js';

// "Open beside the page": Chrome's split view next to the active browser tab.
let env;
let panel;
let windowId;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  env = await launch();
  panel = await env.openPanel();
  windowId = await panel.evaluate(async () => (await chrome.windows.getCurrent()).id);
});

test.afterAll(async () => {
  await env?.close();
});

// The browser tabs of the panel's window, as { path, split, active }.
const browserTabs = () => env.worker.evaluate(async ({ id, base }) => (await chrome.tabs.query({ windowId: id }))
  .filter((tab) => (tab.url || tab.pendingUrl || "").startsWith(base))
  .map((tab) => ({ path: new URL(tab.url || tab.pendingUrl || "").pathname + new URL(tab.url || tab.pendingUrl || "").search, split: tab.splitViewId, active: tab.active })), { id: windowId, base: env.base });
const activateBrowserTab = (url) => env.worker.evaluate(async ({ id, address }) => {
  const tab = await chrome.tabs.create({ windowId: id, url: address, active: true });
  return tab.id;
}, { id: windowId, address: url });
const chooseFromMenu = async (command) => {
  await panel.click('#menu-button');
  await panel.click(`#menu [data-command="${command}"]`);
};

test('the menu opens the panel page beside the active browser tab, in one split view', async () => {
  await activateBrowserTab(`${env.base}/plain?anchor`);
  await go(panel, `${env.base}/second?beside`);
  await chooseFromMenu('open-beside');
  await expect.poll(async () => {
    const tabs = await browserTabs();
    const anchor = tabs.find((tab) => tab.path === '/plain?anchor');
    const beside = tabs.find((tab) => tab.path === '/second?beside');
    return Boolean(anchor && beside && anchor.split !== -1 && anchor.split === beside.split);
  }).toBe(true);
});

test('again from inside that split: the tab showing the site is brought forward, not duplicated', async () => {
  await env.worker.evaluate(async ({ id, base }) => {
    const [anchor] = await chrome.tabs.query({ windowId: id, url: `${base}/plain?anchor` });
    await chrome.tabs.update(anchor.id, { active: true });
  }, { id: windowId, base: env.base });
  await chooseFromMenu('open-beside');
  await expect.poll(async () => (await browserTabs()).find((tab) => tab.path === '/second?beside')?.active).toBe(true);
  expect((await browserTabs()).filter((tab) => tab.path.startsWith('/second'))).toHaveLength(1);
});

test('a different site while the active tab is already split opens as a normal tab, with the reason', async () => {
  await go(panel, `${env.altBase}/plain?other`);
  await chooseFromMenu('open-beside');
  await expect(panel.locator('#toast')).toHaveText(/^Opened next to this page: .*already in a split view/);
  await expect.poll(async () => env.worker.evaluate(async ({ id, alt }) => (await chrome.tabs.query({ windowId: id }))
    .filter((tab) => (tab.url || tab.pendingUrl || "").startsWith(alt)).map((tab) => tab.splitViewId), { id: windowId, alt: env.altBase })).toEqual([-1]);
});

test('a tab in the rail offers "Open beside the page" in its menu', async () => {
  await setSettings(panel, { tabLayout: 'rail' });
  await panel.locator('.rail-tab[aria-pressed="true"]').click({ button: 'right' });
  await expect(panel.getByRole('menuitem', { name: 'Open beside the page' })).toBeEnabled();
  await panel.keyboard.press('Escape');
});

test('a page that refuses the panel offers "Open beside this page" on its hint', async () => {
  await setSettings(panel, { unlockFraming: false });
  await activateBrowserTab(`${env.altBase}/plain?anchor-hint`);
  await go(panel, `${env.base}/xfo?hint`);
  await expect(panel.locator('#load-hint')).toBeVisible();
  await panel.locator('#hint-open-beside').press('Enter');
  await expect.poll(async () => (await browserTabs()).find((tab) => tab.path === '/xfo?hint')?.split ?? -1).not.toBe(-1);
  await setSettings(panel, { unlockFraming: true });
});

test.describe('rail apps set to open beside the page', () => {
  const storedApps = () => panel.evaluate(async () => (await chrome.storage.local.get('settings')).settings.apps);
  const appTabs = () => env.worker.evaluate(async ({ id, base }) => (await chrome.tabs.query({ windowId: id }))
    .filter((tab) => (tab.url || tab.pendingUrl || '').startsWith(`${base}/second?app`)).map((tab) => ({ split: tab.splitViewId, active: tab.active })), { id: windowId, base: env.base });

  test('clicking the app opens it beside the page, and no panel tab', async () => {
    await setSettings(panel, { apps: [{ id: 'app-beside', title: 'Beside app', url: `${env.base}/second?app`, beside: true }] });
    await activateBrowserTab(`${env.altBase}/plain?anchor2`);
    const panelTabs = await panel.locator('#tabs .tab').count();
    await panel.locator('.rail-app').click();
    await expect.poll(async () => (await appTabs()).map((tab) => tab.split !== -1)).toEqual([true]);
    await expect(panel.locator('#tabs .tab')).toHaveCount(panelTabs);
    await expect(panel.locator('.rail-app')).toHaveAttribute('title', 'Beside app\nOpens beside the page');
  });

  test('clicking it again brings that tab forward, even at another address on the site', async () => {
    await env.worker.evaluate(async ({ id, alt, base }) => {
      // Like Gmail moving from its start address to an inbox address.
      const [app] = await chrome.tabs.query({ windowId: id, url: `${base}/second?app` });
      await chrome.tabs.update(app.id, { url: `${base}/second?app-inbox` });
      const [anchor] = await chrome.tabs.query({ windowId: id, url: `${alt}/plain?anchor2` });
      await chrome.tabs.update(anchor.id, { active: true });
    }, { id: windowId, alt: env.altBase, base: env.base });
    await panel.locator('.rail-app').click();
    await expect.poll(async () => (await appTabs()).map((tab) => tab.active)).toEqual([true]);
  });

  test('the rail menu toggles it, and the edit dialog and settings page show it', async () => {
    await panel.locator('.rail-app').click({ button: 'right' });
    const toggle = panel.getByRole('menuitemcheckbox', { name: 'Always open beside the page' });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await expect.poll(async () => (await storedApps())[0].beside).toBe(false);
    await panel.locator('.rail-app').click({ button: 'right' });
    await panel.getByRole('menuitem', { name: 'Edit…' }).click();
    await expect(panel.locator('#app-beside')).not.toBeChecked();
    await panel.locator('#app-beside').check();
    await panel.click('#app-save');
    await expect.poll(async () => (await storedApps())[0].beside).toBe(true);
    const options = await env.context.newPage();
    await options.goto(`chrome-extension://${env.extensionId}/src/options/options.html`);
    const box = options.locator('#apps li[data-key="app-beside"] .beside input');
    await expect(box).toBeChecked();
    await box.uncheck();
    await expect.poll(async () => (await storedApps())[0]).toEqual({ id: 'app-beside', title: 'Beside app', url: `${env.base}/second?app`, beside: false });
    await options.close();
  });
});
