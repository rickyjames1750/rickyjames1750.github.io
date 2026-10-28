import test from 'node:test';
import assert from 'node:assert/strict';
import {NARRATION_CLIPS,NARRATION_REVISION,narrationURL,createRecordedNarrator,createGuideJourney} from '../src/voice-guide.js';
import {content} from '../src/content.js';

const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
function fixture({resume='allow',deferred=false,shared=false}={}){
 const contexts=[],sources=[],fetches=[],waiting=[],timers=new Map(),speaking=[],statuses=[];
 let timerId=0,resumeMode=resume,missing=false;
 const parameter=()=>({value:0,events:[],setTargetAtTime(value,time,smoothing){this.value=value;this.events.push({value,time,smoothing});}});
 class Context {
  constructor(){this.state='suspended';this.currentTime=0;this.destination={};this.listeners=new Map();this.resumeCalls=0;this.decodeCalls=0;this.suspendCalls=0;this.closeCalls=0;contexts.push(this);}
  createGain(){this.gain={gain:parameter(),connect(){},disconnect(){}};return this.gain;}
  createBufferSource(){const source={buffer:null,loop:true,started:false,stopped:false,connect(){},disconnect(){this.disconnected=true;},start(){this.started=true;},stop(){this.stopped=true;}};sources.push(source);return source;}
  decodeAudioData(){this.decodeCalls++;return Promise.resolve({duration:7});}
  addEventListener(type,fn){this.listeners.set(type,fn);}
  removeEventListener(type,fn){if(this.listeners.get(type)===fn)this.listeners.delete(type);}
  change(state){this.state=state;this.listeners.get('statechange')?.();}
  resume(){this.resumeCalls++;if(resumeMode==='allow')this.change('running');if(resumeMode==='reject')return Promise.reject(Object.assign(new Error('Denied'),{name:'NotAllowedError'}));if(resumeMode==='pending')return new Promise(resolve=>waiting.push({kind:'resume',resolve}));return Promise.resolve();}
  suspend(){this.suspendCalls++;this.change('suspended');return Promise.resolve();}
  close(){this.closeCalls++;this.change('closed');return Promise.resolve();}
 }
 const response=()=>({ok:!missing,status:missing?404:200,arrayBuffer:()=>Promise.resolve(new ArrayBuffer(8))});
 const fetchAudio=url=>{fetches.push(url);if(deferred)return new Promise(resolve=>waiting.push({kind:'fetch',url,resolve:()=>resolve(response())}));return Promise.resolve(response());};
 const sharedContext=shared?new Context():null;
 const mainGain=sharedContext?.createGain();if(mainGain)mainGain.gain.value=.35;
 const narrator=createRecordedNarrator({AudioContext:Context,getAudioContext:shared?()=>sharedContext:undefined,fetch:fetchAudio,baseURL:'/portfolio/',onSpeaking:value=>speaking.push(value),onStatus:(status,diagnostics)=>statuses.push({status,diagnostics}),setTimer:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimer:id=>timers.delete(id)});
 return {narrator,contexts,sources,fetches,timers,speaking,statuses,mainGain,get context(){return contexts[0];},resume(value){resumeMode=value;},missing(value){missing=value;},resolve(clip){const index=waiting.findIndex(item=>item.kind==='fetch'&&item.url.split('?')[0].endsWith(`/${clip}.mp3`));assert.ok(index>=0);waiting.splice(index,1)[0].resolve();},settleResume(){for(const item of waiting.filter(item=>item.kind==='resume'))item.resolve();},end(){sources.at(-1).onended();},tick(){const entries=[...timers];timers.clear();for(const [,timer] of entries)timer.fn();}};
}

test('all thirteen instructions resolve only to bundled recordings under the site base',()=>{
 assert.equal(Object.keys(NARRATION_CLIPS).length,13);
 for(const clip of Object.keys(NARRATION_CLIPS)){
  assert.equal(narrationURL(clip),`/narration/${clip}.mp3?v=showcase-20261028`);
  assert.equal(narrationURL(clip,'/portfolio/'),`/portfolio/narration/${clip}.mp3?v=showcase-20261028`);
  assert.equal(narrationURL(clip,'/portfolio'),`/portfolio/narration/${clip}.mp3?v=showcase-20261028`);
  assert.ok(NARRATION_CLIPS[clip].length>25);
 }
 assert.equal(narrationURL('../elsewhere'),null);assert.equal(narrationURL('unknown'),null);
});

