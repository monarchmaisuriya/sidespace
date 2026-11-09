import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS, MAX_SHORTCUTS, normalizeHostname, normalizeSettings, searchTemplate,
} from '../../src/shared/settings.js';

test('missing or non-object input gives the defaults', () => {
  assert.deepEqual(normalizeSettings(undefined), JSON.parse(JSON.stringify(DEFAULT_SETTINGS)));
  assert.deepEqual(normalizeSettings('nope'), JSON.parse(JSON.stringify(DEFAULT_SETTINGS)));
});

test('invalid choices and types fall back to the default for that key only', () => {
  const s = normalizeSettings({ theme: 'neon', density: 'compact', unlockFraming: 'yes', accent: 'red' });
  assert.equal(s.theme, 'system');
  assert.equal(s.density, 'compact');
  assert.equal(s.unlockFraming, true);
  assert.equal(s.accent, DEFAULT_SETTINGS.accent);
});

test('custom search engine without a valid %s template falls back to google', () => {
  assert.equal(normalizeSettings({ searchEngine: 'custom', customSearchUrl: 'https://x.test/?q=' }).searchEngine, 'google');
  assert.equal(normalizeSettings({ searchEngine: 'custom', customSearchUrl: 'javascript:alert(%s)' }).searchEngine, 'google');
  const ok = normalizeSettings({ searchEngine: 'custom', customSearchUrl: 'https://x.test/?q=%s' });
  assert.equal(searchTemplate(ok), 'https://x.test/?q=%s');
});

test('home page accepts only http(s)', () => {
  assert.equal(normalizeSettings({ homePage: 'javascript:alert(1)' }).homePage, '');
  assert.equal(normalizeSettings({ homePage: 'https://news.example/' }).homePage, 'https://news.example/');
});

test('shortcuts keep only http(s) urls, default the title, and are capped', () => {
  const list = [{ url: 'javascript:alert(1)', title: 'bad' }, { url: 'https://a.example/x' }];
  for (let i = 0; i < 40; i += 1) list.push({ url: `https://s${i}.example/`, title: `S${i}` });
  const s = normalizeSettings({ shortcuts: list });
  assert.equal(s.shortcuts.length, MAX_SHORTCUTS);
  assert.deepEqual(s.shortcuts[0], { title: 'a.example', url: 'https://a.example/x' });
  assert.ok(s.shortcuts.every((item) => item.url.startsWith('https://')));
});

test('mobile sites are normalised hostnames without duplicates', () => {
  const s = normalizeSettings({ mobileSites: ['https://www.Example.com/path', 'example.com', 'not a host', 'localhost', 42] });
  assert.deepEqual(s.mobileSites, ['example.com', 'localhost']);
});

test('rail apps: missing list gives presets, an empty list stays empty, duplicates are dropped', () => {
  assert.deepEqual(normalizeSettings({}).apps.map((a) => a.title), ['ChatGPT', 'Gemini', 'Claude', 'Perplexity']);
  assert.deepEqual(normalizeSettings({ apps: [] }).apps, []);
  const s = normalizeSettings({ apps: [{ url: 'https://x.example/' }, { url: 'https://x.example/' }, { url: 'ftp://y' }] });
  assert.deepEqual(s.apps, [{ title: 'x.example', url: 'https://x.example/' }]);
  assert.equal(normalizeSettings({ railPosition: 'top' }).railPosition, 'right');
});

test('normalizeHostname rejects junk', () => {
  assert.equal(normalizeHostname(''), '');
  assert.equal(normalizeHostname('foo'), '');
  assert.equal(normalizeHostname('a..b'), '');
  assert.equal(normalizeHostname('-x.com'), '');
  assert.equal(normalizeHostname('m.youtube.com'), 'm.youtube.com');
});
