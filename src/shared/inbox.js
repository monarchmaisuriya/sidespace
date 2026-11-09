// Hand-off of URLs from the service worker to the side panel of a window.
// One storage.session key per entry, so concurrent writers never overwrite
// each other.

const PREFIX = 'inbox:';

export async function sendToPanel(windowId, url) {
  await chrome.storage.session.set({ [`${PREFIX}${crypto.randomUUID()}`]: { windowId, url, at: Date.now() } });
}

// Removes and returns the URLs waiting for this window, oldest first.
export async function takeForWindow(windowId) {
  const all = await chrome.storage.session.get(null);
  const keys = Object.keys(all).filter((key) => key.startsWith(PREFIX) && all[key]?.windowId === windowId);
  if (keys.length === 0) return [];
  await chrome.storage.session.remove(keys);
  return keys.map((key) => all[key]).sort((a, b) => a.at - b.at).map((entry) => entry.url);
}

export function onInboxChanged(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && Object.keys(changes).some((key) => key.startsWith(PREFIX) && changes[key].newValue)) {
      callback();
    }
  });
}
