import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { db, now, toNotification } from './db.ts';
import { resolveSession } from './security.ts';
import type { NotificationDTO, SimulatorState, WsMessage } from '../shared/domain.ts';

let wss: WebSocketServer | null = null;
let helloState: () => SimulatorState = () => ({ running: false, speed: 1, faults: { gpsDegraded: false, linkLoss: false, lowBattery: false } });

export function attachRealtime(server: Server, getSimState: () => SimulatorState) {
  helloState = getSimState;
  wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/ws')) return socket.destroy();
    // Same-origin check + staff session required: the realtime stream carries operational data.
    const origin = req.headers.origin;
    const host = req.headers.host;
    if (origin && host && new URL(origin).host !== host && !process.env.FIREGUARD_ALLOW_DEV_ORIGIN) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      return socket.destroy();
    }
    const session = resolveSession(req.headers.cookie);
    if (!session) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return socket.destroy();
    }
    wss!.handleUpgrade(req, socket, head, (ws) => {
      ws.send(JSON.stringify({ type: 'hello', data: { serverTime: now(), simulator: helloState() } } satisfies WsMessage));
    });
  });
  // Heartbeat so dead clients are dropped
  setInterval(() => {
    wss?.clients.forEach((c: WebSocket & { alive?: boolean }) => {
      if (c.alive === false) return c.terminate();
      c.alive = false;
      c.ping();
    });
  }, 15000).unref();
  wss.on('connection', (c: WebSocket & { alive?: boolean }) => {
    c.alive = true;
    c.on('pong', () => (c.alive = true));
  });
}

export function broadcast(msg: WsMessage) {
  if (!wss) return;
  const payload = JSON.stringify(msg);
  for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(payload);
}

export function notify(
  level: NotificationDTO['level'],
  kind: string,
  params: Record<string, string | number> = {},
  link: string | null = null,
) {
  const r = db
    .prepare('INSERT INTO notifications (at, level, kind, params, link) VALUES (?,?,?,?,?) RETURNING *')
    .get(now(), level, kind, JSON.stringify(params), link) as Record<string, any>;
  broadcast({ type: 'notification', data: toNotification(r) });
}
