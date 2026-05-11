// ── Zone definitions ──
const ZONES = [
  { name: 'REST',     min: 30,  max: 59,  color: '#4fc3f7', bg: '#060d14', desc: 'Deep rest state. Common during sleep or meditative calm. Heart is functioning at minimal exertion.' },
  { name: 'NORMAL',   min: 60,  max: 99,  color: '#00e5ff', bg: '#0a0e1a', desc: 'Normal resting heart rate. Cardiovascular system is operating efficiently at this range.' },
  { name: 'WARM-UP',  min: 100, max: 114, color: '#69f0ae', bg: '#071208', desc: 'Light activity zone. Increased circulation begins; suitable for warm-up routines and light movement.' },
  { name: 'FAT BURN', min: 115, max: 134, color: '#ffeb3b', bg: '#141000', desc: 'Optimal fat oxidation zone. Body draws primarily on fat stores for fuel at this intensity.' },
  { name: 'CARDIO',   min: 135, max: 159, color: '#ffa726', bg: '#140900', desc: 'Aerobic conditioning zone. Significant cardiovascular and endurance improvements occur here.' },
  { name: 'PEAK',     min: 160, max: 179, color: '#ef5350', bg: '#140404', desc: 'High-intensity exertion. Maximum VO₂ engagement; sustainable only for short intervals.' },
  { name: 'DANGER',   min: 180, max: 220, color: '#e040fb', bg: '#100010', desc: 'Extreme zone. Exceeds safe aerobic capacity for most individuals. Exercise extreme caution.' },
];

const MUSICAL_TEMPOS = [
  { name: 'Grave',       max: 39  },
  { name: 'Largo',       max: 54  },
  { name: 'Larghetto',   max: 62  },
  { name: 'Adagio',      max: 75  },
  { name: 'Andante',     max: 107 },
  { name: 'Moderato',    max: 119 },
  { name: 'Allegretto',  max: 135 },
  { name: 'Allegro',     max: 167 },
  { name: 'Vivace',      max: 179 },
  { name: 'Presto',      max: 199 },
  { name: 'Prestissimo', max: 999 },
];

// ── BroadcastChannel — sync with mobile & watch pages ──
const syncChannel = new BroadcastChannel('heartsync-sync');
let connectedPages = new Set();

syncChannel.onmessage = (e) => {
  if (e.data.type === 'heartdata' && e.data.source !== 'web') {
    // Receiving live data from watch page — update display without re-broadcasting
    applyBPM(e.data.bpm, true);
    if (e.data.rrIntervals && e.data.rrIntervals.length) {
      rrIntervals = [...e.data.rrIntervals];
      updateHRVDisplay();
      drawSparkline();
    }
    updateConnectionStatus('watch');
  }
  if (e.data.type === 'ping') {
    connectedPages.add(e.data.source);
    updateConnectionBadges();
    syncChannel.postMessage({ type: 'pong', source: 'web' });
  }
  if (e.data.type === 'pong') {
    connectedPages.add(e.data.source);
    updateConnectionBadges();
  }
};

function broadcastHeartData() {
  syncChannel.postMessage({
    type: 'heartdata',
    source: 'web',
    bpm,
    rrIntervals: [...rrIntervals],
  });
}

function pingOtherPages() {
  syncChannel.postMessage({ type: 'ping', source: 'web' });
}

function updateConnectionStatus(source) {
  const bar = document.getElementById('conn-bar');
  const dot = document.getElementById('conn-dot');
  const txt = document.getElementById('conn-text');
  if (!bar) return;
  bar.style.display = 'flex';
  dot.classList.add('live');
  txt.textContent = source === 'watch' ? 'Receiving live data from Watch app' : 'Synced';
  clearTimeout(updateConnectionStatus._timer);
  updateConnectionStatus._timer = setTimeout(() => {
    dot.classList.remove('live');
    txt.textContent = 'No active sync';
  }, 6000);
}

function updateConnectionBadges() {
  const mobile = connectedPages.has('mobile');
  const watch  = connectedPages.has('watch');
  const mEl = document.getElementById('badge-mobile');
  const wEl = document.getElementById('badge-watch');
  if (mEl) mEl.classList.toggle('connected', mobile);
  if (wEl) wEl.classList.toggle('connected', watch);
}

// ── State ──
let bpm = 72;
let vibActive = false;
let vibTimer = null;
let tapTimes = [];
let tapResetTimer = null;
let beatDotIndex = 0;
let beatDotTimer = null;
let dotCount = 0;

