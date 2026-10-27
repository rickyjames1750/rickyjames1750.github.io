import test from 'node:test';
import assert from 'node:assert/strict';
import { createBayRace,createRaceCurve,raceCity,resolveRaceContact,RACE_LANE_LIMIT,generateBoostPads,boostPadContact } from '../src/bay-race.js';
import { project } from '../src/geography.js';

function advance(race,seconds,input={},step=1/60){for(let t=0;t<seconds-1e-8;t+=step)race.update(Math.min(step,seconds-t),input);return race.state();}
function go(race){race.start();advance(race,3.1);}

test('Bay circuit is closed, travels down the Peninsula and back through Fremont and Oakland',()=>{
 const c=createRaceCurve({height:9});assert.ok(c.closed);assert.ok(c.getPointAt(0).distanceTo(c.getPointAt(1))<1e-8);
 const names=c.racePlaces.map(p=>p.name);assert.ok(names.indexOf('Mountain View')<names.indexOf('Fremont'));assert.ok(names.indexOf('Fremont')<names.indexOf('Oakland'));assert.ok(names.indexOf('Oakland')<names.indexOf('Bay Bridge'));
 assert.ok(c.getLength()>300&&c.getLength()<500);
 for(let i=0;i<=300;i++){const p=c.getPointAt(i/300);assert.equal(p.y,9);assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.z));}
 for(const [lon,lat,radius]of [[-122.3968,37.7897,7],[-122.1697,37.4275,4]]){const p=project(lon,lat);for(let i=0;i<1800;i++){const s=c.getPointAt(i/1800);assert.ok(Math.hypot(p.x-s.x,p.z-s.z)>radius+4.2,'Road clears tall landmarks');}}
 assert.equal(raceCity(c.racePlaces.find(p=>p.name==='Oakland').progress+.001,c.racePlaces),'Oakland');
});

test('the complete road ribbon has broad corners and cannot overlap another part of the circuit',()=>{
 const c=createRaceCurve({height:9}),samples=c.getSpacedPoints(1600).slice(0,-1),length=c.getLength(),n=samples.length;
 let minimumRadius=Infinity,minimumSeparation=Infinity;
 for(let i=0;i<n;i++){
  const a=samples[(i+n-1)%n],b=samples[i],d=samples[(i+1)%n];
  const twiceArea=Math.abs((b.x-a.x)*(d.z-a.z)-(b.z-a.z)*(d.x-a.x));
  if(twiceArea>1e-12)minimumRadius=Math.min(minimumRadius,a.distanceTo(b)*b.distanceTo(d)*a.distanceTo(d)/(2*twiceArea));
  for(let j=i+1;j<n;j++){
   const arcDistance=Math.min(j-i,n-j+i)*length/n;
   if(arcDistance>=20)minimumSeparation=Math.min(minimumSeparation,b.distanceTo(samples[j]));
  }
 }
 assert.ok(minimumRadius>=6.2,`Inner-road radius stays safe: ${minimumRadius}`);
 assert.ok(minimumSeparation>=10.3,`Separate roadway arcs cannot intersect: ${minimumSeparation}`);
});

test('countdown grid spaces all rivals behind the player on the same circuit',()=>{
 const length=420,r=createBayRace({length});r.start();const s=r.state();
 assert.equal(s.player.distance,0);assert.equal(s.player.progress,0);
 assert.deepEqual(s.rivals.map(d=>d.distance),[-2,-4,-6]);
 assert.deepEqual(s.rivals.map(d=>d.place),[2,3,4]);
 for(const d of s.rivals)assert.ok(Math.abs((1-d.progress)*length+ d.distance)<1e-10);
 advance(r,2);assert.deepEqual(r.state().rivals.map(d=>d.progress),s.rivals.map(d=>d.progress));
});

test('countdown starts once, holds position, and pauses without consuming race time',()=>{
 const events=[],r=createBayRace({seed:551,onEvent:e=>events.push(e)});assert.equal(r.state().phase,'idle');r.start();const initial=r.state().player.distance;
 advance(r,1);assert.equal(r.state().countdown,2);assert.equal(r.state().player.distance,initial);
 advance(r,2,{paused:true});assert.equal(r.state().countdown,2);advance(r,2.1);assert.equal(r.state().phase,'racing');assert.ok(r.state().player.distance>0);
 assert.deepEqual(events.filter(e=>e.type==='countdown').map(e=>e.value),[3,2,1]);assert.equal(events.filter(e=>e.type==='go').length,1);
});

