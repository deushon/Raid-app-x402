const form = document.getElementById('register-form');
const errorEl = document.getElementById('form-error');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorEl.classList.add('hidden');
  errorEl.textContent = '';

  const body = {
    login: form.login.value.trim(),
    password: form.password.value,
    walletPublicKey: form.walletPublicKey.value.trim(),
  };

  const response = await fetch('/api/teleoperator/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    errorEl.textContent = data.error || 'Ошибка регистрации';
    errorEl.classList.remove('hidden');
    return;
  }

  window.location.assign('/teleoperator/cabinet');
});
