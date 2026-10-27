import test from 'node:test';
import assert from 'node:assert/strict';
import { LineCurve3, Matrix4, Scene, Vector3 } from 'three';
import { createLivingWorld, createRobotReaction, sweptRobotContact } from '../src/living-world.js';
import { createCorridorIndex } from '../src/corridors.js';

function fixture(extra={}){
 const scene=new Scene(),roadCurve=new LineCurve3(new Vector3(0,.79,0),new Vector3(0,.79,160)),railCurve=new LineCurve3(new Vector3(8,.84,0),new Vector3(8,.84,160));
 const zones=[.1,.3,.5,.7,.9].map((t,i)=>({id:String(i),x:0,z:t*160}));
 const corridors=createCorridorIndex(roadCurve,railCurve,{samples:160});
 const living=createLivingWorld({scene,roadCurve,railCurve,corridors,zones,isOnLand:()=>true,sampleHeight:()=>.825,...extra});return {scene,living};
}
function matrices(root){return root.children.filter(o=>o.isInstancedMesh).map(o=>Array.from(o.instanceMatrix.array));}

test('humanoids and charging details reserve sidewalks outside the roadway and rail envelope',()=>{
 const {living}=fixture(),reservations=living.root.userData.reservations;
 assert.ok(living.stats.robots>=4&&living.stats.drones>=2);
 assert.ok(living.stats.drawCalls<=12,'many articulated parts remain in a small fixed instanced batch budget');
 for(const path of reservations.robotPaths)assert.ok(Math.abs(path.lateral)-.23>2.1,'humanoid stays outside road pavement');
 for(const pad of reservations.pads){assert.ok(Math.abs(pad.x)-pad.r>2.1,'permanent pad cannot block vehicle lane');assert.ok(Math.abs(8-pad.x)-pad.r>2.2,'permanent pad cannot block rail equipment');}
 living.dispose();
});

test('paused and reduced-motion actors freeze, while normal gait and leaves animate',()=>{
 const {living}=fixture();living.update({dt:.04,carPosition:new Vector3(0,.8,10),carVelocity:8});const moving=matrices(living.root);
 living.update({dt:.04,carPosition:new Vector3(0,.8,10),carVelocity:8});assert.notDeepEqual(matrices(living.root),moving);
 const before=matrices(living.root);living.update({dt:10,paused:true});assert.deepEqual(matrices(living.root),before);living.dispose();
 const reduced=fixture({reducedMotion:true}).living,beforeReduced=matrices(reduced.root);
 reduced.update({dt:.1,carPosition:new Vector3(0,0,0),carVelocity:20});assert.deepEqual(matrices(reduced.root),beforeReduced);assert.equal(reduced.stats.leaves,24);reduced.dispose();
});

test('quality switches trim bounded pools and all animated matrices stay finite',()=>{
 const {living}=fixture();living.update({dt:.04,quality:'eco'});
 assert.ok(living.stats.robots<=4&&living.stats.drones<=2);assert.equal(living.stats.leaves,48);
 living.update({dt:.04,quality:'high'});assert.ok(living.stats.robots<=8&&living.stats.drones<=4);assert.equal(living.stats.leaves,144);
 for(let i=0;i<120;i++)living.update({dt:1/60,carPosition:new Vector3(0,.8,i/4),carVelocity:11});
 for(const mesh of living.root.children){if(!mesh.isInstancedMesh)continue;assert.ok(mesh.count<=mesh.instanceMatrix.count);for(const value of mesh.instanceMatrix.array)assert.ok(Number.isFinite(value));}
 living.dispose();
});

test('bridge approaches exclude actor paths and dispose removes the complete scene addition',()=>{
 const {scene,living}=fixture({bridgeDrive:{contains:(x,z,margin)=>z<36+margin}});
 for(const path of living.root.userData.reservations.robotPaths)assert.ok(path.t*160-path.extent>36);
 const root=living.root;assert.equal(root.parent,scene);living.dispose();assert.equal(root.parent,null);
 const before=matrices(root);living.update({dt:1,quality:'eco'});assert.deepEqual(matrices(root),before);
});

function droneBodyPosition(living,index=0){
 const paper=living.root.children.find(mesh=>mesh.material.color.getHexString()==='d1ddd1'),matrix=new Matrix4();
 paper.getMatrixAt(living.stats.robots+index,matrix);
 living.root.updateWorldMatrix(true,false);return new Vector3().setFromMatrixPosition(matrix).applyMatrix4(living.root.matrixWorld);
}

test('nearest drone audio follows rendered world poses and returns an independent position clone',()=>{
 const {living}=fixture();living.root.position.set(5,2,7);
 const body=droneBodyPosition(living),before=matrices(living.root);
 living.root.traverse=()=>{throw new Error('Audio query must not traverse scene actors');};
 const result=living.nearestDrone(body);
 assert.ok(result.position.isVector3);assert.ok(result.position.distanceTo(body)<.03,'Audio source matches the rendered drone root, including group transform');
 assert.ok(Math.abs(result.distance-result.position.distanceTo(body))<1e-8);assert.equal(result.speed,0);
 const saved=result.position.clone();result.position.set(1000,1000,1000);
 assert.ok(living.nearestDrone(body).position.distanceTo(saved)<1e-8,'Callers cannot move the cached actor through the returned vector');
 assert.deepEqual(matrices(living.root),before,'Audio queries leave the render batches untouched');living.dispose();
});

