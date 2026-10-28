import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseNarratorVoice,createSpeechNarrator,createGuideJourney} from '../src/voice-guide.js';

function fixture(){
 const listeners=new Map(),utterances=[],timers=new Map(),speaking=[],statuses=[];
 let timerId=0,cancels=0,voices=[];
 class Utterance {constructor(text){this.text=text;}}
 const synthesis={
  getVoices:()=>voices,
  speak(utterance){utterances.push(utterance);},
  cancel(){cancels++;},
  addEventListener(type,fn){listeners.set(type,fn);},
  removeEventListener(type,fn){if(listeners.get(type)===fn)listeners.delete(type);},
 };
 const narrator=createSpeechNarrator({synthesis,Utterance,onSpeaking:value=>speaking.push(value),onStatus:value=>statuses.push(value),setTimer:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimer:id=>timers.delete(id)});
 return {narrator,utterances,timers,speaking,statuses,listeners,get cancels(){return cancels;},setVoices(value){voices=value;listeners.get('voiceschanged')?.();},tick(){const entries=[...timers];timers.clear();for(const [,timer] of entries)timer.fn();}};
}

test('chooses natural English voices and ignores a non-English default',()=>{
 const french={name:'Premium French',lang:'fr-FR',default:true,localService:true};
 const plain={name:'English',lang:'en-US',localService:true};
 const natural={name:'Ava (Enhanced)',lang:'en-US',localService:true};
 assert.equal(chooseNarratorVoice([french,plain,natural]),natural);
 assert.equal(chooseNarratorVoice([french,plain]),plain);
 assert.equal(chooseNarratorVoice([french]),null);
 assert.equal(chooseNarratorVoice([]),null);
});

test('voices that arrive later are selected for the next instruction',()=>{
 const f=fixture();f.narrator.request('Welcome.','welcome');
 assert.equal(f.utterances[0].lang,'en-US');
 f.utterances[0].onend();
 const voice={name:'Samantha',lang:'en-US',localService:true};f.setVoices([voice]);
 f.narrator.request('Choose About me.','about');
 assert.equal(f.utterances[1].voice,voice);
 assert.equal(f.utterances[1].rate,.94);
 f.narrator.destroy();assert.equal(f.listeners.size,0);assert.equal(f.timers.size,0);
});

test('blocked autoplay retries only the latest instruction after activation',()=>{
 const f=fixture();f.narrator.request('Welcome.','welcome');
 f.utterances[0].onerror({error:'not-allowed'});
 assert.equal(f.narrator.state().blocked,true);
 f.narrator.request('Reveal the world.','reveal');
 f.utterances[1].onerror({error:'not-allowed'});
 f.narrator.retry();
 assert.deepEqual(f.utterances.map(u=>u.text),['Welcome.','Reveal the world.','Reveal the world.']);
 assert.equal(f.utterances.filter(u=>u.text==='Welcome.').length,1);
 f.utterances[2].onstart();f.utterances[2].onend();
 assert.deepEqual(f.speaking,[true,false]);assert.equal(f.narrator.state().pending,null);
 f.narrator.retry();assert.equal(f.utterances.length,3);f.narrator.destroy();
});

test('rapid navigation cancels stale speech and ignores late callbacks',()=>{
 const f=fixture();f.narrator.request('About me.','about');const old=f.utterances[0];old.onstart();
 f.narrator.request('Experience.','experience');const latest=f.utterances[1];latest.onstart();
 old.onend();old.onerror({error:'interrupted'});
 assert.equal(f.narrator.state().speaking,true);
 assert.equal(f.narrator.state().pending,'experience');
 latest.onend();assert.equal(f.narrator.state().speaking,false);assert.equal(f.timers.size,0);
 assert.deepEqual(f.speaking,[true,false,true,false]);f.narrator.destroy();
});

test('mute and volume zero silence speech and no guide speech overlaps',()=>{
 const f=fixture();f.narrator.setVolume(.31);f.narrator.request('Welcome.','welcome');
 assert.equal(f.utterances[0].volume,.31);f.utterances[0].onstart();
 f.narrator.setEnabled(false);assert.equal(f.narrator.state().speaking,false);
 f.narrator.request('About me.','about');assert.equal(f.utterances.length,1);
 f.narrator.setEnabled(true);assert.equal(f.utterances[1].text,'About me.');
 f.narrator.setVolume(0);f.narrator.retry();assert.equal(f.utterances.length,2);
 f.narrator.setVolume(.5);assert.equal(f.utterances.length,3);
 assert.equal(f.utterances[2].volume,.5);
 f.narrator.destroy();
});

test('suspending a race, another dialog, or a hidden tab never replays a stale instruction',()=>{
 const f=fixture();f.narrator.request('Choose About me.','about');f.utterances[0].onstart();
 f.narrator.setSuspended(true);assert.equal(f.narrator.state().pending,null);
 f.narrator.setSuspended(false);f.narrator.retry();assert.equal(f.utterances.length,1);
 f.narrator.request('Experience.','experience');assert.equal(f.utterances.length,2);f.narrator.destroy();
});

test('silent autoplay failures and stuck speaking both end with a bounded watchdog',()=>{
 const f=fixture();f.narrator.request('Welcome.','welcome');f.tick();
 assert.equal(f.narrator.state().blocked,true);assert.equal(f.narrator.state().pending,'welcome');
 f.narrator.retry();f.utterances[1].onstart();assert.equal(f.narrator.state().speaking,true);
 f.tick();assert.equal(f.narrator.state().speaking,false);assert.equal(f.narrator.state().pending,null);
 assert.equal(f.timers.size,0);f.narrator.destroy();
});

test('unsupported synthesis preserves captions without throwing or timers',()=>{
 const narrator=createSpeechNarrator({synthesis:null,Utterance:null});
 narrator.request('Welcome.','welcome');assert.equal(narrator.available,false);
 narrator.retry();narrator.setEnabled(false);narrator.setVolume(.2);narrator.destroy();
});

test('entrance instructions replace the welcome, then point to number one',()=>{
 const journey=createGuideJourney();assert.match(journey.event('welcome').text,/Welcome to Ricky Sparks/);
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
 assert.match(about.text,/train to 2, Experience/);assert.match(about.spoken,/Your train/);assert.equal(about.target,'#next');
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
  assert.match(direct.text,mode==='train'?/Your train/:/Your car/);
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
