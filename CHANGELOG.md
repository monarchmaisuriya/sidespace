# Changelog

All notable changes to Sidespace. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [0.5.0] - 2026-11-10

### Added

- **Open beside the page**: opens a panel page in Chrome's split view next to the current browser tab, from the panel menu, a tab's right-click menu, or the "Page not showing?" hint. Uses the Tabs Split View API (Chrome 155+); no new permission.
- Rail apps can be set to **Always open beside the page** (right-click menu, edit dialog, settings page). Clicking such an app opens it in split view instead of in the panel, or brings its tab forward when that split already shows the app's site. This is the way to keep Gmail, which refuses the panel, next to your page.
- When Chrome refuses a split (the current tab is already split with another site), the page opens as a normal tab next to it, with Chrome's reason in a message.

### Tested on

- Chrome for Testing 155.0.8059.12 and 158.0.8127.18: 55 unit tests, 101 end-to-end tests (three runs in a row on 158), 8 live sites.

## [0.4.0] - 2026-11-10

### Fixed

- Google Calendar showed Google's 403 page in the panel. Google refuses any request marked as loading a frame (`Sec-Fetch-Dest: iframe`), whatever its other headers. With **Show them anyway** on, panel pages are now requested as pages, with the same scope as the header removal (loads the panel starts, and same-site navigations inside them). Google's sign-in page now loads in the panel too.
- The rail's close button hung outside the tab button and its active bar sat on the rail's border; the first rail button sat 3 px below the toolbar. The rail now follows one spacing grid in both densities and on both sides.
- The last tab showed a close button (closing it only replaced it with a blank tab). The last tab now cannot be closed from any button, menu or shortcut.
- The settings button showed a sun; it is now a gear.

### Known limits

- Gmail still cannot be shown in the panel: its service worker answers page loads with `X-Frame-Options`, which extensions cannot change, and Google's servers refuse it when loaded past the worker. Use **Open in a browser tab** or Chrome's split view. Details: `docs/2026-11-10-0130_gmail-service-worker-debugger_research.md`.

### Added

- New tab page options (settings page, **New tab page**): show, hide and reorder the clock, date, search box and shortcuts; a background of the theme, a colour, or a picture (shrunk and kept on this device, not in the settings export); shortcut columns, icon size, and names on or off.
- Clock format: Auto (Chrome's language), 12-hour or 24-hour.
- A blank tab shows a home icon in the rail instead of a "+".

### Changed

- The new logo is used for the toolbar, `chrome://extensions`, the side panel header and the settings page.
- Settings version 3: the "Show clock and date" checkbox became the clock and date entries of the parts list; a hidden clock stays hidden.

### Tested on

- Chrome for Testing 155.0.8059.12 and 158.0.8127.18: 53 unit tests, 93 end-to-end tests (three runs in a row on 158), 8 live sites including Google Calendar. Calendar and the Google sign-in page checked by M in Chrome 157.

## [0.3.0] - 2026-11-09

### Changed

- The horizontal tab strip is gone: at panel width it shrank tabs to one letter. Open tabs now sit in the rail under the apps, and the toolbar's tab count button opens a list of every tab with its full title. A setting ("Open tabs") keeps tabs only in that list.
- New look: the dark theme uses the [Vesper](https://github.com/vladzima/vesper-theme) palette (peach accent), with a matching light theme. The accent defaults to the theme's own; text on any accent picks black or white for contrast. Settings from 0.2 that still had the old default accent switch to the theme's accent once.
- One font scale everywhere. Chrome gave extension pages its own body font and form controls another, so text mixed fonts and sizes.
- The address bar shows `example.com/path` until you click it; `http://` stays visible so an insecure page never looks like a secure one.
- Site icons come from the page, Chrome's icon store, or the site's `/favicon.ico`, in that order, so sites that refuse to share their icon (Gemini, Claude) still show it once you have visited them. Sites without one show a neutral letter instead of a generic globe. Adds the `favicon` permission.
- The settings page has a section index, accent swatches, and the logo; the README shows the full-resolution logo.

### Added

- Rail apps can be added (with a name and address), edited, moved, dragged and removed, from the rail (the **+** button and right-click menu) and from the settings page. Speed dial shortcuts get the same editor on the settings page. Invalid or duplicate addresses are refused with a reason. Each app has a stable id, so its open tab stays tied to it when its address changes anywhere.

### Fixed

- Importing a JSON file that is not Sidespace settings (say a `package.json`) silently reset every setting to defaults; it is now refused.
- A custom search template without `%s` was refused, but the field you were typing in then disappeared; it now stays open.
- Mobile-site lines that are not hostnames were dropped silently; the status now names them.
- Edits from the panel and the settings page at the same time could overwrite each other; each edit now applies to the settings as stored at that moment.
- Keyboard: the rail and tab list keep focus while pages update their titles; Enter on a tab list close button closes the tab; close buttons are reachable by keyboard; moving an app to the top or bottom keeps focus on its row; rail apps are announced as buttons.
- Failed rail actions (for example on an app removed in another window) now show the reason.

### Tested on

- Chrome for Testing 155.0.8059.12 and 158.0.8127.18: 45 unit tests, 79 end-to-end tests, 7 live sites; the end-to-end suite ran three times in a row on 158 with no failures. Loaded and used by M in Chrome 157.

## [0.2.0] - 2026-11-09

### Added

- `window.open(url, '_blank', 'noopener')` calls made while you are using the page (a click or key press in the last few seconds) open as panel tabs when "Links that open a new window" is set to panel. Popups without `noopener`, such as sign-in popups, still open as real popups. `noopener` is parsed as the HTML spec does, and relative URLs resolve against the page's base URL.
- "Signing in" section in the README: the panel shares cookies and storage with your tabs; Google sign-in must be done in a normal tab.
- `npm run test:live`: loads ChatGPT, Claude, Gemini, Perplexity, GitHub, Wikipedia and YouTube in the panel.
- End-to-end tests for the bookmarks view (folders, breadcrumbs, search, opening, bookmarking the current page) and for sign-in sharing.

### Fixed

- "Page not showing?" could appear over a page that had loaded fine, when the frame fired an extra load event. The panel now asks the frame after each load instead of counting events.
- `npm run test:e2e` without `SIDESPACE_CHROME` used Playwright's headless shell, which cannot load extensions; it now uses the full Chromium.

### Tested on

- Chrome for Testing 155.0.8059.12 and 158.0.8127.18: 36 unit tests, 40 end-to-end tests, 7 live sites.

## [0.1.0] - 2026-11-09

### Added

- Any website as tabs in Chrome's side panel, including sites that forbid framing, with framing headers removed only for loads the panel starts and same-site navigations.
- Tab strip, per-tab history, address bar with search, zoom, mobile view per site.
- App rail with ChatGPT, Gemini, Claude and Perplexity presets; bookmarks view; quick notes; dashboard with clock, search and speed dial.
- Context menus, keyboard shortcuts, session restore, themes, settings import and export.

[0.3.0]: https://github.com/monarchmaisuriya/sidespace/releases/tag/v0.3.0
[0.2.0]: https://github.com/monarchmaisuriya/sidespace/releases/tag/v0.2.0
[0.1.0]: https://github.com/monarchmaisuriya/sidespace/commit/ae2f853
