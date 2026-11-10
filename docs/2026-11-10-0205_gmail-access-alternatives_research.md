# Gmail beside the page: alternatives to framing it in the panel

- Date: 2026-11-10 02:05
- Status: decided: option B, for any page (Gemini not allowed by the admin); plan at docs/2026-11-10-0215_open-beside-split-view_plan.md
- Mode: explore options
- Repos: sidespace   Folders: src/panel/, src/background.js
- Question / problem: how can M read and answer Gmail next to the page they are on, now that Gmail cannot be shown inside the panel?

## Options: Gmail next to the current page, with full Gmail where possible

- **Bottom line:** the best route is Chrome's own split view: real Gmail beside the page, in the same window. Chrome 155+ lets extensions open it (`chrome.tabs.create({ splitWithTabId })`, no permission needed), and that works in Chrome for Testing 158 [verified]. So Sidespace can make a rail app like Gmail open beside the page with one click. Gemini with its Gmail connection is a good companion for searching and summarising mail inside the panel, if M's Workspace admin allows it.
- **Where we are:** 7 routes checked, 10 sources read, 3 live experiments. Real Gmail in split view is not tested here (no Google login).
- **Need from M:** pick an option.

### The problem, framed

- **What:** Gmail cannot be framed. Its service worker answers with `X-Frame-Options`, and Google's servers refuse it when loaded past the worker (`docs/2026-11-10-0130_gmail-service-worker-debugger_research.md`).
- **Why:** M wants email next to the page they are working on.
- **Who:** M; any Sidespace user of Gmail.
- **Where:** a rail app click, or the "Page not showing?" hint.
- **How much:** from zero (use Chrome as is) to a large build (a Gmail API client).

### What must be true

