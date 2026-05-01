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
const AMSTERDAM_VIEWBOX = "4.7288,52.4312,5.0792,52.2780";

export async function searchAmsterdamAddress(query: string): Promise<GeocodeResult[]> {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length < 2) {
    return [];
  }

  const scopedQuery = /amsterdam|nederland|netherlands/i.test(trimmedQuery)
    ? trimmedQuery
    : `${trimmedQuery}, Amsterdam`;

  const params = new URLSearchParams({
    q: scopedQuery,
    format: "jsonv2",
    limit: "5",
    addressdetails: "1",
    countrycodes: "nl",
    viewbox: AMSTERDAM_VIEWBOX,
    bounded: "1",
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
    .filter((result) => Number.isFinite(result.lat) && Number.isFinite(result.lon));
}
