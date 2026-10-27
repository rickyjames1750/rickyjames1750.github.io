import test from 'node:test';
import assert from 'node:assert/strict';
import { CatmullRomCurve3, Vector3 } from 'three';
import {
  project, stops, landmarks, railCoordinates, futurePortalCoordinates,
  peninsulaCoast, eastBayCoast, marinCoast, geographyNote,
} from '../src/geography.js';
import { zones, content } from '../src/content.js';

const closeTo = (actual, expected, tolerance = 1e-8) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should be close to ${expected}`);
const polygon = peninsulaCoast.map(([lon, lat]) => project(lon, lat));
function contains({x, z}, vertices = polygon) {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i], b = vertices[j];
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
const projectedRail = railCoordinates.map(([lon, lat]) => project(lon, lat));
const curveFor = coordinates => new CatmullRomCurve3(
  coordinates.map(([lon, lat]) => {const p = project(lon, lat); return new Vector3(p.x, 0, p.z);}),
  false, 'catmullrom', 0.15,
);

// These expectations represent the map's public geographic contract, not renderer snapshots.
test('projection gives east +X, north -Z, and a stable Bay Area origin', () => {
  closeTo(project(-122.3, 37.6).x, 0);
  closeTo(project(-122.3, 37.6).z, 0);
  assert.ok(project(-122.2, 37.6).x > 0);
  assert.ok(project(-122.4, 37.6).x < 0);
  assert.ok(project(-122.3, 37.7).z < 0);
  assert.ok(project(-122.3, 37.5).z > 0);
  for (const point of [...stops, ...landmarks]) {
    const result = project(point.lon, point.lat);
    assert.ok(Number.isFinite(result.x) && Number.isFinite(result.z), point.id);
    closeTo(result.x, point.x);
    closeTo(result.z, point.z);
  }
});

test('five unique resume stops remain ordered down the Peninsula and match content IDs', () => {
  const ids = ['about', 'experience', 'projects', 'education', 'contact'];
  assert.deepEqual(stops.map(stop => stop.id), ids);
  assert.equal(new Set(stops.map(stop => stop.id)).size, stops.length);
  assert.equal(new Set(stops.map(stop => `${stop.lon},${stop.lat}`)).size, stops.length);
  assert.deepEqual(zones.map(zone => zone.id), ids);
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i];
    assert.ok(contains(stop), `${stop.place} must be on the modeled Peninsula`);
    assert.ok(content(stop.id).length > 100, `${stop.id} has readable resume content`);
    assert.ok(stop.source.startsWith('https://'), `${stop.id} has a source URL`);
    if (i) assert.ok(stop.lat < stops[i - 1].lat, `${stop.place} is south of previous stop`);
  }
});

test('rail follows the current station sequence and finite coordinate bounds', () => {
  assert.ok(railCoordinates.length >= 20, 'Corridor retains intermediate stations');
  const keyStations = [
    ['Fourth & King', -122.3949, 37.7764],
    ['South San Francisco', -122.4046, 37.6558],
    ['San Bruno', -122.4112, 37.6298],
    ['Millbrae', -122.3868, 37.6004],
    ['San Mateo', -122.3240, 37.5680],
    ['Redwood City', -122.2320, 37.4852],
    ['Menlo Park', -122.1812, 37.4547],
    ['Palo Alto', -122.1648, 37.4430],
    ['Mountain View', -122.0767, 37.3944],
  ];
  let lastIndex = -1;
  for (const [name, lon, lat] of keyStations) {
    const index = railCoordinates.findIndex(([x, y]) => Math.hypot(x - lon, y - lat) < 0.001);
    assert.ok(index > lastIndex, `${name} is present after the preceding station`);
    lastIndex = index;
  }
  for (let i = 0; i < railCoordinates.length; i++) {
    const [lon, lat] = railCoordinates[i];
    assert.ok(Number.isFinite(lon) && Number.isFinite(lat));
    assert.ok(lon > -122.45 && lon < -122.05 && lat > 37.38 && lat < 37.80);
    assert.ok(contains(projectedRail[i]), `Rail vertex ${i} must remain on the Peninsula`);
    if (i) {
      assert.ok(lat < railCoordinates[i - 1][1], `Rail vertex ${i} progresses south`);
      assert.ok(Math.hypot(projectedRail[i].x - projectedRail[i - 1].x, projectedRail[i].z - projectedRail[i - 1].z) < 20,
        `Rail segment ${i} has no discontinuous teleport`);
    }
  }
});

test('interpolated rail and road centerlines stay on land between coordinate anchors', () => {
  const rail = curveFor(railCoordinates);
  const road = new CatmullRomCurve3(railCoordinates.map(([lon, lat], i) => {
    const p = project(lon, lat);
    return new Vector3(p.x - 4.6, 0, p.z + (i === 0 ? -1.5 : 0));
  }), false, 'catmullrom', 0.16);
  for (let i = 0; i <= 1000; i++) {
    const t = i / 1000;
    for (const [name, curve] of [['Rail', rail], ['Road', road]]) {
      const p = curve.getPoint(t);
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z), `${name} t=${t}`);
      assert.ok(contains(p), `${name} curve leaves the Peninsula at t=${t}: ${p.x}, ${p.z}`);
    }
  }
});

test('future Portal connects Salesforce to Fourth & King without replacing current service', () => {
  const terminal = landmarks.find(landmark => landmark.id === 'salesforce');
  const [startLon, startLat] = futurePortalCoordinates[0];
  closeTo(startLon, terminal.lon);
  closeTo(startLat, terminal.lat);
  assert.deepEqual(futurePortalCoordinates.at(-1), railCoordinates[0]);
  assert.notDeepEqual(futurePortalCoordinates[0], railCoordinates[0]);
  assert.ok(startLat > railCoordinates[0][1], 'Salesforce is north of Fourth & King');
  const curve = curveFor(futurePortalCoordinates);
  for (let i = 0; i <= 200; i++) assert.ok(contains(curve.getPoint(i / 200)), `Future corridor sample ${i} stays under land`);
  assert.match(geographyNote, /future/i);
});

test('landmark relationships locals recognize are preserved', () => {
  const get = id => landmarks.find(landmark => landmark.id === id);
  const goldenGate = get('golden-gate'), salesforce = get('salesforce');
  assert.ok(goldenGate.x < salesforce.x && goldenGate.z < salesforce.z, 'Golden Gate is northwest of downtown');
  assert.ok(get('stanford').lon < stops.find(stop => stop.id === 'education').lon, 'Stanford is west of Palo Alto station');
  assert.ok(get('meta').lon > get('stanford').lon && get('meta').lat > get('stanford').lat, 'Meta is northeast of Stanford');
  assert.ok(get('sfo').lon > -122.3868, 'SFO is east of Millbrae Caltrain');
  for (const id of ['salesforce', 'south-park', 'spc', 'stanford', 'meta', 'google', 'sfo']) {
    assert.ok(contains(get(id)), `${id} must have a land anchor`);
  }
});

test('coastal silhouettes are valid finite geographic rings without duplicate consecutive vertices', () => {
  for (const [name, ring] of [['Peninsula', peninsulaCoast], ['East Bay', eastBayCoast], ['Marin', marinCoast]]) {
    assert.ok(ring.length >= 8, `${name} has enough coastline anchors`);
    let area = 0;
    for (let i = 0; i < ring.length; i++) {
      const [lon, lat] = ring[i], next = ring[(i + 1) % ring.length];
      assert.ok(Number.isFinite(lon) && Number.isFinite(lat));
      assert.ok(lon > -123 && lon < -121 && lat > 37 && lat < 39);
      assert.notDeepEqual(ring[i], next, `${name} vertex ${i} is not degenerate`);
      area += lon * next[1] - next[0] * lat;
    }
    assert.ok(Math.abs(area) > 0.001, `${name} encloses nonzero area`);
  }
});
