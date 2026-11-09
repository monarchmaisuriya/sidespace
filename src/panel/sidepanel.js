import {
  isHttpUrl, loadHomeImage, loadSettings, normalizeHostname, onHomeImageChanged, onSettingsChanged, searchTemplate,
  updateSettings,
} from '../shared/settings.js';
import {
  displayHost, isBrowserOnlyUrl, resolveInput, sameOriginUrl, shortUrl, trustedFrameUrl,
} from '../shared/url.js';
import {
  addLink, moveLink, RAIL, removeLink, SPEED_DIAL, updateLink,
} from '../shared/links.js';
import { onInboxChanged, takeForWindow } from '../shared/inbox.js';
import { applyAppearance, textColourOn } from '../shared/theme.js';
import * as model from './session.js';
import { faviconFor } from '../shared/favicon.js';
import { reconcile, setIcon } from '../shared/reconcile.js';
import { initAppDialog } from './app-dialog.js';
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
const CLOSE_ICON = '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg>';

const $ = (id) => document.getElementById(id);
const ui = {
  shell: $('shell'),
  rail: $('rail'),
  railApps: $('rail-apps'),
  railTabs: $('rail-tabs'),
  railMenu: $('rail-menu'),
  address: $('address'),
  addressForm: $('address-form'),
  back: $('back'),
  forward: $('forward'),
  reload: $('reload'),
  tabCount: $('tab-count'),
  drawer: $('tab-drawer'),
  tabs: $('tabs'),
  viewport: $('viewport'),
  speedDial: $('speed-dial'),
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
// The home page picture (a data: URL), or '' when there is none.
let homeImage = '';
let session = model.createSession();
let view = 'web';
let windowId;
let bookmarks;
let notes;
let appDialog;

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
const linkedSinceCheck = new Set(); // panel tab ids where a new page linked since the last load check
const answeredTabs = new Set(); // panel tab ids whose page answered the last ping
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
  const next = model.closeTab(session, id);
  if (next === session) return;
  dropFrame(id);
  setSession(next);
}

function activate(tabId) {
  setSession(model.activateTab(session, tabId));
  setView('web');
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
  const existing = model.findAppTab(session, app.id);
  if (existing) activate(existing.id);
  else openTab(app.url, { app: app.id });
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
  linkedSinceCheck.delete(tabId);
  answeredTabs.delete(tabId);
  hintTabs.delete(tabId);
}

