import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createViewRecorder, recordingSize, selectRecordingType } from '../src/view-recorder.js';
let app, scene, doc, win, now, controllers, ready, errors, draws, raf, nextFrame, recorders, tracks, ellipses;
function track(kind) {const value={kind,readyState:'live',stopped:false,stop(){this.stopped=true;this.readyState='ended';},clone(){return track(kind);}};tracks.push(value);return value;}
function stream(items=[]) {const list=[...items];return {getTracks:()=>list,getAudioTracks:()=>list.filter(t=>t.kind==='audio'),addTrack:t=>list.push(t)};}
class FakeRecorder {
 static isTypeSupported(type){return type==='video/webm';}
 constructor(value,options){this.stream=value;this.mimeType=options.mimeType;this.state='inactive';recorders.push(this);}
 start(){this.state='recording';}
 stop(){if(this.state==='inactive')throw new Error('already stopped');this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob(['encoded video frames'],{type:this.mimeType})});this.onstop?.();});}
}
function fakeCanvas() {return {width:780,height:1688,getBoundingClientRect:()=>({left:0,top:0,width:390,height:844}),getContext:()=>({save(){},restore(){},translate(){},scale(){},beginPath(){},ellipse(...args){ellipses.push(args);},fill(){},stroke(){},fillText(){},fillRect(){},drawImage(...args){draws.push(args);}}),captureStream:()=>stream([track('video')])};}
function tickFrame(time){now=time;const callbacks=[...raf.values()];raf.clear();callbacks.forEach(callback=>callback(time));}
async function controller(options={}) {const value=await createViewRecorder({canvas:scene,root:app,overlayRenderer:async()=>fakeCanvas(),onReady:result=>ready.push(result),onError:error=>errors.push(error),...options});controllers.push(value);return value;}
beforeEach(()=>{
 now=0;controllers=[];ready=[];errors=[];draws=[];raf=new Map();nextFrame=1;recorders=[];tracks=[];ellipses=[];
 win={innerWidth:390,innerHeight:844,scrollX:0,scrollY:0,MediaRecorder:FakeRecorder,performance:{now:()=>now},requestAnimationFrame(callback){const id=nextFrame++;raf.set(id,callback);return id;},cancelAnimationFrame:id=>raf.delete(id)};
 doc={defaultView:win,createElement:()=>fakeCanvas(),body:{className:'',dataset:{},classList:{contains:()=>false}}};app={ownerDocument:doc};scene=fakeCanvas();
 globalThis.document=doc;globalThis.window=win;
});
afterEach(()=>{controllers.forEach(value=>value.dispose());delete globalThis.document;delete globalThis.window;});

test('mobile output dimensions preserve the actual viewport aspect and bounded pixel density',()=>{
 const size=recordingSize(scene,390,844);assert.deepEqual(size,{width:780,height:1688,scale:2});
 scene.width=2000;assert.equal(recordingSize(scene,390,844).scale,2);
 assert.equal(size.width/size.height,390/844);
 assert.equal(selectRecordingType(FakeRecorder),'video/webm');assert.equal(selectRecordingType({isTypeSupported:()=>false}),null);
});

test('records live scene plus transparent interface and returns complete local-video metadata',async()=>{
 let snapshotOptions;
 const recorder=await controller({overlayRenderer:async(element,options)=>{assert.equal(element,app);snapshotOptions=options;return fakeCanvas();}});
 assert.equal(await recorder.start({duration:30,filename:'my-portfolio'}),true);assert.equal(recorder.recording(),true);
 assert.equal(snapshotOptions.backgroundColor,null);assert.equal(snapshotOptions.scale,2);
 const cloneStyles=new Map();snapshotOptions.onclone({querySelector(selector){const element={style:{backgroundColor:'#000',backgroundImage:'gradient'}};cloneStyles.set(selector,element);return element;}});
 for(const key of ['html','body','#app','#explore'])assert.equal(cloneStyles.get(key).style.backgroundColor,'transparent');
 assert.equal(cloneStyles.get('#speed').style.visibility,'hidden','Dynamic speed retains layout without being baked into the overlay');
 assert.equal(cloneStyles.get('.joystick-knob').style.visibility,'hidden','Moving knob is not baked into the cached UI');
 tickFrame(35);tickFrame(70);now=500;const result=await recorder.stop();
 assert.equal(recorder.recording(),false);assert.equal(ready.length,1);assert.equal(errors.length,0);
 assert.equal(result.width,780);assert.equal(result.height,1688);assert.equal(result.duration,.5);
 assert.equal(result.fileName,'my-portfolio.webm');assert.equal(result.uiIncluded,true);assert.equal(result.uiRefreshMs,500);assert.equal(result.uiRefreshMode,'on-change');assert.equal(result.targetFrameRate,30);
 assert.ok(result.blob.size>0);assert.ok(result.url.startsWith('blob:'));assert.ok(result.frames>=3);
 assert.ok(draws.some(call=>call[0]===scene),'Compositor draws the actual live WebGL canvas');
 assert.ok(tracks.filter(t=>t.kind==='video').every(t=>t.stopped),'Owned video tracks are stopped');
});

