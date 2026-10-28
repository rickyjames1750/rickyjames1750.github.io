const STOPS = [
 {id:'about', number:1, label:'About me'},
 {id:'experience', number:2, label:'Experience'},
 {id:'projects', number:3, label:'Projects'},
 {id:'education', number:4, label:'Education'},
 {id:'contact', number:5, label:'Say hello'},
];
const stopFor = id => STOPS.find(stop => stop.id === id);

/** Recorded phrases share one consistent studio voice on every device. */
export const NARRATION_CLIPS = Object.freeze({
 'welcome': 'Welcome to Ricky Sparks’ portfolio. Take the wheel, and explore a different perspective.',
 'reveal': 'Ready? Click anywhere to reveal the world.',
 'choose-about-car': 'Let’s begin. Choose number one, About me, at the bottom. Your car will take you there.',
 'choose-about-train': 'Let’s begin. Choose number one, About me, at the bottom. Your train will take you there.',
 'arrive-about-car': 'Welcome to About me. Take your time. When you’re ready, Next section takes your car to Experience.',
 'arrive-about-train': 'Welcome to About me. Take your time. When you’re ready, Next section takes your train to Experience.',
 'arrive-experience-car': 'Here’s Experience. Read at your own pace. Next section takes your car to Projects.',
 'arrive-experience-train': 'Here’s Experience. Read at your own pace. Next section takes your train to Projects.',
 'arrive-projects-car': 'This is Projects. Explore the work, then choose Next section. Your car will take you to Education.',
 'arrive-projects-train': 'This is Projects. Explore the work, then choose Next section. Your train will take you to Education.',
 'arrive-education-car': 'You’ve reached Education. When you’re ready, Next section takes your car to Say hello.',
 'arrive-education-train': 'You’ve reached Education. When you’re ready, Next section takes your train to Say hello.',
 'arrive-contact': 'Thanks for exploring. My contact details are here. I’d love to hear what you’re building.',
});

export function narrationURL(clip, baseURL = import.meta.env?.BASE_URL || '/') {
 if(!Object.hasOwn(NARRATION_CLIPS,clip))return null;
 return `${baseURL.replace(/\/?$/, '/')}narration/${clip}.mp3`;
}

