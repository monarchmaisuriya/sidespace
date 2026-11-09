import { test, expect } from '@playwright/test';
import { go, launch, setSettings } from './harness.js';

// The home page options and the rail's spacing, in the real side panel.
let env;
let panel;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  env = await launch();
  panel = await env.openPanel();
  await setSettings(panel, { theme: 'dark', apps: [{ title: 'Plain app', url: `${env.base}/plain` }] });
});

test.afterAll(async () => {
  await env?.close();
});

const box = (locator) => locator.evaluate((element) => {
  const r = element.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, middle: (r.top + r.bottom) / 2 };
});
// The bar marking the active rail button is drawn by ::before.
const activeBar = (locator) => locator.evaluate((element) => {
  const r = element.getBoundingClientRect();
  const bar = getComputedStyle(element, '::before');
  const left = r.left + parseFloat(bar.left);
  return { left, right: left + parseFloat(bar.width) };
});
const homeParts = () => panel.locator('#speed-dial > [data-section]:not([hidden])').evaluateAll((parts) => parts.map((part) => part.dataset.section));

test.describe('rail spacing', () => {
  for (const [railPosition, density] of [['right', 'comfortable'], ['left', 'compact']]) {
    test(`rail on the ${railPosition}, ${density}: active bar and close button stay inside the rail, first button lines up with the toolbar`, async () => {
      await setSettings(panel, { railPosition, density });
      await go(panel, `${env.base}/second`);
      const tab = panel.locator('.rail-tab[aria-pressed="true"]');
      await panel.click('#new-tab');
      await go(panel, `${env.base}/plain?again`);
      await tab.hover();
      const rail = await panel.locator('#rail').evaluate((element) => {
        const r = element.getBoundingClientRect();
        const border = parseFloat(getComputedStyle(element).borderLeftWidth);
        return { left: r.left + border, right: r.right - border };
      });
      const bar = await activeBar(tab);
      const close = await box(panel.locator('.rail-item:hover .rail-close'));
      expect(bar.left).toBeGreaterThanOrEqual(rail.left);
      expect(bar.right).toBeLessThanOrEqual(rail.right);
      expect(close.left).toBeGreaterThanOrEqual((await box(tab)).left);
      expect(close.right).toBeLessThanOrEqual((await box(tab)).right);
      const firstRail = await box(panel.locator('.rail-app').first());
      const back = await box(panel.locator('#back'));
      expect(Math.abs(firstRail.middle - back.middle)).toBeLessThanOrEqual(1);
    });
  }

  test('a blank tab shows the home glyph in the rail, not a letter', async () => {
    await setSettings(panel, { railPosition: 'right', density: 'comfortable' });
    await panel.click('#new-tab');
    const icon = panel.locator('.rail-tab[aria-pressed="true"] .favicon');
    await expect(icon).toHaveAttribute('data-icon', 'home');
    await expect(icon).toHaveText('');
  });
});

