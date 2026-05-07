// Minimal Minecraft-like voxel demo
// - WebGL block renderer with atlas
// - WASD + mouse look + jump + sprint
// - Collisions (AABB) and gravity
// - Break/place blocks with raycast

const canvas = document.getElementById('glcanvas');
const selectedEl = document.getElementById('selected');
const cloudsEl = document.getElementById('clouds');
const musicEl = document.getElementById('music');
const torchEl = document.getElementById('torch');
const debugEl = document.getElementById('debug');
const labEl = document.getElementById('musiclab');
const harvestStatusEl = document.getElementById('harvestStatus');
const objectiveEl = document.getElementById('objective');
const hotbarEl = document.getElementById('hotbar');
const inventoryPanelEl = document.getElementById('inventoryPanel');
const inventoryGridEl = document.getElementById('inventoryGrid');
const objectiveHistoryEl = document.getElementById('objectiveHistory');
const craftingGridEl = document.getElementById('craftingGrid');
const inventoryCloseEl = document.getElementById('inventoryClose');
const chestPanelEl = document.getElementById('chestPanel');
const chestTitleEl = document.getElementById('chestTitle');
const chestPlayerGridEl = document.getElementById('chestPlayerGrid');
const chestStorageGridEl = document.getElementById('chestStorageGrid');
const chestCloseEl = document.getElementById('chestClose');

// Touch/mobile detection
const IS_TOUCH = (('ontouchstart' in window) || (navigator.maxTouchPoints>0) || (window.matchMedia && matchMedia('(pointer: coarse)').matches));
try { if (IS_TOUCH) document.body.classList.add('touch'); } catch {}

// --- Audio (8-bit SFX + music) ---
let audioCtx = null;
let masterGain, sfxGain, musicGain;
let musicEnabled = true;
let sfxEnabled = true;
let musicTimer = null;
let musicStartTimer = null; // delay between tracks
let nextNoteTime = 0;
let musicStep = 0;
let currentTrackIndex = 0;
const DEFAULT_BPM = 128; // original tempo for Track 1
let BPM = DEFAULT_BPM;
let SEC_PER_BEAT = 60 / BPM;
let STEP = SEC_PER_BEAT / 4; // 16th notes (original grid)
const SONG_STEPS = 64; // 4 bars

function initAudio(){
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) {
    console.warn('WebAudio unsupported');
    return;
  }
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.9;
  masterGain.connect(audioCtx.destination);
  sfxGain = audioCtx.createGain();
  sfxGain.gain.value = 0.35; // revert: keep global SFX balanced
  sfxGain.connect(masterGain);
  musicGain = audioCtx.createGain();
  musicGain.gain.value = 0.18;
  musicGain.connect(masterGain);
  if (musicEnabled) startMusic();
}

function resumeAudio(){
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

function mtof(m){ return 440 * Math.pow(2, (m-69)/12); }

function envGain(node, t, a, d, s, r, dur){
  const g = node.gain;
  g.cancelScheduledValues(t);
  g.setValueAtTime(0.0001, t);
  g.exponentialRampToValueAtTime(1.0, t + a);
  g.exponentialRampToValueAtTime(Math.max(0.0001, s), t + a + d);
  g.setTargetAtTime(0.0001, t + dur, r);
}

function playTone({type='square', freq=440, dur=0.08, vol=1.0, slideTo=null, slideTime=0.05, out=mixSfx()}){
  if (!audioCtx || !sfxEnabled) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo){ osc.frequency.linearRampToValueAtTime(slideTo, t+slideTime); }
  g.gain.value = 0.0001;
  envGain(g, t, 0.002, 0.05, 0.2*vol, 0.05, dur);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.1);
}

function playNoise({dur=0.06, vol=0.4, type='highpass', cutoff=600, q=0, sustain=0.15, attack=0.001, decay=0.03, release=0.05}){
  if (!audioCtx || !sfxEnabled) return;
  const t = audioCtx.currentTime;
  const bufferSize = Math.max(1, Math.floor(audioCtx.sampleRate * dur));
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i=0; i<bufferSize; i++) data[i] = Math.random()*2-1;
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  const g = audioCtx.createGain();
  g.gain.value = 0.0001;
  envGain(g, t, attack, decay, sustain*vol, release, dur);
  let out = g;
  if (type){
    const biq = audioCtx.createBiquadFilter();
    biq.type = type;
    biq.frequency.value = cutoff;
    biq.Q.value = q;
    src.connect(biq).connect(g);
  } else {
    src.connect(g);
  }
  g.connect(mixSfx());
  src.start(t);
}

function mixSfx(){ return sfxGain || audioCtx.destination; }
function mixMusic(){ return musicGain || audioCtx.destination; }

// --- Ambient Rain SFX ---
let rainSrc = null;
let rainGain = null;
function startRainSfx(){
  if (!audioCtx) return; // wait until user interacts
  if (rainSrc) return;   // already playing
  // Build a looping white-noise buffer (2 seconds)
  const dur = 2.0;
  const frames = Math.max(1, Math.floor((audioCtx.sampleRate||44100) * dur));
  const buf = audioCtx.createBuffer(1, frames, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i=0;i<frames;i++) data[i] = (Math.random()*2 - 1) * 0.6;
  const src = audioCtx.createBufferSource(); src.buffer = buf; src.loop = true;
  const hp = audioCtx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value = 200; hp.Q.value=0.2;
  const lp = audioCtx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value = 3500; lp.Q.value=0.0;
  const g = audioCtx.createGain(); g.gain.value = 0.0001; // fade in softly
  src.connect(hp).connect(lp).connect(g).connect(masterGain || audioCtx.destination);
  const t = audioCtx.currentTime;
  // Fade to modest level (not too loud)
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.06, t+0.6);
  src.start();
  rainSrc = src; rainGain = g;
}
function stopRainSfx(){
  if (!audioCtx) { rainSrc=null; rainGain=null; return; }
  if (!rainSrc || !rainGain) return;
  const t = audioCtx.currentTime;
  try {
    rainGain.gain.cancelScheduledValues(t);
    rainGain.gain.setValueAtTime(rainGain.gain.value, t);
    rainGain.gain.exponentialRampToValueAtTime(0.0001, t+0.4);
  } catch {}
  try { rainSrc.stop(t+0.45); } catch {}
  rainSrc = null; rainGain = null;
}

function sfxBreak(){
  // Layered crunch: mid band + bright hiss + click
  playNoise({dur:0.09, vol:1.0, type:'bandpass', cutoff:1300, q:1.2, sustain:0.5, attack:0.001, decay:0.02, release:0.06});
  playNoise({dur:0.035, vol:0.7, type:'highpass', cutoff:3000, q:0.0, sustain:0.35, attack:0.0005, decay:0.01, release:0.03});
  playTone({type:'square', freq:1200, slideTo:800, slideTime:0.02, dur:0.025, vol:0.35});
}
function sfxPlace(){ playTone({type:'square', freq:680, slideTo:420, slideTime:0.05, dur:0.08, vol:0.7}); }
function sfxJump(){ playTone({type:'square', freq:380, slideTo:760, slideTime:0.10, dur:0.12, vol:0.6}); }
function sfxStep(){ playNoise({dur:0.03, vol:0.25, type:'highpass', cutoff:700}); }

// Simple chiptune scheduler and multiple tracks
// Flatten rows into a single array while preserving holes (rests)
function pattern(...rows){
  const out = [];
  for (const row of rows){
    const base = out.length;
    out.length = base + row.length;
    for (let i=0;i<row.length;i++){
      if (i in row) out[base + i] = row[i]; // leave holes as rests
    }
  }
  return out;
}

// Exact original single-track patterns (preserve rests)
// (Track patterns follow)

let baseTracks = [
  {
    name: 'Upbeat Meadow', bpm: 128,
    lead: pattern(
      [76,,79,,81,,79,, 76,,79,,81,,84,,],
      [76,,79,,81,,83,, 81,,79,,76,,72,,],
      [74,,77,,79,,77,, 74,,77,,79,,81,,],
      [74,,77,,79,,81,, 79,,77,,74,,71,,],
    ),
    bass: pattern(
      [45, , , , 45, , , , 41, , , , 41, , , ,],
      [43, , , , 43, , , , 47, , , , 47, , , ,],
      [41, , , , 41, , , , 38, , , , 38, , , ,],
      [40, , , , 40, , , , 47, , , , 47, , , ,],
    ),
  },
  {
    name: 'Chill Plains', bpm: 100,
    lead: pattern(
      // Add light pickup notes and neighbor tones for more flow
      [72,,74,,76,,79,78, 76,,74,,72,71,69,,],
      [72,,74,,76,,79,, 81,80,79,, 76,,74,,],
      [71,,72,73,74,,76,, 74,,72,,71,,69,,],
      [71,,72,73,74,,76,77, 78,,76,,74,73,72,,],
    ),
    bass: pattern(
      [36,,, ,36,,, ,33,,, ,33,,, ,],
      [31,,, ,31,,, ,38,,, ,38,,, ,],
      [33,,, ,33,,, ,29,,, ,29,,, ,],
      [31,,, ,31,,, ,38,,, ,38,,, ,],
    ),
  },
  {
    name: 'Minor Depths', bpm: 120,
    lead: pattern(
      [69,,72,,74,,76,, 74,,72,,71,,69,,],
      [71,,74,,76,,78,, 76,,74,,72,,71,,],
      [69,,72,,74,,76,, 78,,76,,74,,72,,],
      [67,,71,,72,,74,, 72,,71,,69,,67,,],
    ),
    bass: pattern(
      [45,,, ,45,,, ,40,,, ,40,,, ,],
      [43,,, ,43,,, ,38,,, ,38,,, ,],
      [40,,, ,40,,, ,36,,, ,36,,, ,],
      [38,,, ,38,,, ,43,,, ,43,,, ,],
    ),
  },
  {
    name: 'Arp Fields', bpm: 140,
    lead: pattern(
      [72,76,79,84, 72,76,79,84, 72,76,79,84, 72,76,79,84],
      [74,77,81,86, 74,77,81,86, 74,77,81,86, 74,77,81,86],
      [72,76,79,84, 72,76,79,84, 74,77,81,86, 74,77,81,86],
      [76,79,83,88, 76,79,83,88, 72,76,79,84, 72,76,79,84],
    ),
    bass: pattern(
      [48,,,48, 48,,,48, 45,,,45, 45,,,45],
      [50,,,50, 50,,,50, 48,,,48, 48,,,48],
      [48,,,48, 48,,,48, 50,,,50, 50,,,50],
      [52,,,52, 52,,,52, 48,,,48, 48,,,48],
    ),
  },
  {
    name: 'Night Run', bpm: 132,
    lead: pattern(
      [79,,79,, 81,,83,, 81,,79,, 76,,74,,],
      [79,,79,, 81,,83,, 84,,83,, 81,,79,,],
      [76,,76,, 78,,79,, 78,,76,, 74,,72,,],
      [76,,76,, 78,,79,, 81,,79,, 78,,76,,],
    ),
    bass: pattern(
      [40,,, ,40,,, ,47,,, ,47,,, ,],
      [38,,, ,38,,, ,45,,, ,45,,, ,],
      [36,,, ,36,,, ,43,,, ,43,,, ,],
      [35,,, ,35,,, ,43,,, ,43,,, ,],
    ),
  },
  {
    name: 'Lofi Hills', bpm: 90,
    lead: pattern(
      [72,0,0,0, 0,0,0,0, 74,0,0,0, 0,0,0,0],
      [72,0,0,0, 0,0,0,0, 69,0,0,0, 0,0,0,0],
      [72,0,0,0, 0,0,0,0, 74,0,0,0, 0,0,0,0],
      [76,0,0,0, 0,0,0,0, 72,0,0,0, 0,0,0,0],
    ),
    bass: pattern(
      [36,,, ,36,,, ,33,,, ,33,,, ,],
      [31,,, ,31,,, ,36,,, ,36,,, ,],
      [29,,, ,29,,, ,33,,, ,33,,, ,],
      [28,,, ,28,,, ,36,,, ,36,,, ,],
    ),
  },
];

let tracks = baseTracks.slice();

// Debug: log lead/bass lengths for all tracks
for (let i=0;i<tracks.length;i++){
  const tr = tracks[i];
  if (!tr || !tr.lead || !tr.bass) continue;
  console.log(`[Track ${i+1}] ${tr.name} lead.length =`, tr.lead.length, 'bass.length =', tr.bass.length);
}


function updateMusicTiming(){
  const tr = tracks[currentTrackIndex];
  BPM = (tr && tr.bpm ? tr.bpm : DEFAULT_BPM);
  SEC_PER_BEAT = 60 / BPM;
  STEP = SEC_PER_BEAT / 4; // 16th grid
}

function scheduleStep(time, step){
  const tr = tracks[currentTrackIndex];
  const idx = step % SONG_STEPS; // lock parts to the bar length
  const l = tr.lead[idx];
  if (l){
    const o = audioCtx.createOscillator();
    o.type = (tr.leadWave || 'square');
    o.frequency.value = mtof(l);
    const g = audioCtx.createGain();
    g.gain.value = 0.0001;
    envGain(g, time, 0.002, 0.06, 0.25, 0.05, STEP*0.9);
    o.connect(g).connect(mixMusic());
    o.start(time);
    o.stop(time + STEP*0.95);
  }
  const b = tr.bass[idx];
  if (b){
    const o = audioCtx.createOscillator();
    o.type = (tr.bassWave || 'triangle');
    o.frequency.value = mtof(b);
    const g = audioCtx.createGain();
    g.gain.value = 0.0001;
    envGain(g, time, 0.002, 0.05, 0.2, 0.08, STEP);
    o.connect(g).connect(mixMusic());
    o.start(time);
    o.stop(time + STEP);
  }
  // hat on off-beats
  const s16 = step % 16;
  if ((tr.hat16 && tr.hat16[s16]) || (!tr.hat16 && (step % 2 === 1))){
    const t = time;
    const bufferSize = Math.max(1, Math.floor(audioCtx.sampleRate * 0.02));
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i=0;i<bufferSize;i++) data[i] = Math.random()*2-1;
    const src = audioCtx.createBufferSource(); src.buffer = buffer;
    const hp = audioCtx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=3000;
    const g = audioCtx.createGain(); g.gain.value=0.0001; envGain(g, t, 0.001, 0.01, 0.12, 0.03, 0.02);
    src.connect(hp).connect(g).connect(mixMusic()); src.start(t);
  }
  // kick on downbeats (quarter notes on 16th grid => every 4 steps)
  if ((tr.kick16 && tr.kick16[s16]) || (!tr.kick16 && (step % 4 === 0))){
    const o = audioCtx.createOscillator(); o.type='sine';
    const g = audioCtx.createGain(); g.gain.value=0.0001;
    o.frequency.setValueAtTime(110, time);
    o.frequency.exponentialRampToValueAtTime(48, time+0.12);
    envGain(g, time, 0.001, 0.05, 0.3, 0.06, 0.15);
    o.connect(g).connect(mixMusic()); o.start(time); o.stop(time+0.18);
  }
}

function startMusic(resume=false){
  if (!audioCtx) return;
  stopMusic();
  updateMusicTiming();
  nextNoteTime = audioCtx.currentTime + 0.05;
  if (!resume) musicStep = 0;
  musicTimer = setInterval(()=>{
    const lookAhead = 0.2;
    while (nextNoteTime < audioCtx.currentTime + lookAhead){
      scheduleStep(nextNoteTime, musicStep);
      nextNoteTime += STEP;
      musicStep = (musicStep + 1) % SONG_STEPS;
    }
  }, 25);
}

function stopMusic(){
  if (musicTimer){ clearInterval(musicTimer); musicTimer=null; }
  if (musicStartTimer){ clearTimeout(musicStartTimer); musicStartTimer=null; }
}

function updateMusicLabel(){
  // Guard against bad index or missing tracks (e.g., after settings load)
  if (!Array.isArray(tracks) || tracks.length === 0){
    if (musicEl) musicEl.textContent = 'Music: No tracks';
    return;
  }
  if (typeof currentTrackIndex !== 'number' || currentTrackIndex < 0 || currentTrackIndex >= tracks.length || !tracks[currentTrackIndex]){
    currentTrackIndex = 0;
  }
  const tr = tracks[currentTrackIndex] || {};
  const bpm = (tr && tr.bpm) ? tr.bpm : DEFAULT_BPM;
  const name = (tr && tr.name) ? tr.name : 'Track';
  if (musicEl) musicEl.textContent = `Track ${currentTrackIndex+1}/`+tracks.length+`: ${name} (${bpm} BPM)`;
}

function setTrack(i){
  if (i<0) i = tracks.length-1; if (i>=tracks.length) i=0;
  const prev = currentTrackIndex;
  currentTrackIndex = i;
  updateMusicLabel();
  saveSettings();
  if (audioCtx && musicEnabled){
    // Insert a short gap (0.5s) when changing songs to avoid abrupt overlap
    if (musicStartTimer){ clearTimeout(musicStartTimer); musicStartTimer=null; }
    stopMusic();
    musicStartTimer = setTimeout(()=>{ musicStartTimer=null; startMusic(); }, 500);
  }
}

// Resize canvas to CSS size
function resizeCanvasToDisplaySize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.floor(canvas.clientWidth * dpr);
  const h = Math.floor(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

// WebGL setup
// Disable MSAA for performance
const gl = canvas.getContext('webgl', { antialias: false, alpha: false });
if (!gl) alert('WebGL not supported');

// Shaders
const VS = `
attribute vec3 a_pos;
attribute vec3 a_norm;
attribute vec2 a_uv;
uniform mat4 u_proj; 
uniform mat4 u_view;
varying vec3 v_norm;
varying vec2 v_uv;
varying vec3 v_worldPos;
void main(){
  v_norm = a_norm;
  v_uv = a_uv;
  v_worldPos = a_pos;
  gl_Position = u_proj * u_view * vec4(a_pos,1.0);
}`;

const FS = `
precision mediump float;
varying vec3 v_norm;
varying vec2 v_uv;
varying vec3 v_worldPos;
uniform sampler2D u_tex;
uniform vec3 u_sunDir;
uniform float u_ambient;
uniform float u_sunDiffuse;
uniform vec3 u_torchPos;      // world-space torch position
uniform float u_torchOn;      // 0 or 1
uniform float u_torchRadius;  // meters
uniform float u_torchIntensity; // brightness scalar
uniform vec3 u_torchDir;      // normalized torch direction (camera forward)
uniform vec3 u_torchColor;    // warm torch color
uniform float u_torchCosInner;// cos(inner cone angle)
uniform float u_torchCosOuter;// cos(outer cone angle)
uniform float u_time;         // seconds, for subtle flicker
// Fog
uniform vec3 u_camPos;        // camera position for distance
uniform vec3 u_fogColor;      // fog target color (match sky near horizon)
uniform float u_fogStart;     // distance where fog begins
uniform float u_fogEnd;       // distance where fog is full
// Emissive lamps (placed blocks)
const int MAX_LAMPS = 32;
uniform int u_lampCount;
uniform vec3 u_lampPos[MAX_LAMPS];
uniform float u_lampRadius;       // meters
uniform float u_lampIntensity;    // scalar
uniform vec3 u_lampColor;
void main(){
  vec3 n = normalize(v_norm);
  float diff = max(dot(n, normalize(u_sunDir)), 0.0);
  float sun = clamp(u_ambient + diff * u_sunDiffuse, 0.0, 1.5);

  // Torch spotlight: distance falloff + cone + lambert, with slight flicker
  vec3 L = v_worldPos - u_torchPos;         // light->fragment
  float d = length(L);
  vec3 Ldir = (d > 0.0) ? (L / d) : vec3(0.0,0.0,1.0);
  float spotRaw = smoothstep(u_torchCosOuter, u_torchCosInner, dot(Ldir, normalize(u_torchDir)));
  // Soften penumbra (gamma < 1 widens)
  float spot = pow(spotRaw, 0.7);
  // Gentle edge: keep full strength until ~65% radius, then ease out
  float atten = 1.0 - smoothstep(u_torchRadius * 0.65, u_torchRadius, d);
  atten = pow(atten, 1.2);
  float ndotl = max(dot(n, normalize(-Ldir)), 0.0);
  float flicker = 0.92 + 0.08 * sin(u_time * 8.7) + 0.05 * sin(u_time * 13.1);
  flicker = clamp(flicker, 0.85, 1.15);
  float torchTerm = u_torchOn * u_torchIntensity * ndotl * atten * spot * flicker;

  // Emissive lamps: radial falloff; near the lamp, add isotropic glow so lamp blocks self‑illuminate
  float lampAccum = 0.0;
  for (int i=0; i<MAX_LAMPS; i++){
    if (i >= u_lampCount) break;
    vec3 L2 = v_worldPos - u_lampPos[i];
    float d2 = length(L2);
    float atten2 = 1.0 - smoothstep(u_lampRadius * 0.4, u_lampRadius, d2);
    atten2 = pow(max(0.0, atten2), 1.1);
    float ndotl2 = max(dot(n, normalize(-L2)), 0.0);
    // Near the lamp center, blend toward isotropic emission so the lamp surface glows
    float near = 1.0 - smoothstep(0.0, u_lampRadius * 0.3, d2);
    float contrib = atten2 * mix(ndotl2, 1.0, near);
    lampAccum += contrib;
  }
  lampAccum = clamp(lampAccum * u_lampIntensity, 0.0, 4.0);

  vec3 light = vec3(sun) + (u_torchColor * torchTerm) + (u_lampColor * lampAccum);
  vec4 tex = texture2D(u_tex, v_uv);
  vec3 base = tex.rgb * clamp(light, 0.0, 2.0);
  // Distance fog (smoothstep between start/end)
  float camDist = distance(u_camPos, v_worldPos);
  float fog = clamp((camDist - u_fogStart) / max(0.0001, (u_fogEnd - u_fogStart)), 0.0, 1.0);
  // Delay ramp so near/mid distances remain crisp
  fog = pow(fog, 1.25);
  vec3 col = mix(base, u_fogColor, fog);
  gl_FragColor = vec4(col, 1.0);
}`;

function makeShader(type, src){
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if(!gl.getShaderParameter(sh, gl.COMPILE_STATUS)){
    console.error(gl.getShaderInfoLog(sh));
    throw new Error('shader compile failed');
  }
  return sh;
}
const prog = gl.createProgram();
gl.attachShader(prog, makeShader(gl.VERTEX_SHADER, VS));
gl.attachShader(prog, makeShader(gl.FRAGMENT_SHADER, FS));
gl.linkProgram(prog);
if(!gl.getProgramParameter(prog, gl.LINK_STATUS)){
  console.error(gl.getProgramInfoLog(prog));
  throw new Error('program link failed');
}
gl.useProgram(prog);

const a_pos = gl.getAttribLocation(prog, 'a_pos');
const a_norm = gl.getAttribLocation(prog, 'a_norm');
const a_uv = gl.getAttribLocation(prog, 'a_uv');
const u_proj = gl.getUniformLocation(prog, 'u_proj');
const u_view = gl.getUniformLocation(prog, 'u_view');
const u_texLoc = gl.getUniformLocation(prog, 'u_tex');
const u_sunDirLoc = gl.getUniformLocation(prog, 'u_sunDir');
const u_ambientLoc = gl.getUniformLocation(prog, 'u_ambient');
const u_sunDiffuseLoc = gl.getUniformLocation(prog, 'u_sunDiffuse');
const u_torchPosLoc = gl.getUniformLocation(prog, 'u_torchPos');
const u_torchOnLoc = gl.getUniformLocation(prog, 'u_torchOn');
const u_torchRadiusLoc = gl.getUniformLocation(prog, 'u_torchRadius');
const u_torchIntensityLoc = gl.getUniformLocation(prog, 'u_torchIntensity');
const u_torchDirLoc = gl.getUniformLocation(prog, 'u_torchDir');
const u_torchColorLoc = gl.getUniformLocation(prog, 'u_torchColor');
const u_torchCosInnerLoc = gl.getUniformLocation(prog, 'u_torchCosInner');
const u_torchCosOuterLoc = gl.getUniformLocation(prog, 'u_torchCosOuter');
const u_timeWorldLoc = gl.getUniformLocation(prog, 'u_time');
const u_camPosLoc = gl.getUniformLocation(prog, 'u_camPos');
const u_fogColorLoc = gl.getUniformLocation(prog, 'u_fogColor');
const u_fogStartLoc = gl.getUniformLocation(prog, 'u_fogStart');
const u_fogEndLoc = gl.getUniformLocation(prog, 'u_fogEnd');
// Lamps
const u_lampCountLoc = gl.getUniformLocation(prog, 'u_lampCount');
const u_lampPosLoc = new Array(32).fill(0).map((_,i)=> gl.getUniformLocation(prog, `u_lampPos[${i}]`));
const u_lampRadiusLoc = gl.getUniformLocation(prog, 'u_lampRadius');
const u_lampIntensityLoc = gl.getUniformLocation(prog, 'u_lampIntensity');
const u_lampColorLoc = gl.getUniformLocation(prog, 'u_lampColor');

// --- Overlay programs (outline + ghost) ---
const OVERLAY_VS = `
attribute vec3 a_pos;
uniform mat4 u_proj;
uniform mat4 u_view;
uniform vec3 u_offset;
uniform float u_expand; // scale around cube center
void main(){
  vec3 c = vec3(0.5);
  vec3 p = (a_pos - c) * (1.0 + u_expand) + c + u_offset;
  gl_Position = u_proj * u_view * vec4(p, 1.0);
}`;
const OVERLAY_FS = `
precision mediump float;
uniform vec4 u_color;
void main(){ gl_FragColor = u_color; }
`;
const overlayProg = makeProgram(OVERLAY_VS, OVERLAY_FS);
const ov_a_pos = gl.getAttribLocation(overlayProg, 'a_pos');
const ov_u_proj = gl.getUniformLocation(overlayProg, 'u_proj');
const ov_u_view = gl.getUniformLocation(overlayProg, 'u_view');
const ov_u_offset = gl.getUniformLocation(overlayProg, 'u_offset');
const ov_u_expand = gl.getUniformLocation(overlayProg, 'u_expand');
const ov_u_color = gl.getUniformLocation(overlayProg, 'u_color');

// Unit cube line list (12 edges -> 24 vertices)
const outlineVBO = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, outlineVBO);
(function(){
  const v = [];
  const P = [
    [0,0,0],[1,0,0],[1,0,1],[0,0,1], // bottom ring
    [0,1,0],[1,1,0],[1,1,1],[0,1,1], // top ring
  ];
  const addEdge = (a,b)=>{ v.push(P[a][0],P[a][1],P[a][2], P[b][0],P[b][1],P[b][2]); };
  // bottom edges
  addEdge(0,1); addEdge(1,2); addEdge(2,3); addEdge(3,0);
  // top edges
  addEdge(4,5); addEdge(5,6); addEdge(6,7); addEdge(7,4);
  // verticals
  addEdge(0,4); addEdge(1,5); addEdge(2,6); addEdge(3,7);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
})();

