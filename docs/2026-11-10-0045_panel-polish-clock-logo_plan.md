# Sidespace 0.4.0: Google apps in the panel, home page options, rail polish, new logo

- Date: 2026-11-10 00:45 (extended 01:05)
- Status: done (Gmail moved to known limits; see the 01:30 research note)
- Repos: sidespace   Folders: src/, icons/, tests/
- Files:
  - `src/shared/{rules,settings}.js`
  - `src/panel/{session.js,sidepanel.html,sidepanel.css,sidepanel.js}`
  - `src/options/options.{html,css,js}`
  - `icons/icon-{16,32,48,128}.png`, `sidespace.png` (already replaced by M)
  - tests, README.md, CHANGELOG.md, manifest.json (version)
- Subagents: none

## Context and problem

M installed 0.3.0 and reported:

1. Google Calendar shows Google's 403 page in the panel, and Gmail shows "mail.google.com refused to connect". Both are rail apps.
2. The rail's padding is off, and a blank tab adds a third plus sign to the rail.
3. A close option shows even when only one tab is open.
4. The clock needs a 12 or 24-hour choice.
5. The settings icon looks like a sun.
6. The new logo (`sidespace.png`, "S|·") should be used everywhere.
7. The home page should be more customisable.

M's answers so far:

- Home page options: show, hide and reorder the parts; background; shortcut grid look.
- Clock: Auto, 12-hour or 24-hour.
- Diagnose the Google apps first.
- Fix the rail spacing and give a blank tab its own icon.

## Goals / Non-goals

Goals:

- Google apps that check how they are loaded work in the panel, under the existing "Show them anyway" setting.
- One spacing rule for the rail.
- No way to close the last tab.
- A clock format setting.
- A gear icon for settings.
- The new logo everywhere.
- The new home page options.

Non-goals:

- Weather, quotes and greetings (M left these out).
- Signing in to Google for M. Tests use no real accounts.
- Any change for pages in normal browser tabs.

## What is true today

### Google apps (diagnosis)

Calendar reproduced in Chrome for Testing 155, not signed in [verified: `scratchpad/shots/google.mjs`]:

- The panel frame requests `https://calendar.google.com/calendar/u/0/r` with `Sec-Fetch-Dest: iframe`, and Google answers `403`.
- Discriminating experiment: the same URL with curl, changing only the `Sec-Fetch-Dest` header [verified]:
  - `iframe` gave 403, whether `Sec-Fetch-Site` was `cross-site` or `none`.
  - `document` gave 302 to `accounts.google.com/ServiceLogin`.
- Fix experiment: a temporary session rule set `Sec-Fetch-Dest: document` for panel-initiated frames. Calendar then redirected to Google sign-in, which loaded with 200 (it returned 401 without the rule) [verified: `scratchpad/shots/dest.mjs`]. So Chrome lets an extension's network rules rewrite this header.
- Mechanism: browsers attach `Sec-Fetch-Dest` to every request to say what it is for. Google uses it as a third anti-framing check, besides the `X-Frame-Options` and CSP `frame-ancestors` headers Sidespace already removes [verified: `src/shared/rules.js:38-48`].

Gmail, not signed in, goes to Google's sign-in page, which answers 401 inside a frame [verified]. M's signed-in "refused to connect" could not be reproduced without a Google login [unverified: M reloads Gmail after this change]. The leading theory is the same `Sec-Fetch-Dest` check in another form [inferred: same company and the same framing check family; Calendar's sign-in page changed from 401 to 200 with the rewrite].

### Rail, last-tab close, clock, settings icon, logo

- **Rail geometry**, measured at 360 px [verified: `scratchpad/shots/measure.mjs`]:
  - The × hangs 2 px outside the tab button (`top/right: -2px`).
  - The active bar at `right: -6px` overlaps the rail's 1 px border.
  - The first rail button's centre is 3 px below the toolbar buttons' centre.
  - Item gaps are 2 px, but 8 px around the divider (`sidepanel.css:94-168`).
- **Blank tab icon:** a blank tab's rail icon is the letter tile "+", next to the "Add an app" plus and the "New tab" plus [verified: M's screenshot and `measure.mjs` render].
- **Last-tab close:** closing the last tab silently opens a new home tab (`sidepanel.js:137-141`). Five ways to close exist: `:376`, `:406`, `:639`, `:721`/`:740` and `:832-834`. The model has no last-tab rule (`session.js:82-92`). Startup already adds a home tab to an empty session (`sidepanel.js:1004`).
- **Clock:** `toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })` follows Chrome's language (`sidepanel.js:435-439`).
- **Settings icon:** a circle with eight short rays, a sun (`sidepanel.html:30`).
- **Logo:**
  - The new `sidespace.png` is 500 × 500 with a transparent background, and the tile spans pixels 50 to 449 [verified: canvas alpha scan].
  - The icons are still the old logo.
  - Chrome shows them on the toolbar, on `chrome://extensions` and in the side panel header. The settings page top bar uses `icon-48.png` (`options.html:12`).