test('three rivals race to a finite three-lap result with one finish event',()=>{
 const events=[],r=createBayRace({seed:551,length:360,onEvent:e=>events.push(e)});go(r);const final=advance(r,120,{boost:true});
 assert.equal(final.phase,'finished');assert.equal(final.rivals.length,3);assert.equal(final.lap,3);assert.equal(final.player.distance,1080);assert.ok(final.finishedTime>75&&final.finishedTime<105);assert.ok(final.place>=1&&final.place<=4);assert.equal(events.filter(e=>e.type==='finish').length,1);assert.deepEqual(events.filter(e=>e.type==='lap').map(e=>e.lap),[2,3]);assert.ok(final.bestLap>20&&final.bestLap<40);
 const old=JSON.stringify(final);advance(r,3);assert.equal(JSON.stringify(r.state()),old);
});

test('soft rails prevent leaving the track and braking cannot reverse or award a shortcut lap',()=>{
 const r=createBayRace({seed:551});go(r);advance(r,8,{steer:1});assert.equal(r.state().player.lane,RACE_LANE_LIMIT);const before=r.state().player.distance;
 advance(r,2,{brake:true,steer:-1});const stopped=r.state();assert.ok(stopped.player.speed<.001);assert.ok(stopped.player.distance>=before);assert.equal(stopped.lap,1);assert.ok(stopped.player.lane>=-RACE_LANE_LIMIT&&stopped.player.lane<=RACE_LANE_LIMIT);
 r.update(Infinity,{boost:true});r.update(50,{boost:true});r.update(-1);assert.deepEqual(r.state(),stopped);
});

test('outer lanes keep full pace while boost remains available at the usable road edge',()=>{
 const left=createBayRace({seed:551,padCount:0}),right=createBayRace({seed:551,padCount:0});go(left);go(right);advance(left,4,{steer:-1,boost:true});advance(right,4,{steer:1,boost:true});
 assert.equal(Math.abs(left.state().player.lane),RACE_LANE_LIMIT);assert.equal(right.state().player.lane,RACE_LANE_LIMIT);assert.ok(left.state().player.speed>400/32*1.2);assert.ok(right.state().player.speed>400/32*1.2);
 assert.ok(Math.abs(left.state().player.speed-right.state().player.speed)<.03,'No hidden outer-lane speed penalty');
});

test('soft car contact separates overlapping racers without stopping or teleporting',()=>{
 const player={distance:40,lane:0,speed:14},rival={distance:41,lane:.1,speed:13};
 const distance=player.distance;
 let hits=0;
 for(let i=0;i<24;i++){const result=resolveRaceContact(player,[rival],{length:400,dt:1/120});if(result.hit)hits++;player.lane=result.lane;player.speed=result.speed;}
 assert.ok(hits>0);assert.ok(Math.abs(player.lane-rival.lane)>=1.05,'Side step clears the visible car width');
 assert.equal(player.distance,distance,'A bump never grants course progress');assert.ok(player.speed>11&&player.speed<14,'Only a small speed scrub');
 const wall=resolveRaceContact({distance:40,lane:3.4,speed:14},[{distance:41,lane:3.3,speed:14}],{dt:.1});
 assert.ok(wall.lane<3.4&&wall.lane>=-RACE_LANE_LIMIT,'Near a rail, jostle pushes back onto the track');
 const wrapped=resolveRaceContact({distance:400.2,lane:0,speed:14},[{distance:399.5,lane:0,speed:14}],{length:400});assert.equal(wrapped.hit,true,'Contact works across the finish seam');
});

test('race contact cues are bounded and do not interfere with finish rankings',()=>{
 const events=[],r=createBayRace({seed:551,onEvent:e=>events.push({...e,time:r.state().elapsed})});go(r);advance(r,115,{boost:true});
 const bumps=events.filter(e=>e.type==='bump'&&e.source==='rival');assert.ok(bumps.length>0);
 for(let i=1;i<bumps.length;i++)assert.ok(bumps[i].time-bumps[i-1].time>=.69,'Contact feedback has a cooldown');
 assert.equal(r.state().phase,'finished');assert.equal(r.state().place,1);assert.ok(r.state().finishedTime<100);
});

test('an empty boost recharges before reigniting instead of flickering every frame',()=>{
 const r=createBayRace({seed:551});go(r);let transitions=0,previous=false;
 for(let i=0;i<1800;i++){const s=r.update(1/60,{boost:true});if(s.boosting!==previous){transitions++;previous=s.boosting;}assert.ok(s.boostEnergy>=0&&s.boostEnergy<=1);}
 assert.ok(transitions>=4&&transitions<30,`Boost has distinct finite bursts: ${transitions}`);
});

