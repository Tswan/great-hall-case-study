// Great Hall: scroll-driven case study
// Three.js scene: baked Great Hall (night.glb / day.glb composed from the RCP project),
// procedural Enchanted Ceiling, flipbook fire, floating candles, height-faded rafters.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import outlinerNames from '../assets/outliner.json';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
const BUILD = '202610121200'; // bump on every rebuild so browsers never show a stale model
const asset = (p) => (window.__ASSETS && window.__ASSETS[p]) || `${p}?v=${BUILD}`; // lets a single-file preview inline its assets
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
// Phones/tablets: iOS Safari kills the tab at ~1–2 GB, so they get half-res textures and only one lighting scene in memory at a time.
const lowMemory = matchMedia('(pointer: coarse)').matches;

// ---------------------------------------------------------------- renderer
const canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, lowMemory ? 1.5 : 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping; // lighting is baked into the textures
// On iOS the usual sign of running out of memory is a lost context (or the whole tab reloading), so make it visible in Web Inspector.
canvas.addEventListener('webglcontextlost', (e) => console.error('WebGL context lost', e));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020306);
scene.fog = new THREE.FogExp2(0x05060c, 0.012);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 400);
camera.position.set(0, 1.9, 4.6);

// ---------------------------------------------------------------- shared uniforms
const U = {
  uTime: { value: 0 },
  uExposure: { value: 1.35 },
  uRevealCenter: { value: new THREE.Vector3(0, 1.5, 4.5) },
  uRevealR: { value: 6 },
  uRim: { value: new THREE.Color(0xffc979) },
  uUVMix: { value: 0 },
  uDim: { value: 0 },
  uFadeLow: { value: 15 },
  uFadeHigh: { value: 30 },
  uRafterGlow: { value: 0 },
  uDay: { value: 0 },
};

// Patch every baked (unlit) material: exposure, scroll reveal, UV checker, rafter fade.
function patchMaterial(mat, opts = {}) {
  if (mat.userData.__patched) return mat;
  mat.userData.__patched = true;
  mat.userData.uFocus = { value: opts.focus ? 1 : 0 };
  mat.userData.uRafter = { value: opts.rafter ? 1 : 0 };
  mat.userData.uColorScale = { value: opts.colorScale ?? 1 };
  if (opts.rafter) {
    mat.transparent = true;
    mat.depthWrite = false;
    mat.side = THREE.DoubleSide;
  }
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U, { uFocus: mat.userData.uFocus, uRafter: mat.userData.uRafter, uColorScale: mat.userData.uColorScale });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec2 vUV0;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvec4 _wp = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\n_wp = instanceMatrix * _wp;\n#endif\nvWPos = (modelMatrix * _wp).xyz;\nvUV0 = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec2 vUV0;
        uniform float uExposure, uRevealR, uUVMix, uDim, uFadeLow, uFadeHigh, uRafterGlow, uFocus, uRafter, uTime, uColorScale;
        uniform vec3 uRevealCenter, uRim;`)
      .replace('#include <opaque_fragment>', `
        outgoingLight *= uExposure;
        if (uFocus > 0.5) {
          vec2 g = vUV0 * 40.0;
          vec2 w = fwidth(g);
          float aa = clamp(max(w.x, w.y) * 1.2, 0.0, 1.0);
          float c = mod(floor(g.x) + floor(g.y), 2.0);
          vec3 chk = mix(vec3(0.16, 0.12, 0.30), vec3(0.95, 0.76, 0.38), mix(c, 0.5, aa));
          vec2 f = abs(fract(g) - 0.5);
          chk = mix(chk, vec3(1.0), smoothstep(0.44, 0.5, max(f.x, f.y)) * 0.35 * (1.0 - aa));
          chk *= 0.55 + 0.45 * clamp(dot(normalize(cross(dFdx(vWPos), dFdy(vWPos))), normalize(vec3(0.3, 1.0, 0.5))) * 0.5 + 0.5, 0.0, 1.0);
          outgoingLight = mix(outgoingLight, chk, uUVMix);
        } else {
          outgoingLight *= mix(1.0, 0.28, uDim);
        }
        if (uRafter > 0.5) {
          float a = 1.0 - smoothstep(uFadeLow, uFadeHigh, vWPos.y);
          // Like the RCP graph: opacity comes only from the height remap. The texture's own alpha is ignored
          // (the day bake for VFX_SM_GH_Rafters_B_Lite is a PNG whose alpha is mostly near zero).
          diffuseColor.a = a;
          outgoingLight *= uColorScale; // RCP day graph: Mix(bg = black, fg = texture, mix = 0.3–0.4)
          if (diffuseColor.a < 0.004) discard; // fully faded: write nothing (keeps the depth pre-pass from blocking the sky)
          outgoingLight = mix(outgoingLight, vec3(0.45, 0.75, 1.0) * (0.6 + 0.4 * a), uRafterGlow * 0.55);
        }
        float d = distance(vWPos, uRevealCenter);
        float vis = 1.0 - smoothstep(uRevealR - 5.0, uRevealR, d);
        float rim = smoothstep(uRevealR - 1.4, uRevealR - 0.7, d) * (1.0 - smoothstep(uRevealR - 0.7, uRevealR, d));
        rim *= 0.5 + 0.5 * sin(vWPos.x * 3.1 + vWPos.z * 2.3 + uTime * 2.0);
        outgoingLight = outgoingLight * vis + uRim * rim * 0.55 * step(uRevealR, 120.0);
        #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => `gh-${opts.focus ? 1 : 0}-${opts.rafter ? 1 : 0}`;
  return mat;
}

