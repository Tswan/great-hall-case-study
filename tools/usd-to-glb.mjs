import fs from 'fs'; import path from 'path'; import * as THREE from 'three';
import { Document, NodeIO } from '@gltf-transform/core';
import { KHRMaterialsUnlit } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { Stage } from './compose.mjs';
const R = process.env.RK || '/sessions/relaxed-bold-ptolemy/mnt/Development/wbd-beam-rc-environments/environments/great_hall/GreatHallProject/Sources/GreatHallProject/GreatHallProject.rkassets/';
const MODE = process.argv[2] || 'night'; const SCENE = MODE === 'day' ? 'Scene_Day' : 'Scene_Night';
const SZ = +process.env.SZ || 1536, Q = +process.env.Q || 72, OUT = process.argv[3] || `/tmp/build/${MODE}_raw.glb`;
const st = new Stage(R + 'Scene.usda', '/scope_root');
const sceneNode = st.get('/scope_root/' + SCENE);
const sceneDir = R + (MODE === 'day' ? 'dayScene/' : 'nightScene/');
const isColor = (f) => /\.(jpg|jpeg|png)$/i.test(f) && !/normal|nrml|rough|opacity|metal|mask|attenuation|reflection|\.exr/i.test(path.basename(f));
function resolveAsset(a, o) {
  if (!a) return null; a = a.replace(/^\.\//, '');
  for (const base of [o.L.dir, sceneDir, R, path.dirname(o.L.dir)]) { const f = path.resolve(base, a); if (fs.existsSync(f)) return f; }
  return null;
}
const texCache = new Map();
function materialInfo(matPath) {
  const key = matPath; if (texCache.has(key)) return texCache.get(key);
  const m = matPath && st.get(matPath); let best = null, rank = 99, varname = null, missing = null;
  const visit = (n, depth) => {
    if (!st.active(n)) return;
    const nm = n.path.split('/').pop();
    for (const pn of ['inputs:Image', 'inputs:file']) {
      const v = st.asset(n, pn); if (!v) continue;
      const conn = st.prop(n, pn + '.connect'); 
      const f = resolveAsset(v.a, v.o);
      if (!isColor(v.a)) continue;
      const r = nm === 'Baked_Image_Node' ? 0 : /^Image$|^image$/.test(nm) ? 1 : /^Image/.test(nm) ? 2 : 3;
      if (!f) { missing = missing || v.a; continue; }
      if (r < rank) { rank = r; best = f; }
    }
    const vn = st.str(n, 'inputs:varname'); if (vn && !varname) varname = vn;
    if (depth < 4) for (const c of st.children(n)) visit(c, depth + 1);
  };
  if (m) visit(m, 0);
  // Opacity: follow the active surface shader's inputs:opacity connection to an image node (e.g. decal ash / soot masks).
  let opacity = null, opacityMissing = null;
  const findSurf = (n, depth) => {
    if (!st.active(n) || opacity || opacityMissing) return;
    const id = st.str(n, 'info:id') || '';
    if (/unlit_surface|UsdPreviewSurface_surfaceshader/.test(id)) {
      const c = st.prop(n, 'inputs:opacity.connect');
      const tp = c && (c.typed ? c.targets?.[0] : (c.raw.match(/<([^>]+)>/) || [])[1]);
      if (tp) {
        const node = st.get(st.mapPath(c.o, tp).replace(/\.outputs:\w+$/, ''));
        const v = node && st.asset(node, 'inputs:file');
        if (v) { const f = resolveAsset(v.a, v.o); if (f) opacity = f; else opacityMissing = v.a; }
      }
    }
    if (depth < 3) for (const ch of st.children(n)) findSurf(ch, depth + 1);
  };
  if (m) findSurf(m, 0);
  const res = { tex: best, varname, missing, opacity, opacityMissing }; texCache.set(key, res); return res;
}
const doc = new Document(); doc.createBuffer(); const unlit = doc.createExtension(KHRMaterialsUnlit);
const scene = doc.createScene(MODE); const T = new Map(), MAT = new Map(); const report = []; let tris = 0;
const TA = new Map(); // texture -> alpha source ('file path' | 'luma' | null)
const tex = (f, alpha = null) => { const k = f + '|' + (alpha || ''); if (!T.has(k)) { T.set(k, doc.createTexture(path.basename(f) + (alpha ? '+alpha' : '')).setMimeType('image/webp').setURI(path.relative(R, f).replace(/[\/ ]/g, '__').replace(/\.\w+$/, alpha ? '_a.webp' : '.webp'))); TA.set(k, { f, alpha }); } return T.get(k); };
function material(f, kind, alpha = null) { const k = (f || 'none') + kind + (alpha || ''); if (MAT.has(k)) return MAT.get(k);
  const m = doc.createMaterial(f ? path.basename(f) : 'untextured').setExtension('KHR_materials_unlit', unlit.createUnlit());
  if (f) m.setBaseColorTexture(tex(f, alpha)); else m.setBaseColorFactor(MODE === 'night' ? [0.05, 0.04, 0.035, 1] : [0.4, 0.35, 0.3, 1]);
  if (kind === 'rafter') { m.setAlphaMode('BLEND').setDoubleSided(true); m.setExtras({ vfx: 'rafter' }); } else m.setDoubleSided(true);
  if (alpha && kind !== 'rafter') {
    const decal = alpha === 'luma' || /Decal/i.test(f || '');
    if (decal) m.setAlphaMode('BLEND'); else m.setAlphaMode('MASK').setAlphaCutoff(0.5); // banners: torn-edge cut-outs
    m.setExtras({ vfx: decal ? 'decal' : 'cutout', alphaSource: alpha === 'luma' ? 'derived-from-colour' : path.relative(R, alpha) });
  }
  MAT.set(k, m); return m; }
const SKIP = /^(_materials|Shader_Materials|enchanted_ceiling.*|Window_LightBeam|HierarchicalFade|Light_Block)$/;
function walk(n, parentM, bindParent, topName) {
  const name = n.path.split('/').pop();
  if (!st.active(n) || SKIP.test(name)) return;
  const typ = st.type(n);
  if (/Material|Shader|NodeGraph|RealityKit/.test(typ)) return;
  const M = parentM.clone().multiply(st.localMatrix(n));
  const own = st.rel(n, 'material:binding');
  const bind = own && st.get(own) ? own : bindParent;
  if (typ === 'Mesh') emit(n, M, bind, bindParent);
  for (const c of st.children(n)) walk(c, M, bind);
}
function topOf(p) { const rel = p.replace('/scope_root/' + SCENE + '/', '').split('/'); return rel[0] === 'greathallblender_bake1' ? rel[1] : rel[0]; }
const bakeDirs = [sceneDir + 'TextureBakeV1/', sceneDir, R + 'textures/'];
const listing = new Map(bakeDirs.map((d) => [d, fs.existsSync(d) ? fs.readdirSync(d) : []]));
function guessTex(names) {
  for (const d of bakeDirs) for (const nm of names) for (const ext of ['.jpg', '_COMBINED.jpg', '.png']) if (listing.get(d).includes(nm + ext)) return d + nm + ext;
  for (const nm of names) { const fam = nm.replace(/_?\d*(_\d+)?_Bak(ed|e)d?$/, ''); if (fam.length < 8) continue;
    for (const d of bakeDirs) { const f = listing.get(d).find((x) => x.startsWith(fam) && isColor(x)); if (f) return d + f; } }
  return null;
}
function emit(n, M, bind, bindParent) {
  const top = topOf(n.path);
  const P = st.arr(n, 'points'), C = st.arr(n, 'faceVertexCounts'), I = st.arr(n, 'faceVertexIndices'); if (!P || !C || !I || !P.length) return;
  let info = materialInfo(bind);
  if (!info.tex && bindParent && bindParent !== bind) { const pi = materialInfo(bindParent); if (pi.tex) info = { ...pi, varname: info.varname || pi.varname }; }
  if (!info.tex) { const g = guessTex([bind && bind.split('/').pop(), top, top.replace(/d$/, '')].filter(Boolean)); if (g) info = { ...info, tex: g, guessed: true }; }
  const cands = [info.varname, 'st', 'UVMap', 'fixUvMap', 'new_uv', 'newUV', 'st1'].filter(Boolean);
  // UV set that actually fits the 0..1 bake layout (RCP's ND_texcoord reads the first set; old Blender
  // PrimvarReader nodes in the same material can still name a tiling set, e.g. Floor4's 'st').
  const oob = (nm) => { const a = st.arr(n, 'primvars:' + nm); if (!a || !a.length) return Infinity; let lo = Infinity, hi = -Infinity; for (let q = 0; q < a.length; q++) { lo = Math.min(lo, a[q]); hi = Math.max(hi, a[q]); } return Math.max(0, -lo) + Math.max(0, hi - 1); };
  let uvName = info.varname && st.prop(n, 'primvars:' + info.varname) ? info.varname : null;
  if (uvName && oob(uvName) > 0.15) {
    const alts = []; for (const o of n.ops) for (const k of Object.keys(o.prim.props)) if (k.startsWith('primvars:') && !k.includes(':indices') && !/attenuation|emission|lightmap/i.test(k) && /texCoord2f|float2/.test(o.prim.props[k].type || '')) alts.push(k.slice(9));
    const better = alts.filter((x) => oob(x) < 0.05).sort((x, y) => oob(x) - oob(y))[0];
    if (better) uvName = better;
  }
  const spreadOf = (nm) => { const a = st.arr(n, 'primvars:' + nm); if (!a || !a.length) return Infinity; let lo = Infinity, hi = -Infinity; for (let q = 0; q < a.length; q += 7) { lo = Math.min(lo, a[q]); hi = Math.max(hi, a[q]); } return (hi - lo) + Math.max(0, -lo) + Math.max(0, hi - 1); };
  if (!uvName && st.prop(n, 'primvars:st') && spreadOf('st') < 3 && oob('st') < 0.15) uvName = 'st';
  if (!uvName) { // 'st' is a tiling set here: prefer the UV set that looks like a bake layout (stays near 0..1)
    const sets = []; const seen = new Set();
    for (const o of n.ops) for (const k of Object.keys(o.prim.props)) if (k.startsWith('primvars:') && !k.includes(':indices') && !/attenuation|emission|lightmap/i.test(k) && /texCoord2f|float2/.test(o.prim.props[k].type || '') && !seen.has(k)) { seen.add(k); sets.push(k.slice(9)); }
    let best = Infinity;
    for (const nm of sets) { const pen = spreadOf(nm); if (pen < best) { best = pen; uvName = nm; } }
  }
  if (!uvName) uvName = cands.find((c) => st.prop(n, 'primvars:' + c));
  if (!uvName) for (const o of n.ops) { const k = Object.keys(o.prim.props).find((k) => k.startsWith('primvars:') && !k.endsWith(':indices') && /texCoord2f|float2/.test(o.prim.props[k].type || '')); if (k) { uvName = k.slice(9); break; } }
  const uvP = uvName ? st.prop(n, 'primvars:' + uvName) : null; const UV = uvName ? st.arr(n, 'primvars:' + uvName) : null; const UVI = uvName ? st.arr(n, 'primvars:' + uvName + ':indices') : null;
  const fvar = uvP && (uvP.interp === 'faceVarying' || (UV && UV.length / 2 === I.length && UV.length / 2 !== P.length / 3));
  const pos = [], uv = []; const v = new THREE.Vector3(); let fv = 0;
  for (let c = 0; c < C.length; c++) { const k = C[c];
    for (let t = 1; t < k - 1; t++) for (const j of [0, t, t + 1]) { const f = fv + j, vi = I[f];
      v.set(P[vi * 3], P[vi * 3 + 1], P[vi * 3 + 2]).applyMatrix4(M); pos.push(v.x, v.y, v.z);
      if (UV) { let ui = fvar ? f : vi; if (UVI && UVI.length) ui = UVI[ui]; uv.push(UV[ui * 2], 1 - UV[ui * 2 + 1]); } else uv.push(0, 0); }
    fv += k; }
  if (!pos.length) return;
  // mirrored transforms flip winding — we render double sided, so fine
  const kind = /VFX_SM_GH_Rafters/.test(top + n.path) ? 'rafter' : 'solid';
  // Opacity maps (decals, banners…): use the wired map; if the project is missing it, derive alpha from the colour bake.
  const alpha = kind === 'rafter' ? null : info.opacity || (info.opacityMissing ? 'luma' : null);
  const mat = material(info.tex, kind, alpha);
  const prim = doc.createPrimitive().setMaterial(mat)
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uv)));
  const nm = top;
  scene.addChild(doc.createNode(nm).setMesh(doc.createMesh(nm).addPrimitive(prim)).setExtras(kind === 'rafter' ? { vfx: 'rafter' } : {}));
  tris += pos.length / 9;
  report.push([nm, n.path.replace('/scope_root/' + SCENE + '/', ''), bind ? bind.split('/').pop() : '-', (info.tex ? path.relative(R, info.tex) + (info.guessed ? ' (guessed)' : '') : 'NONE') + (alpha ? ' | alpha: ' + (alpha === 'luma' ? 'derived (missing ' + info.opacityMissing + ')' : path.relative(R, alpha)) : '') + (info.missing ? ' (missing ' + info.missing + ')' : ''), uvName || '-'].join('\t'));
}
walk(sceneNode, new THREE.Matrix4(), null, null);
let tb = 0;
for (const [k, t] of T) { const { f, alpha } = TA.get(k); const big = /Wall|Floor|floor|Ceiling|Window|Rood|Table|Fireplace|Column/.test(f); const s = big ? SZ : Math.round(SZ / 2);
  let b;
  if (!alpha) b = await sharp(f).resize(s, s, { fit: 'inside', withoutEnlargement: true }).webp({ quality: Q }).toBuffer();
  else {
    const { data: rgb, info: ii } = await sharp(f).resize(s, s, { fit: 'inside', withoutEnlargement: true }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let a;
    if (alpha === 'luma') { // fallback: black outside the decal = transparent
      a = Buffer.alloc(ii.width * ii.height);
      for (let p = 0; p < a.length; p++) { const m = Math.max(rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2]) / 255; a[p] = Math.round(255 * Math.min(1, Math.max(0, (m - 0.006) / 0.05))); }
    } else a = await sharp(alpha).resize(ii.width, ii.height, { fit: 'fill' }).greyscale().raw().toBuffer();
    const rgba = Buffer.alloc(ii.width * ii.height * 4);
    for (let p = 0; p < ii.width * ii.height; p++) { rgba[p * 4] = rgb[p * 3]; rgba[p * 4 + 1] = rgb[p * 3 + 1]; rgba[p * 4 + 2] = rgb[p * 3 + 2]; rgba[p * 4 + 3] = a[p]; }
    b = await sharp(rgba, { raw: { width: ii.width, height: ii.height, channels: 4 } }).webp({ quality: Q, alphaQuality: 90 }).toBuffer();
  }
  t.setImage(b); tb += b.length; }
fs.writeFileSync(`/tmp/build/${MODE}_map.tsv`, report.join('\n'));
console.log(MODE, 'meshes', report.length, 'tris', tris, 'textures', T.size, 'texMB', (tb / 1e6).toFixed(1), 'untextured', report.filter((r) => r.includes('NONE')).length);
await new NodeIO().registerExtensions([KHRMaterialsUnlit]).write(OUT, doc);
