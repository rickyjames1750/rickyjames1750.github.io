import { Quaternion, Vector3 } from 'three';

const caches=new WeakMap();
function cacheFor(car) {
  const wheels=car.userData?.wheels,centers=car.userData?.wheelCenters;
  if(!wheels?.length||wheels.length!==centers?.length)throw new TypeError('Vehicle grounding requires wheels and measured base wheel centers.');
  let cache=caches.get(car);
  if(!cache||cache.wheels!==wheels){
    cache={wheels,centers:centers.map(p=>new Vector3(p.x,p.y,p.z)),offsets:centers.map(()=>new Vector3()),heights:new Float64Array(wheels.length),
      xs:new Float64Array(wheels.length),zs:new Float64Array(wheels.length),q:new Quaternion(),right:new Vector3(),up:new Vector3(),point:new Vector3()};
    caches.set(car,cache);
  }
  return cache;
}
function plane(cache,sampleHeight,car,scale,yaw,rotated) {
  const c=Math.cos(yaw),s=Math.sin(yaw),n=cache.centers.length;
  let mx=0,mz=0,my=0;
  for(let i=0;i<n;i++) {
    const p=cache.offsets[i].copy(cache.centers[i]);
    if(rotated)p.applyQuaternion(cache.q).multiplyScalar(scale);
    else {const x=p.x*scale,z=p.z*scale;p.set(c*x+s*z,p.y*scale,-s*x+c*z);}
    const y=sampleHeight(car.position.x+p.x,car.position.z+p.z);
    if(!Number.isFinite(y))throw new TypeError('The vehicle surface sampler must return a finite height.');
    const x=c*p.x-s*p.z,z=s*p.x+c*p.z;cache.xs[i]=x;cache.zs[i]=z;cache.heights[i]=y;mx+=x;mz+=z;my+=y;
  }
  mx/=n;mz/=n;my/=n;
  let xx=0,zz=0,xz=0,xy=0,zy=0;
  for(let i=0;i<n;i++){const x=cache.xs[i]-mx,z=cache.zs[i]-mz,y=cache.heights[i]-my;xx+=x*x;zz+=z*z;xz+=x*z;xy+=x*y;zy+=z*y;}
  const determinant=xx*zz-xz*xz;
  return Math.abs(determinant)>1e-10?{right:(xy*zz-zy*xz)/determinant,forward:(zy*xx-xy*xz)/determinant}:{right:0,forward:0};
}

/** Fit the body to its four supporting tire contacts without changing wheel spin.
 * Coordinates and support heights are world-space; the model uses local +Z forward.
 * Analytic support treats each tire as a cylinder, avoiding a per-frame vertex scan.
 */
export function groundVehicle(car,{scale=car.scale.y,sampleHeight,yaw=car.rotation.y,clearance=.006}={}) {
  if(typeof sampleHeight!=='function'||!Number.isFinite(scale)||scale<=0)throw new TypeError('Grounding requires a surface sampler and positive uniform model scale.');
  const cache=cacheFor(car),n=cache.wheels.length;
  // Start from the yaw-only footprint, then refit at the genuinely tilted contact XZs.
  let slopes=plane(cache,sampleHeight,car,scale,yaw,false),pitch=0,roll=0;
  for(let iteration=0;iteration<2;iteration++){
    pitch=-Math.atan(slopes.forward);roll=Math.atan(slopes.right*Math.cos(pitch));
    car.rotation.set(pitch,yaw,roll,'YXZ');cache.q.copy(car.quaternion);
    slopes=plane(cache,sampleHeight,car,scale,yaw,true);
  }
  pitch=-Math.atan(slopes.forward);roll=Math.atan(slopes.right*Math.cos(pitch));
  car.rotation.set(pitch,yaw,roll,'YXZ');cache.q.copy(car.quaternion);
  cache.right.set(1,0,0).applyQuaternion(cache.q);cache.up.set(0,1,0).applyQuaternion(cache.q);
  const radius=car.userData.wheelRadius||.445,halfWidth=.14;
  const verticalSupport=radius*scale*Math.sqrt(Math.max(0,1-cache.right.y**2))+halfWidth*scale*Math.abs(cache.right.y);
  const upY=Math.max(.05,cache.up.y);
  // On an incline, the surface under the tire's rim is higher than the sample below
  // its center. Plane-normal support supplies the small additional conservative lift.
  const support=Math.max(verticalSupport,radius*scale/upY);
  let rootY=0;
  for(let i=0;i<n;i++){
    const p=cache.offsets[i].copy(cache.centers[i]).applyQuaternion(cache.q).multiplyScalar(scale);
    const height=sampleHeight(car.position.x+p.x,car.position.z+p.z);cache.heights[i]=height;
    rootY+=height+support-p.y+clearance;
    cache.wheels[i].position.y=cache.centers[i].y;
  }
  car.position.y=rootY/n;
  // Suspension corrections move along body up, which slightly changes the sampled world XZ.
  for(let iteration=0;iteration<2;iteration++)for(let i=0;i<n;i++){
    const wheel=cache.wheels[i],p=cache.point.copy(cache.centers[i]);p.y=wheel.position.y;p.applyQuaternion(cache.q).multiplyScalar(scale);
    const height=sampleHeight(car.position.x+p.x,car.position.z+p.z);
    const residual=height+support+clearance-(car.position.y+p.y);
    wheel.position.y+=residual/(scale*upY);
  }
  let minClearance=Infinity,maxSuspension=0;
  for(let i=0;i<n;i++){
    const wheel=cache.wheels[i],p=cache.point.copy(cache.centers[i]);p.y=wheel.position.y;p.applyQuaternion(cache.q).multiplyScalar(scale);
    const height=sampleHeight(car.position.x+p.x,car.position.z+p.z);
    minClearance=Math.min(minClearance,car.position.y+p.y-support-height);
    maxSuspension=Math.max(maxSuspension,Math.abs(wheel.position.y-cache.centers[i].y));
  }
  // A discontinuous curb can change level on the last XZ refinement. A final body lift is
  // conservative and keeps every tire above that visible surface rather than clipping it.
  if(minClearance<clearance){const lift=clearance-minClearance;car.position.y+=lift;minClearance+=lift;}
  return {minClearance,pitch,roll,maxSuspension};
}
