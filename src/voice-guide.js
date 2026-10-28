const STOPS = [
 {id:'about', number:1, label:'About me'},
 {id:'experience', number:2, label:'Experience'},
 {id:'projects', number:3, label:'Projects'},
 {id:'education', number:4, label:'Education'},
 {id:'contact', number:5, label:'Say hello'},
];
const stopFor = id => STOPS.find(stop => stop.id === id);

/** Prefer an installed English narrator with a natural voice, then a reliable local fallback. */
export function chooseNarratorVoice(voices = []) {
 const english = voices.filter(voice => /^en(?:[-_]|$)/i.test(voice.lang || ''));
 const score = voice => {
  const name = voice.name || '';
  return (/natural|neural|premium|enhanced/i.test(name) ? 100 : 0)
   + (/ava|samantha|allison|serena|daniel|google us english|microsoft aria|microsoft jenny/i.test(name) ? 35 : 0)
   + (/^en[-_]US$/i.test(voice.lang || '') ? 15 : 0)
   + (voice.localService ? 8 : 0) + (voice.default ? 3 : 0);
 };
 return english.map((voice,index) => ({voice,index,score:score(voice)}))
  .sort((a,b) => b.score-a.score || a.index-b.index)[0]?.voice || null;
}

/** One short instruction at a time; a blocked browser keeps only the latest instruction. */
export function createSpeechNarrator({
 synthesis = globalThis.speechSynthesis,
 Utterance = globalThis.SpeechSynthesisUtterance,
 onSpeaking = () => {},
 onStatus = () => {},
 setTimer = (fn, delay) => setTimeout(fn, delay),
 clearTimer = timer => clearTimeout(timer),
} = {}) {
 const available = Boolean(synthesis && Utterance);
 let enabled = true, suspended = false, destroyed = false, volume = 0.86;
 let voice = null, pending = null, active = null, generation = 0, watchdog = null;
 let speaking = false, lastFinished = null, blocked = false;
 const notifySpeaking = value => {if(value !== speaking){speaking=value;onSpeaking(value);}};
 function updateVoices(){
  try {voice=chooseNarratorVoice(synthesis?.getVoices?.() || []);} catch {voice=null;}
 }
 function cancel({retain = false} = {}) {
  generation++;
  if(watchdog !== null){clearTimer(watchdog);watchdog=null;}
  active=null;
  if(!retain)pending=null;
  notifySpeaking(false);
  if(available){try{synthesis.cancel();}catch{/* Captions remain available. */}}
 }
 function start() {
  if(destroyed || !available || !enabled || suspended || !pending || active || volume <= 0)return false;
  const item = pending, token = ++generation;
  let utterance;
  try {utterance=new Utterance(item.text);} catch {onStatus('unavailable');return false;}
  utterance.lang=voice?.lang || 'en-US';
  if(voice)utterance.voice=voice;
  utterance.rate=0.94;utterance.pitch=1;utterance.volume=volume;
  active={utterance,token,item,started:false};
  const current=()=>!destroyed && active?.token===token && generation===token;
  const finish=(reason)=>{
   if(!current())return;
   if(watchdog!==null){clearTimer(watchdog);watchdog=null;}
   active=null;notifySpeaking(false);
   if(reason==='end'){
    lastFinished=item.key;
    if(pending?.key===item.key)pending=null;
    blocked=false;onStatus('ready');
   } else {
    // Only activation failures should retry. Interrupted or unsupported speech stays quiet.
    const retryable=reason==='not-allowed' || reason==='audio-busy' || reason==='not-started';
    blocked=retryable;
    if(!retryable && pending?.key===item.key)pending=null;
    onStatus(retryable?'blocked':'ready');
   }
  };
  utterance.onstart=()=>{
   if(!current())return;
   active.started=true;blocked=false;notifySpeaking(true);onStatus('speaking');
   if(watchdog!==null)clearTimer(watchdog);
   watchdog=setTimer(()=>{if(current()){cancel();onStatus('ready');}},Math.max(9000,item.text.length*110));
  };
  utterance.onend=()=>finish('end');
  utterance.onerror=event=>finish(event.error || 'error');
  // Some browsers reject autoplay silently rather than firing onerror.
  watchdog=setTimer(()=>{
   if(!current() || active.started)return;
   cancel({retain:true});blocked=true;onStatus('blocked');
  },1800);
  try{synthesis.speak(utterance);}catch{finish('not-allowed');}
  return true;
 }
 function request(text,key=text){
  if(destroyed || !text)return;
  if((pending?.key===key && active) || lastFinished===key)return;
  cancel();pending={text,key};start();
 }
 function retry(){if(!destroyed && pending && !active)start();}
 function setEnabled(value){
  const next=Boolean(value);if(next===enabled)return;
  enabled=next;
  if(!enabled)cancel({retain:true});else start();
 }
 function setSuspended(value){
  const next=Boolean(value);if(next===suspended)return;
  suspended=next;
  if(suspended)cancel();
  // Returning from another task never replays an old instruction.
 }
 function setVolume(value){
  if(!Number.isFinite(value))return;
  const previous=volume;volume=Math.max(0,Math.min(1,value));
  if(active)active.utterance.volume=volume;
  if(volume===0)cancel({retain:true});else if(previous===0)start();
 }
 updateVoices();
 synthesis?.addEventListener?.('voiceschanged',updateVoices);
 return {
  available,request,retry,cancel,setEnabled,setSuspended,setVolume,
  state:()=>({available,enabled,suspended,speaking,blocked,pending:pending?.key || null,voice:voice?.name || null}),
  destroy(){if(destroyed)return;cancel();destroyed=true;synthesis?.removeEventListener?.('voiceschanged',updateVoices);},
 };
}

