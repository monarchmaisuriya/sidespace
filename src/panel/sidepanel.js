import {
  isHttpUrl, loadSettings, MAX_APPS, MAX_SHORTCUTS, normalizeHostname, onSettingsChanged, searchTemplate, updateSettings,
} from '../shared/settings.js';
import {
  displayHost, isBrowserOnlyUrl, resolveInput, sameOriginUrl, trustedFrameUrl,
} from '../shared/url.js';
import { onInboxChanged, takeForWindow } from '../shared/inbox.js';
import { applyAppearance } from '../shared/theme.js';
import * as model from './session.js';
import { faviconFor } from './favicon.js';
import { initBookmarks } from './bookmarks-view.js';
import { initNotes } from './notes-view.js';

// Sandbox without allow-top-navigation: a framed page can never replace the panel.
const FRAME_SANDBOX = [
  'allow-same-origin', 'allow-scripts', 'allow-forms', 'allow-popups', 'allow-popups-to-escape-sandbox',
  'allow-modals', 'allow-downloads', 'allow-presentation', 'allow-storage-access-by-user-activation',
].join(' ');
const FRAME_ALLOW = 'clipboard-read; clipboard-write; fullscreen; autoplay; encrypted-media; picture-in-picture; web-share';
const HINT_DELAY_MS = 1000;
const SAVE_DELAY_MS = 300;
const MAX_EARLY_STATES = 100;
const VIEWS = ['web', 'bookmarks', 'notes'];
const CLOSE_ICON = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';

const $ = (id) => document.getElementById(id);
const ui = {
  shell: $('shell'),
  railApps: $('rail-apps'),
  rail: $('rail'),
  address: $('address'),
  addressForm: $('address-form'),
  back: $('back'),
  forward: $('forward'),
  reload: $('reload'),
  tabstrip: $('tabstrip'),
  tabs: $('tabs'),
  newTab: $('new-tab'),
  viewport: $('viewport'),
  speedDial: $('speed-dial'),
  clock: $('dashboard-clock'),
  clockTime: $('clock-time'),
  clockDate: $('clock-date'),
  dashboardSearch: $('dashboard-search'),
  dashboardQuery: $('dashboard-query'),
  tiles: $('tiles'),
  tilesEmpty: $('tiles-empty'),
  addShortcut: $('add-shortcut'),
  shortcutUrl: $('shortcut-url'),
  bookmarksView: $('bookmarks-view'),
  notesView: $('notes-view'),
  menu: $('menu'),
  menuPin: $('menu-pin'),
  mobileToggle: $('mobile-toggle'),
  zoomLevel: $('zoom-level'),
  hint: $('load-hint'),
  toast: $('toast'),
};

let settings;
let session = model.createSession();
let view = 'web';
let windowId;
let bookmarks;
let notes;

const frames = new Map(); // panel tab id -> <iframe>
// A page inside a frame proves which frame it lives in with a random token
// (postMessage, checked against event.source) and reports its state with the
// same token over chrome.runtime, where the browser fills in sender.url.
const tokenToTab = new Map(); // token -> panel tab id (one live token per tab)
const linkedToken = new Map(); // panel tab id -> token of the document now shown
const earlyStates = new Map(); // token -> { senderUrl, message } that arrived before the hello
// How the first URL a document reports updates the tab's history: 'replace'
// when the panel loaded it (the URL is already in history, perhaps before a
// redirect), 'push' when the page navigated by itself.
const tokenMode = new Map(); // token -> 'replace' | 'push'
const pendingLoads = new Set(); // panel tab ids the panel just loaded
const helloCount = new Map(); // panel tab id -> hellos received
const helloAtLastLoad = new Map(); // panel tab id -> helloCount when the last load was checked
const hintTabs = new Set(); // panel tab ids whose page seems not to have loaded

// ---------- session ----------

function sessionKey() {
  return `session:${windowId}`;
}

let saveTimer = 0;
function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  const data = { tabs: session.tabs, activeId: session.activeId, nextId: session.nextId, view };
  chrome.storage.session.set({ [sessionKey()]: data });
  if (settings.restoreSession) chrome.storage.local.set({ lastSession: data });
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
}

