# Sidespace UI redesign and rail app editing

- Date: 2026-11-09 18:00
- Status: done (released as v0.3.0)
- Repos: sidespace   Files: `src/panel/*`, `src/options/*`, `src/shared/settings.js`, new `src/shared/apps.js`, `manifest.json`, tests, README, CHANGELOG
- Subagents: one independent reviewer after the build

## Context and problem

M loaded 0.2.0 in Chrome 157 (screenshot 2026-11-09 17:48). It works, including a signed-in Claude, but the UI is poor:

- **Tab strip:** five tabs shrink to one letter each ("N", "C") at panel width, and repeat what the rail shows.
- **Rail icons:** Gemini, Claude and Perplexity show coloured letters, because those sites refuse to serve icons cross-origin (`ERR_BLOCKED_BY_RESPONSE.NotSameOrigin`, seen in the 0.1 screenshots).
- **Address bar:** spends width on `https://`.
- **Settings page:** one long plain form; the accent is a raw colour picker.
- **Rail apps:** cannot be added by URL, renamed or edited; only pinned from the menu, removed or moved up.

## Research (short)

- Arc's sidebar splits favourites (icon only), pinned tabs and ordinary tabs into tiers and lists tabs vertically, because horizontal space is scarce and vertical space plentiful. [verified: tertiary, [Mozilla Connect thread](https://connect.mozilla.org/t5/discussions/vertical-tabs-close-the-gap-with-arc-s-sidebar-url-bound-pins/td-p/135309), [Arc design guide](https://blakecrosley.com/guides/design/arc)]
- Vivaldi lets users add any site as a web panel and edit those shortcuts; Opera lets users edit its sidebar. [verified: tertiary, [Vivaldi vs Opera](https://mspoweruser.com/vivaldi-vs-opera)]
- Chrome's side panel docs give no layout guidance. [verified: primary, [Create a side panel](https://developer.chrome.com/docs/extensions/develop/ui/create-a-side-panel)]
- Chrome's `_favicon` endpoint serves icons from the browser's own store (no network, no cross-origin block), but returns a generic globe for unknown sites. [verified: 0.1 screenshots showed globes] Comparing an icon's pixels with the globe returned for a made-up site tells the two apart. [unverified: checked in build]

## Decision

| Area | Change |
| --- | --- |
| Tabs | Remove the horizontal strip. Setting `tabLayout`: `rail` (default; open tabs listed in the rail under the apps) or `drawer` (rail shows apps only). A tabs button with a count in the toolbar opens a drawer with icons, full titles and close buttons in both modes. Replaces `tabStrip`. |
| Rail apps CRUD | Add (button at the end of the app list: dialog with name and URL, prefilled from the current page), edit (right-click or keyboard context key: Edit, Move up, Move down, Remove), drag to reorder. Settings page: editable list with add, inline edit, reorder, remove. All writes go through pure functions in `src/shared/apps.js` with readable errors. |
| Icons | Try the page's own icon (same origin), then Chrome's icon store (globe detected and skipped), then `/favicon.ico`, then a neutral letter tile. Needs the `favicon` permission back (no install warning). |
| Address bar | When not focused, show the URL without `https://` and `www.`; full URL on focus. |
| Visual | Tighter toolbar, 48 px rail with an active indicator, neutral letter tiles, accent swatches in settings, sectioned settings page with a side index. |
| Typography (M, 18:02: "the fonts are not consistent") | One type scale in `src/shared/theme.css`: `--font-ui`, `--font-mono`, sizes `--text-xs` 11 px to `--text-xl` 20 px, plus `--text-display` 40 px for the clock; every button, input, select and textarea inherits the page font; `code` and `kbd` use the mono family at `--text-sm`. No other file sets a font family or a pixel font size. |

Rejected: keeping the strip with wider minimum tabs (still unreadable beyond three tabs).

## Design notes

- Rail order: apps, (+ add app), divider, open non-app tabs (rail mode), + new tab, spacer, bookmarks, notes, settings.
- An app whose tab is open shows a small dot; the active one shows the accent bar.
- Editing an app's URL keeps its open tab tied to it.
- `apps.js`: `parseAppUrl`, `addApp`, `updateApp`, `removeApp`, `moveApp`; duplicates and the 12-app cap raise errors that the UI shows.
- Settings contract: `tabLayout` in `rail | drawer`, default `rail`; the old `tabStrip` key is ignored.

## Acceptance criteria

- Given several tabs, when the panel is narrow, then every tab is reachable with a readable title (rail tooltip or drawer).
- Given rail layout, then open tabs show in the rail and close from it; given drawer layout, then the rail shows only apps.
- Given the add-app dialog, when a name and `example.com` are saved, then a rail app opens `https://example.com/`; invalid or duplicate URLs show an error and save nothing.
- Given a rail app, when edited (name, URL), moved, dragged or removed (from the rail or the settings page), then the rail and storage reflect it.
- Given a site in Chrome's icon store, then its real icon shows; a generic globe never shows.
- Given an unfocused address bar on `https://www.example.com/a`, then it shows `example.com/a`.
- Given any page of the extension, then every text element uses one of the theme's two font families and a size from the theme scale (checked by an e2e test that reads computed styles).

## Parts

### Part 1: shared logic

- [x] `src/shared/apps.js` + unit tests; settings `tabLayout`.

### Part 2: panel

- [x] Rail with tabs and app CRUD, drawer, toolbar, address display, icons, styles.

### Part 3: settings page

- [x] Sectioned layout, accent swatches, editable rail apps and speed dial.

### Part 4: tests, review, docs

- [x] Update e2e for the new layout, add CRUD tests, screenshots, review, README and CHANGELOG.

## Standardized review

- **Bottom line:** ready; the one unverified idea (globe detection) has a fallback (origin icon, letter).
- **Findings:** note - removing the tab strip changes every e2e selector; tests are updated in Part 4 before anything is called done.

## Changes made

- Parts 1 to 4 built as planned, plus M's mid-build asks: consistent fonts (root cause: Chrome's own body font on extension pages, found by an e2e font audit) and the Vesper palette.
- Independent review: 10 defects (orphaned app tabs on edit elsewhere, stale settings editors, rail rebuilt on every title change, Enter on close, accent migration on every read, rail app role, concurrent overwrites, two validators, silent rail errors, hidden http://) and 5 test gaps; all fixed with tests and mutant probes.
- Flaky test diagnosed with five experiments: mouse clicks routed into the cross-process page frame were sometimes dropped by Chromium (3 of 20 never reached the page); in-page activation in tests now uses the keyboard. One misdiagnosed product change was reverted.
- Released as v0.3.0.

## Open questions

- None.
