// html.js (which gates reveal-hiding) is set by the inline head script in
// index.html so it applies before first render.

// ============ Reveal on scroll ============
const revealEls = Array.from(document.querySelectorAll('[data-reveal]'));

if (revealEls.length) {
  const revealAll = () => revealEls.forEach((el) => el.classList.add('in'));
  const reduce =
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduce || !('IntersectionObserver' in window)) {
    revealAll();
  } else {
    // Failsafe: whatever happens, never leave content hidden.
    setTimeout(revealAll, 1800);

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.14 }
    );
    revealEls.forEach((el) => io.observe(el));
  }
}

// ============ Countdown ============
const countdown = document.querySelector('[data-countdown]');

if (countdown) {
  const target = new Date(countdown.dataset.launch).getTime();
  const cells = {
    days: countdown.querySelector('[data-cd="days"]'),
    hours: countdown.querySelector('[data-cd="hours"]'),
    mins: countdown.querySelector('[data-cd="mins"]'),
    secs: countdown.querySelector('[data-cd="secs"]'),
  };
  const pad = (n) => String(n).padStart(2, '0');

  const tick = () => {
    let diff = Math.max(0, target - Date.now());
    const d = Math.floor(diff / 86400000);
    diff -= d * 86400000;
    const h = Math.floor(diff / 3600000);
    diff -= h * 3600000;
    const m = Math.floor(diff / 60000);
    diff -= m * 60000;
    const s = Math.floor(diff / 1000);
    cells.days.textContent = pad(d);
    cells.hours.textContent = pad(h);
    cells.mins.textContent = pad(m);
    cells.secs.textContent = pad(s);
  };

  tick();
  setInterval(tick, 1000);
}

// ============ Demo request form (Formspree) ============
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