// ── HRV State ──
const RR_WINDOW = 30;
let rrIntervals = [];
let rrPlaybackIdx = 0;
let hrvTimer = null;
let ecgBeatInterval = 833;
let ecgBeatIntervalTarget = 833;

// ── Session History (for extended analytics timeline) ──
const SESSION_MAX = 72;   // 6 minutes at 5s intervals
const sessionHistory = [];
let historyTimer = null;

// ── DOM refs ──
const bpmDisplay  = document.getElementById('bpm-display');
const bpmSlider   = document.getElementById('bpm-slider');
const tapBtn      = document.getElementById('tap-btn');
const tapStatus   = document.getElementById('tap-status');
const zoneName    = document.getElementById('zone-name');
const zoneDesc    = document.getElementById('zone-desc');
const rrVal       = document.getElementById('rr-val');
const freqVal     = document.getElementById('freq-val');
const tempoVal    = document.getElementById('tempo-val');
const musicVal    = document.getElementById('music-val');
const vibOn       = document.getElementById('vib-on');
const vibOff      = document.getElementById('vib-off');
const vibBpm      = document.getElementById('vib-bpm');
const vibStartBtn = document.getElementById('vib-start-btn');
const vibStopBtn  = document.getElementById('vib-stop-btn');
const dotsRow     = document.getElementById('dots-row');
const canvas      = document.getElementById('ecg-canvas');
const ctx         = canvas.getContext('2d');

// ── Helpers ──
function getZone(b) {
  return ZONES.find(z => b >= z.min && b <= z.max) || ZONES[1];
}
function getMusical(b) {
  return (MUSICAL_TEMPOS.find(t => b <= t.max) || MUSICAL_TEMPOS.at(-1)).name;
}
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}
function gaussNoise() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0*Math.log(u))*Math.cos(2.0*Math.PI*v);
}

// ── Apply BPM ──
function applyBPM(newBpm, fromSync = false) {
  bpm = Math.round(newBpm);
  bpmDisplay.textContent = bpm;
  bpmSlider.value = bpm;

  const rr   = Math.round(60000 / bpm);
  const freq = (bpm / 60).toFixed(2);
  rrVal.textContent    = rr;
  freqVal.textContent  = freq;
  tempoVal.textContent = rr;
  musicVal.textContent = getMusical(bpm);

  const onMs  = Math.min(Math.round(rr*0.3), 200);
  const offMs = rr - onMs;
  vibOn.textContent  = onMs;
  vibOff.textContent = offMs;
  vibBpm.textContent = bpm;

  const zone = getZone(bpm);
  document.documentElement.style.setProperty('--zone-color', zone.color);
  document.documentElement.style.setProperty('--zone-bg', zone.bg);
  document.documentElement.style.setProperty('--zone-glow', hexToRgba(zone.color, 0.3));
  zoneName.textContent = zone.name;
  zoneDesc.textContent = zone.desc;
  ecgBeatIntervalTarget = rr;

  rebuildDots();
  restartDotSequencer();
  if (!fromSync) restartHRVLoop();
  if (vibActive) restartVibration();
  if (!fromSync) broadcastHeartData();
}

// ── Slider ──
bpmSlider.addEventListener('input', () => applyBPM(parseInt(bpmSlider.value)));

// ── Tap Detection ──
tapBtn.addEventListener('click', () => {
  const now = performance.now();
  tapTimes.push(now);
  tapBtn.classList.add('tapped');
  setTimeout(() => tapBtn.classList.remove('tapped'), 120);
  clearTimeout(tapResetTimer);
  tapResetTimer = setTimeout(() => { tapTimes = []; tapStatus.textContent = 'Tap reset. Start tapping again.'; }, 3000);

  if (tapTimes.length < 2) { tapStatus.textContent = `${tapTimes.length} tap — keep going...`; return; }

  const intervals = [];
  for (let i = 1; i < tapTimes.length; i++) intervals.push(tapTimes[i]-tapTimes[i-1]);
  const avgInterval = intervals.reduce((a,b) => a+b) / intervals.length;
  const clamped = Math.max(30, Math.min(220, Math.round(60000/avgInterval)));

  if (tapTimes.length >= 4) {
    applyBPM(clamped);
    tapStatus.textContent = `Detected: ${clamped} BPM (${tapTimes.length} taps)`;
  } else {
    tapStatus.textContent = `${tapTimes.length} taps — ${4-tapTimes.length} more needed`;
  }
});

