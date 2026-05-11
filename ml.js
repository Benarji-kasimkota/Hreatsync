// ml.js — ML Insights page controller
const GAUGE_ARC_LEN = 267;   // SVG arc total length (measured from path)
const STRESS_HISTORY_MAX = 60;
const BPM_TREND_MAX      = 40;

let liveBpm   = 72;
let liveSDNN  = 0;
let liveRMSSD = 0;
let livePNN50 = 0;
let liveRR    = [];
let isLive    = false;
let liveTimeout = null;

let stressHistory = [];      // [{t, stress}]
let bpmTrendBuf   = [];      // last N bpm readings for regression

let predCount = 0;
let mlInterval = null;

// ── Helpers ──
const el = id => document.getElementById(id);

function setCSSVar(name, val) {
  document.documentElement.style.setProperty(name, val);
}

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  // Show model loading state
  el('ms-dot').classList.add('loading');
  el('ms-label').textContent = 'Loading TF.js…';

  // Start receiving live data from other tabs
  initBroadcastReceiver();

  // Init ML engine
  ML.init().then(() => {
    el('ms-dot').classList.remove('loading');
    el('ms-dot').classList.add('ready');
    el('ms-label').textContent = 'Model Ready';
    startMLLoop();
  }).catch(e => {
    el('ms-label').textContent = 'Load failed';
    console.error('ML init failed:', e);
  });

  // If no live data arrives in 1.5 s, start local HRV simulation
  setTimeout(() => {
    if (!isLive) startLocalSim();
  }, 1500);
});

// ── Local HRV simulation (fallback) ──
let simTimer = null;
function gaussNoise() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function startLocalSim() {
  if (simTimer) return;
  function tick() {
    const base   = 60000 / liveBpm;
    const sdnnS  = Math.max(8, 78 - liveBpm * 0.36);
    const rr     = Math.max(250, Math.round(base + gaussNoise() * sdnnS));
    liveRR.push(rr);
    if (liveRR.length > 30) liveRR.shift();
    liveSDNN  = calcSDNN(liveRR);
    liveRMSSD = calcRMSSD(liveRR);
    livePNN50 = calcPNN50(liveRR);
    simTimer = setTimeout(tick, rr);
  }
  tick();
}

function calcSDNN(rr) {
  if (rr.length < 2) return 0;
  const mean = rr.reduce((s,v)=>s+v,0)/rr.length;
  return Math.round(Math.sqrt(rr.reduce((s,v)=>s+(v-mean)**2,0)/rr.length));
}
function calcRMSSD(rr) {
  if (rr.length < 2) return 0;
  let s = 0;
  for (let i=1;i<rr.length;i++) s += (rr[i]-rr[i-1])**2;
  return Math.round(Math.sqrt(s/(rr.length-1)));
}
function calcPNN50(rr) {
  if (rr.length < 2) return 0;
  let c = 0;
  for (let i=1;i<rr.length;i++) if (Math.abs(rr[i]-rr[i-1])>50) c++;
  return Math.round((c/(rr.length-1))*100);
}

// ── BroadcastChannel receiver ──
function initBroadcastReceiver() {
  const ch = new BroadcastChannel('heartsync-sync');
  ch.onmessage = (e) => {
    if (e.data.type === 'heartdata') {
      isLive = true;
      setLiveUI(true);
      resetLiveTimeout();
      liveBpm = e.data.bpm;
      if (e.data.rrIntervals && e.data.rrIntervals.length) {
        liveRR    = [...e.data.rrIntervals];
        liveSDNN  = calcSDNN(liveRR);
        liveRMSSD = calcRMSSD(liveRR);
        livePNN50 = calcPNN50(liveRR);
      }
    }
  };
}

function resetLiveTimeout() {
  clearTimeout(liveTimeout);
  liveTimeout = setTimeout(() => { isLive = false; setLiveUI(false); }, 6000);
}

function setLiveUI(live) {
  const dot = el('sync-dot'), lbl = el('sync-label');
  dot.classList.toggle('live', live);
  lbl.classList.toggle('live', live);
  lbl.textContent = live ? 'LIVE SYNC' : 'STANDALONE';
}

// ── Main ML prediction loop ──
function startMLLoop() {
  if (mlInterval) return;
  mlInterval = setInterval(async () => {
    if (!ML.isReady) return;

    const bpm   = liveBpm;
    const sdnn  = liveSDNN;
    const rmssd = liveRMSSD;
    const pnn50 = livePNN50;

    // Update live metrics display
    el('ml-bpm').textContent   = bpm;
    el('ml-sdnn').textContent  = sdnn  || '—';
    el('ml-rmssd').textContent = rmssd || '—';
    el('ml-pnn50').textContent = pnn50 || '—';

    // Run prediction
    const result = await ML.predict(bpm, sdnn, rmssd, pnn50);
    if (!result) return;

    updateGauge(result.stress, result.state);
    updateStateLabel(result.state);
    updateConfidence(result.confidence);
    updateAnomaly(result.anomaly);

    // BPM trend buffer
    bpmTrendBuf.push(bpm);
    if (bpmTrendBuf.length > BPM_TREND_MAX) bpmTrendBuf.shift();
    updateTrend();

    // Stress history
    stressHistory.push({ t: Date.now(), stress: result.stress });
    if (stressHistory.length > STRESS_HISTORY_MAX) stressHistory.shift();
    drawStressHistory();
    drawTrendChart();

    // Model stats
    el('mc-samples').textContent = ML.sampleCount;
    el('sample-count').textContent = `${ML.sampleCount} samples`;
    el('mc-preds').textContent = ++predCount;

    // Broadcast ML result to other tabs
    ML.broadcastResult({ stress: result.stress, state: result.state.label, bpm });
  }, 1200);
}

