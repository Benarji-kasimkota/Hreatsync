// ── Shared zone data ──
const ZONES = [
  { name: 'REST',     min: 30,  max: 59,  color: '#ef9a9a', bg: '#0f0303', desc: 'Deep rest state' },
  { name: 'NORMAL',   min: 60,  max: 99,  color: '#e53935', bg: '#0f0505', desc: 'Normal resting range' },
  { name: 'WARM-UP',  min: 100, max: 114, color: '#ff7043', bg: '#150600', desc: 'Light activity zone' },
  { name: 'FAT BURN', min: 115, max: 134, color: '#ff8f00', bg: '#160900', desc: 'Fat oxidation zone' },
  { name: 'CARDIO',   min: 135, max: 159, color: '#f4511e', bg: '#160400', desc: 'Aerobic conditioning' },
  { name: 'PEAK',     min: 160, max: 179, color: '#b71c1c', bg: '#120000', desc: 'High-intensity exertion' },
  { name: 'DANGER',   min: 180, max: 220, color: '#880e4f', bg: '#100008', desc: 'Extreme — use caution' },
];

// ── State ──
let bpm = 72;
let rrIntervals = [];
let hrvTimer = null;
let hapticActive = false;
let hapticTimer = null;
let rrPlaybackIdx = 0;
let ecgBeatInterval = 833;
let ecgBeatIntervalTarget = 833;
let tapTimes = [];
let tapResetTimer = null;
let liveMode = false;           // true when receiving from watch/web page

// ── BroadcastChannel — receive data from watch.html or index.html ──
const syncChannel = new BroadcastChannel('heartsync-sync');
syncChannel.onmessage = (e) => {
  if (e.data.type === 'heartdata') {
    liveMode = true;
    setLiveUI(true);
    applyBPM(e.data.bpm, true);
    if (e.data.rrIntervals && e.data.rrIntervals.length) {
      rrIntervals = [...e.data.rrIntervals];
      updateHRVDisplay();
      drawSparkline();
    }
  }
};

// Stop live mode if no message received for 6 seconds
let liveTimeout = null;
function resetLiveTimeout() {
  clearTimeout(liveTimeout);
  liveTimeout = setTimeout(() => {
    liveMode = false;
    setLiveUI(false);
  }, 6000);
}

function setLiveUI(live) {
  const dot   = document.getElementById('sync-dot');
  const label = document.getElementById('sync-label');
  const manual = document.getElementById('manual-section');
  dot.classList.toggle('live', live);
  label.classList.toggle('live', live);
  label.textContent = live ? 'LIVE SYNC' : 'STANDALONE';
  manual.style.opacity = live ? '0.4' : '1';
  manual.style.pointerEvents = live ? 'none' : 'auto';
}

// ── DOM refs ──
const el = (id) => document.getElementById(id);

// ── Helpers ──
function getZone(b) {
  return ZONES.find(z => b >= z.min && b <= z.max) || ZONES[1];
}
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}
function gaussNoise() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}
function setCSSVar(name, val) {
  document.documentElement.style.setProperty(name, val);
}

// ── Apply BPM ──
function applyBPM(newBpm, fromSync = false) {
  bpm = Math.round(newBpm);
  el('m-bpm').textContent    = bpm;
  el('manual-val').textContent = bpm;
  if (!fromSync) document.getElementById('m-slider').value = bpm;

  const rr   = Math.round(60000 / bpm);
  const freq = (bpm / 60).toFixed(2);
  el('m-rr').textContent   = rr;
  el('m-freq').textContent = freq;

  const zone = getZone(bpm);
  setCSSVar('--zc', zone.color);
  setCSSVar('--zg', hexToRgba(zone.color, 0.25));
  setCSSVar('--bg', zone.bg);

  el('zs-dot').style.background  = zone.color;
  el('zs-dot').style.boxShadow   = `0 0 8px ${hexToRgba(zone.color,0.6)}`;
  el('zs-name').textContent       = zone.name;
  el('zs-desc').textContent       = zone.desc;

  ecgBeatIntervalTarget = rr;
  drawRing();

  if (!fromSync) {
    restartHRVLoop();
    syncChannel.postMessage({ type: 'heartdata', bpm, rrIntervals: [...rrIntervals] });
  }
  if (hapticActive) restartHaptic();
}

// ── BPM Ring canvas ──
function drawRing() {
  const rc   = document.getElementById('ring-canvas');
  if (!rc) return;
  const size = rc.offsetWidth;
  rc.width   = size;
  rc.height  = size;
  const ctx  = rc.getContext('2d');
  const cx   = size / 2, cy = size / 2, R = size / 2 - 8;
  const pct  = (bpm - 30) / (220 - 30);

  ctx.clearRect(0, 0, size, size);

  // Track ring
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth   = 6;
  ctx.stroke();

  // Progress arc
  const color = getComputedStyle(document.documentElement).getPropertyValue('--zc').trim();
  ctx.beginPath();
  ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
  ctx.strokeStyle = color;
  ctx.lineWidth   = 6;
  ctx.lineCap     = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur  = 12;
  ctx.stroke();
  ctx.shadowBlur  = 0;
}

