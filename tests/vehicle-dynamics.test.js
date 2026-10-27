import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { createBrakeDynamics, createVehicleDynamics, createVehicleHop } from '../src/vehicle-dynamics.js';
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


test('impact hop lifts the whole car and all measured tires above the road, then lands cleanly',()=>{
 const car=carModel(),hop=createVehicleHop();groundVehicle(car,{scale:.4,sampleHeight:()=>.79,yaw:0});const base=car.position.clone();
 assert.equal(hop.trigger(.25),true);let peak=0;
 for(let i=0;i<70;i++){
  const value=hop.update(1/120);peak=Math.max(peak,value.height);car.position.copy(base);car.position.y+=value.height;car.rotation.x=value.pitch;car.rotation.z=value.roll;
  if(value.height>.46){car.updateMatrixWorld(true);for(const wheel of car.userData.wheels){const tire=wheel.children[0],position=tire.geometry.getAttribute('position'),point=new Vector3();for(let v=0;v<position.count;v++){point.fromBufferAttribute(position,v).applyMatrix4(tire.matrixWorld);assert.ok(point.y>.79+.35,'Every tire is visibly airborne');}}}
 }
 assert.ok(peak>.48&&peak<.52,'Even a slow impact creates a readable half-unit hop');
 for(let i=0;i<90;i++)hop.update(1/120);assert.deepEqual(hop.state(),{height:0,verticalVelocity:0,airborne:false,pitch:0,roll:0});
});

test('hop trajectory is frame-rate stable and repeated hits cannot accumulate unbounded altitude',()=>{
 const simulate=fps=>{const hop=createVehicleHop();hop.trigger(1);for(let i=0;i<fps*.3;i++)hop.update(1/fps);return hop.state();};
 const expected=simulate(120);for(const fps of [10,30,60,120]){const actual=simulate(fps);close(actual.height,expected.height);close(actual.pitch,expected.pitch);close(actual.roll,expected.roll);}
 const hop=createVehicleHop();let peak=0;
 for(let i=0;i<300;i++){hop.trigger(1);const value=hop.update(1/60);peak=Math.max(peak,value.height);assert.ok(value.height>=0&&value.height<=.72);}
 assert.ok(peak>.5);for(let i=0;i<120;i++)hop.update(1/60);assert.equal(hop.state().height,0);assert.equal(hop.state().airborne,false);
});

test('hop pause freezes a flight; reduced motion, reset, invalid time and background gaps stay safe',()=>{
 const hop=createVehicleHop();hop.trigger(1);hop.update(.1);const current=hop.state();
 assert.deepEqual(hop.update(.2,{paused:true}),current);assert.deepEqual(hop.update(NaN),current);assert.deepEqual(hop.update(-1),current);
 assert.equal(hop.update(.1).airborne,true);assert.equal(hop.update(1).height,0);assert.equal(hop.state().airborne,false);
 hop.trigger(1);hop.update(.1);assert.equal(hop.reset().height,0);
 const reduced=createVehicleHop({reducedMotion:true});assert.equal(reduced.trigger(1),false);assert.equal(reduced.update(.1).height,0);
 assert.equal(hop.trigger(0),false);assert.equal(hop.trigger(NaN),false);
});
