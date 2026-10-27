import test from 'node:test';
import assert from 'node:assert/strict';
import { Shape, ExtrudeGeometry, Mesh, MeshBasicMaterial, Box3, Vector3, PlaneGeometry, DoubleSide } from 'three';
import { SURFACES, terrainTopY, distanceXZToPolyline, createSurfaceSampler, createMeshHeightSampler, groundedRootY } from '../src/surfaces.js';
import { createGravityCar, createCaltrain } from '../src/landmarks.js';

const closeTo = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should equal ${expected}`);

test('land upper cap includes bevel and remains below road and sleepers', () => {
  const shape = new Shape(); shape.moveTo(-2, -2); shape.lineTo(2, -2); shape.lineTo(2, 2); shape.lineTo(-2, 2); shape.closePath();
  const geometry = new ExtrudeGeometry(shape, { depth: SURFACES.terrainDepth, bevelEnabled: true,
    bevelThickness: SURFACES.terrainBevel, bevelSize: .3, bevelSegments: 2 });
  const land = new Mesh(geometry, new MeshBasicMaterial()); land.rotation.x = -Math.PI / 2; land.position.y = SURFACES.terrainOriginY;
  land.updateMatrixWorld();
  const actualTop = new Box3().setFromObject(land).max.y;
  closeTo(actualTop, SURFACES.land);
  closeTo(actualTop, terrainTopY(SURFACES.terrainOriginY));
  assert.ok(actualTop < SURFACES.shoulder && actualTop < SURFACES.road && actualTop < SURFACES.railBed);
  // Regression: the old placement put land at .9, occluding the .79 road entirely.
  closeTo(terrainTopY(-2.05), .9);
  geometry.dispose(); land.material.dispose();
});

test('road distance uses segments, avoiding dips between centerline points', () => {
  const points = [{x:0,z:0}, {x:0,z:20}, {x:20,z:20}];
  closeTo(distanceXZToPolyline(.5, 10, points), .5);
  closeTo(distanceXZToPolyline(10, 21, points), 1);
  closeTo(distanceXZToPolyline(23, 24, points), 5);
  closeTo(distanceXZToPolyline(0, 5, [{x:0,z:0}, {x:0,z:0}, {x:0,z:10}]), 0);
  assert.equal(distanceXZToPolyline(0, 0, []), Infinity);
});

test('surface sampler respects paved width, shoulder width, and off-road baseline', () => {
  const sample = createSurfaceSampler({roadPoints:[new Vector3(0, .79, -100), new Vector3(0, .79, 100)]});
  assert.equal(sample(0, 50).type, 'road');
  closeTo(sample(2.1, 50).height, .79);
  assert.equal(sample(2.2, 50).type, 'shoulder');
  closeTo(sample(2.2, 50).height, .75);
  assert.equal(sample(2.36, 50).type, 'land');
  closeTo(sample(2.36, 50).height, .6);
});

test('car and train root heights ground measured tire geometry regardless of model scale', () => {
  // Canvas is used only for vehicle lettering; no graphics context is needed to inspect geometry.
  const previousDocument = globalThis.document;
  globalThis.document = {createElement:() => ({getContext:() => ({clearRect(){},fillText(){}})})};
  try {
    const car = createGravityCar(), train = createCaltrain();
    const carLocalBottom = car.userData.wheelBottom;
    assert.ok(Number.isFinite(carLocalBottom));
    for (const height of [SURFACES.land, SURFACES.shoulder, SURFACES.road]) {
      const rootY = groundedRootY(height, carLocalBottom, .4);
      closeTo(rootY + carLocalBottom * .4, height + SURFACES.vehicleClearance);
      assert.ok(rootY + carLocalBottom * .4 >= height);
    }
    const trainLocalBottom = train.userData.wheelBottom;
    assert.ok(Number.isFinite(trainLocalBottom));
    // Low-polygon wheel profile is measured; nominal radius does not quite reach its lowest bound.
    closeTo(SURFACES.railCenter + SURFACES.railHeadOffset + SURFACES.railHeadRadius, SURFACES.railTop);
    const trainRoot = groundedRootY(SURFACES.railTop, trainLocalBottom, .46);
    closeTo(trainRoot + trainLocalBottom * .46, SURFACES.railTop + SURFACES.vehicleClearance);
    assert.ok(trainRoot > SURFACES.railCenter, 'train root clears the visible rail-head surface');
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('exact mesh sampler chooses highest drivable surface at overlapping road and ground', () => {
  const material = new MeshBasicMaterial({side:DoubleSide});
  const land = new Mesh(new PlaneGeometry(20, 20), material);land.rotation.x=-Math.PI/2;land.position.y=.6;
  const road = new Mesh(new PlaneGeometry(4.2, 20), material);road.rotation.x=-Math.PI/2;road.position.y=.79;
  const sample = createMeshHeightSampler([land, road]);
  closeTo(sample(0, 0).height, .79);
  closeTo(sample(3, 0).height, .6);
  assert.equal(sample(100, 100).type, 'land');
  closeTo(sample(100, 100).height, .6);
  land.geometry.dispose();road.geometry.dispose();material.dispose();
});
