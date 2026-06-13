const toggle = document.querySelector('.menu-toggle');
const nav = document.querySelector('[data-nav]');

if (toggle && nav) {
  const setMenu = (isOpen) => {
    nav.classList.toggle('open', isOpen);
    toggle.setAttribute('aria-expanded', String(isOpen));
    toggle.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
  };

  toggle.addEventListener('click', () => {
    setMenu(!nav.classList.contains('open'));
  });

  nav.addEventListener('click', (event) => {
    if (event.target.closest('a')) {
      setMenu(false);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && nav.classList.contains('open')) {
      setMenu(false);
      toggle.focus();
    }
  });

  document.addEventListener('click', (event) => {
    if (
      nav.classList.contains('open') &&
      !nav.contains(event.target) &&
      !toggle.contains(event.target)
    ) {
      setMenu(false);
    }
  });
}

const revealItems = document.querySelectorAll('.reveal');

if (revealItems.length) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.2 }
  );

  revealItems.forEach((item, index) => {
    item.style.transitionDelay = `${index * 120}ms`;
    observer.observe(item);
  });
}
