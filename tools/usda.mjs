// Minimal USDA parser -> prim tree {name, spec, type, meta, props:{name:raw}, children:Map}
export function parseUSDA(text) {
  let i = 0; const n = text.length;
  const ws = () => { for (;;) { while (i < n && /\s/.test(text[i])) i++; if (text[i] === '#') { while (i < n && text[i] !== '\n') i++; continue; } break; } };
  function balanced(open, close) { // text[i]===open
    let d = 0; const s = i;
    while (i < n) {
      const c = text[i];
      if (c === '"') { if (text.startsWith('"""', i)) { i = text.indexOf('"""', i + 3) + 3; continue; } i++; while (i < n && text[i] !== '"') { if (text[i] === '\\') i++; i++; } i++; continue; }
      if (c === "'") { i++; while (i < n && text[i] !== "'") { if (text[i] === '\\') i++; i++; } i++; continue; }
      if (c === '@') { i++; while (i < n && text[i] !== '@') i++; i++; continue; }
      if (c === open) d++; else if (c === close) { d--; if (d === 0) { i++; return text.slice(s, i); } }
      i++;
    }
    return text.slice(s);
  }
  function statement() { // read until newline at depth 0 (with trailing ( meta ) allowed)
    const s = i; let d = 0;
    while (i < n) {
      const c = text[i];
      if (c === '"' || c === "'" || c === '@') { // reuse balanced-ish skipping
        if (c === '"' && text.startsWith('"""', i)) { i = text.indexOf('"""', i + 3) + 3; continue; }
        const q = c; i++; while (i < n && text[i] !== q) { if (text[i] === '\\' && q !== '@') i++; i++; } i++; continue;
      }
      if (c === '(' || c === '[' || c === '{') d++;
      else if (c === ')' || c === ']' || c === '}') { if (d === 0) break; d--; }
      else if (c === '\n' && d === 0) {
        let j = i; while (j < n && /\s/.test(text[j])) j++;
        if (text[j] === '(') { i = j; continue; }
        break;
      }
      i++;
    }
    return text.slice(s, i).trim();
  }
  function prim(spec, type, name) { return { name, spec, type, meta: {}, props: {}, children: new Map(), variants: [] }; }
  function parseMeta(raw, p) {
    const m = raw.match(/\bactive\s*=\s*(true|false)/); if (m) p.meta.active = m[1] === 'true';
    const r = raw.match(/(?:^|\n|\s)(?:prepend |append )?references\s*=\s*(\[[\s\S]*?\]|@[^@]*@(?:<[^>]*>)?)/);
    if (r) p.meta.refs = [...r[1].matchAll(/@([^@]*)@(?:<([^>]*)>)?/g)].map((x) => ({ asset: x[1], path: x[2] || null }));
    const k = raw.match(/\bkind\s*=\s*"(\w+)"/); if (k) p.meta.kind = k[1];
  }
  function body(p) {
    for (;;) {
      ws(); if (i >= n) return; if (text[i] === '}') { i++; return; }
      const head = text.slice(i, i + 200);
      let m = head.match(/^(def|over|class)\s+(?:([\w:]+)\s+)?"([^"]*)"/);
      if (m) {
        i += m[0].length; const c = prim(m[1], m[2] || '', m[3]); ws();
        if (text[i] === '(') parseMeta(balanced('(', ')'), c);
        ws(); if (text[i] === '{') { i++; body(c); }
        const ex = p.children.get(c.name); if (ex) { Object.assign(ex.props, c.props); for (const [k, v] of c.children) ex.children.set(k, v); } else p.children.set(c.name, c);
        continue;
      }
      m = head.match(/^variantSet\s+"([^"]*)"\s*=\s*/);
      if (m) { i += m[0].length; ws(); const blk = balanced('{', '}'); p.variants.push({ set: m[1], raw: blk }); continue; }
      const st = statement(); if (!st) { i++; continue; }
      if (/^(reorder|rel\s+[\w:]+\s*$)/.test(st)) { if (st.startsWith('rel')) { const mm = st.match(/^rel\s+([\w:.]+)/); p.props[mm[1]] = null; } continue; }
      // property
      const pm = st.match(/^(?:(?:custom|uniform|prepend|append|delete|add|varying|config)\s+)*(rel\s+|[\w\[\]]+\s+)?([\w:.]+)(\.connect|\.timeSamples)?\s*(?:=\s*([\s\S]*))?$/);
      if (pm) {
        let val = pm[4], meta = null; if (val === undefined) val = null; else {
          const mi = topLevelParen(val); if (mi >= 0) { meta = val.slice(mi); val = val.slice(0, mi).trim(); }
        }
        const key = pm[2] + (pm[3] || '');
        const interp = meta && meta.match(/interpolation\s*=\s*"(\w+)"/);
        p.props[key] = { type: (pm[1] || '').trim(), raw: val, interp: interp ? interp[1] : null };
      }
    }
  }
  function topLevelParen(v) { // index of a trailing metadata '(' at depth 0 after the value
    let d = 0, q = null;
    for (let k = 0; k < v.length; k++) { const c = v[k];
      if (q) { if (c === q) q = null; continue; } if (c === '"' || c === '@') { q = c; continue; }
      if (c === '[' || c === '{') d++; else if (c === ']' || c === '}') d--;
      else if (c === '(' && d === 0) { const before = v.slice(0, k).trim(); if (before.length && /[\]\}@"\w>)]$/.test(before) && !/^\(/.test(v.trim())) return k; d++; }
      else if (c === '(') d++; else if (c === ')') d--; }
    return -1;
  }
  // header
  ws(); const hm = text.slice(i, i + 20).match(/^#usda[^\n]*/); if (hm) i += hm[0].length;
  const root = prim('def', '', ''); root.layerMeta = {};
  ws(); if (text[i] === '(') { const raw = balanced('(', ')'); const dp = raw.match(/defaultPrim\s*=\s*"([^"]+)"/); if (dp) root.layerMeta.defaultPrim = dp[1]; const up = raw.match(/upAxis\s*=\s*"(\w)"/); if (up) root.layerMeta.upAxis = up[1]; }
  body(root);
  return root;
}
export const nums = (raw) => (raw ? (raw.match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?|-?inf|nan/gi) || []).map(Number) : []);
