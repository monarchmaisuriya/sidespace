import {
  DEFAULT_SETTINGS, HOME_IMAGE_KEY, loadHomeImage, loadSettings, looksLikeSettings, normalizeHostname, onHomeImageChanged,
  onSettingsChanged, saveSettings, updateSettings, validHomeImage,
} from '../shared/settings.js';
import {
  addLink, moveLink, RAIL, removeLink, SPEED_DIAL, updateLink,
} from '../shared/links.js';
import { applyAppearance } from '../shared/theme.js';
import { faviconFor } from '../shared/favicon.js';
import { reconcile, setIcon } from '../shared/reconcile.js';

const form = document.getElementById('settings');
const status = document.getElementById('status');
const importFile = document.getElementById('import-file');
const accentCustom = document.getElementById('accent-custom');
const homeSections = document.getElementById('home-sections');
const backgroundType = document.getElementById('home-background-type');
const backgroundColour = document.getElementById('home-background-colour');
const imageFile = document.getElementById('home-image-file');
const imagePreview = document.getElementById('home-image-preview');
const imageError = document.getElementById('home-image-error');
const SECTION_NAMES = { clock: 'Clock', date: 'Date', search: 'Search box', shortcuts: 'Shortcuts' };
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_SIDE = 2560;
const ICONS = {
  up: '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
  remove: '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>',
};
// The lists edited on this page, and which limits apply to each.
const EDITORS = {
  apps: { where: RAIL, list: 'apps', add: 'apps-add', error: 'apps-error', empty: 'apps-empty', noun: 'app' },
  shortcuts: { where: SPEED_DIAL, list: 'shortcuts', add: 'shortcuts-add', error: 'shortcuts-error', empty: 'shortcuts-empty', noun: 'shortcut' },
};

let settings;
// The stored new tab page picture (a data: URL), or ''.
let homeImage = '';
// True from picking "Custom" until a valid template is saved or another
// engine is picked. Until then the stored engine is still the old one, so
// refilling the form from storage would undo the user's choice mid-edit.
let choosingCustom = false;

let statusTimer = 0;
function showStatus(text, { error = false } = {}) {
  status.textContent = text;
  status.classList.toggle('error', error);
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { status.textContent = ''; }, error ? 6000 : 2000);
}

function fill(values) {
  settings = values;
  applyAppearance(values);
  for (const element of form.elements) {
    if (!element.name || !(element.name in values)) continue;
    if (choosingCustom && (element.name === 'searchEngine' || element.name === 'customSearchUrl')) continue;
    if (element.type === 'radio') element.checked = element.value === values[element.name];
    else if (element.type === 'checkbox') element.checked = values[element.name];
    else if (element.name === 'mobileSites') {
      if (document.activeElement !== element) element.value = values.mobileSites.join('\n');
    } else if (document.activeElement !== element) element.value = values[element.name];
  }
  const presetAccent = [...form.elements.accent].some((radio) => radio.checked);
  accentCustom.closest('.swatch').classList.toggle('selected', !presetAccent);
  if (!presetAccent) accentCustom.value = values.accent;
  const custom = choosingCustom || values.searchEngine === 'custom';
  document.getElementById('custom-search-row').hidden = !custom;
  for (const key of Object.keys(EDITORS)) renderEditor(key);
  renderHomeSections();
  renderBackground();
}

// ---------- rail apps and speed dial editors ----------

function iconButton(kind, label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `icon-button${kind === 'remove' ? ' danger' : ''}`;
  button.dataset.action = kind;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = ICONS[kind];
  return button;
}

function textInput(className, label) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = className;
  input.spellcheck = false;
  input.setAttribute('aria-label', label);
  return input;
}

function renderEditor(key) {
  const editor = EDITORS[key];
  const links = settings[key];
  // Rows are kept by key, so the field being typed in and its focus survive
  // saves made from this page, the panel or another window.
  reconcile(document.getElementById(editor.list), links, (link) => link.id ?? link.url, () => {
    const li = document.createElement('li');
    li.append(textInput('name', `${editor.noun} name`), textInput('url', `${editor.noun} address`));
    if (editor.where.ids) {
      // Rail apps only: open beside the page in Chrome's split view.
      const beside = document.createElement('label');
      beside.className = 'beside';
      beside.title = 'Open beside the page (Chrome split view), not in the panel';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.setAttribute('aria-label', 'Open beside the page');
      beside.append(box, 'Beside');
      li.append(beside);
    }
    li.append(
      iconButton('up', 'Move up'),
      iconButton('down', 'Move down'),
      iconButton('remove', 'Remove'),
    );
    return li;
  }, (li, link) => {
    const index = links.indexOf(link);
    li.dataset.url = link.url;
    const name = li.querySelector('.name');
    const url = li.querySelector('.url');
    if (document.activeElement !== name) name.value = link.title;
    if (document.activeElement !== url) url.value = link.url;
    const beside = li.querySelector('.beside input');
    if (beside) beside.checked = link.beside === true;
    li.querySelector('[data-action="up"]').disabled = index === 0;
    li.querySelector('[data-action="down"]').disabled = index === links.length - 1;
    setIcon(li, link.url, '', faviconFor);
  });
  document.getElementById(editor.empty).hidden = links.length > 0;
}

