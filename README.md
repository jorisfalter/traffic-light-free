# Traffic-Light-Free Amsterdam

A first prototype for cycling routes in Amsterdam that can compare a normal route with a route that heavily penalizes OSM traffic-light nodes.

## What Exists Now

- A Vite + React + Leaflet map app.
- Address search through Nominatim for explicit start/finish searches.
- Overpass fetches for bike-relevant OSM ways and traffic signals around the selected route.
- A local in-browser bike graph built from OSM ways.
- A* routing over that graph.
- Two route calculations:
  - normal route;
  - traffic-light-avoidance route.

The architecture/options note is in [docs/routing-options.md](docs/routing-options.md).

## Run It

```bash
npm install
npm run dev
```

Then open the local URL printed by Vite.

## Caveats

This is intentionally a learning prototype. It still needs better bike access handling, turn modeling, ferries, route instructions, and a move away from public Overpass as the main data source.
