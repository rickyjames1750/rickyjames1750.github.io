import { CatmullRomCurve3, Vector3 } from 'three';
import { SURFACES } from './surfaces.js';

/** Shared horizontal reservation envelopes, in world units. */
export const CORRIDORS = Object.freeze({
  roadPavementHalfWidth: 2.1,
  roadShoulderHalfWidth: 2.35,
  roadSidewalkOuter: 3.2,
  roadFurnitureOuter: 4.1,
  roadReservedHalfWidth: 4.1,
  railTrackHalfWidth: 1.05,
  railPoleOffset: 1.8,
  railInfrastructureHalfWidth: 2.2,
  railReservedHalfWidth: 2.2,
  separationGap: .5,
  minCenterlineSeparation: 6.8,
  architectureGap: .5,
  stationPlatformCenter: 1.95,
  stationPlatformWidth: 1.5,
  stationReservationCenter: 3.2,
  stationReservationWidth: 4.6,
  stationReservationLength: 10,
});

export function sampleCurvePolyline(curve, samples = 900) {
  return Array.from({length:samples + 1}, (_,i) => {
    const p=curve.getPointAt(i/samples);return {x:p.x,z:p.z};
  });
}

export function closestPointOnPolyline(point, points) {
  let best={x:0,z:0,distance:Infinity,index:-1,t:0};
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z,length=dx*dx+dz*dz;
    const t=length?Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.z-a.z)*dz)/length)):0;
    const x=a.x+dx*t,z=a.z+dz*t,distance=Math.hypot(point.x-x,point.z-z);
    if(distance<best.distance)best={x,z,distance,index:i-1,t};
  }
  return best;
}

const cross=(a,b,c)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
const inBounds=(a,b,p)=>p.x>=Math.min(a.x,b.x)-1e-9&&p.x<=Math.max(a.x,b.x)+1e-9&&p.z>=Math.min(a.z,b.z)-1e-9&&p.z<=Math.max(a.z,b.z)+1e-9;
function intersects(a,b,c,d){
  const x1=cross(a,b,c),x2=cross(a,b,d),x3=cross(c,d,a),x4=cross(c,d,b);
  if((x1>0)!==(x2>0)&&(x3>0)!==(x4>0))return true;
  return Math.abs(x1)<1e-9&&inBounds(a,b,c)||Math.abs(x2)<1e-9&&inBounds(a,b,d)||Math.abs(x3)<1e-9&&inBounds(c,d,a)||Math.abs(x4)<1e-9&&inBounds(c,d,b);
}
function segmentPointDistance(a,b,p){
  const dx=b.x-a.x,dz=b.z-a.z,length=dx*dx+dz*dz,t=length?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/length)):0;
  return Math.hypot(p.x-a.x-dx*t,p.z-a.z-dz*t);
}
function containsPoint(points,p){
  let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=points[i],b=points[j];if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)inside=!inside;
  }return inside;
}

/** Accept a circle {x,z,r/radius}, rectangle {x,z,w,d,rotation}, polygon, or world Box3. */
export function footprintPolygon(footprint) {
  if(footprint.points)return footprint.points.map(p=>Array.isArray(p)?{x:p[0],z:p[1]}:{x:p.x,z:p.z});
  let x=footprint.x,z=footprint.z,w=footprint.w??footprint.width,d=footprint.d??footprint.depth;
  if(footprint.min&&footprint.max){x=(footprint.min.x+footprint.max.x)/2;z=(footprint.min.z+footprint.max.z)/2;w=footprint.max.x-footprint.min.x;d=footprint.max.z-footprint.min.z;}
  if(!Number.isFinite(w)||!Number.isFinite(d))return null;
  const angle=footprint.rotation??footprint.angle??0,c=Math.cos(angle),s=Math.sin(angle);
  return [[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]].map(([a,b])=>({x:x+a*c+b*s,z:z-a*s+b*c}));
}

/** Exact 2D distance to the footprint boundary, rather than distance to its center or sampled vertices. */
export function footprintDistanceToPolyline(footprint, points) {
  const polygon=footprintPolygon(footprint);
  if(!polygon){const r=footprint.r??footprint.radius??0;return Math.max(0,closestPointOnPolyline(footprint,points).distance-r);}
  let distance=Infinity;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i];if(containsPoint(polygon,a)||containsPoint(polygon,b))return 0;
    for(let j=0;j<polygon.length;j++){
      const c=polygon[j],d=polygon[(j+1)%polygon.length];if(intersects(a,b,c,d))return 0;
      distance=Math.min(distance,segmentPointDistance(a,b,c),segmentPointDistance(a,b,d),segmentPointDistance(c,d,a),segmentPointDistance(c,d,b));
    }
  }return distance;
}

export function stationReservationFootprints(railCurve,stations=[],samples=900) {
  const rail=sampleCurvePolyline(railCurve,samples);
  return stations.map(station=>{
    const near=closestPointOnPolyline(station,rail),t=Math.max(0,Math.min(1,(near.index+near.t)/samples));
    const p=railCurve.getPointAt(t),d=railCurve.getTangentAt(t),flat=Math.hypot(d.x,d.z)||1;
    return {id:station.id,x:p.x+d.z/flat*CORRIDORS.stationReservationCenter,z:p.z-d.x/flat*CORRIDORS.stationReservationCenter,
      w:CORRIDORS.stationReservationWidth,d:CORRIDORS.stationReservationLength,rotation:Math.atan2(d.x,d.z)};
  });
}