function setSession(next) {
  session = next;
  render();
  scheduleSave();
}

function setView(next) {
  view = VIEWS.includes(next) ? next : 'web';
  if (view === 'bookmarks') bookmarks.show();
  render();
  scheduleSave();
}

function openTab(url, { activate = true, app = '' } = {}) {
  try {
    setSession(model.addTab(session, { url, activate, app }).session);
    if (activate) setView('web');
  } catch (error) {
    showToast(error.message);
  }
}

function homeUrl() {
  return settings.homePage;
}

function closeTab(id) {
  dropFrame(id);
  let next = model.closeTab(session, id);
  if (next.tabs.length === 0) next = model.addTab(next, { url: homeUrl() }).session;
  setSession(next);
}

// Loads the tab's current URL into its frame (if it has one yet).
function loadFrame(tabId) {
  const frame = frames.get(tabId);
  const tab = session.tabs.find((t) => t.id === tabId);
  if (!frame || !tab?.url) return;
  unlinkTab(tabId);
  pendingLoads.add(tabId);
  frame.src = tab.url;
}

// Opens a URL in a panel tab as a new history entry, or hands browser-only
// URLs to a real tab.
function navigate(tabId, url) {
  if (isBrowserOnlyUrl(url)) {
    chrome.tabs.create({ url, windowId });
    return;
  }
  if (!isHttpUrl(url)) return;
  // A tab without a frame gets one, already pointing at the URL, on render.
  const hadFrame = frames.has(tabId);
  setSession(model.updateTab(model.pushUrl(session, tabId, url), tabId, { title: '', icon: '' }));
  if (hadFrame) loadFrame(tabId);
  if (tabId === session.activeId) setView('web');
}

function openUrlFromOutside(url) {
  if (isBrowserOnlyUrl(url)) chrome.tabs.create({ url, windowId });
  else if (isHttpUrl(url)) openTab(url);
}

function openApp(app) {
  const existing = model.findAppTab(session, app.url);
  if (existing) setSession(model.activateTab(session, existing.id));
  else openTab(app.url, { app: app.url });
  setView('web');
}

// ---------- frames ----------

function ensureFrame(tab) {
  let frame = frames.get(tab.id);
  if (frame) return frame;
  frame = document.createElement('iframe');
  frame.className = 'frame';
  frame.setAttribute('sandbox', FRAME_SANDBOX);
  frame.setAttribute('allow', FRAME_ALLOW);
  frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  frame.title = 'Web page';
  frame.addEventListener('load', () => checkLoaded(tab.id));
  // src is set before insertion, so the frame never loads about:blank first
  // (an extra load event without a hello would look like a failed page).
  pendingLoads.add(tab.id);
  frame.src = tab.url;
  frames.set(tab.id, frame);
  ui.viewport.append(frame);
  return frame;
}

function unlinkTab(tabId) {
  const token = linkedToken.get(tabId);
  if (token) {
    tokenToTab.delete(token);
    tokenMode.delete(token);
  }
  linkedToken.delete(tabId);
}

function dropFrame(tabId) {
  frames.get(tabId)?.remove();
  frames.delete(tabId);
  unlinkTab(tabId);
  pendingLoads.delete(tabId);
  helloCount.delete(tabId);
  helloAtLastLoad.delete(tabId);
  hintTabs.delete(tabId);
}

// A page that loaded but never said hello is usually an error page (blocked
// framing, network error) or a page Chrome keeps scripts out of.
function checkLoaded(tabId) {
  setTimeout(() => {
    const hellos = helloCount.get(tabId) ?? 0;
    if (hellos > (helloAtLastLoad.get(tabId) ?? 0)) hintTabs.delete(tabId);
    else hintTabs.add(tabId);
    helloAtLastLoad.set(tabId, hellos);
    renderHint();
  }, HINT_DELAY_MS);
}

function frameConfig() {
  return { type: 'sidespace:config', openLinksInPanel: settings.newWindowLinks === 'panel' };
}

