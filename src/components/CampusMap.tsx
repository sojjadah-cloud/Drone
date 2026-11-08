import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { GeoJSONSource, Map as MlMap, Marker } from 'maplibre-gl';
import { useI18n } from '@/i18n';
import { CAMPUS, GRID_DEG, STATIONS } from '@shared/campus';
import type { Agent, CampusDrone, CampusReport, Hotspot } from '@shared/campus';

if (import.meta.env.PROD) maplibregl.setWorkerUrl(new URL(workerUrl, location.href).href);

export const AGENT_COLOR: Record<Agent, string> = { water: '#2f8fe0', foam: '#e8b931', powder: '#e9edf0' };
const FLAME = '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>';

interface Props {
  pick?: { value: { lat: number; lng: number } | null; onChange: (p: { lat: number; lng: number }) => void };
  drones?: CampusDrone[];
  fires?: CampusReport[];
  hotspots?: Hotspot[];
  selectedFire?: number | null;
  onFire?: (id: number) => void;
  showStations?: boolean;
  className?: string;
}

const square = (lat: number, lng: number) => [[[lng, lat], [lng + GRID_DEG, lat], [lng + GRID_DEG, lat + GRID_DEG], [lng, lat + GRID_DEG], [lng, lat]]];

export function CampusMap({ pick, drones, fires, hotspots, selectedFire, onFire, showStations = true, className }: Props) {
  const { t, lang } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const markers = useRef(new Map<string, Marker>());
  const pin = useRef<Marker | null>(null);
  const [ready, setReady] = useState(false);
  const cb = useRef({ pick, onFire });
  cb.current = { pick, onFire };

  useEffect(() => {
    const m = new maplibregl.Map({
      container: box.current!,
      style: {
        version: 8,
        sources: { sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar' } },
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#dfe6e2' } }, { id: 'sat', type: 'raster', source: 'sat' }],
      },
      bounds: CAMPUS.bounds,
      fitBoundsOptions: { padding: 16 },
      maxBounds: [[CAMPUS.bounds[0][0] - 0.006, CAMPUS.bounds[0][1] - 0.006], [CAMPUS.bounds[1][0] + 0.006, CAMPUS.bounds[1][1] + 0.006]],
      dragRotate: false,
      attributionControl: { compact: true },
    });
    m.touchZoomRotate.disableRotation();
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), document.dir === 'rtl' ? 'top-left' : 'top-right');
    m.on('load', () => {
      m.addSource('campus', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [CAMPUS.boundary] } } });
      // Dim everything outside the campus so the reporting area is obvious.
      m.addSource('outside', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[57.9, 23.3], [58.7, 23.3], [58.7, 23.9], [57.9, 23.9], [57.9, 23.3]], [...CAMPUS.boundary].reverse()] } },
      });
      m.addLayer({ id: 'outside-dim', type: 'fill', source: 'outside', paint: { 'fill-color': '#0b1a14', 'fill-opacity': 0.45 } });
      m.addLayer({ id: 'campus-casing', type: 'line', source: 'campus', paint: { 'line-color': '#003a2c', 'line-width': 5 } });
      m.addLayer({ id: 'campus-line', type: 'line', source: 'campus', paint: { 'line-color': '#c9a24d', 'line-width': 2.5 } });
      m.addSource('hot', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({ id: 'hot-fill', type: 'fill', source: 'hot', paint: { 'fill-color': '#e02424', 'fill-opacity': ['interpolate', ['linear'], ['get', 'count'], 2, 0.25, 6, 0.5] } });
      m.addLayer({ id: 'hot-line', type: 'line', source: 'hot', paint: { 'line-color': '#ff4d4d', 'line-width': 2 } });
      m.addSource('paths', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({ id: 'paths', type: 'line', source: 'paths', paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-dasharray': [2, 2] } });
      setReady(true);
    });
    m.on('click', (e) => {
      if ((e.originalEvent.target as HTMLElement).closest('.fg-marker')) return;
      cb.current.pick?.onChange({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });
    map.current = m;
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(box.current!);
    return () => {
      ro.disconnect();
      m.remove();
      markers.current.clear();
      pin.current = null;
    };
  }, []);

  // red squares + flight paths
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    (m.getSource('hot') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: (hotspots ?? []).map((h) => ({ type: 'Feature', properties: { count: h.count }, geometry: { type: 'Polygon', coordinates: square(h.lat, h.lng) } })),
    });
    (m.getSource('paths') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: (drones ?? []).filter((d) => d.target).map((d) => ({
        type: 'Feature', properties: { color: d.state === 'returning' ? '#ffffff' : AGENT_COLOR[d.agent] },
        geometry: { type: 'LineString', coordinates: [[d.lng, d.lat], [d.target!.lng, d.target!.lat]] },
      })),
    });
  }, [ready, hotspots, drones]);

  // markers
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const seen = new Set<string>();
    const put = (key: string, ll: [number, number], sig: string, html: () => HTMLElement, onClick?: () => void) => {
      seen.add(key);
      const ex = markers.current.get(key);
      if (ex && (ex as any)._sig === sig) return void ex.setLngLat(ll);
      ex?.remove();
      const el = html();
      if (onClick) el.addEventListener('click', (e) => (e.stopPropagation(), onClick()));
      const mk = new maplibregl.Marker({ element: el }).setLngLat(ll).addTo(m);
      (mk as any)._sig = sig;
      markers.current.set(key, mk);
    };
    if (showStations)
      for (const s of STATIONS) {
        const here = (drones ?? []).filter((d) => d.station === s.id && (d.state === 'ready' || d.state === 'charging'));
        const sig = here.map((d) => d.id + d.state).join() + lang;
        put(`st:${s.id}`, [s.lng, s.lat], sig, () => {
          const el = document.createElement('div');
          el.className = 'fg-marker';
          el.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:3px">
            <div style="display:flex;gap:3px;padding:4px 6px;border-radius:8px;background:#005041;border:2px solid #c9a24d;box-shadow:0 3px 10px rgba(0,0,0,.4)">
              ${here.length ? here.map((d) => `<span title="${d.name}" style="width:11px;height:11px;border-radius:3px;background:${AGENT_COLOR[d.agent]};opacity:${d.state === 'ready' ? 1 : 0.35}"></span>`).join('') : '<span style="width:11px;height:11px"></span>'}
            </div>
            <span style="font:700 11px 'IBM Plex Sans Arabic',Inter;color:#fff;background:rgba(0,38,29,.85);padding:1px 6px;border-radius:4px;white-space:nowrap">${s.name[lang]}</span></div>`;
          return el;
        });
      }
    for (const f of fires ?? []) {
      const sel = selectedFire === f.id;
      put(`fire:${f.id}`, [f.lng, f.lat], `${sel}${f.status}`, () => {
        const el = document.createElement('button');
        el.className = 'fg-marker';
        el.setAttribute('aria-label', f.ref);
        el.innerHTML = `<span style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:999px;background:#d62828;color:#fff;box-shadow:0 0 0 ${sel ? 4 : 2}px #fff,0 4px 12px rgba(0,0,0,.45)" class="pulse-dot"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${FLAME}</svg></span>`;
        return el;
      }, () => cb.current.onFire?.(f.id));
    }
    for (const d of drones ?? []) {
      if (d.state === 'ready' || d.state === 'charging') continue;
      put(`dr:${d.id}`, [d.lng, d.lat], `${d.agent}${d.state === 'returning'}`, () => {
        const el = document.createElement('div');
        el.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:2px">
          <span style="display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:999px;background:${AGENT_COLOR[d.agent]};border:2px solid ${d.state === 'returning' ? '#fff' : '#003a2c'};box-shadow:0 2px 8px rgba(0,0,0,.5)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#003a2c" stroke-width="2.4"><circle cx="5" cy="5" r="3"/><circle cx="19" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/><path d="M7 7l3 3M17 7l-3 3M7 17l3-3M17 17l-3-3"/></svg></span>
          <span style="font:700 10px Inter;color:#fff;background:rgba(0,0,0,.7);padding:0 4px;border-radius:3px">${d.name}</span></div>`;
        return el;
      });
    }
    for (const [k, mk] of markers.current) if (!seen.has(k)) (mk.remove(), markers.current.delete(k));
  }, [ready, drones, fires, selectedFire, showStations, lang]);

  // report pin
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !pick) return;
    const v = pick.value;
    if (!v) return void (pin.current?.remove(), (pin.current = null));
    if (!pin.current) {
      const el = document.createElement('div');
      el.innerHTML = `<svg width="40" height="50" viewBox="0 0 38 48"><path d="M19 47s16-15.3 16-28A16 16 0 0 0 3 19c0 12.7 16 28 16 28z" fill="#d62828" stroke="#fff" stroke-width="2.5"/><circle cx="19" cy="19" r="6" fill="#fff"/></svg>`;
      pin.current = new maplibregl.Marker({ element: el, anchor: 'bottom', draggable: true }).setLngLat([v.lng, v.lat]).addTo(m);
      pin.current.on('dragend', () => {
        const ll = pin.current!.getLngLat();
        cb.current.pick?.onChange({ lat: ll.lat, lng: ll.lng });
      });
    } else pin.current.setLngLat([v.lng, v.lat]);
  }, [ready, pick?.value]);

  return <div ref={box} className={className} role="application" aria-label={t('campus.college')} />;
}