function showEditorError(key, message) {
  const error = document.getElementById(EDITORS[key].error);
  error.textContent = message;
  error.hidden = !message;
}

// Runs one list edit on the list as stored right now (the panel may have
// changed it); a refused edit shows its reason and stores nothing.
async function editList(key, change) {
  try {
    const next = await updateSettings((current) => ({ [key]: change(current[key], EDITORS[key].where) }));
    showEditorError(key, '');
    fill(next);
    showStatus('Saved');
    return true;
  } catch (failure) {
    showEditorError(key, failure.message);
    return false;
  }
}

for (const key of Object.keys(EDITORS)) {
  const editor = EDITORS[key];
  const list = document.getElementById(editor.list);
  list.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const { url } = button.closest('li').dataset;
    const step = { up: -1, down: 1 }[button.dataset.action];
    if (button.dataset.action === 'remove') editList(key, (links, where) => removeLink(links, url, where));
    if (step) {
      editList(key, (links, where) => moveLink(links, url, links.findIndex((link) => link.url === url) + step, where)).then(() => {
        // At the top or bottom the button just used is disabled and loses
        // focus; keep the keyboard on the row with its other move button.
        if (button.disabled) button.closest('li').querySelector(`[data-action="${step < 0 ? 'down' : 'up'}"]`).focus();
      });
    }
  });
  // Name and address edits are saved when the field is left (change event).
  list.addEventListener('change', (event) => {
    event.stopPropagation();
    const row = event.target.closest('li');
    if (!row) return;
    const title = row.querySelector('.name').value;
    const url = row.querySelector('.url').value;
    const beside = row.querySelector('.beside input')?.checked;
    editList(key, (links, where) => updateLink(links, row.dataset.url, { title, url, beside }, where));
  });

  const add = document.getElementById(editor.add);
  add.addEventListener('change', (event) => event.stopPropagation());
  const addNow = async () => {
    const name = add.querySelector('.name');
    const url = add.querySelector('.url');
    if (await editList(key, (links, where) => addLink(links, { title: name.value, url: url.value }, where))) {
      name.value = '';
      url.value = '';
    }
  };
  add.querySelector('button').addEventListener('click', addNow);
  add.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addNow();
    }
  });
}

// ---------- new tab page ----------

function renderHomeSections() {
  const sections = settings.homeSections;
  reconcile(homeSections, sections, (section) => section.id, (section) => {
    const li = document.createElement('li');
    const label = document.createElement('label');
    const show = document.createElement('input');
    show.type = 'checkbox';
    label.append(show, SECTION_NAMES[section.id]);
    li.append(label, iconButton('up', `Move ${SECTION_NAMES[section.id]} up`), iconButton('down', `Move ${SECTION_NAMES[section.id]} down`));
    return li;
  }, (li, section) => {
    const index = sections.indexOf(section);
    li.dataset.id = section.id;
    li.querySelector('input').checked = section.show;
    li.querySelector('[data-action="up"]').disabled = index === 0;
    li.querySelector('[data-action="down"]').disabled = index === sections.length - 1;
  });
}

// Applies one change to the parts list as stored right now.
async function editSections(change) {
  fill(await updateSettings((current) => ({ homeSections: change(current.homeSections.map((section) => ({ ...section }))) })));
  showStatus('Saved');
}

homeSections.addEventListener('change', (event) => {
  event.stopPropagation();
  const { id } = event.target.closest('li').dataset;
  const show = event.target.checked;
  editSections((sections) => sections.map((section) => (section.id === id ? { ...section, show } : section)));
});

homeSections.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { id } = button.closest('li').dataset;
  const step = button.dataset.action === 'up' ? -1 : 1;
  editSections((sections) => {
    const from = sections.findIndex((section) => section.id === id);
    const to = from + step;
    if (from === -1 || to < 0 || to >= sections.length) return sections;
    [sections[from], sections[to]] = [sections[to], sections[from]];
    return sections;
  }).then(() => {
    // At the top or bottom the button just used is disabled and loses focus.
    if (button.disabled) button.closest('li').querySelector(`[data-action="${step < 0 ? 'down' : 'up'}"]`).focus();
  });
});

function renderBackground() {
  const { type, colour } = settings.homeBackground;
  backgroundType.value = type;
  if (document.activeElement !== backgroundColour) backgroundColour.value = colour;
  backgroundColour.hidden = type !== 'colour';
  document.getElementById('home-image-row').hidden = type !== 'image';
  imagePreview.hidden = !homeImage;
  if (homeImage) imagePreview.src = homeImage;
  document.getElementById('home-image-remove').disabled = !homeImage;
}

