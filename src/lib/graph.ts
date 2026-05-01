import { haversineMeters, type LatLon } from "./geo";
import { isTrafficSignal, type OsmElement, type OsmNodeElement, type OsmTags, type OsmWayElement } from "./overpass";

export type GraphEdge = {
  to: number;
  distanceMeters: number;
  multiplier: number;
  highway: string;
  wayId: number;
};

export type GraphNode = {
  id: number;
  lat: number;
  lon: number;
  signal: boolean;
  edges: GraphEdge[];
};

export type BikeGraph = {
  nodes: Map<number, GraphNode>;
  signalNodeIds: Set<number>;
  stats: {
    osmNodes: number;
    osmWays: number;
    routedNodes: number;
    routedEdges: number;
    signalNodes: number;
    skippedWays: number;
  };
};

export type SignalPoint = LatLon & {
  id: number;
};

export function buildBikeGraph(elements: OsmElement[]): BikeGraph {
  const osmNodes = new Map<number, OsmNodeElement>();
  const ways: OsmWayElement[] = [];

  for (const element of elements) {
    if (element.type === "node") {
      osmNodes.set(element.id, element);
    } else if (element.type === "way") {
      ways.push(element);
    }
  }

  const graphNodes = new Map<number, GraphNode>();
  const signalNodeIds = new Set<number>();
  let routedEdges = 0;
  let skippedWays = 0;

  for (const way of ways) {
    if (!isBikeRoutableWay(way.tags)) {
      skippedWays += 1;
      continue;
    }

    const highway = way.tags?.highway ?? "road";
    const multiplier = roadMultiplier(way.tags);
    const direction = bikeDirection(way.tags);

    for (let index = 0; index < way.nodes.length - 1; index += 1) {
      const fromId = way.nodes[index];
      const toId = way.nodes[index + 1];
      const fromOsmNode = osmNodes.get(fromId);
      const toOsmNode = osmNodes.get(toId);

      if (!fromOsmNode || !toOsmNode) {
        continue;
      }

      const distanceMeters = haversineMeters(fromOsmNode, toOsmNode);
      if (!Number.isFinite(distanceMeters) || distanceMeters < 0.25) {
        continue;
      }

      const fromNode = ensureGraphNode(graphNodes, signalNodeIds, fromOsmNode);
      const toNode = ensureGraphNode(graphNodes, signalNodeIds, toOsmNode);

      if (direction !== "reverse") {
        fromNode.edges.push({
          to: toNode.id,
          distanceMeters,
          multiplier,
          highway,
          wayId: way.id,
        });
        routedEdges += 1;
      }

      if (direction !== "forward") {
        toNode.edges.push({
          to: fromNode.id,
          distanceMeters,
          multiplier,
          highway,
          wayId: way.id,
        });
        routedEdges += 1;
      }
    }
  }

  return {
    nodes: graphNodes,
    signalNodeIds,
    stats: {
      osmNodes: osmNodes.size,
      osmWays: ways.length,
      routedNodes: graphNodes.size,
      routedEdges,
      signalNodes: signalNodeIds.size,
      skippedWays,
    },
  };
}

export function extractSignalPoints(elements: OsmElement[]): SignalPoint[] {
  const points: SignalPoint[] = [];

  for (const element of elements) {
    if (element.type === "node" && isTrafficSignal(element.tags)) {
      points.push({
        id: element.id,
        lat: element.lat,
        lon: element.lon,
      });
    }
  }

  return points;
}

function ensureGraphNode(
  nodes: Map<number, GraphNode>,
  signalNodeIds: Set<number>,
  osmNode: OsmNodeElement,
): GraphNode {
  const existing = nodes.get(osmNode.id);
  if (existing) {
    return existing;
  }

  const signal = isTrafficSignal(osmNode.tags);
  const graphNode: GraphNode = {
    id: osmNode.id,
    lat: osmNode.lat,
    lon: osmNode.lon,
    signal,
    edges: [],
  };

  if (signal) {
    signalNodeIds.add(osmNode.id);
  }

  nodes.set(osmNode.id, graphNode);
  return graphNode;
}

function isBikeRoutableWay(tags?: OsmTags): boolean {
  const highway = tags?.highway;
  if (!highway || tags?.area === "yes") {
    return false;
  }

  const access = tags.access;
  const bicycle = tags.bicycle;

  if (["no", "private"].includes(access ?? "") && !["yes", "designated", "permissive"].includes(bicycle ?? "")) {
    return false;
  }

  if (["no", "private", "dismount", "use_sidepath"].includes(bicycle ?? "")) {
    return false;
  }

  if (["motorway", "motorway_link", "trunk", "trunk_link", "steps", "construction"].includes(highway)) {
    return false;
  }

  if (["footway", "pedestrian"].includes(highway)) {
    return ["yes", "designated", "permissive"].includes(bicycle ?? "");
  }

  return [
    "cycleway",
    "path",
    "residential",
    "living_street",
    "service",
    "unclassified",
    "tertiary",
    "tertiary_link",
    "secondary",
    "secondary_link",
    "primary",
    "primary_link",
    "track",
    "road",
  ].includes(highway);
}

function bikeDirection(tags?: OsmTags): "both" | "forward" | "reverse" {
  if (tags?.["oneway:bicycle"] === "no" || tags?.cycleway === "opposite" || tags?.["cycleway:left"] === "opposite") {
    return "both";
  }

  const oneway = tags?.oneway;
  if (oneway === "-1") {
    return "reverse";
  }

  if (["yes", "true", "1"].includes(oneway ?? "") || tags?.["oneway:bicycle"] === "yes") {
    return "forward";
  }

  return "both";
}

function roadMultiplier(tags?: OsmTags): number {
  switch (tags?.highway) {
    case "cycleway":
      return 0.82;
    case "living_street":
      return 0.9;
    case "path":
      return tags.bicycle === "designated" ? 0.86 : 0.98;
    case "residential":
      return 1;
    case "service":
      return 1.08;
    case "track":
      return 1.16;
    case "unclassified":
      return 1.08;
    case "tertiary":
    case "tertiary_link":
      return 1.18;
    case "secondary":
    case "secondary_link":
      return 1.34;
    case "primary":
    case "primary_link":
      return 1.58;
    case "pedestrian":
    case "footway":
      return 1.42;
    default:
      return 1.12;
  }
}
