import test from 'node:test';
import assert from 'node:assert/strict';
import { CatmullRomCurve3, Scene, Vector3 } from 'three';
import { createStreets } from '../src/streets.js';
import { createMeshHeightSampler } from '../src/surfaces.js';

const withCanvas=callback=>{const previous=globalThis.document;globalThis.document={createElement:()=>({getContext:()=>({clearRect(){},fillText(){},fillRect(){}})})};try{return callback();}finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}};

// The westbound approach leaves a north/south main road at the sample containing a streetlamp.
const driveway={contains:(x,z,margin=0)=>x>=-25-margin&&x<=-6.9+margin&&Math.abs(z+4.2)<=2.1+margin};
const routes=()=>({roadCurve:new CatmullRomCurve3([new Vector3(-7,.79,-30),new Vector3(-7,.79,30)]),railCurve:new CatmullRomCurve3([new Vector3(0,.84,-30),new Vector3(0,.84,30)]),zones:[]});

test('sidewalk and curb openings leave a driving junction unobstructed while retaining surrounding sidewalks',()=>withCanvas(()=>{
  const plain=createStreets(new Scene(),routes()),opened=createStreets(new Scene(),{...routes(),driveways:[driveway]});
  const original=createMeshHeightSampler(plain.groundMeshes),cut=createMeshHeightSampler(opened.groundMeshes);
  assert.ok(original(-9.75,-4.2).height>.82,'the uncut sidewalk crosses the approach');
  assert.equal(cut(-9.75,-4.2).height,.6,'junction opening has no raised sidewalk surface');
  assert.equal(cut(-9.32,-4.2).height,.6,'the matching raised curb is also absent');
  assert.ok(cut(-9.75,-12).height>.82,'the same continuous sidewalk remains away from the junction');
  assert.ok(cut(-4.25,-4.2).height>.82,'the opposite sidewalk is preserved when the approach leaves one side only');
}));

test('junction clears conservative lamp and planter footprints instead of leaving furniture in the approach',()=>withCanvas(()=>{
  const plain=createStreets(new Scene(),routes()),opened=createStreets(new Scene(),{...routes(),driveways:[driveway]});
  assert.ok(opened.furnitureFootprints.length<plain.furnitureFootprints.length,'at least the approach streetlamp is removed');
  for(const item of opened.furnitureFootprints){const radius=Math.hypot(item.w,item.d)/2+.4;assert.equal(driveway.contains(item.x,item.z,radius),false,`${item.kind} does not intersect the driveway envelope`);}
}));
