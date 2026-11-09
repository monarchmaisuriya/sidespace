import { displayHost, originFaviconUrl } from './url.js';

// Site icons. Tried in order, first one that works wins:
//   1. the icon the page itself reported (already checked to be on its origin)
//   2. Chrome's own icon store (_favicon), which needs no network and is not
//      blocked by sites that refuse cross-origin icon requests; it answers
//      every unknown site with the same generic globe, which is skipped
//   3. /favicon.ico on the page's origin
//   4. a letter tile (always shown until an image loads)
const STORE_SIZE = 32;
const UNKNOWN_SITE = 'https://sidespace-unknown-site.invalid/';
const resolved = new Map(); // sources key -> working image URL, or null for none

function storeIconUrl(pageUrl) {
  return chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=${STORE_SIZE}`);
}

async function loadImage(src) {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

function pixels(img) {
  const canvas = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
  const context = canvas.getContext('2d');
  context.drawImage(img, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

let globePixels = null;
function genericGlobe() {
  globePixels ??= loadImage(storeIconUrl(UNKNOWN_SITE)).then(pixels, () => new Uint8ClampedArray());
  return globePixels;
}

function samePixels(a, b) {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

async function firstWorkingIcon(pageUrl, reportedIcon) {
  if (reportedIcon) {
    try {
      await loadImage(reportedIcon);
      return reportedIcon;
    } catch {
      // Not loadable from the extension page; try the next source.
    }
  }
  if (pageUrl) {
    const store = storeIconUrl(pageUrl);
    try {
      const img = await loadImage(store);
      if (!samePixels(pixels(img), await genericGlobe())) return store;
    } catch {
      // Chrome's store had nothing usable; try the next source.
    }
    const origin = originFaviconUrl(pageUrl);
    try {
      await loadImage(origin);
      return origin;
    } catch {
      // No icon on the site either; the letter tile stays.
    }
  }
  return null;
}

function iconFor(pageUrl, reportedIcon) {
  const key = `${pageUrl}\n${reportedIcon}`;
  if (!resolved.has(key)) resolved.set(key, firstWorkingIcon(pageUrl, reportedIcon));
  return resolved.get(key);
}

const HOME_ICON = '<svg viewBox="0 0 24 24"><path d="M4 11l8-7 8 7M6.5 9v11h11V9M10 20v-5h4v5"/></svg>';

// An icon box showing the first letter of the host, replaced by the site's
// icon once one loads. A blank tab (no page yet) shows the home page glyph.
export function faviconFor(pageUrl, reportedIcon = '') {
  const box = document.createElement('span');
  box.className = 'favicon';
  if (!pageUrl) {
    box.dataset.icon = 'home';
    box.innerHTML = HOME_ICON;
    return box;
  }
  box.textContent = (displayHost(pageUrl)[0] ?? '?').toUpperCase();
  // data-icon says how the lookup ended: "image" or "letter".
  iconFor(pageUrl, reportedIcon).then((src) => {
    box.dataset.icon = src ? 'image' : 'letter';
    if (!src) return;
    const img = document.createElement('img');
    img.alt = '';
    img.src = src;
    box.replaceChildren(img);
    box.classList.add('has-image');
  });
  return box;
}