function postToFrame(tabId, message) {
  frames.get(tabId)?.contentWindow?.postMessage(message, '*');
}

window.addEventListener('message', (event) => {
  const { data } = event;
  if (data?.type !== 'sidespace:frame-hello' || typeof data.token !== 'string' || data.token.length > 64) return;
  const entry = [...frames].find(([, frame]) => frame.contentWindow === event.source);
  if (!entry) return;
  const [tabId] = entry;
  unlinkTab(tabId);
  tokenToTab.set(data.token, tabId);
  linkedToken.set(tabId, data.token);
  tokenMode.set(data.token, pendingLoads.has(tabId) ? 'replace' : 'push');
  pendingLoads.delete(tabId);
  helloCount.set(tabId, (helloCount.get(tabId) ?? 0) + 1);
  hintTabs.delete(tabId);
  event.source.postMessage(frameConfig(), '*');
  const early = earlyStates.get(data.token);
  earlyStates.delete(data.token);
  if (early) applyFrameState(tabId, data.token, early.senderUrl, early.message);
  else render();
});

function applyFrameState(tabId, token, senderUrl, message) {
  const url = trustedFrameUrl(senderUrl, message.url);
  let next = model.updateTab(session, tabId, { title: message.title, icon: sameOriginUrl(message.icon, url) });
  if (url) {
    const mode = tokenMode.get(token);
    tokenMode.set(token, 'push');
    next = mode === 'replace' ? model.replaceUrl(next, tabId, url) : model.pushUrl(next, tabId, url);
  }
  setSession(next);
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== chrome.runtime.id || typeof message?.token !== 'string') return;
  const tabId = tokenToTab.get(message.token);
  if (!tabId) {
    // The hello may still be in flight. Other windows' panels also see this
    // message; for them the token never links and the entry ages out.
    if (message.type === 'sidespace:frame-state') {
      earlyStates.set(message.token, { senderUrl: sender.url, message });
      if (earlyStates.size > MAX_EARLY_STATES) earlyStates.delete(earlyStates.keys().next().value);
    }
    return;
  }
  const fromActiveTab = tabId === session.activeId && view === 'web';
  if (message.type === 'sidespace:frame-state') applyFrameState(tabId, message.token, sender.url, message);
  // A page may navigate itself, even in a background tab; that stays in its tab.
  if (message.type === 'sidespace:navigate-request' && isHttpUrl(message.url)) navigate(tabId, message.url);
  // Opening tabs and shortcuts need user input, which only the visible tab gets.
  if (message.type === 'sidespace:open-tab' && fromActiveTab && isHttpUrl(message.url)) openTab(message.url);
  if (message.type === 'sidespace:shortcut' && fromActiveTab) runShortcut(message.code);
});

// ---------- rendering ----------

function tabLabel(tab) {
  return tab.title || displayHost(tab.url) || 'New tab';
}

function renderRail() {
  ui.shell.classList.remove('rail-left', 'rail-right', 'rail-hidden');
  ui.shell.classList.add(`rail-${settings.railPosition}`);
  const active = model.activeTab(session);
  const buttons = settings.apps.map((app) => {
    const button = document.createElement('button');
    button.className = 'rail-button';
    button.dataset.app = app.url;
    button.title = app.title;
    button.setAttribute('aria-label', app.title);
    button.setAttribute('aria-pressed', String(view === 'web' && active?.app === app.url));
    const appTab = model.findAppTab(session, app.url);
    button.append(faviconFor(app.url, appTab ? sameOriginUrl(appTab.icon, app.url) : '', 32));
    return button;
  });
  ui.railApps.replaceChildren(...buttons);
  for (const button of ui.rail.querySelectorAll('[data-view]')) {
    button.setAttribute('aria-pressed', String(view === button.dataset.view));
  }
}

