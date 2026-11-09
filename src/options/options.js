import {
  DEFAULT_SETTINGS, loadSettings, onSettingsChanged, saveSettings, updateSettings,
} from '../shared/settings.js';
import { applyAppearance } from '../shared/theme.js';

const form = document.getElementById('settings');
const status = document.getElementById('status');
const shortcutsList = document.getElementById('shortcuts');
const appsList = document.getElementById('apps');
const importFile = document.getElementById('import-file');
let settings;

function showStatus(text) {
  status.textContent = text;
  setTimeout(() => { if (status.textContent === text) status.textContent = ''; }, 2000);
}

function fill(values) {
  settings = values;
  applyAppearance(values);
  for (const element of form.elements) {
    if (!element.name || !(element.name in values)) continue;
    if (element.type === 'checkbox') element.checked = values[element.name];
    else if (element.name === 'mobileSites') {
      if (document.activeElement !== element) element.value = values.mobileSites.join('\n');
    } else if (document.activeElement !== element) element.value = values[element.name];
  }
  const custom = values.searchEngine === 'custom' || form.elements.searchEngine.value === 'custom';
  document.getElementById('custom-search-row').hidden = !custom;
  document.getElementById('custom-search-help').hidden = !custom;
  renderLinks(shortcutsList, document.getElementById('shortcuts-empty'), values.shortcuts, 'shortcuts');
  renderLinks(appsList, document.getElementById('apps-empty'), values.apps, 'apps');
}

// Lists { title, url } items with Move up and Remove buttons.
function renderLinks(list, emptyNote, links, key) {
  const items = links.map((shortcut, index) => {
    const li = document.createElement('li');
    const text = document.createElement('span');
    text.textContent = shortcut.title;
    const url = document.createElement('small');
    url.textContent = shortcut.url;
    text.append(document.createElement('br'), url);
    const up = document.createElement('button');
    up.type = 'button';
    up.textContent = 'Move up';
    up.disabled = index === 0;
    Object.assign(up.dataset, { key, index: String(index), action: 'up' });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    Object.assign(remove.dataset, { key, index: String(index), action: 'remove' });
    li.append(text, up, remove);
    return li;
  });
  list.replaceChildren(...items);
  emptyNote.hidden = items.length > 0;
}

function readField(element) {
  if (element.type === 'checkbox') return element.checked;
  if (element.name === 'mobileSites') return element.value.split('\n');
  return element.value.trim();
}

async function save(patch) {
  const next = await updateSettings(patch);
  // Show what was actually stored, so rejected input is visible at once.
  const rejected = Object.keys(patch).filter((key) => key !== 'mobileSites'
    && JSON.stringify(next[key]) !== JSON.stringify(patch[key]));
  fill(next);
  showStatus(rejected.length ? `Not saved: invalid ${rejected.join(', ')}` : 'Saved');
}

form.addEventListener('change', (event) => {
  const element = event.target;
  if (!element.name) return;
  if (element.name === 'searchEngine' && element.value === 'custom' && !settings.customSearchUrl) {
    // Wait for a template before switching; an empty custom engine is invalid.
    document.getElementById('custom-search-row').hidden = false;
    document.getElementById('custom-search-help').hidden = false;
    form.elements.customSearchUrl.focus();
    return;
  }
  const patch = { [element.name]: readField(element) };
  if (element.name === 'customSearchUrl' && form.elements.searchEngine.value === 'custom') patch.searchEngine = 'custom';
  save(patch);
});
form.addEventListener('submit', (event) => event.preventDefault());

function onLinkListClick(event) {
  const { key, index, action } = event.target.dataset ?? {};
  if (!key) return;
  const links = [...settings[key]];
  const i = Number(index);
  if (action === 'remove') links.splice(i, 1);
  if (action === 'up' && i > 0) [links[i - 1], links[i]] = [links[i], links[i - 1]];
  save({ [key]: links });
}
shortcutsList.addEventListener('click', onLinkListClick);
appsList.addEventListener('click', onLinkListClick);
document.getElementById('apps-reset').addEventListener('click', () => {
  save({ apps: DEFAULT_SETTINGS.apps.map((app) => ({ ...app })) });
});

// chrome:// links do not open from extension pages by default.
document.getElementById('shortcuts-link').addEventListener('click', (event) => {
  event.preventDefault();
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

document.getElementById('export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'sidespace-settings.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
});

document.getElementById('import').addEventListener('click', () => importFile.click());
importFile.addEventListener('change', async () => {
  const [file] = importFile.files;
  importFile.value = '';
  if (!file) return;
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch (error) {
    showStatus(`Import failed: ${file.name} is not valid JSON (${error.message})`);
    return;
  }
  fill(await saveSettings(parsed));
  showStatus('Imported');
});

document.getElementById('reset').addEventListener('click', async () => {
  if (!confirm('Reset every Sidespace setting, including speed dial shortcuts?')) return;
  fill(await saveSettings(DEFAULT_SETTINGS));
  showStatus('Reset');
});

onSettingsChanged(fill);
loadSettings().then(fill);
