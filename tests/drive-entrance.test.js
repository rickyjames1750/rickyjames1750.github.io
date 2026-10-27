import test from 'node:test';
import assert from 'node:assert/strict';
import {createDriveEntrance} from '../src/drive-entrance.js';
const tick=(entrance,seconds)=>{for(let i=0;i<seconds*60;i++)entrance.update(1/60);};
test('entrance waits at the car for the second gesture, then reveals',()=>{const phases=[],e=createDriveEntrance({onChange:p=>phases.push(p)});e.begin();tick(e,2);assert.equal(e.state().phase,'ready');tick(e,10);assert.equal(e.state().phase,'ready');e.reveal();tick(e,2);assert.equal(e.state().active,false);assert.deepEqual(phases,['approach','ready','reveal','idle']);});
test('early second tap queues a reveal and never cancels the approach',()=>{const e=createDriveEntrance();e.begin();e.reveal();assert.equal(e.state().phase,'approach');tick(e,2);assert.equal(e.state().phase,'reveal');tick(e,2);assert.equal(e.state().phase,'idle');});
test('navigation can cancel entrance and restarting clears prior gestures',()=>{const e=createDriveEntrance();e.begin();e.reveal();e.cancel();assert.equal(e.state().active,false);e.begin();tick(e,2);assert.equal(e.state().phase,'ready');});
test('reduced motion entrance is brief but still requires a second gesture',()=>{const e=createDriveEntrance({reducedMotion:true});e.begin();tick(e,.1);assert.equal(e.state().phase,'ready');e.reveal();tick(e,.2);assert.equal(e.state().active,false);});
test('invalid time cannot poison entrance state',()=>{const e=createDriveEntrance();e.begin();e.update(NaN);e.update(-1);assert.equal(e.state().progress,0);e.update(100);assert.ok(e.state().progress<1);});
