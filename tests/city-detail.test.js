import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Color, InstancedBufferAttribute, InstancedMesh, LineCurve3, Matrix4, MeshStandardMaterial, Scene, ShaderLib, Vector3 } from 'three';
import { createCityDetail } from '../src/city-detail.js';
import { createCorridorIndex } from '../src/corridors.js';

const blocks = [{x: -7, z: 8, w: 1.7, d: 1.4, h: 5.2}, {x: -8, z: 18, w: .7, d: .7, h: 1.2}, {x: -7, z: 28, w: 1.2, d: 1.8, h: 3.2}, {x: -8, z: 38, w: 1.7, d: 1.1, h: 2.8}];
const roadCurve = new LineCurve3(new Vector3(0, .79, 0), new Vector3(0, .79, 50));
const railCurve = new LineCurve3(new Vector3(10, .84, 0), new Vector3(10, .84, 50));
const corridors = createCorridorIndex(roadCurve, railCurve);
const byName = (detail, kind) => detail.root.getObjectByName(`City detail ${kind}`);
function fixture(options = {}) {const scene = new Scene(), detail = createCityDetail({scene, buildings: blocks, roadCurve, railCurve, corridors, isOnLand: () => true, ...options});return {scene, detail};}
function visitVertices(mesh, count, visit) {
  const matrix = new Matrix4(), point = new Vector3(), positions = mesh.geometry.getAttribute('position');
  for (let index = 0; index < count; index++) {
    mesh.getMatrixAt(index, matrix);
    for (let vertex = 0; vertex < positions.count; vertex++) {point.fromBufferAttribute(positions, vertex).applyMatrix4(matrix);visit(point, index);}
  }
}
const rectDistance = (p, b) => Math.hypot(Math.max(0, Math.abs(p.x - b.x) - b.w / 2), Math.max(0, Math.abs(p.z - b.z) - b.d / 2));

test('facade skins stay behind existing window planes and all rooftop details remain over their host', () => {
  const {detail} = fixture(), facades = byName(detail, 'facade');
  assert.equal(detail.stats.facadeFaces, blocks.length * 4);
  visitVertices(facades, facades.count, (p, index) => {
    const host = blocks[detail.root.userData.instanceHosts.facade[index]];
    assert.ok(Math.abs(p.x - host.x) <= host.w / 2 + .00201 && Math.abs(p.z - host.z) <= host.d / 2 + .00201);
    assert.ok(p.y >= .63 - 1e-6 && p.y <= .63 + host.h + 1e-6);
    const offset = Math.min(Math.abs(Math.abs(p.x - host.x) - host.w / 2), Math.abs(Math.abs(p.z - host.z) - host.d / 2));
    assert.ok(offset <= .00201, 'wall material stays behind .008-offset UrbanNature windows');
  });
  for (const kind of ['metal', 'dark', 'cylinder', 'fan', 'solar']) {
    const mesh = byName(detail, kind), count = detail.root.userData.roofInstanceCounts[kind];
    visitVertices(mesh, count, (p, index) => {
      const host = blocks[detail.root.userData.instanceHosts[kind][index]];
      assert.ok(Math.abs(p.x - host.x) <= host.w / 2 + 1e-6, `${kind} leaves roof width`);
      assert.ok(Math.abs(p.z - host.z) <= host.d / 2 + 1e-6, `${kind} leaves roof depth`);
      assert.ok(p.y >= .63 + host.h, `${kind} cannot float through its roof`);
    });
  }
  detail.dispose();
});

