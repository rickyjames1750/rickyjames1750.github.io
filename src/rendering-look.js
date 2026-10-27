import * as T from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

// The official Sky/GTAOPass/ShaderPass are distributed with Three.js under MIT.
// Procedural surface data and the finishing shader below are original, asset-free work.
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
function randomSequence(seed){let state=seed;return ()=>((state=Math.imul(state,1664525)+1013904223)>>>0)/4294967296;}
function onceDispose(resource,extra=()=>{}){const original=resource.dispose.bind(resource);let done=false;resource.dispose=()=>{if(done)return;done=true;original();extra();};return resource;}

/** Packed linear data: R aggregate albedo, G micro-height, B material roughness. */
export function createSurfaceDetailTexture(size=256){
  size=2**Math.round(Math.log2(clamp(Number(size)||256,32,512)));
  const data=new Uint8Array(size*size*4),random=randomSequence(1978501);
  for(let z=0;z<size;z++)for(let x=0;x<size;x++){
    const grain=random(),stone=random(),broad=.5+.25*Math.sin(x/size*Math.PI*8)*Math.cos(z/size*Math.PI*6),i=(z*size+x)*4;
    const aggregate=grain>.93?.82:grain<.1?.24:.43+grain*.24;
    data[i]=Math.round(clamp(aggregate*.86+broad*.14,0,1)*255);
    data[i+1]=Math.round((.29+grain*.36+(stone>.97?.16:0))*255);
    data[i+2]=Math.round((.56+grain*.32)*255);data[i+3]=255;
  }
  const texture=new T.DataTexture(data,size,size,T.RGBAFormat,T.UnsignedByteType);texture.name='Original asphalt aggregate and concrete grain';texture.colorSpace=T.NoColorSpace;
  texture.wrapS=texture.wrapT=T.RepeatWrapping;texture.minFilter=T.LinearMipmapLinearFilter;texture.magFilter=T.LinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;return texture;
}

function applySurfaceDetail(material,texture,{kind='asphalt',scale=2.4,height=.0012}={}){
  const uniforms={uSurfaceDetail:{value:texture},uSurfaceScale:{value:scale},uSurfaceHeight:{value:height}};
  material.userData.surfaceUniforms=uniforms;
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vSurfaceWorld;')
      .replace('#include <begin_vertex>',`#include <begin_vertex>\nvec4 surfacePosition=vec4(transformed,1.);\n#ifdef USE_INSTANCING\nsurfacePosition=instanceMatrix*surfacePosition;\n#endif\nvSurfaceWorld=(modelMatrix*surfacePosition).xyz;`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nvarying vec3 vSurfaceWorld;uniform sampler2D uSurfaceDetail;uniform float uSurfaceScale,uSurfaceHeight;`)
      .replace('#include <color_fragment>',`#include <color_fragment>\nvec3 surfaceTexel=texture2D(uSurfaceDetail,vSurfaceWorld.xz*uSurfaceScale).rgb;\nfloat surfacePatina=texture2D(uSurfaceDetail,vSurfaceWorld.xz*.071+vec2(.37,.19)).r;\ndiffuseColor.rgb*= ${kind==='concrete'?'(.88+surfaceTexel.r*.23)*(.95+surfacePatina*.09)':'(.65+surfaceTexel.r*.68)*(.91+surfacePatina*.18)'};`)
      .replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>\nroughnessFactor=clamp(roughnessFactor+(surfaceTexel.b-.7)*.23,.55,.99);`)
      .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>\n// Screen derivatives keep the grain attached to ramps and avoid UV seams.\nfloat surfaceHeight=surfaceTexel.g*uSurfaceHeight;\nvec3 surfaceDx=dFdx(-vViewPosition),surfaceDy=dFdy(-vViewPosition);\nvec3 surfaceR1=cross(surfaceDy,normal),surfaceR2=cross(normal,surfaceDx);\nfloat surfaceDet=dot(surfaceDx,surfaceR1)*faceDirection;\nvec3 surfaceGradient=sign(surfaceDet)*(dFdx(surfaceHeight)*surfaceR1+dFdy(surfaceHeight)*surfaceR2);\nnormal=normalize(max(abs(surfaceDet),1.e-10)*normal-surfaceGradient);`);
  };material.customProgramCacheKey=()=>`bay-physical-${kind}-v1`;
}

