import fs from 'fs'; import path from 'path';
import * as THREE from 'three';
import { USDCParser } from 'three/examples/jsm/loaders/usd/USDCParser.js';
import { parseUSDA, nums } from './usda.mjs';

const layerCache = new Map();
export function loadLayer(file) {
  if (layerCache.has(file)) return layerCache.get(file);
  let L;
  if (file.endsWith('.usda')) {
    const root = parseUSDA(fs.readFileSync(file, 'utf8'));
    L = { file, dir: path.dirname(file), kind: 'usda', root, defaultPrim: root.layerMeta.defaultPrim };
  } else if (file.endsWith('.usdc')) {
    const b = fs.readFileSync(file);
    const S = new USDCParser().parseData(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)).specsByPath;
    const root = { name: '', meta: {}, props: {}, children: new Map() };
    const get = (p) => { if (p === '/') return root; const parts = p.split('/').filter(Boolean); let cur = root;
      for (const x of parts) { if (!cur.children.has(x)) cur.children.set(x, { name: x, meta: {}, props: {}, children: new Map() }); cur = cur.children.get(x); } return cur; };
    for (const [k, spec] of Object.entries(S)) {
      const dot = k.lastIndexOf('.'), slash = k.lastIndexOf('/');
      if (dot > slash) { // property
        const pr = get(k.slice(0, dot)); const f = spec.fields || {};
        let value = f.default; if ((value === undefined || value === 0) && f.timeSamples) value = f.timeSamples.values?.[0] ?? value;
        pr.props[k.slice(dot + 1)] = { typed: true, type: f.typeName, value, targets: f.targetPaths || f.connectionPaths, interp: f.interpolation || null };
      } else { const pr = get(k); const f = spec.fields || {}; pr.type = f.typeName || ''; if (f.active !== undefined) pr.meta.active = f.active; }
    }
    L = { file, dir: path.dirname(file), kind: 'usdc', root, defaultPrim: (S['/']?.fields?.defaultPrim) || [...root.children.keys()][0] };
  } else throw new Error('unsupported ' + file);
  layerCache.set(file, L); return L;
}
const primAt = (L, p) => { let cur = L.root; for (const x of p.split('/').filter(Boolean)) { cur = cur.children.get(x); if (!cur) return null; } return cur; };

