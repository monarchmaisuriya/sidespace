// Runs in the page's own JavaScript world (manifest "world": "MAIN"), only in
// frames shown directly inside the Sidespace panel. Calls to
// window.open(url, '_blank', 'noopener') are offered to the Sidespace bridge
// (frame-bridge.js) first, which may turn them into panel tabs.
//
// Only noopener/noreferrer calls are offered: for those the page has said it
// needs no link to the new window, and the browser returns null anyway, so
// the page cannot tell the difference. Every other call, such as a sign-in
// popup that talks back to its opener, goes to the real window.open.
//
// Page scripts can call this code or fire the event themselves; the bridge
// decides, and checks that the user is interacting with the page.
(() => {
  const isExtensionPageFrame = window !== window.top
    && window.parent === window.top
    && location.ancestorOrigins?.[0]?.startsWith('chrome-extension://');
  if (!isExtensionPageFrame) return;
  // This world cannot see the extension id. The bridge, which runs first and
  // only in Sidespace frames, answers this probe; other extensions' frames
  // keep the native window.open untouched.
  const probe = new CustomEvent('sidespace:window-open-probe', { cancelable: true });
  if (window.dispatchEvent(probe)) return;

  const nativeOpen = window.open;
  const SEPARATOR = /[\s=,]/;
  const WHITESPACE = /\s/;

  // The HTML spec's "tokenize the features argument".
  function tokenizeFeatures(features) {
    const tokens = new Map();
    let i = 0;
    while (i < features.length) {
      while (i < features.length && SEPARATOR.test(features[i])) i += 1;
      let name = '';
      while (i < features.length && !SEPARATOR.test(features[i])) name += features[i++];
      while (i < features.length && features[i] !== '=' && features[i] !== ',' && WHITESPACE.test(features[i])) i += 1;
      let value = '';
      if (i < features.length && SEPARATOR.test(features[i])) {
        while (i < features.length && SEPARATOR.test(features[i]) && features[i] !== ',') i += 1;
        while (i < features.length && !SEPARATOR.test(features[i])) value += features[i++];
      }
      if (name) tokens.set(name.toLowerCase(), value.toLowerCase());
    }
    return tokens;
  }

  // The spec's "parse a boolean feature": empty, yes and true are on;
  // otherwise the leading integer, with anything unparsable meaning 0.
  function featureIsOn(value) {
    if (value === '' || value === 'yes' || value === 'true') return true;
    const match = /^\s*([+-]?\d+)/.exec(value);
    return match !== null && Number(match[1]) !== 0;
  }

  function declaresNoOpener(features) {
    const tokens = tokenizeFeatures(String(features ?? ''));
    return ['noopener', 'noreferrer'].some((name) => tokens.has(name) && featureIsOn(tokens.get(name)));
  }

  window.open = function open(url, target, features) {
    const newWindow = target === undefined || target === '' || String(target).toLowerCase() === '_blank';
    const address = String(url ?? '');
    if (address !== '' && newWindow && declaresNoOpener(features)) {
      let resolved = null;
      try {
        // Same base as the native call: the document's base URL.
        resolved = new URL(address, document.baseURI).href;
      } catch {
        // Not a URL; the native call reports it the way the page expects.
      }
      // Event detail must be a string: objects do not cross into the
      // extension's isolated world.
      const offer = resolved && new CustomEvent('sidespace:window-open', { cancelable: true, detail: resolved });
      if (offer && !window.dispatchEvent(offer)) return null;
    }
    return Reflect.apply(nativeOpen, this, arguments);
  };
})();
