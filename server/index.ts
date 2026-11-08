import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedIfEmpty } from './seed.ts';
import { securityHeaders, sessionMiddleware, ValidationError } from './security.ts';
import { Simulator } from './simulator.ts';
import { buildAdapters } from './adapters.ts';
import { buildRouter } from './routes.ts';
import { attachRealtime } from './realtime.ts';
import { buildCampusRouter, CampusFleet } from './campus.ts';
import { MulterError } from 'multer';

const PORT = Number(process.env.PORT ?? 8787);
const here = dirname(fileURLToPath(import.meta.url));

if (seedIfEmpty()) console.log('[fireguard] demo dataset seeded');

const sim = new Simulator();
const adapters = buildAdapters(sim);
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.use(securityHeaders);
app.use(express.json({ limit: '64kb' }));
app.use(sessionMiddleware);
app.use('/api/campus', buildCampusRouter(new CampusFleet()));
app.use('/api', buildRouter(sim, adapters));
app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

// Serve built client in production
const dist = join(here, '..', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('*', (_req, res) => res.sendFile(join(dist, 'index.html')));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ValidationError) return res.status(422).json({ error: 'validation', field: err.field, reason: err.message });
  if (err instanceof MulterError) return res.status(413).json({ error: 'upload', reason: err.code });
  if (err instanceof SyntaxError) return res.status(400).json({ error: 'bad_json' });
  console.error(err);
  res.status(500).json({ error: 'internal' });
});

const server = createServer(app);
attachRealtime(server, () => sim.state);
sim.start();
server.listen(PORT, () => console.log(`[fireguard] API listening on http://localhost:${PORT}`));
