// Local server for development and self-hosting: same handler as the Netlify Function,
// with state kept in a JSON file. Also serves the built site from dist/ when present.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, createReadStream } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from './handler.ts';
import type { State } from '../shared/campus.ts';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = process.env.RESQAIR_DATA_DIR ?? join(here, 'data');
const FILE = join(DATA, 'resqair.json');
const DIST = join(here, '..', 'dist');
const PORT = Number(process.env.PORT ?? 8787);
mkdirSync(DATA, { recursive: true });

const store = {
  load: async (): Promise<State | null> => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : null),
  save: async (s: State) => {
    writeFileSync(FILE + '.tmp', JSON.stringify(s));
    renameSync(FILE + '.tmp', FILE);
  },
};

const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    headers.set('x-forwarded-for', req.socket.remoteAddress ?? 'local');
    const r = await handle(new Request(url, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined }), store);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    return res.end(Buffer.from(await r.arrayBuffer()));
  }
  // static site (production build)
  const p = normalize(join(DIST, decodeURIComponent(url.pathname)));
  const file = p.startsWith(DIST) && existsSync(p) && extname(p) ? p : join(DIST, 'index.html');
  if (!existsSync(file)) return res.writeHead(404).end('Run "npm run build" first, or use "npm run dev".');
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'x-content-type-options': 'nosniff' });
  createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`[resqair] http://localhost:${PORT}`));
