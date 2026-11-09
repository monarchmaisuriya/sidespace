import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textColourOn } from '../../src/shared/theme.js';

test('text on an accent is black on light colours and white on dark ones', () => {
  assert.equal(textColourOn('#ffc799'), '#000000');
  assert.equal(textColourOn('#ffffff'), '#000000');
  assert.equal(textColourOn('#b4561d'), '#ffffff');
  assert.equal(textColourOn('#101010'), '#ffffff');
});