| Constraint | Status |
| --- | --- |
| Gmail cannot be framed in the panel | verified (earlier research) |
| Chrome has a built-in split view for two tabs in one window | verified: [TechRadar](https://www.techradar.com/computing/chrome/split-view-tabs-in-chrome-are-a-game-changer-i-cant-believe-i-wasnt-using-this-before), [Chrome Story](https://chromestory.com/2025/11/split-view-google-chrome-tabs/) (Chrome 145+ per [Chrome's blog](https://developer.chrome.com/blog/split-view-api-extensions)) |
| Extensions can open a split view without any permission, from Chrome 155 | verified: [Chrome blog](https://developer.chrome.com/blog/split-view-api-extensions). Experiment: in Chrome for Testing 158 both tabs got the same `splitViewId` (1317355623). |
| Split rules: tabs adjacent, same window, same pinned and group state, not already split | verified: [Chrome blog](https://developer.chrome.com/blog/split-view-api-extensions) |
| Third-party Gmail web clients (Shortwave, Superhuman, Missive) work in the panel | **disproved**: they load in a fresh browser, but after one normal visit installs their service worker, the panel cannot show them (all three) [verified: experiments] |
| Gemini can search and summarise Gmail; a Workspace admin must enable it | verified: [Workspace Updates, May 2025](https://workspaceupdates.googleblog.com/2025/05/google-workspace-apps-are-now-generally-available-for-the-gemini-app.html). Whether M's admin enabled it: unverified (check: ask Gemini "@Gmail what did I get today"). |
| Gemini in Chrome's own side panel connects to Gmail | inferred from press coverage ([9to5Google](https://9to5google.com/2026/01/28/gemini-chrome-side-panel-more/), [Hashe](https://www.hashe.com/tech-news/gemini-in-chrome-gets-side-panel-ui-inline-gmail-compose-more/)). Official help not found. |
| Gmail's unread feed (`/mail/feed/atom`) exists, for Workspace accounts | verified: [Gmail inbox feed docs](https://developers.google.com/workspace/gmail/gmail_inbox_feed). Whether it works with M's browser sign-in and no OAuth: unverified (check: open the URL in a tab). |
| A personal or internal Gmail API app avoids Google's security review | verified: [restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification) (personal use and internal use are exempt, unless data is stored on servers) |

### Options

| | A: Chrome split view, by hand | B: Sidespace opens Gmail beside the page (recommended) | C: Gemini with Gmail | D: Sidespace unread list | E: Sidespace Gmail client (API) |
| --- | --- | --- | --- | --- | --- |
| How it works | Right-click the Gmail tab and choose split view | A rail app setting, "Open beside the page": clicking Gmail opens or focuses it in split view with the current tab. The "Page not showing?" hint gains "Open beside this page". | Ask Gemini (already a rail app) to find, summarise or draft mail | A panel view listing unread mail from Gmail's feed; clicking opens the mail beside the page (B) | Read, reply and archive in the panel through the Gmail API |
| Real Gmail? | yes | yes | no (answers about mail) | list only | Sidespace's own UI |
| Build | none | small: `chrome.tabs`, one app setting, one hint button, tests | none | medium | large: OAuth client, Google Cloud project, admin consent |
| Depends on | Chrome 145+ | Chrome 155+ (M: 157) | M's admin enabling Gemini for Gmail | Workspace account; feed works with browser sign-in | Admin allowing a custom OAuth app; ongoing API upkeep |
| When it fails | Never; it's manual each time | The current tab is pinned, grouped or already split (Chrome's rules); handled by grouping or with a reason shown | Admin off | Google retires the feed | Google policy or scope changes |
| Completeness | 7/10 | 9/10 | 6/10 | 6/10 | 8/10, at high cost |

Not recommended:
- **Third-party Gmail web clients:** they fail the same way once used (disproved above), and they get full mailbox access.
- **Gmail as an installed app window:** works, but it's a separate window; B gives the same Gmail inside the window.

RECOMMENDATION: B, because it gives real Gmail beside the page in one click, with no new permission and a small build that also helps any other site that cannot be framed.

### Flow of the recommended option

```
click Gmail in the rail (app set to "Open beside the page")
   |
   +-- a Gmail tab already in a split with the current tab? --> focus it
   |
   +-- otherwise --> chrome.tabs.create({ url, splitWithTabId: current tab })   <-- new
                        |
                        +-- Chrome refuses (pinned / grouped / already split)
                              --> open as a normal tab next to it, and say why
```

### Sources

- [Chrome blog: Tabs Split View API for extensions](https://developer.chrome.com/blog/split-view-api-extensions)
- [TechRadar: Split View tabs in Chrome](https://www.techradar.com/computing/chrome/split-view-tabs-in-chrome-are-a-game-changer-i-cant-believe-i-wasnt-using-this-before)
- [Chrome Story: How to use Split View](https://chromestory.com/2025/11/split-view-google-chrome-tabs/)
- [Google Workspace Updates: Workspace apps in the Gemini app](https://workspaceupdates.googleblog.com/2025/05/google-workspace-apps-are-now-generally-available-for-the-gemini-app.html)
- [9to5Google: Gemini in Chrome side panel](https://9to5google.com/2026/01/28/gemini-chrome-side-panel-more/)
- [Hashe: Gemini in Chrome side panel with Gmail](https://www.hashe.com/tech-news/gemini-in-chrome-gets-side-panel-ui-inline-gmail-compose-more/)
- [Gmail inbox feed](https://developers.google.com/workspace/gmail/gmail_inbox_feed)
- [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
- [Nylas: Google verification guide](https://developer.nylas.com/docs/dev-guide/provider-guides/google/google-verification-security-assessment-guide)
- Local experiments (not in the repo): `scratchpad/shots/clients.mjs`, `clients-fresh.mjs`, `split.mjs`

## Standardized review

**Bottom line:** the recommendation rests on a verified API, and one experiment ran on the same Chrome generation as M's. One must-verify: real Gmail in an extension-created split view.

| Criterion | Verdict | Note |
| --- | --- | --- |
| Question answered | pass | Seven routes, each with evidence |
| Evidence graded | pass | Primary docs for the APIs and policies; experiments for third-party clients and the split view; press coverage marked as such for Gemini in Chrome |
| Alternatives | pass | Five options plus two rejected, with reasons |
| Gaps named | pass | M's admin settings (Gemini, feed), and real Gmail in a split |
| Fits our code | pass | Rail apps already carry stable ids (`settings.js` `normalizeApps`); a per-app "open beside" flag is one field; the hint already has "Open in a browser tab" |

Findings:

- **must-verify:** real Gmail opening in an extension-created split view in M's Chrome 157.
- **note:** the failure of third-party clients is a general Sidespace limit: any site whose service worker sends a frame-blocking header breaks after its first visit. Option B's hint button is the general escape hatch for those too.
