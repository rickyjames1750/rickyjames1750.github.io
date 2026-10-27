import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, CatmullRomCurve3, LineCurve3, Scene, Vector3 } from 'three';
import { createBridgeDrive } from '../src/bridge-road.js';
import { createGravityCar, createLandmarks } from '../src/landmarks.js';
import { project, railCoordinates, peninsulaCoast } from '../src/geography.js';
import { createDrivingCurve } from '../src/driving-route.js';
import { groundedRootY, SURFACES } from '../src/surfaces.js';

function fixture() {
  const center=project(-122.4783,37.8199);
  const bridge={name:'Golden Gate Bridge',roadWidth:4.2,deckTop:2.4,endpoints:{
    south:new Vector3(center.x,2.4,center.z+7.5),north:new Vector3(center.x,2.4,center.z-7.5),
  }};
  const roadCurve=new LineCurve3(new Vector3(-31,SURFACES.road,-50),new Vector3(45,SURFACES.road,60));
  return {bridge,roadCurve};
}
const close=(actual,expected,tolerance=1e-6)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);

test('Golden Gate spur joins the actual SF road and every ramp/deck/turnaround seam',()=>{
  const {bridge,roadCurve}=fixture(),drive=createBridgeDrive({bridge,roadCurve});
  assert.equal(drive.join.t,0,'spur extends the northern endpoint, never a middle-of-road overlapping ramp');
  close(drive.southFoot.distanceTo(drive.join.point),0);
  close(drive.curve.getPointAt(0).distanceTo(drive.join.point),0);
  close(drive.join.point.distanceTo(roadCurve.getPointAt(drive.join.t)),0);
  for(let i=1;i<drive.segments.length;i++) {
    const previous=drive.segments[i-1].curve.getPoint(1),next=drive.segments[i].curve.getPoint(0);
    close(previous.distanceTo(next),0);
    close(drive.sampleSurface(previous.x,previous.z).height,previous.y,.002);
  }
  close(drive.curve.getPointAt(1).distanceTo(drive.northFoot),0);
  assert.ok(drive.entrance.z>drive.northExit.z,'Marin is north of San Francisco in the projected map');
});

test('bridge height sampler follows gradual ramps without flattening the elevated span',()=>{
  const drive=createBridgeDrive(fixture());
  for(const segment of drive.segments.filter(s=>s.type==='ramp')) {
    let last=segment.curve.getPoint(0);
    for(let i=1;i<=100;i++) {
      const point=segment.curve.getPoint(i/100),horizontal=Math.hypot(point.x-last.x,point.z-last.z);
      assert.ok(Math.abs(point.y-last.y)/horizontal<.2,'approach grade stays gradual');
      close(drive.sampleSurface(point.x,point.z).height,point.y,.002);
      last=point;
    }
  }
  const center=drive.segments.find(s=>s.type==='deck').curve.getPoint(.5);
  close(drive.sampleSurface(center.x,center.z).height,2.4);
  assert.equal(drive.sampleSurface(center.x+5,center.z),null);
});

test('water-crossing drive corridor accepts the full car and rejects positions outside guardrails',()=>{
  const drive=createBridgeDrive({...fixture(),isOnLand:()=>true});
  const p=drive.segments.find(s=>s.type==='deck').curve.getPoint(.5);
  assert.equal(drive.isDrivable(p.x,p.z,.55),true);
  assert.equal(drive.isDrivable(p.x+1.5,p.z,.55),true);
  assert.equal(drive.isDrivable(p.x+1.7,p.z,.55),false);
  assert.equal(drive.contains(p.x+4,p.z,3),true,'vegetation clearing covers the bridge verge');
  assert.equal(drive.contains(p.x+6,p.z,3),false);
  assert.ok(drive.bounds instanceof Box3);
});

