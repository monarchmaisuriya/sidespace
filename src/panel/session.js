// Panel tab model. Pure functions: each takes a session and returns a new one.
// A tab with url '' is the speed dial (new tab page).
//
// Each tab owns its history (a list of URLs and a position). The panel moves
// through it by loading the URL itself, instead of calling history.back() in
// the frame, which would walk the history shared by every frame in the panel.

import { isHttpUrl } from '../shared/settings.js';

export const MAX_TABS = 50;
export const MAX_HISTORY = 50;
export const ZOOM_LEVELS = Object.freeze([0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5]);

export function createSession() {
  return { tabs: [], activeId: null, nextId: 1 };
}

function cleanUrl(url) {
  return isHttpUrl(url) ? url : '';
}

// A tab's tie to a rail app: the app's id. Sessions saved before app ids
// stored the app's URL; those are kept for the panel to map on load.
const APP_ID = /^app-[a-z0-9]+$/;
function cleanAppRef(value) {
  return typeof value === 'string' && (APP_ID.test(value) || isHttpUrl(value)) ? value : '';
}

function cleanZoom(zoom) {
  return ZOOM_LEVELS.includes(zoom) ? zoom : 1;
}

export function activeTab(session) {
  return session.tabs.find((tab) => tab.id === session.activeId) ?? null;
}

export function findAppTab(session, appId) {
  return session.tabs.find((tab) => tab.app === appId) ?? null;
}

// Sets which app a tab belongs to ('' for none).
export function tieTab(session, id, appId) {
  return { ...session, tabs: session.tabs.map((tab) => (tab.id === id ? { ...tab, app: cleanAppRef(appId) } : tab)) };
}

// Turns every tab of the app back into an ordinary tab (the app was removed).
export function untieApp(session, appId) {
  return { ...session, tabs: session.tabs.map((tab) => (tab.app === appId ? { ...tab, app: '' } : tab)) };
}

// Inserts after the active tab. Throws when the tab limit is reached so the
// caller can tell the user instead of silently dropping the tab.
// `app` ties the tab to a rail app (its id) so the rail can find it again.
export function addTab(session, { url = '', activate = true, app = '' } = {}) {
  if (session.tabs.length >= MAX_TABS) {
    throw new Error(`Sidespace keeps at most ${MAX_TABS} panel tabs; close one first.`);
  }
  const clean = cleanUrl(url);
  const tab = {
    id: `t${session.nextId}`,
    url: clean,
    title: '',
    icon: '',
    zoom: 1,
    app: cleanAppRef(app),
    history: clean ? [clean] : [],
    historyIndex: clean ? 0 : -1,
  };
  const activeIndex = session.tabs.findIndex((t) => t.id === session.activeId);
  const tabs = [...session.tabs];
  tabs.splice(activeIndex + 1, 0, tab);
  return {
    session: {
      tabs,
      activeId: activate || !session.activeId ? tab.id : session.activeId,
      nextId: session.nextId + 1,
    },
    tab,
  };
}

export function closeTab(session, id) {
  const index = session.tabs.findIndex((tab) => tab.id === id);
  if (index === -1) return session;
  const tabs = session.tabs.filter((tab) => tab.id !== id);
  let { activeId } = session;
  if (activeId === id) {
    const neighbour = tabs[index] ?? tabs[index - 1] ?? null;
    activeId = neighbour ? neighbour.id : null;
  }
  return { ...session, tabs, activeId };
}

export function activateTab(session, id) {
  return session.tabs.some((tab) => tab.id === id) ? { ...session, activeId: id } : session;
}

// Activates the tab `step` places away from the active one, wrapping around.
export function cycleTab(session, step) {
  const count = session.tabs.length;
  if (count === 0) return session;
  const index = session.tabs.findIndex((tab) => tab.id === session.activeId);
  const next = session.tabs[(((index + step) % count) + count) % count];
  return { ...session, activeId: next.id };
}

function mapTab(session, id, change) {
  return { ...session, tabs: session.tabs.map((tab) => (tab.id === id ? change(tab) : tab)) };
}

