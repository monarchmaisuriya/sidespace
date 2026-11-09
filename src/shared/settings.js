// User settings: the single definition of every setting, its default, and how
// stored values are validated. Anything invalid falls back to its default.
// Stored in storage.local: storage.sync caps one item at 8 KB, which a long
// shortcut list would exceed.

export const SETTINGS_KEY = 'settings';
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
  accent: '#6d5dfc',
  density: 'comfortable',
  searchEngine: 'google',
  customSearchUrl: '',
  homePage: '',
  tabStrip: 'auto',
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
  showClock: true,
});

const CHOICES = {
  theme: ['system', 'light', 'dark'],
  density: ['comfortable', 'compact'],
  searchEngine: [...Object.keys(SEARCH_ENGINES), 'custom'],
  tabStrip: ['always', 'auto'],
  mobileMode: ['off', 'sites', 'all'],
  newWindowLinks: ['panel', 'browser'],
  railPosition: ['left', 'right', 'hidden'],
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
    if (!item || !isHttpUrl(item.url) || item.url.length > 2048 || seen.has(item.url)) continue;
    seen.add(item.url);
    const title = typeof item.title === 'string' && item.title.trim()
      ? item.title.trim().slice(0, 80)
      : new URL(item.url).hostname;
    result.push({ title, url: item.url });
    if (result.length === max) break;
  }
  return result;
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
  return {
    theme: pickChoice('theme', input.theme),
    accent: typeof input.accent === 'string' && /^#[0-9a-f]{6}$/i.test(input.accent)
      ? input.accent.toLowerCase()
      : DEFAULT_SETTINGS.accent,
    density: pickChoice('density', input.density),
    searchEngine,
    customSearchUrl,
    homePage: isHttpUrl(input.homePage) ? input.homePage : '',
    tabStrip: pickChoice('tabStrip', input.tabStrip),
    restoreSession: pickBoolean('restoreSession', input.restoreSession),
    unlockFraming: pickBoolean('unlockFraming', input.unlockFraming),
    mobileMode: pickChoice('mobileMode', input.mobileMode),
    mobileSites: normalizeMobileSites(input.mobileSites),
    newWindowLinks: pickChoice('newWindowLinks', input.newWindowLinks),
    shortcuts: normalizeLinks(input.shortcuts, MAX_SHORTCUTS),
    railPosition: pickChoice('railPosition', input.railPosition),
    // A missing list means "never set", so the presets apply; an empty list
    // means the user removed every app.
    apps: Array.isArray(input.apps) ? normalizeLinks(input.apps, MAX_APPS) : DEFAULT_SETTINGS.apps.map((app) => ({ ...app })),
    showClock: pickBoolean('showClock', input.showClock),
  };
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

// Applies a partial change on top of the current stored settings.
export async function updateSettings(patch) {
  return saveSettings({ ...(await loadSettings()), ...patch });
}

export function onSettingsChanged(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[SETTINGS_KEY]) {
      callback(normalizeSettings(changes[SETTINGS_KEY].newValue));
    }
  });
}
