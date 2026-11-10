// The "Add an app" / "Edit app" dialog. It only collects a name, an address
// and whether the app opens beside the page; `onSave` validates and stores them and throws an Error whose
// message is shown in the dialog, which then stays open.

export function initAppDialog({ dialog, form, heading, nameInput, urlInput, besideInput, error, cancelButton }) {
  let onSave = null;

  function showError(message) {
    error.textContent = message;
    error.hidden = !message;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await onSave({ title: nameInput.value, url: urlInput.value, beside: besideInput.checked });
      dialog.close();
    } catch (failure) {
      showError(failure.message);
      urlInput.focus();
    }
  });
  cancelButton.addEventListener('click', () => dialog.close());
  urlInput.addEventListener('input', () => showError(''));

  return {
    // title: dialog heading; values: initial { title, url, beside };
    // save: async ({ title, url, beside }) => void.
    open({ title, values, save }) {
      heading.textContent = title;
      nameInput.value = values.title ?? '';
      urlInput.value = values.url ?? '';
      besideInput.checked = values.beside === true;
      onSave = save;
      showError('');
      dialog.showModal();
      (values.url ? nameInput : urlInput).focus();
      (values.url ? nameInput : urlInput).select();
    },
  };
}
