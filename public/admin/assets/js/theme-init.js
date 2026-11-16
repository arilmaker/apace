// Dijalankan lebih awal (di <head>) supaya tidak berkedip saat tema gelap dipakai.
(function () {
  try {
    var t = localStorage.getItem('r1z_admin_theme');
    if (!t) t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = t;
  } catch (e) { document.documentElement.dataset.theme = 'light'; }
})();
