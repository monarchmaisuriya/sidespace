import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { launch } from './harness.js';

// The settings page (src/options/), driven like a user: form controls, list
// buttons, file import and export, and the reset dialog.
let env;
let options;
let panel;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  env = await launch();
  panel = await env.openPanel();
  options = await env.context.newPage();
  await options.goto(`chrome-extension://${env.extensionId}/src/options/options.html`);
});

test.afterAll(async () => {
  await env?.close();
});

const stored = () => options.evaluate(async () => (await chrome.storage.local.get('settings')).settings);
const status = () => options.locator('#status');
const ruleIds = () => env.worker.evaluate(async () => (await chrome.declarativeNetRequest.getSessionRules()).map((rule) => rule.id));
const appTitles = () => options.locator('#apps li .name').evaluateAll((inputs) => inputs.map((input) => input.value));

test.describe('form controls', () => {
  test('a choice is saved, confirmed, and applied to the open panel', async () => {
    await options.selectOption('select[name="theme"]', 'dark');
    await expect(status()).toHaveText('Saved');
    await expect.poll(async () => (await stored()).theme).toBe('dark');
    await expect(panel.locator('html')).toHaveAttribute('data-theme', 'dark');
    await options.selectOption('select[name="railPosition"]', 'left');
    await expect(panel.locator('#shell')).toHaveClass(/rail-left/);
  });

  test('accent swatches store a colour, and Auto returns to the theme accent', async () => {
    await options.locator('.swatch[title="Peppermint"]').click();
    await expect.poll(async () => (await stored()).accent).toBe('#99ffe4');
    await expect(panel.locator('html')).toHaveCSS('--accent', '#99ffe4');
    await options.locator('.swatch[title="Theme default"]').click();
    await expect.poll(async () => (await stored()).accent).toBe('');
  });

  test('an invalid home page is refused with a message and not stored', async () => {
    await options.fill('input[name="homePage"]', 'javascript:alert(1)');
    await options.locator('input[name="homePage"]').blur();
    await expect(status()).toHaveText('Not saved: invalid homePage');
    expect((await stored()).homePage).toBe('');
  });

  test('turning framing unlock off removes the network rules, and on restores them', async () => {
    await options.uncheck('input[name="unlockFraming"]');
    await expect.poll(ruleIds).toEqual([]);
    await options.check('input[name="unlockFraming"]');
    await expect.poll(ruleIds).toEqual([1, 2, 3, 4, 6, 7]);
  });

  test('mobile sites typed in the box become the mobile rule domains', async () => {
    await options.selectOption('select[name="mobileMode"]', 'sites');
    await options.fill('textarea[name="mobileSites"]', 'https://www.Example.com/news\nlocalhost');
    await options.locator('textarea[name="mobileSites"]').blur();
    await expect.poll(() => env.worker.evaluate(async () => {
      const rule = (await chrome.declarativeNetRequest.getSessionRules()).find((r) => r.id === 5);
      return rule?.condition.requestDomains ?? null;
    })).toEqual(['example.com', 'localhost']);
    await expect(options.locator('textarea[name="mobileSites"]')).toHaveValue('example.com\nlocalhost');
  });
});

test.describe('mobile site list', () => {
  test('lines that are not hostnames are named in the status and dropped', async () => {
    await options.fill('textarea[name="mobileSites"]', 'example.com\nnot a host\n\nfoo');
    await options.locator('textarea[name="mobileSites"]').blur();
    await expect(status()).toHaveText('Saved; ignored: not a host, foo');
    await expect(options.locator('textarea[name="mobileSites"]')).toHaveValue('example.com');
    expect((await stored()).mobileSites).toEqual(['example.com']);
  });
});

