import numpy as np, json
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
P=np.fromfile('/tmp/build/cand_pts.bin',dtype=np.float32).reshape(-1,3)
I=np.fromfile('/tmp/build/cand_idx.bin',dtype=np.int32).reshape(-1,3)
UV=np.fromfile('/tmp/build/cand_uv.bin',dtype=np.float32).reshape(-1,3,2)
subs=json.load(open('/tmp/build/cand_subsets.json'))
names=list(subs.keys()); fsub=np.full(len(I),-1)
for i,n in enumerate(names): fsub[np.array(subs[n])]=i
print('faces',len(I),'unassigned',(fsub<0).sum())
nv=len(P)
A=coo_matrix((np.ones(len(I)*2),(np.r_[I[:,0],I[:,1]],np.r_[I[:,1],I[:,2]])),shape=(nv,nv))
nc,lab=connected_components(A,directed=False)
print('components',nc)
flab=lab[I[:,0]]
# per component stats
order=np.argsort(flab,kind='stable'); fl=flab[order]
starts=np.r_[0,np.flatnonzero(np.diff(fl))+1,len(fl)]
vcount=np.bincount(lab,minlength=nc)
groups={}
for c in range(nc):
    fs=order[starts[c]:starts[c+1]]
    if len(fs)==0: continue
    s=fsub[fs[0]]
    key=(names[s],int(vcount[c]),len(fs))
    groups.setdefault(key,[]).append(c)
for k,v in sorted(groups.items(),key=lambda kv:-len(kv[1]))[:20]: print(k,len(v))
print('groups',len(groups))
np.save('/tmp/build/cand_lab.npy',lab); np.save('/tmp/build/cand_fsub.npy',fsub)
