import {
  AdditiveBlending, BoxGeometry, Color, DynamicDrawUsage, Group, IcosahedronGeometry, InstancedBufferAttribute, InstancedMesh,
  MeshBasicMaterial, MeshStandardMaterial, Object3D, OctahedronGeometry, TorusGeometry, Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const SPACING = 8.5, RESPAWN_SECONDS = 16, HIT_RADIUS = 1.05;
const CAPACITY = Object.freeze({shards: 256, sparks: 192, rings: 20, fireballs: 64, smoke: 96});
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finitePosition = point => point && [point.x, point.y, point.z].every(Number.isFinite);

/** Swept contact includes elevation: a bridge pickup cannot burst from the road below it. */
export function sweptPodContact(from, to, pod, radius = HIT_RADIUS, heightTolerance = 1.15) {
  if (![from, to, pod].every(finitePosition)) return false;
  const dx = to.x - from.x, dz = to.z - from.z, lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared ? clamp(((pod.x - from.x) * dx + (pod.z - from.z) * dz) / lengthSquared, 0, 1) : 0;
  return Math.hypot(from.x + dx * t - pod.x, from.z + dz * t - pod.z) <= radius
    && Math.abs(from.y + (to.y - from.y) * t - pod.y) <= heightTolerance;
}

/** Arc-length placement follows the actual drivable curves, including their elevated ramps. */
export function energyPodPlacements({roadCurve, bridgeDrive, sampleHeight} = {}) {
  const placements = [];
  for (const [route, curve, maximum] of [['road', roadCurve, 44], ['bridge', bridgeDrive?.curve, 16]]) {
    if (!curve?.getPointAt || !Number.isFinite(curve.getLength())) continue;
    const length = curve.getLength();
    if (length < 8) continue;
    const count = Math.min(maximum, Math.max(1, Math.floor((length - 6) / SPACING)));
    for (let i = 0; i < count; i++) {
      const t = (4 + i * (length - 8) / Math.max(1, count - 1)) / length;
      const position = curve.getPointAt(t), tangent = curve.getTangentAt(t);
      const horizontal = Math.hypot(tangent.x, tangent.z) || 1, offset = i % 2 ? -.28 : .28;
      position.x -= tangent.z / horizontal * offset;position.z += tangent.x / horizontal * offset;
      const sampled = sampleHeight?.(position.x, position.z), height = typeof sampled === 'number' ? sampled : sampled?.height;
      if (Number.isFinite(height)) position.y = height;
      if (!finitePosition(position) || placements.some(p => Math.hypot(p.position.x - position.x, p.position.z - position.z) < 3)) continue;
      placements.push({position, route, t, yaw: Math.atan2(tangent.x, tangent.z)});
    }
  }
  return placements;
}

function mergedBoxes(specs) {
  const boxes = specs.map(([w, h, d, x = 0, y = 0, z = 0]) => {const g = new BoxGeometry(w, h, d);g.translate(x, y, z);return g;});
  const geometry = mergeGeometries(boxes);boxes.forEach(box => box.dispose());return geometry;
}

function crateHardware() {
  const specs = [[.72, .024, .72, 0, .405, 0]];
  for (const x of [-.455, .455]) for (const z of [-.455, .455]) {
    specs.push([.064, .86, .064, x, 0, z]);
    for (const y of [-.345, .345]) specs.push([.145, .145, .145, x * .91, y, z * .91]);
  }
  for (const y of [-.41, .41]) for (const side of [-1, 1]) {
    specs.push([.93, .062, .062, 0, y, side * .455], [.062, .062, .93, side * .455, y, 0]);
  }
  for (const x of [-.31, .31]) specs.push([.15, .11, .85, x, -.455, 0]);
  return mergedBoxes(specs);
}

function crateSeams() {
  const specs = [];
  for (const side of [-1, 1]) {
    for (const y of [-.18, .18]) specs.push([.73, .013, .012, 0, y, side * .456], [.012, .013, .73, side * .456, y, 0]);
    for (const x of [-.27, .27]) specs.push([.013, .6, .012, x, 0, side * .456], [.012, .6, .013, side * .456, 0, x]);
    specs.push([.16, .055, .016, 0, -.02, side * .458]);
  }
  return mergedBoxes(specs);
}

function crateStrips() {
  const specs = [];
  for (const side of [-1, 1]) specs.push([.28, .025, .012, 0, .275, side * .466], [.012, .025, .28, side * .466, .275, 0]);
  return mergedBoxes(specs);
}

/** Per-instance opacity lets smoke dissipate without turning into opaque black balls. */
function cloudMaterial(geometry, capacity, time, kind) {
  geometry.setAttribute('burstOpacity', new InstancedBufferAttribute(new Float32Array(capacity), 1));
  const fire = kind === 'fire';
  const material = new MeshBasicMaterial({color: '#ffffff', transparent: true, opacity: 1, depthWrite: false, toneMapped: false, ...(fire ? {blending: AdditiveBlending} : {})});
  material.onBeforeCompile = shader => {
    shader.uniforms.uBurstTime = time;
    shader.vertexShader = `uniform float uBurstTime;attribute float burstOpacity;varying float vBurstOpacity;varying vec3 vCloudNormal;varying vec3 vCloudView;varying vec3 vCloudLocal;varying float vCloudPhase;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vBurstOpacity=burstOpacity;
      float phase=instanceMatrix[3].x*.71+instanceMatrix[3].z*.43;
      vCloudLocal=position;vCloudPhase=phase;
      float wobble=sin(position.x*7.+uBurstTime*${fire ? '10.' : '1.7'}+phase)*sin(position.y*9.-uBurstTime*${fire ? '8.' : '1.3'}+phase)*sin(position.z*8.+phase);
      transformed*=1.+wobble*${fire ? '.27' : '.1'};
      ${fire ? `float crown=pow(max(position.y,0.),1.4);
      float tongue=pow(max(0.,sin(atan(position.z+.00001,position.x+.00001)*5.+uBurstTime*9.+phase)),2.);
      transformed.y+=crown*(.15+tongue*.6);transformed.xz*=1.-crown*.12;` : ''}
      vCloudNormal=normalize(normalMatrix*mat3(instanceMatrix)*normal);`);
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nvCloudView=-mvPosition.xyz;');
    const turbulence = fire ? `
      float burstHash(vec3 p){p=fract(p*.3183099+vec3(.11,.23,.37));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
      float burstNoise(vec3 p){
        vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
        return mix(mix(mix(burstHash(i),burstHash(i+vec3(1.,0.,0.)),f.x),mix(burstHash(i+vec3(0.,1.,0.)),burstHash(i+vec3(1.,1.,0.)),f.x),f.y),mix(mix(burstHash(i+vec3(0.,0.,1.)),burstHash(i+vec3(1.,0.,1.)),f.x),mix(burstHash(i+vec3(0.,1.,1.)),burstHash(i+vec3(1.,1.,1.)),f.x),f.y),f.z);
      }
      float burstFbm(vec3 p){return burstNoise(p)*.55+burstNoise(p*2.07+vec3(2.3,1.7,.9))*.29+burstNoise(p*4.15+vec3(4.1,.3,2.7))*.16;}
    ` : '';
    shader.fragmentShader = `uniform float uBurstTime;varying float vBurstOpacity;varying vec3 vCloudNormal;varying vec3 vCloudView;varying vec3 vCloudLocal;varying float vCloudPhase;${turbulence}\n${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float facing=abs(dot(normalize(vCloudNormal),normalize(vCloudView)));
      ${fire ? `
      vec3 flow=vCloudLocal*3.7+vec3(vCloudPhase*.31,-uBurstTime*2.8,vCloudPhase*.17);
      flow.xz+=vec2(sin(vCloudLocal.y*5.+uBurstTime*3.),cos(vCloudLocal.y*4.-uBurstTime*2.6))*.35;
      float turbulence=burstFbm(flow),fine=burstNoise(flow*2.6+uBurstTime*1.3);
      float density=smoothstep(.28,.64,turbulence+fine*.12);
      float feather=smoothstep(.035,.62,facing+(turbulence-.5)*.9);
      float coreHeat=clamp(diffuseColor.g/max(.01,diffuseColor.r),0.,1.);
      float heat=clamp(turbulence*.8+facing*.1+coreHeat*.16,0.,1.);
      vec3 flame=mix(vec3(.85,.035,.002),vec3(1.85,.24,.008),smoothstep(.22,.53,heat));
      flame=mix(flame,vec3(2.15,1.15,.095),smoothstep(.53,.8,heat));
      flame=mix(flame,vec3(2.3,1.75,.45),smoothstep(.85,.98,heat)*smoothstep(.6,.9,fine));
      diffuseColor.rgb=flame*(.83+fine*.3);
      diffuseColor.a*=vBurstOpacity*feather*density;
      ` : 'float feather=pow(facing,.8);diffuseColor.a*=vBurstOpacity*feather;'}
      `);
  };
  material.customProgramCacheKey = () => `bayward-burst-${kind}-v2`;
  return material;
}

