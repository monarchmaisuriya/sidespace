// User settings: the single definition of every setting, its default, and how
// stored values are validated. Anything invalid falls back to its default.
// Stored in storage.local: storage.sync caps one item at 8 KB, which a long
// shortcut list would exceed.

export const SETTINGS_KEY = 'settings';
// Stored with the settings; bumped when stored values need a one-time
// migration. 2: the old fixed accent default (#6d5dfc) became "theme accent".
// 3: showClock became the clock and date entries of homeSections.
export const SETTINGS_VERSION = 3;
export const MAX_LINK_LENGTH = 2048;
export const MAX_SHORTCUTS = 24;
export const MAX_APPS = 12;
export const MAX_MOBILE_SITES = 200;

export const SEARCH_ENGINES = {
  google: 'https://www.google.com/search?q=%s',
  duckduckgo: 'https://duckduckgo.com/?q=%s',
  bing: 'https://www.bing.com/search?q=%s',
  brave: 'https://search.brave.com/search?q=%s',
};

export const DEFAULT_SETTINGS = Object.freeze({
  theme: 'system',
  accent: '',
  density: 'comfortable',
  searchEngine: 'google',
  customSearchUrl: '',
  homePage: '',
  tabLayout: 'rail',
  restoreSession: true,
  unlockFraming: true,
  mobileMode: 'off',
  mobileSites: [],
  newWindowLinks: 'panel',
  shortcuts: [],
  railPosition: 'right',
  apps: [
    { title: 'ChatGPT', url: 'https://chatgpt.com/' },
    { title: 'Gemini', url: 'https://gemini.google.com/' },
    { title: 'Claude', url: 'https://claude.ai/' },
    { title: 'Perplexity', url: 'https://www.perplexity.ai/' },
  ],
  clockFormat: 'auto',
  // The home page's parts, in display order.
  homeSections: [
    { id: 'clock', show: true },
    { id: 'date', show: true },
    { id: 'search', show: true },
    { id: 'shortcuts', show: true },
  ],
  // 'image' shows the picture stored under HOME_IMAGE_KEY, when there is one.
  homeBackground: { type: 'theme', colour: '#1c1c1c' },
  shortcutColumns: 'auto',
  shortcutSize: 'small',
  shortcutLabels: true,
});

// The home page background picture, stored apart from settings so they stay
// small and the settings export does not carry it.
export const HOME_IMAGE_KEY = 'homeImage';

const CHOICES = {
  theme: ['system', 'light', 'dark'],
  density: ['comfortable', 'compact'],
  searchEngine: [...Object.keys(SEARCH_ENGINES), 'custom'],
  tabLayout: ['rail', 'drawer'],
  mobileMode: ['off', 'sites', 'all'],
  newWindowLinks: ['panel', 'browser'],
  railPosition: ['left', 'right', 'hidden'],
  clockFormat: ['auto', '12', '24'],
  shortcutColumns: ['auto', '4', '5', '6'],
  shortcutSize: ['small', 'large'],
};

export function isHttpUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

// "https://www.Example.com/x" or "www.example.com" -> "example.com".
// Returns '' when the input is not a usable hostname.
export function normalizeHostname(value) {
  if (typeof value !== 'string') return '';
  let text = value.trim().toLowerCase();
  if (!text) return '';
  if (!text.includes('://')) text = `https://${text}`;
  let host;
  try {
    host = new URL(text).hostname;
  } catch {
    return '';
  }
  host = host.replace(/^www\./, '');
  const label = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
  const valid = host === 'localhost' || new RegExp(`^(?=.{1,253}$)${label}(?:\\.${label})+$`).test(host);
  return valid ? host : '';
}

// Before settings version 2 the accent had a fixed default, stored for
// everyone who never changed it; in older settings it means "theme accent".
const FORMER_DEFAULT_ACCENT = '#6d5dfc';

