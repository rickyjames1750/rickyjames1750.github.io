import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { createCinematicGrade, createRenderingLook, createSurfaceDetailTexture, createSurfaceMaterials } from '../src/rendering-look.js';

function fixture(extra={}){
  const scene=new T.Scene(),camera=new T.PerspectiveCamera(39,16/9,.1,1400);camera.position.set(12,8,20);
  const renderer={isWebGLRenderer:false,toneMapping:T.ACESFilmicToneMapping,toneMappingExposure:1.1,outputColorSpace:T.SRGBColorSpace,shadowMap:{needsUpdate:false},getPixelRatio:()=>1};
  const sun=new T.DirectionalLight(),hemi=new T.HemisphereLight(),rim=new T.DirectionalLight();scene.add(sun,hemi,rim);
  const look=createRenderingLook({renderer,scene,camera,sun,hemi,rim,environment:false,...extra});return {scene,camera,renderer,sun,hemi,rim,look};
}

test('procedural aggregate data is repeatable, finite, linear and mipmapped for distant roads',()=>{
  const a=createSurfaceDetailTexture(128),b=createSurfaceDetailTexture(128);assert.deepEqual(a.image.data,b.image.data);assert.equal(a.image.data.length,128*128*4);assert.equal(a.colorSpace,T.NoColorSpace);assert.equal(a.wrapS,T.RepeatWrapping);assert.equal(a.wrapT,T.RepeatWrapping);assert.equal(a.minFilter,T.LinearMipmapLinearFilter);assert.equal(a.generateMipmaps,true);
  for(let channel=0;channel<3;channel++){const values=new Set();for(let i=channel;i<a.image.data.length;i+=4)values.add(a.image.data[i]);assert.ok(values.size>25,'aggregate, height and roughness must contain actual surface variation');}
  const bounded=createSurfaceDetailTexture(100000);assert.equal(bounded.image.width,512);a.dispose();b.dispose();bounded.dispose();
});