/** Reusable materials work on existing ribbons without UVs or extra geometry. */
export function createSurfaceMaterials({textureSize=256}={}){
  const texture=createSurfaceDetailTexture(textureSize);
  const roadMaterial=new T.MeshStandardMaterial({name:'Weathered Bay Area asphalt',color:'#55585a',roughness:.9,metalness:0,side:T.DoubleSide,shadowSide:T.FrontSide});
  const concreteMaterial=new T.MeshStandardMaterial({name:'Fine warm concrete',color:'#a0a199',roughness:.88,metalness:0,side:T.DoubleSide});
  const paintMaterial=new T.MeshStandardMaterial({name:'Mineral road marking paint',color:'#e4dfc8',roughness:.78,metalness:0});
  applySurfaceDetail(roadMaterial,texture);applySurfaceDetail(concreteMaterial,texture,{kind:'concrete',scale:1.7,height:.00055});
  let disposed=false;return {roadMaterial,concreteMaterial,paintMaterial,texture,dispose(){if(disposed)return;disposed=true;texture.dispose();roadMaterial.dispose();concreteMaterial.dispose();paintMaterial.dispose();}};
}

export function createCinematicGrade(){
  return onceDispose(new ShaderPass({name:'Restrained coastal photographic finish',uniforms:{tDiffuse:{value:null},uSaturation:{value:.96},uContrast:{value:1.065},uWarmth:{value:.018},uVignette:{value:.035}},
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:`uniform sampler2D tDiffuse;uniform float uSaturation,uContrast,uWarmth,uVignette;varying vec2 vUv;
    void main(){vec4 source=texture2D(tDiffuse,vUv);vec3 color=max(source.rgb,vec3(0.));float luma=dot(color,vec3(.2126,.7152,.0722));
    color=mix(vec3(luma),color,uSaturation);color=max((color-.18)*uContrast+.18,vec3(0.));
    vec3 balance=mix(vec3(.995,1.002,1.009),vec3(1.+uWarmth,1.+uWarmth*.3,1.-uWarmth*.65),smoothstep(.08,.85,luma));
    color*=balance;vec2 q=(vUv-.5)*2.;color*=1.-uVignette*smoothstep(.3,1.65,dot(q,q));gl_FragColor=vec4(color,source.a);}`
  }));
}

function createOcclusion(scene,camera,excluded){
  const pass=new GTAOPass(scene,camera,512,320,undefined,{radius:.65,thickness:.35,distanceExponent:1.25,distanceFallOff:1,scale:1,samples:8,screenSpaceRadius:false},{samples:8,rings:2,radius:3,lumaPhi:8,depthPhi:2,normalPhi:3});
  pass.name='Subtle half-resolution ground contact';pass.blendIntensity=.32;pass.output=GTAOPass.OUTPUT.Default;
  const fullSize=pass.setSize.bind(pass);pass.setSize=(w,h)=>fullSize(Math.max(1,Math.round(w*.5)),Math.max(1,Math.round(h*.5)));
  const originalRender=pass.render.bind(pass),states=[];
  pass.render=(...args)=>{
    states.length=0;
    // The sky and transparent visual effects have no solid surface in the AO G-buffer.
    scene.traverse(o=>{if(o.isMesh&&(excluded.has(o)||o.material?.transparent||Array.isArray(o.material)&&o.material.some(m=>m.transparent))){states.push([o,o.visible]);o.visible=false;}});
    try{return originalRender(...args);}finally{for(const [o,visible] of states)o.visible=visible;states.length=0;}
  };
  // r180's stock disposal omits these two materials; release them as well.
  return onceDispose(pass,()=>{pass.gtaoMaterial.dispose();pass.blendMaterial.dispose();});
}