// ── HRV Engine ──
function generateRR() {
  const base = 60000/bpm, sdnnSim = Math.max(8, 78-bpm*0.36);
  return Math.max(250, Math.round(base+gaussNoise()*sdnnSim));
}
function pushRR(rr) {
  rrIntervals.push(rr);
  if (rrIntervals.length > RR_WINDOW) rrIntervals.shift();
  ecgBeatIntervalTarget = rr;
  updateHRVDisplay();
  drawSparkline();
  broadcastHeartData();
}
function calcSDNN() {
  if (rrIntervals.length < 2) return 0;
  const mean = rrIntervals.reduce((a,b)=>a+b)/rrIntervals.length;
  return Math.round(Math.sqrt(rrIntervals.reduce((s,v)=>s+(v-mean)**2,0)/rrIntervals.length));
}
function calcRMSSD() {
  if (rrIntervals.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < rrIntervals.length; i++) sum += (rrIntervals[i]-rrIntervals[i-1])**2;
  return Math.round(Math.sqrt(sum/(rrIntervals.length-1)));
}
function calcPNN50() {
  if (rrIntervals.length < 2) return 0;
  let count = 0;
  for (let i = 1; i < rrIntervals.length; i++) if (Math.abs(rrIntervals[i]-rrIntervals[i-1])>50) count++;
  return Math.round(count/(rrIntervals.length-1)*100);
}
function classifyRhythm(sdnn) {
  if (sdnn >= 50) return { label: 'COHERENT', color: '#69f0ae' };
  if (sdnn >= 30) return { label: 'VARIABLE', color: '#00e5ff' };
  if (sdnn >= 15) return { label: 'REDUCED',  color: '#ffa726' };
  return             { label: 'RIGID',     color: '#ef5350' };
}
function updateHRVDisplay() {
  const sdnn = calcSDNN(), rmssd = calcRMSSD(), pnn50 = calcPNN50();
  const rhythm = classifyRhythm(sdnn);
  const el = (id) => document.getElementById(id);
  if (el('sdnn-val'))   el('sdnn-val').textContent  = sdnn;
  if (el('rmssd-val'))  el('rmssd-val').textContent = rmssd;
  if (el('pnn50-val'))  el('pnn50-val').textContent = pnn50;
  if (el('rhythm-label')) { el('rhythm-label').textContent = rhythm.label; el('rhythm-label').style.color = rhythm.color; }
}
function drawSparkline() {
  const sc = document.getElementById('sparkline-canvas');
  if (!sc || rrIntervals.length < 2) return;
  sc.width = sc.offsetWidth; sc.height = sc.offsetHeight;
  const sctx = sc.getContext('2d'), W = sc.width, H = sc.height;
  const min = Math.min(...rrIntervals), max = Math.max(...rrIntervals), range = max-min||1;
  const color = getComputedStyle(document.documentElement).getPropertyValue('--zone-color').trim();
  const barW  = Math.max(3, Math.floor(W/rrIntervals.length)-2);
  sctx.clearRect(0,0,W,H);
  rrIntervals.forEach((rr,i) => {
    const barH = Math.round(((rr-min)/range)*(H-10)+10), x = Math.round(i*(W/rrIntervals.length));
    sctx.fillStyle = hexToRgba(color, 0.35+(i/rrIntervals.length)*0.5);
    sctx.beginPath(); sctx.roundRect(x, H-barH, barW, barH, 2); sctx.fill();
  });
  sctx.strokeStyle = hexToRgba(color,0.6); sctx.lineWidth = 1.5; sctx.beginPath();
  rrIntervals.forEach((rr,i) => {
    const barH = Math.round(((rr-min)/range)*(H-10)+10);
    const x = Math.round(i*(W/rrIntervals.length))+barW/2;
    i===0 ? sctx.moveTo(x,H-barH) : sctx.lineTo(x,H-barH);
  });
  sctx.stroke();
}
function restartHRVLoop() {
  clearTimeout(hrvTimer); scheduleNextBeat();
}
function scheduleNextBeat() {
  const rr = generateRR(); pushRR(rr);
  hrvTimer = setTimeout(scheduleNextBeat, rr);
}

