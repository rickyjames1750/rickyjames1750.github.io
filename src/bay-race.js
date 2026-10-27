import { CatmullRomCurve3, Vector3 } from 'three';
import { project } from './geography.js';

const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const finite=(n,fallback=0)=>Number.isFinite(n)?n:fallback;
const wrap=n=>((n%1)+1)%1;

/** A compressed scenic circuit, following the Peninsula south and the East Bay north. */
export const RACE_PLACES=Object.freeze([
 {id:'sf',name:'San Francisco',lon:-122.450,lat:37.773},
 {id:'south-sf',name:'South San Francisco',lon:-122.442,lat:37.663},
 {id:'san-mateo',name:'San Mateo',lon:-122.354,lat:37.563},
 {id:'redwood',name:'Redwood City',lon:-122.259,lat:37.483},
 {id:'palo-alto',name:'Palo Alto',lon:-122.223,lat:37.445},
 {id:'mountain-view',name:'Mountain View',lon:-122.097,lat:37.370},
 {id:'south-bay',name:'South Bay',lon:-121.973,lat:37.350},
 {id:'fremont',name:'Fremont',lon:-121.967,lat:37.531},
 {id:'hayward',name:'Hayward',lon:-122.107,lat:37.663},
 {id:'oakland',name:'Oakland',lon:-122.264,lat:37.805},
 {id:'bay-bridge',name:'Bay Bridge',lon:-122.348,lat:37.811},
].map(p=>Object.freeze(p)));

/** Height is configurable so the optional scenic viaduct clears the portfolio below. */
export function createRaceCurve({height=1.6}={}) {
 const coordinates=[
  [-122.450,37.773],[-122.449,37.724],[-122.442,37.663],
  [-122.407,37.607],[-122.354,37.563],[-122.308,37.520],
  [-122.259,37.483],[-122.223,37.445],[-122.171,37.374],
  [-122.097,37.370],[-122.024,37.358],[-121.973,37.350],
  [-121.941,37.393],[-121.944,37.458],[-121.967,37.531],
  [-122.026,37.601],[-122.107,37.663],[-122.192,37.741],
  [-122.264,37.805],[-122.304,37.816],[-122.348,37.811],
  [-122.389,37.839],[-122.440,37.839],[-122.475,37.815],[-122.466,37.795],
 ];
 const guide=new CatmullRomCurve3(coordinates.map(c=>{const p=project(...c);return new Vector3(p.x,finite(height,1.6),p.z);}),true,'centripetal');
 // Arc-distance smoothing gives the broad roadway a safe inner bend at every corner.
 const guidePoints=guide.getSpacedPoints(320).slice(0,-1);
 const rounded=guidePoints.map((_,i)=>{const point=new Vector3();let weight=0;for(let j=-10;j<=10;j++){const w=Math.exp(-.5*(j/4)**2);point.addScaledVector(guidePoints[(i+j+guidePoints.length)%guidePoints.length],w);weight+=w;}point.multiplyScalar(1/weight);point.y=finite(height,1.6);return point;});
 const curve=new CatmullRomCurve3(rounded,true,'centripetal');
 curve.arcLengthDivisions=2400;curve.updateArcLengths();
 // Each named chapter is assigned to its nearest arc-distance point, not a control-point index.
 const samples=curve.getSpacedPoints(2400);
 curve.racePlaces=RACE_PLACES.map(place=>{
  const p=project(place.lon,place.lat);let nearest=0,best=Infinity;
  samples.forEach((s,i)=>{const d=(s.x-p.x)**2+(s.z-p.z)**2;if(d<best){best=d;nearest=i;}});
  return {...place,x:p.x,z:p.z,progress:nearest/2400};
 }).sort((a,b)=>a.progress-b.progress);
 return curve;
}

export function raceCity(progress,places=[]) {
 const p=wrap(finite(progress));let current=places[0]?.name||'San Francisco';
 for(const place of places){if(place.progress>p)break;current=place.name;}
 return current;
}

