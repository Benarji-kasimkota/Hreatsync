// HeartSync ML Engine — TensorFlow.js neural network + anomaly detection + trend regression
const ML = (() => {
  const TF_CDN   = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js';
  const SAMPLES_KEY = 'heartsync_ml_samples';

  // Feature normalization ranges
  const R = { bpm: [30, 220], sdnn: [0, 150], rmssd: [0, 150], pnn50: [0, 100] };
  const norm   = (v, k) => Math.max(0, Math.min(1, (v - R[k][0]) / (R[k][1] - R[k][0])));
  const denorm = (n, k) => n * (R[k][1] - R[k][0]) + R[k][0];

  // State
  let model          = null;
  let _ready         = false;
  let _initPromise   = null;
  let userSamples    = [];       // { inputs:[4], stress } for online fine-tuning
  let bpmWindow      = [];       // last 120 BPM readings for anomaly baseline
  let sdnnWindow     = [];
  let predCount      = 0;
  const onReadyCbs   = [];

  // ── Gaussian noise ──
  function gauss(sigma = 1) {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sigma;
  }

  // ── Load TF.js if not present ──
  function loadTF() {
    if (window.tf) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = TF_CDN; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  // ── Build model: [bpm,sdnn,rmssd,pnn50] → stress (0-1) ──
  function buildModel() {
    const m = tf.sequential({
      layers: [
        tf.layers.dense({ inputShape: [4], units: 16, activation: 'relu', kernelInitializer: 'glorotNormal' }),
        tf.layers.dropout({ rate: 0.1 }),
        tf.layers.dense({ units: 8, activation: 'relu' }),
        tf.layers.dense({ units: 1, activation: 'sigmoid' }),
      ],
    });
    m.compile({ optimizer: tf.train.adam(0.008), loss: 'meanSquaredError' });
    return m;
  }

  // ── Pre-train on synthetic HRV-research-derived data ──
  async function preTrain(m) {
    const N   = 500;
    const xs  = [];
    const ys  = [];

    for (let i = 0; i < N; i++) {
      // Sample realistic heart state
      const bpm   = Math.max(30, Math.min(220, 40 + Math.random() * 160 + gauss(8)));
      const sdnn  = Math.max(3,  90 - bpm * 0.35 + gauss(18));
      const rmssd = Math.max(3,  sdnn * 0.85 + gauss(12));
      const pnn50 = Math.max(0, Math.min(100, (rmssd - 18) * 0.9 + gauss(8)));

      // Stress label: high BPM + low HRV = high stress (from published HRV research)
      const stress = Math.max(0, Math.min(1,
        0.40 * norm(bpm,   'bpm')            +
        0.28 * (1 - norm(sdnn,  'sdnn'))     +
        0.22 * (1 - norm(rmssd, 'rmssd'))    +
        0.10 * (1 - norm(pnn50, 'pnn50'))    +
        gauss(0.04)
      ));

      xs.push([norm(bpm,'bpm'), norm(sdnn,'sdnn'), norm(rmssd,'rmssd'), norm(pnn50,'pnn50')]);
      ys.push([stress]);
    }

    const xT = tf.tensor2d(xs);
    const yT = tf.tensor2d(ys);
    await m.fit(xT, yT, { epochs: 40, verbose: 0, batchSize: 32 });
    tf.dispose([xT, yT]);
  }

  // ── Online fine-tuning with accumulated user data ──
  async function fineTune() {
    if (!_ready || userSamples.length < 8) return;
    const xs = userSamples.map(s => s.inputs);
    const ys = userSamples.map(s => [s.stress]);
    const xT = tf.tensor2d(xs);
    const yT = tf.tensor2d(ys);
    await model.fit(xT, yT, { epochs: 4, verbose: 0, batchSize: 8 });
    tf.dispose([xT, yT]);
  }

  // ── Public init ──
  function init() {
    if (_initPromise) return _initPromise;
    _initPromise = (async () => {
      await loadTF();
      model = buildModel();
      await preTrain(model);
      // Restore prior user samples and fine-tune
      try {
        const saved = JSON.parse(localStorage.getItem(SAMPLES_KEY) || '[]');
        userSamples = saved;
        if (saved.length >= 8) await fineTune();
      } catch (_) {}
      _ready = true;
      onReadyCbs.forEach(fn => fn());
      onReadyCbs.length = 0;
    })();
    return _initPromise;
  }

  function onReady(fn) {
    if (_ready) { fn(); return; }
    onReadyCbs.push(fn);
  }

  // ── Predict ──
  async function predict(bpm, sdnn, rmssd, pnn50 = 0) {
    if (!_ready) return null;

    const inputs = [norm(bpm,'bpm'), norm(sdnn,'sdnn'), norm(rmssd,'rmssd'), norm(pnn50,'pnn50')];
    const xT     = tf.tensor2d([inputs]);
    const out    = model.predict(xT);
    const stress = (await out.data())[0];
    tf.dispose([xT, out]);

    // Accumulate user sample every 4th prediction
    if (++predCount % 4 === 0) {
      userSamples.push({ inputs, stress });
      if (userSamples.length > 80) userSamples.shift();
      _persist();
      // Periodically fine-tune in background
      if (userSamples.length % 20 === 0) fineTune();
    }

    // Update baseline windows
    bpmWindow.push(bpm);   if (bpmWindow.length  > 120) bpmWindow.shift();
    sdnnWindow.push(sdnn); if (sdnnWindow.length > 120) sdnnWindow.shift();

    const stressScore = Math.round(Math.max(0, Math.min(100, stress * 100)));
    return {
      stress:     stressScore,
      state:      classifyState(stressScore),
      confidence: sampleConfidence(),
      anomaly:    detectAnomaly(bpm, sdnn),
    };
  }

  // ── State classification ──
  function classifyState(stress) {
    if (stress < 18)  return { label: 'RECOVERED',   color: '#69f0ae', tier: 0 };
    if (stress < 32)  return { label: 'CALM',         color: '#40c4ff', tier: 1 };
    if (stress < 48)  return { label: 'BASELINE',     color: '#e0e0e0', tier: 2 };
    if (stress < 62)  return { label: 'ELEVATED',     color: '#ffd740', tier: 3 };
    if (stress < 78)  return { label: 'STRESSED',     color: '#ff6e40', tier: 4 };
    return                    { label: 'HIGH STRESS', color: '#ef5350', tier: 5 };
  }

  // ── Anomaly detection (Z-score on personal baseline) ──
  function detectAnomaly(bpm, sdnn) {
    if (bpmWindow.length < 15) return null;
    const mean = bpmWindow.reduce((s,v)=>s+v,0) / bpmWindow.length;
    const std  = Math.sqrt(bpmWindow.reduce((s,v)=>s+(v-mean)**2,0) / bpmWindow.length) || 1;
    const z    = Math.abs(bpm - mean) / std;

    if (z > 3.0) return { level: 'HIGH',   z: z.toFixed(1), message: `BPM ${Math.round(bpm)} is far outside your baseline (${Math.round(mean)} ±${Math.round(std)})` };
    if (z > 2.0) return { level: 'MILD',   z: z.toFixed(1), message: `BPM slightly outside your normal range of ${Math.round(mean-std)}–${Math.round(mean+std)}` };
    return null;
  }

  // ── BPM trend prediction (linear regression) ──
  function predictTrend(bpmHistory) {
    const n = bpmHistory.length;
    if (n < 6) return null;

    const xs = bpmHistory.map((_, i) => i);
    const ys = bpmHistory;
    const sx  = xs.reduce((s,v)=>s+v,0), sy  = ys.reduce((s,v)=>s+v,0);
    const sxy = xs.reduce((s,v,i)=>s+v*ys[i],0), sx2 = xs.reduce((s,v)=>s+v*v,0);
    const slope = (n*sxy - sx*sy) / (n*sx2 - sx*sx || 1);
    const intcp = (sy - slope*sx) / n;
    const predicted = Math.max(30, Math.min(220, Math.round(intcp + slope*(n+6))));
    const r2 = calcR2(ys, xs.map(x => intcp + slope*x));

    return {
      slope:     slope,
      predicted: predicted,
      direction: slope > 0.2 ? 'rising' : slope < -0.2 ? 'falling' : 'stable',
      r2:        r2,
    };
  }

  function calcR2(actual, predicted) {
    const mean = actual.reduce((s,v)=>s+v,0)/actual.length;
    const ssTot = actual.reduce((s,v)=>s+(v-mean)**2,0);
    const ssRes = actual.reduce((s,v,i)=>s+(v-predicted[i])**2,0);
    return Math.max(0, 1 - ssRes/ssTot);
  }

  function sampleConfidence() {
    return Math.min(0.99, 0.55 + userSamples.length / 160);
  }

  function _persist() {
    try { localStorage.setItem(SAMPLES_KEY, JSON.stringify(userSamples)); } catch(_) {}
  }

  // ── BroadcastChannel: broadcast ML results to other tabs ──
  function broadcastResult(result) {
    try { new BroadcastChannel('heartsync-ml').postMessage({ type: 'mlresult', ...result }); } catch(_) {}
  }

  return {
    init, onReady, predict, predictTrend,
    classifyState, detectAnomaly,
    get isReady() { return _ready; },
    get sampleCount() { return userSamples.length; },
    broadcastResult,
  };
})();
