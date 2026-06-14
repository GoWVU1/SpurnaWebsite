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

const demoForm = document.querySelector('[data-demo-form]');

if (demoForm) {
  const status = demoForm.querySelector('[data-form-status]');
  const submitButton = demoForm.querySelector('button[type="submit"]');

  const setStatus = (message, state) => {
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('is-success', state === 'success');
    status.classList.toggle('is-error', state === 'error');
  };

  demoForm.addEventListener('submit', async (event) => {
    // Don't hijack the submit unless we can fall back gracefully on failure.
    event.preventDefault();
    setStatus('Sending…', null);
    submitButton.disabled = true;

    try {
      const response = await fetch(demoForm.action, {
        method: 'POST',
        body: new FormData(demoForm),
        headers: { Accept: 'application/json' },
      });

      if (response.ok) {
        demoForm.reset();
        setStatus("Thanks! We'll be in touch about your demo soon.", 'success');
      } else {
        const data = await response.json().catch(() => null);
        const message =
          data && data.errors
            ? data.errors.map((e) => e.message).join(', ')
            : 'Something went wrong. Please try again in a moment.';
        setStatus(message, 'error');
      }
    } catch (error) {
      setStatus('Network error. Please try again in a moment.', 'error');
    } finally {
      submitButton.disabled = false;
    }
  });
}