// '' = the theme's accent; otherwise a #rrggbb colour.
function normalizeAccent(value, version) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) return '';
  const accent = value.toLowerCase();
  return accent === FORMER_DEFAULT_ACCENT && version < 2 ? '' : accent;
}

// Known parts once each in the stored order, then any missing ones, shown.
// Before version 3, showClock: false hid the clock and its date.
function normalizeHomeSections(list, version, showClock) {
  const known = DEFAULT_SETTINGS.homeSections.map((section) => section.id);
  const hiddenBefore = version < 3 && showClock === false ? ['clock', 'date'] : [];
  const result = [];
  for (const section of Array.isArray(list) ? list : []) {
    if (!section || !known.includes(section.id) || result.some((kept) => kept.id === section.id)) continue;
    result.push({ id: section.id, show: typeof section.show === 'boolean' ? section.show : true });
  }
  for (const id of known) {
    if (!result.some((kept) => kept.id === id)) result.push({ id, show: !hiddenBefore.includes(id) });
  }
  return result;
}

const HOME_BACKGROUNDS = ['theme', 'colour', 'image'];

function normalizeHomeBackground(value) {
  const input = value && typeof value === 'object' ? value : {};
  const colour = typeof input.colour === 'string' && /^#[0-9a-f]{6}$/i.test(input.colour)
    ? input.colour.toLowerCase()
    : DEFAULT_SETTINGS.homeBackground.colour;
  const type = HOME_BACKGROUNDS.includes(input.type) ? input.type : DEFAULT_SETTINGS.homeBackground.type;
  return { type, colour };
}

// The one rule for addresses in rail apps and speed dial shortcuts.
export function isLinkUrl(value) {
  return isHttpUrl(value) && value.length <= MAX_LINK_LENGTH;
}

const APP_ID = /^app-[a-z0-9]+$/;

// A stable id for a rail app, so its open tab stays tied to it when the
// app's address is edited. Derived from the address (the same on every read
// of settings that have none yet) and kept from then on.
export function newAppId(url, taken) {
  let hash = 0x811c9dc5;
  for (const char of url) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
  let id = `app-${hash.toString(36)}`;
  for (let n = 2; taken.has(id); n += 1) id = `app-${hash.toString(36)}${n.toString(36)}`;
  return id;
}

function pickChoice(key, value) {
  return CHOICES[key].includes(value) ? value : DEFAULT_SETTINGS[key];
}

function pickBoolean(key, value) {
  return typeof value === 'boolean' ? value : DEFAULT_SETTINGS[key];
}

// A list of { title, url } links: http(s) only, no duplicate URLs, capped.
function normalizeLinks(list, max) {
  if (!Array.isArray(list)) return [];
  const result = [];
  const seen = new Set();
  for (const item of list) {
    if (!item || !isLinkUrl(item.url) || seen.has(item.url)) continue;
    seen.add(item.url);
    const title = typeof item.title === 'string' && item.title.trim()
      ? item.title.trim().slice(0, 80)
      : new URL(item.url).hostname;
    result.push({ title, url: item.url });
    if (result.length === max) break;
  }
  return result;
}

// Rail apps are links with a unique, stable id.
function normalizeApps(list) {
  const taken = new Set();
  return normalizeLinks(list, MAX_APPS).map((link) => {
    const stored = list.find((item) => item?.url === link.url);
    const given = stored?.id;
    const id = typeof given === 'string' && APP_ID.test(given) && !taken.has(given) ? given : newAppId(link.url, taken);
    taken.add(id);
    // beside: open in Chrome's split view next to the page, not in the panel.
    return { id, ...link, beside: stored?.beside === true };
  });
}

function normalizeMobileSites(list) {
  if (!Array.isArray(list)) return [];
  const hosts = new Set();
  for (const item of list) {
    const host = normalizeHostname(item);
    if (host) hosts.add(host);
    if (hosts.size === MAX_MOBILE_SITES) break;
  }
  return [...hosts];
}

