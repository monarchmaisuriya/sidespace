# Showing arbitrary web pages as tabs in Chrome's side panel

- Date: 2026-11-09 16:14
- Status: handed to plan
- Mode: find out
- Repos: sidespace (new)   Folders: whole repo
- Question / problem: What does a Manifest V3 extension need so that any web page can be opened, navigated and kept as tabs inside Chrome's side panel, and what limits apply?

## Research: How can an MV3 extension host arbitrary web pages as tabs in the Chrome side panel?

- **Bottom line:** Use an extension page as the side panel, with one `<iframe>` per panel tab. Make frames load by removing `X-Frame-Options` and CSP `frame-ancestors` headers with `declarativeNetRequest` session rules scoped to side-panel subframes. Track URLs and drive back/forward with a content script that runs only in frames whose parent is the panel. Confidence: high for the API surface (primary docs), medium for the runtime behaviours that no doc states (they are checked end to end in the build).
- **Where we are:** Feeds the plan for the first version. About 20 minutes of searching. Scope: Chrome side panel API, request header rules, content scripts in embedded frames, cookies.
- **Need from M:** nothing (M asked for the full chain).

### What I found

**Side panel API**

- The side panel is an extension HTML page declared with `side_panel.default_path` and the `sidePanel` permission. `setPanelBehavior({ openPanelOnActionClick: true })` makes the toolbar icon open it. [verified: primary, [sidePanel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)]
- `sidePanel.open()` exists from Chrome 116 and "may only be called in response to a user action" (toolbar click, shortcut, context menu, or a click in an extension page). [verified: primary, same page]
- `close()` is Chrome 141+, `onOpened` 141+, `onClosed` 142+. [verified: primary, same page]

**Embedding pages that refuse to be framed**

- Many sites send `X-Frame-Options: DENY/SAMEORIGIN` or CSP `frame-ancestors`. The usual MV3 fix is a `declarativeNetRequest` `modifyHeaders` rule that removes those response headers for `sub_frame` requests. [verified: tertiary, [chromium-extensions thread](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/HzEO5vnyocc), [Stack Overflow answer](https://coderapp.vercel.app/answer/74823389)]
- Scope matters. A rule with only `resourceTypes: ["sub_frame"]` would turn off clickjacking protection on every site the user visits. Two narrower conditions exist:
  - `tabIds: [-1]` matches requests "which don't originate from a tab"; session rules only. [verified: primary, [DNR API](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)]
  - `initiatorDomains: [<extension id>]` matches only the first load started by the extension page; a link clicked inside the frame has the frame's own origin as initiator, so it would not match. [verified: tertiary, chromium-extensions thread above] [inferred: initiator is the document that started the navigation]
- That side-panel subframes carry `tabId = -1` is not stated by any doc. [unverified: check by opening the real side panel in Chromium and loading a `X-Frame-Options: DENY` page with only the `tabIds: [-1]` rule active]
- `RuleCondition.responseHeaders` (Chrome 128+) can match on a header value with wildcards, so CSP is removed only when it contains `frame-ancestors`, instead of dropping every site's CSP. [verified: primary, DNR API page]
- `declarativeNetRequestWithHostAccess` avoids the "block content on any page" warning but needs host permissions for every action. [verified: primary, DNR API page]

**Content scripts in frames inside extension pages**

- `all_frames: true` makes a content script run in every matching frame. [verified: primary, [content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)]
- No official doc covers frames inside extension pages. A WebKit bug notes Chrome does run content scripts there while Safari does not; an Opera forum user reports the same in a side panel. [verified: tertiary, [WebKit bug 246619](https://bugs.webkit.org/show_bug.cgi?id=246619)] [unverified: confirm in the end-to-end test]

**Cookies and storage**

- Requests from extension pages are treated as same-site for cookies when the extension has host permissions for the site (since Chrome 79). [verified: primary, [SameSite FAQ](https://chromium.org/updates/same-site/faq)]
- An embedded site the extension has host permission for gets its top-level storage partition, so logins carry over from normal tabs. [verified: primary, [MV3 storage and cookies](https://3-72-0-dot-chrome-apps-doc.appspot.com/docs/extensions/mv3/storage-and-cookies/)]

### How it fits together

```
toolbar click / shortcut / context menu
        |
        v
side panel page (chrome-extension://<id>/sidepanel.html)
        |  one <iframe sandbox> per panel tab
        v
https://site.example  --response-->  DNR session rule (tabIds:[-1], sub_frame)
                                     removes X-Frame-Options, CSP with frame-ancestors   <-- makes framing work
        |
        v
content script (all_frames) -- exits unless parent is our panel
        |  reports URL + title, obeys back/forward
        v
panel updates address bar and tab strip
```

### What this means for our code

- New repo, no prior code. [verified: `gh repo view monarchmaisuriya/sidespace` reports `isEmpty: true`]
- Needs: `manifest.json` with `sidePanel`, `declarativeNetRequestWithHostAccess`, `storage`, `contextMenus`, `favicon`, host permission `<all_urls>`, `minimum_chrome_version` 128.
- Address-bar URL must come from a trusted source. A page inside the frame can `postMessage` anything to its parent, so the URL is taken from `sender.url` on `chrome.runtime` messages (set by the browser), and the `postMessage` only links that report to an iframe through a random token.

### Confidence and gaps

| Claim | Tag | Source tier | What would raise confidence |
| --- | --- | --- | --- |
| Side-panel subframes have `tabId = -1` | verified | e2e: `X-Frame-Options: DENY` page renders in the real side panel with only the `tabIds: [-1]` rule (Chrome for Testing 155) | done |
| Content scripts run in frames of extension pages in Chrome | verified | e2e: title and URL reports arrive from panel frames | done |
| `responseHeaders` condition works for `modifyHeaders` remove | verified | e2e: `frame-ancestors 'none'` page renders | done |
| Cookies first-party with host permission | verified (docs) | primary | Manual login test by M |
| `sender.url` updates after `history.pushState` | disproved | e2e probe: three reports after `pushState` all had `sender.url` = `/spa` | handled by a same-origin check on `location.href` |

### Sources

- [chrome.sidePanel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [chrome.declarativeNetRequest API](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)
- [Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [SameSite FAQ](https://chromium.org/updates/same-site/faq)
- [MV3 storage and cookies](https://3-72-0-dot-chrome-apps-doc.appspot.com/docs/extensions/mv3/storage-and-cookies/)
- [chromium-extensions: load site with X-Frame-Options in iframe](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/HzEO5vnyocc)
- [MV3 declarativeNetRequest and X-Frame-Options DENY](https://coderapp.vercel.app/answer/74823389)
- [WebKit bug 246619](https://bugs.webkit.org/show_bug.cgi?id=246619)

## Standardized review

- **Bottom line:** sound to build on; three runtime behaviours stay unverified and are turned into end-to-end checks rather than assumed.
- **Criterion coverage:** question framed; primary sources for every API claim; tertiary sources only for practice reports and labelled so; gaps table names the check for each unverified claim.
- **Findings:** must-verify - `tabId = -1` for side-panel frames is load-bearing for header stripping; the plan must test it in the real side panel, not only in a tab.
