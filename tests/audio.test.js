import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createAmbience } from '../src/audio.js';

let contexts, instances, storage, mixStorage, documentListeners, behavior;
const parameter = () => ({value:0,events:[],setTargetAtTime(value,time,constant){this.value=value;this.events.push({kind:'target',value,time,constant});},setValueAtTime(value,time){this.value=value;this.events.push({kind:'set',value,time});},cancelScheduledValues(){},linearRampToValueAtTime(value,time){this.events.push({kind:'linear',value,time});},exponentialRampToValueAtTime(value,time){this.events.push({kind:'exponential',value,time});}});
function audioNode() {
  return {gain:parameter(),frequency:parameter(),detune:parameter(),pan:parameter(),Q:parameter(),threshold:parameter(),knee:parameter(),ratio:parameter(),delayTime:parameter(),connections:[],
    connect(next){this.connections.push(next);return next;},disconnect(){},start(time){this.startedAt=time;},stop(time){this.stopped=true;this.stopTime=time;}};
}
function stream() {
  const track = {stopped:false,stop(){this.stopped=true;}};
  return {getTracks:()=>[track],clone:()=>stream()};
}
class AudioMock {
  constructor(){contexts.push(this);this.state='suspended';this.currentTime=0;this.sampleRate=200;this.destination=audioNode();this.events=new Map();this.oscillators=0;this.resumeCalls=0;this.pending=[];this.oscillatorNodes=[];this.filterNodes=[];this.bufferNodes=[];this.gainNodes=[];this.panNodes=[];}
  createGain(){const node=audioNode();this.gainNodes.push(node);return node;} createBiquadFilter(){const node=audioNode();this.filterNodes.push(node);return node;} createStereoPanner(){const node=audioNode();this.panNodes.push(node);return node;}
  createDynamicsCompressor(){return audioNode();} createConvolver(){return audioNode();} createDelay(){return audioNode();}
  createBufferSource(){const node=audioNode();this.bufferNodes.push(node);return node;} createMediaStreamDestination(){this.recordStream=stream();this.recordNode={stream:this.recordStream};return this.recordNode;}
  createOscillator(){this.oscillators++;const node=audioNode();this.oscillatorNodes.push(node);return node;}
  createBuffer(channels,length){return {getChannelData:()=>new Float32Array(length)};}
  addEventListener(name,fn){this.events.set(name,fn);} removeEventListener(name){this.events.delete(name);}
  change(state){this.state=state;this.events.get('statechange')?.();}
  resume(){this.resumeCalls++;if(behavior==='reject')return Promise.reject(new Error('NotAllowedError'));
    if(behavior==='blocked')return Promise.resolve();
    if(behavior==='pending')return new Promise(resolve=>this.pending.push(resolve));
    this.change('running');return Promise.resolve();}
  suspend(){this.change('suspended');return Promise.resolve();} close(){this.change('closed');return Promise.resolve();}
}
function make(){const value=createAmbience();instances.push(value);return value;}
beforeEach(()=>{
  contexts=[];instances=[];storage=new Map();mixStorage=new Map();documentListeners=new Map();behavior='allow';
  globalThis.window={AudioContext:AudioMock,sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},localStorage:{getItem:key=>mixStorage.get(key),setItem:(key,value)=>mixStorage.set(key,value)}};
  globalThis.document={hidden:false,addEventListener:(name,fn)=>documentListeners.set(name,fn),removeEventListener:name=>documentListeners.delete(name)};
});
afterEach(()=>{instances.forEach(value=>value.destroy());delete globalThis.window;delete globalThis.document;});

test('allowed autoplay starts once, and repeated entry/gesture starts do not duplicate the graph', async()=>{
  const audio=make();assert.equal(contexts.length,0);
  const values=await Promise.all([audio.start(),audio.start(),audio.start()]);
  assert.deepEqual(values,[true,true,true]);assert.equal(contexts.length,1);
  const oscillatorCount=contexts[0].oscillators;assert.ok(oscillatorCount>10);
  assert.equal(await audio.start(),true);assert.equal(contexts[0].oscillators,oscillatorCount);
  assert.equal(audio.isEnabled(),true);assert.equal(audio.state().blocked,false);
});