/** Decode the studio recordings once, then share one controlled playback graph. */
export function createRecordedNarrator({
 AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext,
 getAudioContext,
 fetch: fetchAudio = globalThis.fetch,
 baseURL = import.meta.env?.BASE_URL || '/',
 onSpeaking = () => {},
 onStatus = () => {},
 setTimer = (fn, delay) => setTimeout(fn, delay),
 clearTimer = timer => clearTimeout(timer),
} = {}) {
 const externalContext=typeof getAudioContext==='function';
 const available=(externalContext||typeof AudioContext==='function')&&typeof fetchAudio==='function';
 const buffers=new Map();
 let context=null,output=null,enabled=true,suspended=false,destroyed=false,volume=.86;
 let pending=null,active=null,generation=0,watchdog=null,speaking=false,lastFinished=null;
 let lastError=null,lastFailure=null,activationHold=false;
 const diagnostic=()=>({
  error:lastError,source:pending?.url||active?.item.url||lastFailure?.source||'',
  currentSource:active?.item.url||'',contextState:context?.state||'uninitialized',
  readyState:pending?.buffer||active?4:pending?1:0,
  networkState:lastError?3:pending&&!pending.buffer?2:1,
 });
 const report=value=>onStatus(value,diagnostic());
 const notifySpeaking=value=>{if(value!==speaking){speaking=value;onSpeaking(value);}};
 function failure(error){lastError=error;lastFailure={source:pending?.url||active?.item.url||''};}
 function release(record){
  if(!record)return;
  record.source.onended=null;
  try{record.source.stop();}catch{/* An ended source is already silent. */}
  try{record.source.disconnect();}catch{}
 }
 function cancel({retain=false}={}){
  generation++;
  if(watchdog!==null){clearTimer(watchdog);watchdog=null;}
  const previous=active;active=null;
  if(!retain)pending=null;
  notifySpeaking(false);release(previous);
 }
 function applyVolume(){if(output&&context?.state!=='closed')output.gain.setTargetAtTime(enabled&&!suspended?volume:0,context.currentTime,.025);}
 function stateChanged(){
  if(destroyed)return;
  if(context.state==='running'){if(!activationHold)drain();}
  else if(active){cancel();failure('context-suspended');report('blocked');}
 }
 function initialize(){
  if(context)return context;
  if(!available||destroyed)return null;
  try{
   context=externalContext?getAudioContext():new AudioContext();
   if(!context){failure('context-unavailable');report('unavailable');return null;}
   output=context.createGain();output.gain.value=volume;
   output.connect(context.destination);context.addEventListener?.('statechange',stateChanged);
   return context;
  }catch{failure('context-unavailable');report('unavailable');return null;}
 }
 function resumeContext(){
  if(destroyed||!enabled||suspended)return;
  const ctx=initialize();if(!ctx)return;
  if(ctx.state==='running'){if(!activationHold)drain();return;}
  try{
   // Called synchronously in a real gesture, even after an earlier autoplay attempt stayed pending.
   Promise.resolve(ctx.resume()).then(()=>{
    if(destroyed||suspended||!enabled)return;
    if(ctx.state==='running'){lastError=null;if(!activationHold)drain();}
    else {failure('context-suspended');report('blocked');}
   },error=>{if(!destroyed&&!suspended&&enabled&&ctx.state!=='running'){failure(error?.name||'resume-failed');report('blocked');}});
  }catch(error){failure(error?.name||'resume-failed');report('blocked');}
 }
 function load(clip,url){
  if(buffers.has(clip))return buffers.get(clip);
  const task=Promise.resolve().then(()=>fetchAudio(url)).then(response=>{
   if(!response.ok)throw new Error(`audio-http-${response.status}`);
   return response.arrayBuffer();
  }).then(bytes=>{
   if(destroyed||!context)throw new Error('cancelled');
   return context.decodeAudioData(bytes);
  });
  buffers.set(clip,task);
  task.catch(()=>{if(buffers.get(clip)===task)buffers.delete(clip);});
  return task;
 }
 function drain(){
  if(destroyed||!enabled||suspended||activationHold||volume<=0||active||!pending?.buffer||context?.state!=='running')return false;
  const item=pending,token=++generation;
  const source=context.createBufferSource();source.buffer=item.buffer;source.loop=false;source.connect(output);
  active={source,item,token};
  const current=()=>!destroyed&&active?.token===token&&generation===token;
  const finish=()=>{
   if(!current())return;
   const previous=active;active=null;
   if(watchdog!==null){clearTimer(watchdog);watchdog=null;}
   if(pending===item)pending=null;lastFinished=item.key;
   notifySpeaking(false);release(previous);report('ready');
  };
  source.onended=finish;
  try{source.start();}catch(error){cancel();failure(error?.name||'playback-failed');report('ready');return false;}
  lastError=null;lastFailure=null;notifySpeaking(true);report('playing');
  watchdog=setTimer(()=>{if(current()){failure('playback-timeout');finish();}},Math.min(45000,Math.max(2000,(item.buffer.duration+2)*1000)));
  return true;
 }
 function request(clip,key=clip){
  if(destroyed)return;
  const url=narrationURL(clip,baseURL);
  if(!url){cancel();failure('recording-unavailable');report('unavailable');return;}
  if(pending?.key===key||lastFinished===key)return;
  cancel();lastError=null;lastFailure=null;
  const item={clip,key,url,buffer:null};pending=item;
  if(!initialize()){pending=null;return;}
  report('loading');
  load(clip,url).then(buffer=>{
   if(destroyed||pending!==item)return;
   item.buffer=buffer;
   if(!drain()&&context.state!=='running'){failure('context-suspended');report('blocked');}
  },error=>{
   if(destroyed||pending!==item)return;
   failure(error?.message||'recording-failed');pending=null;report('ready');
  });
  resumeContext();
 }
 // Capture reserves activation; the bubbling handler releases only the latest instruction.
 function unlock(){if(!destroyed&&enabled&&!suspended){activationHold=true;resumeContext();}}
 function retry(){if(destroyed)return;activationHold=false;resumeContext();drain();}
 function setEnabled(value){
  const next=Boolean(value);if(next===enabled)return;
  enabled=next;applyVolume();if(!enabled)cancel({retain:true});else resumeContext();
 }
 function setSuspended(value){
  const next=Boolean(value);if(next===suspended)return;
  suspended=next;applyVolume();
  if(suspended){cancel();if(!externalContext){try{context?.suspend()?.catch?.(()=>{});}catch{}}}
  else resumeContext();
 }
 function setVolume(value){
  if(!Number.isFinite(value))return;
  const previous=volume;volume=Math.max(0,Math.min(1,value));applyVolume();
  if(volume===0)cancel({retain:true});else if(previous===0){resumeContext();drain();}
 }
 return {
  available,request,retry,unlock,cancel,setEnabled,setSuspended,setVolume,
  state:()=>({available,enabled,suspended,speaking,blocked:Boolean(pending&&context?.state!=='running'),pending:pending?.key||null,clip:active?.item.clip||null,cached:buffers.size,...diagnostic()}),
  destroy(){if(destroyed)return;cancel();destroyed=true;buffers.clear();context?.removeEventListener?.('statechange',stateChanged);try{output?.disconnect();}catch{}if(!externalContext){try{context?.close()?.catch?.(()=>{});}catch{}}},
 };
}