function renderTabs() {
  const items = session.tabs.map((tab, index) => {
    const el = document.createElement('div');
    el.className = 'tab';
    el.role = 'tab';
    el.tabIndex = tab.id === session.activeId ? 0 : -1;
    el.draggable = true;
    el.dataset.id = tab.id;
    el.title = tab.url ? `${tabLabel(tab)}\n${tab.url}` : 'New tab';
    el.setAttribute('aria-selected', String(tab.id === session.activeId && view === 'web'));
    el.setAttribute('aria-posinset', String(index + 1));
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = tabLabel(tab);
    const close = document.createElement('button');
    close.className = 'icon-button close';
    close.setAttribute('aria-label', `Close ${tabLabel(tab)}`);
    close.innerHTML = CLOSE_ICON;
    close.tabIndex = -1;
    el.append(faviconFor(tab.url, tab.icon, 16), title, close);
    return el;
  });
  ui.tabs.replaceChildren(...items);
  ui.tabs.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  ui.tabstrip.classList.toggle('hidden-strip', settings.tabStrip === 'auto' && session.tabs.length < 2);
}

function renderFrames(active) {
  for (const [tabId, frame] of frames) {
    const tab = session.tabs.find((t) => t.id === tabId);
    if (!tab || !tab.url) dropFrame(tabId);
    else frame.hidden = view !== 'web' || tabId !== active?.id;
  }
  if (view === 'web' && active?.url) {
    const frame = ensureFrame(active);
    frame.hidden = false;
    const zoom = active.zoom;
    frame.style.transform = zoom === 1 ? '' : `scale(${zoom})`;
    frame.style.width = `${100 / zoom}%`;
    frame.style.height = `${100 / zoom}%`;
  }
}

function renderClock() {
  const now = new Date();
  ui.clockTime.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  ui.clockDate.textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

function renderSpeedDial(active) {
  ui.speedDial.hidden = view !== 'web' || Boolean(active?.url);
  if (ui.speedDial.hidden) return;
  ui.clock.hidden = !settings.showClock;
  if (settings.showClock) renderClock();
  const tiles = settings.shortcuts.map((shortcut, index) => {
    const li = document.createElement('li');
    li.className = 'tile';
    const link = document.createElement('a');
    link.href = shortcut.url;
    link.dataset.url = shortcut.url;
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = shortcut.title;
    link.append(faviconFor(shortcut.url, '', 32), label);
    const remove = document.createElement('button');
    remove.className = 'icon-button small remove';
    remove.dataset.removeIndex = String(index);
    remove.setAttribute('aria-label', `Remove ${shortcut.title}`);
    remove.innerHTML = CLOSE_ICON;
    li.append(link, remove);
    return li;
  });
  ui.tiles.replaceChildren(...tiles);
  ui.tilesEmpty.hidden = tiles.length > 0;
}

function renderHint() {
  ui.hint.hidden = view !== 'web' || !hintTabs.has(session.activeId);
}

function render() {
  const active = model.activeTab(session);
  renderRail();
  renderTabs();
  renderFrames(active);
  renderSpeedDial(active);
  ui.bookmarksView.hidden = view !== 'bookmarks';
  ui.notesView.hidden = view !== 'notes';
  renderHint();
  if (document.activeElement !== ui.address) ui.address.value = view === 'web' ? (active?.url ?? '') : '';
  ui.back.disabled = view !== 'web' || !model.canGo(active, -1);
  ui.forward.disabled = view !== 'web' || !model.canGo(active, 1);
  ui.reload.disabled = view !== 'web' || !active?.url;
}

function isPinned(url) {
  return settings.apps.some((app) => app.url === url);
}

function renderMenu() {
  const active = model.activeTab(session);
  const page = view === 'web' ? active?.url : '';
  const host = page ? normalizeHostname(page) : '';
  for (const button of ui.menu.querySelectorAll('[data-command]')) {
    const needsPage = ['open-in-browser', 'add-shortcut', 'toggle-pin', 'zoom-in', 'zoom-out'].includes(button.dataset.command);
    button.disabled = needsPage && !page;
  }
  const pinnedUrl = active?.app || page;
  ui.menuPin.textContent = pinnedUrl && isPinned(pinnedUrl) ? 'Unpin from rail' : 'Pin to rail';
  ui.zoomLevel.value = `${Math.round((active?.zoom ?? 1) * 100)}%`;
  ui.mobileToggle.disabled = !host || settings.mobileMode === 'all';
  ui.mobileToggle.checked = settings.mobileMode === 'all'
    || (settings.mobileMode === 'sites' && settings.mobileSites.includes(host));
}

let toastTimer = 0;
function showToast(text) {
  ui.toast.textContent = text;
  ui.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { ui.toast.hidden = true; }, 2500);
}

