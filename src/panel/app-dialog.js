// The "Add an app" / "Edit app" dialog. It only collects a name and an
// address; `onSave` validates and stores them and throws an Error whose
// message is shown in the dialog, which then stays open.

export function initAppDialog({ dialog, form, heading, nameInput, urlInput, error, cancelButton }) {
  let onSave = null;

  function showError(message) {
    error.textContent = message;
    error.hidden = !message;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await onSave({ title: nameInput.value, url: urlInput.value });
      dialog.close();
    } catch (failure) {
      showError(failure.message);
      urlInput.focus();
    }
  });
  cancelButton.addEventListener('click', () => dialog.close());
  urlInput.addEventListener('input', () => showError(''));

  return {
    // title: dialog heading; values: initial { title, url }; save: async ({ title, url }) => void.
    open({ title, values, save }) {
      heading.textContent = title;
      nameInput.value = values.title ?? '';
      urlInput.value = values.url ?? '';
      onSave = save;
      showError('');
      dialog.showModal();
      (values.url ? nameInput : urlInput).focus();
      (values.url ? nameInput : urlInput).select();
    },
  };
}