// ── Gauge ──
function updateGauge(stress, state) {
  const pct    = stress / 100;
  const offset = GAUGE_ARC_LEN * (1 - pct);
  const fill   = el('gauge-fill');
  const dot    = el('gauge-dot');
  const val    = el('stress-val');

  fill.style.strokeDashoffset = offset;
  fill.style.stroke = state.color;
  val.textContent   = stress;
  val.style.color   = state.color;
  val.style.textShadow = `0 0 20px ${state.color}40`;
  setCSSVar('--zc', state.color);

  // Move needle dot along arc
  const angle = Math.PI + pct * Math.PI; // 180° → 360°
  const cx = 110 + 85 * Math.cos(angle);
  const cy = 115 + 85 * Math.sin(angle);
  dot.setAttribute('cx', cx.toFixed(1));
  dot.setAttribute('cy', cy.toFixed(1));
  dot.setAttribute('fill', state.color);
}

function updateStateLabel(state) {
  const lbl = el('state-label'), dot = el('state-dot');
  lbl.textContent   = state.label;
  lbl.style.color   = state.color;
  dot.style.background = state.color;
  dot.style.boxShadow  = `0 0 8px ${state.color}80`;
  el('state-badge').style.borderColor = `${state.color}40`;
}

function updateConfidence(conf) {
  const pct = Math.round(conf * 100);
  el('confidence-bar').style.width = `${pct}%`;
  el('confidence-label').textContent = `Confidence: ${pct}%`;
}

// ── Anomaly ──
function updateAnomaly(anomaly) {
  const card = el('anomaly-card');
  if (!anomaly) { card.style.display = 'none'; return; }
  card.style.display = 'flex';
  card.className = `anomaly-card ${anomaly.level.toLowerCase()}`;
  el('anomaly-title').textContent = anomaly.level === 'HIGH' ? '⚠ Significant Anomaly' : 'Mild Anomaly';
  el('anomaly-msg').textContent   = anomaly.message;
  el('anomaly-z').textContent     = `z-score: ${anomaly.z}σ`;
}

// ── Trend ──
function updateTrend() {
  const trend = ML.predictTrend(bpmTrendBuf);
  if (!trend) return;
  el('trend-predicted').textContent = trend.predicted;
  el('trend-direction').textContent = trend.direction.toUpperCase();
  el('trend-r2').textContent = `R² ${(trend.r2 * 100).toFixed(0)}%`;
  const arrow = el('trend-arrow');
  arrow.textContent = trend.direction === 'rising' ? '↗' : trend.direction === 'falling' ? '↘' : '→';
  arrow.className   = `trend-arrow ${trend.direction}`;
}

// ── Trend chart (BPM history sparkline) ──
function drawTrendChart() {
  const canvas = el('trend-canvas');
  if (!canvas || bpmTrendBuf.length < 2) return;
  canvas.width  = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const min = Math.min(...bpmTrendBuf) - 3;
  const max = Math.max(...bpmTrendBuf) + 3;
  const range = max - min || 1;
  const color = getComputedStyle(document.documentElement).getPropertyValue('--zc').trim() || '#e53935';

  ctx.clearRect(0, 0, W, H);

  // Fill
  ctx.beginPath();
  bpmTrendBuf.forEach((v, i) => {
    const x = (i / (bpmTrendBuf.length - 1)) * W;
    const y = H - ((v - min) / range) * (H - 4) - 2;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
  ctx.fillStyle = `${color}18`;
  ctx.fill();

  // Line
  ctx.beginPath();
  bpmTrendBuf.forEach((v, i) => {
    const x = (i / (bpmTrendBuf.length - 1)) * W;
    const y = H - ((v - min) / range) * (H - 4) - 2;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth   = 1.5;
  ctx.shadowColor = color;
  ctx.shadowBlur  = 4;
  ctx.stroke();
  ctx.shadowBlur = 0;
}

// ── Stress history chart ──
function drawStressHistory() {
  const canvas = el('stress-canvas');
  if (!canvas || stressHistory.length < 2) return;
  canvas.width  = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const n = stressHistory.length;

  ctx.clearRect(0, 0, W, H);

  // Gradient fill under line
  const gradient = ctx.createLinearGradient(0, 0, 0, H);
  gradient.addColorStop(0, 'rgba(229,57,53,0.25)');
  gradient.addColorStop(1, 'rgba(229,57,53,0)');
  ctx.beginPath();
  stressHistory.forEach((p, i) => {
    const x = (i / (n - 1)) * W;
    const y = H - (p.stress / 100) * (H - 4) - 2;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  // Stress line
  ctx.beginPath();
  stressHistory.forEach((p, i) => {
    const x = (i / (n - 1)) * W;
    const y = H - (p.stress / 100) * (H - 4) - 2;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#e53935';
  ctx.lineWidth   = 1.5;
  ctx.shadowColor = '#e53935';
  ctx.shadowBlur  = 4;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // 50% threshold line
  ctx.beginPath();
  ctx.setLineDash([4, 4]);
  ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.setLineDash([]);
}