// ── HRV Engine ──
function generateRR() {
  const base    = 60000 / bpm;
  const sdnnSim = Math.max(8, 78 - bpm * 0.36);
  return Math.max(250, Math.round(base + gaussNoise() * sdnnSim));
}
let _beatCount = 0;
function pushRR(rr) {
  rrIntervals.push(rr);
  if (rrIntervals.length > 30) rrIntervals.shift();
  ecgBeatIntervalTarget = rr;
  updateHRVDisplay();
  drawSparkline();
  if (typeof AUTH !== 'undefined' && ++_beatCount % 6 === 0) {
    AUTH.recordSession(bpm, calcSDNN(), calcRMSSD());
  }
}
function calcSDNN() {
  if (rrIntervals.length < 2) return 0;
  const mean = rrIntervals.reduce((a,b) => a+b) / rrIntervals.length;
  return Math.round(Math.sqrt(rrIntervals.reduce((s,v) => s+(v-mean)**2, 0) / rrIntervals.length));
}
function calcRMSSD() {
  if (rrIntervals.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < rrIntervals.length; i++) sum += (rrIntervals[i]-rrIntervals[i-1])**2;
  return Math.round(Math.sqrt(sum / (rrIntervals.length-1)));
}
function classifyRhythm(sdnn) {
  if (sdnn >= 50) return { label: 'COHERENT', color: '#69f0ae' };
  if (sdnn >= 30) return { label: 'VARIABLE', color: '#00e5ff' };
  if (sdnn >= 15) return { label: 'REDUCED',  color: '#ffa726' };
  return             { label: 'RIGID',     color: '#ef5350' };
}
function updateHRVDisplay() {
  const sdnn   = calcSDNN();
  const rhythm = classifyRhythm(sdnn);
  el('m-sdnn').textContent   = sdnn || '—';
  const rhythmEl = el('m-rhythm');
  rhythmEl.textContent  = rhythm.label;
  rhythmEl.style.color  = rhythm.color;
}
function restartHRVLoop() {
  clearTimeout(hrvTimer);
  scheduleNext();
}
function scheduleNext() {
  const rr = generateRR();
  pushRR(rr);
  hrvTimer = setTimeout(scheduleNext, rr);
}

// ── Sparkline ──
function drawSparkline() {
  const sc = el('m-spark');
  if (!sc || rrIntervals.length < 2) return;
  sc.width  = sc.offsetWidth;
  sc.height = sc.offsetHeight;
  const sctx  = sc.getContext('2d');
  const W = sc.width, H = sc.height;
  const min = Math.min(...rrIntervals), max = Math.max(...rrIntervals);
  const range = max - min || 1;
  const color = getComputedStyle(document.documentElement).getPropertyValue('--zc').trim();
  const barW  = Math.max(2, Math.floor(W / rrIntervals.length) - 1);

  sctx.clearRect(0, 0, W, H);
  rrIntervals.forEach((rr, i) => {
    const barH = Math.round(((rr-min)/range)*(H-4)+4);
    const x    = Math.round(i*(W/rrIntervals.length));
    sctx.fillStyle = hexToRgba(color, 0.3 + (i/rrIntervals.length)*0.7);
    sctx.beginPath();
    sctx.roundRect(x, H-barH, barW, barH, 1);
    sctx.fill();
  });

  sctx.strokeStyle = hexToRgba(color, 0.7);
  sctx.lineWidth   = 1;
  sctx.beginPath();
  rrIntervals.forEach((rr, i) => {
    const barH = Math.round(((rr-min)/range)*(H-4)+4);
    const x    = Math.round(i*(W/rrIntervals.length)) + barW/2;
    i === 0 ? sctx.moveTo(x, H-barH) : sctx.lineTo(x, H-barH);
  });
  sctx.stroke();
}

// ── ECG ──
const ecgCanvas = el('m-ecg');
const ecgCtx    = ecgCanvas ? ecgCanvas.getContext('2d') : null;
let ecgX = 0, lastFrame = 0;

