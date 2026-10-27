import test from 'node:test';
import assert from 'node:assert/strict';
import {raceTime} from '../src/race-ui.js';

test('race clocks carry rounded centiseconds into the next minute',()=>{
 assert.equal(raceTime(59.999),'1:00.00');
 assert.equal(raceTime(119.999),'2:00.00');
 assert.equal(raceTime(59.994),'0:59.99');
 assert.equal(raceTime(60.001),'1:00.00');
});

test('race clocks keep stable zero padding and handle unavailable values',()=>{
 assert.equal(raceTime(0),'0:00.00');
 assert.equal(raceTime(9.8),'0:09.80');
 assert.equal(raceTime(92.35),'1:32.35');
 assert.equal(raceTime(-1),'0:00.00');
 for(const value of [null,undefined,NaN,Infinity,-Infinity])assert.equal(raceTime(value),'—');
});
