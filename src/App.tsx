import {
  AlertTriangle,
  ArrowLeftRight,
  Bike,
  Flag,
  LocateFixed,
  LoaderCircle,
  MapPin,
  Navigation,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Geolocation, type CallbackID, type Position as CapacitorPosition } from "@capacitor/geolocation";
import L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { searchRouteAddress, type GeocodeResult } from "./lib/geocode";
import { formatDistance, formatLightCount, type LatLon } from "./lib/geo";
import { buildBikeGraph, extractSignalPoints, type BikeGraph, type SignalPoint } from "./lib/graph";
import { fetchBikeOsmData } from "./lib/overpass";
import { calculateIterativeSignalAvoidanceRoute, calculateRoute, type RouteResult } from "./lib/routing";

type EditTarget = "start" | "end";

type Routes = {
  normal: RouteResult | null;
  avoidLights: RouteResult | null;
};

type RoutePhase = "idle" | "fetching" | "building" | "routing" | "ready" | "error";
type SearchPhase = "idle" | "searching" | "ready" | "error";
type GpsPhase = "idle" | "requesting" | "tracking" | "error";

type HighlightedRouteSignal = LatLon & {
  id: number;
  normalIndex?: number;
  avoidLightsIndex?: number;
};

type GpsLocation = LatLon & {
  accuracy: number;
  heading: number | null;
  speed: number | null;
  timestamp: number;
};

type LocationWatch =
  | {
      source: "capacitor";
      id: CallbackID;
    }
  | {
      source: "web";
      id: number;
    };

const AMSTERDAM_CENTER: LatLon = { lat: 52.3676, lon: 4.9041 };
const DEFAULT_START: LatLon = { lat: 52.3786, lon: 4.8838 };
const DEFAULT_END: LatLon = { lat: 52.3571, lon: 4.9308 };
const EMPTY_ROUTES: Routes = { normal: null, avoidLights: null };