export function normalizeSettings(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const customSearchUrl = isHttpUrl(input.customSearchUrl) && input.customSearchUrl.includes('%s')
    ? input.customSearchUrl
    : '';
  let searchEngine = pickChoice('searchEngine', input.searchEngine);
  if (searchEngine === 'custom' && !customSearchUrl) searchEngine = DEFAULT_SETTINGS.searchEngine;
  const version = Number.isInteger(input.settingsVersion) ? input.settingsVersion : 1;
  return {
    settingsVersion: SETTINGS_VERSION,
    theme: pickChoice('theme', input.theme),
    accent: normalizeAccent(input.accent, version),
    density: pickChoice('density', input.density),
    searchEngine,
    customSearchUrl,
    homePage: isHttpUrl(input.homePage) ? input.homePage : '',
    tabLayout: pickChoice('tabLayout', input.tabLayout),
    restoreSession: pickBoolean('restoreSession', input.restoreSession),
    unlockFraming: pickBoolean('unlockFraming', input.unlockFraming),
    mobileMode: pickChoice('mobileMode', input.mobileMode),
    mobileSites: normalizeMobileSites(input.mobileSites),
    newWindowLinks: pickChoice('newWindowLinks', input.newWindowLinks),
    shortcuts: normalizeLinks(input.shortcuts, MAX_SHORTCUTS),
    railPosition: pickChoice('railPosition', input.railPosition),
    // A missing list means "never set", so the presets apply; an empty list
    // means the user removed every app.
    apps: normalizeApps(Array.isArray(input.apps) ? input.apps : DEFAULT_SETTINGS.apps),
    clockFormat: pickChoice('clockFormat', input.clockFormat),
    homeSections: normalizeHomeSections(input.homeSections, version, input.showClock),
    homeBackground: normalizeHomeBackground(input.homeBackground),
    shortcutColumns: pickChoice('shortcutColumns', input.shortcutColumns),
    shortcutSize: pickChoice('shortcutSize', input.shortcutSize),
    shortcutLabels: pickBoolean('shortcutLabels', input.shortcutLabels),
  };
}

// True for a plain object carrying at least one Sidespace setting. Used to
// refuse importing an unrelated JSON file, which normalizeSettings would
// otherwise turn into "all defaults" and wipe the user's settings.
export function looksLikeSettings(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  return Object.keys(raw).some((key) => Object.hasOwn(DEFAULT_SETTINGS, key));
}

export function searchTemplate(settings) {
  return settings.searchEngine === 'custom'
    ? settings.customSearchUrl
    : SEARCH_ENGINES[settings.searchEngine];
}

export async function loadSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(stored[SETTINGS_KEY]);
}

// Replaces all settings; returns what was stored after validation.
export async function saveSettings(raw) {
  const next = normalizeSettings(raw);
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

// Applies a change on top of the settings as stored right now. `change` is a
// partial settings object, or a function from the current settings to one;
// a function sees edits made elsewhere (another panel, the settings page) and
// may throw to refuse the change.
export async function updateSettings(change) {
  const current = await loadSettings();
  const patch = typeof change === 'function' ? change(current) : change;
  return saveSettings({ ...current, ...patch });
}

// The home page picture: a data: URL the settings page made on a canvas.
// Anything else in that key is ignored.
export function validHomeImage(value) {
  return typeof value === 'string' && /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/]+=*$/.test(value) ? value : '';
}

export async function loadHomeImage() {
  return validHomeImage((await chrome.storage.local.get(HOME_IMAGE_KEY))[HOME_IMAGE_KEY]);
}

export function onHomeImageChanged(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[HOME_IMAGE_KEY]) callback(validHomeImage(changes[HOME_IMAGE_KEY].newValue));
  });
}

export function onSettingsChanged(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[SETTINGS_KEY]) {
      callback(normalizeSettings(changes[SETTINGS_KEY].newValue));
    }
  });
}
