// audio.js
// ---------------------------------------------------------------------------
// Sound input for reactive visuals.
//
// One shared analyser feeds every sound-reactive shape and the audio-native
// animations (spectrum, waveform, beat ring). Three sources are supported:
//   - 'mic'  : the microphone / line-in (getUserMedia)
//   - 'file' : a local audio file that PhysMap plays and analyses
//   - 'demo' : a synthetic 120 BPM pattern, so reactivity can be tried (and
//              designed) with no hardware, no permission and no sound at all
//
// Everything is normalised to 0..1 with a slow automatic gain, so a quiet room
// and a loud club both drive the visuals across their full range.

const FFT_SIZE = 1024;
const SPECTRUM_BARS = 48;
const WAVE_POINTS = 256;

const state = {
  mode: 'off',
  label: '',
  sensitivity: 1,
  levels: { level: 0, bass: 0, mid: 0, treble: 0, beat: 0 },
  spectrum: new Float32Array(SPECTRUM_BARS),
  waveform: new Float32Array(WAVE_POINTS),
  beatCount: 0,
};

let context = null;
let analyser = null;
let sourceNode = null;
let micStream = null;
let fileElement = null;
let fileUrl = null;
let freqData = null;
let timeData = null;

// Automatic gain: a slowly decaying ceiling per band.
const ceiling = { level: 0.2, bass: 0.2, mid: 0.2, treble: 0.2 };
let bassAverage = 0;
let lastBeatAt = 0;
let lastUpdate = 0;
const listeners = new Set();

function notify() {
  for (const listener of listeners) listener(state);
}

export function onAudioChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function audioState() {
  return state;
}

export function isAudioActive() {
  return state.mode !== 'off';
}

export function setAudioSensitivity(value) {
  state.sensitivity = Math.max(0.25, Math.min(3, Number(value) || 1));
}

// Energy of one band (or the overall level), 0..1. Returns 0 while sound is off.
export function audioEnergy(band = 'level') {
  if (state.mode === 'off') return 0;
  return state.levels[band] ?? state.levels.level;
}

function resetLevels() {
  state.levels.level = 0;
  state.levels.bass = 0;
  state.levels.mid = 0;
  state.levels.treble = 0;
  state.levels.beat = 0;
  state.spectrum.fill(0);
  state.waveform.fill(0);
  ceiling.level = ceiling.bass = ceiling.mid = ceiling.treble = 0.2;
  bassAverage = 0;
}

function ensureContext() {
  if (!context) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) throw new Error('Web Audio is not available');
    context = new Ctor();
  }
  if (context.state === 'suspended') context.resume().catch(() => {});
  if (!analyser) {
    analyser = context.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.72;
    freqData = new Uint8Array(analyser.frequencyBinCount);
    timeData = new Uint8Array(analyser.fftSize);
  }
  return context;
}

function disconnectSource() {
  try {
    sourceNode?.disconnect();
  } catch (err) {
    // Already disconnected.
  }
  sourceNode = null;
  try {
    analyser?.disconnect();
  } catch (err) {
    // Not connected to the speakers.
  }
  if (micStream) {
    for (const track of micStream.getTracks()) track.stop();
    micStream = null;
  }
  if (fileElement) {
    fileElement.pause();
    fileElement.removeAttribute('src');
    fileElement.load();
    fileElement = null;
  }
  if (fileUrl) {
    URL.revokeObjectURL(fileUrl);
    fileUrl = null;
  }
}

export function stopAudio() {
  disconnectSource();
  state.mode = 'off';
  state.label = '';
  resetLevels();
  notify();
}

export async function startMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone is not available here');
  // Desktop builds need the operating system to grant access first.
  await window.physmapDesktop?.requestMediaAccess?.('microphone');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    video: false,
  });
  disconnectSource();
  ensureContext();
  micStream = stream;
  sourceNode = context.createMediaStreamSource(stream);
  sourceNode.connect(analyser);
  resetLevels();
  state.mode = 'mic';
  state.label = stream.getAudioTracks()[0]?.label || 'Microphone';
  notify();
}

export async function startAudioFile(file) {
  if (!file) throw new Error('No audio file selected');
  disconnectSource();
  ensureContext();
  fileUrl = URL.createObjectURL(file);
  fileElement = new Audio(fileUrl);
  fileElement.loop = true;
  fileElement.crossOrigin = 'anonymous';
  sourceNode = context.createMediaElementSource(fileElement);
  sourceNode.connect(analyser);
  analyser.connect(context.destination); // a played track should also be heard
  resetLevels();
  state.mode = 'file';
  state.label = file.name;
  notify();
  await fileElement.play();
}

export function startDemoBeat() {
  disconnectSource();
  resetLevels();
  state.mode = 'demo';
  state.label = 'Demo beat / 120 BPM';
  notify();
}

function approach(current, target, attack, release) {
  return current + (target - current) * (target > current ? attack : release);
}

function normalise(band, raw) {
  ceiling[band] = Math.max(ceiling[band] * 0.996, raw, 0.06);
  return Math.min(1, (raw / ceiling[band]) * state.sensitivity);
}

function registerBeat(now, strength = 1) {
  state.levels.beat = Math.min(1, strength);
  state.beatCount += 1;
  lastBeatAt = now;
}

