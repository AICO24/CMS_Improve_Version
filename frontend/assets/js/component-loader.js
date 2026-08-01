(function () {
  const basePath = window.location.pathname.includes('/frontend/')
    ? window.location.pathname.split('/frontend/')[0] + '/frontend/'
    : '/';
  const placeholders = {
    '#navbar-placeholder': `${basePath}src/components/layout/navbar.html`,
    '#main-content': `${basePath}src/components/sections/developer-team.html`,
    '#page-footer': `${basePath}src/components/layout/footer.html`
  };

  async function loadPartial(selector, url) {
    const target = document.querySelector(selector);
    if (!target) return;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Unable to load component: ' + url);
      }

      target.innerHTML = await response.text();
    } catch (error) {
      console.error(error);
      target.innerHTML = '<p class="error-message">Unable to load the requested section.</p>';
    }
  }

  document.addEventListener('DOMContentLoaded', async function () {
    for (const [selector, url] of Object.entries(placeholders)) {
      await loadPartial(selector, url);
    }
  });
})();
