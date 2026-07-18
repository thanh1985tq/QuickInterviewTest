const form = document.querySelector('#login-form');
const message = document.querySelector('#login-message');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.textContent = 'Signing in…';
  const data = new FormData(form);
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: data.get('email'), password: data.get('password') }),
  });
  if (response.ok) {
    window.location.assign('/admin');
    return;
  }
  const body = await response.json().catch(() => ({}));
  message.textContent = body.error?.message ?? 'Sign in failed.';
});
