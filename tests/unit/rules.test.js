import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionRules, RULE_IDS } from '../../src/shared/rules.js';
import { normalizeSettings } from '../../src/shared/settings.js';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const build = (patch) => buildSessionRules(normalizeSettings(patch), 157, EXT);
const byId = (rules, id) => rules.find((rule) => rule.id === id);

test('every rule is limited to side-panel frames (no tab, sub_frame)', () => {
  const rules = build({ unlockFraming: true, mobileMode: 'all' });
  assert.equal(rules.length, 5);
  for (const rule of rules) {
    assert.deepEqual(rule.condition.tabIds, [-1]);
    assert.deepEqual(rule.condition.resourceTypes, ['sub_frame']);
  }
});

test('framing headers are removed only for panel loads or same-site navigations', () => {
  const rules = build({});
  for (const id of [RULE_IDS.panelLoadXfo, RULE_IDS.panelLoadCsp]) {
    assert.deepEqual(byId(rules, id).condition.initiatorDomains, [EXT]);
    assert.equal(byId(rules, id).condition.domainType, undefined);
  }
  for (const id of [RULE_IDS.sameSiteXfo, RULE_IDS.sameSiteCsp]) {
    assert.equal(byId(rules, id).condition.domainType, 'firstParty');
    assert.equal(byId(rules, id).condition.initiatorDomains, undefined);
  }
  // No header-removal rule may match every panel frame.
  for (const rule of rules.filter((r) => r.action.responseHeaders)) {
    assert.ok(rule.condition.initiatorDomains || rule.condition.domainType, `rule ${rule.id} is unscoped`);
  }
});

test('the extension id is required', () => {
  assert.throws(() => buildSessionRules(normalizeSettings({}), 157, ''), /extension id/);
});

test('framing unlock off produces no header-removal rules', () => {
  assert.deepEqual(build({ unlockFraming: false }), []);
});

test('CSP is removed only when it contains frame-ancestors', () => {
  for (const id of [RULE_IDS.panelLoadCsp, RULE_IDS.sameSiteCsp]) {
    assert.deepEqual(byId(build({}), id).condition.responseHeaders, [{ header: 'content-security-policy', values: ['*frame-ancestors*'] }]);
  }
});

test('mobile mode "sites" targets only the listed domains, and none when the list is empty', () => {
  const rule = build({ unlockFraming: false, mobileMode: 'sites', mobileSites: ['example.com'] })[0];
  assert.equal(rule.id, RULE_IDS.mobileUserAgent);
  assert.deepEqual(rule.condition.requestDomains, ['example.com']);
  assert.match(rule.action.requestHeaders[0].value, /Android.*Chrome\/157\.0\.0\.0 Mobile/);
  assert.deepEqual(build({ unlockFraming: false, mobileMode: 'sites', mobileSites: [] }), []);
});
