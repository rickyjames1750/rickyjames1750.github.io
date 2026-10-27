import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, Scene, ShaderLib, Vector3 } from 'three';
import { createUrbanNature } from '../src/urban-nature.js';

const trees=[{x:3,z:-4,s:.5},{x:-9,z:2,s:1.3},{x:1,z:8,s:.85}];
const buildings=[{x:12,z:5,h:5.2,w:1.7,d:1.4,c:.4},{x:-13,z:5,h:2.8,w:.9,d:1.2,c:.8}];
function fixture(extra={}){const scene=new Scene(),nature=createUrbanNature({scene,treePositions:trees,buildings,...extra});return {scene,nature};}
function batch(root,name){const mesh=root.getObjectByName(name);assert.ok(mesh?.isInstancedMesh,name);return mesh;}
function everyVertex(mesh,visit){const m=new Matrix4(),v=new Vector3(),position=mesh.geometry.getAttribute('position');for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,m);for(let j=0;j<position.count;j++){v.fromBufferAttribute(position,j).applyMatrix4(m);visit(v,i);}}}

test('rich crowns, branched trunks and grass respect pre-reserved tree footprints',()=>{
  const {nature}=fixture();
  for(const name of ['Layered leafy crowns','Wind grass clumps','Branched coastal trunks']){
    const mesh=batch(nature.root,name);
    everyVertex(mesh,(v,i)=>{const tree=trees[i%trees.length];const animatedMargin=name==='Layered leafy crowns'?.007*tree.s:name==='Wind grass clumps'?.031*tree.s:0;assert.ok(Math.hypot(v.x-tree.x,v.z-tree.z)+animatedMargin<=.8*tree.s+1e-6,`${name} exceeds the reserved foliage radius`);assert.ok(v.y>=.6-1e-6,'tree detail cannot be planted under the terrain');});
  }
  const leaves=batch(nature.root,'Layered leafy crowns'),tufts=batch(nature.root,'Wind grass clumps'),triangles=leaves.geometry.getAttribute('position').count/3;assert.ok(triangles>=200&&triangles<=350,'individual leaves remain within the mobile cluster triangle budget');assert.equal(tufts.geometry.getAttribute('position').count/3,15,'each grass tuft contains five curved blades');for(const mesh of [leaves,tufts]){const colors=mesh.geometry.getAttribute('color');assert.ok(colors?.count===mesh.geometry.getAttribute('position').count);assert.ok(new Set(Array.from(colors.array).map(n=>n.toFixed(2))).size>6,'leaf and grass highlights use varied vertex shades');}
  assert.equal(nature.stats.canopyClusters,trees.length*5);assert.equal(nature.stats.grassTufts,trees.length*6);assert.equal(nature.stats.grassBlades,trees.length*30);
  assert.equal(nature.canopy.count,trees.length);assert.equal(nature.canopy.parent,null,'camera proxies cannot accidentally double-render the canopy');nature.dispose();
});

test('facade windows stay on authored walls and roof details stay over the building footprint',()=>{
  const {nature}=fixture(),panels=batch(nature.root,'Warm rooms and cool glass');
  assert.ok(nature.stats.windows>100);assert.ok(nature.stats.occupants>0);
  everyVertex(panels,v=>{const b=buildings.find(b=>Math.abs(v.x-b.x)<=b.w/2+.011&&Math.abs(v.z-b.z)<=b.d/2+.011);assert.ok(b,'window cannot drift outside its host facade');assert.ok(v.y>=.63&&v.y<=.63+b.h);const edgeX=Math.abs(Math.abs(v.x-b.x)-b.w/2),edgeZ=Math.abs(Math.abs(v.z-b.z)-b.d/2);assert.ok(Math.min(edgeX,edgeZ)<.011,'window must face out from an existing wall');});
  for(const name of ['Architectural cornices and plinths','Rooftop air handling','Inset flat roofs'])everyVertex(batch(nature.root,name),v=>{assert.ok(buildings.some(b=>Math.abs(v.x-b.x)<=b.w/2+1e-6&&Math.abs(v.z-b.z)<=b.d/2+1e-6),'roof detail must preserve the building footprint');});
  const shader={vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader,uniforms:{}};panels.material.onBeforeCompile(shader);assert.equal(shader.uniforms.uUrbanTime,nature.root.userData.windUniform);assert.match(shader.vertexShader,/vUrbanRoomColor=instanceColor/);assert.match(shader.fragmentShader,/urbanPulse\*urbanShade\*vUrbanRoomColor/);nature.dispose();
});

