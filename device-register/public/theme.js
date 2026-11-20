/* Light or dark: what this browser picked with the button in the top bar,
   otherwise what the computer is set to. Loaded in the head, before the
   page draws, so it never flashes the wrong one. */
(() => {
  const KEY = 'device-register.theme';
  const root = document.documentElement;
  const computer = matchMedia('(prefers-color-scheme: dark)');
  const picked = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const apply = () => { root.dataset.theme = picked() || (computer.matches ? 'dark' : 'light'); };
  apply();
  computer.addEventListener('change', apply);

  document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('theme');
    if (!button) return;
    const label = () => { button.textContent = root.dataset.theme === 'dark' ? 'Light mode' : 'Dark mode'; };
    label();
    computer.addEventListener('change', label);
    button.addEventListener('click', () => {
      const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(KEY, next); } catch { /* storage blocked: lasts until the page closes */ }
      root.dataset.theme = next;
      label();
    });
  });
})();
