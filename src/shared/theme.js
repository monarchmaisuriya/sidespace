// Applies appearance settings to a page's <html> element.
export function applyAppearance(settings, root = document.documentElement) {
  if (settings.theme === 'system') root.removeAttribute('data-theme');
  else root.dataset.theme = settings.theme;
  root.dataset.density = settings.density;
  root.style.setProperty('--accent', settings.accent);
}
