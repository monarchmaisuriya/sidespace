import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addLink, moveLink, parseLinkUrl, removeLink, SPEED_DIAL, updateLink,
} from '../../src/shared/links.js';

const A = { title: 'A', url: 'https://a.example/' };
const B = { title: 'B', url: 'https://b.example/' };
const C = { title: 'C', url: 'https://c.example/' };

test('parseLinkUrl adds https and rejects what is not a web address', () => {
  assert.equal(parseLinkUrl(' example.com/x '), 'https://example.com/x');
  assert.equal(parseLinkUrl('http://localhost:3000'), 'http://localhost:3000/');
  assert.throws(() => parseLinkUrl(''), /Enter a web address/);
  assert.throws(() => parseLinkUrl('javascript:alert(1)'), /not a web address/);
  assert.throws(() => parseLinkUrl('chrome://settings'), /not a web address/);
  assert.throws(() => parseLinkUrl('hello'), /not a web address/);
  assert.equal(parseLinkUrl('http://intranet/wiki'), 'http://intranet/wiki');
  assert.throws(() => parseLinkUrl(`https://a.example/${'x'.repeat(2048)}`), /at most 2048 characters/);
});

test('addLink appends with a default title, and refuses duplicates and a full list', () => {
  assert.deepEqual(addLink([A], { title: '', url: 'www.d.example' }, SPEED_DIAL), [A, { title: 'd.example', url: 'https://www.d.example/' }]);
  const added = addLink([{ id: 'app-1', ...A }], { title: 'D', url: 'd.example' });
  assert.match(added[1].id, /^app-[a-z0-9]+$/);
  assert.notEqual(added[1].id, 'app-1');
  assert.throws(() => addLink([A], { title: 'A again', url: 'a.example' }), /already in the rail/);
  const full = Array.from({ length: 12 }, (_, i) => ({ title: `${i}`, url: `https://s${i}.example/` }));
  assert.throws(() => addLink(full, { title: 'x', url: 'x.example' }), /The rail holds at most 12/);
  assert.equal(addLink(full, { title: 'x', url: 'x.example' }, SPEED_DIAL).length, 13);
});

test('updateLink renames and changes the URL in place, and refuses a URL another link has', () => {
  assert.deepEqual(updateLink([A, B], B.url, { title: 'Bee', url: 'bee.example' }), [A, { title: 'Bee', url: 'https://bee.example/' }]);
  assert.deepEqual(updateLink([{ id: 'app-7', ...A }], A.url, { title: 'Kept id', url: 'z.example' }), [{ id: 'app-7', title: 'Kept id', url: 'https://z.example/' }]);
  assert.deepEqual(updateLink([A, B], A.url, { title: 'Same URL', url: A.url }), [{ title: 'Same URL', url: A.url }, B]);
  assert.throws(() => updateLink([A, B], A.url, { title: 'x', url: B.url }), /already in the rail/);
  assert.throws(() => updateLink([A], 'https://gone.example/', { title: 'x', url: 'y.example' }, SPEED_DIAL), /no longer in the speed dial/);
});

test('removeLink and moveLink work by URL; moves clamp to the list', () => {
  assert.deepEqual(removeLink([A, B, C], B.url), [A, C]);
  assert.deepEqual(moveLink([A, B, C], C.url, 0), [C, A, B]);
  assert.deepEqual(moveLink([A, B, C], A.url, 99), [B, C, A]);
  assert.throws(() => removeLink([A], B.url), /no longer in the rail/);
});

test('rail apps carry "open beside the page": set on add, changed or kept on edit, never on shortcuts', () => {
  assert.equal(addLink([], { title: 'Mail', url: 'mail.example', beside: true })[0].beside, true);
  assert.equal(addLink([], { title: 'Mail', url: 'mail.example' })[0].beside, false);
  assert.equal('beside' in addLink([], { title: 'S', url: 's.example', beside: true }, SPEED_DIAL)[0], false);
  const app = { id: 'app-1', title: 'Mail', url: 'https://mail.example/', beside: true };
  assert.equal(updateLink([app], app.url, { title: 'Mail', url: 'mail.example' })[0].beside, true);
  assert.equal(updateLink([app], app.url, { title: 'Mail', url: 'mail.example', beside: false })[0].beside, false);
});