test('suspended autoplay is not reported as enabled, and a later gesture starts the same graph', async()=>{
  behavior='blocked';const audio=make();assert.equal(await audio.start(),false);
  assert.equal(audio.state().blocked,true);assert.equal(audio.isEnabled(),false);
  const count=contexts[0].oscillators;behavior='allow';assert.equal(await audio.start(),true);
  assert.equal(contexts.length,1);assert.equal(contexts[0].oscillators,count);assert.equal(audio.state().blocked,false);
});

test('a browser resume promise that never settles cannot hang UI or duplicate initialization', {timeout:3000}, async()=>{
  behavior='pending';const audio=make();
  assert.deepEqual(await Promise.all([audio.start(),audio.start()]),[false,false]);
  assert.equal(contexts.length,1);assert.equal(audio.state().attempting,false);
  const count=contexts[0].oscillators;behavior='allow';assert.equal(await audio.start(),true);
  assert.equal(contexts[0].oscillators,count);
});

test('mute is respected for this page while a fresh visit ignores legacy stored mute', async()=>{
  storage.set('bayward.sound.muted','true');const audio=make();
  assert.equal(audio.state().muted,false);assert.equal(storage.size,0);assert.equal(await audio.start(),true);
  assert.equal(audio.mute(),false);assert.equal(audio.state().muted,true);assert.equal(await audio.start(),false);
  document.hidden=true;documentListeners.get('visibilitychange')();document.hidden=false;documentListeners.get('visibilitychange')();
  assert.equal(audio.isEnabled(),false);
  const nextVisit=make();assert.equal(nextVisit.state().muted,false);assert.equal(await nextVisit.start(),true);
  assert.equal(await audio.enable(),true,'The explicit control can still unmute the current page');
});

test('muting during a pending autoplay attempt prevents its late completion from unmuting', async()=>{
  behavior='pending';const audio=make();const attempt=audio.start();audio.mute();
  contexts[0].change('running');contexts[0].pending.forEach(resolve=>resolve());
  assert.equal(await attempt,false);assert.equal(audio.isEnabled(),false);assert.equal(audio.state().muted,true);
});

test('visibility suspends sound and resumes only a previously requested unmuted score', async()=>{
  const audio=make();await audio.start();document.hidden=true;documentListeners.get('visibilitychange')();
  assert.equal(audio.isEnabled(),false);assert.equal(contexts[0].state,'suspended');
  document.hidden=false;documentListeners.get('visibilitychange')();await Promise.resolve();
  assert.equal(audio.isEnabled(),true);audio.setMotion(18,'train');audio.setPaused(true);audio.setMotion(NaN,'car');
  assert.equal(audio.isEnabled(),true,'pausing the vehicle preserves the score');
});

test('recorder stream clones have independent tracks, and teardown settles pending starts', async()=>{
  const audio=make();assert.equal(audio.getStream(),null);await audio.start();
  const first=audio.getStream(),second=audio.getStream();assert.notEqual(first,second);
  first.getTracks().forEach(track=>track.stop());assert.equal(second.getTracks()[0].stopped,false);
  assert.equal(contexts[0].recordStream.getTracks()[0].stopped,false);
  behavior='pending';contexts[0].change('suspended');const pending=audio.start();audio.destroy();
  assert.equal(await pending,false);assert.equal(contexts[0].recordStream.getTracks()[0].stopped,true);
  assert.equal(audio.state().available,false);assert.equal(await audio.enable(),false);
});

test('a denied or unavailable audio context fails quietly with honest state', async()=>{
  behavior='reject';const audio=make();assert.equal(await audio.start(),false);assert.equal(audio.isEnabled(),false);
  delete window.AudioContext;const unsupported=make();assert.equal(await unsupported.start(),false);
  assert.equal(unsupported.state().available,false);assert.equal(unsupported.state().contextState,'unavailable');
});

test('subscribers receive actual playback state and unsubscribe cleanly', async()=>{
  const audio=make(),seen=[];const unsubscribe=audio.subscribe(value=>seen.push(value.enabled));
  await audio.start();audio.mute();const transitions=seen.filter((value,index)=>index===0||value!==seen[index-1]);assert.deepEqual(transitions,[false,true,false]);
  unsubscribe();const count=seen.length;await audio.enable();assert.equal(seen.length,count);
});


