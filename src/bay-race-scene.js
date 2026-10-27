import * as T from 'three';
import { groundedRootY } from './surfaces.js';
import {BOOST_PAD_CAPACITY} from './bay-race.js';
import {createFoliageGeometry} from './urban-nature.js';

const wrap = value => ((value % 1) + 1) % 1;
const roadWidth = 4.2;

/** Samples the same horizontal frame used by the race controller. */
export function raceFrame(curve, progress, lane = 0) {
  const t = wrap(progress), point = curve.getPointAt(t), tangent = curve.getTangentAt(t).normalize();
  const right = new T.Vector3(-tangent.z, 0, tangent.x).normalize();
  point.addScaledVector(right, lane);
  return { point, tangent, right, yaw: Math.atan2(tangent.x, tangent.z) };
}

/** Closed, indexed road strip. Offsets separate paint and asphalt without coplanar faces. */
export function circuitRibbon(curve, inner, outer, height = 0, segments = 720) {
  const positions = [], indices = [], uv = [];
  for (let i = 0; i <= segments; i++) {
    const frame = raceFrame(curve, i / segments);
    for (const side of [inner, outer]) {
      positions.push(frame.point.x + frame.right.x * side, frame.point.y + height, frame.point.z + frame.right.z * side);
      uv.push(side, i / segments * curve.getLength());
    }
    if (i < segments) {
      const j = i * 2;
      // Keep upward-facing normals on strips on either side of the centerline.
      if (outer > inner) indices.push(j, j + 1, j + 2, j + 1, j + 3, j + 2);
      else indices.push(j, j + 2, j + 1, j + 1, j + 2, j + 3);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

/** Bounded landscape pockets, kept clear of the racing surface and sign sightlines. */
export function circuitSceneryPlacements(curve) {
  const length = curve.getLength(), planters = [], lamps = [];
  const clear = progress => {
    const arc = Math.min(progress, 1 - progress) * length;
    return arc > 7 && !(curve.racePlaces || []).some(place => {
      const difference = Math.abs(progress - place.progress);
      return Math.min(difference, 1 - difference) * length < 2.8;
    });
  };
  const planterPairs = Math.min(32, Math.max(4, Math.floor(length / 16)));
  const lampPairs = Math.min(16, Math.max(3, Math.floor(length / 28)));
  for (let i = 0; i < planterPairs; i++) {
    const progress = (i + .5) / planterPairs; if (!clear(progress)) continue;
    for (const side of [-1, 1]) planters.push({ progress, lane: side * 6.45, radius: .98, type: 'planter' });
  }
  for (let i = 0; i < lampPairs; i++) {
    const progress = (i + .17) / lampPairs; if (!clear(progress)) continue;
    for (const side of [-1, 1]) lamps.push({ progress, lane: side * 6.35, radius: .86, type: 'lamp' });
  }
  return { planters, lamps };
}

/** Optional elevated circuit. Nothing is added to the normal portfolio view until enabled. */
export function createBayRaceScene({ scene, curve, createCar, reducedMotion = false }) {
  const root = new T.Group(); root.name = 'Bay Circuit'; root.visible = false; scene.add(root);
  const materials = new Set(), geometries = new Set(), textures = new Set();
  const material = (color, options = {}) => {
    const result = new T.MeshStandardMaterial({ color, roughness: .62, ...options }); materials.add(result); return result;
  };
  const asphalt = material('#273b45', { roughness: .87 }), concrete = material('#536c73', { roughness: .82, side: T.DoubleSide });
  const runoff = material('#256b70', { roughness: .56 }), white = material('#f0eedb', { roughness: .5 });
  const mint = material('#94e8ca', { emissive: '#3b927e', emissiveIntensity: .45 });
  const red = material('#c75d47'), dark = material('#10252d', { metalness: .5, roughness: .28 });
  const metal = material('#9bb6b8', { metalness: .8, roughness: .28 });
  const add = (geometry, mat, parent = root) => {
    geometries.add(geometry); const mesh = new T.Mesh(geometry, mat); mesh.castShadow = false; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  const box = (w, h, d, mat, parent = root) => add(new T.BoxGeometry(w, h, d), mat, parent);
  const ribbon = (inner, outer, offset, mat) => add(circuitRibbon(curve, inner, outer, offset), mat);
  // A structural deck below the racing surface, with generous clear runoff on either side.
  ribbon(-5.15, 5.15, -.48, concrete); ribbon(-5.05, 5.05, -.04, runoff);
  ribbon(-roadWidth, roadWidth, 0, asphalt);
  for (const side of [-1, 1]) {
    ribbon(side * 4.02, side * 4.08, .014, white);
    ribbon(side * 4.95, side * 5.02, .024, mint);
  }
  const length = curve.getLength(), segments = Math.ceil(length / .72), dummy = new T.Object3D();
  const buildInstances = (count, geometry, mat, pose, parent = root) => {
    geometries.add(geometry); const mesh = new T.InstancedMesh(geometry, mat, count);
    for (let i = 0; i < count; i++) { dummy.position.set(0, 0, 0); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); pose(i, dummy); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); }
    mesh.castShadow = false; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  // Alternating kerbs read clearly from a chase camera and show the safe steering boundary.
  for (let parity = 0; parity < 2; parity++) {
    const count = Math.ceil((segments - parity) / 2) * 2;
    buildInstances(count, new T.BoxGeometry(.32, .09, .73), parity ? white : red, (i, object) => {
      const t = (Math.floor(i / 2) * 2 + parity) / segments, side = i % 2 ? 1 : -1;
      const frame = raceFrame(curve, t, side * 4.37); object.position.copy(frame.point); object.position.y += .025; object.rotation.y = frame.yaw;
    });
  }
  // Steel guardrails, with repeating posts batched into one draw call.
  for (const side of [-1, 1]) {
    const points = Array.from({ length: 540 }, (_, i) => { const frame = raceFrame(curve, i / 540, side * 5.05); return frame.point.add(new T.Vector3(0, .45, 0)); });
    add(new T.TubeGeometry(new T.CatmullRomCurve3(points, true, 'centripetal'), 540, .055, 5, true), metal);
  }
  const postCount = Math.ceil(length / 2);
  buildInstances(postCount * 2, new T.BoxGeometry(.09, .58, .09), metal, (i, object) => {
    const frame = raceFrame(curve, Math.floor(i / 2) / postCount, (i % 2 ? 1 : -1) * 5.05); object.position.copy(frame.point); object.position.y += .2;
  });
  // A continuous fascia gives the skyway a solid silhouette from the Bay overview.
  for (const side of [-1, 1]) {
    const top = Array.from({ length: 721 }, (_, i) => raceFrame(curve, i / 720, side * 5.15).point);
    const positions = [], indices = [];
    for (let i = 0; i < top.length; i++) { const p = top[i]; positions.push(p.x, p.y - .04, p.z, p.x, p.y - .48, p.z); if (i < top.length - 1) { const j = i * 2; indices.push(j, j + 1, j + 2, j + 1, j + 3, j + 2); } }
    const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
    add(geometry, concrete);
  }
  const supports = Math.max(8, Math.ceil(length / 15));
  buildInstances(supports, new T.CylinderGeometry(.22, .42, 1, 8), concrete, (i, object) => {
    const frame = raceFrame(curve, (i + .4) / supports); const height = Math.max(.1, frame.point.y - .6); object.position.copy(frame.point); object.position.y = .6 + height / 2; object.scale.y = height;
  });
  const paintCount = Math.ceil(length / 3.5);
  buildInstances(paintCount * 2, new T.BoxGeometry(.055, .012, .72), white, (i, object) => {
    const frame = raceFrame(curve, Math.floor(i / 2) / paintCount, (i % 2 ? 1 : -1) * 1.4); object.position.copy(frame.point); object.position.y += .018; object.rotation.y = frame.yaw;
  });


  // Small terraces outside the guardrail give the skyway a planted, inhabited edge.
  // The whole landscape kit uses eleven instanced batches, independent of route length.
  const landscape = circuitSceneryPlacements(curve), pockets = [...landscape.planters, ...landscape.lamps];
  const foliage = material('#ffffff', { roughness: .9,vertexColors:true,side:T.DoubleSide }), soil = material('#303c32', { roughness: 1 });
  const bark = material('#6d6251', { roughness: .95 }), ceramic = material('#c0c3ad', { roughness: .85 });
  const solar = material('#183f52', { metalness: .68, roughness: .22 });
  const warmLamp = material('#fff3ca', { emissive: '#ffe7b2', emissiveIntensity: 2.1, roughness: .3 });
  const foliageTime = { value: 0 };
  function treeWind(mat,leaves=false){
    mat.onBeforeCompile=shader=>{
      shader.uniforms.uCircuitTime=foliageTime;shader.uniforms.uCircuitWind={value:reducedMotion?0:1};
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nuniform float uCircuitTime;uniform float uCircuitWind;attribute vec3 circuitRoot;');
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
        #ifdef USE_INSTANCING
        vec3 circuitPoint=(instanceMatrix*vec4(position,1.)).xyz;
        float height=clamp((circuitPoint.y-circuitRoot.y)/2.5,0.,1.);
        float phase=dot(circuitRoot.xz,vec2(.37,.29));
        float gust=sin(uCircuitTime*.85+phase)*.065+sin(uCircuitTime*1.4+phase*.7)*.018;
        vec3 wind=vec3(gust,0.,gust*.4)*pow(height,1.55)*uCircuitWind;
        ${leaves?'float flutter=sin(uCircuitTime*3.5+dot(position,vec3(11.,8.,13.))+phase)*.018*uCircuitWind;wind+=vec3(flutter,flutter*.2,flutter*.4);':''}
        transformed+=vec3(dot(wind,instanceMatrix[0].xyz)/max(.0001,dot(instanceMatrix[0].xyz,instanceMatrix[0].xyz)),dot(wind,instanceMatrix[1].xyz)/max(.0001,dot(instanceMatrix[1].xyz,instanceMatrix[1].xyz)),dot(wind,instanceMatrix[2].xyz)/max(.0001,dot(instanceMatrix[2].xyz,instanceMatrix[2].xyz)));
        #endif`);
    };mat.customProgramCacheKey=()=>`circuit-branched-wind-${leaves}-${reducedMotion}`;
  }
  treeWind(foliage,true);treeWind(bark);
  function treeRoots(batch,entries){
    const roots=[];for(const entry of entries){const frame=raceFrame(curve,entry.progress,entry.lane);roots.push(frame.point.x,frame.point.y+.4,frame.point.z);}
    batch.geometry.setAttribute('circuitRoot',new T.InstancedBufferAttribute(new Float32Array(roots),3));return batch;
  }
  const place = (entry, object, height = 0) => {
    const frame = raceFrame(curve, entry.progress, entry.lane);
    object.position.copy(frame.point); object.position.y += height; object.rotation.y = frame.yaw; return frame;
  };
  const sceneryBatch = (name, entries, geometry, mat, pose) => {
    const batch = buildInstances(entries.length, geometry, mat, (i, object) => pose(entries[i], object, i)); batch.name = name; return batch;
  };
  sceneryBatch('Skyway pocket platforms', pockets, new T.BoxGeometry(2.7, .2, 2.6), concrete, (entry, object) => { place(entry, object, -.14); if (entry.type === 'lamp') object.scale.x = .92; });
  sceneryBatch('Skyway planters', landscape.planters, new T.CylinderGeometry(.71, .61, .42, 12), ceramic, (entry, object) => place(entry, object, .19));
  sceneryBatch('Skyway soil', landscape.planters, new T.CylinderGeometry(.65, .65, .025, 12), soil, (entry, object) => place(entry, object, .405));
  treeRoots(sceneryBatch('Skyway tree trunks', landscape.planters, new T.CylinderGeometry(.055, .1, 1.45, 7), bark, (entry, object) => place(entry, object, 1.1)),landscape.planters);
  const branchEntries=landscape.planters.flatMap(entry=>[-1,1].map(side=>({...entry,side})));
  treeRoots(sceneryBatch('Skyway tree branches',branchEntries,new T.CylinderGeometry(.022,.055,1,6),bark,(entry,object)=>{const frame=place(entry,object,1.55),direction=new T.Vector3().copy(frame.right).multiplyScalar(entry.side*.43).add(new T.Vector3(0,.55,.12));object.position.addScaledVector(direction,.5);object.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),direction.clone().normalize());object.scale.y=direction.length();}),branchEntries);
  const crowns = landscape.planters.flatMap((entry, index) => [0, 1, 2].map(cluster => ({ ...entry, index, cluster })));
  const canopies = sceneryBatch('Skyway broadleaf canopies', crowns, createFoliageGeometry(), foliage, (entry, object) => {
    const frame = place(entry, object, [1.9, 2.32, 1.97][entry.cluster]);
    object.position.addScaledVector(frame.right, [-.24, .08, .27][entry.cluster]); object.position.addScaledVector(frame.tangent, [.1, -.12, .18][entry.cluster]);
    object.scale.set(.61, [.68, .72, .62][entry.cluster], .62);
    object.rotation.y += entry.index * 1.7;
  });
  treeRoots(canopies,crowns);
  const canopyColor = new T.Color(); crowns.forEach((entry, index) => canopies.setColorAt(index, canopyColor.setHSL(.25 + (entry.index % 5) * .014, .21 + entry.cluster * .025, .42 + (entry.index % 4) * .025)));
  sceneryBatch('Skyway solar lamp poles', landscape.lamps, new T.CylinderGeometry(.045, .065, 2.9, 7), metal, (entry, object) => place(entry, object, 1.42));
  sceneryBatch('Skyway solar lamp arms', landscape.lamps, new T.BoxGeometry(.09, .12, 1.05), metal, (entry, object) => { const frame = place(entry, object, 2.82); object.position.addScaledVector(frame.tangent, .33); });
  sceneryBatch('Skyway solar panel frames', landscape.lamps, new T.BoxGeometry(.8, .065, 1.2), metal, (entry, object) => { place(entry, object, 3.08); object.rotation.x = -.2; });
  sceneryBatch('Skyway solar panels', landscape.lamps, new T.BoxGeometry(.7, .02, 1.1), solar, (entry, object) => { place(entry, object, 3.13); object.rotation.x = -.2; });
  sceneryBatch('Skyway lamp lenses', landscape.lamps, new T.BoxGeometry(.2, .045, .48), warmLamp, (entry, object) => { const frame = place(entry, object, 2.75); object.position.addScaledVector(frame.tangent, .58); });
  root.userData.landscape = { planters: landscape.planters.length, trees: landscape.planters.length, lamps: landscape.lamps.length, branches:branchEntries.length,batches: 11 };

  function signTexture(title, subtitle = '', accent = '#94e8ca') {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 256;
    const context = canvas.getContext('2d'); context.fillStyle = '#10252d'; context.fillRect(0, 0, 1024, 256);
    context.strokeStyle = accent; context.lineWidth = 9; context.strokeRect(8, 8, 1008, 240);
    context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillStyle = '#f0eedb'; context.font = '700 78px sans-serif'; context.fillText(title, 512, subtitle ? 98 : 132, 950);
    if (subtitle) { context.fillStyle = accent; context.font = '500 36px sans-serif'; context.fillText(subtitle, 512, 187, 950); }
    const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace; texture.anisotropy = 4; textures.add(texture); return texture;
  }
  function sign(title, subtitle, width, parent, accent) {
    const texture = signTexture(title, subtitle, accent);
    const mat = new T.MeshBasicMaterial({ color: texture ? '#ffffff' : '#10252d', map: texture, side: T.DoubleSide }); materials.add(mat);
    return add(new T.PlaneGeometry(width, width / 4), mat, parent);
  }
  const gate = new T.Group(), start = raceFrame(curve, 0); gate.position.copy(start.point); gate.rotation.y = start.yaw; root.add(gate);
  for (const side of [-1, 1]) {
    const post = box(.32, 3.6, .45, dark, gate); post.position.set(side * 4.8, 1.55, 0);
    const light = box(.065, 3.1, .47, mint, gate); light.position.set(side * 4.8, 1.5, .01);
  }
  const beam = box(10, .85, .48, dark, gate); beam.position.set(0, 3.15, 0);
  const banner = sign('BAY CIRCUIT', 'THREE LAPS · ONE BAY', 7, gate); banner.position.set(0, 3.17, -.25); banner.rotation.y = Math.PI;
  for (let parity = 0; parity < 2; parity++) {
    buildInstances(24, new T.BoxGeometry(8.4 / 24, .016, .33), parity ? white : dark, (i, object) => {
      const row = Math.floor(i / 12), column = (i % 12) * 2 + ((parity + row) % 2);
      object.position.set(-4.2 + (column + .5) * 8.4 / 24, .024, (row - .5) * .33);
    }, gate);
  }
  const lamps = Array.from({ length: 3 }, (_, i) => {
    const mat = material('#3a4144', { emissive: '#ff493f', emissiveIntensity: 0 });
    const lamp = add(new T.SphereGeometry(.16, 12, 8), mat, gate); lamp.position.set((i - 1) * .55, 2.5, -.34); return lamp;
  });
  const places = curve.racePlaces || [];
  for (let i = 0; i < places.length; i++) {
    const place = places[i]; if (!Number.isFinite(place.progress)) continue;
    const frame = raceFrame(curve, place.progress, -6.1), group = new T.Group(); group.position.copy(frame.point); group.rotation.y = frame.yaw + Math.PI; root.add(group);
    const pole = box(.11, 1.8, .11, metal, group); pole.position.y = .8;
    const board = sign(place.name.toUpperCase(), 'BAY CIRCUIT  →', 3.8, group); board.position.y = 2;
  }
  // Each opponent uses the same measured tire geometry as the player.
  const colors = ['#f7b168', '#74c9f4', '#db9ae7'];
  const rivals = colors.map((color, index) => {
    const car = createCar(); car.name = `Circuit rival ${index + 1}`; car.scale.setScalar(.4);
    car.traverse(part => {
      if (!part.isMesh || Array.isArray(part.material)) return;
      const base = part.material;
      if (base.color?.getHexString() === '727f82') { part.material = base.clone(); part.material.color.set(color); part.material.metalness = .7; materials.add(part.material); }
    });
    root.add(car); const tag = sign(String(index + 2), '', .8, car, color); tag.position.set(0, 2.7, 0); tag.rotation.y = Math.PI;
    return car;
  });
  // Lane-specific pads share two instanced batches even as each race randomizes their layout.
  const padPlateMaterial=material('#11424e',{emissive:'#167e87',emissiveIntensity:.65,metalness:.45,roughness:.4});
  const padArrowMaterial=new T.MeshBasicMaterial({color:'#ffffff',toneMapped:false});materials.add(padArrowMaterial);
  const padPlates=buildInstances(BOOST_PAD_CAPACITY,new T.BoxGeometry(1.8,.035,2.8),padPlateMaterial,(_,object)=>object.position.set(0,-100,0));padPlates.name='Boost pad plates';padPlates.count=0;
  const arrowPositions=[],arrowIndices=[];
  for(const [a,b]of [[[-.6,-.23],[0,.23]],[[0,.23],[.6,-.23]]]){
    const dx=b[0]-a[0],dz=b[1]-a[1],scale=.07/Math.hypot(dx,dz),nx=-dz*scale,nz=dx*scale,j=arrowPositions.length/3;
    arrowPositions.push(a[0]+nx,0,a[1]+nz,a[0]-nx,0,a[1]-nz,b[0]+nx,0,b[1]+nz,b[0]-nx,0,b[1]-nz);arrowIndices.push(j,j+2,j+1,j+1,j+2,j+3);
  }
  const arrowGeometry=new T.BufferGeometry();arrowGeometry.setAttribute('position',new T.Float32BufferAttribute(arrowPositions,3));arrowGeometry.setIndex(arrowIndices);arrowGeometry.computeVertexNormals();
  const padArrows=buildInstances(BOOST_PAD_CAPACITY*3,arrowGeometry,padArrowMaterial,(_,object)=>object.position.set(0,-100,0));padArrows.name='Boost pad chevrons';padArrows.count=0;
  root.userData.boostPads={capacity:BOOST_PAD_CAPACITY,batches:2};
  const padColor=new T.Color();let padLayoutKey='';
  function updatePads(state,time){
    const pads=(state.pads||[]).slice(0,BOOST_PAD_CAPACITY),key=pads.map(p=>`${p.id}:${p.progress}:${p.lane}`).join('|');
    if(key!==padLayoutKey){
      padLayoutKey=key;padPlates.count=pads.length;padArrows.count=pads.length*3;
      pads.forEach((pad,i)=>{
        const frame=raceFrame(curve,pad.progress,pad.lane);dummy.position.copy(frame.point);dummy.position.y+=.03;dummy.rotation.set(0,frame.yaw,0);dummy.scale.set(1,1,1);dummy.updateMatrix();padPlates.setMatrixAt(i,dummy.matrix);
        for(let stripe=0;stripe<3;stripe++){dummy.position.copy(frame.point).addScaledVector(frame.tangent,(stripe-1)*.8);dummy.position.y+=.057;dummy.updateMatrix();padArrows.setMatrixAt(i*3+stripe,dummy.matrix);}
      });
      padPlates.instanceMatrix.needsUpdate=true;padArrows.instanceMatrix.needsUpdate=true;
    }
    pads.forEach((pad,i)=>{
      const hit=Number.isFinite(pad.lastTriggeredAt)&&state.elapsed-pad.lastTriggeredAt<.6;
      const pulse=reducedMotion?1:.82+Math.sin(time*4+i*.7)*.12;
      padColor.set(hit?'#ffe6a0':'#91ffe0').multiplyScalar(hit?1.7:pulse);
      for(let stripe=0;stripe<3;stripe++)padArrows.setColorAt(i*3+stripe,padColor);
    });
    if(pads.length)padArrows.instanceColor.needsUpdate=true;
  }

  // Fixed-size celebration pool, rendered only after a finish and disabled for reduced motion.
  const confetti = buildInstances(72, new T.BoxGeometry(.1, .035, .2), mint, (i, object) => { object.position.set(0, -100, 0); });
  confetti.visible = false;
  let visible = false, disposed = false, finishStarted = null;
  const color = new T.Color(); for (let i = 0; i < confetti.count; i++) confetti.setColorAt(i, color.set(colors[i % colors.length]));
  function update(state, time = 0) {
    if (!visible || disposed || !state) return;
    if (!reducedMotion) foliageTime.value = time;
    updatePads(state,time);
    for (let i = 0; i < rivals.length; i++) {
      const driver = state.rivals?.[i]; if (!driver) { rivals[i].visible = false; continue; }
      const car = rivals[i], frame = raceFrame(curve, driver.progress || 0, driver.lane || 0); car.visible = true; car.position.copy(frame.point);
      car.position.y = groundedRootY(frame.point.y, car.userData.wheelBottom || 0, .4); car.rotation.set(0, frame.yaw, 0);
      for (const wheel of car.userData.wheels || []) wheel.rotation.x = -Number(driver.distance || 0) / (.4 * (car.userData.wheelRadius || .445));
    }
    const count = state.countdown || 0;
    lamps.forEach((lamp, i) => { lamp.material.color.set(state.phase === 'racing' ? '#94e8ca' : count && i >= count - 1 ? '#ff493f' : '#3a4144'); lamp.material.emissive.set(state.phase === 'racing' ? '#59ffbf' : '#ff493f'); lamp.material.emissiveIntensity = state.phase === 'racing' || (count && i >= count - 1) ? 2.2 : 0; });
    if (state.phase === 'finished' && !reducedMotion) {
      if (finishStarted === null) finishStarted = time;
      const elapsed = time - finishStarted; confetti.visible = elapsed < 5;
      const frame = raceFrame(curve, state.player?.progress || 0);
      for (let i = 0; i < confetti.count; i++) {
        const age = (elapsed + i * .027) % 2.7, phase = i * 2.399;
        dummy.position.set(frame.point.x + Math.cos(phase) * (1 + age * 1.6), frame.point.y + 2.8 + Math.sin(age * Math.PI / 2.7) * 2.5 - age * .7, frame.point.z + Math.sin(phase) * (1 + age * 1.6));
        dummy.rotation.set(age * (i % 4 + 1), phase, age * 2); dummy.scale.setScalar(1); dummy.updateMatrix(); confetti.setMatrixAt(i, dummy.matrix);
      }
      confetti.instanceMatrix.needsUpdate = true;
    } else { finishStarted = null; confetti.visible = false; }
  }
  return {
    root, rivals, roadWidth,
    setVisible(active) { visible = Boolean(active); root.visible = visible; if (!visible) { finishStarted = null; confetti.visible = false; } },
    update,
    dispose() {
      if (disposed) return; disposed = true; root.removeFromParent();
      // createCar shares its original materials with the portfolio car; dispose only local clones.
      root.traverse(object => { if (object.geometry) geometries.add(object.geometry); });
      geometries.forEach(geometry => geometry.dispose()); materials.forEach(mat => mat.dispose()); textures.forEach(texture => texture.dispose());
    },
  };
}
