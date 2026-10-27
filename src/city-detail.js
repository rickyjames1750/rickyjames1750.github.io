import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { peninsulaCoast, project as geographicProject } from './geography.js';
import { SURFACES } from './surfaces.js';

const BUILDING_BASE = .63, MAX_BUILDINGS = 512, MAX_SERVICE_SITES = 24;
const MAX_ROOF_MACHINES = 96, MAX_SOLAR_ROOFS = 192;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const hash = n => {const value = Math.sin(n * 127.1 + 311.7) * 43758.5453;return value - Math.floor(value);};
const finiteBuilding = b => b && [b.x, b.z, b.w, b.d, b.h].every(Number.isFinite) && Math.min(b.w, b.d, b.h) > 0;
const blockDistance = (point, b) => Math.hypot(Math.max(0, Math.abs(point.x - b.x) - b.w / 2), Math.max(0, Math.abs(point.z - b.z) - b.d / 2));
function distributed(blocks, limit) {
  const count = Math.min(blocks.length, limit), selected = Array.from({length: count}, (_, i) => blocks[Math.floor((i + .5) * blocks.length / count)]);
  return [...selected.filter((_, i) => i % 2 === 0), ...selected.filter((_, i) => i % 2 === 1)];
}

function landTest(project) {
  const polygon = peninsulaCoast.map(c => project(...c));
  return (x, z) => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i], b = polygon[j];
      if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
    }
    return inside;
  };
}

function fanGeometry() {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const blade = new T.BoxGeometry(.82, .045, .13);blade.translate(.12, 0, 0);blade.rotateY(i * Math.PI * 2 / 3 + .22);parts.push(blade);
  }
  const geometry = mergeGeometries(parts);parts.forEach(g => g.dispose());return geometry;
}

