import test from 'node:test';
import assert from 'node:assert/strict';
import { AdditiveBlending, Color, LineCurve3, Matrix4, Scene, ShaderLib, Vector3 } from 'three';
import { createPlayground, energyPodPlacements, sweptPodContact } from '../src/playground.js';
import { createRaceCurve } from '../src/bay-race.js';

const point = (x, y = .8, z = 0) => new Vector3(x, y, z);
const road = (length = 40) => new LineCurve3(point(0, .79), point(length, .79));
const cargoLane = (x, y = .8) => point(x, y, 1.45);
const passCargo = (game, options = {}) => {
  game.update({dt: .016, carPosition: cargoLane(0), carSpeed: 16, ...options});
  game.update({dt: .016, carPosition: cargoLane(40), carSpeed: 16, ...options});
};

test('journey cargo stays sparse, alternates sides and leaves the guided line and approaches clear', () => {
  const roadCurve = road(400), bridgeDrive = {curve: new LineCurve3(point(0, .79), point(-100, 8.79))};
  const placements = energyPodPlacements({roadCurve, bridgeDrive, sampleHeight: x => ({height: x < 0 ? .79 - x * .08 : .79})});
  assert.ok(placements.some(p => p.route === 'bridge') && placements.some(p => p.route === 'road'));
  assert.equal(placements.filter(p => p.route === 'road').length, 10);
  assert.equal(placements.filter(p => p.route === 'bridge').length, 3);
  for (const placement of placements) {
    assert.ok([placement.position.x, placement.position.y, placement.position.z, placement.t].every(Number.isFinite));
    const curve = placement.route === 'bridge' ? bridgeDrive.curve : roadCurve, center = curve.getPointAt(placement.t);
    assert.ok(Math.abs(Math.hypot(center.x - placement.position.x, center.z - placement.position.z) - 1.45) < 1e-6, 'Crates occupy side lanes');
    assert.equal(sweptPodContact(curve.getPointAt(Math.max(0, placement.t - .01)), curve.getPointAt(Math.min(1, placement.t + .01)), placement.position), false, 'A normal guided centerline trip avoids cargo');
    assert.ok(Math.abs(center.y - placement.position.y) < 1e-6, 'Bridge pickups follow the elevated surface');
    assert.ok(placement.t * curve.getLength() >= 12 - 1e-6 && (1 - placement.t) * curve.getLength() >= 12 - 1e-6, 'Both route ends have a clear approach');
    for (const other of placements) if (placement !== other) assert.ok(Math.hypot(placement.position.x - other.position.x, placement.position.z - other.position.z) >= 22 - 1e-6, 'Nearby routes cannot cluster cargo either');
  }
  const sides = placements.filter(p => p.route === 'road').map(p => Math.sign(p.position.z));
  assert.deepEqual(sides, [1, -1, 1, -1, 1, -1, 1, -1, 1, -1]);
  assert.deepEqual(energyPodPlacements({roadCurve: road(20)}), [], 'Short roads remain entirely clear');
});

test('the full Bay Circuit has only a handful of optional side-lane crates and a clear grid', () => {
  const curve = createRaceCurve({height: 9}), placements = energyPodPlacements({roadCurve: curve, profile: 'race'});
  assert.ok(placements.length >= 6 && placements.length <= 8, `${placements.length} crates over the entire circuit`);
  for (const pod of placements) {
    const center = curve.getPointAt(pod.t);
    assert.ok(Math.abs(center.distanceTo(pod.position) - 2.75) < 1e-6);
    assert.ok(Math.min(pod.t, 1 - pod.t) * curve.getLength() >= 18 - 1e-6, 'The start and finish grid remain clear');
    for (const other of placements) if (pod !== other) assert.ok(pod.position.distanceTo(other.position) >= 48 - 1e-6, 'The loop seam and corners do not crowd crates');
  }
});

test('reserved arrival and boost areas stay free of cargo', () => {
  const roadCurve = road(400), before = energyPodPlacements({roadCurve});
  const reservation = {...before[3].position, radius: 6};
  const after = energyPodPlacements({roadCurve, reservedAreas: [reservation, {x: NaN, z: 0}]});
  assert.equal(after.length, before.length - 1);
  assert.ok(after.every(p => Math.hypot(p.position.x - reservation.x, p.position.z - reservation.z) >= reservation.radius));
});

