import { test, expect } from '@playwright/test';
import { activeFrame, launch } from './harness.js';

// Runs against a copy of the extension where "bookmarks" is a required
// permission (see extensionWithBookmarks in harness.js).
let env;
let panel;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  env = await launch({ grantBookmarks: true });
  panel = await env.openPanel();
  await panel.evaluate(async (base) => {
    const folder = await chrome.bookmarks.create({ parentId: '1', title: 'Work' });
    await chrome.bookmarks.create({ parentId: folder.id, title: 'Plain fixture', url: `${base}/plain` });
    await chrome.bookmarks.create({ parentId: folder.id, title: 'Bookmarklet', url: 'javascript:alert(1)' });
    await chrome.bookmarks.create({ parentId: '2', title: 'Second fixture', url: `${base}/second` });
  }, env.base);
  await panel.click('.rail-button[data-view="bookmarks"]');
});

test.afterAll(async () => {
  await env?.close();
});

const rows = () => panel.locator('#bookmark-list button');
const labels = () => panel.locator('#bookmark-list button .label');

test('with access granted, the top folders show and no prompt appears', async () => {
  await expect(panel.locator('#bookmark-permission')).toBeHidden();
  await expect(rows().filter({ hasText: 'Bookmarks bar' })).toHaveCount(1);
  await expect(rows().filter({ hasText: 'Other bookmarks' })).toHaveCount(1);
});

test('folders open with breadcrumbs, and a breadcrumb goes back up', async () => {
  await rows().filter({ hasText: 'Bookmarks bar' }).click();
  await rows().filter({ hasText: 'Work' }).click();
  await expect(panel.locator('#bookmark-crumbs button')).toHaveText(['Bookmarks', 'Bookmarks bar', 'Work']);
  await expect(labels()).toHaveText(['Plain fixture', 'Bookmarklet']);
  await expect(rows().filter({ hasText: 'Bookmarklet' })).toBeDisabled();
  await panel.locator('#bookmark-crumbs button', { hasText: 'Bookmarks bar' }).click();
  await expect(rows().filter({ hasText: 'Work' })).toHaveCount(1);
});

test('search finds bookmarks by title across folders', async () => {
  await panel.fill('#bookmark-search', 'fixture');
  await expect(labels()).toHaveText(['Plain fixture', 'Second fixture']);
  await expect(panel.locator('#bookmark-crumbs')).toBeEmpty();
});

test('clicking a bookmark opens it in a new panel tab', async () => {
  const before = await panel.locator('.tab').count();
  await rows().filter({ hasText: 'Second fixture' }).click();
  await expect(panel.locator('.tab')).toHaveCount(before + 1);
  await expect(activeFrame(panel).locator('h1')).toHaveText('second page');
  await expect(panel.locator('#bookmarks-view')).toBeHidden();
});

test('the star bookmarks the current panel page, and the list updates', async () => {
  await panel.click('.rail-button[data-view="bookmarks"]');
  await panel.fill('#bookmark-search', '');
  await panel.click('#bookmark-add');
  await expect.poll(() => panel.evaluate(async (url) => (await chrome.bookmarks.search({ url })).length, `${env.base}/second`)).toBe(2);
  await panel.fill('#bookmark-search', 'Second');
  await expect(rows()).toHaveCount(2);
});