/** Guide state stays independent of the vehicle, so switching to Caltrain preserves the itinerary. */
export function createGuideJourney() {
 let mode='drive',phase='home',started=false,arrived=null,nextId=null,entrance='idle';
 let message=null;
 const vehicle=()=>mode==='train'?'train':'car';
 function firstStop(){
  phase='choose';
  return {key:`choose-about-${mode}`,text:`Choose 1, About me, along the bottom. Your ${vehicle()} will take you there.`,target:'.route-stops [data-zone="about"]',speak:true,inDialog:false};
 }
 function event(type,data={}) {
  if(type==='mode'){
   if(!['explore','drive','train'].includes(data.mode))return null;
   if(data.mode===mode && !(phase==='home' && mode!=='explore'))return null;
   mode=data.mode;
   if(mode==='explore'){
    if(!started || phase==='arrived')return null;
    phase='browse';message={key:'browse',text:'Explore at your own pace. Choose any numbered stop along the bottom to read my work.',target:null,speak:false,inDialog:false};
   } else if(phase==='home'){started=true;message=firstStop();}
   else if(phase==='choose')message=firstStop();
   else if(phase==='arrived')message=arrival(arrived,nextId,false);
   else return null;
  } else if(type==='welcome' || type==='home'){
   phase='home';started=false;arrived=null;nextId=null;entrance='idle';
   message={key:'welcome',text:'Welcome to Ricky Sparks’ portfolio. Please click Take the wheel to begin.',target:'#start',speak:true,inDialog:false};
  } else if(type==='entrance'){
   if(data.phase===entrance)return null;
   entrance=data.phase;
   if(entrance==='approach'){
    started=true;phase='approach';arrived=null;
    message={key:'approach',text:'Your journey is coming into focus.',target:null,speak:false,inDialog:false};
   } else if(entrance==='ready'){
    phase='ready';
    message={key:'reveal',text:'Click anywhere to reveal the world.',target:'#reveal-world',speak:true,inDialog:false};
   } else if(entrance==='reveal'){
    phase='reveal';
    message={key:'revealing',text:'One Bay. A world of possibilities.',target:null,speak:false,inDialog:false};
   } else if(entrance==='idle' && started && ['approach','ready','reveal'].includes(phase))message=firstStop();
   else return null;
  } else if(type==='travel'){
   const stop=stopFor(data.id);if(!stop)return null;
   started=true;phase='travel';
   message={key:`travel-${stop.id}`,text:`On the way to ${stop.number}, ${stop.label}. Enjoy the view.`,target:null,speak:false,inDialog:false};
  } else if(type==='arrive'){
   const stop=stopFor(data.id);if(!stop)return null;
   const following=data.nextId || STOPS[STOPS.indexOf(stop)+1]?.id || null;
   if(phase==='arrived' && arrived===data.id && nextId===following)return null;
   started=true;phase='arrived';arrived=data.id;nextId=following;
   message=arrival(arrived,nextId,true);
  } else if(type==='closeSection'){
   if(!arrived)return null;
   const next=stopFor(nextId);
   phase='between';
   message=next?{key:`next-${next.id}`,text:`Ready for the next stop? Choose ${next.number}, ${next.label}, along the bottom.`,target:`.route-stops [data-zone="${next.id}"]`,speak:false,inDialog:false}:{key:'complete',text:'Thanks for exploring. Choose any stop to revisit my work.',target:null,speak:false,inDialog:false};
  } else return null;
  return message;
 }
 function arrival(id,next,speak){
  const stop=stopFor(id),destination=stopFor(next);
  if(id==='contact')return {key:'arrive-contact',text:'You’ve reached Say hello. My contact details are here whenever you’re ready.',spoken:'You’ve reached Say hello. Thanks for exploring. I’d love to hear what you’re building.',target:null,speak,inDialog:true};
  return {key:`arrive-${id}`,text:`${stop.label}. Read at your pace. Next section takes your ${vehicle()} to ${destination?`${destination.number}, ${destination.label}`:'the next stop'}.`,spoken:`Here’s ${stop.label}. Read at your own pace, then choose Next section. Your ${vehicle()} will take you to ${destination?`number ${destination.number}, ${destination.label}`:'the next stop'}.`,target:'#next',speak,inDialog:true};
 }
 return {event,state:()=>({mode,phase,started,arrived,nextId,entrance})};
}