/**
 * Solid sci-fi cargo crates with a bounded arcade explosion. They do not stop the car.
 * Paused time never advances effects or the 16-active-second respawn.
 * onBurst is aggregated once per update: count=this sweep, total=since reset.
 */
export function createPlayground({scene, roadCurve, bridgeDrive, sampleHeight, reducedMotion = false, onBurst = () => {}} = {}) {
  if (!scene?.add) throw new TypeError('createPlayground requires a Three.js scene.');
  const root = new Group();root.name = 'Metal cargo playground';scene.add(root);
  const placements = energyPodPlacements({roadCurve, bridgeDrive, sampleHeight});
  const pods = placements.map((placement, index) => ({...placement, cooldown: 0, phase: index * 1.73}));
  const dummy = new Object3D(), color = new Color(), zero = new Vector3(), time = {value: 0};
  const steel = new Color('#a3b4bd'), scorched = new Color('#6a5041'), gold = new Color('#ffd26c');
  const yellow = new Color('#fff1a8'), orange = new Color('#ff751c'), red = new Color('#a62e0a');
  const resources = [], meshes = [];
  function batch(name, geometry, material, count) {
    resources.push(geometry, material);
    const mesh = new InstancedMesh(geometry, material, Math.max(1, count));mesh.name = name;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);mesh.frustumCulled = false;mesh.count = count;
    mesh.castShadow = false;mesh.receiveShadow = false;root.add(mesh);meshes.push(mesh);
    color.set('#ffffff');for (let i = 0; i < count; i++) mesh.setColorAt(i, color);
    return mesh;
  }
  const shell = batch('Solid metallic cargo shells', new BoxGeometry(.9, .78, .9), new MeshStandardMaterial({color: '#4e6573', metalness: .93, roughness: .28}), pods.length);
  const hardware = batch('Cargo reinforced corners and lids', crateHardware(), new MeshStandardMaterial({color: '#a3b4bf', metalness: .96, roughness: .23}), pods.length);
  const seams = batch('Cargo panel seams', crateSeams(), new MeshStandardMaterial({color: '#172831', metalness: .8, roughness: .42}), pods.length);
  const strips = batch('Cargo amber status strips', crateStrips(), new MeshStandardMaterial({color: '#ffbe63', emissive: '#ffa13d', emissiveIntensity: .65, metalness: .5, roughness: .28}), pods.length);
  const shardMesh = batch('Pooled metal debris', new BoxGeometry(1, 1, 1), new MeshStandardMaterial({color: '#ffffff', metalness: .96, roughness: .25}), CAPACITY.shards);
  const sparkMesh = batch('Pooled explosion embers', new OctahedronGeometry(1), new MeshBasicMaterial({color: '#ffffff', transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false}), CAPACITY.sparks);
  const ringGeometry = new TorusGeometry(1, .025, 4, 40);ringGeometry.rotateX(-Math.PI / 2);
  const ringMesh = batch('Pooled blast shock rings', ringGeometry, new MeshBasicMaterial({color: '#ffffff', transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false}), CAPACITY.rings);
  const fireGeometry = new IcosahedronGeometry(1, 2), smokeGeometry = new IcosahedronGeometry(1, 1);
  const fireMesh = batch('Pooled orange yellow fireballs', fireGeometry, cloudMaterial(fireGeometry, CAPACITY.fireballs, time, 'fire'), CAPACITY.fireballs);
  const smokeMesh = batch('Pooled rising explosion smoke', smokeGeometry, cloudMaterial(smokeGeometry, CAPACITY.smoke, time, 'smoke'), CAPACITY.smoke);
  const makePool = count => Array.from({length: count}, () => ({life: 0, duration: 0, delay: 0, position: new Vector3(), origin: new Vector3(), velocity: new Vector3(), spin: 0, rotation: 0, size: 0, tint: steel.clone()}));
  const shards = makePool(CAPACITY.shards), sparks = makePool(CAPACITY.sparks), rings = makePool(CAPACITY.rings), fireballs = makePool(CAPACITY.fireballs), smoke = makePool(CAPACITY.smoke);
  const cursors = {shard: 0, spark: 0, fire: 0, smoke: 0};
  let ringCursor = 0, elapsed = 0, total = 0, disposed = false, previous = null, effectsDirty = false;
  let activeShards = 0, activeSparks = 0, activeRings = 0, activeFireballs = 0, activeSmoke = 0, seed = 9817;
  const random = () => ((seed = seed * 16807 % 2147483647) - 1) / 2147483646;
  const hidden = mesh => {
    dummy.position.copy(zero);dummy.rotation.set(0, 0, 0);dummy.scale.setScalar(0);dummy.updateMatrix();
    for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, dummy.matrix);
    mesh.instanceMatrix.needsUpdate = true;
    const opacity = mesh.geometry.getAttribute('burstOpacity');if (opacity) {opacity.array.fill(0);opacity.needsUpdate = true;}
  };
  const effectMeshes = [shardMesh, sparkMesh, ringMesh, fireMesh, smokeMesh];effectMeshes.forEach(hidden);

  function renderPods() {
    pods.forEach((pod, index) => {
      // Heavy containers rest on pavement, without the former floating/spinning core.
      dummy.position.copy(pod.position);dummy.position.y += .515;dummy.rotation.set(0, pod.yaw, 0);dummy.scale.setScalar(pod.cooldown > 0 ? 0 : 1);dummy.updateMatrix();
      [shell, hardware, seams, strips].forEach(mesh => mesh.setMatrixAt(index, dummy.matrix));
    });
    [shell, hardware, seams, strips].forEach(mesh => {mesh.instanceMatrix.needsUpdate = true;});
    strips.material.emissiveIntensity = reducedMotion ? .6 : .6 + Math.sin(elapsed * 1.3) * .08;
  }

  function launch(pool, kind, position, count, intensity) {
    for (let i = 0; i < count; i++) {
      const item = pool[cursors[kind]++ % pool.length], angle = random() * Math.PI * 2;
      item.origin.copy(position);item.position.copy(position);item.position.y += .55;item.delay = 0;
      item.rotation = random() * Math.PI;item.spin = (random() - .5) * 12;
      if (kind === 'fire') {
        const offset = i ? .2 + random() * .25 : 0;
        item.position.x += Math.cos(angle) * offset;item.position.z += Math.sin(angle) * offset;
        item.position.y += i ? random() * .25 : .08;item.velocity.set(Math.cos(angle) * .3, .75 + random() * .35, Math.sin(angle) * .3);
        item.delay = i * .025;item.duration = item.life = .52 + random() * .16;
        item.size = (i ? .8 + random() * .35 : .68) * (.9 + intensity * .35);item.tint.copy(i ? orange : yellow);
      } else if (kind === 'smoke') {
        item.position.x += Math.cos(angle) * .28;item.position.z += Math.sin(angle) * .28;item.position.y += .2;
        item.velocity.set(Math.cos(angle) * (.3 + random() * .4), 1.05 + random() * .75, Math.sin(angle) * (.3 + random() * .4));
        item.duration = item.life = 1.5 + random() * .65;item.size = .35 + random() * .3;item.tint.set(i % 2 ? '#534c46' : '#77716a');
      } else {
        const metal = kind === 'shard', radial = (metal ? 2.6 : 5) * (.7 + random() * .7);
        item.velocity.set(Math.cos(angle) * radial, (metal ? 3 : 2) + random() * (metal ? 3 : 4), Math.sin(angle) * radial);
        item.duration = item.life = (metal ? 1.05 : .5) + random() * .45;
        item.size = (metal ? .08 + random() * .12 : .02 + random() * .035) * (.85 + intensity * .25);
        item.tint.copy(metal ? (i % 3 ? steel : scorched) : (i % 3 ? gold : yellow));
      }
    }
  }

  function burst(pod, intensity, quality) {
    pod.cooldown = RESPAWN_SECONDS;effectsDirty = true;
    if (!reducedMotion) {
      const eco = quality === 'eco';
      launch(shards, 'shard', pod.position, eco ? 10 : 18, intensity);
      launch(sparks, 'spark', pod.position, eco ? 10 : 20, intensity);
      launch(fireballs, 'fire', pod.position, eco ? 2 : 4, intensity);
      launch(smoke, 'smoke', pod.position, eco ? 3 : 6, intensity);
    }
    const ring = rings[ringCursor++ % rings.length];ring.position.copy(pod.position);ring.position.y += .055;
    ring.duration = ring.life = reducedMotion ? .3 : .75;ring.tint.copy(gold);
  }

  function particles(pool, mesh, dt, kind) {
    let active = 0;const opacity = mesh.geometry.getAttribute('burstOpacity');
    for (let i = 0; i < pool.length; i++) {
      const item = pool[i];
      const held = Math.min(item.delay, dt), activeStep = dt - held;
      item.delay = Math.max(0, item.delay - dt);item.life = Math.max(0, item.life - activeStep);
      let alpha = 0;
      if (item.life > 0) {
        active++;const remaining = item.life / item.duration, age = 1 - remaining;
        if (kind === 'ring') {
          dummy.position.copy(item.position);dummy.rotation.set(0, 0, 0);dummy.scale.setScalar(reducedMotion ? .6 : .35 + age * 3.1);
          color.copy(item.tint).multiplyScalar(remaining * 1.8);
        } else if (kind === 'fire' || kind === 'smoke') {
          const fire = kind === 'fire';
          if (!item.delay) item.position.addScaledVector(item.velocity, activeStep);
          dummy.position.copy(item.position);dummy.rotation.set(item.rotation, item.rotation * .6, 0);
          dummy.scale.setScalar(item.size * (fire ? .25 + age * 2.25 : .65 + age * 2.4));
          alpha = item.delay ? 0 : (fire ? Math.min(1, age * 30) * remaining ** 2.15 : Math.sin(age * Math.PI) * remaining ** .25 * .52);
          color.copy(item.tint);if (fire) color.lerp(red, age * .65).multiplyScalar(1.4 + remaining * 1.4);
        } else {
          const metal = kind === 'shard';item.velocity.y -= (metal ? 8 : 2.2) * dt;
          item.position.addScaledVector(item.velocity, dt);item.rotation += item.spin * dt;
          if (item.position.y < item.origin.y + .06) {item.position.y = item.origin.y + .06;item.velocity.y = Math.abs(item.velocity.y) * .25;}
          const dx = item.position.x - item.origin.x, dz = item.position.z - item.origin.z, distance = Math.hypot(dx, dz);
          if (distance > 3.1) {item.position.x = item.origin.x + dx / distance * 3.1;item.position.z = item.origin.z + dz / distance * 3.1;item.velocity.x = 0;item.velocity.z = 0;}
          dummy.position.copy(item.position);dummy.rotation.set(item.rotation, item.rotation * .6, 0);
          const size = item.size * Math.min(1, remaining * 4);dummy.scale.set(size, metal ? size * .22 : size, metal ? size * .65 : size);
          color.copy(item.tint).multiplyScalar(metal ? .7 + remaining * .3 : remaining * 2.2);
        }
        mesh.setColorAt(i, color);
      } else {dummy.position.copy(zero);dummy.rotation.set(0, 0, 0);dummy.scale.setScalar(0);}
      if (opacity) opacity.setX(i, alpha);
      dummy.updateMatrix();mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;if (opacity) opacity.needsUpdate = true;
    return active;
  }
  renderPods();
  return {
    root,
    update({dt = 0, carPosition, carSpeed = 0, paused = false, quality = 'high'} = {}) {
      if (disposed) return;
      const step = Number.isFinite(dt) ? clamp(dt, 0, .1) : 0;
      if (paused) {previous = finitePosition(carPosition) ? new Vector3().copy(carPosition) : null;return;}
      elapsed += step;time.value = elapsed;pods.forEach(pod => {pod.cooldown = Math.max(0, pod.cooldown - step);});
      const positionValid = finitePosition(carPosition), moving = Math.abs(carSpeed) > .2 || (positionValid && previous && previous.distanceToSquared(carPosition) > .0001);
      if (positionValid && moving) {
        const start = previous || carPosition, position = new Vector3();let count = 0;
        const intensity = clamp(Math.abs(Number.isFinite(carSpeed) ? carSpeed : 0) / 18, .25, 1);
        for (const pod of pods) if (pod.cooldown === 0 && sweptPodContact(start, carPosition, pod.position)) {
          burst(pod, intensity, quality);position.add(pod.position);count++;total++;
        }
        if (count) onBurst({count, total, position: position.divideScalar(count), intensity});
      }
      previous = positionValid ? new Vector3().copy(carPosition) : null;
      renderPods();
      if (effectsDirty || activeShards || activeSparks || activeRings || activeFireballs || activeSmoke) {
        activeShards = particles(shards, shardMesh, step, 'shard');activeSparks = particles(sparks, sparkMesh, step, 'spark');activeRings = particles(rings, ringMesh, step, 'ring');
        activeFireballs = particles(fireballs, fireMesh, step, 'fire');activeSmoke = particles(smoke, smokeMesh, step, 'smoke');effectsDirty = false;
      }
    },
    reset() {
      previous = null;elapsed = 0;time.value = 0;total = 0;activeShards = activeSparks = activeRings = activeFireballs = activeSmoke = 0;effectsDirty = false;
      pods.forEach(pod => {pod.cooldown = 0;});[...shards, ...sparks, ...rings, ...fireballs, ...smoke].forEach(item => {item.life = item.delay = 0;});
      effectMeshes.forEach(hidden);renderPods();
    },
    get stats() {return {pods: pods.length, roadPods: pods.filter(p => p.route === 'road').length, bridgePods: pods.filter(p => p.route === 'bridge').length, activePods: pods.filter(p => p.cooldown === 0).length, bursts: total, activeShards, activeSparks, activeRings, activeFireballs, activeSmoke, capacity: CAPACITY};},
    dispose() {if (disposed) return;disposed = true;root.removeFromParent();meshes.forEach(mesh => mesh.dispose());resources.forEach(resource => resource.dispose());meshes.length = 0;},
  };
}
