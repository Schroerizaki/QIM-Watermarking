// ============================================================
// STATE GLOBAL
// ============================================================
const APP = {
  hostBuffer: null,       // Float32Array audio samples (host asli)
  hostSampleRate: 44100,
  hostChannels: 1,
  hostFileName: '',

  wmOrigBits: null,       // Uint8Array bits watermark asli (setelah resize)
  wmWidth: 0,
  wmHeight: 0,
  wmOrigCanvas: null,

  embeddedBuffer: null,   // Float32Array audio watermarked
  embeddedParams: null,   // { segLen, nbit, wmW, wmH }

  attackedBuffer: null,   // Float32Array audio diserang
  attackedSource: 'last', // 'last' | 'upload'
  attackSourceBuffer: null,

  extractSource: 'last',  // 'last' | 'upload'
  extractAudioBuffer: null,
};

// ============================================================
// TABS
// ============================================================
function switchTab(t) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + t).classList.add('active');
  event.currentTarget.classList.add('active');
  if (t === 'attack') updateAttackSourceUI();
  if (t === 'extract') updateExtractSourceUI();
}

// ============================================================
// WAV DECODER
// ============================================================
function decodeWAV(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);

  // Find data chunk
  let offset = 12;
  while (offset < view.byteLength - 8) {
    const chunkId = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
    const chunkSize = view.getUint32(offset + 4, true);
    if (chunkId === 'data') {
      offset += 8;
      break;
    }
    offset += 8 + chunkSize;
  }

  const numSamples = Math.floor((view.byteLength - offset) / (bitsPerSample / 8)) / channels;
  const samples = new Float32Array(numSamples);
  const max = Math.pow(2, bitsPerSample - 1);

  for (let i = 0; i < numSamples; i++) {
    let val = 0;
    if (bitsPerSample === 16) {
      val = view.getInt16(offset + i * channels * 2, true);
    } else if (bitsPerSample === 8) {
      val = (view.getUint8(offset + i * channels) - 128);
    } else if (bitsPerSample === 32) {
      val = view.getInt32(offset + i * channels * 4, true) / 65536;
    }
    samples[i] = val / max;
  }
  return { samples, sampleRate, channels, bitsPerSample };
}

// ============================================================
// WAV ENCODER
// ============================================================
function encodeWAV(samples, sampleRate, channels = 1, bitsPerSample = 16) {
  const numSamples = samples.length;
  const dataSize = numSamples * channels * (bitsPerSample / 8);
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeStr(offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * (bitsPerSample / 8), true);
  view.setUint16(32, channels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  const max = Math.pow(2, bitsPerSample - 1) - 1;
  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    if (bitsPerSample === 16) {
      view.setInt16(44 + i * 2, Math.round(clamped * max), true);
    }
  }
  return buffer;
}

