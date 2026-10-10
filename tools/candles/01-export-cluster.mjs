import * as THREE from 'three'; import fs from 'fs';
import { Stage } from './compose.mjs';
const R='/sessions/relaxed-bold-ptolemy/mnt/Development/wbd-beam-rc-environments/environments/great_hall/GreatHallProject/Sources/GreatHallProject/GreatHallProject.rkassets/';
const st=new Stage(R+'Scene.usda','/scope_root');
const mp='/scope_root/Common/candles/candles_cluster/candle1_001/Mesh';
const n=st.get(mp); const parts=mp.split('/').filter(Boolean); const M=new THREE.Matrix4();
for(let i=2;i<=parts.length;i++) M.multiply(st.localMatrix(st.get('/'+parts.slice(0,i).join('/'))));
const P=st.arr(n,'points'), I=st.arr(n,'faceVertexIndices'), UV=st.arr(n,'primvars:st');
const out=new Float32Array(P.length); const v=new THREE.Vector3();
for(let i=0;i<P.length;i+=3){ v.set(P[i],P[i+1],P[i+2]).applyMatrix4(M); out[i]=v.x; out[i+1]=v.y; out[i+2]=v.z; }
fs.writeFileSync('/tmp/build/cand_pts.bin', Buffer.from(out.buffer));
fs.writeFileSync('/tmp/build/cand_idx.bin', Buffer.from(new Int32Array(I).buffer));
fs.writeFileSync('/tmp/build/cand_uv.bin', Buffer.from(new Float32Array(UV).buffer));
const subs={}; for(const c of st.children(n)){ const nm=c.path.split('/').pop(); subs[nm]=Array.from(st.arr(c,'indices')); }
fs.writeFileSync('/tmp/build/cand_subsets.json', JSON.stringify(subs));
console.log('pts',P.length/3,'faces',I.length/3, 'world matrix', M.elements.map(x=>+x.toFixed(4)).join(','));
// day cluster transform too
const mp2='/scope_root/Common/candles/candles_cluster_day/candle1_001/Mesh'; const parts2=mp2.split('/').filter(Boolean); const M2=new THREE.Matrix4(); for(let i=2;i<=parts2.length;i++) M2.multiply(st.localMatrix(st.get('/'+parts2.slice(0,i).join('/')))); console.log('day matrix', M2.elements.map(x=>+x.toFixed(4)).join(','));
// materials
for (const m of ['SM_Skinny_Candle_1_SM_Candle5_initialShadingGroup1','SM_Candle3_initialShadingGroup1','SM_Skinny_Candle_4_initialShadingGroup1','fire_001','fire_002','fire_003']) for (const c of ['candles_cluster','candles_cluster_day']) {
  const mm=st.get(`/scope_root/Common/candles/${c}/_materials/${m}`); const files=[];
  const walk=(x,d)=>{ for(const pn of ['inputs:file','inputs:Image']){ const a=st.asset(x,pn); if(a) files.push(x.path.split('/').pop()+':'+a.a); } const ec=st.prop(x,'inputs:emissiveColor'); if(ec&&!ec.typed) files.push('emis='+ec.raw); const dc=st.prop(x,'inputs:diffuseColor'); if(dc&&!dc.typed&&dc.raw) files.push('diff='+dc.raw); if(d<3) for(const ch of st.children(x)) walk(ch,d+1); };
  if(mm) walk(mm,0); console.log(c, m, files.join(' | '));
}
// mesh-level binding overrides
for (const c of ['candles_cluster','candles_cluster_day']) for (const sub of Object.keys(subs)) { const sn=st.get(`/scope_root/Common/candles/${c}/candle1_001/Mesh/${sub}`); console.log(c, sub, '->', sn && st.rel(sn,'material:binding')); }