test('preferred direct-body PBR path adds no competing wall planes and restores external ownership on dispose', () => {
  const scene = new Scene(), geometry = new BoxGeometry(), originalMaterial = new MeshStandardMaterial({color: '#456789'}), bodies = new InstancedMesh(geometry, originalMaterial, blocks.length);
  const originalKinds = new InstancedBufferAttribute(new Float32Array(blocks.length).fill(9), 1);geometry.setAttribute('cityKind', originalKinds);
  bodies.setColorAt(0, new Color('#abcdef'));const originalColors = bodies.instanceColor;
  scene.add(bodies);let bodyGeometryDisposed = 0;geometry.addEventListener('dispose', () => bodyGeometryDisposed++);
  const detail = createCityDetail({scene, buildings: blocks, buildingBodies: bodies, isOnLand: () => true});
  assert.equal(detail.stats.directBuildingMaterial, true);assert.equal(byName(detail, 'facade'), undefined);
  assert.notEqual(bodies.material, originalMaterial);assert.notEqual(bodies.instanceColor, originalColors);
  assert.equal(geometry.getAttribute('cityKind').count, blocks.length);assert.equal(geometry.getAttribute('citySeed').count, blocks.length);
  const shader = {uniforms: {}, vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader};
  bodies.material.onBeforeCompile(shader);
  assert.ok(shader.vertexShader.includes('abs(normal.x)>.5') && shader.vertexShader.includes('vCityWall=1.-step'), 'cube side and roof UVs use actual host dimensions');
  assert.ok(shader.fragmentShader.includes('fwidth(cityGrid)') && shader.fragmentShader.includes('normal=cityBump'), 'PBR mortar relief is antialiased at distance');
  assert.equal(shader.vertexShader.includes('\\n'), false);assert.equal(shader.fragmentShader.includes('\\n'), false);
  detail.update({quality: 'eco', paused: true});assert.equal(shader.uniforms.uCityQuality.value, .5);
  detail.dispose();detail.dispose();
  assert.equal(bodies.material, originalMaterial);assert.equal(bodies.instanceColor, originalColors);assert.equal(geometry.getAttribute('cityKind'), originalKinds);assert.equal(geometry.getAttribute('citySeed'), undefined);
  assert.equal(bodyGeometryDisposed, 0, 'the caller still owns the original body geometry');assert.equal(bodies.parent, scene);
  geometry.dispose();originalMaterial.dispose();
});

test('every service pad reserves its full footprint outside roads, rail, stations, bridge, trees and buildings', () => {
  const treePositions = [{x: -7, z: 9.2, s: .7}], bridgeDrive = {contains: (x, z, r) => z + r > 42};
  const {detail} = fixture({treePositions, bridgeDrive, isOnLand: (x, z) => x < -4 && z > 1 && z < 45});
  assert.ok(detail.groundFootprints.length > 0);
  assert.equal(detail.colliders.length, detail.groundFootprints.length);
  detail.groundFootprints.forEach((site, index) => {
    assert.ok(corridors.isClear(site));assert.ok(corridors.roadClearance(site) >= .5);assert.ok(corridors.railClearance(site) >= .5);
    assert.equal(bridgeDrive.contains(site.x, site.z, site.r + .4), false);
    for (const b of blocks) assert.ok(rectDistance(site, b) >= site.r + .05);
    for (const tree of treePositions) assert.ok(Math.hypot(tree.x - site.x, tree.z - site.z) >= .8 * tree.s + site.r + .12);
    for (let i = 0; i < 16; i++) {const angle = i * Math.PI / 8;assert.ok(site.x + Math.cos(angle) * site.r < -4 && site.z + Math.sin(angle) * site.r < 45);}
    assert.equal(detail.colliders[index].r, site.r);
  });
  const pads = byName(detail, 'paving');
  visitVertices(pads, pads.count, (p, index) => {
    const site = detail.groundFootprints[index];assert.ok(Math.hypot(p.x - site.x, p.z - site.z) <= site.r);assert.ok(p.y >= .6 - 1e-6);
  });
  detail.dispose();
  const denied = fixture({corridors: {isClear: () => false}}).detail;
  assert.equal(denied.groundFootprints.length, 0);assert.equal(denied.colliders.length, 0);denied.dispose();
});