test('small and large rendering steps produce the same race result',()=>{
 const a=createBayRace({seed:551}),b=createBayRace({seed:551});a.start();b.start();advance(a,95,{boost:true},1/120);advance(b,95,{boost:true},1/30);
 assert.equal(a.state().phase,b.state().phase);assert.ok(Math.abs(a.state().finishedTime-b.state().finishedTime)<.03);assert.equal(a.state().place,b.state().place);
});

test('cancel and restart clear ranking, boost, lap times, and motion',()=>{
 const r=createBayRace({seed:551});go(r);advance(r,45,{boost:true});assert.ok(r.state().lap>1);r.cancel();assert.equal(r.state().phase,'idle');assert.equal(r.state().player,null);assert.equal(r.state().boostEnergy,1);assert.equal(r.state().bestLap,null);
 r.start();assert.equal(r.state().lap,1);assert.equal(r.state().boostEnergy,1);assert.equal(r.state().bestLap,null);assert.equal(r.state().elapsed,0);assert.equal(r.state().player.speed,0);
});

test('randomized pad layouts are seeded, lane-specific, bounded, and fresh for each new race',()=>{
 const first=generateBoostPads(91),same=generateBoostPads(91),different=generateBoostPads(92);
 assert.deepEqual(first,same);assert.notDeepEqual(first,different);assert.equal(first.length,12);assert.equal(generateBoostPads(91,100).length,16);
 for(const pad of first){assert.ok(pad.progress>.03&&pad.progress<.97);assert.ok([-2.75,0,2.75].includes(pad.lane));assert.equal(pad.width,1.8);}
 const a=createBayRace({seed:91}),b=createBayRace({seed:91});a.start();b.start();assert.deepEqual(a.state().pads,b.state().pads);const old=a.state().pads;
 a.cancel();a.start();b.cancel();b.start();assert.deepEqual(a.state().pads,b.state().pads);assert.notDeepEqual(a.state().pads,old);
});

test('swept boost pad contact requires actual lane overlap including the finish seam',()=>{
 const pad={progress:.1,lane:2.75,width:1.8,length:2.8};
 assert.equal(boostPadContact({distance:38,lane:0},{distance:44,lane:0},pad,400),null);
 assert.equal(boostPadContact({distance:38,lane:2.75},{distance:44,lane:2.75},pad,400).cycle,0);
 assert.equal(boostPadContact({distance:38,lane:0},{distance:41,lane:3.1},pad,400).cycle,0,'Swept diagonal entry counts');
 assert.equal(boostPadContact({distance:397,lane:0},{distance:402,lane:0},{...pad,progress:0,lane:0},400).cycle,1);
 assert.equal(boostPadContact({distance:400,lane:2.75},{distance:401,lane:2.75},{...pad,progress:0,lane:0},400),null);
 assert.equal(boostPadContact({distance:NaN,lane:0},{distance:4,lane:0},pad,400),null);
});

test('a matching pad grants finite speed while a different lane grants no boost',()=>{
 const events=[],hit=createBayRace({seed:12,padLayout:[{progress:.005,lane:0}],onEvent:e=>events.push(e)}),miss=createBayRace({seed:12,padLayout:[{progress:.005,lane:2.75}]});
 go(hit);go(miss);advance(hit,1.3);advance(miss,1.3);
 assert.equal(hit.state().player.padHits,1);assert.equal(miss.state().player.padHits,0);assert.ok(hit.state().player.padBoost>0);assert.equal(miss.state().player.padBoost,0);
 assert.ok(hit.state().player.speed>miss.state().player.speed*1.2);assert.equal(events.filter(e=>e.type==='pad').length,1);
 advance(hit,2,{brake:true});assert.equal(hit.state().player.padBoost,0);assert.equal(hit.state().player.padHits,1,'Staying around a pad cannot retrigger it');
});

test('pads can boost rivals and can be collected once per complete lap at a lower frame rate',()=>{
 const events=[],r=createBayRace({seed:51,padLayout:[{progress:.1,lane:0,width:8,length:4}],onEvent:e=>events.push(e)});go(r);advance(r,75,{},1/20);
 const state=r.state();assert.ok(state.player.padHits>=2);assert.ok(state.rivals.some(d=>d.padHits>=2));
 assert.equal(events.filter(e=>e.type==='pad').length,state.player.padHits);assert.ok(state.player.padHits<=3,'At most one hit per lap despite rectangle occupancy over many substeps');
});
