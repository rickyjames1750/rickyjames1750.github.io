import test from 'node:test';
import assert from 'node:assert/strict';
import { CatmullRomCurve3, Scene, Vector3 } from 'three';
import { CORRIDORS, createCorridorIndex, footprintDistanceToPolyline, closestPointOnPolyline, sampleCurvePolyline } from '../src/corridors.js';
import { createDrivingCurve } from '../src/driving-route.js';
import { createLandmarks } from '../src/landmarks.js';
import { createStreets } from '../src/streets.js';
import { project, peninsulaCoast, railCoordinates } from '../src/geography.js';
import { zones } from '../src/content.js';

const points=peninsulaCoast.map(c=>project(...c));
function onLand(x,z){let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a.z>z)!==(b.z>z)&&x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)inside=!inside;}return inside;}
const railCurve=()=>new CatmullRomCurve3(railCoordinates.map(c=>{const p=project(...c);return new Vector3(p.x,.84,p.z);}),false,'catmullrom',.15);
const withCanvas=callback=>{const previous=globalThis.document;globalThis.document={createElement:()=>({getContext:()=>({clearRect(){},fillText(){},fillRect(){}})})};try{return callback();}finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}};

test('full footprint distance catches long side edges and rotated corners missed by center checks',()=>{
  const line=[{x:0,z:-20},{x:0,z:20}];
  assert.equal(footprintDistanceToPolyline({x:3,z:0,w:8,d:1},line),0,'long building crosses the line despite distant center');
  assert.ok(Math.abs(footprintDistanceToPolyline({x:6,z:0,w:4,d:4},line)-4)<1e-9);
  const rotated=footprintDistanceToPolyline({x:6,z:0,w:6,d:1,rotation:Math.PI/4},line);
  assert.ok(rotated<4,'rotated corner changes the horizontal reservation');
  assert.equal(footprintDistanceToPolyline({x:2,z:0,r:3},line),0);
  assert.ok(Math.abs(closestPointOnPolyline({x:.5,z:5},[{x:0,z:0},{x:0,z:10}]).distance-.5)<1e-9,'segment distance does not dip between samples');
});

test('placement index reserves complete roadway sidewalks and rail pole bands',()=>{
  const road=new CatmullRomCurve3([new Vector3(-7,0,-30),new Vector3(-7,0,30)]);
  const rail=new CatmullRomCurve3([new Vector3(0,0,-30),new Vector3(0,0,30)]),index=createCorridorIndex(road,rail);
  assert.equal(index.isClear({x:-3.2,z:0,w:.5,d:1}),false,'inside road sidewalk/verge');
  assert.equal(index.isClear({x:1.8,z:0,r:.2}),false,'inside rail electrification pole band');
  assert.equal(index.isClear({x:-14,z:0,w:2,d:3}),true,'landward building with full footprint clear');
  assert.ok(index.roadClearance({x:-14,z:0,w:2,d:3})>1);
});

test('900 whole road cross-sections clear live rail, overhead poles, landmarks, and coastline',()=>withCanvas(()=>{
  const rail=railCurve(),architecture=createLandmarks(new Scene(),project),road=createDrivingCurve(rail,architecture.colliders,{isOnLand:onLand});
  const railPoints=sampleCurvePolyline(rail),railHalf=CORRIDORS.railInfrastructureHalfWidth;
  for(let i=0;i<=900;i++){
    const p=road.getPointAt(i/900),d=road.getTangentAt(i/900),flat=Math.hypot(d.x,d.z),nx=-d.z/flat,nz=d.x/flat;
    assert.ok(closestPointOnPolyline(p,railPoints).distance>=CORRIDORS.minCenterlineSeparation-.015,`road/rail spacing at ${i}`);
    for(const offset of [-CORRIDORS.roadReservedHalfWidth,0,CORRIDORS.roadReservedHalfWidth]){
      const edge={x:p.x+nx*offset,z:p.z+nz*offset};
      assert.ok(onLand(edge.x,edge.z),`full road envelope on land at ${i}/${offset}`);
      assert.ok(closestPointOnPolyline(edge,railPoints).distance>=railHalf+CORRIDORS.separationGap-.03,`verge cannot reach overhead pole band at ${i}/${offset}`);
      for(const collider of architecture.colliders)assert.ok(Math.hypot(edge.x-collider.x,edge.z-collider.z)>=collider.r+.2,`sidewalk clears architecture at ${i}/${offset}`);
    }
  }
}));

test('street and platform furniture leave both carriageway and train running envelope open',()=>withCanvas(()=>{
  const rail=railCurve(),architecture=createLandmarks(new Scene(),project),road=createDrivingCurve(rail,architecture.colliders,{isOnLand:onLand});
  const street=createStreets(new Scene(),{roadCurve:road,railCurve:rail,zones}),index=createCorridorIndex(road,rail);
  assert.ok(street.furnitureFootprints.length>=60);
  assert.equal(street.groundMeshes.length,36,'both sidewalks, curbs, and five station surfaces retained for wheel sampling');
  for(const item of street.furnitureFootprints){
    assert.ok(footprintDistanceToPolyline(item,index.road)>CORRIDORS.roadPavementHalfWidth+.05,`${item.kind} stays off road`);
    assert.ok(footprintDistanceToPolyline(item,index.rail)>CORRIDORS.railTrackHalfWidth+.08,`${item.kind} stays off rails`);
  }
}));


