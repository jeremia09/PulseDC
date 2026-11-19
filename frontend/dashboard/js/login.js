// API base is resolved centrally via PulseDC.API (core/utils.js, loaded first)
const LOGIN_API_BASE = window.PulseDC.API.getBaseUrl();

document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('loginForm');
  const username = document.getElementById('username');
  const password = document.getElementById('password');
  const error = document.getElementById('loginError');
  const submit = document.getElementById('loginSubmit');
  const passwordToggle = document.getElementById('passwordToggle');

  passwordToggle.addEventListener('click', () => {
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    passwordToggle.textContent = show ? 'Hide' : 'Show';
    passwordToggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });

  try {
    const session = await fetch(`${LOGIN_API_BASE}/api/me`, { credentials: 'include' });
    if (session.ok) window.location.replace('index.html');
  } catch (e) { /* The form shows a clearer error if the server is unavailable. */ }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    error.textContent = '';
    submit.disabled = true;
    submit.textContent = 'Signing in…';
    try {
      const response = await fetch(`${LOGIN_API_BASE}/api/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.value.trim(), password: password.value })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Sign-in failed.');
      window.location.replace('index.html');
    } catch (err) {
      error.textContent = err.message === 'Failed to fetch'
        ? 'Cannot reach the backend. Start the PulseDC backend and try again.'
        : err.message;
    } finally {
      submit.disabled = false;
      submit.textContent = 'Sign in';
    }
  });
});