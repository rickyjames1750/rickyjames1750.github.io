import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { chooseSafeCamera } from '../src/camera-safety.js';
const target = new Vector3(0, 1, 0), desired = new Vector3(0, 4, 8);
function wall(x = 0, z = 4) {const mesh = new Mesh(new BoxGeometry(8, 10, .5),new MeshBasicMaterial());mesh.position.set(x,5,z);mesh.updateMatrixWorld();return mesh;}
function visible(from,to,meshes){const d=to.clone().sub(from),distance=d.length();return new Raycaster(from,d.normalize(),.35,distance-.35).intersectObjects(meshes,true).length===0;}

test('clear desired view is preserved without mutating inputs',()=>{
 const obstruction=wall(30);const a=target.clone(),b=desired.clone();
 const result=chooseSafeCamera(target,desired,[obstruction]);assert.ok(result.equals(desired));assert.notEqual(result,desired);
 assert.ok(target.equals(a));assert.ok(desired.equals(b));
});

test('blocked view moves around or above a wall while keeping a clear line of sight',()=>{
 const obstruction=wall();assert.equal(visible(target,desired,[obstruction]),false);
 const safe=chooseSafeCamera(target,desired,[obstruction]);assert.equal(visible(target,safe,[obstruction]),true);
 assert.ok(safe.distanceTo(target)>=desired.distanceTo(target)*.8,'Does not pull the camera inside a wall');
 assert.ok(!safe.equals(desired));
});

test('three-ray clearance catches a wall that the central ray narrowly misses',()=>{
 const obstruction=new Mesh(new BoxGeometry(.15,10,.5),new MeshBasicMaterial());obstruction.position.set(.22,5,4);obstruction.updateMatrixWorld();
 assert.equal(visible(target,desired,[obstruction]),true,'Central ray misses the edge');
 const safe=chooseSafeCamera(target,desired,[obstruction],{clearance:.28});
 assert.ok(!safe.equals(desired),'Offset camera-volume ray catches the edge');assert.ok(visible(target,safe,[obstruction]));
});

test('near-wall target gets an outside view and a prior safe viewpoint remains stable',()=>{
 const obstruction=wall();const nearTarget=new Vector3(0,1,3.4),behind=new Vector3(0,3,8);
 const first=chooseSafeCamera(nearTarget,behind,[obstruction]);assert.ok(visible(nearTarget,first,[obstruction]));
 const second=chooseSafeCamera(nearTarget,behind,[obstruction],{previousPosition:first});assert.ok(first.equals(second));
});

test('transformed and instanced architecture participates in occlusion checks',()=>{
 const instance=new InstancedMesh(new BoxGeometry(8,10,.5),new MeshBasicMaterial(),1);
 instance.setMatrixAt(0,new Matrix4().makeTranslation(0,5,4));instance.updateMatrixWorld();
 const safe=chooseSafeCamera(target,desired,[instance]);assert.ok(!safe.equals(desired));assert.ok(visible(target,safe,[instance]));
});

test('large batched meshes use exact nearby triangles rather than their broad bounding box',()=>{
 const triangles=[];
 for(let i=0;i<180;i++){const geometry=new BoxGeometry(1,2,1).toNonIndexed();geometry.translate(30+(i%18)*2,1,Math.floor(i/18)*2);triangles.push(geometry);}
 const obstruction=wall();const blockedGeometry=obstruction.geometry.toNonIndexed();blockedGeometry.applyMatrix4(obstruction.matrixWorld);triangles.push(blockedGeometry);
 const batch=new Mesh(mergeGeometries(triangles),new MeshBasicMaterial());batch.updateMatrixWorld();
 const safe=chooseSafeCamera(target,desired,[batch]);assert.ok(visible(target,safe,[batch]));
 const clearTarget=new Vector3(15,1,0),clearDesired=new Vector3(15,4,8);
 const clear=chooseSafeCamera(clearTarget,clearDesired,[batch]);assert.ok(clear.equals(clearDesired),'Empty space inside aggregate bounds stays clear');
});

test('moving an occluder invalidates bounds and no-occluder fallback is finite',()=>{
 const obstruction=wall();assert.ok(!chooseSafeCamera(target,desired,[obstruction]).equals(desired));
 obstruction.position.x=30;assert.ok(chooseSafeCamera(target,desired,[obstruction]).equals(desired));
 const empty=chooseSafeCamera(target,desired,[]);assert.ok(empty.equals(desired));assert.ok([empty.x,empty.y,empty.z].every(Number.isFinite));
});