function distanceToReservation(footprint,reservation) {
  const boundary=footprintPolygon(reservation),inside=footprintPolygon(footprint);
  if(containsPoint(boundary,inside?inside[0]:footprint))return 0;
  return footprintDistanceToPolyline(footprint,[...boundary,boundary[0]]);
}

export function createCorridorIndex(roadCurve, railCurve, {samples=900,roadHalfWidth=CORRIDORS.roadReservedHalfWidth,railHalfWidth=CORRIDORS.railReservedHalfWidth,stations=[],reservations=[]}={}) {
  const road=sampleCurvePolyline(roadCurve,samples),rail=sampleCurvePolyline(railCurve,samples);
  const extra=[...reservations,...stationReservationFootprints(railCurve,stations,samples)];
  return {
    road,rail,roadHalfWidth,railHalfWidth,reservations:extra,
    roadClearance(footprint){return footprintDistanceToPolyline(footprint,road)-roadHalfWidth;},
    railClearance(footprint){return footprintDistanceToPolyline(footprint,rail)-railHalfWidth;},
    reservationClearance(footprint){return Math.min(Infinity,...extra.map(reservation=>distanceToReservation(footprint,reservation)));},
    isClear(footprint,{roadGap=CORRIDORS.architectureGap,railGap=CORRIDORS.architectureGap,reservationGap=CORRIDORS.architectureGap}={}){
      return footprintDistanceToPolyline(footprint,road)>=roadHalfWidth+roadGap&&footprintDistanceToPolyline(footprint,rail)>=railHalfWidth+railGap&&extra.every(reservation=>distanceToReservation(footprint,reservation)>=reservationGap);
    },
  };
}

/** Keep the whole road, sidewalks and verge west of the rail/pole envelope, with no crossings. */
export function resolveDrivingAlignment(railCurve, colliders=[], {isOnLand=()=>true,minSeparation=CORRIDORS.minCenterlineSeparation,samples=900,gridSpacing=.35,smoothingSigma=4}={}) {
  const rail=sampleCurvePolyline(railCurve,Math.max(900,samples)),radius=minSeparation+.35;
  const north=rail[0].z,south=rail.at(-1).z,count=Math.max(2,Math.ceil((south-north)/gridSpacing)),step=(south-north)/count;
  if(!(step>0))throw new Error('The Peninsula driving corridor requires a north-to-south railway.');
  // x(z) is monotonic in its north/south coordinate. A direct normal offset of a tight
  // railway curve can fold back on itself and make coplanar asphalt triangles overlap.
  const points=[],allowed=[];
  for(let i=0;i<=count;i++){
    const z=north+step*i;let x=Infinity;
    for(const p of rail){const dz=z-p.z;if(Math.abs(dz)<radius)x=Math.min(x,p.x-Math.sqrt(radius*radius-dz*dz));}
    for(const collider of colliders){
      const clearance=collider.r+CORRIDORS.roadReservedHalfWidth+CORRIDORS.architectureGap+.3,dz=z-collider.z;
      if(Math.abs(dz)<clearance)x=Math.min(x,collider.x-Math.sqrt(clearance*clearance-dz*dz));
    }
    if(!Number.isFinite(x))throw new Error(`The road has no railway envelope at sample ${i}.`);
    allowed.push(x);points.push(new Vector3(x,SURFACES.road,z));
  }
  // Smooth without pointwise clamping: clamps would restore sharp derivative kinks.
  // One conservative global west shift then restores every clearance constraint while
  // leaving the Gaussian-smoothed derivatives continuous through the entire road.
  const window=Math.ceil(smoothingSigma*3/step),weights=Array.from({length:window*2+1},(_,i)=>Math.exp(-.5*((i-window)*step/smoothingSigma)**2));
  for(let i=0;i<=count;i++){
    let sum=0,total=0;for(let k=-window;k<=window;k++){const w=weights[k+window];sum+=allowed[Math.max(0,Math.min(count,i+k))]*w;total+=w;}
    points[i].x=sum/total;
  }
  const westShift=Math.max(0,...points.map((p,i)=>p.x-allowed[i]))+.1;points.forEach(p=>p.x-=westShift);
  const curve=new CatmullRomCurve3(points,false,'centripetal');curve.arcLengthDivisions=2400;curve.updateArcLengths();
  // Verify the whole road/sidewalk/verge cross-section and no unmarked rail crossings.
  for(let i=0;i<=900;i++){
    const p=curve.getPointAt(i/900),d=curve.getTangentAt(i/900),flat=Math.hypot(d.x,d.z)||1;
    if(d.z<=0)throw new Error(`The road reverses direction at sample ${i}.`);
    for(const side of [-1,0,1]){
      const x=p.x-d.z/flat*side*CORRIDORS.roadReservedHalfWidth,z=p.z+d.x/flat*side*CORRIDORS.roadReservedHalfWidth;
      if(!isOnLand(x,z))throw new Error(`The road corridor leaves modeled land at sample ${i}.`);
    }
    if(closestPointOnPolyline(p,rail).distance<minSeparation-.015)throw new Error(`Road and rail corridors overlap at sample ${i}.`);
  }
  return curve;
}