test('authored bridge deck and transverse beams clear the actual scaled SUV geometry',()=>{
  const previous=globalThis.document;
  globalThis.document={createElement:()=>({getContext:()=>({clearRect(){},fillText(){}})})};
  try {
    const authored=createLandmarks(new Scene(),project),car=createGravityCar(),bridge=authored.bridge;
    const scale=.4,rootY=groundedRootY(bridge.deckTop,car.userData.wheelBottom,scale);
    close(rootY+car.userData.wheelBottom*scale,bridge.deckTop+SURFACES.vehicleClearance);
    assert.ok(rootY+car.userData.bounds.max[1]*scale<bridge.lowestCrossbarBottom,'SUV roof clears lower tower crossbeam');
    const halfCar=car.userData.collisionHalfExtents.x*scale;
    assert.ok(bridge.driveHalfWidth-.55+halfCar<bridge.railInnerHalfWidth,'car remains inside bridge rails at the legal lane edge');
    assert.ok(bridge.towerColliders.every(t=>Math.abs(t.x-bridge.center.x)-t.r>bridge.driveHalfWidth),'tower piers do not intrude into the road surface');
    assert.equal(bridge.vegetationBounds.containsPoint(bridge.center),true);
  } finally {if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});


test('real SF ramp does not lift any main-road pavement after the shared northern junction',()=>{
  const previous=globalThis.document;
  globalThis.document={createElement:()=>({getContext:()=>({clearRect(){},fillText(){}})})};
  try {
    const land=peninsulaCoast.map(c=>project(...c));
    const isOnLand=(x,z)=>{let inside=false;for(let i=0,j=land.length-1;i<land.length;j=i++){const a=land[i],b=land[j];if((a.z>z)!==(b.z>z)&&x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)inside=!inside;}return inside;};
    const authored=createLandmarks(new Scene(),project);
    const rail=new CatmullRomCurve3(railCoordinates.map(c=>{const p=project(...c);return new Vector3(p.x,.84,p.z);}),false,'catmullrom',.15);
    rail.arcLengthDivisions=2000;rail.updateArcLengths();
    const road=createDrivingCurve(rail,authored.colliders,{isOnLand});road.arcLengthDivisions=2000;road.updateArcLengths();
    const drive=createBridgeDrive({bridge:authored.bridge,roadCurve:road,isOnLand}),ramp=drive.segments[0].curve;
    const roadLength=road.getLength();
    for(let distance=.5;distance<14;distance+=.1){
      const u=distance/roadLength,p=road.getPointAt(u),tangent=road.getTangentAt(u),normal=new Vector3(tangent.z,0,-tangent.x).normalize();
      for(let lateral=-2.1;lateral<=2.1;lateral+=.1){
        const q=p.clone().addScaledVector(normal,lateral),height=drive.sampleSurface(q.x,q.z)?.height;
        assert.ok(height===undefined||height<=SURFACES.road+.001,`raised ramp overlaps SF road ${distance} units past junction at lateral ${lateral}`);
      }
    }
    assert.ok(ramp.getTangent(0).dot(road.getTangentAt(0).negate())>.99999,'northbound departure follows the same end cross-section');
    // Test the actual ribbon triangles, including both pavement edges, rather than only its centerline.
    const left=[],right=[];
    for(let i=0;i<=450;i++){
      const p=ramp.getPoint(i/450),t=ramp.getTangent(i/450),n=new Vector3(-t.z,0,t.x).multiplyScalar(2.1);
      left.push(p.clone().add(n));right.push(p.clone().sub(n));
    }
    let orientation=0;
    for(let i=0;i<450;i++)for(const [a,b,c] of [[left[i],left[i+1],right[i]],[right[i],left[i+1],right[i+1]]]){
      const y=b.clone().sub(a).cross(c.clone().sub(a)).y;
      assert.ok(Math.abs(y)>1e-7,'approach pavement has no degenerate triangles');
      orientation ||= Math.sign(y);assert.equal(Math.sign(y),orientation,'approach pavement never folds or inverts');
    }
    let last=ramp.getPoint(0);for(let i=1;i<=100;i++){const p=ramp.getPoint(i/100);assert.ok(Math.abs(p.y-last.y)/Math.hypot(p.x-last.x,p.z-last.z)<.5,'miniature approach remains below a 27-degree maximum grade');last=p;}
  } finally {if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
