# Open beside the page: Chrome split view from Sidespace

- Date: 2026-11-10 02:15
- Status: done
- Repos: sidespace   Folders: src/, tests/
- Files:
  - `src/panel/sidepanel.{html,js}`, `src/panel/app-dialog.js`
  - `src/shared/settings.js`, `src/options/options.{html,js}`
  - `tests/unit/settings.test.js`, `tests/e2e/split.spec.js` (new)
  - README.md, CHANGELOG.md, manifest.json (version 0.5.0)
- Subagents: none

## Context and problem

Gmail cannot be shown in the panel (`docs/2026-11-10-0130_gmail-service-worker-debugger_research.md`). M picked option B of `docs/2026-11-10-0205_gmail-access-alternatives_research.md`, "for any page": Sidespace opens pages beside the current page in Chrome's split view. Gemini is not allowed by M's admin, so option C is out.

## Goals / Non-goals

Goals:

- Any panel page can be opened beside the current browser page in one action.
- Any rail app can be set to always open beside the page instead of in the panel.
- A refused page offers this from the "Page not showing?" hint.

Non-goals:

- More than two tabs in a split.
- Managing splits after they are made (Chrome's own UI does that).
- Moving panel history into the split tab.

## What is true today

- **Open in browser tab** exists in three places: the menu command `open-in-browser` (`sidepanel.js:756`, menu button at `sidepanel.html:119`), the tab right-click menu (`sidepanel.js:672`), and the hint button (`sidepanel.js:963`). All three call `chrome.tabs.create({ url, windowId })` [verified].
- A rail app click calls `openApp` and opens or activates its panel tab (`sidepanel.js:181-185`) [verified].
- Rail apps are `{ id, title, url }`. `normalizeApps` builds them from `normalizeLinks` (title and url only) plus an id (`settings.js:187-195`) [verified]. `updateLink` keeps other fields by spreading the link (`links.js:47`) [verified].
- The app dialog edits title and url only (`app-dialog.js:16, 28-36`) [verified].
- `chrome.tabs.create({ url, splitWithTabId })` makes a split view in Chrome for Testing 158, with no permission (both tabs got `splitViewId` 1317355623) [verified: `scratchpad/shots/split.mjs`].
- Chrome's rules: the tabs must be adjacent, not already split, and share pinned, window and group state [verified: [Chrome blog](https://developer.chrome.com/blog/split-view-api-extensions)].
- What Chrome does with a pinned, grouped or already-split current tab when an extension calls `create` [unverified: experiment in part 1].

## Options considered

| | A: one "open beside" function every entry point calls (recommended) | B: each entry point calls `chrome.tabs.create` itself |
| --- | --- | --- |
| How it works | `openBeside(url)`: find the active browser tab of this window, reuse an existing split partner showing the same site, otherwise create the split, otherwise fall back to a normal tab with a reason | Copy the call into the menu, tab menu, hint and app click |
| Fallback | In one place | Four copies to keep in step |
| Completeness | 9/10 | 5/10 |

RECOMMENDATION: A, because the split rules and the fallback must behave the same everywhere.

## Decision

Option A. A per-app boolean `beside` (default `false`) stored with each rail app.

## Design

```
entry point (menu, tab menu, hint, app click with beside on)
   |
   v
openBeside(url)                                   <-- new, sidepanel.js
   |
   +-- active browser tab in this window (chrome.tabs.query)
   +-- its split partner already shows this site? --> activate the partner
   +-- chrome.tabs.create({ url, splitWithTabId }) --> split view
   +-- Chrome refuses --> chrome.tabs.create({ url, index: next to it })
                          and toast: "Opened next to this page: <Chrome's reason>"
```

- **Entry points:**
  - Panel menu: "Open beside this page", under "Open in browser tab".
  - Tab right-click menu: "Open beside the page".
  - Hint: an "Open beside this page" button.
  - Rail app right-click menu: a checkbox item "Always open beside the page", which toggles `beside`.
  - Rail app click: when `beside` is true, call `openBeside(app.url)`; the panel does not open a tab for it.
- **Settings:**
  - `normalizeApps` keeps `beside: true` only when it is exactly `true`; anything else becomes `false`.
  - Not a new settings version: a missing field means `false`.
  - The app dialog and the settings page rail editor get an "Open beside the page" checkbox.
- **Same site:** "the same site" means the same origin. Gmail at `/mail/u/0/#inbox` and the app address `https://mail.google.com/` count as the same.
- **Browser-only URLs** (`chrome://`): the same function works, since those are real tabs.
- **Version:** 0.5.0.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How noticed |
| --- | --- | --- | --- | --- |
| Chrome refuses the split for a pinned, grouped or already-split tab | medium | low | Fall back to a normal tab with Chrome's reason in a toast; experiment in part 1 decides the exact handling | e2e test for an already-split tab |
| The active tab is the window's only tab and it is a new-tab page | low | low | Splitting works with any tab | e2e |
| `splitWithTabId` is missing in Chrome before 155 | low (minimum is 128) | medium | Feature-detect `chrome.tabs.createSplit`; fall back to a normal tab and say split view needs Chrome 155 | unit-free; manual note in README |
| The rail app with `beside` on loses its panel tab | none | none | An existing panel tab stays until closed | none |

## Acceptance criteria

- **Menu:** given a browser tab is active and a panel page is open, when "Open beside this page" is chosen, then the page opens in a new tab split with the active tab, and both report the same `splitViewId`.
- **Rail app:** given a rail app with "Always open beside the page" on, when its rail icon is clicked, then it opens in split view and no panel tab is created. Clicking again while that split exists activates the existing tab and does not open another.
- **Fallback:** given the active tab is already split, when "Open beside this page" is chosen, then a normal tab opens next to it and a toast gives the reason.
- **Hint:** given the hint is showing, it offers "Open beside this page".
- **Settings:** `beside` survives reload, edit, move and import, and is `false` for anything not exactly `true`.

## Rollout and rollback

- Rollout: reload the unpacked extension; M checks Gmail beside a page in Chrome 157. Then commit, push and release 0.5.0, on M's go.
- Rollback: revert the commit. A stored `beside` field is ignored by 0.4.0.

## Parts

### Part 1: openBeside and its fallback

- [x] Experiment: pinned, grouped and already-split anchors in Chrome for Testing 158.
- [x] `openBeside` in the panel, with the menu and tab-menu entries. e2e: split made; already-split falls back with a reason.

### Part 2: per-app setting

- [x] `beside` in `normalizeApps` (unit tests).
- [x] Rail click, rail menu toggle, app dialog checkbox, settings editor checkbox. e2e for click (split, and no panel tab) and for activating the existing partner.

### Part 3: hint, docs, verify

- [x] Hint button. README, CHANGELOG, version 0.5.0. Full suite three times, plus 155, plus live.

## Standardized review

**Bottom line:** ready after M's sign-off. No blocking findings. One must-verify: Chrome's behaviour with pinned or grouped tabs, settled by the part 1 experiment.

| Principle | Verdict | Note |
| --- | --- | --- |
| Modularity and cohesion | pass | One function owns split creation and its fallback |
| Dependency direction | pass | Panel to Chrome API; settings stay pure |
| Single source of truth | pass | `beside` lives on the app record; one fallback path |
| Simplicity | pass | No split management UI; Chrome provides it |
| YAGNI | pass | Only the entry points M asked for ("any page") plus the app setting |
| Boundaries and contracts | pass | `beside` is validated in `normalizeApps`; Chrome's refusal surfaces as a reason |
| Composition | pass | Reuses `menuButton`, the hint, the app dialog and the editor rows |
| Fail-fast | pass | Refusals are shown, never silent; old Chrome detected explicitly |
| Comments | pass | One comment on Chrome's split rules at `openBeside` |

Findings:

- **must-verify:** split behaviour for pinned, grouped and already-split tabs (part 1 experiment).

## Changes made

- **Experiment:** Chrome gives a new split tab the anchor's pinned and group state itself. It refuses only an anchor that is already split ("Tab ID … is already in a split view").
- **Part 1:** `openBeside(url, sameAs)` in `sidepanel.js`, with the menu and tab-menu entries. A first version counted the current tab as "already showing" by site, and did nothing for another page on the same site. Fixed: rail apps match by site, the menu and hint by exact page, and the current tab counts only when it already shows it.
- **Part 2:** `beside` on rail app records (`settings.js` `normalizeApps`, `links.js` `addLink` and `updateLink`), plus the rail click, menu toggle, app dialog and settings page checkbox. Four e2e tests that compare stored app records now expect `beside: false`.
- **Part 3:** the hint button; README, CHANGELOG; version 0.5.0.
- **Verified:** 55 unit tests. 101 e2e tests, three runs on 158 and two on 155. 8 live sites. Mutant probes caught: the app ignoring `beside`, the app matching by page, the menu matching by site, and the hint without its handler.
- **One verification run failed under machine overload** (load average 32, Bitdefender and Paseo Daemon busy, the Mac asleep partway). All suites passed once the load was normal.

## Open questions

None.
