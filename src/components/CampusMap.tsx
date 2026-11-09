import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { GeoJSONSource, Map as MlMap, Marker } from 'maplibre-gl';
import { useI18n } from '@/i18n';
import { AGENTS, CAMPUS, GRID_DEG, STATIONS, droneAt } from '@shared/campus';
import type { Agent, DroneRec, Hotspot, Report } from '@shared/campus';

if (import.meta.env.PROD) maplibregl.setWorkerUrl(new URL(workerUrl, location.href).href);

export const AGENT_COLOR: Record<Agent, string> = { water: '#2f8fe0', foam: '#f2b72f', powder: '#eef1f3' };
const FLAME = '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>';
const square = (lat: number, lng: number) => [[[lng, lat], [lng + GRID_DEG, lat], [lng + GRID_DEG, lat + GRID_DEG], [lng, lat + GRID_DEG], [lng, lat]]];

function droneSvg(agent: Agent, size: number) {
  const c = AGENT_COLOR[agent];
  return `<svg width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true">
    <g stroke="#0b2a22" stroke-width="2.2" stroke-linecap="round"><path d="M9 9l14 14M23 9L9 23"/></g>
    <g fill="${c}" stroke="#0b2a22" stroke-width="1.5"><circle cx="8" cy="8" r="5"/><circle cx="24" cy="8" r="5"/><circle cx="8" cy="24" r="5"/><circle cx="24" cy="24" r="5"/></g>
    <rect x="12" y="11" width="8" height="10" rx="3" fill="#0b2a22"/><path d="M16 6.5l3 4h-6z" fill="#e2362f"/></svg>`;
}

interface Props {
  pick?: { value: { lat: number; lng: number } | null; onChange: (p: { lat: number; lng: number }) => void };
  drones?: DroneRec[];
  clockOffset?: number; // serverTime - Date.now()
  fires?: Report[];
  hotspots?: Hotspot[];
  selectedFire?: number | null;
  onFire?: (id: number) => void;
  selectedDrone?: string | null;
  onDrone?: (id: string) => void;
  showStations?: boolean;
  className?: string;
}