// ── Beat Dot Sequencer ──
function rebuildDots() {
  const count = Math.max(4, Math.min(32, Math.round(bpm/10)));
  if (count === dotCount) return;
  dotCount = count; dotsRow.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const d = document.createElement('div'); d.className = 'beat-dot'; dotsRow.appendChild(d);
  }
  beatDotIndex = 0;
}
function tickDot() {
  const dots = dotsRow.querySelectorAll('.beat-dot'); if (!dots.length) return;
  dots.forEach(d => d.classList.remove('lit'));
  beatDotIndex = (beatDotIndex+1)%dots.length;
  dots[beatDotIndex].classList.add('lit');
}
function restartDotSequencer() {
  clearInterval(beatDotTimer); tickDot();
  beatDotTimer = setInterval(tickDot, 60000/bpm);
}

// ── Vibration Engine (exact RR mirror) ──
function scheduleVibLoop() {
  if (!vibActive) return;
  const rr = rrIntervals.length > 0 ? rrIntervals[rrPlaybackIdx%rrIntervals.length] : Math.round(60000/bpm);
  rrPlaybackIdx++;
  const onMs = Math.min(Math.round(rr*0.3), 200);
  if (navigator.vibrate) navigator.vibrate([onMs, rr-onMs]);
  vibTimer = setTimeout(scheduleVibLoop, rr);
}
function restartVibration() { clearTimeout(vibTimer); if (vibActive) scheduleVibLoop(); }

vibStartBtn.addEventListener('click', () => {
  if (!navigator.vibrate) { document.getElementById('vib-note').textContent = 'Vibration API not supported on this device/browser.'; return; }
  vibActive = true; vibStartBtn.classList.add('active'); vibStopBtn.classList.remove('active');
  scheduleVibLoop();
});
vibStopBtn.addEventListener('click', () => {
  vibActive = false; clearTimeout(vibTimer);
  if (navigator.vibrate) navigator.vibrate(0);
  vibStartBtn.classList.remove('active'); vibStopBtn.classList.add('active');
  setTimeout(() => vibStopBtn.classList.remove('active'), 400);
});

// ── Session History & Timeline ──
function recordHistory() {
  sessionHistory.push({ t: Date.now(), bpm, sdnn: calcSDNN() });
  if (sessionHistory.length > SESSION_MAX) sessionHistory.shift();
  drawTimeline();
  historyTimer = setTimeout(recordHistory, 5000);
}

function drawTimeline() {
  const tc = document.getElementById('timeline-canvas');
  if (!tc || sessionHistory.length < 2) return;
  tc.width = tc.offsetWidth; tc.height = tc.offsetHeight;
  const tctx = tc.getContext('2d'), W = tc.width, H = tc.height;
  const bpms  = sessionHistory.map(d => d.bpm);
  const sdnns = sessionHistory.map(d => d.sdnn);
  const minB  = Math.max(0, Math.min(...bpms)-10), maxB = Math.min(220, Math.max(...bpms)+10);
  const bRange = maxB - minB || 1;

  tctx.clearRect(0,0,W,H);

  // Zone background bands
  const zoneRanges = [[30,59,'#4fc3f7'],[60,99,'#00e5ff'],[100,114,'#69f0ae'],[115,134,'#ffeb3b'],[135,159,'#ffa726'],[160,179,'#ef5350'],[180,220,'#e040fb']];
  zoneRanges.forEach(([lo,hi,col]) => {
    const y1 = H - ((Math.min(hi,maxB)-minB)/bRange)*(H-20)-10;
    const y2 = H - ((Math.max(lo,minB)-minB)/bRange)*(H-20)-10;
    if (y2 > y1) { tctx.fillStyle = hexToRgba(col,0.05); tctx.fillRect(0, y1, W, y2-y1); }
  });

  // SDNN line (secondary, dashed, dim)
  if (sdnns.some(s => s > 0)) {
    const maxS = Math.max(...sdnns)||1;
    tctx.setLineDash([3,4]);
    tctx.strokeStyle = 'rgba(255,255,255,0.15)';
    tctx.lineWidth = 1;
    tctx.beginPath();
    sessionHistory.forEach((d,i) => {
      const x = (i/(sessionHistory.length-1))*W;
      const y = H - (d.sdnn/maxS)*(H-20)-5;
      i===0 ? tctx.moveTo(x,y) : tctx.lineTo(x,y);
    });
    tctx.stroke();
    tctx.setLineDash([]);
  }

  // BPM line
  const color = getComputedStyle(document.documentElement).getPropertyValue('--zone-color').trim();

  // Gradient fill under BPM line
  const grad = tctx.createLinearGradient(0,0,0,H);
  grad.addColorStop(0, hexToRgba(color, 0.25));
  grad.addColorStop(1, hexToRgba(color, 0));
  tctx.beginPath();
  sessionHistory.forEach((d,i) => {
    const x = (i/(sessionHistory.length-1))*W;
    const y = H - ((d.bpm-minB)/bRange)*(H-20)-10;
    i===0 ? tctx.moveTo(x,y) : tctx.lineTo(x,y);
  });
  tctx.lineTo(W, H); tctx.lineTo(0, H); tctx.closePath();
  tctx.fillStyle = grad; tctx.fill();

  tctx.strokeStyle = color;
  tctx.lineWidth   = 2;
  tctx.shadowColor = color;
  tctx.shadowBlur  = 5;
  tctx.beginPath();
  sessionHistory.forEach((d,i) => {
    const x = (i/(sessionHistory.length-1))*W;
    const y = H - ((d.bpm-minB)/bRange)*(H-20)-10;
    i===0 ? tctx.moveTo(x,y) : tctx.lineTo(x,y);
  });
  tctx.stroke();
  tctx.shadowBlur = 0;

  // Session stats overlay
  const avgBPM  = Math.round(bpms.reduce((a,b)=>a+b)/bpms.length);
  const avgSDNN = Math.round(sdnns.filter(s=>s>0).reduce((a,b)=>a+b, 0) / (sdnns.filter(s=>s>0).length||1));
  const mins    = Math.floor(sessionHistory.length*5/60);
  const secs    = (sessionHistory.length*5)%60;

  const statsEl = document.getElementById('session-stats');
  if (statsEl) {
    statsEl.innerHTML = `
      <span>Avg BPM <strong>${avgBPM}</strong></span>
      <span>Avg SDNN <strong>${avgSDNN}ms</strong></span>
      <span>Duration <strong>${mins}m ${secs}s</strong></span>
      <span>Beats recorded <strong>${sessionHistory.length * Math.round(bpm/12)}</strong></span>
    `;
  }
}