test('decodes the requested recording and ducks only when a running context starts it',async()=>{
 const f=fixture();f.narrator.request('welcome');assert.deepEqual(f.speaking,[]);await flush();
 assert.equal(f.fetches[0],'/portfolio/narration/welcome.mp3?v=showcase-20261028');assert.equal(f.sources.length,1);
 assert.equal(f.sources[0].loop,false);assert.equal(f.sources[0].started,true);assert.deepEqual(f.speaking,[true]);
 f.end();assert.deepEqual(f.speaking,[true,false]);assert.equal(f.narrator.state().pending,null);
 f.narrator.retry();f.narrator.request('welcome');await flush();assert.equal(f.sources.length,1);f.narrator.destroy();
});

test('a blocked context starts only the latest instruction after synchronous gesture unlock',async()=>{
 const f=fixture({resume:'blocked'});f.narrator.request('welcome');await flush();
 assert.equal(f.narrator.state().blocked,true);assert.equal(f.sources.length,0);
 f.resume('allow');f.narrator.unlock();assert.equal(f.context.state,'running');
 assert.equal(f.sources.length,0,'Capture must hold the old welcome until the action has run');
 f.narrator.cancel();f.narrator.request('reveal');await flush();assert.equal(f.sources.length,0);
 f.narrator.retry();await flush();assert.equal(f.sources.length,1);assert.equal(f.narrator.state().clip,'reveal');
 assert.equal(f.contexts.length,1);f.narrator.destroy();
});

test('a blank click retries the buffered welcome after its capture-phase unlock',async()=>{
 const f=fixture({resume:'blocked'});f.narrator.request('welcome');await flush();
 f.resume('allow');f.narrator.unlock();assert.equal(f.sources.length,0);
 f.narrator.retry();await flush();assert.equal(f.narrator.state().clip,'welcome');assert.deepEqual(f.speaking,[true]);f.narrator.destroy();
});

test('one activated context handles later automatic arrivals without another gesture',async()=>{
 const f=fixture();
 for(const clip of ['welcome','reveal','arrive-about-train','arrive-experience-train']){
  f.narrator.request(clip);await flush();assert.equal(f.contexts.length,1);assert.equal(f.narrator.state().clip,clip);f.end();
 }
 assert.equal(f.sources.length,4);f.narrator.destroy();
});

test('decoded clips cache across a complete change of instruction',async()=>{
 const f=fixture();
 for(const clip of ['welcome','reveal','welcome']){f.narrator.request(clip);await flush();f.end();}
 assert.equal(f.fetches.length,2);assert.equal(f.context.decodeCalls,2);assert.equal(f.sources.length,3);f.narrator.destroy();
});

test('rapid navigation stops old sources and ignores their late ended callbacks',async()=>{
 const f=fixture();f.narrator.request('arrive-about-car');await flush();const old=f.sources[0],ended=old.onended;
 f.narrator.request('arrive-experience-car');await flush();assert.equal(old.stopped,true);assert.equal(old.onended,null);
 ended();assert.equal(f.narrator.state().speaking,true);assert.equal(f.narrator.state().clip,'arrive-experience-car');
 f.end();assert.deepEqual(f.speaking,[true,false,true,false]);assert.equal(f.timers.size,0);f.narrator.destroy();
});

test('a stale fetch may finish caching but cannot play a cancelled instruction',async()=>{
 const f=fixture({deferred:true});f.narrator.request('welcome');await flush();
 f.narrator.request('reveal');await flush();f.resolve('welcome');await flush();assert.equal(f.sources.length,0);
 f.resolve('reveal');await flush();assert.equal(f.sources.length,1);assert.equal(f.narrator.state().clip,'reveal');f.narrator.destroy();
});

test('mute and zero volume stop the node and preserve only the current instruction',async()=>{
 const f=fixture();f.narrator.setVolume(.31);f.narrator.request('welcome');await flush();assert.equal(f.context.gain.gain.value,.31);
 f.narrator.setEnabled(false);assert.equal(f.sources[0].stopped,true);assert.equal(f.context.gain.gain.value,0);
 f.narrator.request('arrive-about-car');await flush();assert.equal(f.sources.length,1);
 f.narrator.setEnabled(true);await flush();assert.equal(f.sources.length,2);assert.equal(f.narrator.state().clip,'arrive-about-car');
 f.narrator.setVolume(0);f.narrator.retry();assert.equal(f.sources.length,2);
 f.narrator.setVolume(.5);assert.equal(f.sources.length,3);assert.equal(f.context.gain.gain.value,.5);
 f.narrator.destroy();assert.equal(f.sources[2].stopped,true);assert.equal(f.context.state,'closed');assert.equal(f.timers.size,0);
});

