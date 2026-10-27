import test from 'node:test';
import assert from 'node:assert/strict';
import {readingState,scrollPosition} from '../src/resume-reader.js';
test('long sections expose unread content and progress at each reading position',()=>{
 const start=readingState({scrollTop:0,scrollHeight:2400,clientHeight:600});assert.equal(start.extent,1800);assert.equal(start.percent,0);assert.equal(start.atEnd,false);
 const middle=readingState({scrollTop:900,scrollHeight:2400,clientHeight:600});assert.equal(middle.percent,50);assert.equal(middle.atEnd,false);
 const end=readingState({scrollTop:1799,scrollHeight:2400,clientHeight:600});assert.equal(end.atEnd,true);
});
test('sections fitting the panel report full visibility without a draggable scroll range',()=>{
 for(const height of [0,350,600]){const state=readingState({scrollTop:0,scrollHeight:height,clientHeight:600});assert.equal(state.scrollable,false);assert.equal(state.percent,100);assert.equal(state.atEnd,true);}
});
test('overscroll and shrinking content never create invalid or excessive progress',()=>{
 assert.equal(readingState({scrollTop:-30,scrollHeight:1200,clientHeight:400}).percent,0);
 assert.equal(readingState({scrollTop:1000,scrollHeight:1200,clientHeight:400}).percent,100);
 assert.equal(readingState({scrollTop:1000,scrollHeight:300,clientHeight:400}).top,0);
});
test('the permanent slider maps and clamps to the actual available scroll extent',()=>{
 assert.equal(scrollPosition(25,1600),400);assert.equal(scrollPosition(100,1600),1600);assert.equal(scrollPosition(-3,1600),0);assert.equal(scrollPosition(300,1600),1600);assert.equal(scrollPosition(50,0),0);assert.equal(scrollPosition(NaN,500),0);
});
