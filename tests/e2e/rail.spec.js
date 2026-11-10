import { test, expect } from '@playwright/test';
import { activeFrame, go, launch, pickTab, setSettings } from './harness.js';

// The redesigned panel: tabs in the rail or the tab list, rail app editing,
// the short address bar, site icons, fonts and the Vesper accent.
let env;
let panel;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  env = await launch();
  panel = await env.openPanel();
  await setSettings(panel, { apps: [{ title: 'Plain app', url: `${env.base}/plain` }] });
});

test.afterAll(async () => {
  await env?.close();
});

const railApps = () => panel.locator('.rail-app');
const railTabs = () => panel.locator('.rail-tab');
const stored = () => panel.evaluate(async () => (await chrome.storage.local.get('settings')).settings);

test.describe('tabs', () => {
  test('ordinary tabs show in the rail, app tabs only as their app', async () => {
    await go(panel, `${env.base}/second`);
    await expect(railTabs()).toHaveCount(1);
    await railApps().first().click();
    await expect(railApps().first()).toHaveAttribute('aria-pressed', 'true');
    await expect(railTabs()).toHaveCount(1);
    await expect(panel.locator('#tab-count')).toHaveText('2');
  });

  test('a tab closes from its button in the rail', async () => {
    await panel.click('#new-tab');
    await expect(railTabs()).toHaveCount(2);
    await railTabs().last().hover();
    await panel.locator('.rail-close').last().click();
    await expect(railTabs()).toHaveCount(1);
  });

  test('the tab list shows every tab with its full title and switches tabs', async () => {
    await panel.click('#tabs-button');
    await expect(panel.locator('#tab-drawer')).toBeVisible();
    await expect(panel.locator('#tabs .tab .title')).toHaveText(['Second', 'Plain']);
    await panel.locator('#tabs .tab', { hasText: 'Second' }).click();
    await expect(panel.locator('#tab-drawer')).toBeHidden();
    await expect(activeFrame(panel).locator('h1')).toHaveText('second page');
  });

  test('with "only in the tab list", the rail shows no tabs', async () => {
    await setSettings(panel, { tabLayout: 'drawer' });
    await expect(railTabs()).toBeHidden();
    await expect(railApps()).toHaveCount(1);
    await setSettings(panel, { tabLayout: 'rail' });
    await expect(railTabs().first()).toBeVisible();
  });
});

