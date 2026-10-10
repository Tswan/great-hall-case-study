import fs from 'fs'; import * as THREE from 'three';
import { Document, NodeIO } from '@gltf-transform/core';
import { Stage } from './compose.mjs';
const R='/sessions/relaxed-bold-ptolemy/mnt/Development/wbd-beam-rc-environments/environments/great_hall/GreatHallProject/Sources/GreatHallProject/GreatHallProject.rkassets/';
const st=new Stage(R+'Scene.usda','/scope_root');
const doc=new Document(); doc.createBuffer(); const scene=doc.createScene('ceiling');
for (const lyr of ['stars','cloud']) {
  const path=`/scope_root/enchanted_ceiling_scene_Night/enchanted_ceiling/greathall_ceiling_${lyr}/Mesh/Mesh`;
  const n=st.get(path); const parts=path.split('/').filter(Boolean); const M=new THREE.Matrix4();
  for(let i=2;i<=parts.length;i++) M.multiply(st.localMatrix(st.get('/'+parts.slice(0,i).join('/'))));
  const P=st.arr(n,'points'), C=st.arr(n,'faceVertexCounts'), I=st.arr(n,'faceVertexIndices'); const uvp=st.prop(n,'primvars:UVMap'); const UV=st.arr(n,'primvars:UVMap'); const UVI=st.arr(n,'primvars:UVMap:indices');
  const fvar = uvp.interp==='faceVarying' || UV.length/2===I.length;
  const pos=[],uv=[]; const v=new THREE.Vector3(); let fv=0;
  for(let c=0;c<C.length;c++){const k=C[c]; for(let t=1;t<k-1;t++) for(const j of [0,t,t+1]){const f=fv+j,vi=I[f]; v.set(P[vi*3],P[vi*3+1],P[vi*3+2]).applyMatrix4(M); pos.push(v.x,v.y,v.z); let ui=fvar?f:vi; if(UVI&&UVI.length) ui=UVI[ui]; uv.push(UV[ui*2],1-UV[ui*2+1]);} fv+=k;}
  const prim=doc.createPrimitive().setAttribute('POSITION',doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos))).setAttribute('TEXCOORD_0',doc.createAccessor().setType('VEC2').setArray(new Float32Array(uv)));
  scene.addChild(doc.createNode('ceiling_'+lyr).setMesh(doc.createMesh('ceiling_'+lyr).addPrimitive(prim)));
  let lo=[9,9],hi=[-9,-9]; for(let i=0;i<uv.length;i+=2) for(const k of [0,1]){lo[k]=Math.min(lo[k],uv[i+k]);hi[k]=Math.max(hi[k],uv[i+k]);} console.log(lyr,'tris',pos.length/9,'uv',lo,hi, 'interp',uvp.interp);
}
await new NodeIO().write(process.argv[2],doc);