// Title, icon and zoom. URLs change only through the history functions below.
export function updateTab(session, id, patch) {
  const allowed = {};
  if ('title' in patch) allowed.title = String(patch.title ?? '').slice(0, 300);
  if ('icon' in patch) allowed.icon = isHttpUrl(patch.icon) ? patch.icon : '';
  if ('zoom' in patch) allowed.zoom = cleanZoom(patch.zoom);
  return mapTab(session, id, (tab) => ({ ...tab, ...allowed }));
}

// A new page: drops the forward entries and appends the URL.
export function pushUrl(session, id, url) {
  const clean = cleanUrl(url);
  if (!clean) return session;
  return mapTab(session, id, (tab) => {
    if (tab.history[tab.historyIndex] === clean) return { ...tab, url: clean };
    const history = [...tab.history.slice(0, tab.historyIndex + 1), clean].slice(-MAX_HISTORY);
    return { ...tab, url: clean, history, historyIndex: history.length - 1 };
  });
}

// The current page ended up somewhere else (a redirect): rewrite this entry.
export function replaceUrl(session, id, url) {
  const clean = cleanUrl(url);
  if (!clean) return session;
  return mapTab(session, id, (tab) => {
    if (tab.historyIndex < 0) return { ...tab, url: clean, history: [clean], historyIndex: 0 };
    const history = [...tab.history];
    history[tab.historyIndex] = clean;
    return { ...tab, url: clean, history };
  });
}

export function canGo(tab, step) {
  const index = (tab?.historyIndex ?? -1) + step;
  return Boolean(tab) && index >= 0 && index < tab.history.length;
}

// Moves back (-1) or forward (+1). Returns the session unchanged at either end.
export function goHistory(session, id, step) {
  const tab = session.tabs.find((t) => t.id === id);
  if (!canGo(tab, step)) return session;
  return mapTab(session, id, (t) => ({ ...t, historyIndex: t.historyIndex + step, url: t.history[t.historyIndex + step], title: '', icon: '' }));
}

export function moveTab(session, id, toIndex) {
  const from = session.tabs.findIndex((tab) => tab.id === id);
  if (from === -1) return session;
  const tabs = [...session.tabs];
  const [tab] = tabs.splice(from, 1);
  tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, tab);
  return { ...session, tabs };
}

// direction: +1 zoom in, -1 zoom out, 0 reset.
export function nextZoom(current, direction) {
  if (direction === 0) return 1;
  const index = ZOOM_LEVELS.indexOf(cleanZoom(current));
  const next = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, index + direction));
  return ZOOM_LEVELS[next];
}

// Rebuilds a session from storage, dropping anything malformed.
export function restoreSession(raw) {
  if (!raw || !Array.isArray(raw.tabs)) return createSession();
  const seen = new Set();
  const tabs = [];
  let maxId = 0;
  for (const item of raw.tabs.slice(0, MAX_TABS)) {
    if (!item || typeof item.id !== 'string' || !/^t\d+$/.test(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    maxId = Math.max(maxId, Number(item.id.slice(1)));
    const url = cleanUrl(item.url);
    let history = Array.isArray(item.history) ? item.history.map(cleanUrl).filter(Boolean).slice(-MAX_HISTORY) : [];
    let historyIndex = Number.isInteger(item.historyIndex) ? item.historyIndex : history.length - 1;
    if (history[historyIndex] !== url) {
      history = url ? [url] : [];
      historyIndex = history.length - 1;
    }
    tabs.push({
      id: item.id,
      url,
      title: typeof item.title === 'string' ? item.title.slice(0, 300) : '',
      icon: isHttpUrl(item.icon) ? item.icon : '',
      zoom: cleanZoom(item.zoom),
      app: cleanAppRef(item.app),
      history,
      historyIndex,
    });
  }
  const activeId = seen.has(raw.activeId) ? raw.activeId : (tabs[0]?.id ?? null);
  return { tabs, activeId, nextId: maxId + 1 };
}