test.describe('rail apps', () => {
  test('add an app from the current page through the dialog', async () => {
    await go(panel, `${env.base}/csp`);
    await panel.click('#add-app');
    await expect(panel.locator('#app-dialog')).toBeVisible();
    await expect(panel.locator('#app-url')).toHaveValue(`${env.base}/csp`);
    await panel.fill('#app-name', 'CSP page');
    await panel.click('#app-save');
    await expect(panel.locator('#app-dialog')).toBeHidden();
    await expect(railApps()).toHaveCount(2);
    await expect(railApps().last()).toHaveAttribute('title', 'CSP page');
    await expect(railApps().last()).toHaveAttribute('aria-pressed', 'true');
  });

  test('the dialog refuses an invalid or duplicate address and stays open', async () => {
    await panel.click('#new-tab');
    await panel.click('#add-app');
    await panel.fill('#app-url', 'hello');
    await panel.click('#app-save');
    await expect(panel.locator('#app-error')).toHaveText('"hello" is not a web address (http or https, at most 2048 characters)');
    await panel.fill('#app-url', `${env.base}/plain`);
    await panel.click('#app-save');
    await expect(panel.locator('#app-error')).toHaveText(`${env.base}/plain is already in the rail.`);
    await expect(panel.locator('#app-dialog')).toBeVisible();
    await panel.click('#app-cancel');
    await expect(railApps()).toHaveCount(2);
  });

  test('edit an app from its right-click menu; its open tab stays tied to it', async () => {
    const idBefore = await railApps().last().getAttribute('data-app-id');
    await railApps().last().click({ button: 'right' });
    await panel.getByRole('menuitem', { name: 'Edit…' }).click();
    await expect(panel.locator('#app-name')).toHaveValue('CSP page');
    await panel.fill('#app-name', 'Renamed');
    await panel.fill('#app-url', `${env.altBase}/csp`);
    await panel.click('#app-save');
    await expect(railApps().last()).toHaveAttribute('title', 'Renamed');
    await expect(railApps().last()).toHaveAttribute('data-app', `${env.altBase}/csp`);
    await expect(railApps().last()).toHaveClass(/is-open/);
    expect((await stored()).apps.at(-1)).toEqual({ id: idBefore, title: 'Renamed', url: `${env.altBase}/csp`, beside: false });
  });

  test('move an app up from its menu, then remove it', async () => {
    await railApps().last().click({ button: 'right' });
    await panel.getByRole('menuitem', { name: 'Move up' }).click();
    await expect(railApps().first()).toHaveAttribute('title', 'Renamed');
    await railApps().first().click({ button: 'right' });
    await panel.getByRole('menuitem', { name: 'Remove from rail' }).click();
    await expect(railApps()).toHaveCount(1);
    await expect(railApps().first()).toHaveAttribute('title', 'Plain app');
  });

  test('drag an app to reorder the rail', async () => {
    await setSettings(panel, { apps: [{ title: 'One', url: `${env.base}/plain` }, { title: 'Two', url: `${env.base}/second` }] });
    await expect(railApps()).toHaveCount(2);
    await railApps().last().dragTo(railApps().first());
    await expect.poll(async () => (await stored()).apps.map((app) => app.title)).toEqual(['Two', 'One']);
  });
});

test.describe('rail apps edited elsewhere', () => {
  test('editing an app address on the settings page keeps its open tab tied to it', async () => {
    await setSettings(panel, { apps: [{ id: 'app-tied', title: 'Tied', url: `${env.base}/plain` }] });
    await railApps().first().click();
    await expect(railApps().first()).toHaveClass(/is-open/);
    const railTabsBefore = await railTabs().count();
    const options = await env.context.newPage();
    await options.goto(`chrome-extension://${env.extensionId}/src/options/options.html`);
    await options.locator('#apps li[data-key="app-tied"] .url').fill(`${env.base}/second`);
    await options.locator('#apps li[data-key="app-tied"] .url').blur();
    await expect(railApps().first()).toHaveAttribute('data-app', `${env.base}/second`);
    await expect(railApps().first()).toHaveClass(/is-open/);
    await expect(railTabs()).toHaveCount(railTabsBefore);
    await options.close();
  });

  test('a rail menu action on an app removed elsewhere shows why it failed', async () => {
    await railApps().first().click({ button: 'right' });
    await panel.evaluate(async () => {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, apps: [] } });
    });
    await panel.getByRole('menuitem', { name: 'Remove from rail' }).click();
    await expect(panel.locator('#toast')).toHaveText('That link is no longer in the rail.');
  });

  test('Enter on a close button in the tab list closes that tab', async () => {
    await panel.click('#new-tab');
    const count = await panel.locator('#tabs .tab').count();
    await panel.click('#tabs-button');
    await panel.locator('#tabs .tab').last().locator('.close').focus();
    await panel.keyboard.press('Enter');
    await expect(panel.locator('#tabs .tab')).toHaveCount(count - 1);
  });

  test('rail apps are buttons to assistive technology', async () => {
    await setSettings(panel, { apps: [{ title: 'Named app', url: `${env.base}/plain` }] });
    await expect(panel.getByRole('button', { name: 'Named app' })).toHaveCount(1);
  });
});

