import { CatmullRomCurve3, Vector3 } from 'three';
import { SURFACES } from './surfaces.js';
import { resolveDrivingAlignment } from './corridors.js';

export function nearestCurveParameter(point, curve, samples = 600) {
  let best = 0, distance = Infinity;
  for (let i = 0; i <= samples; i++) {
    const p = curve.getPointAt(i / samples), d = (p.x - point.x) ** 2 + (p.z - point.z) ** 2;
    if (d < distance) { distance = d; best = i / samples; }
  }
  return best;
}

/** A continuous scenic road with complete road/sidewalk/rail reservations. */
export function createDrivingCurve(railCurve, colliders = [], options = {}) {
  return resolveDrivingAlignment(railCurve, colliders, options);
}

/** Arc-length frame with tangent extension: carriages do not collapse together at track endpoints. */
export function curveFrame(curve, t, offset = 0) {
  const length = curve.getLength(), u = t + offset / length, clamped = Math.max(0, Math.min(1, u));
  const point = curve.getPointAt(clamped), tangent = curve.getTangentAt(clamped).normalize();
  if (u !== clamped) point.addScaledVector(tangent, (u - clamped) * length);
  return { point, tangent };
}

/** Short connector path used when a visitor asks for guidance after free driving. */
export function planGroundPath(start, end, {colliders = [], isOnLand = () => true, clearance = .85, cellSize = .8} = {}) {
  const clear = p => isOnLand(p.x,p.z) && !colliders.some(b => Math.hypot(p.x-b.x,p.z-b.z) < b.r+clearance);
  const segmentClear = (a,b) => {
    const count=Math.max(1,Math.ceil(Math.hypot(a.x-b.x,a.z-b.z)/.35));
    for(let i=0;i<=count;i++){const t=i/count;if(!clear({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t}))return false;}
    return true;
  };
  if(segmentClear(start,end))return [end.clone()];
  const pad=12,minX=Math.min(start.x,end.x)-pad,minZ=Math.min(start.z,end.z)-pad;
  const maxX=Math.max(start.x,end.x)+pad,maxZ=Math.max(start.z,end.z)+pad;
  const cell=p=>({x:Math.round((p.x-minX)/cellSize),z:Math.round((p.z-minZ)/cellSize)});
  const point=n=>new Vector3(minX+n.x*cellSize,SURFACES.road,minZ+n.z*cellSize);
  const first=cell(start),goal=cell(end),key=n=>`${n.x},${n.z}`;
  const open=[{...first,g:0,f:0}],scores=new Map([[key(first),0]]),parents=new Map();let found=null;
  for(let iter=0;open.length&&iter<9000;iter++){
    let best=0;for(let i=1;i<open.length;i++)if(open[i].f<open[best].f)best=i;
    const current=open.splice(best,1)[0];
    if(Math.abs(current.x-goal.x)<=1&&Math.abs(current.z-goal.z)<=1&&segmentClear(point(current),end)){found=current;break;}
    for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){
      const next={x:current.x+dx,z:current.z+dz},p=point(next),id=key(next),g=current.g+Math.hypot(dx,dz);
      if(p.x<minX||p.x>maxX||p.z<minZ||p.z>maxZ||g>=(scores.get(id)??Infinity)||!segmentClear(point(current),p))continue;
      scores.set(id,g);parents.set(id,current);next.g=g;next.f=g+Math.hypot(next.x-goal.x,next.z-goal.z);open.push(next);
    }
  }
  if(!found)return []; // Refuse a path through architecture instead of teleporting through it.
  const route=[end.clone()];let cursor=found;while(cursor){route.unshift(point(cursor));cursor=parents.get(key(cursor));}
  const simplified=[];let anchor=start;
  for(let i=0;i<route.length;){let far=i;while(far+1<route.length&&segmentClear(anchor,route[far+1]))far++;simplified.push(route[far]);anchor=route[far];i=far+1;}
  return simplified;
}
