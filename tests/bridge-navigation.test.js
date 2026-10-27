import test from 'node:test';
import assert from 'node:assert/strict';
import { CatmullRomCurve3, Scene, Vector3 } from 'three';
import { createBridgeDrive } from '../src/bridge-road.js';
import { createDrivingNavigator } from '../src/bridge-navigation.js';
import { createDrivingCurve, nearestCurveParameter } from '../src/driving-route.js';
import { createLandmarks } from '../src/landmarks.js';
import { project, railCoordinates, peninsulaCoast, stops } from '../src/geography.js';

const land = peninsulaCoast.map(c => project(...c));
const onLand = (x, z) => {
  let inside = false;
  for (let i = 0, j = land.length - 1; i < land.length; j = i++) {
    const a = land[i], b = land[j];
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
};
const close = (a, b, tolerance = 1e-5) => assert.ok(a.distanceTo(b) < tolerance, `${a.toArray()} != ${b.toArray()}`);
const length = points => points.slice(1).reduce((total, point, i) => total + point.distanceTo(points[i]), 0);

function fixture() {
  const previous = globalThis.document;
  globalThis.document = {createElement: () => ({getContext: () => ({clearRect() {}, fillText() {}})})};
  let architecture;
  try { architecture = createLandmarks(new Scene(), project); }
  finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
  const rail = new CatmullRomCurve3(railCoordinates.map(c => { const p = project(...c); return new Vector3(p.x, .84, p.z); }), false, 'catmullrom', .15);
  rail.arcLengthDivisions = 2000; rail.updateArcLengths();
  const road = createDrivingCurve(rail, architecture.colliders, {isOnLand: onLand});
  road.arcLengthDivisions = 2000; road.updateArcLengths();
  const bridge = createBridgeDrive({bridge: architecture.bridge, roadCurve: road, isOnLand: onLand});
  const navigator = createDrivingNavigator({roadCurve: road, bridgeDrive: bridge, colliders: architecture.colliders, isOnLand: onLand});
  return {architecture, road, bridge, navigator};
}
const {architecture, road, bridge, navigator} = fixture();

test('all five resume destinations return from the elevated deck, both ramps and every Marin turnaround quarter by pavement', () => {
  const origins = bridge.segments.flatMap(segment => [.15, .55, .9].map(u => segment.curve.getPointAt(u)));
  for (const start of origins) for (const stop of stops) {
    const destinationT = nearestCurveParameter(stop, road), destination = road.getPointAt(destinationT);
    const route = navigator.toRoad(start, destinationT);
    assert.ok(route.fromBridge, `${stop.id} recognizes bridge origin`);
    assert.ok(route.points.length > 1, `${stop.id} has immediate guidance`);
    assert.ok(Number.isInteger(route.bridgeExitIndex));
    close(route.points[route.bridgeExitIndex], bridge.join.point);
    close(route.points.at(-1), destination);
    let previous = start;
    for (let i = 0; i < route.points.length; i++) {
      const point = route.points[i];
      assert.ok(previous.distanceTo(point) <= .245, 'no gap or teleport across the water');
      if (i <= route.bridgeExitIndex) {
        const surface = bridge.sampleSurface(point.x, point.z);
        assert.ok(surface, 'all bridge-return waypoints stay on the authored bridge road');
        assert.ok(Math.abs(surface.height - point.y) < .003, 'ramp elevation remains continuous');
      } else {
        assert.ok(onLand(point.x, point.z), 'after the exact junction, guidance stays on Peninsula land');
        for (const collider of architecture.colliders) assert.ok(Math.hypot(point.x - collider.x, point.z - collider.z) > collider.r + 2.35, 'resume road clears architecture');
      }
      previous = point;
    }
  }
});

test('an off-center bridge driver reconnects laterally inside pavement before returning to San Francisco', () => {
  const deck = bridge.segments.find(segment => segment.type === 'deck').curve;
  const center = deck.getPointAt(.7), tangent = deck.getTangentAt(.7), start = center.clone().add(new Vector3(tangent.z, 0, -tangent.x).multiplyScalar(.75));
  start.y += .006;
  const route = navigator.toRoad(start, .8);
  assert.equal(route.fromBridge, true);
  for (let i = 0; i <= 25; i++) {
    const point = start.clone().lerp(route.points[0], i / 25);
    assert.ok(bridge.isDrivable(point.x, point.z, 1.18), 'lateral reconnection keeps the entire car inside the guardrails');
  }
  close(route.points[route.bridgeExitIndex], bridge.join.point);
});

test('Marin return chooses the short remaining arc of the closed loop without crossing its center', () => {
  const last = bridge.segments.at(-1), start = last.curve.getPointAt(.8);
  const route = navigator.bridgePath(start, bridge.northFoot);
  close(route.at(-1), bridge.northFoot);
  assert.ok(length([start, ...route]) < last.curve.getLength() * .21, 'return uses the final fifth of the quarter, not the other three quarters');
  for (const point of route) {
    const radius = Math.hypot(point.x - bridge.turnaround.center.x, point.z - bridge.turnaround.center.z);
    assert.ok(radius >= bridge.turnaround.radius - .003, 'the guide never cuts across the turnaround island');
  }
});

test('Golden Gate is reachable as a Drive EV destination from the road, deck and north approach', () => {
  const destination = bridge.segments.find(segment => segment.type === 'deck').curve.getPointAt(.5);
  const roadRoute = navigator.toBridge(road.getPointAt(.65));
  assert.equal(roadRoute.fromBridge, false);
  close(roadRoute.points.at(-1), destination);
  const join = roadRoute.points.findIndex(point => point.distanceTo(bridge.join.point) < 1e-5);
  assert.ok(join >= 0, 'outbound journey enters at the exact road-to-ramp junction');
  for (const point of roadRoute.points.slice(join)) assert.ok(bridge.contains(point.x, point.z, .003));
  for (const segment of bridge.segments) {
    const route = navigator.toBridge(segment.curve.getPointAt(.6));
    assert.equal(route.fromBridge, true);
    assert.ok(route.points.length);
    close(route.points.at(-1), destination);
  }
});

test('a second resume request mid-return plans from the current bridge position and reaches its new stop', () => {
  const original = navigator.toRoad(bridge.segments.at(-1).curve.getPointAt(.25), .95);
  const current = original.points[Math.floor(original.bridgeExitIndex / 2)];
  const redirected = navigator.toRoad(current, .2);
  assert.ok(redirected.fromBridge);
  close(redirected.points[0], current, .001);
  close(redirected.points.at(-1), road.getPointAt(.2));
  close(redirected.points[redirected.bridgeExitIndex], bridge.join.point);
});

test('same-point bridge guidance remains a valid arrival and ordinary road guidance does not detour to the bridge', () => {
  const midpoint = bridge.segments.find(segment => segment.type === 'deck').curve.getPointAt(.5);
  const same = navigator.toBridge(midpoint);
  assert.ok(same.points.length);
  close(same.points.at(-1), midpoint);
  const roadStart = road.getPointAt(.5), route = navigator.toRoad(roadStart, .8);
  assert.equal(route.fromBridge, false);
  assert.equal(route.bridgeExitIndex, null);
  assert.ok(length([roadStart, ...route.points]) < road.getLength() * .31, 'normal journey stays between its road origin and destination');
  close(route.points.at(-1), road.getPointAt(.8));
});
