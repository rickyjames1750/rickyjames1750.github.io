import { Box3, Matrix4, Ray, Raycaster, Vector3 } from 'three';

const meshCache = new WeakMap(), geometryCache = new WeakMap();
const UP = new Vector3(0, 1, 0);

// Merged architecture is spatially broad. Index its local triangles once so follow-camera
// rays only visit nearby cells, rather than rechecking a whole city for every candidate.
function triangleGrid(geometry) {
  const position = geometry.getAttribute('position'), index = geometry.getIndex();
  const old = geometryCache.get(geometry);
  if (old && old.positionVersion === position.version && old.indexVersion === index?.version) return old;
  const count = Math.floor((index?.count ?? position.count) / 3), cellSize = 4;
  const cells = new Map(), global = [], a = new Vector3(), b = new Vector3(), c = new Vector3();
  const vertex = (number, vector) => vector.fromBufferAttribute(position, index ? index.getX(number) : number);
  for (let triangle = 0; triangle < count; triangle++) {
    vertex(triangle * 3, a);vertex(triangle * 3 + 1, b);vertex(triangle * 3 + 2, c);
    const minX = Math.floor(Math.min(a.x, b.x, c.x) / cellSize), maxX = Math.floor(Math.max(a.x, b.x, c.x) / cellSize);
    const minZ = Math.floor(Math.min(a.z, b.z, c.z) / cellSize), maxZ = Math.floor(Math.max(a.z, b.z, c.z) / cellSize);
    if ((maxX - minX + 1) * (maxZ - minZ + 1) > 256) {global.push(triangle);continue;}
    for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
      const key = `${x},${z}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(triangle);
    }
  }
  const result = {position, index, positionVersion:position.version, indexVersion:index?.version, cells, global, cellSize};
  geometryCache.set(geometry, result);return result;
}

function cachedMesh(mesh) {
  mesh.updateWorldMatrix(true, false);
  const positionVersion = mesh.geometry.getAttribute('position').version, instanceVersion = mesh.instanceMatrix?.version;
  let record = meshCache.get(mesh);
  if (!record || !record.matrix.equals(mesh.matrixWorld) || record.positionVersion !== positionVersion || record.instanceVersion !== instanceVersion) {
    if (mesh.isInstancedMesh) mesh.computeBoundingBox();
    else if (!mesh.geometry.boundingBox || record?.positionVersion !== positionVersion) mesh.geometry.computeBoundingBox();
    record = {
      matrix:mesh.matrixWorld.clone(), inverse:new Matrix4().copy(mesh.matrixWorld).invert(), positionVersion, instanceVersion,
      bounds:new Box3().copy(mesh.isInstancedMesh ? mesh.boundingBox : mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld),
    };
    meshCache.set(mesh, record);
  }
  return record;
}

function gridIntersects(mesh, record, start, end) {
  const data = triangleGrid(mesh.geometry), origin = start.clone().applyMatrix4(record.inverse), finish = end.clone().applyMatrix4(record.inverse);
  const delta = finish.clone().sub(origin), length = delta.length();
  if (length < 1e-6) return false;
  const ray = new Ray(origin, delta.clone().multiplyScalar(1 / length));
  const triangles = new Set(data.global);
  // Half-cell steps plus neighbors cover cell-edge grazing rays and steep vertical views.
  const steps = Math.max(1, Math.ceil(Math.hypot(delta.x, delta.z) / (data.cellSize * 0.5)));
  for (let i = 0; i <= steps; i++) {
    const x = Math.floor((origin.x + delta.x * i / steps) / data.cellSize), z = Math.floor((origin.z + delta.z * i / steps) / data.cellSize);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const cell = data.cells.get(`${x + dx},${z + dz}`);
      if (cell) for (const triangle of cell) triangles.add(triangle);
    }
  }
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), hit = new Vector3();
  const vertex = (number, vector) => vector.fromBufferAttribute(data.position, data.index ? data.index.getX(number) : number);
  for (const triangle of triangles) {
    vertex(triangle * 3, a);vertex(triangle * 3 + 1, b);vertex(triangle * 3 + 2, c);
    if (ray.intersectTriangle(a, b, c, false, hit) && hit.distanceToSquared(origin) <= length * length) return true;
  }
  return false;
}

/**
 * Returns a new camera position with a clear target-to-camera corridor where possible.
 * Inputs, scene transforms, materials, and the desired follow distance are never changed.
 * Pass architecture only; do not include terrain, the followed vehicle, or decorative water.
 * previousPosition can reduce heading changes when a desired view is temporarily blocked.
 */
export function chooseSafeCamera(target, desired, occluderMeshes, options = {}) {
  const clearance = Math.max(0.02, options.clearance ?? 0.28), targetClearance = Math.max(0, options.targetClearance ?? 0.35);
  const minDistance = Math.max(0.5, options.minDistance ?? 2.5), maxLift = Math.max(2, options.maxLift ?? 10);
  const objects = [], seen = new Set();
  function collect(object, ancestorsVisible = true) {
    if (!object || !ancestorsVisible || !object.visible) return;
    if (object.isMesh && !seen.has(object) && object.geometry?.getAttribute('position')) {seen.add(object);objects.push(object);}
    for (const child of object.children || []) collect(child, ancestorsVisible && object.visible);
  }
  for (const object of occluderMeshes || []) collect(object);
  if (!objects.length) return desired.clone();
  const records = objects.map(object => ({object, record:cachedMesh(object)}));
  const raycaster = new Raycaster(), broadHit = new Vector3();
  function clear(candidate) {
    const direction = candidate.clone().sub(target), distance = direction.length();
    if (distance < minDistance) return false;
    direction.multiplyScalar(1 / distance);
    const side = new Vector3().crossVectors(direction, UP);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);else side.normalize();
    const offsets = [new Vector3(), side.clone().multiplyScalar(clearance).addScaledVector(UP, clearance * 0.5), side.clone().multiplyScalar(-clearance).addScaledVector(UP, clearance * 0.5)];
    for (const offset of offsets) {
      const origin = target.clone().add(offset).addScaledVector(direction, targetClearance), end = candidate.clone().add(offset);
      const length = origin.distanceTo(end);raycaster.set(origin, direction);raycaster.near = 0;raycaster.far = length;
      for (const {object, record} of records) {
        if (!record.bounds.containsPoint(origin)) {
          if (!raycaster.ray.intersectBox(record.bounds, broadHit) || broadHit.distanceToSquared(origin) > length * length) continue;
        }
        const triangleCount = (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3;
        if (!object.isInstancedMesh && triangleCount > 2000) {
          if (gridIntersects(object, record, origin, end)) return false;
        } else {
          const intersections = raycaster.intersectObject(object, false);
          if (intersections.length) return false;
          // When the start lies inside a closed solid, front-sided raycasting alone misses the exit.
          if (record.bounds.containsPoint(origin)) {
            const reverse = new Raycaster(end, direction.clone().negate(), 0, length);
            if (reverse.intersectObject(object, false).length) return false;
          }
        }
      }
    }
    return true;
  }
  if (clear(desired)) return desired.clone();
  const offset = desired.clone().sub(target), horizontal = Math.hypot(offset.x, offset.z);
  if (options.previousPosition?.isVector3) {
    const previousDistance = options.previousPosition.distanceTo(target), desiredDistance = offset.length();
    if (previousDistance > desiredDistance * 0.65 && previousDistance < desiredDistance * 1.6 && clear(options.previousPosition)) return options.previousPosition.clone();
  }
  if (horizontal < 0.01) offset.x = minDistance;
  const headings = [
    [0, .2], [.25, .15], [-.25, .15], [.5, .3], [-.5, .3],
    [0, .6], [.85, .3], [-.85, .3], [1.2, .5], [-1.2, .5],
    [0, 1], [Math.PI / 2, .6], [-Math.PI / 2, .6], [Math.PI, .4],
  ];
  for (const [angle, lift] of headings) {
    const candidate = offset.clone().applyAxisAngle(UP, angle).add(target);candidate.y += lift * maxLift;
    if (clear(candidate)) return candidate;
  }
  // Enclosed/inside-solid targets may have no valid line of sight. Keep the camera outside
  // the architecture with an elevated establishing view instead of snapping it into a wall.
  const fallback = offset.clone().add(target);fallback.y += maxLift * 2;
  return fallback;
}