// ---------- commands ----------

function activeWebTab() {
  return view === 'web' ? model.activeTab(session) : null;
}

function goHistory(step) {
  const active = activeWebTab();
  if (!active || !model.canGo(active, step)) return;
  setSession(model.goHistory(session, active.id, step));
  loadFrame(active.id);
}

function reload() {
  const active = activeWebTab();
  if (active?.url) loadFrame(active.id);
}

function newTab() {
  openTab(homeUrl());
  if (!homeUrl()) focusAddress();
}

function focusAddress() {
  if (view !== 'web') setView('web');
  ui.address.focus();
  ui.address.select();
}

// Asks the service worker to rebuild network rules from the stored settings
// and waits until they are live, so the next page load sees them.
async function syncRules() {
  const result = await chrome.runtime.sendMessage({ type: 'sidespace:sync-rules' });
  if (!result?.ok) throw new Error(`Could not update network rules: ${result?.error ?? 'no answer from the service worker'}`);
}

async function toggleMobileForActiveSite() {
  const active = activeWebTab();
  const host = active?.url ? normalizeHostname(active.url) : '';
  if (!host) return;
  const sites = new Set(settings.mobileSites);
  if (ui.mobileToggle.checked) sites.add(host);
  else sites.delete(host);
  settings = await updateSettings({ mobileSites: [...sites], mobileMode: sites.size > 0 ? 'sites' : 'off' });
  try {
    await syncRules();
  } catch (error) {
    showToast(error.message);
    throw error;
  }
  reload();
}

async function loadCurrentBrowserTab() {
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (tab?.url && isHttpUrl(tab.url)) openTab(tab.url);
  else showToast('That page cannot be shown in the panel.');
}

async function addShortcut(url, title) {
  if (settings.shortcuts.some((item) => item.url === url)) {
    showToast('Already in speed dial.');
    return;
  }
  if (settings.shortcuts.length >= MAX_SHORTCUTS) {
    showToast(`Speed dial holds at most ${MAX_SHORTCUTS} shortcuts.`);
    return;
  }
  settings = await updateSettings({ shortcuts: [...settings.shortcuts, { title, url }] });
  showToast('Added to speed dial.');
  render();
}

// Pins the active page to the rail, or unpins the app it belongs to. A newly
// pinned page's tab becomes that app's tab.
async function togglePin() {
  const active = activeWebTab();
  if (!active?.url) return;
  const pinnedUrl = active.app || active.url;
  if (isPinned(pinnedUrl)) {
    settings = await updateSettings({ apps: settings.apps.filter((app) => app.url !== pinnedUrl) });
    showToast('Unpinned from the rail.');
  } else if (settings.apps.length >= MAX_APPS) {
    showToast(`The rail holds at most ${MAX_APPS} apps.`);
    return;
  } else {
    settings = await updateSettings({ apps: [...settings.apps, { title: tabLabel(active), url: active.url }] });
    session = { ...session, tabs: session.tabs.map((tab) => (tab.id === active.id ? { ...tab, app: active.url } : tab)) };
    showToast('Pinned to the rail.');
  }
  setSession(session);
}

function setZoom(direction) {
  const active = activeWebTab();
  if (!active?.url) return;
  setSession(model.updateTab(session, active.id, { zoom: model.nextZoom(active.zoom, direction) }));
  renderMenu();
}

const COMMANDS = {
  'new-tab': newTab,
  'close-tab': () => { if (session.activeId) closeTab(session.activeId); },
  'open-in-browser': () => {
    const active = activeWebTab();
    if (active?.url) chrome.tabs.create({ url: active.url, windowId });
  },
  'load-current-tab': loadCurrentBrowserTab,
  'add-shortcut': () => {
    const active = activeWebTab();
    if (active?.url) addShortcut(active.url, tabLabel(active));
  },
  'toggle-pin': togglePin,
  'zoom-in': () => setZoom(1),
  'zoom-out': () => setZoom(-1),
  settings: () => chrome.runtime.openOptionsPage(),
};

