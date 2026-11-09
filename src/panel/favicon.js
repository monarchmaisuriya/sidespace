import { displayHost, originFaviconUrl } from '../shared/url.js';

// Which image worked for a page (or null when none did), so each failing
// request is made once per panel session, not on every render.
const resolved = new Map();

function letterColour(host) {
  let hash = 0;
  for (const char of host) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return `hsl(${hash} 45% 42%)`;
}

// An icon box that shows the first letter of the host, in a colour derived
// from the host, until an image loads. Tries an icon the page reported
// (already checked to be on the page's own origin), then /favicon.ico there.
export function faviconFor(pageUrl, reportedIcon, size) {
  const host = displayHost(pageUrl);
  const box = document.createElement('span');
  box.className = 'favicon';
  box.textContent = (host[0] ?? '+').toUpperCase();
  if (host) box.style.background = letterColour(host);
  const sources = [reportedIcon, originFaviconUrl(pageUrl)].filter(Boolean);
  const key = sources.join(' ');
  if (!key || resolved.get(key) === null) return box;

  const img = document.createElement('img');
  img.alt = '';
  img.width = size;
  img.height = size;
  img.referrerPolicy = 'no-referrer';
  const known = resolved.get(key);
  const queue = known ? [known] : sources;
  img.addEventListener('load', () => {
    resolved.set(key, img.src);
    box.replaceChildren(img);
    box.style.background = '';
  }, { once: true });
  img.addEventListener('error', () => {
    queue.shift();
    if (queue.length) img.src = queue[0];
    else resolved.set(key, null);
  });
  img.src = queue[0];
  return box;
}