test.describe('rail apps and speed dial lists', () => {
  test('rail apps move up and are removed, and the open panel rail follows', async () => {
    await expect.poll(appTitles).toEqual(['ChatGPT', 'Gemini', 'Claude', 'Perplexity']);
    await options.locator('#apps li[data-url="https://claude.ai/"]').getByRole('button', { name: 'Move up' }).click();
    await expect.poll(appTitles).toEqual(['ChatGPT', 'Claude', 'Gemini', 'Perplexity']);
    await options.locator('#apps li[data-url="https://www.perplexity.ai/"]').getByRole('button', { name: 'Remove' }).click();
    await expect.poll(appTitles).toEqual(['ChatGPT', 'Claude', 'Gemini']);
    await expect(panel.locator('.rail-button[data-app]')).toHaveCount(3);
    await expect(panel.locator('.rail-button[data-app]').nth(1)).toHaveAttribute('title', 'Claude');
    await expect(options.locator('#apps li').first().getByRole('button', { name: 'Move up' })).toBeDisabled();
  });

  test('add a rail app on the settings page; invalid and duplicate addresses are refused with a reason', async () => {
    const add = options.locator('#apps-add');
    await add.locator('.name').fill('Docs');
    await add.locator('.url').fill('docs.example');
    await add.getByRole('button', { name: 'Add app' }).click();
    await expect.poll(appTitles).toEqual(['ChatGPT', 'Claude', 'Gemini', 'Docs']);
    await expect(add.locator('.url')).toHaveValue('');
    await expect(panel.locator('.rail-app').last()).toHaveAttribute('data-app', 'https://docs.example/');
    await add.locator('.url').fill('not a site');
    await add.getByRole('button', { name: 'Add app' }).click();
    await expect(options.locator('#apps-error')).toHaveText('"not a site" is not a web address (http or https, at most 2048 characters)');
    await add.locator('.url').fill('https://docs.example/');
    await add.locator('.url').press('Enter');
    await expect(options.locator('#apps-error')).toHaveText('https://docs.example/ is already in the rail.');
    await expect.poll(appTitles).toEqual(['ChatGPT', 'Claude', 'Gemini', 'Docs']);
  });

  test('edit a rail app name and address in place; the app keeps its id', async () => {
    const idBefore = (await stored()).apps.at(-1).id;
    const row = options.locator('#apps li[data-url="https://docs.example/"]');
    await row.locator('.name').fill('Manual');
    await row.locator('.name').blur();
    await expect.poll(appTitles).toEqual(['ChatGPT', 'Claude', 'Gemini', 'Manual']);
    await options.locator('#apps li[data-url="https://docs.example/"] .url').fill('manual.example/start');
    await options.locator('#apps li[data-url="https://docs.example/"] .url').blur();
    await expect.poll(async () => (await stored()).apps.at(-1)).toEqual({ id: idBefore, title: 'Manual', url: 'https://manual.example/start', beside: false });
    await expect(panel.locator('.rail-app').last()).toHaveAttribute('title', 'Manual');
  });

  test('editing by keyboard: address then name in one go, and Move up keeps focus', async () => {
    await options.evaluate(async () => {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, apps: [
        { id: 'app-one', title: 'One', url: 'https://one.example/' },
        { id: 'app-two', title: 'Two', url: 'https://two.example/' },
      ] } });
    });
    await expect.poll(appTitles).toEqual(['One', 'Two']);
    const row = options.locator('#apps li[data-key="app-two"]');
    await row.locator('.url').fill('keyboard.example');
    await row.locator('.url').press('Shift+Tab');
    await expect(row.locator('.name')).toBeFocused();
    // Tabbing into a field selects its text; Right Arrow moves to its end
    // (End does not, on macOS).
    await options.keyboard.press('ArrowRight');
    await options.keyboard.type(' (kb)');
    await options.keyboard.press('Tab');
    await expect.poll(async () => (await stored()).apps).toEqual([
      { id: 'app-one', title: 'One', url: 'https://one.example/', beside: false },
      { id: 'app-two', title: 'Two (kb)', url: 'https://keyboard.example/', beside: false },
    ]);
    await row.getByRole('button', { name: 'Move up' }).focus();
    await options.keyboard.press('Enter');
    await expect.poll(appTitles).toEqual(['Two (kb)', 'One']);
    // Now first, its Move up is disabled; focus stays on the row.
    await expect(row.getByRole('button', { name: 'Move down' })).toBeFocused();
  });

  test('restore default apps brings back the four presets', async () => {
    await options.click('#apps-reset');
    await expect.poll(appTitles).toEqual(['ChatGPT', 'Gemini', 'Claude', 'Perplexity']);
  });

  test('speed dial shortcuts move up and are removed', async () => {
    await options.evaluate(async () => {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, shortcuts: [
        { title: 'One', url: 'https://one.example/' },
        { title: 'Two', url: 'https://two.example/' },
      ] } });
    });
    const titles = () => options.locator('#shortcuts li .name').evaluateAll((inputs) => inputs.map((input) => input.value));
    await expect.poll(titles).toEqual(['One', 'Two']);
    await options.locator('#shortcuts li[data-url="https://two.example/"]').getByRole('button', { name: 'Move up' }).click();
    await expect.poll(titles).toEqual(['Two', 'One']);
    await options.locator('#shortcuts li[data-url="https://two.example/"]').getByRole('button', { name: 'Remove' }).click();
    await expect.poll(titles).toEqual(['One']);
    await expect.poll(async () => (await stored()).shortcuts).toEqual([{ title: 'One', url: 'https://one.example/' }]);
  });

  test('a page pinned from the panel appears on the open settings page', async () => {
    await panel.fill('#address', `${env.base}/plain`);
    await panel.press('#address', 'Enter');
    await expect(panel.locator('.tab[aria-selected="true"] .title')).toHaveText('Plain');
    await panel.click('#menu-button');
    await panel.click('#menu-pin');
    await expect.poll(appTitles).toEqual(['ChatGPT', 'Gemini', 'Claude', 'Perplexity', 'Plain']);
  });
});

