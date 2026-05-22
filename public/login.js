// Tab switching
function showTab(name) {
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const loginTab = document.getElementById('tab-login');
  const registerTab = document.getElementById('tab-register');

  if (name === 'login') {
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
    loginTab.classList.remove('bg-white', 'text-stone-700', 'border', 'border-stone-200');
    loginTab.classList.add('bg-stone-900', 'text-white');
    registerTab.classList.add('bg-white', 'text-stone-700', 'border', 'border-stone-200');
    registerTab.classList.remove('bg-stone-900', 'text-white');
  } else {
    registerForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
    registerTab.classList.remove('bg-white', 'text-stone-700', 'border', 'border-stone-200');
    registerTab.classList.add('bg-stone-900', 'text-white');
    loginTab.classList.add('bg-white', 'text-stone-700', 'border', 'border-stone-200');
    loginTab.classList.remove('bg-stone-900', 'text-white');
  }
}

// Show an error message inside a form
function showError(formName, message) {
  const el = document.getElementById(`${formName}-error`);
  el.textContent = message;
  el.classList.remove('hidden');
}

function clearError(formName) {
  document.getElementById(`${formName}-error`).classList.add('hidden');
}

// Login
async function doLogin() {
  clearError('login');
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;

  if (!username || !password) {
    showError('login', 'Username and password required');
    return;
  }

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    if (!res.ok) {
      const data = await res.json();
      showError('login', data.error || 'Login failed');
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const redirect = params.get('redirect');
    window.location.href = redirect || '/';
  } catch (err) {
    showError('login', 'Network error - try again');
  }
}

// Register
async function doRegister() {
  clearError('register');
  const username = document.getElementById('register-username').value.trim();
  const password = document.getElementById('register-password').value;

  if (!username || !password) {
    showError('register', 'Username and password required');
    return;
  }

  if (password.length < 8) {
    showError('register', 'Password must be at least 8 characters');
    return;
  }

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    if (!res.ok) {
      const data = await res.json();
      showError('register', data.error || 'Registration failed');
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const redirect = params.get('redirect');
    window.location.href = redirect || '/';
  } catch (err) {
    showError('register', 'Network error - try again');
  }
}

// Allow Enter key to submit
document.getElementById('login-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') doLogin();
});
document.getElementById('register-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') doRegister();
});