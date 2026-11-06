'use strict';
const passwordInput = document.getElementById('access-password');
document.getElementById('toggle-password').addEventListener('click', event => {
  const show = passwordInput.type === 'password';
  passwordInput.type = show ? 'text' : 'password';
  event.target.textContent = show ? 'Ocultar' : 'Mostrar'; event.target.setAttribute('aria-pressed', String(show));
});
document.getElementById('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = document.getElementById('login-submit');
  const errorEl = document.getElementById('login-error');
  button.disabled = true; errorEl.hidden = true;
  try { await window.AppAccess.login(passwordInput.value, document.querySelector('[name="access-kind"]:checked').value); }
  catch (error) { errorEl.textContent = error.message || 'No se pudo conectar con el acceso seguro.'; errorEl.hidden = false; }
  finally { button.disabled = false; passwordInput.value = ''; }
});
