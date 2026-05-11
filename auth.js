// HeartSync Authentication Module
const AUTH = (() => {
  const STORAGE_KEY  = 'heartsync_user';
  const ACCOUNTS_KEY = 'heartsync_accounts';
  const SESSIONS_KEY = 'heartsync_sessions';
  const SETTINGS_KEY = 'heartsync_settings';
  const AUTH_CHANNEL = 'heartsync-auth';

  // Replace with your Apple Service ID after registering at developer.apple.com
  const APPLE_CLIENT_ID    = 'com.heartsync.web';
  const APPLE_REDIRECT_URI = window.location.origin + window.location.pathname;

  // ── Core session ──
  function getUser()    { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
  function saveUser(u)  { localStorage.setItem(STORAGE_KEY, JSON.stringify(u)); }
  function isLoggedIn() { return !!getUser(); }

  function logout() {
    localStorage.removeItem(STORAGE_KEY);
    broadcast({ type: 'logout' });
    window.location.href = 'login.html';
  }

  function requireAuth(redirect = 'login.html') {
    if (!isLoggedIn()) window.location.href = redirect;
  }

  // ── Email auth (localStorage, demo quality) ──
  async function hashPassword(pw) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function loginEmail(email, password) {
    const hash     = await hashPassword(password);
    const accounts = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '{}');
    const acct     = accounts[email.toLowerCase()];
    if (!acct || acct.hash !== hash) throw new Error('Invalid email or password');
    const user = { id: acct.id, name: acct.name, email: acct.email, provider: 'email', created: acct.created };
    saveUser(user);
    broadcast({ type: 'login', user });
    return user;
  }

  async function createAccount(name, email, password) {
    if (!name.trim())          throw new Error('Name is required');
    if (!email.includes('@'))  throw new Error('Enter a valid email address');
    if (password.length < 6)   throw new Error('Password must be at least 6 characters');
    const hash     = await hashPassword(password);
    const accounts = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '{}');
    const key      = email.toLowerCase();
    if (accounts[key]) throw new Error('An account with that email already exists');
    const user = { id: 'local_' + Date.now(), name: name.trim(), email: key, provider: 'email', created: Date.now() };
    accounts[key] = { ...user, hash };
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
    saveUser(user);
    broadcast({ type: 'login', user });
    return user;
  }

  // ── Apple Sign In ──
  function initAppleSignIn() {
    if (typeof AppleID === 'undefined') return;
    try {
      AppleID.auth.init({
        clientId:    APPLE_CLIENT_ID,
        scope:       'name email',
        redirectURI: APPLE_REDIRECT_URI,
        state:       'hs-' + Math.random().toString(36).slice(2),
        usePopup:    true,
      });
    } catch (_) { /* unconfigured — demo mode will be used */ }
  }

  async function signInWithApple() {
    // Fall back to demo when Apple credentials aren't configured (localhost / no Service ID)
    const isConfigured = typeof AppleID !== 'undefined' && APPLE_CLIENT_ID !== 'com.heartsync.web';
    if (!isConfigured) return _demoAppleLogin();

    try {
      const data    = await AppleID.auth.signIn();
      const raw     = data.authorization.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(raw));
      const user    = {
        id:       payload.sub,
        name:     data.user
          ? `${data.user.name.firstName} ${data.user.name.lastName}`.trim()
          : _nameFromEmail(payload.email),
        email:    data.user?.email || payload.email || '',
        provider: 'apple',
        created:  Date.now(),
      };
      saveUser(user);
      broadcast({ type: 'login', user });
      return user;
    } catch (e) {
      if (e.error === 'popup_closed_by_user') return null;
      throw e;
    }
  }

  function _demoAppleLogin() {
    const user = {
      id:       'apple_demo_' + Date.now(),
      name:     'Demo User',
      email:    'demo@icloud.com',
      provider: 'apple',
      demo:     true,
      created:  Date.now(),
    };
    saveUser(user);
    broadcast({ type: 'login', user });
    return user;
  }

  function _nameFromEmail(email) {
    if (!email) return 'Apple User';
    return email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  // ── Settings ──
  function getSettings() {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{"hapticOnLogin":false,"syncTabs":true,"privacy":false}');
  }
  function saveSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }

  // ── Session history ──
  function recordSession(bpm, sdnn, rmssd) {
    if (!isLoggedIn()) return;
    const sessions = JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]');
    sessions.push({ date: Date.now(), bpm: Math.round(bpm), sdnn: Math.round(sdnn || 0), rmssd: Math.round(rmssd || 0) });
    if (sessions.length > 200) sessions.shift();
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  }
  function getSessions() { return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]'); }

  // ── Utils ──
  function getInitials(name) {
    if (!name) return '♥';
    return name.split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  }

  function broadcast(msg) {
    try { new BroadcastChannel(AUTH_CHANNEL).postMessage(msg); } catch (_) {}
  }

  return {
    getUser, saveUser, isLoggedIn, logout, requireAuth,
    loginEmail, createAccount,
    initAppleSignIn, signInWithApple,
    getSettings, saveSettings,
    recordSession, getSessions,
    getInitials,
  };
})();