// Unit cube faces (12 triangles)
const ghostVBO = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, ghostVBO);
(function(){
  const q = (x0,y0,z0,x1,y1,z1,x2,y2,z2,x3,y3,z3)=>[
    x0,y0,z0, x1,y1,z1, x2,y2,z2,
    x0,y0,z0, x2,y2,z2, x3,y3,z3
  ];
  const verts = [].concat(
    // -Z
    q(0,0,0, 1,0,0, 1,1,0, 0,1,0),
    // +Z
    q(0,0,1, 0,1,1, 1,1,1, 1,0,1),
    // -X
    q(0,0,0, 0,1,0, 0,1,1, 0,0,1),
    // +X
    q(1,0,0, 1,0,1, 1,1,1, 1,1,0),
    // -Y
    q(0,0,0, 0,0,1, 1,0,1, 1,0,0),
    // +Y
    q(0,1,0, 1,1,0, 1,1,1, 0,1,1)
  );
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
})();

let debugVisible = false;

// Texture atlas generation (procedural) with bold borders per tile
const TILE_SIZE = 64; // px per tile
const TILES = 8; // 8x8 -> 64 tiles
const ATLAS_SIZE = TILE_SIZE * TILES;

const tileIndex = {
  grass_top: 0,
  grass_side: 1,
  dirt: 2,
  stone: 3,
  sand: 4,
  water: 5,
  rock: 6,
  wood: 7,
  leaf: 8,
  lamp: 9,
  chest: 10,
  ore: 11,
};

function drawTile(ctx, idx, color, borderColor){
  const x = (idx % TILES) * TILE_SIZE;
  const y = Math.floor(idx / TILES) * TILE_SIZE;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 4;
  ctx.strokeRect(x+2, y+2, TILE_SIZE-4, TILE_SIZE-4);
  // slight noise for texture variation
  const n = 200;
  const imgData = ctx.getImageData(x, y, TILE_SIZE, TILE_SIZE);
  for(let i=0;i<n;i++){
    const px = (Math.random()*TILE_SIZE)|0;
    const py = (Math.random()*TILE_SIZE)|0;
    const idx4 = (py*TILE_SIZE+px)*4;
    imgData.data[idx4+0] = (imgData.data[idx4+0]*0.9)|0;
    imgData.data[idx4+1] = (imgData.data[idx4+1]*0.9)|0;
    imgData.data[idx4+2] = (imgData.data[idx4+2]*0.9)|0;
  }
  ctx.putImageData(imgData, x, y);
}

const atlasCanvas = document.createElement('canvas');
atlasCanvas.width = ATLAS_SIZE;
atlasCanvas.height = ATLAS_SIZE;
const actx = atlasCanvas.getContext('2d');
// Create tiles
drawTile(actx, tileIndex.grass_top, '#6fbf50', '#2a4f1b');
drawTile(actx, tileIndex.grass_side, '#5aa143', '#2a4f1b');
drawTile(actx, tileIndex.dirt, '#8b5a2b', '#3a2410');
drawTile(actx, tileIndex.stone, '#9aa0a6', '#50565c');
drawTile(actx, tileIndex.sand, '#e5d38c', '#8c7d3a');
drawTile(actx, tileIndex.water, '#3fa7ff', '#135a8f');
drawTile(actx, tileIndex.rock, '#808080', '#404040');
drawTile(actx, tileIndex.wood, '#9b6b3d', '#5a3a1c');
// Make leaves noticeably darker than grass for clear contrast
drawTile(actx, tileIndex.leaf, '#2a5e1f', '#0e2a09');
drawTile(actx, tileIndex.lamp, '#f2e48a', '#a07f2a');
drawTile(actx, tileIndex.chest, '#b87832', '#5b3314');
drawTile(actx, tileIndex.ore, '#7e8f96', '#2f464f');

// Upload as GL texture
const tex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, tex);
// Trilinear mipmapped filtering for stable distance rendering
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasCanvas);
gl.generateMipmap(gl.TEXTURE_2D);
// Anisotropic filtering for grazing angles / horizon
const anisoExt = gl.getExtension('EXT_texture_filter_anisotropic')
  || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic')
  || gl.getExtension('MOZ_EXT_texture_filter_anisotropic');
if (anisoExt) {
  const maxAniso = gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 8;
  gl.texParameterf(gl.TEXTURE_2D, anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, maxAniso));
}

// Sky pass (full-screen) with gradient, clouds, and sun
function makeProgram(vsSrc, fsSrc){
  const vs = makeShader(gl.VERTEX_SHADER, vsSrc);
  const fs = makeShader(gl.FRAGMENT_SHADER, fsSrc);
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if(!gl.getProgramParameter(p, gl.LINK_STATUS)){
    console.error(gl.getProgramInfoLog(p));
    throw new Error('program link failed');
  }
  return p;
}

const SKY_VS = `
attribute vec2 a_pos;
varying vec2 v_ndc;
void main(){
  v_ndc = a_pos; // clip-space quad in [-1,1]
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const SKY_FS = `
precision mediump float;
varying vec2 v_ndc; // [-1,1]
uniform float u_time;
uniform float u_yaw;
uniform float u_pitch;
uniform float u_fov;
uniform float u_aspect;
uniform int u_cloudMode; // 0 none, 1 wispy, 2 both, 3 puffy
uniform vec3 u_sunDir;   // world-anchored sun direction
uniform float u_day;     // 0 night .. 1 day

// 2D value noise (kept for possible future use)
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f*f*(3.0-2.0*f);
  return mix(a, b, u.x) + (c - a)*u.y*(1.0 - u.x) + (d - b)*u.x*u.y;
}
float fbm(vec2 p){
  float a = 0.5;
  float f = 1.0;
  float s = 0.0;
  for(int i=0;i<5;i++){
    s += a * noise(p*f);
    f *= 2.02;
    a *= 0.5;
  }
  return s;
}

// 3D value noise helpers (for seamless sky sampling)
float hash3(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7, 74.7))) * 43758.5453); }
float noise3(vec3 p){
  vec3 i = floor(p);
  vec3 f = fract(p);
  float n000 = hash3(i + vec3(0.0,0.0,0.0));
  float n100 = hash3(i + vec3(1.0,0.0,0.0));
  float n010 = hash3(i + vec3(0.0,1.0,0.0));
  float n110 = hash3(i + vec3(1.0,1.0,0.0));
  float n001 = hash3(i + vec3(0.0,0.0,1.0));
  float n101 = hash3(i + vec3(1.0,0.0,1.0));
  float n011 = hash3(i + vec3(0.0,1.0,1.0));
  float n111 = hash3(i + vec3(1.0,1.0,1.0));
  vec3 u = f*f*(3.0-2.0*f);
  float nx00 = mix(n000, n100, u.x);
  float nx10 = mix(n010, n110, u.x);
  float nx01 = mix(n001, n101, u.x);
  float nx11 = mix(n011, n111, u.x);
  float nxy0 = mix(nx00, nx10, u.y);
  float nxy1 = mix(nx01, nx11, u.y);
  return mix(nxy0, nxy1, u.z);
}
float fbm3(vec3 p){
  float a = 0.5;
  float f = 1.0;
  float s = 0.0;
  for(int i=0;i<4;i++){
    s += a * noise3(p*f);
    f *= 2.02;
    a *= 0.5;
  }
  return s;
}

// (Stars now computed directly in main; helper removed.)

void main(){
  // Build view ray in camera space
  float tanHalfFov = tan(u_fov*0.5);
  vec3 dirCam = normalize(vec3(v_ndc.x * tanHalfFov * u_aspect, v_ndc.y * tanHalfFov, -1.0));
  // Build camera-to-world basis consistent with world renderer
  float cy = cos(u_yaw), sy = sin(u_yaw);
  float cp = cos(u_pitch), sp = sin(u_pitch);
  vec3 right = vec3(cy, 0.0, -sy);
  vec3 up    = vec3(sy*sp, cp, cy*sp);
  vec3 fwd   = vec3(-sy*cp, sp, -cy*cp);
  // camera->world: worldDir = x*right + y*up + z*(-forward)
  vec3 dir = normalize(dirCam.x*right + dirCam.y*up + dirCam.z*(-fwd));

  // Base sky gradient day/night blend
  float h = clamp(dir.y*0.5 + 0.5, 0.0, 1.0);
  float t = pow(h, 0.65);
  vec3 nightTop = vec3(0.02, 0.05, 0.12);
  vec3 nightBottom = vec3(0.06, 0.08, 0.14);
  vec3 dayTop = vec3(0.38, 0.62, 0.95);
  vec3 dayBottom = vec3(0.70, 0.88, 1.00);
  vec3 topCol = mix(nightTop, dayTop, u_day);
  vec3 botCol = mix(nightBottom, dayBottom, u_day);
  vec3 col = mix(botCol, topCol, t);

  // Domain-warped FBM clouds (seamless over sphere)
  float speed = 0.010; // slightly faster wispy layer
  vec3 wind = normalize(vec3(0.6, 0.0, 0.2));
  vec3 s = dir * 2.0 + wind * (u_time * speed);
  vec3 q = vec3(
    fbm3(s*1.7),
    fbm3(s*1.7 + vec3(5.2,1.3,8.5)),
    fbm3(s*1.7 + vec3(1.7,9.2,2.1))
  );
  vec3 r = vec3(
    fbm3(s*3.1 + 2.0*q + vec3(1.7,9.2,2.1)),
    fbm3(s*3.1 + 2.0*q + vec3(8.3,2.8,1.4)),
    fbm3(s*3.1 + 2.0*q)
  );
  float n = fbm3(s*2.0 + 2.5*r);
  // Sharpen and shape
  float base = smoothstep(0.60, 0.82, n);
  float puff = pow(clamp(n,0.0,1.0), 2.0);
  float clouds1 = clamp(base*0.55 + puff*0.45, 0.0, 1.0);
  // Fade clouds near horizon and below
  float horizonMask = smoothstep(0.00, 0.18, dir.y);
  clouds1 *= horizonMask;
  // Mix wispy layer with mode-specific strength
  float wispyStrength = 0.0;
  if (u_cloudMode == 1)      wispyStrength = 0.45; // wispy only
  else if (u_cloudMode == 2) wispyStrength = 0.28; // both
  // Dim wispy clouds at night slightly
  col = mix(col, vec3(1.0), clouds1 * wispyStrength * mix(0.25, 1.0, u_day));

  // Second layer: larger, cartoonish puffy clouds (bright white, crisp edges)
  float speed2 = 0.004; // slower drift for big puffs
  vec3 wind2 = normalize(vec3(0.2, 0.0, 0.6));
  vec3 s2 = dir * 0.40 + wind2 * (u_time * speed2);
  vec3 q2 = vec3(
    fbm3(s2*1.1),
    fbm3(s2*1.1 + vec3(3.7,0.8,6.1)),
    fbm3(s2*1.1 + vec3(1.1,5.5,2.9))
  );
  vec3 r2 = vec3(
    fbm3(s2*2.0 + 1.8*q2 + vec3(1.7,4.2,2.1)),
    fbm3(s2*2.0 + 1.8*q2 + vec3(5.3,1.8,1.4)),
    fbm3(s2*2.0 + 1.8*q2)
  );
  float d2 = fbm3(s2*1.1 + 1.6*r2);
  // Hard, crisp silhouette and rim for cartoon look (reduced coverage)
  float core = smoothstep(0.48, 0.56, d2);
  float rim  = core * (1.0 - smoothstep(0.56, 0.60, d2));
  core *= horizonMask; rim *= horizonMask;
  // Mode-specific strength: puffy dominates in both/puffy modes
  float puffyStrength = 0.0;
  if (u_cloudMode == 2)      puffyStrength = 0.65; // both (less dominant)
  else if (u_cloudMode == 3) puffyStrength = 0.95; // puffy only
  // Colors: solid white body with a subtle bluish rim
  vec3 bodyColor = vec3(1.0);
  vec3 rimColor  = vec3(0.90, 0.94, 1.0);
  float coreNoRim = max(core - rim*0.95, 0.0);
  // Compose: fill body, then overlay rim for clear edge
  float nightDim = mix(0.30, 1.0, u_day);
  col = mix(col, bodyColor, coreNoRim * puffyStrength * nightDim);
  // Gate rim strictly by puffyStrength so disabled clouds contribute nothing
  col = mix(col, rimColor,  rim * puffyStrength * nightDim);

  // Sun: disk + glow using world-anchored direction
  float cosAng = dot(dir, normalize(u_sunDir));
  float ang = acos(clamp(cosAng, -1.0, 1.0));
  float sun = smoothstep(0.03, 0.02, ang) * u_day;
  float glow = smoothstep(0.22, 0.05, ang) * u_day;
  vec3 sunColor = vec3(1.0, 0.96, 0.85);
  col = mix(col, sunColor, glow*0.35);
  col = mix(col, vec3(1.0), sun);

  // Moon opposite the sun (visible at night)
  vec3 moonDir = -normalize(u_sunDir);
  float mang = acos(clamp(dot(dir, moonDir), -1.0, 1.0));
  float moon = smoothstep(0.035, 0.028, mang) * (1.0 - u_day);
  float mglow = smoothstep(0.18, 0.07, mang) * (1.0 - u_day);
  vec3 moonColor = vec3(0.92, 0.96, 1.0);
  col = mix(col, moonColor, mglow*0.25);
  col = mix(col, vec3(1.0), moon);

  // Stars: increase density (~+50%) and stronger twinkle
  float starVal = noise3(dir * 60.0);
  float stars = smoothstep(0.978, 0.995, starVal);
  // Fade out rapidly after sunrise
  float dayFade = 1.0 - smoothstep(0.02, 0.12, u_day);
  stars *= dayFade;
  float tw = 0.75 + 0.35 * sin(u_time * 4.2 + starVal * 60.0);
  stars *= tw;
  col += vec3(1.0) * stars * 1.20;

  gl_FragColor = vec4(col, 1.0);
}`;

const skyProg = makeProgram(SKY_VS, SKY_FS);
const sky_a_pos = gl.getAttribLocation(skyProg, 'a_pos');
const sky_u_time = gl.getUniformLocation(skyProg, 'u_time');
const sky_u_yaw = gl.getUniformLocation(skyProg, 'u_yaw');
const sky_u_pitch = gl.getUniformLocation(skyProg, 'u_pitch');
const sky_u_fov = gl.getUniformLocation(skyProg, 'u_fov');
const sky_u_aspect = gl.getUniformLocation(skyProg, 'u_aspect');
const sky_u_cloudMode = gl.getUniformLocation(skyProg, 'u_cloudMode');
const sky_u_sunDir = gl.getUniformLocation(skyProg, 'u_sunDir');
const sky_u_day = gl.getUniformLocation(skyProg, 'u_day');
const skyVBO = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, skyVBO);
// full-screen triangle
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
  -1, -1,
   3, -1,
  -1,  3,
]), gl.STATIC_DRAW);

// --- Rain overlay (screen-space) ---
const RAIN_VS = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main(){
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;
const RAIN_FS = `
precision mediump float;
varying vec2 v_uv;
uniform float u_time;
uniform float u_aspect;
uniform float u_alpha;
uniform float u_day;
uniform float u_yaw;

// Thin diagonal lines moving downward; two layers for parallax
float stripe(vec2 uv, float density, float speed, float angle, float width){
  // rotate uv by angle
  float ca = cos(angle), sa = sin(angle);
  vec2 ruv = vec2(ca*uv.x - sa*uv.y, sa*uv.x + ca*uv.y);
  float coord = ruv.x * density + u_time * speed;
  float f = abs(fract(coord) - 0.5);
  float line = smoothstep(width, 0.0, f);
  return line;
}

void main(){
  vec2 uv = v_uv;
  uv.x *= u_aspect;
  // Two layers rotated by ~90 degrees
  float l1 = stripe(uv, 40.0, 1.6, 0.07 + u_yaw*0.0, 0.045);
  float l2 = stripe(uv*1.2 + vec2(0.12,0.0), 26.0, 2.4, 0.00 + u_yaw*0.0, 0.040);
  float rain = clamp(l1*0.7 + l2*0.5, 0.0, 1.0);
  // Dim at night slightly
  float vis = mix(0.65, 1.0, u_day);
  float a = rain * u_alpha * vis;
  gl_FragColor = vec4(vec3(0.85,0.9,1.0)*0.9, a);
}`;
const rainProg = makeProgram(RAIN_VS, RAIN_FS);
const rain_a_pos = gl.getAttribLocation(rainProg, 'a_pos');
const rain_u_time = gl.getUniformLocation(rainProg, 'u_time');
const rain_u_aspect = gl.getUniformLocation(rainProg, 'u_aspect');
const rain_u_alpha = gl.getUniformLocation(rainProg, 'u_alpha');
const rain_u_day = gl.getUniformLocation(rainProg, 'u_day');
const rain_u_yaw = gl.getUniformLocation(rainProg, 'u_yaw');

// --- Post-process (FXAA-like) ---
const POST_VS = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main(){
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;
const POST_FS = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_scene;
uniform vec2 u_invRes;

float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }

void main(){
  vec3 rgbM = texture2D(u_scene, v_uv).rgb;
  float lumaM = luma(rgbM);
  // Diagonal samples for gradient
  vec3 rgbNW = texture2D(u_scene, v_uv + vec2(-1.0, -1.0) * u_invRes).rgb;
  vec3 rgbNE = texture2D(u_scene, v_uv + vec2( 1.0, -1.0) * u_invRes).rgb;
  vec3 rgbSW = texture2D(u_scene, v_uv + vec2(-1.0,  1.0) * u_invRes).rgb;
  vec3 rgbSE = texture2D(u_scene, v_uv + vec2( 1.0,  1.0) * u_invRes).rgb;
  // Cardinal samples for color gradient
  vec3 rgbN = texture2D(u_scene, v_uv + vec2( 0.0, -1.0) * u_invRes).rgb;
  vec3 rgbS = texture2D(u_scene, v_uv + vec2( 0.0,  1.0) * u_invRes).rgb;
  vec3 rgbW = texture2D(u_scene, v_uv + vec2(-1.0,  0.0) * u_invRes).rgb;
  vec3 rgbE = texture2D(u_scene, v_uv + vec2( 1.0,  0.0) * u_invRes).rgb;
  float lumaNW = luma(rgbNW);
  float lumaNE = luma(rgbNE);
  float lumaSW = luma(rgbSW);
  float lumaSE = luma(rgbSE);
  float lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
  float lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));

  // Edge thresholds: use both luma and chroma contrast
  float lumaThresh = max(0.012, lumaMax * 0.035);
  float chromaGrad = max(
    max(length(rgbN - rgbS), length(rgbE - rgbW)),
    0.5 * max(length(rgbNE - rgbSW), length(rgbNW - rgbSE))
  );
  float chromaThresh = 0.08; // catches subtle same-hue edges
  if ((lumaMax - lumaMin) < lumaThresh && chromaGrad < chromaThresh){
    gl_FragColor = vec4(rgbM, 1.0);
    return;
  }

  // Luma gradient direction
  vec2 dir;
  dir.x = -((lumaNW + lumaNE) - (lumaSW + lumaSE));
  dir.y =  ((lumaNW + lumaSW) - (lumaNE + lumaSE));

  // Reduce step for stability
  float dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) * 0.25 * 0.4, 0.01);
  float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
  dir = clamp(dir * rcpDirMin, vec2(-12.0), vec2(12.0)) * u_invRes;

  // Sample along edge direction (two-tap + fallback)
  vec3 rgbA = 0.5 * (
    texture2D(u_scene, v_uv + dir * (1.0/3.0 - 0.5)).rgb +
    texture2D(u_scene, v_uv + dir * (2.0/3.0 - 0.5)).rgb
  );
  vec3 rgbB = rgbA * 0.5 + 0.25 * (
    texture2D(u_scene, v_uv + dir * -0.5).rgb +
    texture2D(u_scene, v_uv + dir *  0.5).rgb
  );

  float lumaB = luma(rgbB);
  vec3 result = ((lumaB < lumaMin) || (lumaB > lumaMax)) ? rgbA : rgbB;
  gl_FragColor = vec4(result, 1.0);
}`;
const postProg = makeProgram(POST_VS, POST_FS);
const post_a_pos = gl.getAttribLocation(postProg, 'a_pos');
const post_u_scene = gl.getUniformLocation(postProg, 'u_scene');
const post_u_invRes = gl.getUniformLocation(postProg, 'u_invRes');