test.describe('home page', () => {
  test('the clock follows the chosen 12 or 24-hour format', async () => {
    await panel.clock.setFixedTime(new Date(2026, 10, 10, 0, 35));
    await setSettings(panel, { clockFormat: '24' });
    await expect(panel.locator('#clock-time')).toHaveText('00:35');
    await setSettings(panel, { clockFormat: '12' });
    await expect(panel.locator('#clock-time')).toHaveText(/^12:35\s?AM$/i);
  });

  test('parts follow the stored order, and hidden parts are not shown', async () => {
    await expect.poll(homeParts).toEqual(['clock', 'date', 'search', 'shortcuts']);
    await setSettings(panel, { homeSections: [{ id: 'search', show: true }, { id: 'shortcuts', show: true }, { id: 'clock', show: false }, { id: 'date', show: true }] });
    await expect.poll(homeParts).toEqual(['search', 'shortcuts', 'date']);
    await expect(panel.locator('#clock-time')).toBeHidden();
  });

  test('a backdrop colour sets the background and readable text', async () => {
    await setSettings(panel, { homeBackground: { type: 'colour', colour: '#f5f0e6' } });
    const style = () => panel.locator('#speed-dial').evaluate((element) => [getComputedStyle(element).backgroundColor, getComputedStyle(element).color]);
    await expect.poll(style).toEqual(['rgb(245, 240, 230)', 'rgb(0, 0, 0)']);
    await setSettings(panel, { homeBackground: { type: 'theme', colour: '#f5f0e6' } });
    await expect(panel.locator('#speed-dial')).not.toHaveAttribute('data-backdrop');
  });

  test('a stored picture becomes the background; without one the theme shows', async () => {
    await setSettings(panel, { homeBackground: { type: 'image', colour: '#1c1c1c' } });
    await expect(panel.locator('#speed-dial')).not.toHaveAttribute('data-backdrop');
    await panel.evaluate(async () => {
      const canvas = new OffscreenCanvas(4, 4);
      canvas.getContext('2d').fillRect(0, 0, 4, 4);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      const url = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
      await chrome.storage.local.set({ homeImage: url });
    });
    await expect(panel.locator('#speed-dial')).toHaveAttribute('data-backdrop', 'image');
    await expect(panel.locator('#speed-dial')).toHaveCSS('background-image', /^url\("data:image\/png;base64,/);
    await panel.evaluate(() => chrome.storage.local.remove('homeImage'));
    await expect(panel.locator('#speed-dial')).not.toHaveAttribute('data-backdrop');
  });

  test('shortcut grid: columns, icon size and labels', async () => {
    await setSettings(panel, {
      shortcuts: [{ title: 'Plain', url: `${env.base}/plain` }],
      shortcutColumns: '4',
      shortcutSize: 'large',
      shortcutLabels: false,
    });
    const tiles = panel.locator('#tiles');
    await expect.poll(() => tiles.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(4);
    await expect(panel.locator('.tile .favicon')).toHaveCSS('width', '56px');
    await expect(panel.locator('.tile .label')).toBeHidden();
    await setSettings(panel, { shortcutColumns: 'auto', shortcutSize: 'small', shortcutLabels: true });
    await expect(panel.locator('.tile .label')).toBeVisible();
    await expect(panel.locator('.tile .favicon')).toHaveCSS('width', '40px');
  });
});

test.describe('settings page: new tab page section', () => {
  let options;
  const stored = () => panel.evaluate(async () => (await chrome.storage.local.get('settings')).settings);

  test.beforeAll(async () => {
    await setSettings(panel, { homeSections: undefined, homeBackground: undefined });
    options = await env.context.newPage();
    await options.goto(`chrome-extension://${env.extensionId}/src/options/options.html`);
  });

  test.afterAll(async () => {
    await options?.close();
  });

  test('hiding and moving parts updates the open panel', async () => {
    await options.getByRole('checkbox', { name: 'Clock' }).uncheck();
    await options.getByRole('button', { name: 'Move Shortcuts up' }).click();
    await expect.poll(homeParts).toEqual(['date', 'shortcuts', 'search']);
    await expect(options.getByRole('button', { name: 'Move Shortcuts up' })).toBeFocused();
  });

  test('the clock format select is saved', async () => {
    await options.selectOption('select[name="clockFormat"]', '12');
    await expect.poll(async () => (await stored()).clockFormat).toBe('12');
  });

  test('choosing a colour background shows the colour picker and saves the colour', async () => {
    await options.selectOption('#home-background-type', 'colour');
    await expect(options.locator('#home-background-colour')).toBeVisible();
    await options.locator('#home-background-colour').evaluate((input) => {
      input.value = '#336699';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect.poll(async () => (await stored()).homeBackground).toEqual({ type: 'colour', colour: '#336699' });
    await expect(panel.locator('#speed-dial')).toHaveCSS('background-color', 'rgb(51, 102, 153)');
  });

  test('a chosen picture is shrunk to WebP, shown in the panel, and removable', async () => {
    await options.selectOption('#home-background-type', 'theme');
    const png = await options.evaluate(async () => {
      const canvas = new OffscreenCanvas(3000, 1500);
      canvas.getContext('2d').fillRect(0, 0, 3000, 1500);
      return [...new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())];
    });
    await options.locator('#home-image-file').setInputFiles({ name: 'wide.png', mimeType: 'image/png', buffer: Buffer.from(png) });
    await expect(panel.locator('#speed-dial')).toHaveAttribute('data-backdrop', 'image');
    const size = await panel.evaluate(async () => {
      const { homeImage } = await chrome.storage.local.get('homeImage');
      const bitmap = await createImageBitmap(await (await fetch(homeImage)).blob());
      return [homeImage.slice(0, 23), bitmap.width, bitmap.height];
    });
    expect(size).toEqual(['data:image/webp;base64,', 2560, 1280]);
    await options.click('#home-image-remove');
    await expect(panel.locator('#speed-dial')).not.toHaveAttribute('data-backdrop');
    expect(await panel.evaluate(() => chrome.storage.local.get('homeImage'))).toEqual({});
  });

  test('a file that is not a picture is refused with its name', async () => {
    await options.selectOption('#home-background-type', 'image');
    await options.locator('#home-image-file').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(options.locator('#home-image-error')).toHaveText('notes.txt is not a picture.');
    expect(await panel.evaluate(() => chrome.storage.local.get('homeImage'))).toEqual({});
  });
});
