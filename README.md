# FIREGUARD — MTC campus fire response

Simple two-page system for the **Military Technological College (Muscat)** campus:

| Page | URL | Who |
|---|---|---|
| Report a fire | `/` | Anyone. Tap the location on the campus map, choose size and type, optional details. |
| Drone pilot | `/pilot` | Pilot account only (`pilot` / demo password below). |

**How dispatch works** (rules in `shared/campus.ts`):
- 4 drone stations on campus, each with one water, one foam and one powder drone (all **simulated**).
- Agent by fire type: grass/building → water · vehicle/fuel → foam · electrical/other → powder (never water on electrical).
- Number of drones by size: small 1 · medium 2 · large 3. Nearest ready drones are proposed with distance and ETA
  (speed 15 m/s); the pilot presses **Launch**.
- In flight: battery, altitude, agent remaining, distance and arrival time. Below **20 %** battery a drone returns to the
  **nearest** station; when its agent runs out it returns to refill.
- Red squares mark grid cells (~110 m) with repeated reports; dense cells far (> 350 m) from any station are listed as
  **suggested new stations**. Station positions are proposals — adjust `STATIONS` to the real fire-prone areas.

Campus boundary: OpenStreetMap way 688730411 (ODbL). Satellite imagery: Esri World Imagery.

---

# FIREGUARD | فاير جارد

Smart fire reporting, emergency response and drone command platform — **prototype**.

> FIREGUARD is an independent prototype. It is **not** an official service of the Civil Defence and Ambulance
> Authority (CDAA), uses no official logos, and **does not dispatch emergency services**. In an emergency, call **9999**.

## Run locally

Requires Node.js 24+ (uses the built-in `node:sqlite` and TypeScript type stripping — no native modules).

```bash
npm install
npm run dev          # API on :8787 + web on :5180
```

Open http://localhost:5180. Arabic (RTL) is the default; switch to English from the header.

| Command | What it does |
|---|---|
| `npm run dev` | API (watch mode) + Vite dev server |
| `npm run typecheck` | TypeScript check of client, server and shared code |
| `npm run build` then `npm start` | Production build served by the API on :8787 |
| `npm run seed:reset` | Delete the local DB + uploads and reseed demo data (stop the API first) |

### Demo staff accounts (local only)

`admin`, `supervisor`, `dispatcher`, `pilot`, `safety`, `analyst` — shared password `FireGuard#Demo2026`
(override with `FIREGUARD_DEMO_PASSWORD` before seeding). Each role sees and can do different things; try the
full flow by signing in as different users:

1. **Public** → `/report`: submit a report (GPS or map pin), get a tracking reference, follow it at `/track`.
2. **dispatcher** → Incident Reports › Intake: verify (creates incident), reject, or link as duplicate. Plan a mission.
3. **supervisor** → Mission Management: authorize the mission.
4. **pilot** → Live Monitoring: complete the preflight checklist, request take-off, pause/RTL/land/abort.
5. **pilot** → Fire Analysis: confirm/reject AI suggestions; request suppression, confirm target, run readiness checks.
6. **safety** → Fire Analysis: safety approval (must be a different person — two-person rule).
7. **pilot** → type `RELEASE` to perform the **simulated** release; record outcome.
8. **admin** → Settings: simulator time scale (1–10×) and fault injection (GPS degradation, link loss, battery drain).

## What is real vs. simulated

| Area | Status |
|---|---|
| Public reporting, location correction, secure uploads, tracking, cancellation | Implemented |
| Incident workflow: verification, rule-based priority, assignment, status transitions, merge, notes, timeline | Implemented |
| RBAC (server-enforced), session cookies (HttpOnly, SameSite=Strict), CSRF token, rate limiting, login lockout, audit log | Implemented |
| Mission planning → authorization → preflight → command, with state checks and confirmations | Implemented |
| Analytics computed from stored records, CSV export (audited, formula-injection safe) | Implemented |
| Aircraft telemetry & command execution | **Simulated** (built-in simulator adapter) |
| Camera / thermal video | **Simulated** canvas feed, labelled on screen |
| AI fire detection | **Simulated** model output, labelled "unvalidated", operator review required |
| Payload release | **Simulated only** — no hardware path exists |
| MAVLink / PX4 / ArduPilot / vendor SDK adapters | Interfaces defined; **refuse all commands** until integrated & certified |
| WebRTC video, authority dispatch integration, MFA (IdP), PostGIS, object storage, Redis | Not configured — see Architecture |

All seeded records carry `is_demo = 1` and show a **Demo** badge; analytics can exclude them.

## Architecture

```
shared/domain.ts     Types, status machines, priority rules, role→permission matrix (used by client AND server)
server/
  index.ts           Express app, security headers, error handling, static hosting of dist/
  routes.ts          REST API — every state change: permission check → state validation → audit log
  security.ts        scrypt passwords, sessions, CSRF, rate limiting, validation helpers, audit()
  db.ts              SQLite schema + row→DTO mappers (repository layer; swap for PostgreSQL/PostGIS)
  simulator.ts       Flight simulator: kinematics, battery, failsafes (low battery / link loss RTL), detections
  adapters.ts        DroneAdapter interface; simulator + hardware stubs that refuse commands
  realtime.ts        Authenticated WebSocket broadcast (telemetry, incidents, missions, notifications)
src/
  i18n/              Arabic + English dictionaries, RTL/LTR switching, Latin-digit formatting (Asia/Muscat)
  styles.css         Design tokens (light institutional + dark operations theme), Tailwind v4 @theme mapping
  components/        UI kit (ui.tsx), domain atoms (domain.tsx), MapView (MapLibre), LiveVideoPanel, dialogs
  layouts/           PublicLayout, OpsApp (AppShell: collapsible sidebar, command header, notifications)
  pages/public/      Landing, ReportWizard, Track, Login
  pages/ops/         Overview, LiveOps, Incidents, IncidentDetail, GisMap, Fleet, DroneDetail, Missions,
                     Monitor (GCS), Analysis (AI + suppression), Analytics, Users, Settings
```

**Safety principles enforced in code**

- The browser never talks to an aircraft. Commands go browser → authenticated API → permission + mission-state
  checks → adapter. Flight credentials would live only in server configuration.
- Take-off requires authorization by a supervisor *and* a complete preflight checklist by the pilot.
- Stale telemetry (> 4 s) is an explicit state: only RTL / land / abort are accepted.
- Suppression: no autonomous release. Request → positive target confirmation → live readiness checks →
  safety-officer approval by a different person → typed `RELEASE` confirmation, re-checked server-side.
- Incident priority comes from fixed rules over reported facts (`shared/domain.ts`), never from AI output.
- Reports are never described as delivered to the authority (`authorityNotified: false`).

**Production path**: PostgreSQL + PostGIS behind `db.ts`; Redis for rate limits / pub-sub across instances;
S3-compatible object storage with malware scanning for uploads; OIDC identity provider with MFA for privileged
roles; WebRTC media gateway; real adapters developed against SITL and bench-tested before enabling.

## Map data & photos

Operations maps use Esri World Imagery satellite tiles; the public report picker uses OpenStreetMap tiles
(attribution shown on the map). Geofences and the operational boundary are **indicative demonstration geometry**,
not authoritative airspace data. Site photographs come from Unsplash (Unsplash License) via its CDN — see
`src/lib/photos.ts`. The camera panel draws a real aerial photo behind a clearly labelled **simulated** feed.
