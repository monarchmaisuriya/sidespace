import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  displayHost, isBrowserOnlyUrl, originFaviconUrl, resolveInput, sameOriginUrl, trustedFrameUrl,
} from '../../src/shared/url.js';

const T = 'https://search.example/?q=%s';

test('empty input resolves to null', () => {
  assert.equal(resolveInput('   ', T), null);
});

test('full http(s) urls are kept', () => {
  assert.equal(resolveInput('https://example.com/a?b=1', T), 'https://example.com/a?b=1');
  assert.equal(resolveInput('http://example.com', T), 'http://example.com/');
});

test('bare hosts get https, loopback gets http', () => {
  assert.equal(resolveInput('example.com/path', T), 'https://example.com/path');
  assert.equal(resolveInput('localhost:3000', T), 'http://localhost:3000/');
  assert.equal(resolveInput('127.0.0.1:8080/x', T), 'http://127.0.0.1:8080/x');
});

test('words and sentences become a search', () => {
  assert.equal(resolveInput('side panel', T), 'https://search.example/?q=side%20panel');
  assert.equal(resolveInput('hello', T), 'https://search.example/?q=hello');
});

test('javascript: text is searched, never returned as a url', () => {
  const out = resolveInput('javascript:alert(1)', T);
  assert.ok(out.startsWith('https://search.example/'));
});

test('browser-only schemes are kept so the caller can open a browser tab', () => {
  assert.equal(resolveInput('chrome://settings', T), 'chrome://settings');
  assert.equal(isBrowserOnlyUrl('chrome://settings'), true);
  assert.equal(isBrowserOnlyUrl('https://example.com'), false);
});

test('displayHost strips www', () => {
  assert.equal(displayHost('https://www.example.com/x'), 'example.com');
  assert.equal(displayHost('nope'), '');
});

test('frame URL: same-origin reported URL wins, anything else falls back to the browser URL', () => {
  const loaded = 'https://app.example/spa';
  assert.equal(trustedFrameUrl(loaded, 'https://app.example/spa/next'), 'https://app.example/spa/next');
  assert.equal(trustedFrameUrl(loaded, 'https://bank.example/login'), loaded);
  assert.equal(trustedFrameUrl(loaded, 'http://app.example/spa'), loaded);
  assert.equal(trustedFrameUrl(loaded, undefined), loaded);
  assert.equal(trustedFrameUrl('chrome-error://chromewebdata/', 'https://x.example/'), '');
});

test('page-supplied URLs are kept only on the page origin', () => {
  assert.equal(sameOriginUrl('https://a.example/icon.png', 'https://a.example/page'), 'https://a.example/icon.png');
  assert.equal(sameOriginUrl('http://192.168.1.1/cgi?x=1', 'https://a.example/page'), '');
  assert.equal(sameOriginUrl('https://cdn.a.example/icon.png', 'https://a.example/page'), '');
  assert.equal(sameOriginUrl('', 'https://a.example/'), '');
  assert.equal(originFaviconUrl('https://a.example/x/y'), 'https://a.example/favicon.ico');
  assert.equal(originFaviconUrl('chrome://settings'), '');
});