test('suspending for visibility or another view cancels speech without replaying stale instructions',async()=>{
 const f=fixture();f.narrator.request('choose-about-car');await flush();
 f.narrator.setSuspended(true);assert.equal(f.narrator.state().pending,null);assert.equal(f.context.state,'suspended');
 f.narrator.setSuspended(false);f.narrator.retry();await flush();assert.equal(f.sources.length,1);
 f.narrator.request('arrive-experience-car');await flush();assert.equal(f.sources.length,2);f.narrator.destroy();
});

test('missing recordings stay silent, expose the response and do not repeatedly fetch on clicks',async()=>{
 const f=fixture();f.missing(true);f.narrator.request('welcome');await flush();
 assert.equal(f.sources.length,0);assert.equal(f.narrator.state().pending,null);assert.equal(f.narrator.state().error,'audio-http-404');
 f.narrator.retry();await flush();assert.equal(f.fetches.length,1);f.narrator.request('unknown');assert.equal(f.sources.length,0);f.narrator.destroy();
});

test('unsupported playback keeps captions usable without constructing another kind of voice',()=>{
 const narrator=createRecordedNarrator({AudioContext:null,fetch:null});narrator.request('welcome');assert.equal(narrator.available,false);
 narrator.unlock();narrator.retry();narrator.setEnabled(false);narrator.setVolume(.2);narrator.destroy();
});

test('late resume attempts use the current pending instruction and never recreate the graph',async()=>{
 const f=fixture({resume:'pending'});f.narrator.request('welcome');await flush();f.narrator.request('reveal');await flush();
 f.resume('allow');f.narrator.unlock();f.narrator.retry();await flush();f.settleResume();await flush();
 assert.equal(f.contexts.length,1);assert.equal(f.sources.length,1);assert.equal(f.narrator.state().clip,'reveal');f.narrator.destroy();
});

test('the completion watchdog releases a stalled node and restores the soundtrack',async()=>{
 const f=fixture();f.narrator.request('welcome');await flush();f.tick();
 assert.equal(f.narrator.state().speaking,false);assert.equal(f.narrator.state().pending,null);assert.equal(f.sources[0].stopped,true);
 assert.equal(f.narrator.state().error,'playback-timeout');assert.deepEqual(f.speaking,[true,false]);f.narrator.destroy();
});

test('an external shared context keeps its lifetime and ambient gain while the guide owns its output',async()=>{
 const f=fixture({shared:true});f.narrator.request('welcome');await flush();
 assert.equal(f.contexts.length,1);assert.equal(f.narrator.state().speaking,true);
 assert.notEqual(f.context.gain,f.mainGain);assert.equal(f.mainGain.gain.value,.35);
 f.narrator.setVolume(.2);assert.equal(f.context.gain.gain.value,.2);assert.equal(f.mainGain.gain.value,.35);
 f.narrator.setSuspended(true);assert.equal(f.sources[0].stopped,true);assert.equal(f.context.suspendCalls,0);assert.equal(f.context.state,'running');
 f.narrator.setSuspended(false);f.narrator.request('reveal');await flush();assert.equal(f.narrator.state().speaking,true);
 f.narrator.destroy();assert.equal(f.context.closeCalls,0);assert.equal(f.context.state,'running');
 assert.equal(f.mainGain.gain.value,.35);assert.equal(f.sources[1].stopped,true);
});

test('entrance instructions replace the welcome, then point to number one',()=>{
 const journey=createGuideJourney();assert.match(journey.event('welcome').text,/Meet Ricky Sparks/);
 const approach=journey.event('entrance',{phase:'approach'});assert.equal(approach.speak,false);
 assert.equal(journey.event('entrance',{phase:'approach'}),null);
 assert.equal(journey.event('entrance',{phase:'ready'}).target,'#reveal-world');
 assert.equal(journey.event('entrance',{phase:'reveal'}).speak,false);
 const begin=journey.event('entrance',{phase:'idle'});assert.match(begin.text,/Choose 1, About me/);
 assert.match(begin.target,/data-zone="about"/);
 assert.equal(journey.event('entrance',{phase:'idle'}),null);
});

test('train guidance preserves the itinerary, supports section jumps, and stops at contact',()=>{
 const journey=createGuideJourney();journey.event('welcome');journey.event('mode',{mode:'train'});
 journey.event('travel',{id:'about'});
 const about=journey.event('arrive',{id:'about',nextId:'experience'});
 assert.match(about.text,/train to 2, Experience/);assert.equal(about.spoken,NARRATION_CLIPS['arrive-about-train']);assert.equal(about.target,'#next');
 assert.equal(journey.event('mode',{mode:'train'}),null);
 assert.equal(journey.event('arrive',{id:'about',nextId:'experience'}),null);
 const travel=journey.event('travel',{id:'education'});assert.equal(travel.speak,false);
 const education=journey.event('arrive',{id:'education'});assert.match(education.text,/5, Say hello/);
 const next=journey.event('closeSection');assert.match(next.target,/contact/);assert.equal(next.speak,false);
 const contact=journey.event('arrive',{id:'contact',nextId:'about'});assert.equal(contact.target,null);
 assert.match(contact.text,/contact details/);
 assert.equal(journey.event('arrive',{id:'unknown'}),null);
});

