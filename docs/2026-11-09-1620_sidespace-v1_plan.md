# Sidespace v1: web pages as tabs in Chrome's side panel

- Date: 2026-11-09 16:20
- Status: done (reviewed, fixed, pushed)
- Repos: sidespace   Folders: whole repo   Files: all new (`manifest.json`, `src/**`, `tests/**`, `package.json`, `README.md`, `.gitignore`, `icons/**`)
- Subagents: none

## Context and problem

Chrome's side panel only shows extension pages. M wants an extension that opens any website in the side panel, like a second browser beside the main page, with real tabs, navigation, and settings to customise it. Research: `docs/2026-11-09-1614_side-panel-web-tabs_research.md`.

## Goals / Non-goals

Goals:

- Open any http(s) site in the side panel, including sites that send `X-Frame-Options` or CSP `frame-ancestors`.
- Multiple panel tabs with a tab strip; back, forward, reload, home; address bar that accepts a URL or a search.
- Trustworthy address bar: the URL shown comes from the browser, not from the page.
- Ways in: toolbar icon, keyboard shortcut, context menu (link, page, selection), "load current browser tab here", and the reverse "open in browser tab".
- Customisation: theme (system, light, dark), accent colour, density, search engine (including a custom template), home page or speed dial, tab strip mode, session restore, framing unlock on or off, mobile mode (off, per site, all), where `target=_blank` links open, settings import and export.
- Per-tab zoom. Speed dial with user-managed shortcuts.

Non-goals (v1):

- Changing `navigator.userAgent` seen by page scripts (mobile mode changes only request headers).
- Chrome Web Store packaging, i18n, sync of open panel tabs across devices.
- `chrome://`, `file://`, and Web Store pages: Chrome does not allow them in frames; the panel offers "open in browser tab" instead.

## What is true today

- The repo is empty. [verified: `gh repo view monarchmaisuriya/sidespace --json isEmpty` -> `true`]
- Target browsers: M runs Chrome 157; tests run on Chrome for Testing 155. [verified: `--version` output]
- API facts and gaps come from the research file; the load-bearing unverified one is that side-panel frames have `tabId = -1`.

## Options considered

| Option | How it works | Tradeoffs | Fails when | Completeness |
| --- | --- | --- | --- | --- |
| A. iframe per tab + DNR session rules scoped by `tabIds: [-1]` (superseded after review: see Changes made) | Panel page hosts sandboxed iframes; rules strip framing headers only for frames outside tabs | Small, no build step; also affects frames inside other extensions' popups or side panels (not web pages) | side-panel frames do not have tabId -1 (tested end to end) | 9/10 |
| B. Same, scoped by `initiatorDomains: [extension id]` | Only the first load from the panel is unlocked | Narrowest scope | Any link click inside the frame that lands on a framing-protected site breaks | 5/10 |
| C. Global `sub_frame` header stripping | Strip headers for every frame everywhere | Simplest | Removes clickjacking protection from every site the user visits | 2/10 (rejected: security) |

RECOMMENDATION: A because it keeps navigation inside the panel working while never touching frames embedded in normal web pages.

## Decision

Option A. Plain JavaScript ES modules, no bundler, no runtime dependencies. Pure logic (URL parsing, settings normalisation, rule building, tab session model) lives in modules unit-tested with `node:test`; browser behaviour is tested end to end with Playwright in Chrome for Testing with the extension loaded.

## Design

```
                       +---------------------------+
 toolbar / Alt+Shift+S | background.js (service    |  context menu, commands
 ------------------->  | worker)                   | -----> sidePanel.open() then
                       |  - panel behaviour        |        inbox in storage.session
                       |  - DNR session rules  <---+-- settings change
                       +-------------+-------------+
                                     | rules (tabIds:[-1], sub_frame)
                                     v
 sidepanel.html  --- iframe sandbox ---> https://site   (X-Frame-Options removed,
   tab strip, address bar                               CSP removed only if it has frame-ancestors)
   session model (session.js)                 |
        ^   postMessage {token} (links frame) |  frame-bridge.js content script,
        |   runtime message {token,title} ----+  exits unless parent is our panel
        |   sender.url = trusted URL
```

Files:

- `manifest.json`: MV3, `minimum_chrome_version` 128 (needed for `responseHeaders` rule condition), permissions `sidePanel`, `storage`, `contextMenus`, `declarativeNetRequestWithHostAccess`, `favicon`, host permission `<all_urls>`.
- `src/background.js`: sets `openPanelOnActionClick`; rebuilds session rules on start and on settings change; context menus; command `open-current-tab-in-panel`; writes `{ windowId, url }` to an inbox in `storage.session` after calling `sidePanel.open()` inside the user gesture.
- `src/shared/settings.js`: defaults + `normalizeSettings()`; every unknown or invalid value falls back to its default.
- `src/shared/url.js`: `resolveInput(text, settings)` returns an http(s) URL or a search URL; `isEmbeddable(url)`.
- `src/shared/rules.js`: `buildSessionRules(settings, chromeMajor)` pure.
- `src/content/frame-bridge.js`: runs at `document_start` in all frames; returns immediately unless `window.parent === window.top` and `location.ancestorOrigins[0]` is our extension origin. Reports title and favicon; obeys back, forward, reload from the parent (checks `event.source === window.parent` and `event.origin`); optionally routes `target=_blank` clicks to a new panel tab.
- `src/panel/session.js`: pure tab model (add, close, activate, move, update, serialise, restore).
- `src/panel/sidepanel.{html,css,js}`: UI.
- `src/options/options.{html,css,js}`: settings page, import and export.

Settings contract (`storage.local`, key `settings`; not `storage.sync`, whose 8 KB per-item cap a long shortcut list would exceed):

| Key | Values | Default (safe) | Empty or invalid means |
| --- | --- | --- | --- |
| `theme` | system, light, dark | system | system |
| `accent` | `#rrggbb` | `#6d5dfc` | default |
| `density` | comfortable, compact | comfortable | comfortable |
| `searchEngine` | google, duckduckgo, bing, brave, custom | google | google |
| `customSearchUrl` | URL containing `%s`, http(s) | empty | custom falls back to google |
| `homePage` | http(s) URL or empty | empty | empty = speed dial |
| `tabStrip` | always, auto | auto | auto (hidden with one tab) |
| `restoreSession` | boolean | true | true |
| `unlockFraming` | boolean | true | true |
| `mobileMode` | off, sites, all | off | off |
| `mobileSites` | hostnames | [] | none |
| `newWindowLinks` | panel, browser | panel | panel |
| `shortcuts` | `[{ title, url }]` http(s) only, max 24 | [] | none |

Address-bar trust: the origin shown always comes from `sender.url` of runtime messages from our content script (set by the browser). Chrome does not update `sender.url` after `history.pushState` (verified in e2e), so the content script also reports `location.href`, and the panel uses it only when its origin equals the `sender.url` origin. A page can forge `postMessage` to the panel, but only to claim a token; without the matching runtime message, which page scripts cannot send, nothing changes.

Session: per window in `storage.session` (survives closing and reopening the panel), mirrored to `storage.local` for restore after a browser restart. Restored tabs load lazily (only the active one loads).

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | Noticed by |
| --- | --- | --- | --- | --- |
| Side-panel frames are not tabId -1 | low | core feature broken | End-to-end test in the real side panel | e2e `frames load in side panel` |
| Content scripts do not run in frames inside the panel | low | no URL sync, no back/forward | Panel falls back to iframe `src` tracking; e2e test | e2e `address bar follows navigation` |
| `sender.url` stale after `pushState` | medium | address bar lags in SPAs | e2e test; fall back to reporting on `navigatesuccess` | e2e `spa` |
| Removing CSP weakens a site's XSS protection inside the panel | medium | security | Only removed when it contains `frame-ancestors`; documented; user can turn unlock off | review |
| Rule also hits frames in other extensions' non-tab pages | low | those frames lose XFO | Documented; no web page can be the embedder there | review |
| Frame busting navigates the panel | low | panel replaced | iframe `sandbox` without `allow-top-navigation` | e2e |

## Acceptance criteria

- Given framing unlock on, when the user opens a site that sends `X-Frame-Options: DENY`, then it renders in the side panel.
- Given a site sends `frame-ancestors 'none'`, when opened, then it renders.
- Given framing unlock off, when the user opens the DENY site, then it does not render.
- Given a panel tab, when the user clicks a link or the page calls `pushState`, then the address bar shows the new URL.
- Given navigation history, when the user presses back then forward, then the frame goes back and forward.
- Given two panel tabs, when the panel is closed and reopened, then both tabs and the active one are restored.
- Given mobile mode for a site, when that site loads, then its request carries a mobile user agent.
- Given `newWindowLinks` = panel, when the user clicks a `target=_blank` link, then a new panel tab opens with that URL.
- Given an entry in the inbox for this window, when the panel is open, then a tab with that URL opens and the entry is removed.
- Given text that is not a URL, when entered in the address bar, then the configured search engine is used.

