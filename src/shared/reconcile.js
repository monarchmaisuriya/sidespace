// Keeps one element per key in `container`, in the order of `items`.
// Existing elements are reused, so focus, hover and drags survive re-renders
// (the rail re-renders whenever any tab's title changes); missing ones are
// created and the rest removed. `update` runs for every item.
export function reconcile(container, items, keyOf, create, update) {
  // Moving an element in the DOM drops its focus; it is given back below.
  const focused = container.contains(document.activeElement) ? document.activeElement : null;
  const existing = new Map([...container.children].map((element) => [element.dataset.key, element]));
  let previous = null;
  for (const item of items) {
    const key = keyOf(item);
    let element = existing.get(key);
    if (element) {
      existing.delete(key);
    } else {
      element = create(item);
      element.dataset.key = key;
    }
    update(element, item);
    const expected = previous ? previous.nextElementSibling : container.firstElementChild;
    if (element !== expected) container.insertBefore(element, expected);
    previous = element;
  }
  for (const element of existing.values()) element.remove();
  if (focused?.isConnected && document.activeElement !== focused) focused.focus();
}

// Replaces the icon inside `holder` only when its page or reported icon changed.
export function setIcon(holder, pageUrl, reportedIcon, makeIcon) {
  const key = `${pageUrl}\n${reportedIcon}`;
  if (holder.dataset.iconKey === key) return;
  holder.dataset.iconKey = key;
  holder.querySelector('.favicon')?.remove();
  holder.prepend(makeIcon(pageUrl, reportedIcon));
}
