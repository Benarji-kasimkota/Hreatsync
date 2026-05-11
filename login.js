// login.js
let isCreateMode = false;

document.addEventListener('DOMContentLoaded', () => {
  // Skip login if already authenticated
  if (AUTH.isLoggedIn()) { redirectAfterLogin(); return; }

  // Show demo notice on localhost / file://
  const isLocal = ['localhost', '127.0.0.1', ''].includes(location.hostname) || location.protocol === 'file:';
  if (isLocal) document.getElementById('demo-notice').classList.add('show');

  AUTH.initAppleSignIn();

  // ── Apple Sign In ──
  document.getElementById('apple-btn').addEventListener('click', async () => {
    const btn = document.getElementById('apple-btn');
    const txt = document.getElementById('apple-btn-text');
    btn.disabled = true;
    txt.textContent = 'Signing in…';
    clearError();
    try {
      const user = await AUTH.signInWithApple();
      if (user) redirectAfterLogin();
    } catch (e) {
      showError(e.message || 'Apple Sign In failed. Please try email instead.');
    } finally {
      btn.disabled = false;
      txt.textContent = 'Continue with Apple';
    }
  });

  // ── Email form ──
  document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submit-btn');
    btn.disabled = true;
    clearError();
    try {
      if (isCreateMode) {
        await AUTH.createAccount(
          document.getElementById('form-name').value,
          document.getElementById('form-email').value,
          document.getElementById('form-pass').value,
        );
      } else {
        await AUTH.loginEmail(
          document.getElementById('form-email').value,
          document.getElementById('form-pass').value,
        );
      }
      redirectAfterLogin();
    } catch (e) {
      showError(e.message);
    } finally {
      btn.disabled = false;
    }
  });

  // ── Toggle create / sign in ──
  document.getElementById('mode-switch').addEventListener('click', toggleMode);
});

function toggleMode() {
  isCreateMode = !isCreateMode;
  const nameRow = document.getElementById('name-row');
  nameRow.style.display = isCreateMode ? 'block' : 'none';
  document.getElementById('submit-btn').textContent = isCreateMode ? 'CREATE ACCOUNT' : 'SIGN IN';
  document.getElementById('mode-switch').innerHTML = isCreateMode
    ? 'Already have one? <span>Sign in →</span>'
    : 'No account? <span>Create one →</span>';
  document.getElementById('form-pass').autocomplete = isCreateMode ? 'new-password' : 'current-password';
  clearError();
}

function showError(msg) { document.getElementById('form-error').textContent = msg; }
function clearError()   { document.getElementById('form-error').textContent = ''; }

function redirectAfterLogin() {
  const params = new URLSearchParams(location.search);
  window.location.href = params.get('back') || 'index.html';
}