## Rollout and rollback

Load unpacked from the repo root (`chrome://extensions` -> Developer mode -> Load unpacked). Rollback: remove the extension; nothing persists outside the extension's storage.

## Parts

### Part 1: scaffold and pure modules

- [x] `manifest.json`, `package.json`, `.gitignore`, icons. Done: `node -e` parses manifest.
- [x] `settings.js`, `url.js`, `rules.js`, `session.js` with unit tests. Done: `npm test` green.

### Part 2: background and content script

- [x] `background.js`, `frame-bridge.js`. Done: e2e loads the extension with no service-worker errors.

### Part 3: panel UI and options page

- [x] Panel and options. Done: e2e acceptance criteria pass.

### Part 4: end-to-end tests, README

- [x] Playwright suite and README. Done: `npm run test:e2e` green.

## Standardized review

- **Bottom line:** ready to build; one must-verify (tabId -1 in the real side panel) is covered by a named e2e test.
- **Criterion coverage:** goals and non-goals explicit; every setting has a safe default; trust boundary for the address bar named; security tradeoffs of header removal stated with mitigation; each behaviour has an acceptance criterion.
- **Findings:** must-verify - rule scope depends on tabId -1; note - removing CSP is a real security tradeoff and stays user-switchable.

## Changes made

- Part 1: settings, URL, rules and tab-model modules with 27 unit tests; settings moved to `storage.local`.
- Part 2: service worker (rules, context menus, commands, rules-sync message) and frame bridge content script.
- Part 3: side panel UI and settings page; icons.
- Part 4: 13 Playwright tests driving the real side panel; README.
- Found in build: `sender.url` is stale after `pushState`; fixed by same-origin check on the reported URL (`trustedFrameUrl`).
- Verified in build: side-panel frames have `tabId -1`; content scripts run in panel frames.
- Independent review found 9 defects; all fixed with a regression test each:
  1. Rule scope let a panel page embed another site unprotected. Rules now match only panel-started loads (`initiatorDomains: [extension id]`) or same-site requests (`domainType: firstParty`); cross-site GET navigations inside a frame are rerouted through the panel by the content script (Navigation API). Mutant probe: old rule fails both nested-frame tests.
  2. Synthetic events could close or open tabs: `isTrusted` required; shortcuts and new tabs only from the visible tab.
  3. Page-supplied icon URLs were fetched from the extension origin: icons accepted only on the page's own origin.
  4. Token map eviction froze long-lived tabs: one live token per tab, removed on unlink.
  5. One failed rule update blocked all later ones: chain runs each update regardless; hostname validation tightened.
  6. Rules could be missing after a browser restart: `runtime.onStartup` listener and the panel waits for `sidespace:sync-rules` before loading pages.
  7. `history.back()` walked the panel's shared history: each tab now owns its history; back/forward load the URL from the panel.
  8. Session save lost changes and ignored the restore setting: flush on `pagehide`/hidden; `lastSession` written only with restore on, removed when turned off.
  9. `<base target>` links missed: handled; `window.open` documented as a limit.
  Also: `incognito: not_allowed`.
- M asked mid-build for Meomni-inspired features: app rail (presets ChatGPT, Gemini, Claude, Perplexity), bookmarks view (optional permission), dashboard clock and search, quick notes. Built with e2e tests.
- M asked to use `sidespace.png` as the logo: icons rendered from it; `favicon` permission removed (letter icons replace Chrome's generic globe).
- Found while checking screenshots: a new tab loaded its frame twice, showing a false "Page not showing?" hint. Fixed in the frame lifecycle; red-checked test added.
- Final: 36 unit tests, 28 end-to-end tests in the real side panel, all passing.

## Open questions

- Bookmarks view is tested only up to the permission prompt; Chrome's permission dialog cannot be clicked in automation. Needs a manual check by M.
- None blocking. Defaults chosen by me (accent colour, shortcut `Alt+Shift+S`, mobile mode off) are easy to change.