test('swept contact catches a fast pass and rejects the road beneath an elevated bridge', () => {
  assert.equal(sweptPodContact(point(-10), point(10), point(0, .79)), true, 'Both frame endpoints can lie beyond the pickup');
  assert.equal(sweptPodContact(point(-10), point(10), point(0, 4)), false);
  assert.equal(sweptPodContact(point(-10, 4), point(10, 4), point(0, 4)), true);
  assert.equal(sweptPodContact(point(-10, .8, 2), point(10, .8, 2), point(0, .79)), false);
  assert.equal(sweptPodContact(point(NaN), point(10), point(0)), false);
});

test('manual movement can chase cargo while centerline travel never causes repeated bumps', () => {
  const scene = new Scene(), events = [], game = createPlayground({scene, roadCurve: road(), onBurst: value => events.push(value)});
  game.update({dt: .016, carPosition: point(0), carSpeed: 14});
  game.update({dt: .016, carPosition: point(40), carSpeed: 14});
  assert.equal(events.length, 0, 'The guided centerline remains clear');
  passCargo(game);
  assert.equal(events.length, 1);assert.equal(events[0].count, 1);assert.equal(events[0].total, 1);
  assert.ok(events[0].position.isVector3);assert.ok(events[0].intensity > 0 && events[0].intensity <= 1);
  game.update({dt: .016, carPosition: cargoLane(0), carSpeed: -14});
  assert.equal(events.length, 1, 'A reverse pass during cooldown does not repeatedly score the same pods');
  assert.equal(game.stats.activePods, game.stats.pods - 1);game.dispose();assert.equal(scene.children.length, 0);
});

test('pause freezes cooldown and particles; pickups return only after active game time', () => {
  const scene = new Scene(), events = [], game = createPlayground({scene, roadCurve: road(), onBurst: value => events.push(value)});
  passCargo(game);
  assert.equal(game.stats.bursts, 1);const before = game.stats.activeShards;
  for (let i = 0; i < 200; i++) game.update({dt: .1, paused: true, carPosition: point(0), carSpeed: 10});
  assert.equal(game.stats.activeShards, before);assert.equal(game.stats.activePods, 0);
  game.update({dt: .05, carPosition: cargoLane(40), carSpeed: 10});assert.equal(events.length, 1);
  for (let i = 0; i < 200; i++) game.update({dt: .1, carPosition: cargoLane(40), carSpeed: 0});
  assert.equal(game.stats.activePods, 0, 'Cargo does not return during a quick return trip');
  for (let i = 0; i < 360; i++) game.update({dt: .1, carPosition: cargoLane(40), carSpeed: 0});
  assert.equal(game.stats.activePods, 1);assert.equal(game.stats.activeShards, 0);
  game.update({dt: .05, carPosition: cargoLane(0), carSpeed: -10});assert.equal(events.length, 2);game.dispose();
});

test('race cargo stays absent for ninety active seconds after a hit', () => {
  const roadCurve = road(418), scene = new Scene(), game = createPlayground({scene, roadCurve, profile: 'race'});
  const first = energyPodPlacements({roadCurve, profile: 'race'})[0].position;
  game.update({dt: .016, carPosition: first.clone().add(point(-4, 0)), carSpeed: 16});
  game.update({dt: .016, carPosition: first.clone().add(point(4, 0)), carSpeed: 16});
  assert.equal(game.stats.bursts, 1);
  for (let i = 0; i < 600; i++) game.update({dt: .1, carSpeed: 0});
  assert.equal(game.stats.activePods, game.stats.pods - 1, 'No new obstacle respawns in front of a later lap');
  for (let i = 0; i < 310; i++) game.update({dt: .1, carSpeed: 0});
  assert.equal(game.stats.activePods, game.stats.pods);game.dispose();
});

test('large burst sweeps have fixed GPU pools, bounded debris, and deterministic teardown', () => {
  const scene = new Scene(), game = createPlayground({scene, roadCurve: road(600)}), root = scene.children[0];
  const renderObjectCount = root.children.length, disposal = [];
  root.children.forEach(mesh => {mesh.geometry.addEventListener('dispose', () => disposal.push(mesh.name));});
  for (const pod of energyPodPlacements({roadCurve: road(600)})) {
    game.update({dt: .016, carPosition: pod.position.clone().add(point(-2, 0)), carSpeed: 30});
    game.update({dt: .016, carPosition: pod.position.clone().add(point(2, 0)), carSpeed: 30});
  }
  assert.equal(game.stats.bursts, game.stats.pods);assert.equal(root.children.length, renderObjectCount);
  assert.ok(game.stats.activeShards <= game.stats.capacity.shards);assert.ok(game.stats.activeSparks <= game.stats.capacity.sparks);assert.ok(game.stats.activeRings <= game.stats.capacity.rings);
  for (let i = 0; i < 20; i++) game.update({dt: .05, carPosition: point(602), carSpeed: 0});
  assert.ok(game.stats.activeFireballs <= game.stats.capacity.fireballs);assert.ok(game.stats.activeSmoke <= game.stats.capacity.smoke);
  const mesh = root.children.find(child => child.name === 'Pooled metal debris'), matrix = new Matrix4(), position = new Vector3();
  for (let i = 0; i < mesh.count; i++) {mesh.getMatrixAt(i, matrix);position.setFromMatrixPosition(matrix);assert.ok([position.x, position.y, position.z].every(Number.isFinite));assert.ok(Math.abs(position.z) < 4.6, 'Debris remains close to the side-lane cargo');}
  game.dispose();game.dispose();assert.equal(scene.children.length, 0);assert.equal(disposal.length, renderObjectCount);
});

