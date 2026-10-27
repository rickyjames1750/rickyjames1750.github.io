import test from 'node:test';
import assert from 'node:assert/strict';
import { measureAudio, audioBufferWav, DIAGNOSTIC_STEMS, diagnosticCuesAt } from '../src/audio-diagnostics.js';

const buffer = channels => ({numberOfChannels:channels.length,length:channels[0].length,sampleRate:24000,getChannelData:channel=>Float32Array.from(channels[channel])});
test('audio diagnostics measure sample RMS, peak, silence, and clipped samples accurately',()=>{
 const measured=measureAudio(buffer([[.5,-.5,.5,-.5],[.5,-.5,.5,-.5]]));
 assert.equal(measured.rms,.5);assert.equal(measured.peak,.5);assert.equal(measured.rmsDBFS,-6.02);assert.equal(measured.clippedSamples,0);
 assert.deepEqual(measureAudio(buffer([[0,0]])),{rms:0,peak:0,rmsDBFS:null,peakDBFS:null,clippedSamples:0});
 assert.equal(measureAudio(buffer([[1,-1,1.1,0]])).clippedSamples,3);
});
test('listenable diagnostic WAVs preserve channel layout and sample rate',async()=>{
 const wav=audioBufferWav(buffer([[.5,-.5],[.25,-.25]])),bytes=await wav.arrayBuffer(),view=new DataView(bytes);
 assert.equal(wav.type,'audio/wav');assert.equal(view.getUint16(22,true),2);assert.equal(view.getUint32(24,true),24000);assert.equal(view.getUint32(40,true),8);
 assert.equal(view.getInt16(44,true),16384);assert.equal(view.getInt16(46,true),8192);assert.equal(view.getInt16(48,true),-16383);
});


test('cinematic and race diagnostics isolate named cues on a fixed finite trace',()=>{
 for(const stem of ['focus','reveal','race','page-turn','pad','combined'])assert.ok(DIAGNOSTIC_STEMS.includes(stem));
 for(const stem of ['focus','reveal']){
  const cues=Array.from({length:160},(_,tick)=>diagnosticCuesAt(stem,tick)).flat();assert.deepEqual(cues,[['transition',stem]]);
 }
 assert.deepEqual(diagnosticCuesAt('race',70),[['raceCue','go']]);assert.deepEqual(diagnosticCuesAt('race',124),[['raceCue','finish']]);
 assert.deepEqual(diagnosticCuesAt('combined',106),[['impact',.7]]);
 for(let tick=0;tick<160;tick++)assert.deepEqual(diagnosticCuesAt('idle-effects',tick),[],'Idle recording cannot receive action sounds');
});


test('page and lane-pad listening stems schedule exactly one finite gesture',()=>{
 assert.deepEqual(Array.from({length:160},(_,tick)=>diagnosticCuesAt('page-turn',tick)).flat(),[['pageTurn',null]]);
 assert.deepEqual(Array.from({length:160},(_,tick)=>diagnosticCuesAt('pad',tick)).flat(),[['raceCue','pad']]);
 assert.deepEqual(diagnosticCuesAt('combined',30),[['pageTurn',null]]);assert.deepEqual(diagnosticCuesAt('combined',92),[['raceCue','pad']]);
});