// ---------------------------------------------------------------- loading
const loadingEl = $('#loader');
const barEl = $('#loader .bar i');
const pctEl = $('#loader .pct');
const manager = new THREE.LoadingManager();
manager.onProgress = (_u, loaded, total) => setProgress(0.85 + 0.15 * (loaded / total));
let progress = 0;
function setProgress(p) {
  progress = Math.max(progress, p);
  barEl.style.transform = `scaleX(${progress})`;
  pctEl.textContent = `${Math.round(progress * 100)}%`;
}

const texLoader = new THREE.TextureLoader(manager);
const tex = (url, srgb = true, repeat = false) => {
  const t = texLoader.load(asset(url));
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
};

// Hall textures are KTX2 (Basis ETC1S, see tools/compress-textures.mjs): they stay block-compressed on the GPU.
const ktx2Loader = new KTX2Loader().setTranscoderPath('assets/basis/').detectSupport(renderer);
const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder);
gltfLoader.setKTX2Loader(ktx2Loader);

// Two scenes, exactly as composed in Reality Composer Pro (Scene_Night / Scene_Day).
// Each is its own GLB because the day and night compositions differ (e.g. the house tables only appear in day).
const hall = { night: null, day: null, loading: {}, focusMeshes: [], rafters: [], rafterPrepass: [] };

// Rafter depth pre-pass: the web version of the RCP Mesh Sorting Group with depthPass = "prePass".
// Each rafter writes its own depth first, then its colour, so only its nearest surface is shaded and its own
// overlapping faces can't stack opacity (the fade reads like a flat image). Rafters are drawn one at a time,
// farthest first (re-sorted every frame), so a nearer rafter's faded parts never hide a rafter behind it.
let rafterPrepassOn = true;

function prepare(root, which) {
  const newRafters = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const name = o.name || o.parent?.name || '';
    // The light-shield box is an RCP lighting helper; the roof stays, with the Enchanted Ceiling dome inside it.
    if (/LightShield/.test(name)) { o.visible = false; return; }
    const focus = /SM_HW_GH_Table_|TableRunner|WoodenBench/.test(name);
    const rafter = /VFX_SM_GH_Rafters/.test(name);
    // Day floor is layered (full floor + centre strips at the same height), so nudge the strips forward to avoid z-fighting.
    // Floor decals (ash/soot): blended over the floor without writing depth, nudged forward to avoid z-fighting
    if (o.material.userData?.vfx === 'decal') { o.material.depthWrite = false; o.material.polygonOffset = true; o.material.polygonOffsetFactor = -2; o.material.polygonOffsetUnits = -8; o.renderOrder = 1; }
    const layer = /FloorMain_006/.test(name) ? 2 : /FloorMain_00[45]|Floor4/.test(name) ? 1 : 0;
    if (layer) { o.material = o.material.clone(); o.material.polygonOffset = true; o.material.polygonOffsetFactor = -layer; o.material.polygonOffsetUnits = -4 * layer; o.renderOrder = layer; }
    if (rafter) {
      // Day-scene overrides from Scene.usda (Scene_Day): the A rafters pass their texture through a Mix node
      // (black → texture at 0.3 or 0.4), B_Lite uses its texture as-is. Night uses the texture as-is.
      const mix = which !== 'day' ? 1 : /A_Lite[56]_/.test(name) ? 0.3 : /A_Lite\d?_/.test(name) ? 0.4 : 1;
      o.material = o.material.clone();
      patchMaterial(o.material, { focus, rafter, colorScale: mix });
    } else patchMaterial(o.material, { focus, rafter });
    if (rafter) { o.renderOrder = 11; hall.rafters.push(o); newRafters.push(o); } // re-ordered every frame in sortRafters()
    if (focus) hall.focusMeshes.push(o);
    o.matrixAutoUpdate = false; o.updateMatrix();
  });
  // depth-only twin per rafter, drawn right before that rafter's colour pass (see sortRafters)
  newRafters.forEach((o) => {
    // Same shader as the colour pass (only colour writes off), so both passes compute identical depth on every GPU.
    // A tiny polygon offset pushes the pre-pass back a hair, so the nearest surface always passes in the colour pass.
    const dm = new THREE.MeshBasicMaterial({ map: o.material.map });
    patchMaterial(dm, { rafter: true });
    Object.assign(dm, { colorWrite: false, depthWrite: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const pre = new THREE.Mesh(o.geometry, dm);
    pre.matrixAutoUpdate = false; pre.matrix.copy(o.matrix); pre.renderOrder = 10; pre.visible = rafterPrepassOn;
    o.parent.add(pre); hall.rafterPrepass.push(pre); o.userData.pre = pre;
    o.geometry.computeBoundingSphere();
  });
  root.name = which;
  root.visible = false;
  scene.add(root);
  return root;
}

function loadScene(which, onProgress) {
  if (hall.loading[which]) return hall.loading[which];
  hall.loading[which] = new Promise((resolve, reject) => {
    const done = (gltf) => resolve((hall[which] = prepare(gltf.scene, which)));
    const inline = window.__ASSETS && window.__ASSETS.glb && window.__ASSETS.glb[which]; // single-file preview builds only
    if (inline) {
      const bin = Uint8Array.from(atob(inline), (c) => c.charCodeAt(0)).buffer;
      gltfLoader.parse(bin, '', done, reject);
    } else gltfLoader.load(asset(`assets/model/${which}${lowMemory ? '.mobile' : ''}.ktx2.glb`), done, onProgress, reject);
  });
  return hall.loading[which];
}

// Frees a lighting scene's GPU memory (mobile only, so day and night are never resident together); loadScene() reloads it on demand.
function unloadScene(which) {
  const root = hall[which];
  if (!root) return;
  const owned = (o) => { for (let p = o; p; p = p.parent) if (p === root) return true; return false; };
  hall.rafters = hall.rafters.filter((o) => !owned(o));
  hall.rafterPrepass = hall.rafterPrepass.filter((o) => !owned(o));
  hall.focusMeshes = hall.focusMeshes.filter((o) => !owned(o));
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.dispose();
    for (const m of [].concat(o.material)) {
      for (const v of Object.values(m)) if (v && v.isTexture) v.dispose();
      m.dispose();
    }
  });
  scene.remove(root);
  hall[which] = null;
  delete hall.loading[which];
}

