import { bboxAround, bboxToOverpass, type BBox, type LatLon } from "./geo";

export type OsmTags = Record<string, string | undefined>;

export type OsmNodeElement = {
  type: "node";
  id: number;
  lat: number;
  lon: number;
  tags?: OsmTags;
};

export type OsmWayElement = {
  type: "way";
  id: number;
  nodes: number[];
  tags?: OsmTags;
};

export type OsmElement = OsmNodeElement | OsmWayElement;

export type OverpassPayload = {
  elements: OsmElement[];
  bbox: BBox;
  endpoint: string;
};

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const BIKE_RELEVANT_HIGHWAYS = [
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
  "pedestrian",
  "footway",
  "track",
  "road",
].join("|");

export async function fetchBikeOsmData(
  start: LatLon,
  end: LatLon,
  paddingKm: number,
): Promise<OverpassPayload> {
  const bbox = bboxAround([start, end], paddingKm);
  const overpassBBox = bboxToOverpass(bbox);
  const query = `
[out:json][timeout:35];
(
  way["highway"~"^(${BIKE_RELEVANT_HIGHWAYS})$"]["area"!="yes"](${overpassBBox});
  node["highway"="traffic_signals"](${overpassBBox});
  node["crossing"="traffic_signals"](${overpassBBox});
);
(._;>;);
out body qt;
`;

  let lastError: unknown;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 45_000);
      const body = new URLSearchParams({ data: query });

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body,
        signal: controller.signal,
      });

      window.clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Overpass returned ${response.status}`);
      }

      const json = (await response.json()) as { elements?: OsmElement[] };

      return {
        elements: json.elements ?? [],
        bbox,
        endpoint,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Could not reach Overpass");
}

export function isTrafficSignal(tags?: OsmTags): boolean {
  return (
    tags?.highway === "traffic_signals" ||
    tags?.crossing === "traffic_signals" ||
    tags?.["traffic_signals:bicycle"] === "yes"
  );
}