function runShortcut(code) {
  if (code === 'KeyL') focusAddress();
  else if (code === 'KeyT') newTab();
  else if (code === 'KeyW') COMMANDS['close-tab']();
  else if (code === 'KeyR') reload();
  else if (code === 'ArrowLeft') goHistory(-1);
  else if (code === 'ArrowRight') goHistory(1);
  else if (/^Digit[1-9]$/.test(code)) {
    const n = Number(code.slice(5));
    const tab = n === 9 ? session.tabs.at(-1) : session.tabs[n - 1];
    if (tab) {
      setSession(model.activateTab(session, tab.id));
      setView('web');
    }
  }
}

// ---------- events ----------

function submitQuery(text) {
  const url = resolveInput(text, searchTemplate(settings));
  if (!url) return;
  const active = model.activeTab(session);
  // A rail app keeps its own tab on the app; anything typed there opens a new tab.
  if (active && !active.app) navigate(active.id, url);
  else openUrlFromOutside(url);
  setView('web');
}

function bindEvents() {
  ui.addressForm.addEventListener('submit', (event) => {
    event.preventDefault();
    ui.address.blur();
    submitQuery(ui.address.value);
  });
  ui.address.addEventListener('focus', () => ui.address.select());
  ui.address.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      ui.address.blur();
      render();
    }
  });
  ui.dashboardSearch.addEventListener('submit', (event) => {
    event.preventDefault();
    submitQuery(ui.dashboardQuery.value);
    ui.dashboardQuery.value = '';
  });
  ui.back.addEventListener('click', () => goHistory(-1));
  ui.forward.addEventListener('click', () => goHistory(1));
  ui.reload.addEventListener('click', reload);
  ui.newTab.addEventListener('click', newTab);

  ui.rail.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.app) {
      const app = settings.apps.find((item) => item.url === button.dataset.app);
      if (app) openApp(app);
    } else if (button.dataset.view) {
      setView(view === button.dataset.view ? 'web' : button.dataset.view);
    } else if (button.id === 'rail-pin') {
      togglePin();
    } else if (button.id === 'rail-settings') {
      chrome.runtime.openOptionsPage();
    }
  });

  ui.tabs.addEventListener('click', (event) => {
    const tabEl = event.target.closest('.tab');
    if (!tabEl) return;
    if (event.target.closest('.close')) {
      closeTab(tabEl.dataset.id);
    } else {
      setSession(model.activateTab(session, tabEl.dataset.id));
      setView('web');
    }
  });
  ui.tabs.addEventListener('auxclick', (event) => {
    const tabEl = event.target.closest('.tab');
    if (tabEl && event.button === 1) closeTab(tabEl.dataset.id);
  });
  ui.tabs.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      setSession(model.cycleTab(session, event.key === 'ArrowRight' ? 1 : -1));
      ui.tabs.querySelector('[aria-selected="true"]')?.focus();
    }
  });
  ui.tabstrip.addEventListener('dblclick', (event) => {
    if (!event.target.closest('.tab, button')) newTab();
  });

  let draggedId = null;
  ui.tabs.addEventListener('dragstart', (event) => {
    const tabEl = event.target.closest('.tab');
    if (!tabEl) return;
    draggedId = tabEl.dataset.id;
    tabEl.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
  });
  ui.tabs.addEventListener('dragover', (event) => {
    if (draggedId) event.preventDefault();
  });
  ui.tabs.addEventListener('drop', (event) => {
    event.preventDefault();
    const tabEl = event.target.closest('.tab');
    if (!draggedId || !tabEl) return;
    const toIndex = session.tabs.findIndex((tab) => tab.id === tabEl.dataset.id);
    setSession(model.moveTab(session, draggedId, toIndex));
  });
  ui.tabs.addEventListener('dragend', () => {
    draggedId = null;
    render();
  });

  ui.tiles.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove-index]');
    if (remove) {
      const index = Number(remove.dataset.removeIndex);
      updateSettings({ shortcuts: settings.shortcuts.filter((_, i) => i !== index) });
      return;
    }
    const link = event.target.closest('a[data-url]');
    if (!link) return;
    event.preventDefault();
    const active = model.activeTab(session);
    if (active) navigate(active.id, link.dataset.url);
  });
  ui.addShortcut.addEventListener('submit', async (event) => {
    event.preventDefault();
    const url = resolveInput(ui.shortcutUrl.value, searchTemplate(settings));
    if (!url || !isHttpUrl(url)) {
      showToast('Enter a web address, like example.com');
      return;
    }
    await addShortcut(url, displayHost(url));
    ui.shortcutUrl.value = '';
  });

  ui.menu.addEventListener('beforetoggle', (event) => {
    if (event.newState === 'open') renderMenu();
  });
  ui.menu.addEventListener('click', (event) => {
    const button = event.target.closest('[data-command]');
    if (!button || button.disabled) return;
    if (!button.dataset.command.startsWith('zoom-')) ui.menu.hidePopover();
    COMMANDS[button.dataset.command]();
  });
  ui.mobileToggle.addEventListener('change', toggleMobileForActiveSite);

  $('hint-open-browser').addEventListener('click', () => COMMANDS['open-in-browser']());
  $('hint-dismiss').addEventListener('click', () => {
    hintTabs.delete(session.activeId);
    renderHint();
  });

  document.addEventListener('keydown', (event) => {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    const before = session;
    runShortcut(event.code);
    if (before !== session || /^Key[LTWR]$|^Arrow/.test(event.code)) event.preventDefault();
  });

  // The panel can close at any moment; write pending changes first.
  const flush = () => {
    if (saveTimer) saveNow();
    notes.flush();
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  setInterval(() => {
    if (!ui.speedDial.hidden && settings.showClock) renderClock();
  }, 10_000);
}

