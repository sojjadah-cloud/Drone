# ResQAir

Campus fire reporting and drone dispatch for the **Military Technological College (Muscat)**.

| Page | Path | Who |
|---|---|---|
| Report a fire | `/` | Anyone — tap the location on the campus map, choose size and type, optional details. |
| Pilot console | `/pilot` | Drone pilot only. |

## How dispatch works

Rules live in [`shared/campus.ts`](shared/campus.ts).

- 4 stations on campus, each with a **water**, **foam** and **powder** drone. All drones are **simulated**.
- Agent by fire type: grass/building → water · vehicle/fuel → foam · electrical/other → powder (never water on electrical).
- Drones by size: small 1 · medium 2 · large 3. The nearest ready drones are proposed with distance and ETA
  (cruise 15 m/s); the pilot presses **Launch**.
- In flight: battery, altitude, agent remaining, distance and ETA. Below **20 %** battery a drone returns to the
  **nearest** station; when its agent runs out it returns to refill. A drone is ready again at 40 % charge.
- Red squares mark ~110 m cells with repeated reports; dense cells more than 350 m from any station are listed
  as **suggested new stations**. Station positions are proposals — edit `STATIONS`.

The flight engine is deterministic: the server stores each drone's current phase (start time, from, to, battery,
payload) and the browser computes exact positions every frame, so movement is smooth and the backend is stateless.

## Run locally

Requires Node.js 22+.

```bash
npm install
npm run dev        # site on http://localhost:5180, API on :8787
```

Pilot sign-in: username `pilot`, password from `RESQAIR_PILOT_PASSWORD` (default `ResQAir#2026` — change it for any
public deployment).

## Deploy on Netlify

The API runs as a Netlify Function (`netlify/functions/api.mts`) and stores data in Netlify Blobs — no database to set up.

1. In Netlify, **Import from Git** and pick this repository. `netlify.toml` already sets the build command,
   publish folder and functions. (Drag-and-drop of `dist/` will **not** include the API.)
2. Site settings → Environment variables: set `RESQAIR_PILOT_PASSWORD`.
3. Deploy. Every push to `main` redeploys.

## Structure

```
shared/campus.ts            campus geometry, dispatch rules, deterministic flight engine (server + browser)
server/handler.ts           API: /api/config, /api/reports, /api/login, /api/state, /api/reports/:id/{dispatch,resolve}
server/index.ts             local server (same handler, JSON-file storage)
netlify/functions/api.mts   Netlify Function (same handler, Netlify Blobs storage)
src/pages/campus/           ReportPage, PilotPage, SimpleLayout
src/components/CampusMap.tsx  satellite campus map, stations, animated drones, hotspots
```

Campus boundary: OpenStreetMap way 688730411 (ODbL). Satellite imagery: Esri World Imagery.
