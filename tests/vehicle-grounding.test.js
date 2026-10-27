import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { createGravityCar } from '../src/landmarks.js';
import { groundVehicle } from '../src/vehicle-grounding.js';

function carModel(){
  const previous=globalThis.document;globalThis.document={createElement:()=>({getContext:()=>({clearRect(){},fillText(){}})})};
  try {const car=createGravityCar();car.scale.setScalar(.4);return car;}
  finally {if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
}
const close=(actual,expected,tolerance=1e-5)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`);
function minimumTireSurfaceGap(car,sampleHeight){
  car.updateMatrixWorld(true);let minimum=Infinity;
  for(const wheel of car.userData.wheels){const tyre=wheel.children[0],position=tyre.geometry.getAttribute('position'),p=new Vector3();
    for(let i=0;i<position.count;i++){p.fromBufferAttribute(position,i).applyMatrix4(tyre.matrixWorld);minimum=Math.min(minimum,p.y-sampleHeight(p.x,p.z));}
  }
  return minimum;
}

test('actual SUV follows a 17-degree ramp at different yaw headings without detached wheels',()=>{
  for(const yaw of [0,.7,Math.PI/2,2.6]){
    const car=carModel();car.position.set(3,0,-2);car.rotation.y=yaw;
    car.userData.wheels.forEach((w,i)=>w.rotation.x=.3+i*.4);
    const spins=car.userData.wheels.map(w=>w.rotation.x),slope=Math.tan(17*Math.PI/180),c=Math.cos(yaw),s=Math.sin(yaw);
    const height=(x,z)=>.79+slope*((x-3)*s+(z+2)*c);
    const result=groundVehicle(car,{scale:.4,sampleHeight:height,yaw});
    close(result.pitch,-17*Math.PI/180);close(result.roll,0);assert.ok(result.minClearance>=.005999);
    assert.ok(result.maxSuspension<.1,'body alignment, not stretched suspension, follows the plane');
    assert.ok(minimumTireSurfaceGap(car,height)>=0,'actual tire vertices clear the sloped surface');
    car.userData.wheels.forEach((w,i)=>close(w.rotation.x,spins[i]));
  }
});

test('cross slope and combined slopes use YXZ orientation with measured tire support',()=>{
  const car=carModel(),yaw=1.2,c=Math.cos(yaw),s=Math.sin(yaw),rightSlope=.25,forwardSlope=.17;
  const height=(x,z)=>.6+rightSlope*(x*c-z*s)+forwardSlope*(x*s+z*c);
  const result=groundVehicle(car,{scale:.4,sampleHeight:height,yaw});
  close(result.pitch,-Math.atan(forwardSlope));close(result.roll,Math.atan(rightSlope*Math.cos(result.pitch)));
  assert.equal(car.rotation.order,'YXZ');close(car.rotation.y,yaw);
  assert.ok(result.maxSuspension<.1);assert.ok(result.minClearance>=.005999);
  assert.ok(minimumTireSurfaceGap(car,height)>=0);
});

test('a discontinuous single-wheel curb never puts a tire below its sampled surface',()=>{
  const car=carModel();const height=(x,z)=>x>0&&z>0?.837:.6;
  const result=groundVehicle(car,{scale:.4,sampleHeight:height,yaw:0});
  assert.ok(Number.isFinite(result.pitch)&&Number.isFinite(result.roll));assert.ok(result.minClearance>=.005999);
  car.updateMatrixWorld(true);
  for(const wheel of car.userData.wheels){const center=wheel.getWorldPosition(new Vector3());assert.ok(center.y>.837||height(center.x,center.z)===.6);}
  assert.ok(minimumTireSurfaceGap(car,height)>=0,'actual tire vertices remain above both curb levels');
});

test('flat road returns upright body and nominal wheel positions across repeated calls',()=>{
  const car=carModel();car.rotation.set(.4,.6,.3,'YXZ');
  for(let i=0;i<10;i++){
    const result=groundVehicle(car,{scale:.4,sampleHeight:()=>.79,yaw:.6});
    close(result.pitch,0);close(result.roll,0);close(result.maxSuspension,0);close(result.minClearance,.006);
    for(let j=0;j<car.userData.wheels.length;j++)close(car.userData.wheels[j].position.y,car.userData.wheelCenters[j].y);
  }
});