test.describe('import and export', () => {
  test('export downloads a JSON file equal to the stored settings', async () => {
    // Its own browser: the side-panel connection used by the other tests
    // redirects downloads to a folder this connection cannot see.
    const own = await launch();
    try {
      const page = await own.context.newPage();
      await page.goto(`chrome-extension://${own.extensionId}/src/options/options.html`);
      await page.selectOption('select[name="theme"]', 'dark');
      await expect(page.locator('#status')).toHaveText('Saved');
      const download = page.waitForEvent('download');
      await page.click('#export');
      const file = await download;
      expect(file.suggestedFilename()).toBe('sidespace-settings.json');
      const body = JSON.parse(readFileSync(await file.path(), 'utf8'));
      const saved = await page.evaluate(async () => (await chrome.storage.local.get('settings')).settings);
      expect(body).toEqual(saved);
      expect(body.theme).toBe('dark');
    } finally {
      await own.close();
    }
  });

  test('import applies a valid file and drops invalid entries', async () => {
    await options.setInputFiles('#import-file', {
      name: 'mine.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({
        theme: 'light',
        density: 'compact',
        shortcuts: [{ title: 'Ok', url: 'https://ok.example/' }, { title: 'Bad', url: 'javascript:alert(1)' }],
        apps: [{ title: 'Docs', url: 'https://docs.example/' }],
      })),
    });
    await expect(status()).toHaveText('Imported');
    const settings = await stored();
    expect(settings.theme).toBe('light');
    expect(settings.density).toBe('compact');
    expect(settings.shortcuts).toEqual([{ title: 'Ok', url: 'https://ok.example/' }]);
    expect(settings.apps).toEqual([{ id: expect.stringMatching(/^app-[a-z0-9]+$/), title: 'Docs', url: 'https://docs.example/', beside: false }]);
    await expect(options.locator('select[name="density"]')).toHaveValue('compact');
  });

  test('import of a file that is not JSON names the file and the error, and changes nothing', async () => {
    const before = await stored();
    await options.setInputFiles('#import-file', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('theme: dark') });
    await expect(status()).toContainText('Import failed: notes.txt is not valid JSON');
    expect(await stored()).toEqual(before);
  });

  test('import of a JSON file that is not Sidespace settings is refused and changes nothing', async () => {
    const before = await stored();
    await options.setInputFiles('#import-file', {
      name: 'package.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ name: 'something-else', version: '1.0.0' })),
    });
    await expect(status()).toHaveText('Import failed: package.json has no Sidespace settings');
    expect(await stored()).toEqual(before);
    await options.setInputFiles('#import-file', { name: 'list.json', mimeType: 'application/json', buffer: Buffer.from('[]') });
    await expect(status()).toHaveText('Import failed: list.json has no Sidespace settings');
    expect(await stored()).toEqual(before);
  });

  test('import of an older export keeps its values and fills in newer settings with defaults', async () => {
    await options.setInputFiles('#import-file', {
      name: 'sidespace-0.1.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ theme: 'dark', shortcuts: [{ title: 'Old', url: 'https://old.example/' }] })),
    });
    await expect(status()).toHaveText('Imported');
    const settings = await stored();
    expect(settings.theme).toBe('dark');
    expect(settings.shortcuts).toEqual([{ title: 'Old', url: 'https://old.example/' }]);
    expect(settings.railPosition).toBe('right');
    expect(settings.apps.map((app) => app.title)).toEqual(['ChatGPT', 'Gemini', 'Claude', 'Perplexity']);
  });
});

test.describe('reset and custom search', () => {
  test('reset asks first: cancel keeps everything, OK restores the defaults', async () => {
    const before = await stored();
    options.once('dialog', (dialog) => dialog.dismiss());
    await options.click('#reset');
    await expect.poll(stored).toEqual(before);
    options.once('dialog', (dialog) => dialog.accept());
    await options.click('#reset');
    await expect(status()).toHaveText('Reset');
    const settings = await stored();
    expect(settings.theme).toBe('system');
    expect(settings.shortcuts).toEqual([]);
  });

  test('a custom template without %s is refused, and the field stays open with the typed text', async () => {
    await options.selectOption('select[name="searchEngine"]', 'custom');
    await options.fill('input[name="customSearchUrl"]', 'https://search.example/?q=');
    await options.locator('input[name="customSearchUrl"]').blur();
    await expect(status()).toHaveText('Not saved: invalid customSearchUrl, searchEngine');
    await expect(options.locator('input[name="customSearchUrl"]')).toBeVisible();
    await expect(options.locator('input[name="customSearchUrl"]')).toHaveValue('https://search.example/?q=');
    await expect(options.locator('select[name="searchEngine"]')).toHaveValue('custom');
    expect((await stored()).searchEngine).toBe('google');
  });

  test('choosing a custom engine waits for a template, and a valid template saves both', async () => {
    await options.selectOption('select[name="searchEngine"]', 'custom');
    await expect(options.locator('input[name="customSearchUrl"]')).toBeVisible();
    await expect(options.locator('input[name="customSearchUrl"]')).toBeFocused();
    expect((await stored()).searchEngine).toBe('google');
    await options.fill('input[name="customSearchUrl"]', 'https://search.example/?q=%s');
    await options.locator('input[name="customSearchUrl"]').blur();
    await expect(status()).toHaveText('Saved');
    const settings = await stored();
    expect(settings.searchEngine).toBe('custom');
    expect(settings.customSearchUrl).toBe('https://search.example/?q=%s');
  });
});