// ---------- startup ----------

let inboxWork = Promise.resolve();
function drainInbox() {
  inboxWork = inboxWork.then(async () => {
    for (const url of await takeForWindow(windowId)) openUrlFromOutside(url);
  });
  return inboxWork;
}

async function init() {
  windowId = (await chrome.windows.getCurrent()).id;
  settings = await loadSettings();
  applyAppearance(settings);
  bookmarks = initBookmarks({
    view: ui.bookmarksView,
    search: $('bookmark-search'),
    crumbs: $('bookmark-crumbs'),
    list: $('bookmark-list'),
    permissionBox: $('bookmark-permission'),
    grantButton: $('bookmark-grant'),
    addButton: $('bookmark-add'),
    openUrl: openUrlFromOutside,
    currentPage: () => {
      const active = model.activeTab(session);
      return active?.url ? { url: active.url, title: tabLabel(active) } : null;
    },
    showToast,
  });
  notes = initNotes({ textarea: $('notes'), status: $('notes-status'), copyButton: $('notes-copy'), showToast });
  const key = sessionKey();
  let stored = (await chrome.storage.session.get(key))[key];
  if (!stored && settings.restoreSession) stored = (await chrome.storage.local.get('lastSession')).lastSession;
  session = model.restoreSession(stored);
  if (session.tabs.length === 0) session = model.addTab(session, { url: homeUrl() }).session;
  view = VIEWS.includes(stored?.view) ? stored.view : 'web';
  bindEvents();
  // After a browser restart the network rules may not exist yet, so pages
  // load only once they do. If that fails the user is told, and pages that
  // forbid framing will show the "Page not showing?" hint.
  try {
    await syncRules();
  } catch (error) {
    showToast(error.message);
  }
  render();
  if (view === 'bookmarks') bookmarks.show();
  onSettingsChanged((next) => {
    settings = next;
    applyAppearance(next);
    for (const tabId of frames.keys()) postToFrame(tabId, frameConfig());
    render();
  });
  onInboxChanged(drainInbox);
  await drainInbox();
  if (view === 'web' && !model.activeTab(session)?.url) focusAddress();
}

init();