test('going directly to a section does not restart onboarding when its mode is reported',()=>{
 const journey=createGuideJourney();journey.event('travel',{id:'projects'});
 journey.event('arrive',{id:'projects'});
 const updated=journey.event('mode',{mode:'train'});
 assert.match(updated.text,/train to 4, Education/);assert.equal(updated.speak,false);
 assert.equal(journey.state().arrived,'projects');assert.equal(journey.state().phase,'arrived');
});


test('direct Drive EV or Caltrain selection begins at About me without the entrance sequence',()=>{
 for(const mode of ['drive','train']){
  const journey=createGuideJourney();journey.event('welcome');
  const direct=journey.event('mode',{mode});
  assert.equal(direct.target,'.route-stops [data-zone="about"]');
  assert.match(direct.text,mode==='train'?/Your train/:/Your car/);assert.equal(direct.spoken,NARRATION_CLIPS[direct.clip]);
  assert.equal(journey.state().started,true);
  assert.equal(journey.event('mode',{mode}),null);
 }
});

test('Explore after starting has no hidden Take the wheel highlight or repeated welcome',()=>{
 const journey=createGuideJourney();journey.event('welcome');journey.event('mode',{mode:'train'});
 const explore=journey.event('mode',{mode:'explore'});
 assert.equal(explore.target,null);assert.equal(explore.speak,false);assert.equal(explore.key,'browse');
 assert.equal(journey.event('mode',{mode:'explore'}),null);
 assert.equal(journey.state().phase,'browse');
});


test('showcase recordings and captions introduce Ricky in third person and keep spoken text exact',()=>{
 const firstPerson=/\b(?:I|I’m|I'm|I’d|I'd|my|mine|our|ours|we|we’re|we're)\b/i;
 for(const script of Object.values(NARRATION_CLIPS))assert.doesNotMatch(script,firstPerson);
 for(const mode of ['drive','train']){
  const journey=createGuideJourney();
  const messages=[journey.event('welcome'),journey.event('mode',{mode})];
  for(const id of ['about','experience','projects','education','contact']){
   messages.push(journey.event('travel',{id}),journey.event('arrive',{id}),journey.event('closeSection'));
  }
  messages.push(journey.event('mode',{mode:'explore'}));
  for(const message of messages.filter(Boolean)){
   assert.doesNotMatch(message.text,firstPerson);
   if(message.key.startsWith('travel-'))assert.doesNotMatch(message.text,/his (?:car|train)/i);
   if(message.clip)assert.equal(message.spoken,NARRATION_CLIPS[message.clip]);
   if(message.key.startsWith('arrive-')){
    const words=message.text.split(/\s+/).length;
    assert.ok(words>=20&&words<=28,`${message.key}: ${words} words`);
   }
  }
 }
});

test('the showcase highlights supported skills and attaches honors specifically to the bachelor’s degree',()=>{
 assert.match(content('about'),/Menlo Park/);assert.match(NARRATION_CLIPS['arrive-about-car'],/Menlo Park/);
 assert.match(content('experience'),/SQL and Python/);assert.match(NARRATION_CLIPS['arrive-experience-car'],/SQL and Python data pipelines/);
 assert.match(content('projects'),/Computer vision/);assert.match(content('projects'),/Anomaly detection/);
 assert.match(NARRATION_CLIPS['arrive-projects-car'],/computer vision, anomaly detection/);
 const education=content('education');assert.match(education,/M\.S\. Computer Science/);assert.match(education,/B\.S\. Computer Science/);assert.match(education,/Summa cum laude/);
 assert.match(NARRATION_CLIPS['arrive-education-car'],/bachelor’s degree summa cum laude/);
 assert.match(NARRATION_CLIPS['arrive-education-car'],/master’s in computer science/);
 assert.doesNotMatch(NARRATION_CLIPS['arrive-education-car'],/master’s[^.]*summa cum laude/);
});

test('the narration revision changes every recording URL so previous dialogue cannot remain cached',()=>{
 assert.equal(NARRATION_REVISION,'showcase-20261028');
 for(const clip of Object.keys(NARRATION_CLIPS)){
  const url=new URL(narrationURL(clip,'/portfolio/'),'https://example.test');
  assert.equal(url.pathname,`/portfolio/narration/${clip}.mp3`);
  assert.equal(url.searchParams.get('v'),'showcase-20261028');
 }
});
