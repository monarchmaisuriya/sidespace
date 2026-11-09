// Quick notes: one text, saved locally shortly after each change.

const NOTES_KEY = 'notes';
const SAVE_DELAY_MS = 400;

export function initNotes({ textarea, status, copyButton, showToast }) {
  let timer = 0;

  async function save() {
    clearTimeout(timer);
    timer = 0;
    await chrome.storage.local.set({ [NOTES_KEY]: textarea.value });
    status.textContent = 'Saved';
  }

  chrome.storage.local.get(NOTES_KEY).then((stored) => {
    textarea.value = typeof stored[NOTES_KEY] === 'string' ? stored[NOTES_KEY] : '';
  });
  textarea.addEventListener('input', () => {
    status.textContent = 'Saving…';
    clearTimeout(timer);
    timer = setTimeout(save, SAVE_DELAY_MS);
  });
  // Another window's panel edited the notes.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[NOTES_KEY] && document.activeElement !== textarea) {
      textarea.value = changes[NOTES_KEY].newValue ?? '';
    }
  });
  copyButton.addEventListener('click', async () => {
    await navigator.clipboard.writeText(textarea.value);
    showToast('Notes copied.');
  });

  return {
    // Saves a pending change right away (the panel is closing).
    flush() {
      if (timer) save();
    },
  };
}