/** A soft side-step resolves contact without awarding distance or stopping a new player. */
export function resolveRaceContact(player,rivals,{length=400,dt=1/60}={}) {
 const result={lane:clamp(finite(player?.lane),-2.55,2.55),speed:Math.max(0,finite(player?.speed)),hit:false,intensity:0};
 if(!Number.isFinite(dt)||dt<=0||!Number.isFinite(player?.distance)||player.finished)return result;
 dt=Math.min(dt,.1);length=Math.max(20,finite(length,400));
 for(const rival of rivals){
  if(rival.finished||!Number.isFinite(rival.distance))continue;
  const difference=Math.abs(player.distance-rival.distance)%length,longitudinal=Math.min(difference,length-difference);
  if(longitudinal>=2.12||Math.abs(result.lane-rival.lane)>=1.05)continue;
  let direction=Math.sign(result.lane-rival.lane)||(result.lane>0?-1:1);
  let target=rival.lane+direction*1.12;
  if(target< -2.55||target>2.55){direction*=-1;target=rival.lane+direction*1.12;}
  result.lane=clamp(result.lane+(target-result.lane)*(1-Math.exp(-18*dt)),-2.55,2.55);
  result.speed*=Math.exp(-.75*dt);result.hit=true;
  result.intensity=Math.max(result.intensity,clamp(.4+Math.abs(finite(player.speed)-finite(rival.speed))*.025,.4,.75));
 }
 return result;
}

const DRIVER_SPECS=Object.freeze([
 {id:'you',name:'You',color:'#b9f5cf',base:1,lane:0},
 {id:'nova',name:'Nova',color:'#f7b168',base:1.025,lane:-1.8},
 {id:'milo',name:'Milo',color:'#74c9f4',base:1.006,lane:.2},
 {id:'rio',name:'Rio',color:'#db9ae7',base:.982,lane:1.8},
]);

/**
 * Assisted arcade racing: everyone advances along the same measured circuit.
 * Steering chooses a lane; automatic acceleration and soft rails keep new players
 * on course. Laps can only advance by travelling the complete ordered distance.
 */