test('spacecraft drive raises its layered pitch and load without constructing another audio graph',async()=>{
 const audio=make();await audio.start();const ctx=contexts[0],count=ctx.oscillators;
 ctx.currentTime=.12;audio.setMotion(6,'car',{acceleration:0,braking:false});
 const motionVoices=ctx.oscillatorNodes.filter(node=>node.frequency.events.some(event=>event.kind==='target'&&event.constant===.09)||node.frequency.events.some(event=>event.kind==='target'&&event.constant===.11));
 assert.equal(motionVoices.length,2,'Hover fundamental and glassy fifth respond to speed');
 const pitches=motionVoices.map(node=>node.frequency.value),gains=motionVoices.map(node=>node.connections[0].gain.value);
 ctx.currentTime=.24;audio.setMotion(18,'car',{acceleration:6,braking:false});
 motionVoices.forEach((node,index)=>{assert.ok(node.frequency.value>pitches[index]);assert.ok(node.connections[0].gain.value>gains[index]);});
 assert.ok(motionVoices.some(node=>node.frequency.value>700),'Whine remains audible on small speakers');
 assert.equal(ctx.oscillators,count);assert.equal(contexts.length,1);
 audio.setPaused(true);motionVoices.forEach(node=>assert.equal(node.connections[0].gain.value,0));
});

test('deceleration creates a regenerative swish and explicit braking telemetry is honored',async()=>{
 const audio=make();await audio.start();const ctx=contexts[0];
 const regen=ctx.filterNodes.find(node=>node.type==='bandpass'&&node.frequency.value===1800);assert.ok(regen);
 ctx.currentTime=.12;audio.setMotion(12,'car',{acceleration:0,braking:false});assert.equal(regen.connections[0].gain.value,0);
 ctx.currentTime=.24;audio.setMotion(5,'car');assert.ok(regen.connections[0].gain.value>0,'Inferred slowing activates regenerative air/whine');
 assert.ok(regen.frequency.value>1800);ctx.currentTime=.36;audio.setMotion(5,'car',{acceleration:0,braking:false});
 assert.equal(regen.connections[0].gain.value,0,'Steady speed releases the swish');
 audio.setMotion(5,'car',{braking:.7});assert.ok(regen.connections[0].gain.value>0);audio.setPaused(true);assert.equal(regen.connections[0].gain.value,0);
});

test('horn adds a short dual tone to the same speaker/recording mix and respects mute',async()=>{
 const audio=make();await audio.start();const ctx=contexts[0],before=ctx.oscillators;assert.equal(await audio.horn(),true);
 const notes=ctx.oscillatorNodes.slice(before);assert.equal(notes.length,2);assert.deepEqual(notes.map(note=>note.frequency.value),[349.2282,440]);
 assert.ok(notes.every(note=>note.stopTime-note.startedAt<.5));assert.equal(contexts.length,1);
 const reaches=(node,target,seen=new Set())=>{if(node===target)return true;if(seen.has(node))return false;seen.add(node);return(node.connections||[]).some(next=>reaches(next,target,seen));};
 assert.ok(notes.every(note=>reaches(note,ctx.destination)),'Horn shares the mastered output');
 assert.equal(await audio.horn(),false,'Repeated keydown cannot stack horns instantly');ctx.currentTime=.3;assert.equal(await audio.horn(),true);
 audio.mute();ctx.currentTime=.6;assert.equal(await audio.horn(),false,'Horn does not override a deliberate page mute');
});