function showImageError(message) {
  imageError.textContent = message;
  imageError.hidden = !message;
}

backgroundType.addEventListener('change', (event) => {
  event.stopPropagation();
  save({ homeBackground: { ...settings.homeBackground, type: backgroundType.value } });
  if (backgroundType.value === 'image' && !homeImage) imageFile.click();
});
backgroundColour.addEventListener('change', (event) => {
  event.stopPropagation();
  save({ homeBackground: { ...settings.homeBackground, colour: backgroundColour.value } });
});

// Shrinks the picture to at most MAX_IMAGE_SIDE pixels on its long side and
// returns it as a WebP data: URL, so one picture stays well inside the
// 10 MB storage.local quota.
async function homeImageFrom(file) {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name} is not a picture.`);
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`${file.name} is ${(file.size / 1048576).toFixed(1)} MB; pictures can be at most 8 MB.`);
  }
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error(`${file.name} could not be read as a picture.`);
  });
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 });
  const url = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  if (!validHomeImage(url)) throw new Error(`${file.name} could not be converted to a WebP picture.`);
  return url;
}

document.getElementById('home-image-choose').addEventListener('click', () => imageFile.click());
imageFile.addEventListener('change', async () => {
  const [file] = imageFile.files;
  imageFile.value = '';
  if (!file) return;
  try {
    await chrome.storage.local.set({ [HOME_IMAGE_KEY]: await homeImageFrom(file) });
  } catch (failure) {
    showImageError(failure.message);
    return;
  }
  showImageError('');
  await save({ homeBackground: { ...settings.homeBackground, type: 'image' } });
});
document.getElementById('home-image-remove').addEventListener('click', async () => {
  await chrome.storage.local.remove(HOME_IMAGE_KEY);
  await save({ homeBackground: { ...settings.homeBackground, type: 'theme' } });
});

onHomeImageChanged((next) => {
  homeImage = next;
  renderBackground();
});

document.getElementById('apps-reset').addEventListener('click', () => {
  save({ apps: DEFAULT_SETTINGS.apps.map((app) => ({ ...app })) });
});

// ---------- form fields ----------

function readField(element) {
  if (element.type === 'checkbox') return element.checked;
  if (element.name === 'mobileSites') return element.value.split('\n');
  return element.value.trim();
}

async function save(patch) {
  const next = await updateSettings(patch);
  if (next.searchEngine === 'custom') choosingCustom = false;
  // Show what was actually stored, so rejected input is visible at once.
  // Lists are checked before saving (links.js), and the site list below.
  const rejected = Object.keys(patch).filter((key) => !['mobileSites', 'apps', 'shortcuts'].includes(key)
    && JSON.stringify(next[key]) !== JSON.stringify(patch[key]));
  // The site list is saved minus lines that are not hostnames; name them.
  const ignored = (patch.mobileSites ?? []).map((line) => line.trim()).filter((line) => line && !normalizeHostname(line));
  fill(next);
  if (rejected.length) showStatus(`Not saved: invalid ${rejected.join(', ')}`, { error: true });
  else if (ignored.length) showStatus(`Saved; ignored: ${ignored.join(', ')}`);
  else showStatus('Saved');
}

form.addEventListener('change', (event) => {
  const element = event.target;
  if (!element.name) return;
  if (element.name === 'searchEngine') {
    choosingCustom = element.value === 'custom' && settings.searchEngine !== 'custom';
    if (choosingCustom && !settings.customSearchUrl) {
      // Wait for a template before switching; an empty custom engine is invalid.
      fill(settings);
      form.elements.customSearchUrl.focus();
      return;
    }
  }
  const patch = { [element.name]: readField(element) };
  if (element.name === 'customSearchUrl' && form.elements.searchEngine.value === 'custom') patch.searchEngine = 'custom';
  save(patch);
});
form.addEventListener('submit', (event) => event.preventDefault());
accentCustom.addEventListener('change', () => save({ accent: accentCustom.value }));

// chrome:// links do not open from extension pages by default.
document.getElementById('shortcuts-link').addEventListener('click', (event) => {
  event.preventDefault();
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

// ---------- backup ----------

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
    showStatus(`Import failed: ${file.name} is not valid JSON (${error.message})`, { error: true });
    return;
  }
  if (!looksLikeSettings(parsed)) {
    showStatus(`Import failed: ${file.name} has no Sidespace settings`, { error: true });
    return;
  }
  fill(await saveSettings(parsed));
  showStatus('Imported');
});

document.getElementById('reset').addEventListener('click', async () => {
  if (!confirm('Reset every Sidespace setting, including rail apps, speed dial shortcuts and the new tab picture?')) return;
  await chrome.storage.local.remove(HOME_IMAGE_KEY);
  fill(await saveSettings(DEFAULT_SETTINGS));
  showStatus('Reset');
});

onSettingsChanged(fill);
Promise.all([loadSettings(), loadHomeImage()]).then(([values, image]) => {
  homeImage = image;
  fill(values);
});
