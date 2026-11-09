// Runs in every frame, but does nothing unless this frame is a page shown
// directly inside the Sidespace panel. There it:
// - reports the page URL, title and icon (the panel only accepts a URL whose
//   origin matches the browser-provided sender.url),
// - hands cross-site navigations of this frame to the panel, which loads them
//   itself (see src/shared/rules.js for why that matters),
// - optionally opens new-window links as new panel tabs,
// - forwards panel keyboard shortcuts typed while the page has focus.
// Only real user input (event.isTrusted) can open tabs or trigger shortcuts.
(() => {
  const EXTENSION_ORIGIN = new URL(chrome.runtime.getURL('')).origin;
  const isPanelPage = window !== window.top
    && window.parent === window.top
    && location.ancestorOrigins?.[0] === EXTENSION_ORIGIN;
  if (!isPanelPage) return;

  const token = crypto.randomUUID();
  let openLinksInPanel = false;
  let lastReported = '';
  let reportTimer = 0;

  // Messages go to whichever panel is listening. When none is (the panel is
  // closing), there is nobody to tell, so the rejection is expected.
  function send(message) {
    if (!chrome.runtime?.id) {
      // The extension was reloaded or removed; this script is orphaned.
      clearInterval(reportTimer);
      return;
    }
    chrome.runtime.sendMessage({ ...message, token }).catch(() => {});
  }

  function iconUrl() {
    const link = document.querySelector('link[rel~="icon"][href], link[rel="apple-touch-icon"][href]');
    return link ? link.href : '';
  }

  function report() {
    // location is read in this isolated world, so page scripts cannot fake it.
    const state = { url: location.href, title: document.title, icon: iconUrl() };
    const key = `${state.url}\n${state.title}\n${state.icon}`;
    if (key === lastReported) return;
    lastReported = key;
    send({ type: 'sidespace:frame-state', ...state });
  }

  // Links this document to its iframe in the panel. The token travels both
  // here (proving which iframe) and in runtime messages (proving the URL).
  window.parent.postMessage({ type: 'sidespace:frame-hello', token }, EXTENSION_ORIGIN);
  report();
  document.addEventListener('DOMContentLoaded', report);
  window.addEventListener('load', report);
  window.addEventListener('popstate', report);
  window.addEventListener('hashchange', report);
  window.navigation?.addEventListener('navigatesuccess', report);
  // Catches title changes and history.pushState, which fire no event here.
  reportTimer = setInterval(report, 1000);

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || event.origin !== EXTENSION_ORIGIN) return;
    if (event.data?.type === 'sidespace:config') openLinksInPanel = event.data.openLinksInPanel === true;
  });

  // The panel unlocks framing headers only for loads it starts and for
  // same-site navigations. A plain GET to another site from inside this frame
  // is therefore cancelled here and loaded by the panel instead. POST forms and
  // reloads go ahead untouched.
  window.navigation?.addEventListener('navigate', (event) => {
    if (!event.cancelable || event.hashChange || event.downloadRequest !== null || event.formData) return;
    if (event.navigationType !== 'push' && event.navigationType !== 'replace') return;
    const destination = new URL(event.destination.url);
    if (!/^https?:$/.test(destination.protocol) || destination.origin === location.origin) return;
    event.preventDefault();
    send({ type: 'sidespace:navigate-request', url: destination.href });
  });

  function linkTarget(anchor) {
    return (anchor.target || document.querySelector('base[target]')?.target || '').toLowerCase();
  }

  const isNewWindowTarget = (target) => target !== '' && !['_self', '_parent', '_top'].includes(target);

  window.addEventListener('click', (event) => {
    if (!event.isTrusted || !openLinksInPanel || event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.composedPath().find((node) => node instanceof HTMLAnchorElement && node.href);
    if (!anchor || !isNewWindowTarget(linkTarget(anchor))) return;
    if (!/^https?:$/.test(new URL(anchor.href).protocol)) return;
    event.preventDefault();
    send({ type: 'sidespace:open-tab', url: anchor.href });
  });

  const SHORTCUT_CODES = new Set(['KeyL', 'KeyT', 'KeyW', 'KeyR', 'ArrowLeft', 'ArrowRight',
    'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9']);

  window.addEventListener('keydown', (event) => {
    if (!event.isTrusted || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!SHORTCUT_CODES.has(event.code)) return;
    // Option+letter types characters on macOS; leave editable fields alone.
    const target = event.composedPath()[0];
    if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    event.preventDefault();
    send({ type: 'sidespace:shortcut', code: event.code });
  }, true);
})();