test('fireball impacts remain distinct, rate limited, mastered into recordings, and honor mute and pause',async()=>{
 const audio=make();await audio.start();const ctx=contexts[0],before=ctx.oscillators,bufferCount=ctx.bufferNodes.length;
 assert.equal(await audio.impact(100),true);const note=ctx.oscillatorNodes[before],noise=ctx.bufferNodes[bufferCount];
 const reaches=(node,target,seen=new Set())=>{if(node===target)return true;if(seen.has(node))return false;seen.add(node);return(node.connections||[]).some(next=>reaches(next,target,seen));};
 assert.ok(reaches(note,ctx.destination)&&reaches(noise,ctx.recordNode),'Low thump and generated whoosh share the limited speaker and capture output');
 assert.ok(note.stopTime-note.startedAt<=.7&&noise.stopTime-noise.startedAt<=.7);assert.ok(noise.stopTime-noise.startedAt>.4);
 const envelope=noise.connections[0].connections[0],peak=envelope.gain.events.find(event=>event.kind==='linear').value;
 assert.ok(peak>=.15&&peak<=.16,'Explosion has a clear transient while leaving room for music and transport');
 assert.equal(await audio.impact(1),false,'Rapid contacts cannot stack impacts instantly');ctx.currentTime=.25;assert.equal(await audio.impact(.3),true);
 assert.equal(ctx.bufferNodes.at(-1).buffer,noise.buffer,'Generated noise is cached rather than allocated per hit');
 audio.setPaused(true);ctx.currentTime=.3;assert.equal(await audio.impact(1),false);audio.setPaused(false);audio.mute();assert.equal(await audio.impact(1),false);
 await audio.enable();assert.equal(await audio.impact(NaN),false);assert.equal(await audio.impact(0),false);assert.equal(contexts.length,1);
});

test('fireball overlap is capped and an ended burst releases its voice budget',async()=>{
 const audio=make();await audio.start();const ctx=contexts[0],oscillators=ctx.oscillators,buffers=ctx.bufferNodes.length;
 for(let i=0;i<2;i++){ctx.currentTime=i*.25;assert.equal(await audio.impact(1),true);}
 ctx.currentTime=.5;assert.equal(await audio.impact(1),false,'Only two fireballs can overlap');
 ctx.bufferNodes[buffers].onended();ctx.oscillatorNodes.slice(oscillators,oscillators+2).forEach(note=>note.onended());
 ctx.currentTime=.7;assert.equal(await audio.impact(1),true);
});


test('bright score starts in D major and schedules a steady pulse with short original arpeggios',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});const audio=make();await audio.start();const ctx=contexts[0];
 const initial=ctx.oscillatorNodes.map(node=>node.frequency.value);
 assert.ok(initial.includes(146.8324)&&initial.includes(184.9972),'D and F sharp establish a major opening');
 t.mock.timers.tick(75);
 for(let i=1;i<=4;i++){ctx.currentTime=i*.3;t.mock.timers.tick(300);}
 const arps=ctx.oscillatorNodes.filter(node=>node.type==='triangle'&&Number.isFinite(node.startedAt)&&node.frequency.value>=293);
 assert.ok(arps.length>=3,'Music has a light repeating motif instead of only a drone');
 const times=[...new Set(arps.map(node=>node.startedAt))];
 times.forEach(time=>assert.ok(Math.abs((time-.025)/.3-Math.round((time-.025)/.3))<1e-8,'Notes align to the100BPM eighth-note grid'));
 assert.ok(arps.every(node=>node.stopTime-node.startedAt<.6),'Plucks decay cleanly rather than building a wash');
 for(let i=5;i<=34;i++){ctx.currentTime=i*.3;t.mock.timers.tick(300);}
 assert.ok(ctx.oscillatorNodes.some(node=>node.frequency.events.some(event=>event.kind==='target'&&event.value===97.9989)),'Major harmony progresses into Gmaj9');
 audio.destroy();t.mock.timers.reset();
});

test('UFO pitch glides continuously across speed changes and becomes silent at idle',async()=>{
 const audio=make();await audio.start();const ctx=contexts[0];
 ctx.currentTime=.2;audio.setMotion(2.4,'car',{acceleration:0,braking:false});
 const hover=ctx.oscillatorNodes.find(node=>node.frequency.events.some(event=>event.kind==='target'&&event.constant===.09));
 const before=hover.frequency.value;ctx.currentTime=.4;audio.setMotion(2.6,'car',{acceleration:0,braking:false});
 assert.ok(hover.frequency.value>before&&hover.frequency.value-before<5,'No race-gear rev discontinuity remains');
 assert.equal(hover.type,'sine');const steady=hover.frequency.value;
 ctx.currentTime=.6;audio.setMotion(2.6,'car',{acceleration:12,braking:false});assert.ok(hover.frequency.value>steady,'Thrust adds a gentle pitch lift');
 ctx.currentTime=.8;audio.setMotion(0,'car',{acceleration:0,braking:false});assert.equal(hover.frequency.value,170);assert.equal(hover.connections[0].gain.value,0,'The parked car cannot create a constant motor drone');
 const modulation=ctx.oscillatorNodes.find(node=>node.connections.some(gain=>gain.connections.includes(hover.frequency)));assert.ok(modulation,'Frequency modulation supplies the UFO shimmer without a harsh firing pulse');
});

