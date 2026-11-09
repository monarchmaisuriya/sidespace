// Browse and search Chrome bookmarks. Uses the optional "bookmarks"
// permission, which Chrome asks the user for on first use.

import { isHttpUrl } from '../shared/settings.js';
import { isBrowserOnlyUrl } from '../shared/url.js';
import { faviconFor } from '../shared/favicon.js';

const ROOT_ID = '0';
const MAX_RESULTS = 200;
const SEARCH_DELAY_MS = 150;
const PERMISSION = { permissions: ['bookmarks'] };
const FOLDER_ICON = '<svg class="folder-icon" viewBox="0 0 24 24"><path d="M3 6h7l2 2h9v11H3z"/></svg>';

export function initBookmarks({ view, search, crumbs, list, permissionBox, grantButton, addButton, openUrl, currentPage, showToast }) {
  let folderId = ROOT_ID;
  let query = '';
  let listening = false;
  let searchTimer = 0;

  function listenForChanges() {
    if (listening) return;
    listening = true;
    for (const event of ['onCreated', 'onRemoved', 'onChanged', 'onMoved']) {
      chrome.bookmarks[event].addListener(() => { if (!view.hidden) render(); });
    }
  }

  function row(node) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = node.title || node.url || 'Untitled';
    if (node.url) {
      button.dataset.url = node.url;
      button.title = node.url;
      button.disabled = !isHttpUrl(node.url) && !isBrowserOnlyUrl(node.url);
      button.append(faviconFor(isHttpUrl(node.url) ? node.url : '', '', 16), label);
    } else {
      button.dataset.folder = node.id;
      button.insertAdjacentHTML('afterbegin', FOLDER_ICON);
      button.append(label);
    }
    li.append(button);
    return li;
  }

  async function renderCrumbs() {
    const chain = [];
    for (let id = folderId; id && id !== ROOT_ID;) {
      const [node] = await chrome.bookmarks.get(id);
      chain.unshift(node);
      id = node.parentId;
    }
    const items = [{ id: ROOT_ID, title: 'Bookmarks' }, ...chain].map((node) => {
      const button = document.createElement('button');
      button.dataset.folder = node.id;
      button.textContent = node.title || 'Untitled';
      return button;
    });
    crumbs.replaceChildren(...items);
  }

  async function render() {
    let nodes;
    if (query) {
      nodes = (await chrome.bookmarks.search(query)).filter((node) => node.url).slice(0, MAX_RESULTS);
      crumbs.replaceChildren();
    } else {
      try {
        nodes = await chrome.bookmarks.getChildren(folderId);
      } catch {
        // The folder was deleted while open; go back to the top.
        folderId = ROOT_ID;
        nodes = await chrome.bookmarks.getChildren(ROOT_ID);
      }
      nodes = [...nodes.filter((node) => !node.url), ...nodes.filter((node) => node.url)];
      await renderCrumbs();
    }
    if (nodes.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty-row';
      empty.textContent = query ? 'No bookmarks match.' : 'This folder is empty.';
      list.replaceChildren(empty);
    } else {
      list.replaceChildren(...nodes.map(row));
    }
  }

  async function show() {
    const granted = await chrome.permissions.contains(PERMISSION);
    permissionBox.hidden = granted;
    if (!granted) {
      list.replaceChildren();
      crumbs.replaceChildren();
      return;
    }
    listenForChanges();
    await render();
  }

  // permissions.request needs the click's user gesture, so it is called
  // first, before any await.
  grantButton.addEventListener('click', () => {
    chrome.permissions.request(PERMISSION).then((granted) => {
      if (granted) show();
      else showToast('Bookmarks access was not granted.');
    });
  });

  addButton.addEventListener('click', () => {
    const page = currentPage();
    if (!page) {
      showToast('Open a page in the panel first.');
      return;
    }
    chrome.permissions.request(PERMISSION).then(async (granted) => {
      if (!granted) return;
      await chrome.bookmarks.create({ title: page.title, url: page.url });
      showToast('Bookmarked.');
      show();
    });
  });

  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      query = search.value.trim();
      render();
    }, SEARCH_DELAY_MS);
  });

  function onActivate(event) {
    const target = event.target.closest('button');
    if (!target || target.disabled) return;
    if (target.dataset.folder) {
      folderId = target.dataset.folder;
      query = '';
      search.value = '';
      render();
    } else if (target.dataset.url) {
      openUrl(target.dataset.url);
    }
  }
  list.addEventListener('click', onActivate);
  crumbs.addEventListener('click', onActivate);

  return { show };
}
