// ── Zone definitions ──
const ZONES = [
  { name: 'REST',     min: 30,  max: 59,  color: '#4fc3f7', bg: '#060d14' },
  { name: 'NORMAL',   min: 60,  max: 99,  color: '#00e5ff', bg: '#0a0e1a' },
  { name: 'WARM-UP',  min: 100, max: 114, color: '#69f0ae', bg: '#071208' },
  { name: 'FAT BURN', min: 115, max: 134, color: '#ffeb3b', bg: '#141000' },
  { name: 'CARDIO',   min: 135, max: 159, color: '#ffa726', bg: '#140900' },
  { name: 'PEAK',     min: 160, max: 179, color: '#ef5350', bg: '#140404' },
  { name: 'DANGER',   min: 180, max: 220, color: '#e040fb', bg: '#100010' },
];

// ── State ──
let wBpm = 72;
let rrIntervals = [];
let rrPlaybackIdx = 0;
let hrvTimer = null;
let hapticActive = false;
let hapticTimer = null;
let currentScreen = 0;
let ecgBeatInterval = 833;
let ecgBeatIntervalTarget = 833;

// ── DOM refs ──
const screensTrack  = document.getElementById('screens-track');
const navDots       = document.querySelectorAll('.ndot');
const bpmSlider     = document.getElementById('w-bpm-slider');
const simVal        = document.getElementById('sim-val');
const prevBtn       = document.getElementById('prev-btn');
const nextBtn       = document.getElementById('next-btn');
const inavCount     = document.getElementById('inav-count');
const hapticBtn     = document.getElementById('s-haptic-btn');
const hapticStatus  = document.getElementById('s-haptic-status');
const hapticIcon    = document.getElementById('s-haptic-icon');
const ecgCanvas     = document.getElementById('s-ecg');
const sparkCanvas   = document.getElementById('s-sparkline');
const ecgCtx        = ecgCanvas ? ecgCanvas.getContext('2d') : null;

const SCREEN_INFO = [
  { name: 'Live Monitor',    desc: 'Real-time BPM, zone classification, and live ECG trace from your Apple Watch heart rate sensor.' },
  { name: 'HRV Signature',   desc: 'Heart Rate Variability metrics — SDNN, RMSSD, and pNN50 — calculated from your live beat sequence. Each person\'s values are unique.' },
  { name: 'Beat Pattern',    desc: 'Your cardiac rhythm fingerprint. Each bar represents one R-R interval. The variation pattern is unique to you.' },
  { name: 'Haptic Mirror',   desc: 'The Taptic Engine fires at the exact timing of each real heartbeat — you physically feel your own cardiac rhythm, variability and all.' },
];