let mode = 'night';
let modeTarget = 0;
loadScene('night', (e) => { if (e.total) setProgress(0.85 * (e.loaded / e.total)); else setProgress(Math.min(0.8, progress + 0.01)); })
  .then((root) => {
    root.visible = true;
    setProgress(0.9);
    finishLoading();
    // Warm the day scene in the background so the toggle is instant (not on mobile: both scenes together don't fit).
    if (!lowMemory) setTimeout(() => loadScene('day').catch((e) => console.warn('day scene', e)), 1200);
  })
  .catch((err) => { console.error(err); pctEl.textContent = 'Could not load the 3D model. See the README (serve the folder over http).'; setTimeout(finishLoading, 2500); });

let switching = false;
async function setMode(next, { auto = false } = {}) {
  if (next === mode || switching) return;
  if (!auto) userMode = next;
  switching = true;
  document.documentElement.dataset.mode = next;
  $$('[data-mode-btn]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.modeBtn === next)));
  const veil = $('#veil');
  try {
    const target = await loadScene(next);
    // quick veil so the swap reads as a lighting change, not a pop
    veil.classList.add('on');
    await new Promise((r) => setTimeout(r, 260));
    if (hall.night) hall.night.visible = next === 'night';
    if (hall.day) hall.day.visible = next === 'day';
    target.visible = true;
    if (lowMemory) unloadScene(mode);
    mode = next;
    // RCP fade starts at 15 m at night and 18 m in day (Remap inlow override in Scene_Day); both end at 30 m
    if (fadeLow) { fadeLow.value = FADE_LOW[next]; fadeHigh.value = 30; syncFade(); }
    modeTarget = next === 'day' ? 1 : 0;
  } catch (e) { console.error(e); document.documentElement.dataset.mode = mode; }
  veil.classList.remove('on');
  switching = false;
}
let userMode = 'night';
const FADE_LOW = { night: 15, day: 18 };
let autoDay = false;
$$('[data-mode-btn]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.modeBtn)));
$$('[data-mode-toggle]').forEach((b) => b.addEventListener('click', () => setMode(mode === 'night' ? 'day' : 'night')));

// ---------------------------------------------------------------- UV seams on the house tables (computed from the real meshes)
const seamMat = new THREE.LineBasicMaterial({ color: 0x7fe3ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
const seamLines = new THREE.LineSegments(new THREE.BufferGeometry(), seamMat);
seamLines.renderOrder = 8; seamLines.visible = false; scene.add(seamLines);
(async () => {
  try {
    let buf;
    if (window.__ASSETS && window.__ASSETS.seamsBase64) buf = Uint8Array.from(atob(window.__ASSETS.seamsBase64), (c) => c.charCodeAt(0)).buffer;
    else buf = await (await fetch(asset('assets/model/table-seams.bin'))).arrayBuffer();
    seamLines.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf), 3));
  } catch (e) { console.warn('seams', e); }
})();

// ---------------------------------------------------------------- Enchanted Ceiling
// The real dome from the RCP project (enchanted-ceiling-assets/greathall-ceiling.usdc): two nested shells,
// 'stars' (sky gradient + star field) and 'cloud' (procedural clouds), both feathered by the pill opacity mask.
const skyUniforms = {
  uTime: U.uTime, uDay: U.uDay, uRevealR: U.uRevealR, uRevealCenter: U.uRevealCenter,
  tNightC: { value: tex('assets/textures/clouds-night-color.webp', true, true) },
  tNightA: { value: tex('assets/textures/clouds-night-alpha.webp', false, true) },
  tDayA: { value: tex('assets/textures/clouds-day-alpha.webp', false, true) },
  tStars: { value: tex('assets/textures/stars.webp', true, true) },
  tPill: { value: tex('assets/textures/pill-mask.webp', false) },
};
const skyVert = /* glsl */`
  varying vec2 vUv; varying vec3 vW;
  void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const skyCommon = /* glsl */`
  precision highp float;
  varying vec2 vUv; varying vec3 vW;
  uniform float uTime, uDay, uRevealR; uniform vec3 uRevealCenter;
  uniform sampler2D tNightC, tNightA, tDayA, tStars, tPill;
  float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
    return mix(mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x), mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x), mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z); }
  float fbm(vec3 p, int oct, float lac, float dim){ float v = 0.0, a = 0.5; for (int i = 0; i < 8; i++){ if (i >= oct) break; v += a * noise(p); p *= lac; a *= dim; } return v; }
  float pill(){ return smoothstep(0.1, 0.5, texture2D(tPill, vUv).r); }
  float reveal(){ return 1.0 - smoothstep(uRevealR - 5.0, uRevealR, distance(vW, uRevealCenter)); }
  vec3 toSRGB(vec3 c){ return pow(max(c, 0.0), vec3(1.0/2.2)); }`;
const starMat = new THREE.ShaderMaterial({
  uniforms: skyUniforms, vertexShader: skyVert, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  fragmentShader: skyCommon + /* glsl */`
    void main(){
      float t = uTime;
      // horizontal ramp across the dome (values from the RCP 'star' material, linear)
      vec3 night = mix(vec3(0.16471, 0.23944, 0.47610), vec3(0.01038, 0.04748, 0.15084), smoothstep(0.18, 0.83, vUv.x));
      night *= 0.36;
      // tiled star mask + slow 3D-noise twinkle (RCP: Fractal3D on position*0.01 driven by time)
      vec3 stars = texture2D(tStars, vUv * vec2(3.0, 6.0)).rgb;
      float tw = clamp((fbm(vW * 0.15 + vec3(0.0, 0.0, t * 0.6), 4, 2.0, 0.5) - 0.2) / 0.6, 0.0, 1.0);
      stars *= mix(vec3(0.33, 0.55, 0.55), vec3(1.0), tw) * (2.0 + 4.0 * tw);
      vec3 sp = vW * 2.2; vec3 cell = floor(sp); float r = hash(cell);
      float pt = step(0.965, r) * smoothstep(0.35, 0.0, length(fract(sp) - 0.5)) * (0.5 + 0.5 * sin(t * (1.5 + r * 3.0) + r * 40.0));
      vec3 colN = night + stars + vec3(1.0, 0.95, 0.85) * pt * 1.6;
      vec3 colD = mix(vec3(0.30, 0.50, 0.80), vec3(0.62, 0.76, 0.92), vUv.y * 0.5 + 0.25);
      vec3 col = mix(toSRGB(colN), colD, uDay);
      gl_FragColor = vec4(col * reveal(), pill() * reveal());
    }`,
});
const cloudMat = new THREE.ShaderMaterial({
  uniforms: skyUniforms, vertexShader: skyVert, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  fragmentShader: skyCommon + /* glsl */`
    void main(){
      float t = uTime;
      vec3 p = vW;
      // night: base + area + wispy fractals on world position, drifting with time (RCP 'nightCloudOpacity')
      float base = fbm(p * 0.06 + vec3(t * 0.02, 0.0, t * 0.012), 6, 2.6, 0.5);
      float area = fbm(p * 0.03 + vec3(-t * 0.01, 3.1, 0.0), 4, 3.0, 0.4);
      float wisp = fbm(p * 0.25 + vec3(t * 0.05, 0.0, -t * 0.03), 4, 2.4, 0.5);
      float texA = texture2D(tNightA, vUv * vec2(1.5, 3.0) + vec2(t * 0.003, t * 0.0015)).r;
      float nA = smoothstep(0.42, 0.78, base * 0.75 + area * 0.35 + texA * 0.2) * (0.65 + 0.35 * wisp);
      vec3 nCol = mix(vec3(0.04, 0.05, 0.10), vec3(0.24, 0.27, 0.40), smoothstep(0.3, 0.9, wisp)) + texture2D(tNightC, vUv * 2.0).rgb * 0.5;
      // day: bright, softer, larger clouds (RCP 'dayCloudOpacity')
      float dBase = fbm(p * 0.045 + vec3(t * 0.015, 0.0, t * 0.01), 6, 3.0, 0.5);
      float dTex = 1.0 - texture2D(tDayA, vUv * vec2(1.2, 2.4) + vec2(t * 0.004, 0.0)).r;
      float dA = smoothstep(0.38, 0.72, dBase * 0.8 + dTex * 0.35);
      vec3 dCol = mix(vec3(0.78, 0.82, 0.88), vec3(1.0), smoothstep(0.4, 0.9, dBase));
      float a = mix(nA * 0.85, dA * 0.9, uDay);
      vec3 col = mix(nCol, dCol, uDay);
      gl_FragColor = vec4(col * reveal(), a * pill() * reveal());
    }`,
});
const ceiling = new THREE.Group();
scene.add(ceiling);
(async () => {
  try {
    let gltf;
    if (window.__ASSETS && window.__ASSETS.glb && window.__ASSETS.glb.ceiling) {
      const bin = Uint8Array.from(atob(window.__ASSETS.glb.ceiling), (c) => c.charCodeAt(0)).buffer;
      gltf = await gltfLoader.parseAsync(bin, '');
    } else gltf = await gltfLoader.loadAsync(asset('assets/model/ceiling.glb'));
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const stars = /stars/.test(o.name) || /stars/.test(o.parent?.name || '');
      o.material = stars ? starMat : cloudMat;
      o.renderOrder = stars ? 2 : 3;
      o.frustumCulled = false;
    });
    ceiling.add(gltf.scene);
  } catch (e) { console.warn('ceiling', e); }
})();

// ---------------------------------------------------------------- flipbook fire (Mark's sprite sheets)
function flipbookMaterial(url, cols, rows, fps, frames, tint = 1) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, map: { value: typeof url === 'string' ? tex(url) : url }, uCols: { value: cols }, uRows: { value: rows }, uFps: { value: fps }, uFrames: { value: frames }, uTint: { value: tint }, uDay: U.uDay, uRevealR: U.uRevealR, uRevealCenter: U.uRevealCenter, uOffset: { value: Math.random() * 100 } },
    vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv=uv; vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `
      varying vec2 vUv; varying vec3 vW; uniform sampler2D map; uniform float uTime,uCols,uRows,uFps,uFrames,uTint,uDay,uOffset,uRevealR; uniform vec3 uRevealCenter;
      void main(){
        float f = mod(floor((uTime + uOffset) * uFps), uFrames);
        vec2 cell = vec2(mod(f, uCols), floor(f / uCols));
        vec2 uv = (vec2(cell.x, uRows - 1.0 - cell.y) + vUv) / vec2(uCols, uRows);
        vec4 c = texture2D(map, uv);
        float vis = 1.0 - smoothstep(uRevealR - 5.0, uRevealR, distance(vW, uRevealCenter));
        gl_FragColor = vec4(c.rgb * uTint * 1.25 * vis, c.a * vis * mix(1.0, 0.75, uDay));
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}
const fireplace = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.8), flipbookMaterial('assets/textures/fireplace-sheet.webp', 16, 16, 24, 256, 1.15));
fireplace.position.set(-16.25, 0.15 + 1.4, -5.95);
fireplace.rotation.y = Math.PI / 2;
fireplace.renderOrder = 6;
scene.add(fireplace);