test('station access areas reserve finite east-side footprints without clearing the whole rail corridor',()=>{
  const road=new CatmullRomCurve3([new Vector3(-7,0,-30),new Vector3(-7,0,30)]);
  const rail=new CatmullRomCurve3([new Vector3(0,0,-30),new Vector3(0,0,30)]);
  const index=createCorridorIndex(road,rail,{stations:[{id:'test',x:0,z:0}]});
  assert.equal(index.isClear({x:4.4,z:0,w:.8,d:1}),false,'building cannot occupy platform access ramp');
  assert.equal(index.isClear({x:4.4,z:18,w:.8,d:1}),true,'space farther along rail is not blanket-blocked');
  assert.equal(index.isClear({x:3.2,z:0,r:.1}),false,'tree inside station footprint is rejected');
});

const signedArea=(a,b,c)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
function roadTriangles(curve,width=4.2,count=450){
  const rows=Array.from({length:count+1},(_,i)=>{const p=curve.getPoint(i/count),d=curve.getTangent(i/count);return [{x:p.x-d.z*width/2,z:p.z+d.x*width/2},{x:p.x+d.z*width/2,z:p.z-d.x*width/2}];});
  const result=[];for(let i=0;i<count;i++){
    const [a,b]=rows[i],[c,d]=rows[i+1];for(const points of [[a,c,b],[b,c,d]])result.push({row:i,points,minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minZ:Math.min(...points.map(p=>p.z)),maxZ:Math.max(...points.map(p=>p.z))});
  }return result;
}
function strictlyInside(p,t){const a=signedArea(t[0],t[1],p),b=signedArea(t[1],t[2],p),c=signedArea(t[2],t[0],p);return a>1e-7&&b>1e-7&&c>1e-7||a< -1e-7&&b< -1e-7&&c< -1e-7;}
function properEdgeCross(a,b,c,d){return signedArea(a,b,c)*signedArea(a,b,d)< -1e-9&&signedArea(c,d,a)*signedArea(c,d,b)< -1e-9;}

test('rendered road ribbons have positive face areas and no nonadjacent coplanar overlaps',()=>withCanvas(()=>{
  const architecture=createLandmarks(new Scene(),project),road=createDrivingCurve(railCurve(),architecture.colliders,{isOnLand:onLand});
  for(const width of [4.2,CORRIDORS.roadReservedHalfWidth*2]){
    const triangles=roadTriangles(road,width);
    for(const triangle of triangles)assert.ok(-signedArea(...triangle.points)>1e-6,`width ${width}, row ${triangle.row}: no folded/inverted ribbon face`);
    for(let i=0;i<triangles.length;i++)for(let j=i+1;j<triangles.length;j++){
      const a=triangles[i],b=triangles[j];if(Math.abs(a.row-b.row)<2||a.maxX<b.minX||b.maxX<a.minX||a.maxZ<b.minZ||b.maxZ<a.minZ)continue;
      assert.equal(a.points.some(p=>strictlyInside(p,b.points))||b.points.some(p=>strictlyInside(p,a.points)),false,`width ${width}: nonadjacent rows ${a.row}/${b.row} overlap`);
      for(let k=0;k<3;k++)for(let l=0;l<3;l++)assert.equal(properEdgeCross(a.points[k],a.points[(k+1)%3],b.points[l],b.points[(l+1)%3]),false,`width ${width}: nonadjacent edges cross`);
    }
  }
}));

test('driving alignment has no cusps and a comfortable minimum five-unit bend radius',()=>withCanvas(()=>{
  const architecture=createLandmarks(new Scene(),project),road=createDrivingCurve(railCurve(),architecture.colliders,{isOnLand:onLand});
  const count=3000,ds=road.getLength()/count;let minRadius=Infinity;
  for(let i=2;i<count-1;i++){
    const previous=road.getTangentAt((i-1)/count),next=road.getTangentAt((i+1)/count),angle=Math.acos(Math.max(-1,Math.min(1,previous.dot(next))));
    assert.ok(previous.z>0&&next.z>0,'north/south direction never doubles back');
    if(angle>1e-6)minRadius=Math.min(minRadius,2*ds/angle);
  }
  assert.ok(minRadius>5,`minimum bend radius ${minRadius} must clear both sidewalks without folding`);
}));

test('raised curb inner edges stay outside actual rendered asphalt faces',()=>withCanvas(()=>{
  const architecture=createLandmarks(new Scene(),project),road=createDrivingCurve(railCurve(),architecture.colliders,{isOnLand:onLand}),asphalt=roadTriangles(road,4.2);
  for(const side of [-1,1])for(let i=0;i<=360;i++){
    const p=road.getPointAt(i/360),d=road.getTangentAt(i/360),curb={x:p.x+d.z*side*2.24,z:p.z-d.x*side*2.24};
    assert.equal(asphalt.some(t=>curb.x>=t.minX&&curb.x<=t.maxX&&curb.z>=t.minZ&&curb.z<=t.maxZ&&strictlyInside(curb,t.points)),false,`curb side ${side} sample ${i} cannot cut through pavement`);
  }
}));
