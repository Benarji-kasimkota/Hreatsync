// account.js
document.addEventListener('DOMContentLoaded', () => {
  AUTH.requireAuth();

  const user = AUTH.getUser();
  populateProfile(user);
  loadStats();
  loadRhythmProfile();
  loadSettings();
  pingDevices();

  document.getElementById('signout-btn').addEventListener('click', () => {
    if (confirm('Sign out of HeartSync?')) AUTH.logout();
  });

  ['set-haptic', 'set-sync', 'set-privacy'].forEach(id =>
    document.getElementById(id).addEventListener('change', persistSettings)
  );

  // Mirror auth state from other tabs
  const authCh = new BroadcastChannel('heartsync-auth');
  authCh.onmessage = (e) => {
    if (e.data.type === 'logout') window.location.href = 'login.html';
  };
});

// ── Profile ──
function populateProfile(user) {
  document.getElementById('acc-avatar').textContent = AUTH.getInitials(user.name);
  document.getElementById('acc-name').textContent   = user.name  || 'HeartSync User';
  document.getElementById('acc-email').textContent  = user.demo  ? 'Demo Account' : (user.email || '—');

  const isApple = user.provider === 'apple';
  document.getElementById('provider-icon').textContent  = isApple ? '🍎' : '✉️';
  document.getElementById('provider-label').textContent =
    (isApple ? 'Apple ID' : 'Email') + (user.demo ? ' · Demo' : '');
}

// ── Stats ──
function loadStats() {
  const sessions = AUTH.getSessions();
  if (!sessions.length) return;

  const avgBpm  = Math.round(sessions.reduce((s, x) => s + x.bpm,          0) / sessions.length);
  const avgSdnn = Math.round(sessions.reduce((s, x) => s + (x.sdnn  || 0), 0) / sessions.length);
  const streak  = calcStreak(sessions);

  document.getElementById('stat-sessions').textContent = sessions.length;
  document.getElementById('stat-avg-bpm').textContent  = avgBpm;
  document.getElementById('stat-avg-hrv').textContent  = avgSdnn || '—';
  document.getElementById('stat-streak').textContent   = streak;
}

function calcStreak(sessions) {
  const days  = new Set(sessions.map(s => new Date(s.date).toDateString()));
  let streak  = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    if (days.has(d.toDateString())) streak++;
    else break;
  }
  return streak;
}

// ── Rhythm profile ──
const ZONES = [
  { name: 'REST',     min: 30,  max: 59  },
  { name: 'NORMAL',   min: 60,  max: 99  },
  { name: 'WARM-UP',  min: 100, max: 114 },
  { name: 'FAT BURN', min: 115, max: 134 },
  { name: 'CARDIO',   min: 135, max: 159 },
  { name: 'PEAK',     min: 160, max: 179 },
  { name: 'DANGER',   min: 180, max: 220 },
];

function loadRhythmProfile() {
  const sessions = AUTH.getSessions();
  if (!sessions.length) return;

  const avgBpm  = Math.round(sessions.reduce((s, x) => s + x.bpm,           0) / sessions.length);
  const avgSdnn = Math.round(sessions.reduce((s, x) => s + (x.sdnn  || 0),  0) / sessions.length);
  const avgRmss = Math.round(sessions.reduce((s, x) => s + (x.rmssd || 0),  0) / sessions.length);

  const zone   = ZONES.find(z => avgBpm >= z.min && avgBpm <= z.max) || ZONES[1];
  const rhythm = avgSdnn >= 50 ? 'COHERENT' : avgSdnn >= 30 ? 'VARIABLE' : avgSdnn >= 15 ? 'REDUCED' : 'RIGID';

  document.getElementById('rp-zone').textContent  = zone.name;
  document.getElementById('rp-rhythm').textContent = rhythm;
  document.getElementById('rp-sdnn').textContent  = avgSdnn ? `${avgSdnn} ms` : '—';
  document.getElementById('rp-rmssd').textContent = avgRmss ? `${avgRmss} ms` : '—';
}

// ── Settings ──
function loadSettings() {
  const s = AUTH.getSettings();
  document.getElementById('set-haptic').checked  = s.hapticOnLogin;
  document.getElementById('set-sync').checked    = s.syncTabs;
  document.getElementById('set-privacy').checked = s.privacy;
}

function persistSettings() {
  AUTH.saveSettings({
    hapticOnLogin: document.getElementById('set-haptic').checked,
    syncTabs:      document.getElementById('set-sync').checked,
    privacy:       document.getElementById('set-privacy').checked,
  });
}

// ── Device pinging ──
function pingDevices() {
  const syncCh   = new BroadcastChannel('heartsync-sync');
  const watchDot = document.getElementById('dev-watch-dot');
  const watchSub = document.getElementById('dev-watch-sub');
  const mobDot   = document.getElementById('dev-mobile-dot');
  const mobSub   = document.getElementById('dev-mobile-sub');

  let watchSeen = false;
  let mobSeen   = false;

  // Ping all tabs to respond
  syncCh.postMessage({ type: 'ping' });

  syncCh.onmessage = (e) => {
    const { type, source, bpm } = e.data;

    if ((type === 'pong' || type === 'heartdata') && source === 'watch') {
      watchSeen = true;
      watchDot.className = 'status-dot active';
      watchSub.textContent = type === 'heartdata' ? `Broadcasting · ${bpm} BPM` : 'Connected';
    }

    if (type === 'heartdata' && source !== 'watch') {
      mobSeen = true;
      mobDot.className = 'status-dot active';
      mobSub.textContent = `Connected · ${bpm} BPM`;
    }
  };

  // After 2.5 s, mark unresponding devices as not found
  setTimeout(() => {
    if (!watchSeen) {
      watchDot.className = 'status-dot pending';
      watchSub.textContent = 'Open watch.html to connect';
    }
    if (!mobSeen) {
      mobDot.className = 'status-dot pending';
      mobSub.textContent = 'Open mobile.html to connect';
    }
  }, 2500);
}
