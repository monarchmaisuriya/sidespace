// Applies appearance settings to a page's <html> element.

// Black or white, whichever reads better on the given #rrggbb colour
// (WCAG relative luminance).
export function textColourOn(hex) {
  const channel = (i) => {
    const value = parseInt(hex.slice(i, i + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.179 ? '#000000' : '#ffffff';
}

export function applyAppearance(settings, root = document.documentElement) {
  if (settings.theme === 'system') root.removeAttribute('data-theme');
  else root.dataset.theme = settings.theme;
  root.dataset.density = settings.density;
  // An empty accent means the theme's own (Vesper peach in dark mode).
  if (settings.accent) {
    root.style.setProperty('--accent', settings.accent);
    root.style.setProperty('--on-accent', textColourOn(settings.accent));
  } else {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--on-accent');
  }
}
