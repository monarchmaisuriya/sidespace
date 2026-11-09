# Gmail in the panel: the debugger route

- Date: 2026-11-10 01:30
- Status: decided: not shipped (M chose to remove the debugger route)
- Mode: explore options
- Repos: sidespace   Folders: src/background.js, src/panel/, manifest.json
- Question / problem: can Sidespace load sites whose service worker answers page loads with a frame-blocking header (Gmail), using `chrome.debugger`, and at what cost?

## Options: load service-worker-blocked sites in the panel without breaking trust or other sites

- **Bottom line:** `chrome.debugger` can switch the service worker off for one panel site frame, and Gmail-style pages then load from the network. It only works on a reload of an already-refused frame, it needs the `debugger` permission for every user (it cannot be optional), and Chrome shows a "debugging this browser" bar while attached. Recommended: an opt-in retry button on the existing "Page not showing?" hint, attaching only for that one reload.
- **Where we are:** experiments done in Chrome for Testing 155. 4 sources read. Real Gmail is not tested (it needs M's sign-in).
- **Need from M:** pick an option.

### The problem, framed

- **What:** Gmail's service worker serves its page with `X-Frame-Options: sameorigin`. Network rules cannot edit service-worker responses [verified: local reproduction, cases C and E].
- **Why:** M uses Gmail as a rail app.
- **Who:** anyone using a site whose service worker answers page loads (Gmail; others unknown).
- **When:** every full load of such a site in the panel.
- **Where:** the panel's site frames (the cross-site frames that hold websites).
- **Which:** Chrome DevTools Protocol through `chrome.debugger`: `Target.setAutoAttach` (flat sessions) and `Network.setBypassServiceWorker`.
- **How:** attach to the panel page, reach the site frame's own session, switch the service worker off there, reload, detach.
- **How much:** one new required permission, a background module, and the hint UI. Moderate risk, because the debugger API is powerful.

### What must be true

| Constraint | Status |
| --- | --- |
| The service worker can be bypassed per site frame | verified: V2 and V4 loaded "from network" |
| Setting it on the panel page alone is not enough | verified: V1 refused |
| A new tab's first load cannot be bypassed: the site frame only becomes reachable after its first load, and Chrome cannot hold it first (`waitingForDebugger=false`) | verified: V3 refused |
| The page stays after detaching | verified: V4 "after detach, still showing" |
| `debugger` cannot be an optional permission | verified: [permissions docs](https://developer.chrome.com/docs/extensions/reference/api/permissions) lists it among the exceptions |
| Install warnings: "Access the page debugger backend" and "Read and change all your data on all websites" | verified: [permissions list](https://developer.chrome.com/docs/extensions/reference/permissions-list). Sidespace already carries the second warning through `<all_urls>`. |
| A "debugging this browser" bar shows while attached | unverified in this run (headless). Widely reported ([UiPath](https://docs.uipath.com/studio-web/automation-cloud/latest/user-guide/debugging-banner-notification-after-extension-upgrade-to-manifest-v3), [Chromium change](https://chromium.googlesource.com/chromium/src/+/d73ce43f031b7e5acdc5c501d9c93e08a89307eb%5E%21)). Check: M sees it in Chrome 157. |
| Enterprise policy can block attaching | verified: [debugger docs](https://developer.chrome.com/docs/extensions/reference/api/debugger) (`runtime_blocked_hosts`). M's browser is managed, but DevTools works there. |
| Real Gmail loads with its worker bypassed, and stays usable after detach | unverified. Check: M on a build with the retry button. |

### Options

| | A: known limit | B: opt-in retry on the hint (recommended) | C: automatic retry | D: always attached |
| --- | --- | --- | --- | --- |
| How it works | README limit. "Open in a browser tab" as today. | The "Page not showing?" hint gains **Retry without the site's offline cache**. Click: attach, switch the worker off for that frame, reload, detach on load. | Same, started by Sidespace when the hint would show | Debugger attached while the panel is open; every site frame has its worker off |
| Warning bar | never | a second or two per retry | the same, but without the user asking | always, while the panel is open |
| Permission | none | `debugger` for every user | the same | the same |
| Other sites | unchanged | only the one frame, one reload | the same | all panel sites lose offline mode and speed |
| Full reloads of Gmail | n/a | refused again, then retry again | refused, then the retry runs on its own | work |
| Completeness | 5/10 | 8/10 | 8/10 | 6/10 |

RECOMMENDATION: B, because it reaches Gmail at the lowest standing cost. The warning bar and the debugger only appear when the user asks for them, for one reload.

### Sources

- [chrome.permissions: optional permission exceptions](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- [Permissions list: debugger warnings](https://developer.chrome.com/docs/extensions/reference/permissions-list)
- [chrome.debugger reference: flat sessions, auto-attach, policy](https://developer.chrome.com/docs/extensions/reference/api/debugger)
- [UiPath: debugging banner after the MV3 upgrade](https://docs.uipath.com/studio-web/automation-cloud/latest/user-guide/debugging-banner-notification-after-extension-upgrade-to-manifest-v3)
- [Chromium: Don't close infobar on first chrome.debugger.detach](https://chromium.googlesource.com/chromium/src/+/d73ce43f031b7e5acdc5c501d9c93e08a89307eb%5E%21)
- Local experiments: `scratchpad/shots/sw.mjs`, `dbg.mjs`, `dbg2.mjs` (not in the repo)

## Outcome

- M picked option B, and it was built and tested locally. A local site behaving like Gmail loaded, and the debugger was let go after the reload.
- On real Gmail (Chrome 157, signed in) the retry got past the service worker:
  - The first try showed a blank page at `mail.google.com/mail/mu/mp/791/#tl/Inbox`, and the 20-second load wait ran out.
  - The second try showed Google's own "Temporary Error: your account is temporarily unavailable" page.
- So Google's servers also refuse the inbox in this setting. Going further would be an arms race with Google's security checks, with some risk of the account being flagged.
- M chose to remove the debugger route. Gmail is listed as a known limit; Chrome's split view or "Open in a browser tab" is the way to keep Gmail beside a page.

## Standardized review

**Bottom line:** the recommendation follows from the experiments. One must-verify item is open: real Gmail in M's Chrome.

| Criterion | Verdict | Note |
| --- | --- | --- |
| Question answered | pass | Feasibility and cost are both established |
| Evidence graded | pass | Primary docs for the permission facts; local experiments for feasibility |
| Alternatives | pass | Four options, including doing nothing |
| Gaps named | pass | The bar's look and timing, and real Gmail |
| Fits our code | pass | Reuses the existing hint (`sidepanel.js` `renderHint`). Attaching belongs in the service worker, next to the network rules. |

Findings:

- **must-verify:** real Gmail with its worker bypassed.
- **note:** a required `debugger` permission adds an install warning and will draw Chrome Web Store review attention, if Sidespace is ever published there.
