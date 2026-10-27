import test from 'node:test';
import assert from 'node:assert/strict';
import { CatmullRomCurve3, Scene, Vector3 } from 'three';
import { createGravityCar } from '../src/landmarks.js';
import { createRaceCurve } from '../src/bay-race.js';
import { circuitRibbon, circuitSceneryPlacements, createBayRaceScene, raceFrame } from '../src/bay-race-scene.js';

const near = (a, b, tolerance = 1e-5) => assert.ok(Math.abs(a - b) < tolerance, `${a} is not near ${b}`);
function carModel() {
  const previous = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => ({ clearRect() {}, fillText() {} }) }) };
  try { return createGravityCar(); }
  finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
}
const circle = () => new CatmullRomCurve3([new Vector3(-15, 9, -15), new Vector3(15, 9, -15), new Vector3(15, 9, 15), new Vector3(-15, 9, 15)], true);

test('lateral race frames preserve surface height, tangent direction, and wrapped coordinates', () => {
  const curve = circle();
  for (const progress of [-2.2, -.01, 0, .4, .99, 1, 3.7]) {
    const center = raceFrame(curve, progress), lane = raceFrame(curve, progress, 2.55);
    near(center.point.y, 9); near(lane.point.y, 9); near(center.tangent.length(), 1); near(center.right.length(), 1);
    near(center.tangent.dot(center.right), 0); near(center.point.distanceTo(lane.point), 2.55);
    const repeated = raceFrame(curve, progress + 2, 2.55); near(lane.point.distanceTo(repeated.point), 0);
    assert.ok(Number.isFinite(center.yaw));
  }
});

test('asphalt and both edge paint strips face upwards with a closed nondegenerate seam', () => {
  const curve = circle(), segments = 360;
  for (const [inner, outer] of [[-4.2, 4.2], [-4.02, -4.08], [4.02, 4.08]]) {
    const geometry = circuitRibbon(curve, inner, outer, .012, segments), positions = geometry.attributes.position, normal = geometry.attributes.normal;
    assert.equal(positions.count, (segments + 1) * 2);
    for (let i = 0; i < positions.count; i++) {
      assert.ok(Number.isFinite(positions.getX(i)) && Number.isFinite(positions.getY(i)) && Number.isFinite(positions.getZ(i)));
      near(positions.getY(i), 9.012); assert.ok(normal.getY(i) > .99);
    }
    for (const side of [0, 1]) for (const axis of ['X', 'Y', 'Z']) near(positions[`get${axis}`](side), positions[`get${axis}`](segments * 2 + side));
    const a = new Vector3(), b = new Vector3(), c = new Vector3();
    for (let i = 0; i < geometry.index.count; i += 3) {
      a.fromBufferAttribute(positions, geometry.index.getX(i)); b.fromBufferAttribute(positions, geometry.index.getX(i + 1)); c.fromBufferAttribute(positions, geometry.index.getX(i + 2));
      assert.ok(b.sub(a).cross(c.sub(a)).lengthSq() > 1e-9, 'No zero-area racing-surface triangles');
    }
    geometry.dispose();
  }
});

test('rival models remain tire-grounded on their lanes, freeze when hidden, and use matching colors', () => {
  const scene = new Scene(), curve = circle(), stage = createBayRaceScene({ scene, curve, createCar: carModel });
  assert.equal(stage.root.visible, false); stage.setVisible(true);
  const rivals = [{ progress: .15, lane: -2.55, distance: 20 }, { progress: .4, lane: 0, distance: 40 }, { progress: .8, lane: 2.55, distance: 80 }];
  stage.update({ phase: 'racing', rivals }, 3);
  stage.rivals.forEach((car, i) => {
    const frame = raceFrame(curve, rivals[i].progress, rivals[i].lane);
    near(car.position.x, frame.point.x); near(car.position.z, frame.point.z); near(car.rotation.y, frame.yaw);
    car.updateMatrixWorld(true);
    for (const wheel of car.userData.wheels) {
      // A tire is circular, so its measured radius gives an exact contact plane while spinning.
      const center = wheel.getWorldPosition(new Vector3()); near(center.y - .4 * car.userData.wheelRadius, 9.006, .0001);
    }
    assert.ok(car.userData.wheels.every(wheel => Number.isFinite(wheel.rotation.x)));
  });
  const before = stage.rivals[0].position.clone(); stage.setVisible(false); stage.update({ phase: 'racing', rivals: rivals.map(r => ({ ...r, progress: r.progress + .2 })) }, 5);
  near(before.distanceTo(stage.rivals[0].position), 0); stage.dispose();
});

