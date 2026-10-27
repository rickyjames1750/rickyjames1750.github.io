import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, CatmullRomCurve3, Vector3 } from 'three';
import { createStreets } from '../src/streets.js';

const withCanvas=callback=>{const previous=globalThis.document;globalThis.document={createElement:()=>({getContext:()=>({clearRect(){},fillText(){},fillRect(){}})})};try{return callback();}finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}};

test('batched road and station floor materials keep all shadow flags disabled',()=>withCanvas(()=>{
  const scene=new Scene(),roadCurve=new CatmullRomCurve3([new Vector3(-7,.79,-30),new Vector3(-7,.79,30)]),railCurve=new CatmullRomCurve3([new Vector3(0,.84,-30),new Vector3(0,.84,30)]);
  const {root,groundMeshes}=createStreets(scene,{roadCurve,railCurve,zones:[{id:'about',city:'Test',x:0,z:0}]});
  const floorColors=new Set(['9aa69c','c4c7ae','53605b','d6b25e','7b8e83','7f9488']);let floorCount=0;
  root.traverse(object=>{if(!object.isMesh||!floorColors.has(object.material.color?.getHexString()))return;floorCount++;assert.equal(object.castShadow,false,'thin floor geometry cannot cast shadow-map stripes');assert.equal(object.receiveShadow,false,'floor shadow state cannot be resurrected by material batching');});
  assert.ok(floorCount>=6,'curbs, sidewalk, access landings and tile joints remain rendered');
  assert.ok(groundMeshes.length>6,'exact ground proxies survive the render batching change');
}));

test('shadow batching separates thin poles from three-dimensional furniture sharing metal material',()=>withCanvas(()=>{
  const roadCurve=new CatmullRomCurve3([new Vector3(-7,.79,-30),new Vector3(-7,.79,30)]),railCurve=new CatmullRomCurve3([new Vector3(0,.84,-30),new Vector3(0,.84,30)]);
  const {root}=createStreets(new Scene(),{roadCurve,railCurve,zones:[{id:'about',city:'Test',x:0,z:0}]});
  const flags=new Set();root.traverse(object=>{if(object.isMesh&&object.material.color?.getHexString()==='3b5154')flags.add(`${object.castShadow}/${object.receiveShadow}`);});
  assert.ok(flags.has('false/false'),'fine lamppoles remain free of shadow-map aliasing');
  assert.ok(flags.has('true/true'),'canopies, bench frames and other solid furniture retain 3D shadows');
}));