// Torch flames: placed exactly like the four Torch_Fire_SpriteSheet entities in Scene.usda (Common/Fire___Flipbook).
// Each is a flat card (Cube size 0.2 × scale 1.5 → 0.3 m) with the Fire_A_Sheet flipbook (16 × 8 frames, 24 fps).
const torchMat = flipbookMaterial('assets/textures/torch-sheet.webp', 16, 8, 24, 128, 1.1);
const TORCHES = [ // [x, y, z, orient quat (w, x, y, z)] — Slytherin, Ravenclaw, Hufflepuff, Gryffindor sconces
  [-9.58519, 2.69921, -12.064497, [0.95371705, 0, 0.3007056, 0]],
  [-9.949326, 2.8012416, -24.310343, null],
  [9.834196, 2.6946476, -12.152406, null],
  [9.772791, 3.1816306, -24.293125, null],
];
const torches = TORCHES.map(([x, y, z, q], i) => {
  // Note: don't clone() the shader material — cloning copies the shared uniforms (time, scroll reveal)
  // into frozen copies, which left the old torch flames invisible. Build a fresh material that shares them.
  const mat = flipbookMaterial(torchMat.uniforms.map.value, 16, 8, 24, 128, 1.1);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), mat);
  m.position.set(x, y, z);
  const rotY = [35, 24, -35, -20][i]; // yaw from the RCP xformOp:orient values
  m.rotation.y = THREE.MathUtils.degToRad(rotY);
  m.renderOrder = 6;
  scene.add(m);
  return m;
});
// Sconce point lights (Common/Lights/Torch_Lights/Sconce_Torch_*), used for the glow sprites
const TORCH_LIGHTS = [[-9.33, 3.05, -11.86], [-9.74, 2.80, -24.34], [9.68, 2.71, -12.10], [9.80, 3.10, -24.33]];

