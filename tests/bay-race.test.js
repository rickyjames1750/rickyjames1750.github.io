import test from 'node:test';
import assert from 'node:assert/strict';
import { createBayRace,createRaceCurve,raceCity,resolveRaceContact } from '../src/bay-race.js';
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
 const events=[],r=createBayRace({onEvent:e=>events.push(e)});assert.equal(r.state().phase,'idle');r.start();const initial=r.state().player.distance;
 advance(r,1);assert.equal(r.state().countdown,2);assert.equal(r.state().player.distance,initial);
 advance(r,2,{paused:true});assert.equal(r.state().countdown,2);advance(r,2.1);assert.equal(r.state().phase,'racing');assert.ok(r.state().player.distance>0);
 assert.deepEqual(events.filter(e=>e.type==='countdown').map(e=>e.value),[3,2,1]);assert.equal(events.filter(e=>e.type==='go').length,1);
});

test('three rivals race to a finite three-lap result with one finish event',()=>{
 const events=[],r=createBayRace({length:360,onEvent:e=>events.push(e)});go(r);const final=advance(r,120,{boost:true});
 assert.equal(final.phase,'finished');assert.equal(final.rivals.length,3);assert.equal(final.lap,3);assert.equal(final.player.distance,1080);assert.ok(final.finishedTime>75&&final.finishedTime<105);assert.ok(final.place>=1&&final.place<=4);assert.equal(events.filter(e=>e.type==='finish').length,1);assert.deepEqual(events.filter(e=>e.type==='lap').map(e=>e.lap),[2,3]);assert.ok(final.bestLap>20&&final.bestLap<40);
 const old=JSON.stringify(final);advance(r,3);assert.equal(JSON.stringify(r.state()),old);
});

test('soft rails prevent leaving the track and braking cannot reverse or award a shortcut lap',()=>{
 const r=createBayRace();go(r);advance(r,8,{steer:1});assert.equal(r.state().player.lane,2.55);const before=r.state().player.distance;
 advance(r,2,{brake:true,steer:-1});const stopped=r.state();assert.ok(stopped.player.speed<.001);assert.ok(stopped.player.distance>=before);assert.equal(stopped.lap,1);assert.ok(stopped.player.lane>=-2.55&&stopped.player.lane<=2.55);
 r.update(Infinity,{boost:true});r.update(50,{boost:true});r.update(-1);assert.deepEqual(r.state(),stopped);
});

test('boost can earn the win while exaggerated edge driving loses pace',()=>{
 const clean=createBayRace(),edge=createBayRace();go(clean);go(edge);advance(clean,110,{boost:true});advance(edge,110,{steer:1});
 assert.equal(clean.state().place,1);assert.ok(edge.state().place>clean.state().place);assert.ok(edge.state().player.distance<clean.state().player.distance);
});

test('soft car contact separates overlapping racers without stopping or teleporting',()=>{
 const player={distance:40,lane:0,speed:14},rival={distance:41,lane:.1,speed:13};
 const distance=player.distance;
 let hits=0;
 for(let i=0;i<24;i++){const result=resolveRaceContact(player,[rival],{length:400,dt:1/120});if(result.hit)hits++;player.lane=result.lane;player.speed=result.speed;}
 assert.ok(hits>0);assert.ok(Math.abs(player.lane-rival.lane)>=1.05,'Side step clears the visible car width');
 assert.equal(player.distance,distance,'A bump never grants course progress');assert.ok(player.speed>11&&player.speed<14,'Only a small speed scrub');
 const wall=resolveRaceContact({distance:40,lane:2.5,speed:14},[{distance:41,lane:2.4,speed:14}],{dt:.1});
 assert.ok(wall.lane<2.5&&wall.lane>=-2.55,'Near a rail, jostle pushes back onto the track');
 const wrapped=resolveRaceContact({distance:400.2,lane:0,speed:14},[{distance:399.5,lane:0,speed:14}],{length:400});assert.equal(wrapped.hit,true,'Contact works across the finish seam');
});

test('race contact cues are bounded and do not interfere with finish rankings',()=>{
 const events=[],r=createBayRace({onEvent:e=>events.push({...e,time:r.state().elapsed})});go(r);advance(r,115,{boost:true});
 const bumps=events.filter(e=>e.type==='bump'&&e.source==='rival');assert.ok(bumps.length>0);
 for(let i=1;i<bumps.length;i++)assert.ok(bumps[i].time-bumps[i-1].time>=.69,'Contact feedback has a cooldown');
 assert.equal(r.state().phase,'finished');assert.equal(r.state().place,1);assert.ok(r.state().finishedTime<100);
});

test('an empty boost recharges before reigniting instead of flickering every frame',()=>{
 const r=createBayRace();go(r);let transitions=0,previous=false;
 for(let i=0;i<1800;i++){const s=r.update(1/60,{boost:true});if(s.boosting!==previous){transitions++;previous=s.boosting;}assert.ok(s.boostEnergy>=0&&s.boostEnergy<=1);}
 assert.ok(transitions>=4&&transitions<30,`Boost has distinct finite bursts: ${transitions}`);
});

test('small and large rendering steps produce the same race result',()=>{
 const a=createBayRace(),b=createBayRace();a.start();b.start();advance(a,95,{boost:true},1/120);advance(b,95,{boost:true},1/30);
 assert.equal(a.state().phase,b.state().phase);assert.ok(Math.abs(a.state().finishedTime-b.state().finishedTime)<.03);assert.equal(a.state().place,b.state().place);
});

test('cancel and restart clear ranking, boost, lap times, and motion',()=>{
 const r=createBayRace();go(r);advance(r,45,{boost:true});assert.ok(r.state().lap>1);r.cancel();assert.equal(r.state().phase,'idle');assert.equal(r.state().player,null);assert.equal(r.state().boostEnergy,1);assert.equal(r.state().bestLap,null);
 r.start();assert.equal(r.state().lap,1);assert.equal(r.state().boostEnergy,1);assert.equal(r.state().bestLap,null);assert.equal(r.state().elapsed,0);assert.equal(r.state().player.speed,0);
});
