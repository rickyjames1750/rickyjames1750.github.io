import { Vector3 } from 'three';
import { SURFACES } from './surfaces.js';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const angleDifference = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const vector = p => new Vector3(p.x, Number.isFinite(p.y) ? p.y : SURFACES.road, p.z);

function indexedPolyline(points) {
  const size = 4, range = 3, grid = new Map(), segments = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dx = b.x - a.x, dz = b.z - a.z;
    if (dx * dx + dz * dz < 1e-12) continue;
    const segment = {a, dx, dz, squaredLength: dx * dx + dz * dz}; segments.push(segment);
    for (let x = Math.floor((Math.min(a.x, b.x) - range) / size); x <= Math.floor((Math.max(a.x, b.x) + range) / size); x++) {
      for (let z = Math.floor((Math.min(a.z, b.z) - range) / size); z <= Math.floor((Math.max(a.z, b.z) + range) / size); z++) {
        const key = `${x},${z}`; if (!grid.has(key)) grid.set(key, []); grid.get(key).push(segment);
      }
    }
  }
  function find(position, candidates) {
    let distanceSquared = Infinity, pointX = 0, pointZ = 0;
    for (const {a, dx, dz, squaredLength} of candidates) {
      const t = clamp(((position.x - a.x) * dx + (position.z - a.z) * dz) / squaredLength, 0, 1);
      const x = a.x + dx * t, z = a.z + dz * t, d = (position.x - x) ** 2 + (position.z - z) ** 2;
      if (d < distanceSquared) { distanceSquared = d; pointX = x; pointZ = z; }
    }
    return {distance: Math.sqrt(distanceSquared), point: {x: pointX, z: pointZ}};
  }
  return position => {
    const candidates = grid.get(`${Math.floor(position.x / size)},${Math.floor(position.z / size)}`);
    const result = find(position, candidates || segments);
    return result.distance <= range || !candidates ? result : find(position, segments);
  };
}