// soft glow sprites (dynamic-light flicker stand-in)
function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,220,160,1)'); gr.addColorStop(0.25, 'rgba(255,170,80,0.45)'); gr.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const glowTex = glowTexture();
const glows = [...TORCH_LIGHTS.map(([x, y, z]) => [x, y - 0.1, z, 2.6]), [-16.7, 1.17, -6.09, 7]].map(([x, y, z, s]) => {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.35 }));
  sp.position.set(x, y, z); sp.scale.setScalar(s); sp.userData.base = s; sp.renderOrder = 7; scene.add(sp); return sp;
});

// ---------------------------------------------------------------- floating candles (Mark)
// Mark's real candles: the Blender cluster (candles-cluster-verticle-offset-2.usdc) split into its individual
// candles, each placed exactly where it sits in the scene. Three candle body shapes + one flame shape are
// drawn as instanced meshes (assets/model/candles.glb, EXT_mesh_gpu_instancing).
// Bobbing recreates the RCP GeometryModifier: a 3D noise field sampled at each candle's world position
// (position * 0.1, scrolling up with time * 0.3) pushes the whole candle up/down, with a little sideways drift.
const candleUniforms = {
  uTime: U.uTime, uDay: U.uDay, uExposure: U.uExposure, uRevealR: U.uRevealR, uRevealCenter: U.uRevealCenter,
  tNight: { value: tex('assets/textures/candles-night.webp') },
  tDay: { value: tex('assets/textures/candles-day.webp') },
  tFire: { value: tex('assets/textures/candle-fire.webp') },
};
// candles.glb stores glTF-style UVs (origin top-left), so these textures must not be flipped on upload
for (const k of ['tNight', 'tDay', 'tFire']) candleUniforms[k].value.flipY = false;
const candleVert = /* glsl */`
  uniform float uTime; varying vec2 vUv; varying vec3 vW; varying float vSeed;
  vec3 h3(vec3 p){ p = vec3(dot(p,vec3(127.1,311.7,74.7)), dot(p,vec3(269.5,183.3,246.1)), dot(p,vec3(113.5,271.9,124.6)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453); }
  float gnoise(vec3 p){ vec3 i = floor(p), f = fract(p); vec3 u = f*f*(3.0-2.0*f);
    return mix(mix(mix(dot(h3(i),f), dot(h3(i+vec3(1,0,0)),f-vec3(1,0,0)),u.x), mix(dot(h3(i+vec3(0,1,0)),f-vec3(0,1,0)), dot(h3(i+vec3(1,1,0)),f-vec3(1,1,0)),u.x),u.y),
               mix(mix(dot(h3(i+vec3(0,0,1)),f-vec3(0,0,1)), dot(h3(i+vec3(1,0,1)),f-vec3(1,0,1)),u.x), mix(dot(h3(i+vec3(0,1,1)),f-vec3(0,1,1)), dot(h3(i+vec3(1,1,1)),f-vec3(1,1,1)),u.x),u.y), u.z); }
  void main(){
    vUv = uv;
    vec3 c = (modelMatrix * instanceMatrix * vec4(0.0,0.0,0.0,1.0)).xyz;   // this candle's position in the hall
    vec3 q = c * 0.1 + vec3(0.0, uTime * 0.3 * 0.25, 0.0);
    float n = gnoise(q), n2 = gnoise(q + 17.3);
    vec3 offs = vec3(n * n2 * 0.04, n * 0.12, n2 * n * 0.04);
    vSeed = fract(sin(dot(c, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
    w.xyz += offs; vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const candleFragHead = /* glsl */`
  uniform float uTime, uDay, uExposure, uRevealR; uniform vec3 uRevealCenter;
  uniform sampler2D tNight, tDay, tFire; varying vec2 vUv; varying vec3 vW; varying float vSeed;
  float reveal(){ return 1.0 - smoothstep(uRevealR - 5.0, uRevealR, distance(vW, uRevealCenter)); }`;
const candleBodyMat = new THREE.ShaderMaterial({
  uniforms: candleUniforms, vertexShader: candleVert,
  fragmentShader: candleFragHead + /* glsl */`
    void main(){
      vec3 col = mix(texture2D(tNight, vUv).rgb, texture2D(tDay, vUv).rgb, uDay) * uExposure;
      float vis = reveal(); if (vis < 0.003) discard;
      gl_FragColor = vec4(col * vis, 1.0);
      #include <colorspace_fragment>
    }`,
});
const candleFlameMat = new THREE.ShaderMaterial({
  uniforms: candleUniforms, vertexShader: candleVert,
  fragmentShader: candleFragHead + /* glsl */`
    void main(){
      float fl = 0.85 + 0.15 * sin(uTime * (9.0 + vSeed * 6.0) + vSeed * 50.0);
      vec3 col = texture2D(tFire, vUv + vec2(0.0, -uTime * 0.15 + vSeed)).rgb * 1.3 * fl;
      float vis = reveal(); if (vis < 0.003) discard;
      gl_FragColor = vec4(col * vis, 1.0);
      #include <colorspace_fragment>
    }`,
});
const candleGroup = new THREE.Group();
candleGroup.position.y = 3; // raised 3 m above the exported Blender height (art direction for the web page)
scene.add(candleGroup);
(async () => {
  try {
    let gltf;
    if (window.__ASSETS && window.__ASSETS.glb && window.__ASSETS.glb.candles) {
      const bin = Uint8Array.from(atob(window.__ASSETS.glb.candles), (c) => c.charCodeAt(0)).buffer;
      gltf = await gltfLoader.parseAsync(bin, '');
    } else gltf = await gltfLoader.loadAsync(asset('assets/model/candles.glb'));
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const flame = /flame/.test(o.name) || /flame/.test(o.parent?.name || '');
      o.material = flame ? candleFlameMat : candleBodyMat;
      o.frustumCulled = false;
    });
    candleGroup.add(gltf.scene);
  } catch (e) { console.warn('candles', e); }
})();
function updateCandles() {} // bobbing runs entirely in the vertex shader
const rnd = mulberry(7);

// ---------------------------------------------------------------- dust motes
const DUST = 1400;
const dustGeo = new THREE.BufferGeometry();
const dp = new Float32Array(DUST * 3);
for (let i = 0; i < DUST; i++) { dp[i * 3] = (rnd() * 2 - 1) * 15; dp[i * 3 + 1] = rnd() * 16; dp[i * 3 + 2] = lerp(-38, 26, rnd()); }
dustGeo.setAttribute('position', new THREE.BufferAttribute(dp, 3));
// Points render as squares unless they have a sprite: a soft white disc, tinted by the material colour.
function dotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
// opacity 0.6 (was 0.35 as squares): a soft disc covers about half the pixels of a square
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: 0.04, map: dotTexture(), color: 0xffd9a8, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
scene.add(dust);

function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------------------------------------------------------------- camera choreography
// One shot per chapter (matches data-shot on each <section>). World units = metres, hall faces -Z.
const SHOTS = {
  hero:     { p: [0, 1.9, 4.6],   t: [0, 3.4, -30],  fov: 52, reveal: 6 },
  brief:    { p: [-6, 5.5, 3],    t: [2, 6.5, -30],  fov: 55, reveal: 30 },
  setup:    { p: [8.5, 12.5, -1], t: [-3, 2, -24],   fov: 58, reveal: 80 },
  tables:   { p: [-5.2, 2.1, -1], t: [-0.5, 0.2, -16], fov: 50, reveal: 140 },
  ceiling:  { p: [0, 3.0, 2],     t: [0, 29, -14],   fov: 68, reveal: 140 },
  rafters:  { p: [7.5, 11, -2],   t: [-3, 22, -20],  fov: 60, reveal: 140 },
  fire:     { p: [-10.2, 2.2, -2.2], t: [-17, 1.9, -10.2], fov: 50, reveal: 140 },
  candles:  { p: [2.5, 6.2, -1],  t: [-1, 10.5, -19], fov: 58, reveal: 140 },
  lighting: { p: [0, 3.2, 4.4],   t: [0, 5.5, -36],  fov: 60, reveal: 140 },
  headset:  { p: [0, 1.6, 1.5],   t: [0, 2.8, -12],  fov: 60, reveal: 140 },
  credits:  { p: [0, 15, 4],      t: [0, 6, -30],    fov: 58, reveal: 140 },
};
const sections = $$('[data-shot]');
const shotList = sections.map((s) => SHOTS[s.dataset.shot]);
const V = (a) => new THREE.Vector3(...a);
const posCurve = new THREE.CatmullRomCurve3(shotList.map((s) => V(s.p)), false, 'centripetal', 0.5);
const tgtCurve = new THREE.CatmullRomCurve3(shotList.map((s) => V(s.t)), false, 'centripetal', 0.5);

let scrollT = 0;   // continuous chapter index (0 … n-1)
let smoothT = 0;
const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
addEventListener('pointermove', (e) => { mouse.x = e.clientX / innerWidth - 0.5; mouse.y = e.clientY / innerHeight - 0.5; });

function measure() {
  const mid = innerHeight * 0.5;
  let idx = 0;
  // anchor each shot on its chapter's main card, so the camera arrives as you read
  const anchor = (i) => (sections[i].querySelector('.card, .hero-inner') || sections[i]).getBoundingClientRect();
  for (let i = 0; i < sections.length; i++) {
    const r = anchor(i);
    if (r.top + r.height / 2 <= mid) idx = i;
  }
  const a = anchor(idx);
  const b = sections[idx + 1] ? anchor(idx + 1) : null;
  let f = 0;
  if (b) {
    const ca = a.top + a.height / 2, cb = b.top + b.height / 2;
    f = clamp((mid - ca) / (cb - ca));
  }
  scrollT = idx + smooth(f);
}
addEventListener('scroll', measure, { passive: true });

// active chapter → UI + effects
let activeShot = 'hero';
const io = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (!e.isIntersecting) return;
    activeShot = e.target.dataset.shot;
    // The house tables only exist in the day composition, so the tables chapter borrows day lighting.
    if (activeShot === 'tables' && mode === 'night') { autoDay = true; setMode('day', { auto: true }); }
    else if (activeShot !== 'tables' && autoDay) { autoDay = false; if (userMode !== mode) setMode(userMode, { auto: true }); }
    $$('.rail a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#${e.target.id}`));
    document.documentElement.dataset.chapter = activeShot;
  });
}, { rootMargin: '-45% 0px -45% 0px' });
sections.forEach((s) => io.observe(s));