test('wind and subtle room animation pause, respect reduced motion and keep ECO trees distributed',()=>{
  const {nature}=fixture();nature.update({dt:.05});assert.equal(nature.stats.animationTime,.05);nature.update({dt:10,paused:true});assert.equal(nature.stats.animationTime,.05);nature.update({dt:10});assert.ok(Math.abs(nature.stats.animationTime-.15)<1e-10,'a long suspended frame cannot jump the shader clock');
  nature.update({quality:'eco',paused:true});assert.equal(nature.stats.canopyClusters,trees.length*3);assert.equal(nature.stats.grassTufts,trees.length*3);assert.equal(nature.stats.grassBlades,trees.length*15);
  const canopy=batch(nature.root,'Layered leafy crowns'),m=new Matrix4(),p=new Vector3();for(let i=0;i<trees.length;i++){canopy.getMatrixAt(i,m);p.setFromMatrixPosition(m);assert.ok(Math.hypot(p.x-trees[i].x,p.z-trees[i].z)<1e-6,'ECO retains every tree rather than cutting one end of the map');}
  nature.update({quality:'high',dt:.02});assert.equal(nature.stats.canopyClusters,trees.length*5);assert.ok(nature.stats.drawCalls<=11);nature.dispose();
  const reduced=fixture({reducedMotion:true}).nature;reduced.update({dt:2});assert.equal(reduced.stats.animationTime,0);reduced.dispose();
});

test('bounded static batches contain finite transforms and release their owned GPU resources',()=>{
  const {scene,nature}=fixture(),geometries=new Set(),materials=new Set();for(const mesh of [...nature.root.children,nature.canopy]){assert.ok(mesh.count<=mesh.instanceMatrix.count);assert.ok(Array.from(mesh.instanceMatrix.array).every(Number.isFinite));geometries.add(mesh.geometry);materials.add(mesh.material);}
  let releasedGeometry=0,releasedMaterial=0;for(const g of geometries)g.addEventListener('dispose',()=>releasedGeometry++);for(const m of materials)m.addEventListener('dispose',()=>releasedMaterial++);
  assert.equal(nature.root.parent,scene);nature.dispose();nature.dispose();assert.equal(nature.root.parent,null);assert.equal(releasedGeometry,geometries.size);assert.equal(releasedMaterial,materials.size);const clock=nature.stats.animationTime;nature.update({dt:1});assert.equal(nature.stats.animationTime,clock);
  const empty=createUrbanNature({scene,treePositions:[{x:NaN,z:0,s:1}],buildings:[]});assert.equal(empty.stats.trees,0);assert.equal(empty.stats.drawCalls,0);empty.dispose();
});

test('roadside grass patches reuse the finite grass batch without generating tree geometry',()=>{
  const scene=new Scene(),patches=[{x:14,z:-5,s:.5},{x:22,z:10,s:1},{x:-2,z:30,s:.73}];
  const nature=createUrbanNature({scene,treePositions:[trees[0]],grassPatches:patches,buildings:[]}),sites=[trees[0],...patches],grass=batch(nature.root,'Wind grass clumps');
  assert.equal(nature.stats.trees,1);assert.equal(nature.stats.grassPatches,patches.length);assert.equal(nature.stats.canopyClusters,5);assert.equal(nature.canopy.count,1);assert.equal(batch(nature.root,'Branched coastal trunks').count,5);assert.equal(nature.stats.grassTufts,sites.length*6);
  everyVertex(grass,(v,i)=>{const p=sites[i%sites.length];assert.ok(Math.hypot(v.x-p.x,v.z-p.z)+.031*p.s<=.8*p.s+1e-6,'wind-displaced roadside grass must stay inside its supplied reservation');});
  const draws=nature.stats.drawCalls;nature.update({quality:'eco',paused:true});assert.equal(nature.stats.grassTufts,sites.length*3);assert.equal(nature.stats.drawCalls,draws,'roadside planting cannot add rendering passes');nature.dispose();
  const grassOnly=createUrbanNature({scene,grassPatches:patches});assert.equal(grassOnly.stats.trees,0);assert.equal(grassOnly.canopy.count,0);assert.equal(batch(grassOnly.root,'Branched coastal trunks').count,0);assert.equal(batch(grassOnly.root,'Layered leafy crowns').count,0);assert.equal(grassOnly.stats.grassTufts,patches.length*6);assert.equal(grassOnly.stats.drawCalls,1);grassOnly.dispose();
});
