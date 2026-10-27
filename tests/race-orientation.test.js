import test from 'node:test';
import assert from 'node:assert/strict';
import {landscapeRequired,raceRotationBlocked} from '../src/race-orientation.js';
test('phone and touch tablet races require landscape, desktop browsing does not',()=>{
 assert.equal(landscapeRequired({width:390,height:844}),true);
 assert.equal(landscapeRequired({width:844,height:390}),false);
 assert.equal(landscapeRequired({width:834,height:1112,coarse:true}),true);
 assert.equal(landscapeRequired({width:1000,height:1200}),false);
 assert.equal(landscapeRequired({width:1280,height:800}),false);
 for(const width of [0,-1,NaN,Infinity])assert.equal(landscapeRequired({width,height:844}),false);
});
test('rotation pauses playing and countdown, while finished results remain readable in portrait',()=>{
 const phone={width:390,height:844};
 for(const phase of ['countdown','racing'])assert.equal(raceRotationBlocked(phase,phone),true);
 for(const phase of ['idle','finished'])assert.equal(raceRotationBlocked(phase,phone),false);
 assert.equal(raceRotationBlocked('racing',{width:844,height:390}),false);
});