// ── ECG Waveform ──
let ecgX = 0;
const ECG_LINE_COLOR = () => getComputedStyle(document.documentElement).getPropertyValue('--zone-color').trim();

function resizeCanvas() { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; }

function ecgSample(phase) {
  if (phase < 0.15) return 0.15*Math.sin(Math.PI*(phase/0.15));
  if (phase < 0.22) return 0;
  if (phase < 0.26) return -0.15*Math.sin(Math.PI*((phase-0.22)/0.04));
  if (phase < 0.38) return       Math.sin(Math.PI*((phase-0.26)/0.12));
  if (phase < 0.45) return -0.25*Math.sin(Math.PI*((phase-0.38)/0.07));
  if (phase < 0.55) return 0;
  if (phase < 0.80) return  0.35*Math.sin(Math.PI*((phase-0.55)/0.25));
  return 0;
}

let lastFrameTime = 0;
function drawECG(timestamp) {
  const dt = timestamp - lastFrameTime; lastFrameTime = timestamp;
  ecgBeatInterval += (ecgBeatIntervalTarget-ecgBeatInterval)*0.08;

  const W = canvas.width, H = canvas.height, mid = H/2, amp = H*0.38;
  const pxPerMs = (W/4000)*(bpm/60);
  const advance = pxPerMs*dt;

  const imageData = ctx.getImageData(Math.ceil(advance), 0, W-Math.ceil(advance), H);
  ctx.putImageData(imageData, 0, 0);
  ctx.clearRect(W-Math.ceil(advance)-1, 0, Math.ceil(advance)+2, H);
  ecgX += advance;

  const color = ECG_LINE_COLOR();
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.shadowColor = color; ctx.shadowBlur = 6;
  ctx.beginPath();
  let first = true;
  for (let px = W-advance-2; px <= W+1; px++) {
    const globalMs = (ecgX-(W-px))/pxPerMs;
    const phase = ((globalMs%ecgBeatInterval)+ecgBeatInterval)%ecgBeatInterval/ecgBeatInterval;
    const y = mid - ecgSample(phase)*amp;
    first ? (ctx.moveTo(px,y), first=false) : ctx.lineTo(px,y);
  }
  ctx.stroke(); ctx.shadowBlur = 0;
  requestAnimationFrame(drawECG);
}

// ── Init ──
window.addEventListener('resize', resizeCanvas);
resizeCanvas();
applyBPM(72);
recordHistory();
pingOtherPages();
requestAnimationFrame(drawECG);