test('four controlled motor layers mute with pause and keep conservative pre-master headroom',async()=>{
 const audio=make();await audio.start();const ctx=contexts[0];ctx.currentTime=.2;audio.setMotion(20,'car',{acceleration:12});
 const voices=ctx.oscillatorNodes.filter(node=>node.frequency.events.some(event=>event.kind==='target'&&[.09,.1,.11,.12].includes(event.constant)));
 assert.equal(voices.length,4,'Hover fundamental, fifth, warm body, and upper shimmer are separate layers');
 assert.ok(voices.every(node=>['sine','triangle'].includes(node.type)));assert.ok(voices.some(node=>node.frequency.value>1000));
 assert.ok(voices.reduce((sum,node)=>sum+node.connections[0].gain.value,0)<.05,'Subtle motor is well below the former .16 sustained budget');
 audio.setPaused(true);voices.forEach(node=>assert.equal(node.connections[0].gain.value,0));
});

test('nearby train and drone are spatial, fade with distance, and become silent when paused',async()=>{
 const audio=make();await audio.start();const ctx=contexts[0],count=ctx.oscillators;
 ctx.currentTime=.2;audio.setMotion(0,'car',{trainDistance:3,trainSpeed:18,trainPan:.73,droneDistance:2,dronePan:-.81,droneSpeed:8});
 ctx.currentTime=.4;audio.setMotion(0,'car',{trainDistance:3,trainSpeed:18,trainPan:.73,droneDistance:2,dronePan:-.81,droneSpeed:8});
 const trainPan=ctx.panNodes.find(node=>node.pan.value===.73),dronePan=ctx.panNodes.find(node=>node.pan.value===-.81);
 const trainBus=ctx.gainNodes.find(node=>node.connections.includes(trainPan)),droneBus=ctx.gainNodes.find(node=>node.connections.includes(dronePan));
 assert.ok(trainBus.gain.value>.3&&trainBus.gain.value<=.6,'A genuinely nearby passing train has a restrained bounded level');
 assert.ok(droneBus.gain.value>.1&&droneBus.gain.value<=.35,'Nearby drone sound is a soft brief pass');
 audio.setPaused(true);assert.equal(trainBus.gain.value,0);assert.equal(droneBus.gain.value,0);audio.setPaused(false);
 ctx.currentTime=.4;audio.setMotion(0,'car',{trainDistance:80,droneDistance:40});assert.equal(trainBus.gain.value,0);assert.equal(droneBus.gain.value,0);
 ctx.currentTime=.6;audio.setMotion(0,'car',{trainDistance:0,droneDistance:0,trainPan:50,dronePan:-50});assert.equal(trainPan.pan.value,1);assert.equal(dronePan.pan.value,-1);
 audio.setMotion(0,'car');assert.equal(trainBus.gain.value,0);assert.equal(droneBus.gain.value,0,'Missing world telemetry cannot leave a stale buzzing vehicle nearby');assert.equal(ctx.oscillators,count);
});

test('loitering drones cannot produce continuous rotor noise and distant sources are hard-gated',async()=>{
 const audio=make();await audio.start();const ctx=contexts[0];
 ctx.currentTime=.2;audio.setMotion(0,'car',{droneDistance:5,droneSpeed:.7});
 ctx.currentTime=.4;audio.setMotion(0,'car',{droneDistance:5,droneSpeed:.7});assert.ok(audio.diagnostics().targets.drone>0);
 for(let i=1;i<=80;i++){ctx.currentTime=.4+i*.1;audio.setMotion(0,'car',{droneDistance:5,droneSpeed:.7});}
 assert.equal(audio.diagnostics().targets.drone,0,'A drone hovering beside a stationary car goes quiet after its one short pass');
 ctx.currentTime=20;audio.setMotion(0,'car',{droneDistance:5,droneSpeed:.7});assert.equal(audio.diagnostics().targets.drone,0,'Time alone cannot rearm a loitering drone');
 ctx.currentTime=20.2;audio.setMotion(0,'car',{droneDistance:14,droneSpeed:.7});ctx.currentTime=20.4;audio.setMotion(0,'car',{droneDistance:4,droneSpeed:.7});
 ctx.currentTime=20.6;audio.setMotion(0,'car',{droneDistance:4,droneSpeed:.7});assert.ok(audio.diagnostics().targets.drone>0,'Leaving the range and returning permits a new passing cue');
 ctx.currentTime=21;audio.setMotion(0,'car',{droneDistance:8,droneSpeed:4,trainDistance:24,trainSpeed:8});assert.equal(audio.diagnostics().targets.drone,0);assert.equal(audio.diagnostics().targets.train,0);
});

