// Editable { title, url } lists: rail apps and speed dial shortcuts.
// Pure functions; each returns a new list or throws an Error whose message
// can be shown to the user as is. Rail apps also carry a stable `id`, which
// edits keep and additions get, and `beside`: open beside the page in
// Chrome's split view instead of in the panel.

import { isLinkUrl, MAX_APPS, MAX_SHORTCUTS, newAppId } from './settings.js';

export const RAIL = Object.freeze({ max: MAX_APPS, place: 'the rail', ids: true });
export const SPEED_DIAL = Object.freeze({ max: MAX_SHORTCUTS, place: 'the speed dial', ids: false });

// "example.com" -> "https://example.com/". A name without a dot needs its
// scheme typed out ("http://intranet"), so a stray word is not taken for an
// address. Throws when the text is not a usable web address.
export function parseLinkUrl(text) {
  const input = typeof text === 'string' ? text.trim() : '';
  if (!input) throw new Error('Enter a web address, like example.com');
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(input);
  const candidate = hasScheme ? input : `https://${input}`;
  const valid = isLinkUrl(candidate) && (hasScheme || new URL(candidate).hostname.includes('.'));
  if (!valid) throw new Error(`"${input.slice(0, 80)}" is not a web address (http or https, at most 2048 characters)`);
  return new URL(candidate).href;
}

function cleanTitle(title, url) {
  const text = typeof title === 'string' ? title.trim().slice(0, 80) : '';
  return text || new URL(url).hostname.replace(/^www\./, '');
}

function indexOfUrl(links, url, where) {
  const index = links.findIndex((link) => link.url === url);
  if (index === -1) throw new Error(`That link is no longer in ${where.place}.`);
  return index;
}

export function addLink(links, { title, url, beside = false }, where = RAIL) {
  const href = parseLinkUrl(url);
  if (links.some((link) => link.url === href)) throw new Error(`${href} is already in ${where.place}.`);
  if (links.length >= where.max) throw new Error(`${where.place[0].toUpperCase()}${where.place.slice(1)} holds at most ${where.max}; remove one first.`);
  const link = { title: cleanTitle(title, href), url: href };
  return [...links, where.ids ? { id: newAppId(href, new Set(links.map((item) => item.id))), ...link, beside: beside === true } : link];
}

// `beside` changes only when given; otherwise the app keeps its own.
export function updateLink(links, currentUrl, { title, url, beside }, where = RAIL) {
  const index = indexOfUrl(links, currentUrl, where);
  const href = parseLinkUrl(url);
  if (links.some((link, i) => i !== index && link.url === href)) throw new Error(`${href} is already in ${where.place}.`);
  const kept = where.ids && typeof beside === 'boolean' ? { beside } : {};
  return links.map((link, i) => (i === index ? { ...link, title: cleanTitle(title, href), url: href, ...kept } : link));
}

export function removeLink(links, url, where = RAIL) {
  const index = indexOfUrl(links, url, where);
  return links.filter((_, i) => i !== index);
}

// Moves the link to position `toIndex` (clamped to the list).
export function moveLink(links, url, toIndex, where = RAIL) {
  const from = indexOfUrl(links, url, where);
  const list = [...links];
  const [link] = list.splice(from, 1);
  list.splice(Math.max(0, Math.min(toIndex, list.length)), 0, link);
  return list;
}