// After every frame load: if a new page linked since the last check, the
// load was that page. Otherwise ask the frame whether a page with our content
// script is still there. No answer usually means an error page (blocked
// framing, network error) or a page Chrome keeps scripts out of. Asking,
// instead of counting load events, keeps the answer right when a frame fires
// extra load events.
function checkLoaded(tabId) {
  if (linkedSinceCheck.delete(tabId)) {
    hintTabs.delete(tabId);
    renderHint();
    return;
  }
  answeredTabs.delete(tabId);
  postToFrame(tabId, { type: 'sidespace:ping' });
  setTimeout(() => {
    if (answeredTabs.has(tabId)) hintTabs.delete(tabId);
    else hintTabs.add(tabId);
    // A hello that arrived after its own load event was settled by this ping.
    linkedSinceCheck.delete(tabId);
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
  const isFrameMessage = data?.type === 'sidespace:frame-hello' || data?.type === 'sidespace:frame-alive';
  if (!isFrameMessage || typeof data.token !== 'string' || data.token.length > 64) return;
  const entry = [...frames].find(([, frame]) => frame.contentWindow === event.source);
  if (!entry) return;
  const [tabId] = entry;
  if (data.type === 'sidespace:frame-alive') {
    // Counts only for the page now linked to this tab, never links one.
    if (linkedToken.get(tabId) === data.token) {
      answeredTabs.add(tabId);
      hintTabs.delete(tabId);
      renderHint();
    }
    return;
  }
  linkedSinceCheck.add(tabId);
  hintTabs.delete(tabId);
  unlinkTab(tabId);
  tokenToTab.set(data.token, tabId);
  linkedToken.set(tabId, data.token);
  tokenMode.set(data.token, pendingLoads.has(tabId) ? 'replace' : 'push');
  pendingLoads.delete(tabId);
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

function appForTab(tab) {
  return tab.app ? settings.apps.find((app) => app.id === tab.app) ?? null : null;
}

function appById(id) {
  return settings.apps.find((app) => app.id === id) ?? null;
}

function closeButton(className, tab) {
  const close = document.createElement('button');
  close.className = className;
  close.dataset.closeId = tab.id;
  close.innerHTML = CLOSE_ICON;
  return close;
}

function renderRail() {
  ui.shell.classList.remove('rail-left', 'rail-right', 'rail-hidden');
  ui.shell.classList.add(`rail-${settings.railPosition}`);
  ui.shell.classList.toggle('tabs-in-rail', settings.tabLayout === 'rail');
  const active = model.activeTab(session);

  reconcile(ui.railApps, settings.apps, (app) => app.id, () => {
    const item = document.createElement('div');
    item.className = 'rail-item';
    item.role = 'listitem';
    const button = document.createElement('button');
    button.className = 'rail-button rail-app';
    button.draggable = true;
    item.append(button);
    return item;
  }, (item, app) => {
    const button = item.firstElementChild;
    const appTab = model.findAppTab(session, app.id);
    button.dataset.app = app.url;
    button.dataset.appId = app.id;
    button.title = app.title;
    button.setAttribute('aria-label', app.title);
    button.setAttribute('aria-pressed', String(view === 'web' && active?.app === app.id));
    button.classList.toggle('is-open', Boolean(appTab));
    setIcon(button, app.url, appTab ? sameOriginUrl(appTab.icon, app.url) : '', faviconFor);
  });

  const railTabs = session.tabs.filter((tab) => !appForTab(tab));
  reconcile(ui.railTabs, railTabs, (tab) => tab.id, (tab) => {
    const item = document.createElement('div');
    item.className = 'rail-item';
    item.role = 'listitem';
    const button = document.createElement('button');
    button.className = 'rail-button rail-tab';
    button.draggable = true;
    button.dataset.id = tab.id;
    const close = closeButton('rail-close', tab);
    close.tabIndex = -1;
    item.append(button, close);
    return item;
  }, (item, tab) => {
    const [button, close] = item.children;
    button.title = tab.url ? `${tabLabel(tab)}\n${shortUrl(tab.url)}` : 'New tab';
    button.setAttribute('aria-label', tabLabel(tab));
    button.setAttribute('aria-pressed', String(view === 'web' && tab.id === session.activeId));
    close.setAttribute('aria-label', `Close ${tabLabel(tab)}`);
    close.hidden = !model.canCloseTab(session);
    setIcon(button, tab.url, tab.icon, faviconFor);
  });
  for (const button of ui.rail.querySelectorAll('[data-view]')) {
    button.setAttribute('aria-pressed', String(view === button.dataset.view));
  }
}

function renderDrawer() {
  reconcile(ui.tabs, session.tabs, (tab) => tab.id, (tab) => {
    const li = document.createElement('li');
    li.className = 'tab';
    li.role = 'tab';
    li.draggable = true;
    li.tabIndex = 0;
    li.dataset.id = tab.id;
    const title = document.createElement('span');
    title.className = 'title';
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = 'App';
    li.append(title, tag, closeButton('icon-button small close', tab));
    return li;
  }, (li, tab) => {
    li.title = tab.url || 'New tab';
    li.setAttribute('aria-selected', String(tab.id === session.activeId && view === 'web'));
    li.querySelector('.title').textContent = tabLabel(tab);
    li.querySelector('.tag').hidden = !appForTab(tab);
    li.querySelector('.close').setAttribute('aria-label', `Close ${tabLabel(tab)}`);
    li.querySelector('.close').hidden = !model.canCloseTab(session);
    setIcon(li, tab.url, tab.icon, faviconFor);
  });
  ui.tabCount.textContent = String(session.tabs.length);
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

// 'auto' leaves the 12 or 24-hour choice to Chrome's language.
const CLOCK_FORMATS = {
  auto: { hour: '2-digit' },
  12: { hour: 'numeric', hourCycle: 'h12' },
  24: { hour: '2-digit', hourCycle: 'h23' },
};

function renderClock() {
  const now = new Date();
  ui.clockTime.textContent = now.toLocaleTimeString([], { ...CLOCK_FORMATS[settings.clockFormat], minute: '2-digit' });
  ui.clockDate.textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

// Order, visibility, background and shortcut grid of the home page.
function renderHomeLayout() {
  const parts = new Map([...ui.speedDial.querySelectorAll(':scope > [data-section]')].map((part) => [part.dataset.section, part]));
  const order = settings.homeSections.map((section) => section.id);
  // Moving a node drops its focus, so the parts move only when the order changed.
  if (order.join() !== [...parts.keys()].join()) for (const id of order) ui.speedDial.append(parts.get(id));
  for (const { id, show } of settings.homeSections) parts.get(id).hidden = !show;
  ui.speedDial.dataset.columns = settings.shortcutColumns;
  ui.speedDial.dataset.size = settings.shortcutSize;
  ui.speedDial.classList.toggle('no-labels', !settings.shortcutLabels);
  const { type, colour } = settings.homeBackground;
  const backdrop = type === 'colour' || (type === 'image' && homeImage) ? type : '';
  if (backdrop) ui.speedDial.dataset.backdrop = backdrop;
  else delete ui.speedDial.dataset.backdrop;
  ui.speedDial.style.backgroundColor = backdrop === 'colour' ? colour : '';
  ui.speedDial.style.backgroundImage = backdrop === 'image' ? `url("${homeImage}")` : '';
  ui.speedDial.style.setProperty('--home-ink', backdrop === 'colour' ? textColourOn(colour) : '#ffffff');
}

function sectionShown(id) {
  return settings.homeSections.some((section) => section.id === id && section.show);
}

function renderSpeedDial(active) {
  ui.speedDial.hidden = view !== 'web' || Boolean(active?.url);
  if (ui.speedDial.hidden) return;
  renderHomeLayout();
  if (sectionShown('clock') || sectionShown('date')) renderClock();
  reconcile(ui.tiles, settings.shortcuts, (shortcut) => shortcut.url, () => {
    const li = document.createElement('li');
    li.className = 'tile';
    const link = document.createElement('a');
    const label = document.createElement('span');
    label.className = 'label';
    link.append(label);
    const remove = document.createElement('button');
    remove.className = 'icon-button small remove';
    remove.innerHTML = CLOSE_ICON;
    li.append(link, remove);
    return li;
  }, (li, shortcut) => {
    const [link, remove] = li.children;
    link.href = shortcut.url;
    link.dataset.url = shortcut.url;
    link.querySelector('.label').textContent = shortcut.title;
    setIcon(link, shortcut.url, '', faviconFor);
    remove.dataset.removeUrl = shortcut.url;
    remove.setAttribute('aria-label', `Remove ${shortcut.title}`);
  });
  ui.tilesEmpty.hidden = settings.shortcuts.length > 0;
}

function renderHint() {
  ui.hint.hidden = view !== 'web' || !hintTabs.has(session.activeId);
}

function renderAddress(active) {
  if (document.activeElement === ui.address) return;
  ui.address.value = view === 'web' ? shortUrl(active?.url ?? '') : '';
}

function render() {
  const active = model.activeTab(session);
  renderRail();
  renderDrawer();
  renderFrames(active);
  renderSpeedDial(active);
  ui.bookmarksView.hidden = view !== 'bookmarks';
  ui.notesView.hidden = view !== 'notes';
  renderHint();
  renderAddress(active);
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
  const pinned = Boolean(active && appForTab(active)) || Boolean(page && isPinned(page));
  ui.menuPin.textContent = pinned ? 'Unpin from rail' : 'Pin to rail';
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

// ---------- rail apps: add, edit, move, remove ----------

// Applies `change` to the rail apps as stored right now (another panel or
// the settings page may have changed them) and returns the new list.
async function changeApps(change) {
  settings = await updateSettings((current) => ({ apps: change(current.apps) }));
  render();
  return settings.apps;
}

// Runs a rail app action; a refused or failed one is shown, never dropped.
async function appAction(action) {
  try {
    await action();
  } catch (error) {
    showToast(error.message);
  }
}

function openAddAppDialog() {
  const active = model.activeTab(session);
  const page = view === 'web' && active?.url && !appForTab(active) ? active : null;
  appDialog.open({
    title: 'Add an app',
    values: page ? { title: tabLabel(page), url: page.url } : { title: '', url: '' },
    save: async ({ title, url }) => {
      const apps = await changeApps((current) => addLink(current, { title, url }, RAIL));
      const added = apps.at(-1);
      // The current page becomes the new app's tab when it is that page.
      if (page && page.url === added.url) setSession(model.tieTab(session, page.id, added.id));
      showToast(`Added ${added.title} to the rail.`);
    },
  });
}

function openEditAppDialog(app) {
  appDialog.open({
    title: 'Edit app',
    values: app,
    // The app keeps its id, so its open tab stays tied to it.
    save: ({ title, url }) => changeApps((current) => updateLink(current, app.url, { title, url }, RAIL)),
  });
}

function moveApp(app, step) {
  return appAction(() => changeApps((current) => {
    const index = current.findIndex((item) => item.id === app.id);
    return moveLink(current, app.url, index + step, RAIL);
  }));
}

function removeApp(app) {
  return appAction(async () => {
    await changeApps((current) => removeLink(current, app.url, RAIL));
    // Its open tab stays open as an ordinary tab.
    setSession(model.untieApp(session, app.id));
    showToast(`Removed ${app.title} from the rail.`);
  });
}

// Pins the active page to the rail, or unpins the app it belongs to.
function togglePin() {
  const active = activeWebTab();
  if (!active?.url) return Promise.resolve();
  const app = appForTab(active) ?? settings.apps.find((item) => item.url === active.url);
  if (app) return removeApp(app);
  return appAction(async () => {
    const apps = await changeApps((current) => addLink(current, { title: tabLabel(active), url: active.url }, RAIL));
    setSession(model.tieTab(session, active.id, apps.at(-1).id));
    showToast('Pinned to the rail.');
  });
}

// ---------- rail context menu ----------

function menuButton(label, action, { danger = false, disabled = false } = {}) {
  const button = document.createElement('button');
  button.textContent = label;
  button.role = 'menuitem';
  button.disabled = disabled;
  if (danger) button.className = 'danger';
  button.addEventListener('click', () => {
    ui.railMenu.hidePopover();
    action();
  });
  return button;
}

function openRailMenu(target, items) {
  ui.railMenu.replaceChildren(...items);
  const box = target.getBoundingClientRect();
  ui.railMenu.showPopover();
  const menuBox = ui.railMenu.getBoundingClientRect();
  const left = settings.railPosition === 'left' ? box.right + 6 : box.left - menuBox.width - 6;
  ui.railMenu.style.left = `${Math.max(6, left)}px`;
  ui.railMenu.style.top = `${Math.min(box.top, window.innerHeight - menuBox.height - 6)}px`;
  ui.railMenu.querySelector('button:not(:disabled)')?.focus();
}

function appMenu(target, app) {
  const index = settings.apps.findIndex((item) => item.id === app.id);
  openRailMenu(target, [
    menuButton('Open', () => openApp(app)),
    menuButton('Edit…', () => openEditAppDialog(app)),
    menuButton('Move up', () => moveApp(app, -1), { disabled: index === 0 }),
    menuButton('Move down', () => moveApp(app, 1), { disabled: index === settings.apps.length - 1 }),
    menuButton('Remove from rail', () => removeApp(app), { danger: true }),
  ]);
}

function tabMenu(target, tab) {
  openRailMenu(target, [
    menuButton('Pin to rail', () => {
      activate(tab.id);
      togglePin();
    }, { disabled: !tab.url }),
    menuButton('Open in browser tab', () => chrome.tabs.create({ url: tab.url, windowId }), { disabled: !tab.url }),
    menuButton('Close tab', () => closeTab(tab.id), { danger: true, disabled: !model.canCloseTab(session) }),
  ]);
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
  if (ui.drawer.matches(':popover-open')) ui.drawer.hidePopover();
  openTab(homeUrl());
  if (!homeUrl()) focusAddress();
}

function focusAddress() {
  if (view !== 'web') setView('web');
  ui.address.focus();
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
  try {
    settings = await updateSettings((current) => ({ shortcuts: addLink(current.shortcuts, { title, url }, SPEED_DIAL) }));
    showToast('Added to speed dial.');
    render();
  } catch (error) {
    showToast(error.message);
  }
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
    if (tab) activate(tab.id);
  }
}

// ---------- events ----------

function submitQuery(text) {
  const url = resolveInput(text, searchTemplate(settings));
  if (!url) return;
  const active = model.activeTab(session);
  // A rail app keeps its own tab on the app; anything typed there opens a new tab.
  if (active && !appForTab(active)) navigate(active.id, url);
  else openUrlFromOutside(url);
  setView('web');
}

// Drag to reorder: rail apps (settings order) and tabs (session order).
function bindReorder(container, itemSelector, keyOf, onDrop) {
  let dragged = null;
  container.addEventListener('dragstart', (event) => {
    const item = event.target.closest(itemSelector);
    if (!item) return;
    dragged = keyOf(item);
    item.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
  });
  container.addEventListener('dragover', (event) => {
    if (dragged !== null && event.target.closest(itemSelector)) event.preventDefault();
  });
  container.addEventListener('drop', (event) => {
    const target = event.target.closest(itemSelector);
    if (dragged === null || !target) return;
    event.preventDefault();
    onDrop(dragged, keyOf(target));
  });
  container.addEventListener('dragend', () => {
    dragged = null;
    render();
  });
}

function bindEvents() {
  ui.addressForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = ui.address.value;
    ui.address.blur();
    submitQuery(text);
  });
  // The full URL while editing; the short form at rest.
  ui.address.addEventListener('focus', () => {
    if (view === 'web') ui.address.value = model.activeTab(session)?.url ?? '';
    ui.address.select();
  });
  ui.address.addEventListener('blur', () => renderAddress(model.activeTab(session)));
  ui.address.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') ui.address.blur();
  });
  ui.dashboardSearch.addEventListener('submit', (event) => {
    event.preventDefault();
    submitQuery(ui.dashboardQuery.value);
    ui.dashboardQuery.value = '';
  });
  ui.back.addEventListener('click', () => goHistory(-1));
  ui.forward.addEventListener('click', () => goHistory(1));
  ui.reload.addEventListener('click', reload);
  $('new-tab').addEventListener('click', newTab);
  $('drawer-new-tab').addEventListener('click', newTab);
  $('add-app').addEventListener('click', openAddAppDialog);

  ui.rail.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.closeId) {
      closeTab(button.dataset.closeId);
    } else if (button.dataset.appId) {
      const app = appById(button.dataset.appId);
      if (app) openApp(app);
    } else if (button.dataset.id) {
      activate(button.dataset.id);
    } else if (button.dataset.view) {
      setView(view === button.dataset.view ? 'web' : button.dataset.view);
    } else if (button.id === 'rail-settings') {
      chrome.runtime.openOptionsPage();
    }
  });
  ui.rail.addEventListener('auxclick', (event) => {
    const button = event.target.closest('.rail-tab');
    if (button && event.button === 1) closeTab(button.dataset.id);
  });
  // Right-click, or the keyboard context-menu key, on an app or a tab.
  ui.rail.addEventListener('contextmenu', (event) => {
    const appButton = event.target.closest('.rail-app');
    const tabButton = event.target.closest('.rail-tab');
    if (appButton) {
      const app = appById(appButton.dataset.appId);
      if (!app) return;
      event.preventDefault();
      appMenu(appButton, app);
    } else if (tabButton) {
      const tab = session.tabs.find((item) => item.id === tabButton.dataset.id);
      if (!tab) return;
      event.preventDefault();
      tabMenu(tabButton, tab);
    }
  });
  bindReorder(ui.railApps, '.rail-app', (el) => el.dataset.app, (from, to) => {
    appAction(() => changeApps((current) => moveLink(current, from, current.findIndex((app) => app.url === to), RAIL)));
  });
  bindReorder(ui.railTabs, '.rail-tab', (el) => el.dataset.id, (from, to) => {
    setSession(model.moveTab(session, from, session.tabs.findIndex((tab) => tab.id === to)));
  });
  bindReorder(ui.tabs, '.tab', (el) => el.dataset.id, (from, to) => {
    setSession(model.moveTab(session, from, session.tabs.findIndex((tab) => tab.id === to)));
  });

  ui.tabs.addEventListener('click', (event) => {
    const tabEl = event.target.closest('.tab');
    if (!tabEl) return;
    if (event.target.closest('[data-close-id]')) {
      closeTab(tabEl.dataset.id);
      return;
    }
    ui.drawer.hidePopover();
    activate(tabEl.dataset.id);
  });
  ui.tabs.addEventListener('keydown', (event) => {
    const tabEl = event.target.closest('.tab');
    // Keys on the close button are that button's (Enter clicks it).
    if (!tabEl || event.target !== tabEl) return;
    if (event.key === 'Enter') {
      ui.drawer.hidePopover();
      activate(tabEl.dataset.id);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      closeTab(tabEl.dataset.id);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      (event.key === 'ArrowDown' ? tabEl.nextElementSibling : tabEl.previousElementSibling)?.focus();
    }
  });
  ui.tabs.addEventListener('auxclick', (event) => {
    const tabEl = event.target.closest('.tab');
    if (tabEl && event.button === 1) closeTab(tabEl.dataset.id);
  });
  ui.drawer.addEventListener('toggle', (event) => {
    if (event.newState === 'open') ui.tabs.querySelector('[aria-selected="true"]')?.focus();
  });

  ui.tiles.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove-url]');
    if (remove) {
      updateSettings((current) => ({ shortcuts: removeLink(current.shortcuts, remove.dataset.removeUrl, SPEED_DIAL) }))
        .catch((error) => showToast(error.message));
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
    if (!ui.speedDial.hidden && (sectionShown('clock') || sectionShown('date'))) renderClock();
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
  homeImage = await loadHomeImage();
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
  appDialog = initAppDialog({
    dialog: $('app-dialog'),
    form: $('app-form'),
    heading: $('app-dialog-title'),
    nameInput: $('app-name'),
    urlInput: $('app-url'),
    error: $('app-error'),
    cancelButton: $('app-cancel'),
  });
  const key = sessionKey();
  let stored = (await chrome.storage.session.get(key))[key];
  if (!stored && settings.restoreSession) stored = (await chrome.storage.local.get('lastSession')).lastSession;
  session = model.restoreSession(stored);
  // Sessions saved before app ids tied tabs to an app's URL.
  for (const tab of session.tabs) {
    if (isHttpUrl(tab.app)) session = model.tieTab(session, tab.id, settings.apps.find((app) => app.url === tab.app)?.id ?? '');
  }
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
  onHomeImageChanged((next) => {
    homeImage = next;
    render();
  });
  onInboxChanged(drainInbox);
  await drainInbox();
  if (view === 'web' && !model.activeTab(session)?.url) focusAddress();
}

init();
