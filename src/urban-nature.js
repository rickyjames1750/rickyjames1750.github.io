import * as T from 'three';

const BASE=.6, BUILDING_BASE=.63, UP=new T.Vector3(0,1,0);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const hash=n=>{const v=Math.sin(n*127.1+311.7)*43758.5453;return v-Math.floor(v);};

function foliageGeometry(){
  // A rough, recessed core fills distant crowns; 56 folded lanceolate leaves create
  // the actual silhouette and the small changing highlights visible while driving.
  const core=new T.SphereGeometry(.77,8,5).toNonIndexed(),positions=[],normals=[],colors=[];
  const cp=core.getAttribute('position'),cn=core.getAttribute('normal');
  for(let i=0;i<cp.count;i++){
    const x=cp.getX(i),y=cp.getY(i),z=cp.getZ(i),rough=1+.05*Math.sin(x*19+y*11+z*23),shade=.67+.12*hash(i/3);
    positions.push(x*rough,y*rough,z*rough);normals.push(cn.getX(i),cn.getY(i),cn.getZ(i));colors.push(shade*.88,shade,shade*.78);
  }
  core.dispose();
  const n=new T.Vector3(),u=new T.Vector3(),v=new T.Vector3(),point=new T.Vector3(),center=new T.Vector3(),normal=new T.Vector3(),edgeA=new T.Vector3(),edgeB=new T.Vector3();
  const count=56,golden=Math.PI*(3-Math.sqrt(5));
  for(let i=0;i<count;i++){
    const y=1-2*(i+.5)/count,r=Math.sqrt(1-y*y),angle=i*golden;n.set(Math.cos(angle)*r,y,Math.sin(angle)*r);
    u.crossVectors(Math.abs(y)>.9?new T.Vector3(1,0,0):UP,n).normalize();v.crossVectors(n,u);
    const turn=hash(i+5)*Math.PI*2,cos=Math.cos(turn),sin=Math.sin(turn),oldU=u.clone();u.multiplyScalar(cos).addScaledVector(v,sin);v.multiplyScalar(cos).addScaledVector(oldU,-sin);
    center.copy(n).multiplyScalar(.875+hash(i+19)*.045);
    const length=.23+hash(i+37)*.055,width=.105+hash(i+47)*.035;
    const outline=[[0,length,0],[-width,.018,0],[0,-length*.88,-.005],[width,.018,0]],ridge=[0,.012,.036];
    const leafPoints=[ridge,...outline].map(([x,y,z])=>point.copy(center).addScaledVector(u,x).addScaledVector(v,y).addScaledVector(n,z).clone());
    const shade=.81+hash(i+91)*.28;
    for(let j=0;j<4;j++){
      const points=[leafPoints[0],leafPoints[j+1],leafPoints[(j+1)%4+1]];edgeA.copy(points[1]).sub(points[0]);edgeB.copy(points[2]).sub(points[0]);normal.crossVectors(edgeA,edgeB).normalize();
      for(let k=0;k<3;k++){const p=points[k],light=shade*(k===0?1.06:k===1?.94:1);positions.push(p.x,p.y,p.z);normals.push(normal.x,normal.y,normal.z);colors.push(light*.9,light,light*.76);}
    }
  }
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('normal',new T.Float32BufferAttribute(normals,3));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));return g;
}
function bladeGeometry(){
  const positions=[],colors=[];
  // Five different bends and headings make one compact tuft, still drawn as one instance.
  for(let blade=0;blade<5;blade++){
    const angle=blade*2.39996,cos=Math.cos(angle),sin=Math.sin(angle),height=.72+hash(blade+12)*.28,width=.36+hash(blade+22)*.18;
    const ox=Math.cos(angle+.6)*.14,oz=Math.sin(angle+.6)*.14;
    const vertices=[[-width/2,0,0],[width/2,0,0],[-width*.28,.55*height,.1],[width*.28,.55*height,.1],[.07,height,.38+hash(blade+7)*.15]];
    for(const index of [0,1,2,1,3,2,2,3,4]){const [x,y,z]=vertices[index],shade=.76+y*.24+hash(blade+3)*.08;positions.push(ox+x*cos+z*sin,y,oz-x*sin+z*cos);colors.push(shade*.88,shade,shade*.72);}
  }
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.computeVertexNormals();return g;
}
function frameGeometry(){
  const outer=new T.Shape();outer.moveTo(-.5,-.5);outer.lineTo(.5,-.5);outer.lineTo(.5,.5);outer.lineTo(-.5,.5);outer.closePath();
  const hole=new T.Path();hole.moveTo(-.438,-.43);hole.lineTo(-.438,.43);hole.lineTo(.438,.43);hole.lineTo(.438,-.43);hole.closePath();outer.holes.push(hole);
  const mullion=new T.Shape();mullion.moveTo(-.024,-.43);mullion.lineTo(.024,-.43);mullion.lineTo(.024,.43);mullion.lineTo(-.024,.43);mullion.closePath();
  return new T.ShapeGeometry([outer,mullion]);
}
function occupantGeometry(){
  const body=new T.Shape();body.moveTo(-.22,-.5);body.lineTo(-.17,.04);body.quadraticCurveTo(-.17,.21,0,.21);body.quadraticCurveTo(.17,.21,.17,.04);body.lineTo(.22,-.5);body.closePath();
  const head=new T.Shape();head.absarc(0,.35,.135,0,Math.PI*2);return new T.ShapeGeometry([body,head],8);
}
function addWind(material,clock,strength){
  material.onBeforeCompile=shader=>{
    shader.uniforms.uUrbanTime=clock;
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>\nuniform float uUrbanTime;`)
      .replace('#include <begin_vertex>',`#include <begin_vertex>\n#ifdef USE_INSTANCING\nfloat urbanSeed=dot(instanceMatrix[3].xz,vec2(2.1,3.7));\ntransformed.x += sin(uUrbanTime*1.35+urbanSeed+position.y*1.6)*${strength.toFixed(4)}*max(0.0,position.y)*max(0.0,position.y);\n#endif`);
  };material.customProgramCacheKey=()=>`urban-wind-${strength}`;
}
function addRoomLife(material,clock){
  material.onBeforeCompile=shader=>{
    shader.uniforms.uUrbanTime=clock;
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying float vUrbanSeed;\nvarying vec2 vUrbanUv;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvUrbanUv=uv;\nvUrbanSeed=dot(instanceMatrix[3].xyz,vec3(17.1,31.7,13.3));');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform float uUrbanTime;\nvarying float vUrbanSeed;\nvarying vec2 vUrbanUv;')
      .replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>\nfloat urbanPulse=.91+.055*sin(uUrbanTime*.38+vUrbanSeed)+.035*sin(uUrbanTime*.67+vUrbanSeed*2.4);\nfloat urbanShade=.7+.3*smoothstep(.0,.7,vUrbanUv.y);\ntotalEmissiveRadiance*=urbanPulse*urbanShade;`);
  };material.customProgramCacheKey=()=> 'urban-occupied-rooms-v1';
}

/**
 * Original batched trees and architecture detail. The supplied building bodies remain owned by
 * the caller. `canopy` is a camera-only, unparented occlusion proxy; add it to camera occluders,
 * not to the scene. All tree/grass geometry stays inside each existing .8*s reserved footprint. Optional
 * grassPatches use the same {x,z,s} reservation and wind batch without spawning tree geometry.
 */
export function createUrbanNature({scene,treePositions=[],grassPatches=[],buildings=[],reducedMotion=false}={}){
  if(!scene?.add)throw new TypeError('Urban nature requires a Three.js scene.');
  const trees=treePositions.filter(p=>[p.x,p.z,p.s].every(Number.isFinite)&&p.s>0);
  const patches=grassPatches.filter(p=>[p.x,p.z,p.s].every(Number.isFinite)&&p.s>0),grassSites=[...trees,...patches];
  const blocks=buildings.filter(b=>[b.x,b.z,b.h,b.w,b.d].every(Number.isFinite)&&b.h>0&&b.w>0&&b.d>0);
  const root=new T.Group();root.name='Coastal canopy, lived-in facades and wind grass';scene.add(root);
  const geometries=new Set(),materials=new Set(),batches=[],clock={value:0};
  const own=g=>(geometries.add(g),g);
  function mat(color,extra={}){const m=new T.MeshStandardMaterial({color,roughness:.84,metalness:0,...extra});materials.add(m);return m;}
  function batch(name,g,m,n){const mesh=new T.InstancedMesh(g,m,n);mesh.name=name;mesh.count=n;mesh.castShadow=false;mesh.receiveShadow=true;root.add(mesh);batches.push(mesh);return mesh;}
  const bark=mat('#776950',{roughness:1}),leaf=mat('#d2e4c6',{roughness:.96,vertexColors:true,side:T.DoubleSide}),grassMat=mat('#829d66',{side:T.DoubleSide,roughness:1,vertexColors:true});
  addWind(leaf,clock,.011);addWind(grassMat,clock,.32);
  const stone=mat('#9caa9f',{roughness:.8,metalness:.1}),trimMat=mat('#566869',{roughness:.48,metalness:.45}),roofMat=mat('#697577',{roughness:.9}),mechanicalMat=mat('#8d9e9d',{roughness:.65,metalness:.4});
  const glassMat=mat('#2b4a4d',{emissive:'#f2c387',emissiveIntensity:.62,roughness:.32,metalness:.18,side:T.DoubleSide});addRoomLife(glassMat,clock);
  const shadowMat=new T.MeshBasicMaterial({color:'#182b2d',side:T.DoubleSide});materials.add(shadowMat);
  const doorMat=mat('#324d50',{roughness:.3,metalness:.35});
  const cylinder=own(new T.CylinderGeometry(.65,1,1,7)),cube=own(new T.BoxGeometry(1,1,1)),plane=own(new T.PlaneGeometry(1,1));
  const trunks=batch('Branched coastal trunks',cylinder,bark,trees.length*5);
  const foliage=batch('Layered leafy crowns',own(foliageGeometry()),leaf,trees.length*5);
  const grass=batch('Wind grass clumps',own(bladeGeometry()),grassMat,grassSites.length*6);
  const roofCaps=batch('Architectural cornices and plinths',cube,stone,blocks.length*2);
  const trim=batch('Facade corner piers',cube,trimMat,blocks.length*4);
  const roofUnits=batch('Rooftop air handling',cube,mechanicalMat,blocks.length*2);
  const roofs=batch('Inset flat roofs',cube,roofMat,blocks.length);
  const doors=batch('Recessed ground floor entries',plane,doorMat,blocks.length);
  const position=new T.Vector3(),scale=new T.Vector3(),rotation=new T.Euler(),quaternion=new T.Quaternion(),matrix=new T.Matrix4(),direction=new T.Vector3(),color=new T.Color();
  function put(mesh,i,x,y,z,sx,sy,sz,ry=0){position.set(x,y,z);scale.set(sx,sy,sz);quaternion.setFromEuler(rotation.set(0,ry,0));matrix.compose(position,quaternion,scale);mesh.setMatrixAt(i,matrix);}
  function rod(i,a,b,r){direction.copy(b).sub(a);const length=direction.length();quaternion.setFromUnitVectors(UP,direction.multiplyScalar(1/length));position.copy(a).add(b).multiplyScalar(.5);scale.set(r,length,r);matrix.compose(position,quaternion,scale);trunks.setMatrixAt(i,matrix);}
  const crown=[[0,2.0,0,.53,.86,.53],[-.34,1.68,.04,.39,.63,.39],[.34,1.77,.03,.39,.66,.39],[.02,1.7,-.34,.39,.65,.39],[-.02,1.84,.34,.39,.65,.39]];
  const a=new T.Vector3(),b=new T.Vector3();
  trees.forEach((p,i)=>{
    a.set(p.x,BASE,p.z);b.set(p.x,BASE+1.54*p.s,p.z);rod(i,a,b,.09*p.s);
    for(let fork=0;fork<4;fork++){const c=crown[fork+1];a.set(p.x,BASE+(.92+.05*fork)*p.s,p.z);b.set(p.x+c[0]*p.s,BASE+(c[1]-.16)*p.s,p.z+c[2]*p.s);rod((fork+1)*trees.length+i,a,b,.047*p.s);}
    for(let layer=0;layer<5;layer++){const c=crown[layer],j=layer*trees.length+i;put(foliage,j,p.x+c[0]*p.s,BASE+c[1]*p.s,p.z+c[2]*p.s,c[3]*p.s,c[4]*p.s,c[5]*p.s);foliage.setColorAt(j,color.setHSL(.29+hash(i*5+layer)*.085,.22+hash(i+layer*31)*.16,.25+hash(i*2+layer)*.11));}
  });
  grassSites.forEach((p,i)=>{
    for(let layer=0;layer<6;layer++){const angle=layer*Math.PI/3+hash(i)*.8,r=(.4+hash(i*13+layer)*.22)*p.s,j=layer*grassSites.length+i;put(grass,j,p.x+Math.cos(angle)*r,BASE+.005,p.z+Math.sin(angle)*r,(.065+hash(i+layer)*.03)*p.s,(.18+hash(i*9+layer)*.17)*p.s,.12*p.s,angle);grass.setColorAt(j,color.setHSL(.2+hash(i+layer)*.1,.22,.4+hash(i*7+layer)*.14));}
  });
  const windows=[],occupants=[];
  blocks.forEach((block,i)=>{
    const {x,z,w,d,h}=block,top=BUILDING_BASE+h;
    put(roofCaps,i,x,top-.055,z,w,.11,d);put(roofCaps,blocks.length+i,x,BUILDING_BASE+.065,z,w,.13,d);
    put(roofs,i,x,top+.012,z,w*.87,.035,d*.87);
    for(let corner=0;corner<4;corner++){const sx=corner<2?-1:1,sz=corner%2?-1:1;put(trim,corner*blocks.length+i,x+sx*(w/2-.023),BUILDING_BASE+h/2,z+sz*(d/2-.023),.038,h,.038);}
    const unitWidth=Math.min(.34,w*.23),unitDepth=Math.min(.42,d*.28);
    put(roofUnits,i,x-w*.17,top+.105,z-d*.15,unitWidth,.17,unitDepth);put(roofUnits,blocks.length+i,x+w*.18,top+.07,z+d*.18,unitWidth*.6,.1,unitDepth*.7);
    put(doors,i,x-w*.17,BUILDING_BASE+.27,z+d/2+.009,Math.min(.24,w*.3),Math.min(.46,h*.4),1);
    doors.setColorAt(i,color.setHSL(.47,.15,.28+hash(i)*.14));
    const floors=Math.max(1,Math.min(12,Math.floor((h-.38)/.61))),floorHeight=(h-.38)/floors;
    const faces=[{width:w,x:0,z:d/2+.008,angle:0},{width:w,x:0,z:-d/2-.008,angle:Math.PI},{width:d,x:w/2+.008,z:0,angle:Math.PI/2},{width:d,x:-w/2-.008,z:0,angle:-Math.PI/2}];
    for(let f=0;f<faces.length;f++){
      const face=faces[f],cols=Math.max(1,Math.min(4,Math.floor(face.width/.43))),spacing=face.width/(cols+.45),windowWidth=Math.min(.34,spacing*.65),windowHeight=Math.min(.36,floorHeight*.64);
      for(let row=0;row<floors;row++)for(let col=0;col<cols;col++){
        const across=(col-(cols-1)/2)*spacing,cos=Math.cos(face.angle),sin=Math.sin(face.angle),seed=i*97+f*23+row*11+col*7;
        const room={x:x+face.x+across*cos,y:BUILDING_BASE+.32+(row+.5)*floorHeight,z:z+face.z-across*sin,w:windowWidth,h:windowHeight,angle:face.angle,lit:hash(seed)>.36,seed};
        windows.push(room);if(room.lit&&hash(seed+311)>.76)occupants.push(room);
      }
    }
  });
  const panels=batch('Warm rooms and cool glass',plane,glassMat,windows.length),frames=batch('Recessed frames and mullions',own(frameGeometry()),trimMat,windows.length),people=batch('Interior occupant silhouettes',own(occupantGeometry()),shadowMat,occupants.length);
  windows.forEach((room,i)=>{
    put(panels,i,room.x,room.y,room.z,room.w,room.h,1,room.angle);
    put(frames,i,room.x+Math.sin(room.angle)*.002,room.y,room.z+Math.cos(room.angle)*.002,room.w,room.h,1,room.angle);
    // Vertex colors multiply both the facade glass and its emissive light. Dark rooms remain
    // dark between lit interiors, avoiding uniformly luminous walls at miniature scale.
    panels.setColorAt(i,room.lit?color.setRGB(.8+hash(room.seed+1)*.2,.62+hash(room.seed+2)*.24,.39+hash(room.seed+3)*.3):color.setRGB(.065,.12,.15));
  });
  occupants.forEach((room,i)=>{const offset=(hash(room.seed+71)-.5)*room.w*.32;put(people,i,room.x+Math.sin(room.angle)*.001+Math.cos(room.angle)*offset,room.y-room.h*.08,room.z+Math.cos(room.angle)*.001-Math.sin(room.angle)*offset,room.w*.72,room.h*.7,1,room.angle);});
  // Room instance colors also need to tint emission; standard Three.js vertex colors affect
  // diffuse only, so pass their luminance explicitly to the custom room shader.
  const baseRoomCompile=glassMat.onBeforeCompile;
  glassMat.onBeforeCompile=shader=>{baseRoomCompile(shader);shader.vertexShader=shader.vertexShader.replace('varying float vUrbanSeed;','varying float vUrbanSeed;\nvarying vec3 vUrbanRoomColor;').replace('vUrbanUv=uv;','vUrbanUv=uv;\nvUrbanRoomColor=instanceColor;');shader.fragmentShader=shader.fragmentShader.replace('varying float vUrbanSeed;','varying float vUrbanSeed;\nvarying vec3 vUrbanRoomColor;').replace('totalEmissiveRadiance*=urbanPulse*urbanShade;','totalEmissiveRadiance*=urbanPulse*urbanShade*vUrbanRoomColor;');};
  const proxyMaterial=new T.MeshBasicMaterial({side:T.DoubleSide});materials.add(proxyMaterial);
  const canopy=new T.InstancedMesh(own(new T.IcosahedronGeometry(1,0)),proxyMaterial,trees.length);canopy.name='Camera-only coastal canopy volumes';canopy.frustumCulled=false;
  trees.forEach((p,i)=>put(canopy,i,p.x,BASE+1.77*p.s,p.z,.79*p.s,1.14*p.s,.79*p.s));
  for(const mesh of [...batches,canopy]){mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;mesh.computeBoundingSphere();}
  foliage.castShadow=true;trunks.castShadow=true;
  root.userData.windUniform=clock;
  root.userData.treeFootprints=trees.map(p=>({x:p.x,z:p.z,r:.8*p.s}));
  root.userData.grassFootprints=grassSites.map(p=>({x:p.x,z:p.z,r:.8*p.s}));
  let quality='high',disposed=false;
  function setQuality(value){quality=value==='eco'?'eco':'high';foliage.count=trees.length*(quality==='eco'?3:5);grass.count=grassSites.length*(quality==='eco'?3:6);foliage.castShadow=quality!=='eco';}
  function update({dt=0,paused=false,quality:nextQuality=quality}={}){if(disposed)return;if(nextQuality!==quality)setQuality(nextQuality);if(!paused&&!reducedMotion)clock.value+=clamp(Number(dt)||0,0,.1);}
  function dispose(){if(disposed)return;disposed=true;root.removeFromParent();for(const mesh of [...batches,canopy])mesh.dispose();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();}
  return {root,canopy,update,dispose,get stats(){return {trees:trees.length,grassPatches:patches.length,canopyClusters:foliage.count,grassTufts:grass.count,grassBlades:grass.count*5,buildings:blocks.length,windows:windows.length,occupants:occupants.length,drawCalls:batches.filter(m=>m.count>0).length,quality,animationTime:clock.value};}};
}
