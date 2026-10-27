import { Box3, CubicBezierCurve3, CurvePath, LineCurve3, Vector3 } from 'three';
import { SURFACES } from './surfaces.js';

const copy = p => p?.isVector3 ? p.clone() : new Vector3(p.x,p.y,p.z);

/**
 * A connected Golden Gate spur, ordered SF main-road junction → Marin turnaround.
 * Paths are illustrative miniature roads, not a surveyed highway alignment.
 * curve/curves: Three.js Curve objects, surface height is in world-space Y.
 * segments: named curve metadata; the existing landmark supplies the flat deck surface.
 * sampleSurface(x,z) returns null outside the pavement envelope.
 * contains(x,z,margin) is suitable for clearing vegetation and generic buildings.
 * isDrivable(x,z,vehicleRadius) is the legacy circular envelope query. Manual
 * driving uses createBridgeConstraint() for its oriented body and tire footprint.
 */
export function createBridgeDrive({ bridge, roadCurve, isOnLand=()=>true }={}) {
  if(!bridge?.endpoints?.south||!bridge?.endpoints?.north||!roadCurve?.getPointAt)throw new TypeError('Golden Gate bridge endpoints and a main road curve are required.');
  const roadWidth=bridge.roadWidth||4.2,halfWidth=roadWidth/2;
  const south=copy(bridge.endpoints.south),north=copy(bridge.endpoints.north);
  const axis=north.clone().sub(south).setY(0).normalize();
  if(axis.lengthSq()<.9)throw new TypeError('Bridge endpoints must have a horizontal span.');
  const right=new Vector3(-axis.z,0,axis.x);
  // The south ramp extends the north end of the main road. A second detached
  // 14-unit approach would overlap and elevate the adjacent SF pavement.
  const joinT=0,joinPoint=roadCurve.getPointAt(0);joinPoint.y=SURFACES.road;
  const southFoot=joinPoint.clone();
  const northFoot=north.clone().addScaledVector(axis,14);northFoot.y=SURFACES.road;
  const junctionTangent=roadCurve.getTangentAt(0).setY(0).normalize().negate();
  const joinDistance=Math.hypot(south.x-joinPoint.x,south.z-joinPoint.z),handle=joinDistance/3;
  const southRamp=new CubicBezierCurve3(joinPoint.clone(),joinPoint.clone().addScaledVector(junctionTangent,handle),south.clone().addScaledVector(axis,-handle),south.clone());
  const deck=new LineCurve3(south.clone(),north.clone());
  const northRamp=new CubicBezierCurve3(north.clone(),north.clone().addScaledVector(axis,5),northFoot.clone().addScaledVector(axis,-5),northFoot.clone());
  // A full smooth loop lets manual drivers turn around without falling off the north endpoint.
  const radius=3.3,k=.5522847498307936;
  const center=northFoot.clone().addScaledVector(right,-radius);
  const a=northFoot.clone(),b=center.clone().addScaledVector(axis,radius),c=center.clone().addScaledVector(right,-radius),d=center.clone().addScaledVector(axis,-radius);
  const loop=[
    new CubicBezierCurve3(a.clone(),a.clone().addScaledVector(axis,k*radius),b.clone().addScaledVector(right,k*radius),b.clone()),
    new CubicBezierCurve3(b.clone(),b.clone().addScaledVector(right,-k*radius),c.clone().addScaledVector(axis,k*radius),c.clone()),
    new CubicBezierCurve3(c.clone(),c.clone().addScaledVector(axis,-k*radius),d.clone().addScaledVector(right,-k*radius),d.clone()),
    new CubicBezierCurve3(d.clone(),d.clone().addScaledVector(right,k*radius),a.clone().addScaledVector(axis,-k*radius),a.clone()),
  ];
  const segments=[
    {id:'south-ramp',name:'Presidio bridge approach',curve:southRamp,type:'ramp'},
    {id:'golden-gate-deck',name:bridge.name||'Golden Gate Bridge',curve:deck,type:'deck'},
    {id:'north-ramp',name:'Marin bridge approach',curve:northRamp,type:'ramp'},
    ...loop.map((curve,i)=>({id:`marin-turnaround-${i}`,name:'Marin turnaround',curve,type:'turnaround'})),
  ];
  const curve=new CurvePath();for(const segment of segments)curve.add(segment.curve);curve.arcLengthDivisions=1800;curve.updateArcLengths();
  // Sampling separately retains every exact join, so ramps meet the flat deck without a height step.
  const samples=[];
  for(const segment of segments){const count=Math.max(24,Math.ceil(segment.curve.getLength()*10));for(let i=0;i<=count;i++){if(samples.length&&i===0)continue;samples.push(segment.curve.getPointAt(i/count));}}
  const bounds=new Box3().setFromPoints(samples);bounds.expandByVector(new Vector3(halfWidth,0,halfWidth));
  function nearest(x,z) {
    let distanceSquared=Infinity,height=NaN,pointX=0,pointZ=0;
    for(let i=1;i<samples.length;i++) {
      const a=samples[i-1],b=samples[i],dx=b.x-a.x,dz=b.z-a.z,l2=dx*dx+dz*dz;
      const t=l2?Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/l2)):0;
      const px=a.x+dx*t,pz=a.z+dz*t,d=(x-px)**2+(z-pz)**2;
      if(d<distanceSquared){distanceSquared=d;height=a.y+(b.y-a.y)*t;pointX=px;pointZ=pz;}
    }
    return {distance:Math.sqrt(distanceSquared),height,point:new Vector3(pointX,height,pointZ)};
  }
  function contains(x,z,margin=0) {
    if(x<bounds.min.x-margin||x>bounds.max.x+margin||z<bounds.min.z-margin||z>bounds.max.z+margin)return false;
    return nearest(x,z).distance<=halfWidth+margin;
  }
  function sampleSurface(x,z) {if(x<bounds.min.x||x>bounds.max.x||z<bounds.min.z||z>bounds.max.z)return null;const sample=nearest(x,z);return sample.distance<=halfWidth?{...sample,type:'bridge-road'}:null;}
  function isDrivable(x,z,vehicleRadius=.55){return nearest(x,z).distance<=Math.max(0,halfWidth-vehicleRadius);}
  return {
    curve,curves:segments.map(s=>s.curve),segments,samples,bounds,roadWidth,halfWidth,roadCurve,
    towerColliders:bridge.towerColliders||[],
    join:{point:joinPoint,t:joinT},entrance:south.clone(),northExit:north.clone(),
    southFoot,northFoot,turnaround:{center,radius,entry:northFoot.clone()},
    contains,sampleSurface,isDrivable,nearest,
  };
}