export function CampusMap(props: Props) {
  const { pick, drones, fires, hotspots, selectedFire, selectedDrone, showStations = true, className } = props;
  const { t, lang } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const droneMarkers = useRef(new Map<string, { m: Marker; icon: HTMLElement; root: HTMLElement; sig: string }>());
  const staticMarkers = useRef(new Map<string, Marker>());
  const pin = useRef<Marker | null>(null);
  const [ready, setReady] = useState(false);
  const live = useRef(props);
  live.current = props;

  // ---- init ---------------------------------------------------------------------------------
  useEffect(() => {
    const m = new maplibregl.Map({
      container: box.current!,
      style: {
        version: 8,
        sources: { sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar' } },
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#d9e0dc' } }, { id: 'sat', type: 'raster', source: 'sat' }],
      },
      bounds: CAMPUS.bounds,
      fitBoundsOptions: { padding: 12 },
      maxBounds: [[CAMPUS.bounds[0][0] - 0.006, CAMPUS.bounds[0][1] - 0.006], [CAMPUS.bounds[1][0] + 0.006, CAMPUS.bounds[1][1] + 0.006]],
      dragRotate: false,
      pitchWithRotate: false,
      attributionControl: { compact: true },
    });
    m.touchZoomRotate.disableRotation();
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), document.dir === 'rtl' ? 'top-left' : 'top-right');
    m.on('load', () => {
      m.addSource('outside', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[57.9, 23.3], [58.7, 23.3], [58.7, 23.9], [57.9, 23.9], [57.9, 23.3]], [...CAMPUS.boundary].reverse()] } },
      });
      m.addLayer({ id: 'outside-dim', type: 'fill', source: 'outside', paint: { 'fill-color': '#06140f', 'fill-opacity': 0.5 } });
      m.addSource('campus', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [CAMPUS.boundary] } } });
      m.addLayer({ id: 'campus-casing', type: 'line', source: 'campus', paint: { 'line-color': '#003a2c', 'line-width': 5 } });
      m.addLayer({ id: 'campus-line', type: 'line', source: 'campus', paint: { 'line-color': '#c9a24d', 'line-width': 2.5 } });
      m.addSource('hot', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({ id: 'hot-fill', type: 'fill', source: 'hot', paint: { 'fill-color': '#e02424', 'fill-opacity': ['interpolate', ['linear'], ['get', 'count'], 2, 0.22, 6, 0.45] } });
      m.addLayer({ id: 'hot-line', type: 'line', source: 'hot', paint: { 'line-color': '#ff5a5a', 'line-width': 1.5 } });
      m.addSource('paths', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({ id: 'paths-casing', type: 'line', source: 'paths', paint: { 'line-color': '#0b2a22', 'line-width': 5, 'line-opacity': 0.55 }, layout: { 'line-cap': 'round' } });
      m.addLayer({ id: 'paths', type: 'line', source: 'paths', paint: { 'line-color': ['get', 'color'], 'line-width': 2.5, 'line-dasharray': ['case', ['get', 'returning'], ['literal', [1.5, 1.5]], ['literal', [1, 0]]] }, layout: { 'line-cap': 'round' } });
      setReady(true);
    });
    m.on('click', (e) => {
      if ((e.originalEvent.target as HTMLElement).closest('.rq-marker')) return;
      live.current.pick?.onChange({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });
    map.current = m;
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(box.current!);
    return () => {
      ro.disconnect();
      m.remove();
      droneMarkers.current.clear();
      staticMarkers.current.clear();
      pin.current = null;
    };
  }, []);

  // ---- hotspots ----------------------------------------------------------------------------
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    (m.getSource('hot') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: (hotspots ?? []).map((h) => ({ type: 'Feature', properties: { count: h.count }, geometry: { type: 'Polygon', coordinates: square(h.lat, h.lng) } })),
    });
  }, [ready, hotspots]);

  // ---- stations & fires (static markers) ---------------------------------------------------
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const seen = new Set<string>();
    const put = (key: string, ll: [number, number], sig: string, make: () => HTMLElement, anchor: maplibregl.PositionAnchor = 'center') => {
      seen.add(key);
      const ex = staticMarkers.current.get(key);
      if (ex && (ex as any)._sig === sig) return;
      ex?.remove();
      const mk = new maplibregl.Marker({ element: make(), anchor }).setLngLat(ll).addTo(m);
      (mk as any)._sig = sig;
      staticMarkers.current.set(key, mk);
    };
    if (showStations) {
      const now = Date.now() + (live.current.clockOffset ?? 0);
      const views = (drones ?? []).map((d) => droneAt(d, now));
      for (const s of STATIONS) {
        const slots = AGENTS.map((a) => views.find((v) => v.home === s.id && v.agent === a && (v.phase === 'ready' || v.phase === 'charging')) ?? null);
        const sig = lang + slots.map((v) => (v ? v.id + v.phase : '-')).join();
        put(`st:${s.id}`, [s.lng, s.lat], sig, () => {
          const el = document.createElement('div');
          el.style.pointerEvents = 'none';
          el.innerHTML = `<div class="rq-station">
            <span class="rq-station-name">${s.name[lang]}</span>
            <span class="rq-station-pad">${slots
              .map((v, i) => v
                ? `<span class="rq-slot" data-state="${v.phase}" title="${v.id}">${droneSvg(v.agent, 18)}</span>`
                : `<span class="rq-slot" data-state="away" style="--c:${AGENT_COLOR[AGENTS[i]]}"></span>`)
              .join('')}</span></div>`;
          return el;
        }, 'bottom');
      }
    }
    for (const f of fires ?? []) {
      const sel = selectedFire === f.id;
      put(`fire:${f.id}`, [f.lng, f.lat], `${sel}`, () => {
        const el = document.createElement('button');
        el.className = 'rq-marker rq-fire';
        el.type = 'button';
        el.setAttribute('aria-label', f.ref);
        el.innerHTML = `<span class="rq-fire-ring"></span><span style="position:relative;display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:999px;background:#d62828;color:#fff;box-shadow:0 0 0 ${sel ? 4 : 2}px #fff,0 4px 12px rgba(0,0,0,.45)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${FLAME}</svg></span>`;
        el.addEventListener('click', (e) => (e.stopPropagation(), live.current.onFire?.(f.id)));
        return el;
      });
    }
    for (const [k, mk] of staticMarkers.current) if (!seen.has(k)) (mk.remove(), staticMarkers.current.delete(k));
  }, [ready, fires, selectedFire, showStations, lang, drones]);

  // ---- drones: create/update DOM when the record set changes --------------------------------
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const ids = new Set((drones ?? []).map((d) => d.id));
    for (const d of drones ?? []) {
      const sel = selectedDrone === d.id;
      const sig = `${sel}`;
      const ex = droneMarkers.current.get(d.id);
      if (ex && ex.sig === sig) continue;
      ex?.m.remove();
      const root = document.createElement('button');
      root.type = 'button';
      root.className = 'rq-marker rq-drone';
      root.setAttribute('aria-label', d.id);
      root.innerHTML = `<span class="rq-drone-icon" style="display:block;transition:transform .25s linear">${droneSvg(d.agent, 30)}</span><span class="rq-drone-tag" style="${sel ? 'background:#c9a24d;color:#0b2a22' : ''}">${d.id}</span>`;
      root.addEventListener('click', (e) => (e.stopPropagation(), live.current.onDrone?.(d.id)));
      const mk = new maplibregl.Marker({ element: root, anchor: 'center' }).setLngLat([d.from.lng, d.from.lat]).addTo(m);
      droneMarkers.current.set(d.id, { m: mk, icon: root.querySelector('.rq-drone-icon') as HTMLElement, root, sig });
    }
    for (const [k, v] of droneMarkers.current) if (!ids.has(k)) (v.m.remove(), droneMarkers.current.delete(k));
  }, [ready, drones, selectedDrone]);

  // ---- animation loop: exact positions every frame -----------------------------------------
  useEffect(() => {
    if (!ready) return;
    let raf = 0;
    let lastPaths = 0;
    const frame = (ts: number) => {
      const p = live.current;
      const now = Date.now() + (p.clockOffset ?? 0);
      const features: any[] = [];
      for (const rec of p.drones ?? []) {
        const mk = droneMarkers.current.get(rec.id);
        if (!mk) continue;
        const v = droneAt(rec, now);
        mk.m.setLngLat([v.pos.lng, v.pos.lat]);
        const parked = v.phase === 'ready' || v.phase === 'charging';
        const scale = parked ? 0.62 : 0.85 + Math.min(1, v.altitude / 40) * 0.25; // higher = slightly larger
        mk.icon.style.transform = `rotate(${v.heading}deg) scale(${scale})`;
        mk.root.dataset.phase = v.phase;
        mk.root.style.display = parked ? 'none' : '';
        if ((v.phase === 'enroute' || v.phase === 'returning') && v.to)
          features.push({
            type: 'Feature',
            properties: { color: v.phase === 'returning' ? '#ffffff' : AGENT_COLOR[v.agent], returning: v.phase === 'returning' },
            geometry: { type: 'LineString', coordinates: [[v.pos.lng, v.pos.lat], [v.to.lng, v.to.lat]] },
          });
      }
      if (ts - lastPaths > 120 && map.current?.getSource('paths')) {
        lastPaths = ts;
        (map.current.getSource('paths') as GeoJSONSource).setData({ type: 'FeatureCollection', features });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [ready]);

  // ---- report pin --------------------------------------------------------------------------
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !pick) return;
    const v = pick.value;
    if (!v) {
      pin.current?.remove();
      pin.current = null;
      return;
    }
    if (!pin.current) {
      const el = document.createElement('div');
      el.className = 'rq-marker';
      el.innerHTML = `<svg width="40" height="50" viewBox="0 0 38 48" aria-hidden="true"><path d="M19 47s16-15.3 16-28A16 16 0 0 0 3 19c0 12.7 16 28 16 28z" fill="#d62828" stroke="#fff" stroke-width="2.5"/><circle cx="19" cy="19" r="6" fill="#fff"/></svg>`;
      pin.current = new maplibregl.Marker({ element: el, anchor: 'bottom', draggable: true }).setLngLat([v.lng, v.lat]).addTo(m);
      pin.current.on('dragend', () => {
        const ll = pin.current!.getLngLat();
        live.current.pick?.onChange({ lat: ll.lat, lng: ll.lng });
      });
    } else pin.current.setLngLat([v.lng, v.lat]);
  }, [ready, pick?.value]);

  return <div ref={box} className={className} role="application" aria-label={t('brand.college')} />;
}
