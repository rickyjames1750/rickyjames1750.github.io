import test from 'node:test';
import assert from 'node:assert/strict';
import { joystickInput, bindJoystick } from '../src/joystick.js';
const approx = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} should equal ${expected}`);
const neutral = {throttle:0,steer:0,brake:0,x:0,y:0};
function pointer(element,type,x,y,id=1,button=0) {const event=new Event(type,{cancelable:true});Object.assign(event,{pointerId:id,clientX:x,clientY:y,button});element.dispatchEvent(event);return event;}
function fixture() {
 const win=new EventTarget(),doc=new EventTarget();doc.defaultView=win;doc.hidden=false;
 const element=new EventTarget(),knob={style:{}};element.ownerDocument=doc;element.style={touchAction:'pan-y'};element.dataset={};element.querySelector=()=>knob;
 element.getBoundingClientRect=()=>({left:100,top:200,width:100,height:100});element.captured=new Set();
 element.setPointerCapture=id=>element.captured.add(id);
 element.releasePointerCapture=id=>{element.captured.delete(id);pointer(element,'lostpointercapture',150,250,id);};
 const values=[],starts=[];const control=bindJoystick(element,{onStart:()=>starts.push(true),onChange:value=>values.push(value)});
 return {element,knob,win,doc,values,starts,control};
}

test('one-finger cardinal movement has forward, reverse, and steering-assist behavior',()=>{
 assert.deepEqual(joystickInput(0,0),neutral);
 assert.equal(joystickInput(0,-1).throttle,1);assert.equal(joystickInput(0,1).throttle,-1);
 const left=joystickInput(-1,0),right=joystickInput(1,0);
 assert.equal(left.steer,1);assert.equal(right.steer,-1);approx(left.throttle,.45);approx(right.throttle,.45);
 assert.equal(joystickInput(.7,.4).throttle,-.4,'Intentional downward diagonal reverses rather than driving forward');
});

test('circular clamp preserves diagonal direction and deadzone/invalid data stay neutral',()=>{
 const diagonal=joystickInput(2,-2);approx(diagonal.x,Math.SQRT1_2);approx(diagonal.y,-Math.SQRT1_2);
 approx(Math.hypot(diagonal.x,diagonal.y),1);approx(diagonal.throttle,Math.SQRT1_2);approx(diagonal.steer,-Math.SQRT1_2);
 assert.deepEqual(joystickInput(.04,.05),neutral);assert.deepEqual(joystickInput(.08,0),neutral);
 assert.deepEqual(joystickInput(NaN,1),neutral);assert.deepEqual(joystickInput(Infinity,-1),neutral);
});

test('pointer capture supports diagonal motion and invokes onStart only once per gesture',()=>{
 const f=fixture();assert.equal(f.element.dataset.active,'false');assert.equal(f.element.style.touchAction,'none');
 const down=pointer(f.element,'pointerdown',150,250);assert.equal(down.defaultPrevented,true);assert.equal(f.starts.length,1);assert.ok(f.element.captured.has(1));
 pointer(f.element,'pointermove',186,214);pointer(f.element,'pointermove',180,220);
 assert.equal(f.starts.length,1);const latest=f.values.at(-1);assert.equal(latest.active,true);assert.ok(latest.throttle>0&&latest.steer<0);
 assert.notEqual(f.knob.style.transform,'translate(0px, 0px)');
 pointer(f.element,'pointerup',180,220);assert.deepEqual(f.values.at(-1),{...neutral,active:false});assert.equal(f.knob.style.transform,'translate(0px, 0px)');
 assert.equal(f.element.dataset.active,'false');assert.equal(f.element.captured.size,0);f.control.destroy();
});

test('second fingers cannot steal or release the active pointer',()=>{
 const f=fixture();pointer(f.element,'pointerdown',150,214,1);const count=f.values.length;
 pointer(f.element,'pointerdown',186,250,2);pointer(f.element,'pointermove',186,250,2);pointer(f.element,'pointerup',186,250,2);
 assert.equal(f.starts.length,1);assert.equal(f.values.length,count);assert.equal(f.element.dataset.active,'true');
 pointer(f.element,'pointerup',150,214,1);assert.equal(f.values.at(-1).active,false);f.control.destroy();
});

test('cancel, lost capture, blur, visibility, and global release all clear the input',()=>{
 const f=fixture();
 for(const reset of [()=>pointer(f.element,'pointercancel',186,250),()=>pointer(f.element,'lostpointercapture',186,250),()=>f.win.dispatchEvent(new Event('blur')),()=>{f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));f.doc.hidden=false;},()=>pointer(f.win,'pointerup',186,250)]) {
  pointer(f.element,'pointerdown',186,250);assert.equal(f.values.at(-1).active,true);reset();assert.deepEqual(f.values.at(-1),{...neutral,active:false});assert.equal(f.element.dataset.active,'false');
 }
 f.control.destroy();
});

test('destroy resets movement, restores touch action, and removes all input listeners',()=>{
 const f=fixture();pointer(f.element,'pointerdown',186,214);f.control.destroy();
 assert.deepEqual(f.values.at(-1),{...neutral,active:false});assert.equal(f.element.style.touchAction,'pan-y');
 const count=f.values.length;pointer(f.element,'pointerdown',150,214);f.win.dispatchEvent(new Event('blur'));f.control.reset();
 assert.equal(f.values.length,count);assert.equal(f.starts.length,1);
});
