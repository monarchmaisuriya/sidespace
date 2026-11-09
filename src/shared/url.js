// Turns what the user typed into the URL to load.

import { isHttpUrl } from './settings.js';

// Schemes Chrome refuses to load in a frame; the panel offers a browser tab instead.
const BROWSER_ONLY_SCHEMES = new Set(['chrome:', 'file:', 'about:', 'view-source:']);

const HOST_LIKE = /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\]|[^\s/?#:@]+\.[a-z][a-z0-9-]*)(:\d{1,5})?([/?#]\S*)?$/i;
const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?([/?#]|$)/i;

// Returns an absolute URL string, or null for empty input.
// - "https://x.com/a" stays as is.
// - "example.com/path" and "localhost:3000" become https:// (http:// for loopback).
// - "chrome://settings" is kept so the caller can open it in a browser tab.
// - Anything else, including "javascript:..." text, becomes a search.
export function resolveInput(text, template) {
  const input = typeof text === 'string' ? text.trim() : '';
  if (!input) return null;
  if (isHttpUrl(input) && /^https?:\/\//i.test(input)) return new URL(input).href;
  if (!/\s/.test(input) && HOST_LIKE.test(input)) {
    const scheme = LOCAL_HOST.test(input) ? 'http' : 'https';
    const candidate = `${scheme}://${input}`;
    if (isHttpUrl(candidate)) return new URL(candidate).href;
  }
  if (isBrowserOnlyUrl(input)) return input;
  return template.replace('%s', encodeURIComponent(input));
}

export function isBrowserOnlyUrl(value) {
  try {
    return BROWSER_ONLY_SCHEMES.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

// sender.url is the URL the document loaded with; Chrome does not update it
// for history.pushState. The reported URL is used only when it has the same
// origin, which is all pushState can change, so the origin shown is always
// the one the browser vouches for.
export function trustedFrameUrl(senderUrl, reportedUrl) {
  if (!isHttpUrl(senderUrl)) return '';
  if (isHttpUrl(reportedUrl) && new URL(reportedUrl).origin === new URL(senderUrl).origin) return reportedUrl;
  return senderUrl;
}

// A URL a page supplied (such as its icon) is used only if it points at the
// page's own origin, so a page cannot make the panel request other hosts.
export function sameOriginUrl(candidate, pageUrl) {
  if (!isHttpUrl(candidate) || !isHttpUrl(pageUrl)) return '';
  return new URL(candidate).origin === new URL(pageUrl).origin ? candidate : '';
}

export function originFaviconUrl(pageUrl) {
  return isHttpUrl(pageUrl) ? `${new URL(pageUrl).origin}/favicon.ico` : '';
}

export function displayHost(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