test('road and concrete materials add physical detail to UV-free ribbons and instanced paving',()=>{
  const surfaces=createSurfaceMaterials({textureSize:64});
  for(const material of [surfaces.roadMaterial,surfaces.concreteMaterial]){
    assert.equal(material.isMeshStandardMaterial,true);assert.equal(material.metalness,0);assert.ok(material.roughness>=.8);assert.equal(material.map,null,'surface cannot depend on missing ribbon UVs');
    const shader={vertexShader:T.ShaderLib.standard.vertexShader,fragmentShader:T.ShaderLib.standard.fragmentShader,uniforms:{}};material.onBeforeCompile(shader);
    assert.equal(shader.uniforms.uSurfaceDetail.value,surfaces.texture);assert.match(shader.vertexShader,/instanceMatrix\*surfacePosition/);assert.match(shader.fragmentShader,/texture2D\(uSurfaceDetail,vSurfaceWorld.xz/);assert.match(shader.fragmentShader,/dFdx\(surfaceHeight\)/);assert.match(shader.fragmentShader,/roughnessFactor=clamp/);
    assert.ok(shader.fragmentShader.indexOf('vec3 surfaceTexel=')<shader.fragmentShader.indexOf('float surfaceHeight='),'detail must be declared before the normal calculation');
  }
  assert.equal(surfaces.paintMaterial.isMeshStandardMaterial,true,'road stripes respond to daylight instead of glowing');surfaces.dispose();
});

test('coastal look neutralizes the lighting and keeps camera and existing assets untouched',()=>{
  const {look,scene,camera,renderer,sun,hemi,rim}=fixture({enableAO:false}),cameraPose=camera.matrixWorld.clone(),direction=sun.position.clone().sub(sun.target.position).normalize();
  assert.equal(renderer.toneMapping,T.AgXToneMapping);assert.equal(renderer.outputColorSpace,T.SRGBColorSpace);assert.ok(sun.color.r-sun.color.b<.3,'sunlight remains a neutral warm white');assert.ok(rim.intensity<.3,'a cyan rim cannot dominate the material colors');assert.ok(hemi.intensity<1.2);assert.ok(scene.fog.density<.004);assert.equal(look.sky.isSky,true);
  look.update({dt:.016,target:new T.Vector3(38,1,61)});assert.deepEqual(camera.matrixWorld,cameraPose);assert.ok(sun.position.clone().sub(sun.target.position).normalize().distanceTo(direction)<1e-10,'moving the shadow region must not turn the sun');assert.equal(sun.shadow.camera.right,34);assert.ok(sun.shadow.normalBias<.03);
  assert.equal(look.setDay(false),false);assert.ok(sun.intensity>1&&sun.intensity<3);assert.ok(renderer.toneMappingExposure>.9);assert.equal(look.setDay(true),true);assert.equal(look.stats.environmentMaps,0,'CPU-only fixture cannot request GPU environment work');look.dispose();
});

test('ground contact pass is half-resolution and skips small screens, ECO and distant map views',()=>{
  const {look,camera}=fixture({width:1440,height:900});assert.equal(look.stats.occlusionEnabled,true);assert.equal(look.stats.occlusionWidth,720);assert.equal(look.stats.occlusionHeight,450);assert.ok(look.occlusionPass.blendIntensity<=.35);assert.equal(look.occlusionPass.gtaoMaterial.defines.SAMPLES,8);
  look.resize(844,390,2);assert.equal(look.stats.occlusionEnabled,false);look.resize(1280,720,1.5);assert.equal(look.stats.occlusionWidth,960);assert.equal(look.stats.occlusionHeight,540);assert.equal(look.stats.occlusionEnabled,true);
  look.setQuality('eco');assert.equal(look.stats.occlusionEnabled,false);look.setQuality('high');camera.position.y=100;look.update({dt:.016});assert.equal(look.stats.occlusionEnabled,false);camera.position.y=10;look.update({dt:.016});assert.equal(look.stats.occlusionEnabled,true);look.dispose();
});

test('finish preserves HDR range and disposal releases resources exactly once',()=>{
  const grade=createCinematicGrade();assert.ok(grade.uniforms.uSaturation.value>.9);assert.ok(grade.uniforms.uVignette.value<.05);assert.doesNotMatch(grade.material.fragmentShader,/clamp\(color.*0\..*1\./,'the photographic finish cannot clip HDR highlights before OutputPass');grade.dispose();grade.dispose();
  const scene=new T.Scene(),previousEnvironment=new T.Texture(),previousFog=new T.FogExp2('#abcdef',.01),background=new T.Color('#123456');scene.environment=previousEnvironment;scene.fog=previousFog;scene.background=background;
  const {look,renderer}=fixture({scene,enableAO:true});
  const owned=[look.texture,look.roadMaterial,look.concreteMaterial,look.paintMaterial,look.sky.geometry,look.sky.material,look.gradePass.material,look.occlusionPass.gtaoMaterial,look.occlusionPass.blendMaterial];let freed=0;for(const resource of owned)resource.addEventListener('dispose',()=>freed++);
  look.update({dt:.05});const clock=look.stats.animationTime;look.update({dt:1,paused:true});assert.equal(look.stats.animationTime,clock);look.dispose();look.dispose();look.gradePass.dispose();look.occlusionPass.dispose();assert.equal(freed,owned.length);assert.equal(look.root.parent,null);assert.equal(scene.environment,previousEnvironment);assert.equal(scene.fog,previousFog);assert.equal(scene.background,background);assert.equal(renderer.toneMapping,T.ACESFilmicToneMapping);look.update({dt:1});assert.equal(look.stats.animationTime,clock);
});

test('self-hosted HDR loading applies only the newest request and keeps the analytic sky',async()=>{
  const pending=new Map(),loader={loadAsync:url=>new Promise(resolve=>pending.set(url,resolve))};
  const {look,scene}=fixture({environmentLoader:loader,enableAO:false});
  const first=look.setEnvironmentMap('/assets/old.hdr'),second=look.setEnvironmentMap('/assets/coastal-city.hdr',{rotation:.8});
  const old=new T.Texture(),current=new T.Texture();let oldDisposed=0,currentDisposed=0;old.addEventListener('dispose',()=>oldDisposed++);current.addEventListener('dispose',()=>currentDisposed++);
  pending.get('/assets/coastal-city.hdr')(current);assert.equal(await second,true);assert.equal(scene.environment,current);assert.equal(current.mapping,T.EquirectangularReflectionMapping);assert.equal(scene.environmentRotation.y,.8);assert.equal(look.sky.visible,true,'the local HDR changes reflections, not Bay Area geography');
  pending.get('/assets/old.hdr')(old);assert.equal(await first,false);assert.equal(oldDisposed,1);assert.equal(scene.environment,current);assert.equal(look.stats.environmentStatus,'hdr');look.setDay(false);assert.equal(scene.environment,current,'changing daylight cannot replace a loaded reflection asset');
  assert.equal(await look.setEnvironmentMap(null),true);assert.equal(scene.environment,null);assert.equal(currentDisposed,1);look.dispose();
});

test('HDR failures resolve safely and loading completion after disposal cannot retain a texture',async()=>{
  let report=0;const {look}=fixture({environmentURL:'/missing.hdr',environmentLoader:{loadAsync:async()=>{throw new Error('missing');}},onEnvironmentError:()=>{report++;throw new Error('observer');},enableAO:false});
  assert.equal(await look.ready,false);assert.equal(report,1);assert.equal(look.stats.environmentStatus,'error');look.dispose();
  let resolve;const late=fixture({environmentLoader:{loadAsync:()=>new Promise(r=>{resolve=r;})},enableAO:false});const request=late.look.setEnvironmentMap('/late.hdr'),texture=new T.Texture();let freed=0;texture.addEventListener('dispose',()=>freed++);late.look.dispose();resolve(texture);assert.equal(await request,false);assert.equal(freed,1);assert.equal(late.scene.environment,null);
});

test('AO budget tolerates occasional slow frames, suspends sustained overload, then retries',()=>{
  const {look}=fixture({width:1440,height:900});
  look.update({dt:.035,frameMs:35});assert.equal(look.stats.occlusionEnabled,true,'one slow frame cannot change visual quality');
  for(let i=0;i<40;i++)look.update({dt:.035,frameMs:35});assert.equal(look.stats.occlusionEnabled,false);assert.ok(look.stats.aoCooldown>10);
  const cooldown=look.stats.aoCooldown;look.update({dt:.1,frameMs:100,paused:true});assert.equal(look.stats.aoCooldown,cooldown,'pause cannot consume the cooldown');
  for(let i=0;i<800;i++)look.update({dt:.016,frameMs:16});assert.equal(look.stats.occlusionEnabled,true,'the expensive pass gets a bounded later retry after recovery');look.dispose();
});
