// Network rules for frames shown in the side panel.
//
// Framing headers are removed only for sub_frame requests outside browser tabs
// (tabId -1, where side-panel frames live) and only when one of these holds:
// - the panel page itself started the load (initiator is this extension), or
// - the request is same-site (eTLD+1) as the frame that started it.
// A page shown in the panel that embeds a different site therefore never gets
// that site's clickjacking protection removed. Frames inside normal web pages
// are never touched.

export const RULE_IDS = Object.freeze({
  panelLoadXfo: 1,
  panelLoadCsp: 2,
  sameSiteXfo: 3,
  sameSiteCsp: 4,
  mobileUserAgent: 5,
});

const NO_TAB = -1;
const PANEL_FRAMES = { tabIds: [NO_TAB], resourceTypes: ['sub_frame'] };
const REMOVE_XFO = {
  type: 'modifyHeaders',
  responseHeaders: [{ header: 'x-frame-options', operation: 'remove' }],
};
// CSP is removed only when it restricts framing, so other sites keep it.
const CSP_WITH_FRAME_ANCESTORS = [{ header: 'content-security-policy', values: ['*frame-ancestors*'] }];
const REMOVE_CSP = {
  type: 'modifyHeaders',
  responseHeaders: [{ header: 'content-security-policy', operation: 'remove' }],
};

export function mobileUserAgent(chromeMajor) {
  return `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Mobile Safari/537.36`;
}

export function buildSessionRules(settings, chromeMajor, extensionId) {
  if (!extensionId) throw new Error('buildSessionRules needs the extension id to scope panel loads');
  const rules = [];
  if (settings.unlockFraming) {
    const panelLoads = { ...PANEL_FRAMES, initiatorDomains: [extensionId] };
    const sameSite = { ...PANEL_FRAMES, domainType: 'firstParty' };
    rules.push(
      { id: RULE_IDS.panelLoadXfo, priority: 1, condition: panelLoads, action: REMOVE_XFO },
      { id: RULE_IDS.panelLoadCsp, priority: 1, condition: { ...panelLoads, responseHeaders: CSP_WITH_FRAME_ANCESTORS }, action: REMOVE_CSP },
      { id: RULE_IDS.sameSiteXfo, priority: 1, condition: sameSite, action: REMOVE_XFO },
      { id: RULE_IDS.sameSiteCsp, priority: 1, condition: { ...sameSite, responseHeaders: CSP_WITH_FRAME_ANCESTORS }, action: REMOVE_CSP },
    );
  }
  const mobileAll = settings.mobileMode === 'all';
  const mobileSome = settings.mobileMode === 'sites' && settings.mobileSites.length > 0;
  if (mobileAll || mobileSome) {
    rules.push({
      id: RULE_IDS.mobileUserAgent,
      priority: 1,
      condition: mobileAll ? { ...PANEL_FRAMES } : { ...PANEL_FRAMES, requestDomains: [...settings.mobileSites] },
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'user-agent', operation: 'set', value: mobileUserAgent(chromeMajor) },
          { header: 'sec-ch-ua-mobile', operation: 'set', value: '?1' },
          { header: 'sec-ch-ua-platform', operation: 'set', value: '"Android"' },
        ],
      },
    });
  }
  return rules;
}