function nearestPolyline(position, points) {
  let best = {distance: Infinity, point: null};
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dx = b.x - a.x, dz = b.z - a.z;
    const t = clamp(((position.x - a.x) * dx + (position.z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    const x = a.x + dx * t, z = a.z + dz * t, distance = Math.hypot(position.x - x, position.z - z);
    if (distance < best.distance) best = {distance, point: {x, z}};
  }
  return best;
}

/**
 * A rectangle follows the SUV's measured width/length instead of shrinking every
 * lane by its circumscribed radius. All dimensions are already world-scaled.
 * The small inset covers polyline/ribbon sampling error and body suspension tilt.
 * resolveStep clips outward motion while preserving the movement along a rail.
 */
export function createBridgeConstraint(bridgeDrive, {
  halfExtents,
  roadCurve = bridgeDrive?.roadCurve,
  colliders = bridgeDrive?.towerColliders || [],
  margin = .045,
  perimeterStep = .18,
} = {}) {
  if (!bridgeDrive?.nearest || !Number.isFinite(halfExtents?.x) || !Number.isFinite(halfExtents?.z) || halfExtents.x <= 0 || halfExtents.z <= 0) {
    throw new TypeError('Bridge constraints require a bridge drive and measured positive world-space half extents.');
  }
  const halfWidth = halfExtents.x, halfLength = halfExtents.z;
  const nearestBridge = indexedPolyline(bridgeDrive.samples);
  margin = clamp(margin, .015, .15);
  perimeterStep = clamp(perimeterStep, .08, .3);
  const perimeter = [{x: 0, z: 0}];
  const corners = [{x: -halfWidth, z: -halfLength}, {x: halfWidth, z: -halfLength}, {x: halfWidth, z: halfLength}, {x: -halfWidth, z: halfLength}];
  for (let side = 0; side < 4; side++) {
    const a = corners[side], b = corners[(side + 1) % 4], count = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / perimeterStep);
    for (let i = 0; i < count; i++) perimeter.push({x: a.x + (b.x - a.x) * i / count, z: a.z + (b.z - a.z) * i / count});
  }
  // Include the true continuation at the SF seam. Without this, a footprint that
  // straddles the exact ramp endpoint would meet an artificial circular end cap.
  const roadPoints = [];
  if (roadCurve) {
    const length = roadCurve.getLength(), reach = Math.min(6, length), count = Math.ceil(reach / .12);
    for (let i = 0; i <= count; i++) roadPoints.push(roadCurve.getPointAt(reach * i / count / length));
  }

  function pavement(position) {
    const bridge = nearestBridge(position);
    let best = {...bridge, clearance: bridgeDrive.halfWidth - margin - bridge.distance};
    if (roadPoints.length && Math.hypot(position.x - roadPoints[0].x, position.z - roadPoints[0].z) < 8) {
      const road = nearestPolyline(position, roadPoints), clearance = SURFACES.roadHalfWidth - margin - road.distance;
      if (clearance > best.clearance) best = {...road, clearance};
    }
    const dx = position.x - best.point.x, dz = position.z - best.point.z, distance = Math.hypot(dx, dz);
    return {...best, normal: distance > 1e-9 ? {x: dx / distance, z: dz / distance} : {x: 0, z: 0}};
  }

  function inspectPose(position, yaw, {includePoints = false} = {}) {
    const c = Math.cos(yaw), s = Math.sin(yaw), points = includePoints ? [] : undefined;
    let clearance = Infinity, normal = {x: 0, z: 0};
    for (const local of perimeter) {
      const point = {x: position.x + c * local.x + s * local.z, z: position.z - s * local.x + c * local.z};
      const surface = pavement(point);
      if (includePoints) points.push({...point, clearance: surface.clearance});
      if (surface.clearance < clearance) { clearance = surface.clearance; normal = surface.normal; }
    }
    // Circle-versus-oriented-rectangle distance includes a pier inside the body;
    // checking only sampled corners would miss that overlap.
    for (const collider of colliders) {
      const dx = collider.x - position.x, dz = collider.z - position.z;
      const lx = c * dx - s * dz, lz = s * dx + c * dz;
      const nx = clamp(lx, -halfWidth, halfWidth), nz = clamp(lz, -halfLength, halfLength);
      const ex = lx - nx, ez = lz - nz, distance = Math.hypot(ex, ez);
      let gap = distance - collider.r - margin, outward;
      if (distance > 1e-9) outward = {x: (c * ex + s * ez) / distance, z: (-s * ex + c * ez) / distance};
      else {
        const xGap = halfWidth - Math.abs(lx), zGap = halfLength - Math.abs(lz);
        const local = xGap < zGap ? {x: Math.sign(lx) || 1, z: 0} : {x: 0, z: Math.sign(lz) || 1};
        gap -= Math.min(xGap, zGap);
        outward = {x: c * local.x + s * local.z, z: -s * local.x + c * local.z};
      }
      // The constraint correction goes away from the obstacle, toward pavement.
      if (gap < clearance) { clearance = gap; normal = outward; }
    }
    return {valid: clearance >= -1e-6, clearance, normal, ...(includePoints ? {points} : {})};
  }

  function corrected(position, yaw, maxCorrection) {
    const result = position.clone();
    for (let i = 0; i < 18; i++) {
      const pose = inspectPose(result, yaw);
      if (pose.valid) return {position: result, yaw};
      result.x -= pose.normal.x * (-pose.clearance + .00001);
      result.z -= pose.normal.z * (-pose.clearance + .00001);
      if (Math.hypot(result.x - position.x, result.z - position.z) > maxCorrection) return null;
    }
    return inspectPose(result, yaw).valid ? {position: result, yaw} : null;
  }

  function resolveStep({from, to, yaw, previousYaw = yaw} = {}) {
    if (!from || !to || ![from.x, from.z, to.x, to.z, yaw, previousYaw].every(Number.isFinite)) throw new TypeError('A bridge movement requires finite positions and yaw headings.');
    const original = vector(from), requested = vector(to);
    // Only the bridge's actual pavement engages this constraint. Ordinary land
    // collision behavior, including buildings and trees, stays with the caller.
    const active = Boolean(bridgeDrive.sampleSurface(from.x, from.z));
    if (!active) return {position: requested, yaw, active: false, valid: true, constrained: false, blocked: false, progress: 1, speedScale: 1};
    const dx = requested.x - original.x, dz = requested.z - original.z, distance = Math.hypot(dx, dz), turn = angleDifference(previousYaw, yaw);
    const count = Math.min(256, Math.max(1, Math.ceil(distance / .16), Math.ceil(Math.abs(turn) / .045)));
    let position = original.clone(), acceptedYaw = previousYaw, constrained = false;
    for (let step = 1; step <= count; step++) {
      const desired = position.clone(); desired.x += dx / count; desired.z += dz / count;
      desired.y = original.y + (requested.y - original.y) * step / count;
      const desiredYaw = previousYaw + turn * step / count;
      if (inspectPose(desired, desiredYaw).valid) { position = desired; acceptedYaw = desiredYaw; continue; }
      constrained = true;
      let safe = null;
      // Preserve steering whenever a small inward correction can make room for
      // the bumper. If the turn cannot fit, progressively limit just that turn.
      for (const fraction of [1, .75, .5, .25, 0]) {
        const heading = acceptedYaw + angleDifference(acceptedYaw, desiredYaw) * fraction;
        safe = corrected(desired, heading, Math.max(.28, distance / count * 1.5 + .04));
        if (safe) break;
      }
      if (safe) { position = safe.position; acceptedYaw = safe.yaw; }
      else if (!inspectPose(position, acceptedYaw).valid) {
        // A pre-existing unsafe pose must never be advanced further over water.
        const recovered = corrected(position, acceptedYaw, Math.max(halfWidth, .5));
        if (recovered) position = recovered.position;
      }
    }
    const movedX = position.x - original.x, movedZ = position.z - original.z;
    const progress = distance > 1e-8 ? clamp((movedX * dx + movedZ * dz) / (distance * distance), 0, 1) : 1;
    // Tangential rail motion retains its speed; a head-on press loses speed
    // progressively instead of an abrupt zero from a one-millimeter crossing.
    const speedScale = constrained ? .6 + .4 * Math.sqrt(progress) : 1;
    return {position, yaw: acceptedYaw, active: true, valid: inspectPose(position, acceptedYaw).valid, constrained, blocked: distance > 1e-8 && Math.hypot(movedX, movedZ) < 1e-5, progress, speedScale};
  }

  return {resolveStep, inspectPose, halfExtents: {x: halfWidth, z: halfLength}, margin};
}