/** Guide state stays independent of the vehicle, so switching to Caltrain preserves the itinerary. */
export function createGuideJourney() {
 let mode='drive',phase='home',started=false,arrived=null,nextId=null,entrance='idle';
 let message=null;
 const vehicle=()=>mode==='train'?'train':'car';
 function firstStop(){
  phase='choose';
  return {key:`choose-about-${vehicle()}`,clip:`choose-about-${vehicle()}`,text:`Choose 1, About me, along the bottom. Your ${vehicle()} will take you there.`,target:'.route-stops [data-zone="about"]',speak:true,inDialog:false};
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
   message={key:'welcome',clip:'welcome',text:'Welcome to Ricky Sparks’ portfolio. Please click Take the wheel to begin.',target:'#start',speak:true,inDialog:false};
  } else if(type==='entrance'){
   if(data.phase===entrance)return null;
   entrance=data.phase;
   if(entrance==='approach'){
    started=true;phase='approach';arrived=null;
    message={key:'approach',text:'Your journey is coming into focus.',target:null,speak:false,inDialog:false};
   } else if(entrance==='ready'){
    phase='ready';
    message={key:'reveal',clip:'reveal',text:'Click anywhere to reveal the world.',target:'#reveal-world',speak:true,inDialog:false};
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
  if(id==='contact')return {key:'arrive-contact',clip:'arrive-contact',text:'You’ve reached Say hello. My contact details are here whenever you’re ready.',spoken:'You’ve reached Say hello. Thanks for exploring. I’d love to hear what you’re building.',target:null,speak,inDialog:true};
  return {key:`arrive-${id}-${vehicle()}`,clip:`arrive-${id}-${vehicle()}`,text:`${stop.label}. Read at your pace. Next section takes your ${vehicle()} to ${destination?`${destination.number}, ${destination.label}`:'the next stop'}.`,spoken:`Here’s ${stop.label}. Read at your own pace, then choose Next section. Your ${vehicle()} will take you to ${destination?`number ${destination.number}, ${destination.label}`:'the next stop'}.`,target:'#next',speak,inDialog:true};
 }
 return {event,state:()=>({mode,phase,started,arrived,nextId,entrance})};
}

/** Captions, a short voice guide, and unobtrusive highlights for the five-stop portfolio tour. */
export function bindVoiceGuide({root,reducedMotion=false,onSpeaking=()=>{},getAudioContext}={}) {
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
 root.dataset.guideVoice='recorded';
 const narrator=createRecordedNarrator({AudioContext:view.AudioContext||view.webkitAudioContext,getAudioContext,fetch:view.fetch?.bind(view),onSpeaking(value){
  root.dataset.guideSpeaking=String(value);for(const element of panels)element.classList.toggle('is-speaking',value);onSpeaking(value);
 },onStatus(value,diagnostics){root.dataset.guideVoiceState=value;root.dataset.guideVoiceError=diagnostics.error||'';root.dataset.guideVoiceSource=diagnostics.source;root.dataset.guideVoiceReadyState=String(diagnostics.readyState);root.dataset.guideVoiceNetworkState=String(diagnostics.networkState);root.dataset.guideVoiceCurrentSource=diagnostics.currentSource;root.dataset.guideVoiceContextState=diagnostics.contextState;if(!destroyed)render();}});
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
  if(active && !suspended && !doc.hidden && message.speak)narrator.request(message.clip,message.key);
  else narrator.cancel();
  render();
 }
 const unlock=e=>{
  if(e.target?.closest?.('[data-guide-skip],[data-guide-voice],[data-sound-toggle],[data-audio-control]'))return;
  if(e.type==='keydown'&&(e.ctrlKey||e.metaKey||e.altKey||['Escape','Tab','Shift','Meta','Control','Alt'].includes(e.key)))return;
  if(active&&voiceEnabled&&audioEnabled&&!suspended&&!doc.hidden)narrator.unlock();
 };
 listen(doc,'pointerdown',unlock,{capture:true});listen(doc,'click',unlock,{capture:true});listen(doc,'keydown',unlock,{capture:true});
 // A click bubbles after its button action has selected the latest instruction.
 // This prevents a blocked welcome from replaying after Take the wheel.
 const activation=e=>{
  if(e.target?.closest?.('[data-guide-skip],[data-guide-voice],[data-sound-toggle],[data-audio-control]'))return;
  if(e.type==='keydown' && e.target?.closest?.('button,a'))return;
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
  destroy(){if(destroyed)return;destroyed=true;narrator.destroy();unhighlight();for(const remove of listeners)remove();for(const element of panels)element.remove();delete root.dataset.guideActive;delete root.dataset.guideSpeaking;delete root.dataset.guideStep;delete root.dataset.guideVoice;delete root.dataset.guideVoiceState;delete root.dataset.guideVoiceError;delete root.dataset.guideVoiceSource;delete root.dataset.guideVoiceReadyState;delete root.dataset.guideVoiceNetworkState;delete root.dataset.guideVoiceCurrentSource;delete root.dataset.guideVoiceContextState;},
 };
}
