import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {NARRATION_CLIPS} from '../src/voice-guide.js';

function inspectRecording(bytes){
 let offset=0,frames=0,seconds=0;
 if(bytes.subarray(0,3).toString()==='ID3'){
  const size=[6,7,8,9].reduce((value,index)=>(value<<7)|(bytes[index]&127),0);
  offset=10+size+((bytes[5]&16)?10:0);
 }
 while(offset+4<=bytes.length){
  if(bytes.subarray(offset,offset+3).toString()==='TAG'&&bytes.length-offset===128)break;
  const header=bytes.readUInt32BE(offset);
  assert.equal((header>>>21)&2047,2047,'Every frame has an MPEG sync header');
  const version=(header>>>19)&3,layer=(header>>>17)&3;
  assert.equal(version,2,'Recordings use MPEG-2 at the mastered sample rate');
  assert.equal(layer,1,'Recordings use MPEG Layer III');
  const bitrate=[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,0][(header>>>12)&15]*1000;
  const sampleRate=[44100,48000,32000][(header>>>10)&3]/2;
  assert.equal(bitrate,128000);assert.equal(sampleRate,24000);
  assert.equal((header>>>6)&3,3,'Speech is mono');
  const frameLength=Math.floor(72*bitrate/sampleRate)+((header>>>9)&1);
  assert.ok(offset+frameLength<=bytes.length,'Audio frames are complete');
  offset+=frameLength;frames++;seconds+=576/sampleRate;
 }
 assert.ok(frames>70,'A full spoken phrase is bundled');
 assert.ok(seconds>=2&&seconds<=10,'Guide phrases are short and finite');
 assert.ok(bytes.length-offset<=128,'No unexpected trailing audio data');
 return seconds;
}

test('every guide phrase is a complete, compact MP3 shipped with the site',async()=>{
 let total=0;
 for(const clip of Object.keys(NARRATION_CLIPS)){
  const file=new URL(`../public/narration/${clip}.mp3`,import.meta.url);
  const [bytes,info]=await Promise.all([readFile(file),stat(file)]);
  assert.ok(info.isFile(),`${clip} exists in the public build input`);
  assert.ok(info.size>30000&&info.size<180000,`${clip} is a compact complete phrase`);
  inspectRecording(bytes);total+=info.size;
 }
 assert.equal(Object.keys(NARRATION_CLIPS).length,13);
 assert.ok(total<2_000_000,'The full optional guide stays below two megabytes');
});
