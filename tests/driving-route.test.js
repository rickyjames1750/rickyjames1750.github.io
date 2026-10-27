import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, CatmullRomCurve3, Vector3 } from 'three';
import { createDrivingCurve, curveFrame, planGroundPath } from '../src/driving-route.js';
import { createLandmarks } from '../src/landmarks.js';
import { railCoordinates, project, peninsulaCoast } from '../src/geography.js';

const pp=peninsulaCoast.map(c=>project(...c));
const onLand=(x,z)=>{let inside=false;for(let i=0,j=pp.length-1;i<pp.length;j=i++){const a=pp[i],b=pp[j];if((a.z>z)!==(b.z>z)&&x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)inside=!inside;}return inside;};

test('guided driving pavement clears authored landmarks and stays on modeled land', () => {
  const previous=globalThis.document;globalThis.document={createElement:()=>({getContext:()=>({clearRect(){},fillText(){}})})};
  try {
    const architecture=createLandmarks(new Scene(),project);
    const rail=new CatmullRomCurve3(railCoordinates.map(c=>{const p=project(...c);return new Vector3(p.x,.84,p.z);}),false,'catmullrom',.15);
    const road=createDrivingCurve(rail,architecture.colliders,{isOnLand:onLand});
    for(let i=0;i<=1000;i++){
      const p=road.getPointAt(i/1000);
      assert.ok(onLand(p.x,p.z),`Road t=${i/1000} stays on land`);
      for(const collider of architecture.colliders)assert.ok(Math.hypot(p.x-collider.x,p.z-collider.z)>=collider.r+2.35,`Pavement t=${i/1000} clears landmark`);
    }
  } finally {if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});

test('carriage frame offsets use distance along curves and extend rather than stack at endpoints', () => {
  const straight=new CatmullRomCurve3([new Vector3(0,0,0),new Vector3(0,0,20)]);
  const a=curveFrame(straight,.5,4),b=curveFrame(straight,.5,-4);
  assert.ok(Math.abs(a.point.z-b.point.z-8)<1e-3);
  assert.ok(Math.abs(curveFrame(straight,0,-4).point.z+4)<1e-4);
  assert.ok(Math.abs(curveFrame(straight,1,4).point.z-24)<1e-4);
  const bend=new CatmullRomCurve3([new Vector3(0,0,0),new Vector3(0,0,10),new Vector3(10,0,10)]);
  const front=curveFrame(bend,.5,3),rear=curveFrame(bend,.5,-3);
  assert.ok(front.tangent.dot(rear.tangent)<.95,'Each carriage has its own heading through the bend');
});

test('guided connector routes around an obstacle instead of cutting through its footprint', () => {
  const start=new Vector3(0,.79,0),end=new Vector3(10,.79,0),colliders=[{x:5,z:0,r:1.6}];
  const route=planGroundPath(start,end,{colliders,clearance:.8,isOnLand:()=>true});
  assert.ok(route.length>=2);
  let previous=start;
  for(const p of route){for(let i=0;i<=100;i++){const t=i/100,x=previous.x+(p.x-previous.x)*t,z=previous.z+(p.z-previous.z)*t;assert.ok(Math.hypot(x-5,z)>=2.4-1e-6);}previous=p;}
  assert.ok(route.at(-1).distanceTo(end)<1e-8);
});