export default function App() {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const signalLayerRef = useRef<L.LayerGroup | null>(null);
  const routeSignalLayerRef = useRef<L.LayerGroup | null>(null);
  const gpsLayerRef = useRef<L.LayerGroup | null>(null);
  const editTargetRef = useRef<EditTarget>("start");
  const locationWatchIdRef = useRef<LocationWatch | null>(null);

  const [start, setStart] = useState<LatLon>(DEFAULT_START);
  const [end, setEnd] = useState<LatLon>(DEFAULT_END);
  const [editTarget, setEditTarget] = useState<EditTarget>("start");
  const [addressInputs, setAddressInputs] = useState<Record<EditTarget, string>>({
    start: "",
    end: "",
  });
  const [addressResults, setAddressResults] = useState<Record<EditTarget, GeocodeResult[]>>({
    start: [],
    end: [],
  });
  const [searchPhase, setSearchPhase] = useState<SearchPhase>("idle");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchTarget, setSearchTarget] = useState<EditTarget | null>(null);
  const [penaltyMeters, setPenaltyMeters] = useState(650);
  const [paddingKm, setPaddingKm] = useState(2.6);
  const [phase, setPhase] = useState<RoutePhase>("idle");
  const [statusText, setStatusText] = useState("Ready");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [graph, setGraph] = useState<BikeGraph | null>(null);
  const [signals, setSignals] = useState<SignalPoint[]>([]);
  const [routes, setRoutes] = useState<Routes>(EMPTY_ROUTES);
  const [overpassEndpoint, setOverpassEndpoint] = useState<string | null>(null);
  const [gpsPhase, setGpsPhase] = useState<GpsPhase>("idle");
  const [gpsLocation, setGpsLocation] = useState<GpsLocation | null>(null);
  const [gpsFollowMode, setGpsFollowMode] = useState(true);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const routeButtonLabel = phase === "fetching" || phase === "building" || phase === "routing" ? "Routing" : "Route";
  const isBusy = phase === "fetching" || phase === "building" || phase === "routing";

  const routeComparison = useMemo(() => {
    if (!routes.normal || !routes.avoidLights) {
      return null;
    }

    return {
      extraDistance: routes.avoidLights.distanceMeters - routes.normal.distanceMeters,
      fewerLights: routes.normal.trafficLights - routes.avoidLights.trafficLights,
    };
  }, [routes]);

  useEffect(() => {
    editTargetRef.current = editTarget;
  }, [editTarget]);

  useEffect(() => {
    if (!mapElementRef.current || mapRef.current) {
      return;
    }

    const map = L.map(mapElementRef.current, {
      zoomControl: false,
    }).setView([AMSTERDAM_CENTER.lat, AMSTERDAM_CENTER.lon], 13);

    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    signalLayerRef.current = L.layerGroup().addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);
    routeSignalLayerRef.current = L.layerGroup().addTo(map);
    gpsLayerRef.current = L.layerGroup().addTo(map);
    markerLayerRef.current = L.layerGroup().addTo(map);

    map.on("click", (event) => {
      const point = { lat: event.latlng.lat, lon: event.latlng.lng };
      setRoutePoint(editTargetRef.current, point);
    });

    mapRef.current = map;
    map.getContainer().style.cursor = "crosshair";

    window.setTimeout(() => {
      map.invalidateSize();
    }, 0);
  }, []);

  useEffect(() => {
    return () => {
      void clearGpsWatch(locationWatchIdRef);
    };
  }, []);

  useEffect(() => {
    const markerLayer = markerLayerRef.current;
    if (!markerLayer) {
      return;
    }

    markerLayer.clearLayers();
    addPointMarker(markerLayer, start, "start", "Start");
    addPointMarker(markerLayer, end, "end", "Finish");
  }, [start, end]);

  useEffect(() => {
    const signalLayer = signalLayerRef.current;
    if (!signalLayer) {
      return;
    }

    signalLayer.clearLayers();
    for (const signal of signals.slice(0, 2_500)) {
      L.circleMarker([signal.lat, signal.lon], {
        radius: 3,
        color: "#7f1d1d",
        weight: 1,
        fillColor: "#f59e0b",
        fillOpacity: 0.72,
        opacity: 0.6,
      }).addTo(signalLayer);
    }
  }, [signals]);

  useEffect(() => {
    const routeLayer = routeLayerRef.current;
    const map = mapRef.current;
    if (!routeLayer || !map) {
      return;
    }

    routeLayer.clearLayers();

    const lines: L.Polyline[] = [];

    if (routes.normal) {
      const normalLine = L.polyline(toLeafletLatLngs(routes.normal.coordinates), {
        color: "#2563eb",
        weight: 5,
        opacity: 0.55,
        dashArray: "8 8",
      }).addTo(routeLayer);
      normalLine.bindTooltip("Normal", { sticky: true });
      lines.push(normalLine);
    }

    if (routes.avoidLights) {
      const avoidLine = L.polyline(toLeafletLatLngs(routes.avoidLights.coordinates), {
        color: "#0f766e",
        weight: 6,
        opacity: 0.9,
      }).addTo(routeLayer);
      avoidLine.bindTooltip("Avoid lights", { sticky: true });
      lines.push(avoidLine);
    }

    if (lines.length > 0) {
      const bounds = L.featureGroup(lines).getBounds();
      map.fitBounds(bounds.pad(0.18), { animate: true, maxZoom: 15 });
    }
  }, [routes]);

  useEffect(() => {
    const routeSignalLayer = routeSignalLayerRef.current;
    if (!routeSignalLayer) {
      return;
    }

    routeSignalLayer.clearLayers();
    if (!graph) {
      return;
    }

    const routeSignals = getHighlightedRouteSignals(routes, graph);
    for (const signal of routeSignals) {
      const inNormal = signal.normalIndex !== undefined;
      const inAvoidLights = signal.avoidLightsIndex !== undefined;
      const bothRoutes = inNormal && inAvoidLights;
      const marker = L.circleMarker([signal.lat, signal.lon], {
        radius: bothRoutes ? 9 : 8,
        color: bothRoutes ? "#111827" : inAvoidLights ? "#0f766e" : "#2563eb",
        weight: 3,
        fillColor: bothRoutes ? "#fbbf24" : "#ffffff",
        fillOpacity: 0.96,
        opacity: 1,
        className: "route-signal-marker",
      }).addTo(routeSignalLayer);

      marker.bindTooltip(routeSignalLabel(signal), {
        sticky: true,
        className: "route-signal-tooltip",
      });
    }
  }, [routes, graph]);

  useEffect(() => {
    const gpsLayer = gpsLayerRef.current;
    const map = mapRef.current;
    if (!gpsLayer || !map) {
      return;
    }

    gpsLayer.clearLayers();
    if (!gpsLocation) {
      return;
    }

    if (gpsLocation.accuracy <= 500) {
      L.circle([gpsLocation.lat, gpsLocation.lon], {
        radius: gpsLocation.accuracy,
        color: "#0f766e",
        weight: 1,
        fillColor: "#0f766e",
        fillOpacity: 0.08,
        opacity: 0.35,
      }).addTo(gpsLayer);
    }

    const marker = L.circleMarker([gpsLocation.lat, gpsLocation.lon], {
      radius: 10,
      color: "#ffffff",
      weight: 4,
      fillColor: "#0f766e",
      fillOpacity: 1,
      opacity: 1,
      className: "gps-location-marker",
    }).addTo(gpsLayer);

    marker.bindTooltip(`GPS · ±${Math.round(gpsLocation.accuracy)} m`, {
      sticky: true,
      className: "gps-tooltip",
    });

    if (gpsFollowMode) {
      const targetZoom = Math.max(map.getZoom(), 16);
      map.setView([gpsLocation.lat, gpsLocation.lon], targetZoom, { animate: true });
    }
  }, [gpsLocation, gpsFollowMode]);

  async function handleRoute() {
    setErrorText(null);
    setPhase("fetching");
    setStatusText("Fetching OSM data");

    try {
      const payload = await fetchBikeOsmData(start, end, paddingKm);
      setOverpassEndpoint(payload.endpoint);
      setSignals(extractSignalPoints(payload.elements));

      setPhase("building");
      setStatusText("Building bike graph");
      await nextFrame();

      const nextGraph = buildBikeGraph(payload.elements);
      setGraph(nextGraph);

      setPhase("routing");
      setStatusText("Calculating route alternatives");
      await nextFrame();

      const normal = calculateRoute(nextGraph, start, end, { trafficLightPenaltyMeters: 0 });
      const avoidLights = calculateIterativeSignalAvoidanceRoute(nextGraph, start, end, {
        trafficLightPenaltyMeters: penaltyMeters,
        maxIterations: 7,
        referenceDistanceMeters: normal?.distanceMeters,
        maxDistanceFactor: 2.4,
        maxExtraDistanceMeters: 4_500,
      });

      if (!normal && !avoidLights) {
        throw new Error("No route found in this OSM extract. Try a larger search buffer or nearby points.");
      }

      setRoutes({ normal, avoidLights });
      setPhase("ready");
      setStatusText("Routes ready");
    } catch (error) {
      setPhase("error");
      setStatusText("Route failed");
      setErrorText(error instanceof Error ? error.message : "Something went wrong while routing.");
    }
  }

  function handleGpsToggle() {
    if (gpsPhase === "tracking" || gpsPhase === "requesting") {
      void stopGpsTracking();
      return;
    }

    void startGpsTracking();
  }

  async function startGpsTracking() {
    await clearGpsWatch(locationWatchIdRef);

    setGpsPhase("requesting");
    setGpsError(null);
    setGpsFollowMode(true);

    if (Capacitor.isNativePlatform()) {
      try {
        const permission = await Geolocation.requestPermissions({ permissions: ["location"] });
        if (permission.location === "denied") {
          throw new Error("Location permission was denied.");
        }

        const id = await Geolocation.watchPosition(
          {
            enableHighAccuracy: true,
            maximumAge: 2_000,
            timeout: 15_000,
          },
          (position, error) => {
            if (error) {
              setGpsPhase("error");
              setGpsError(gpsErrorMessage(error));
              return;
            }

            if (position) {
              setGpsLocation(gpsLocationFromCapacitor(position));
              setGpsPhase("tracking");
            }
          },
        );

        locationWatchIdRef.current = { source: "capacitor", id };
      } catch (error) {
        setGpsPhase("error");
        setGpsError(gpsErrorMessage(error));
      }

      return;
    }

    if (!navigator.geolocation) {
      setGpsPhase("error");
      setGpsError("GPS is not available in this browser.");
      return;
    }

    const id = navigator.geolocation.watchPosition(
      (position) => {
        setGpsLocation({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy: position.coords.accuracy,
          heading: position.coords.heading,
          speed: position.coords.speed,
          timestamp: position.timestamp,
        });
        setGpsPhase("tracking");
      },
      (error) => {
        setGpsPhase("error");
        setGpsError(gpsErrorMessage(error));
      },
      {
        enableHighAccuracy: true,
        maximumAge: 2_000,
        timeout: 15_000,
      },
    );

    locationWatchIdRef.current = { source: "web", id };
  }

  async function stopGpsTracking() {
    await clearGpsWatch(locationWatchIdRef);

    setGpsPhase("idle");
    setGpsError(null);
    setGpsLocation(null);
  }

  function useGpsAsStart() {
    if (!gpsLocation) {
      return;
    }

    setRoutePoint("start", gpsLocation);
    setAddressInputs((current) => ({ ...current, start: "Current GPS location" }));
    setGpsFollowMode(true);
  }

  async function handleAddressSearch(target: EditTarget) {
    const query = addressInputs[target];
    setSearchTarget(target);
    setSearchPhase("searching");
    setSearchError(null);

    try {
      const results = await searchRouteAddress(query);
      setAddressResults((current) => ({ ...current, [target]: results }));

      if (results.length === 0) {
        setSearchPhase("error");
        setSearchError("No address found in the Amsterdam region.");
        return;
      }

      applyGeocodeResult(target, results[0]);
      setSearchPhase("ready");
    } catch (error) {
      setSearchPhase("error");
      setSearchError(error instanceof Error ? error.message : "Address search failed.");
    }
  }

  function applyGeocodeResult(target: EditTarget, result: GeocodeResult) {
    setRoutePoint(target, result);
    setAddressInputs((current) => ({ ...current, [target]: compactAddress(result.label) }));

    const map = mapRef.current;
    if (map) {
      map.flyTo([result.lat, result.lon], Math.max(map.getZoom(), 15), { duration: 0.55 });
    }
  }

  function setRoutePoint(target: EditTarget, point: LatLon) {
    if (target === "start") {
      setStart(point);
      setEditTarget("end");
    } else {
      setEnd(point);
      setEditTarget("start");
    }

    setRoutes(EMPTY_ROUTES);
    setGraph(null);
    setSignals([]);
    setOverpassEndpoint(null);
    setPhase("idle");
    setStatusText("Ready");
    setErrorText(null);
  }

  function handleSwap() {
    setStart(end);
    setEnd(start);
    setRoutes(EMPTY_ROUTES);
    setGraph(null);
    setSignals([]);
    setOverpassEndpoint(null);
  }

  function handleReset() {
    setStart(DEFAULT_START);
    setEnd(DEFAULT_END);
    setRoutes(EMPTY_ROUTES);
    setSignals([]);
    setGraph(null);
    setPhase("idle");
    setStatusText("Ready");
    setErrorText(null);
    setSearchPhase("idle");
    setSearchError(null);
    setAddressInputs({ start: "", end: "" });
    setAddressResults({ start: [], end: [] });
    setOverpassEndpoint(null);
  }

  return (
    <main className="app-shell">
      <section className="map-stage" aria-label="Amsterdam region cycling map">
        <div ref={mapElementRef} className="map-canvas" />
      </section>

      <aside className="control-panel" aria-label="Route controls">
        <header className="panel-header">
          <div className="brand-mark">
            <Bike size={22} strokeWidth={2.2} />
          </div>
          <div>
            <h1>Lightless Bike</h1>
            <p>Amsterdam region</p>
          </div>
        </header>

        <section className="address-panel" aria-label="Address search">
          <AddressSearchRow
            target="start"
            label="Start address"
            value={addressInputs.start}
            results={addressResults.start}
            isSearching={searchPhase === "searching" && searchTarget === "start"}
            onValueChange={(value) => setAddressInputs((current) => ({ ...current, start: value }))}
            onSearch={() => handleAddressSearch("start")}
            onPick={(result) => applyGeocodeResult("start", result)}
          />
          <AddressSearchRow
            target="end"
            label="Finish address"
            value={addressInputs.end}
            results={addressResults.end}
            isSearching={searchPhase === "searching" && searchTarget === "end"}
            onValueChange={(value) => setAddressInputs((current) => ({ ...current, end: value }))}
            onSearch={() => handleAddressSearch("end")}
            onPick={(result) => applyGeocodeResult("end", result)}
          />
          {searchError ? <p className="search-error">{searchError}</p> : null}
        </section>

        <div className="target-switch" role="group" aria-label="Point selector">
          <button
            className={editTarget === "start" ? "active" : ""}
            type="button"
            onClick={() => setEditTarget("start")}
          >
            <MapPin size={17} />
            Start
          </button>
          <button
            className={editTarget === "end" ? "active" : ""}
            type="button"
            onClick={() => setEditTarget("end")}
          >
            <Flag size={17} />
            Finish
          </button>
        </div>

        <div className="coordinate-grid">
          <CoordinateReadout label="Start" point={start} />
          <CoordinateReadout label="Finish" point={end} />
        </div>

        <div className="toolbar">
          <button
            type="button"
            className={`icon-button gps-toggle ${gpsPhase === "tracking" ? "active" : ""}`}
            onClick={handleGpsToggle}
            title={gpsPhase === "tracking" || gpsPhase === "requesting" ? "Stop GPS" : "Start GPS"}
          >
            {gpsPhase === "requesting" ? <LoaderCircle className="spin" size={18} /> : <LocateFixed size={18} />}
          </button>
          <button type="button" className="icon-button" onClick={handleSwap} title="Swap start and finish">
            <ArrowLeftRight size={18} />
          </button>
          <button type="button" className="icon-button" onClick={handleReset} title="Reset route">
            <RefreshCw size={18} />
          </button>
          <button type="button" className="primary-button" onClick={handleRoute} disabled={isBusy}>
            {isBusy ? <LoaderCircle className="spin" size={18} /> : <Navigation size={18} />}
            {routeButtonLabel}
          </button>
        </div>

        <section className="gps-panel" aria-label="GPS controls">
          <div className="gps-actions">
            <button type="button" onClick={useGpsAsStart} disabled={!gpsLocation}>
              Start here
            </button>
            <button
              type="button"
              className={gpsFollowMode ? "active" : ""}
              onClick={() => setGpsFollowMode((current) => !current)}
              disabled={!gpsLocation}
            >
              Follow
            </button>
          </div>
          <div className="gps-meta">
            <span>{gpsLabel(gpsPhase, gpsLocation)}</span>
            {gpsLocation?.speed !== null && gpsLocation?.speed !== undefined ? (
              <span>{formatSpeed(gpsLocation.speed)}</span>
            ) : null}
          </div>
          {gpsError ? <p className="gps-error">{gpsError}</p> : null}
        </section>

        <section className="settings-panel" aria-label="Route weighting">
          <div className="section-title">
            <SlidersHorizontal size={17} />
            Cost model
          </div>
          <label className="range-row">
            <span>Light penalty</span>
            <strong>{penaltyMeters} m</strong>
            <input
              min="150"
              max="1400"
              step="50"
              type="range"
              value={penaltyMeters}
              onChange={(event) => setPenaltyMeters(Number(event.target.value))}
            />
          </label>
          <label className="range-row">
            <span>Search buffer</span>
            <strong>{paddingKm.toFixed(1)} km</strong>
            <input
              min="1.2"
              max="5"
              step="0.2"
              type="range"
              value={paddingKm}
              onChange={(event) => setPaddingKm(Number(event.target.value))}
            />
          </label>
        </section>

        <section className="status-strip" aria-live="polite">
          <span className={`status-dot ${phase}`} />
          <span>{statusText}</span>
        </section>

        {errorText ? (
          <section className="error-panel">
            <AlertTriangle size={18} />
            <span>{errorText}</span>
          </section>
        ) : null}

        <section className="route-list" aria-label="Route results">
          <RouteSummary title="Normal" accent="blue" route={routes.normal} />
          <RouteSummary title="Avoid lights" accent="green" route={routes.avoidLights} />
        </section>

        {routeComparison ? (
          <section className="comparison-panel">
            <strong>{formatLightCount(Math.max(routeComparison.fewerLights, 0))} fewer</strong>
            <span>{formatDistance(Math.max(routeComparison.extraDistance, 0))} extra distance</span>
          </section>
        ) : null}

        {routes.normal || routes.avoidLights ? (
          <section className="route-light-key" aria-label="Highlighted traffic lights">
            <span>
              <i className="key-dot normal" />
              Normal
            </span>
            <span>
              <i className="key-dot avoid" />
              Avoid lights
            </span>
            <span>
              <i className="key-dot both" />
              Both
            </span>
          </section>
        ) : null}

        {graph ? (
          <footer className="data-footnote">
            <span>{graph.stats.routedNodes.toLocaleString()} nodes</span>
            <span>{graph.stats.signalNodes.toLocaleString()} routed lights</span>
            <span>{signals.length.toLocaleString()} mapped lights</span>
            {overpassEndpoint ? <span>{new URL(overpassEndpoint).hostname}</span> : null}
          </footer>
        ) : null}
      </aside>
    </main>
  );
}