test('stationary scenes have no motor, tire, brake, stopped-train, or stationary-drone noise targets',async()=>{
 const audio=make();await audio.start();const ctx=contexts[0];
 ctx.currentTime=.2;audio.setMotion(0,'car',{trainDistance:2,trainSpeed:0,droneDistance:2,droneSpeed:0,braking:false,birdActivity:0});
 assert.deepEqual(audio.diagnostics().targets,{motor:0,road:0,braking:0,train:0,drone:0});
 ctx.currentTime=.4;audio.setMotion(0,'car',{trainDistance:2,trainSpeed:0,droneDistance:2,droneSpeed:0,braking:false,birdActivity:0});
 assert.equal(audio.diagnostics().targets.drone,0);assert.equal(audio.diagnostics().targets.train,0);
});

test('independent mixer controls survive playback gestures and share the recording master',async()=>{
 const audio=make();assert.deepEqual(audio.getMix(),{volume:.7,music:true,ambience:true,effects:true});
 audio.setMix({volume:.2,music:false,ambience:false,effects:false});assert.equal(contexts.length,0,'Changing mix preferences does not initialize playback');
 await audio.start();const ctx=contexts[0],seen=[];audio.subscribe(state=>seen.push(state.mix));
 assert.equal(await audio.horn(),false);assert.equal(await audio.impact(),false);
 await audio.enable();assert.deepEqual(audio.getMix(),{volume:.2,music:false,ambience:false,effects:false},'Any interaction can unlock audio without overriding the chosen mix');
 const master=ctx.gainNodes.find(node=>node.connections[0]?.threshold);assert.equal(master.gain.value,.1);
 audio.setMix({volume:3,music:true,effects:true});assert.equal(audio.getMix().volume,1);assert.equal(master.gain.value,.5);assert.equal(audio.getMix().ambience,false);
 assert.ok(seen.at(-1).music);audio.setMix({volume:0});assert.equal(master.gain.value,0,'Volume zero silences both live playback and recording upstream of the shared limiter');
});

test('volume and mixer groups persist across new visits while explicit mute stays page-only',async()=>{
 const first=make();first.setMix({volume:.34,music:true,ambience:false,effects:false});first.mute();
 assert.deepEqual(JSON.parse(mixStorage.get('bayward.sound.mix.v1')),{volume:.34,music:true,ambience:false,effects:false},'Storage contains only the validated mixer preferences');
 const next=make();assert.deepEqual(next.getMix(),{volume:.34,music:true,ambience:false,effects:false});assert.equal(next.state().muted,false);
 await next.enable();assert.deepEqual(next.getMix(),first.getMix());assert.equal(next.isEnabled(),true);
});

test('malformed, invalid, or blocked mixer storage falls back without blocking audio',async()=>{
 const defaults={volume:.7,music:true,ambience:true,effects:true};
 for(const value of ['broken JSON','null','[]','5','{"volume":".2","music":"false","ambience":null,"effects":0}']){
  mixStorage.set('bayward.sound.mix.v1',value);assert.deepEqual(make().getMix(),defaults);
 }
 mixStorage.set('bayward.sound.mix.v1','{"volume":20,"music":false,"muted":true,"unexpected":true}');
 assert.deepEqual(make().getMix(),{...defaults,music:false},'Invalid fields are ignored independently and mute is never restored');
 Object.defineProperty(window,'localStorage',{configurable:true,get(){throw new Error('Storage blocked');}});
 const blocked=make();assert.deepEqual(blocked.getMix(),defaults);assert.doesNotThrow(()=>blocked.setMix({volume:.25,ambience:false}));
 assert.equal(await blocked.start(),true);assert.equal(blocked.getMix().volume,.25,'In-memory controls still work when saving is unavailable');
});

