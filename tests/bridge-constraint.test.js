import test from 'node:test';
import assert from 'node:assert/strict';
import { CatmullRomCurve3, Scene, Vector3 } from 'three';
import { createBridgeDrive } from '../src/bridge-road.js';
import { createBridgeConstraint } from '../src/bridge-constraint.js';
import { createGravityCar, createLandmarks } from '../src/landmarks.js';
import { createDrivingCurve } from '../src/driving-route.js';
import { railCoordinates, project, peninsulaCoast } from '../src/geography.js';

const coast = peninsulaCoast.map(c => project(...c));
function isOnLand(x, z) {
  let inside = false;
  for (let i = 0, j = coast.length - 1; i < coast.length; j = i++) {
    const a = coast[i], b = coast[j];
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
const previousDocument = globalThis.document;
globalThis.document = {createElement: () => ({getContext: () => ({clearRect() {}, fillText() {}})})};
let architecture, car;
try { architecture = createLandmarks(new Scene(), project); car = createGravityCar(); }
finally { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; }
const rail = new CatmullRomCurve3(railCoordinates.map(c => { const p = project(...c); return new Vector3(p.x, .84, p.z); }), false, 'catmullrom', .15);
rail.arcLengthDivisions = 2000; rail.updateArcLengths();
const roadCurve = createDrivingCurve(rail, architecture.colliders, {isOnLand});
roadCurve.arcLengthDivisions = 2000; roadCurve.updateArcLengths();
const bridge = createBridgeDrive({bridge: architecture.bridge, roadCurve, isOnLand});
const scale = .4, halfExtents = {x: car.userData.collisionHalfExtents.x * scale, z: car.userData.collisionHalfExtents.z * scale};
const constraint = createBridgeConstraint(bridge, {halfExtents});
const deck = bridge.segments.find(segment => segment.type === 'deck').curve;
const center = deck.getPointAt(.5);
const close = (a, b, tolerance = 1e-5) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
function lanePoint(offset, longitudinal = 0) { const p = center.clone(); p.x += offset; p.z += longitudinal; return p; }
function assertSupported(position, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (const wheel of car.userData.wheelCenters) {
    // Tire cylinders have .14 model-unit half width and .445 radius. Testing
    // each projected tire corner covers the whole visible tire envelope.
    for (const xSide of [-.14, .14]) for (const zSide of [-.445, .445]) {
      const lx = (wheel.x + xSide) * scale, lz = (wheel.z + zSide) * scale;
      const x = position.x + c * lx + s * lz, z = position.z - s * lx + c * lz;
      const support = bridge.sampleSurface(x, z);
      assert.ok(support || isOnLand(x, z), 'every tire stays on actual pavement or the shared land seam');
      for (const tower of bridge.towerColliders) assert.ok(Math.hypot(x - tower.x, z - tower.z) > tower.r, 'no tire clips a tower pier');
    }
  }
  assert.ok(constraint.inspectPose(position, yaw).valid, 'the full oriented body, including mirrors, fits the paved envelope');
}

test('measured aligned SUV approaches either lane edge without the old circumscribed-circle restriction', () => {
  close(halfExtents.x, .54, 1e-5); close(halfExtents.z, 1.05691, 1e-5);
  for (const side of [-1, 1]) for (const yaw of [0, Math.PI]) {
    const p = lanePoint(side * 1.5);
    assert.equal(bridge.isDrivable(p.x, p.z, 1.18), false, 'old radius incorrectly rejects this safe position');
    assertSupported(p, yaw);
    assert.equal(constraint.inspectPose(lanePoint(side * 1.53), yaw).valid, false, 'body cannot clip the guardrail to gain extra lane width');
  }
});

test('orientation changes allowed lateral position instead of allowing rotated bumpers over water', () => {
  assertSupported(lanePoint(.99), Math.PI / 2);
  assert.equal(constraint.inspectPose(lanePoint(1.02), Math.PI / 2).valid, false);
  assert.equal(constraint.inspectPose(lanePoint(1), Math.PI / 4).valid, false);
  assertSupported(lanePoint(.9), Math.PI / 4);
});

test('a tiny outward crossing slides along the rail and retains nearly all tangential speed', () => {
  const from = lanePoint(1.514), to = from.clone().add(new Vector3(.01, 0, -.15));
  const result = constraint.resolveStep({from, to, yaw: Math.PI});
  assert.ok(result.active && result.valid && result.constrained && !result.blocked);
  close(result.position.z, to.z);
  assert.ok(result.position.x <= center.x + 1.5151);
  assert.ok(result.speedScale > .995, 'grazing the rail does not abruptly kill velocity');
  assertSupported(result.position, result.yaw);
  close(from.x, center.x + 1.514); close(to.x, center.x + 1.524); // Inputs are never mutated.
});

test('repeated rail contact preserves forward travel across the deck-to-ramp seam without tire or tower overlap', () => {
  let p = lanePoint(-1.5, 2.5), total = 0;
  for (let i = 0; i < 70; i++) {
    const result = constraint.resolveStep({from: p, to: p.clone().add(new Vector3(-.025, 0, -.15)), yaw: Math.PI});
    assert.ok(result.valid && !result.blocked);
    total += p.z - result.position.z; p = result.position;
    assertSupported(p, result.yaw);
  }
  close(total, 10.5);
});

test('Marin quarters support near-edge driving with the actual tangent heading around the entire turnaround', () => {
  for (const segment of bridge.segments.filter(segment => segment.type === 'turnaround')) {
    for (let i = 0; i <= 16; i++) {
      const t = i / 16, p = segment.curve.getPointAt(t), tangent = segment.curve.getTangentAt(t), yaw = Math.atan2(tangent.x, tangent.z);
      const right = new Vector3(tangent.z, 0, -tangent.x).normalize();
      for (const offset of [-1.3, 0, 1.3]) assertSupported(p.clone().addScaledVector(right, offset), yaw);
    }
  }
});

test('continued outward input around a Marin bend slides along the curved pavement without stalling or hopping its island', () => {
  const curve = bridge.segments.find(segment => segment.type === 'turnaround').curve;
  const startTangent = curve.getTangentAt(0), startNormal = new Vector3(startTangent.z, 0, -startTangent.x).normalize();
  let position = curve.getPointAt(0).addScaledVector(startNormal, 1.3), yaw = Math.atan2(startTangent.x, startTangent.z);
  let constrained = 0;
  for (let i = 1; i <= 40; i++) {
    const t = i / 40, tangent = curve.getTangentAt(t), normal = new Vector3(tangent.z, 0, -tangent.x).normalize();
    const requested = curve.getPointAt(t).addScaledVector(normal, 1.6), nextYaw = Math.atan2(tangent.x, tangent.z);
    const result = constraint.resolveStep({from: position, to: requested, previousYaw: yaw, yaw: nextYaw});
    assert.ok(result.valid && !result.blocked, 'curve-edge steering keeps moving');
    assert.ok(position.distanceTo(result.position) < .4, 'edge recovery remains a small continuous move');
    if (result.constrained) constrained++;
    assertSupported(result.position, result.yaw);
    position = result.position; yaw = result.yaw;
  }
  assert.ok(constrained > 30, 'the regression actually exercises curved edge correction');
  assert.ok(position.distanceTo(curve.getPointAt(1)) < 1.65, 'the car completes the quarter turn');
});

test('all approach/deck/turnaround seams accept a footprint straddling their true joined pavement', () => {
  for (let i = 0; i < bridge.segments.length; i++) {
    const curve = bridge.segments[i].curve, point = curve.getPointAt(0), tangent = curve.getTangentAt(0), yaw = Math.atan2(tangent.x, tangent.z);
    assertSupported(point, yaw);
    const next = point.clone().addScaledVector(tangent, .12), previous = point.clone().addScaledVector(tangent, -.12);
    const result = constraint.resolveStep({from: previous, to: next, yaw});
    assert.ok(result.valid, `safe seam ${bridge.segments[i].id}`);
  }
});

test('steering near a rail gives the bumper room or limits the turn while keeping a safe smooth pose', () => {
  const from = lanePoint(1.51), to = from.clone().add(new Vector3(.015, 0, -.14));
  const result = constraint.resolveStep({from, to, previousYaw: Math.PI, yaw: Math.PI - .07});
  assert.ok(result.valid && result.constrained);
  assert.ok(Math.abs(result.yaw - Math.PI) <= .070001);
  assert.ok(result.position.distanceTo(from) < .3, 'small turn corrections do not teleport the car');
  assertSupported(result.position, result.yaw);
});

test('oriented rectangle versus pier collision catches an obstacle inside the body and sweeps prevent crossing it', () => {
  const obstacle = {x: center.x, z: center.z - 1.8, r: .18};
  const guarded = createBridgeConstraint(bridge, {halfExtents, colliders: [obstacle]});
  assert.equal(guarded.inspectPose(new Vector3(obstacle.x, 2.4, obstacle.z), 0).valid, false, 'interior overlap cannot hide between sampled corners');
  const result = guarded.resolveStep({from: center, to: center.clone().add(new Vector3(0, 0, -.8)), yaw: Math.PI});
  assert.ok(result.valid && result.constrained);
  assert.ok(guarded.inspectPose(result.position, result.yaw).clearance >= -1e-6);
  assert.ok(result.position.z > obstacle.z + halfExtents.z + obstacle.r, 'car stays on the approach side of the pier');
});

test('ordinary off-bridge land remains under the world collision rules and malformed dimensions are refused', () => {
  const from = roadCurve.getPointAt(.5), to = from.clone().add(new Vector3(.1, 0, .1));
  const result = constraint.resolveStep({from, to, yaw: .2});
  assert.equal(result.active, false);
  close(result.position.distanceTo(to), 0);
  assert.throws(() => createBridgeConstraint(bridge, {halfExtents: {x: 0, z: 1}}), TypeError);
  assert.throws(() => constraint.resolveStep({from, to, yaw: NaN}), TypeError);
});
