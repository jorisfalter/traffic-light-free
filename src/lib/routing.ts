import { haversineMeters, type LatLon } from "./geo";
import type { BikeGraph, GraphNode } from "./graph";

export type RouteResult = {
  nodeIds: number[];
  coordinates: LatLon[];
  distanceMeters: number;
  weightedCost: number;
  trafficLights: number;
  searchPasses: number;
  startNode: GraphNode;
  endNode: GraphNode;
  startSnapDistance: number;
  endSnapDistance: number;
  visitedNodes: number;
};

export type RouteOptions = {
  trafficLightPenaltyMeters: number;
  blockedNodeIds?: Set<number>;
};

export type IterativeRouteOptions = {
  trafficLightPenaltyMeters: number;
  maxIterations: number;
  referenceDistanceMeters?: number;
  maxDistanceFactor?: number;
  maxExtraDistanceMeters?: number;
};

export function calculateRoute(
  graph: BikeGraph,
  start: LatLon,
  end: LatLon,
  options: RouteOptions,
): RouteResult | null {
  const startSnap = findNearestNode(graph, start);
  const endSnap = findNearestNode(graph, end);

  if (!startSnap || !endSnap) {
    return null;
  }

  const path = aStar(graph, startSnap.node.id, endSnap.node.id, options);
  if (!path) {
    return null;
  }

  const coordinates = path.nodeIds.map((id) => {
    const node = graph.nodes.get(id)!;
    return { lat: node.lat, lon: node.lon };
  });

  return {
    ...path,
    searchPasses: 1,
    coordinates,
    startNode: startSnap.node,
    endNode: endSnap.node,
    startSnapDistance: startSnap.distanceMeters,
    endSnapDistance: endSnap.distanceMeters,
  };
}

export function calculateIterativeSignalAvoidanceRoute(
  graph: BikeGraph,
  start: LatLon,
  end: LatLon,
  options: IterativeRouteOptions,
): RouteResult | null {
  let current = calculateRoute(graph, start, end, {
    trafficLightPenaltyMeters: options.trafficLightPenaltyMeters,
  });

  if (!current) {
    return null;
  }

  let best = current;
  const blockedSignalIds = new Set<number>();
  const referenceDistanceMeters = options.referenceDistanceMeters ?? current.distanceMeters;
  const maxDistanceMeters = Math.min(
    referenceDistanceMeters * (options.maxDistanceFactor ?? 2.2),
    referenceDistanceMeters + (options.maxExtraDistanceMeters ?? 3_500),
  );

  for (let pass = 2; pass <= options.maxIterations && current.trafficLights > 0; pass += 1) {
    const addedSignals = addSignalBlocks(current, graph, blockedSignalIds);
    if (addedSignals === 0) {
      break;
    }

    const candidate = calculateRoute(graph, start, end, {
      trafficLightPenaltyMeters: options.trafficLightPenaltyMeters,
      blockedNodeIds: blockedSignalIds,
    });

    if (!candidate) {
      break;
    }

    current = { ...candidate, searchPasses: pass };

    if (current.distanceMeters <= maxDistanceMeters && isBetterSignalAvoidanceRoute(current, best)) {
      best = current;
    }
  }

  return best;
}

function findNearestNode(
  graph: BikeGraph,
  point: LatLon,
): { node: GraphNode; distanceMeters: number } | null {
  let nearest: GraphNode | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const node of graph.nodes.values()) {
    const distance = haversineMeters(point, node);
    if (distance < nearestDistance) {
      nearest = node;
      nearestDistance = distance;
    }
  }

  return nearest ? { node: nearest, distanceMeters: nearestDistance } : null;
}

function aStar(
  graph: BikeGraph,
  startId: number,
  endId: number,
  options: RouteOptions,
): Pick<RouteResult, "nodeIds" | "distanceMeters" | "weightedCost" | "trafficLights" | "visitedNodes"> | null {
  const endNode = graph.nodes.get(endId);
  if (!endNode) {
    return null;
  }

  const open = new MinHeap();
  const cameFrom = new Map<number, number>();
  const distanceScore = new Map<number, number>([[startId, 0]]);
  const costScore = new Map<number, number>([[startId, 0]]);
  const visited = new Set<number>();

  open.push({ id: startId, priority: 0 });

  while (open.size > 0) {
    const current = open.pop();
    if (!current || visited.has(current.id)) {
      continue;
    }

    if (current.id === endId) {
      return reconstructRoute(graph, cameFrom, startId, endId, distanceScore, costScore, visited.size);
    }

    visited.add(current.id);

    const currentNode = graph.nodes.get(current.id);
    if (!currentNode) {
      continue;
    }

    for (const edge of currentNode.edges) {
      const nextNode = graph.nodes.get(edge.to);
      if (!nextNode || visited.has(edge.to)) {
        continue;
      }

      if (edge.to !== startId && edge.to !== endId && options.blockedNodeIds?.has(edge.to)) {
        continue;
      }

      const baseDistance = distanceScore.get(current.id) ?? Number.POSITIVE_INFINITY;
      const baseCost = costScore.get(current.id) ?? Number.POSITIVE_INFINITY;
      const lightPenalty =
        nextNode.signal && edge.to !== startId && edge.to !== endId ? options.trafficLightPenaltyMeters : 0;
      const nextDistance = baseDistance + edge.distanceMeters;
      const nextCost = baseCost + edge.distanceMeters * edge.multiplier + lightPenalty;

      if (nextCost < (costScore.get(edge.to) ?? Number.POSITIVE_INFINITY)) {
        cameFrom.set(edge.to, current.id);
        distanceScore.set(edge.to, nextDistance);
        costScore.set(edge.to, nextCost);
        open.push({
          id: edge.to,
          priority: nextCost + heuristic(nextNode, endNode),
        });
      }
    }
  }

  return null;
}

