import { haversineMeters, type LatLon } from "./geo";
import type { BikeGraph, GraphNode } from "./graph";

export type RouteResult = {
  nodeIds: number[];
  coordinates: LatLon[];
  distanceMeters: number;
  weightedCost: number;
  trafficLights: number;
  startNode: GraphNode;
  endNode: GraphNode;
  startSnapDistance: number;
  endSnapDistance: number;
  visitedNodes: number;
};

export type RouteOptions = {
  trafficLightPenaltyMeters: number;
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
    coordinates,
    startNode: startSnap.node,
    endNode: endSnap.node,
    startSnapDistance: startSnap.distanceMeters,
    endSnapDistance: endSnap.distanceMeters,
  };
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
