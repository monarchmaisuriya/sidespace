import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS, MAX_SHORTCUTS, looksLikeSettings, validHomeImage, normalizeHostname, normalizeSettings, searchTemplate,
} from '../../src/shared/settings.js';

test('missing or non-object input gives the defaults, versioned, with app ids', () => {
  for (const input of [undefined, 'nope']) {
    const { settingsVersion, apps, ...rest } = normalizeSettings(input);
    const { apps: defaultApps, ...defaultRest } = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    assert.deepEqual(rest, defaultRest);
    assert.equal(settingsVersion, 3);
    assert.deepEqual(apps.map(({ title, url }) => ({ title, url })), defaultApps);
    assert.ok(apps.every((app) => /^app-[a-z0-9]+$/.test(app.id)));
  }
});

test('app ids are the same on every read of settings without ids, unique, and kept once stored', () => {
  const legacy = { apps: [{ title: 'A', url: 'https://a.example/' }, { title: 'B', url: 'https://b.example/' }] };
  const first = normalizeSettings(legacy).apps;
  assert.deepEqual(normalizeSettings(legacy).apps, first);
  assert.notEqual(first[0].id, first[1].id);
  const edited = normalizeSettings({ apps: [{ ...first[0], url: 'https://elsewhere.example/' }] }).apps;
  assert.equal(edited[0].id, first[0].id);
  const clash = normalizeSettings({ apps: [{ id: 'app-x', title: 'A', url: 'https://a.example/' }, { id: 'app-x', title: 'B', url: 'https://b.example/' }] }).apps;
  assert.equal(clash[0].id, 'app-x');
  assert.notEqual(clash[1].id, 'app-x');
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
  assert.deepEqual(s.apps.map(({ title, url }) => ({ title, url })), [{ title: 'x.example', url: 'https://x.example/' }]);
  assert.equal(normalizeSettings({ railPosition: 'top' }).railPosition, 'right');
});

test('normalizeHostname rejects junk', () => {
  assert.equal(normalizeHostname(''), '');
  assert.equal(normalizeHostname('foo'), '');
  assert.equal(normalizeHostname('a..b'), '');
  assert.equal(normalizeHostname('-x.com'), '');
  assert.equal(normalizeHostname('m.youtube.com'), 'm.youtube.com');
});

test('a settings file is an object with at least one known setting', () => {
  assert.equal(looksLikeSettings({ theme: 'dark' }), true);
  assert.equal(looksLikeSettings({ theme: 'neon', extra: 1 }), true);
  assert.equal(looksLikeSettings({ name: 'pkg', version: '1.0.0' }), false);
  assert.equal(looksLikeSettings({}), false);
  assert.equal(looksLikeSettings([]), false);
  assert.equal(looksLikeSettings(null), false);
  assert.equal(looksLikeSettings(42), false);
});

test('accent: empty means the theme accent, the old fixed default migrates once, a colour is kept', () => {
  assert.equal(normalizeSettings({}).accent, '');
  assert.equal(normalizeSettings({ accent: '#6D5DFC' }).accent, '');
  assert.equal(normalizeSettings({ accent: '#6d5dfc', settingsVersion: 2 }).accent, '#6d5dfc');
  assert.equal(normalizeSettings({ accent: '#FFC799' }).accent, '#ffc799');
  assert.equal(normalizeSettings({ accent: 'red' }).accent, '');
});

test('clock format is auto, 12 or 24', () => {
  assert.equal(normalizeSettings({}).clockFormat, 'auto');
  assert.equal(normalizeSettings({ clockFormat: '12' }).clockFormat, '12');
  assert.equal(normalizeSettings({ clockFormat: 12 }).clockFormat, 'auto');
});

test('home sections: known ids once each, missing ones appended shown, order kept', () => {
  assert.deepEqual(normalizeSettings({}).homeSections, [
    { id: 'clock', show: true }, { id: 'date', show: true }, { id: 'search', show: true }, { id: 'shortcuts', show: true },
  ]);
  assert.deepEqual(normalizeSettings({ settingsVersion: 3, homeSections: [{ id: 'shortcuts', show: false }, { id: 'weather' }, { id: 'shortcuts' }, { id: 'clock', show: 'no' }] }).homeSections, [
    { id: 'shortcuts', show: false }, { id: 'clock', show: true }, { id: 'date', show: true }, { id: 'search', show: true },
  ]);
});

test('home sections: an old hidden clock hides the clock and date once; showClock is gone', () => {
  const migrated = normalizeSettings({ settingsVersion: 2, showClock: false });
  assert.deepEqual(migrated.homeSections.filter((section) => !section.show).map((section) => section.id), ['clock', 'date']);
  assert.equal('showClock' in migrated, false);
  const later = normalizeSettings({ settingsVersion: 3, showClock: false });
  assert.ok(later.homeSections.every((section) => section.show));
});

test('home background: theme, a colour, or an image; bad values fall back', () => {
  assert.deepEqual(normalizeSettings({}).homeBackground, { type: 'theme', colour: '#1c1c1c' });
  assert.deepEqual(normalizeSettings({ homeBackground: { type: 'colour', colour: '#ABCDEF' } }).homeBackground, { type: 'colour', colour: '#abcdef' });
  assert.deepEqual(normalizeSettings({ homeBackground: { type: 'video', colour: 'red' } }).homeBackground, { type: 'theme', colour: '#1c1c1c' });
  assert.equal(normalizeSettings({ homeBackground: { type: 'image' } }).homeBackground.type, 'image');
});

test('shortcut grid: columns, size and labels', () => {
  const defaults = normalizeSettings({});
  assert.deepEqual([defaults.shortcutColumns, defaults.shortcutSize, defaults.shortcutLabels], ['auto', 'small', true]);
  const set = normalizeSettings({ shortcutColumns: '6', shortcutSize: 'large', shortcutLabels: false });
  assert.deepEqual([set.shortcutColumns, set.shortcutSize, set.shortcutLabels], ['6', 'large', false]);
  assert.equal(normalizeSettings({ shortcutColumns: '9' }).shortcutColumns, 'auto');
});

test('home image: only a base64 webp, jpeg or png data URL is used', () => {
  assert.equal(validHomeImage('data:image/webp;base64,UklGRg=='), 'data:image/webp;base64,UklGRg==');
  assert.equal(validHomeImage('data:image/svg+xml;base64,PHN2Zz4='), '');
  assert.equal(validHomeImage('data:image/png;base64,AA") ; background: red'), '');
  assert.equal(validHomeImage('https://example.com/a.png'), '');
  assert.equal(validHomeImage(undefined), '');
});
