import { Raycaster, Vector3 } from 'three';

/** One height contract for the miniature world. All values are world-space Y. */
export const SURFACES = Object.freeze({
  land: 0.6,
  road: 0.79,
  roadHalfWidth: 2.1,
  shoulder: 0.75,
  shoulderHalfWidth: 2.35,
  water: -0.18,
  railBed: 0.76,
  railCenter: 0.84,
  railHeadOffset: 0.1,
  railHeadRadius: 0.045,
  railTop: 0.985,
  terrainDepth: 2.6,
  terrainBevel: 0.35,
  terrainOriginY: -2.35,
  vehicleClearance: 0.006,
});

/** Y of an extrusion rotated -PI/2, including its upper bevel. */
export function terrainTopY(originY, depth = SURFACES.terrainDepth, bevel = SURFACES.terrainBevel) {
  return originY + depth + bevel;
}

function pointXZ(point) {
  const x = Array.isArray(point) ? point[0] : point?.x;
  const z = Array.isArray(point) ? point[1] : point?.z;
  if (!Number.isFinite(x) || !Number.isFinite(z)) throw new TypeError('Surface points require finite x and z coordinates.');
  return { x, z };
}

/** Segment distance avoids false off-road dips between sparse centerline samples. */
export function distanceXZToPolyline(x, z, points) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return Infinity;
  if (!points.length) return Infinity;
  let result = Infinity;
  const p = pointXZ(points[0]);
  let ax = p.x, az = p.z;
  if (points.length === 1) return Math.hypot(x - ax, z - az);
  for (let i = 1; i < points.length; i++) {
    const b = pointXZ(points[i]), dx = b.x - ax, dz = b.z - az;
    const lengthSquared = dx * dx + dz * dz;
    const t = lengthSquared ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSquared)) : 0;
    result = Math.min(result, Math.hypot(x - ax - t * dx, z - az - t * dz));
    ax = b.x; az = b.z;
  }
  return result;
}

/** Flat ground/road surfaces follow the actual ribbon's sampled centerline and widths. */
export function createSurfaceSampler({ roadPoints = [], landHeight = SURFACES.land, roadHeight = SURFACES.road,
  shoulderHeight = SURFACES.shoulder, roadHalfWidth = SURFACES.roadHalfWidth,
  shoulderHalfWidth = SURFACES.shoulderHalfWidth } = {}) {
  const points = roadPoints.map(pointXZ);
  return function sampleSurface(x, z) {
    const distance = distanceXZToPolyline(x, z, points);
    if (distance <= roadHalfWidth) return { height: roadHeight, type: 'road', distance };
    if (distance <= shoulderHalfWidth) return { height: shoulderHeight, type: 'shoulder', distance };
    return { height: landHeight, type: 'land', distance };
  };
}

/** Optional exact sampler for terrain, ramps, bridges, and authored drivable meshes. */
export function createMeshHeightSampler(meshes, { fallback = SURFACES.land, top = 100, bottom = -20 } = {}) {
  const raycaster = new Raycaster(new Vector3(0, top, 0), new Vector3(0, -1, 0), 0, top - bottom);
  return function sampleMeshHeight(x, z) {
    raycaster.ray.origin.set(x, top, z);
    for (const mesh of meshes) mesh.updateWorldMatrix(true, false);
    const hit = raycaster.intersectObjects(meshes, false)[0];
    return hit ? { height: hit.point.y, type: 'mesh', object: hit.object } : { height: fallback, type: 'land', object: null };
  };
}

/** Position the root so the measured tire bottom contacts the surface, regardless of model scale. */
export function groundedRootY(surfaceY, localWheelBottom = 0, scaleY = 1, clearance = SURFACES.vehicleClearance) {
  return surfaceY - localWheelBottom * scaleY + clearance;
}
