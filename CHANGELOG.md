# Changelog

All notable changes to Sidespace. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

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

[0.2.0]: https://github.com/monarchmaisuriya/sidespace/releases/tag/v0.2.0
[0.1.0]: https://github.com/monarchmaisuriya/sidespace/commit/ae2f853
