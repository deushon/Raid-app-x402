document.getElementById('logout-btn').addEventListener('click', async () => {
  await fetch('/api/teleoperator/logout', {
    method: 'POST',
    credentials: 'include',
  });
  window.location.href = '/teleoperator/login.html';
});
