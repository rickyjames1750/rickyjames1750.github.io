import { nearestCurveParameter, planGroundPath } from './driving-route.js';

const clamp = value => Math.max(0, Math.min(1, value));
const append = (points, point) => {
  if (!points.length || points.at(-1).distanceToSquared(point) > 1e-12) points.push(point.clone());
};

/** Sample arc-length intervals in either direction, retaining their exact seams. */
function appendInterval(points, curve, from, to, spacing) {
  const count = Math.max(1, Math.ceil(Math.abs(to - from) * curve.getLength() / spacing));
  for (let i = 0; i <= count; i++) append(points, curve.getPointAt(from + (to - from) * i / count));
}

/**
 * The bridge is a road network, not an off-road connector. Its four turnaround
 * quarters form a closed cycle at the north ramp. Routing that cycle as graph
 * edges lets either side of Marin return by pavement without cutting its center.
 */
export function createDrivingNavigator({roadCurve, bridgeDrive, colliders = [], isOnLand = () => true, clearance = 1.05, spacing = .24} = {}) {
  if (!roadCurve?.getPointAt || !bridgeDrive?.segments?.length) throw new TypeError('Main road and connected bridge segments are required.');
  spacing = Math.max(.08, Math.min(.5, spacing));
  const edges = bridgeDrive.segments.map(segment => {
    const curve = segment.curve, count = Math.max(24, Math.ceil(curve.getLength() / .16));
    return {...segment, samples: Array.from({length: count + 1}, (_, i) => curve.getPointAt(i / count))};
  });

  function projectToBridge(position) {
    let best = null;
    for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex++) {
      const edge = edges[edgeIndex], {samples, curve} = edge;
      let closest = 0, distance = Infinity;
      const score = u => {
        const p = curve.getPointAt(u), dy = Number.isFinite(position.y) ? p.y - position.y : 0;
        return (p.x - position.x) ** 2 + (p.z - position.z) ** 2 + dy * dy * .25;
      };
      for (let i = 0; i < samples.length; i++) {
        const p = samples[i], dy = Number.isFinite(position.y) ? p.y - position.y : 0;
        const d = (p.x - position.x) ** 2 + (p.z - position.z) ** 2 + dy * dy * .25;
        if (d < distance) { distance = d; closest = i; }
      }
      // Refine between the adjacent samples; an endpoint projection stays exact.
      let low = Math.max(0, (closest - 1) / (samples.length - 1)), high = Math.min(1, (closest + 1) / (samples.length - 1));
      for (let i = 0; i < 22; i++) {
        const left = low + (high - low) / 3, right = high - (high - low) / 3;
        if (score(left) < score(right)) high = right; else low = left;
      }
      let u = (low + high) / 2;
      for (const endpoint of [0, 1]) if (score(endpoint) < score(u)) u = endpoint;
      const d = score(u), point = curve.getPointAt(u);
      if (!best || d < best.score) best = {edgeIndex, u, point, score: d, distance: Math.hypot(position.x - point.x, position.z - point.z)};
    }
    return best;
  }

  function bridgePath(start, destination) {
    const from = projectToBridge(start), to = projectToBridge(destination);
    const nodes = [], adjacency = [], nodeKeys = new Map();
    const node = point => {
      const key = [point.x, point.y, point.z].map(n => Math.round(n * 1e6)).join(',');
      if (!nodeKeys.has(key)) { nodeKeys.set(key, nodes.length); nodes.push(point); adjacency.push([]); }
      return nodeKeys.get(key);
    };
    let source, target;
    edges.forEach((edge, edgeIndex) => {
      const cuts = [{u: 0}, {u: 1}];
      if (from.edgeIndex === edgeIndex) cuts.push({...from, source: true});
      if (to.edgeIndex === edgeIndex) cuts.push({...to, target: true});
      cuts.sort((a, b) => a.u - b.u);
      for (const cut of cuts) {
        cut.node = node(edge.curve.getPointAt(cut.u));
        if (cut.source) source = cut.node;
        if (cut.target) target = cut.node;
      }
      for (let i = 1; i < cuts.length; i++) {
        const a = cuts[i - 1], b = cuts[i];
        if (a.node === b.node) continue;
        const cost = edge.curve.getLength() * (b.u - a.u);
        adjacency[a.node].push({node: b.node, edgeIndex, from: a.u, to: b.u, cost});
        adjacency[b.node].push({node: a.node, edgeIndex, from: b.u, to: a.u, cost});
      }
    });
    const distances = nodes.map(() => Infinity), previous = [], pending = new Set(nodes.map((_, i) => i));
    distances[source] = 0;
    while (pending.size) {
      let current = null;
      for (const candidate of pending) if (current === null || distances[candidate] < distances[current]) current = candidate;
      if (!Number.isFinite(distances[current])) return [];
      if (current === target) break;
      pending.delete(current);
      for (const edge of adjacency[current]) {
        const distance = distances[current] + edge.cost;
        if (distance < distances[edge.node]) { distances[edge.node] = distance; previous[edge.node] = {previous: current, ...edge}; }
      }
    }
    const route = [];
    for (let cursor = target; cursor !== source;) {
      const edge = previous[cursor];
      if (!edge) return [];
      route.unshift(edge); cursor = edge.previous;
    }
    const points = [];
    // Moving laterally onto the nearest centerline remains inside the same road
    // envelope. All subsequent intervals follow authored pavement, including Y.
    append(points, from.point);
    for (const edge of route) appendInterval(points, edges[edge.edgeIndex].curve, edge.from, edge.to, spacing);
    append(points, to.point);
    return points;
  }

  const isOnBridge = start => bridgeDrive.contains(start.x, start.z, .12);
  const roadConnector = start => {
    const t = nearestCurveParameter(start, roadCurve), point = roadCurve.getPointAt(t);
    const points = planGroundPath(start, point, {colliders, isOnLand, clearance});
    return {t, points};
  };

  return {
    bridgePath,
    projectToBridge,
    /** Return from any ramp/deck/Marin loop position before following the resume road. */
    toRoad(start, destinationT) {
      const points = [], fromBridge = isOnBridge(start);
      let t, bridgeExitIndex = null;
      if (fromBridge) {
        for (const point of bridgePath(start, bridgeDrive.join.point)) append(points, point);
        if (!points.length) return {points, fromBridge};
        t = bridgeDrive.join.t; bridgeExitIndex = points.length - 1;
      } else {
        const connector = roadConnector(start); t = connector.t;
        if (!connector.points.length) return {points, fromBridge};
        for (const point of connector.points) append(points, point);
      }
      appendInterval(points, roadCurve, t, clamp(destinationT), spacing);
      return {points, fromBridge, bridgeExitIndex};
    },
    /** Golden Gate is a destination within Drive EV, reached from road or bridge. */
    toBridge(start) {
      const destination = edges.find(edge => edge.type === 'deck').curve.getPointAt(.5), points = [];
      const fromBridge = isOnBridge(start);
      if (fromBridge) return {points: bridgePath(start, destination), fromBridge};
      const connector = roadConnector(start);
      if (!connector.points.length) return {points, fromBridge};
      for (const point of connector.points) append(points, point);
      appendInterval(points, roadCurve, connector.t, bridgeDrive.join.t, spacing);
      for (const point of bridgePath(bridgeDrive.join.point, destination)) append(points, point);
      return {points, fromBridge};
    },
  };
}