// ── Helpers ──
function getZone(b) {
  return ZONES.find(z => b >= z.min && b <= z.max) || ZONES[1];
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function gaussNoise() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function setCSSVar(name, value) {
  document.documentElement.style.setProperty(name, value);
}

// ── Apply BPM ──
function applyBPM(newBpm) {
  wBpm = Math.round(newBpm);
  simVal.textContent = wBpm;
  bpmSlider.value = wBpm;

  const zone = getZone(wBpm);
  setCSSVar('--zc', zone.color);
  setCSSVar('--zg', hexToRgba(zone.color, 0.3));

  const rr = Math.round(60000 / wBpm);
  ecgBeatIntervalTarget = rr;

  // Update screen 1
  const el = (id) => document.getElementById(id);
  el('s-bpm').textContent     = wBpm;
  el('s-rr-val').textContent  = rr;
  el('s-zone-name').textContent = zone.name;

  restartHRVLoop();
}

// ── Screen Navigation ──
function goToScreen(i) {
  currentScreen = Math.max(0, Math.min(3, i));
  screensTrack.style.transform = `translateX(-${currentScreen * 25}%)`;

  navDots.forEach((d, idx) => d.classList.toggle('active', idx === currentScreen));

  const info = SCREEN_INFO[currentScreen];
  document.getElementById('info-screen-name').textContent = info.name;
  document.getElementById('info-desc').textContent        = info.desc;
  inavCount.textContent = `${currentScreen + 1} / 4`;

  // Highlight active feature item
  document.querySelectorAll('.if-item').forEach((el, idx) => {
    el.classList.toggle('active', idx === currentScreen);
  });
}

navDots.forEach(d => d.addEventListener('click', () => goToScreen(+d.dataset.i)));
prevBtn.addEventListener('click', () => goToScreen(currentScreen - 1));
nextBtn.addEventListener('click', () => goToScreen(currentScreen + 1));

// ── HRV Engine ──
function generateRR() {
  const base     = 60000 / wBpm;
  const sdnnSim  = Math.max(8, 78 - wBpm * 0.36);
  return Math.max(250, Math.round(base + gaussNoise() * sdnnSim));
}

function pushRR(rr) {
  rrIntervals.push(rr);
  if (rrIntervals.length > 30) rrIntervals.shift();
  ecgBeatIntervalTarget = rr;
  updateHRVDisplay();
  drawSparkline();
  broadcastHeartData();
}

function calcSDNN() {
  if (rrIntervals.length < 2) return 0;
  const mean     = rrIntervals.reduce((a, b) => a + b) / rrIntervals.length;
  const variance = rrIntervals.reduce((s, v) => s + (v - mean) ** 2, 0) / rrIntervals.length;
  return Math.round(Math.sqrt(variance));
}

function calcRMSSD() {
  if (rrIntervals.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < rrIntervals.length; i++) sum += (rrIntervals[i] - rrIntervals[i - 1]) ** 2;
  return Math.round(Math.sqrt(sum / (rrIntervals.length - 1)));
}

function calcPNN50() {
  if (rrIntervals.length < 2) return 0;
  let count = 0;
  for (let i = 1; i < rrIntervals.length; i++) {
    if (Math.abs(rrIntervals[i] - rrIntervals[i - 1]) > 50) count++;
  }
  return Math.round((count / (rrIntervals.length - 1)) * 100);
}

function classifyRhythm(sdnn) {
  if (sdnn >= 50) return { label: 'COHERENT',  color: '#69f0ae' };
  if (sdnn >= 30) return { label: 'VARIABLE',  color: '#00e5ff' };
  if (sdnn >= 15) return { label: 'REDUCED',   color: '#ffa726' };
  return             { label: 'RIGID',      color: '#ef5350' };
}

function updateHRVDisplay() {
  const sdnn   = calcSDNN();
  const rmssd  = calcRMSSD();
  const pnn50  = calcPNN50();
  const rhythm = classifyRhythm(sdnn);

  const el = (id) => document.getElementById(id);
  el('s-sdnn').textContent  = sdnn;
  el('s-rmssd').textContent = rmssd;
  el('s-pnn50').textContent = pnn50;

  const badge = el('s-rhythm-badge');
  badge.textContent  = rhythm.label;
  badge.style.color  = rhythm.color;
  badge.style.borderColor = rhythm.color;

  // Update sig sub-label
  const sigSub = el('s-sig-sub');
  if (rrIntervals.length >= 5 && sigSub) {
    sigSub.textContent = `${rrIntervals.length} beats · SDNN ${sdnn}ms`;
  }
}

function drawSparkline() {
  if (!sparkCanvas || rrIntervals.length < 2) return;

  sparkCanvas.width  = sparkCanvas.offsetWidth;
  sparkCanvas.height = sparkCanvas.offsetHeight;

  const sctx  = sparkCanvas.getContext('2d');
  const W     = sparkCanvas.width;
  const H     = sparkCanvas.height;
  const min   = Math.min(...rrIntervals);
  const max   = Math.max(...rrIntervals);
  const range = max - min || 1;
  const color = getComputedStyle(document.documentElement).getPropertyValue('--zc').trim();
  const barW  = Math.max(2, Math.floor(W / rrIntervals.length) - 1);

  sctx.clearRect(0, 0, W, H);

  rrIntervals.forEach((rr, i) => {
    const barH  = Math.round(((rr - min) / range) * (H - 6) + 6);
    const x     = Math.round(i * (W / rrIntervals.length));
    const y     = H - barH;
    const alpha = 0.3 + (i / rrIntervals.length) * 0.7;
    sctx.fillStyle = hexToRgba(color, alpha);
    sctx.beginPath();
    sctx.roundRect(x, y, barW, barH, 1);
    sctx.fill();
  });

  // Connecting line
  sctx.strokeStyle = hexToRgba(color, 0.7);
  sctx.lineWidth   = 1;
  sctx.beginPath();
  rrIntervals.forEach((rr, i) => {
    const barH = Math.round(((rr - min) / range) * (H - 6) + 6);
    const x    = Math.round(i * (W / rrIntervals.length)) + barW / 2;
    const y    = H - barH;
    i === 0 ? sctx.moveTo(x, y) : sctx.lineTo(x, y);
  });
  sctx.stroke();
}

function restartHRVLoop() {
  clearTimeout(hrvTimer);
  scheduleNextBeat();
}

function scheduleNextBeat() {
  const rr = generateRR();
  pushRR(rr);
  hrvTimer = setTimeout(scheduleNextBeat, rr);
}

// ── Haptic Mirror ──
function scheduleHapticLoop() {
  if (!hapticActive) return;
  const rr   = rrIntervals.length > 0 ? rrIntervals[rrPlaybackIdx % rrIntervals.length] : Math.round(60000 / wBpm);
  rrPlaybackIdx++;
  const onMs = Math.min(Math.round(rr * 0.3), 200);
  if (navigator.vibrate) navigator.vibrate([onMs, rr - onMs]);
  hapticTimer = setTimeout(scheduleHapticLoop, rr);
}

hapticBtn.addEventListener('click', () => {
  hapticActive = !hapticActive;

  hapticBtn.textContent = hapticActive ? 'STOP' : 'START';
  hapticBtn.classList.toggle('active', hapticActive);
  hapticStatus.textContent = hapticActive ? 'ON' : 'OFF';
  hapticStatus.classList.toggle('on', hapticActive);
  hapticIcon.classList.toggle('beating', hapticActive);

  if (hapticActive) {
    scheduleHapticLoop();
  } else {
    clearTimeout(hapticTimer);
    if (navigator.vibrate) navigator.vibrate(0);
  }
});

// ── ECG Waveform (watch) ──
let ecgX = 0;
let lastFrame = 0;

function resizeECG() {
  if (!ecgCanvas) return;
  ecgCanvas.width  = ecgCanvas.offsetWidth;
  ecgCanvas.height = ecgCanvas.offsetHeight;
}

function ecgSample(phase) {
  if (phase < 0.15) return 0.15 * Math.sin(Math.PI * (phase / 0.15));
  if (phase < 0.22) return 0;
  if (phase < 0.26) return -0.15 * Math.sin(Math.PI * ((phase - 0.22) / 0.04));
  if (phase < 0.38) return        Math.sin(Math.PI * ((phase - 0.26) / 0.12));
  if (phase < 0.45) return -0.25 * Math.sin(Math.PI * ((phase - 0.38) / 0.07));
  if (phase < 0.55) return 0;
  if (phase < 0.80) return  0.35 * Math.sin(Math.PI * ((phase - 0.55) / 0.25));
  return 0;
}

function drawECG(ts) {
  if (!ecgCtx || !ecgCanvas) { requestAnimationFrame(drawECG); return; }

  const dt = ts - lastFrame;
  lastFrame = ts;

  ecgBeatInterval += (ecgBeatIntervalTarget - ecgBeatInterval) * 0.08;

  const W       = ecgCanvas.width;
  const H       = ecgCanvas.height;
  const mid     = H / 2;
  const amp     = H * 0.4;
  const pxPerMs = (W / 3000) * (wBpm / 60);
  const advance = pxPerMs * dt;

  const img = ecgCtx.getImageData(Math.ceil(advance), 0, W - Math.ceil(advance), H);
  ecgCtx.putImageData(img, 0, 0);
  ecgCtx.clearRect(W - Math.ceil(advance) - 1, 0, Math.ceil(advance) + 2, H);

  ecgX += advance;

  const color = getComputedStyle(document.documentElement).getPropertyValue('--zc').trim();
  ecgCtx.strokeStyle = color;
  ecgCtx.lineWidth   = 1.5;
  ecgCtx.shadowColor = color;
  ecgCtx.shadowBlur  = 4;

  ecgCtx.beginPath();
  let first = true;
  for (let px = W - advance - 2; px <= W + 1; px++) {
    const globalMs = (ecgX - (W - px)) / pxPerMs;
    const phase    = ((globalMs % ecgBeatInterval) + ecgBeatInterval) % ecgBeatInterval / ecgBeatInterval;
    const y        = mid - ecgSample(phase) * amp;
    if (first) { ecgCtx.moveTo(px, y); first = false; }
    else ecgCtx.lineTo(px, y);
  }
  ecgCtx.stroke();
  ecgCtx.shadowBlur = 0;

  requestAnimationFrame(drawECG);
}

// ── BroadcastChannel — broadcast to mobile & web ──
const syncChannel = new BroadcastChannel('heartsync-sync');

function broadcastHeartData() {
  syncChannel.postMessage({
    type: 'heartdata',
    source: 'watch',
    bpm: wBpm,
    rrIntervals: [...rrIntervals],
  });
}

syncChannel.onmessage = (e) => {
  if (e.data.type === 'ping') {
    syncChannel.postMessage({ type: 'pong', source: 'watch' });
  }
};

function updateSyncIndicator(on) {
  const dot = document.getElementById('w-sync-dot');
  const lbl = document.getElementById('w-sync-label');
  if (dot) dot.classList.toggle('live', on);
  if (lbl) lbl.textContent = on ? 'BROADCASTING' : 'IDLE';
}

// ── Slider ──
bpmSlider.addEventListener('input', () => applyBPM(parseInt(bpmSlider.value)));

// ── Init ──
window.addEventListener('resize', resizeECG);
resizeECG();
goToScreen(0);
applyBPM(72);
updateSyncIndicator(true);
requestAnimationFrame(drawECG);
