// ResQAir API — one fetch-style handler used by both the Netlify Function and the local dev server.
import {
  CAMPUS, FIRE_SIZES, FIRE_TYPES, STATIONS, advance, hotspots, initialState, insideCampus, launch, planFor, resolve,
} from '../shared/campus.ts';
import type { FireSize, FireType, Report, State } from '../shared/campus.ts';

export interface Store {
  load(): Promise<State | null>;
  save(s: State): Promise<void>;
}

const PILOT_USER = 'pilot';
const pilotPassword = () => (globalThis as any).process?.env?.RESQAIR_PILOT_PASSWORD || 'ResQAir#2026';
const TOKEN_TTL = 12 * 3600 * 1000;
const enc = new TextEncoder();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const err = (code: string, status: number, extra: Record<string, unknown> = {}) => json({ error: code, ...extra }, status);

async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha(s: string) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
  return Array.from(h.slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}
function randomSecret() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
function refCode() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return 'RQ-' + Array.from(crypto.getRandomValues(new Uint8Array(5)), (x) => a[x % a.length]).join('');
}

async function isPilot(req: Request, s: State) {
  const h = req.headers.get('authorization') ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, await hmac(s.secret, `pilot.${exp}`));
}

export async function handle(req: Request, store: Store): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, '').replace(/\/$/, '') || '/';
  const now = Date.now();
  let s = await store.load();
  if (!s || s.v !== 2) {
    s = initialState(now, randomSecret());
    await store.save(s);
  }

  try {
    // ---- public ---------------------------------------------------------------------------
    if (req.method === 'GET' && path === '/config') return json({ campus: CAMPUS, stations: STATIONS });

    if (req.method === 'POST' && path === '/reports') {
      const b = await req.json().catch(() => ({}));
      const lat = Number(b.lat);
      const lng = Number(b.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !insideCampus(lat, lng)) return err('outside_campus', 422);
      if (!FIRE_SIZES.includes(b.size)) return err('validation', 422, { field: 'size' });
      if (!FIRE_TYPES.includes(b.type)) return err('validation', 422, { field: 'type' });
      const details = typeof b.details === 'string' ? b.details.trim().slice(0, 500) : '';
      // Rate limit: 6 reports / 10 min per client
      const ip = req.headers.get('x-nf-client-connection-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'local';
      const key = await sha(`${s.secret}:${ip}`);
      const recent = (s.rl[key] ?? []).filter((t) => now - t < 10 * 60 * 1000);
      if (recent.length >= 6) return err('rate_limited', 429);
      s.rl[key] = [...recent, now];
      const r: Report = { id: s.seq++, ref: refCode(), lat, lng, size: b.size as FireSize, type: b.type as FireType, details, status: 'new', createdAt: now, resolvedAt: null };
      s.reports.push(r);
      await store.save(s);
      return json({ ref: r.ref, createdAt: r.createdAt }, 201);
    }

    if (req.method === 'POST' && path === '/login') {
      const b = await req.json().catch(() => ({}));
      const ok = String(b.username ?? '').trim().toLowerCase() === PILOT_USER && safeEqual(String(b.password ?? ''), pilotPassword());
      if (!ok) {
        await new Promise((r) => setTimeout(r, 600)); // slow down guessing
        return err('invalid', 401);
      }
      const exp = String(now + TOKEN_TTL);
      return json({ token: `${exp}.${await hmac(s.secret, `pilot.${exp}`)}`, expires: Number(exp) });
    }

    // ---- pilot only ------------------------------------------------------------------------
    if (!(await isPilot(req, s))) return err('unauthenticated', 401);

    if (req.method === 'GET' && path === '/state') {
      s.drones = s.drones.map((d) => advance(d, now));
      const active = s.reports.filter((r) => r.status !== 'resolved').sort((a, b) => b.createdAt - a.createdAt);
      return json({
        serverTime: now,
        drones: s.drones,
        active: active.map((r) => ({ ...r, plan: planFor(r, s!.drones, now), assigned: s!.drones.filter((d) => d.reportId === r.id).map((d) => d.id) })),
        hotspots: hotspots(s.reports),
        resolvedToday: s.reports.filter((r) => r.resolvedAt && now - r.resolvedAt < 864e5 && !r.demo).length,
      });
    }

    const m = path.match(/^\/reports\/(\d+)\/(dispatch|resolve)$/);
    if (req.method === 'POST' && m) {
      const id = Number(m[1]);
      const r = s.reports.find((x) => x.id === id);
      if (!r || r.status === 'resolved') return err('not_found', 404);
      if (m[2] === 'dispatch') {
        const plan = launch(s, id, now);
        if (!plan.drones.length) return err('no_drones_available', 409);
        await store.save(s);
        return json(plan);
      }
      resolve(s, id, now);
      await store.save(s);
      return json({ ok: true });
    }

    return err('not_found', 404);
  } catch (e) {
    console.error(e);
    return err('internal', 500);
  }
}