/** Captions, a short voice guide, and unobtrusive highlights for the five-stop portfolio tour. */
export function bindVoiceGuide({root,reducedMotion=false,onSpeaking=()=>{}}={}) {
 const doc=root?.ownerDocument || globalThis.document;
 if(!doc)return {event(){},quiet(){},setAudioEnabled(){},setVolume(){},destroy(){}};
 root ||= doc.querySelector('#explore') || doc.body;
 const view=doc.defaultView || globalThis;
 const journey=createGuideJourney(),listeners=[],panels=[];
 let active=true,voiceEnabled=true,audioEnabled=true,suspended=false,lastMessage=null,currentTarget=null,destroyed=false;
 const listen=(element,type,fn,options)=>{element?.addEventListener?.(type,fn,options);listeners.push(()=>element?.removeEventListener?.(type,fn,options));};
 function panel(className){
  const element=doc.createElement('aside');element.className=className;element.hidden=true;
  element.setAttribute('aria-label','Portfolio guide');
  element.innerHTML='<div class="voice-guide-heading"><span class="voice-guide-indicator" aria-hidden="true"><i></i><i></i><i></i></span><span class="voice-guide-status">YOUR GUIDE</span></div><p class="voice-guide-caption" role="status" aria-live="polite" aria-atomic="true"></p><div class="voice-guide-actions"><button type="button" data-guide-voice data-audio-control aria-pressed="true">Voice on</button><button type="button" data-guide-skip>Skip guide <span aria-hidden="true">↗</span></button></div>';
  listen(element.querySelector('[data-guide-voice]'),'click',()=>{
   voiceEnabled=!voiceEnabled;narrator.setEnabled(active && voiceEnabled && audioEnabled && !suspended);
   if(voiceEnabled)narrator.retry();render();
  });
  listen(element.querySelector('[data-guide-skip]'),'click',()=>{active=false;narrator.cancel();narrator.setEnabled(false);render();});
  panels.push(element);return element;
 }
 const outside=panel('voice-guide');outside.dataset.reducedMotion=String(reducedMotion);root.append(outside);
 const detail=doc.querySelector('#detail'),scroller=doc.querySelector('#detail-scroll');
 const inside=scroller?panel('voice-guide voice-guide-in-reader'):null;
 if(inside)scroller.prepend(inside);
 const narrator=createSpeechNarrator({synthesis:view.speechSynthesis,Utterance:view.SpeechSynthesisUtterance,onSpeaking(value){
  root.dataset.guideSpeaking=String(value);for(const element of panels)element.classList.toggle('is-speaking',value);onSpeaking(value);
 },onStatus(){if(!destroyed)render();}});
 function unhighlight(){currentTarget?.classList.remove('voice-guide-target');currentTarget?.removeAttribute('data-guide-motion');currentTarget=null;}
 function render(){
  if(destroyed)return;
  const visible=active && !suspended && Boolean(lastMessage);
  root.dataset.guideActive=String(active);
  root.dataset.guideStep=journey.state().phase;
  for(const element of panels){
   const isInside=element===inside;
   element.hidden=!visible || (lastMessage.inDialog && inside ? !isInside : isInside);
   const caption=element.querySelector('.voice-guide-caption'),text=lastMessage?.text || '';
   if(caption.textContent!==text)caption.textContent=text;
   element.querySelector('.voice-guide-status').textContent=!narrator.available?'YOUR GUIDE':!audioEnabled?'GUIDE · SOUND MUTED':'YOUR GUIDE';
   const button=element.querySelector('[data-guide-voice]');button.textContent=voiceEnabled?'Voice on':'Voice off';button.setAttribute('aria-pressed',String(voiceEnabled));
   button.disabled=!narrator.available;button.title=narrator.available?'Turn spoken guidance on or off':'Spoken guidance is unavailable in this browser';
  }
  const target=visible && lastMessage.target?doc.querySelector(lastMessage.target):null;
  if(target!==currentTarget){unhighlight();currentTarget=target;currentTarget?.classList.add('voice-guide-target');currentTarget?.setAttribute('data-guide-motion',reducedMotion?'reduced':'full');}
 }
 function event(type,data={}){
  if(destroyed)return;
  if(type==='suspend'){
   if(Boolean(data.active)===suspended)return;
   suspended=Boolean(data.active);narrator.setSuspended(suspended || doc.hidden);narrator.setEnabled(active && voiceEnabled && audioEnabled && !suspended && !doc.hidden);render();return;
  }
  const message=journey.event(type,data);if(!message)return;
  lastMessage=message;
  if(active && !suspended && !doc.hidden && message.speak)narrator.request(message.spoken || message.text,message.key);
  else narrator.cancel();
  render();
 }
 // A click bubbles after its button action has selected the latest instruction.
 // This prevents a blocked welcome from replaying after Take the wheel.
 const activation=e=>{
  if(e.target?.closest?.('[data-guide-skip],[data-guide-voice],[data-sound-toggle],[data-audio-control]'))return;
  if(e.type==='keydown' && (e.ctrlKey || e.metaKey || e.altKey || e.key==='Escape'))return;
  if(active && voiceEnabled && audioEnabled && !suspended && !doc.hidden)narrator.retry();
 };
 listen(doc,'click',activation);listen(doc,'keydown',activation);
 listen(doc,'visibilitychange',()=>{
  narrator.setSuspended(suspended || doc.hidden);
  if(doc.hidden)root.dataset.guideSpeaking='false';
 });
 return {
  event,
  quiet(){if(!destroyed)narrator.cancel();},
  setAudioEnabled(value){audioEnabled=Boolean(value);narrator.setEnabled(active && voiceEnabled && audioEnabled && !suspended && !doc.hidden);render();},
  setVolume(value){narrator.setVolume(value);},
  destroy(){if(destroyed)return;destroyed=true;narrator.destroy();unhighlight();for(const remove of listeners)remove();for(const element of panels)element.remove();delete root.dataset.guideActive;delete root.dataset.guideSpeaking;delete root.dataset.guideStep;},
 };
}
