// Apply the saved appearance before loading CSS, so refreshes do not flash dark.
(() => {
  const storageKey = 'tellshift.theme.v1';
  const choices = ['light', 'dark', 'system'];
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = 'light';

  try {
    const saved = localStorage.getItem(storageKey);
    if (choices.includes(saved)) preference = saved;
  } catch { /* Appearance remains usable when browser storage is unavailable. */ }

  function applyTheme() {
    const theme = preference === 'system' ? (system.matches ? 'dark' : 'light') : preference;
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themeMode = preference;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'dark' ? '#0c1118' : '#f1f3ed';
    const control = document.getElementById('theme-mode');
    if (control) control.value = preference;
  }

  applyTheme();
  system.addEventListener('change', () => {
    if (preference === 'system') applyTheme();
  });
  document.addEventListener('DOMContentLoaded', () => {
    applyTheme();
    document.getElementById('theme-mode')?.addEventListener('change', event => {
      if (!choices.includes(event.target.value)) return;
      preference = event.target.value;
      try { localStorage.setItem(storageKey, preference); } catch { /* Keep the choice for this page. */ }
      applyTheme();
    });
  });
})();