function resizeECG() {
  if (!ecgCanvas) return;
  ecgCanvas.width  = ecgCanvas.offsetWidth;
  ecgCanvas.height = ecgCanvas.offsetHeight;
}
function ecgSample(p) {
  if (p < 0.15) return 0.15 * Math.sin(Math.PI*(p/0.15));
  if (p < 0.22) return 0;
  if (p < 0.26) return -0.15*Math.sin(Math.PI*((p-0.22)/0.04));
  if (p < 0.38) return       Math.sin(Math.PI*((p-0.26)/0.12));
  if (p < 0.45) return -0.25*Math.sin(Math.PI*((p-0.38)/0.07));
  if (p < 0.55) return 0;
  if (p < 0.80) return  0.35*Math.sin(Math.PI*((p-0.55)/0.25));
  return 0;
}
function drawECG(ts) {
  if (!ecgCtx || !ecgCanvas) { requestAnimationFrame(drawECG); return; }
  const dt = ts - lastFrame; lastFrame = ts;
  ecgBeatInterval += (ecgBeatIntervalTarget - ecgBeatInterval) * 0.08;

  const W = ecgCanvas.width, H = ecgCanvas.height;
  const mid = H/2, amp = H*0.38;
  const pxPerMs = (W/3500)*(bpm/60);
  const advance = pxPerMs*dt;

  const img = ecgCtx.getImageData(Math.ceil(advance), 0, W-Math.ceil(advance), H);
  ecgCtx.putImageData(img, 0, 0);
  ecgCtx.clearRect(W-Math.ceil(advance)-1, 0, Math.ceil(advance)+2, H);
  ecgX += advance;

  const color = getComputedStyle(document.documentElement).getPropertyValue('--zc').trim();
  ecgCtx.strokeStyle = color;
  ecgCtx.lineWidth   = 1.5;
  ecgCtx.shadowColor = color;
  ecgCtx.shadowBlur  = 5;
  ecgCtx.beginPath();
  let first = true;
  for (let px = W-advance-2; px <= W+1; px++) {
    const gms   = (ecgX-(W-px))/pxPerMs;
    const phase = ((gms%ecgBeatInterval)+ecgBeatInterval)%ecgBeatInterval/ecgBeatInterval;
    const y     = mid - ecgSample(phase)*amp;
    first ? (ecgCtx.moveTo(px,y), first=false) : ecgCtx.lineTo(px,y);
  }
  ecgCtx.stroke();
  ecgCtx.shadowBlur = 0;
  requestAnimationFrame(drawECG);
}

// ── Haptic Mirror ──
function scheduleHapticLoop() {
  if (!hapticActive) return;
  const rr   = rrIntervals.length > 0 ? rrIntervals[rrPlaybackIdx % rrIntervals.length] : Math.round(60000/bpm);
  rrPlaybackIdx++;
  const onMs = Math.min(Math.round(rr*0.3), 200);
  if (navigator.vibrate) navigator.vibrate([onMs, rr-onMs]);
  hapticTimer = setTimeout(scheduleHapticLoop, rr);
}
function restartHaptic() {
  clearTimeout(hapticTimer);
  if (hapticActive) scheduleHapticLoop();
}

el('m-haptic-btn').addEventListener('click', () => {
  hapticActive = !hapticActive;
  el('m-haptic-btn').classList.toggle('active', hapticActive);
  el('haptic-btn-text').textContent = hapticActive ? 'STOP HAPTIC MIRROR' : 'START HAPTIC MIRROR';
  el('haptic-icon').classList.toggle('beating', hapticActive);
  if (hapticActive) {
    scheduleHapticLoop();
  } else {
    clearTimeout(hapticTimer);
    if (navigator.vibrate) navigator.vibrate(0);
  }
});

// ── Manual slider ──
el('m-slider').addEventListener('input', () => {
  if (!liveMode) applyBPM(parseInt(el('m-slider').value));
});

// ── Tap detection ──
el('m-tap-btn').addEventListener('click', () => {
  if (liveMode) return;
  const now = performance.now();
  tapTimes.push(now);
  clearTimeout(tapResetTimer);
  tapResetTimer = setTimeout(() => { tapTimes = []; el('m-tap-hint').textContent = 'Tap 4+ times to calculate BPM'; }, 3000);

  if (tapTimes.length >= 4) {
    const intervals = [];
    for (let i = 1; i < tapTimes.length; i++) intervals.push(tapTimes[i]-tapTimes[i-1]);
    const avg = intervals.reduce((a,b)=>a+b)/intervals.length;
    const detected = Math.max(30, Math.min(220, Math.round(60000/avg)));
    applyBPM(detected);
    el('m-tap-hint').textContent = `Detected: ${detected} BPM`;
  } else {
    el('m-tap-hint').textContent = `${tapTimes.length} taps — ${4-tapTimes.length} more needed`;
  }
});

// ── Resize ──
window.addEventListener('resize', () => { resizeECG(); drawRing(); });

// ── Init ──
resizeECG();

// Read ?bpm= injected by iOS Shortcut or Apple Health bridge
(function applyURLParams() {
  const params = new URLSearchParams(location.search);
  const urlBpm = parseInt(params.get('bpm') || params.get('hr') || '0', 10);
  if (urlBpm >= 30 && urlBpm <= 220) {
    applyBPM(urlBpm);
    // Show a brief "from Health" indicator
    const label = el('sync-label');
    if (label) { label.textContent = 'FROM HEALTH'; label.classList.add('live'); }
    setTimeout(() => { if (label) { label.textContent = 'STANDALONE'; label.classList.remove('live'); } }, 4000);
  } else {
    applyBPM(72);
  }
})();

requestAnimationFrame(drawECG);

// ── ML stress display ──
(function initML() {
  if (typeof ML === 'undefined') return;
  ML.init();
  setInterval(async () => {
    if (!ML.isReady) return;
    const sdnn  = calcSDNN();
    const rmssd = calcRMSSD();
    const result = await ML.predict(bpm, sdnn, rmssd);
    if (!result) return;
    const stressEl = el('m-stress');
    if (stressEl) {
      stressEl.textContent  = result.stress;
      stressEl.style.color  = result.state.color;
    }
  }, 2000);
})();
