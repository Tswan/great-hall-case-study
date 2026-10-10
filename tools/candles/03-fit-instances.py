import numpy as np, json
P=np.fromfile('/tmp/build/cand_pts.bin',dtype=np.float32).reshape(-1,3).astype(np.float64)
I=np.fromfile('/tmp/build/cand_idx.bin',dtype=np.int32).reshape(-1,3)
UV=np.fromfile('/tmp/build/cand_uv.bin',dtype=np.float32).reshape(-1,3,2)
lab=np.load('/tmp/build/cand_lab.npy'); fsub=np.load('/tmp/build/cand_fsub.npy'); names=list(json.load(open('/tmp/build/cand_subsets.json')))
isfire=np.array([s>=0 and names[s].startswith('fire') for s in fsub])
flab=lab[I[:,0]]
vorder=np.argsort(lab,kind='stable'); vs=np.r_[0,np.flatnonzero(np.diff(lab[vorder]))+1,len(lab)]
forder=np.argsort(flab,kind='stable'); fs_=np.r_[0,np.flatnonzero(np.diff(flab[forder]))+1,len(flab)]
cnt=np.bincount(lab)
def sim(A,B):
    ma,mb=A.mean(0),B.mean(0); A0,B0=A-ma,B-mb
    U,S,Vt=np.linalg.svd(A0.T@B0); d=np.sign(np.linalg.det(Vt.T@U.T)); D=np.diag([1,1,d])
    R=Vt.T@D@U.T; s=(S*np.diag(D)).sum()/(A0**2).sum(); t=mb-s*R@ma
    return s,R,t,np.abs(s*(R@A.T).T+t-B).max()
def quat(R):
    m=R; tr=m.trace()
    if tr>0: S=np.sqrt(tr+1)*2; w=0.25*S; x=(m[2,1]-m[1,2])/S; y=(m[0,2]-m[2,0])/S; z=(m[1,0]-m[0,1])/S
    elif m[0,0]>m[1,1] and m[0,0]>m[2,2]: S=np.sqrt(1+m[0,0]-m[1,1]-m[2,2])*2; w=(m[2,1]-m[1,2])/S; x=0.25*S; y=(m[0,1]+m[1,0])/S; z=(m[0,2]+m[2,0])/S
    elif m[1,1]>m[2,2]: S=np.sqrt(1+m[1,1]-m[0,0]-m[2,2])*2; w=(m[0,2]-m[2,0])/S; x=(m[0,1]+m[1,0])/S; y=0.25*S; z=(m[1,2]+m[2,1])/S
    else: S=np.sqrt(1+m[2,2]-m[0,0]-m[1,1])*2; w=(m[1,0]-m[0,1])/S; x=(m[0,2]+m[2,0])/S; y=(m[1,2]+m[2,1])/S; z=0.25*S
    return [x,y,z,w]
out={'shapes':[]}; maxerr=0
for size in [183,202,205,25]:
    comps=np.flatnonzero(cnt==size); p=comps[0]
    pv=vorder[vs[p]:vs[p+1]]; pf=forder[fs_[p]:fs_[p+1]]
    remap={int(g):i for i,g in enumerate(pv)}
    # role per local face: fire if majority of instances mark it fire
    firevotes=np.zeros(len(pf))
    T=[];Rq=[];Sc=[]
    for c in comps:
        v=vorder[vs[c]:vs[c+1]]; f=forder[fs_[c]:fs_[c+1]]
        s,R,t,e=sim(P[pv],P[v]); maxerr=max(maxerr,e)
        T.append(t.tolist()); Rq.append(quat(R)); Sc.append(float(s))
        firevotes+=isfire[f]
    fireface=(firevotes/len(comps))>0.5 if size!=25 else np.ones(len(pf),bool)
    tri=np.vectorize(remap.get)(I[pf])
    out['shapes'].append({'size':size,'flame':size==25,'positions':P[pv].round(5).tolist(),'tris':tri.tolist(),'uv':UV[pf].round(5).tolist(),'fireFace':fireface.astype(int).tolist(),
        't':np.round(T,5).tolist(),'q':np.round(Rq,6).tolist(),'s':np.round(Sc,5).tolist()})
    print(size,len(comps),'fire faces in proto',int(fireface.sum()),'/',len(pf))
print('max fit error (m)',round(maxerr,4))
json.dump(out,open('/tmp/build/candles.json','w'))
