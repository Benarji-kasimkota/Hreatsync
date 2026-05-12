// health-connect.js
const BASE_URL = location.origin + location.pathname.replace('health-connect.html', '');
const MOBILE_URL = BASE_URL + 'mobile.html';

let importedSamples = [];   // [{date, bpm}]
let pbTimer  = null;
let pbIndex  = 0;
let pbSpeed  = 1;
let pbActive = false;
const syncChannel = new BroadcastChannel('heartsync-sync');

document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupShortcutPanel();
  setupImportPanel();
});

// ── Tabs ──
function setupTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
      btn.classList.add('active');
      document.getElementById('panel-' + btn.dataset.tab).classList.remove('hidden');
    });
  });
}

// ── Shortcuts panel ──
function setupShortcutPanel() {
  const url      = MOBILE_URL + '?bpm=';
  const fullUrl  = url + 'YOUR_BPM_HERE';

  document.getElementById('live-url').textContent            = MOBILE_URL;
  document.getElementById('shortcut-url-template').textContent = url;

  document.getElementById('copy-url-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(MOBILE_URL + '?bpm=').then(() => {
      const btn = document.getElementById('copy-url-btn');
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1800);
    }).catch(() => {
      const btn = document.getElementById('copy-url-btn');
      btn.textContent = 'Select & copy manually';
    });
  });

  document.getElementById('launch-btn').addEventListener('click', () => {
    const bpm = parseInt(document.getElementById('test-bpm').value, 10);
    if (bpm >= 30 && bpm <= 220) {
      window.location.href = MOBILE_URL + '?bpm=' + bpm;
    }
  });
}

// ── Import panel ──
function setupImportPanel() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');

  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });

  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  // Playback controls
  document.getElementById('pb-play').addEventListener('click',  startPlayback);
  document.getElementById('pb-pause').addEventListener('click', togglePause);
  document.getElementById('pb-stop').addEventListener('click',  stopPlayback);

  document.querySelectorAll('.pb-speed').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pb-speed').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      pbSpeed = parseFloat(btn.dataset.s);
    });
  });
}

// ── File handling ──
async function handleFile(file) {
  showParseStatus('Parsing…', true);
  try {
    const text = await file.text();
    importedSamples = parseAppleHealthXML(text);
    if (!importedSamples.length) throw new Error('No heart rate records found in this file.');
    showParseStatus('✓ Parsed ' + importedSamples.length + ' samples', false);
    renderResults(importedSamples);
  } catch (e) {
    showParseStatus('Error: ' + e.message, false);
  }
}

// ── Apple Health XML parser ──
function parseAppleHealthXML(xml) {
  const parser   = new DOMParser();
  const doc      = parser.parseFromString(xml, 'text/xml');
  const records  = doc.querySelectorAll('Record[type="HKQuantityTypeIdentifierHeartRate"]');
  const samples  = [];

  records.forEach(r => {
    const bpm  = parseFloat(r.getAttribute('value'));
    const date = r.getAttribute('startDate') || r.getAttribute('creationDate');
    if (!isNaN(bpm) && date) {
      samples.push({ date: new Date(date), bpm: Math.round(bpm) });
    }
  });

  // Sort oldest first
  samples.sort((a, b) => a.date - b.date);
  return samples;
}

// ── Render results ──
function renderResults(samples) {
  const bpms   = samples.map(s => s.bpm);
  const avg    = Math.round(bpms.reduce((s,v)=>s+v,0) / bpms.length);
  const min    = Math.min(...bpms);
  const max    = Math.max(...bpms);
  const from   = samples[0].date;
  const to     = samples[samples.length - 1].date;

  document.getElementById('imp-count').textContent = samples.length.toLocaleString();
  document.getElementById('imp-avg').textContent   = avg;
  document.getElementById('imp-min').textContent   = min;
  document.getElementById('imp-max').textContent   = max;
  document.getElementById('imp-from').textContent  = formatDate(from);
  document.getElementById('imp-to').textContent    = formatDate(to);

  document.getElementById('import-results').style.display = 'block';
  drawHRChart(samples);
}

function formatDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── HR History Chart ──
function drawHRChart(samples) {
  const canvas = document.getElementById('hr-chart');
  if (!canvas || samples.length < 2) return;
  canvas.width  = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  // Downsample to max 300 points for performance
  const step   = Math.max(1, Math.floor(samples.length / 300));
  const pts    = samples.filter((_, i) => i % step === 0);
  const bpms   = pts.map(s => s.bpm);
  const minBPM = Math.min(...bpms) - 5;
  const maxBPM = Math.max(...bpms) + 5;
  const range  = maxBPM - minBPM || 1;

  ctx.clearRect(0, 0, W, H);

  // Fill
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(229,57,53,0.3)');
  grad.addColorStop(1, 'rgba(229,57,53,0)');
  ctx.beginPath();
  pts.forEach((p, i) => {
    const x = (i / (pts.length - 1)) * W;
    const y = H - ((p.bpm - minBPM) / range) * (H - 8) - 4;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  pts.forEach((p, i) => {
    const x = (i / (pts.length - 1)) * W;
    const y = H - ((p.bpm - minBPM) / range) * (H - 8) - 4;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#e53935';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

// ── Playback ──
function startPlayback() {
  if (!importedSamples.length) return;
  pbActive = true;
  pbIndex  = 0;
  document.getElementById('pb-play').disabled  = true;
  document.getElementById('pb-pause').disabled = false;
  document.getElementById('pb-stop').disabled  = false;
  document.getElementById('pb-status').textContent = 'Playing…';
  playNext();
}

function playNext() {
  if (!pbActive || pbIndex >= importedSamples.length) {
    stopPlayback();
    return;
  }
  const sample = importedSamples[pbIndex];
  broadcastBPM(sample.bpm);
  updatePBProgress();

  // Interval: base 1000ms / speed (1 s of real time per sample at 1×)
  pbTimer = setTimeout(playNext, Math.max(100, 1000 / pbSpeed));
  pbIndex++;
}

function togglePause() {
  pbActive = !pbActive;
  const btn = document.getElementById('pb-pause');
  btn.textContent = pbActive ? '⏸ PAUSE' : '▶ RESUME';
  if (pbActive) playNext();
}

function stopPlayback() {
  pbActive = false;
  clearTimeout(pbTimer);
  pbIndex = 0;
  document.getElementById('pb-play').disabled  = false;
  document.getElementById('pb-pause').disabled = true;
  document.getElementById('pb-stop').disabled  = true;
  document.getElementById('pb-progress').style.width = '0%';
  document.getElementById('pb-status').textContent = 'Stopped';
  document.getElementById('pb-pause').textContent  = '⏸ PAUSE';
}

function updatePBProgress() {
  const pct = (pbIndex / importedSamples.length) * 100;
  document.getElementById('pb-progress').style.width = pct + '%';
  const s = importedSamples[pbIndex] || importedSamples[importedSamples.length - 1];
  document.getElementById('pb-status').textContent =
    `${pbIndex} / ${importedSamples.length}  ·  ${s.bpm} BPM  ·  ${formatDate(s.date)}`;
}

function broadcastBPM(bpm) {
  syncChannel.postMessage({ type: 'heartdata', bpm, rrIntervals: [], source: 'healthimport' });
}

// ── Helpers ──
function showParseStatus(msg, spinning) {
  const el = document.getElementById('parse-status');
  el.style.display = 'flex';
  document.getElementById('ps-text').textContent = msg;
  const icon = document.getElementById('ps-icon');
  icon.textContent = spinning ? '⏳' : '✓';
  icon.style.animation = spinning ? 'spin 1s linear infinite' : 'none';
}