// Interactive controls ----------------------------------------------------
let uvOverride = null;
$('#uv-toggle')?.addEventListener('click', (e) => {
  uvOverride = uvOverride === 0 ? null : 0;
  e.currentTarget.setAttribute('aria-pressed', String(uvOverride === null));
  e.currentTarget.textContent = uvOverride === null ? 'Hide UV checker' : 'Show UV checker';
});
const fadeLow = $('#fade-low'), fadeHigh = $('#fade-high');
function syncFade() {
  let lo = +fadeLow.value, hi = +fadeHigh.value;
  if (hi < lo + 1) { hi = lo + 1; fadeHigh.value = hi; }
  U.uFadeLow.value = lo; U.uFadeHigh.value = hi;
  $('#fade-low-out').textContent = `${lo} m`; $('#fade-high-out').textContent = `${hi} m`;
}
fadeLow?.addEventListener('input', syncFade); fadeHigh?.addEventListener('input', syncFade);
$('#prepass-toggle')?.addEventListener('click', (e) => {
  rafterPrepassOn = !rafterPrepassOn;
  hall.rafterPrepass.forEach((m) => (m.visible = rafterPrepassOn));
  e.currentTarget.setAttribute('aria-pressed', String(rafterPrepassOn));
  e.currentTarget.textContent = rafterPrepassOn ? 'Depth pre-pass: on' : 'Depth pre-pass: off';
});
$('#fade-reset')?.addEventListener('click', () => { fadeLow.value = FADE_LOW[mode]; fadeHigh.value = 30; syncFade(); });