test('roof fan motion pauses, reduced motion remains static and ECO coverage is distributed across the city', () => {
  const buildings = Array.from({length: 200}, (_, i) => ({x: i * 3, z: 7, w: 1.5, d: 1.4, h: 1 + i % 7}));
  const {detail} = fixture({buildings, corridors: undefined});
  const fan = byName(detail, 'fan'), original = fan.instanceMatrix.array.slice();detail.update({dt: .05});
  assert.notDeepEqual(fan.instanceMatrix.array, original);assert.equal(detail.stats.animationTime, .05);
  const moved = fan.instanceMatrix.array.slice();detail.update({dt: 1, paused: true});assert.deepEqual(fan.instanceMatrix.array, moved);assert.equal(detail.stats.animationTime, .05);
  detail.update({dt: 10});assert.ok(Math.abs(detail.stats.animationTime - .15) < 1e-10);
  detail.update({quality: 'eco', paused: true});assert.equal(detail.stats.activeFans, 48);
  const visibleHosts = detail.root.userData.instanceHosts.fan.slice(0, 48);
  assert.ok(Math.max(...visibleHosts) - Math.min(...visibleHosts) > buildings.length * .9, 'ECO does not remove one end of the Peninsula');
  const solar = byName(detail, 'solar'), shader = {uniforms: {}, vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader};solar.material.onBeforeCompile(shader);
  assert.ok(shader.fragmentShader.includes('fwidth(grid)'));assert.equal(shader.fragmentShader.includes('\\n'), false);detail.dispose();
  const reduced = fixture({reducedMotion: true}).detail, frozen = byName(reduced, 'fan').instanceMatrix.array.slice();reduced.update({dt: .1});
  assert.deepEqual(byName(reduced, 'fan').instanceMatrix.array, frozen);assert.equal(reduced.stats.animationTime, 0);reduced.dispose();
});

test('maximum input remains under seven added draws and thirty thousand triangles with finite pooled transforms', () => {
  const buildings = Array.from({length: 1200}, (_, i) => ({x: i * 4, z: 10 + i % 3 * 4, w: 1.6, d: 1.4, h: 1 + i % 7}));
  const {detail} = fixture({buildings, corridors: {isClear: () => true}, isOnLand: () => true});
  assert.equal(detail.stats.buildings, 512);assert.equal(detail.stats.roofMachines, 96);assert.equal(detail.stats.solarPanels, 384);
  assert.ok(detail.stats.serviceSites <= 24);assert.ok(detail.stats.drawCalls <= 7);assert.ok(detail.stats.triangles < 30000);
  const geometries = new Set(), materials = new Set();
  for (const mesh of detail.root.children) {
    assert.ok(mesh.isInstancedMesh && mesh.count <= mesh.instanceMatrix.count);assert.ok(Array.from(mesh.instanceMatrix.array).every(Number.isFinite));
    geometries.add(mesh.geometry);materials.add(mesh.material);
  }
  let geometryDisposals = 0, materialDisposals = 0;
  geometries.forEach(g => g.addEventListener('dispose', () => geometryDisposals++));materials.forEach(m => m.addEventListener('dispose', () => materialDisposals++));
  detail.dispose();detail.dispose();assert.equal(geometryDisposals, geometries.size);assert.equal(materialDisposals, materials.size);assert.equal(detail.root.parent, null);
  const previous = detail.stats.animationTime;detail.update({dt: .1});assert.equal(detail.stats.animationTime, previous);
});

test('empty or invalid host data creates no visible batches and does not mutate caller metadata', () => {
  const inputs = [{x: NaN, z: 0, h: 2, w: 1, d: 1}, {x: 0, z: 0, h: 2, w: 0, d: 1}];
  const scene = new Scene(), detail = createCityDetail({scene, buildings: inputs});
  assert.equal(detail.stats.buildings, 0);assert.equal(detail.stats.drawCalls, 0);assert.equal(detail.stats.triangles, 0);assert.equal(detail.groundFootprints.length, 0);
  assert.equal(inputs[1].w, 0);assert.throws(() => createCityDetail({}), TypeError);detail.dispose();
});
