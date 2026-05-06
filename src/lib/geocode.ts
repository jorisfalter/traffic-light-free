import type { LatLon } from "./geo";

export type GeocodeResult = LatLon & {
  id: string;
  label: string;
  type?: string;
};

type NominatimResult = {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
  type?: string;
};

const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const AMSTERDAM_REGION_BOUNDS = {
  west: 4.55,
  south: 52.15,
  east: 5.15,
  north: 52.55,
};
const AMSTERDAM_REGION_VIEWBOX = [
  AMSTERDAM_REGION_BOUNDS.west,
  AMSTERDAM_REGION_BOUNDS.north,
  AMSTERDAM_REGION_BOUNDS.east,
  AMSTERDAM_REGION_BOUNDS.south,
].join(",");

export async function searchRouteAddress(query: string): Promise<GeocodeResult[]> {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length < 2) {
    return [];
  }

  const primaryResults = await runNominatimSearch(trimmedQuery);
  if (primaryResults.length > 0 || hasPlaceQualifier(trimmedQuery)) {
    return primaryResults;
  }

  return runNominatimSearch(`${trimmedQuery}, Amsterdam`);
}

async function runNominatimSearch(query: string): Promise<GeocodeResult[]> {
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: "8",
    addressdetails: "1",
    countrycodes: "nl",
    viewbox: AMSTERDAM_REGION_VIEWBOX,
    "accept-language": "nl,en",
  });

  const response = await fetch(`${NOMINATIM_SEARCH_URL}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Address search returned ${response.status}`);
  }

  const results = (await response.json()) as NominatimResult[];

  return results
    .map((result) => ({
      id: String(result.place_id),
      lat: Number(result.lat),
      lon: Number(result.lon),
      label: result.display_name,
      type: result.type,
    }))
    .filter((result) => Number.isFinite(result.lat) && Number.isFinite(result.lon))
    .filter(isInAmsterdamRegion)
    .slice(0, 5);
}

function isInAmsterdamRegion(result: GeocodeResult): boolean {
  return (
    result.lon >= AMSTERDAM_REGION_BOUNDS.west &&
    result.lon <= AMSTERDAM_REGION_BOUNDS.east &&
    result.lat >= AMSTERDAM_REGION_BOUNDS.south &&
    result.lat <= AMSTERDAM_REGION_BOUNDS.north
  );
}

function hasPlaceQualifier(query: string): boolean {
  return /[,]|amsterdam|amstelveen|diemen|ouderkerk|badhoevedorp|zaandam|weesp|aalsmeer|hoofddorp|nederland|netherlands/i.test(
    query,
  );
}