function AddressSearchRow({
  target,
  label,
  value,
  results,
  isSearching,
  onValueChange,
  onSearch,
  onPick,
}: {
  target: EditTarget;
  label: string;
  value: string;
  results: GeocodeResult[];
  isSearching: boolean;
  onValueChange: (value: string) => void;
  onSearch: () => void;
  onPick: (result: GeocodeResult) => void;
}) {
  return (
    <form
      className={`address-row ${target}`}
      onSubmit={(event) => {
        event.preventDefault();
        onSearch();
      }}
    >
      <label>
        <span>{label}</span>
        <div className="address-input-wrap">
          <input
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            placeholder={target === "start" ? "Amsterdam Centraal" : "Gerard Doulaan 1, Amstelveen"}
          />
          <button type="submit" title={`Search ${label.toLowerCase()}`} disabled={isSearching || value.trim().length < 2}>
            {isSearching ? <LoaderCircle className="spin" size={17} /> : <Search size={17} />}
          </button>
        </div>
      </label>

      {results.length > 1 ? (
        <div className="address-results">
          {results.slice(0, 3).map((result) => (
            <button key={result.id} type="button" onClick={() => onPick(result)}>
              {compactAddress(result.label)}
            </button>
          ))}
        </div>
      ) : null}
    </form>
  );
}