test.describe('look', () => {
  test('the address bar shows a short address at rest, keeping http://, and the full URL while editing', async () => {
    await go(panel, `${env.base}/`);
    await expect(panel.locator('#address')).toHaveValue(env.base);
    await panel.click('#address');
    await expect(panel.locator('#address')).toHaveValue(`${env.base}/`);
    await panel.press('#address', 'Escape');
    await expect(panel.locator('#address')).toHaveValue(env.base);
  });

  test("a page's own icon is shown, and an unknown site gets a letter, never a generic globe", async () => {
    await go(panel, `${env.base}/with-icon`);
    await expect(panel.locator('.rail-tab[aria-pressed="true"] .favicon img')).toHaveAttribute('src', `${env.base}/icon.png`);
    await go(panel, `${env.altBase}/second`);
    // Chrome's icon store answers this unknown site with its generic globe,
    // and the site has no /favicon.ico: the letter stays.
    await expect(panel.locator('.rail-tab[aria-pressed="true"] .favicon')).toHaveAttribute('data-icon', 'letter');
    await expect(panel.locator('.rail-tab[aria-pressed="true"] .favicon')).toHaveText('L');
  });

  test("a site whose icon refuses other origins gets its real icon from Chrome's icon store", async () => {
    // Visiting the page in a normal tab is how Chrome's icon store learns it.
    const tab = await env.context.newPage();
    await tab.goto(`${env.base}/corp-icon-page`);
    const store = `chrome-extension://${env.extensionId}/_favicon/?pageUrl=${encodeURIComponent(`${env.base}/corp-icon-page`)}&size=32`;
    const unknown = `chrome-extension://${env.extensionId}/_favicon/?pageUrl=${encodeURIComponent('https://sidespace-unknown-site.invalid/')}&size=32`;
    const bytes = (url) => panel.evaluate(async (src) => (await (await fetch(src)).arrayBuffer()).byteLength, url);
    await expect.poll(async () => (await bytes(store)) !== (await bytes(unknown)), { timeout: 10_000 }).toBe(true);
    await tab.close();
    await go(panel, `${env.base}/corp-icon-page`);
    const icon = panel.locator('.rail-tab[aria-pressed="true"] .favicon');
    await expect(icon).toHaveAttribute('data-icon', 'image');
    await expect(icon.locator('img')).toHaveAttribute('src', store);
  });

  test('every text element in the panel and settings page uses the theme fonts and sizes', async () => {
    const audit = (page) => page.evaluate(() => {
      const families = new Set();
      const sizes = new Set();
      for (const element of document.querySelectorAll('body *')) {
        if (element.closest('svg, iframe')) continue;
        // Controls count even when empty; other elements when they hold text.
        const hasText = ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(element.tagName)
          || [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
        if (!hasText) continue;
        const style = getComputedStyle(element);
        families.add(style.fontFamily);
        sizes.add(style.fontSize);
      }
      return { families: [...families].sort(), sizes: [...sizes].sort() };
    });
    const ui = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    const mono = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    const scale = ['11px', '12px', '13px', '15px', '20px', '40px'];
    const options = await env.context.newPage();
    await options.goto(`chrome-extension://${env.extensionId}/src/options/options.html`);
    await panel.click('#new-tab');
    for (const page of [panel, options]) {
      const { families, sizes } = await audit(page);
      expect(families.filter((family) => family !== ui && family !== mono), `fonts on ${page.url()}`).toEqual([]);
      expect(sizes.filter((size) => !scale.includes(size)), `sizes on ${page.url()}`).toEqual([]);
    }
    await options.close();
  });

  test('dark theme uses the Vesper peach accent, and text on any accent stays readable', async () => {
    await setSettings(panel, { theme: 'dark', accent: '' });
    const colours = () => panel.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return [style.getPropertyValue('--bg').trim(), style.getPropertyValue('--accent').trim(), style.getPropertyValue('--on-accent').trim()];
    });
    await expect.poll(colours).toEqual(['#101010', '#ffc799', '#000000']);
    await setSettings(panel, { accent: '#ffffff' });
    await expect.poll(colours).toEqual(['#101010', '#ffffff', '#000000']);
    await setSettings(panel, { accent: '#1a1a1a' });
    await expect.poll(colours).toEqual(['#101010', '#1a1a1a', '#ffffff']);
  });
});