test('cargo containers have closed solid metal shells, reinforced corners and grounded static poses', () => {
  const scene = new Scene(), game = createPlayground({scene, roadCurve: road()}), root = scene.children[0];
  const shell = root.children.find(mesh => mesh.name === 'Solid metallic cargo shells');
  const hardware = root.children.find(mesh => mesh.name === 'Cargo reinforced corners and lids');
  assert.ok(shell && hardware);
  assert.equal(shell.geometry.type, 'BoxGeometry');assert.equal(shell.geometry.index.count, 36, 'six closed faces replace an open cage');
  assert.ok(shell.material.metalness > .9 && hardware.material.metalness > .9);
  assert.ok(shell.material.roughness > .1 && shell.material.roughness < .4);
  assert.ok(!root.children.some(mesh => /cage|luminous core/i.test(mesh.name)));
  const before = new Matrix4(), after = new Matrix4();shell.getMatrixAt(0, before);
  game.update({dt: .1, carPosition: point(-20), carSpeed: 0});shell.getMatrixAt(0, after);
  assert.deepEqual(before.toArray(), after.toArray(), 'heavy crates do not float or rotate above the road');
  hardware.geometry.computeBoundingBox();
  const translation = new Vector3().setFromMatrixPosition(before);
  assert.ok(translation.y + hardware.geometry.boundingBox.min.y >= .79, 'lowest skid clears the actual road surface');
  assert.ok(root.children.length <= 9, 'all crates and effects share a small fixed set of draw calls');
  game.dispose();
});

test('impact expands a hot yellow-orange fireball, leaves fading smoke and throws metallic plate debris', () => {
  const scene = new Scene(), game = createPlayground({scene, roadCurve: road()}), root = scene.children[0];
  const fire = root.children.find(mesh => mesh.name === 'Pooled orange yellow fireballs');
  const smoke = root.children.find(mesh => mesh.name === 'Pooled rising explosion smoke');
  const debris = root.children.find(mesh => mesh.name === 'Pooled metal debris');
  passCargo(game);
  assert.equal(game.stats.activeFireballs, 4);assert.equal(game.stats.activeSmoke, 6);
  assert.equal(fire.material.blending, AdditiveBlending);assert.equal(fire.material.depthWrite, false);
  assert.equal(debris.geometry.type, 'BoxGeometry');assert.ok(debris.material.metalness > .9);
  const matrix = new Matrix4(), firstSize = new Vector3(), laterSize = new Vector3(), hot = new Color();
  fire.getMatrixAt(0, matrix);firstSize.setFromMatrixScale(matrix);fire.getColorAt(0, hot);
  assert.ok(hot.r > hot.g && hot.g > hot.b && hot.r > 1, 'fire emits bright warm light colors');
  game.update({dt: .1, carPosition: point(8), carSpeed: 0});
  fire.getMatrixAt(0, matrix);laterSize.setFromMatrixScale(matrix);
  assert.ok(laterSize.x > firstSize.x * 1.8, 'the fireball visibly expands after impact');
  assert.ok(fire.geometry.getAttribute('burstOpacity').getX(0) > .2);
  for (let i = 0; i < 8; i++) game.update({dt: .1, carPosition: point(8), carSpeed: 0});
  assert.equal(game.stats.activeFireballs, 0);assert.ok(game.stats.activeSmoke > 0, 'smoke outlives the initial flame');
  assert.ok(smoke.geometry.getAttribute('burstOpacity').array.some(alpha => alpha > 0 && alpha < .6), 'smoke uses per-instance transparency rather than opaque black balls');
  for (let i = 0; i < 20; i++) game.update({dt: .1, carPosition: point(8), carSpeed: 0});
  assert.equal(game.stats.activeSmoke, 0);assert.ok(smoke.geometry.getAttribute('burstOpacity').array.every(alpha => alpha === 0));
  game.dispose();
});

