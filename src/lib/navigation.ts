import { formatDistance, haversineMeters, type LatLon } from "./geo";
import type { RouteResult } from "./routing";

export type NavigationTurnKind = "left" | "right" | "sharp-left" | "sharp-right" | "straight" | "finish";

export type NavigationInstruction = {
  index: number;
  kind: NavigationTurnKind;
  text: string;
  distanceFromStartMeters: number;
};

export type NavigationProgress = {
  completedMeters: number;
  remainingMeters: number;
  distanceToRouteMeters: number;
  distanceToInstructionMeters: number;
  closestSegmentIndex: number;
  snapPoint: LatLon;
  instruction: NavigationInstruction;
  offRoute: boolean;
  arrived: boolean;
};

const OFF_ROUTE_MIN_METERS = 45;
const ARRIVAL_METERS = 25;
const TURN_MIN_ANGLE_DEGREES = 34;
const TURN_LOOKAHEAD_METERS = 18;

export function getNavigationProgress(route: RouteResult, location: LatLon & { accuracy?: number }): NavigationProgress {
  const coordinates = route.coordinates;
  const measures = cumulativeDistances(coordinates);
  const closest = findClosestRoutePoint(coordinates, measures, location);
  const remainingMeters = Math.max(route.distanceMeters - closest.distanceFromStartMeters, 0);
  const instruction = nextInstruction(coordinates, measures, closest.distanceFromStartMeters);
  const distanceToInstructionMeters = Math.max(instruction.distanceFromStartMeters - closest.distanceFromStartMeters, 0);
  const offRouteThreshold = Math.max(OFF_ROUTE_MIN_METERS, (location.accuracy ?? 0) * 1.35);

  return {
    completedMeters: closest.distanceFromStartMeters,
    remainingMeters,
    distanceToRouteMeters: closest.distanceToRouteMeters,
    distanceToInstructionMeters,
    closestSegmentIndex: closest.segmentIndex,
    snapPoint: closest.point,
    instruction,
    offRoute: closest.distanceToRouteMeters > offRouteThreshold,
    arrived: remainingMeters <= ARRIVAL_METERS,
  };
}

export function navigationSummary(progress: NavigationProgress): string {
  if (progress.arrived) {
    return "Arrived";
  }

  if (progress.offRoute) {
    return `${formatDistance(progress.distanceToRouteMeters)} from route`;
  }

  return `${formatDistance(progress.remainingMeters)} remaining`;
}

function cumulativeDistances(points: LatLon[]): number[] {
  const measures = [0];

  for (let index = 1; index < points.length; index += 1) {
    measures.push(measures[index - 1] + haversineMeters(points[index - 1], points[index]));
  }

  return measures;
}

function findClosestRoutePoint(points: LatLon[], measures: number[], location: LatLon) {
  let closest = {
    point: points[0] ?? location,
    segmentIndex: 0,
    distanceFromStartMeters: 0,
    distanceToRouteMeters: Number.POSITIVE_INFINITY,
  };

  for (let index = 0; index < points.length - 1; index += 1) {
    const projection = projectPointToSegment(location, points[index], points[index + 1]);
    const distanceToRouteMeters = haversineMeters(location, projection.point);

    if (distanceToRouteMeters < closest.distanceToRouteMeters) {
      closest = {
        point: projection.point,
        segmentIndex: index,
        distanceFromStartMeters:
          measures[index] + haversineMeters(points[index], projection.point),
        distanceToRouteMeters,
      };
    }
  }

  return closest;
}

function projectPointToSegment(point: LatLon, start: LatLon, end: LatLon): { point: LatLon; t: number } {
  const midLat = ((start.lat + end.lat + point.lat) / 3) * (Math.PI / 180);
  const scaleX = Math.cos(midLat);
  const ax = start.lon * scaleX;
  const ay = start.lat;
  const bx = end.lon * scaleX;
  const by = end.lat;
  const px = point.lon * scaleX;
  const py = point.lat;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const rawT = lengthSquared === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
  const t = Math.min(Math.max(rawT, 0), 1);

  return {
    t,
    point: {
      lat: start.lat + (end.lat - start.lat) * t,
      lon: start.lon + (end.lon - start.lon) * t,
    },
  };
}

function nextInstruction(points: LatLon[], measures: number[], completedMeters: number): NavigationInstruction {
  for (let index = 1; index < points.length - 1; index += 1) {
    if (measures[index] <= completedMeters + TURN_LOOKAHEAD_METERS) {
      continue;
    }

    const before = points[index - 1];
    const current = points[index];
    const after = points[index + 1];
    const angle = normalizeDegrees(bearingDegrees(current, after) - bearingDegrees(before, current));

    if (Math.abs(angle) < TURN_MIN_ANGLE_DEGREES) {
      continue;
    }

    const kind = turnKind(angle);
    return {
      index,
      kind,
      text: turnText(kind),
      distanceFromStartMeters: measures[index],
    };
  }

  return {
    index: points.length - 1,
    kind: "finish",
    text: "Continue to finish",
    distanceFromStartMeters: measures[measures.length - 1] ?? completedMeters,
  };
}

function turnKind(angle: number): NavigationTurnKind {
  if (angle <= -115) {
    return "sharp-left";
  }

  if (angle < 0) {
    return "left";
  }

  if (angle >= 115) {
    return "sharp-right";
  }

  return "right";
}

function turnText(kind: NavigationTurnKind): string {
  switch (kind) {
    case "sharp-left":
      return "Sharp left";
    case "left":
      return "Turn left";
    case "sharp-right":
      return "Sharp right";
    case "right":
      return "Turn right";
    case "finish":
      return "Continue to finish";
    case "straight":
    default:
      return "Continue straight";
  }
}

function bearingDegrees(from: LatLon, to: LatLon): number {
  const fromLat = toRadians(from.lat);
  const toLat = toRadians(to.lat);
  const deltaLon = toRadians(to.lon - from.lon);
  const y = Math.sin(deltaLon) * Math.cos(toLat);
  const x = Math.cos(fromLat) * Math.sin(toLat) - Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLon);

  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

function normalizeDegrees(value: number): number {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}
