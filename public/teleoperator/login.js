const form = document.getElementById('login-form');
const errorEl = document.getElementById('form-error');

const params = new URLSearchParams(window.location.search);
const rawNext = params.get('next') || '/teleoperator/cabinet';
const nextUrl =
  rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/teleoperator/cabinet';

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorEl.classList.add('hidden');
  errorEl.textContent = '';

  const body = {
    login: form.login.value.trim(),
    password: form.password.value,
  };

  const response = await fetch('/api/teleoperator/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    errorEl.textContent = data.error || 'Неверный логин или пароль';
    errorEl.classList.remove('hidden');
    return;
  }

  window.location.assign(nextUrl);
});