test('fire and smoke shader hooks integrate with the real Three basic shader and retain valid GLSL line breaks', () => {
  const scene = new Scene(), game = createPlayground({scene, roadCurve: road()});
  for (const name of ['Pooled orange yellow fireballs', 'Pooled rising explosion smoke']) {
    const mesh = scene.children[0].children.find(child => child.name === name);
    const shader = {uniforms: {}, vertexShader: ShaderLib.basic.vertexShader, fragmentShader: ShaderLib.basic.fragmentShader};
    mesh.material.onBeforeCompile(shader);
    assert.ok(shader.uniforms.uBurstTime && Number.isFinite(shader.uniforms.uBurstTime.value));
    assert.ok(shader.vertexShader.includes('vCloudView=-mvPosition.xyz;'));
    assert.ok(shader.fragmentShader.includes('diffuseColor.a*=vBurstOpacity*feather'));
    assert.equal(shader.vertexShader.includes('\\n'), false, 'escaped text cannot break the GPU shader');
    assert.equal(shader.fragmentShader.includes('\\n'), false);
    assert.equal(mesh.geometry.getAttribute('burstOpacity').count, mesh.count);
    if (name.includes('fireballs')) {
      assert.ok(shader.fragmentShader.includes('burstFbm(flow)') && shader.fragmentShader.includes('feather*density'), 'fire uses animated turbulent density and broken edges');
      assert.ok(shader.vertexShader.includes('transformed.y+=crown*'), 'the flame silhouette includes rising tongues');
    }
  }
  game.dispose();
});

test('late expanding fire decays quickly instead of leaving a translucent spherical bubble', () => {
  const scene = new Scene(), game = createPlayground({scene, roadCurve: road()}), fire = scene.children[0].children.find(mesh => mesh.name === 'Pooled orange yellow fireballs');
  passCargo(game);
  game.update({dt: .08, carPosition: point(8), carSpeed: 0});
  const peak = Math.max(...fire.geometry.getAttribute('burstOpacity').array);
  assert.ok(peak > .5, 'the initial burst has dense hot cores');
  for (let i = 0; i < 5; i++) game.update({dt: .08, carPosition: point(8), carSpeed: 0});
  const late = Math.max(...fire.geometry.getAttribute('burstOpacity').array);
  assert.ok(late < peak * .2, 'the final large-radius stage has little residual glow');
  assert.ok(game.stats.activeSmoke > 0, 'dark smoke carries the aftermath');
  game.dispose();
});

test('ECO preserves the fireball with fewer particles and pause/reset freeze and clear every new pool', () => {
  const scene = new Scene(), game = createPlayground({scene, roadCurve: road()}), root = scene.children[0];
  passCargo(game, {carSpeed: 12, quality: 'eco'});
  assert.equal(game.stats.activeFireballs, 2);assert.equal(game.stats.activeSmoke, 3);
  assert.equal(game.stats.activeShards, 10);assert.equal(game.stats.activeSparks, 10);
  const fire = root.children.find(mesh => mesh.name === 'Pooled orange yellow fireballs'), matrix = fire.instanceMatrix.array.slice(), opacity = fire.geometry.getAttribute('burstOpacity').array.slice();
  for (let i = 0; i < 100; i++) game.update({dt: .1, paused: true, carPosition: point(8)});
  assert.deepEqual(fire.instanceMatrix.array, matrix);assert.deepEqual(fire.geometry.getAttribute('burstOpacity').array, opacity);
  assert.equal(game.stats.activePods, 0);
  game.reset();assert.equal(game.stats.activeFireballs, 0);assert.equal(game.stats.activeSmoke, 0);
  assert.ok(fire.geometry.getAttribute('burstOpacity').array.every(alpha => alpha === 0));
  assert.equal(game.stats.activePods, game.stats.pods);game.dispose();
});

test('reset clears stale sweeps and reduced motion removes flying debris', () => {
  const scene = new Scene(), game = createPlayground({scene, roadCurve: road(), reducedMotion: true});
  passCargo(game, {carSpeed: 10});
  assert.equal(game.stats.bursts, 1);assert.equal(game.stats.activeShards, 0);assert.equal(game.stats.activeSparks, 0);assert.equal(game.stats.activeRings, 1);
  assert.equal(game.stats.activeFireballs, 0);assert.equal(game.stats.activeSmoke, 0);
  game.reset();game.update({dt: .016, carPosition: point(-20), carSpeed: 0});game.reset();game.update({dt: .016, carPosition: point(20), carSpeed: 0});
  assert.equal(game.stats.bursts, 0, 'A reset/teleport must not burst pickups along a stale journey');assert.equal(game.stats.activePods, game.stats.pods);game.dispose();
});
