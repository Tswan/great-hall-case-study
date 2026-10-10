import fs from 'fs';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshGPUInstancing, ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
await MeshoptEncoder.ready;
const J=JSON.parse(fs.readFileSync('/tmp/build/candles.json'));
const doc=new Document(); doc.createBuffer(); const inst=doc.createExtension(EXTMeshGPUInstancing).setRequired(true);
const scene=doc.createScene('candles');
for (const sh of J.shapes) {
  const P=sh.positions, c=[0,1,2].map(k=>P.reduce((a,p)=>a+p[k],0)/P.length);
  const rot=(q,v)=>{const [x,y,z,w]=q; const ix=w*v[0]+y*v[2]-z*v[1], iy=w*v[1]+z*v[0]-x*v[2], iz=w*v[2]+x*v[1]-y*v[0], iw=-x*v[0]-y*v[1]-z*v[2];
    return [ix*w+iw*-x+iy*-z-iz*-y, iy*w+iw*-y+iz*-x-ix*-z, iz*w+iw*-z+ix*-y-iy*-x];};
  sh.t=sh.t.map((t,i)=>{const r=rot(sh.q[i],c); return [t[0]+sh.s[i]*r[0],t[1]+sh.s[i]*r[1],t[2]+sh.s[i]*r[2]];});
  sh.positions=P.map(p=>[p[0]-c[0],p[1]-c[1],p[2]-c[2]]);
  const ts=sh.t; console.log('centers min',[0,1,2].map(k=>Math.min(...ts.map(t=>t[k])).toFixed(2)),'max',[0,1,2].map(k=>Math.max(...ts.map(t=>t[k])).toFixed(2)));
  const pos=[],uv=[];
  sh.tris.forEach((t,fi)=>t.forEach((vi,k)=>{ pos.push(...sh.positions[vi]); uv.push(sh.uv[fi][k][0], 1-sh.uv[fi][k][1]); }));
  const prim=doc.createPrimitive().setAttribute('POSITION',doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos))).setAttribute('TEXCOORD_0',doc.createAccessor().setType('VEC2').setArray(new Float32Array(uv)));
  prim.setMaterial(doc.createMaterial(sh.flame?'candle_flame':'candle_body').setExtras({role: sh.flame?'flame':'body'}));
  const mesh=doc.createMesh(`candle_${sh.flame?'flame':'body_'+sh.size}`).addPrimitive(prim);
  const n=sh.t.length;
  const batch=inst.createInstancedMesh()
    .setAttribute('TRANSLATION',doc.createAccessor().setType('VEC3').setArray(new Float32Array(sh.t.flat())))
    .setAttribute('ROTATION',doc.createAccessor().setType('VEC4').setArray(new Float32Array(sh.q.flat())))
    .setAttribute('SCALE',doc.createAccessor().setType('VEC3').setArray(new Float32Array(sh.s.flatMap(s=>[s,s,s]))));
  scene.addChild(doc.createNode(mesh.getName()).setMesh(mesh).setExtension('EXT_mesh_gpu_instancing',batch).setExtras({role: sh.flame?'flame':'body', count:n}));
  console.log(mesh.getName(), 'instances', n, 'tris', sh.tris.length);
}
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder':MeshoptEncoder,'meshopt.decoder':MeshoptDecoder});
await doc.transform(weld());
await io.write('/tmp/build/candles_plain.glb',doc);
//await doc.transform(meshopt({encoder:MeshoptEncoder, level:'medium'}));
//await io.write('/sessions/relaxed-bold-ptolemy/mnt/Development/great-hall-case-study/assets/model/candles.glb',doc);
