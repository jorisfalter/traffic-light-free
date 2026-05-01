export type LatLon = {
  lat: number;
  lon: number;
};

export type BBox = {
  south: number;
  west: number;
  north: number;
  east: number;
};

const EARTH_RADIUS_METERS = 6_371_000;

export function haversineMeters(a: LatLon, b: LatLon): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

export function bboxAround(points: LatLon[], paddingKm: number): BBox {
  const latitudes = points.map((point) => point.lat);
  const longitudes = points.map((point) => point.lon);
  const midLat = latitudes.reduce((sum, value) => sum + value, 0) / latitudes.length;
  const latPadding = paddingKm / 111;
  const lonPadding = paddingKm / (111 * Math.max(Math.cos(toRadians(midLat)), 0.15));

  return {
    south: Math.min(...latitudes) - latPadding,
    west: Math.min(...longitudes) - lonPadding,
    north: Math.max(...latitudes) + latPadding,
    east: Math.max(...longitudes) + lonPadding,
  };
}

export function bboxToOverpass(bbox: BBox): string {
  return [
    bbox.south.toFixed(6),
    bbox.west.toFixed(6),
    bbox.north.toFixed(6),
    bbox.east.toFixed(6),
  ].join(",");
}

export function formatDistance(meters: number): string {
  if (meters < 950) {
    return `${Math.round(meters)} m`;
  }

  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatLightCount(count: number): string {
  return count === 1 ? "1 light" : `${count} lights`;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