// Composed node: opinions strongest→weakest, each {prim, L, from, to}
export class Stage {
  constructor(rootFile, rootPrimPath) {
    const L = loadLayer(rootFile);
    this.root = this.node(rootPrimPath, [{ prim: primAt(L, rootPrimPath), L, from: rootPrimPath, to: rootPrimPath }]);
    this.cache = new Map([[rootPrimPath, this.root]]);
    this.rootPath = rootPrimPath;
  }
  expand(ops) { // add references (weaker) recursively
    const out = [...ops];
    for (let k = 0; k < out.length; k++) {
      const o = out[k]; const refs = o.prim.meta?.refs; if (!refs) continue;
      for (const r of refs) {
        if (!r.asset) continue;
        const f = path.resolve(o.L.dir, r.asset); if (!fs.existsSync(f)) { console.warn('missing ref', f); continue; }
        const RL = loadLayer(f); const src = r.path || '/' + RL.defaultPrim; const p = primAt(RL, src);
        if (p) out.push({ prim: p, L: RL, from: src, to: o.to });
      }
    }
    return out;
  }
  node(p, ops) { return { path: p, ops: this.expand(ops.filter((o) => o.prim)), _kids: null }; }
  children(n) {
    if (n._kids) return n._kids;
    const names = []; const seen = new Set();
    for (const o of n.ops) for (const k of o.prim.children.keys()) if (!seen.has(k)) { seen.add(k); names.push(k); }
    n._kids = names.map((k) => {
      const p = n.path + '/' + k;
      if (this.cache.has(p)) return this.cache.get(p);
      const c = this.node(p, n.ops.map((o) => ({ prim: o.prim.children.get(k), L: o.L, from: o.from + (o.from.endsWith('/') ? '' : '/') + k, to: p })));
      this.cache.set(p, c); return c;
    });
    return n._kids;
  }
  get(p) { if (this.cache.has(p)) return this.cache.get(p); if (!p.startsWith(this.rootPath)) return null;
    let cur = this.root; for (const x of p.slice(this.rootPath.length).split('/').filter(Boolean)) { cur = this.children(cur).find((c) => c.path.endsWith('/' + x)); if (!cur) return null; } return cur; }
  prop(n, name) { for (const o of n.ops) { const v = o.prim.props[name]; if (v !== undefined) return { ...v, o }; } return null; }
  active(n) { for (const o of n.ops) if (o.prim.meta?.active !== undefined) return o.prim.meta.active; return true; }
  type(n) { for (const o of n.ops) if (o.prim.type) return o.prim.type; return ''; }
  mapPath(o, p) { // remap an authored path from opinion's layer namespace into the stage
    if (p.startsWith(o.from)) return o.to + p.slice(o.from.length);
    // path authored relative to the layer's own root (e.g. /scope_root/... inside a referenced file)
    const lroot = '/' + o.L.defaultPrim; const anc = this.ancestorFor(o); if (anc && p.startsWith(lroot)) return anc + p.slice(lroot.length);
    return p;
  }
  ancestorFor(o) { // composed path where this layer's defaultPrim is mounted
    const rel = o.from.slice(('/' + o.L.defaultPrim).length); return rel ? o.to.slice(0, o.to.length - rel.length) : o.to; }
  rel(n, name) {
    const v = this.prop(n, name); if (!v) return null;
    if (v.typed) { const t = v.targets?.[0]; return t ? this.mapPath(v.o, t) : null; }
    const m = v.raw && v.raw.match(/<([^>]+)>/); return m ? this.mapPath(v.o, m[1]) : null;
  }
  localMatrix(n) {
    const M = new THREE.Matrix4();
    const ord = this.prop(n, 'xformOpOrder'); if (!ord) return M;
    let order = ord.typed ? ord.value : (ord.raw.match(/"([^"]+)"/g) || []).map((s) => s.slice(1, -1));
    if (!Array.isArray(order)) order = [];
    for (const opName of order) {
      if (opName.startsWith('!')) continue;
      const v = this.prop(n, opName); if (!v) continue;
      const a = v.typed ? Array.from(v.value || []) : nums(v.raw);
      const T = new THREE.Matrix4(); const base = opName.split(':')[1];
      if (base === 'translate') T.makeTranslation(a[0], a[1], a[2]);
      else if (base === 'scale') T.makeScale(a[0], a[1], a[2]);
      else if (base === 'orient') T.makeRotationFromQuaternion(new THREE.Quaternion(a[1], a[2], a[3], a[0]));
      else if (base === 'transform') T.fromArray(a);
      else if (base === 'rotateXYZ') T.makeRotationFromEuler(new THREE.Euler(...a.map(THREE.MathUtils.degToRad), 'ZYX'));
      else if (base === 'rotateX') T.makeRotationX(THREE.MathUtils.degToRad(a[0]));
      else if (base === 'rotateY') T.makeRotationY(THREE.MathUtils.degToRad(a[0]));
      else if (base === 'rotateZ') T.makeRotationZ(THREE.MathUtils.degToRad(a[0]));
      else continue;
      M.multiply(T);
    }
    return M;
  }
  arr(n, name) { const v = this.prop(n, name); if (!v) return null; if (v.typed) return v.value && v.value.length !== undefined && typeof v.value !== 'string' ? v.value : null; return v.raw ? nums(v.raw) : null; }
  str(n, name) { const v = this.prop(n, name); if (!v) return null; if (v.typed) return typeof v.value === 'string' ? v.value : null; const m = v.raw && v.raw.match(/"([^"]*)"/); return m ? m[1] : v.raw; }
  asset(n, name) { const v = this.prop(n, name); if (!v) return null; let a = v.typed ? v.value : (v.raw && (v.raw.match(/@([^@]*)@/) || [])[1]); if (!a || typeof a !== 'string') return null; return { a, o: v.o }; }
}
