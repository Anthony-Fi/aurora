// Articles Navbar Component
// This file contains the reusable navbar that can be updated globally

(function() {
  // Navbar items configuration
  // To update the navbar, modify this array and it will reflect across all pages
  const navbarItems = [
    { text: 'Home', href: '/' },
    { text: 'Dashboard', href: '/#dashboard' },
    { text: 'Features', href: '/#features' },
    { text: 'Guide', href: '/#guide' },
    { text: 'Aurora 101', href: '/#aurora-101' },
    { text: 'Clothing Guide', href: '/northern-lights-clothing.html' }
  ];

  // Function to generate navbar HTML
  function generateNavbar() {
    return `
      <nav id="primary-nav" class="nav" aria-label="Primary">
        <ul>
          ${navbarItems.map(item => `
            <li><a href="${item.href}">${item.text}</a></li>
          `).join('')}
        </ul>
      </nav>
    `;
  }

  // Function to inject navbar into the header
  function injectHeaderNavbar() {
    const navContainer = document.getElementById('navbar-container');
    if (navContainer) {
      navContainer.innerHTML = generateNavbar();
      // Dispatch event to notify other components that navbar has been updated
      document.dispatchEvent(new CustomEvent('navbarUpdated'));
    }
  }
  
  // Function to inject navbar into the footer
  function injectFooterNavbar() {
    const footerNavContainer = document.getElementById('footer-navbar-container');
    if (footerNavContainer) {
      footerNavContainer.innerHTML = generateNavbar();
    }
  }
  
  // Function to inject navbar into both header and footer
  function injectNavbar() {
    injectHeaderNavbar();
    injectFooterNavbar();
  }

  // Initialize navbar when DOM is loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectNavbar);
  } else {
    injectNavbar();
  }

  // Expose function to update navbar items dynamically
  window.updateNavbarItems = function(newItems) {
    navbarItems.length = 0;
    navbarItems.push(...newItems);
    injectNavbar();
  };

  // Expose function to add an article link
  window.addArticleLink = function(text, href) {
    navbarItems.push({ text, href });
    injectNavbar();
  };

})();
