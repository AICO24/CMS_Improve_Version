(function () {
  const placeholders = {
    '#navbar-placeholder': 'src/components/layout/navbar.html',
    '#main-content': 'src/components/sections/developer-team.html',
    '#page-footer': 'src/components/layout/footer.html'
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