function reconstructRoute(
  graph: BikeGraph,
  cameFrom: Map<number, number>,
  startId: number,
  endId: number,
  distanceScore: Map<number, number>,
  costScore: Map<number, number>,
  visitedNodes: number,
): Pick<RouteResult, "nodeIds" | "distanceMeters" | "weightedCost" | "trafficLights" | "visitedNodes"> | null {
  const nodeIds = [endId];
  let current = endId;

  while (current !== startId) {
    const previous = cameFrom.get(current);
    if (previous === undefined) {
      return null;
    }

    current = previous;
    nodeIds.push(current);
  }

  nodeIds.reverse();

  let trafficLights = 0;
  for (let index = 1; index < nodeIds.length - 1; index += 1) {
    const node = graph.nodes.get(nodeIds[index]);
    if (node?.signal) {
      trafficLights += 1;
    }
  }

  return {
    nodeIds,
    distanceMeters: distanceScore.get(endId) ?? 0,
    weightedCost: costScore.get(endId) ?? 0,
    trafficLights,
    visitedNodes,
  };
}

function addSignalBlocks(route: RouteResult, graph: BikeGraph, blockedSignalIds: Set<number>): number {
  let addedSignals = 0;

  for (let index = 1; index < route.nodeIds.length - 1; index += 1) {
    const node = graph.nodes.get(route.nodeIds[index]);
    if (node?.signal && !blockedSignalIds.has(node.id)) {
      blockedSignalIds.add(node.id);
      addedSignals += 1;
    }
  }

  return addedSignals;
}

function isBetterSignalAvoidanceRoute(candidate: RouteResult, currentBest: RouteResult): boolean {
  if (candidate.trafficLights !== currentBest.trafficLights) {
    return candidate.trafficLights < currentBest.trafficLights;
  }

  if (candidate.weightedCost !== currentBest.weightedCost) {
    return candidate.weightedCost < currentBest.weightedCost;
  }

  return candidate.distanceMeters < currentBest.distanceMeters;
}

function heuristic(from: LatLon, to: LatLon): number {
  return haversineMeters(from, to) * 0.75;
}

type HeapItem = {
  id: number;
  priority: number;
};

class MinHeap {
  private items: HeapItem[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: HeapItem): void {
    this.items.push(item);
    this.bubbleUp(this.items.length - 1);
  }

  pop(): HeapItem | undefined {
    if (this.items.length === 0) {
      return undefined;
    }

    const root = this.items[0];
    const last = this.items.pop();

    if (last && this.items.length > 0) {
      this.items[0] = last;
      this.sinkDown(0);
    }

    return root;
  }

  private bubbleUp(index: number): void {
    let childIndex = index;

    while (childIndex > 0) {
      const parentIndex = Math.floor((childIndex - 1) / 2);
      if (this.items[parentIndex].priority <= this.items[childIndex].priority) {
        break;
      }

      [this.items[parentIndex], this.items[childIndex]] = [this.items[childIndex], this.items[parentIndex]];
      childIndex = parentIndex;
    }
  }

  private sinkDown(index: number): void {
    let parentIndex = index;

    while (true) {
      const leftIndex = parentIndex * 2 + 1;
      const rightIndex = parentIndex * 2 + 2;
      let smallestIndex = parentIndex;

      if (
        leftIndex < this.items.length &&
        this.items[leftIndex].priority < this.items[smallestIndex].priority
      ) {
        smallestIndex = leftIndex;
      }

      if (
        rightIndex < this.items.length &&
        this.items[rightIndex].priority < this.items[smallestIndex].priority
      ) {
        smallestIndex = rightIndex;
      }

      if (smallestIndex === parentIndex) {
        break;
      }

      [this.items[parentIndex], this.items[smallestIndex]] = [this.items[smallestIndex], this.items[parentIndex]];
      parentIndex = smallestIndex;
    }
  }
}
