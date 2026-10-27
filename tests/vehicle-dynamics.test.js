import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { createBrakeDynamics, createVehicleDynamics } from '../src/vehicle-dynamics.js';
import { createGravityCar } from '../src/landmarks.js';
import { groundVehicle } from '../src/vehicle-grounding.js';

function carModel(){const old=globalThis.document;globalThis.document={createElement:()=>({getContext:()=>({clearRect(){},fillText(){}})})};try{const car=createGravityCar();car.scale.setScalar(.4);return car;}finally{if(old===undefined)delete globalThis.document;else globalThis.document=old;}}
const close=(a,b,tolerance=1e-7)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
function run(fps){const spring=createBrakeDynamics(),dt=1/fps;spring.update({dt,speed:10,acceleration:0});for(let i=1;i<=fps*.4;i++)spring.update({dt,speed:10-8*i*dt,acceleration:-8,braking:true});const peak=spring.state();for(let i=0;i<fps*1.6;i++)spring.update({dt,speed:6.8,acceleration:0,braking:false});return {peak,rest:spring.state()};}

test('braking response is frame-rate stable and settles promptly after release',()=>{
  const reference=run(120);
  assert.ok(reference.peak.pitch>.01&&reference.peak.heave>.004);
  for(const fps of [15,30,60,120]){const actual=run(fps);close(actual.peak.pitch,reference.peak.pitch);close(actual.peak.heave,reference.peak.heave);assert.ok(Math.abs(actual.rest.pitch)<.00005);assert.ok(Math.abs(actual.rest.heave)<.00003);}
});

test('significant braking has a strong bounded nose dive followed by a controlled rebound',()=>{
  const spring=createBrakeDynamics();let max=0,rebound=0;
  for(let i=0;i<36;i++){const value=spring.update({dt:1/120,speed:10-i/120*12,acceleration:-12,braking:true});max=Math.max(max,value.pitch);assert.ok(Math.abs(value.pitch)<=.105&&Math.abs(value.heave)<=.06);}
  for(let i=0;i<180;i++){const value=spring.update({dt:1/120,speed:6.4,acceleration:0});rebound=Math.min(rebound,value.pitch);}
  assert.ok(max>.015);assert.ok(rebound<-.0001&&rebound>-.05,'release rebounds visibly while remaining bounded');
  assert.ok(Math.abs(spring.state().pitch)<.00005);
});

test('idle, pause, reduced motion, and a background-sized frame cannot create a bounce',()=>{
  const spring=createBrakeDynamics();
  for(let i=0;i<100;i++)assert.equal(spring.update({dt:1/60,speed:0,acceleration:-100,braking:true}).pitch,0);
  spring.update({dt:.1,speed:8,acceleration:-10,braking:true});assert.ok(spring.state().pitch>0);
  assert.equal(spring.update({dt:1/60,speed:0,acceleration:-10,braking:true,paused:true}).pitch,0);
  assert.equal(spring.update({dt:1/60,speed:0,acceleration:-10,braking:true}).pitch,0);
  spring.update({dt:.1,speed:8,acceleration:-10,braking:true});assert.equal(spring.update({dt:2,speed:0,acceleration:-10,braking:true}).pitch,0);
  assert.equal(createBrakeDynamics({reducedMotion:true}).update({dt:.1,speed:8,acceleration:-10,braking:true}).pitch,0);
});

test('reverse braking transfers weight toward the rear and braking at steady speed stays level',()=>{
  const reverse=createBrakeDynamics(),steady=createBrakeDynamics();
  const response=reverse.update({dt:.08,speed:-5,acceleration:-8,braking:true});assert.ok(response.pitch<0);assert.ok(response.heave>0);
  for(let i=0;i<30;i++)assert.equal(steady.update({dt:1/60,speed:8,acceleration:0,braking:true}).pitch,0);
});

test('chassis animation leaves measured wheels, terrain orientation, and tire contact untouched',()=>{
  const car=carModel(),height=(x,z)=>.79+Math.tan(17*Math.PI/180)*z;
  groundVehicle(car,{scale:.4,sampleHeight:height,yaw:.4});car.updateMatrixWorld(true);
  const rootQuaternion=car.quaternion.clone(),wheelPositions=car.userData.wheels.map(w=>w.getWorldPosition(new Vector3()));
  const controller=createVehicleDynamics(car),before=controller.body.localToWorld(new Vector3(0,.2,2.5));
  for(let i=0;i<8;i++)controller.update({dt:1/60,speed:8-i/6,acceleration:-10,braking:true});
  car.updateMatrixWorld(true);const after=controller.body.localToWorld(new Vector3(0,.2,2.5));assert.ok(after.y<before.y,'only the nose of the suspended body lowers');
  car.userData.wheels.forEach((wheel,i)=>{assert.equal(wheel.parent,car);close(wheel.getWorldPosition(new Vector3()).distanceTo(wheelPositions[i]),0);});
  close(car.quaternion.angleTo(rootQuaternion),0);controller.reset();assert.equal(controller.body.rotation.x,0);
  controller.dispose();assert.equal(controller.body.parent,null);
});


test('container impacts shake only the chassis, settle quickly, and obey reduced motion',()=>{
 const car=carModel();groundVehicle(car,{scale:.4,sampleHeight:()=>.79,yaw:0});car.updateMatrixWorld(true);
 const wheels=car.userData.wheels.map(w=>w.getWorldPosition(new Vector3())),controller=createVehicleDynamics(car);
 assert.equal(controller.impact(1),true);let peak=0;
 for(let i=0;i<60;i++){const value=controller.update({dt:1/60,speed:8,acceleration:0});peak=Math.max(peak,Math.abs(value.roll));assert.ok(Math.abs(value.roll)<=.115);}
 assert.ok(peak>.05,'A strong hit gives the body a readable side-to-side jolt');assert.equal(controller.state().shake,0);
 car.updateMatrixWorld(true);car.userData.wheels.forEach((w,i)=>close(w.getWorldPosition(new Vector3()).distanceTo(wheels[i]),0));
 controller.impact(1);controller.update({dt:1/60,paused:true});assert.equal(controller.state().shake,0);
 const reduced=createVehicleDynamics(carModel(),{reducedMotion:true});assert.equal(reduced.impact(1),false);assert.equal(reduced.update({dt:1/60,speed:9,acceleration:-24,braking:true}).shake,0);
});

test('holding the brake triggers one finite shake rather than ongoing vibration',()=>{
 const controller=createVehicleDynamics(carModel());let peak=0;
 for(let i=0;i<100;i++){const value=controller.update({dt:1/60,speed:10,acceleration:-12,braking:true});peak=Math.max(peak,value.shake);}
 assert.ok(peak>.5);assert.equal(controller.state().shake,0);
 controller.reset();assert.equal(controller.body.rotation.z,0);assert.equal(controller.body.position.x,0);
});