// ============================================================
// LOAD HOST AUDIO
// ============================================================
function loadHostAudio(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const decoded = decodeWAV(e.target.result);
      APP.hostBuffer = decoded.samples;
      APP.hostSampleRate = decoded.sampleRate;
      APP.hostChannels = decoded.channels;
      APP.hostFileName = file.name;

      document.getElementById('host-fname').textContent = '✓ ' + file.name;
      document.getElementById('zone-host').classList.add('has-file');

      // Audio preview
      const blob = new Blob([e.target.result], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const preview = document.getElementById('host-preview');
      preview.innerHTML = `
        <span class="preview-label">Durasi: ${(decoded.samples.length / decoded.sampleRate).toFixed(2)}s · ${decoded.sampleRate} Hz · ${decoded.channels}ch · ${decoded.bitsPerSample}bit</span>
        <audio controls src="${url}"></audio>`;

      updateWmInfo();
      checkEmbedReady();
    } catch (err) {
      setStatus('embed-status', 'error', 'Gagal baca WAV: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

// ============================================================
// LOAD WATERMARK
// ============================================================
function loadWatermark(input) {
  const file = input.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    // Convert to grayscale binary
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    APP.wmOrigCanvas = canvas;

    document.getElementById('wm-fname').textContent = '✓ ' + file.name;
    document.getElementById('zone-wm').classList.add('has-file');

    const preview = document.getElementById('wm-preview');
    preview.innerHTML = '';
    const displayImg = new Image();
    displayImg.src = url;
    displayImg.style.maxHeight = '100px';
    displayImg.style.maxWidth = '100%';
    preview.appendChild(displayImg);
    const lbl = document.createElement('span');
    lbl.className = 'preview-label';
    lbl.textContent = `Original: ${img.width}×${img.height}px`;
    preview.appendChild(lbl);

    updateWmInfo();
    checkEmbedReady();
  };
  img.src = url;
}

// ============================================================
// UPDATE WM INFO
// ============================================================
function updateWmInfo() {
  if (!APP.hostBuffer || !APP.wmOrigCanvas) return;
  const segLen = parseInt(document.getElementById('param-seglen').value);
  const maxBits = Math.floor(APP.hostBuffer.length / segLen);
  const maxSide = Math.floor(Math.sqrt(maxBits));

  const info = document.getElementById('wm-info');
  info.style.display = 'block';
  info.innerHTML = `<strong>Kapasitas:</strong> ${maxBits} bit maks · Resolusi WM maks: <strong>${maxSide}×${maxSide} px</strong><br>
    Host samples: ${APP.hostBuffer.length} · Segmen tersedia: ${Math.floor(APP.hostBuffer.length / segLen)}`;
}

// ============================================================
// NBIT DISPLAY
// ============================================================
function updateNbit(v) {
  document.getElementById('nbit-display').textContent = v + ' (Δ=' + Math.pow(2, parseInt(v)) + ')';
}

// ============================================================
// CHECK EMBED READY
// ============================================================
function checkEmbedReady() {
  const ready = APP.hostBuffer && APP.wmOrigCanvas;
  document.getElementById('btn-embed').disabled = !ready;
  if (ready) setStatus('embed-status', 'idle', 'Siap — klik "Jalankan Embedding"');
}

// ============================================================
// QIM EMBED / EXTRACT
// ============================================================
function qimEmbed(samples, bits, segLen, delta) {
  const out = new Float32Array(samples);
  const scale = 32767; // 16-bit int scale
  for (let i = 0; i < bits.length; i++) {
    const start = i * segLen;
    if (start + segLen > out.length) break;
    // Use mean of segment as the representative value
    let sum = 0;
    for (let j = start; j < start + segLen; j++) sum += out[j];
    let mean = sum / segLen;

    // QIM: quantize to nearest even/odd multiple of delta/2
    const halfDelta = delta / 2;
    const bit = bits[i];
    const q0 = Math.round(mean * scale / delta) * delta; // even quantizer
    const q1 = (Math.round((mean * scale - halfDelta) / delta) * delta) + halfDelta; // odd quantizer

    const target = bit === 0 ? q0 : q1;
    const diff = (target - mean * scale) / scale;
    const perSample = diff; // Fix: We want to shift the mean by diff, so we add diff to EVERY sample

    for (let j = start; j < start + segLen; j++) {
      out[j] = Math.max(-1, Math.min(1, out[j] + perSample));
    }
  }
  return out;
}

function qimExtract(samples, numBits, segLen, delta) {
  const bits = new Uint8Array(numBits);
  const scale = 32767;
  for (let i = 0; i < numBits; i++) {
    const start = i * segLen;
    if (start + segLen > samples.length) { bits[i] = 0; continue; }
    let sum = 0;
    for (let j = start; j < start + segLen; j++) sum += samples[j];
    const mean = sum / segLen;
    const scaledMean = mean * scale;
    const halfDelta = delta / 2;

    // Distance to nearest even vs odd quantizer
    const q0 = Math.round(scaledMean / delta) * delta;
    const q1 = (Math.round((scaledMean - halfDelta) / delta) * delta) + halfDelta;
    const d0 = Math.abs(scaledMean - q0);
    const d1 = Math.abs(scaledMean - q1);
    bits[i] = d0 <= d1 ? 0 : 1;
  }
  return bits;
}

// ============================================================
// IMAGE → BINARY BITS
// ============================================================
function canvasToBinaryBits(canvas) {
  const ctx = canvas.getContext('2d');
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const bits = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < bits.length; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    bits[i] = gray < 128 ? 1 : 0;
  }
  return bits;
}

function binaryBitsToCanvas(bits, w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < bits.length; i++) {
    const v = bits[i] === 1 ? 0 : 255;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function resizeWatermark(srcCanvas, targetW, targetH) {
  const dst = document.createElement('canvas');
  dst.width = targetW; dst.height = targetH;
  const ctx = dst.getContext('2d');
  ctx.drawImage(srcCanvas, 0, 0, targetW, targetH);
  return dst;
}

// ============================================================
// METRICS
// ============================================================
function computeSNR(orig, wm) {
  let sigPow = 0, noisePow = 0;
  for (let i = 0; i < orig.length; i++) {
    sigPow += orig[i] * orig[i];
    noisePow += (orig[i] - wm[i]) * (orig[i] - wm[i]);
  }
  if (noisePow === 0) return Infinity;
  return 10 * Math.log10(sigPow / noisePow);
}

function computePSNR(orig, wm) {
  let mse = 0;
  for (let i = 0; i < orig.length; i++) {
    const d = orig[i] - wm[i];
    mse += d * d;
  }
  mse /= orig.length;
  if (mse === 0) return Infinity;
  return 10 * Math.log10(1 / mse);
}

function computeNC(bitsA, bitsB) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < bitsA.length; i++) {
    const a = bitsA[i] === 1 ? 1 : -1;
    const b = bitsB[i] === 1 ? 1 : -1;
    dot += a * b;
    normA += a * a;
    normB += b * b;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function computeBER(bitsA, bitsB) {
  let err = 0;
  const len = Math.min(bitsA.length, bitsB.length);
  for (let i = 0; i < len; i++) if (bitsA[i] !== bitsB[i]) err++;
  return err / len;
}

// ============================================================
// STATUS HELPER
// ============================================================
function setStatus(id, type, msg, spinner = false) {
  const el = document.getElementById(id);
  el.className = 'status-bar status-' + type;
  el.innerHTML = (spinner ? '<div class="spinner"></div>' : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>') + ' ' + msg;
}

// ============================================================
// AUDIO BLOB PLAYER + DOWNLOAD
// ============================================================
function makeAudioPlayer(wavBuffer, filename, container) {
  const blob = new Blob([wavBuffer], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  container.innerHTML = `
    <div class="audio-player-box">
      <div class="audio-player-label">${filename}</div>
      <audio controls src="${url}" style="width:100%"></audio>
      <div style="margin-top:10px;">
        <a href="${url}" download="${filename}">
          <button class="btn btn-success btn-sm">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Download ${filename}
          </button>
        </a>
      </div>
    </div>`;
}

function makeImageDownload(canvas, filename, container) {
  canvas.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    container.innerHTML = `
      <a href="${url}" download="${filename}">
        <button class="btn btn-success btn-sm">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Download ${filename}
        </button>
      </a>`;
  }, 'image/png');
}

// ============================================================
// RUN EMBEDDING
// ============================================================
async function runEmbedding() {
  setStatus('embed-status', 'processing', 'Proses embedding...', true);
  document.getElementById('btn-embed').disabled = true;

  await new Promise(r => setTimeout(r, 30)); // yield to UI

  try {
    const segLen = parseInt(document.getElementById('param-seglen').value);
    const nbit = parseInt(document.getElementById('param-nbit').value);
    const delta = Math.pow(2, nbit);

    const totalSamples = APP.hostBuffer.length;
    const maxBits = Math.floor(totalSamples / segLen);
    const maxSide = Math.floor(Math.sqrt(maxBits));

    // Resize watermark to fit
    const wmW = Math.min(maxSide, APP.wmOrigCanvas.width);
    const wmH = Math.min(maxSide, APP.wmOrigCanvas.height);
    const resized = resizeWatermark(APP.wmOrigCanvas, wmW, wmH);
    const bits = canvasToBinaryBits(resized);

    APP.wmOrigBits = bits;
    APP.wmWidth = wmW;
    APP.wmHeight = wmH;

    // Show resized WM
    const resizedPreview = document.getElementById('wm-resized-preview');
    resizedPreview.innerHTML = '';
    const rc = binaryBitsToCanvas(bits, wmW, wmH);
    rc.style.maxHeight = '120px';
    rc.style.imageRendering = 'pixelated';
    resizedPreview.appendChild(rc);
    const rl = document.createElement('span');
    rl.className = 'preview-label';
    rl.textContent = `Setelah resize: ${wmW}×${wmH}px (${bits.length} bit)`;
    resizedPreview.appendChild(rl);

    // Embed
    const embedded = qimEmbed(APP.hostBuffer, bits, segLen, delta);
    APP.embeddedBuffer = embedded;
    APP.embeddedParams = { segLen, nbit, wmW, wmH };

    // Compute metrics
    const snr = computeSNR(APP.hostBuffer, embedded);
    const psnr = computePSNR(APP.hostBuffer, embedded);
    const extractedBits = qimExtract(embedded, bits.length, segLen, delta);
    const nc = computeNC(bits, extractedBits);
    const payload = bits.length;

    document.getElementById('m-snr').textContent = isFinite(snr) ? snr.toFixed(2) : '∞';
    document.getElementById('m-psnr').textContent = isFinite(psnr) ? psnr.toFixed(2) : '∞';
    document.getElementById('m-nc').textContent = nc.toFixed(4);
    document.getElementById('m-payload').textContent = payload;
    document.getElementById('m-segs').textContent = Math.floor(totalSamples / segLen);
    document.getElementById('m-wmres').textContent = `${wmW}×${wmH}`;

    // Encode WAV
    const wavBuf = encodeWAV(embedded, APP.hostSampleRate);
    const outName = 'watermarked_' + APP.hostFileName;
    makeAudioPlayer(wavBuf, outName, document.getElementById('embed-output'));

    setStatus('embed-status', 'done', `Embedding selesai · SNR: ${snr.toFixed(2)} dB · Payload: ${payload} bit`);
    updateAttackSourceUI();
    updateExtractSourceUI();
  } catch (err) {
    setStatus('embed-status', 'error', 'Error: ' + err.message);
  }
  document.getElementById('btn-embed').disabled = false;
}

// ============================================================
// ATTACK SOURCE
// ============================================================
function setAttackSource(src) {
  APP.attackedSource = src;
  document.getElementById('atk-src-last').classList.toggle('active', src === 'last');
  document.getElementById('atk-src-upload').classList.toggle('active', src === 'upload');
  document.getElementById('atk-upload-area').style.display = src === 'upload' ? 'block' : 'none';
  updateAttackSourceUI();
}

function updateAttackSourceUI() {
  const preview = document.getElementById('atk-audio-preview');
  if (APP.attackedSource === 'last') {
    if (APP.embeddedBuffer) {
      const wavBuf = encodeWAV(APP.embeddedBuffer, APP.hostSampleRate);
      const blob = new Blob([wavBuf], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      preview.innerHTML = `<span class="preview-label">Hasil embedding terakhir</span><audio controls src="${url}"></audio>`;
      APP.attackSourceBuffer = APP.embeddedBuffer;
      document.getElementById('btn-attack').disabled = false;
    } else {
      preview.innerHTML = '<span class="placeholder-text" id="atk-src-hint">Jalankan embedding terlebih dahulu</span>';
      document.getElementById('btn-attack').disabled = true;
    }
  }
}

function loadAttackAudio(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const decoded = decodeWAV(e.target.result);
      APP.attackSourceBuffer = decoded.samples;
      APP.hostSampleRate = decoded.sampleRate;
      document.getElementById('atk-fname').textContent = '✓ ' + file.name;
      const blob = new Blob([e.target.result], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const preview = document.getElementById('atk-audio-preview');
      preview.innerHTML = `<span class="preview-label">${file.name}</span><audio controls src="${url}"></audio>`;
      document.getElementById('btn-attack').disabled = false;
    } catch (err) { alert('Gagal baca file: ' + err.message); }
  };
  reader.readAsArrayBuffer(file);
}

// ============================================================
// ATTACK TOGGLE
// ============================================================
const activeAttacks = {};
function toggleAttack(id) {
  activeAttacks[id] = !activeAttacks[id];
  const toggle = document.getElementById('toggle-' + id);
  const body = document.getElementById('body-' + id);
  toggle.classList.toggle('checked', !!activeAttacks[id]);
  body.classList.toggle('open', !!activeAttacks[id]);
}

// ============================================================
// RUN ATTACKS
// ============================================================
async function runAttacks() {
  const src = APP.attackedSource === 'last' ? APP.embeddedBuffer : APP.attackSourceBuffer;
  if (!src) { alert('Tidak ada audio sumber!'); return; }

  setStatus('attack-status', 'processing', 'Menerapkan serangan...', true);
  document.getElementById('btn-attack').disabled = true;
  await new Promise(r => setTimeout(r, 30));

  try {
    let signal = new Float32Array(src);
    const log = [];

    // AWGN
    if (activeAttacks['awgn']) {
      const snrDb = parseFloat(document.getElementById('atk-awgn-snr').value);
      let sigPow = 0;
      for (let i = 0; i < signal.length; i++) sigPow += signal[i] * signal[i];
      sigPow /= signal.length;
      const noisePow = sigPow / Math.pow(10, snrDb / 10);
      const std = Math.sqrt(noisePow);
      for (let i = 0; i < signal.length; i++) {
        // Box-Muller
        const u1 = Math.random(), u2 = Math.random();
        const n = std * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        signal[i] = Math.max(-1, Math.min(1, signal[i] + n));
      }
      log.push(`✓ AWGN: SNR=${snrDb} dB`);
    }

    // Time Shifting
    if (activeAttacks['shift']) {
      const n = parseInt(document.getElementById('atk-shift-n').value);
      const dir = document.getElementById('atk-shift-dir').value;
      const shifted = new Float32Array(signal.length);
      if (dir === 'right') {
        for (let i = n; i < signal.length; i++) shifted[i] = signal[i - n];
      } else {
        for (let i = 0; i < signal.length - n; i++) shifted[i] = signal[i + n];
      }
      signal = shifted;
      log.push(`✓ Time Shift: ${n} samples (${dir})`);
    }

    // Cropping
    if (activeAttacks['crop']) {
      const startPct = parseFloat(document.getElementById('atk-crop-start').value) / 100;
      const endPct = parseFloat(document.getElementById('atk-crop-end').value) / 100;
      const startIdx = Math.floor(signal.length * startPct);
      const endIdx = Math.floor(signal.length * (1 - endPct));
      const cropped = signal.slice(startIdx, endIdx);
      // Pad back to original length with zeros
      const padded = new Float32Array(signal.length);
      padded.set(cropped, 0);
      signal = padded;
      log.push(`✓ Cropping: awal ${(startPct * 100).toFixed(0)}%, akhir ${(endPct * 100).toFixed(0)}%`);
    }

    // Rescaling
    if (activeAttacks['scale']) {
      const f = parseFloat(document.getElementById('atk-scale-f').value);
      for (let i = 0; i < signal.length; i++) signal[i] = Math.max(-1, Math.min(1, signal[i] * f));
      log.push(`✓ Rescaling: ×${f.toFixed(2)}`);
    }

    // Requantization
    if (activeAttacks['requant']) {
      const bits = parseInt(document.getElementById('atk-requant-bits').value);
      const levels = Math.pow(2, bits);
      for (let i = 0; i < signal.length; i++) {
        const q = Math.round((signal[i] * 0.5 + 0.5) * (levels - 1)) / (levels - 1);
        signal[i] = (q - 0.5) * 2;
      }
      log.push(`✓ Requantization: ${bits}-bit (dari 16-bit)`);
    }

    APP.attackedBuffer = signal;

    // Metrics vs original embedded
    const orig = APP.embeddedBuffer || src;
    const snr = computeSNR(orig, signal);
    const psnr = computePSNR(orig, signal);

    document.getElementById('am-snr').textContent = isFinite(snr) ? snr.toFixed(2) : '∞';
    document.getElementById('am-psnr').textContent = isFinite(psnr) ? psnr.toFixed(2) : '∞';
    document.getElementById('atk-metrics-card').style.display = 'block';

    // Output player
    const wavBuf = encodeWAV(signal, APP.hostSampleRate);
    makeAudioPlayer(wavBuf, 'attacked_audio.wav', document.getElementById('attack-output'));

    document.getElementById('attack-log').innerHTML = log.join('<br>') || 'Tidak ada serangan dipilih.';
    setStatus('attack-status', 'done', `${log.length} serangan diterapkan · SNR: ${snr.toFixed(2)} dB`);

    updateExtractSourceUI();
  } catch (err) {
    setStatus('attack-status', 'error', 'Error: ' + err.message);
  }
  document.getElementById('btn-attack').disabled = false;
}

// ============================================================
// EXTRACT SOURCE
// ============================================================
function setExtractSource(src) {
  APP.extractSource = src;
  document.getElementById('ext-src-last').classList.toggle('active', src === 'last');
  document.getElementById('ext-src-upload').classList.toggle('active', src === 'upload');
  document.getElementById('ext-upload-area').style.display = src === 'upload' ? 'block' : 'none';
  updateExtractSourceUI();
}

function updateExtractSourceUI() {
  if (APP.extractSource === 'last' && APP.embeddedBuffer) {
    // Auto-fill params from embedding
    if (APP.embeddedParams) {
      document.getElementById('ext-seglen').value = APP.embeddedParams.segLen;
      document.getElementById('ext-nbit').value = APP.embeddedParams.nbit;
      document.getElementById('ext-nbit-display').textContent = APP.embeddedParams.nbit + ' (Δ=' + Math.pow(2, APP.embeddedParams.nbit) + ')';
      document.getElementById('ext-wm-w').value = APP.embeddedParams.wmW;
      document.getElementById('ext-wm-h').value = APP.embeddedParams.wmH;
      document.getElementById('ext-param-source-info').style.display = 'block';
    }
    APP.extractAudioBuffer = APP.embeddedBuffer;

    const wavBuf = encodeWAV(APP.embeddedBuffer, APP.hostSampleRate);
    const blob = new Blob([wavBuf], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const preview = document.getElementById('ext-audio-preview');
    preview.innerHTML = `<span class="preview-label">Hasil embedding terakhir</span><audio controls src="${url}"></audio>`;
    document.getElementById('btn-extract').disabled = false;
  } else if (APP.extractSource === 'upload') {
    document.getElementById('ext-param-source-info').style.display = 'none';
  }

  // Update attacked preview
  if (APP.attackedBuffer) {
    const wavBuf = encodeWAV(APP.attackedBuffer, APP.hostSampleRate);
    const blob = new Blob([wavBuf], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const preview = document.getElementById('ext-attacked-preview');
    preview.innerHTML = `<span class="preview-label">Audio hasil serangan</span><audio controls src="${url}"></audio>`;
  }
}

function loadExtractAudio(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const decoded = decodeWAV(e.target.result);
      APP.extractAudioBuffer = decoded.samples;
      document.getElementById('ext-fname').textContent = '✓ ' + file.name;
      const blob = new Blob([e.target.result], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const preview = document.getElementById('ext-audio-preview');
      preview.innerHTML = `<span class="preview-label">${file.name}</span><audio controls src="${url}"></audio>`;
      document.getElementById('ext-param-source-info').style.display = 'none';
      document.getElementById('btn-extract').disabled = false;
    } catch (err) { alert('Gagal baca file: ' + err.message); }
  };
  reader.readAsArrayBuffer(file);
}

function toggleAttackedSource(checked) {
  document.getElementById('ext-attacked-area').style.display = checked ? 'block' : 'none';
  updateExtractSourceUI();
}

// ============================================================
// RUN EXTRACTION
// ============================================================
async function runExtraction() {
  const src = APP.extractSource === 'last' ? APP.embeddedBuffer : APP.extractAudioBuffer;
  if (!src) { alert('Tidak ada audio untuk diekstrak!'); return; }

  setStatus('extract-status', 'processing', 'Ekstraksi watermark...', true);
  document.getElementById('btn-extract').disabled = true;
  await new Promise(r => setTimeout(r, 30));

  try {
    const segLen = parseInt(document.getElementById('ext-seglen').value);
    const nbit = parseInt(document.getElementById('ext-nbit').value);
    const delta = Math.pow(2, nbit);
    const wmW = parseInt(document.getElementById('ext-wm-w').value);
    const wmH = parseInt(document.getElementById('ext-wm-h').value);
    const numBits = wmW * wmH;

    // Extract from clean watermarked
    const extractedBits = qimExtract(src, numBits, segLen, delta);

    // BER clean
    let berClean = null;
    if (APP.wmOrigBits && APP.wmOrigBits.length === numBits) {
      berClean = computeBER(APP.wmOrigBits, extractedBits);
    }

    // Display clean watermark
    const cleanCanvas = binaryBitsToCanvas(extractedBits, wmW, wmH);
    cleanCanvas.style.imageRendering = 'pixelated';
    cleanCanvas.style.maxWidth = '100%';
    cleanCanvas.style.maxHeight = '160px';
    const cleanPreview = document.getElementById('ext-wm-clean-preview');
    cleanPreview.innerHTML = `<span class="preview-label">Ekstraksi (tanpa serangan) · ${wmW}×${wmH}</span>`;
    cleanPreview.appendChild(cleanCanvas);
    makeImageDownload(cleanCanvas, 'extracted_wm_clean.png', document.getElementById('ext-clean-dl'));

    // BER display
    if (berClean !== null) {
      const berEl = document.getElementById('ber-clean');
      berEl.textContent = (berClean * 100).toFixed(2) + '%';
      berEl.className = 'ber-val ' + (berClean < 0.05 ? 'ber-good' : berClean < 0.2 ? '' : 'ber-bad');
    } else {
      document.getElementById('ber-clean').textContent = 'N/A (WM asli tidak ada)';
    }

    // BER with attack
    const useAttacked = document.getElementById('ext-use-attacked').checked;
    if (useAttacked && APP.attackedBuffer) {
      const attackedBits = qimExtract(APP.attackedBuffer, numBits, segLen, delta);
      const berAtk = APP.wmOrigBits ? computeBER(APP.wmOrigBits, attackedBits) : null;

      const atkCanvas = binaryBitsToCanvas(attackedBits, wmW, wmH);
      atkCanvas.style.imageRendering = 'pixelated';
      atkCanvas.style.maxWidth = '100%';
      atkCanvas.style.maxHeight = '130px';
      const atkPreview = document.getElementById('ext-wm-attacked-preview');
      atkPreview.innerHTML = `<span class="preview-label">Ekstraksi (dari audio diserang)</span>`;
      atkPreview.appendChild(atkCanvas);
      makeImageDownload(atkCanvas, 'extracted_wm_attacked.png', document.getElementById('ext-attacked-dl'));

      if (berAtk !== null) {
        const berEl = document.getElementById('ber-attacked');
        berEl.textContent = (berAtk * 100).toFixed(2) + '%';
        berEl.className = 'ber-val ' + (berAtk < 0.1 ? 'ber-good' : berAtk < 0.35 ? '' : 'ber-bad');
      }
    } else {
      document.getElementById('ber-attacked').textContent = useAttacked ? 'N/A (jalankan serangan dulu)' : '—';
    }

    setStatus('extract-status', 'done', 'Ekstraksi selesai' + (berClean !== null ? ` · BER: ${(berClean * 100).toFixed(2)}%` : ''));
  } catch (err) {
    setStatus('extract-status', 'error', 'Error: ' + err.message);
  }
  document.getElementById('btn-extract').disabled = false;
}

// ============================================================
// INIT
// ============================================================
// Manual file input triggers (avoid form issues)
document.getElementById('inp-host').addEventListener('change', function () { loadHostAudio(this); });
document.getElementById('inp-wm').addEventListener('change', function () { loadWatermark(this); });

// Fix upload zone clicks
document.getElementById('zone-host').addEventListener('click', () => document.getElementById('inp-host').click());
document.getElementById('zone-wm').addEventListener('click', () => document.getElementById('inp-wm').click());