// Per-frame: order rafters back-to-front; each gets [depth pass, colour pass] = renderOrder [10+2k, 11+2k].
// (Sky dome draws at 2–3, before all of them.)
const _c = new THREE.Vector3();
function sortRafters() {
  const list = hall.rafters.filter((o) => o.parent && o.parent.visible !== false && isShown(o));
  for (const o of list) { _c.copy(o.geometry.boundingSphere.center).applyMatrix4(o.matrixWorld); o.userData.dist = _c.distanceToSquared(camera.position); }
  list.sort((a, b) => b.userData.dist - a.userData.dist);
  list.forEach((o, k) => { if (o.userData.pre) o.userData.pre.renderOrder = 10 + 2 * k; o.renderOrder = 11 + 2 * k; });
}
function isShown(o) { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; }

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
const lookAt = new THREE.Vector3();
let started = false;
function finishLoading() {
  setProgress(1);
  setTimeout(() => { loadingEl.classList.add('done'); document.body.classList.add('ready'); started = true; }, 350);
}

function tick() {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.05);
  const t = timer.getElapsed();
  U.uTime.value = t;

  smoothT = lerp(smoothT, scrollT, reduceMotion ? 1 : 1 - Math.pow(0.0025, dt));
  const n = shotList.length - 1;
  const u = clamp(smoothT / n);
  posCurve.getPoint(u, camera.position);
  tgtCurve.getPoint(u, lookAt);
  const i0 = Math.floor(smoothT), i1 = Math.min(n, i0 + 1), f = smoothT - i0;
  const s0 = shotList[i0], s1 = shotList[i1];
  camera.fov = lerp(s0.fov, s1.fov, f);
  // reveal grows as you scroll: the hall "materialises" from the entrance outward
  const intro = started ? 1 : 0;
  U.uRevealR.value = lerp(U.uRevealR.value, lerp(s0.reveal, s1.reveal, f) * intro + (1 - intro) * 0.1, 1 - Math.pow(0.02, dt));
  // gentle parallax + idle drift
  mouse.sx = lerp(mouse.sx, mouse.x, 0.05); mouse.sy = lerp(mouse.sy, mouse.y, 0.05);
  if (!reduceMotion) {
    camera.position.x += mouse.sx * 0.6 + Math.sin(t * 0.25) * 0.08;
    camera.position.y += -mouse.sy * 0.35 + Math.sin(t * 0.31) * 0.05;
  }
  camera.lookAt(lookAt);
  camera.updateProjectionMatrix();

  // chapter-driven effects
  const want = (k) => (activeShot === k ? 1 : 0);
  U.uUVMix.value = lerp(U.uUVMix.value, uvOverride ?? want('tables'), 0.08);
  U.uDim.value = lerp(U.uDim.value, want('tables') * 0.85, 0.06);
  seamMat.opacity = U.uUVMix.value * 0.95; seamLines.visible = seamMat.opacity > 0.01;
  U.uRafterGlow.value = lerp(U.uRafterGlow.value, want('rafters'), 0.06);
  U.uDay.value = lerp(U.uDay.value, modeTarget, 0.06);
  U.uExposure.value = lerp(U.uExposure.value, mode === 'day' ? 1.0 : 1.35, 0.06);
  scene.fog.color.setRGB(lerp(0.02, 0.32, U.uDay.value), lerp(0.024, 0.30, U.uDay.value), lerp(0.047, 0.28, U.uDay.value));
  scene.fog.density = lerp(0.012, 0.0012, U.uDay.value);

  // flicker
  glows.forEach((g, i) => { const k = 0.85 + 0.15 * Math.sin(t * 13 + i * 4) * Math.sin(t * 7.3 + i); g.scale.setScalar(g.userData.base * k); g.material.opacity = (0.32 + 0.1 * k) * (1 - U.uDay.value * 0.5) * clamp(U.uRevealR.value / 40); });
  sortRafters();
  updateCandles(t);
  // dust drift
  const pa = dustGeo.attributes.position.array;
  for (let i = 0; i < DUST; i++) { pa[i * 3 + 1] += Math.sin(t * 0.3 + i) * 0.0015 - 0.0025; if (pa[i * 3 + 1] < 0) pa[i * 3 + 1] = 16; }
  dustGeo.attributes.position.needsUpdate = true;

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
measure();
tick();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- page UI bits
// Outliner: real object names from the production scene, typed in as the setup chapter appears.
Promise.resolve(outlinerNames).then((names) => {
  const list = $('#outliner-list'); if (!list) return;
  const frag = document.createDocumentFragment();
  names.forEach((n) => { const li = document.createElement('li'); li.innerHTML = n.replace(/^(SM|VFX|GC)_/, '<b>$1_</b>').replace(/_(Baked|Bake)$/, '<em>_$1</em>'); frag.appendChild(li); });
  list.appendChild(frag);
}).catch(() => {});

