// Applies the saved theme (or the device preference on the first visit) before
// the page is painted, so the dark theme does not flash white. External file:
// the Content-Security-Policy of the site does not allow inline scripts.
(function () {
  var theme = null;
  try { theme = localStorage.getItem('fbf-theme'); } catch (e) { /* storage blocked */ }
  if (theme !== 'dark' && theme !== 'light') {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', theme);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#16130f' : '#181818');
})();