function updateDemo(now) {
  const t = now / 1000;
  const beat = (t * 2) % 1; // 120 BPM
  const bar = Math.floor(t * 2) % 8;
  const kick = Math.exp(-beat * 5.5);
  const offbeat = Math.exp(-(((t * 2) + 0.5) % 1) * 9);
  const hat = Math.exp(-(((t * 4) + 0.5) % 1) * 12) * 0.75;
  const melody = 0.45 + 0.35 * Math.sin(t * 1.3) + 0.2 * Math.sin(t * 3.1 + bar);

  const gain = state.sensitivity;
  const levels = state.levels;
  levels.bass = approach(levels.bass, Math.min(1, kick * gain), 0.7, 0.2);
  levels.mid = approach(levels.mid, Math.min(1, (melody * 0.7 + offbeat * 0.3) * gain), 0.5, 0.15);
  levels.treble = approach(levels.treble, Math.min(1, hat * gain), 0.7, 0.25);
  levels.level = Math.min(1, levels.bass * 0.5 + levels.mid * 0.3 + levels.treble * 0.2);

  const beatIndex = Math.floor(t * 2);
  if (beatIndex !== updateDemo.lastIndex) {
    updateDemo.lastIndex = beatIndex;
    registerBeat(now);
  } else {
    levels.beat *= 0.88;
  }

  for (let i = 0; i < SPECTRUM_BARS; i++) {
    const position = i / (SPECTRUM_BARS - 1);
    const low = Math.exp(-position * 7) * levels.bass;
    const middle = Math.exp(-((position - 0.38) ** 2) * 26) * levels.mid;
    const high = Math.exp(-((position - 0.78) ** 2) * 30) * levels.treble;
    const shimmer = 0.07 * (0.5 + 0.5 * Math.sin(t * 9 + i * 1.7));
    const target = Math.min(1, low + middle * 0.8 + high * 0.7 + shimmer);
    state.spectrum[i] = approach(state.spectrum[i], target, 0.6, 0.18);
  }
  for (let i = 0; i < WAVE_POINTS; i++) {
    const x = i / WAVE_POINTS;
    state.waveform[i] =
      Math.sin(x * 12 + t * 6) * levels.bass * 0.6 +
      Math.sin(x * 41 + t * 11) * levels.mid * 0.3 +
      Math.sin(x * 130 + t * 23) * levels.treble * 0.18;
  }
}
updateDemo.lastIndex = -1;

function bandAverage(from, to) {
  let sum = 0;
  const end = Math.min(to, freqData.length - 1);
  for (let i = from; i <= end; i++) sum += freqData[i];
  return sum / Math.max(1, end - from + 1) / 255;
}

function updateAnalyser(now) {
  analyser.getByteFrequencyData(freqData);
  analyser.getByteTimeDomainData(timeData);

  const binHz = context.sampleRate / analyser.fftSize;
  const bin = (hz) => Math.max(1, Math.round(hz / binHz));
  const rawBass = bandAverage(bin(30), bin(220));
  const rawMid = bandAverage(bin(220) + 1, bin(2200));
  const rawTreble = bandAverage(bin(2200) + 1, bin(11000));
  const rawLevel = rawBass * 0.45 + rawMid * 0.35 + rawTreble * 0.2;

  const levels = state.levels;
  levels.bass = approach(levels.bass, normalise('bass', rawBass), 0.65, 0.16);
  levels.mid = approach(levels.mid, normalise('mid', rawMid), 0.55, 0.14);
  levels.treble = approach(levels.treble, normalise('treble', rawTreble), 0.6, 0.18);
  levels.level = approach(levels.level, normalise('level', rawLevel), 0.55, 0.14);

  // Beat = a bass hit clearly above its own recent average.
  bassAverage = bassAverage * 0.93 + rawBass * 0.07;
  if (rawBass > 0.08 && rawBass > bassAverage * 1.32 && now - lastBeatAt > 170) {
    registerBeat(now, 0.6 + rawBass);
  } else {
    levels.beat *= 0.88;
  }

  // Log-spaced bars so bass does not hog the display.
  const maxBin = Math.min(freqData.length - 1, bin(14000));
  for (let i = 0; i < SPECTRUM_BARS; i++) {
    const start = Math.floor(maxBin ** (i / SPECTRUM_BARS));
    const end = Math.max(start, Math.floor(maxBin ** ((i + 1) / SPECTRUM_BARS)) - 1);
    const value = Math.min(1, bandAverage(Math.max(1, start), Math.max(1, end)) * 1.25 * state.sensitivity);
    state.spectrum[i] = approach(state.spectrum[i], value, 0.7, 0.2);
  }
  const stride = timeData.length / WAVE_POINTS;
  for (let i = 0; i < WAVE_POINTS; i++) {
    state.waveform[i] = ((timeData[Math.floor(i * stride)] - 128) / 128) * state.sensitivity;
  }
}

// Advance the analysis once per rendered frame.
export function updateAudio(now) {
  if (state.mode === 'off') return;
  if (now - lastUpdate < 8) return;
  lastUpdate = now;
  if (state.mode === 'demo') updateDemo(now);
  else if (analyser) updateAnalyser(now);
}
