# Traffic-Light-Free Cycling Routes In Amsterdam

This document captures the practical options for building a cyclist route planner that avoids traffic lights using OpenStreetMap data.

## Goal

Build a route planner for Amsterdam that can answer:

- What is the normal cycling route from A to B?
- What is the best route if traffic lights are heavily penalized?
- Is a truly traffic-light-free route possible, or only a lower-light route?
- How much extra distance/time does avoiding lights cost?

## Relevant OSM Tags

Traffic lights are commonly represented in OSM with:

```txt
highway=traffic_signals
```

Crossings may also be represented as:

```txt
highway=crossing
crossing=traffic_signals
```

Cycle-specific signal mapping can include tags such as `traffic_signals:bicycle=*`, `traffic_signals:direction=*`, and red-turn exceptions. The most important rule for routing is that traffic signal nodes should be attached to the ways they affect, not merely placed beside the road.

Source: [OSM traffic signals wiki](https://wiki.openstreetmap.org/wiki/Tag%3Ahighway%3Dtraffic_signals).

## Option 1: Hosted Routing API

Use an existing hosted routing provider for cycling routes.

Examples:

- GraphHopper Directions API
- Mapbox Directions
- OpenRouteService
- Stadia/Valhalla-backed services
- OSRM demo servers for experiments only

Pros:

- Fastest route to a prototype.
- No routing infrastructure to operate.
- Good turn-by-turn instructions and route geometry.

Cons:

- Usually limited control over custom traffic-light penalties.
- Some APIs expose custom profiles, but not necessarily signal-level OSM data.
- Request volume and pricing can become meaningful.
- You depend on the provider's OSM import choices and update cadence.

Best use:

- Prototype normal bike routing and UI quickly.
- Compare your local routes against a known baseline.

GraphHopper has custom routing profiles based on built-in profiles such as `bike`, with custom model rules for priority/speed/distance influence. Source: [GraphHopper custom profiles](https://docs.graphhopper.com/openapi/custom-profiles).

## Option 2: Self-Hosted Routing Engine

Run a routing engine locally or on a server, import OSM extracts, and customize the bike profile.

Candidates:

- OSRM
- GraphHopper
- Valhalla
- BRouter

Pros:

- Serious production path.
- Much faster than doing routing directly over raw OSM.
- Lets the web app stay small: the app calls your `/route` endpoint.
- Can update OSM data on a schedule.

Cons:

- More infrastructure.
- Custom signal avoidance depends on engine internals.
- Reprocessing is needed when profiles or OSM data change.

### OSRM

OSRM profiles are Lua scripts run during preprocessing. They can process OSM nodes and turns, including traffic signals as obstacles/delays. This is a strong fit for "traffic lights add route cost".

Important consequence: profile changes happen at preprocessing time, not per request. If we want both normal and avoid-light routing, we likely run two profiles or two preprocessed datasets.

Source: [OSRM profiles documentation](https://github.com/Project-OSRM/osrm-backend/blob/master/docs/profiles.md).

### GraphHopper

GraphHopper is attractive because it has good bike support and custom profiles. The question to validate is whether the needed traffic-signal information is available as an encoded routing attribute in the profile/custom model path. If not, it may require custom GraphHopper code or preprocessing.

Best use:

- Good candidate for production if signal penalties can be modeled cleanly.

### Valhalla

Valhalla supports dynamic costing at request time and bicycle costing options. It is flexible, but adding a custom traffic-signal cost may require deeper engine work unless an existing costing field already exposes the signal data needed.

Source: [Valhalla turn-by-turn API reference](https://valhalla.github.io/valhalla/api/turn-by-turn/api-reference/).

### BRouter

BRouter is strong for bike routing and custom profiles. It is worth testing if it exposes traffic signal nodes in a way the profile language can penalize.

Best use:

- Bike-first experimentation.
- Offline/mobile-inspired routing.

## Option 3: Fully Local Browser Routing

Fetch or ship a compact Amsterdam bike graph and run A* or Dijkstra in the browser.

Pros:

- Maximum control.
- No per-route API cost.
- Great for experimentation and transparency.
- Amsterdam is small enough that a preprocessed graph may be feasible.

Cons:

- Raw OSM is too large and messy to use directly in the browser.
- Need to handle snapping, access tags, one-way cycling, bridges, ferries, private roads, disconnected graph issues, and updates.
- Turn-by-turn instructions are extra work.

Best use:

- First proof-of-concept.
- Research UI.
- A public demo if the graph is preprocessed and cached.

Important distinction:

```txt
Bad browser path:
  Download raw OSM PBF/XML in the browser and parse everything there.

Good browser path:
  Preprocess OSM into a compact bike graph, then route over that graph locally.
```

## Option 4: Hybrid Local Graph + Server Preprocessing

Preprocess OSM server-side into a compact graph format, then ship that graph to the browser.

Pros:

- Keeps route calculation local.
- Avoids running a full routing service.
- Easy to customize traffic-light cost.
- Good fit for one city.

Cons:

- You own graph correctness.
- You need a graph update pipeline.
- Browser memory and download size need watching.

Potential graph artifacts:

- `nodes.bin` or `nodes.parquet`: id, lat, lon, signal flag.
- `edges.bin`: from, to, distance, road class, bike access flags.
- `spatial-index.bin`: for snapping start/end points.
- Optional route tile chunks by area.

## Data Sources

### Overpass API

Good for experiments and targeted feature queries.

Example: traffic lights in an Amsterdam bbox.

```overpass
[out:json][timeout:60];
(
  node["highway"="traffic_signals"](52.27,4.73,52.43,5.08);
  node["crossing"="traffic_signals"](52.27,4.73,52.43,5.08);
);
out body;
```

Pros:

- Easy.
- No local import required.
- Great for validating tags and coverage.

Cons:

- Not appropriate as the main production routing backend.
- Public instances are shared infrastructure.
- Large city-wide graph queries can time out.

Source: [Overpass bbox documentation](https://dev.overpass-api.de/overpass-doc/en/full_data/bbox.html).

### Nominatim Address Search

Good for turning a user-entered place or address into a coordinate.

The current prototype uses Nominatim only for explicit search submissions, not live autocomplete. The public OSMF Nominatim service has limited capacity, allows moderate user-triggered usage, and forbids client-side autocomplete against the public API. For a real app, use a proxy/cache or a hosted/self-hosted geocoder.

Sources:

- [Nominatim search API](https://nominatim.org/release-docs/latest/api/Search/)
- [OSMF Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/)

### Geofabrik OSM PBF Extracts

Best source for local preprocessing. Geofabrik publishes daily OSM extracts; the Netherlands and Noord-Holland extracts are available as `.osm.pbf`.

Pros:

- Complete raw OSM data for the region.
- Works with OSRM, GraphHopper, Valhalla, Osmium, pyosmium, and custom pipelines.
- Daily updates and diff files are available.

Cons:

- Requires preprocessing tooling.
- Full Netherlands extract is larger than needed; Noord-Holland or custom clipping is better.

Sources:

- [Geofabrik data overview](https://www.geofabrik.de/data/index.html)
- [Netherlands downloads](https://download.geofabrik.de/europe/netherlands.html)
- [Geofabrik technical notes](https://download.geofabrik.de/technical.html)

## Traffic-Light Avoidance Strategies

### Soft Penalty

Add a cost whenever a path passes through a traffic-signal node.

```txt
edge cost = distance + road_penalty + traffic_light_penalty
```

Recommended default. It still finds a route if traffic lights are unavoidable.

### Hard Ban

Treat signal nodes as impassable, except perhaps near the start/end.

This gives a true traffic-light-free route when one exists, but it can easily fail in Amsterdam or produce extreme detours.

### Multi-Objective Routing

Optimize a combination of:

- distance
- estimated time
- number of lights
- route comfort
- main-road exposure
- canal/bridge crossings

Then show tradeoffs:

```txt
Fastest: 14 min, 8 lights
Fewer lights: 18 min, 2 lights
Zero lights: no practical route found
```

### Route Alternatives

Compute several candidate routes with different signal penalties:

```txt
penalty = 0m
penalty = 150m
penalty = 400m
penalty = 900m
```

Then deduplicate similar paths and present the best few.

## Recommended Build Plan

1. Build a browser prototype that fetches a small OSM graph from Overpass and runs A* locally.
2. Compare normal routing vs high traffic-light penalty routing.
3. Validate whether Amsterdam traffic-signal coverage is good enough.
4. Move from Overpass to a Geofabrik/PBF preprocessing pipeline.
5. Decide between:
   - custom compact browser graph, or
   - self-hosted OSRM/GraphHopper/Valhalla.

## Current MVP Direction

This repository starts with option 3: a local browser routing prototype.

The first slice:

- fetches OSM bike-relevant ways and traffic signals from Overpass for the route area;
- builds an in-memory graph;
- snaps start/end points to graph nodes;
- runs A* twice:
  - normal route;
  - traffic-light-avoidance route;
- displays route distance and number of traffic lights crossed.

The traffic-light-avoidance route is now iterative: after the first weighted route is found, the app temporarily blocks the traffic-signal nodes on that candidate route and reruns routing for a few passes. This helps discover obvious local detours around light clusters that a single weighted route may still accept.

This is intentionally not the final production architecture. It is the fastest way to learn whether the product idea works.
