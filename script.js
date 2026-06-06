const hamburger = document.getElementById('hamburger');
const navLinks = document.getElementById('navLinks');

if (hamburger && navLinks) {
  hamburger.addEventListener('click', () => navLinks.classList.toggle('open'));
}

window.addEventListener('scroll', () => {
  const navbar = document.getElementById('navbar');
  if (navbar) navbar.classList.toggle('scrolled', window.scrollY > 12);
});

const fadeObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) entry.target.classList.add('visible');
  });
}, { threshold: 0.12 });

document.querySelectorAll('.fade-in').forEach((el) => fadeObserver.observe(el));

async function startStripeCheckout(order) {
  const button = order.button;
  const previousText = button ? button.textContent : '';

  if (button) {
    button.disabled = true;
    button.textContent = 'Opening secure checkout...';
  }

  try {
    const response = await fetch('/api/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(order)
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Checkout could not start.');
    window.location.href = data.url;
  } catch (error) {
    alert(`${error.message}\n\nStripe checkout failed. Check your Vercel environment variables and function logs.`);
    if (button) {
      button.disabled = false;
      button.textContent = previousText;
    }
  }
}