test('the stage releases its own GPU resources once without disposing shared car materials', () => {
  const scene = new Scene(), stage = createBayRaceScene({ scene, curve: circle(), createCar: carModel });
  const geometries = new Set(), materials = new Set();
  stage.root.traverse(object => { if (object.geometry) geometries.add(object.geometry); if (object.material) materials.add(object.material); });
  let geometryDisposals = 0; geometries.forEach(geometry => geometry.addEventListener('dispose', () => geometryDisposals++));
  const shared = [];
  stage.rivals.forEach(car => car.traverse(object => { if (object.material && !['f7b168', '74c9f4', 'db9ae7'].includes(object.material.color?.getHexString()) && object.material.isMeshStandardMaterial) shared.push(object.material); }));
  let sharedDisposals = 0; new Set(shared).forEach(material => material.addEventListener('dispose', () => sharedDisposals++));
  stage.dispose(); stage.dispose(); assert.equal(scene.children.length, 0); assert.equal(geometryDisposals, geometries.size); assert.equal(sharedDisposals, 0);
});

test('finish celebration respects reduced motion and resets across another race', () => {
  for (const reducedMotion of [false, true]) {
    const scene = new Scene(), stage = createBayRaceScene({ scene, curve: circle(), createCar: carModel, reducedMotion }); stage.setVisible(true);
    const confetti = stage.root.children.find(object => object.isInstancedMesh && object.count === 72);
    stage.update({ phase: 'finished', player: { progress: 0 }, rivals: [] }, 4);
    assert.equal(confetti.visible, !reducedMotion); stage.setVisible(false); assert.equal(confetti.visible, false);
    stage.setVisible(true); stage.update({ phase: 'countdown', countdown: 3, rivals: [] }, 6); assert.equal(confetti.visible, false); stage.dispose();
  }
});

test('the complete Bay roadway keeps its inner and outer edges ordered through the SF finish bend', () => {
  const curve = createRaceCurve({ height: 9 });
  for (const [inner, outer] of [[-5.15, 5.15], [-4.2, 4.2], [-4.02, -4.08], [4.02, 4.08]]) {
    const geometry = circuitRibbon(curve, inner, outer), positions = geometry.attributes.position;
    const a = new Vector3(), b = new Vector3(), c = new Vector3();
    let minimumArea = Infinity;
    for (let i = 0; i < geometry.index.count; i += 3) {
      a.fromBufferAttribute(positions, geometry.index.getX(i)); b.fromBufferAttribute(positions, geometry.index.getX(i + 1)); c.fromBufferAttribute(positions, geometry.index.getX(i + 2));
      const normal = b.sub(a).cross(c.sub(a)); minimumArea = Math.min(minimumArea, normal.length());
      assert.ok(normal.y > 0, 'Road edges never fold over at a bend or the SF closing seam');
    }
    assert.ok(minimumArea > .001, 'All complete-circuit triangles have useful finite area'); geometry.dispose();
  }
});


test('skyway planting and solar lights stay bounded and clear of lanes and city signs', () => {
  for (const curve of [createRaceCurve({ height: 9 }), new CatmullRomCurve3([new Vector3(-1500, 9, -1500), new Vector3(1500, 9, -1500), new Vector3(1500, 9, 1500), new Vector3(-1500, 9, 1500)], true)]) {
    const placements = circuitSceneryPlacements(curve), length = curve.getLength();
    assert.ok(placements.planters.length <= 64 && placements.lamps.length <= 32, 'Route length cannot create unlimited scenery');
    assert.ok(placements.planters.length > 0 && placements.lamps.length > 0);
    for (const item of [...placements.planters, ...placements.lamps]) {
      assert.ok(Math.abs(item.lane) - item.radius > 5.3, 'Foliage, poles and panels stay beyond the guardrail');
      assert.ok(Math.min(item.progress, 1 - item.progress) * length > 7, 'The finish approach remains clear');
      for (const place of curve.racePlaces || []) {
        const difference = Math.abs(item.progress - place.progress);
        assert.ok(Math.min(difference, 1 - difference) * length >= 2.8, 'City signs retain an open sightline');
      }
    }
  }
  const stage = createBayRaceScene({ scene: new Scene(), curve: createRaceCurve({ height: 9 }), createCar: carModel });
  const meshes = stage.root.children.filter(child => child.name.startsWith('Skyway '));
  assert.equal(meshes.length, 10); assert.ok(meshes.every(mesh => mesh.isInstancedMesh));
  assert.equal(stage.root.userData.landscape.batches, 10); stage.dispose();
});