function CoordinateReadout({ label, point }: { label: string; point: LatLon }) {
  return (
    <div className="coordinate-readout">
      <span>{label}</span>
      <strong>
        {point.lat.toFixed(5)}, {point.lon.toFixed(5)}
      </strong>
    </div>
  );
}

function RouteSummary({
  title,
  accent,
  route,
}: {
  title: string;
  accent: "blue" | "green";
  route: RouteResult | null;
}) {
  return (
    <article className={`route-summary ${accent}`}>
      <div>
        <h2>{title}</h2>
        {route ? <p>{routeSummaryMeta(route)}</p> : <p>Not calculated</p>}
      </div>
      <dl>
        <div>
          <dt>Distance</dt>
          <dd>{route ? formatDistance(route.distanceMeters) : "--"}</dd>
        </div>
        <div>
          <dt>Lights</dt>
          <dd>{route ? route.trafficLights : "--"}</dd>
        </div>
      </dl>
    </article>
  );
}

function routeSummaryMeta(route: RouteResult): string {
  const passes = route.searchPasses > 1 ? ` · ${route.searchPasses} passes` : "";
  return `${route.visitedNodes.toLocaleString()} visited nodes${passes}`;
}

function gpsLabel(phase: GpsPhase, location: GpsLocation | null): string {
  if (phase === "requesting") {
    return "GPS starting";
  }

  if (phase === "error") {
    return "GPS unavailable";
  }

  if (!location) {
    return "GPS off";
  }

  return `GPS ±${Math.round(location.accuracy)} m`;
}