export function createBayRace({length=400,laps=3,lapSeconds=32,places=[],onEvent=()=>{}}={}) {
 length=Math.max(20,finite(length,400));laps=clamp(Math.floor(finite(laps,3)),1,9);lapSeconds=clamp(finite(lapSeconds,32),15,90);
 const baseSpeed=length/lapSeconds,total=length*laps;
 let phase='idle',countdown=3,elapsed=0,drivers=[],lastLap=0,lapStarted=0,bestLap=null,boostEnergy=1,boosting=false,boostReady=true,bumpCooldown=0;
 const emit=(type,data={})=>onEvent({type,...data});
 function makeDrivers(){return DRIVER_SPECS.map((s,i)=>({...s,distance:-i*2||0,progress:wrap(-i*2/length),lap:1,speed:0,finished:false,finishTime:null,place:i+1}));}
 function ordered(){return [...drivers].sort((a,b)=>{
  if(a.finished&&b.finished)return a.finishTime-b.finishTime||DRIVER_SPECS.findIndex(d=>d.id===a.id)-DRIVER_SPECS.findIndex(d=>d.id===b.id);
  if(a.finished!==b.finished)return a.finished?-1:1;
  return b.distance-a.distance||DRIVER_SPECS.findIndex(d=>d.id===a.id)-DRIVER_SPECS.findIndex(d=>d.id===b.id);
 });}
 function state(){
  const standings=ordered().map((d,i)=>({...d,place:i+1}));
  const player=standings.find(d=>d.id==='you')||null;
  return {phase,countdown:phase==='countdown'?Math.ceil(countdown-1e-8):0,elapsed,lap:player?.lap||1,laps,place:player?.place||1,
   player,rivals:drivers.filter(d=>d.id!=='you').map(d=>({...d,place:standings.find(s=>s.id===d.id)?.place||1})),standings,
   city:raceCity(player?.progress||0,places),finishedTime:player?.finishTime??null,bestLap,boostEnergy,boosting,length,totalDistance:total};
 }
 function cancel(){phase='idle';drivers=[];countdown=3;elapsed=0;boosting=false;boostEnergy=1;boostReady=true;bestLap=null;lastLap=0;lapStarted=0;bumpCooldown=0;return state();}
 function start(){phase='countdown';countdown=3;elapsed=0;drivers=makeDrivers();lastLap=0;lapStarted=0;bestLap=null;boostEnergy=1;boosting=false;boostReady=true;bumpCooldown=0;emit('countdown',{value:3});return state();}
 function advance(dt,input){
  if(phase==='countdown'){
   const previous=Math.ceil(countdown-1e-8);countdown=Math.max(0,countdown-dt);
   if(countdown>1e-8&&Math.ceil(countdown-1e-8)!==previous)emit('countdown',{value:Math.ceil(countdown-1e-8)});
   if(countdown<=1e-9){countdown=0;phase='racing';emit('go');}
   return;
  }
  if(phase!=='racing')return;
  const previousElapsed=elapsed;elapsed+=dt;bumpCooldown=Math.max(0,bumpCooldown-dt);
  const player=drivers[0],steer=clamp(finite(input.steer),-1,1),brake=Boolean(input.brake);
  player.lane=clamp(player.lane+steer*3.4*dt,-2.55,2.55);
  const edge=Math.abs(player.lane)>2.43;
  if(edge&&Math.abs(steer)>.1&&bumpCooldown===0){emit('bump',{intensity:.35});bumpCooldown=.7;}
  if(boostEnergy<=.015)boostReady=false;else if(boostEnergy>=.24)boostReady=true;
  boosting=Boolean(input.boost)&&boostReady&&!brake&&!edge;
  boostEnergy=clamp(boostEnergy+(boosting?-.24:.13)*dt,0,1);
  const line=Math.sin(player.progress*Math.PI*8)*1.45;
  const clean=1-clamp(Math.abs(player.lane-line)/3,0,1);
  let target=baseSpeed*(.985+clean*.04)*(boosting?1.34:1)*(edge?.61:1);
  if(brake)target=0;
  const response=brake?22:3.8;
  player.speed+=(target-player.speed)*(1-Math.exp(-response*dt));
  for(let i=1;i<drivers.length;i++){
   const d=drivers[i];if(d.finished){d.speed=0;continue;}
   const wobble=Math.sin(elapsed*.58+i*1.7)*.014;
   const targetLane=Math.sin(d.progress*Math.PI*6+i*2)*1.7;
   d.lane+=(targetLane-d.lane)*(1-Math.exp(-1.5*dt));
   const desired=baseSpeed*(d.base+wobble);
   d.speed+=(desired-d.speed)*(1-Math.exp(-3.2*dt));
  }
  const contact=resolveRaceContact(player,drivers.slice(1),{length,dt});
  player.lane=contact.lane;player.speed=contact.speed;
  if(contact.hit&&bumpCooldown===0){emit('bump',{intensity:contact.intensity,source:'rival'});bumpCooldown=.7;}
  for(const d of drivers){
   if(d.finished)continue;
   const previous=d.distance;d.distance=Math.min(total,d.distance+Math.max(0,d.speed)*dt);
   d.progress=wrap(d.distance/length);d.lap=Math.min(laps,Math.max(1,Math.floor(Math.max(0,d.distance)/length)+1));
   if(d.distance>=total){
    const fraction=d.distance>previous?(total-previous)/(d.speed*dt):1;
    d.finished=true;d.finishTime=previousElapsed+clamp(fraction,0,1)*dt;d.speed=0;d.progress=0;d.lap=laps;
   }
  }
  const completed=Math.min(laps,Math.floor(Math.max(0,player.distance)/length));
  if(completed>lastLap){
   const time=(player.finished?player.finishTime:elapsed)-lapStarted;bestLap=bestLap===null?time:Math.min(bestLap,time);lapStarted=player.finished?player.finishTime:elapsed;lastLap=completed;
   if(completed<laps)emit('lap',{lap:completed+1,laps,lapTime:time});
  }
  if(player.finished){phase='finished';boosting=false;emit('finish',{place:state().place,time:player.finishTime,bestLap});}
 }
 function update(dt,input={}){
  if(!Number.isFinite(dt)||dt<=0||input.paused||phase==='idle'||phase==='finished')return state();
  // Ignore elapsed background time; simulating it would skip the race or countdown.
  if(dt>.5)return state();
  let remaining=Math.min(dt,.1);
  while(remaining>1e-9){const step=Math.min(remaining,1/120);advance(step,input);remaining-=step;}
  return state();
 }
 return {start,update,state,cancel};
}