### Home page

The home page shows, in fixed order: clock and date (one toggle, `showClock`), search, shortcut tiles, the empty-list text and the add-shortcut form (`sidepanel.html:65-80`). There is no background setting. Settings are versioned (`SETTINGS_VERSION = 2`, `settings.js:9`) with per-field migration (`normalizeAccent`, `:90`).

## Options considered

### Google's frame check

| | A: rewrite `Sec-Fetch-Dest` with the existing scope (recommended) | B: only for loads the panel starts | C: per-site list |
| --- | --- | --- | --- |
| How it works | Two new rules mirror the existing header-removal scope: panel-started loads, plus same-site navigations inside them | Only the first rule | Rewrite only for hosts M lists |
| Covers | First load, the sign-in redirect chain, and later full navigations inside Calendar or Gmail | The first load only. Sign-in finishing navigates from `accounts.google.com`, which would hit 403 again [inferred: the same-site initiator is not the extension]. | Only what M thinks to list |
| Side effect | Same-site nested frames inside a panel page (Google's own helper frames, for example `accounts.google.com/_/bscframe`) are also reported as documents. The existing rules already treat them alike [verified: rules 3 and 4 use the same scope]. | Fewer side effects | More settings for the user to maintain |
| Completeness | 9/10 | 6/10 | 5/10 |

RECOMMENDATION: A, because it is the same trust boundary Sidespace already uses for the framing headers, and B breaks sign-in.

### Rail spacing

A: shared size tokens define the rail's grid (recommended, 9/10), versus B: nudging the four offsets (5/10). Tokens hold for both densities and both rail sides.

### Last-tab close

A: a `canCloseTab` rule in the tab model that every close path asks (recommended, 9/10), versus B: hiding the × with CSS (4/10; Alt+W, middle-click and the menu would still close).

### Home page parts storage

| | A: one ordered list setting (recommended) | B: one flag per part plus an order string |
| --- | --- | --- |
| Shape | `homeSections: [{ id, show }]`, ids `clock`, `date`, `search`, `shortcuts` | `showDate`, `showSearch`, and so on, plus `homeOrder` |
| Validation | One normaliser: known ids, no duplicates, missing ids appended in default order | Several fields that can disagree |
| Completeness | 9/10 | 7/10 |

RECOMMENDATION: A, because order and visibility belong to the same thing.

## Decision

Option A everywhere. Version 0.4.0 (new features, per semver).

## Design

### Google frame check (`src/shared/rules.js`)

- New rule ids: `panelLoadFetchDest: 6` and `sameSiteFetchDest: 7`.
- Action: `{ type: 'modifyHeaders', requestHeaders: [{ header: 'sec-fetch-dest', operation: 'set', value: 'document' }] }`.
- Conditions: the existing `panelLoads` and `sameSite` scopes.
- Gated by `unlockFraming`, like rules 1 to 4.
- The file header comment and README "How embedding works" gain one line: the panel also tells same-scope sites they are being loaded as a page, because some sites (Google) refuse frame requests.

### Rail (`sidepanel.css`)

- `--rail-button: calc(var(--control) + 6px)` and `--rail-gutter: 7px`.
- Rail width: `calc(var(--rail-button) + 2 * var(--rail-gutter) + 2px)`.
- Active bar: `right: calc(2px - var(--rail-gutter))`, mirrored on the left.
- `.rail-close`: 14 px, inside the button at `top: 2px; right: 2px`.
- Rail `padding-top: calc(var(--gap) - 3px)` centres the first button on the toolbar row.
- One 4 px gap between rail items, and the divider margin is the same 4 px.
- **Blank tab icon:** a blank tab (no URL) shows a "home" glyph, not the letter tile.

### Last tab

- `session.js`: `canCloseTab(session) = tabs.length > 1`, and `closeTab` returns the session unchanged when it is false.
- The panel hides the × in the rail and the tab list, and disables "Close tab". Alt+W and middle-click go through `closeTab`, so they become no-ops.
- The unreachable "re-add home tab" branch in the panel's `closeTab` is removed.

### Clock

- `clockFormat: 'auto' | '12' | '24'`, default `auto`.
- `renderClock` passes `hourCycle: 'h12'` or `'h23'`, or leaves it out for auto.

### Home page

- `homeSections`: default `[clock, date, search, shortcuts]`, all shown.
- **Migration to settings version 3:** a stored `showClock: false` becomes clock and date hidden, and `showClock` is removed. Importing an old backup file runs the same migration.
- `homeBackground`:
  - `{ type: 'theme' | 'colour' | 'image', colour: '#rrggbb' }`.
  - **Image:**
    - The user picks a file on the settings page. It is downscaled on a canvas to at most 2560 px on the long side, saved as WebP at quality 0.85, and stored in `storage.local` under its own key `homeImage`. It is not part of `settings`, so settings stay small and the export file does not carry megabytes.
    - Files above 8 MB, or that fail to decode, are refused with a message.
    - Over an image, the clock and date get a soft shadow, and the search box and tiles a translucent surface, so they stay readable.
- Shortcut grid: `shortcutColumns: 'auto' | '4' | '5' | '6'`, `shortcutSize: 'small' | 'large'`, `shortcutLabels: true | false`.
- Settings page: a new **Home page** section, with the clock checkbox moved into it:
  - a parts list with a show checkbox and move up/down buttons, the same pattern as the link editors
  - the clock format select
  - the background choice with a colour picker or image picker, and a "Remove image" button
  - the three grid controls
- The panel renders the parts in the stored order. The add-shortcut form stays with the shortcuts.

### Settings icon and logo

- Gear outline in the existing 24 × 24 stroke style.
- The four icons are re-rendered from the new logo, cropping 42 to 458, with step-halving downscale (the same method as before).

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How noticed |
| --- | --- | --- | --- | --- |
| Gmail fails for a different reason | medium | medium | Ask M to reload Gmail on this build before release. If it still fails, a DevTools capture from the panel gives the failing response. | M's check |
| Reporting `document` lets a site skip its own defence against being framed | certain, by design | Same class as removing X-Frame-Options, which the setting already does | Same scope and same user setting. README states it. | Review |
| Google helper frames behave differently when reported as documents | low | low | They loaded with 200 in the experiment | Live test |
| A big image fills `storage.local` (10 MB quota) | low | medium | Downscale, an 8 MB input cap and one image only | Error message on save |
| A wider rail (48 to 52 px) | certain | low | Panels are at least 320 px wide | e2e at 360 px |
| Migration loses `showClock: false` | low | low | Unit test for version 2 to 3 | Unit test |

## Acceptance criteria

- **Google check:** given "Show them anyway" on, when the panel loads `calendar.google.com/calendar/u/0/r`, then the request carries `Sec-Fetch-Dest: document` and the response is not 403. With the setting off, the header is `iframe`. Pages in normal tabs are unchanged.
- **Rail:** given either rail side and either density, the active bar and the hover × lie inside the rail's inner box, and the first rail button's centre is within 1 px of the toolbar buttons' centre.
- **Blank tab icon:** a blank tab shows the home glyph in the rail.
- **Last tab:** given one tab, there is no ×, "Close tab" is disabled, and Alt+W and middle-click leave it open. Given two tabs, closing works.
- **Clock:** with a frozen clock at 00:35, `12` shows 12:35 AM in Chrome's language format and `24` shows 00:35.
- **Home parts:** hiding and reordering in settings change the home page at once. Old settings with `showClock: false` hide the clock and date.
- **Background:** a colour or an image shows behind the home page, and "Remove image" deletes the stored image.
- **Grid:** columns, size and labels change the tiles.
- **Icons:** the settings button is a gear. After a reload, the toolbar, `chrome://extensions`, the side panel header and the settings page show the new logo.

## Rollout and rollback

- Rollout: reload the unpacked extension. M checks Gmail and Calendar signed in. Then commit, push, and release 0.4.0 (on M's go).
- Rollback: revert the commit. Settings version 3 data stays readable by 0.3.0, because unknown keys are ignored. A hidden clock would show again.

## Parts

### Part 1: Google frame check

- [x] Rules 6 and 7 with unit tests (red, then green).
- [x] An e2e test against the local test server: a fixture route echoes `Sec-Fetch-Dest`. It reads `document` in the panel and `iframe` with the setting off.
- [x] A live test adds `calendar.google.com/calendar/u/0/r`, expecting no 403.

### Part 2: model and settings

- [x] `canCloseTab` and the last-tab rule.
- [x] `clockFormat`, `homeSections`, `homeBackground` and the grid settings, with the version 3 migration. Unit tests for each.

### Part 3: panel

- [x] Rail tokens, the blank-tab glyph and the gear icon.
- [x] Close paths read `canCloseTab`.
- [x] The home page renders parts in order, the background, the grid options and the clock format. e2e tests for each.

### Part 4: settings page

- [x] The Home page section: parts list, clock format, background with image upload and removal, and grid controls. e2e tests.

### Part 5: logo, docs, verify

- [x] Re-render the icons and view them.
- [x] README, CHANGELOG, and the manifest version set to 0.4.0.
- [x] The full suite (unit, e2e three runs, live), plus a screenshot pass of the panel and the settings page.

## Standardized review

**Bottom line:** ready to build after M's go. No blocking findings. Two must-verify items, both checked by M in M's own Chrome.

| Principle | Verdict | Note |
| --- | --- | --- |
| Modularity and cohesion | pass | Network rules stay in `rules.js`, the tab rule in `session.js`, home settings in `settings.js`, the image in its own storage key. |
| Dependency direction | pass | The panel and settings page depend on shared modules, never the reverse. |
| Single source of truth | pass | One scope for all frame-unlocking rules. One `canCloseTab`. One `homeSections` list. Rail geometry from two tokens. |
| Simplicity | pass | Each setting maps to one render decision. No layout engine. |
| YAGNI | pass | Only the options M picked. Weather and quotes are out. |
| Boundaries and contracts | pass | Every new setting is validated where settings load. Image size and type are checked at upload, with a message. |
| Composition | pass | Reuses the link-editor row pattern, `pickChoice`, the earlier icon script and the rule scopes. |
| Fail-fast | pass | A bad image is refused with a reason, never stored half-processed. |
| Comments | pass | One comment each for the `Sec-Fetch-Dest` rule and the rail token arithmetic. |

Findings:

- **must-verify, Gmail signed in:** not reproducible here. M reloads Gmail on the build before release.
- **must-verify, framing defence:** reporting `document` overrides a site's own check. It is the same trade the setting already makes; M confirms it is acceptable.
- **note, plan size:** five parts. Part 1 is independent and can ship first if M wants Calendar sooner.

## Changes made

- Part 1: rules 6 and 7 set `Sec-Fetch-Dest: document` (`src/shared/rules.js`). The unit test, the e2e echo test (seen red without the rules) and the Calendar live test pass.
- Part 2: `canCloseTab` and the last-tab rule in `session.js`, plus `clockFormat`, `homeSections` (version 3 migration from `showClock`), `homeBackground`, the grid settings and `validHomeImage` in `settings.js`.
- Part 3: rail tokens, the × inside the button, the home glyph for blank tabs (in `favicon.js`), the gear icon, the home layout and the clock format. The panel drops a tab's frame only after the model closes it.
- Part 4: the New tab page section on the settings page (parts list, clock, background, picture upload with 8 MB cap, WebP at most 2560 px, grid).
- Part 5: icons re-rendered from the new logo. README, CHANGELOG, and version 0.4.0 in the manifest, package and lockfile.
- Verified: 53 unit tests. 93 e2e tests three times on the default Chromium and once on Chrome for Testing 155. 8 live sites. Mutant probes killed for the last-tab rule, rail spacing, clock format, part order, labels, image shrink, image type check and image validation.

## Open questions

In the chat briefing.
