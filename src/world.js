import * as T from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { groundVehicle } from './vehicle-grounding.js';
import { createVehicleDynamics,createVehicleHop } from './vehicle-dynamics.js';
import { createCorridorIndex } from './corridors.js';
import { createBridgeDrive } from './bridge-road.js';
import { createDrivingNavigator } from './bridge-navigation.js';
import { createBridgeConstraint } from './bridge-constraint.js';
import { createLivingWorld } from './living-world.js';
import { createPlayground } from './playground.js';
import {createRaceCurve,createBayRace} from './bay-race.js';
import {createBayRaceScene,raceFrame} from './bay-race-scene.js';
import { createUrbanNature } from './urban-nature.js';
import { createDriveEntrance } from './drive-entrance.js';
import { environmentAudio } from './environment-audio.js';
import { SURFACES, createSurfaceSampler, createMeshHeightSampler, groundedRootY } from './surfaces.js';
import { createDrivingCurve, nearestCurveParameter, curveFrame } from './driving-route.js';
import { chooseSafeCamera } from './camera-safety.js';
import { createStreets } from './streets.js';
import { createRenderingLook } from './rendering-look.js';
import { createCityDetail } from './city-detail.js';
import { createLandmarks, createGravityCar, createCaltrain } from './landmarks.js';
import { project, peninsulaCoast, eastBayCoast, marinCoast, railCoordinates, futurePortalCoordinates, landmarks } from './geography.js';

