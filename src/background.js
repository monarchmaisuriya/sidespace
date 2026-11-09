import { loadSettings, onSettingsChanged, searchTemplate } from './shared/settings.js';
import { buildSessionRules } from './shared/rules.js';
import { resolveInput } from './shared/url.js';
import { sendToPanel } from './shared/inbox.js';

const MENU = Object.freeze({ link: 'open-link', page: 'open-page', selection: 'search-selection' });

function chromeMajorVersion() {
  const match = /Chrome\/(\d+)/.exec(navigator.userAgent);
  if (!match) throw new Error(`Cannot read the Chrome version from "${navigator.userAgent}"`);
  return Number(match[1]);
}

// Rule updates run one at a time so two quick settings changes cannot
// interleave. Each update runs whether or not the previous one failed; a
// failure is reported to that update's caller only.
let rulesUpdate = Promise.resolve();
function applyRules(settings) {
  const run = async () => {
    const existing = await chrome.declarativeNetRequest.getSessionRules();
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: existing.map((rule) => rule.id),
      addRules: buildSessionRules(settings, chromeMajorVersion(), chrome.runtime.id),
    });
  };
  rulesUpdate = rulesUpdate.then(run, run);
  return rulesUpdate;
}

function onSettings(settings) {
  // With restore off, no panel history may stay on disk.
  if (!settings.restoreSession) chrome.storage.local.remove('lastSession');
  return applyRules(settings);
}

// Session rules live in memory only, so they are rebuilt every time the
// service worker starts, including at browser startup. The panel also asks
// for them (sidespace:sync-rules) before loading any page.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
loadSettings().then(applyRules);
onSettingsChanged(onSettings);
// An onStartup listener makes Chrome start this worker when the browser
// starts, which runs the rule setup above before any panel is opened.
chrome.runtime.onStartup.addListener(() => {});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU.link, title: 'Open link in Sidespace', contexts: ['link'] });
    chrome.contextMenus.create({ id: MENU.page, title: 'Open this page in Sidespace', contexts: ['page'] });
    chrome.contextMenus.create({ id: MENU.selection, title: 'Search Sidespace for “%s”', contexts: ['selection'] });
  });
});

// sidePanel.open() must run before any await: Chrome only allows it while the
// user gesture (menu click, shortcut) is still active.
function openPanel(windowId) {
  chrome.sidePanel.open({ windowId });
}

async function targetWindowId(tab) {
  if (tab?.windowId !== undefined && tab.windowId !== chrome.windows.WINDOW_ID_NONE) return tab.windowId;
  // Clicks inside the side panel itself carry no tab.
  return (await chrome.windows.getLastFocused()).id;
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (tab?.windowId >= 0) openPanel(tab.windowId);
  const windowId = await targetWindowId(tab);
  let url = null;
  if (info.menuItemId === MENU.link) url = info.linkUrl;
  if (info.menuItemId === MENU.page) url = info.pageUrl;
  if (info.menuItemId === MENU.selection) {
    url = resolveInput(info.selectionText, searchTemplate(await loadSettings()));
  }
  if (url) await sendToPanel(windowId, url);
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'open-current-tab-in-panel' || !tab) return;
  openPanel(tab.windowId);
  if (tab.url) await sendToPanel(tab.windowId, tab.url);
});

// Lets a page wait until the network rules match the stored settings.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'sidespace:sync-rules') return undefined;
  loadSettings()
    .then(applyRules)
    .then(() => sendResponse({ ok: true }), (error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