async function clearGpsWatch(watchRef: { current: LocationWatch | null }): Promise<void> {
  const watch = watchRef.current;
  if (!watch) {
    return;
  }

  watchRef.current = null;

  if (watch.source === "capacitor") {
    await Geolocation.clearWatch({ id: watch.id });
    return;
  }

  navigator.geolocation.clearWatch(watch.id);
}

function gpsLocationFromCapacitor(position: CapacitorPosition): GpsLocation {
  return {
    lat: position.coords.latitude,
    lon: position.coords.longitude,
    accuracy: position.coords.accuracy,
    heading: position.coords.heading,
    speed: position.coords.speed,
    timestamp: position.timestamp,
  };
}

function gpsErrorMessage(error: unknown): string {
  if (isWebGeolocationError(error)) {
    if (error.code === 1) {
      return "Location permission was denied.";
    }

    if (error.code === 2) {
      return "Current location is unavailable.";
    }

    if (error.code === 3) {
      return "GPS lookup timed out.";
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "object" && error && "message" in error && typeof error.message === "string") {
    return error.message;
  }

  return "Could not read current location.";
}

function isWebGeolocationError(error: unknown): error is GeolocationPositionError {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "number";
}

function formatSpeed(speedMetersPerSecond: number): string {
  return `${Math.round(speedMetersPerSecond * 3.6)} km/h`;
}

function getHighlightedRouteSignals(routes: Routes, graph: BikeGraph): HighlightedRouteSignal[] {
  const signalsById = new Map<number, HighlightedRouteSignal>();

  addRouteSignals(routes.normal, graph, signalsById, "normalIndex");
  addRouteSignals(routes.avoidLights, graph, signalsById, "avoidLightsIndex");

  return Array.from(signalsById.values());
}

function addRouteSignals(
  route: RouteResult | null,
  graph: BikeGraph,
  signalsById: Map<number, HighlightedRouteSignal>,
  indexKey: "normalIndex" | "avoidLightsIndex",
) {
  if (!route) {
    return;
  }

  let routeSignalIndex = 0;

  for (let index = 1; index < route.nodeIds.length - 1; index += 1) {
    const node = graph.nodes.get(route.nodeIds[index]);
    if (!node?.signal) {
      continue;
    }

    routeSignalIndex += 1;

    const existing = signalsById.get(node.id);
    if (existing) {
      existing[indexKey] = routeSignalIndex;
      continue;
    }

    signalsById.set(node.id, {
      id: node.id,
      lat: node.lat,
      lon: node.lon,
      [indexKey]: routeSignalIndex,
    });
  }
}

function routeSignalLabel(signal: HighlightedRouteSignal): string {
  const labels: string[] = [];

  if (signal.normalIndex !== undefined) {
    labels.push(`Normal light ${signal.normalIndex}`);
  }

  if (signal.avoidLightsIndex !== undefined) {
    labels.push(`Avoid light ${signal.avoidLightsIndex}`);
  }

  labels.push(`OSM node ${signal.id}`);

  return labels.join(" · ");
}

function compactAddress(label: string): string {
  return label
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(", ");
}

function addPointMarker(layer: L.LayerGroup, point: LatLon, kind: "start" | "end", label: string) {
  const marker = L.circleMarker([point.lat, point.lon], {
    radius: 9,
    weight: 3,
    color: kind === "start" ? "#0f766e" : "#be123c",
    fillColor: "#ffffff",
    fillOpacity: 1,
  });

  marker.bindTooltip(label, {
    permanent: true,
    direction: "top",
    offset: [0, -10],
    className: `point-tooltip ${kind}`,
  });
  marker.addTo(layer);
}

function toLeafletLatLngs(points: LatLon[]): L.LatLngExpression[] {
  return points.map((point) => [point.lat, point.lon]);
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}