const v3 = (p,y=.72) => new T.Vector3(p.x,y,p.z);
export function createWorld({container,labels,zones,reducedMotion,onNear,onArrive,onDrive,onStatus=()=>{},onBurst=()=>{},onRobotHit=()=>{},onRaceEvent=()=>{},getAudioStream=()=>null}) {
 const lifecycle=new AbortController();
 const listen=(target,type,handler,options={})=>target.addEventListener(type,handler,{...options,signal:lifecycle.signal});
 const renderer = new T.WebGLRenderer({antialias:true,powerPreference:'high-performance',preserveDrawingBuffer:true});
 renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;
 renderer.info.autoReset=false;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;container.append(renderer.domElement);
 renderer.domElement.setAttribute('aria-label','Interactive three-dimensional Bay Area. Use WASD or arrow keys to drive. Drag to orbit and scroll to zoom.');
 const scene=new T.Scene();scene.background=new T.Color('#101e2c');scene.fog=new T.FogExp2('#142c3e',.003);
 const camera=new T.PerspectiveCamera(39,1,.1,1400);camera.position.set(142,158,200);
 const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.06;controls.maxPolarAngle=Math.PI*.47;controls.minDistance=8;controls.maxDistance=370;controls.target.set(12,0,5);controls.enablePan=true;
 const hemi=new T.HemisphereLight('#93c6ed','#40362d',1.9);scene.add(hemi);
 const sun=new T.DirectionalLight('#ffcbaa',3);sun.position.set(-90,140,-90);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-150,right:150,top:160,bottom:-160,near:10,far:450});sun.shadow.bias=-.0003;sun.shadow.normalBias=.1;scene.add(sun);
 const rim=new T.DirectionalLight('#4bbfff',2);rim.position.set(80,50,40);scene.add(rim);

 const composer=new EffectComposer(renderer);composer.addPass(new RenderPass(scene,camera));const bloom=new UnrealBloomPass(new T.Vector2(1200,800),.24,.4,1.6);const renderingLook=createRenderingLook({renderer,scene,camera,sun,hemi,rim,bloom,day:true,environmentURL:new URL('./environments/venice_sunset_1k.hdr',document.baseURI).href,quality:'high',width:container.clientWidth,height:container.clientHeight});if(renderingLook.occlusionPass)composer.addPass(renderingLook.occlusionPass);composer.addPass(bloom);composer.addPass(renderingLook.gradePass);composer.addPass(new OutputPass());const fadePass=new ShaderPass({uniforms:{tDiffuse:{value:null},fade:{value:1}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'uniform sampler2D tDiffuse;uniform float fade;varying vec2 vUv;void main(){gl_FragColor=texture2D(tDiffuse,vUv)*vec4(vec3(fade),1.);}'});composer.addPass(fadePass);

 // The entrance is rendered in the same compositor as the 3D scene. Outside
 // the car's focus ellipse is a quiet atlas field; the second gesture opens it.
 const focusPass=new ShaderPass({uniforms:{tDiffuse:{value:null},uCenter:{value:new T.Vector2(.5,.5)},uAspect:{value:1},uRadius:{value:2},uStrength:{value:0},uTime:{value:0}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:`
 uniform sampler2D tDiffuse;uniform vec2 uCenter;uniform float uAspect,uRadius,uStrength,uTime;varying vec2 vUv;
 void main(){vec2 q=(vUv-uCenter)*vec2(uAspect,1.);float d=length(q/vec2(1.,.68));float inside=1.-smoothstep(uRadius-.008,uRadius+.015,d);
 vec2 atlas=vUv*vec2(uAspect,1.)*45.;vec2 cell=abs(fract(atlas)-.5);float cross=(1.-smoothstep(.015,.035,cell.x))*(1.-smoothstep(.065,.1,cell.y))+(1.-smoothstep(.015,.035,cell.y))*(1.-smoothstep(.065,.1,cell.x));
 vec3 field=vec3(.018,.046,.067)+cross*vec3(.04,.10,.11);field+=vec3(.008,.022,.026)*(1.-length(q)*.5);
 float edge=exp(-abs(d-uRadius)*370.);float shimmer=.8+.2*sin(atan(q.y,q.x)*38.+uTime*1.4);vec3 scene=texture2D(tDiffuse,vUv).rgb;
 vec3 focused=mix(field,scene,inside)+edge*shimmer*vec3(.42,.95,.77);
 gl_FragColor=vec4(mix(scene,focused,uStrength),1.);}`});composer.addPass(focusPass);
 const mats=new Map();function material(color,extra={}){const key=color+JSON.stringify(extra);if(!mats.has(key))mats.set(key,new T.MeshStandardMaterial({color,roughness:.85,...extra}));return mats.get(key);}
 function mesh(geo,color,x=0,y=0,z=0,extra={}){const m=new T.Mesh(geo,typeof color==='string'?material(color,extra):color);m.position.set(x,y,z);m.receiveShadow=true;m.castShadow=true;scene.add(m);return m;}
 function box(x,y,z,w,h,d,c,extra={}){return mesh(new T.BoxGeometry(w,h,d),c,x,y,z,extra);}
 let seed=772;const rand=()=>{seed=(seed*16807)%2147483647;return(seed-1)/2147483646;};
 function polygon(coords,color){const shape=new T.Shape();coords.forEach(([lon,lat],i)=>{const p=project(lon,lat);i?shape.lineTo(p.x,-p.z):shape.moveTo(p.x,-p.z);});shape.closePath();const m=mesh(new T.ExtrudeGeometry(shape,{depth:2.6,bevelEnabled:true,bevelThickness:.35,bevelSize:.3,bevelSegments:2}),color);m.rotation.x=-Math.PI/2;m.position.y=SURFACES.terrainOriginY;return m;}
 const peninsulaMesh=polygon(peninsulaCoast,'#35552f');polygon(eastBayCoast,'#3a5136');polygon(marinCoast,'#34532e');
 // Procedural soil/grass variation adds close-range texture without image downloads.
 for(const color of ['#35552f','#3a5136','#34532e']){const mat=material(color);mat.onBeforeCompile=shader=>{
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vBayLand;').replace('#include <begin_vertex>','#include <begin_vertex>\nvBayLand=(modelMatrix*vec4(transformed,1.)).xyz;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
   varying vec3 vBayLand;float bayHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
   float bayNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(bayHash(i),bayHash(i+vec2(1,0)),f.x),mix(bayHash(i+vec2(0,1)),bayHash(i+vec2(1)),f.x),f.y);}`)
   .replace('#include <color_fragment>',`#include <color_fragment>
    float groundMix=bayNoise(vBayLand.xz*.28)*.65+bayNoise(vBayLand.xz*1.7)*.35;float grain=bayNoise(vBayLand.xz*55.);
    diffuseColor.rgb*=mix(vec3(.75,.82,.65),vec3(1.12,1.06,.84),groundMix)*(.88+grain*.22);`);
 };mat.customProgramCacheKey=()=> 'bay-ground-cover-v1';}
 const landPoints=peninsulaCoast.map(c=>project(...c));function onLand(x,z){let inside=false;for(let i=0,j=landPoints.length-1;i<landPoints.length;j=i++){const a=landPoints[i],b=landPoints[j];if((a.z>z)!==(b.z>z)&&x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)inside=!inside;}return inside;}
 // The bay is a living surface; the cursor reveals a luminous bathymetric field below it.
 const waterUniforms={uTime:{value:0},uPointer:{value:new T.Vector2(9999,9999)},uDay:{value:1}};
 const waterMat=new T.ShaderMaterial({uniforms:waterUniforms,vertexShader:`varying vec3 vWorld;uniform float uTime;void main(){vec3 p=position;p.z+=sin(p.x*.13+uTime*.45)*.045+cos(p.y*.17+uTime*.28)*.05;vec4 w=modelMatrix*vec4(p,1.);vWorld=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,fragmentShader:`precision highp float;varying vec3 vWorld;uniform float uTime;uniform vec2 uPointer;uniform float uDay;
 float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1)),f.x),f.y);}
 void main(){vec2 p=vWorld.xz;float n=noise(p*.18+vec2(uTime*.018,-uTime*.025));float fine=sin(p.x*1.7+p.y*2.4+n*4.+uTime*.6)*.5+.5;float band=pow(max(0.,sin(p.x*.08+p.y*.06+n*.6+uTime*.03)),38.);vec3 deep=mix(vec3(.014,.065,.1),vec3(.045,.18,.22),n*.7);deep+=vec3(.13,.28,.31)*band*.32+fine*.008;float d=length(p-uPointer);float reveal=1.-smoothstep(3.,14.,d);float depth=noise(p*.045)*7.+noise(p*.12)*2.;float contour=1.-smoothstep(.0,.05,abs(fract(depth)-.5));vec3 seabed=vec3(.06,.27,.27)+contour*vec3(.08,.27,.25);float ripple=pow(max(0.,sin(d*2.4-uTime*2.)),15.)*reveal;vec3 color=mix(deep,seabed,reveal*.65)+ripple*vec3(.05,.25,.24);color=mix(color,color*1.8+vec3(.03,.08,.08),uDay*.7);gl_FragColor=vec4(color,1.);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`});
 const water=mesh(new T.PlaneGeometry(1600,1600,100,100),waterMat,0,-.18,0);water.rotation.x=-Math.PI/2;water.castShadow=false;water.receiveShadow=false;
 const raycaster=new T.Raycaster(),pointer=new T.Vector2(),seaPlane=new T.Plane(new T.Vector3(0,1,0),.18),hit=new T.Vector3();
 listen(container,'pointermove',e=>{const r=container.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);raycaster.setFromCamera(pointer,camera);if(raycaster.ray.intersectPlane(seaPlane,hit))waterUniforms.uPointer.value.set(hit.x,hit.z);});listen(container,'pointerleave',()=>waterUniforms.uPointer.value.set(9999,9999));
 // Coastal ranges form a quiet western spine. Landmarks retain their geographic anchors.
 const hills=[];const hillGeo=new T.IcosahedronGeometry(1,2);for(let i=0;i<38;i++){const lat=37.35+rand()*.41,lon=-122.47+(37.75-lat)*.53,p=project(lon,lat);if(!onLand(p.x,p.z)||railCoordinates.some(c=>{const r=project(...c);return Math.hypot(r.x-p.x,r.z-p.z)<13;}))continue;const hill=mesh(hillGeo,'#364d40',p.x,-.7,p.z);hill.scale.set(4+rand()*3,1+rand()*2.5,6+rand()*3);hill.updateMatrixWorld(true);hills.push({mesh:hill,bounds:new T.Box3().setFromObject(hill)});}
 const authoredLandmarks=createLandmarks(scene,project);
 const car=createGravityCar(),train=createCaltrain();const finishes=new Map();car.traverse(part=>{if(!part.isMesh||Array.isArray(part.material)||!part.material.isMeshStandardMaterial||part.material.metalness<.7)return;const original=part.material;if(!finishes.has(original)){const finish=new T.MeshPhysicalMaterial({color:original.color,roughness:original.roughness,metalness:original.metalness,emissive:original.emissive,emissiveIntensity:original.emissiveIntensity,clearcoat:.85,clearcoatRoughness:.14,envMapIntensity:1.1});finishes.set(original,finish);}part.material=finishes.get(original);});car.scale.setScalar(.4);train.scale.setScalar(.46);
 const carScale=.4,trainScale=.46;const trainRootHeight=groundedRootY(SURFACES.railTop,train.userData.wheelBottom,trainScale);const contactWireHeight=trainRootHeight+train.userData.contactHeight*trainScale+.022;
 const railPts=railCoordinates.map(c=>v3(project(...c),.84));const railCurve=new T.CatmullRomCurve3(railPts,false,'catmullrom',.15);railCurve.arcLengthDivisions=2000;railCurve.updateArcLengths();const railLength=railCurve.getLength();const trainEndMargin=train.userData.length*trainScale*.52/railLength;
 const futurePts=futurePortalCoordinates.map((c,i)=>v3(project(...c),i<3?-1.5:.84));const futureCurve=new T.CatmullRomCurve3(futurePts,false,'catmullrom',.1);
 const roadCurve=createDrivingCurve(railCurve,authoredLandmarks.colliders,{isOnLand:onLand});roadCurve.arcLengthDivisions=2000;roadCurve.updateArcLengths();
 const laneMaterial=renderingLook.paintMaterial;
 const roadPts=roadCurve.getPoints(900),sampleRoad=createSurfaceSampler({roadPoints:roadPts});
 const corridors=createCorridorIndex(roadCurve,railCurve,{stations:zones});
 const bridgeDrive=createBridgeDrive({bridge:authoredLandmarks.bridge,roadCurve,isOnLand:onLand});
 const bridgeConstraint=createBridgeConstraint(bridgeDrive,{halfExtents:{x:car.userData.collisionHalfExtents.x*carScale,z:car.userData.collisionHalfExtents.z*carScale}});
 for(let i=hills.length-1;i>=0;i--){const h=hills[i];if([...roadPts,...bridgeDrive.samples].some(p=>p.x>=h.bounds.min.x-4&&p.x<=h.bounds.max.x+4&&p.z>=h.bounds.min.z-4&&p.z<=h.bounds.max.z+4)){scene.remove(h.mesh);hills.splice(i,1);}}
 const sampleHill=createMeshHeightSampler(hills.map(h=>h.mesh));
 function drivingHeight(x,z){
  const surface=sampleRoad(x,z),bounds=bridgeDrive.bounds;
  const bridge=x>=bounds.min.x&&x<=bounds.max.x&&z>=bounds.min.z&&z<=bounds.max.z?bridgeDrive.sampleSurface(x,z):null;
  if(bridge&&bridge.height>SURFACES.road+.015)return bridge.height;
  let height=Math.max(surface.height,bridge?.height??-Infinity);
  // The validated continuous sidewalks have an analytic cross-section. Avoid raycasting
  // the entire Peninsula ribbon for every tire contact on every animation frame.
  const d=surface.distance;
  if(d>=2.24&&d<=3.165&&!bridgeDrive.contains(x,z,.16)){
   if(d<=2.4)height=Math.max(height,.837);else if(d>=2.405&&d<=3.095)height=Math.max(height,.825);else if(d>=3.095)height=Math.max(height,.831);
  }
  const atStation=corridors.reservations.some(r=>{const c=Math.cos(r.rotation),sn=Math.sin(r.rotation),dx=x-r.x,dz=z-r.z;return Math.abs(c*dx-sn*dz)<=r.w/2&&Math.abs(sn*dx+c*dz)<=r.d/2;});
  if(atStation)height=Math.max(height,sampleStreet(x,z).height);
  if(surface.type==='land'&&hills.some(h=>x>=h.bounds.min.x&&x<=h.bounds.max.x&&z>=h.bounds.min.z&&z<=h.bounds.max.z))height=Math.max(height,sampleHill(x,z).height);
  return height;
 }
 function ribbon(curve,width,color,y,emissive=false){const pts=curve.getPoints(450),arr=[],idx=[];for(let i=0;i<pts.length;i++){const d=curve.getTangent(i/450),nx=-d.z*width/2,nz=d.x*width/2;arr.push(pts[i].x+nx,y??pts[i].y,pts[i].z+nz,pts[i].x-nx,y??pts[i].y,pts[i].z-nz);if(i<450){let j=i*2;idx.push(j,j+2,j+1,j+1,j+2,j+3);}}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(arr,3));g.setIndex(idx);g.computeVertexNormals();const surface=mesh(g,color?.isMaterial?color:material(color,{side:T.DoubleSide,shadowSide:T.FrontSide,...(emissive?{emissive:color,emissiveIntensity:2}:{} )}));surface.castShadow=false;surface.receiveShadow=color?.isMaterial||false;return surface;}
 ribbon(roadCurve,4.7,renderingLook.concreteMaterial,.75);ribbon(roadCurve,4.2,renderingLook.roadMaterial,.79);ribbon(railCurve,2.1,'#7c7768',.76);
 for(const segment of bridgeDrive.segments){if(segment.type==='deck')continue;ribbon(segment.curve,4.6,renderingLook.concreteMaterial).position.y=-.04;ribbon(segment.curve,4.2,renderingLook.roadMaterial).position.y=.004;}
 for(let i=0;i<Math.floor(bridgeDrive.curve.getLength()/1.1);i++){const t=i/Math.floor(bridgeDrive.curve.getLength()/1.1),p=bridgeDrive.curve.getPointAt(t),d=bridgeDrive.curve.getTangentAt(t);if(p.y>2.39)continue;const dash=box(p.x,p.y+.018,p.z,.07,.012,.48,laneMaterial);dash.receiveShadow=false;dash.rotation.y=Math.atan2(d.x,d.z);dash.castShadow=false;}
 const railGlow=material('#7fbec0',{metalness:.7,roughness:.3,emissive:'#1e566a',emissiveIntensity:.8});
 for(const side of [-1,1].map(sign=>sign*train.userData.grounding.trackWidth*trainScale/2)){const pts=railCurve.getPoints(500).map((p,i)=>{const d=railCurve.getTangent(i/500);return p.clone().add(new T.Vector3(-d.z*side,.1,d.x*side));});mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts),500,.045,4,false),railGlow);}
 for(let i=0;i<280;i++){const p=railCurve.getPoint(i/279),d=railCurve.getTangent(i/279);const tie=box(p.x,.8,p.z,1.7,.08,.2,'#4b463e');tie.rotation.y=Math.atan2(d.x,d.z);}
 for(let i=0;i<125;i++){const p=roadCurve.getPoint(i/124),d=roadCurve.getTangent(i/124);const dash=box(p.x,.81,p.z,.08,.015,.75,laneMaterial);dash.castShadow=false;dash.receiveShadow=false;dash.rotation.y=Math.atan2(d.x,d.z);}
 const futureLine=mesh(new T.TubeGeometry(futureCurve,80,.08,5,false),'#7fe3ed',0,0,0,{emissive:'#4cdde8',emissiveIntensity:2});futureLine.material.transparent=true;futureLine.material.opacity=.8;futureLine.material.depthTest=false;futureLine.renderOrder=2;futureLine.visible=false;
 // Overhead electrification: poles, cantilevers, and a continuous contact wire.
 const contact=railCurve.getPoints(200).map(p=>p.clone().add(new T.Vector3(0,contactWireHeight-SURFACES.railCenter,0)));const overheadWire=mesh(new T.TubeGeometry(new T.CatmullRomCurve3(contact),200,.022,3,false),'#7d8a86');overheadWire.castShadow=false;
 for(let i=0;i<34;i++){const p=railCurve.getPoint(i/33),d=railCurve.getTangent(i/33),nx=-d.z*1.8,nz=d.x*1.8;box(p.x+nx,(contactWireHeight+SURFACES.land)/2,p.z+nz,.09,contactWireHeight-SURFACES.land,.09,'#657977');const arm=box(p.x+nx*.5,contactWireHeight+.02,p.z+nz*.5,1.9,.08,.08,'#7c8b84');arm.castShadow=false;arm.rotation.y=Math.atan2(-nz,nx);}
 // Dense miniature city blocks use shared geometry and instanced windows.
 const cityAnchors=[[-122.411,37.789,85,3.5],[-122.402,37.779,75,2.3],[-122.405,37.657,35,1.4],[-122.328,37.565,45,1.5],[-122.237,37.484,40,1.6],[-122.171,37.446,34,1.3],[-122.078,37.394,35,1.5]];
 const buildings=[],windows=[],colliders=[...authoredLandmarks.colliders];const railSamples=railCurve.getPoints(450),roadSamples=roadPts;
 for(const [lon,lat,count,height] of cityAnchors){const anchor=project(lon,lat);for(let i=0;i<count;i++){
  const x=anchor.x+(rand()-.5)*18,z=anchor.z+(rand()-.5)*18,h=1.1+rand()*height*2,w=.7+rand()*1.1,d=.7+rand()*1.2,c=rand(),radius=Math.hypot(w,d)/2;
  if(!onLand(x,z)||!corridors.isClear({x,z,w,d})||bridgeDrive.contains(x,z,radius+1.2)||authoredLandmarks.colliders.some(b=>Math.hypot(b.x-x,b.z-z)<b.r+radius+.3))continue;
  buildings.push({x,z,h,w,d,c});colliders.push({x,z,r:radius});
  for(let yy=1.3;yy<h;yy+=.65){if(rand()>.25)windows.push({x:x+w*.51,z:z+d*.2,y:yy,w:.035,d:d*.5});if(rand()>.3)windows.push({x:x-w*.12,z:z+d*.51,y:yy,w:w*.5,d:.035});}
 }}
 const bodyInstances=new T.InstancedMesh(new T.BoxGeometry(1,1,1),material('#667275',{roughness:.7,metalness:.15}),buildings.length);const dummy=new T.Object3D();buildings.forEach((b,i)=>{dummy.position.set(b.x,.63+b.h/2,b.z);dummy.scale.set(b.w,b.h,b.d);dummy.updateMatrix();bodyInstances.setMatrixAt(i,dummy.matrix);bodyInstances.setColorAt(i,new T.Color().setHSL(.52,.08,.26+b.c*.2));});bodyInstances.castShadow=true;bodyInstances.receiveShadow=true;scene.add(bodyInstances);
 const treePositions=[];for(let i=0;i<1400;i++){const x=-55+rand()*120,z=-78+rand()*161,s=.5+rand()*.8,r=.8*s;
  if(!onLand(x,z)||!corridors.isClear({x,z,r})||bridgeDrive.contains(x,z,r+1.4)||authoredLandmarks.bridge.vegetationBounds.containsPoint(new T.Vector3(x,1,z))||authoredLandmarks.colliders.some(p=>Math.hypot(p.x-x,p.z-z)<p.r+r+.5)||buildings.some(p=>Math.hypot(p.x-x,p.z-z)<Math.hypot(p.w,p.d)/2+r+.5))continue;treePositions.push({x,z,s});}
 const grassPatches=[];for(let i=0;i<280;i++){const t=(i+.5)/280,p=roadCurve.getPointAt(t),d=roadCurve.getTangentAt(t),side=i%2?1:-1,s=.55+rand()*.3,offset=3.5+rand()*2.4,x=p.x-d.z*offset*side,z=p.z+d.x*offset*side,r=.8*s;
  if(onLand(x,z)&&corridors.isClear({x,z,r})&&!bridgeDrive.contains(x,z,r+1.3)&&!buildings.some(b=>Math.hypot(b.x-x,b.z-z)<Math.hypot(b.w,b.d)/2+r+.2)&&!authoredLandmarks.colliders.some(b=>Math.hypot(b.x-x,b.z-z)<b.r+r+.2))grassPatches.push({x,z,s});
 }
 const urbanNature=createUrbanNature({scene,treePositions,grassPatches,buildings,reducedMotion});
 const cityDetail=createCityDetail({scene,buildings,buildingBodies:bodyInstances,roadCurve,railCurve,corridors,bridgeDrive,treePositions,reducedMotion,project,isOnLand:onLand});colliders.push(...cityDetail.colliders);
 for(const tree of treePositions)colliders.push({x:tree.x,z:tree.z,r:.14*tree.s});
 const streetScenery=createStreets(scene,{roadCurve,railCurve,zones,driveways:[bridgeDrive]});const streetGroundBounds=streetScenery.groundMeshes.map(m=>new T.Box3().setFromObject(m)),sampleStreet=createMeshHeightSampler(streetScenery.groundMeshes);
 // Bay Bridge: eastern crossing, distinct from the Golden Gate to the northwest.
 const bA=v3(project(-122.389,37.789),2),bB=v3(project(-122.366,37.811),2),bC=v3(project(-122.297,37.819),2);const bayBridge=new T.CatmullRomCurve3([bA,bB,bC]);ribbon(bayBridge,1.6,'#798b8d',2.5);for(let i=0;i<18;i++){const p=bayBridge.getPoint(i/17);box(p.x,1,p.z,.2,3,.2,'#6e8589');}
 // Airport runways on the east side of the Peninsula.
 const airport=project(-122.376,37.621);for(let i=0;i<2;i++){const runway=box(airport.x+i*1.2,.7,airport.z,1, .05,8,'#263f48');runway.rotation.y=-.62;}box(airport.x-1,.95,airport.z,2.5,.7,2,'#94a6a1');
 // Illuminated resume platforms are places in the story, not employer locations.
 const arrivals=new Map(zones.map(z=>{let t=nearestCurveParameter(v3(z),roadCurve);let p=roadCurve.getPointAt(t);if(colliders.some(b=>Math.hypot(b.x-p.x,b.z-p.z)<b.r+1)){let best=Infinity;for(let i=0;i<=800;i++){const candidate=roadCurve.getPointAt(i/800);if(colliders.some(b=>Math.hypot(b.x-candidate.x,b.z-candidate.z)<b.r+1))continue;const d=Math.hypot(candidate.x-z.x,candidate.z-z.z);if(d<best){best=d;t=i/800;p=candidate;}}}return[z.id,{...p,t}];}));
 const drivingNavigator=createDrivingNavigator({roadCurve,bridgeDrive,colliders,isOnLand:onLand});
 const rings=[];zones.forEach((z,i)=>{const arrival=arrivals.get(z.id);const ring=mesh(new T.RingGeometry(1.1,1.25,64),new T.MeshBasicMaterial({color:new T.Color(1.1,2,1.65),side:T.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}),arrival.x,SURFACES.road+.045,arrival.z);ring.castShadow=false;ring.receiveShadow=false;ring.rotation.x=-Math.PI/2;rings.push(ring);const el=document.createElement('button');el.className='map-label';el.dataset.zone=z.id;el.innerHTML=`<i>${String(i+1).padStart(2,'0')}</i><span>${z.city}<small>${z.label}</small></span><b>↗</b>`;el.setAttribute('aria-label',`Visit ${z.label} in ${z.city}`);el.onclick=()=>{onDrive();goTo(z.id);};labels.append(el);z.el=el;});
 const sceneryLabels=[];for(const id of ['golden-gate','salesforce','stanford','meta','google','sfo']){const l=landmarks.find(l=>l.id===id);const el=document.createElement('span');el.className='landmark-label';el.textContent=l.name;labels.append(el);sceneryLabels.push({...l,el});}
 // Vessels moving quietly through the bay.
 const boats=[];for(let i=0;i<9;i++){const boat=new T.Group();const hull=new T.Mesh(new T.ConeGeometry(.5,2.2,3),material('#c6d0cb'));hull.rotation.x=Math.PI/2;boat.add(hull);const sail=new T.Mesh(new T.ConeGeometry(.7,1.8,3),material('#d5d5c4'));sail.position.y=1;boat.add(sail);boat.position.set(-1+rand()*45,.1,-70+rand()*90);scene.add(boat);boats.push(boat);}
 // Batch static terrain, sleepers, markings, and infrastructure by material.
 scene.updateMatrixWorld(true);const batches=new Map();
 for(const m of [...scene.children]){if(!m.isMesh||m.isInstancedMesh||m===water||m===futureLine||rings.includes(m)||Array.isArray(m.material)||m.material.transparent)continue;const key=`${m.material.uuid}|${m.castShadow}|${m.receiveShadow}`;if(!batches.has(key))batches.set(key,{mat:m.material,meshes:[]});batches.get(key).meshes.push(m);}
 for(const {mat,meshes} of batches.values()){if(meshes.length<2)continue;const geometries=meshes.map(m=>{let g=m.geometry.clone();if(g.index)g=g.toNonIndexed();g.applyMatrix4(m.matrixWorld);return g;});const merged=mergeGeometries(geometries,false);if(merged){const batch=new T.Mesh(merged,mat);batch.castShadow=meshes.some(m=>m.castShadow);batch.receiveShadow=meshes.some(m=>m.receiveShadow);scene.add(batch);meshes.forEach(m=>scene.remove(m));}geometries.forEach(g=>g.dispose());}
 scene.add(car,train);const spawn=roadCurve.getPointAt(.01);spawn.y=groundedRootY(drivingHeight(spawn.x,spawn.z),car.userData.wheelBottom,carScale);
 car.position.copy(spawn);car.rotation.y=Math.atan2(roadCurve.getTangentAt(.01).x,roadCurve.getTangentAt(.01).z);
 const trainLight=new T.PointLight('#b5efff',4,12);trainLight.position.set(0,2,4.8);train.add(trainLight);
 const cameraOccluders=[authoredLandmarks.root,bodyInstances,cityDetail.root,urbanNature.canopy,...hills.map(h=>h.mesh)];scene.updateMatrixWorld(true);
 const cameraCache={safe:new T.Vector3(),target:new T.Vector3(Infinity,0,0),desired:new T.Vector3(),ready:false};
 let race=null,raceCurve=null,raceScene=null,racePlayground=null,savedDrive=null,raceActive=false,raceBoost=false;
 let vehicleGroundingMin=0,lastGround=null;const contactSamples=new Map();
 function groundCar(){
  if(raceActive)return;
  const x=car.position.x,z=car.position.z,yaw=car.rotation.y;
  if(lastGround&&x===lastGround.x&&z===lastGround.z&&yaw===lastGround.yaw)return;
  contactSamples.clear();const sampleHeight=(px,pz)=>{const key=`${Math.round(px*1e5)},${Math.round(pz*1e5)}`;if(!contactSamples.has(key))contactSamples.set(key,drivingHeight(px,pz));return contactSamples.get(key);};
  const pose=groundVehicle(car,{scale:carScale,sampleHeight,yaw,clearance:SURFACES.vehicleClearance});vehicleGroundingMin=pose.minClearance;car.userData.maxSuspension=pose.maxSuspension;lastGround={x,z,yaw};
 }
 groundCar();
 const shadowCanvas=document.createElement('canvas');shadowCanvas.width=128;shadowCanvas.height=128;const shadowContext=shadowCanvas.getContext('2d'),gradient=shadowContext.createRadialGradient(64,64,8,64,64,64);gradient.addColorStop(0,'rgba(0,10,14,.42)');gradient.addColorStop(.55,'rgba(0,10,14,.22)');gradient.addColorStop(1,'rgba(0,10,14,0)');shadowContext.fillStyle=gradient;shadowContext.fillRect(0,0,128,128);
 const contactShadow=new T.Mesh(new T.PlaneGeometry(1.7,3.2),new T.MeshBasicMaterial({map:new T.CanvasTexture(shadowCanvas),transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1}));contactShadow.rotation.x=-Math.PI/2;scene.add(contactShadow);
 const carGlow=new T.PointLight('#8ae5f7',2.5,7);carGlow.position.set(0,1.1,2.8);car.add(carGlow);
 const chassis=createVehicleDynamics(car,{reducedMotion}),vehicleHop=createVehicleHop({reducedMotion});let hopPose=null;
 const bridgeTowers=new Set(authoredLandmarks.bridge.towerColliders),ordinaryColliders=colliders.filter(b=>!bridgeTowers.has(b));
 const livingWorld=createLivingWorld({scene,roadCurve,railCurve,corridors,bridgeDrive,zones,reducedMotion,isOnLand:onLand,sampleHeight:drivingHeight,onRobotHit(event){chassis.impact(.3);onRobotHit(event);}});
 const burstLight=new T.PointLight('#ff9b32',0,9,2);scene.add(burstLight);
 let impactKick=0;
 const playground=createPlayground({scene,roadCurve,bridgeDrive,sampleHeight:drivingHeight,reducedMotion,onBurst(event){burstLight.position.copy(event.position).add(new T.Vector3(0,.7,0));burstLight.intensity=reducedMotion?0:16;impactKick=Math.min(.38,impactKick+.16+event.intensity*.2);chassis.impact(event.intensity);vehicleHop.trigger(event.intensity);onStatus({popped:event.total});onBurst(event);}});
 let paused=false,velocity=0,mode='explore',cameraMode='hero',day=true,auto=null,nearest=null,lastTime=0,frame=0,trainT=.1,trainDir=1,portal=false,cinematic=false,cinemaTime=0,recorder=null,recording=false,quality='high',trainVelocity=0,recordingURL=null,perfStart=0,perfFrames=0;
 const pauseReasons=new Set();
 let analog={throttle:0,steer:0,brake:0,active:false},brakeHeld=false,acceleration=0,previousVelocity=0;
 const keys=new Set(),camTarget=new T.Vector3(),camPosition=new T.Vector3(),tmp=new T.Vector3(),previousTrainPosition=new T.Vector3();let cameraManual=false,disposed=false,animationFrame=0,lastRenderTime=0;
 const entranceFrom=new T.Vector3(),entranceTargetFrom=new T.Vector3(),entranceEnd=new T.Vector3();
 const entrance=createDriveEntrance({reducedMotion,onChange(phase){onStatus({entrance:phase});focusPass.uniforms.uStrength.value=phase==='idle'?0:1;}});
 function cancelEntrance(){entrance.cancel();camera.clearViewOffset();focusPass.uniforms.uStrength.value=0;}
 function startEntrance(){cancelRace();cancelPortal();clearDrivingInput();auto=null;velocity=0;mode='drive';cinematic=false;cameraManual=false;cameraMode='follow';cameraCache.ready=false;entranceFrom.copy(camera.position);entranceTargetFrom.copy(controls.target);
  const target=car.position.clone().add(new T.Vector3(0,.55,0)),offset=new T.Vector3(4.2,3.8,5.8).applyAxisAngle(new T.Vector3(0,1,0),car.rotation.y+Math.PI);
  if(camera.aspect<.8)offset.multiplyScalar(1.28);entranceEnd.copy(chooseSafeCamera(target,target.clone().add(offset),cameraOccluders,{clearance:.3,maxLift:4}));
  onDrive();entrance.begin();onStatus({mode,camera:cameraMode});
 }
 listen(document,'pointerdown',e=>{if(!e.target.closest?.('dialog'))entrance.reveal();},{capture:true});
 listen(document,'keydown',e=>{if(!entrance.state().active||e.ctrlKey||e.metaKey||e.altKey||e.target.closest?.('dialog'))return;if(['Enter',' ','ArrowUp','ArrowLeft','ArrowRight','ArrowDown','w','a','s','d'].includes(e.key)){e.preventDefault();entrance.reveal();}},{capture:true});
 controls.addEventListener('start',()=>{if(entrance.state().active)return;cameraManual=true;cinematic=false;fadePass.uniforms.fade.value=1;});
 function nearestRoad(position,curve=roadCurve){return nearestCurveParameter(position,curve);}
 function cancelPortal(){
  if(!portal)return;
  portal=null;futureLine.visible=false;
  train.traverse(m=>{const state=m.userData.portalState;if(!state)return;const temporary=Array.isArray(m.material)?m.material:[m.material];temporary.forEach(mat=>mat.dispose());m.material=state.material;m.renderOrder=state.renderOrder;delete m.userData.portalState;});
  trainPosition(trainT);trainVelocity=0;
 }
 function goTo(id){
  cancelRace();
  const z=zones.find(z=>z.id===id);if(!z)return;
  cancelEntrance();cancelPortal();clearDrivingInput();cinematic=false;velocity=0;auto=null;fadePass.uniforms.fade.value=1;onDrive();
  if(mode==='train'){auto={id,targetT:T.MathUtils.clamp(nearestRoad(v3(z),railCurve),trainEndMargin,1-trainEndMargin),train:true};cameraMode='follow';cameraManual=false;}
  else{mode='drive';cameraMode='follow';cameraManual=false;const route=drivingNavigator.toRoad(car.position,arrivals.get(id).t);
   if(!route.points.length){onStatus({mode,camera:cameraMode,message:'Drive into an open area to reconnect with the road, then choose your stop again.'});return;}
   auto={id,points:route.points,index:0};
  }
  cameraCache.ready=false;onStatus({mode,camera:cameraMode,message:`Heading to ${z.label} · ${z.city}. ${mode==='drive'&&bridgeDrive.contains(car.position.x,car.position.z)?'Following the bridge back to San Francisco.':''}`});
 }
 function startRace(){
  cancelEntrance();cancelPortal();clearDrivingInput();auto=null;pauseReasons.clear();paused=false;cinematic=false;fadePass.uniforms.fade.value=1;
  if(!raceActive)savedDrive={position:car.position.clone(),rotation:car.rotation.clone(),mode,cameraMode};
  if(!race){
   raceCurve=createRaceCurve({height:9});
   raceScene=createBayRaceScene({scene,curve:raceCurve,createCar:createGravityCar,reducedMotion});
   race=createBayRace({length:raceCurve.getLength(),places:raceCurve.racePlaces,onEvent(event){
    if(event.type==='bump'){chassis.impact(event.intensity);impactKick=Math.max(impactKick,.1);}
    onRaceEvent(event);
   }});
   racePlayground=createPlayground({scene,roadCurve:raceCurve,sampleHeight:()=>9,reducedMotion,onBurst(event){burstLight.position.copy(event.position).add(new T.Vector3(0,.7,0));burstLight.intensity=reducedMotion?0:22;impactKick=Math.min(.38,impactKick+.25);chassis.impact(event.intensity);vehicleHop.trigger(event.intensity);onBurst(event);}});
  }
  raceActive=true;raceBoost=false;impactKick=0;burstLight.intensity=0;raceScene.setVisible(true);racePlayground.root.visible=true;playground.root.visible=false;racePlayground.reset();mode='drive';cameraMode='follow';cameraManual=false;cameraCache.ready=false;velocity=0;nearest=null;onNear(null);
  const state=race.start();placeRaceCar(state);const target=car.position.clone().add(new T.Vector3(0,.6,0)),offset=new T.Vector3(0,4.8,-8.5).applyAxisAngle(new T.Vector3(0,1,0),car.rotation.y);camera.position.copy(target).add(offset);controls.target.copy(target);camera.lookAt(target);onDrive();onStatus({race:state,mode});
 }
 function placeRaceCar(state){
  const f=raceFrame(raceCurve,state.player?.progress||0,state.player?.lane||0);car.position.copy(f.point);car.position.y=groundedRootY(f.point.y,car.userData.wheelBottom,carScale);car.rotation.set(0,f.yaw,0);vehicleGroundingMin=SURFACES.vehicleClearance;
 }
 function cancelRace(){
  if(!raceActive)return;raceActive=false;raceBoost=false;race.cancel();raceScene.setVisible(false);racePlayground.root.visible=false;playground.root.visible=true;clearDrivingInput();velocity=0;impactKick=0;
  if(savedDrive){car.position.copy(savedDrive.position);car.rotation.copy(savedDrive.rotation);mode=savedDrive.mode;cameraMode=savedDrive.cameraMode;savedDrive=null;}lastGround=null;groundCar();playground.update({dt:0,carPosition:car.position,paused:true});cameraCache.ready=false;cameraManual=false;onStatus({race:{phase:'idle'},mode});
 }
 function restoreHopPose(){if(!hopPose)return;car.position.y=hopPose.y;car.rotation.x=hopPose.pitch;car.rotation.z=hopPose.roll;hopPose=null;}
 function setPaused(value,reason='ui'){if(value)pauseReasons.add(reason);else pauseReasons.delete(reason);paused=pauseReasons.size>0;clearDrivingInput();velocity=0;}
 function clearDrivingInput(){restoreHopPose();vehicleHop.reset();keys.clear();analog={throttle:0,steer:0,brake:0,active:false};brakeHeld=false;acceleration=0;previousVelocity=0;chassis.reset();}
 function reset(){cancelRace();cancelEntrance();playground.reset();impactKick=0;onStatus({popped:0});lastGround=null;cancelPortal();clearDrivingInput();auto=null;velocity=0;trainVelocity=0;car.position.copy(spawn);car.rotation.y=Math.atan2(roadCurve.getTangentAt(.01).x,roadCurve.getTangentAt(.01).z);car.rotation.z=0;groundCar();trainT=.1;trainDir=1;trainPosition(trainT);nearest=null;onNear(null);cameraMode='hero';cameraManual=false;cinematic=false;mode='explore';onStatus({mode,camera:cameraMode});}
 function setMode(value){
  if(!['explore','drive','train'].includes(value))return;
  cancelRace();cancelEntrance();cancelPortal();auto=null;if(mode!==value){velocity=0;chassis.reset();}mode=value;cameraManual=false;cinematic=false;
  if(value==='train'||value==='drive'){cameraMode='follow';onDrive();}
  else cameraMode='overview';
  onStatus({mode,camera:cameraMode});
 }
 function followCar(){if(raceActive){cameraManual=false;cameraMode='follow';return;}cancelEntrance();cancelPortal();cinematic=false;cameraManual=false;cameraMode='follow';mode='drive';fadePass.uniforms.fade.value=1;cameraCache.ready=false;onDrive();onStatus({mode,camera:cameraMode});}
 function driveBridge(){
  cancelRace();
  clearDrivingInput();velocity=0;setMode('drive');fadePass.uniforms.fade.value=1;const route=drivingNavigator.toBridge(car.position);
  if(!route.points.length){onStatus({message:'Drive into an open area to reconnect with the Golden Gate route.'});return;}
  auto={bridge:true,points:route.points,index:0};cameraMode='follow';cameraManual=false;cameraCache.ready=false;onStatus({message:'Taking the scenic route to the Golden Gate Bridge. Steer any time to take over.'});
 }
 function setView(value){if(raceActive)return;cancelEntrance();cameraCache.ready=false;cameraMode=value;cameraManual=false;cinematic=false;if(value==='sf'){camTarget.copy(v3(project(-122.407,37.79),2));}onStatus({camera:cameraMode});}
 const driveKeys=['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','a','s','d','Shift',' '];
 listen(window,'keydown',e=>{if(disposed||paused||e.ctrlKey||e.metaKey||e.altKey||e.target.matches('input,textarea,select')||e.target.closest?.('dialog'))return;if(driveKeys.includes(e.key)){e.preventDefault();if(entrance.state().active){entrance.reveal();return;}keys.add(e.key);auto=null;if(!raceActive)setMode('drive');onDrive();}if(e.key.toLowerCase()==='r')reset();if(e.key.toLowerCase()==='m')setView('overview');if(e.key.toLowerCase()==='c')followCar();});listen(window,'keyup',e=>keys.delete(e.key));listen(window,'blur',()=>keys.clear());listen(document,'visibilitychange',()=>{keys.clear();lastTime=0;perfStart=0;perfFrames=0;});
 listen(window,'pagehide',()=>{if(recordingURL)URL.revokeObjectURL(recordingURL);});
 document.querySelectorAll('[data-key]').forEach(el=>{el.onpointerdown=e=>{e.preventDefault();el.setPointerCapture(e.pointerId);keys.add(el.dataset.key);auto=null;setMode('drive');};const release=()=>keys.delete(el.dataset.key);el.onpointerup=release;el.onpointercancel=release;el.onlostpointercapture=release;});
 function resize(){const w=container.clientWidth,h=container.clientHeight;if(!w||!h)return;renderer.setPixelRatio(quality==='eco'?1:Math.min(devicePixelRatio,w<=760?1.25:1.5));const shadowSize=w<=760?1024:2048;sun.shadow.mapSize.set(shadowSize,shadowSize);if(sun.shadow.map&&sun.shadow.map.width!==shadowSize){sun.shadow.map.dispose();sun.shadow.map=null;sun.shadow.mapPass?.dispose();sun.shadow.mapPass=null;}renderer.shadowMap.needsUpdate=true;renderer.setSize(w,h);composer.setPixelRatio(renderer.getPixelRatio());composer.setSize(w,h);renderingLook.resize(w,h,renderer.getPixelRatio());camera.aspect=w/h;camera.updateProjectionMatrix();}const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(container);resize();
 const projected=new T.Vector3();
 function projectLabel(z,alt=3){projected.set(z.x,alt,z.z).project(camera);const visible=projected.z<1&&Math.abs(projected.x)<1.1&&Math.abs(projected.y)<1.1;z.el.hidden=!visible;if(visible){z.el.style.left=`${(projected.x*.5+.5)*container.clientWidth}px`;z.el.style.top=`${(-projected.y*.5+.5)*container.clientHeight}px`;}}
 function poseTrain(curve,t,direction=1){
  const anchor=curveFrame(curve,t).point,rootCorrection=trainRootHeight-SURFACES.railCenter;
  train.position.copy(anchor);train.position.y+=rootCorrection;train.rotation.set(0,0,0);train.updateMatrixWorld(true);
  for(const data of train.userData.carriages){
   const frame=curveFrame(curve,t,data.offset*trainScale*direction),p=frame.point.clone();p.y+=rootCorrection;
   data.group.position.copy(train.worldToLocal(p));
   const axle=data.axleOffsets.at(-1)*trainScale,front=curveFrame(curve,t,(data.offset*trainScale+axle)*direction).point,rear=curveFrame(curve,t,(data.offset*trainScale-axle)*direction).point;
   const tangent=front.sub(rear).normalize();data.group.rotation.set(-Math.atan2(tangent.y,Math.hypot(tangent.x,tangent.z)),Math.atan2(tangent.x,tangent.z),0,'YXZ');
  }
 }
 // A bidirectional EMU reverses travel without rotating its consist at the terminus.
 function trainPosition(t){poseTrain(railCurve,t,1);}
 let cinemaChapter=-1;
 function updateCamera(dt,time){
  if(raceActive){
   const state=race.state(),f=raceFrame(raceCurve,state.player?.progress||0,state.player?.lane||0),look=raceFrame(raceCurve,(state.player?.progress||0)+.015,state.player?.lane||0);
   camera.fov=T.MathUtils.damp(camera.fov,!reducedMotion&&state.boosting?43:39,4,dt);camera.updateProjectionMatrix();
   const close=camera.aspect<.8,target=car.position.clone().add(new T.Vector3(0,.65,0));
   const behind=f.tangent.clone().multiplyScalar(close?-11:-8.4);behind.y=close?7.2:5.1;const desired=target.clone().add(behind);
   camera.position.lerp(desired,1-Math.exp(-dt*6));controls.target.copy(target).lerp(look.point.clone().add(new T.Vector3(0,.7,0)),.12);camera.lookAt(controls.target);fadePass.uniforms.fade.value=1;return;
  }
  if(camera.fov!==39){camera.fov=39;camera.updateProjectionMatrix();}
  const intro=entrance.state();
  if(intro.active){
   const target=car.position.clone().add(new T.Vector3(0,.55,0));
   if(intro.phase==='approach'){camera.position.lerpVectors(entranceFrom,entranceEnd,intro.eased);controls.target.lerpVectors(entranceTargetFrom,target,intro.eased);}
   else{const pull=intro.phase==='reveal'?intro.eased:0;camera.position.copy(entranceEnd).sub(target).multiplyScalar(1+pull*.16).add(target);controls.target.copy(target);}
   if(camera.aspect<.8){const lift=.16*(intro.phase==='reveal'?1-intro.eased:1);camera.setViewOffset(container.clientWidth,container.clientHeight,0,container.clientHeight*lift,container.clientWidth,container.clientHeight);}else camera.clearViewOffset();
   camera.lookAt(controls.target);const center=car.position.clone().add(new T.Vector3(0,.18,0)).project(camera);focusPass.uniforms.uCenter.value.set(center.x*.5+.5,center.y*.5+.5);focusPass.uniforms.uAspect.value=camera.aspect;
   const radius=camera.aspect<.8?camera.aspect*.44:.30;focusPass.uniforms.uRadius.value=intro.phase==='approach'?T.MathUtils.lerp(1.8,radius,intro.eased):intro.phase==='reveal'?T.MathUtils.lerp(radius,2.5,intro.eased):radius;
   focusPass.uniforms.uStrength.value=intro.phase==='reveal'?1-intro.eased:Math.min(1,intro.progress*2);if(intro.phase==='ready')focusPass.uniforms.uStrength.value=1;
   return;
  }
  if(camera.view?.enabled)camera.clearViewOffset();
  if(cameraManual)return;const aspect=camera.aspect,close=aspect<.8;let target=new T.Vector3(8,0,2),offset=new T.Vector3(135,150,190),chapter=-1;
  if(cameraMode==='overview'){target.set(close?6:-13,0,6);offset.set(close?185:130,close?230:154,close?270:194);}
  if(cameraMode==='hero'){target.copy(v3(project(-122.423,37.79),2));offset.set(close?30:37,close?37:36,close?50:48);}
  if(cameraMode==='sf'){target.copy(v3(project(-122.415,37.794),3));offset.set(35,35,45);}
  if(cameraMode==='follow'){const vehicle=mode==='train'?train:car;target.copy(vehicle.position).add(new T.Vector3(0,mode==='train'?1.3:.65,0));offset.set(...(mode==='train'?[13,9,17]:[5,4,7]));if(close)offset.multiplyScalar(mode==='train'?1.2:1.55);if(mode!=='train')offset.applyAxisAngle(new T.Vector3(0,1,0),car.rotation.y+Math.PI);}
  fadePass.uniforms.fade.value=1;
  if(cinematic){
   if(!paused)cinemaTime+=dt;const cycle=cinemaTime%30;chapter=cycle<10?0:cycle<21?1:2;
   const start=[0,10,21][chapter],end=[10,21,30][chapter],local=cycle-start;
   fadePass.uniforms.fade.value=T.MathUtils.smoothstep(local,0,.6)*T.MathUtils.smoothstep(end-cycle,0,.6);
   if(chapter===0){target.copy(v3(project(-122.418,37.792),3));const a=local*.035;offset.set(30+Math.sin(a)*10,32,45+Math.cos(a)*3);}
   else if(chapter===1){target.copy(train.position).add(new T.Vector3(0,1.2,0));offset.set(14,12,19);}
   else{target.copy(v3(project(-122.1697,37.4275),2));const a=local*.04;offset.set(23+Math.sin(a)*8,22,28);}
  }
  camPosition.copy(target).add(offset);const protectView=cameraMode==='follow'&&!cinematic||cinematic&&chapter===1;
  if(!cameraCache.ready||cameraCache.target.distanceToSquared(target)>.001||cameraCache.desired.distanceToSquared(camPosition)>.001){
   cameraCache.safe.copy(protectView?chooseSafeCamera(target,camPosition,cameraOccluders,{clearance:.35,maxLift:10,previousPosition:cameraCache.ready?cameraCache.safe:undefined}):camPosition);cameraCache.target.copy(target);cameraCache.desired.copy(camPosition);cameraCache.ready=true;
  }
  if(cinematic&&chapter!==cinemaChapter){camera.position.copy(cameraCache.safe);controls.target.copy(target);cinemaChapter=chapter;}
  else{
   const next=camera.position.clone().lerp(cameraCache.safe,1-Math.exp(-dt*(reducedMotion?30:3.5)));
   // Validate the interpolated camera too: a clear endpoint alone can still fly through a building.
   if(protectView&&camera.position.distanceToSquared(cameraCache.safe)>.0025&&frame%3===0){const clear=chooseSafeCamera(target,next,cameraOccluders,{clearance:.3,maxLift:7,previousPosition:cameraCache.safe});clear.y=Math.min(clear.y,cameraCache.safe.y+3);next.copy(clear);}
   camera.position.copy(next);if(cameraMode==='follow'&&!cinematic)controls.target.copy(target);else controls.target.lerp(target,1-Math.exp(-dt*(reducedMotion?30:4)));
  }
  if(cameraMode==='follow'||cinematic){controls.target.copy(target);camera.lookAt(target);}else controls.update();
 }
 function animate(time){if(disposed)return;animationFrame=requestAnimationFrame(animate);if(document.hidden||container.clientWidth===0)return;const frameInterval=1000/60,elapsed=time-lastRenderTime;if(elapsed<frameInterval-.25)return;lastRenderTime=time-(Math.max(frameInterval,elapsed)%frameInterval);const frameMs=lastTime?time-lastTime:16.667,dt=Math.min(frameMs/1000,.045);lastTime=time;restoreHopPose();previousTrainPosition.copy(train.position);if(!paused)entrance.update(dt);focusPass.uniforms.uTime.value=time*.001;burstLight.intensity*=Math.exp(-dt*8);waterUniforms.uTime.value=reducedMotion?0:time*.001;
 if(!paused){if(raceActive){const oldSpeed=velocity;const steer=analog.active?analog.steer:(keys.has('a')||keys.has('ArrowLeft')?1:0)-(keys.has('d')||keys.has('ArrowRight')?1:0);const state=race.update(dt,{steer:-steer,brake:brakeHeld||keys.has(' ')||analog.brake>0,boost:raceBoost||keys.has('Shift')});velocity=state.player?.speed||0;acceleration=(velocity-oldSpeed)/dt;placeRaceCar(state);raceScene.update(state,time*.001);if(frame%3===0)onStatus({race:state});}else if(auto?.train){const delta=auto.targetT-trainT;trainDir=Math.sign(delta)||trainDir;const step=Math.min(Math.abs(delta),dt*.1);trainT+=Math.sign(delta)*step;trainPosition(trainT);if(Math.abs(delta)<.001){const id=auto.id;auto=null;onArrive(id);}}else if(auto){let remaining=dt*(reducedMotion?45:14);while(auto&&remaining>0){const p=auto.points[auto.index],dx=p.x-car.position.x,dz=p.z-car.position.z,d=Math.hypot(dx,dz);if(d<.06){auto.index++;if(auto.index>=auto.points.length){const id=auto.id,isBridge=auto.bridge;auto=null;velocity=0;if(isBridge)onStatus({message:'Golden Gate Bridge. Explore toward Marin, or choose any resume stop to follow the road back.'});else onArrive(id);}continue;}const a=Math.atan2(dx,dz),diff=Math.atan2(Math.sin(a-car.rotation.y),Math.cos(a-car.rotation.y));car.rotation.y+=diff*Math.min(1,dt*8);const step=Math.min(d,remaining);car.position.x+=dx/d*step;car.position.z+=dz/d*step;remaining-=step;velocity=14;}}else if(mode==='drive'&&!entrance.state().active){
  const keyThrottle=(keys.has('w')||keys.has('ArrowUp')?1:0)-(keys.has('s')||keys.has('ArrowDown')?1:0),keySteer=(keys.has('a')||keys.has('ArrowLeft')?1:0)-(keys.has('d')||keys.has('ArrowRight')?1:0);
  const throttle=analog.active?analog.throttle:keyThrottle,steer=analog.active?analog.steer:keySteer,braking=brakeHeld||analog.brake>0||keys.has(' ');
  if(analog.active||keyThrottle||keySteer||braking){cinematic=false;cameraManual=false;cameraMode='follow';}
  previousVelocity=velocity;
  if(braking)velocity*=Math.exp(-dt*10);else{velocity+=throttle*dt*12;velocity*=Math.exp(-dt*(Math.abs(throttle)>.02?.5:2.6));}
  velocity=T.MathUtils.clamp(velocity,-5,keys.has('Shift')?21:11);
  if(Math.abs(velocity)<.025)velocity=0;
  let previousYaw=car.rotation.y;car.rotation.y+=steer*dt*1.65*Math.min(Math.abs(velocity)/2.5,1)*Math.sign(velocity);
  const old=car.position.clone(),distance=velocity*dt,steps=Math.max(1,Math.ceil(Math.abs(distance)/.18));
  for(let step=0;step<steps;step++){
   const x=car.position.x+Math.sin(car.rotation.y)*distance/steps,z=car.position.z+Math.cos(car.rotation.y)*distance/steps;
   const resolved=bridgeConstraint.resolveStep({from:car.position,to:{x,y:car.position.y,z},yaw:car.rotation.y,previousYaw});
   const px=resolved.active?resolved.position.x:x,pz=resolved.active?resolved.position.z:z;
   const blockers=resolved.active?ordinaryColliders:colliders;
   const legal=(resolved.active?resolved.valid:onLand(px,pz))&&!blockers.some(b=>Math.hypot(b.x-px,b.z-pz)<b.r+.65);
   if(!legal){velocity=0;break;}car.position.x=px;car.position.z=pz;
   if(resolved.active){car.rotation.y=resolved.yaw;velocity*=resolved.speedScale;}previousYaw=car.rotation.y;
  }
  acceleration=(Math.abs(velocity)-Math.abs(previousVelocity))/dt;
 }
 groundCar();chassis.update({dt,speed:velocity,acceleration,braking:brakeHeld||keys.has(' ')||analog.brake>0,paused:paused||mode!=='drive'});contactShadow.position.set(car.position.x,(raceActive?9:drivingHeight(car.position.x,car.position.z))+.012,car.position.z);contactShadow.rotation.z=-car.rotation.y;
 for(const w of car.userData.wheels)w.rotation.x+=velocity*dt/ .45;
 const current=mode==='train'?train.position:car.position;const n=raceActive?null:zones.find(z=>{const p=mode==='train'?z:arrivals.get(z.id);return Math.hypot(current.x-p.x,current.z-p.z)<2.7;})?.id||null;if(n!==nearest){nearest=n;onNear(n);}
 }
 if((!reducedMotion||mode==='train')&&!paused&&!auto?.train&&!portal){trainT+=dt*.018*trainDir;if(trainDir>0&&trainT>=1-trainEndMargin){trainT=1-trainEndMargin;trainDir=-1;}if(trainDir<0&&trainT<=trainEndMargin){trainT=trainEndMargin;trainDir=1;}trainPosition(trainT);for(let i=0;i<boats.length;i++){boats[i].position.z+=dt*.1;boats[i].position.y=.1+Math.sin(time*.001+i)*.04;}rings.forEach((r,i)=>r.scale.setScalar(1+Math.sin(time*.0015+i)*.06));}
 if(portal&&!paused){portal.elapsed+=dt;const t=Math.min(1,portal.elapsed/6.5);poseTrain(futureCurve,t,1);if(t>=1){trainT=0;trainDir=1;cancelPortal();onStatus({message:'Now joining the existing Caltrain corridor at Fourth & King.'});}}
 const hop=vehicleHop.update(dt,{paused});hopPose={y:car.position.y,pitch:car.rotation.x,roll:car.rotation.z};car.position.y+=hop.height;car.rotation.x+=hop.pitch;car.rotation.z+=hop.roll;contactShadow.material.opacity=Math.max(.35,1-hop.height*.6);contactShadow.scale.setScalar(1+hop.height*.2);
 const detailQuality=quality==='eco'||container.clientWidth<=760?'eco':'high';
 urbanNature.update({dt,time:time*.001,paused,quality:detailQuality});cityDetail.update({dt,paused,quality:detailQuality});
 livingWorld.update({dt,time:time*.001,carPosition:car.position,carVelocity:velocity,paused,quality:detailQuality});
 playground.update({dt,time:time*.001,carPosition:car.position,carSpeed:velocity,paused:paused||raceActive||mode!=='drive'||entrance.state().active,quality:detailQuality});
 if(raceActive)racePlayground.update({dt,carPosition:car.position,carSpeed:velocity,paused:paused||race.state().phase!=='racing',quality:detailQuality});
 trainVelocity=paused?0:train.position.distanceTo(previousTrainPosition)/dt;
 controls.enabled=!raceActive&&!paused&&!entrance.state().active&&!cinematic&&!(cameraMode==='follow'&&!cameraManual);
 if(paused||cameraManual){if(controls.enabled)controls.update();if(cameraManual&&cameraMode==='follow'&&frame%4===0)camera.position.copy(chooseSafeCamera(controls.target,camera.position,cameraOccluders,{clearance:.3,maxLift:18}));}else updateCamera(dt,time);
 renderingLook.update({dt,frameMs,paused,target:cinematic||cameraMode!=='follow'?controls.target:mode==='train'?train.position:car.position,quality});
 if(frame++%3===0){zones.forEach(z=>projectLabel(z,3));sceneryLabels.forEach(z=>{projectLabel(z,z.id==='salesforce'?25:5);z.el.hidden=z.el.hidden||cameraMode==='overview';z.el.classList.toggle('dimmed',cameraMode==='follow');});const carProjection=car.position.clone().project(camera);onStatus({speed:Math.round((mode==='train'?trainVelocity:Math.abs(velocity))*3.6),mode,cinematic,cinemaChapter,cameraMode,carScreenX:carProjection.x,carScreenY:carProjection.y,carX:car.position.x,carY:car.position.y,hopHeight:hop.height,carZ:car.position.z,carYaw:car.rotation.y,onBridge:bridgeDrive.contains(car.position.x,car.position.z),braking:brakeHeld||keys.has(' '),brakePitch:chassis.state().pitch,brakeHeave:chassis.state().heave,activeFireballs:(raceActive?racePlayground:playground).stats.activeFireballs,activeSmoke:(raceActive?racePlayground:playground).stats.activeSmoke});}
 renderer.info.reset();if(frame%3===0)renderer.shadowMap.needsUpdate=true;const brakeKick=!reducedMotion&&!paused&&(brakeHeld||keys.has(' '))?Math.min(.16,Math.abs(acceleration)*.003):0;const kick=!reducedMotion&&!paused?Math.max(impactKick,brakeKick):0,shakeX=Math.sin(time*.071)*kick,shakeY=Math.cos(time*.097)*kick*.5;impactKick*=Math.exp(-dt*7);camera.position.x+=shakeX;camera.position.y+=shakeY;camera.updateMatrixWorld();bloom.enabled=quality==='high';if(quality==='high'||entrance.state().active)composer.render();else renderer.render(scene,camera);camera.position.x-=shakeX;camera.position.y-=shakeY;camera.updateMatrixWorld();
 if(!perfStart)perfStart=time;perfFrames++;if(perfFrames>=120){onStatus({drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,fps:Math.round(perfFrames*1000/Math.max(1,time-perfStart)),vehicleGroundingMin,robots:livingWorld.stats.robots,robotHits:livingWorld.stats.robotHits,robotsUpset:livingWorld.stats.robotsUpset,drones:livingWorld.stats.drones,leaves:livingWorld.stats.leaves,pods:playground.stats.pods,terrainTop:SURFACES.land,roadTop:SURFACES.road,trees:urbanNature.stats.trees,grassBlades:urbanNature.stats.grassBlades,occupiedWindows:urbanNature.stats.occupants,activeFireballs:(raceActive?racePlayground:playground).stats.activeFireballs,activeSmoke:(raceActive?racePlayground:playground).stats.activeSmoke});perfFrames=0;perfStart=time;}
 }
 trainPosition(trainT);updateCamera(100,0);animationFrame=requestAnimationFrame(animate);
 function audioTelemetry(){
  const listener=mode==='train'?train.position:car.position;return environmentAudio({listener,train:train.position,trainSpeed:trainVelocity,cameraQuaternion:camera.quaternion,drone:livingWorld.nearestDrone(listener),braking:brakeHeld||keys.has(' '),day});
 }
 function recordTour(){
  if(recording){if(recorder&&recorder.state!=='inactive')recorder.stop();return false;}
  if(!renderer.domElement.captureStream||typeof MediaRecorder==='undefined')throw new Error('Video recording is unavailable in this browser.');
  const type=['video/webm;codecs=vp8,opus','video/webm;codecs=vp9,opus','video/webm;codecs=vp8','video/webm','video/mp4'].find(t=>MediaRecorder.isTypeSupported(t));
  if(!type)throw new Error('No supported recording format.');
  const stream=renderer.domElement.captureStream(30);const audioStream=getAudioStream();if(audioStream)for(const track of audioStream.getAudioTracks())stream.addTrack(track.clone());let localRecorder;
  try{localRecorder=new MediaRecorder(stream,{mimeType:type,videoBitsPerSecond:6000000});}
  catch(error){stream.getTracks().forEach(t=>t.stop());throw error;}
  const chunks=[];let stopTimer=null,failed=false;
  localRecorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  localRecorder.onerror=()=>{failed=true;clearTimeout(stopTimer);stream.getTracks().forEach(t=>t.stop());if(localRecorder.state!=='inactive')localRecorder.stop();if(recorder===localRecorder){recording=false;onStatus({recording:false,message:'Recording could not finish in this browser. Please try again.'});}};
  localRecorder.onstop=()=>{
   clearTimeout(stopTimer);stream.getTracks().forEach(t=>t.stop());if(recorder===localRecorder)recording=false;
   if(failed)return;
   if(!chunks.length){onStatus({recording:false,message:'No video frames were captured. Please try recording again.'});return;}
   if(recordingURL)URL.revokeObjectURL(recordingURL);const videoBlob=new Blob(chunks,{type});recordingURL=URL.createObjectURL(videoBlob);const a=document.querySelector('#recording-download')||document.createElement('a');a.id='recording-download';a.href=recordingURL;a.download=`ricky-sparks-bayward.${type.includes('mp4')?'mp4':'webm'}`;a.textContent='Download video ↓';if(!a.isConnected)(document.querySelector('footer>div')||container).append(a);onStatus({recording:false,recordingURL,recordingBytes:videoBlob.size,message:'Your recording is ready. Watch it here or use Download video to save it.'});
  };
  recorder=localRecorder;recording=true;cinematic=true;cinemaTime=0;cameraManual=false;
  try{localRecorder.start();}
  catch(error){recording=false;stream.getTracks().forEach(t=>t.stop());throw error;}
  if(recordingURL){URL.revokeObjectURL(recordingURL);recordingURL=null;document.querySelector('#recording-download')?.remove();}
  stopTimer=setTimeout(()=>{if(localRecorder.state!=='inactive')localRecorder.stop();},30000);
  return true;
 }
 return {dispose(){disposed=true;lifecycle.abort();cancelAnimationFrame(animationFrame);resizeObserver.disconnect();controls.dispose();chassis.dispose();livingWorld.dispose();cityDetail.dispose();urbanNature.dispose();playground.dispose();racePlayground?.dispose();raceScene?.dispose();renderingLook.dispose();if(recorder&&recorder.state!=='inactive')recorder.stop();composer.passes.forEach(pass=>pass.dispose?.());composer.dispose();scene.traverse(o=>{o.geometry?.dispose();for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){for(const value of Object.values(m))if(value?.isTexture)value.dispose();m.dispose();}});scene.environment?.dispose();renderer.dispose();renderer.forceContextLoss();},goTo,reset,driveBridge,followCar,startRace,cancelRace,setRaceBoost(value){raceBoost=Boolean(value);},setInput(input){if(!raceActive&&analog.active&&!input.active)velocity*=.25;analog={...analog,...input};if(input.active){if(mode!=='drive'||cameraManual||cinematic||cameraMode!=='follow')followCar();auto=null;}},setBrake(value){brakeHeld=Boolean(value);if(value){auto=null;followCar();}},telemetry:audioTelemetry,start:startEntrance,reveal:()=>entrance.reveal(),pause:setPaused,isPaused:()=>paused,speed:()=>paused?0:(mode==='train'?trainVelocity:velocity),mode:()=>mode,setMode,setView,
 toggleDay(){day=!day;waterUniforms.uDay.value=day?1:0;renderingLook.setDay(day);return day;},
 toggleQuality(){quality=quality==='high'?'eco':'high';renderer.shadowMap.enabled=quality==='high';renderingLook.setQuality(quality);renderer.setPixelRatio(quality==='high'?Math.min(devicePixelRatio,1.5):1);resize();return quality;},
 tour(value){cancelRace();cancelEntrance();cinematic=typeof value==='boolean'?value:!cinematic;cameraManual=false;cinemaTime=0;onDrive();return cinematic;},recordTour,
 portal(){
  cancelRace();cancelEntrance();cancelPortal();auto=null;velocity=0;cinematic=false;mode='train';portal={elapsed:0};futureLine.visible=true;
  train.traverse(m=>{if(!m.isMesh)return;m.userData.portalState={material:m.material,renderOrder:m.renderOrder};if(Array.isArray(m.material))m.material=m.material.map(mat=>{const copy=mat.clone();copy.depthTest=false;return copy;});else{m.material=m.material.clone();m.material.depthTest=false;}m.renderOrder=3;});
  poseTrain(futureCurve,0,1);cameraCache.ready=false;cameraMode='follow';cameraManual=false;onDrive();onStatus({mode,message:'Future Portal concept: below Salesforce Park → Fourth & King. Not current service.'});
 },
 get stats(){return {drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles};}
 };
}
