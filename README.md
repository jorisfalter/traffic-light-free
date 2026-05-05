# Traffic-Light-Free Amsterdam

A first prototype for cycling routes in Amsterdam that can compare a normal route with a route that heavily penalizes OSM traffic-light nodes.

## What Exists Now

- A Vite + React + Leaflet map app.
- Address search through Nominatim for explicit start/finish searches.
- iPhone-friendly PWA metadata and live GPS follow mode.
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

## iPhone

Open the deployed app in Safari, use Share -> Add to Home Screen, then start GPS from the locate button in the toolbar. The app can follow your live position and set your current location as the route start.

## Native iOS App

The repo also contains a Capacitor iOS wrapper in `ios/`.

```bash
npm run ios:sync
npm run ios:open
```

Then use Xcode to select your Apple team, bundle signing, and a connected iPhone or simulator. Xcode is required for building, signing, and installing the native app.

## Caveats

This is intentionally a learning prototype. It still needs better bike access handling, turn modeling, ferries, voice instructions, off-route rerouting, and a move away from public Overpass as the main data source.