test('drone telemetry reports motion, freezes speed on pause, and excludes ECO-hidden drones',()=>{
 const {living}=fixture();assert.ok(living.stats.drones>=3);
 const third=droneBodyPosition(living,2);assert.ok(living.nearestDrone(third).distance<.03);
 living.update({dt:.04,quality:'eco'});assert.equal(living.stats.drones,2);
 assert.ok(living.nearestDrone(third).distance>5,'ECO-hidden third drone must not keep buzzing beside the listener');
 const first=droneBodyPosition(living);living.update({dt:.04,quality:'eco'});
 const moving=living.nearestDrone(first);assert.ok(moving.speed>0&&moving.speed<3,'Telemetry uses actual bounded actor displacement');
 living.update({dt:.04,paused:true,quality:'eco'});assert.equal(living.nearestDrone(first).speed,0);
 for(let i=0;i<30;i++)living.update({dt:.04,quality:'eco'});
 living.update({dt:.04,quality:'high'});assert.equal(living.nearestDrone(droneBodyPosition(living,2)).speed,0,'A newly restored drone does not report a spurious velocity jump');
 living.root.visible=false;assert.equal(living.nearestDrone(first),undefined);living.root.visible=true;
 living.dispose();assert.equal(living.nearestDrone(first),undefined);
});

test('empty and reduced-motion worlds expose only actual visible drones with valid telemetry',()=>{
 const empty=fixture({isOnLand:()=>false}).living;assert.equal(empty.stats.drones,0);assert.equal(empty.nearestDrone(new Vector3()),undefined);empty.dispose();
 const reduced=fixture({reducedMotion:true}).living,result=reduced.nearestDrone(new Vector3());
 assert.ok(result&&Number.isFinite(result.distance));assert.equal(result.speed,0);
 assert.equal(reduced.nearestDrone({x:NaN,y:0,z:0}),undefined);assert.equal(reduced.nearestDrone(),undefined);reduced.dispose();
});


test('swept robot contact catches a crossing but excludes elevated cars and navigation jumps',()=>{
 const robot={x:0,y:.825,z:0};
 assert.equal(sweptRobotContact({x:-1.5,y:1,z:0},{x:1.5,y:1,z:0},robot),true);
 assert.equal(sweptRobotContact({x:-1.5,y:9,z:0},{x:1.5,y:9,z:0},robot),false);
 assert.equal(sweptRobotContact({x:-1.5,y:9,z:0},{x:1.5,y:1,z:0},robot),false);
 assert.equal(sweptRobotContact({x:-20,y:1,z:0},{x:20,y:1,z:0},robot),false);
 assert.equal(sweptRobotContact({x:-1.5,y:1,z:2},{x:1.5,y:1,z:2},robot),false);
 assert.equal(sweptRobotContact({x:NaN,y:1,z:0},{x:0,y:1,z:0},robot),false);
});

test('robot reaction falls, complains, gets up, and cannot be retriggered until its cooldown ends',()=>{
 const reaction=createRobotReaction();assert.equal(reaction.state().phase,'walking');assert.equal(reaction.hit({side:-1}),true);assert.equal(reaction.hit(),false);
 for(let i=0;i<4;i++)reaction.update(.1);assert.equal(reaction.state().phase,'upset');assert.ok(reaction.state().tilt< -1.3);assert.equal(reaction.state().hits,1);
 const before=reaction.state();reaction.update(.1,{paused:true});assert.deepEqual(reaction.state(),before);
 for(let i=0;i<15;i++)reaction.update(.1);assert.equal(reaction.state().phase,'rising');
 for(let i=0;i<8;i++)reaction.update(.1);assert.equal(reaction.state().phase,'walking');assert.equal(reaction.state().tilt,0);assert.equal(reaction.hit(),false);
 for(let i=0;i<18;i++)reaction.update(.1);assert.equal(reaction.hit({side:1}),true);assert.equal(reaction.state().hits,2);
 const reduced=createRobotReaction({reducedMotion:true});assert.equal(reduced.hit(),false);reduced.update(10);assert.equal(reduced.state().phase,'walking');
});

test('rendered robots freeze at impact, show an upset reaction, and recover without leaving their paths',()=>{
 const events=[],{living}=fixture({onRobotHit:event=>events.push(event)}),original=living.getRobotStates()[0].position;
 living.update({dt:.016,carPosition:new Vector3(original.x-1.5,1,original.z),carVelocity:12});
 living.update({dt:.016,carPosition:new Vector3(original.x+1.5,1,original.z),carVelocity:12});
 assert.equal(events.length,1);assert.equal(living.stats.robotHits,1);assert.equal(living.getRobotStates()[0].phase,'falling');const hit=living.getRobotStates()[0].position;
 for(let i=0;i<12;i++)living.update({dt:.05,carPosition:new Vector3(100,1,100),carVelocity:0});
 assert.equal(living.getRobotStates()[0].phase,'upset');assert.ok(living.getRobotStates()[0].position.distanceTo(hit)<1e-8,'robot must stop walking while it reacts');
 assert.equal(living.stats.robotsUpset,1);const paused=living.getRobotStates();living.update({dt:1,paused:true});assert.deepEqual(living.getRobotStates(),paused);
 for(let i=0;i<44;i++)living.update({dt:.05,carPosition:new Vector3(100,1,100),carVelocity:0});
 assert.equal(living.getRobotStates()[0].phase,'walking');assert.equal(living.stats.robotsUpset,0);assert.equal(events.length,1);
 for(const mesh of living.root.children){if(mesh.isInstancedMesh){assert.ok(mesh.count<=mesh.instanceMatrix.count);assert.ok(Array.from(mesh.instanceMatrix.array).every(Number.isFinite));}}
 living.dispose();
 const elevated=fixture().living,p=elevated.getRobotStates()[0].position;elevated.update({dt:.016,carPosition:new Vector3(p.x-1.5,9,p.z),carVelocity:20});elevated.update({dt:.016,carPosition:new Vector3(p.x+1.5,9,p.z),carVelocity:20});assert.equal(elevated.stats.robotHits,0);elevated.dispose();
});