test('includes independently cloned audio and never stops the source score track',async()=>{
 const sourceTrack=track('audio'),audio=stream([sourceTrack]),recorder=await controller({getAudioStream:()=>audio});
 await recorder.start();const result=await recorder.stop();
 assert.equal(result.hasAudio,true);assert.equal(sourceTrack.stopped,false);
 const clones=tracks.filter(t=>t.kind==='audio'&&t!==sourceTrack);assert.equal(clones.length,1);assert.equal(clones[0].stopped,true);
});

test('failed overlay capture degrades to scene video and reports uiIncluded honestly',async()=>{
 const recorder=await controller({overlayRenderer:async()=>{throw new Error('unsupported CSS');}});
 assert.equal(await recorder.start(),true);const result=await recorder.stop();
 assert.equal(result.uiIncluded,false);assert.equal(result.hasAudio,false);assert.equal(errors.length,1);assert.match(errors[0].message,/live scene will still record/);
});

test('cancelling an unresolved initial overlay settles start and stop without leaking capture tracks',async()=>{
 const recorder=await controller({overlayRenderer:()=>new Promise(()=>{})});
 const starting=recorder.start();await Promise.resolve();const stopping=recorder.stop();
 assert.equal(await starting,false);assert.equal(await stopping,null);assert.equal(recorder.recording(),false);
 assert.equal(recorders.length,0);assert.equal(ready.length,0);
});

test('an earlier session timer cannot stop a newly started recording',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 const recorder=await controller();await recorder.start({duration:1});await recorder.stop();
 await recorder.start({duration:3});t.mock.timers.tick(1100);assert.equal(recorder.recording(),true);
 t.mock.timers.tick(2000);await Promise.resolve();assert.equal(recorder.recording(),false);assert.equal(ready.length,2);
 t.mock.timers.reset();
});

test('duplicate starts are refused, and disposal suppresses incomplete output',async()=>{
 const recorder=await controller();assert.equal(await recorder.start(),true);assert.equal(await recorder.start(),false);
 recorder.dispose();await Promise.resolve();assert.equal(ready.length,0);assert.equal(recorder.recording(),false);
 await assert.rejects(recorder.start(),/disposed/);assert.ok(tracks.every(t=>t.stopped));
});


test('every animation frame is composited and captureStream provides the frame-rate cap',async()=>{
 const recorder=await controller();await recorder.start();
 for(const time of [16,32,48,64])tickFrame(time);
 const result=await recorder.stop();assert.equal(result.frames,5,'Initial frame plus every rAF, including sub-33ms intervals');
});

test('unchanged UI does not rerasterize while meaningful UI changes trigger one fresh snapshot',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 let snapshots=0;const recorder=await controller({overlayRenderer:async()=>{snapshots++;return fakeCanvas();}});await recorder.start();
 t.mock.timers.tick(2000);await Promise.resolve();assert.equal(snapshots,1,'Static UI remains cached across multiple checks');
 doc.body.className='driving';t.mock.timers.tick(500);await Promise.resolve();await Promise.resolve();await Promise.resolve();
 assert.equal(snapshots,2,'Entering driving mode updates the interface snapshot');
 t.mock.timers.tick(1000);await Promise.resolve();assert.equal(snapshots,2,'No repeated rasterization after the change');
 await recorder.stop();t.mock.timers.reset();
});


test('recorded joystick follows transformed DOM bounds without rerasterizing on movement',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 let left=210,top=500,snapshots=0;
 const knob={hidden:false,textContent:'↑',getBoundingClientRect:()=>({left,top,width:44,height:44})};
 const joystick={hidden:false,querySelector:()=>knob};
 app.querySelector=selector=>selector==='#joystick'?joystick:selector==='.joystick-knob'?knob:undefined;
 doc.body.className='driving';doc.body.classList.contains=name=>name==='driving';doc.body.dataset.cinematic='false';
 win.getComputedStyle=()=>({visibility:'visible',display:'block',opacity:'1',backgroundColor:'#d7edda',borderTopColor:'#fff',borderTopWidth:'1px',font:'22px sans-serif',color:'#234c3e'});
 const recorder=await controller({overlayRenderer:async()=>{snapshots++;return fakeCanvas();}});await recorder.start();
 assert.deepEqual(ellipses.at(-1).slice(0,2),[232,522]);left=240;top=470;tickFrame(16);
 assert.deepEqual(ellipses.at(-1).slice(0,2),[262,492],'Live knob follows the current diagonal drag in the very next frame');
 t.mock.timers.tick(1000);await Promise.resolve();assert.equal(snapshots,1,'Knob movement does not invoke html2canvas');
 const count=ellipses.length;doc.body.dataset.cinematic='true';tickFrame(32);assert.equal(ellipses.length,count,'Cinematic mode hides the joystick overlay');
 await recorder.stop();t.mock.timers.reset();
});

test('brake highlight changes are meaningful UI changes without polling motion values',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});let snapshots=0;const brake={dataset:{active:'false'}};app.querySelector=selector=>selector==='#brake'?brake:undefined;
 const recorder=await controller({overlayRenderer:async()=>{snapshots++;return fakeCanvas();}});await recorder.start();brake.dataset.active='true';
 t.mock.timers.tick(500);await Promise.resolve();await Promise.resolve();await Promise.resolve();assert.equal(snapshots,2);
 t.mock.timers.tick(1000);await Promise.resolve();assert.equal(snapshots,2);await recorder.stop();t.mock.timers.reset();
});
