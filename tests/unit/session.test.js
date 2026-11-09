import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activateTab, addTab, canGo, closeTab, createSession, cycleTab, findAppTab, goHistory, MAX_HISTORY, MAX_TABS,
  moveTab, nextZoom, pushUrl, replaceUrl, restoreSession, updateTab,
} from '../../src/panel/session.js';

function withTabs(n) {
  let s = createSession();
  for (let i = 0; i < n; i += 1) s = addTab(s, { url: `https://t${i}.example/` }).session;
  return s;
}
const tab = (s, id) => s.tabs.find((t) => t.id === id);

test('new tabs open right after the active tab and become active', () => {
  let s = withTabs(3);
  s = activateTab(s, 't1');
  const { session, tab: added } = addTab(s, { url: 'https://new.example/' });
  assert.deepEqual(session.tabs.map((t) => t.id), ['t1', 't4', 't2', 't3']);
  assert.equal(session.activeId, added.id);
});

test('background tabs do not steal focus', () => {
  const s = addTab(withTabs(1), { url: 'https://bg.example/', activate: false }).session;
  assert.equal(s.activeId, 't1');
});

test('closing the active tab activates the right neighbour, then the left', () => {
  let s = activateTab(withTabs(3), 't2');
  s = closeTab(s, 't2');
  assert.equal(s.activeId, 't3');
  s = closeTab(s, 't3');
  assert.equal(s.activeId, 't1');
  s = closeTab(s, 't1');
  assert.equal(s.activeId, null);
  assert.equal(s.tabs.length, 0);
});

test('tab limit raises instead of dropping silently', () => {
  assert.throws(() => addTab(withTabs(MAX_TABS)), /at most 50/);
});

test('updateTab rejects non-http icons and unknown zoom, and never changes the URL', () => {
  let s = withTabs(1);
  s = updateTab(s, 't1', { url: 'https://evil.example/', icon: 'data:x', zoom: 3, title: 'T' });
  assert.equal(tab(s, 't1').url, 'https://t0.example/');
  assert.equal(tab(s, 't1').icon, '');
  assert.equal(tab(s, 't1').zoom, 1);
  assert.equal(tab(s, 't1').title, 'T');
});

test('history: push drops forward entries, back and forward move within one tab only', () => {
  let s = withTabs(2);
  s = pushUrl(s, 't1', 'https://a.example/2');
  s = pushUrl(s, 't1', 'https://a.example/3');
  s = pushUrl(s, 't2', 'https://b.example/2');
  s = goHistory(s, 't1', -1);
  assert.equal(tab(s, 't1').url, 'https://a.example/2');
  assert.equal(tab(s, 't2').url, 'https://b.example/2');
  assert.ok(canGo(tab(s, 't1'), 1));
  s = pushUrl(s, 't1', 'https://a.example/new');
  assert.deepEqual(tab(s, 't1').history, ['https://t0.example/', 'https://a.example/2', 'https://a.example/new']);
  assert.equal(canGo(tab(s, 't1'), 1), false);
  assert.equal(goHistory(s, 't1', 1), s);
});

test('history: pushing the current URL again adds nothing; replace rewrites the current entry', () => {
  let s = withTabs(1);
  s = pushUrl(s, 't1', 'https://t0.example/');
  assert.equal(tab(s, 't1').history.length, 1);
  s = replaceUrl(s, 't1', 'https://t0.example/after-redirect');
  assert.deepEqual(tab(s, 't1').history, ['https://t0.example/after-redirect']);
  assert.equal(tab(s, 't1').url, 'https://t0.example/after-redirect');
});

test('history: non-http URLs are ignored and length is capped', () => {
  let s = withTabs(1);
  s = pushUrl(s, 't1', 'javascript:alert(1)');
  assert.equal(tab(s, 't1').history.length, 1);
  for (let i = 0; i < MAX_HISTORY + 10; i += 1) s = pushUrl(s, 't1', `https://t0.example/${i}`);
  assert.equal(tab(s, 't1').history.length, MAX_HISTORY);
  assert.equal(tab(s, 't1').historyIndex, MAX_HISTORY - 1);
});

test('a speed dial tab starts with empty history', () => {
  let s = addTab(createSession(), { url: '' }).session;
  assert.equal(canGo(tab(s, 't1'), -1), false);
  s = pushUrl(s, 't1', 'https://x.example/');
  assert.deepEqual(tab(s, 't1').history, ['https://x.example/']);
});

test('rail apps find their own tab', () => {
  const s = addTab(withTabs(1), { url: 'https://chatgpt.com/c/1', app: 'https://chatgpt.com/' }).session;
  assert.equal(findAppTab(s, 'https://chatgpt.com/').id, 't2');
  assert.equal(findAppTab(s, 'https://claude.ai/'), null);
});

test('cycle wraps both ways and move clamps the index', () => {
  let s = withTabs(3);
  assert.equal(cycleTab(s, 1).activeId, 't1');
  assert.equal(cycleTab(activateTab(s, 't1'), -1).activeId, 't3');
  s = moveTab(s, 't1', 99);
  assert.deepEqual(s.tabs.map((t) => t.id), ['t2', 't3', 't1']);
});

test('zoom steps stay within the allowed levels', () => {
  assert.equal(nextZoom(1, 1), 1.1);
  assert.equal(nextZoom(1.5, 1), 1.5);
  assert.equal(nextZoom(0.5, -1), 0.5);
  assert.equal(nextZoom(1.25, 0), 1);
});

test('restore drops malformed tabs, keeps ids unique, repairs history, and continues numbering', () => {
  const s = restoreSession({
    activeId: 'zzz',
    tabs: [
      { id: 't3', url: 'https://a.example/2', zoom: 1.25, history: ['https://a.example/1', 'https://a.example/2'], historyIndex: 1 },
      { id: 't3', url: 'https://dup.example/' },
      { id: 'evil', url: 'https://b.example/' },
      null,
      { id: 't7', url: 'file:///etc/passwd', history: ['javascript:alert(1)'], historyIndex: 0 },
      { id: 't8', url: 'https://c.example/', history: ['https://other.example/'], historyIndex: 0 },
    ],
  });
  assert.deepEqual(s.tabs.map((t) => [t.id, t.url, t.zoom]), [['t3', 'https://a.example/2', 1.25], ['t7', '', 1], ['t8', 'https://c.example/', 1]]);
  assert.deepEqual(s.tabs[0].history, ['https://a.example/1', 'https://a.example/2']);
  assert.deepEqual(s.tabs[1].history, []);
  assert.deepEqual(s.tabs[2].history, ['https://c.example/']);
  assert.equal(s.activeId, 't3');
  assert.equal(s.nextId, 9);
  assert.deepEqual(restoreSession(null), createSession());
});