test('offline diagnostics neither restore nor alter any stored audio preferences',async()=>{
 mixStorage.set('bayward.sound.mix.v1',JSON.stringify({volume:.1,music:false,ambience:false,effects:false}));storage.set('bayward.sound.muted','true');
 let accesses=0;Object.defineProperty(window,'localStorage',{configurable:true,get(){accesses++;throw new Error('Offline renderer must not access storage');}});
 const ctx=new AudioMock(),audio=createAmbience({offlineContext:ctx,clock:()=>0,manualScheduling:true});instances.push(audio);
 assert.deepEqual(audio.getMix(),{volume:.7,music:true,ambience:true,effects:true});await audio.start();audio.setMix({volume:.5});
 assert.equal(accesses,0);assert.equal(storage.get('bayward.sound.muted'),'true','Offline diagnostics leave even legacy session state untouched');
 assert.equal(JSON.parse(mixStorage.get('bayward.sound.mix.v1')).volume,.1);
});

test('offline diagnostics schedule the production graph without live autoplay or timers',async()=>{
 const ctx=new AudioMock();let time=0;const audio=createAmbience({offlineContext:ctx,clock:()=>time,manualScheduling:true});instances.push(audio);
 assert.equal(await audio.start(),true);assert.equal(ctx.resumeCalls,0);audio.isolateSources(['motor']);
 assert.equal(audio.diagnostics().isolated.music,0);assert.equal(audio.diagnostics().isolated.motor,1);
 time=2;audio.setMotion(10,'car');audio.diagnosticTick();assert.ok(audio.diagnostics().targets.motor>0);
 assert.ok(ctx.oscillatorNodes.some(node=>node.startedAt>2),'Offline notes use the deterministic audio clock');
});

test('train passby has approach/recede pitch and onboard mode avoids a doubled external train',async()=>{
 const audio=make();await audio.start();const ctx=contexts[0];
 ctx.currentTime=.2;audio.setMotion(0,'car',{trainDistance:5,trainSpeed:15,trainApproach:1,trainPan:.72});
 const voice=ctx.oscillatorNodes.find(node=>node.frequency.events.some(event=>event.kind==='target'&&event.constant===.18));assert.ok(voice);const approach=voice.frequency.value;
 ctx.currentTime=.4;audio.setMotion(0,'car',{trainDistance:6,trainSpeed:15,trainApproach:-1,trainPan:.72});assert.ok(voice.frequency.value<approach*.8,'Passing movement changes the traction whine smoothly');
 const pan=ctx.panNodes.find(node=>node.pan.value===.72),bus=ctx.gainNodes.find(node=>node.connections.includes(pan));
 audio.setMotion(12,'train',{trainDistance:0,trainPan:.72});assert.equal(bus.gain.value,0,'Train riders use the onboard rumble rather than hearing the train twice');
});

test('occasional original bird calls stay bounded, irregular, and quiet during pause or mute',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});const audio=make();await audio.start();const ctx=contexts[0];
 const birds=()=>ctx.oscillatorNodes.filter(node=>node.type==='sine'&&node.frequency.events.some(event=>event.kind==='exponential'&&event.value>1700));
 ctx.currentTime=2;t.mock.timers.tick(75);assert.equal(birds().length,2,'A light paired bird call is scheduled after entry');
 for(const bird of birds()){assert.ok(bird.stopTime-bird.startedAt<=.2);const peak=bird.connections[0].gain.events.find(event=>event.kind==='linear').value;assert.ok(peak>0&&peak<=.025);}
 ctx.currentTime=2.5;t.mock.timers.tick(75);assert.equal(birds().length,2,'Bird calls do not repeat every music tick');
 audio.setPaused(true);ctx.currentTime=20;t.mock.timers.tick(75);assert.equal(birds().length,2);audio.setPaused(false);
 audio.setMotion(0,'car',{birdActivity:0});ctx.currentTime=30;t.mock.timers.tick(75);assert.equal(birds().length,2);
 audio.setMotion(0,'car',{birdActivity:1});ctx.currentTime=50;t.mock.timers.tick(75);assert.equal(birds().length,4);
 audio.mute();ctx.currentTime=70;t.mock.timers.tick(75);assert.equal(birds().length,4);audio.destroy();t.mock.timers.reset();
});