// Offscreen framebuffer for scene rendering
let sceneFBO = gl.createFramebuffer();
let sceneTex = gl.createTexture();
let sceneDepth = gl.createRenderbuffer();
let sceneW = 0, sceneH = 0;
let fxaaEnabled = true; // enabled by default

function allocSceneTarget(w, h){
  if (sceneW === w && sceneH === h) return;
  sceneW = w; sceneH = h;
  gl.bindTexture(gl.TEXTURE_2D, sceneTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

  gl.bindRenderbuffer(gl.RENDERBUFFER, sceneDepth);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);

  gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFBO);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTex, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, sceneDepth);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE){
    console.warn('FXAA FBO incomplete:', status);
    fxaaEnabled = false; // fail safe
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// World generation
const WORLD_W = 64;
const WORLD_H = 32;
const WORLD_D = 64;
const BLOCK_ID = {
  AIR: 0,
  GRASS: 1,
  DIRT: 3,
  STONE: 4,
  WATER: 5,
  SAND: 6,
  ROCK: 7,
  WOOD: 8,
  LEAF: 9,
  LAMP: 10,
  CHEST: 11,
  ORE: 12,
};

const blocks = new Uint8Array(WORLD_W * WORLD_H * WORLD_D); // 0=air, >0 block ids

// --- Persistence (localStorage) ---
const STORAGE_KEY = 'voxel_world_v1';
const PLAYER_KEY = 'voxel_player_v1';
const TIME_KEY = 'voxel_time_phase_v1'; // stores phase in [0,1)
const SETTINGS_KEY = 'voxel_settings_v1';
const INVENTORY_KEY = 'voxel_inventory_v1';
const OBJECTIVE_KEY = 'voxel_objectives_v1';
const CHEST_KEY = 'voxel_chests_v1';

function bytesToBase64(bytes){
  let binary = '';
  const chunk = 0x8000; // 32k chunks to avoid call stack overflow
  for (let i=0; i<bytes.length; i+=chunk){
    const sub = bytes.subarray(i, i+chunk);
    binary += String.fromCharCode.apply(null, sub);
  }
  return btoa(binary);
}
function base64ToBytes(b64){
  const binary = atob(b64);
  const len = binary.length;
  const out = new Uint8Array(len);
  for (let i=0;i<len;i++) out[i] = binary.charCodeAt(i);
  return out;
}

// Settings persistence (clouds, time mode, torch, FXAA, music, track)
function saveSettings(){
  try {
    const payload = {
      cloudMode,
      timeMode,
      torchEnabled,
      fxaaEnabled,
      musicEnabled,
      currentTrackIndex,
      flyMode,
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn('Failed saving settings:', e);
  }
}
function loadSettings(){
  try {
    const s = localStorage.getItem(SETTINGS_KEY);
    if (!s) return false;
    const obj = JSON.parse(s);
    if (obj && typeof obj === 'object'){
      if (typeof obj.cloudMode === 'number') cloudMode = obj.cloudMode & 3;
      if (typeof obj.timeMode === 'number') timeMode = Math.max(0, Math.min(2, obj.timeMode|0));
      if (typeof obj.torchEnabled === 'boolean') torchEnabled = obj.torchEnabled;
      if (typeof obj.fxaaEnabled === 'boolean') fxaaEnabled = obj.fxaaEnabled;
      if (typeof obj.musicEnabled === 'boolean') musicEnabled = obj.musicEnabled;
      if (typeof obj.currentTrackIndex === 'number') currentTrackIndex = (obj.currentTrackIndex|0);
      if (typeof obj.flyMode === 'boolean') flyMode = obj.flyMode;
      return true;
    }
  } catch (e) {
    console.warn('Failed loading settings:', e);
  }
  return false;
}

// URL-safe base64 helpers (no padding)
function b64urlEncode(bytes){
  return bytesToBase64(bytes).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function b64urlDecode(str){
  let b64 = str.replace(/-/g,'+').replace(/_/g,'/');
  const pad = b64.length % 4;
  if (pad) b64 += '='.repeat(4 - pad);
  return base64ToBytes(b64);
}

// Simple RLE with varint run lengths: [value:uint8][run:varint]...
function writeVarint(arr, value){
  while (value >= 0x80){ arr.push((value & 0x7F) | 0x80); value >>>= 7; }
  arr.push(value & 0x7F);
}
function readVarint(bytes, i){
  let shift = 0, val = 0;
  while (i < bytes.length){
    const b = bytes[i++];
    val |= (b & 0x7F) << shift;
    if (!(b & 0x80)) break;
    shift += 7;
  }
  return { value: val, next: i };
}
function rleCompress(u8){
  const out = [];
  let prev = u8[0];
  let run = 1;
  for (let i=1;i<u8.length;i++){
    const v = u8[i];
    if (v === prev && run < 0x1fffffff){ run++; }
    else {
      out.push(prev);
      writeVarint(out, run);
      prev = v; run = 1;
    }
  }
  out.push(prev); writeVarint(out, run);
  return new Uint8Array(out);
}
function rleDecompress(u8, outLen){
  const out = new Uint8Array(outLen);
  let i=0, o=0;
  while (i < u8.length && o < outLen){
    const val = u8[i++];
    const r = readVarint(u8, i); i = r.next;
    for (let k=0;k<r.value && o<outLen;k++) out[o++] = val;
  }
  return out;
}

function hash2i(x,z){
  let n = (x * 374761393 + z * 668265263) | 0;
  n = (n ^ (n >>> 13)) | 0;
  n = Math.imul(n, 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function hash3i(x,y,z){
  let n = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function placeBaseTree(arr, x, y, z){
  const h = 4 + ((hash2i(x+11,z-7) * 3)|0);
  for (let i=0; i<h && y+i<WORLD_H; i++){
    arr[idx(x,y+i,z)] = BLOCK_ID.WOOD;
  }
  const topY = y + h - 1;
  for (let dy=-2; dy<=1; dy++){
    const ly = topY + dy;
    if (ly < y+2 || ly >= WORLD_H) continue;
    const radius = dy === 1 ? 1 : dy === -2 ? 1 : 2;
    for (let dz=-radius; dz<=radius; dz++){
      for (let dx=-radius; dx<=radius; dx++){
        if ((dx*dx + dz*dz) > radius*radius + 0.35) continue;
        if (dx===0 && dz===0 && dy<=0) continue;
        const lx = x+dx, lz = z+dz;
        if (lx<1 || lz<1 || lx>=WORLD_W-1 || lz>=WORLD_D-1) continue;
        if (arr[idx(lx,ly,lz)] === BLOCK_ID.AIR) arr[idx(lx,ly,lz)] = BLOCK_ID.LEAF;
      }
    }
  }
}

function shouldPlaceBaseTree(x,z,h){
  if (x < 4 || z < 4 || x > WORLD_W-5 || z > WORLD_D-5 || h <= WATER_LEVEL+1) return false;
  if (((x * 3 + z * 5) % 7) !== 0) return false;
  return hash2i(x,z) < 0.16;
}

function fillTerrainBaseArray({ resources=false, trees=false } = {}){
  const arr = new Uint8Array(blocks.length);
  for(let z=0; z<WORLD_D; z++){
    for(let x=0; x<WORLD_W; x++){
      const h = heightAt(x,z);
      for(let y=0; y<=h; y++){
        const isTop = y===h;
        let id = 0;
        if (isTop) id = BLOCK_ID.GRASS;
        else if (y >= h-2) id = BLOCK_ID.DIRT;
        else {
          id = BLOCK_ID.STONE;
          if (resources && y >= h-6 && y <= h-2 && hash3i(x,y,z) < 0.055) id = BLOCK_ID.ROCK;
          else if (resources && y <= Math.max(3, h-8) && hash3i(x+17,y,z-23) < 0.035) id = BLOCK_ID.ORE;
        }
        arr[idx(x,y,z)] = id;
      }
      if (h < WATER_LEVEL){
        for(let y=h+1; y<=WATER_LEVEL; y++){
          arr[idx(x,y,z)] = BLOCK_ID.WATER;
        }
      }
    }
  }
  if (trees){
    for(let z=0; z<WORLD_D; z++){
      for(let x=0; x<WORLD_W; x++){
        const h = heightAt(x,z);
        if (shouldPlaceBaseTree(x,z,h)) placeBaseTree(arr, x, h+1, z);
      }
    }
  }
  return arr;
}

function buildLegacyBaseWorldArray(){
  return fillTerrainBaseArray({ resources: false, trees: false });
}

// Build deterministic base world including Survival Builder resources.
function buildBaseWorldArray(){
  return fillTerrainBaseArray({ resources: true, trees: true });
}

function migrateSurvivalResourcesIntoWorld(){
  const legacy = buildLegacyBaseWorldArray();
  const upgraded = buildBaseWorldArray();
  for (let i=0; i<blocks.length; i++){
    if (legacy[i] !== BLOCK_ID.AIR && blocks[i] === legacy[i] && upgraded[i] !== legacy[i]) {
      blocks[i] = upgraded[i];
    }
  }
  migrateLegacyWoodSourcesIntoWorld(legacy);
}

function migrateLegacyWoodSourcesIntoWorld(legacy){
  for(let z=0; z<WORLD_D; z++){
    for(let x=0; x<WORLD_W; x++){
      const h = heightAt(x,z);
      if (!shouldPlaceBaseTree(x,z,h)) continue;
      const ground = idx(x,h,z);
      if (h+1 >= WORLD_H) continue;
      const above = idx(x,h+1,z);
      if (blocks[ground] !== legacy[ground]) continue;
      if (legacy[ground] !== BLOCK_ID.GRASS) continue;
      if (blocks[above] !== legacy[above] || legacy[above] !== BLOCK_ID.AIR) continue;
      blocks[ground] = BLOCK_ID.WOOD;
    }
  }
}

function encodeDeltaFromBase(){
  const base = buildBaseWorldArray();
  const out = [];
  // collect indices that differ
  const diffs = [];
  for (let i=0;i<blocks.length;i++){
    if (blocks[i] !== base[i]) diffs.push(i);
  }
  // write count
  writeVarint(out, diffs.length);
  // delta-encode indices
  let prev = 0;
  for (let j=0;j<diffs.length;j++){
    const i = diffs[j];
    writeVarint(out, i - prev);
    out.push(blocks[i]);
    prev = i;
  }
  return new Uint8Array(out);
}

function decodeDeltaIntoWorld(body, base=buildBaseWorldArray()){
  blocks.set(base);
  // read count
  let i = 0; const r = readVarint(body, i); let count = r.value; i = r.next;
  let index = 0;
  for (let k=0;k<count;k++){
    const dv = readVarint(body, i); i = dv.next;
    index += dv.value; // delta
    const val = body[i++];
    if (index>=0 && index<blocks.length) blocks[index] = val;
  }
}

// Encode world blocks → compact url-safe string
function encodeWorldToCode(){
  // Option A: full RLE
  const headerV3 = new Uint8Array([86,87,51, WORLD_W, WORLD_H, WORLD_D]); // 'V''W''3' + dims
  const fullBody = rleCompress(blocks);
  const full = new Uint8Array(headerV3.length + 1 + fullBody.length);
  full.set(headerV3, 0); full[headerV3.length] = 0; // mode=0 full
  full.set(fullBody, headerV3.length+1);

  // Option B: delta from base world
  const deltaBytes = encodeDeltaFromBase();
  const delta = new Uint8Array(headerV3.length + 1 + deltaBytes.length);
  delta.set(headerV3, 0); delta[headerV3.length] = 1; // mode=1 delta
  delta.set(deltaBytes, headerV3.length+1);

  const a = b64urlEncode(full);
  const b = b64urlEncode(delta);
  return (b.length < a.length) ? b : a;
}
function decodeWorldFromCode(code){
  const data = b64urlDecode(code);
  if (data.length < 6) throw new Error('Invalid code');
  if (data[0] !== 86 || data[1] !== 87) throw new Error('Bad magic');
  const ver = data[2];
  const w = data[3], h = data[4], d = data[5];
  if (w!==WORLD_W || h!==WORLD_H || d!==WORLD_D) throw new Error('World size mismatch');
  if (ver === 49) { // '1' legacy full RLE
    const body = data.subarray(6);
    const decompressed = rleDecompress(body, blocks.length);
    if (decompressed.length !== blocks.length) throw new Error('Decompress mismatch');
    blocks.set(decompressed);
  } else if (ver === 50 || ver === 51) { // '2' or '3'
    const mode = data[6];
    const body = data.subarray(7);
    if (mode === 0){
      const decompressed = rleDecompress(body, blocks.length);
      if (decompressed.length !== blocks.length) throw new Error('Decompress mismatch');
      blocks.set(decompressed);
    } else if (mode === 1){
      const base = ver === 50 ? buildLegacyBaseWorldArray() : buildBaseWorldArray();
      decodeDeltaIntoWorld(body, base);
    } else {
      throw new Error('Unknown mode');
    }
  } else {
    throw new Error('Unknown version');
  }
  if (ver < 51) migrateSurvivalResourcesIntoWorld();
  worldDirty = true;
}

async function copyWorldCode(){
  const code = encodeWorldToCode();
  try {
    if (navigator.clipboard && navigator.clipboard.writeText){
      await navigator.clipboard.writeText(code);
    } else {
      const ta = document.createElement('textarea');
      ta.value = code; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    }
    console.log('World code copied. Length:', code.length);
  } catch (e) {
    console.warn('Copy failed:', e);
    alert('Copy failed. See console for the code.');
    console.log(code);
  }
}

function promptLoadWorldCode(){
  const str = prompt('Paste world code:');
  if (!str) return;
  try {
    decodeWorldFromCode(str.trim());
    resetChestsForCurrentWorld();
    saveWorld();
    saveChests();
    // Ensure player isn't trapped in blocks after load
    ensurePlayerNotStuck();
    alert('World loaded!');
  } catch (e){
    console.warn(e);
    alert('Failed to load code: ' + e.message);
  }
}

function saveWorld(){
  try {
    const payload = {
      w: WORLD_W, h: WORLD_H, d: WORLD_D,
      survivalBuilderVersion: 1,
      data: bytesToBase64(blocks)
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn('Failed saving world:', e);
  }
}
function loadWorld(){
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (!s) return false;
    const obj = JSON.parse(s);
    if (obj.w !== WORLD_W || obj.h !== WORLD_H || obj.d !== WORLD_D) return false;
    const arr = base64ToBytes(obj.data);
    if (arr.length !== blocks.length) return false;
    blocks.set(arr);
    if ((obj.survivalBuilderVersion|0) < 1) {
      migrateSurvivalResourcesIntoWorld();
      saveWorld();
    }
    return true;
  } catch (e) {
    console.warn('Failed loading world:', e);
    return false;
  }
}

// Time persistence (store phase in [0,1))
function saveTimePhase(){
  try {
    const phase = (worldTime % DAY_LENGTH) / DAY_LENGTH;
    localStorage.setItem(TIME_KEY, JSON.stringify({ phase }));
  } catch (e) { console.warn('Failed saving time:', e); }
}
function loadTimePhase(){
  try {
    const s = localStorage.getItem(TIME_KEY);
    if (!s) return null;
    const obj = JSON.parse(s);
    const p = Number(obj.phase);
    if (Number.isFinite(p) && p >= 0 && p < 1) return p;
    return null;
  } catch (e) { console.warn('Failed loading time:', e); return null; }
}

let saveTimer = null;
function scheduleSave(){
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveWorld, 1000);
}
window.addEventListener('beforeunload', ()=>{ saveWorld(); savePlayer(); saveTimePhase(); saveInventory(); saveObjectiveProgress(); saveChests(); });
document.addEventListener('visibilitychange', ()=>{
  if (document.visibilityState === 'hidden'){
    // Persist state
    saveWorld(); savePlayer(); saveTimePhase(); saveInventory(); saveObjectiveProgress(); saveChests();
    // Pause all audio scheduling to avoid throttled/uneven timers
    stopMusic();
    stopLabPreview();
  } else if (document.visibilityState === 'visible'){
    // Resume appropriate audio path
    initAudio();
    resumeAudio();
    if (labEl && !labEl.classList.contains('hidden')){
      startLabPreview();
    } else if (musicEnabled) {
      startMusic(true); // resume at previous step
    }
  }
});

function clampPitch(p){
  const lim = Math.PI/2 - 0.01;
  return Math.max(-lim, Math.min(lim, p));
}

function savePlayer(){
  try {
    const payload = {
      pos: player.pos,
      yaw: player.yaw,
      pitch: player.pitch,
      sel: selectedIndex,
    };
    localStorage.setItem(PLAYER_KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn('Failed saving player:', e);
  }
}
function loadPlayer(){
  try {
    const s = localStorage.getItem(PLAYER_KEY);
    if (!s) return false;
    const obj = JSON.parse(s);
    if (!obj || !Array.isArray(obj.pos) || obj.pos.length!==3) return false;
    player.pos = [Number(obj.pos[0])||0, Number(obj.pos[1])||0, Number(obj.pos[2])||0];
    player.yaw = Number(obj.yaw)||0;
    player.pitch = clampPitch(Number(obj.pitch)||0);
    // Defer applying selected block until UI/init variables exist
    if (typeof obj.sel === 'number'){
      window.__loadedSelectedIndex = (obj.sel|0);
    }
    return true;
  } catch (e) {
    console.warn('Failed loading player:', e);
    return false;
  }
}

function idx(x,y,z){ return x + z*WORLD_W + y*WORLD_W*WORLD_D; }

// Simple pseudo-noise using sines for hills
function heightAt(x,z){
  const h = 10 + Math.floor(4*Math.sin(x*0.15) + 3*Math.cos(z*0.12) + 2*Math.sin((x+z)*0.1));
  return Math.max(3, Math.min(WORLD_H-2, h));
}

const WATER_LEVEL = 8;

// Try to load world; otherwise generate and then save
if (!loadWorld()){
  blocks.set(buildBaseWorldArray());
  // initial save
  saveWorld();
}

// Block type -> tile per face
// ids: 0=air,1=grass,3=dirt,4=stone,5=water,6=sand,7=rock, 8=wood, 9=leaf, 10=lamp
const BLOCK = {
  ...BLOCK_ID,
};

const BLOCK_TILES = {
  [BLOCK.GRASS]: { top: tileIndex.grass_top, side: tileIndex.grass_side, bottom: tileIndex.dirt },
  [BLOCK.DIRT]: { top: tileIndex.dirt, side: tileIndex.dirt, bottom: tileIndex.dirt },
  [BLOCK.STONE]: { top: tileIndex.stone, side: tileIndex.stone, bottom: tileIndex.stone },
  [BLOCK.WATER]: { top: tileIndex.water, side: tileIndex.water, bottom: tileIndex.water },
  [BLOCK.SAND]:  { top: tileIndex.sand, side: tileIndex.sand, bottom: tileIndex.sand },
  [BLOCK.ROCK]:  { top: tileIndex.rock, side: tileIndex.rock, bottom: tileIndex.rock },
  [BLOCK.WOOD]:  { top: tileIndex.wood, side: tileIndex.wood, bottom: tileIndex.wood },
  [BLOCK.LEAF]:  { top: tileIndex.leaf, side: tileIndex.leaf, bottom: tileIndex.leaf },
  [BLOCK.LAMP]:  { top: tileIndex.lamp, side: tileIndex.lamp, bottom: tileIndex.lamp },
  [BLOCK.CHEST]: { top: tileIndex.chest, side: tileIndex.chest, bottom: tileIndex.wood },
  [BLOCK.ORE]:   { top: tileIndex.ore, side: tileIndex.ore, bottom: tileIndex.ore },
};

// Representative colors for block outline/UI accents (match drawTile base colors)
const BLOCK_COLOR = {
  [BLOCK.GRASS]: '#6fbf50',
  [BLOCK.DIRT]:  '#8b5a2b',
  [BLOCK.STONE]: '#9aa0a6',
  [BLOCK.WATER]: '#3fa7ff',
  [BLOCK.SAND]:  '#e5d38c',
  [BLOCK.ROCK]:  '#808080',
  [BLOCK.WOOD]:  '#9b6b3d',
  [BLOCK.LEAF]:  '#2a5e1f',
  [BLOCK.LAMP]:  '#f2e48a',
  [BLOCK.CHEST]: '#b87832',
  [BLOCK.ORE]:   '#7e8f96',
};

const MAX_STACK = 99;
function blockItemId(blockId){ return `block:${blockId}`; }

const ITEM_DEFS = {
  [blockItemId(BLOCK.GRASS)]: { name: 'Grass', color: BLOCK_COLOR[BLOCK.GRASS], block: BLOCK.GRASS },
  [blockItemId(BLOCK.DIRT)]: { name: 'Dirt', color: BLOCK_COLOR[BLOCK.DIRT], block: BLOCK.DIRT },
  [blockItemId(BLOCK.STONE)]: { name: 'Stone', color: BLOCK_COLOR[BLOCK.STONE], block: BLOCK.STONE },
  [blockItemId(BLOCK.WATER)]: { name: 'Water', color: BLOCK_COLOR[BLOCK.WATER], block: BLOCK.WATER },
  [blockItemId(BLOCK.SAND)]: { name: 'Sand', color: BLOCK_COLOR[BLOCK.SAND], block: BLOCK.SAND },
  [blockItemId(BLOCK.ROCK)]: { name: 'Rock', color: BLOCK_COLOR[BLOCK.ROCK], block: BLOCK.ROCK },
  [blockItemId(BLOCK.WOOD)]: { name: 'Wood', color: BLOCK_COLOR[BLOCK.WOOD], block: BLOCK.WOOD },
  [blockItemId(BLOCK.LEAF)]: { name: 'Leaf', color: BLOCK_COLOR[BLOCK.LEAF], block: BLOCK.LEAF },
  [blockItemId(BLOCK.LAMP)]: { name: 'Lamp', color: BLOCK_COLOR[BLOCK.LAMP], block: BLOCK.LAMP },
  [blockItemId(BLOCK.CHEST)]: { name: 'Chest', color: BLOCK_COLOR[BLOCK.CHEST], block: BLOCK.CHEST },
  [blockItemId(BLOCK.ORE)]: { name: 'Ore', color: BLOCK_COLOR[BLOCK.ORE], block: BLOCK.ORE },
  plank: { name: 'Planks', color: '#c9964a' },
  stick: { name: 'Sticks', color: '#b77a38' },
  wood_pickaxe: { name: 'Wooden Pickaxe', color: '#c9964a', toolTier: 1 },
  stone_pickaxe: { name: 'Stone Pickaxe', color: '#a8b2bd', toolTier: 2 },
  pickaxe: { name: 'Basic Pickaxe', color: '#a8b2bd', toolTier: 2 },
};

const HARVEST_RULES = {
  [BLOCK.GRASS]: { item: blockItemId(BLOCK.GRASS), amount: 1, hardness: 1, toolTier: 0 },
  [BLOCK.DIRT]:  { item: blockItemId(BLOCK.DIRT), amount: 1, hardness: 1, toolTier: 0 },
  [BLOCK.STONE]: { item: blockItemId(BLOCK.STONE), amount: 1, hardness: 4, toolTier: 1 },
  [BLOCK.WATER]: { item: blockItemId(BLOCK.WATER), amount: 1, hardness: 1, toolTier: 0 },
  [BLOCK.SAND]:  { item: blockItemId(BLOCK.SAND), amount: 1, hardness: 1, toolTier: 0 },
  [BLOCK.ROCK]:  { item: blockItemId(BLOCK.ROCK), amount: 1, hardness: 5, toolTier: 2 },
  [BLOCK.WOOD]:  { item: blockItemId(BLOCK.WOOD), amount: 1, hardness: 2, toolTier: 0 },
  [BLOCK.LEAF]:  { item: blockItemId(BLOCK.LEAF), amount: 1, hardness: 1, toolTier: 0 },
  [BLOCK.LAMP]:  { item: blockItemId(BLOCK.LAMP), amount: 1, hardness: 2, toolTier: 0 },
  [BLOCK.CHEST]: { item: blockItemId(BLOCK.CHEST), amount: 1, hardness: 2, toolTier: 0 },
  [BLOCK.ORE]:   { item: blockItemId(BLOCK.ORE), amount: 1, hardness: 6, toolTier: 2 },
};

const CRAFT_RECIPES = [
  {
    id: 'planks',
    name: 'Wood -> Planks',
    in: { [blockItemId(BLOCK.WOOD)]: 1 },
    out: { plank: 4 },
  },
  {
    id: 'sticks',
    name: 'Planks -> Sticks',
    in: { plank: 2 },
    out: { stick: 4 },
  },
  {
    id: 'wood-pickaxe',
    name: 'Wooden Pickaxe',
    in: { plank: 3, stick: 2 },
    out: { wood_pickaxe: 1 },
  },
  {
    id: 'stone-pickaxe',
    name: 'Stone Pickaxe',
    in: { [blockItemId(BLOCK.STONE)]: 3, stick: 2 },
    out: { stone_pickaxe: 1 },
  },
  {
    id: 'wood-block',
    name: 'Planks -> Wood',
    in: { plank: 4 },
    out: { [blockItemId(BLOCK.WOOD)]: 1 },
  },
  {
    id: 'lamp',
    name: 'Lamp Block',
    in: { [blockItemId(BLOCK.ROCK)]: 1, stick: 1 },
    out: { [blockItemId(BLOCK.LAMP)]: 1 },
  },
  {
    id: 'ore-lamp',
    name: 'Ore Lamp Block',
    in: { [blockItemId(BLOCK.ORE)]: 1, stick: 1 },
    out: { [blockItemId(BLOCK.LAMP)]: 1 },
  },
  {
    id: 'chest',
    name: 'Chest',
    in: { plank: 6 },
    out: { [blockItemId(BLOCK.CHEST)]: 1 },
  },
];

const OBJECTIVES = [
  {
    id: 'harvest-wood',
    title: 'Collect Wood',
    detail: 'Get 1 Wood in your inventory.',
    item: blockItemId(BLOCK.WOOD),
    count: 1,
  },
  {
    id: 'craft-planks',
    title: 'Craft Planks',
    detail: 'Open inventory with I and craft Wood into Planks.',
    item: 'plank',
    count: 4,
  },
  {
    id: 'craft-sticks',
    title: 'Craft Sticks',
    detail: 'Craft Planks into Sticks for tool handles.',
    item: 'stick',
    count: 4,
  },
  {
    id: 'craft-wood-pickaxe',
    title: 'Craft A Wooden Pickaxe',
    detail: 'Craft a Wooden Pickaxe from Planks and Sticks.',
    item: 'wood_pickaxe',
    count: 1,
  },
  {
    id: 'harvest-stone',
    title: 'Harvest Stone',
    detail: 'Select the Wooden Pickaxe and break stone blocks until you have 3 Stone.',
    item: blockItemId(BLOCK.STONE),
    count: 3,
  },
  {
    id: 'craft-stone-pickaxe',
    title: 'Craft A Stone Pickaxe',
    detail: 'Craft a Stone Pickaxe from Stone and Sticks.',
    item: 'stone_pickaxe',
    count: 1,
  },
  {
    id: 'harvest-rock',
    title: 'Harvest Rock Or Ore',
    detail: 'Select the Stone Pickaxe and collect 1 Rock or Ore.',
    check: ()=> getItemCount(blockItemId(BLOCK.ROCK)) + getItemCount(blockItemId(BLOCK.ORE)) >= 1,
    current: ()=> getItemCount(blockItemId(BLOCK.ROCK)) + getItemCount(blockItemId(BLOCK.ORE)),
    count: 1,
  },
  {
    id: 'craft-lamp',
    title: 'Craft A Lamp',
    detail: 'Craft a Lamp Block from Rock or Ore and a Stick.',
    item: blockItemId(BLOCK.LAMP),
    count: 1,
  },
  {
    id: 'craft-chest',
    title: 'Craft A Chest',
    detail: 'Craft a Chest from Planks.',
    item: blockItemId(BLOCK.CHEST),
    count: 1,
  },
  {
    id: 'place-chest',
    title: 'Place The Chest',
    detail: 'Select the Chest hotbar slot and place it as your base anchor.',
    check: ()=> chestExists(),
  },
  {
    id: 'place-lamp-near-chest',
    title: 'Light The Chest',
    detail: 'Place a Lamp within five blocks of a Chest.',
    check: ()=> lampNearChestExists(),
  },
  {
    id: 'build-shelter',
    title: 'Build A Simple Shelter',
    detail: 'Add floor, wall, and roof blocks around a Chest.',
    check: ()=> shelterExists(),
  },
];

function inBounds(x,y,z){
  return x>=0 && z>=0 && y>=0 && x<WORLD_W && z<WORLD_D && y<WORLD_H;
}
function getBlock(x,y,z){
  if (!inBounds(x,y,z)) return 0;
  return blocks[idx(x,y,z)];
}
function setBlock(x,y,z,id){
  if (!inBounds(x,y,z)) return;
  blocks[idx(x,y,z)] = id;
  worldDirty = true;
  scheduleSave();
}

function parsePosKey(key){
  const parts = String(key).split(',').map((part)=> parseInt(part, 10));
  if (parts.length !== 3 || parts.some((v)=> !Number.isFinite(v))) return null;
  return { x: parts[0], y: parts[1], z: parts[2] };
}

function isShelterBlock(id){
  return id !== BLOCK.AIR && id !== BLOCK.WATER && id !== BLOCK.LEAF;
}

function collectChestPositions(){
  const out = [];
  for (let y=0; y<WORLD_H; y++){
    for (let z=0; z<WORLD_D; z++){
      for (let x=0; x<WORLD_W; x++){
        if (getBlock(x,y,z) === BLOCK.CHEST) out.push({ x, y, z });
      }
    }
  }
  return out;
}

function chestExists(){
  return collectChestPositions().length > 0;
}

function lampNearChestExists(){
  const chestsFound = collectChestPositions();
  for (const chest of chestsFound){
    for (let y=Math.max(0, chest.y-3); y<=Math.min(WORLD_H-1, chest.y+4); y++){
      for (let z=Math.max(0, chest.z-5); z<=Math.min(WORLD_D-1, chest.z+5); z++){
        for (let x=Math.max(0, chest.x-5); x<=Math.min(WORLD_W-1, chest.x+5); x++){
          if (getBlock(x,y,z) !== BLOCK.LAMP) continue;
          const dist = Math.hypot(x-chest.x, y-chest.y, z-chest.z);
          if (dist <= 5.0) return true;
        }
      }
    }
  }
  return false;
}

function shelterExists(){
  const chestsFound = collectChestPositions();
  for (const chest of chestsFound){
    let floor = 0, walls = 0, roof = 0;
    for (let dz=-2; dz<=2; dz++){
      for (let dx=-2; dx<=2; dx++){
        if (isShelterBlock(getBlock(chest.x+dx, chest.y-1, chest.z+dz))) floor += 1;
        if (isShelterBlock(getBlock(chest.x+dx, chest.y+3, chest.z+dz))) roof += 1;
      }
    }
    for (let dy=0; dy<=2; dy++){
      for (let i=-2; i<=2; i++){
        if (isShelterBlock(getBlock(chest.x-2, chest.y+dy, chest.z+i))) walls += 1;
        if (isShelterBlock(getBlock(chest.x+2, chest.y+dy, chest.z+i))) walls += 1;
        if (isShelterBlock(getBlock(chest.x+i, chest.y+dy, chest.z-2))) walls += 1;
        if (isShelterBlock(getBlock(chest.x+i, chest.y+dy, chest.z+2))) walls += 1;
      }
    }
    if (floor >= 9 && walls >= 12 && roof >= 4) return true;
  }
  return false;
}

function updateShelterProgress(){
  updateObjectiveProgress();
}

// World mesh generation (cull faces hidden by neighbors)
let worldDirty = true;
let vbuf = gl.createBuffer();
let nbuf = gl.createBuffer();
let tbuf = gl.createBuffer();
let vCount = 0;

const faceNormals = {
  px: [1,0,0], nx: [-1,0,0], pz: [0,0,1], nz: [0,0,-1], py: [0,1,0], ny: [0,-1,0]
};
const faces = [
  {dir:'px', off:[1,0,0], quad:[[1,0,0],[1,1,0],[1,1,1],[1,0,1]]},
  {dir:'nx', off:[-1,0,0], quad:[[0,0,1],[0,1,1],[0,1,0],[0,0,0]]},
  {dir:'pz', off:[0,0,1], quad:[[0,0,1],[1,0,1],[1,1,1],[0,1,1]]},
  {dir:'nz', off:[0,0,-1], quad:[[0,0,0],[0,1,0],[1,1,0],[1,0,0]]},
  {dir:'py', off:[0,1,0], quad:[[0,1,1],[1,1,1],[1,1,0],[0,1,0]]},
  {dir:'ny', off:[0,-1,0], quad:[[0,0,0],[1,0,0],[1,0,1],[0,0,1]]},
];

function pushFace(vertices, normals, uvs, x,y,z, face, tile){
  const q = face.quad; // [v0,v1,v2,v3]
  const n = faceNormals[face.dir];
  // Two triangles: (0,1,2) and (0,2,3)
  const triIdx = [0,1,2, 0,2,3];
  for (let i=0;i<6;i++){
    const p = q[triIdx[i]];
    vertices.push(x+p[0], y+p[1], z+p[2]);
    normals.push(n[0], n[1], n[2]);
  }
  // UVs for the face using tile index
  const t = tile;
  const tx = (t % TILES);
  const ty = Math.floor(t / TILES);
  const eps = 1.5 / ATLAS_SIZE; // padding to avoid bleeding
  const u0 = (tx * TILE_SIZE + eps) / ATLAS_SIZE;
  const v0 = (ty * TILE_SIZE + eps) / ATLAS_SIZE;
  const u1 = ((tx+1) * TILE_SIZE - eps) / ATLAS_SIZE;
  const v1 = ((ty+1) * TILE_SIZE - eps) / ATLAS_SIZE;
  // UVs correspond to quad verts order [0..3]
  const uvQuad = [ [u0,v1],[u1,v1],[u1,v0],[u0,v0] ];
  const uvTris = [uvQuad[0],uvQuad[1],uvQuad[2], uvQuad[0],uvQuad[2],uvQuad[3]];
  for (let i=0;i<6;i++){
    uvs.push(uvTris[i][0], uvTris[i][1]);
  }
}

function rebuildWorld(){
  const vertices = [];
  const normals = [];
  const uvs = [];
  for(let y=0;y<WORLD_H;y++){
    for(let z=0; z<WORLD_D; z++){
      for(let x=0; x<WORLD_W; x++){
        const id = getBlock(x,y,z);
        if (id===0) continue;
        const tiles = BLOCK_TILES[id] || BLOCK_TILES[BLOCK.STONE];
        for (const face of faces){
          const nx = x + face.off[0];
          const ny = y + face.off[1];
          const nz = z + face.off[2];
          const neighbor = getBlock(nx,ny,nz);
          if (neighbor===0){
            const tile = face.dir==='py' ? tiles.top : face.dir==='ny' ? tiles.bottom : tiles.side;
            pushFace(vertices, normals, uvs, x,y,z, face, tile);
          }
        }
      }
    }
  }

  vCount = vertices.length/3;
  gl.bindBuffer(gl.ARRAY_BUFFER, vbuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(a_pos);
  gl.vertexAttribPointer(a_pos, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, nbuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(a_norm);
  gl.vertexAttribPointer(a_norm, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, tbuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(a_uv);
  gl.vertexAttribPointer(a_uv, 2, gl.FLOAT, false, 0, 0);

  worldDirty = false;
}

// Camera and player
const player = {
  pos: [WORLD_W/2, 20, WORLD_D/2],
  vel: [0,0,0],
  yaw: 0,
  pitch: 0,
  onGround: false,
};
const EYE_HEIGHT = 1.62; // raise camera so we can see below
let footstepAcc = 0;
const FOOTSTEP_SPACING = 0.6; // meters between steps
let moveSaveAcc = 0; // accumulate meters moved before autosaving player

function respawn(){
  const sx = (WORLD_W/2)|0;
  const sz = (WORLD_D/2)|0;
  let sy = WORLD_H-2;
  for (let y=WORLD_H-2; y>=0; y--){
    if (getBlock(sx,y,sz)!==0){ sy = y+3; break; }
  }
  player.pos = [sx+0.5, sy, sz+0.5];
  player.vel = [0,0,0];
}
function ensurePlayerNotStuck(){
  // If inside blocks, try moving up to find free space
  let tries = 10;
  console.log("player pos ", player.pos);
  while (tries-- > 0 && aabbIntersectsBlock(player.pos[0], player.pos[1], player.pos[2])){
    player.pos[1] += 0.5;
  }
  if (aabbIntersectsBlock(player.pos[0], player.pos[1], player.pos[2])){
    // As a fallback, keep XZ and place player on top surface at current XZ
    const px = Math.floor(player.pos[0]);
    const pz = Math.floor(player.pos[2]);
    let yTop = WORLD_H - 2;
    for (let y=WORLD_H-2; y>=0; y--){
      if (getBlock(px,y,pz)!==BLOCK.AIR){ yTop = y+2; break; }
    }
    player.pos[1] = yTop + 1e-3;
    player.vel[1] = 0;
    player.onGround = true;
  }
}
// (loadPlayer moved below UI init to avoid TDZ on selection vars)

// Load saved time phase or default to ~10am (sun has been up for ~4h from 6am)
let initialTimePhase = loadTimePhase();
if (initialTimePhase == null) initialTimePhase = (10 - 6) / 24; // 1/6 ≈ 0.1667

// Controls
const keys = new Set();
let sprint = false;
// Cloud rendering mode: 0 none, 1 wispy, 2 both, 3 puffy
let cloudMode = 2;
// Time mode: 0 auto cycle, 1 force day, 2 force night
let timeMode = 0;
// Torch
let torchEnabled = false;
// Fly mode (double Space toggles)
let flyMode = false;
let lastSpaceTap = 0;
let lastCtrlTap = 0;
function updateTorchLabel(){ if (torchEl) torchEl.textContent = `Torch: ${torchEnabled ? 'On' : 'Off'} (F)`; }
// (FXAA HUD removed)

// Load persisted settings early to override defaults
loadSettings();
// Reflect in HUD immediately
updateCloudsLabel();
updateTorchLabel();
updateMusicLabel();
// If flight was persisted, ensure consistent state
if (flyMode) { try { player.onGround = false; player.vel[1] = 0; } catch(e){} }
// Initialize mobile UI (buttons + menu) if touch
initMobileUI();
// Attempt to autostart music on load if enabled (may be deferred by browser until user gesture)
try { if (musicEnabled) initAudio(); } catch {}
window.addEventListener('keydown', (e)=>{
  if (e.code==='F3') {
    e.preventDefault();
    debugVisible = !debugVisible;
    if (debugEl) debugEl.classList.toggle('hidden', !debugVisible);
  }
  if (e.code==='KeyI') {
    e.preventDefault();
    if (labEl && !labEl.classList.contains('hidden')) return;
    toggleInventoryPanel();
    return;
  }
  if (e.code==='KeyX') {
    e.preventDefault();
    if (labEl && !labEl.classList.contains('hidden')) return;
    if (isChestOpen()) toggleChestPanel(false);
    else useTargetOnce();
    return;
  }
  if (isInventoryOpen() || isChestOpen()) return;
  // If music lab is open, only allow 'G' to close it; ignore other game controls
  if (labEl && !labEl.classList.contains('hidden') && e.code !== 'KeyG') return;
  keys.add(e.code);
  if (!audioCtx) initAudio(); else resumeAudio();
  if (e.code==='ShiftLeft' || e.code==='ShiftRight') sprint = true;
  if (e.code==='KeyR') respawn();
  if (e.code==='Space') {
    const t = performance.now();
    // Simple: double Space starts flight (no toggle). Use double Ctrl to end.
    if ((t - lastSpaceTap) < 300) {
      if (!flyMode) {
        flyMode = true;
        player.vel[1] = 0;
        player.onGround = false;
        saveSettings();
      }
    }
    lastSpaceTap = t;
  }
  if (e.code==='ControlLeft' || e.code==='ControlRight') {
    const t = performance.now();
    // Double Ctrl: explicitly end flight (even mid-air)
    if ((t - lastCtrlTap) < 300 && flyMode) {
      flyMode = false;
      saveSettings();
    }
    lastCtrlTap = t;
  }
  if (e.code==='KeyM') {
    initAudio();
    resumeAudio();
    musicEnabled = !musicEnabled;
    if (musicEnabled) startMusic(); else stopMusic();
    saveSettings();
  }
  if (e.code==='KeyG') { // toggle music lab
    e.preventDefault();
    toggleMusicLab();
  }
  if (e.code==='KeyP') { // Save world to clipboard
    e.preventDefault();
    copyWorldCode();
  }
  if (e.code==='KeyO') { // Load world from pasted code
    e.preventDefault();
    promptLoadWorldCode();
  }
  if (e.code==='KeyK') { // Cycle cloud modes
    e.preventDefault();
    cloudMode = (cloudMode + 1) & 3; // 0..3
    updateCloudsLabel();
    saveSettings();
  }
  if (e.code==='KeyT') { // Toggle time: Auto -> Day -> Night
    e.preventDefault();
    timeMode = (timeMode + 1) % 3;
    const names = ['Auto','Day','Night'];
    console.log('Time:', names[timeMode]);
    saveSettings();
  }
  if (e.code==='KeyF') { // Torch toggle (rebound from L)
    e.preventDefault();
    torchEnabled = !torchEnabled;
    updateTorchLabel();
    saveSettings();
  }
  if (e.code==='Comma') { setTrack(currentTrackIndex-1); }
  if (e.code==='Period') { setTrack(currentTrackIndex+1); }
  if (e.code==='Digit1') { setTrack(0); }
  if (e.code==='Digit2') { setTrack(1); }
  if (e.code==='Digit3') { setTrack(2); }
  if (e.code==='Digit4') { setTrack(3); }
  if (e.code==='Digit5') { setTrack(4); }
  if (e.code==='Digit6') { setTrack(5); }
  // Removed track 7
});
window.addEventListener('keyup', (e)=>{
  if (isInventoryOpen() || isChestOpen()) return;
  if (labEl && !labEl.classList.contains('hidden')) return;
  keys.delete(e.code);
  if (e.code==='ShiftLeft' || e.code==='ShiftRight') sprint = false;
});

canvas.addEventListener('click', ()=>{
  initAudio();
  resumeAudio();
  updateMusicLabel();
  // Do not lock pointer if music lab is open
  if ((!labEl || labEl.classList.contains('hidden')) && !isInventoryOpen() && !isChestOpen()) {
    canvas.requestPointerLock();
  }
});

document.addEventListener('pointerlockchange', ()=>{
  if (document.pointerLockElement === canvas){
    document.addEventListener('mousemove', onMouseMove);
  } else {
    document.removeEventListener('mousemove', onMouseMove);
  }
});

function onMouseMove(e){
  const sensitivity = 0.0025;
  player.yaw -= e.movementX * sensitivity;
  player.pitch -= e.movementY * sensitivity;
  const lim = Math.PI/2 - 0.01;
  if (player.pitch > lim) player.pitch = lim;
  if (player.pitch < -lim) player.pitch = -lim;
}

// --- Touch look (mobile) ---
let touchActive = false;
let lastTouchX = 0, lastTouchY = 0;
let forwardTimer = null;
let forwardActive = false;
let tapCandidate = false;
let touchStartTime = 0;
let touchMoveAccum = 0;

function onTouchStart(ev){
  if (!IS_TOUCH) return;
  if (isInventoryOpen() || isChestOpen()) return;
  if (labEl && !labEl.classList.contains('hidden')) return;
  const t = ev.touches[0]; if (!t) return;
  ev.preventDefault();
  // Try to ensure audio starts on first touch if enabled
  try { initAudio(); resumeAudio(); } catch {}
  touchActive = true; tapCandidate = true; touchMoveAccum = 0; touchStartTime = performance.now();
  lastTouchX = t.clientX; lastTouchY = t.clientY;
  // Hold-to-move-forward with longer delay to avoid accidental activation
  clearTimeout(forwardTimer);
  forwardTimer = setTimeout(()=>{
    forwardActive = true; keys.add('KeyW');
  }, 400);
}
function onTouchMove(ev){
  if (!IS_TOUCH || !touchActive) return;
  const t = ev.touches[0]; if (!t) return;
  ev.preventDefault();
  const dx = t.clientX - lastTouchX;
  const dy = t.clientY - lastTouchY;
  lastTouchX = t.clientX; lastTouchY = t.clientY;
  touchMoveAccum += Math.hypot(dx, dy);
  if (touchMoveAccum > 6) tapCandidate = false;
  const sensitivity = 0.0040; // a bit higher for touch
  player.yaw -= dx * sensitivity;
  player.pitch -= dy * sensitivity;
  const lim = Math.PI/2 - 0.01;
  if (player.pitch > lim) player.pitch = lim;
  if (player.pitch < -lim) player.pitch = -lim;
}
function onTouchEnd(ev){
  if (!IS_TOUCH) return;
  ev.preventDefault();
  touchActive = false;
  clearTimeout(forwardTimer);
  if (forwardActive){ keys.delete('KeyW'); forwardActive=false; }
}
canvas.addEventListener('touchstart', onTouchStart, { passive:false });
canvas.addEventListener('touchmove', onTouchMove, { passive:false });
canvas.addEventListener('touchend', onTouchEnd, { passive:false });
canvas.addEventListener('touchcancel', onTouchEnd, { passive:false });

// Block selection and actions
const placeOptions = [
  { type:'block', id: BLOCK.GRASS, item: blockItemId(BLOCK.GRASS), name:'Grass' },
  { type:'block', id: BLOCK.DIRT,  item: blockItemId(BLOCK.DIRT),  name:'Dirt' },
  { type:'block', id: BLOCK.STONE, item: blockItemId(BLOCK.STONE), name:'Stone' },
  { type:'block', id: BLOCK.SAND,  item: blockItemId(BLOCK.SAND),  name:'Sand' },
  { type:'block', id: BLOCK.ROCK,  item: blockItemId(BLOCK.ROCK),  name:'Rock' },
  { type:'block', id: BLOCK.WATER, item: blockItemId(BLOCK.WATER), name:'Water' },
  { type:'block', id: BLOCK.WOOD,  item: blockItemId(BLOCK.WOOD),  name:'Wood' },
  { type:'block', id: BLOCK.LEAF,  item: blockItemId(BLOCK.LEAF),  name:'Leaf' },
  { type:'block', id: BLOCK.LAMP,  item: blockItemId(BLOCK.LAMP),  name:'Lamp' },
  { type:'block', id: BLOCK.CHEST, item: blockItemId(BLOCK.CHEST), name:'Chest' },
  { type:'tool', item: 'wood_pickaxe', name:'Wood Pick' },
  { type:'tool', item: 'stone_pickaxe', name:'Stone Pick' },
];
let selectedIndex = 0;
let inventory = {};
let objectiveProgress = { index: 0, completed: [], flags: {} };
let chests = {};
let openChestKey = null;
let harvestTarget = null;
let harvestStatusTimer = null;

function itemName(itemId){
  return (ITEM_DEFS[itemId] && ITEM_DEFS[itemId].name) || itemId;
}

function getItemCount(itemId){
  return Math.max(0, inventory[itemId]|0);
}

function setItemCount(itemId, count){
  const next = Math.max(0, Math.min(MAX_STACK, count|0));
  if (next > 0) inventory[itemId] = next;
  else delete inventory[itemId];
}

function canAddItem(itemId, amount=1){
  return !!ITEM_DEFS[itemId] && amount > 0 && getItemCount(itemId) + amount <= MAX_STACK;
}

function addItem(itemId, amount=1, persist=true){
  if (!ITEM_DEFS[itemId] || amount <= 0) return false;
  if (!canAddItem(itemId, amount)) return false;
  setItemCount(itemId, getItemCount(itemId) + amount);
  if (persist) {
    saveInventory();
    refreshInventoryUI();
  }
  return true;
}

function removeItem(itemId, amount=1, persist=true){
  if (getItemCount(itemId) < amount) return false;
  setItemCount(itemId, getItemCount(itemId) - amount);
  if (persist) {
    saveInventory();
    refreshInventoryUI();
  }
  return true;
}

function hasIngredients(ingredients){
  for (const itemId of Object.keys(ingredients)){
    if (getItemCount(itemId) < ingredients[itemId]) return false;
  }
  return true;
}

function canFitOutputs(outputs){
  for (const itemId of Object.keys(outputs)){
    if (!canAddItem(itemId, outputs[itemId])) return false;
  }
  return true;
}

function consumeIngredients(ingredients){
  if (!hasIngredients(ingredients)) return false;
  for (const itemId of Object.keys(ingredients)){
    setItemCount(itemId, getItemCount(itemId) - ingredients[itemId]);
  }
  return true;
}

function saveInventory(){
  try {
    localStorage.setItem(INVENTORY_KEY, JSON.stringify({ version: 1, items: inventory }));
  } catch (e) {
    console.warn('Failed saving inventory:', e);
  }
}

function loadInventory(){
  try {
    const s = localStorage.getItem(INVENTORY_KEY);
    if (s) {
      const obj = JSON.parse(s);
      const items = obj && obj.items;
      if (items && typeof items === 'object') {
        inventory = {};
        for (const itemId of Object.keys(items)){
          if (ITEM_DEFS[itemId]) setItemCount(itemId, items[itemId]|0);
        }
        return true;
      }
    }
  } catch (e) {
    console.warn('Failed loading inventory:', e);
  }
  inventory = {};
  addItem(blockItemId(BLOCK.DIRT), 12, false);
  addItem('stick', 2, false);
  saveInventory();
  return false;
}

function chestKey(x,y,z){ return `${x},${y},${z}`; }

function saveChests(){
  try {
    localStorage.setItem(CHEST_KEY, JSON.stringify({ version: 1, chests }));
  } catch (e) {
    console.warn('Failed saving chests:', e);
  }
}

function loadChests(){
  try {
    const s = localStorage.getItem(CHEST_KEY);
    if (!s) return false;
    const obj = JSON.parse(s);
    const data = obj && obj.chests;
    if (!data || typeof data !== 'object') return false;
    chests = {};
    for (const key of Object.keys(data)){
      const source = data[key];
      const items = source && typeof source === 'object' && source.items ? source.items : source;
      if (!items || typeof items !== 'object') continue;
      const clean = {};
      for (const itemId of Object.keys(items)){
        if (ITEM_DEFS[itemId]) {
          const count = Math.max(0, Math.min(MAX_STACK, items[itemId]|0));
          if (count > 0) clean[itemId] = count;
        }
      }
      chests[key] = clean;
    }
    return true;
  } catch (e) {
    console.warn('Failed loading chests:', e);
    return false;
  }
}

function getChestItems(key){
  if (!chests[key]) chests[key] = {};
  return chests[key];
}

function chestItemCount(key, itemId){
  const items = getChestItems(key);
  return Math.max(0, items[itemId]|0);
}

function setChestItemCount(key, itemId, count){
  const items = getChestItems(key);
  const next = Math.max(0, Math.min(MAX_STACK, count|0));
  if (next > 0) items[itemId] = next;
  else delete items[itemId];
}

function chestIsEmpty(key){
  const items = chests[key];
  return !items || Object.keys(items).every((itemId)=> (items[itemId]|0) <= 0);
}

function createChestAt(x,y,z){
  const key = chestKey(x,y,z);
  if (!chests[key]) chests[key] = {};
  saveChests();
  return key;
}

function deleteChestAt(x,y,z){
  delete chests[chestKey(x,y,z)];
  saveChests();
}

function resetChestsForCurrentWorld(){
  const next = {};
  for (const chest of collectChestPositions()){
    next[chestKey(chest.x, chest.y, chest.z)] = {};
  }
  chests = next;
}

function saveObjectiveProgress(){
  try {
    localStorage.setItem(OBJECTIVE_KEY, JSON.stringify({
      version: 1,
      index: objectiveProgress.index|0,
      completed: objectiveProgress.completed || [],
      flags: objectiveProgress.flags || {},
    }));
  } catch (e) {
    console.warn('Failed saving objectives:', e);
  }
}

function loadObjectiveProgress(){
  try {
    const s = localStorage.getItem(OBJECTIVE_KEY);
    if (!s) return false;
    const obj = JSON.parse(s);
    if (!obj || typeof obj !== 'object') return false;
    objectiveProgress = {
      index: Math.max(0, Math.min(OBJECTIVES.length, obj.index|0)),
      completed: Array.isArray(obj.completed) ? obj.completed.filter((id)=> typeof id === 'string') : [],
      flags: (obj.flags && typeof obj.flags === 'object') ? obj.flags : {},
    };
    return true;
  } catch (e) {
    console.warn('Failed loading objectives:', e);
    return false;
  }
}

function getObjectiveState(obj){
  if (!obj) return { done: true, current: 1, target: 1 };
  if (obj.check) {
    const done = !!obj.check();
    const current = obj.current ? obj.current() : (done ? 1 : 0);
    return { done, current, target: obj.count || 1 };
  }
  if (obj.item) {
    const current = getItemCount(obj.item);
    return { done: current >= obj.count, current, target: obj.count };
  }
  if (obj.flag) {
    const done = !!(objectiveProgress.flags && objectiveProgress.flags[obj.flag]);
    return { done, current: done ? 1 : 0, target: 1 };
  }
  return { done: false, current: 0, target: 1 };
}

function updateObjectiveProgress(){
  let advanced = false;
  while (objectiveProgress.index < OBJECTIVES.length) {
    const obj = OBJECTIVES[objectiveProgress.index];
    if (!getObjectiveState(obj).done) break;
    if (!objectiveProgress.completed) objectiveProgress.completed = [];
    if (!objectiveProgress.completed.includes(obj.id)) objectiveProgress.completed.push(obj.id);
    showHarvestStatus(`Objective complete: ${obj.title}`, 1600);
    objectiveProgress.index += 1;
    advanced = true;
  }
  if (advanced) saveObjectiveProgress();
  renderObjective();
}

function markObjectiveFlag(flag){
  if (!objectiveProgress.flags) objectiveProgress.flags = {};
  if (!objectiveProgress.flags[flag]) {
    objectiveProgress.flags[flag] = true;
    saveObjectiveProgress();
  }
  updateObjectiveProgress();
}

function renderObjective(){
  if (!objectiveEl) return;
  if (objectiveProgress.index >= OBJECTIVES.length) {
    objectiveEl.innerHTML = '<div class="objective-title objective-complete">Objectives Complete</div><div class="objective-progress">You have the basics: harvest, craft, and light your build.</div>';
    renderObjectiveHistory();
    return;
  }
  const obj = OBJECTIVES[objectiveProgress.index];
  const state = getObjectiveState(obj);
  const current = Math.min(state.current, state.target);
  objectiveEl.textContent = '';
  const title = document.createElement('div');
  title.className = 'objective-title';
  title.textContent = `Objective ${objectiveProgress.index + 1}/${OBJECTIVES.length}: ${obj.title}`;
  const detail = document.createElement('div');
  detail.className = 'objective-progress';
  detail.textContent = `${obj.detail} (${current}/${state.target})`;
  objectiveEl.append(title, detail);
  renderObjectiveHistory();
}

function renderObjectiveHistory(){
  if (!objectiveHistoryEl) return;
  objectiveHistoryEl.textContent = '';
  const completed = objectiveProgress.completed || [];
  if (!completed.length){
    const empty = document.createElement('div');
    empty.className = 'done';
    empty.textContent = 'No objectives completed yet';
    objectiveHistoryEl.appendChild(empty);
    return;
  }
  for (const id of completed){
    const obj = OBJECTIVES.find((candidate)=> candidate.id === id);
    if (!obj) continue;
    const item = document.createElement('div');
    item.className = 'done';
    item.textContent = obj.title;
    objectiveHistoryEl.appendChild(item);
  }
}

function refreshInventoryUI(){
  updateObjectiveProgress();
  updateSelectedLabel();
  renderHotbar();
  renderInventoryPanel();
}

function updateSelectedLabel(){
  const opt = placeOptions[selectedIndex];
  const count = opt.item ? getItemCount(opt.item) : 0;
  if (selectedEl) selectedEl.textContent = `Selected: ${opt.name} x${count}`;
  // Mobile: reflect in switch button label + outline color
  const btnSwitch = document.getElementById('btnSwitch');
  if (btnSwitch){
    btnSwitch.textContent = `${opt.name} ${count}`;
    let color = '#cccccc';
    if (opt.type === 'block') color = BLOCK_COLOR[opt.id] || color;
    else if (opt.item && ITEM_DEFS[opt.item]) color = ITEM_DEFS[opt.item].color || color;
    btnSwitch.style.borderColor = color;
  }
}

function renderHotbar(){
  if (!hotbarEl) return;
  hotbarEl.textContent = '';
  for (let i=0; i<placeOptions.length; i++){
    const opt = placeOptions[i];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `hotbar-slot${i === selectedIndex ? ' selected' : ''}`;
    btn.title = `${opt.name} (${getItemCount(opt.item)})`;
    btn.addEventListener('click', (e)=>{
      e.preventDefault();
      selectedIndex = i;
      refreshInventoryUI();
      savePlayer();
    });
    const swatch = document.createElement('span');
    swatch.className = 'hotbar-swatch';
    swatch.style.background = opt.type === 'block'
      ? (BLOCK_COLOR[opt.id] || '#cccccc')
      : ((ITEM_DEFS[opt.item] && ITEM_DEFS[opt.item].color) || '#cccccc');
    const name = document.createElement('span');
    name.textContent = opt.name;
    const count = document.createElement('span');
    count.className = 'hotbar-count';
    count.textContent = String(getItemCount(opt.item));
    btn.append(swatch, name, count);
    hotbarEl.appendChild(btn);
  }
}

function ingredientsText(ingredients){
  return Object.keys(ingredients).map((itemId)=> `${itemName(itemId)} x${ingredients[itemId]}`).join(', ');
}

function outputsText(outputs){
  return Object.keys(outputs).map((itemId)=> `${itemName(itemId)} x${outputs[itemId]}`).join(', ');
}

function craftRecipe(recipe){
  if (!canFitOutputs(recipe.out)) {
    showHarvestStatus(`No room for ${outputsText(recipe.out)}`);
    refreshInventoryUI();
    return false;
  }
  if (!consumeIngredients(recipe.in)) {
    showHarvestStatus(`Need ${ingredientsText(recipe.in)}`);
    refreshInventoryUI();
    return false;
  }
  for (const itemId of Object.keys(recipe.out)){
    setItemCount(itemId, getItemCount(itemId) + recipe.out[itemId]);
  }
  saveInventory();
  refreshInventoryUI();
  showHarvestStatus(`Crafted ${outputsText(recipe.out)}`);
  return true;
}

function renderInventoryPanel(){
  if (inventoryGridEl){
    inventoryGridEl.textContent = '';
    for (const itemId of Object.keys(ITEM_DEFS)){
      const count = getItemCount(itemId);
      if (count <= 0) continue;
      const def = ITEM_DEFS[itemId];
      const item = document.createElement('div');
      item.className = 'inventory-item';
      const swatch = document.createElement('div');
      swatch.className = 'item-swatch';
      swatch.style.background = def.color || '#cccccc';
      const body = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = def.name;
      const amount = document.createElement('div');
      amount.className = 'count';
      amount.textContent = `Count: ${count}`;
      body.append(name, amount);
      item.append(swatch, body);
      inventoryGridEl.appendChild(item);
    }
    if (!inventoryGridEl.children.length){
      const empty = document.createElement('div');
      empty.className = 'inventory-item';
      empty.textContent = 'No resources yet';
      inventoryGridEl.appendChild(empty);
    }
  }
  if (craftingGridEl){
    craftingGridEl.textContent = '';
    for (const recipe of CRAFT_RECIPES){
      const canCraft = hasIngredients(recipe.in) && canFitOutputs(recipe.out);
      const row = document.createElement('div');
      row.className = `recipe${canCraft ? '' : ' disabled'}`;
      const body = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = recipe.name;
      const cost = document.createElement('div');
      cost.className = 'cost';
      cost.textContent = `${ingredientsText(recipe.in)} -> ${outputsText(recipe.out)}`;
      body.append(name, cost);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn';
      btn.textContent = 'Craft';
      btn.disabled = !canCraft;
      btn.addEventListener('click', (e)=>{
        e.preventDefault();
        craftRecipe(recipe);
      });
      row.append(body, btn);
      craftingGridEl.appendChild(row);
    }
  }
}

function renderStorageGrid(gridEl, items, buttonText, onClick){
  if (!gridEl) return;
  gridEl.textContent = '';
  for (const itemId of Object.keys(ITEM_DEFS)){
    const count = Math.max(0, items[itemId]|0);
    if (count <= 0) continue;
    const def = ITEM_DEFS[itemId];
    const row = document.createElement('div');
    row.className = 'inventory-item storage-row';
    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.alignItems = 'center';
    left.style.gap = '8px';
    const swatch = document.createElement('div');
    swatch.className = 'item-swatch';
    swatch.style.background = def.color || '#cccccc';
    const body = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = def.name;
    const amount = document.createElement('div');
    amount.className = 'count';
    amount.textContent = `Count: ${count}`;
    body.append(name, amount);
    left.append(swatch, body);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    btn.textContent = buttonText;
    btn.addEventListener('click', (e)=>{
      e.preventDefault();
      onClick(itemId);
    });
    row.append(left, btn);
    gridEl.appendChild(row);
  }
  if (!gridEl.children.length){
    const empty = document.createElement('div');
    empty.className = 'inventory-item';
    empty.textContent = 'Empty';
    gridEl.appendChild(empty);
  }
}

function renderChestPanel(){
  if (!openChestKey) return;
  const items = getChestItems(openChestKey);
  if (chestTitleEl) chestTitleEl.textContent = `Chest ${openChestKey}`;
  renderStorageGrid(chestPlayerGridEl, inventory, 'Store 1', transferToChest);
  renderStorageGrid(chestStorageGridEl, items, 'Take 1', transferFromChest);
}

function transferToChest(itemId){
  if (!openChestKey || getItemCount(itemId) <= 0) return false;
  if (chestItemCount(openChestKey, itemId) >= MAX_STACK) {
    showHarvestStatus('Chest stack is full');
    return false;
  }
  removeItem(itemId, 1, false);
  setChestItemCount(openChestKey, itemId, chestItemCount(openChestKey, itemId) + 1);
  saveInventory();
  saveChests();
  refreshInventoryUI();
  renderChestPanel();
  updateShelterProgress();
  return true;
}

function transferFromChest(itemId){
  if (!openChestKey || chestItemCount(openChestKey, itemId) <= 0) return false;
  if (getItemCount(itemId) >= MAX_STACK) {
    showHarvestStatus('Inventory stack is full');
    return false;
  }
  setChestItemCount(openChestKey, itemId, chestItemCount(openChestKey, itemId) - 1);
  addItem(itemId, 1, false);
  saveInventory();
  saveChests();
  refreshInventoryUI();
  renderChestPanel();
  return true;
}

function isInventoryOpen(){
  return !!(inventoryPanelEl && !inventoryPanelEl.classList.contains('hidden'));
}

function isChestOpen(){
  return !!(chestPanelEl && !chestPanelEl.classList.contains('hidden'));
}

function toggleInventoryPanel(force){
  if (!inventoryPanelEl) return;
  const open = typeof force === 'boolean' ? force : inventoryPanelEl.classList.contains('hidden');
  inventoryPanelEl.classList.toggle('hidden', !open);
  if (open) {
    keys.clear();
    sprint = false;
    toggleChestPanel(false);
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch {}
    renderInventoryPanel();
  }
}

function toggleChestPanel(force, key=null){
  if (!chestPanelEl) return;
  const open = typeof force === 'boolean' ? force : chestPanelEl.classList.contains('hidden');
  if (open && key) openChestKey = key;
  chestPanelEl.classList.toggle('hidden', !open);
  if (open) {
    keys.clear();
    sprint = false;
    toggleInventoryPanel(false);
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch {}
    renderChestPanel();
  } else {
    openChestKey = null;
  }
}

if (inventoryCloseEl) inventoryCloseEl.addEventListener('click', (e)=>{
  e.preventDefault();
  toggleInventoryPanel(false);
});
if (inventoryPanelEl) inventoryPanelEl.addEventListener('click', (e)=>{
  if (e.target === inventoryPanelEl) toggleInventoryPanel(false);
});
if (chestCloseEl) chestCloseEl.addEventListener('click', (e)=>{
  e.preventDefault();
  toggleChestPanel(false);
});
if (chestPanelEl) chestPanelEl.addEventListener('click', (e)=>{
  if (e.target === chestPanelEl) toggleChestPanel(false);
});

loadObjectiveProgress();
loadChests();
loadInventory();
refreshInventoryUI();
// Apply any loaded selection from storage now that variables exist
if (typeof window !== 'undefined' && window.__loadedSelectedIndex != null){
  selectedIndex = ((window.__loadedSelectedIndex|0)%placeOptions.length + placeOptions.length)%placeOptions.length;
  refreshInventoryUI();
  try { delete window.__loadedSelectedIndex; } catch {}
}

// --- Mobile UI (buttons + menu) ---
function initMobileUI(){
  if (!IS_TOUCH) return;
  // Show controls container
  const mc = document.getElementById('mobileControls');
  if (mc) mc.classList.remove('hidden');
  const btnJump = document.getElementById('btnJump');
  const btnUp = document.getElementById('btnUp');
  const btnDown = document.getElementById('btnDown');
  const btnLeft = document.getElementById('btnLeft');
  const btnRight = document.getElementById('btnRight');
  const btnAdd = document.getElementById('btnAdd');
  const btnRemove = document.getElementById('btnRemove');
  const btnSwitch = document.getElementById('btnSwitch');
  const btnUse = document.getElementById('btnUse');
  const btnInventory = document.getElementById('btnInventory');
  const menuBtn = document.getElementById('menuBtn');
  const menuClose = document.getElementById('menuClose');
  const panel = document.getElementById('menuPanel');
  const mClouds = document.getElementById('menuClouds');
  const mTime = document.getElementById('menuTime');
  const mTorch = document.getElementById('menuTorch');
  const mFxaa = document.getElementById('menuFxaa');
  const mMusic = document.getElementById('menuMusic');
  const mPrevTr = document.getElementById('menuPrevTrack');
  const mNextTr = document.getElementById('menuNextTrack');
  const mTrackLabel = document.getElementById('menuTrackLabel');
  const mFly = document.getElementById('menuFly');
  const mInventory = document.getElementById('menuInventory');
  const mRespawn = document.getElementById('menuRespawn');
  const mSave = document.getElementById('menuSave');
  const mLoad = document.getElementById('menuLoad');

  const setBtnHold = (el, code, withAudio=false)=>{
    if (!el) return;
    const down = ()=> { if (withAudio) { try { initAudio(); resumeAudio(); } catch {} } keys.add(code); };
    const up = ()=> keys.delete(code);
    el.addEventListener('touchstart', (e)=>{ e.preventDefault(); down(); }, {passive:false});
    el.addEventListener('touchend',   (e)=>{ e.preventDefault(); up(); }, {passive:false});
    el.addEventListener('touchcancel',(e)=>{ e.preventDefault(); up(); }, {passive:false});
    el.addEventListener('pointerdown', (e)=>{ e.preventDefault(); down(); });
    el.addEventListener('pointerup',   (e)=>{ e.preventDefault(); up(); });
    el.addEventListener('pointercancel',(e)=>{ e.preventDefault(); up(); });
    el.addEventListener('mouseleave', (e)=>{ e.preventDefault(); up(); });
  };
  setBtnHold(btnJump, 'Space', true);
  setBtnHold(btnUp, 'KeyW');
  setBtnHold(btnDown, 'KeyS');
  // Left/Right: strafe like desktop
  setBtnHold(btnLeft, 'KeyA');
  setBtnHold(btnRight, 'KeyD');

  if (btnAdd) btnAdd.addEventListener('click', (e)=>{ e.preventDefault(); placeSelectedBlockOnce(); });
  if (btnRemove) btnRemove.addEventListener('click', (e)=>{ e.preventDefault(); breakBlockOnce(); });
  if (btnUse) btnUse.addEventListener('click', (e)=>{ e.preventDefault(); useTargetOnce(); });
  if (btnSwitch) btnSwitch.addEventListener('click', (e)=>{
    e.preventDefault();
    selectedIndex = (selectedIndex+1)%placeOptions.length; refreshInventoryUI(); savePlayer();
  });
  if (btnInventory) btnInventory.addEventListener('click', (e)=>{ e.preventDefault(); toggleInventoryPanel(true); });

  function updateMenuLabels(){
    const cloudNames = ['None','Wispy','Both','Puffy'];
    if (mClouds) mClouds.textContent = `Clouds: ${cloudNames[cloudMode]}`;
    const timeNames = ['Auto','Day','Night'];
    if (mTime) mTime.textContent = `Time: ${timeNames[timeMode]}`;
    if (mTorch) mTorch.textContent = `Torch: ${torchEnabled? 'On':'Off'}`;
    if (mFxaa) mFxaa.textContent = `FXAA: ${fxaaEnabled? 'On':'Off'}`;
    if (mMusic) mMusic.textContent = `Music: ${musicEnabled? 'On':'Off'}`;
    const tr = (tracks && tracks[currentTrackIndex]) || {name:'', bpm:DEFAULT_BPM};
    if (mTrackLabel) mTrackLabel.textContent = `Track ${Math.min(currentTrackIndex+1, tracks.length)}/${tracks.length} ${tr.name}`;
    if (mFly) mFly.textContent = `Fly: ${flyMode? 'On':'Off'}`;
  }
  function openMenu(){ if (panel) panel.classList.remove('hidden'); updateMenuLabels(); }
  function closeMenu(){ if (panel) panel.classList.add('hidden'); }
  if (menuBtn) menuBtn.addEventListener('click', (e)=>{ e.preventDefault(); openMenu(); });
  if (menuClose) menuClose.addEventListener('click', (e)=>{ e.preventDefault(); closeMenu(); });
  // Menu actions
  if (mClouds) mClouds.addEventListener('click', (e)=>{ e.preventDefault(); cloudMode=(cloudMode+1)&3; saveSettings(); updateMenuLabels(); });
  if (mTime) mTime.addEventListener('click', (e)=>{ e.preventDefault(); timeMode=(timeMode+1)%3; saveSettings(); updateMenuLabels(); });
  if (mTorch) mTorch.addEventListener('click', (e)=>{ e.preventDefault(); torchEnabled=!torchEnabled; updateTorchLabel(); saveSettings(); updateMenuLabels(); });
  if (mFxaa) mFxaa.addEventListener('click', (e)=>{ e.preventDefault(); fxaaEnabled=!fxaaEnabled; saveSettings(); updateMenuLabels(); });
  if (mMusic) mMusic.addEventListener('click', (e)=>{ e.preventDefault(); initAudio(); resumeAudio(); musicEnabled=!musicEnabled; if(musicEnabled) startMusic(); else stopMusic(); saveSettings(); updateMenuLabels(); });
  if (mPrevTr) mPrevTr.addEventListener('click', (e)=>{ e.preventDefault(); setTrack(currentTrackIndex-1); updateMenuLabels(); });
  if (mNextTr) mNextTr.addEventListener('click', (e)=>{ e.preventDefault(); setTrack(currentTrackIndex+1); updateMenuLabels(); });
  if (mFly) mFly.addEventListener('click', (e)=>{ e.preventDefault(); flyMode=!flyMode; if(!flyMode){ player.vel[1]=0; } saveSettings(); updateMenuLabels(); });
  if (mInventory) mInventory.addEventListener('click', (e)=>{ e.preventDefault(); toggleInventoryPanel(true); closeMenu(); });
  if (mRespawn) mRespawn.addEventListener('click', (e)=>{ e.preventDefault(); respawn(); closeMenu(); });
  if (mSave) mSave.addEventListener('click', (e)=>{ e.preventDefault(); copyWorldCode(); });
  if (mLoad) mLoad.addEventListener('click', (e)=>{ e.preventDefault(); promptLoadWorldCode(); closeMenu(); });
}

function updateCloudsLabel(){
  const names = ['No Clouds','Wispy','Both','Puffy'];
  if (cloudsEl) cloudsEl.textContent = `Clouds: ${names[cloudMode]} (K)`;
  }
  updateCloudsLabel();
  updateTorchLabel();

// Cycle selected block: Q/E and [ ]
window.addEventListener('keydown', (e)=>{
  if (e.code==='KeyQ' || e.code==='BracketLeft') {
    if (labEl && !labEl.classList.contains('hidden')) return;
    if (isInventoryOpen() || isChestOpen()) return;
    selectedIndex = (selectedIndex-1+placeOptions.length)%placeOptions.length; refreshInventoryUI(); savePlayer();
  }
  if (e.code==='KeyE' || e.code==='BracketRight') {
    if (labEl && !labEl.classList.contains('hidden')) return;
    if (isInventoryOpen() || isChestOpen()) return;
    selectedIndex = (selectedIndex+1)%placeOptions.length; refreshInventoryUI(); savePlayer();
  }
});

function doPlaceAt(x,y,z, hit){
  const opt = placeOptions[selectedIndex];
  if (opt.type === 'block'){
    if (!inBounds(x,y,z)) return false;
    if (getBlock(x,y,z)!==BLOCK.AIR) return false;
    if (!removeItem(opt.item, 1, false)) {
      showHarvestStatus(`No ${opt.name} in inventory`);
      refreshInventoryUI();
      return false;
    }
    setBlock(x,y,z, opt.id);
    if (opt.id === BLOCK.CHEST) createChestAt(x,y,z);
    saveInventory();
    refreshInventoryUI();
    if (opt.id === BLOCK.LAMP) markObjectiveFlag('placedLamp');
    if (opt.id === BLOCK.CHEST) markObjectiveFlag('placedChest');
    updateShelterProgress();
    showHarvestStatus(`Placed ${opt.name}`);
    sfxPlace();
    return true;
  }
  return false;
}

function placeSelectedBlockOnce(){
  const yaw = player.yaw;
  const camPos = [player.pos[0], player.pos[1] + EYE_HEIGHT, player.pos[2]];
  const lookDir = [
    -Math.sin(yaw)*Math.cos(player.pitch),
    Math.sin(player.pitch),
    -Math.cos(yaw)*Math.cos(player.pitch)
  ];
  const hit = raycast(camPos, lookDir, 6.0);
  if (hit){
    const tx = hit.x + hit.face[0];
    const ty = hit.y + hit.face[1];
    const tz = hit.z + hit.face[2];
    if (getBlock(tx,ty,tz)===BLOCK.AIR){
      const px = player.pos[0], py = player.pos[1], pz = player.pos[2];
      const inside = (tx+1 > px-PLAYER_W/2 && tx < px+PLAYER_W/2 &&
                      ty+1 > py && ty < py+PLAYER_H &&
                      tz+1 > pz-PLAYER_D/2 && tz < pz+PLAYER_D/2);
      if (!inside) {
        doPlaceAt(tx,ty,tz, hit);
      } else {
        // Special case: allow placing on the block we're standing on when pointing at its top
        const bx = Math.floor(px);
        const by = Math.floor(py);
        const bz = Math.floor(pz);
        const isTopFace = (hit.face[0]===0 && hit.face[1]===1 && hit.face[2]===0);
        const placingAtFeetCell = (tx===bx && ty===by && tz===bz);
        if (isTopFace && placingAtFeetCell){
          const newY = ty + 1 + 1e-3; // stand on top of the placed block
          if (!aabbIntersectsBlock(px, newY, pz)){
            if (doPlaceAt(tx,ty,tz, hit)){
              player.pos[1] = newY;
              player.vel[1] = 0;
              player.onGround = true;
              savePlayer();
            }
          }
        }
      }
    }
  }
}

function breakBlockOnce(){
  const yaw = player.yaw;
  const camPos = [player.pos[0], player.pos[1] + EYE_HEIGHT, player.pos[2]];
  const lookDir = [
    -Math.sin(yaw)*Math.cos(player.pitch),
    Math.sin(player.pitch),
    -Math.cos(yaw)*Math.cos(player.pitch)
  ];
  const hit = raycast(camPos, lookDir, 6.0);
  if (hit){
    harvestBlockAt(hit.x, hit.y, hit.z);
  }
}

function useTargetOnce(){
  const yaw = player.yaw;
  const camPos = [player.pos[0], player.pos[1] + EYE_HEIGHT, player.pos[2]];
  const lookDir = [
    -Math.sin(yaw)*Math.cos(player.pitch),
    Math.sin(player.pitch),
    -Math.cos(yaw)*Math.cos(player.pitch)
  ];
  const hit = raycast(camPos, lookDir, 6.0);
  if (!hit) {
    showHarvestStatus('Nothing to use');
    return false;
  }
  if (getBlock(hit.x, hit.y, hit.z) === BLOCK.CHEST){
    openChestKey = createChestAt(hit.x, hit.y, hit.z);
    toggleChestPanel(true, openChestKey);
    return true;
  }
  showHarvestStatus('Use targets chests');
  return false;
}

function showHarvestStatus(text, timeout=1400){
  if (!harvestStatusEl) return;
  harvestStatusEl.textContent = text;
  harvestStatusEl.classList.remove('hidden');
  if (harvestStatusTimer) clearTimeout(harvestStatusTimer);
  harvestStatusTimer = setTimeout(()=>{
    harvestStatusEl.classList.add('hidden');
  }, timeout);
}

function selectedToolTier(){
  const opt = placeOptions[selectedIndex];
  if (!opt || opt.type !== 'tool' || getItemCount(opt.item) <= 0) return 0;
  const def = ITEM_DEFS[opt.item];
  return (def && def.toolTier) || 0;
}

function neededToolName(tier){
  if (tier >= 2) return 'Stone Pickaxe';
  if (tier >= 1) return 'Wooden Pickaxe';
  return 'Hand';
}

function harvestPowerForBlock(blockId, tier){
  if (blockId === BLOCK.STONE && tier >= 1) return 2;
  if ((blockId === BLOCK.ROCK || blockId === BLOCK.ORE) && tier >= 2) return 2;
  return 1;
}

function harvestBlockAt(x,y,z){
  const blockId = getBlock(x,y,z);
  if (blockId === BLOCK.AIR) return false;
  if (blockId === BLOCK.CHEST && !chestIsEmpty(chestKey(x,y,z))){
    showHarvestStatus('Empty chest before breaking', 1800);
    return false;
  }
  const rule = HARVEST_RULES[blockId] || { item: blockItemId(blockId), amount: 1, hardness: 1, toolTier: 0 };
  const tier = selectedToolTier();
  if (tier < (rule.toolTier || 0)){
    const name = itemName(rule.item);
    showHarvestStatus(`${name} needs ${neededToolName(rule.toolTier)}`, 1800);
    return false;
  }
  if (!canAddItem(rule.item, rule.amount || 1)){
    showHarvestStatus(`${itemName(rule.item)} stack is full`, 1800);
    return false;
  }
  const key = `${x},${y},${z},${blockId}`;
  if (!harvestTarget || harvestTarget.key !== key){
    harvestTarget = { key, progress: 0 };
  }
  const hardness = Math.max(1, rule.hardness|0);
  harvestTarget.progress += harvestPowerForBlock(blockId, tier);
  const def = ITEM_DEFS[rule.item];
  const name = def ? def.name : 'Block';
  if (harvestTarget.progress >= hardness){
    setBlock(x, y, z, BLOCK.AIR);
    if (blockId === BLOCK.CHEST) deleteChestAt(x,y,z);
    if (!addItem(rule.item, rule.amount || 1, true)) return false;
    harvestTarget = null;
    updateShelterProgress();
    showHarvestStatus(`Harvested ${name} x${rule.amount || 1}`);
    sfxBreak();
    return true;
  }
  showHarvestStatus(`${name}: ${Math.min(hardness, harvestTarget.progress)} / ${hardness}`, 2200);
  sfxStep();
  return false;
}

// Bind B to place where we're pointing (with standing-on-block allowance)
window.addEventListener('keydown', (e)=>{
  if (e.code==='KeyB') {
    if (labEl && !labEl.classList.contains('hidden')) return;
    if (isInventoryOpen() || isChestOpen()) return;
    e.preventDefault();
    placeSelectedBlockOnce();
  }
});

// Bind C to break once
window.addEventListener('keydown', (e)=>{
  if (e.code==='KeyC') {
    e.preventDefault();
    if (labEl && !labEl.classList.contains('hidden')) return;
    if (isInventoryOpen() || isChestOpen()) return;
    breakBlockOnce();
  }
});

function canPlaceAtFromHit(hit){
  if (!hit) return null;
  const opt = placeOptions[selectedIndex];
  if (!opt || opt.type !== 'block' || getItemCount(opt.item) <= 0) return null;
  const tx = hit.x + hit.face[0];
  const ty = hit.y + hit.face[1];
  const tz = hit.z + hit.face[2];
  if (!inBounds(tx,ty,tz) || getBlock(tx,ty,tz) !== BLOCK.AIR) return null;
  // Disallow if intersects player AABB, except allow top-face stand-on placement when safe
  const px = player.pos[0], py = player.pos[1], pz = player.pos[2];
  const inside = (tx+1 > px-PLAYER_W/2 && tx < px+PLAYER_W/2 &&
                  ty+1 > py && ty < py+PLAYER_H &&
                  tz+1 > pz-PLAYER_D/2 && tz < pz+PLAYER_D/2);
  if (!inside) return { x: tx, y: ty, z: tz };
  // Allow placing on top of the block we're standing on when pointing at its top, if we can stand after
  const bx = Math.floor(px);
  const by = Math.floor(py);
  const bz = Math.floor(pz);
  const isTopFace = (hit.face[0]===0 && hit.face[1]===1 && hit.face[2]===0);
  const placingAtFeetCell = (tx===bx && ty===by && tz===bz);
  if (isTopFace && placingAtFeetCell){
    const newY = ty + 1 + 1e-3;
    if (!aabbIntersectsBlock(px, newY, pz)){
      return { x: tx, y: ty, z: tz };
    }
  }
  return null;
}

// Tree generator (small trunk + leaves blob)
function placeTreeAt(x,y,z){
  // Trunk
  const h = 5 + (Math.random()<0.5?0:1); // 5–6 blocks tall
  for (let i=0;i<h;i++){
    if (inBounds(x,y+i,z)) setBlock(x,y+i,z, BLOCK.WOOD);
  }
  const topY = y + h - 1;
  // Canopy: 4 layers centered near the top with shrinking radius toward bottom
  // dy from -2..+1 relative to top; radii pattern similar to a simple oak
  for (let dy=-2; dy<=1; dy++){
    const ly = topY + dy;
    if (ly < y + 2) continue; // avoid very low leaves near ground
    let radius = 0;
    if (dy === 1) radius = 1;        // small cap
    else if (dy === 0) radius = 2;   // widest ring
    else if (dy === -1) radius = 2;  // mid ring
    else if (dy === -2) radius = 1;  // small lower ring
    for (let dz=-radius; dz<=radius; dz++){
      for (let dx=-radius; dx<=radius; dx++){
        // Round-ish shape per layer
        if ((dx*dx + dz*dz) > (radius*radius + 0.25)) continue;
        // Avoid filling the trunk shaft below the top
        if (dx===0 && dz===0 && dy<=0) continue;
        const lx = x+dx, lz = z+dz;
        if (!inBounds(lx,ly,lz)) continue;
        if (getBlock(lx,ly,lz) !== BLOCK.AIR) continue;
        setBlock(lx,ly,lz, BLOCK.LEAF);
      }
    }
  }
}

function placeBlockUnderPlayer(){
  const px = player.pos[0], py = player.pos[1], pz = player.pos[2];
  const bx = Math.floor(px);
  const bz = Math.floor(pz);
  let ty = Math.floor(py) - 1;
  // Prefer placing directly under feet; if occupied, try current feet cell
  if (getBlock(bx, ty, bz) !== BLOCK.AIR) {
    ty = Math.floor(py);
  }
  if (!inBounds(bx, ty, bz) || getBlock(bx, ty, bz) !== BLOCK.AIR) return false;
  // Predict new bottom Y if we stand on top
  const newY = ty + 1 + 1e-3;
  // Only place if we can stand there without intersecting
  if (!aabbIntersectsBlock(px, newY, pz)){
    const opt = placeOptions[selectedIndex];
    if (opt.type !== 'block') return false;
    if (!removeItem(opt.item, 1, false)) {
      showHarvestStatus(`No ${opt.name} in inventory`);
      refreshInventoryUI();
      return false;
    }
    setBlock(bx, ty, bz, opt.id);
    if (opt.id === BLOCK.CHEST) createChestAt(bx,ty,bz);
    saveInventory();
    refreshInventoryUI();
    if (opt.id === BLOCK.LAMP) markObjectiveFlag('placedLamp');
    if (opt.id === BLOCK.CHEST) markObjectiveFlag('placedChest');
    updateShelterProgress();
    showHarvestStatus(`Placed ${opt.name}`);
    // Snap player on top
    player.pos[1] = newY;
    player.vel[1] = 0;
    player.onGround = true;
    savePlayer();
    sfxPlace();
    return true;
  }
  return false;
}

// Note: Removed separate V binding; B handles underfoot placement.

let mouseButtons = 0;
window.addEventListener('mousedown', (e)=>{ 
  mouseButtons |= 1<<e.button; 
  // Left click no longer breaks blocks; reserved for camera/pointer lock.
});
window.addEventListener('mouseup',   (e)=>{ mouseButtons &= ~(1<<e.button); });

// Raycast blocks using 3D DDA
function raycast(origin, dir, maxDist){
  let x = Math.floor(origin[0]);
  let y = Math.floor(origin[1]);
  let z = Math.floor(origin[2]);

  const stepX = dir[0] > 0 ? 1 : -1;
  const stepY = dir[1] > 0 ? 1 : -1;
  const stepZ = dir[2] > 0 ? 1 : -1;

  const tDeltaX = Math.abs(1 / (dir[0] || 1e-6));
  const tDeltaY = Math.abs(1 / (dir[1] || 1e-6));
  const tDeltaZ = Math.abs(1 / (dir[2] || 1e-6));

  let tMaxX = ((stepX>0) ? (Math.floor(origin[0])+1-origin[0]) : (origin[0]-Math.floor(origin[0]))) * tDeltaX;
  let tMaxY = ((stepY>0) ? (Math.floor(origin[1])+1-origin[1]) : (origin[1]-Math.floor(origin[1]))) * tDeltaY;
  let tMaxZ = ((stepZ>0) ? (Math.floor(origin[2])+1-origin[2]) : (origin[2]-Math.floor(origin[2]))) * tDeltaZ;

  let t = 0;
  let lastFace = [0,0,0];
  while (t <= maxDist){
    if (inBounds(x,y,z) && getBlock(x,y,z) !== BLOCK.AIR){
      return { x, y, z, face: lastFace };
    }
    if (tMaxX < tMaxY){
      if (tMaxX < tMaxZ){ x += stepX; t = tMaxX; tMaxX += tDeltaX; lastFace=[-stepX,0,0]; }
      else { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; lastFace=[0,0,-stepZ]; }
    } else {
      if (tMaxY < tMaxZ){ y += stepY; t = tMaxY; tMaxY += tDeltaY; lastFace=[0,-stepY,0]; }
      else { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; lastFace=[0,0,-stepZ]; }
    }
  }
  return null;
}

// Physics and collision
const PLAYER_W = 0.6, PLAYER_H = 1.8, PLAYER_D = 0.6;

function aabbIntersectsBlock(px,py,pz){
  const minX = Math.floor(px - PLAYER_W/2);
  const maxX = Math.floor(px + PLAYER_W/2);
  const minY = Math.floor(py);
  const maxY = Math.floor(py + PLAYER_H);
  const minZ = Math.floor(pz - PLAYER_D/2);
  const maxZ = Math.floor(pz + PLAYER_D/2);
  for(let y=minY; y<=maxY; y++){
    for(let z=minZ; z<=maxZ; z++){
      for(let x=minX; x<=maxX; x++){
        if (getBlock(x,y,z)!==BLOCK.AIR) return true;
      }
    }
  }
  return false;
}

function moveAndCollide(dx,dy,dz){
  const p = player.pos;
  // X
  p[0] += dx;
  if (aabbIntersectsBlock(p[0], p[1], p[2])){
    p[0] -= dx;
  }
  // Z
  p[2] += dz;
  if (aabbIntersectsBlock(p[0], p[1], p[2])){
    p[2] -= dz;
  }
  // Y
  p[1] += dy;
  if (aabbIntersectsBlock(p[0], p[1], p[2])){
    p[1] -= dy;
    if (dy < 0) player.onGround = true;
    player.vel[1] = 0;
  } else {
    if (dy < 0) player.onGround = false;
  }
}

// Now safe to load player (all physics/constants ready). If no save, respawn to safe center.
if (!loadPlayer()) respawn(); else ensurePlayerNotStuck();

// Matrices
function perspective(fovy, aspect, near, far){
  const f = 1 / Math.tan(fovy/2);
  const nf = 1/(near-far);
  return new Float32Array([
    f/aspect,0,0,0,
    0,f,0,0,
    0,0,(far+near)*nf,-1,
    0,0,(2*far*near)*nf,0
  ]);
}
function lookView(pos, yaw, pitch){
  const cy=Math.cos(yaw), sy=Math.sin(yaw);
  const cp=Math.cos(pitch), sp=Math.sin(pitch);
  // Forward vector (camera looks down -Z at yaw=0)
  const fx = -sy*cp; 
  const fy = sp;
  const fz = -cy*cp;
  // Orthonormal basis
  const rx = cy, ry = 0, rz = -sy; // right = normalize(cross([0,1,0], f))
  const ux = sy*sp, uy = cp, uz = cy*sp; // up = cross(f, right)
  // View matrix (column-major): [r u -f t]
  const x = -(rx*pos[0] + ry*pos[1] + rz*pos[2]);
  const y = -(ux*pos[0] + uy*pos[1] + uz*pos[2]);
  const z =  (fx*pos[0] + fy*pos[1] + fz*pos[2]); // note +dot(f,pos)
  return new Float32Array([
    rx, ux, -fx, 0,
    ry, uy, -fy, 0,
    rz, uz, -fz, 0,
    x,  y,   z,  1,
  ]);
}

// Game loop
let last = performance.now();
let worldTime = 0; // seconds
const DAY_LENGTH = 240; // seconds per full cycle (4 minutes)
const DAY_FRACTION = 0.7; // portion of cycle spent in daytime (night = 0.3)
// Rain scheduling
let rainActive = false;
let rainTimeLeft = 0;
let rainCheckTimer = 5; // seconds until next start check
function randNormal(mean, std){
  // Box-Muller
  let u = 0, v = 0;
  while (u===0) u = Math.random();
  while (v===0) v = Math.random();
  const z = Math.sqrt(-2.0*Math.log(u)) * Math.cos(2.0*Math.PI*v);
  return mean + std * z;
}
// FPS counter accumulators
let fpsAccumTime = 0;
let fpsAccumFrames = 0;
let fpsLast = 0;
let lastDayFactor = 1.0;
function frame(now){
  resizeCanvasToDisplaySize();
  const dt = Math.min(0.05, (now-last)/1000); // clamp
  last = now;
  // Initialize worldTime once from saved/default phase right before first tick
  if (worldTime === 0 && initialTimePhase != null) {
    worldTime = initialTimePhase * DAY_LENGTH;
  }
  worldTime += dt;
  // Rain timers
  if (rainActive){
    rainTimeLeft -= dt;
    if (rainTimeLeft <= 0){ rainActive = false; rainCheckTimer = 10 + Math.random()*10; stopRainSfx(); }
  } else {
    rainCheckTimer -= dt;
    if (rainCheckTimer <= 0){
      rainCheckTimer = 8 + Math.random()*12;
      if (Math.random() < 0.25){
        rainActive = true; startRainSfx();
        rainTimeLeft = Math.min(90, Math.max(8, randNormal(35, 12)));
      }
    }
  }
  // FPS accumulation and update label ~1/sec
  fpsAccumTime += dt;
  fpsAccumFrames += 1;
  if (fpsAccumTime >= 1.0){
    fpsLast = Math.round(fpsAccumFrames / fpsAccumTime);
    fpsAccumTime = 0;
    fpsAccumFrames = 0;
  }

  // Input -> desired velocity aligned to camera yaw
  const speed = (sprint? 7.0 : 4.0);
  let forward = 0, strafe = 0;
  if (keys.has('KeyW')) forward += 1;
  if (keys.has('KeyS')) forward -= 1;
  if (keys.has('KeyA')) strafe -= 1;
  if (keys.has('KeyD')) strafe += 1;
  if (forward || strafe){
    const len = Math.hypot(forward, strafe);
    forward/=len; strafe/=len;
  }
  const yaw = player.yaw;
  const fwdX = -Math.sin(yaw), fwdZ = -Math.cos(yaw);
  const rightX =  Math.cos(yaw), rightZ = -Math.sin(yaw);
  const vx = (forward*fwdX + strafe*rightX) * speed;
  const vz = (forward*fwdZ + strafe*rightZ) * speed;
  if (flyMode) {
    // Vertical: Space ascend, Ctrl descend
    const ascend = keys.has('Space') ? 1 : 0;
    const descend = (keys.has('ControlLeft') || keys.has('ControlRight')) ? 1 : 0;
    player.vel[1] = (ascend - descend) * speed;
  } else {
    // Jump
    if (keys.has('Space') && player.onGround){
      player.vel[1] = 6.5;
      player.onGround = false;
      sfxJump();
    }
    // Gravity
    player.vel[1] -= 20 * dt;
  }

  // Integrate with collisions (track horizontal delta for footsteps)
  const prevX = player.pos[0], prevZ = player.pos[2];
  moveAndCollide(vx*dt, player.vel[1]*dt, vz*dt);
  const dx = player.pos[0] - prevX;
  const dz = player.pos[2] - prevZ;
  const moveDist = Math.hypot(dx, dz);
  if (player.onGround && moveDist > 0.001){
    footstepAcc += moveDist;
    moveSaveAcc += moveDist;
    if (footstepAcc >= FOOTSTEP_SPACING){
      footstepAcc = footstepAcc - FOOTSTEP_SPACING;
      sfxStep();
    }
    // Autosave player position every ~2 meters moved
    if (moveSaveAcc >= 2.0){
      moveSaveAcc = 0;
      savePlayer();
    }
  }

  // Raycast and block actions (instant)
  const camPos = [player.pos[0], player.pos[1] + EYE_HEIGHT, player.pos[2]];
  const lookDir = [
    -Math.sin(yaw)*Math.cos(player.pitch),
    Math.sin(player.pitch),
    -Math.cos(yaw)*Math.cos(player.pitch)
  ];
  const hit = raycast(camPos, lookDir, 6.0);
  // Gather nearby lamp positions for emissive lighting
  const lampPos = [];
  const maxLamp = 32;
  const radLamp = 64; // activation radius for collecting lamps
  const cx = Math.floor(player.pos[0]);
  const cy = Math.floor(player.pos[1]);
  const cz = Math.floor(player.pos[2]);
  const y0 = Math.max(0, cy - radLamp), y1 = Math.min(WORLD_H-1, cy + radLamp);
  const z0 = Math.max(0, cz - radLamp), z1 = Math.min(WORLD_D-1, cz + radLamp);
  const x0 = Math.max(0, cx - radLamp), x1 = Math.min(WORLD_W-1, cx + radLamp);
  for (let yy=y0; yy<=y1 && lampPos.length<maxLamp; yy++){
    for (let zz=z0; zz<=z1 && lampPos.length<maxLamp; zz++){
      for (let xx=x0; xx<=x1 && lampPos.length<maxLamp; xx++){
        if (getBlock(xx,yy,zz) === BLOCK.LAMP){ lampPos.push([xx+0.5, yy+0.5, zz+0.5]); }
      }
    }
  }

  if (worldDirty) rebuildWorld();

  if (fxaaEnabled){
    // Ensure offscreen target matches canvas
    allocSceneTarget(gl.drawingBufferWidth, gl.drawingBufferHeight);
    // Render scene into offscreen FBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFBO);
  } else {
    // Render directly to default framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  gl.viewport(0,0,gl.drawingBufferWidth, gl.drawingBufferHeight);
  gl.depthMask(true);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // Draw sky background
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.depthMask(false);
  gl.useProgram(skyProg);
  gl.bindBuffer(gl.ARRAY_BUFFER, skyVBO);
  gl.enableVertexAttribArray(sky_a_pos);
  gl.vertexAttribPointer(sky_a_pos, 2, gl.FLOAT, false, 0, 0);
  gl.uniform1f(sky_u_time, now * 0.001);
  const aspect = gl.drawingBufferWidth / gl.drawingBufferHeight;
  const fov = Math.PI/3;
  gl.uniform1f(sky_u_yaw, player.yaw);
  gl.uniform1f(sky_u_pitch, player.pitch);
  gl.uniform1f(sky_u_fov, fov);
  gl.uniform1f(sky_u_aspect, aspect);
  gl.uniform1i(sky_u_cloudMode, cloudMode);
  // Compute sun direction and day factor
  const az = [0.6, 0.8];
  const azLen = Math.hypot(az[0], az[1]);
  const ax = az[0]/azLen, azz = az[1]/azLen;
  let sdx, sdy, sdz, day;
  if (timeMode === 0) {
    const phase = (worldTime % DAY_LENGTH) / DAY_LENGTH; // 0..1
    const rDay = Math.max(0.01, Math.min(0.99, DAY_FRACTION));
    const rNight = 1.0 - rDay;
    // Make day last rDay of the cycle (sun above horizon), night lasts rNight
    let ang;
    if (phase < rDay) {
      const p = phase / rDay;        // 0..1 over the day arc
      ang = p * Math.PI;             // 0..π (sunrise to sunset)
    } else {
      const p = (phase - rDay) / rNight; // 0..1 over the night arc
      ang = Math.PI + p * Math.PI;       // π..2π (sunset to sunrise)
    }
    const elev = Math.sin(ang);
    const horiz = Math.cos(ang);
    sdx = ax * horiz; sdy = elev; sdz = azz * horiz;
    day = Math.pow(Math.max(0, elev), 0.6);
  } else if (timeMode === 1) { // force day (midday)
    sdx = ax; sdy = 0.8; sdz = azz; day = 1.0;
  } else { // force night (midnight)
    sdx = ax; sdy = -0.8; sdz = azz; day = 0.0;
  }
  const sdLen = Math.hypot(sdx, Math.hypot(sdy, sdz)) || 1;
  sdx/=sdLen; sdy/=sdLen; sdz/=sdLen;
  gl.uniform3f(sky_u_sunDir, sdx, sdy, sdz);
  gl.uniform1f(sky_u_day, day);
  lastDayFactor = day;
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.depthMask(true);

  // Draw world
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.useProgram(prog);
  // Rebind world vertex arrays after sky pass (attribute 0 likely changed)
  gl.bindBuffer(gl.ARRAY_BUFFER, vbuf);
  gl.enableVertexAttribArray(a_pos);
  gl.vertexAttribPointer(a_pos, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, nbuf);
  gl.enableVertexAttribArray(a_norm);
  gl.vertexAttribPointer(a_norm, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, tbuf);
  gl.enableVertexAttribArray(a_uv);
  gl.vertexAttribPointer(a_uv, 2, gl.FLOAT, false, 0, 0);
  // Ensure texture bound
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(u_texLoc, 0);
  const proj = perspective(Math.PI/3, gl.drawingBufferWidth/gl.drawingBufferHeight, 0.1, 200.0);
  const view = lookView(camPos, player.yaw, player.pitch);
  gl.uniformMatrix4fv(u_proj, false, proj);
  gl.uniformMatrix4fv(u_view, false, view);
  // Dynamic lighting uniforms for world
  const ambient = 0.08 + 0.27*day; // 0.08..0.35
  const sunDiff = day;             // 0..1
  gl.uniform3f(u_sunDirLoc, sdx, sdy, sdz);
  gl.uniform1f(u_ambientLoc, ambient);
  gl.uniform1f(u_sunDiffuseLoc, sunDiff);
  // Torch uniforms (spotlight facing camera direction)
  gl.uniform3f(u_torchPosLoc, camPos[0], camPos[1], camPos[2]);
  gl.uniform1f(u_torchOnLoc, torchEnabled ? 1.0 : 0.0);
  gl.uniform1f(u_torchRadiusLoc, 12.0);
  gl.uniform1f(u_torchIntensityLoc, 2.0);
  gl.uniform3f(u_torchDirLoc, lookDir[0], lookDir[1], lookDir[2]);
  gl.uniform3f(u_torchColorLoc, 1.0, 0.78, 0.45);
  const inner = 18 * Math.PI/180, outer = 42 * Math.PI/180;
  gl.uniform1f(u_torchCosInnerLoc, Math.cos(inner));
  gl.uniform1f(u_torchCosOuterLoc, Math.cos(outer));
  gl.uniform1f(u_timeWorldLoc, now * 0.001);
  // Lamp uniforms
  gl.uniform1i(u_lampCountLoc, lampPos.length);
  for (let i=0;i<32;i++){
    const p = lampPos[i] || [0,0,0];
    gl.uniform3f(u_lampPosLoc[i], p[0], p[1], p[2]);
  }
  gl.uniform1f(u_lampRadiusLoc, 10.0);
  gl.uniform1f(u_lampIntensityLoc, 1.3);
  gl.uniform3f(u_lampColorLoc, 1.0, 0.9, 0.65);
  // Fog uniforms
  gl.uniform3f(u_camPosLoc, camPos[0], camPos[1], camPos[2]);
  // Match sky bottom color by day factor
  const nightBottom = [0.06, 0.08, 0.14];
  const dayBottom = [0.70, 0.88, 1.00];
  let fogR = nightBottom[0] * (1-day) + dayBottom[0] * day;
  let fogG = nightBottom[1] * (1-day) + dayBottom[1] * day;
  let fogB = nightBottom[2] * (1-day) + dayBottom[2] * day;
  // Keep fog close to sky color (minimal boost)
  const fogBoost = 0.06;
  fogR = fogR*(1-fogBoost) + 1.0*fogBoost;
  fogG = fogG*(1-fogBoost) + 1.0*fogBoost;
  fogB = fogB*(1-fogBoost) + 1.0*fogBoost;
  gl.uniform3f(u_fogColorLoc, fogR, fogG, fogB);
  gl.uniform1f(u_fogStartLoc, 40.0);
  gl.uniform1f(u_fogEndLoc, 140.0);

  gl.drawArrays(gl.TRIANGLES, 0, vCount);

  // Block targeting overlays (draw into scene before post-process)
  if (hit){
    gl.useProgram(overlayProg);
    gl.uniformMatrix4fv(ov_u_proj, false, proj);
    gl.uniformMatrix4fv(ov_u_view, false, view);
    // Outline
    gl.bindBuffer(gl.ARRAY_BUFFER, outlineVBO);
    gl.enableVertexAttribArray(ov_a_pos);
    gl.vertexAttribPointer(ov_a_pos, 3, gl.FLOAT, false, 0, 0);
    gl.disable(gl.CULL_FACE);
    gl.uniform3f(ov_u_offset, hit.x, hit.y, hit.z);
    gl.uniform1f(ov_u_expand, 0.02);
    gl.uniform4f(ov_u_color, 1.0, 1.0, 1.0, 0.85);
    gl.drawArrays(gl.LINES, 0, 24);
    // Placement ghost (if valid)
    const cand = canPlaceAtFromHit(hit);
    if (cand){
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindBuffer(gl.ARRAY_BUFFER, ghostVBO);
      gl.enableVertexAttribArray(ov_a_pos);
      gl.vertexAttribPointer(ov_a_pos, 3, gl.FLOAT, false, 0, 0);
      gl.disable(gl.CULL_FACE);
      gl.uniform3f(ov_u_offset, cand.x, cand.y, cand.z);
      gl.uniform1f(ov_u_expand, 0.0);
      gl.uniform4f(ov_u_color, 1.0, 1.0, 1.0, 0.25);
      gl.drawArrays(gl.TRIANGLES, 0, 36);
      gl.disable(gl.BLEND);
    }
  }

  if (fxaaEnabled){
    // Post-process: FXAA on default framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.useProgram(postProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, skyVBO);
    gl.enableVertexAttribArray(post_a_pos);
    gl.vertexAttribPointer(post_a_pos, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.uniform1i(post_u_scene, 0);
    gl.uniform2f(post_u_invRes, 1.0/gl.drawingBufferWidth, 1.0/gl.drawingBufferHeight);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  // Rain overlay on default framebuffer (after post-process if any)
  if (rainActive){
    // Ensure audio rain starts once audio is available
    if (audioCtx && !rainSrc) startRainSfx();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(rainProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, skyVBO);
    gl.enableVertexAttribArray(rain_a_pos);
    gl.vertexAttribPointer(rain_a_pos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1f(rain_u_time, now * 0.001);
    gl.uniform1f(rain_u_aspect, gl.drawingBufferWidth / gl.drawingBufferHeight);
    gl.uniform1f(rain_u_alpha, 0.25);
    gl.uniform1f(rain_u_day, day);
    gl.uniform1f(rain_u_yaw, player.yaw);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
  }

  // Debug overlay update (F3)
  if (debugVisible && debugEl){
    const toFixed = (v)=> (Math.round(v*100)/100).toFixed(2);
    const rad2deg = (r)=> (r*180/Math.PI);
    const yawDeg = ((rad2deg(player.yaw)%360)+360)%360;
    const pitchDeg = rad2deg(player.pitch);
    const phase = (worldTime % DAY_LENGTH) / DAY_LENGTH;
    const minutes = Math.floor(phase * 24 * 60);
    const hh = String(Math.floor(minutes/60)).padStart(2,'0');
    const mm = String(minutes%60).padStart(2,'0');
    const tNames = ['Auto','Day','Night'];
    const lines = [
      `FPS: ${fpsLast}`,
      `Pos: ${toFixed(player.pos[0])}, ${toFixed(player.pos[1])}, ${toFixed(player.pos[2])}`,
      `Yaw/Pitch: ${toFixed(yawDeg)}°, ${toFixed(pitchDeg)}°`,
      `Ground: ${player.onGround ? 'Yes' : 'No'}  Fly: ${flyMode ? 'Yes' : 'No'}`,
      `Weather: ${rainActive ? `Rain (${Math.max(0, rainTimeLeft).toFixed(1)}s)` : 'Clear'}`,
      `Time: ${hh}:${mm}  Mode: ${tNames[timeMode]}  DayFactor: ${toFixed(lastDayFactor)}`,
    ];
    debugEl.textContent = lines.join('\n');
  }

  requestAnimationFrame(frame);
}

rebuildWorld();
requestAnimationFrame(frame);
updateMusicLabel();

// ==== Music Lab (simple 8-bit generator) ====
const BANK_KEY = 'voxel_music_bank_v1';
let labState = null;
let labPreviewTimer = null;
let labNextTime = 0;
let labStep = 0;
let labStatusTimer = null;

function defaultLabState(){
  return {
    name: 'New Track',
    bpm: 128,
    leadWave: 'square',
    bassWave: 'triangle',
    lead64: Array(64).fill('.'),
    bass64: Array(64).fill('.'),
    hat64:  Array(64).fill(0).map((_,i)=> (i%2===1?1:0)),
    kick64: Array(64).fill(0).map((_,i)=> (i%4===0?1:0)),
  };
}

function ensureLab64(st){
  const out = Object.assign({}, st);
  const rep = (arr16, fillVal)=> repeat16to64(Array.isArray(arr16)?arr16:[], v=> v==null?fillVal:v);
  if (!Array.isArray(out.lead64) || out.lead64.length!==64){
    out.lead64 = rep(out.lead16, '.');
  }
  if (!Array.isArray(out.bass64) || out.bass64.length!==64){
    out.bass64 = rep(out.bass16, '.');
  }
  if (!Array.isArray(out.hat64) || out.hat64.length!==64){
    out.hat64 = rep(out.hat16, 0);
  }
  if (!Array.isArray(out.kick64) || out.kick64.length!==64){
    out.kick64 = rep(out.kick16, 0);
  }
  return out;
}

function setLabStatus(msg){
  const el = document.getElementById('labStatus');
  if (!el) return;
  if (labStatusTimer) { clearTimeout(labStatusTimer); labStatusTimer = null; }
  el.textContent = msg || '';
  if (msg){
    labStatusTimer = setTimeout(()=>{ el.textContent=''; labStatusTimer=null; }, 2000);
  }
}

function encodeLabToCode(st){
  const s = ensureLab64(st || labState || defaultLabState());
  const payload = {
    v: 1,
    name: s.name,
    bpm: s.bpm,
    leadWave: s.leadWave,
    bassWave: s.bassWave,
    lead: s.lead64,
    bass: s.bass64,
    hat: s.hat64,
    kick: s.kick64,
  };
  return JSON.stringify(payload);
}

function decodeLabFromCode(code){
  const data = JSON.parse(String(code||'').trim());
  if (!data || typeof data !== 'object') throw new Error('Invalid data');
  const st = defaultLabState();
  st.name = data.name || st.name;
  st.bpm = Math.max(60, Math.min(200, parseInt(data.bpm||st.bpm,10)));
  st.leadWave = data.leadWave || st.leadWave;
  st.bassWave = data.bassWave || st.bassWave;
  st.lead64 = Array.isArray(data.lead) ? data.lead.slice(0,64).concat(Array(64).fill('.')).slice(0,64) : st.lead64;
  st.bass64 = Array.isArray(data.bass) ? data.bass.slice(0,64).concat(Array(64).fill('.')).slice(0,64) : st.bass64;
  st.hat64  = Array.isArray(data.hat)  ? data.hat.slice(0,64).concat(Array(64).fill(0)).slice(0,64) : st.hat64;
  st.kick64 = Array.isArray(data.kick) ? data.kick.slice(0,64).concat(Array(64).fill(0)).slice(0,64) : st.kick64;
  return st;
}

// Full bank (all slots) export/import
function normalizeSlot(st){
  if (!st) return null;
  const s = ensureLab64(st);
  return {
    name: s.name,
    bpm: Math.max(60, Math.min(200, s.bpm||128)),
    leadWave: s.leadWave || 'square',
    bassWave: s.bassWave || 'triangle',
    lead64: s.lead64.slice(0,64),
    bass64: s.bass64.slice(0,64),
    hat64: s.hat64.slice(0,64),
    kick64: s.kick64.slice(0,64),
  };
}

function encodeAllLabToCode(){
  const bank = loadBank();
  const slotSel = document.getElementById('labSlot');
  const selected = slotSel ? (parseInt(slotSel.value,10)||0) : 0;
  const payload = {
    v: 2,
    selected,
    slots: new Array(16).fill(null).map((_,i)=> normalizeSlot(bank[i]))
  };
  return JSON.stringify(payload);
}

function decodeAllLabFromCode(code){
  const data = JSON.parse(String(code||'').trim());
  if (!data || typeof data !== 'object') throw new Error('Invalid data');
  if (Array.isArray(data.slots)){
    const incoming = data.slots;
    const bank = new Array(16).fill(null);
    for (let i=0;i<16;i++){
      const s = incoming[i];
      if (s && typeof s==='object'){
        const st = defaultLabState();
        st.name = s.name || st.name;
        st.bpm = Math.max(60, Math.min(200, parseInt(s.bpm||st.bpm,10)));
        st.leadWave = s.leadWave || st.leadWave;
        st.bassWave = s.bassWave || st.bassWave;
        const leadArr = s.lead64 || s.lead || [];
        const bassArr = s.bass64 || s.bass || [];
        const hatArr  = s.hat64  || s.hat  || [];
        const kickArr = s.kick64 || s.kick || [];
        st.lead64 = Array.isArray(leadArr) ? leadArr.slice(0,64).concat(Array(64).fill('.')).slice(0,64) : st.lead64;
        st.bass64 = Array.isArray(bassArr) ? bassArr.slice(0,64).concat(Array(64).fill('.')).slice(0,64) : st.bass64;
        st.hat64  = Array.isArray(hatArr)  ? hatArr.slice(0,64).concat(Array(64).fill(0)).slice(0,64) : st.hat64;
        st.kick64 = Array.isArray(kickArr) ? kickArr.slice(0,64).concat(Array(64).fill(0)).slice(0,64) : st.kick64;
        bank[i] = st;
      } else {
        bank[i] = null;
      }
    }
    saveBank(bank);
    rebuildTracksFromBank();
    const slotSel = document.getElementById('labSlot');
    const sel = Math.max(0, Math.min(15, parseInt(data.selected||0,10)||0));
    if (slotSel){ slotSel.value = String(sel); }
    // choose state to show
    let st = bank[sel];
    if (!st){
      for (let i=0;i<16;i++){ if (bank[i]) { st = bank[i]; if (slotSel) slotSel.value=String(i); break; } }
    }
    st = ensureLab64(st || defaultLabState());
    try { labState = JSON.parse(JSON.stringify(st)); } catch { labState = st; }
    setLabUI(labState);
    refreshLabSlotNames();
    updateMusicLabel();
    return 'bank';
  } else {
    // Fallback: single-track JSON
    const st = decodeLabFromCode(data);
    try { labState = JSON.parse(JSON.stringify(st)); } catch { labState = st; }
    setLabUI(labState);
    saveCurrentLabToSelectedSlot();
    return 'single';
  }
}

async function copyLabCode(){
  const code = encodeAllLabToCode();
  try{
    if (navigator.clipboard && navigator.clipboard.writeText){
      await navigator.clipboard.writeText(code);
    } else {
      const ta = document.createElement('textarea');
      ta.value = code; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    }
    setLabStatus('Copied to clipboard');
  }catch(e){
    console.warn('Copy failed:', e);
    setLabStatus('Copy failed (see console)');
    console.log(code);
  }
  // Ensure preview continues
  startLabPreview();
}

function promptLoadLabCode(){
  const str = prompt('Paste music JSON:');
  if (!str){ setLabStatus('Import cancelled'); startLabPreview(); return; }
  try{
    const kind = decodeAllLabFromCode(str);
    setLabStatus(kind==='bank' ? 'All slots loaded' : 'Music loaded');
  }catch(e){
    console.warn(e);
    setLabStatus('Failed to load music');
  }
  // Resume preview after prompt
  startLabPreview();
}

function mtofName(n){
  // Accept note names like C4, D#4, Bb3 etc.; fallback numeric
  if (typeof n === 'number') return n;
  if (!n || n==='.') return null;
  const s = String(n).trim();
  if (/^\d+$/.test(s)) return parseInt(s,10);
  const m = s.match(/^([A-Ga-g])([#b]?)(-?\d)$/);
  if (!m) return null;
  const base = {C:0,D:2,E:4,F:5,G:7,A:9,B:11}[m[1].toUpperCase()];
  let semi = base + (m[2]==='#'?1:(m[2]==='b'?-1:0));
  const oct = parseInt(m[3],10);
  return 12*(oct+1)+semi; // MIDI: C4=60
}

function midiToName(m){
  if (m==null || !isFinite(m)) return '.';
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const semi = ((m % 12) + 12) % 12;
  const oct = Math.floor(m/12) - 1;
  return names[semi] + String(oct);
}

function buildGrid(selectContainer, initial){
  // legacy select-based grid (unused after roll migration)
  selectContainer.textContent='';
  const notes = ['.', 'C3','D3','E3','F3','G3','A3','B3','C4','D4','E4','F4','G4','A4','B4','C5','D5','E5'];
  for (let i=0;i<16;i++){
    const sel = document.createElement('select'); sel.dataset.idx=i;
    for (const n of notes){
      const opt = document.createElement('option'); opt.value=n; opt.textContent=n; sel.appendChild(opt);
    }
    sel.value = initial[i] || '.';
    selectContainer.appendChild(sel);
  }
}

function chromaticRange(fromName, toName){
  const from = mtofName(fromName);
  const to = mtofName(toName);
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const out = [];
  for (let m = end; m >= start; m--){ // descending so higher pitches at top
    out.push(midiToName(m));
  }
  return out;
}

function buildRoll(container, initial, trackKey){
  // initial: 16-length array of note names or '.'
  container.textContent = '';
  container.dataset.track = trackKey;
  const blackSet = new Set([1,3,6,8,10]); // semitone indices for black keys
  // Determine dynamic range based on used notes in this 16-step slice
  const used = [];
  for (let i=0;i<16;i++){
    const n = initial[i];
    const m = mtofName(n);
    if (typeof m === 'number' && isFinite(m)) used.push(m);
  }
  let start, end;
  if (used.length){
    let min = Math.min(...used), max = Math.max(...used);
    // add small padding
    min -= 2; max += 2;
    // ensure at least ~2 octaves for context
    if ((max - min) < 24){
      const center = Math.round((min + max)/2);
      min = center - 12; max = center + 12;
    }
    start = min; end = max;
  } else {
    start = mtofName('C3'); end = mtofName('E5');
  }
  const notes = [];
  for (let m = Math.round(end); m >= Math.round(start); m--) notes.push(midiToName(m));
  // Precompute which columns are active per note
  const activeByCol = new Array(16).fill('.');
  for (let i=0;i<16;i++) activeByCol[i] = initial[i] || '.';
  // Create rows (notes) x columns (steps)
  for (let r=0; r<notes.length; r++){
    const noteName = notes[r];
    const midi = mtofName(noteName) || 0;
    const semi = ((midi % 12) + 12) % 12;
    // left keyboard key/label
    const key = document.createElement('div');
    key.className = 'key' + (blackSet.has(semi) ? ' black' : '');
    key.textContent = noteName;
    container.appendChild(key);
    for (let c=0; c<16; c++){
      const cell = document.createElement('div');
      cell.className = 'cell' + (blackSet.has(semi) ? ' black' : '');
      cell.dataset.idx = String(c);
      cell.dataset.note = noteName;
      if (activeByCol[c] === noteName) cell.classList.add('active');
      container.appendChild(cell);
    }
  }
}
function buildBoolGrid(container, initial){
  container.textContent='';
  for(let i=0;i<16;i++){
    const cb = document.createElement('input'); cb.type='checkbox'; cb.dataset.idx=i; cb.checked = !!initial[i];
    container.appendChild(cb);
  }
}

function getLabUI(){
  // labState is the source of truth across 64 steps; sync meta
  labState.name = document.getElementById('labName').value || labState.name || 'Untitled';
  labState.bpm = Math.max(60, Math.min(200, parseInt(document.getElementById('labBpm').value,10)||labState.bpm||128));
  labState.leadWave = document.getElementById('labLeadWave').value || labState.leadWave || 'square';
  labState.bassWave = document.getElementById('labBassWave').value || labState.bassWave || 'triangle';
  return labState;
}
function setLabUI(st){
  document.getElementById('labName').value = st.name;
  document.getElementById('labBpm').value = st.bpm;
  document.getElementById('labLeadWave').value = st.leadWave;
  document.getElementById('labBassWave').value = st.bassWave;
  renderLabPage();
}

let labPage = 0; // 0..3
function renderLabPage(){
  const pageOff = labPage*16;
  const title = document.getElementById('labPageLabel');
  if (title) title.textContent = `Bar ${labPage+1} / 4`;
  const leadSlice = labState.lead64.slice(pageOff, pageOff+16);
  const bassSlice = labState.bass64.slice(pageOff, pageOff+16);
  const hatSlice  = labState.hat64.slice(pageOff, pageOff+16);
  const kickSlice = labState.kick64.slice(pageOff, pageOff+16);
  buildRoll(document.getElementById('leadGrid'), leadSlice, 'lead64');
  buildRoll(document.getElementById('bassGrid'), bassSlice, 'bass64');
  buildBoolGrid(document.getElementById('hatGrid'), hatSlice);
  buildBoolGrid(document.getElementById('kickGrid'), kickSlice);
  // reattach live handlers for the new elements
  attachLabLiveHandlers();
}

function loadBank(){
  try{
    const s = localStorage.getItem(BANK_KEY);
    if (!s) return new Array(16).fill(null);
    const arr = JSON.parse(s);
    return Array.isArray(arr)?arr:new Array(16).fill(null);
  }catch(e){ return new Array(16).fill(null); }
}
function saveBank(bank){
  try{ localStorage.setItem(BANK_KEY, JSON.stringify(bank)); }catch(e){}
}

function saveCurrentLabToSelectedSlot(){
  const slotSel = document.getElementById('labSlot');
  if (!slotSel) return;
  const bank = loadBank();
  const i = parseInt(slotSel.value,10)||0;
  bank[i] = ensureLab64(getLabUI());
  saveBank(bank);
  rebuildTracksFromBank();
  refreshLabSlotNames();
  updateMusicLabel();
  setLabStatus(`Saved to Slot ${i+1}`);
}

function toggleMusicLab(){
  const hidden = labEl.classList.toggle('hidden');
  if (!hidden){
    // open
    if (!labState) labState = defaultLabState();
    // stop game music and start live preview
    stopMusic();
    // clear movement and exit pointer lock
    keys.clear(); sprint = false;
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch {}
    // build selects once
    const slotSel = document.getElementById('labSlot');
    if (!slotSel.dataset.ready){
      for(let i=0;i<16;i++){ const opt=document.createElement('option'); opt.value=String(i); opt.textContent=`Slot ${i+1}`; slotSel.appendChild(opt); }
      slotSel.dataset.ready = '1';
      document.getElementById('labSave').onclick = ()=>{
        const bank = loadBank();
        const i = parseInt(slotSel.value,10)||0;
        bank[i] = getLabUI();
        saveBank(bank);
        rebuildTracksFromBank();
        updateMusicLabel();
        refreshLabSlotNames();
      };
      document.getElementById('labLoad').onclick = ()=>{
        const bank = loadBank();
        const i = parseInt(slotSel.value,10)||0;
        const st = ensureLab64(bank[i] || defaultLabState());
        try { labState = JSON.parse(JSON.stringify(st)); } catch { labState = st; }
        setLabUI(labState);
        refreshLabSlotNames();
      };
      document.getElementById('labStopPreview').onclick = ()=> toggleLabPreviewButton();
      document.getElementById('labClose').onclick = ()=> toggleMusicLab();
      // Built-in select
      const builtinSel = document.getElementById('labBuiltin');
      const btnBuiltin = document.getElementById('labBuiltinLoad');
      const btnExport = document.getElementById('labExport');
      const btnImport = document.getElementById('labImport');
      const modal = document.getElementById('labModal');
      const modalText = document.getElementById('labModalText');
      const modalCancel = document.getElementById('labModalCancel');
      const modalLoad = document.getElementById('labModalLoad');
      if (builtinSel){
        builtinSel.innerHTML = '';
        for (let i=0;i<baseTracks.length;i++){
          const opt = document.createElement('option');
          opt.value = String(i);
          opt.textContent = `Track ${i+1}: ${baseTracks[i].name}`;
          builtinSel.appendChild(opt);
        }
        btnBuiltin.onclick = ()=>{
          const idx = parseInt(builtinSel.value,10)||0;
          loadBuiltinToLab(idx);
        };
        if (btnExport) btnExport.onclick = ()=> { copyLabCode(); };
        if (btnImport) btnImport.onclick = ()=> {
          if (!modal) return;
          modal.classList.remove('hidden');
          modalText.value = '';
          setLabStatus('');
          // Keep preview running
          startLabPreview();
        };
        if (modalCancel) modalCancel.onclick = ()=>{ if (modal) modal.classList.add('hidden'); startLabPreview(); };
        if (modalLoad) modalLoad.onclick = ()=>{
          try{
            const kind = decodeAllLabFromCode(modalText.value||'');
            setLabStatus(kind==='bank' ? 'All slots loaded' : 'Music loaded');
          }catch(e){ console.warn(e); setLabStatus('Failed to load music'); }
          if (modal) modal.classList.add('hidden');
          stopLabPreview();
          startLabPreview();
        };
      }
    }
    labState = ensureLab64(labState);
    setLabUI(labState);
    // attach live update handlers
    attachLabLiveHandlers();
    refreshLabSlotNames();
    startLabPreview();
  } else {
    // close
    labState = getLabUI();
    stopLabPreview();
    if (musicEnabled) startMusic();
  }
}

function attachLabLiveHandlers(){
  const nameEl = document.getElementById('labName');
  const bpmEl = document.getElementById('labBpm');
  const leadWaveEl = document.getElementById('labLeadWave');
  const bassWaveEl = document.getElementById('labBassWave');
  const leadGrid = document.getElementById('leadGrid');
  const bassGrid = document.getElementById('bassGrid');
  const hatGrid = document.getElementById('hatGrid');
  const kickGrid = document.getElementById('kickGrid');

  nameEl.oninput = ()=>{ labState.name = nameEl.value; };
  bpmEl.oninput = ()=>{ labState.bpm = Math.max(60, Math.min(200, parseInt(bpmEl.value,10)||128)); };
  leadWaveEl.onchange = ()=>{ labState.leadWave = leadWaveEl.value; };
  bassWaveEl.onchange = ()=>{ labState.bassWave = bassWaveEl.value; };
  const handleRollClick = (container)=> (e)=>{
    const cell = e.target.closest('.cell');
    if (!cell || !container.contains(cell)) return;
    const idx = parseInt(cell.dataset.idx, 10);
    const note = cell.dataset.note;
    const track = container.dataset.track;
    const off = labPage*16 + idx;
    const cur = (labState[track] && labState[track][off]) || '.';
    const next = (cur === note) ? '.' : note;
    // Update state
    if (Array.isArray(labState[track])) labState[track][off] = next;
    // Update UI: clear active in the column, then set if needed
    const cells = container.querySelectorAll(`.cell[data-idx="${idx}"]`);
    cells.forEach(n => n.classList.remove('active'));
    if (next !== '.') cell.classList.add('active');
  };
  leadGrid.onclick = handleRollClick(leadGrid);
  bassGrid.onclick = handleRollClick(bassGrid);
  hatGrid.onchange = (e)=>{ if (e.target.type==='checkbox'){ const i=+e.target.dataset.idx; labState.hat64[labPage*16+i]=e.target.checked?1:0; } };
  kickGrid.onchange = (e)=>{ if (e.target.type==='checkbox'){ const i=+e.target.dataset.idx; labState.kick64[labPage*16+i]=e.target.checked?1:0; } };
}

function refreshLabSlotNames(){
  const slotSel = document.getElementById('labSlot');
  if (!slotSel) return;
  const bank = loadBank();
  const maxLen = 18;
  for (let i=0;i<16;i++){
    const name = (bank[i] && bank[i].name) ? String(bank[i].name) : 'Empty';
    const txt = `${i+1}: ${name.length>maxLen ? name.slice(0,maxLen-1)+'…' : name}`;
    if (slotSel.options[i]){
      // Update displayed label robustly across browsers
      slotSel.options[i].text = txt;
      slotSel.options[i].label = txt;
      slotSel.options[i].textContent = txt;
    }
    else {
      const opt = document.createElement('option');
      opt.value = String(i); opt.textContent = txt; slotSel.appendChild(opt);
    }
  }
  // Nudge select to ensure the UI reflects any text updates for the selected option
  slotSel.selectedIndex = slotSel.selectedIndex;
}

// Hook up bar nav buttons
const _prevBtn = document.getElementById('labPrevPage');
const _nextBtn = document.getElementById('labNextPage');
if (_prevBtn) _prevBtn.onclick = ()=>{ labPage = (labPage+3)%4; renderLabPage(); };
if (_nextBtn) _nextBtn.onclick = ()=>{ labPage = (labPage+1)%4; renderLabPage(); };

function loadBuiltinToLab(idx){
  const tr = baseTracks[idx];
  if (!tr) return;
  const st = defaultLabState();
  st.name = `${tr.name} (edit)`;
  st.bpm = tr.bpm || DEFAULT_BPM;
  st.leadWave = tr.leadWave || 'square';
  st.bassWave = tr.bassWave || 'triangle';
  st.lead64 = new Array(64);
  st.bass64 = new Array(64);
  for (let i=0;i<64;i++){
    const lm = tr.lead && tr.lead[i];
    const bm = tr.bass && tr.bass[i];
    // Treat 0 or falsy as rest; some built-ins use 0 for rests
    st.lead64[i] = (typeof lm === 'number' ? (lm>0? midiToName(lm) : '.') : (lm!=null? midiToName(lm) : '.'));
    st.bass64[i] = (typeof bm === 'number' ? (bm>0? midiToName(bm) : '.') : (bm!=null? midiToName(bm) : '.'));
  }
  st.hat64 = tr.hat16 ? repeat16to64(tr.hat16) : defaultLabState().hat64;
  st.kick64 = tr.kick16 ? repeat16to64(tr.kick16) : defaultLabState().kick64;
  // Apply to state then UI (UI reads from labState)
  try { labState = JSON.parse(JSON.stringify(st)); } catch { labState = st; }
  setLabUI(labState);
}

function repeat16to64(arr16, mapFn){
  const out = new Array(64);
  for(let i=0;i<64;i++){
    const v = arr16[i%16];
    out[i] = mapFn?mapFn(v,i):v;
  }
  return out;
}

// Build tracks array from base + saved slots
function rebuildTracksFromBank(){
  const bank = loadBank();
  const user = [];
  for (let i=0;i<bank.length;i++){
    const st = bank[i];
    if (!st) continue;
    const lead64 = (st.lead64 && st.lead64.length===64) ? st.lead64.map(v=>{ const m=mtofName(v); return m||null; }) : repeat16to64(st.lead16||[], (v)=>{ const m=mtofName(v); return m||null; });
    const bass64 = (st.bass64 && st.bass64.length===64) ? st.bass64.map(v=>{ const m=mtofName(v); return m||null; }) : repeat16to64(st.bass16||[], (v)=>{ const m=mtofName(v); return m||null; });
    user.push({
      name: st.name || `Slot ${i+1}`,
      bpm: Math.max(60, Math.min(200, st.bpm||128)),
      lead: lead64,
      bass: bass64,
      leadWave: st.leadWave || 'square',
      bassWave: st.bassWave || 'triangle',
      hat16: (st.hat64 ? st.hat64.slice(0,16) : (st.hat16||Array(16).fill(0))),
      kick16: (st.kick64 ? st.kick64.slice(0,16) : (st.kick16||Array(16).fill(0))),
    });
  }
  tracks = baseTracks.concat(user);
  if (currentTrackIndex >= tracks.length) currentTrackIndex = 0;
}

function startLabPreview(){
  // Ensure audio context is alive and resumed (alerts/prompts can suspend it)
  initAudio();
  resumeAudio();
  if (labPreviewTimer) return; // already running
  labNextTime = audioCtx.currentTime + 0.05;
  // do not reset labStep to preserve groove while editing
  labPreviewTimer = setInterval(()=>{
    const lookAhead = 0.2;
    while (labNextTime < audioCtx.currentTime + lookAhead){
      const cur = labState || defaultLabState();
      const stepLen = (60 / (Math.max(60, Math.min(200, cur.bpm||128))))/4;
      scheduleLabStep(labNextTime, labStep);
      labNextTime += stepLen;
      labStep = (labStep+1)%64;
    }
  }, 25);
  updateLabPreviewButton(true);
}
function stopLabPreview(){ if (labPreviewTimer){ clearInterval(labPreviewTimer); labPreviewTimer=null; } }

function scheduleLabStep(time, step){
  const st = labState || defaultLabState();
  const s16 = step%16;
  // lead
  const l = (st.lead64 && st.lead64[step]) || '.';
  const lm = mtofName(l);
  if (lm){
    const o = audioCtx.createOscillator(); o.type = st.leadWave||'square'; o.frequency.value = mtof(lm);
    const g = audioCtx.createGain(); g.gain.value=0.0001; envGain(g, time, 0.002, 0.06, 0.25, 0.05, (60/(st.bpm||128))/4*0.9);
    o.connect(g).connect(mixMusic()); o.start(time); o.stop(time + (60/(st.bpm||128))/4*0.95);
  }
  // bass
  const b = (st.bass64 && st.bass64[step]) || '.';
  const bm = mtofName(b);
  if (bm){
    const o = audioCtx.createOscillator(); o.type = st.bassWave||'triangle'; o.frequency.value = mtof(bm);
    const g = audioCtx.createGain(); g.gain.value=0.0001; envGain(g, time, 0.002, 0.05, 0.2, 0.08, (60/(st.bpm||128))/4);
    o.connect(g).connect(mixMusic()); o.start(time); o.stop(time + (60/(st.bpm||128))/4);
  }
  // drums
  if ((st.hat64 && st.hat64[step]) || st.hat16 && st.hat16[s16]){
    const t = time;
    const bufferSize = Math.max(1, Math.floor(audioCtx.sampleRate * 0.02));
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i=0;i<bufferSize;i++) data[i] = Math.random()*2-1;
    const src = audioCtx.createBufferSource(); src.buffer = buffer;
    const hp = audioCtx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=3000;
    const g = audioCtx.createGain(); g.gain.value=0.0001; envGain(g, t, 0.001, 0.01, 0.12, 0.03, 0.02);
    src.connect(hp).connect(g).connect(mixMusic()); src.start(t);
  }
  if ((st.kick64 && st.kick64[step]) || st.kick16 && st.kick16[s16]){
    const o = audioCtx.createOscillator(); o.type='sine'; const g=audioCtx.createGain(); g.gain.value=0.0001;
    o.frequency.setValueAtTime(110, time); o.frequency.exponentialRampToValueAtTime(48, time+0.12);
    envGain(g, time, 0.001, 0.05, 0.3, 0.06, 0.15); o.connect(g).connect(mixMusic()); o.start(time); o.stop(time+0.18);
  }
}

function updateLabPreviewButton(running){
  const btn = document.getElementById('labStopPreview');
  if (!btn) return;
  btn.textContent = running ? 'Stop Preview' : 'Preview';
}
function toggleLabPreviewButton(){
  if (labPreviewTimer){
    stopLabPreview();
    updateLabPreviewButton(false);
  } else {
    startLabPreview();
    updateLabPreviewButton(true);
  }
}

// Build tracks from bank on startup so slot tracks are available
rebuildTracksFromBank();
updateMusicLabel();

// Allow context menu inside Music Lab (for paste), block elsewhere
window.addEventListener('contextmenu', (e)=>{
  if (labEl && labEl.contains(e.target)) return; // allow in lab UI
  e.preventDefault();
});
