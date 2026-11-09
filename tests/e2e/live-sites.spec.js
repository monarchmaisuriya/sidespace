import { test, expect } from '@playwright/test';
import { go, launch } from './harness.js';

// Loads real websites in the side panel. Needs network access, so it runs only
// with SIDESPACE_LIVE=1 (npm run test:live). It checks that each site's own
// page loads in the panel frame, not that you can sign in.
const SITES = [
  'https://chatgpt.com/',
  'https://claude.ai/',
  'https://gemini.google.com/',
  'https://www.perplexity.ai/',
  'https://github.com/',
  'https://en.wikipedia.org/',
  'https://www.youtube.com/',
];

test.describe.configure({ mode: 'serial' });
test.skip(!process.env.SIDESPACE_LIVE, 'set SIDESPACE_LIVE=1 to load live sites');

let env;
let panel;

test.beforeAll(async () => {
  env = await launch();
  panel = await env.openPanel();
});

test.afterAll(async () => {
  await env?.close();
});

// The page title the panel stored for the active tab. Only our content script
// inside the site's own page reports it, so a non-empty title proves the frame
// shows the site and not an error page (the tab label alone falls back to the
// host name, which would prove nothing).
async function activeTabTitle() {
  await panel.waitForTimeout(400); // the session is saved 300 ms after a change
  return panel.evaluate(async () => {
    const { id } = await chrome.windows.getCurrent();
    const key = `session:${id}`;
    const saved = (await chrome.storage.session.get(key))[key];
    return saved?.tabs.find((tab) => tab.id === saved.activeId)?.title ?? '';
  });
}

for (const url of SITES) {
  test(`${new URL(url).hostname} loads in the panel`, async () => {
    test.setTimeout(60_000);
    await go(panel, url);
    await expect.poll(activeTabTitle, { timeout: 25_000 }).not.toBe('');
    // The hint is decided about a second after each load; give slow pages time.
    await panel.waitForTimeout(5000);
    await expect(panel.locator('#load-hint')).toBeHidden();
  });
}