/**
 * Scene rendering only: does not alter geometry, driving, collision, camera pose or UI.
 * Add occlusionPass after RenderPass, gradePass before OutputPass. ECO can render directly.
 * update({target:car.position,dt,paused}) stabilizes one existing sun shadow region.
 */
export function createRenderingLook({renderer,scene,camera,sun,hemi,rim,bloom,day=true,quality='high',enableAO=true,environment=true,textureSize=256,width=1200,height=800,environmentURL=null,environmentLoader=null,onEnvironmentError=()=>{},aoFrameBudget=24}={}){
  if(!renderer||!scene?.add||!camera?.isCamera)throw new TypeError('Rendering look requires renderer, scene and camera.');
  const previous={background:scene.background,fog:scene.fog,environment:scene.environment,environmentIntensity:scene.environmentIntensity,toneMapping:renderer.toneMapping,exposure:renderer.toneMappingExposure,outputColorSpace:renderer.outputColorSpace,environmentRotation:scene.environmentRotation.clone()};
  renderer.toneMapping=T.AgXToneMapping;renderer.outputColorSpace=T.SRGBColorSpace;
  const root=new T.Group();root.name='Analytic coastal atmosphere';scene.add(root);
  const sky=new Sky();sky.name='Physical daylight scattering sky';sky.scale.setScalar(2000);sky.frustumCulled=false;sky.renderOrder=-1000;sky.castShadow=false;sky.receiveShadow=false;sky.material.fog=false;root.add(sky);
  const surfaces=createSurfaceMaterials({textureSize}),gradePass=createCinematicGrade(),occlusionPass=enableAO?createOcclusion(scene,camera,new Set([sky])):null;
  const environmentScene=new T.Scene(),environmentSky=sky.clone();environmentSky.position.set(0,0,0);environmentSky.material=sky.material.clone();
  // Suppress only the tiny solar disc in the reflection convolution to avoid hot pixels.
  environmentSky.material.fragmentShader=environmentSky.material.fragmentShader.replace(/float sundisk = [^;]+;/,'float sundisk = 0.0;');environmentSky.material.needsUpdate=true;environmentScene.add(environmentSky);
  const environmentTargets=new Map();let pmrem=null,disposed=false,currentDay=Boolean(day),currentQuality=quality==='eco'?'eco':'high',viewportWidth=width,viewportHeight=height,highView=false,clock=0;
  let hdrTexture=null,environmentRequest=0,environmentStatus='procedural',readyPromise=Promise.resolve(false),aoSlowTime=0,aoCooldown=0,frameAverage=16.7;
  const sunDirection=new T.Vector3(),center=new T.Vector3(),sunOffset=new T.Vector3();
  const ownedLights=[];
  if(!sun){sun=new T.DirectionalLight();sun.castShadow=true;scene.add(sun);ownedLights.push(sun);scene.add(sun.target);ownedLights.push(sun.target);}
  if(!hemi){hemi=new T.HemisphereLight();scene.add(hemi);ownedLights.push(hemi);}
  if(!rim){rim=new T.DirectionalLight();scene.add(rim);ownedLights.push(rim);}
  if(!sun.target.parent)scene.add(sun.target);
  function refreshEnvironment(){
    if(hdrTexture){scene.environment=hdrTexture;return;}
    if(!environment||!renderer.isWebGLRenderer){scene.environment=previous.environment;return;}
    const key=currentDay?'day':'late';if(!environmentTargets.has(key)){
      if(!pmrem)pmrem=new T.PMREMGenerator(renderer);
      const target=pmrem.fromScene(environmentScene,.025,.1,3000,{size:128});environmentTargets.set(key,target);
    }
    scene.environment=environmentTargets.get(key).texture;
  }
  function refreshPass(){if(occlusionPass)occlusionPass.enabled=currentQuality==='high'&&viewportWidth>=1000&&viewportHeight>=500&&!highView&&aoCooldown<=0;}
  function setDay(value){
    if(disposed)return currentDay;currentDay=Boolean(value);const daylight=currentDay;
    renderer.toneMappingExposure=daylight?.96:.94;
    sunDirection.set(daylight?-.61:-.73,daylight?.69:.27,daylight?-.39:-.63).normalize();sunOffset.copy(sunDirection).multiplyScalar(180);
    sun.color.set(daylight?'#fff1dc':'#ffdbb6');sun.intensity=daylight?3.15:2.2;
    hemi.color.set(daylight?'#c8dcec':'#a5b5cf');hemi.groundColor.set(daylight?'#6e745f':'#4e5354');hemi.intensity=daylight?.64:.58;
    rim.color.set('#e0edf2');rim.intensity=daylight?.13:.18;rim.position.set(65,70,45);
    scene.environmentIntensity=hdrTexture?(daylight?.95:.82):(daylight?.64:.58);
    const fogColor=daylight?'#b3c5ca':'#8b9ca7';scene.fog=new T.FogExp2(fogColor,daylight?.0028:.0038);scene.background=new T.Color(fogColor);
    for(const dome of [sky,environmentSky]){const u=dome.material.uniforms;u.turbidity.value=daylight?3.2:5;u.rayleigh.value=daylight?1.45:1.8;u.mieCoefficient.value=.004;u.mieDirectionalG.value=.78;u.sunPosition.value.copy(sunDirection).multiplyScalar(1000);}
    gradePass.uniforms.uWarmth.value=daylight?.015:.028;gradePass.uniforms.uSaturation.value=daylight?.97:.94;
    if(bloom){bloom.strength=daylight?.085:.16;bloom.radius=.22;bloom.threshold=daylight?2.2:1.8;}
    sun.position.copy(center).add(sunOffset);sun.target.position.copy(center);sun.target.updateMatrixWorld();
    refreshEnvironment();if(renderer.shadowMap)renderer.shadowMap.needsUpdate=true;return currentDay;
  }
  /** Owns the loaded texture. Relative URLs keep the HDR asset self-hosted on Pages.
   * Three.js automatically convolves equirectangular environments for PBR materials.
   * Every promise resolves to a boolean; failed or stale requests cannot replace the sky.
   */
  function setEnvironmentMap(source,{rotation=0}={}){
    const request=++environmentRequest;if(disposed)return Promise.resolve(false);
    if(!source){hdrTexture?.dispose();hdrTexture=null;environmentStatus='procedural';scene.environmentRotation.copy(previous.environmentRotation);refreshEnvironment();setDay(currentDay);readyPromise=Promise.resolve(true);return readyPromise;}
    environmentStatus='loading';
    readyPromise=(async()=>{
      let texture;
      try{
        texture=source.isTexture?source:await (environmentLoader||new HDRLoader()).loadAsync(source);
        if(disposed||request!==environmentRequest){texture?.dispose();return false;}
        if(!texture?.isTexture)throw new TypeError('HDR environment loader did not return a texture.');
        texture.mapping=T.EquirectangularReflectionMapping;
        const prior=hdrTexture;hdrTexture=texture;scene.environment=texture;scene.environmentRotation.y=Number(rotation)||0;environmentStatus='hdr';
        if(prior&&prior!==texture)prior.dispose();setDay(currentDay);return true;
      }catch(error){
        if(texture&&texture!==hdrTexture)texture.dispose();
        if(disposed||request!==environmentRequest)return false;
        environmentStatus=hdrTexture?'hdr':'error';
        try{onEnvironmentError(error,source);}catch{/* UI observers cannot reject a safe fallback. */}
        refreshEnvironment();return false;
      }
    })();return readyPromise;
  }
  function resize(w,h,pixelRatio=renderer.getPixelRatio?.()||1){
    if(disposed)return;viewportWidth=Math.max(1,Number(w)||1);viewportHeight=Math.max(1,Number(h)||1);
    occlusionPass?.setSize(viewportWidth*pixelRatio,viewportHeight*pixelRatio);refreshPass();
  }
  function setQuality(value){if(disposed)return;currentQuality=value==='eco'?'eco':'high';refreshPass();}
  function update({dt=0,frameMs,paused=false,target,quality:nextQuality=currentQuality}={}){
    if(disposed)return;if(nextQuality!==currentQuality)setQuality(nextQuality);if(!paused)clock+=clamp(Number(dt)||0,0,.1);
    if(!paused&&Number.isFinite(frameMs)&&frameMs>=5&&frameMs<=150){
      const elapsed=frameMs/1000;aoCooldown=Math.max(0,aoCooldown-elapsed);
      frameAverage+=(frameMs-frameAverage)*(1-Math.exp(-elapsed/.16));
      if(aoCooldown===0&&occlusionPass?.enabled){
        aoSlowTime=frameAverage>aoFrameBudget?aoSlowTime+elapsed:Math.max(0,aoSlowTime-elapsed*2);
        if(aoSlowTime>=.7){aoCooldown=12;aoSlowTime=0;}
      }
    }
    sky.position.copy(camera.position);sky.updateMatrixWorld();highView=camera.position.y>85;refreshPass();
    // A fixed world direction with texel-sized translations avoids swimming shadow edges.
    if(target&&[target.x,target.y,target.z].every(Number.isFinite)){
      const halfExtent=highView?110:34,mapSize=sun.shadow.mapSize.x||2048,texel=halfExtent*2/mapSize;
      center.set(Math.round(target.x/texel)*texel,Math.round(target.y/texel)*texel,Math.round(target.z/texel)*texel);
      sun.position.copy(center).add(sunOffset);sun.target.position.copy(center);sun.target.updateMatrixWorld();
      const shadowCamera=sun.shadow.camera;
      if(shadowCamera.right!==halfExtent){Object.assign(shadowCamera,{left:-halfExtent,right:halfExtent,top:halfExtent,bottom:-halfExtent,near:10,far:380});shadowCamera.updateProjectionMatrix();if(renderer.shadowMap)renderer.shadowMap.needsUpdate=true;}
    }
  }
  sun.shadow.bias=-.00015;sun.shadow.normalBias=.018;sun.shadow.radius=2;
  setDay(currentDay);resize(width,height);if(environmentURL)setEnvironmentMap(environmentURL);
  function dispose(){
    if(disposed)return;disposed=true;environmentRequest++;hdrTexture?.dispose();hdrTexture=null;root.removeFromParent();surfaces.dispose();gradePass.dispose();occlusionPass?.dispose();sky.geometry.dispose();sky.material.dispose();environmentSky.material.dispose();
    for(const target of environmentTargets.values())target.dispose();pmrem?.dispose();for(const light of ownedLights){light.removeFromParent();light.dispose?.();}
    scene.background=previous.background;scene.fog=previous.fog;scene.environment=previous.environment;scene.environmentIntensity=previous.environmentIntensity;scene.environmentRotation.copy(previous.environmentRotation);renderer.toneMapping=previous.toneMapping;renderer.toneMappingExposure=previous.exposure;renderer.outputColorSpace=previous.outputColorSpace;
  }
  return {root,sky,...surfaces,gradePass,occlusionPass,setDay,setQuality,setEnvironmentMap,resize,update,dispose,get ready(){return readyPromise;},get stats(){return {day:currentDay,quality:currentQuality,occlusionEnabled:Boolean(occlusionPass?.enabled),occlusionWidth:occlusionPass?.width||0,occlusionHeight:occlusionPass?.height||0,surfaceTextureBytes:surfaces.texture.image.data.byteLength,environmentMaps:environmentTargets.size+(hdrTexture?1:0),environmentStatus,aoCooldown,frameAverage,animationTime:clock};}};
}