/** Brick, cut stone and metal joints are antialiased in world units, with small PBR relief. */
function facadeMaterial(quality) {
  const material = new T.MeshStandardMaterial({color: '#ffffff', roughness: .8, metalness: .08});
  material.onBeforeCompile = shader => {
    shader.uniforms.uCityQuality = quality;
    shader.vertexShader = `attribute float cityKind;attribute float citySeed;varying vec2 vCityUv;varying float vCityKind;varying float vCitySeed;varying float vCityWall;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float cityWidth=abs(normal.x)>.5?length(instanceMatrix[2].xyz):length(instanceMatrix[0].xyz);
      float cityHeight=abs(normal.y)>.5?length(instanceMatrix[2].xyz):length(instanceMatrix[1].xyz);
      vCityUv=uv*vec2(cityWidth,cityHeight);vCityKind=cityKind;vCitySeed=citySeed;vCityWall=1.-step(.5,abs(normal.y));`);
    shader.fragmentShader = `uniform float uCityQuality;varying vec2 vCityUv;varying float vCityKind;varying float vCitySeed;varying float vCityWall;
      float cityHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      vec3 cityBump(vec3 eye,vec3 n,float h){
        vec3 dx=dFdx(eye),dy=dFdy(eye),a=cross(dy,n),b=cross(n,dx);float determinant=dot(dx,a);
        if(abs(determinant)<.0000001)return n;
        return normalize(abs(determinant)*n-sign(determinant)*(dFdx(h)*a+dFdy(h)*b));
      }
      ${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec2 cityCell=vCityKind<.5?vec2(.145,.055):vCityKind<1.5?vec2(.38,.19):vec2(.44,.68);
      vec2 cityGrid=vCityUv/cityCell;cityGrid.x+=vCityKind<.5?mod(floor(cityGrid.y),2.)*.5:0.;
      vec2 cityId=floor(cityGrid),cityF=fract(cityGrid),cityAA=max(fwidth(cityGrid),vec2(.001));
      vec2 cityJoint=vec2(vCityKind<.5?.0035:vCityKind<1.5?.007:.004)/cityCell;
      vec2 cityInside=smoothstep(cityJoint-cityAA,cityJoint+cityAA,cityF)*(1.-smoothstep(1.-cityJoint-cityAA,1.-cityJoint+cityAA,cityF));
      float cityDetail=(1.-smoothstep(.3,.85,max(cityAA.x,cityAA.y)))*uCityQuality*vCityWall;
      float cityFace=mix(1.,cityInside.x*cityInside.y,cityDetail),cityVariation=cityHash(cityId+vCitySeed);
      float cityStreak=cityHash(vec2(floor(vCityUv.x/.08),vCitySeed))*.04;
      float cityWeather=.94+cityVariation*.1-cityStreak-.045*(1.-smoothstep(0.,.35,vCityUv.y));
      diffuseColor.rgb*=mix(vCityKind>1.5?.55:.64,cityWeather,cityFace);
      float cityHeight=cityFace*(vCityKind<.5?.002:vCityKind<1.5?.0013:.001)*cityDetail;
      `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor=clamp(vCityKind>1.5?.39+cityVariation*.12:.77+cityVariation*.12,.3,.98);`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal=cityBump(-vViewPosition,normal,cityHeight);');
  };
  material.customProgramCacheKey = () => 'bayward-world-scale-facade-v1';
  return material;
}

function solarMaterial() {
  const material = new T.MeshStandardMaterial({color: '#16374b', roughness: .25, metalness: .6});
  material.onBeforeCompile = shader => {
    shader.vertexShader = `varying vec2 vSolarUv;\n${shader.vertexShader}`.replace('#include <begin_vertex>', '#include <begin_vertex>\nvSolarUv=uv;');
    shader.fragmentShader = `varying vec2 vSolarUv;\n${shader.fragmentShader}`.replace('#include <color_fragment>', `#include <color_fragment>
      vec2 grid=vSolarUv*vec2(4.,6.),f=fract(grid),aa=max(fwidth(grid),vec2(.003));
      vec2 cell=smoothstep(vec2(.035)-aa,vec2(.035)+aa,f)*(1.-smoothstep(vec2(.965)-aa,vec2(.965)+aa,f));
      float line=cell.x*cell.y,fade=1.-smoothstep(.4,1.,max(aa.x,aa.y));
      diffuseColor.rgb*=mix(1.,mix(2.1,.92,line),fade);`);
  };
  material.customProgramCacheKey = () => 'bayward-solar-cell-grid-v1';
  return material;
}

/**
 * Additive detail for existing buildings. Facade skins sit behind UrbanNature's
 * .008-offset windows. Roof work stays entirely over its host footprint. Ground
 * service sites reserve full pads, clear roads/rail/stations/bridge/trees and return
 * conservative colliders for the caller to append to its ordinary collision set.
 */
export function createCityDetail({scene, buildings = [], buildingBodies, roadCurve, railCurve, corridors, bridgeDrive, treePositions = [], reducedMotion = false, project = geographicProject, isOnLand} = {}) {
  if (!scene?.add) throw new TypeError('City detail requires a Three.js scene.');
  const blocks = buildings.filter(finiteBuilding).slice(0, MAX_BUILDINGS), onLand = isOnLand || landTest(project);
  const root = new T.Group();root.name = 'Material-rich facades, roof plant and city services';scene.add(root);
  const geometries = new Set(), materials = new Set(), batches = [], specs = {facade: [], metal: [], dark: [], cylinder: [], fan: [], solar: [], paving: []};
  const own = geometry => {geometries.add(geometry);return geometry;};
  const mat = (color, options = {}) => {const material = new T.MeshStandardMaterial({color, roughness: .62, metalness: .45, ...options});materials.add(material);return material;};
  const qualityUniform = {value: 1}, cladding = facadeMaterial(qualityUniform), pv = solarMaterial();materials.add(cladding);materials.add(pv);
  const metal = mat('#ffffff', {roughness: .42, metalness: .65}), dark = mat('#26343a', {roughness: .7, metalness: .35});
  const concrete = mat('#a1a297', {roughness: .98, metalness: 0});
  const cube = own(new T.BoxGeometry(1, 1, 1)), plane = own(new T.PlaneGeometry(1, 1)), cylinder = own(new T.CylinderGeometry(.5, .5, 1, 10));
  const hosts = [], roofBounds = [], groundFootprints = [], colliders = [];
  function add(kind, host, x, y, z, w, h, d, color = '#9aa7aa', ry = 0, rx = 0, rz = 0) {specs[kind].push({host, x, y, z, w, h, d, color, ry, rx, rz});}
  // Group roof records by parity so ECO keeps a distributed half of the city.
  const roofBlocks = distributed(blocks, MAX_ROOF_MACHINES), solarBlocks = distributed(blocks, MAX_SOLAR_ROOFS);
  blocks.forEach((b, index) => {
    const kind = b.h > 4.4 ? 2 : hash(index + 7) > .42 ? 0 : 1;
    const palette = kind === 0 ? ['#8c7462', '#a0846c', '#7c7e73'] : kind === 1 ? ['#a7aaa0', '#b5ad9d', '#94a29e'] : ['#69828a', '#788d91', '#718080'];
    const color = palette[Math.floor(hash(index + 49) * palette.length)], y = BUILDING_BASE + b.h / 2;
    const faces = [[b.x, b.z + b.d / 2 + .002, b.w, 0], [b.x, b.z - b.d / 2 - .002, b.w, Math.PI], [b.x + b.w / 2 + .002, b.z, b.d, Math.PI / 2], [b.x - b.w / 2 - .002, b.z, b.d, -Math.PI / 2]];
    for (const [x, z, width, angle] of faces) {add('facade', index, x, y, z, width, b.h, 1, color, angle);specs.facade.at(-1).kind = kind;specs.facade.at(-1).seed = hash(index + 39) * 97;}
    hosts.push({...b, index});
  });
  roofBlocks.forEach(b => {
    const index = blocks.indexOf(b), top = BUILDING_BASE + b.h;
    const w = Math.min(.23, b.w * .19), d = Math.min(.3, b.d * .22), x = b.x + b.w * .27, z = b.z - b.d * .23;
    // A third service cabinet occupies an unused roof quadrant, clear of the two
    // UrbanNature units. Louvers, neck and fan rotor give its silhouette depth.
    add('metal', index, x, top + .105, z, w, .17, d, '#9ca9a9');
    for (let row = 0; row < 4; row++) add('dark', index, x, top + .055 + row * .03, z + d / 2 + .002, w * .8, .009, .004);
    const radius = Math.min(w, d) * .38;
    add('cylinder', index, x, top + .205, z, radius * 2, .03, radius * 2, '#798b8d');
    add('cylinder', index, x, top + .223, z, radius * 1.72, .008, radius * 1.72, '#24353b');
    add('fan', index, x, top + .23, z, radius * 1.65, .3, radius * 1.65, '#859697');
    const ductW = Math.min(.19, b.w * .16);
    add('metal', index, x - w / 2 - ductW / 2, top + .065, z, ductW, .075, d * .48, '#7c9093');
    roofBounds.push({host: index, x: b.x, z: b.z, w: b.w, d: b.d, top});
  });
  solarBlocks.forEach(b => {
    const index = blocks.indexOf(b), top = BUILDING_BASE + b.h;
    // Two framed PV panels occupy the opposite front quadrant, not the parapet.
    const panelW = b.w * .19, panelD = b.d * .25;
    for (let i = 0; i < 2; i++) {
      const px = b.x - b.w * .25 + (i ? 1 : -1) * panelW * .54, pz = b.z + b.d * .2;
      add('metal', index, px, top + .052, pz, panelW + .018, .025, panelD + .018, '#7b8a8d');
      add('solar', index, px, top + .069, pz, panelW, panelD, 1, '#ffffff', 0, -Math.PI / 2);
    }
  });
  const roofInstanceCounts = Object.fromEntries(Object.entries(specs).map(([kind, records]) => [kind, records.length]));

  function clearSite(site, host) {
    if (!corridors?.isClear || !corridors.isClear(site)) return false;
    if (bridgeDrive?.contains?.(site.x, site.z, site.r + .4)) return false;
    for (let i = 0; i < 8; i++) if (!onLand(site.x + Math.cos(i * Math.PI / 4) * site.r, site.z + Math.sin(i * Math.PI / 4) * site.r)) return false;
    if (blocks.some(b => blockDistance(site, b) < site.r + .05)) return false;
    if (treePositions.some(tree => Number.isFinite(tree.s) && Math.hypot(tree.x - site.x, tree.z - site.z) < .8 * tree.s + site.r + .12)) return false;
    return !groundFootprints.some(other => Math.hypot(other.x - site.x, other.z - site.z) < other.r + site.r + .3);
  }
  blocks.forEach((b, index) => {
    if (index % 3 || groundFootprints.length >= MAX_SERVICE_SITES) return;
    const orientations = [[0, 1, b.d / 2], [0, -1, b.d / 2], [1, 0, b.w / 2], [-1, 0, b.w / 2]];
    let site;
    for (const [nx, nz, extent] of orientations) {
      const candidate = {x: b.x + nx * (extent + .5), z: b.z + nz * (extent + .5), r: .34, host: index, rotation: Math.atan2(nx, nz), kind: index % 2 ? 'hydrant' : 'utility-cabinet'};
      if (clearSite(candidate, index)) {site = candidate;break;}
    }
    if (!site) return;
    groundFootprints.push(site);colliders.push({x: site.x, z: site.z, r: site.r, kind: 'city-service'});
    add('paving', index, site.x, SURFACES.land + .018, site.z, .48, .036, .42, '#ffffff', site.rotation);
    const floor = SURFACES.land + .036;
    if (site.kind === 'utility-cabinet') {
      add('metal', index, site.x, floor + .22, site.z, .29, .44, .19, '#a3aeaa', site.rotation);
      for (let row = 0; row < 3; row++) {
        const distance = .098, x = site.x + Math.sin(site.rotation) * distance, z = site.z + Math.cos(site.rotation) * distance;
        add('dark', index, x, floor + .11 + row * .045, z, .21, .012, .005, '#ffffff', site.rotation);
      }
    } else {
      add('cylinder', index, site.x, floor + .145, site.z, .12, .23, .12, '#a34537');
      add('cylinder', index, site.x, floor + .27, site.z, .17, .035, .17, '#a34e40');
      add('metal', index, site.x, floor + .305, site.z, .055, .045, .055, '#8e9b9a');
      add('cylinder', index, site.x, floor + .16, site.z, .08, .24, .08, '#b55b46', 0, 0, Math.PI / 2);
    }
  });

  const position = new T.Vector3(), size = new T.Vector3(), q = new T.Quaternion(), rotation = new T.Euler(), matrix = new T.Matrix4(), color = new T.Color();
  function put(mesh, index, record, spin = 0) {
    position.set(record.x, record.y, record.z);size.set(record.w, record.h, record.d);q.setFromEuler(rotation.set(record.rx, record.ry + spin, record.rz));matrix.compose(position, q, size);mesh.setMatrixAt(index, matrix);
  }
  const directBodies = Boolean(buildingBodies?.isInstancedMesh && buildingBodies.count === blocks.length && blocks.length > 0);
  const bodyState = directBodies ? {material: buildingBodies.material, color: buildingBodies.instanceColor, kind: buildingBodies.geometry.getAttribute('cityKind'), seed: buildingBodies.geometry.getAttribute('citySeed')} : null;
  const definitions = [...(directBodies ? [] : [['facade', plane, cladding]]), ['metal', cube, metal], ['dark', cube, dark], ['cylinder', cylinder, metal], ['fan', own(fanGeometry()), metal], ['solar', own(new T.PlaneGeometry(1, 1)), pv], ['paving', cube, concrete]];
  const byKind = {};
  for (const [kind, geometry, material] of definitions) {
    const records = specs[kind], mesh = new T.InstancedMesh(geometry, material, Math.max(1, records.length));mesh.name = `City detail ${kind}`;mesh.count = records.length;mesh.castShadow = false;mesh.receiveShadow = kind !== 'paving';
    records.forEach((record, index) => {put(mesh, index, record);mesh.setColorAt(index, color.set(record.color));});
    mesh.instanceMatrix.needsUpdate = true;if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;mesh.computeBoundingSphere();root.add(mesh);batches.push(mesh);byKind[kind] = mesh;
  }
  const facadeGeometry = directBodies ? buildingBodies.geometry : plane;
  const facadeRecords = directBodies ? blocks.map((_, index) => specs.facade[index * 4]) : specs.facade;
  facadeGeometry.setAttribute('cityKind', new T.InstancedBufferAttribute(new Float32Array(facadeRecords.map(record => record.kind)), 1));
  facadeGeometry.setAttribute('citySeed', new T.InstancedBufferAttribute(new Float32Array(facadeRecords.map(record => record.seed)), 1));
  if (directBodies) {
    buildingBodies.instanceColor = new T.InstancedBufferAttribute(new Float32Array(blocks.length * 3), 3);
    facadeRecords.forEach((record, index) => buildingBodies.setColorAt(index, color.set(record.color)));
    buildingBodies.instanceColor.needsUpdate = true;buildingBodies.material = cladding;
  }
  root.userData.hostBuildings = hosts;root.userData.roofBounds = roofBounds;root.userData.groundFootprints = groundFootprints;
  root.userData.roofInstanceCounts = roofInstanceCounts;
  root.userData.instanceHosts = Object.fromEntries(Object.entries(specs).map(([kind, records]) => [kind, records.map(record => record.host)]));
  let elapsed = 0, quality = 'high', disposed = false;
  function update({dt = 0, paused = false, quality: nextQuality = quality} = {}) {
    if (disposed) return;
    const level = nextQuality === 'eco' ? 'eco' : 'high';
    if (level !== quality) {quality = level;qualityUniform.value = quality === 'eco' ? .5 : 1;byKind.fan.count = quality === 'eco' ? Math.ceil(specs.fan.length / 2) : specs.fan.length;}
    if (paused || reducedMotion) return;
    elapsed += clamp(Number.isFinite(dt) ? dt : 0, 0, .1);
    for (let index = 0; index < byKind.fan.count; index++) {const record = specs.fan[index];put(byKind.fan, index, record, elapsed * 2.8 + hash(record.host) * Math.PI);}
    if (byKind.fan.count) byKind.fan.instanceMatrix.needsUpdate = true;
  }
  function dispose() {
    if (disposed) return;disposed = true;root.removeFromParent();
    if (bodyState) {
      buildingBodies.material = bodyState.material;buildingBodies.instanceColor = bodyState.color;
      for (const [name, attribute] of [['cityKind', bodyState.kind], ['citySeed', bodyState.seed]]) {
        if (attribute) buildingBodies.geometry.setAttribute(name, attribute);else buildingBodies.geometry.deleteAttribute(name);
      }
    }
    batches.forEach(mesh => mesh.dispose());geometries.forEach(g => g.dispose());materials.forEach(m => m.dispose());
  }
  return {root, update, dispose, colliders, groundFootprints,
    get stats() {return {buildings: blocks.length, facadeFaces: specs.facade.length, directBuildingMaterial: directBodies, roofMachines: specs.fan.length, solarPanels: specs.solar.length, serviceSites: groundFootprints.length, activeFans: byKind.fan.count, drawCalls: batches.filter(mesh => mesh.count > 0).length, triangles: batches.reduce((sum, mesh) => sum + mesh.count * (mesh.geometry.index?.count || mesh.geometry.getAttribute('position').count) / 3, 0), animationTime: elapsed, quality};},
  };
}
