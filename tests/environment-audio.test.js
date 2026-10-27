import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {environmentAudio} from '../src/environment-audio.js';
test('vehicle sound distance and stereo pan follow scene and camera positions',()=>{const listener=new T.Vector3(),train=new T.Vector3(6,0,8),drone={position:new T.Vector3(-5,2,0),distance:Math.sqrt(29),speed:2},q=new T.Quaternion(),r=environmentAudio({listener,train,drone,trainSpeed:4,cameraQuaternion:q});assert.equal(r.trainDistance,10);assert.equal(r.trainPan,.5);assert.equal(r.dronePan,-.5);assert.equal(r.trainSpeed,4);assert.equal(r.droneSpeed,2);assert.deepEqual(train.toArray(),[6,0,8]);const rotated=environmentAudio({listener,train,cameraQuaternion:q.setFromAxisAngle(new T.Vector3(0,1,0),Math.PI)});assert.ok(rotated.trainPan<0);assert.equal(rotated.droneDistance,undefined);});
test('stereo pan is bounded and bird activity follows lighting',()=>{const r=environmentAudio({listener:new T.Vector3(),train:new T.Vector3(1000,0,0),cameraQuaternion:new T.Quaternion(),braking:true,day:true});assert.equal(r.trainPan,1);assert.equal(r.birdActivity,.85);assert.equal(r.braking,true);});
