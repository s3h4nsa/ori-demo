(function () {
  const currentPage = location.pathname.split('/').pop() || 'index.html';
  const icon = {
    track: '<path d="M1 3h15v13H1z"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
    bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
    search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>'
  };
  const svg = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon[name]}</svg>`;
  const link = (href, label, page) => `<a href="${href}" class="${currentPage === page ? 'active' : ''}">${label}</a>`;
  const header = document.createElement('header');
  header.className = 'site-header';
  header.innerHTML = `
    <div class="site-header-inner">
      <a class="site-header-brand" href="index.html" aria-label="Oriflame LK home">
        <img src="assets/logo-placeholder.png" alt="Oriflame LK">
      </a>
      <nav class="site-header-nav" aria-label="Primary navigation">
        ${link('categories.html', 'Categories', 'categories.html')}
        ${link('index.html#new-arrivals', 'New arrivals', 'index.html')}
        ${link('track.html', 'Track order', 'track.html')}
      </nav>
      <div class="site-header-actions">
        <a class="site-header-action" href="track.html" aria-label="Track order">${svg('track')}</a>
        <a class="site-header-action" data-header-bag href="cart.html" aria-label="Shopping bag">${svg('bag')}<span class="site-header-badge" data-header-bag-count>0</span></a>
        <button class="site-header-action" type="button" aria-label="Search" data-header-search>${svg('search')}</button>
        <button class="site-header-action" type="button" aria-label="Wishlist" data-header-wishlist>${svg('heart')}</button>
        <button class="site-header-action" type="button" aria-label="Account" data-header-account>${svg('user')}</button>
      </div>
    </div>`;
  document.querySelectorAll('.topnav, .topbar, .hello-bar').forEach((element) => element.remove());
  const anchor = document.querySelector('body');
  anchor.insertBefore(header, anchor.firstChild);
  function readCartCount() {
    try {
      const cart = JSON.parse(localStorage.getItem('oriflameCart') || '[]');
      return Array.isArray(cart) ? cart.reduce((total, item) => total + Number(item.qty || 1), 0) : 0;
    } catch {
      return 0;
    }
  }
  function updateCartCount(animate) {
    const count = readCartCount();
    document.querySelectorAll('[data-header-bag-count]').forEach((element) => { element.textContent = count; });
    if (animate) {
      document.querySelectorAll('[data-header-bag]').forEach((element) => {
        element.classList.remove('cart-updated');
        void element.offsetWidth;
        element.classList.add('cart-updated');
        window.setTimeout(() => element.classList.remove('cart-updated'), 600);
      });
    }
  }
  updateCartCount(false);
  window.addEventListener('storage', (event) => {
    if (event.key === 'oriflameCart') updateCartCount(false);
  });
  window.addEventListener('oriflame:cart-updated', () => updateCartCount(true));
  const searchButton = header.querySelector('[data-header-search]');
  if (searchButton) {
    searchButton.addEventListener('click', () => {
      const overlay = document.getElementById('searchOverlay');
      if (!overlay) {
        location.href = 'index.html#new-arrivals';
        return;
      }
      overlay.classList.add('show');
      overlay.setAttribute('aria-hidden', 'false');
      overlay.querySelector('input')?.focus();
    });
  }
})();