// before/after panorama wipe (Luke's final renders)
$$('.wipe').forEach((w) => {
  const set = (x) => w.style.setProperty('--x', `${clamp(x) * 100}%`);
  const move = (e) => { const r = w.getBoundingClientRect(); set((e.clientX - r.left) / r.width); };
  w.addEventListener('pointerdown', (e) => { w.setPointerCapture(e.pointerId); move(e); w.addEventListener('pointermove', move); });
  w.addEventListener('pointerup', () => w.removeEventListener('pointermove', move));
  w.querySelector('input')?.addEventListener('input', (e) => set(e.target.value / 100));
});

// lazy autoplay videos only when visible
const vio = new IntersectionObserver((es) => es.forEach((e) => { const v = e.target; if (e.isIntersecting) { v.play?.().catch(() => {}); } else v.pause?.(); }), { threshold: 0.25 });
$$('video[data-auto]').forEach((v) => vio.observe(v));

// reveal-on-scroll cards
const cio = new IntersectionObserver((es) => es.forEach((e) => e.target.classList.toggle('in', e.isIntersecting)), { rootMargin: '-10% 0px -10% 0px' });
$$('.card, .media-row, .stat').forEach((c) => cio.observe(c));

// stats count-up
$$('[data-count]').forEach((el) => {
  const o = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return; o.disconnect();
    const end = +el.dataset.count; const t0 = performance.now();
    const step = (now) => { const k = clamp((now - t0) / 1400); el.textContent = Math.round(end * smooth(k)).toLocaleString(); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
  o.observe(el);
});
